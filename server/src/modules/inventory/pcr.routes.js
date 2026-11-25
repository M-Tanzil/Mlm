// server/src/modules/inventory/pcr.routes.js  (admin side of depo/franchise stock requests)
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../core/prisma.js';
import { badRequest, notFound } from '../../core/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { TX, wrap } from './helpers.js';
import { createTransfer } from './transfer.service.js';

const router = Router();
router.use(requireAuth, requireRole('SUPER_ADMIN', 'ADMIN'));

const parseId = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n < 1) throw badRequest('Invalid id');
  return n;
};

router.get('/', wrap(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const conds = [];
  const params = [];
  const st = String(req.query.status || '');
  if (['PENDING', 'APPROVED', 'REJECTED'].includes(st)) { params.push(st); conds.push(`r.status = $${params.length}`); }
  const loc = parseInt(req.query.location_id);
  if (loc) { params.push(loc); conds.push(`r.location_id = $${params.length}::bigint`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = await prisma.$queryRawUnsafe(
    `SELECT r.id::int AS id, r.status, r.created_at, r.items, r.location_id::int AS location_id, l.name AS location_name, l.type AS location_type
       FROM pcr r JOIN locations l ON l.id = r.location_id ${where} ORDER BY r.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, ...params);
  const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM pcr r ${where}`, ...params);
  // product names for this page only
  const ids = [...new Set(rows.flatMap((r) => r.items.map((i) => i.product_id)))];
  const names = ids.length ? await prisma.$queryRawUnsafe(`SELECT id::int AS id, name, sku FROM products WHERE id = ANY($1::bigint[])`, ids) : [];
  const map = new Map(names.map((p) => [p.id, p]));
  rows.forEach((r) => {
    r.items = r.items.map((i) => ({ ...i, name: map.get(i.product_id)?.name || `#${i.product_id}`, sku: map.get(i.product_id)?.sku }));
    r.total_qty = r.items.reduce((s, i) => s + i.qty, 0);
  });
  res.json({ rows, total: n, page, limit });
}));

// Approve = send stock from a chosen location (usually the warehouse) to the requester.
// One transaction: the request is locked, the transfer is created and the status changes together, or nothing happens.
router.put('/:id/approve', wrap(async (req, res) => {
  const { from_location } = z.object({ from_location: z.coerce.number().int().positive() }).parse(req.body);
  const pid = parseId(req);
  const out = await prisma.$transaction(async (tx) => {
    const [r] = await tx.$queryRawUnsafe(
      `SELECT location_id::int AS location_id, items, status FROM pcr WHERE id = $1::bigint FOR UPDATE`, pid);
    if (!r) throw notFound('Request not found');
    if (r.status !== 'PENDING') throw badRequest(`This request is already ${r.status}`);
    const transfer = await createTransfer({ from_location, to_location: r.location_id, items: r.items }, tx); // short stock etc. rolls everything back
    await tx.$executeRawUnsafe(`UPDATE pcr SET status = 'APPROVED' WHERE id = $1::bigint`, pid);
    return { id: pid, status: 'APPROVED', transfer_id: transfer.id, transfer_no: transfer.transfer_no };
  }, TX);
  res.json(out);
}));

router.put('/:id/reject', wrap(async (req, res) => {
  const pid = parseId(req);
  const n = await prisma.$executeRawUnsafe(`UPDATE pcr SET status = 'REJECTED' WHERE id = $1::bigint AND status = 'PENDING'`, pid);
  if (!n) throw notFound('Pending request not found');
  res.json({ id: pid, status: 'REJECTED' });
}));

export default router;
