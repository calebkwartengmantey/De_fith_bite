import {
  allowedAdminPhones,
  ApiError,
  constantTimeEqual,
  ensureSameOrigin,
  Env,
  hmac,
  json,
  normalizePhone,
  nowIso,
  OrderItem,
  OrderRow,
  parseItems,
  rateLimit,
  randomHex,
  requireConfiguration,
  readJson,
  sha256,
  siteUrl
} from './shared';
import {
  customerStatusSms,
  deliverOutbox,
  MAX_AUTOMATIC_SMS_ATTEMPTS,
  queueSms,
  SMS_RETRY_INTERVAL_MS
} from './sms';

interface Product {
  id: string;
  name: string;
  price_pesewas: number;
  online_orderable: number;
}

interface ManagedProduct {
  id: string;
  name: string;
  price_pesewas: number;
  active: number;
  category: string;
  description: string;
  price_label: string;
  previous_price_label: string;
  image_url: string;
  online_orderable: number;
  sort_order: number;
}

interface NewsPost {
  id: string;
  title: string;
  body: string;
  image_url: string;
  publish_at: string | null;
  show_on_homepage: number;
  created_at: string;
  updated_at: string;
}

interface PaystackResult {
  status: boolean;
  message: string;
  data?: {
    authorization_url?: string;
    reference?: string;
    status?: string;
    amount?: number;
    currency?: string;
  };
}

interface Session {
  phone: string;
}

