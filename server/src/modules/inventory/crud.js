// Small CRUD factory for simple master tables (categories, products, suppliers, couriers).
// Table/column names come from code constants below, never from user input.
import { Router } from 'express';
import { prisma } from '../../core/prisma.js';
import { badRequest, notFound } from '../../core/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';

function mapDbError(e) {
  const m = String(e?.message || '');
  if (/duplicate key|23505/i.test(m)) return badRequest('That value already exists (name / SKU must be unique)');
  if (/foreign key|23503/i.test(m)) return badRequest('This record is linked to other data');
  return e;
}
const wrap = (fn) => (req, res, next) => fn(req, res).catch((e) => next(mapDbError(e)));

export function makeCrud({ table, from, columns, searchCols, schema, orderBy = 't.id DESC', aliases = {}, filterCols = {} }) {
  // filterCols: { queryParam: 't.column' } exact-match filters on whitelisted integer columns, e.g. { category_id: 't.category_id' }
  // aliases: { apiName: 'db_column' } e.g. { active: 'published' }
  const rename = (data) => Object.fromEntries(Object.entries(data).map(([k, v]) => [aliases[k] || k, v]));
  const router = Router();
  router.use(requireAuth, requireRole('SUPER_ADMIN', 'ADMIN'));
  const base = `SELECT ${columns} FROM ${from}`;
  const one = async (id) => (await prisma.$queryRawUnsafe(`${base} WHERE t.id = $1::bigint`, id))[0];
  const parseId = (req) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw badRequest('Invalid id');
    return id;
  };

  router.get('/', wrap(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const q = String(req.query.q || '').trim();
    const conds = [];
    const params = [];
    if (q) {
      params.push(`%${q}%`);
      conds.push(`(${searchCols.map((c) => `${c} ILIKE $1`).join(' OR ')})`);
    }
    if (req.query.active === 'true') conds.push('t.active = true');
    if (req.query.active === 'false') conds.push('t.active IS NOT TRUE'); // active is nullable: NULL counts as inactive
    for (const [param, col] of Object.entries(filterCols)) {
      const v = req.query[param];
      if (v === undefined || v === '') continue;
      const n = Number(v);
      if (!Number.isInteger(n)) throw badRequest(`Invalid ${param}`);
      params.push(n);
      conds.push(`${col} = $${params.length}::bigint`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = await prisma.$queryRawUnsafe(
      `${base} ${where} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${(page - 1) * limit}`, ...params);
    const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM ${from} ${where}`, ...params);
    res.json({ rows, total: n, page, limit });
  }));

  router.post('/', wrap(async (req, res) => {
    const data = rename(schema.parse(req.body));
    const keys = Object.keys(data).filter((k) => data[k] !== undefined);
    const [{ id }] = await prisma.$queryRawUnsafe(
      `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id::int AS id`,
      ...keys.map((k) => data[k]));
    res.status(201).json(await one(id));
  }));

  router.put('/:id', wrap(async (req, res) => {
    const id = parseId(req);
    const data = rename(schema.partial().parse(req.body));
    const keys = Object.keys(data).filter((k) => data[k] !== undefined);
    if (!keys.length) throw badRequest('Nothing to update');
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const n = await prisma.$executeRawUnsafe(
      `UPDATE ${table} SET ${sets} WHERE id = $${keys.length + 1}::bigint`, ...keys.map((k) => data[k]), id);
    if (!n) throw notFound('Record not found');
    res.json(await one(id));
  }));

  return router;
}
