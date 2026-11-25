// server/src/modules/inventory/pcr.routes.js  (admin side of depo/franchise stock requests)
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../core/prisma.js';
import { badRequest, notFound } from '../../core/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { wrap } from './helpers.js';
import { createTransfer } from './transfer.service.js';

const router = Router();
router.use(requireAuth, requireRole('SUPER_ADMIN', 'ADMIN'));

router.get('/', wrap(async (req, res) => {
  const st = String(req.query.status || '');
  const where = ['PENDING', 'APPROVED', 'REJECTED'].includes(st) ? `WHERE r.status = '${st}'` : '';
  const rows = await prisma.$queryRawUnsafe(
    `SELECT r.id::int AS id, r.status, r.created_at, r.items, l.name AS location_name, l.type AS location_type
       FROM pcr r JOIN locations l ON l.id = r.location_id ${where} ORDER BY r.id DESC LIMIT 200`);
  const names = await prisma.$queryRawUnsafe(`SELECT id::int AS id, name FROM products`);
  const map = new Map(names.map((n) => [n.id, n.name]));
  rows.forEach((r) => {
    r.items = r.items.map((i) => ({ ...i, name: map.get(i.product_id) || `#${i.product_id}` }));
    r.total_qty = r.items.reduce((s, i) => s + i.qty, 0);
  });
  res.json({ rows, total: rows.length });
}));

// Approve = send stock from a chosen location (usually the warehouse) to the requester.
router.put('/:id/approve', wrap(async (req, res) => {
  const { from_location } = z.object({ from_location: z.coerce.number().int().positive() }).parse(req.body);
  const pid = Number(req.params.id);
  const [r] = await prisma.$queryRawUnsafe(
    `UPDATE pcr SET status = 'APPROVED' WHERE id = $1::bigint AND status = 'PENDING' RETURNING location_id::int AS location_id, items`, pid);
  if (!r) throw badRequest('This request is not pending');
  try {
    const transfer = await createTransfer({ from_location, to_location: r.location_id, items: r.items });
    res.json({ id: pid, status: 'APPROVED', transfer_no: transfer.transfer_no });
  } catch (e) {
    await prisma.$executeRawUnsafe(`UPDATE pcr SET status = 'PENDING' WHERE id = $1::bigint`, pid); // not enough stock etc.: stay pending
    throw e;
  }
}));

router.put('/:id/reject', wrap(async (req, res) => {
  const n = await prisma.$executeRawUnsafe(`UPDATE pcr SET status = 'REJECTED' WHERE id = $1::bigint AND status = 'PENDING'`, Number(req.params.id));
  if (!n) throw notFound('Pending request not found');
  res.json({ id: Number(req.params.id), status: 'REJECTED' });
}));

export default router;
