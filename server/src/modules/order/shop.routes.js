// Distributor-facing shop API. Mounted at /api/orders/my (see order.routes.js).
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../core/prisma.js';
import { badRequest, notFound, forbidden } from '../../core/errors.js';
import { requireRole } from '../../middleware/auth.js';
import { wrap } from '../inventory/helpers.js';
import { getOrder, listOrders, placeOrder, cancelOrder } from './order.service.js';

const router = Router();
router.use(requireRole('DISTRIBUTOR'));

const id = z.coerce.number().int().positive();

async function member(req) {
  if (req.member) return req.member;
  const [m] = await prisma.$queryRawUnsafe(`SELECT id::int AS id, member_code, full_name FROM members WHERE user_id = $1::bigint`, Number(req.user.sub));
  if (!m) throw forbidden('No member profile for this login');
  req.member = m;
  return m;
}

// where can I collect from
router.get('/locations', wrap(async (_req, res) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id::int AS id, name, type, city, state FROM locations WHERE active = true AND type IN ('DEPO','FRANCHISE') ORDER BY state, city, name`);
  res.json({ rows, total: rows.length });
}));

// catalogue with the stock available at the chosen location
router.get('/products', wrap(async (req, res) => {
  const loc = parseInt(req.query.location_id) || 0;
  const q = String(req.query.q || '').trim();
  const params = [loc];
  let search = '';
  if (q) { params.push(`%${q}%`); search = `AND (p.name ILIKE $2 OR p.sku ILIKE $2)`; }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT p.id::int AS id, p.sku, p.name, c.name AS category_name, p.image_url,
            p.mrp::float8 AS mrp, p.dp_price::float8 AS price, p.bv::float8 AS bv, p.gst_percent::float8 AS gst_percent,
            COALESCE((SELECT SUM(qty_change) FROM stock_ledger sl WHERE sl.product_id = p.id AND sl.location_id = $1::bigint), 0)::int AS available
       FROM products p JOIN product_categories c ON c.id = p.category_id
      WHERE p.active = true ${search} ORDER BY c.name, p.name LIMIT 300`, ...params);
  res.json({ rows, total: rows.length });
}));

router.post('/orders', wrap(async (req, res) => {
  const m = await member(req);
  const d = z.object({
    location_id: id,
    payment_mode: z.enum(['CASH', 'WALLET', 'EPIN', 'ONLINE']).default('CASH'),
    items: z.array(z.object({ product_id: id, qty: z.coerce.number().int().positive() })).min(1, 'Your cart is empty'),
  }).parse(req.body);
  const [loc] = await prisma.$queryRawUnsafe(`SELECT type FROM locations WHERE id = $1::bigint AND active = true`, d.location_id);
  if (!loc || !['DEPO', 'FRANCHISE'].includes(loc.type)) throw badRequest('Choose a depo or franchise to collect from');
  res.status(201).json(await placeOrder({ member_code: m.member_code, location_id: d.location_id, type: 'REPURCHASE', payment_mode: d.payment_mode, items: d.items }));
}));

router.get('/orders', wrap(async (req, res) => {
  const m = await member(req);
  const out = await listOrders({ page: 1, limit: 100, memberCode: m.member_code, status: String(req.query.status || '') });
  res.json({ rows: out.rows, total: out.rows.length });
}));

router.get('/orders/:id', wrap(async (req, res) => {
  const m = await member(req);
  const o = await getOrder(Number(req.params.id));
  if (!o || o.member_code !== m.member_code) throw notFound('Order not found');
  res.json(o);
}));

// I can cancel an order that has not been paid yet
router.put('/orders/:id/cancel', wrap(async (req, res) => {
  const m = await member(req);
  const o = await getOrder(Number(req.params.id));
  if (!o || o.member_code !== m.member_code) throw notFound('Order not found');
  if (o.status !== 'PLACED') throw badRequest('Only an unpaid order can be cancelled here. Contact support.');
  res.json(await cancelOrder(o.id));
}));

export default router;
