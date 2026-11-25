// server/src/modules/order/order.service.js
import { prisma } from '../../core/prisma.js';
import { badRequest, notFound } from '../../core/errors.js';
import { events } from '../../core/events.js';
import { TX, nextNo } from '../inventory/helpers.js';
import { deductStock, addStock, assertStock } from '../inventory/stock.service.js';

const scoped = (onlyLocation) => (onlyLocation ? `AND o.location_id = ${Number(onlyLocation)}` : '');

export async function getOrder(orderId, onlyLocation = null) {
  const [o] = await prisma.$queryRawUnsafe(
    `SELECT o.id::int AS id, o.order_no, o.type, o.status, o.payment_mode, o.payment_status,
            o.subtotal::float8 AS subtotal, o.gst_amount::float8 AS gst_amount, o.total::float8 AS total, o.total_bv::float8 AS total_bv,
            o.created_at, o.location_id::int AS location_id, l.name AS location_name,
            m.member_code, m.full_name AS member_name,
            d.status AS dispatch_status, d.tracking_no, d.dispatched_at, d.delivered_at, c.name AS courier_name,
            c.tracking_url_template
       FROM orders o JOIN members m ON m.id = o.member_id JOIN locations l ON l.id = o.location_id
       LEFT JOIN dispatches d ON d.order_id = o.id LEFT JOIN couriers c ON c.id = d.courier_id
      WHERE o.id = $1::bigint ${scoped(onlyLocation)}`, orderId);
  if (!o) return null;
  // http(s) only (the template is admin-entered): never hand the browser a javascript: link
  o.tracking_url = o.tracking_no && /^https?:\/\//i.test(o.tracking_url_template || '')
    ? o.tracking_url_template.replaceAll('{tracking_no}', encodeURIComponent(o.tracking_no)) : null;
  delete o.tracking_url_template;
  o.items = await prisma.$queryRawUnsafe(
    `SELECT i.id::int AS id, i.product_id::int AS product_id, p.name AS product_name, p.sku, i.qty,
            i.price::float8 AS price, i.bv::float8 AS bv, i.gst_percent::float8 AS gst_percent
       FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = $1::bigint ORDER BY i.id`, orderId);
  return o;
}

