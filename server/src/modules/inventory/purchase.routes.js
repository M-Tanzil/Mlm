// server/src/modules/inventory/purchase.routes.js
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../core/prisma.js';
import { badRequest, notFound } from '../../core/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { TX, wrap, nextNo } from './helpers.js';

const router = Router();
router.use(requireAuth, requireRole('SUPER_ADMIN', 'ADMIN'));

const STATUSES = ['OPEN', 'PARTIAL', 'CLOSED', 'CANCELLED'];
const id = z.coerce.number().int().positive();
const poSchema = z.object({
  supplier_id: id,
  items: z.array(z.object({
    product_id: id,
    qty: z.coerce.number().int().positive().max(10_000_000),
    // rejected rather than silently rounded: the column holds 2 decimals, and the total must match the stored rates
    rate: z.coerce.number().min(0).max(99_999_999).refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Rate can have at most 2 decimals'),
  })).min(1, 'Add at least one product').max(200, 'At most 200 product lines')
    .refine((a) => new Set(a.map((i) => i.product_id)).size === a.length, 'Each product can appear only once'),
});

const parseId = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n < 1) throw badRequest('Invalid id');
  return n;
};

async function getPo(poId) {
  const [po] = await prisma.$queryRawUnsafe(
    `SELECT po.id::int AS id, po.po_no, po.supplier_id::int AS supplier_id, s.name AS supplier_name,
            po.status, po.total::float8 AS total, po.created_at
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = $1::bigint`, poId);
  if (!po) return null;
  po.items = await prisma.$queryRawUnsafe(
    `SELECT i.id::int AS id, i.product_id::int AS product_id, p.name AS product_name, p.sku,
            i.qty, i.rate::float8 AS rate, i.received_qty
       FROM purchase_order_items i JOIN products p ON p.id = i.product_id
      WHERE i.po_id = $1::bigint ORDER BY i.id`, poId);
  return po;
}

router.get('/', wrap(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const q = String(req.query.q || '').trim();
  const conds = [];
  const params = [];
  if (q) { params.push(`%${q}%`); conds.push('(po.po_no ILIKE $1 OR s.name ILIKE $1)'); }
  const statuses = String(req.query.status || '').split(',').filter((s) => STATUSES.includes(s));
  if (statuses.length) conds.push(`po.status IN (${statuses.map((s) => `'${s}'`).join(',')})`);
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = await prisma.$queryRawUnsafe(
    `SELECT po.id::int AS id, po.po_no, s.name AS supplier_name, po.status, po.total::float8 AS total, po.created_at,
            COALESCE(SUM(i.qty), 0)::int AS ordered_qty, COALESCE(SUM(i.received_qty), 0)::int AS received_qty
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN purchase_order_items i ON i.po_id = po.id
       ${where} GROUP BY po.id, s.name
      ORDER BY po.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, ...params);
  const [{ n }] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id ${where}`, ...params);
  res.json({ rows, total: n, page, limit });
}));

router.get('/:id', wrap(async (req, res) => {
  const po = await getPo(parseId(req));
  if (!po) throw notFound('Purchase order not found');
  res.json(po);
}));

router.post('/', wrap(async (req, res) => {
  const d = poSchema.parse(req.body);
  const poId = await prisma.$transaction(async (tx) => {
    const [sup] = await tx.$queryRawUnsafe(`SELECT active FROM suppliers WHERE id = $1::bigint`, d.supplier_id);
    if (!sup) throw notFound('Supplier not found');
    if (sup.active !== true) throw badRequest('That supplier is inactive');
    const prods = await tx.$queryRawUnsafe(
      `SELECT id::int AS id, sku, active FROM products WHERE id = ANY($1::bigint[])`, d.items.map((i) => i.product_id));
    if (prods.length !== d.items.length) throw badRequest('One of the products no longer exists');
    const inactive = prods.find((p) => p.active !== true);
    if (inactive) throw badRequest(`Product ${inactive.sku} is inactive`);

    const poNo = await nextNo(tx, 'po', 'PO');
    const [{ id: newId }] = await tx.$queryRawUnsafe(
      `INSERT INTO purchase_orders (po_no, supplier_id, created_by) VALUES ($1, $2, $3) RETURNING id::int AS id`,
      poNo, d.supplier_id, Number(req.user.sub));
    for (const it of d.items) {
      await tx.$executeRawUnsafe(
        `INSERT INTO purchase_order_items (po_id, product_id, qty, rate) VALUES ($1, $2, $3, $4)`,
        newId, it.product_id, it.qty, it.rate);
    }
    // total comes from the stored (rounded) rates, never from the client
    await tx.$executeRawUnsafe(
      `UPDATE purchase_orders SET total = (SELECT SUM(qty * rate) FROM purchase_order_items WHERE po_id = $1::bigint) WHERE id = $1::bigint`, newId);
    return newId;
  }, TX);
  res.status(201).json(await getPo(poId));
}));

router.put('/:id/cancel', wrap(async (req, res) => {
  const poId = parseId(req);
  const n = await prisma.$executeRawUnsafe(
    `UPDATE purchase_orders SET status = 'CANCELLED' WHERE id = $1::bigint AND status = 'OPEN'`, poId);
  if (!n) {
    if (!(await getPo(poId))) throw notFound('Purchase order not found');
    throw badRequest('Only an OPEN purchase order (nothing received yet) can be cancelled');
  }
  res.json(await getPo(poId));
}));

export default router;
