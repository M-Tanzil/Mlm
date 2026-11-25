import { Router } from 'express';
import { z } from 'zod';
import { makeCrud } from './crud.js';
import purchase from './purchase.routes.js';
import stock from './stock.routes.js';
import transfers from './transfer.routes.js';
import pcr from './pcr.routes.js';
import productImage from './productImage.routes.js';
import depos from '../depo/location.routes.js';

const req = z.string().trim().min(1);
const opt = z.string().trim().transform((v) => (v === '' ? null : v)).nullish();
// Optional text field: blank -> null, otherwise must match (regex or predicate); upper = force upper-case first
const optMatching = (test, msg, upper = false) =>
  z.string().trim()
    .transform((v) => (upper ? v.toUpperCase() : v))
    .refine((v) => v === '' || (typeof test === 'function' ? test(v) : test.test(v)), msg)
    .transform((v) => v || null)
    .nullish();
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
    name: req, contact_person: opt,
    mobile: optMatching(/^\+?[0-9][0-9\s-]{6,14}$/, 'Enter a valid mobile number'),
    email: optMatching((v) => z.string().email().safeParse(v).success, 'Enter a valid email address'),
    gstin: optMatching(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'GSTIN must be 15 characters, e.g. 22AAAAA0000A1Z5', true),
    address: opt, active,
  }),
}));

router.use('/couriers', makeCrud({
  table: 'couriers',
  from: 'couriers t',
  columns: 't.id::int AS id, t.name, t.contact, t.tracking_url_template, t.active',
  searchCols: ['t.name'],
  schema: z.object({
    name: req, contact: opt, active,
    // http(s) only: this is rendered as a link later, so javascript: URLs must not get in
    tracking_url_template: optMatching(/^https?:\/\/\S+$/i, 'Must start with http:// or https:// (use {tracking_no} where the number goes)'),
  }),
}));

// TODO (next): purchase-orders, stock-inward, stock-returns, stock-transfers, stock report

router.use('/purchase-orders', purchase);
router.use('/stock-transfers', transfers);
router.use('/pcr', pcr);
router.use('/depos', depos);
router.use('/', stock);

export default router;
