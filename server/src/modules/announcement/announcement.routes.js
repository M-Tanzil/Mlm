// Announcements: news, events, achievers, gallery. Admin manages them; every logged-in user reads the ones meant for them.
// An announcement is visible to a reader when it is published, inside its start/expiry window, and its audience fits the reader's role.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../core/prisma.js';
import { badRequest, notFound } from '../../core/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { wrap } from '../inventory/helpers.js';

const router = Router();
router.use(requireAuth);
const TYPES = ['NEWS', 'EVENT', 'ACHIEVER', 'GALLERY'];
const AUDIENCES = ['ALL', 'DISTRIBUTOR', 'DEPO']; // DEPO covers depo and franchise logins
const parseId = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n < 1) throw badRequest('Invalid id');
  return n;
};
const paging = (req, max) => ({
  page: Math.max(1, parseInt(req.query.page) || 1),
  limit: Math.min(max, Math.max(1, parseInt(req.query.limit) || 20)),
});

// "visible right now" for a reader: audience is checked in SQL against the reader's role
const LIVE = `a.published = true AND (a.starts_at IS NULL OR a.starts_at <= now()) AND (a.expires_at IS NULL OR a.expires_at > now())`;
const audienceFor = (role) => (role === 'DISTRIBUTOR' ? ['ALL', 'DISTRIBUTOR'] : ['DEPO', 'FRANCHISE'].includes(role) ? ['ALL', 'DEPO'] : AUDIENCES);

router.get('/published', wrap(async (req, res) => {
  const { page, limit } = paging(req, 50);
  const args = [audienceFor(req.user.role)];
  let typeCond = '';
  if (TYPES.includes(String(req.query.type))) { args.push(req.query.type); typeCond = `AND a.type = $2`; }
  const from = `announcements a WHERE ${LIVE} AND a.audience = ANY($1::text[]) ${typeCond}`;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT a.id::int AS id, a.type, a.title, a.body, a.media_url, to_char(a.event_date, 'YYYY-MM-DD') AS event_date, a.created_at, a.starts_at, a.expires_at
       FROM ${from} ORDER BY COALESCE(a.starts_at, a.created_at) DESC, a.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, ...args);
  const [{ n }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ${from}`, ...args);
  res.json({ rows, total: n, page, limit });
}));

// ---- admin ----
const admin = Router();
admin.use(requireRole('SUPER_ADMIN', 'ADMIN'));

const realDate = (s) => { const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };
const blank = (v) => (v === '' ? null : v);
const dateOnly = z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(realDate).nullish());
const when = z.preprocess(blank, z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Use a valid date and time').nullish()); // ISO timestamp
const url = z.preprocess(blank, z.string().trim().max(500).refine((s) => /^https?:\/\//i.test(s) || s.startsWith('/'), 'Use a web link (https://…) or an uploaded file path').nullish());
const base = z.object({
  type: z.enum(TYPES),
  title: z.string().trim().min(1, 'Enter a title').max(200),
  body: z.preprocess(blank, z.string().trim().max(5000).nullish()),
  media_url: url,
  event_date: dateOnly,
  audience: z.enum(AUDIENCES),
  starts_at: when, expires_at: when,
  published: z.boolean(),
});
const checkWindow = (d) => {
  if (d.starts_at && d.expires_at && Date.parse(d.expires_at) <= Date.parse(d.starts_at)) throw badRequest('The expiry must be after the start');
};

const VIS = `CASE WHEN NOT a.published THEN 'DRAFT' WHEN a.starts_at > now() THEN 'SCHEDULED' WHEN a.expires_at <= now() THEN 'EXPIRED' ELSE 'LIVE' END`;
const COLS = `a.id::int AS id, a.type, a.title, a.body, a.media_url, to_char(a.event_date, 'YYYY-MM-DD') AS event_date, a.audience,
  a.published, a.starts_at, a.expires_at, a.created_at, a.updated_at, ${VIS} AS visibility`;
const one = async (id) => (await prisma.$queryRawUnsafe(`SELECT ${COLS} FROM announcements a WHERE a.id = $1::bigint`, id))[0];

admin.get('/', wrap(async (req, res) => {
  const { page, limit } = paging(req, 100);
  const conds = []; const args = [];
  const q = String(req.query.q || '').trim();
  if (q) { args.push(`%${q}%`); conds.push(`a.title ILIKE $${args.length}`); }
  if (TYPES.includes(String(req.query.type))) { args.push(req.query.type); conds.push(`a.type = $${args.length}`); }
  if (AUDIENCES.includes(String(req.query.audience))) { args.push(req.query.audience); conds.push(`a.audience = $${args.length}`); }
  if (['DRAFT', 'SCHEDULED', 'LIVE', 'EXPIRED'].includes(String(req.query.visibility))) { args.push(req.query.visibility); conds.push(`(${VIS}) = $${args.length}`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = await prisma.$queryRawUnsafe(`SELECT ${COLS} FROM announcements a ${where} ORDER BY a.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, ...args);
  const [{ n }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM announcements a ${where}`, ...args);
  res.json({ rows, total: n, page, limit });
}));

admin.post('/', wrap(async (req, res) => {
  const d = base.partial({ audience: true, published: true }).parse(req.body);
  checkWindow(d);
  const [{ id }] = await prisma.$queryRawUnsafe(
    `INSERT INTO announcements (type, title, body, media_url, event_date, audience, starts_at, expires_at, published)
     VALUES ($1, $2, $3, $4, $5::date, $6, $7::timestamptz, $8::timestamptz, $9) RETURNING id::int AS id`,
    d.type, d.title, d.body ?? null, d.media_url ?? null, d.event_date ?? null, d.audience ?? 'ALL', d.starts_at ?? null, d.expires_at ?? null, d.published ?? true);
  res.status(201).json(await one(id));
}));

admin.put('/:id', wrap(async (req, res) => {
  const id = parseId(req);
  const patch = base.partial().parse(req.body);
  if (!Object.keys(patch).length) throw badRequest('Nothing to update');
  const cur = await one(id);
  if (!cur) throw notFound('Announcement not found');
  const cs = (await prisma.$queryRawUnsafe(`SELECT starts_at, expires_at FROM announcements WHERE id = $1::bigint`, id))[0];
  const d = { ...cur, starts_at: cs.starts_at?.toISOString() ?? null, expires_at: cs.expires_at?.toISOString() ?? null,
    ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
  checkWindow(d);
  await prisma.$executeRawUnsafe(
    `UPDATE announcements SET type = $1, title = $2, body = $3, media_url = $4, event_date = $5::date, audience = $6,
            starts_at = $7::timestamptz, expires_at = $8::timestamptz, published = $9, updated_at = now() WHERE id = $10::bigint`,
    d.type, d.title, d.body ?? null, d.media_url ?? null, d.event_date ?? null, d.audience, d.starts_at ?? null, d.expires_at ?? null, d.published, id);
  res.json(await one(id));
}));

admin.delete('/:id', wrap(async (req, res) => {
  const n = await prisma.$executeRawUnsafe(`DELETE FROM announcements WHERE id = $1::bigint`, parseId(req));
  if (!n) throw notFound('Announcement not found');
  res.status(204).end();
}));
router.use('/', admin);

export default router;
