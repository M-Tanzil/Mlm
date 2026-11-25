import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../core/prisma.js';
import { badRequest, notFound, forbidden } from '../../core/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { wrap } from '../inventory/helpers.js';
import { sendNotification } from '../notification/notification.service.js';

const router = Router();
router.use(requireAuth);

const msg = z.object({ body: z.string().trim().min(1, 'Write a message') });
const STATUS = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

async function thread(ticketId) {
  const [t] = await prisma.$queryRawUnsafe(
    `SELECT t.id::int AS id, t.subject, t.status, t.priority, t.created_at, t.member_id::int AS member_id, m.member_code, m.full_name AS member_name
       FROM tickets t JOIN members m ON m.id = t.member_id WHERE t.id = $1::bigint`, ticketId);
  if (!t) return null;
  t.messages = await prisma.$queryRawUnsafe(
    `SELECT x.id::int AS id, x.body, x.created_at, (r.code IN ('SUPER_ADMIN','ADMIN')) AS from_admin
       FROM ticket_messages x JOIN users u ON u.id = x.sender_user_id JOIN roles r ON r.id = u.role_id
      WHERE x.ticket_id = $1::bigint ORDER BY x.id`, ticketId);
  return t;
}

// ---------- member side (distributor panel) ----------
const member = Router();
member.use(requireRole('DISTRIBUTOR'));
const myMemberId = async (req) => {
  const [m] = await prisma.$queryRawUnsafe(`SELECT id::int AS id FROM members WHERE user_id = $1::bigint`, Number(req.user.sub));
  if (!m) throw forbidden('No member profile for this login');
  return m.id;
};
member.get('/tickets', wrap(async (req, res) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id::int AS id, subject, status, priority, created_at FROM tickets WHERE member_id = $1::bigint ORDER BY id DESC LIMIT 100`, await myMemberId(req));
  res.json({ rows, total: rows.length });
}));
member.post('/tickets', wrap(async (req, res) => {
  const d = z.object({ subject: z.string().trim().min(1, 'Enter a subject'), body: z.string().trim().min(1, 'Write a message') }).parse(req.body);
  const mid = await myMemberId(req);
  const [{ id }] = await prisma.$queryRawUnsafe(`INSERT INTO tickets (member_id, subject) VALUES ($1::bigint, $2) RETURNING id::int AS id`, mid, d.subject);
  await prisma.$executeRawUnsafe(`INSERT INTO ticket_messages (ticket_id, sender_user_id, body) VALUES ($1::bigint, $2::bigint, $3)`, id, Number(req.user.sub), d.body);
  res.status(201).json({ id });
}));
member.get('/tickets/:id', wrap(async (req, res) => {
  const t = await thread(Number(req.params.id));
  if (!t || t.member_id !== (await myMemberId(req))) throw notFound('Ticket not found');
  res.json(t);
}));
member.post('/tickets/:id/reply', wrap(async (req, res) => {
  const d = msg.parse(req.body);
  const t = await thread(Number(req.params.id));
  if (!t || t.member_id !== (await myMemberId(req))) throw notFound('Ticket not found');
  if (t.status === 'CLOSED') throw badRequest('This ticket is closed');
  await prisma.$executeRawUnsafe(`INSERT INTO ticket_messages (ticket_id, sender_user_id, body) VALUES ($1::bigint, $2::bigint, $3)`, t.id, Number(req.user.sub), d.body);
  await prisma.$executeRawUnsafe(`UPDATE tickets SET status = 'OPEN' WHERE id = $1::bigint AND status IN ('RESOLVED')`, t.id);
  res.status(201).json(await thread(t.id));
}));
router.use('/my', member);

// ---------- admin side ----------
const admin = Router();
admin.use(requireRole('SUPER_ADMIN', 'ADMIN'));
admin.get('/tickets', wrap(async (req, res) => {
  const st = String(req.query.status || '');
  const where = STATUS.includes(st) ? `WHERE t.status = '${st}'` : '';
  const rows = await prisma.$queryRawUnsafe(
    `SELECT t.id::int AS id, t.subject, t.status, t.priority, t.created_at, m.member_code, m.full_name AS member_name
       FROM tickets t JOIN members m ON m.id = t.member_id ${where} ORDER BY t.id DESC LIMIT 200`);
  res.json({ rows, total: rows.length });
}));
admin.get('/tickets/:id', wrap(async (req, res) => {
  const t = await thread(Number(req.params.id));
  if (!t) throw notFound('Ticket not found');
  res.json(t);
}));
admin.post('/tickets/:id/reply', wrap(async (req, res) => {
  const d = msg.parse(req.body);
  const t = await thread(Number(req.params.id));
  if (!t) throw notFound('Ticket not found');
  await prisma.$executeRawUnsafe(`INSERT INTO ticket_messages (ticket_id, sender_user_id, body) VALUES ($1::bigint, $2::bigint, $3)`, t.id, Number(req.user.sub), d.body);
  await prisma.$executeRawUnsafe(`UPDATE tickets SET status = 'IN_PROGRESS' WHERE id = $1::bigint AND status = 'OPEN'`, t.id);
  const [m] = await prisma.$queryRawUnsafe(`SELECT user_id::int AS user_id FROM members WHERE id = $1::bigint`, t.member_id);
  if (m) sendNotification(m.user_id, 'TICKET_REPLY', { ticket_id: t.id, subject: t.subject }).catch(() => {});
  res.status(201).json(await thread(t.id));
}));
admin.put('/tickets/:id', wrap(async (req, res) => {
  const d = z.object({ status: z.enum(STATUS).optional(), priority: z.enum(['LOW', 'NORMAL', 'HIGH']).optional() }).parse(req.body);
  if (!d.status && !d.priority) throw badRequest('Nothing to update');
  const n = await prisma.$executeRawUnsafe(
    `UPDATE tickets SET status = COALESCE($1, status), priority = COALESCE($2, priority) WHERE id = $3::bigint`, d.status ?? null, d.priority ?? null, Number(req.params.id));
  if (!n) throw notFound('Ticket not found');
  res.json(await thread(Number(req.params.id)));
}));
router.use('/', admin);

export default router;
