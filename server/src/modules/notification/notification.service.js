// server/src/modules/notification/notification.service.js
// Hand-off to Tanzil: sendNotification(userId, template, data)
import { prisma } from '../../core/prisma.js';
import { events } from '../../core/events.js';

export const TEMPLATES = {
  WELCOME: { channels: ['INAPP', 'EMAIL'], subject: 'Welcome to the company', body: 'Hello {{name}}, your account is ready. Your ID is {{member_code}}.' },
  ORDER_DISPATCHED: { channels: ['INAPP', 'EMAIL'], subject: 'Your order {{order_no}} has been dispatched', body: 'Hello {{name}}, order {{order_no}} is on its way.' },
  ORDER_DELIVERED: { channels: ['INAPP'], subject: 'Order {{order_no}} delivered', body: 'Hello {{name}}, order {{order_no}} was delivered.' },
  SCHEME_QUALIFIED: { channels: ['INAPP', 'EMAIL'], subject: 'You qualified for {{scheme}}', body: 'Congratulations {{name}}! You qualified for {{scheme}}. Reward: {{reward}}.' },
  TICKET_RESOLVED: { channels: ['INAPP', 'EMAIL'], subject: 'Ticket #{{ticket_id}} resolved', body: 'Your ticket "{{subject}}" was marked resolved. Reply on it in your panel if you still need help.' },
  TICKET_REPLY: { channels: ['INAPP', 'EMAIL'], subject: 'Reply on your ticket #{{ticket_id}}', body: 'Support replied to "{{subject}}". Open Support in your panel to read it.' },
};

const render = (text, data) => String(text).replace(/\{\{(\w+)\}\}/g, (_, k) => data?.[k] ?? '');
const oneLine = (s) => s.replace(/[\r\n]+/g, ' '); // a subject is never allowed to span lines (header injection)

/** Create the notification rows (one per channel) and deliver them in the background. */
export async function sendNotification(userId, template, data = {}) {
  const t = TEMPLATES[template];
  if (!t) throw new Error(`Unknown notification template ${template}`);
  const [u] = await prisma.$queryRawUnsafe(`SELECT email::text AS email, mobile FROM users WHERE id = $1::bigint`, Number(userId));
  if (!u) return [];
  const ids = [];
  for (const channel of t.channels) {
    const recipient = channel === 'EMAIL' ? u.email : channel === 'SMS' ? u.mobile : null;
    if (channel !== 'INAPP' && !recipient) continue; // nothing to send to
    const [r] = await prisma.$queryRawUnsafe(
      `INSERT INTO notifications (user_id, channel, template, subject, body, recipient) VALUES ($1::bigint, $2, $3, $4, $5, $6) RETURNING id::int AS id`,
      Number(userId), channel, template, oneLine(render(t.subject, data)), render(t.body, data), recipient);
    ids.push(r.id);
  }
  ids.forEach(enqueue);
  return ids;
}

function enqueue(id) {
  if (process.env.USE_QUEUE === 'true') {
    import('../../jobs/queues.js')
      .then(({ notificationQueue }) => notificationQueue.add('send', { notificationId: id }))
      .catch((e) => { console.error('[notify] queue failed, sending directly:', e.message); deliver(id); });
  } else {
    deliver(id); // no worker needed in development
  }
}

/** A send that failed. permanent = retrying cannot help (missing configuration), so the queue should not retry it. */
export class DeliveryError extends Error {
  constructor(message, permanent = false) { super(message); this.permanent = permanent; }
}

/**
 * Send one notification row and record the outcome. Throws DeliveryError when the send fails (the row is then FAILED)
 * so a queue worker can retry; returns false when the row was not claimable (already SENT, or being sent by someone else).
 * Only QUEUED/FAILED rows are claimed, so a duplicate job can never send twice. force also claims a row stuck in SENDING.
 */
export async function attempt(id, { force = false } = {}) {
  const [n] = await prisma.$queryRawUnsafe(
    `UPDATE notifications SET status = 'SENDING' WHERE id = $1::bigint AND (status IN ('QUEUED','FAILED') OR ($2::boolean AND status = 'SENDING'))
     RETURNING id::int AS id, channel, recipient, subject, body`, id, force);
  if (!n) return false;
  try {
    if (n.channel === 'EMAIL') await sendEmail(n);
    else if (n.channel === 'SMS') await sendSms(n);
    await prisma.$executeRawUnsafe(`UPDATE notifications SET status = 'SENT', sent_at = now(), error = NULL WHERE id = $1::bigint`, id);
    return true;
  } catch (e) {
    const msg = String(e.message).slice(0, 500);
    console.error(`[notify] #${id} ${n.channel} failed: ${msg}`); // never log the recipient or message body
    await prisma.$executeRawUnsafe(`UPDATE notifications SET status = 'FAILED', error = $2 WHERE id = $1::bigint`, id, msg);
    throw e instanceof DeliveryError ? e : new DeliveryError(msg);
  }
}

/** Fire-and-forget delivery used when no queue is running. A failure stays visible as FAILED in the log and can be resent. */
export async function deliver(id, opts) {
  try { await attempt(id, opts); } catch { /* already recorded on the row */ }
}

let mailer; // one SMTP transport, reused
async function sendEmail(n) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST) throw new DeliveryError('SMTP is not configured (set SMTP_HOST in server/.env)', true);
  if (!mailer) {
    let nodemailer;
    try { nodemailer = (await import('nodemailer')).default; }
    catch { throw new DeliveryError('Package nodemailer is not installed (run npm install nodemailer in server/)', true); }
    mailer = nodemailer.createTransport({
      host: SMTP_HOST, port: Number(SMTP_PORT) || 587, secure: Number(SMTP_PORT) === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    });
  }
  await mailer.sendMail({ from: SMTP_FROM || SMTP_USER, to: n.recipient, subject: n.subject, text: n.body });
}

async function sendSms(n) {
  const { SMS_API_URL, SMS_API_KEY } = process.env;
  if (!SMS_API_URL) throw new DeliveryError('SMS gateway is not configured (set SMS_API_URL and SMS_API_KEY in server/.env)', true);
  let r;
  try {
    r = await fetch(SMS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SMS_API_KEY || ''}` },
      body: JSON.stringify({ to: n.recipient, message: n.body }),
      signal: AbortSignal.timeout(10_000), // a hung gateway must not leave the row stuck in SENDING
    });
  } catch (e) { throw new DeliveryError(`SMS gateway unreachable: ${e.name === 'TimeoutError' ? 'timed out' : e.message}`); }
  // 4xx (other than 429) means the request itself is wrong: retrying the same request will not help
  if (!r.ok) throw new DeliveryError(`SMS gateway answered ${r.status}`, r.status >= 400 && r.status < 500 && r.status !== 429);
}

// ---- automatic notifications from order events ----
async function notifyOrder(orderId, template) {
  const [o] = await prisma.$queryRawUnsafe(
    `SELECT o.order_no, m.user_id::int AS user_id, m.full_name AS name FROM orders o JOIN members m ON m.id = o.member_id WHERE o.id = $1::bigint`, orderId);
  if (o) await sendNotification(o.user_id, template, { name: o.name, order_no: o.order_no });
}
events.on('ORDER_DISPATCHED', ({ orderId }) => notifyOrder(orderId, 'ORDER_DISPATCHED').catch((e) => console.error('[notify]', e.message)));
events.on('ORDER_DELIVERED', ({ orderId }) => notifyOrder(orderId, 'ORDER_DELIVERED').catch((e) => console.error('[notify]', e.message)));