interface SmsNotificationRow {
  recipient: string;
  message_type: string;
  delivery_status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

function cookie(request: Request): string | null {
  const value = (request.headers.get('Cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('admin_session='));
  return value ? value.slice('admin_session='.length) : null;
}

function sessionCookie(value: string, seconds: number, secure: boolean): string {
  return `admin_session=${value}; Path=/; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Strict; Max-Age=${seconds}`;
}

async function paystack(env: Env, path: string, init: RequestInit): Promise<PaystackResult> {
  requireConfiguration(env, ['PAYSTACK_SECRET_KEY']);
  const response = await fetch(`https://api.paystack.co${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' }
  });
  let payload: unknown;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    throw new Error(`Paystack returned an unreadable response (HTTP ${response.status}).`);
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error(`Paystack returned an invalid response (HTTP ${response.status}).`);
  }
  const body = payload as Record<string, unknown>;
  const providerMessage = typeof body.message === 'string' ? body.message.slice(0, 180) : 'No reason was provided.';
  if (!response.ok || body.status !== true) {
    throw new Error(`Paystack rejected the request (HTTP ${response.status}): ${providerMessage}`);
  }
  const data = body.data && typeof body.data === 'object'
    ? body.data as PaystackResult['data']
    : undefined;
  return { status: true, message: providerMessage, data };
}

async function requireAdmin(request: Request, env: Env): Promise<Session> {
  const token = cookie(request);
  if (!token) throw new ApiError(401, 'Sign in to access the staff dashboard.');
  const row = await env.DB.prepare('SELECT phone FROM admin_sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(await sha256(token), Math.floor(Date.now() / 1000)).first<Session>();
  if (!row || row.phone !== `admin:${env.ADMIN_USERNAME}`) throw new ApiError(401, 'Your staff session has expired. Sign in again.');
  return row;
}

function publicOrder(row: OrderRow) {
  const labels = ['Received', 'Preparing', 'Ready for pickup', 'Completed'];
  const index = { received: 0, preparing: 1, ready: 2, completed: 3 }[row.status as 'received' | 'preparing' | 'ready' | 'completed'] ?? -1;
  return {
    orderNumber: row.order_number,
    status: row.status,
    statusLabel: row.status === 'awaiting_restaurant' ? 'Paid — awaiting restaurant confirmation' : labels[index],
    statuses: labels.map((label, position) => ({ label, complete: position <= index })),
    items: parseItems(row).map((item) => ({ name: item.name, quantity: item.quantity, lineTotal: item.lineTotal / 100 })),
    total: row.total_pesewas / 100,
    updatedAt: row.updated_at
  };
}

function orderSummaryForSms(order: OrderRow): string {
  const items = parseItems(order);
  if (items.length === 0) return 'No items recorded';
  return items.map((item) => `${item.name}, quantity ${item.quantity}`).join('; ');
}

async function adminOrderObject(env: Env, row: OrderRow) {
  const [notifications, review] = await Promise.all([
    env.DB.prepare(`
      SELECT recipient, message_type, delivery_status, attempts, last_error, created_at
      FROM sms_outbox WHERE order_id = ? AND delivery_status != 'sent' ORDER BY id
    `).bind(row.id).all<SmsNotificationRow>(),
    env.DB.prepare('SELECT rating, review_text, created_at FROM order_reviews WHERE order_id = ?')
      .bind(row.id).first<{ rating: number; review_text: string; created_at: string }>()
  ]);
  return {
    orderNumber: row.order_number,
    status: row.status,
    customerName: row.customer_name,
    email: row.customer_email,
    phone: row.customer_phone,
    items: parseItems(row).map((item) => ({ name: item.name, quantity: item.quantity, lineTotal: item.lineTotal / 100 })),
    total: row.total_pesewas / 100,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    failedNotifications: notifications.results.length,
    notifications: notifications.results.map((notification) => ({
      recipient: notification.recipient,
      messageType: notification.message_type,
      status: notification.delivery_status,
      attempts: notification.attempts,
      error: notification.last_error,
      createdAt: notification.created_at
    })),
    review: review ? { rating: review.rating, text: review.review_text, createdAt: review.created_at } : null
  };
}

async function findPaidOrder(env: Env, orderNumber: string): Promise<OrderRow> {
  const row = await env.DB.prepare("SELECT * FROM orders WHERE order_number = ? AND payment_status = 'paid'")
    .bind(orderNumber).first<OrderRow>();
  if (!row) throw new ApiError(404, 'Paid order not found.');
  return row;
}

async function adminLogin(request: Request, env: Env): Promise<Response> {
  ensureSameOrigin(request);
  requireConfiguration(env, ['ADMIN_USERNAME', 'ADMIN_ACCESS_KEY']);
  await rateLimit(env, request, 'admin-login', 8, 600);
  const body = await readJson(request);
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const accessKey = typeof body.accessKey === 'string' ? body.accessKey : '';
  const accessKeyMatches = accessKey.length <= 512 &&
    constantTimeEqual(await sha256(accessKey), await sha256(env.ADMIN_ACCESS_KEY));
  if (username !== env.ADMIN_USERNAME || !accessKeyMatches) {
    throw new ApiError(401, 'Username or access key is incorrect.');
  }
  const now = Math.floor(Date.now() / 1000);
  const token = randomHex(32);
  await env.DB.prepare('INSERT INTO admin_sessions (token_hash, phone, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), `admin:${env.ADMIN_USERNAME}`, now + 43200, now).run();
  const secure = new URL(request.url).protocol === 'https:';
  return json({ username, expiresIn: 43200 }, 200, { 'Set-Cookie': sessionCookie(token, 43200, secure) });
}

async function createCheckout(request: Request, env: Env): Promise<Response> {
  ensureSameOrigin(request);
  requireConfiguration(env, ['PAYSTACK_SECRET_KEY', 'SITE_URL']);
  await rateLimit(env, request, 'checkout', 12, 600);
  const body = await readJson(request);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const submittedEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (name.length < 2 || name.length > 100) throw new ApiError(400, 'Enter your full name.');
  if (submittedEmail && (submittedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submittedEmail))) {
    throw new ApiError(400, 'Enter a valid email address.');
  }
  const phone = normalizePhone(body.phone);
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) throw new ApiError(400, 'Your cart is empty.');
  const quantities = new Map<string, number>();
  for (const entry of body.items) {
    if (!entry || typeof entry !== 'object') throw new ApiError(400, 'The cart contains an invalid item.');
    const item = entry as Record<string, unknown>;
    if (typeof item.productId !== 'string' || !/^[a-z0-9-]{1,60}$/.test(item.productId) ||
        !Number.isInteger(item.quantity) || Number(item.quantity) < 1 || Number(item.quantity) > 10) {
      throw new ApiError(400, 'The cart contains an invalid item or quantity.');
    }
    quantities.set(item.productId, (quantities.get(item.productId) || 0) + Number(item.quantity));
  }
  if ([...quantities.values()].some((quantity) => quantity > 10)) throw new ApiError(400, 'Maximum quantity per item is 10.');
  const ids = [...quantities.keys()];
  const products = await env.DB.prepare(`
    SELECT id, name, price_pesewas, online_orderable FROM products
    WHERE active = 1 AND online_orderable = 1 AND id IN (${ids.map(() => '?').join(',')})
  `).bind(...ids).all<Product>();
  if (products.results.length !== ids.length) throw new ApiError(400, 'A menu item is unavailable. Refresh the menu and try again.');
  const items: OrderItem[] = products.results.map((product) => {
    const quantity = quantities.get(product.id) || 0;
    return { productId: product.id, name: product.name, quantity, unitPrice: product.price_pesewas, lineTotal: product.price_pesewas * quantity };
  });
  const total = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const id = crypto.randomUUID();
  const orderNumber = `D5B-${randomHex(6).toUpperCase()}`;
  const email = submittedEmail || `${orderNumber.toLowerCase()}@example.com`;
  const reference = `D5B-${randomHex(16)}`;
  const now = nowIso();
  await env.DB.prepare(`
    INSERT INTO orders (id, order_number, paystack_reference, customer_name, customer_email, customer_phone, items_json,
      total_pesewas, payment_status, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'awaiting_restaurant', ?, ?)
  `).bind(id, orderNumber, reference, name, email, phone, JSON.stringify(items), total, now, now).run();
  try {
    const result = await paystack(env, '/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email,
        amount: total,
        currency: env.PAYSTACK_CURRENCY || 'GHS',
        reference,
        callback_url: siteUrl(env, '/payment-return.html'),
        metadata: { order_number: orderNumber, customer_phone: phone }
      })
    });
    if (!result.data?.authorization_url || result.data.reference !== reference) throw new Error('Paystack returned an invalid checkout response.');
    return json({ authorizationUrl: result.data.authorization_url, orderNumber, reference });
  } catch (error) {
    console.error('Paystack checkout initialization failed', error);
    await env.DB.prepare("UPDATE orders SET payment_status = 'failed', updated_at = ? WHERE id = ? AND payment_status = 'pending'")
      .bind(nowIso(), id).run();
    const reason = error instanceof Error ? error.message : 'Unknown Paystack error.';
    throw new ApiError(502, `Could not start Paystack checkout: ${reason}`);
  }
}

async function confirmPayment(env: Env, reference: string): Promise<{ paid: boolean; orderNumber: string }> {
  requireConfiguration(env, ['PAYSTACK_SECRET_KEY', 'SITE_URL']);
  const order = await env.DB.prepare('SELECT * FROM orders WHERE paystack_reference = ?').bind(reference).first<OrderRow>();
  if (!order) throw new ApiError(404, 'Order not found.');
  const result = await paystack(env, `/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' });
  const payment = result.data;
  if (!payment || payment.reference !== reference) throw new ApiError(502, 'Paystack returned an invalid verification result.');
  if (payment.status !== 'success' || payment.amount !== order.total_pesewas || payment.currency !== (env.PAYSTACK_CURRENCY || 'GHS')) {
    throw new ApiError(402, 'Paystack has not confirmed a successful payment for this order.');
  }
  if (order.payment_status !== 'paid') {
    const now = nowIso();
    await env.DB.prepare(`
      UPDATE orders SET payment_status = 'paid', updated_at = ?, paid_at = ?
      WHERE id = ? AND payment_status = 'pending' AND total_pesewas = ?
    `).bind(now, now, order.id, payment.amount).run();
  }
  const current = await env.DB.prepare('SELECT payment_status, paid_at FROM orders WHERE id = ?')
    .bind(order.id).first<{ payment_status: string; paid_at: string | null }>();
  if (current?.payment_status !== 'paid') throw new ApiError(409, 'Payment confirmation is still processing.');
  const paidAt = current.paid_at || nowIso();
  const itemCount = parseItems(order).reduce((sum, item) => sum + item.quantity, 0);
  const adminLink = siteUrl(env, `/admin.html?order=${encodeURIComponent(order.order_number)}`);
  const summary = orderSummaryForSms(order);
  const alert = `New paid order ${order.order_number}: ${summary}. Customer: ${order.customer_name}, ${order.customer_phone}. ${itemCount} item(s), GH₵${(order.total_pesewas / 100).toFixed(2)}. View order: ${adminLink}`;
  const statements = [
    env.DB.prepare(`
      INSERT INTO order_events (order_id, status, created_at)
      SELECT ?, 'awaiting_restaurant', ?
      WHERE NOT EXISTS (
        SELECT 1 FROM order_events WHERE order_id = ? AND status = 'awaiting_restaurant'
      )
    `).bind(order.id, paidAt, order.id)
  ];
  for (const recipient of allowedAdminPhones(env)) {
    statements.push(env.DB.prepare(`
      INSERT INTO sms_outbox (order_id, recipient, message_type, message, created_at)
      VALUES (?, ?, 'owner_new_order', ?, ?)
      ON CONFLICT(order_id, recipient, message_type) DO NOTHING
    `).bind(order.id, recipient, alert, paidAt));
  }
  await env.DB.batch(statements);
  await deliverOutbox(env, order.id);
  return { paid: true, orderNumber: order.order_number };
}

async function confirmRoute(request: Request, env: Env): Promise<Response> {
  ensureSameOrigin(request);
  await rateLimit(env, request, 'payment-confirm', 30, 600);
  const reference = (await readJson(request)).reference;
  if (typeof reference !== 'string' || !/^[A-Za-z0-9_-]{10,100}$/.test(reference)) throw new ApiError(400, 'Payment reference is invalid.');
  return json(await confirmPayment(env, reference));
}

async function webhook(request: Request, env: Env): Promise<Response> {
  requireConfiguration(env, ['PAYSTACK_SECRET_KEY']);
  const body = await request.text();
  if (body.length > 16000) throw new ApiError(413, 'Webhook payload is too large.');
  const received = request.headers.get('x-paystack-signature') || '';
  const expected = await hmac(body, env.PAYSTACK_SECRET_KEY, 'SHA-512');
  if (!constantTimeEqual(received.toLowerCase(), expected)) throw new ApiError(401, 'Invalid Paystack signature.');
  let event: { event?: string; data?: { reference?: string } };
  try {
    event = JSON.parse(body) as typeof event;
  } catch {
    throw new ApiError(400, 'Invalid webhook payload.');
  }
  if (event.event !== 'charge.success' || typeof event.data?.reference !== 'string') return json({ received: true });
  try {
    await confirmPayment(env, event.data.reference);
    return json({ received: true });
  } catch (error) {
    console.error('Paystack webhook processing failed', error);
    if (error instanceof ApiError && error.status === 404) return json({ received: true });
    throw new ApiError(503, 'Could not process payment event; Paystack may retry.');
  }
}

async function lookupOrder(request: Request, env: Env): Promise<Response> {
  ensureSameOrigin(request);
  await rateLimit(env, request, 'order-lookup', 24, 600);
  const body = await readJson(request);
  const number = typeof body.orderNumber === 'string' ? body.orderNumber.trim().toUpperCase() : '';
  if (!/^D5B-[A-F0-9]{12}$/.test(number)) throw new ApiError(404, 'No paid order matched that order number and phone number.');
  const phone = normalizePhone(body.phone);
  const row = await env.DB.prepare(`
    SELECT * FROM orders WHERE order_number = ? AND customer_phone = ? AND payment_status = 'paid'
  `).bind(number, phone).first<OrderRow>();
  if (!row) throw new ApiError(404, 'No paid order matched that order number and phone number.');
  const review = await env.DB.prepare('SELECT rating, review_text, created_at FROM order_reviews WHERE order_id = ?')
    .bind(row.id).first<{ rating: number; review_text: string; created_at: string }>();
  return json({
    ...publicOrder(row),
    canReview: row.status === 'completed' && !review,
    review: review ? { rating: review.rating, text: review.review_text, createdAt: review.created_at } : null
  });
}

async function submitOrderReview(request: Request, env: Env): Promise<Response> {
  ensureSameOrigin(request);
  await rateLimit(env, request, 'order-review', 8, 600);
  const body = await readJson(request);
  const orderNumber = typeof body.orderNumber === 'string' ? body.orderNumber.trim().toUpperCase() : '';
  if (!/^D5B-[A-F0-9]{12}$/.test(orderNumber)) throw new ApiError(404, 'Completed order not found.');
  const phone = normalizePhone(body.phone);
  if (!Number.isInteger(body.rating) || Number(body.rating) < 1 || Number(body.rating) > 5) {
    throw new ApiError(400, 'Choose a rating from 1 to 5 stars.');
  }
  const reviewText = typeof body.review === 'string' ? body.review.trim() : '';
  const displayPublicly = body.displayPublicly === true;
  if (reviewText.length < 2 || reviewText.length > 1000) {
    throw new ApiError(400, 'Write a review between 2 and 1000 characters.');
  }
  const order = await env.DB.prepare(`
    SELECT id FROM orders
    WHERE order_number = ? AND customer_phone = ? AND payment_status = 'paid' AND status = 'completed'
  `).bind(orderNumber, phone).first<{ id: string }>();
  if (!order) throw new ApiError(404, 'Only completed orders can be reviewed. Check the order number and phone number.');
  const createdAt = nowIso();
  const inserted = await env.DB.prepare(`
    INSERT INTO order_reviews (id, order_id, rating, review_text, created_at, public_consent)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM orders WHERE id = ? AND payment_status = 'paid' AND status = 'completed'
    )
    ON CONFLICT(order_id) DO NOTHING
    RETURNING id
  `).bind(crypto.randomUUID(), order.id, Number(body.rating), reviewText, createdAt, displayPublicly ? 1 : 0, order.id).first<{ id: string }>();
  if (!inserted) throw new ApiError(409, 'A review has already been submitted for this order.');
  return json({ review: { rating: Number(body.rating), text: reviewText, createdAt, displayPublicly } }, 201);
}

async function featuredReviews(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(`
    SELECT o.customer_name, r.review_text, r.created_at
    FROM order_reviews r
    JOIN orders o ON o.id = r.order_id
    WHERE r.rating = 5 AND r.public_consent = 1
      AND o.payment_status = 'paid' AND o.status = 'completed'
    ORDER BY r.created_at DESC
    LIMIT 12
  `).all<{ customer_name: string; review_text: string; created_at: string }>();
  return json({
    reviews: rows.results.map((row) => ({
      name: row.customer_name,
      text: row.review_text
    }))
  });
}

function productObject(row: ManagedProduct) {
  const price = row.price_pesewas / 100;
  return {
    id: row.id,
    name: row.name,
    active: row.active === 1,
    category: row.category,
    description: row.description,
    priceLabel: row.online_orderable ? `GH₵${price.toFixed(2).replace(/\.00$/, '')}` : row.price_label,
    previousPriceLabel: row.previous_price_label,
    imageUrl: row.image_url,
    onlineOrderable: row.online_orderable === 1,
    checkoutPrice: row.online_orderable ? price : null,
    sortOrder: row.sort_order
  };
}

async function publicMenu(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(`
    SELECT * FROM products WHERE active = 1 ORDER BY category, sort_order, name
  `).all<ManagedProduct>();
  return json({ products: rows.results.map(productObject) });
}

async function publicNews(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(`
    SELECT * FROM news_posts WHERE publish_at IS NOT NULL AND publish_at <= ?
    ORDER BY publish_at DESC LIMIT 50
  `).bind(nowIso()).all<NewsPost>();
  return json({ posts: rows.results.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    imageUrl: row.image_url,
    publishAt: row.publish_at
  })) });
}

async function publicHomepageNews(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(`
    SELECT news_id, title, image_url FROM homepage_news_slides
    ORDER BY created_at ASC
  `).all<{ news_id: string; title: string; image_url: string }>();
  return json({ posts: rows.results.map((row) => ({
    id: row.news_id,
    title: row.title,
    imageUrl: row.image_url
  })) });
}

async function publicSiteSettings(env: Env): Promise<Response> {
  const rows = await env.DB.prepare('SELECT setting_key, setting_value FROM site_settings').all<{ setting_key: string; setting_value: string }>();
  return json({ settings: Object.fromEntries(rows.results.map((row) => [row.setting_key, row.setting_value])) });
}

function productInput(body: Record<string, unknown>) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const category = body.category;
  const onlineOrderable = body.onlineOrderable === true;
  const active = body.active !== false;
  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : '';
  const previousPriceLabel = typeof body.previousPriceLabel === 'string' ? body.previousPriceLabel.trim() : '';
  const priceLabel = typeof body.priceLabel === 'string' ? body.priceLabel.trim() : '';
  const sortOrder = Number(body.sortOrder);
  const checkoutPrice = Number(body.checkoutPrice);
  if (name.length < 2 || name.length > 100) throw new ApiError(400, 'Enter a menu item name between 2 and 100 characters.');
  if (description.length > 1000) throw new ApiError(400, 'The menu description is too long.');
  if (!['shawarma', 'fries', 'cakes', 'wedding-cakes'].includes(String(category))) throw new ApiError(400, 'Choose a valid menu category.');
  if (onlineOrderable && (!Number.isFinite(checkoutPrice) || checkoutPrice <= 0 || checkoutPrice > 1000000)) {
    throw new ApiError(400, 'Enter a valid online checkout price.');
  }
  if (!onlineOrderable && (!priceLabel || priceLabel.length > 80)) throw new ApiError(400, 'Enter the displayed price or price range.');
  if (previousPriceLabel.length > 80) throw new ApiError(400, 'The previous price is too long.');
  if (imageUrl && !validImageUrl(imageUrl)) throw new ApiError(400, 'Choose an uploaded image.');
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) throw new ApiError(400, 'Enter a display position between 0 and 9999.');
  return {
    name,
    description,
    category: String(category),
    imageUrl,
    priceLabel,
    previousPriceLabel,
    onlineOrderable,
    active,
    pricePesewas: onlineOrderable ? Math.round(checkoutPrice * 100) : 1,
    sortOrder
  };
}

