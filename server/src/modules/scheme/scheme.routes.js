// Schemes / offers / achievements.
// Mapping onto the existing tables (no schema change): a scheme is the offer AND the achievement definition
// (target_type + target_value = eligibility criteria, reward = what is won, start/end_date = validity, active = on/off);
// scheme_qualifiers is the per-member achievement tracking.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../core/prisma.js';
import { badRequest, notFound, forbidden } from '../../core/errors.js';
import { events } from '../../core/events.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { TX, wrap } from '../inventory/helpers.js';
import { sendNotification } from '../notification/notification.service.js';

const router = Router();
const parseId = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n < 1) throw badRequest('Invalid id');
  return n;
};

/**
 * Recompute progress for one scheme and mark who qualified. Safe to run any time, and safe to run twice at once:
 * runs for the same scheme are serialised, so a member is told about a qualification only once.
 * Dates use the database's date (UTC); a member who qualified stays qualified even if the criteria are later raised.
 */
export async function recalcScheme(schemeId) {
  const out = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('scheme:' || $1))`, String(schemeId));
    const [s] = await tx.$queryRawUnsafe(
      `SELECT id::int AS id, name, reward, active, target_type, target_value::float8 AS target, start_date::text AS start_date, end_date::text AS end_date
         FROM schemes WHERE id = $1::bigint`, schemeId);
    if (!s) return null;
    let sql;
    if (s.target_type === 'BV' || s.target_type === 'REPURCHASE') {
      // BV = total BV of paid orders, REPURCHASE = rupee value of paid repurchase orders, both inside the scheme dates
      const col = s.target_type === 'BV' ? 'o.total_bv' : 'o.total';
      const typeFilter = s.target_type === 'REPURCHASE' ? `AND o.type = 'REPURCHASE'` : '';
      sql = `SELECT o.member_id::int AS member_id, SUM(${col})::float8 AS progress FROM orders o
              WHERE o.payment_status = 'PAID' AND o.status <> 'CANCELLED' ${typeFilter}
                AND o.created_at::date BETWEEN $1::date AND $2::date GROUP BY o.member_id`;
    } else if (s.target_type === 'DIRECTS') {
      sql = `SELECT m.sponsor_id::int AS member_id, COUNT(*)::float8 AS progress FROM members m
              WHERE m.sponsor_id IS NOT NULL AND m.joined_at::date BETWEEN $1::date AND $2::date GROUP BY m.sponsor_id`;
    } else { // NEW_JOINING: new members anywhere in the sponsor's downline
      sql = `SELECT up.id::int AS member_id, COUNT(*)::float8 AS progress FROM members up
               JOIN members d ON d.sponsor_path <@ up.sponsor_path AND d.id <> up.id
              WHERE d.joined_at::date BETWEEN $1::date AND $2::date GROUP BY up.id`;
    }
    const rows = await tx.$queryRawUnsafe(sql, s.start_date, s.end_date);
    const was = new Set((await tx.$queryRawUnsafe(
      `SELECT member_id::int AS member_id FROM scheme_qualifiers WHERE scheme_id = $1::bigint AND qualified`, s.id)).map((r) => r.member_id));
    const ids = rows.map((r) => r.member_id);
    if (rows.length) {
      await tx.$executeRawUnsafe(
        `INSERT INTO scheme_qualifiers (scheme_id, member_id, progress, qualified, qualified_at)
         SELECT $1::bigint, u.m, u.p, u.p >= $4::numeric, CASE WHEN u.p >= $4::numeric THEN now() END
           FROM unnest($2::bigint[], $3::numeric[]) AS u(m, p)
         ON CONFLICT (scheme_id, member_id) DO UPDATE
           SET progress = EXCLUDED.progress,
               qualified = scheme_qualifiers.qualified OR EXCLUDED.qualified,
               qualified_at = COALESCE(scheme_qualifiers.qualified_at, EXCLUDED.qualified_at)`,
        s.id, ids, rows.map((r) => r.progress), s.target);
    }
    // members who no longer count (e.g. their orders were cancelled) go back to 0 unless they already qualified
    await tx.$executeRawUnsafe(
      `UPDATE scheme_qualifiers SET progress = 0 WHERE scheme_id = $1::bigint AND NOT qualified AND member_id <> ALL($2::bigint[])`, s.id, ids);
    const newly = rows.filter((r) => r.progress >= s.target && !was.has(r.member_id)).map((r) => r.member_id);
    return { s, members: rows.length, newly };
  }, TX);
  if (!out) return null;
  if (out.s.active) {
    for (const mid of out.newly) {
      const [m] = await prisma.$queryRawUnsafe(`SELECT user_id::int AS user_id, full_name FROM members WHERE id = $1::bigint`, mid);
      if (m) sendNotification(m.user_id, 'SCHEME_QUALIFIED', { name: m.full_name, scheme: out.s.name, reward: out.s.reward }).catch(() => {});
    }
  }
  return { members: out.members, newly_qualified: out.newly.length };
}

// Keep progress fresh. Orders move BV/REPURCHASE schemes; a new joining moves DIRECTS/NEW_JOINING schemes.
async function refreshLive(types) {
  try {
    const live = await prisma.$queryRawUnsafe(
      `SELECT id::int AS id FROM schemes WHERE active = true AND target_type = ANY($1::text[]) AND CURRENT_DATE BETWEEN start_date AND end_date`, types);
    for (const s of live) await recalcScheme(s.id);
  } catch (e) { console.error('[scheme]', e.message); }
}
events.on('ORDER_PAID', () => refreshLive(['BV', 'REPURCHASE']));
events.on('ORDER_CANCELLED', () => refreshLive(['BV', 'REPURCHASE']));
events.on('MEMBER_JOINED', () => refreshLive(['DIRECTS', 'NEW_JOINING']));

const PHASE = `CASE WHEN NOT t.active THEN 'INACTIVE' WHEN CURRENT_DATE < t.start_date THEN 'UPCOMING' WHEN CURRENT_DATE > t.end_date THEN 'ENDED' ELSE 'RUNNING' END`;
const COLS = `t.id::int AS id, t.name, t.description, t.target_type, t.target_value::float8 AS target_value, t.reward,
  to_char(t.start_date, 'YYYY-MM-DD') AS start_date, to_char(t.end_date, 'YYYY-MM-DD') AS end_date, t.active, ${PHASE} AS phase`;

// ---- distributor: my schemes and achievements (must come before the admin '/:id' routes) ----
router.get('/my', requireAuth, requireRole('DISTRIBUTOR'), wrap(async (req, res) => {
  const [m] = await prisma.$queryRawUnsafe(`SELECT id::int AS id FROM members WHERE user_id = $1::bigint`, Number(req.user.sub));
  if (!m) throw forbidden('No member profile for this login');
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  // running + upcoming schemes, plus any ended scheme this member won
  const from = `schemes t LEFT JOIN scheme_qualifiers q ON q.scheme_id = t.id AND q.member_id = $1::bigint
                 WHERE t.active = true AND (t.end_date >= CURRENT_DATE OR q.qualified)`;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT ${COLS}, COALESCE(q.progress, 0)::float8 AS progress, COALESCE(q.qualified, false) AS qualified, q.qualified_at
       FROM ${from} ORDER BY q.qualified DESC NULLS LAST, t.end_date LIMIT ${limit} OFFSET ${(page - 1) * limit}`, m.id);
  const [{ n }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ${from}`, m.id);
  res.json({ rows, total: n, page, limit });
}));

// ---- admin ----
const admin = Router();
admin.use(requireAuth, requireRole('SUPER_ADMIN', 'ADMIN'));

const realDate = (s) => { const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date').refine(realDate, 'Use a valid date');
const base = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(150),
  description: z.string().trim().max(1000).transform((v) => v || null).nullish(),
  target_type: z.enum(['BV', 'DIRECTS', 'NEW_JOINING', 'REPURCHASE']),
  target_value: z.coerce.number().positive('Target must be more than 0').max(999_999_999),
  reward: z.string().trim().min(1, 'Enter the reward').max(200),
  start_date: date, end_date: date, active: z.boolean().optional(),
});
const checkDates = (d) => { if (d.end_date < d.start_date) throw badRequest('End date cannot be before the start date'); };

admin.get('/', wrap(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const conds = []; const args = [];
  const q = String(req.query.q || '').trim();
  if (q) { args.push(`%${q}%`); conds.push(`(t.name ILIKE $1 OR t.reward ILIKE $1)`); }
  if (req.query.active === 'true') conds.push('t.active = true');
  if (req.query.active === 'false') conds.push('t.active = false');
  if (['BV', 'DIRECTS', 'NEW_JOINING', 'REPURCHASE'].includes(req.query.target_type)) { args.push(req.query.target_type); conds.push(`t.target_type = $${args.length}`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = await prisma.$queryRawUnsafe(
    `SELECT ${COLS}, (SELECT count(*) FROM scheme_qualifiers x WHERE x.scheme_id = t.id AND x.qualified)::int AS qualified_count
       FROM schemes t ${where} ORDER BY t.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, ...args);
  const [{ n }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM schemes t ${where}`, ...args);
  res.json({ rows, total: n, page, limit });
}));

const one = async (id) => (await prisma.$queryRawUnsafe(
  `SELECT ${COLS}, (SELECT count(*) FROM scheme_qualifiers x WHERE x.scheme_id = t.id AND x.qualified)::int AS qualified_count FROM schemes t WHERE t.id = $1::bigint`, id))[0];

admin.post('/', wrap(async (req, res) => {
  const d = base.parse(req.body);
  checkDates(d);
  const [{ id }] = await prisma.$queryRawUnsafe(
    `INSERT INTO schemes (name, description, target_type, target_value, reward, start_date, end_date, active)
     VALUES ($1, $2, $3, $4::numeric, $5, $6::date, $7::date, $8) RETURNING id::int AS id`,
    d.name, d.description ?? null, d.target_type, d.target_value, d.reward, d.start_date, d.end_date, d.active ?? true);
  await recalcScheme(id).catch((e) => console.error('[scheme]', e.message)); // show current progress straight away
  res.status(201).json(await one(id));
}));

admin.put('/:id', wrap(async (req, res) => {
  const id = parseId(req);
  const patch = base.partial().parse(req.body);
  const cur = await one(id);
  if (!cur) throw notFound('Scheme not found');
  const d = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
  checkDates(d);
  if (!Object.keys(patch).length) throw badRequest('Nothing to update');
  await prisma.$executeRawUnsafe(
    `UPDATE schemes SET name = $1, description = $2, target_type = $3, target_value = $4::numeric, reward = $5, start_date = $6::date, end_date = $7::date, active = $8 WHERE id = $9::bigint`,
    d.name, d.description ?? null, d.target_type, d.target_value, d.reward, d.start_date, d.end_date, d.active, id);
  if (d.active) await recalcScheme(id).catch((e) => console.error('[scheme]', e.message));
  res.json(await one(id));
}));

admin.get('/:id/qualifiers', wrap(async (req, res) => {
  const id = parseId(req);
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const cond = req.query.qualified === 'true' ? 'AND q.qualified' : '';
  const rows = await prisma.$queryRawUnsafe(
    `SELECT q.id::int AS id, m.member_code, m.full_name, q.progress::float8 AS progress, q.qualified, q.qualified_at
       FROM scheme_qualifiers q JOIN members m ON m.id = q.member_id WHERE q.scheme_id = $1::bigint ${cond}
      ORDER BY q.qualified DESC, q.progress DESC, q.id LIMIT ${limit} OFFSET ${(page - 1) * limit}`, id);
  const [{ n }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM scheme_qualifiers q WHERE q.scheme_id = $1::bigint ${cond}`, id);
  res.json({ rows, total: n, page, limit });
}));
admin.post('/:id/recalculate', wrap(async (req, res) => {
  const r = await recalcScheme(parseId(req));
  if (!r) throw notFound('Scheme not found');
  res.json(r);
}));
router.use('/', admin);

export default router;
