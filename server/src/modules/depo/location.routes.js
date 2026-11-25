// Admin side of Depo / Franchise management: the location itself and (optionally) its login.
// Mounted at /api/inventory/depos. Warehouses belong to the Masters module and are not touched here.
import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { prisma } from '../../core/prisma.js';
import { AppError, badRequest, forbidden, notFound } from '../../core/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { TX, wrap } from '../inventory/helpers.js';

const router = Router();
router.use(requireAuth, requireRole('SUPER_ADMIN', 'ADMIN'));

const opt = (max) => z.string().trim().max(max).transform((v) => v || null).nullish();
const base = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  state: opt(80), city: opt(80), pincode: opt(10), address: opt(500),
});
const createSchema = base.extend({
  type: z.enum(['DEPO', 'FRANCHISE']),
  login_id: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9._-]+$/, 'Login ID can use letters, digits, dot, dash and underscore').optional(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(72).optional(), // 72 = bcrypt limit
}).refine((d) => Boolean(d.login_id) === Boolean(d.password), 'Enter both a login ID and a password, or neither');
const updateSchema = base.partial().extend({ active: z.boolean().optional() });

const COLUMNS = `l.id::int AS id, l.type, l.name, l.state, l.city, l.pincode, l.address, l.active, u.login_id,
  (SELECT COALESCE(SUM(qty_change), 0)::int FROM stock_ledger WHERE location_id = l.id) AS stock_units`;
const FROM = `locations l LEFT JOIN users u ON u.id = l.owner_user_id`;
const one = async (id) => (await prisma.$queryRawUnsafe(`SELECT ${COLUMNS} FROM ${FROM} WHERE l.id = $1::bigint AND l.type IN ('DEPO', 'FRANCHISE')`, id))[0];
const parseId = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n < 1) throw badRequest('Invalid id');
  return n;
};

router.get('/', wrap(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const conds = [`l.type IN ('DEPO', 'FRANCHISE')`];
  const params = [];
  const q = String(req.query.q || '').trim();
  if (q) { params.push(`%${q}%`); conds.push('(l.name ILIKE $1 OR l.city ILIKE $1 OR l.state ILIKE $1 OR u.login_id ILIKE $1)'); }
  if (['DEPO', 'FRANCHISE'].includes(req.query.type)) { params.push(req.query.type); conds.push(`l.type = $${params.length}`); }
  if (req.query.active === 'true') conds.push('l.active = true');
  if (req.query.active === 'false') conds.push('l.active IS NOT TRUE');
  const where = `WHERE ${conds.join(' AND ')}`;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT ${COLUMNS} FROM ${FROM} ${where} ORDER BY l.type, l.name LIMIT ${limit} OFFSET ${(page - 1) * limit}`, ...params);
  const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM ${FROM} ${where}`, ...params);
  res.json({ rows, total: n, page, limit });
}));

router.post('/', wrap(async (req, res) => {
  const d = createSchema.parse(req.body);
  // creating a login is an account-creation action: Super Admin only
  if (d.login_id && req.user.role !== 'SUPER_ADMIN') throw forbidden('Only a Super Admin can create a depo/franchise login');
  const hash = d.password ? await bcrypt.hash(d.password, 12) : null; // outside the transaction: bcrypt is slow

  const id = await prisma.$transaction(async (tx) => {
    let ownerId = null;
    if (d.login_id) {
      const [taken] = await tx.$queryRawUnsafe(`SELECT 1 FROM users WHERE lower(login_id) = lower($1)`, d.login_id);
      if (taken) throw new AppError(409, 'That login ID is already in use');
      const [u] = await tx.$queryRawUnsafe(
        `INSERT INTO users (role_id, login_id, password_hash) SELECT id, $1, $2 FROM roles WHERE code = $3 RETURNING id::int AS id`,
        d.login_id, hash, d.type);
      if (!u) throw badRequest(`The ${d.type} role is missing in the database`);
      ownerId = u.id;
    }
    const [loc] = await tx.$queryRawUnsafe(
      `INSERT INTO locations (type, name, state, city, pincode, address, owner_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7::bigint) RETURNING id::int AS id`,
      d.type, d.name, d.state ?? null, d.city ?? null, d.pincode ?? null, d.address ?? null, ownerId);
    return loc.id;
  }, TX);
  res.status(201).json(await one(id));
}));

router.put('/:id', wrap(async (req, res) => {
  const id = parseId(req);
  const d = updateSchema.parse(req.body);
  const keys = Object.keys(d).filter((k) => d[k] !== undefined);
  if (!keys.length) throw badRequest('Nothing to update');
  if (d.active === false) {
    // stock in transit to/from a location that gets switched off could never be accepted or returned cleanly
    const [{ n }] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM stock_transfers WHERE status = 'SENT' AND (from_location = $1::bigint OR to_location = $1::bigint)`, id);
    if (n > 0) throw badRequest(`Resolve the ${n} transfer(s) still in transit before deactivating this location`);
  }
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const n = await prisma.$executeRawUnsafe(
    `UPDATE locations SET ${sets} WHERE id = $${keys.length + 1}::bigint AND type IN ('DEPO', 'FRANCHISE')`, ...keys.map((k) => d[k]), id);
  if (!n) throw notFound('Depo or franchise not found');
  res.json(await one(id));
}));

export default router;
