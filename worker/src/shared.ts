export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  MEDIA?: R2Bucket;
  PAYSTACK_SECRET_KEY: string;
  ARKESEL_API_KEY: string;
  ARKESEL_SENDER_ID: string;
  SITE_URL: string;
  ADMIN_PHONES: string;
  ADMIN_USERNAME: string;
  ADMIN_ACCESS_KEY: string;
  PAYSTACK_CURRENCY: string;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface OrderRow {
  id: string;
  order_number: string;
  paystack_reference: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  items_json: string;
  total_pesewas: number;
  payment_status: string;
  status: string;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
}

export interface ProductRow {
  id: string;
  name: string;
  price_pesewas: number;
}

export interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers
    }
  });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > 16000) throw new ApiError(413, 'Request is too large.');
  const text = await request.text();
  if (text.length > 16000) throw new ApiError(413, 'Request is too large.');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ApiError(400, 'Request body must be valid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'Request body must be a JSON object.');
  return value as Record<string, unknown>;
}

export function normalizePhone(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError(400, 'Enter a valid Ghana phone number.');
  const digits = value.replace(/[\s()+.-]/g, '');
  if (/^0\d{9}$/.test(digits)) return `233${digits.slice(1)}`;
  if (/^233\d{9}$/.test(digits)) return digits;
  throw new ApiError(400, 'Enter a valid Ghana phone number.');
}

export function allowedAdminPhones(env: Env): Set<string> {
  return new Set(env.ADMIN_PHONES.split(',').map((value) => value.trim()).filter(Boolean));
}

export function randomHex(bytes = 16): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hmac(value: string, secret: string, hash = 'SHA-256'): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export function siteUrl(env: Env, path: string): string {
  let url: URL;
  try {
    url = new URL(env.SITE_URL);
  } catch {
    throw new ApiError(503, 'The site address is not configured yet.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname.endsWith('.example')) throw new ApiError(503, 'The site address is not configured yet.');
  return `${env.SITE_URL.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

export function requireConfiguration(env: Env, names: Array<keyof Env>): void {
  for (const name of names) {
    const value = env[name];
    if (typeof value !== 'string' || !value.trim()) {
      throw new ApiError(503, 'Ordering is not configured yet. Please contact the restaurant.');
    }
    if (name === 'ADMIN_ACCESS_KEY' && value.length < 32) {
      throw new ApiError(503, 'Admin sign-in is not configured yet.');
    }
  }
}

export function ensureSameOrigin(request: Request): void {
  const origin = request.headers.get('Origin');
  if (!origin || origin !== new URL(request.url).origin) throw new ApiError(403, 'This request is not allowed.');
}

export async function rateLimit(env: Env, request: Request, purpose: string, limit: number, windowSeconds: number, subject = ''): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const bucket = await sha256(`${purpose}:${request.headers.get('CF-Connecting-IP') || 'unknown'}:${subject}`);
  const row = await env.DB.prepare(`
    INSERT INTO rate_limits (bucket_key, count, window_started_at) VALUES (?, 1, ?)
    ON CONFLICT(bucket_key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_started_at < ? THEN 1 ELSE rate_limits.count + 1 END,
      window_started_at = CASE WHEN rate_limits.window_started_at < ? THEN excluded.window_started_at ELSE rate_limits.window_started_at END
    RETURNING count
  `).bind(bucket, windowStart, windowStart, windowStart).first<{ count: number }>();
  if (!row || row.count > limit) throw new ApiError(429, 'Too many attempts. Please wait and try again.');
}

export function parseItems(row: OrderRow): OrderItem[] {
  const value: unknown = JSON.parse(row.items_json);
  if (!Array.isArray(value)) throw new Error('Stored order items are invalid.');
  return value as OrderItem[];
}