function productIdFromName(name: string): string {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  if (!id) throw new ApiError(400, 'The item name must include letters or numbers.');
  return id;
}

function validImageUrl(value: string): boolean {
  return /^\/images\/[A-Za-z0-9._-]{1,160}$/.test(value) ||
    /^\/media\/[a-f0-9]{32}\.(?:jpg|png|webp)$/.test(value);
}

function newsInput(body: Record<string, unknown>) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : '';
  const showOnHomepage = body.showOnHomepage === true;
  const rawPublishAt = body.publishAt;
  let publishAt: string | null = null;
  if (typeof rawPublishAt === 'string' && rawPublishAt.trim()) {
    const date = new Date(rawPublishAt);
    if (!Number.isFinite(date.getTime())) throw new ApiError(400, 'Choose a valid publish date and time.');
    publishAt = date.toISOString();
  } else if (rawPublishAt !== null && rawPublishAt !== undefined && rawPublishAt !== '') {
    throw new ApiError(400, 'Choose a valid publish date and time.');
  }
  if (title.length < 3 || title.length > 140) throw new ApiError(400, 'Enter a news title between 3 and 140 characters.');
  if (text.length < 2 || text.length > 3000) throw new ApiError(400, 'Enter news text between 2 and 3000 characters.');
  if (imageUrl && !validImageUrl(imageUrl)) throw new ApiError(400, 'Choose an uploaded image.');
  if (showOnHomepage && !imageUrl) throw new ApiError(400, 'Upload a photo before adding this news post to the homepage banner.');
  return { title, body: text, imageUrl, publishAt, showOnHomepage };
}

