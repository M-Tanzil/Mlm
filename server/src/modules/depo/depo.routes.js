// Depo / Franchise panel API. Every route works on the logged-in user's own location.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../core/prisma.js';
import { badRequest, notFound, forbidden } from '../../core/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { wrap } from '../inventory/helpers.js';
import { getOrder, listOrders, markPaid, dispatchOrder, deliverOrder } from '../order/order.service.js';
import { getTransfer, acceptTransfer, rejectTransfer } from '../inventory/transfer.service.js';

const router = Router();
router.use(requireAuth, requireRole('DEPO', 'FRANCHISE'));

// find the location owned by this login
router.use((req, _res, next) => {
  prisma.$queryRawUnsafe(
    `SELECT id::int AS id, type, name, city, state FROM locations WHERE owner_user_id = $1::bigint AND active = true ORDER BY id LIMIT 1`, Number(req.user.sub))
    .then(([loc]) => {
      if (!loc) return next(forbidden('No active location is linked to this login. Ask the admin.'));
      req.loc = loc;
      next();
    }).catch(next);
});

const id = z.coerce.number().int().positive();
const parseId = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n < 1) throw badRequest('Invalid id');
  return n;
};
const paging = (req) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  return { page, limit, offset: (page - 1) * limit };
};

router.get('/me', (req, res) => res.json(req.loc));

router.get('/products', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id::int AS id, sku, name FROM products WHERE active = true ${q ? 'AND (name ILIKE $1 OR sku ILIKE $1)' : ''} ORDER BY name LIMIT 2000`,
    ...(q ? [`%${q}%`] : []));
  res.json({ rows, total: rows.length });
}));

router.get('/stock', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const params = [req.loc.id];
  let extra = '';
  if (q) { params.push(`%${q}%`); extra = 'AND (p.name ILIKE $2 OR p.sku ILIKE $2)'; }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT p.id::int AS id, p.sku, p.name, c.name AS category_name, SUM(sl.qty_change)::int AS qty
       FROM stock_ledger sl JOIN products p ON p.id = sl.product_id JOIN product_categories c ON c.id = p.category_id
      WHERE sl.location_id = $1::bigint ${extra}
      GROUP BY p.id, p.sku, p.name, c.name ORDER BY p.name LIMIT 1000`, ...params);
  res.json({ rows, total: rows.length });
}));

// ---- incoming stock transfers (stock inward for depo) ----
router.get('/transfers', wrap(async (req, res) => {
  const { page, limit, offset } = paging(req);
  const params = [req.loc.id];
  let extra = '';
  const st = String(req.query.status || '');
  if (['SENT', 'ACCEPTED', 'REJECTED'].includes(st)) { params.push(st); extra = `AND t.status = $${params.length}`; }
  const q = String(req.query.q || '').trim();
  if (q) { params.push(`%${q}%`); extra += ` AND (t.transfer_no ILIKE $${params.length} OR f.name ILIKE $${params.length})`; }
  const from = `stock_transfers t JOIN locations f ON f.id = t.from_location JOIN locations d ON d.id = t.to_location WHERE t.to_location = $1::bigint ${extra}`;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT t.id::int AS id, t.transfer_no, t.status, t.sent_at, f.name AS from_name, d.name AS to_name,
            (SELECT COALESCE(SUM(qty_sent),0)::int FROM stock_transfer_items x WHERE x.transfer_id = t.id) AS total_qty
       FROM ${from} ORDER BY t.id DESC LIMIT ${limit} OFFSET ${offset}`, ...params);
  const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM ${from}`, ...params);
  res.json({ rows, total: n, page, limit });
}));
router.get('/transfers/:id', wrap(async (req, res) => {
  const t = await getTransfer(prisma, parseId(req));
  if (!t || t.to_id !== req.loc.id) throw notFound('Transfer not found');
  res.json(t);
}));
router.put('/transfers/:id/accept', wrap(async (req, res) => {
  const d = z.object({ items: z.array(z.object({ id, qty_accepted: z.coerce.number().int().min(0).max(10_000_000) })).min(1) }).parse(req.body);
  res.json(await acceptTransfer(parseId(req), d.items, Number(req.user.sub), req.loc.id));
}));
router.put('/transfers/:id/reject', wrap(async (req, res) => {
  res.json(await rejectTransfer(parseId(req), Number(req.user.sub), req.loc.id));
}));

