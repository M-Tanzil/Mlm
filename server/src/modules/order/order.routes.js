import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../core/prisma.js';
import { notFound } from '../../core/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { wrap } from '../inventory/helpers.js';
import { getOrder, listOrders, placeOrder, markPaid, dispatchOrder, deliverOrder, cancelOrder } from './order.service.js';
import joining from './joining.routes.js';
import shop from './shop.routes.js';

const router = Router();
router.use(requireAuth);
router.use('/my', shop); // distributor shop, has its own DISTRIBUTOR guard
router.use(requireRole('SUPER_ADMIN', 'ADMIN'));

const id = z.coerce.number().int().positive();
const placeSchema = z.object({
  member_code: z.string().trim().min(1, 'Enter the member ID'),
  location_id: id,
  type: z.enum(['JOINING', 'REPURCHASE', 'RESALE']).default('REPURCHASE'),
  payment_mode: z.enum(['CASH', 'WALLET', 'EPIN', 'ONLINE']).default('CASH'),
  items: z.array(z.object({ product_id: id, qty: z.coerce.number().int().positive() })).min(1, 'Add at least one product'),
});
const dispatchSchema = z.object({
  courier_id: id.optional(),
  tracking_no: z.string().trim().transform((v) => v || null).nullish(),
});
const paging = (req) => ({
  page: Math.max(1, parseInt(req.query.page) || 1),
  limit: Math.min(100, Math.max(1, parseInt(req.query.limit) || 20)),
  q: String(req.query.q || '').trim(),
  status: String(req.query.status || ''),
  locationId: parseInt(req.query.location_id) || null,
});

router.use('/', joining);

router.get('/member-lookup', wrap(async (req, res) => {
  const [m] = await prisma.$queryRawUnsafe(
    `SELECT member_code, full_name FROM members WHERE member_code = $1`, String(req.query.code || '').trim());
  if (!m) throw notFound('Member ID not found');
  res.json(m);
}));

router.get('/', wrap(async (req, res) => res.json(await listOrders(paging(req)))));
router.get('/:id', wrap(async (req, res) => {
  const o = await getOrder(Number(req.params.id));
  if (!o) throw notFound('Order not found');
  res.json(o);
}));
router.post('/', wrap(async (req, res) => res.status(201).json(await placeOrder(placeSchema.parse(req.body)))));
router.put('/:id/pay', wrap(async (req, res) => res.json(await markPaid(Number(req.params.id)))));
router.put('/:id/dispatch', wrap(async (req, res) => res.json(await dispatchOrder(Number(req.params.id), dispatchSchema.parse(req.body)))));
router.put('/:id/deliver', wrap(async (req, res) => res.json(await deliverOrder(Number(req.params.id)))));
router.put('/:id/cancel', wrap(async (req, res) => res.json(await cancelOrder(Number(req.params.id)))));

export default router;
