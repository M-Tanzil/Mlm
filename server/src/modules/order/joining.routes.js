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

/** Used by the member module when someone joins: queue the package for delivery. */
export async function createJoiningDelivery({ member_id, package_id, location_id = null }) {
  const [r] = await prisma.$queryRawUnsafe(
    `INSERT INTO joining_package_deliveries (member_id, package_id, location_id) VALUES ($1::bigint, $2::bigint, $3::bigint) RETURNING id::int AS id`,
    member_id, package_id, location_id);
  return r;
}
events.on('MEMBER_JOINED', async (e) => {
  // Tanzil emits { memberId, packageId } when a member joins; a delivery row is queued automatically.
  try { if (e?.memberId && e?.packageId) await createJoiningDelivery({ member_id: e.memberId, package_id: e.packageId }); }
  catch (err) { console.error('[joining] could not queue delivery', err.message); }
});

const DELIVERY_SQL = `
  SELECT d.id::int AS id, d.status, d.tracking_no, d.delivered_at, d.location_id::int AS location_id,
         m.member_code, m.full_name AS member_name, p.name AS package_name, l.name AS location_name, c.name AS courier_name
    FROM joining_package_deliveries d
    JOIN members m ON m.id = d.member_id JOIN packages p ON p.id = d.package_id
    LEFT JOIN locations l ON l.id = d.location_id LEFT JOIN couriers c ON c.id = d.courier_id`;

router.get('/joining-deliveries', requireAuth, wrap(async (req, res) => {
  const st = String(req.query.status || '');
  const where = ['PENDING', 'DISPATCHED', 'DELIVERED'].includes(st) ? `WHERE d.status = '${st}'` : '';
  const rows = await prisma.$queryRawUnsafe(`${DELIVERY_SQL} ${where} ORDER BY d.id DESC LIMIT 200`);
  res.json({ rows, total: rows.length });
}));

router.post('/joining-deliveries', requireAuth, wrap(async (req, res) => {
  const d = z.object({ member_code: z.string().trim().min(1), package_id: id, location_id: id }).parse(req.body);
  const [m] = await prisma.$queryRawUnsafe(`SELECT id::int AS id FROM members WHERE member_code = $1`, d.member_code);
  if (!m) throw badRequest('Member ID not found');
  res.status(201).json(await createJoiningDelivery({ member_id: m.id, package_id: d.package_id, location_id: d.location_id }));
}));

// Dispatch: the package contents leave the chosen location's stock.
router.put('/joining-deliveries/:id/dispatch', requireAuth, wrap(async (req, res) => {
  const d = z.object({ location_id: id, courier_id: id.optional(), tracking_no: z.string().trim().transform((v) => v || null).nullish() }).parse(req.body);
  const did = Number(req.params.id);
  await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRawUnsafe(
      `SELECT id::int AS id, status, package_id::int AS package_id FROM joining_package_deliveries WHERE id = $1::bigint FOR UPDATE`, did);
    if (!row) throw notFound('Delivery not found');
    if (row.status !== 'PENDING') throw badRequest(`This delivery is already ${row.status}`);
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
  const n = await prisma.$executeRawUnsafe(
    `UPDATE joining_package_deliveries SET status = 'DELIVERED', delivered_at = now() WHERE id = $1::bigint AND status = 'DISPATCHED'`, Number(req.params.id));
  if (!n) throw badRequest('Only a dispatched package can be marked delivered');
  res.json({ id: Number(req.params.id), status: 'DELIVERED' });
}));

// ---- package returns ----
const RETURN_SQL = `
  SELECT r.id::int AS id, r.status, r.reason, r.delivery_id::int AS delivery_id, m.member_code, m.full_name AS member_name, p.name AS package_name
    FROM package_returns r JOIN members m ON m.id = r.member_id
    LEFT JOIN joining_package_deliveries d ON d.id = r.delivery_id LEFT JOIN packages p ON p.id = d.package_id`;

router.get('/package-returns', requireAuth, wrap(async (_req, res) => {
  const rows = await prisma.$queryRawUnsafe(`${RETURN_SQL} ORDER BY r.id DESC LIMIT 200`);
  res.json({ rows, total: rows.length });
}));

router.post('/package-returns', requireAuth, wrap(async (req, res) => {
  const d = z.object({ delivery_id: id, reason: z.string().trim().transform((v) => v || null).nullish() }).parse(req.body);
  const [del] = await prisma.$queryRawUnsafe(`SELECT member_id::int AS member_id, status FROM joining_package_deliveries WHERE id = $1::bigint`, d.delivery_id);
  if (!del) throw notFound('Delivery not found');
  if (del.status === 'PENDING') throw badRequest('This package has not been dispatched yet');
  const [r] = await prisma.$queryRawUnsafe(
    `INSERT INTO package_returns (member_id, delivery_id, reason) VALUES ($1::bigint, $2::bigint, $3) RETURNING id::int AS id`,
    del.member_id, d.delivery_id, d.reason ?? null);
  res.status(201).json(r);
}));

// Confirm: the package contents go back into stock at the location it was sent from.
router.put('/package-returns/:id/confirm', requireAuth, wrap(async (req, res) => {
  const rid = Number(req.params.id);
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
  const n = await prisma.$executeRawUnsafe(
    `UPDATE package_returns SET status = 'REJECTED', confirmed_by = $1::bigint, confirmed_at = now() WHERE id = $2::bigint AND status = 'REQUESTED'`,
    Number(req.user.sub), Number(req.params.id));
  if (!n) throw badRequest('Only a requested return can be rejected');
  res.json({ id: Number(req.params.id), status: 'REJECTED' });
}));

export default router;
