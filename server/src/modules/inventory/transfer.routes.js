// server/src/modules/inventory/transfer.routes.js
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../core/prisma.js';
import { badRequest, notFound } from '../../core/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { wrap } from './helpers.js';
import { getTransfer, createTransfer, acceptTransfer, rejectTransfer } from './transfer.service.js';

const router = Router();
router.use(requireAuth, requireRole('SUPER_ADMIN', 'ADMIN'));

const parseId = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n < 1) throw badRequest('Invalid id');
  return n;
};
const STATUSES = ['SENT', 'ACCEPTED', 'REJECTED'];
const id = z.coerce.number().int().positive();
const createSchema = z.object({
  from_location: id,
  to_location: id,
  items: z.array(z.object({ product_id: id, qty: z.coerce.number().int().positive().max(10_000_000) })).min(1, 'Add at least one product').max(200),
});
const acceptSchema = z.object({
  items: z.array(z.object({ id, qty_accepted: z.coerce.number().int().min(0).max(10_000_000) })).min(1),
});

router.get('/', wrap(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const conds = [];
  const params = [];
  const q = String(req.query.q || '').trim();
  if (q) { params.push(`%${q}%`); conds.push('(t.transfer_no ILIKE $1 OR f.name ILIKE $1 OR d.name ILIKE $1)'); }
  const st = String(req.query.status || '');
  if (STATUSES.includes(st)) conds.push(`t.status = '${st}'`);
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const from = `stock_transfers t JOIN locations f ON f.id = t.from_location JOIN locations d ON d.id = t.to_location`;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT t.id::int AS id, t.transfer_no, t.status, t.sent_at, f.name AS from_name, d.name AS to_name,
            (SELECT COALESCE(SUM(qty_sent),0)::int FROM stock_transfer_items x WHERE x.transfer_id = t.id) AS total_qty
       FROM ${from} ${where} ORDER BY t.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, ...params);
  const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM ${from} ${where}`, ...params);
  res.json({ rows, total: n, page, limit });
}));

router.get('/:id', wrap(async (req, res) => {
  const t = await getTransfer(prisma, parseId(req));
  if (!t) throw notFound('Transfer not found');
  res.json(t);
}));

router.post('/', wrap(async (req, res) => {
  res.status(201).json(await createTransfer(createSchema.parse(req.body)));
}));

router.put('/:id/accept', wrap(async (req, res) => {
  const d = acceptSchema.parse(req.body);
  res.json(await acceptTransfer(parseId(req), d.items, Number(req.user.sub)));
}));

router.put('/:id/reject', wrap(async (req, res) => {
  res.json(await rejectTransfer(parseId(req), Number(req.user.sub)));
}));

export default router;
