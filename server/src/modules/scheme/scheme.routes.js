import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../core/prisma.js';
import { notFound } from '../../core/errors.js';
import { events } from '../../core/events.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { wrap } from '../inventory/helpers.js';
import { makeCrud } from '../inventory/crud.js';
import { sendNotification } from '../notification/notification.service.js';

const router = Router();

/** Recompute progress for one scheme and mark who qualified. Safe to run any time. */
export async function recalcScheme(schemeId) {
  const [s] = await prisma.$queryRawUnsafe(
    `SELECT id::int AS id, name, reward, target_type, target_value::float8 AS target, start_date::text AS start_date, end_date::text AS end_date
       FROM schemes WHERE id = $1::bigint`, schemeId);
  if (!s) return null;
  const win = [s.start_date, s.end_date];
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
  const rows = await prisma.$queryRawUnsafe(sql, ...win);
  const newlyQualified = [];
  for (const r of rows) {
    const ok = r.progress >= s.target;
    const [prev] = await prisma.$queryRawUnsafe(
      `SELECT qualified FROM scheme_qualifiers WHERE scheme_id = $1::bigint AND member_id = $2::bigint`, s.id, r.member_id);
    await prisma.$executeRawUnsafe(
      `INSERT INTO scheme_qualifiers (scheme_id, member_id, progress, qualified, qualified_at)
       VALUES ($1::bigint, $2::bigint, $3, $4, CASE WHEN $4::boolean THEN now() END)
       ON CONFLICT (scheme_id, member_id) DO UPDATE
         SET progress = EXCLUDED.progress,
             qualified = scheme_qualifiers.qualified OR EXCLUDED.qualified,
             qualified_at = COALESCE(scheme_qualifiers.qualified_at, EXCLUDED.qualified_at)`,
      s.id, r.member_id, r.progress, ok);
    if (ok && !prev?.qualified) newlyQualified.push(r.member_id);
  }
  for (const mid of newlyQualified) {
    const [m] = await prisma.$queryRawUnsafe(`SELECT user_id::int AS user_id, full_name FROM members WHERE id = $1::bigint`, mid);
    if (m) sendNotification(m.user_id, 'SCHEME_QUALIFIED', { name: m.full_name, scheme: s.name, reward: s.reward }).catch(() => {});
  }
  return { members: rows.length, newly_qualified: newlyQualified.length };
}

// keep progress fresh: every paid order re-checks the schemes that are running today
events.on('ORDER_PAID', async () => {
  try {
    const live = await prisma.$queryRawUnsafe(
      `SELECT id::int AS id FROM schemes WHERE active = true AND target_type IN ('BV','REPURCHASE') AND CURRENT_DATE BETWEEN start_date AND end_date`);
    for (const s of live) await recalcScheme(s.id);
  } catch (e) { console.error('[scheme]', e.message); }
});

// ---- admin ----
const admin = Router();
admin.use(requireAuth, requireRole('SUPER_ADMIN', 'ADMIN'));

admin.get('/:id/qualifiers', wrap(async (req, res) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT q.id::int AS id, m.member_code, m.full_name, q.progress::float8 AS progress, q.qualified, q.qualified_at
       FROM scheme_qualifiers q JOIN members m ON m.id = q.member_id WHERE q.scheme_id = $1::bigint
      ORDER BY q.qualified DESC, q.progress DESC LIMIT 500`, Number(req.params.id));
  res.json({ rows, total: rows.length });
}));
admin.post('/:id/recalculate', wrap(async (req, res) => {
  const r = await recalcScheme(Number(req.params.id));
  if (!r) throw notFound('Scheme not found');
  res.json(r);
}));
router.use('/', admin);

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');
const opt = z.string().trim().transform((v) => (v === '' ? null : v)).nullish();
router.use('/', makeCrud({
  table: 'schemes',
  from: 'schemes t',
  columns: `t.id::int AS id, t.name, t.description, t.target_type, t.target_value::float8 AS target_value, t.reward,
            to_char(t.start_date, 'YYYY-MM-DD') AS start_date, to_char(t.end_date, 'YYYY-MM-DD') AS end_date, t.active`,
  searchCols: ['t.name', 't.reward'],
  schema: z.object({
    name: z.string().trim().min(1), description: opt,
    target_type: z.enum(['BV', 'DIRECTS', 'NEW_JOINING', 'REPURCHASE']),
    target_value: z.coerce.number().positive(), reward: z.string().trim().min(1),
    start_date: date, end_date: date, active: z.boolean().optional(),
  }),
}));

export default router;
