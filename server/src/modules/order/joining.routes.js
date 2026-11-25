// Joining package delivery + package returns (admin side). Mounted inside order.routes (already admin-guarded).
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../core/prisma.js';
import { badRequest, notFound } from '../../core/errors.js';
import { events } from '../../core/events.js';
import { TX, wrap } from '../inventory/helpers.js';
import { deductStock, addStock } from '../inventory/stock.service.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();
const id = z.coerce.number().int().positive();
const parseId = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n < 1) throw badRequest('Invalid id');
  return n;
};
const paging = (req) => ({
  page: Math.max(1, parseInt(req.query.page) || 1),
  limit: Math.min(100, Math.max(1, parseInt(req.query.limit) || 20)),
  q: String(req.query.q || '').trim(),
  status: String(req.query.status || ''),
});

/**
 * INTEGRATION BOUNDARY with the member module (Tanzil): when a member joins, call createJoiningDelivery({ member_id, package_id })
 * or emit MEMBER_JOINED { memberId, packageId }. Nothing else here depends on the joining flow.
 * Idempotent: a member/package pair is queued once, however many times it is called.
 */
export async function createJoiningDelivery({ member_id, package_id, location_id = null }) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('joining_delivery:' || $1))`, String(member_id));
    const [dup] = await tx.$queryRawUnsafe(
      `SELECT id::int AS id FROM joining_package_deliveries WHERE member_id = $1::bigint AND package_id = $2::bigint LIMIT 1`, member_id, package_id);
    if (dup) return { ...dup, existing: true };
    const [r] = await tx.$queryRawUnsafe(
      `INSERT INTO joining_package_deliveries (member_id, package_id, location_id) VALUES ($1::bigint, $2::bigint, $3::bigint) RETURNING id::int AS id`,
      member_id, package_id, location_id);
    return r;
  }, TX);
}
events.on('MEMBER_JOINED', async (e) => {
  try { if (e?.memberId && e?.packageId) await createJoiningDelivery({ member_id: e.memberId, package_id: e.packageId }); }
  catch (err) { console.error('[joining] could not queue delivery', err.message); }
});

const DELIVERY_SQL = `
  SELECT d.id::int AS id, d.status, d.tracking_no, d.delivered_at, d.location_id::int AS location_id, d.package_id::int AS package_id,
         m.member_code, m.full_name AS member_name, p.name AS package_name, l.name AS location_name, c.name AS courier_name,
         (SELECT r.status FROM package_returns r WHERE r.delivery_id = d.id ORDER BY (r.status = 'CONFIRMED') DESC, (r.status = 'REQUESTED') DESC, r.id DESC LIMIT 1) AS return_status
    FROM joining_package_deliveries d
    JOIN members m ON m.id = d.member_id JOIN packages p ON p.id = d.package_id
    LEFT JOIN locations l ON l.id = d.location_id LEFT JOIN couriers c ON c.id = d.courier_id`;

router.get('/joining-deliveries', requireAuth, wrap(async (req, res) => {
  const { page, limit, q, status } = paging(req);
  const conds = []; const args = [];
  if (['PENDING', 'DISPATCHED', 'DELIVERED'].includes(status)) { args.push(status); conds.push(`d.status = $${args.length}`); }
  if (q) { args.push(`%${q}%`); conds.push(`(m.member_code ILIKE $${args.length} OR m.full_name ILIKE $${args.length} OR p.name ILIKE $${args.length} OR d.tracking_no ILIKE $${args.length})`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const [{ n }] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM joining_package_deliveries d JOIN members m ON m.id = d.member_id JOIN packages p ON p.id = d.package_id ${where}`, ...args);
  const rows = await prisma.$queryRawUnsafe(`${DELIVERY_SQL} ${where} ORDER BY d.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, ...args);
  res.json({ rows, total: n, page, limit });
}));

router.get('/joining-deliveries/:id', requireAuth, wrap(async (req, res) => {
  const [row] = await prisma.$queryRawUnsafe(`${DELIVERY_SQL} WHERE d.id = $1::bigint`, parseId(req));
  if (!row) throw notFound('Delivery not found');
  row.items = await prisma.$queryRawUnsafe(
    `SELECT pi.product_id::int AS product_id, pr.name AS product_name, pr.sku, pi.qty FROM package_items pi JOIN products pr ON pr.id = pi.product_id WHERE pi.package_id = $1::bigint ORDER BY pr.name`, row.package_id);
  res.json(row);
}));

router.post('/joining-deliveries', requireAuth, wrap(async (req, res) => {
  const d = z.object({ member_code: z.string().trim().min(1), package_id: id, location_id: id.optional() }).parse(req.body);
  const [m] = await prisma.$queryRawUnsafe(`SELECT id::int AS id FROM members WHERE member_code = $1`, d.member_code);
  if (!m) throw badRequest('Member ID not found');
  const [p] = await prisma.$queryRawUnsafe(`SELECT id FROM packages WHERE id = $1::bigint`, d.package_id);
  if (!p) throw badRequest('Package not found');
  const r = await createJoiningDelivery({ member_id: m.id, package_id: d.package_id, location_id: d.location_id ?? null });
  if (r.existing) throw badRequest('A delivery for this member and package already exists');
  res.status(201).json(r);
}));

// Dispatch: the package contents leave the chosen location's stock.
router.put('/joining-deliveries/:id/dispatch', requireAuth, wrap(async (req, res) => {
  const d = z.object({ location_id: id, courier_id: id.optional(), tracking_no: z.string().trim().max(100).transform((v) => v || null).nullish() }).parse(req.body);
  const did = parseId(req);
  await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRawUnsafe(
      `SELECT id::int AS id, status, package_id::int AS package_id FROM joining_package_deliveries WHERE id = $1::bigint FOR UPDATE`, did);
    if (!row) throw notFound('Delivery not found');
    if (row.status !== 'PENDING') throw badRequest(`This delivery is already ${row.status}`);
    const [loc] = await tx.$queryRawUnsafe(`SELECT active FROM locations WHERE id = $1::bigint`, d.location_id);
    if (!loc) throw badRequest('Location not found');
    if (loc.active !== true) throw badRequest('That location is inactive');
    if (d.courier_id) {
      const [c] = await tx.$queryRawUnsafe(`SELECT active FROM couriers WHERE id = $1::bigint`, d.courier_id);
      if (!c) throw badRequest('Courier not found');
      if (c.active !== true) throw badRequest('That courier is inactive');
    }
    const items = await tx.$queryRawUnsafe(`SELECT product_id::int AS product_id, qty FROM package_items WHERE package_id = $1::bigint`, row.package_id);
    if (!items.length) throw badRequest('This package has no products set up');
    await deductStock(d.location_id, items, { txnType: 'JOINING_DISPATCH', refType: 'joining_package_deliveries', refId: did, tx });
    await tx.$executeRawUnsafe(
      `UPDATE joining_package_deliveries SET status = 'DISPATCHED', location_id = $1::bigint, courier_id = $2::bigint, tracking_no = $3 WHERE id = $4::bigint`,
      d.location_id, d.courier_id ?? null, d.tracking_no ?? null, did);
  }, TX);
  res.json({ id: did, status: 'DISPATCHED' });
}));

router.put('/joining-deliveries/:id/deliver', requireAuth, wrap(async (req, res) => {
  const did = parseId(req);
  await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRawUnsafe(`SELECT status FROM joining_package_deliveries WHERE id = $1::bigint FOR UPDATE`, did);
    if (!row) throw notFound('Delivery not found');
    if (row.status !== 'DISPATCHED') throw badRequest('Only a dispatched package can be marked delivered');
    const [open] = await tx.$queryRawUnsafe(`SELECT 1 AS x FROM package_returns WHERE delivery_id = $1::bigint AND status IN ('REQUESTED','CONFIRMED') LIMIT 1`, did);
    if (open) throw badRequest('This package has a return in progress or already returned');
    await tx.$executeRawUnsafe(`UPDATE joining_package_deliveries SET status = 'DELIVERED', delivered_at = now() WHERE id = $1::bigint`, did);
  }, TX);
  res.json({ id: did, status: 'DELIVERED' });
}));

// ---- package returns ----
const RETURN_SQL = `
  SELECT r.id::int AS id, r.status, r.reason, r.delivery_id::int AS delivery_id, r.confirmed_at, m.member_code, m.full_name AS member_name,
         p.name AS package_name, l.name AS location_name
    FROM package_returns r JOIN members m ON m.id = r.member_id
    LEFT JOIN joining_package_deliveries d ON d.id = r.delivery_id LEFT JOIN packages p ON p.id = d.package_id
    LEFT JOIN locations l ON l.id = d.location_id`;

router.get('/package-returns', requireAuth, wrap(async (req, res) => {
  const { page, limit, q, status } = paging(req);
  const conds = []; const args = [];
  if (['REQUESTED', 'CONFIRMED', 'REJECTED'].includes(status)) { args.push(status); conds.push(`r.status = $${args.length}`); }
  if (q) { args.push(`%${q}%`); conds.push(`(m.member_code ILIKE $${args.length} OR m.full_name ILIKE $${args.length} OR p.name ILIKE $${args.length})`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const [{ n }] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM package_returns r JOIN members m ON m.id = r.member_id LEFT JOIN joining_package_deliveries d ON d.id = r.delivery_id LEFT JOIN packages p ON p.id = d.package_id ${where}`, ...args);
  const rows = await prisma.$queryRawUnsafe(`${RETURN_SQL} ${where} ORDER BY r.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, ...args);
  res.json({ rows, total: n, page, limit });
}));

router.post('/package-returns', requireAuth, wrap(async (req, res) => {
  const d = z.object({ delivery_id: id, reason: z.string().trim().max(500).transform((v) => v || null).nullish() }).parse(req.body);
  const r = await prisma.$transaction(async (tx) => {
    const [del] = await tx.$queryRawUnsafe(`SELECT member_id::int AS member_id, status FROM joining_package_deliveries WHERE id = $1::bigint FOR UPDATE`, d.delivery_id);
    if (!del) throw notFound('Delivery not found');
    if (del.status === 'PENDING') throw badRequest('This package has not been dispatched yet');
    // One live return per delivery: a second confirmed return would put the same stock back twice.
    const [open] = await tx.$queryRawUnsafe(`SELECT status FROM package_returns WHERE delivery_id = $1::bigint AND status IN ('REQUESTED','CONFIRMED') LIMIT 1`, d.delivery_id);
    if (open) throw badRequest(`This delivery already has a ${open.status.toLowerCase()} return`);
    const [row] = await tx.$queryRawUnsafe(
      `INSERT INTO package_returns (member_id, delivery_id, reason) VALUES ($1::bigint, $2::bigint, $3) RETURNING id::int AS id`,
      del.member_id, d.delivery_id, d.reason ?? null);
    return row;
  }, TX);
  res.status(201).json(r);
}));

// Confirm: the package contents go back into stock at the location it was sent from.
router.put('/package-returns/:id/confirm', requireAuth, wrap(async (req, res) => {
  const rid = parseId(req);
  await prisma.$transaction(async (tx) => {
    const [r] = await tx.$queryRawUnsafe(
      `SELECT r.id::int AS id, r.status, d.location_id::int AS location_id, d.package_id::int AS package_id
         FROM package_returns r JOIN joining_package_deliveries d ON d.id = r.delivery_id WHERE r.id = $1::bigint FOR UPDATE OF r`, rid);
    if (!r) throw notFound('Return not found');
    if (r.status !== 'REQUESTED') throw badRequest(`This return is already ${r.status}`);
    if (!r.location_id) throw badRequest('The delivery has no location to return stock to');
    const items = await tx.$queryRawUnsafe(`SELECT product_id::int AS product_id, qty FROM package_items WHERE package_id = $1::bigint`, r.package_id);
    await addStock(tx, r.location_id, items, 'PKG_RETURN', 'package_returns', rid);
    await tx.$executeRawUnsafe(
      `UPDATE package_returns SET status = 'CONFIRMED', confirmed_by = $1::bigint, confirmed_at = now() WHERE id = $2::bigint`, Number(req.user.sub), rid);
  }, TX);
  res.json({ id: rid, status: 'CONFIRMED' });
}));

router.put('/package-returns/:id/reject', requireAuth, wrap(async (req, res) => {
  const rid = parseId(req);
  const n = await prisma.$executeRawUnsafe(
    `UPDATE package_returns SET status = 'REJECTED', confirmed_by = $1::bigint, confirmed_at = now() WHERE id = $2::bigint AND status = 'REQUESTED'`,
    Number(req.user.sub), rid);
  if (!n) throw badRequest('Only a requested return can be rejected');
  res.json({ id: rid, status: 'REJECTED' });
}));

export default router;
