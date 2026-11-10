import { Env, nowIso, randomHex } from './shared';

interface OutboxRow {
  id: number;
  recipient: string;
  message: string;
}

export async function sendSms(env: Env, recipient: string, message: string): Promise<void> {
  if (!env.ARKESEL_API_KEY || !env.ARKESEL_SENDER_ID) throw new Error('Arkesel SMS is not configured.');
  const response = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
    method: 'POST',
    headers: { 'api-key': env.ARKESEL_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: env.ARKESEL_SENDER_ID, message, recipients: [recipient] })
  });
  if (!response.ok) throw new Error(`Arkesel returned HTTP ${response.status}.`);
  const result: unknown = await response.json();
  if (result && typeof result === 'object' && 'status' in result) {
    const status = String(result.status).toLowerCase();
    if (status && status !== 'success' && status !== 'ok') throw new Error('Arkesel rejected the SMS request.');
  }
}

export async function queueSms(env: Env, orderId: string, recipient: string, type: string, message: string): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO sms_outbox (order_id, recipient, message_type, message, created_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(order_id, recipient, message_type) DO NOTHING
  `).bind(orderId, recipient, type, message, nowIso()).run();
}

export async function deliverOutbox(env: Env, orderId: string, retry = false): Promise<boolean> {
  const staleSendingBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const condition = retry
    ? "(delivery_status IN ('pending', 'failed') OR (delivery_status = 'sending' AND sending_at < ?))"
    : "delivery_status = 'pending'";
  const rows = await env.DB.prepare(`
    SELECT id, recipient, message FROM sms_outbox
    WHERE order_id = ? AND ${condition} ORDER BY id
  `).bind(...(retry ? [orderId, staleSendingBefore] : [orderId])).all<OutboxRow>();
  let success = true;
  for (const row of rows.results) {
    const claimCondition = retry
      ? "(delivery_status IN ('pending', 'failed') OR (delivery_status = 'sending' AND sending_at < ?))"
      : "delivery_status = 'pending'";
    const claimed = await env.DB.prepare(`
      UPDATE sms_outbox SET delivery_status = 'sending', attempts = attempts + 1, sending_at = ?
      WHERE id = ? AND ${claimCondition} RETURNING id
    `).bind(...(retry ? [nowIso(), row.id, staleSendingBefore] : [nowIso(), row.id])).first<{ id: number }>();
    if (!claimed) {
      success = false;
      continue;
    }
    try {
      await sendSms(env, row.recipient, row.message);
      await env.DB.prepare(`
        UPDATE sms_outbox SET delivery_status = 'sent', last_error = NULL, sending_at = NULL, sent_at = ?
        WHERE id = ? AND delivery_status = 'sending'
      `).bind(nowIso(), row.id).run();
    } catch (error) {
      const reference = randomHex(4);
      console.error(`SMS delivery ${reference} failed`, error);
      await env.DB.prepare(`
        UPDATE sms_outbox SET delivery_status = 'failed', last_error = ?, sending_at = NULL
        WHERE id = ? AND delivery_status = 'sending'
      `).bind(`Delivery failed (${reference}).`, row.id).run();
      success = false;
    }
  }
  return success;
}

interface CustomerStatusSmsOptions {
  reviewUrl?: string;
  pickupLocation?: string;
  contactPhones?: string[];
}

function displayPhone(phone: string): string {
  return phone.startsWith('233') ? `0${phone.slice(3)}` : phone;
}

export function customerStatusSms(status: string, orderNumber: string, options: CustomerStatusSmsOptions = {}): string | null {
  if (status === 'received') return `De 5th Bite: Your order ${orderNumber} has been received and is being processed.`;
  if (status === 'ready') {
    const location = options.pickupLocation || 'XZ Residence, Accra';
    const phones = (options.contactPhones || ['024 845 1683', '059 527 2224']).map(displayPhone);
    return `De 5th Bite: Your order ${orderNumber} is ready for pickup. Please arrange a ride to pick it up at ${location}. For more information, contact ${phones.join(' or ')}.`;
  }
  if (status === 'completed' && options.reviewUrl) {
    return `De 5th Bite: Your order ${orderNumber} is complete! Please rate your order and leave a review: ${options.reviewUrl} Enter the phone number used at checkout.`;
  }
  return null;
}