export async function listOrders({ page, limit, q, status, paymentStatus, locationId, onlyLocation, memberCode }) {
  const conds = [];
  const params = [];
  if (q) { params.push(`%${q}%`); conds.push(`(o.order_no ILIKE $${params.length} OR m.member_code ILIKE $${params.length} OR m.full_name ILIKE $${params.length})`); }
  if (memberCode) { params.push(memberCode); conds.push(`m.member_code = $${params.length}`); }
  if (['PLACED', 'CONFIRMED', 'DISPATCHED', 'DELIVERED', 'CANCELLED'].includes(status)) conds.push(`o.status = '${status}'`);
  if (['PENDING', 'PAID', 'REFUND_DUE'].includes(paymentStatus)) conds.push(`o.payment_status = '${paymentStatus}'`);
  const loc = onlyLocation || locationId;
  if (loc) conds.push(`o.location_id = ${Number(loc)}`);
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const from = `orders o JOIN members m ON m.id = o.member_id JOIN locations l ON l.id = o.location_id
                LEFT JOIN dispatches d ON d.order_id = o.id LEFT JOIN couriers c ON c.id = d.courier_id`;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT o.id::int AS id, o.order_no, o.type, o.status, o.payment_status, o.total::float8 AS total, o.created_at,
            m.member_code, m.full_name AS member_name, l.name AS location_name,
            c.name AS courier_name, d.tracking_no, d.dispatched_at, d.delivered_at
       FROM ${from} ${where} ORDER BY o.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, ...params);
  const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM ${from} ${where}`, ...params);
  return { rows, total: n, page, limit };
}

/** Price comes from the product master at order time: dp_price, bv, gst_percent (GST added on top). */
export async function placeOrder({ member_code, location_id, type, payment_mode, items }) {
  const merged = new Map();
  items.forEach((i) => merged.set(i.product_id, (merged.get(i.product_id) || 0) + i.qty));
  const id = await prisma.$transaction(async (tx) => {
    const [m] = await tx.$queryRawUnsafe(`SELECT id::int AS id FROM members WHERE member_code = $1`, member_code);
    if (!m) throw badRequest('Member ID not found');
    const [loc] = await tx.$queryRawUnsafe(`SELECT id FROM locations WHERE id = $1::bigint AND active = true`, location_id);
    if (!loc) throw badRequest('Location not found');
    const lines = [];
    for (const [productId, qty] of merged) {
      const [p] = await tx.$queryRawUnsafe(
        `SELECT id::int AS id, dp_price::float8 AS price, bv::float8 AS bv, gst_percent::float8 AS gst FROM products WHERE id = $1::bigint AND active = true`, productId);
      if (!p) throw badRequest('A product in this order is not available');
      lines.push({ product_id: p.id, qty, price: p.price, bv: p.bv, gst: p.gst });
    }
    await assertStock(tx, location_id, lines);
    const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
    const gst = lines.reduce((s, l) => s + (l.price * l.qty * l.gst) / 100, 0);
    const bv = lines.reduce((s, l) => s + l.bv * l.qty, 0);
    const orderNo = await nextNo(tx, 'order', 'ORD');
    const [{ id: oid }] = await tx.$queryRawUnsafe(
      `INSERT INTO orders (order_no, member_id, location_id, type, subtotal, gst_amount, total, total_bv, payment_mode)
       VALUES ($1, $2::bigint, $3::bigint, $4, $5::numeric, $6::numeric, $7::numeric, $8::numeric, $9) RETURNING id::int AS id`,
      orderNo, m.id, location_id, type, subtotal.toFixed(2), gst.toFixed(2), (subtotal + gst).toFixed(2), bv.toFixed(2), payment_mode ?? null);
    for (const l of lines) {
      await tx.$executeRawUnsafe(
        `INSERT INTO order_items (order_id, product_id, qty, price, bv, gst_percent) VALUES ($1::bigint, $2::bigint, $3, $4, $5, $6)`,
        oid, l.product_id, l.qty, l.price, l.bv, l.gst);
    }
    return oid;
  }, TX);
  return getOrder(id);
}

async function lockOrder(tx, orderId, onlyLocation) {
  const [o] = await tx.$queryRawUnsafe(
    `SELECT id::int AS id, status, payment_status, location_id::int AS location_id FROM orders WHERE id = $1::bigint FOR UPDATE`, orderId);
  if (!o || (onlyLocation && o.location_id !== onlyLocation)) throw notFound('Order not found');
  return o;
}
const itemsOf = (tx, orderId) => tx.$queryRawUnsafe(`SELECT product_id::int AS product_id, qty FROM order_items WHERE order_id = $1::bigint`, orderId);

/** Payment received: stock is deducted from the location and ORDER_PAID is emitted. */
export async function markPaid(orderId, onlyLocation = null) {
  await prisma.$transaction(async (tx) => {
    const o = await lockOrder(tx, orderId, onlyLocation);
    if (o.status !== 'PLACED' || o.payment_status !== 'PENDING') throw badRequest('This order is not waiting for payment');
    await deductStock(o.location_id, await itemsOf(tx, orderId), { txnType: 'SALE', refType: 'orders', refId: orderId, tx });
    await tx.$executeRawUnsafe(`UPDATE orders SET payment_status = 'PAID', status = 'CONFIRMED' WHERE id = $1::bigint`, orderId);
  }, TX);
  events.emit('ORDER_PAID', { orderId });
  return getOrder(orderId, onlyLocation);
}

export async function dispatchOrder(orderId, { courier_id, tracking_no }, onlyLocation = null) {
  await prisma.$transaction(async (tx) => {
    const o = await lockOrder(tx, orderId, onlyLocation);
    if (o.status !== 'CONFIRMED') throw badRequest('Only a paid (confirmed) order can be dispatched');
    if (courier_id) {
      const [c] = await tx.$queryRawUnsafe(`SELECT active FROM couriers WHERE id = $1::bigint`, courier_id);
      if (!c) throw badRequest('Courier not found');
      if (c.active !== true) throw badRequest('That courier is inactive');
    }
    await tx.$executeRawUnsafe(
      `INSERT INTO dispatches (order_id, courier_id, tracking_no, dispatched_at, status)
       VALUES ($1::bigint, $2::bigint, $3, now(), 'DISPATCHED')
       ON CONFLICT (order_id) DO UPDATE SET courier_id = EXCLUDED.courier_id, tracking_no = EXCLUDED.tracking_no,
                                            dispatched_at = now(), status = 'DISPATCHED'`, orderId, courier_id ?? null, tracking_no ?? null);
    await tx.$executeRawUnsafe(`UPDATE orders SET status = 'DISPATCHED' WHERE id = $1::bigint`, orderId);
  }, TX);
  events.emit('ORDER_DISPATCHED', { orderId });
  return getOrder(orderId, onlyLocation);
}

export async function deliverOrder(orderId, onlyLocation = null) {
  await prisma.$transaction(async (tx) => {
    const o = await lockOrder(tx, orderId, onlyLocation);
    if (o.status !== 'DISPATCHED') throw badRequest('Only a dispatched order can be marked delivered');
    await tx.$executeRawUnsafe(`UPDATE dispatches SET status = 'DELIVERED', delivered_at = now() WHERE order_id = $1::bigint`, orderId);
    await tx.$executeRawUnsafe(`UPDATE orders SET status = 'DELIVERED' WHERE id = $1::bigint`, orderId);
  }, TX);
  events.emit('ORDER_DELIVERED', { orderId });
  return getOrder(orderId, onlyLocation);
}

/** Cancel before dispatch. A paid order gets its stock back and is flagged REFUND_DUE. */
export async function cancelOrder(orderId) {
  await prisma.$transaction(async (tx) => {
    const o = await lockOrder(tx, orderId, null);
    if (!['PLACED', 'CONFIRMED'].includes(o.status)) throw badRequest('This order can no longer be cancelled');
    if (o.payment_status === 'PAID') {
      await addStock(tx, o.location_id, await itemsOf(tx, orderId), 'SALE', 'order_cancel', orderId);
    }
    await tx.$executeRawUnsafe(
      `UPDATE orders SET status = 'CANCELLED', payment_status = CASE WHEN payment_status = 'PAID' THEN 'REFUND_DUE' ELSE payment_status END
        WHERE id = $1::bigint`, orderId);
  }, TX);
  events.emit('ORDER_CANCELLED', { orderId });
  return getOrder(orderId);
}
