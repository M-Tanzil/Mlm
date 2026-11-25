// server/src/modules/inventory/stock.routes.js
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../core/prisma.js';
import { badRequest, notFound } from '../../core/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { TX, wrap, nextNo } from './helpers.js';

const router = Router();
const guard = [requireAuth, requireRole('SUPER_ADMIN', 'ADMIN')];
const id = z.coerce.number().int().positive();
const qty = z.coerce.number().int().positive();
const text = z.string().trim().transform((v) => v || null).nullish();
const paging = (req) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  return { page, limit, offset: (page - 1) * limit };
};

// ---- locations (read-only here; the Location master itself belongs to the Masters module) ----
router.get('/locations', ...guard, wrap(async (_req, res) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id::int AS id, name, type FROM locations WHERE active = true ORDER BY type, name`);
  res.json({ rows, total: rows.length });
}));

// ---- stock inward ----
const inwardSchema = z.object({
  mode: z.enum(['PO_WISE', 'SUPPLIER_WISE']),
  po_id: id.optional(),
  supplier_id: id.optional(),
  location_id: id,
  invoice_no: text,
  items: z.array(z.object({
    product_id: id, qty,
    batch_no: text,
    expiry_date: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Use a valid date').transform((v) => v || null).nullish(),
  })).min(1, 'Add at least one product'),
});

router.get('/stock-inward', ...guard, wrap(async (req, res) => {
  const { page, limit, offset } = paging(req);
  const q = String(req.query.q || '').trim();
  const params = [];
  let where = '';
  if (q) { params.push(`%${q}%`); where = 'WHERE (si.inward_no ILIKE $1 OR s.name ILIKE $1 OR si.invoice_no ILIKE $1 OR po.po_no ILIKE $1)'; }
  const from = `stock_inward si JOIN suppliers s ON s.id = si.supplier_id JOIN locations l ON l.id = si.location_id
                LEFT JOIN purchase_orders po ON po.id = si.po_id`;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT si.id::int AS id, si.inward_no, si.mode, po.po_no, s.name AS supplier_name, l.name AS location_name,
            si.invoice_no, si.received_at,
            (SELECT COUNT(*)::int FROM stock_inward_items x WHERE x.inward_id = si.id) AS item_count,
            (SELECT COALESCE(SUM(x.qty), 0)::int FROM stock_inward_items x WHERE x.inward_id = si.id) AS total_qty
       FROM ${from} ${where} ORDER BY si.id DESC LIMIT ${limit} OFFSET ${offset}`, ...params);
  const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM ${from} ${where}`, ...params);
  res.json({ rows, total: n, page, limit });
}));

router.post('/stock-inward', ...guard, wrap(async (req, res) => {
  const d = inwardSchema.parse(req.body);
  if (d.mode === 'PO_WISE' && !d.po_id) throw badRequest('Choose a purchase order');
  if (d.mode === 'SUPPLIER_WISE' && !d.supplier_id) throw badRequest('Choose a supplier');

  const result = await prisma.$transaction(async (tx) => {
    const [loc] = await tx.$queryRawUnsafe(`SELECT id FROM locations WHERE id = $1::bigint AND active = true`, d.location_id);
    if (!loc) throw badRequest('Location not found');

    let supplierId = d.supplier_id;
    let poId = null;

    if (d.mode === 'PO_WISE') {
      const [po] = await tx.$queryRawUnsafe(
        `SELECT id::int AS id, supplier_id::int AS supplier_id, status FROM purchase_orders WHERE id = $1::bigint FOR UPDATE`, d.po_id);
      if (!po) throw notFound('Purchase order not found');
      if (!['OPEN', 'PARTIAL'].includes(po.status)) throw badRequest(`This purchase order is ${po.status}`);
      poId = po.id;
      supplierId = po.supplier_id;

      const poItems = await tx.$queryRawUnsafe(
        `SELECT id::int AS id, product_id::int AS product_id, qty, received_qty FROM purchase_order_items
          WHERE po_id = $1::bigint ORDER BY id`, po.id);
      // total received per product, spread over the PO lines of that product
      const incoming = new Map();
      d.items.forEach((i) => incoming.set(i.product_id, (incoming.get(i.product_id) || 0) + i.qty));
      for (const [productId, total] of incoming) {
        let left = total;
        for (const line of poItems.filter((l) => l.product_id === productId)) {
          const take = Math.min(left, line.qty - line.received_qty);
          if (take > 0) {
            await tx.$executeRawUnsafe(
              `UPDATE purchase_order_items SET received_qty = received_qty + $1 WHERE id = $2::bigint`, take, line.id);
            line.received_qty += take;
            left -= take;
          }
        }
        if (left > 0) throw badRequest('Received quantity is more than what is pending on the purchase order');
      }
      const done = poItems.every((l) => l.received_qty >= l.qty);
      await tx.$executeRawUnsafe(`UPDATE purchase_orders SET status = $1 WHERE id = $2::bigint`, done ? 'CLOSED' : 'PARTIAL', po.id);
    } else {
      const [s] = await tx.$queryRawUnsafe(`SELECT id FROM suppliers WHERE id = $1::bigint`, supplierId);
      if (!s) throw notFound('Supplier not found');
    }

    const inwardNo = await nextNo(tx, 'inward', 'GRN');
    const [{ id: inwardId }] = await tx.$queryRawUnsafe(
      `INSERT INTO stock_inward (inward_no, mode, po_id, supplier_id, location_id, invoice_no, received_by)
       VALUES ($1, $2, $3::bigint, $4::bigint, $5::bigint, $6, $7::bigint) RETURNING id::int AS id`,
      inwardNo, d.mode, poId, supplierId, d.location_id, d.invoice_no ?? null, Number(req.user.sub));
    for (const it of d.items) {
      await tx.$executeRawUnsafe(
        `INSERT INTO stock_inward_items (inward_id, product_id, qty, batch_no, expiry_date) VALUES ($1::bigint, $2::bigint, $3, $4, $5::date)`,
        inwardId, it.product_id, it.qty, it.batch_no ?? null, it.expiry_date ?? null);
      await tx.$executeRawUnsafe(
        `INSERT INTO stock_ledger (location_id, product_id, qty_change, txn_type, ref_type, ref_id)
         VALUES ($1::bigint, $2::bigint, $3, 'INWARD', 'stock_inward', $4::bigint)`,
        d.location_id, it.product_id, it.qty, inwardId);
    }
    return { id: inwardId, inward_no: inwardNo };
  }, TX);
  res.status(201).json(result);
}));

// ---- stock return to supplier ----
const returnSchema = z.object({ supplier_id: id, location_id: id, product_id: id, qty, reason: text });

router.get('/stock-returns', ...guard, wrap(async (req, res) => {
  const { page, limit, offset } = paging(req);
  const from = `stock_returns r JOIN suppliers s ON s.id = r.supplier_id JOIN locations l ON l.id = r.location_id
                JOIN products p ON p.id = r.product_id`;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT r.id::int AS id, r.return_no, s.name AS supplier_name, l.name AS location_name,
            p.name AS product_name, p.sku, r.qty, r.reason, r.created_at
       FROM ${from} ORDER BY r.id DESC LIMIT ${limit} OFFSET ${offset}`);
  const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM ${from}`);
  res.json({ rows, total: n, page, limit });
}));

router.post('/stock-returns', ...guard, wrap(async (req, res) => {
  const d = returnSchema.parse(req.body);
  const result = await prisma.$transaction(async (tx) => {
    const [{ q }] = await tx.$queryRawUnsafe(
      `SELECT COALESCE(SUM(qty_change), 0)::int AS q FROM stock_ledger WHERE location_id = $1::bigint AND product_id = $2::bigint`,
      d.location_id, d.product_id);
    if (q < d.qty) throw badRequest(`Only ${q} in stock at this location`);
    const returnNo = await nextNo(tx, 'return', 'SRT');
    const [{ id: returnId }] = await tx.$queryRawUnsafe(
      `INSERT INTO stock_returns (return_no, supplier_id, location_id, product_id, qty, reason)
       VALUES ($1, $2::bigint, $3::bigint, $4::bigint, $5, $6) RETURNING id::int AS id`,
      returnNo, d.supplier_id, d.location_id, d.product_id, d.qty, d.reason ?? null);
    await tx.$executeRawUnsafe(
      `INSERT INTO stock_ledger (location_id, product_id, qty_change, txn_type, ref_type, ref_id)
       VALUES ($1::bigint, $2::bigint, $3, 'RETURN', 'stock_returns', $4::bigint)`,
      d.location_id, d.product_id, -d.qty, returnId);
    return { id: returnId, return_no: returnNo };
  }, TX);
  res.status(201).json(result);
}));

// ---- stock report: current stock per location and product ----
router.get('/stock-report', ...guard, wrap(async (req, res) => {
  const conds = [];
  const params = [];
  const loc = parseInt(req.query.location_id);
  if (loc) { params.push(loc); conds.push(`sl.location_id = $${params.length}::bigint`); }
  const q = String(req.query.q || '').trim();
  if (q) { params.push(`%${q}%`); conds.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = await prisma.$queryRawUnsafe(
    `SELECT (l.id::text || '-' || p.id::text) AS id, l.name AS location_name, l.type AS location_type,
            p.sku, p.name, c.name AS category_name, SUM(sl.qty_change)::int AS qty
       FROM stock_ledger sl
       JOIN locations l ON l.id = sl.location_id
       JOIN products p ON p.id = sl.product_id
       JOIN product_categories c ON c.id = p.category_id
       ${where}
      GROUP BY l.id, l.name, l.type, p.id, p.sku, p.name, c.name
      ORDER BY l.name, p.name LIMIT 1000`, ...params);
  res.json({ rows, total: rows.length });
}));

export default router;