// ---- PCR: stock request to head office ----
router.get('/pcr', wrap(async (req, res) => {
  const { page, limit, offset } = paging(req);
  const rows = await prisma.$queryRawUnsafe(
    `SELECT r.id::int AS id, r.status, r.created_at, r.items,
            (SELECT COALESCE(SUM((i->>'qty')::int),0)::int FROM jsonb_array_elements(r.items) i) AS total_qty
       FROM pcr r WHERE r.location_id = $1::bigint ORDER BY r.id DESC LIMIT ${limit} OFFSET ${offset}`, req.loc.id);
  const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM pcr WHERE location_id = $1::bigint`, req.loc.id);
  const ids = [...new Set(rows.flatMap((r) => r.items.map((i) => i.product_id)))];
  const names = ids.length ? await prisma.$queryRawUnsafe(`SELECT id::int AS id, name FROM products WHERE id = ANY($1::bigint[])`, ids) : [];
  const map = new Map(names.map((p) => [p.id, p.name]));
  rows.forEach((r) => { r.items = r.items.map((i) => ({ ...i, name: map.get(i.product_id) || `#${i.product_id}` })); });
  res.json({ rows, total: n, page, limit });
}));
router.post('/pcr', wrap(async (req, res) => {
  const d = z.object({ items: z.array(z.object({ product_id: id, qty: z.coerce.number().int().positive().max(10_000_000) })).min(1, 'Add at least one product').max(200) }).parse(req.body);
  const wanted = [...new Set(d.items.map((i) => i.product_id))];
  const known = await prisma.$queryRawUnsafe(`SELECT id::int AS id FROM products WHERE active = true AND id = ANY($1::bigint[])`, wanted);
  if (known.length !== wanted.length) throw badRequest('One of the products is not available');
  const merged = new Map();
  d.items.forEach((i) => merged.set(i.product_id, (merged.get(i.product_id) || 0) + i.qty));
  const items = [...merged].map(([product_id, qty]) => ({ product_id, qty }));
  const [r] = await prisma.$queryRawUnsafe(
    `INSERT INTO pcr (location_id, items) VALUES ($1::bigint, $2::jsonb) RETURNING id::int AS id`, req.loc.id, JSON.stringify(items));
  res.status(201).json(r);
}));

// ---- orders fulfilled by this depo/franchise ----
router.get('/couriers', wrap(async (_req, res) => {
  const rows = await prisma.$queryRawUnsafe(`SELECT id::int AS id, name FROM couriers WHERE active = true ORDER BY name`);
  res.json({ rows, total: rows.length });
}));
router.get('/orders', wrap(async (req, res) => res.json(await listOrders({
  page: Math.max(1, parseInt(req.query.page) || 1), limit: Math.min(100, parseInt(req.query.limit) || 20),
  q: String(req.query.q || '').trim(), status: String(req.query.status || ''), onlyLocation: req.loc.id,
}))));
router.get('/orders/:id', wrap(async (req, res) => {
  const o = await getOrder(parseId(req), req.loc.id);
  if (!o) throw notFound('Order not found');
  res.json(o);
}));
router.put('/orders/:id/pay', wrap(async (req, res) => res.json(await markPaid(parseId(req), req.loc.id))));
router.put('/orders/:id/dispatch', wrap(async (req, res) => {
  const d = z.object({ courier_id: id.optional(), tracking_no: z.string().trim().transform((v) => v || null).nullish() }).parse(req.body);
  res.json(await dispatchOrder(parseId(req), d, req.loc.id));
}));
router.put('/orders/:id/deliver', wrap(async (req, res) => res.json(await deliverOrder(parseId(req), req.loc.id))));

export default router;
