// server/src/modules/inventory/stock.routes.js
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../core/prisma.js';
import { AppError, badRequest, notFound } from '../../core/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { TX, wrap, nextNo } from './helpers.js';

const router = Router();
const guard = [requireAuth, requireRole('SUPER_ADMIN', 'ADMIN')];
const id = z.coerce.number().int().positive();
const qty = z.coerce.number().int().positive().max(10_000_000); // also keeps the INT ledger column from overflowing
const text = z.string().trim().transform((v) => v || null).nullish();
// real calendar date in YYYY-MM-DD (Date.parse alone accepts 2026-02-30 and toISOString throws on 2026-13-45)
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
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
    product_id: id,
    // qty = ACCEPTED quantity (the only part that enters stock); rejected_qty = refused at the gate (damaged, wrong item...)
    qty: z.coerce.number().int().min(0).max(10_000_000),
    rejected_qty: z.coerce.number().int().min(0).max(10_000_000).default(0),
    batch_no: text,
    expiry_date: z.string().trim()
      .refine((v) => v === '' || isDate(v), 'Use a valid date (YYYY-MM-DD)')
      .transform((v) => v || null).nullish(),
  }).refine((i) => i.qty + i.rejected_qty > 0, 'Enter an accepted or a rejected quantity for every product'))
    .min(1, 'Add at least one product'),
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
            (SELECT COALESCE(SUM(x.qty), 0)::int FROM stock_inward_items x WHERE x.inward_id = si.id) AS total_qty,
            (SELECT COALESCE(SUM(x.rejected_qty), 0)::int FROM stock_inward_items x WHERE x.inward_id = si.id) AS total_rejected
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

    const prods = new Map((await tx.$queryRawUnsafe(
      `SELECT id::int AS id, sku, active FROM products WHERE id = ANY($1::bigint[])`, d.items.map((i) => i.product_id))).map((p) => [p.id, p]));
    if (d.items.some((i) => !prods.has(i.product_id))) throw badRequest('One of the products no longer exists');

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
        const lines = poItems.filter((l) => l.product_id === productId);
        if (!lines.length) throw badRequest(`Product ${prods.get(productId).sku} is not on this purchase order`);
        for (const line of lines) {
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
      // only accepted goods count as received, so an all-rejected delivery leaves the PO status (and its cancel option) as it was
      if (d.items.some((i) => i.qty > 0)) {
        await tx.$executeRawUnsafe(`UPDATE purchase_orders SET status = $1 WHERE id = $2::bigint`, done ? 'CLOSED' : 'PARTIAL', po.id);
      }
    } else {
      const [s] = await tx.$queryRawUnsafe(`SELECT active FROM suppliers WHERE id = $1::bigint`, supplierId);
      if (!s) throw notFound('Supplier not found');
      if (s.active !== true) throw badRequest('That supplier is inactive');
      const off = d.items.find((i) => prods.get(i.product_id).active !== true);
      if (off) throw badRequest(`Product ${prods.get(off.product_id).sku} is inactive`);
      if (d.invoice_no) {
        // same supplier invoice at the same location is a double entry (double click, retry). Serialised so two requests can't both pass.
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `inward:${supplierId}:${d.invoice_no.toLowerCase()}`);
        const [dup] = await tx.$queryRawUnsafe(
          `SELECT inward_no FROM stock_inward WHERE mode = 'SUPPLIER_WISE' AND supplier_id = $1::bigint AND location_id = $2::bigint
              AND lower(invoice_no) = lower($3) LIMIT 1`, supplierId, d.location_id, d.invoice_no);
        if (dup) throw new AppError(409, `Invoice ${d.invoice_no} from this supplier was already received at this location as ${dup.inward_no}`);
      }
    }

    const inwardNo = await nextNo(tx, 'inward', 'GRN');
    const [{ id: inwardId }] = await tx.$queryRawUnsafe(
      `INSERT INTO stock_inward (inward_no, mode, po_id, supplier_id, location_id, invoice_no, received_by)
       VALUES ($1, $2, $3::bigint, $4::bigint, $5::bigint, $6, $7::bigint) RETURNING id::int AS id`,
      inwardNo, d.mode, poId, supplierId, d.location_id, d.invoice_no ?? null, Number(req.user.sub));
    for (const it of d.items) {
      await tx.$executeRawUnsafe(
        `INSERT INTO stock_inward_items (inward_id, product_id, qty, rejected_qty, batch_no, expiry_date) VALUES ($1::bigint, $2::bigint, $3, $4, $5, $6::date)`,
        inwardId, it.product_id, it.qty, it.rejected_qty, it.batch_no ?? null, it.expiry_date ?? null);
      if (it.qty === 0) continue; // fully rejected line: recorded on the GRN, nothing enters stock
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
    const [[sup], [loc], [prod]] = await Promise.all([
      tx.$queryRawUnsafe(`SELECT 1 FROM suppliers WHERE id = $1::bigint`, d.supplier_id),
      tx.$queryRawUnsafe(`SELECT 1 FROM locations WHERE id = $1::bigint`, d.location_id),
      tx.$queryRawUnsafe(`SELECT 1 FROM products WHERE id = $1::bigint`, d.product_id),
    ]);
    if (!sup) throw notFound('Supplier not found');
    if (!loc) throw notFound('Location not found');
    if (!prod) throw notFound('Product not found');
    // same lock key as deductStock and transfers: without it two returns could both pass the check and push stock below zero
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock($1::bigint)`, d.location_id);
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
// There is no per-product reorder level in the schema, so "low" means qty <= one threshold chosen by the caller (default 10).
router.get('/stock-report', ...guard, wrap(async (req, res) => {
  const { page, limit, offset } = paging(req);
  const threshold = Math.min(1_000_000, Math.max(0, parseInt(req.query.threshold) || 10));
  const params = [threshold];
  const conds = [];
  const loc = parseInt(req.query.location_id);
  if (loc) { params.push(loc); conds.push(`sl.location_id = $${params.length}::bigint`); }
  const q = String(req.query.q || '').trim();
  if (q) { params.push(`%${q}%`); conds.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const having = req.query.low === 'true' ? 'HAVING SUM(sl.qty_change) <= $1' : '';
  const grouped = `FROM stock_ledger sl
       JOIN locations l ON l.id = sl.location_id
       JOIN products p ON p.id = sl.product_id
       JOIN product_categories c ON c.id = p.category_id
       ${where}
      GROUP BY l.id, l.name, l.type, p.id, p.sku, p.name, c.name ${having}`;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT (l.id::text || '-' || p.id::text) AS id, l.id::int AS location_id, l.name AS location_name, l.type AS location_type,
            p.id::int AS product_id, p.sku, p.name, c.name AS category_name,
            SUM(sl.qty_change)::int AS qty, (SUM(sl.qty_change) <= $1) AS low
       ${grouped} ORDER BY l.name, p.name LIMIT ${limit} OFFSET ${offset}`, ...params);
  const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM (SELECT 1 ${grouped}) x`, ...params);
  res.json({ rows, total: n, page, limit, threshold });
}));

// ---- stock movements (history): every ledger row, newest first ----
const day = z.string().refine(isDate, 'Use a valid date (YYYY-MM-DD)');
const movementQuery = z.object({
  location_id: id.optional(), product_id: id.optional(),
  txn_type: z.string().regex(/^[A-Z_]{1,30}$/).optional(),
  from: day.optional(), to: day.optional(),
});
router.get('/stock-movements', ...guard, wrap(async (req, res) => {
  const { page, limit, offset } = paging(req);
  const f = movementQuery.parse(Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '')));
  const params = [];
  const conds = [];
  const add = (sql, v) => { params.push(v); conds.push(sql.replaceAll('?', `$${params.length}`)); };
  if (f.location_id) add('sl.location_id = ?::bigint', f.location_id);
  if (f.product_id) add('sl.product_id = ?::bigint', f.product_id);
  if (f.txn_type) add('sl.txn_type = ?', f.txn_type);
  if (f.from) add('sl.created_at >= ?::date', f.from);
  if (f.to) add(`sl.created_at < (?::date + 1)`, f.to);
  const q = String(req.query.q || '').trim();
  if (q) add('(p.name ILIKE ? OR p.sku ILIKE ?)', `%${q}%`) ;
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const from = `stock_ledger sl
       JOIN locations l ON l.id = sl.location_id
       JOIN products p ON p.id = sl.product_id
       LEFT JOIN stock_inward si ON sl.ref_type = 'stock_inward' AND si.id = sl.ref_id
       LEFT JOIN stock_returns sr ON sl.ref_type = 'stock_returns' AND sr.id = sl.ref_id
       LEFT JOIN stock_transfers st ON sl.ref_type = 'stock_transfers' AND st.id = sl.ref_id
       LEFT JOIN orders o ON sl.ref_type IN ('orders', 'order_cancel') AND o.id = sl.ref_id`;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT sl.id::int AS id, sl.created_at, l.name AS location_name, p.sku, p.name AS product_name,
            sl.qty_change, sl.txn_type, sl.ref_type, sl.ref_id::int AS ref_id,
            COALESCE(si.inward_no, sr.return_no, st.transfer_no, o.order_no) AS ref_no
       FROM ${from} ${where} ORDER BY sl.id DESC LIMIT ${limit} OFFSET ${offset}`, ...params);
  const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM ${from} ${where}`, ...params);
  res.json({ rows, total: n, page, limit });
}));

export default router;
