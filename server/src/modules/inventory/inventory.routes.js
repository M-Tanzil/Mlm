import { Router } from 'express';
import { z } from 'zod';
import { makeCrud } from './crud.js';
import purchase from './purchase.routes.js';
import stock from './stock.routes.js';
import transfers from './transfer.routes.js';
import pcr from './pcr.routes.js';
import productImage from './productImage.routes.js';

const req = z.string().trim().min(1);
const opt = z.string().trim().transform((v) => (v === '' ? null : v)).nullish();
const money = z.coerce.number().min(0);
const active = z.boolean().optional();

const router = Router();

router.use('/categories', makeCrud({
  table: 'product_categories',
  from: 'product_categories t',
  columns: 't.id::int AS id, t.name, t.active',
  searchCols: ['t.name'],
  schema: z.object({ name: req, active }),
}));

router.use('/products', productImage); // /:id/image must come before the CRUD router
router.use('/products', makeCrud({
  table: 'products',
  from: 'products t JOIN product_categories c ON c.id = t.category_id',
  columns: `t.id::int AS id, t.category_id::int AS category_id, c.name AS category_name, t.sku, t.name,
    t.mrp::float8 AS mrp, t.dp_price::float8 AS dp_price, t.bv::float8 AS bv,
    t.gst_percent::float8 AS gst_percent, t.hsn_code, t.image_url, t.active`,
  searchCols: ['t.name', 't.sku', 'c.name'],
  filterCols: { category_id: 't.category_id' },
  schema: z.object({
    category_id: z.coerce.number().int().positive(),
    sku: req, name: req,
    mrp: money, dp_price: money, bv: money,
    gst_percent: z.coerce.number().min(0).max(100),
    hsn_code: opt, active,
  }),
}));

router.use('/suppliers', makeCrud({
  table: 'suppliers',
  from: 'suppliers t',
  columns: 't.id::int AS id, t.name, t.contact_person, t.mobile, t.email, t.gstin, t.address, t.active',
  searchCols: ['t.name', 't.mobile', 't.gstin'],
  schema: z.object({
    name: req, contact_person: opt, mobile: opt,
    email: z.string().trim().email().or(z.literal('')).transform((v) => v || null).nullish(),
    gstin: opt, address: opt, active,
  }),
}));

router.use('/couriers', makeCrud({
  table: 'couriers',
  from: 'couriers t',
  columns: 't.id::int AS id, t.name, t.contact, t.tracking_url_template, t.active',
  searchCols: ['t.name'],
  schema: z.object({ name: req, contact: opt, tracking_url_template: opt, active }),
}));

// TODO (next): purchase-orders, stock-inward, stock-returns, stock-transfers, stock report

router.use('/purchase-orders', purchase);
router.use('/stock-transfers', transfers);
router.use('/pcr', pcr);
router.use('/', stock);

export default router;
