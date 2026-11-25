import { Router } from 'express';
import { prisma } from '../../core/prisma.js';
import { badRequest, notFound } from '../../core/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { wrap } from '../inventory/helpers.js';
import { TEMPLATES, deliver } from './notification.service.js';

const router = Router();
router.use(requireAuth);
const admin = requireRole('SUPER_ADMIN', 'ADMIN');
const paging = (req, max = 100) => ({
  page: Math.max(1, parseInt(req.query.page) || 1),
  limit: Math.min(max, Math.max(1, parseInt(req.query.limit) || 20)),
});

// any logged-in user: own in-app notifications
router.get('/mine', wrap(async (req, res) => {
  const { page, limit } = paging(req, 50);
  const uid = Number(req.user.sub);
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id::int AS id, subject, body, created_at FROM notifications WHERE user_id = $1::bigint AND channel = 'INAPP'
      ORDER BY id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, uid);
  const [{ n }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1::bigint AND channel = 'INAPP'`, uid);
  res.json({ rows, total: n, page, limit });
}));

// admin: the templates in use (fixed in code; editing them in the UI would need a database table)
router.get('/templates', admin, wrap(async (_req, res) => {
  const rows = Object.entries(TEMPLATES).map(([code, t]) => ({
    code, channels: t.channels, subject: t.subject, body: t.body,
    variables: [...new Set([...t.subject.matchAll(/\{\{(\w+)\}\}/g), ...t.body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))],
  }));
  res.json({ rows, total: rows.length });
}));

// admin: delivery counts per channel and status
router.get('/stats', admin, wrap(async (_req, res) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT channel, status, count(*)::int AS n FROM notifications GROUP BY channel, status ORDER BY channel, status`);
  res.json({ rows });
}));

// admin: delivery log
router.get('/', admin, wrap(async (req, res) => {
  const { page, limit } = paging(req);
  const conds = []; const args = [];
  const st = String(req.query.status || '');
  const ch = String(req.query.channel || '');
  const tpl = String(req.query.template || '');
  const q = String(req.query.q || '').trim();
  if (['QUEUED', 'SENDING', 'SENT', 'FAILED'].includes(st)) { args.push(st); conds.push(`n.status = $${args.length}`); }
  if (['EMAIL', 'SMS', 'INAPP'].includes(ch)) { args.push(ch); conds.push(`n.channel = $${args.length}`); }
  if (TEMPLATES[tpl]) { args.push(tpl); conds.push(`n.template = $${args.length}`); }
  if (q) { args.push(`%${q}%`); conds.push(`(n.subject ILIKE $${args.length} OR n.recipient ILIKE $${args.length} OR u.login_id ILIKE $${args.length})`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const from = `notifications n LEFT JOIN users u ON u.id = n.user_id`;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT n.id::int AS id, n.channel, n.template, n.subject, n.recipient, n.status, n.error, n.created_at, n.sent_at, u.login_id
       FROM ${from} ${where} ORDER BY n.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, ...args);
  const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM ${from} ${where}`, ...args);
  res.json({ rows, total: n, page, limit });
}));

// admin: try a FAILED notification again (or one stuck in SENDING for 15+ minutes, e.g. after a crash)
router.put('/:id/resend', admin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw badRequest('Invalid id');
  const [n] = await prisma.$queryRawUnsafe(
    `SELECT status, channel, (created_at < now() - interval '15 minutes') AS stale FROM notifications WHERE id = $1::bigint`, id);
  if (!n) throw notFound('Notification not found');
  if (n.channel === 'INAPP') throw badRequest('In-app notifications are not sent anywhere');
  if (n.status === 'SENT') throw badRequest('Already sent');
  if (n.status === 'SENDING' && !n.stale) throw badRequest('This notification is being sent right now');
  await deliver(id, { force: n.status === 'SENDING' });
  const [after] = await prisma.$queryRawUnsafe(`SELECT status, error FROM notifications WHERE id = $1::bigint`, id);
  res.json(after);
}));

export default router;
