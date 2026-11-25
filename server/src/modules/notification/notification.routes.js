import { Router } from 'express';
import { prisma } from '../../core/prisma.js';
import { notFound } from '../../core/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { wrap } from '../inventory/helpers.js';
import { deliver } from './notification.service.js';

const router = Router();
router.use(requireAuth);

// any logged-in user: own in-app notifications
router.get('/mine', wrap(async (req, res) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id::int AS id, subject, body, created_at FROM notifications WHERE user_id = $1::bigint AND channel = 'INAPP' ORDER BY id DESC LIMIT 50`, Number(req.user.sub));
  res.json({ rows, total: rows.length });
}));

// admin: delivery log
router.get('/', requireRole('SUPER_ADMIN', 'ADMIN'), wrap(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const conds = [];
  const st = String(req.query.status || '');
  const ch = String(req.query.channel || '');
  if (['QUEUED', 'SENT', 'FAILED'].includes(st)) conds.push(`n.status = '${st}'`);
  if (['EMAIL', 'SMS', 'INAPP'].includes(ch)) conds.push(`n.channel = '${ch}'`);
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = await prisma.$queryRawUnsafe(
    `SELECT n.id::int AS id, n.channel, n.template, n.subject, n.recipient, n.status, n.error, n.created_at, u.login_id
       FROM notifications n LEFT JOIN users u ON u.id = n.user_id ${where} ORDER BY n.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`);
  const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM notifications n ${where}`);
  res.json({ rows, total: n, page, limit });
}));

router.put('/:id/resend', requireRole('SUPER_ADMIN', 'ADMIN'), wrap(async (req, res) => {
  const [n] = await prisma.$queryRawUnsafe(`SELECT status FROM notifications WHERE id = $1::bigint`, Number(req.params.id));
  if (!n) throw notFound('Notification not found');
  await deliver(Number(req.params.id));
  const [after] = await prisma.$queryRawUnsafe(`SELECT status, error FROM notifications WHERE id = $1::bigint`, Number(req.params.id));
  res.json(after);
}));

export default router;