async function uploadMedia(request: Request, env: Env): Promise<Response> {
  ensureSameOrigin(request);
  await requireAdmin(request, env);
  if (!env.MEDIA) throw new ApiError(503, 'Image uploads are not configured yet. Ask the site administrator to finish the media storage setup.');
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > 5 * 1024 * 1024 + 128 * 1024) throw new ApiError(413, 'Images must be 5 MB or smaller.');
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) throw new ApiError(400, 'Choose an image to upload.');
  if (file.size > 5 * 1024 * 1024) throw new ApiError(413, 'Images must be 5 MB or smaller.');
  const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const extension = extensions[file.type];
  if (!extension) throw new ApiError(415, 'Upload a JPEG, PNG, or WebP image.');
  const key = `media/${randomHex(16)}.${extension}`;
  await env.MEDIA.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' }
  });
  return json({ imageUrl: `/${key}` }, 201);
}

async function serveMedia(request: Request, env: Env): Promise<Response> {
  const match = new URL(request.url).pathname.match(/^\/media\/([a-f0-9]{32}\.(?:jpg|png|webp))$/);
  if (!match || !env.MEDIA) return new Response('Not found.', { status: 404 });
  const object = await env.MEDIA.get(`media/${match[1]}`);
  if (!object) return new Response('Not found.', { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(object.body, { headers });
}

async function adminApi(request: Request, env: Env, path: string): Promise<Response> {
  if (path === '/api/admin/auth/login' && request.method === 'POST') return adminLogin(request, env);
  if (path === '/api/admin/auth/session' && request.method === 'GET') {
    const token = cookie(request);
    if (!token) return json({ authenticated: false });
    const session = await env.DB.prepare('SELECT phone FROM admin_sessions WHERE token_hash = ? AND expires_at > ?')
      .bind(await sha256(token), Math.floor(Date.now() / 1000)).first<Session>();
    return json({
      authenticated: Boolean(session && session.phone === `admin:${env.ADMIN_USERNAME}`),
      username: session ? env.ADMIN_USERNAME : undefined
    });
  }
  if (path === '/api/admin/auth/logout' && request.method === 'POST') {
    ensureSameOrigin(request);
    const token = cookie(request);
    if (token) await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    const secure = new URL(request.url).protocol === 'https:';
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0, secure) });
  }
  const session = await requireAdmin(request, env);
  if (path === '/api/admin/products' && request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT * FROM products ORDER BY category, sort_order, name').all<ManagedProduct>();
    return json({ products: rows.results.map(productObject) });
  }
  if (path === '/api/admin/products' && request.method === 'POST') {
    ensureSameOrigin(request);
    const input = productInput(await readJson(request));
    const id = productIdFromName(input.name);
    if (await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(id).first()) {
      throw new ApiError(409, 'An item with that name already exists. Edit the existing item instead.');
    }
    await env.DB.prepare(`
      INSERT INTO products
        (id, name, price_pesewas, active, category, description, price_label, previous_price_label, image_url, online_orderable, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, input.name, input.pricePesewas, input.active ? 1 : 0, input.category, input.description,
      input.priceLabel, input.previousPriceLabel, input.imageUrl, input.onlineOrderable ? 1 : 0, input.sortOrder).run();
    return json({ id }, 201);
  }
  const productMatch = path.match(/^\/api\/admin\/products\/([a-z0-9-]{1,60})$/);
  if (productMatch && request.method === 'PUT') {
    ensureSameOrigin(request);
    const input = productInput(await readJson(request));
    const updated = await env.DB.prepare(`
      UPDATE products SET name = ?, price_pesewas = ?, active = ?, category = ?, description = ?,
        price_label = ?, previous_price_label = ?, image_url = ?, online_orderable = ?, sort_order = ?
      WHERE id = ? RETURNING id
    `).bind(input.name, input.pricePesewas, input.active ? 1 : 0, input.category, input.description,
      input.priceLabel, input.previousPriceLabel, input.imageUrl, input.onlineOrderable ? 1 : 0,
      input.sortOrder, productMatch[1]).first<{ id: string }>();
    if (!updated) throw new ApiError(404, 'Menu item not found.');
    return json({ id: updated.id });
  }
  if (productMatch && request.method === 'DELETE') {
    ensureSameOrigin(request);
    const archived = await env.DB.prepare('UPDATE products SET active = 0 WHERE id = ? RETURNING id')
      .bind(productMatch[1]).first<{ id: string }>();
    if (!archived) throw new ApiError(404, 'Menu item not found.');
    return json({ id: archived.id, active: false });
  }
  if (path === '/api/admin/news' && request.method === 'GET') {
    const [rows, orphanedSlides] = await Promise.all([
      env.DB.prepare('SELECT * FROM news_posts ORDER BY COALESCE(publish_at, updated_at) DESC').all<NewsPost>(),
      env.DB.prepare(`
        SELECT slides.news_id, slides.title, slides.image_url
        FROM homepage_news_slides slides
        LEFT JOIN news_posts posts ON posts.id = slides.news_id
        WHERE posts.id IS NULL
        ORDER BY slides.created_at ASC
      `).all<{ news_id: string; title: string; image_url: string }>()
    ]);
    return json({ posts: rows.results.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      imageUrl: row.image_url,
      publishAt: row.publish_at,
      showOnHomepage: row.show_on_homepage === 1
    })), orphanedSlides: orphanedSlides.results.map((row) => ({
      id: row.news_id,
      title: row.title,
      imageUrl: row.image_url
    })) });
  }
  if (path === '/api/admin/news' && request.method === 'POST') {
    ensureSameOrigin(request);
    const input = newsInput(await readJson(request));
    const id = crypto.randomUUID();
    const now = nowIso();
    const insertPost = env.DB.prepare(`
      INSERT INTO news_posts (id, title, body, image_url, publish_at, show_on_homepage, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, input.title, input.body, input.imageUrl, input.publishAt, input.showOnHomepage ? 1 : 0, now, now);
    if (input.showOnHomepage) {
      await env.DB.batch([
        insertPost,
        env.DB.prepare(`
          INSERT INTO homepage_news_slides (news_id, title, image_url, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).bind(id, input.title, input.imageUrl, now, now)
      ]);
    } else {
      await insertPost.run();
    }
    return json({ id }, 201);
  }
  const orphanedNewsSlideMatch = path.match(/^\/api\/admin\/news-slides\/([0-9a-f-]{36})$/);
  if (orphanedNewsSlideMatch && request.method === 'DELETE') {
    ensureSameOrigin(request);
    const deleted = await env.DB.prepare(`
      DELETE FROM homepage_news_slides
      WHERE news_id = ? AND NOT EXISTS (SELECT 1 FROM news_posts WHERE id = ?)
      RETURNING news_id
    `).bind(orphanedNewsSlideMatch[1], orphanedNewsSlideMatch[1]).first<{ news_id: string }>();
    if (!deleted) throw new ApiError(404, 'Retained homepage slide not found.');
    return json({ id: deleted.news_id });
  }
  const newsMatch = path.match(/^\/api\/admin\/news\/([0-9a-f-]{36})$/);
  if (newsMatch && request.method === 'PUT') {
    ensureSameOrigin(request);
    const input = newsInput(await readJson(request));
    const now = nowIso();
    const existing = await env.DB.prepare('SELECT id FROM news_posts WHERE id = ?')
      .bind(newsMatch[1]).first<{ id: string }>();
    if (!existing) throw new ApiError(404, 'News post not found.');
    const statements = [
      env.DB.prepare(`
        UPDATE news_posts SET title = ?, body = ?, image_url = ?, publish_at = ?, show_on_homepage = ?, updated_at = ?
        WHERE id = ?
      `).bind(input.title, input.body, input.imageUrl, input.publishAt, input.showOnHomepage ? 1 : 0, now, newsMatch[1]),
      input.showOnHomepage
        ? env.DB.prepare(`
            INSERT INTO homepage_news_slides (news_id, title, image_url, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(news_id) DO UPDATE SET title = excluded.title, image_url = excluded.image_url, updated_at = excluded.updated_at
          `).bind(newsMatch[1], input.title, input.imageUrl, now, now)
        : env.DB.prepare('DELETE FROM homepage_news_slides WHERE news_id = ?').bind(newsMatch[1])
    ];
    await env.DB.batch(statements);
    return json({ id: existing.id });
  }
  if (newsMatch && request.method === 'DELETE') {
    ensureSameOrigin(request);
    const deleted = await env.DB.prepare('DELETE FROM news_posts WHERE id = ? RETURNING id')
      .bind(newsMatch[1]).first<{ id: string }>();
    if (!deleted) throw new ApiError(404, 'News post not found.');
    return json({ id: deleted.id });
  }
  if (path === '/api/admin/site-settings' && request.method === 'GET') {
    const result = await publicSiteSettings(env);
    return result;
  }
  if (path === '/api/admin/site-settings' && request.method === 'PUT') {
    ensureSameOrigin(request);
    const body = await readJson(request);
    const keys = ['homepage_headline', 'homepage_tagline', 'business_hours', 'whatsapp_phone', 'contact_phone', 'contact_email', 'business_location'];
    const values: Record<string, string> = {};
    for (const key of keys) {
      const value = body[key];
      if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 240) {
        throw new ApiError(400, 'Complete each site information field using 1 to 240 characters.');
      }
      values[key] = value.trim();
    }
    values.whatsapp_phone = normalizePhone(values.whatsapp_phone);
    values.contact_phone = normalizePhone(values.contact_phone);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.contact_email) || values.contact_email.length > 254) {
      throw new ApiError(400, 'Enter a valid contact email address.');
    }
    await env.DB.batch(keys.map((key) => env.DB.prepare(`
      INSERT INTO site_settings (setting_key, setting_value) VALUES (?, ?)
      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value
    `).bind(key, values[key])));
    return json({ settings: values });
  }
  if (path === '/api/admin/media' && request.method === 'POST') return uploadMedia(request, env);
  if (path === '/api/admin/orders' && request.method === 'GET') {
    const rows = await env.DB.prepare(`
      SELECT * FROM orders WHERE payment_status = 'paid'
      ORDER BY CASE WHEN status = 'completed' THEN 1 ELSE 0 END, created_at DESC LIMIT 100
    `).all<OrderRow>();
    return json({ orders: await Promise.all(rows.results.map((row) => adminOrderObject(env, row))) });
  }
  const retry = path.match(/^\/api\/admin\/orders\/(D5B-[A-Fa-f0-9]{12})\/retry-notifications$/);
  if (retry && request.method === 'POST') {
    ensureSameOrigin(request);
    const row = await findPaidOrder(env, retry[1].toUpperCase());
    const success = await deliverOutbox(env, row.id, true);
    return json({ order: await adminOrderObject(env, row), failed: !success });
  }
  const statusMatch = path.match(/^\/api\/admin\/orders\/(D5B-[A-Fa-f0-9]{12})\/status$/);
  if (statusMatch && request.method === 'POST') {
    ensureSameOrigin(request);
    const next = (await readJson(request)).status;
    const row = await findPaidOrder(env, statusMatch[1].toUpperCase());
    const valid: Record<string, string> = { awaiting_restaurant: 'received', received: 'preparing', preparing: 'ready', ready: 'completed' };
    if (typeof next !== 'string' || valid[row.status] !== next) throw new ApiError(409, 'That status change is not allowed.');
    const reviewUrl = next === 'completed'
      ? siteUrl(env, `/orders.html?order=${encodeURIComponent(row.order_number)}`)
      : undefined;
    const now = nowIso();
    const changed = await env.DB.prepare(`
      UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = ? AND payment_status = 'paid' RETURNING id
    `).bind(next, now, row.id, row.status).first<{ id: string }>();
    if (!changed) throw new ApiError(409, 'The order changed. Refresh and try again.');
    await env.DB.prepare('INSERT INTO order_events (order_id, status, actor_phone, created_at) VALUES (?, ?, ?, ?)')
      .bind(row.id, next, session.phone, now).run();
    const pickupSettings = await env.DB.prepare(`
      SELECT setting_key, setting_value FROM site_settings
      WHERE setting_key IN ('whatsapp_phone', 'contact_phone', 'business_location')
    `).all<{ setting_key: string; setting_value: string }>();
    const settings = new Map(pickupSettings.results.map(({ setting_key, setting_value }) => [setting_key, setting_value]));
    const message = customerStatusSms(next, row.order_number, {
      reviewUrl,
      pickupLocation: settings.get('business_location') || 'XZ Residence, Accra',
      contactPhones: [
        settings.get('whatsapp_phone') || '024 845 1683',
        settings.get('contact_phone') || '059 527 2224'
      ]
    });
    let notificationSent = true;
    if (message) {
      await queueSms(env, row.id, row.customer_phone, `customer_${next}`, message);
      notificationSent = await deliverOutbox(env, row.id);
    }
    return json({ order: await adminOrderObject(env, await findPaidOrder(env, row.order_number)), notificationSent });
  }
  const detail = path.match(/^\/api\/admin\/orders\/(D5B-[A-Fa-f0-9]{12})$/);
  if (detail && request.method === 'GET') return json({ order: await adminOrderObject(env, await findPaidOrder(env, detail[1].toUpperCase())) });
  throw new ApiError(404, 'Admin API endpoint not found.');
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (request.method === 'GET' && path === '/api/reviews/featured') return featuredReviews(env);
  if (request.method === 'GET' && path === '/api/menu') return publicMenu(env);
  if (request.method === 'GET' && path === '/api/news') return publicNews(env);
  if (request.method === 'GET' && path === '/api/news/featured') return publicHomepageNews(env);
  if (request.method === 'GET' && path === '/api/site-settings') return publicSiteSettings(env);
  if (request.method === 'POST' && path === '/api/checkout') return createCheckout(request, env);
  if (request.method === 'POST' && path === '/api/payment/confirm') return confirmRoute(request, env);
  if (request.method === 'POST' && path === '/api/paystack/webhook') return webhook(request, env);
  if (request.method === 'POST' && path === '/api/orders/lookup') return lookupOrder(request, env);
  if (request.method === 'POST' && path === '/api/orders/review') return submitOrderReview(request, env);
  if (path.startsWith('/api/admin/')) return adminApi(request, env, path);
  throw new ApiError(404, 'API endpoint not found.');
}

async function retryDueSms(env: Env): Promise<void> {
  const now = Date.now();
  const retryBefore = new Date(now - SMS_RETRY_INTERVAL_MS).toISOString();
  const staleSendingBefore = new Date(now - 10 * 60 * 1000).toISOString();
  const dueOrders = await env.DB.prepare(`
    SELECT DISTINCT order_id FROM sms_outbox
    WHERE attempts < ? AND (
      (delivery_status IN ('pending', 'failed')
        AND (last_attempt_at IS NULL OR last_attempt_at <= ?))
      OR (delivery_status = 'sending' AND sending_at < ?)
    )
    ORDER BY order_id LIMIT 100
  `).bind(MAX_AUTOMATIC_SMS_ATTEMPTS, retryBefore, staleSendingBefore).all<{ order_id: string }>();

  for (const { order_id } of dueOrders.results) {
    const delivered = await deliverOutbox(
      env,
      order_id,
      true,
      MAX_AUTOMATIC_SMS_ATTEMPTS,
      retryBefore
    );
    if (!delivered) console.warn(`Automatic SMS retry still has failures for order ${order_id}.`);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/media/')) {
      if (request.method !== 'GET') return new Response('Method not allowed.', { status: 405 });
      return serveMedia(request, env);
    }
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env);
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.message }, error.status);
      console.error('API request failed', error);
      return json({ error: 'The request could not be completed. Please try again.' }, 500);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await retryDueSms(env);
  }
};
