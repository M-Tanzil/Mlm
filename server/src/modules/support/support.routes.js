// Support tickets. Members raise and follow their own tickets; admins triage, assign, reply and resolve.
// Workflow: OPEN -> IN_PROGRESS (admin replies) -> RESOLVED -> CLOSED. A member's reply to a RESOLVED ticket reopens it.
// CLOSED is final for replies: reopen it from the admin side first.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../core/prisma.js';
import { badRequest, notFound, forbidden } from '../../core/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { TX, wrap } from '../inventory/helpers.js';
import { sendNotification } from '../notification/notification.service.js';

const router = Router();
router.use(requireAuth);

export const STATUS = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
export const PRIORITY = ['LOW', 'NORMAL', 'HIGH'];
export const CATEGORIES = ['GENERAL', 'ORDER', 'PAYMENT', 'KYC', 'ACCOUNT', 'TECHNICAL']; // kept in code; change here to add one
const parseId = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n < 1) throw badRequest('Invalid id');
  return n;
};
const paging = (req) => ({
  page: Math.max(1, parseInt(req.query.page) || 1),
  limit: Math.min(100, Math.max(1, parseInt(req.query.limit) || 20)),
});
const text = (max, msg = 'Write a message') => z.string().trim().min(1, msg).max(max);
const msg = z.object({ body: text(5000) });

const TICKET_COLS = `t.id::int AS id, t.subject, t.status, t.priority, t.category, t.created_at, t.resolved_at, t.resolution,
  t.member_id::int AS member_id, t.assigned_to::int AS assigned_to, au.login_id AS assigned_name,
  m.member_code, m.full_name AS member_name,
  (SELECT max(x.created_at) FROM ticket_messages x WHERE x.ticket_id = t.id) AS last_message_at`;
const TICKET_FROM = `tickets t JOIN members m ON m.id = t.member_id LEFT JOIN users au ON au.id = t.assigned_to`;

async function thread(ticketId, db = prisma) {
  const [t] = await db.$queryRawUnsafe(`SELECT ${TICKET_COLS} FROM ${TICKET_FROM} WHERE t.id = $1::bigint`, ticketId);
  if (!t) return null;
  t.messages = await db.$queryRawUnsafe(
    `SELECT x.id::int AS id, x.body, x.created_at, (r.code IN ('SUPER_ADMIN','ADMIN')) AS from_admin
       FROM ticket_messages x JOIN users u ON u.id = x.sender_user_id JOIN roles r ON r.id = u.role_id
      WHERE x.ticket_id = $1::bigint ORDER BY x.id`, ticketId);
  return t;
}
const addMessage = (tx, ticketId, userId, body) =>
  tx.$executeRawUnsafe(`INSERT INTO ticket_messages (ticket_id, sender_user_id, body) VALUES ($1::bigint, $2::bigint, $3)`, ticketId, userId, body);
const lockTicket = async (tx, id) => {
  const [t] = await tx.$queryRawUnsafe(`SELECT id::int AS id, member_id::int AS member_id, subject, status FROM tickets WHERE id = $1::bigint FOR UPDATE`, id);
  return t;
};
const notifyMember = async (memberId, template, data) => {
  const [m] = await prisma.$queryRawUnsafe(`SELECT user_id::int AS user_id FROM members WHERE id = $1::bigint`, memberId);
  if (m) sendNotification(m.user_id, template, data).catch(() => {});
};

// the lists the UI needs for its dropdowns
router.get('/options', wrap(async (_req, res) => res.json({ statuses: STATUS, priorities: PRIORITY, categories: CATEGORIES })));

// ---------- member side (distributor panel) ----------
const member = Router();
member.use(requireRole('DISTRIBUTOR'));
const myMemberId = async (req) => {
  const [m] = await prisma.$queryRawUnsafe(`SELECT id::int AS id FROM members WHERE user_id = $1::bigint`, Number(req.user.sub));
  if (!m) throw forbidden('No member profile for this login');
  return m.id;
};
member.get('/tickets', wrap(async (req, res) => {
  const { page, limit } = paging(req);
  const mid = await myMemberId(req);
  const args = [mid]; let cond = '';
  if (STATUS.includes(String(req.query.status))) { args.push(req.query.status); cond = 'AND t.status = $2'; }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT ${TICKET_COLS} FROM ${TICKET_FROM} WHERE t.member_id = $1::bigint ${cond} ORDER BY t.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, ...args);
  const [{ n }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM tickets t WHERE t.member_id = $1::bigint ${cond}`, ...args);
  res.json({ rows, total: n, page, limit });
}));
member.post('/tickets', wrap(async (req, res) => {
  const d = z.object({ subject: text(200, 'Enter a subject'), body: text(5000), category: z.enum(CATEGORIES).default('GENERAL') }).parse(req.body);
  const mid = await myMemberId(req);
  const id = await prisma.$transaction(async (tx) => {
    const [{ id: tid }] = await tx.$queryRawUnsafe(`INSERT INTO tickets (member_id, subject, category) VALUES ($1::bigint, $2, $3) RETURNING id::int AS id`, mid, d.subject, d.category);
    await addMessage(tx, tid, Number(req.user.sub), d.body);
    return tid;
  }, TX);
  res.status(201).json({ id });
}));
member.get('/tickets/:id', wrap(async (req, res) => {
  const t = await thread(parseId(req));
  if (!t || t.member_id !== (await myMemberId(req))) throw notFound('Ticket not found');
  res.json(t);
}));
member.post('/tickets/:id/reply', wrap(async (req, res) => {
  const d = msg.parse(req.body);
  const id = parseId(req);
  const mid = await myMemberId(req);
  const out = await prisma.$transaction(async (tx) => {
    const t = await lockTicket(tx, id);
    if (!t || t.member_id !== mid) throw notFound('Ticket not found');
    if (t.status === 'CLOSED') throw badRequest('This ticket is closed');
    await addMessage(tx, id, Number(req.user.sub), d.body);
    if (t.status === 'RESOLVED') await tx.$executeRawUnsafe(`UPDATE tickets SET status = 'OPEN', resolved_at = NULL, resolution = NULL WHERE id = $1::bigint`, id);
    return thread(id, tx);
  }, TX);
  res.status(201).json(out);
}));
router.use('/my', member);

// ---------- admin side ----------
const admin = Router();
admin.use(requireRole('SUPER_ADMIN', 'ADMIN'));

// staff who can be assigned a ticket
admin.get('/staff', wrap(async (_req, res) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT u.id::int AS id, u.login_id FROM users u JOIN roles r ON r.id = u.role_id
      WHERE r.code IN ('SUPER_ADMIN','ADMIN') AND u.status = 'ACTIVE' ORDER BY u.login_id`);
  res.json({ rows, total: rows.length });
}));

admin.get('/stats', wrap(async (_req, res) => {
  const [r] = await prisma.$queryRawUnsafe(
    `SELECT count(*) FILTER (WHERE status = 'OPEN')::int AS open, count(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS in_progress,
            count(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved, count(*) FILTER (WHERE status = 'CLOSED')::int AS closed,
            count(*) FILTER (WHERE status IN ('OPEN','IN_PROGRESS') AND assigned_to IS NULL)::int AS unassigned
       FROM tickets`);
  res.json(r);
}));

admin.get('/tickets', wrap(async (req, res) => {
  const { page, limit } = paging(req);
  const conds = []; const args = [];
  const push = (v) => { args.push(v); return `$${args.length}`; };
  if (STATUS.includes(String(req.query.status))) conds.push(`t.status = ${push(req.query.status)}`);
  if (PRIORITY.includes(String(req.query.priority))) conds.push(`t.priority = ${push(req.query.priority)}`);
  if (CATEGORIES.includes(String(req.query.category))) conds.push(`t.category = ${push(req.query.category)}`);
  const as = String(req.query.assigned || '');
  if (as === 'none') conds.push('t.assigned_to IS NULL');
  else if (as === 'me') conds.push(`t.assigned_to = ${push(Number(req.user.sub))}::bigint`);
  else if (as) {
    const n = Number(as);
    if (!Number.isInteger(n) || n < 1) throw badRequest('Invalid assigned filter');
    conds.push(`t.assigned_to = ${push(n)}::bigint`);
  }
  const q = String(req.query.q || '').trim();
  if (q) { const p = push(`%${q}%`); conds.push(`(t.subject ILIKE ${p} OR m.member_code ILIKE ${p} OR m.full_name ILIKE ${p})`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = await prisma.$queryRawUnsafe(
    `SELECT ${TICKET_COLS} FROM ${TICKET_FROM} ${where} ORDER BY t.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, ...args);
  const [{ n }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ${TICKET_FROM} ${where}`, ...args);
  res.json({ rows, total: n, page, limit });
}));
admin.get('/tickets/:id', wrap(async (req, res) => {
  const t = await thread(parseId(req));
  if (!t) throw notFound('Ticket not found');
  res.json(t);
}));
admin.post('/tickets/:id/reply', wrap(async (req, res) => {
  const d = msg.parse(req.body);
  const id = parseId(req);
  const { out, t } = await prisma.$transaction(async (tx) => {
    const lt = await lockTicket(tx, id);
    if (!lt) throw notFound('Ticket not found');
    if (lt.status === 'CLOSED') throw badRequest('This ticket is closed. Reopen it to reply.');
    await addMessage(tx, id, Number(req.user.sub), d.body);
    await tx.$executeRawUnsafe(`UPDATE tickets SET status = 'IN_PROGRESS' WHERE id = $1::bigint AND status = 'OPEN'`, id);
    return { out: await thread(id, tx), t: lt };
  }, TX);
  notifyMember(t.member_id, 'TICKET_REPLY', { ticket_id: t.id, subject: t.subject });
  res.status(201).json(out);
}));

const update = z.object({
  status: z.enum(STATUS), priority: z.enum(PRIORITY), category: z.enum(CATEGORIES),
  assigned_to: z.number().int().positive().nullable(), resolution: z.string().trim().max(2000).transform((v) => v || null).nullable(),
}).partial();
admin.put('/tickets/:id', wrap(async (req, res) => {
  const id = parseId(req);
  const d = update.parse(req.body);
  if (!Object.keys(d).length) throw badRequest('Nothing to update');
  let notify = false;
  const out = await prisma.$transaction(async (tx) => {
    const t = await lockTicket(tx, id);
    if (!t) throw notFound('Ticket not found');
    if (d.assigned_to) {
      const [s] = await tx.$queryRawUnsafe(
        `SELECT 1 AS ok FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1::bigint AND r.code IN ('SUPER_ADMIN','ADMIN') AND u.status = 'ACTIVE'`, d.assigned_to);
      if (!s) throw badRequest('Choose an active admin user to assign');
    }
    const sets = []; const args = [];
    const set = (col, v, cast = '') => { args.push(v); sets.push(`${col} = $${args.length}${cast}`); };
    if (d.priority) set('priority', d.priority);
    if (d.category) set('category', d.category);
    if (d.assigned_to !== undefined) set('assigned_to', d.assigned_to, '::bigint');
    if (d.status) {
      set('status', d.status);
      if (['RESOLVED', 'CLOSED'].includes(d.status)) { if (!['RESOLVED', 'CLOSED'].includes(t.status)) sets.push('resolved_at = now()'); }
      else { sets.push('resolved_at = NULL', 'resolution = NULL'); } // reopened
      notify = d.status === 'RESOLVED' && t.status !== 'RESOLVED';
    }
    if (d.resolution !== undefined && !(d.status && !['RESOLVED', 'CLOSED'].includes(d.status))) {
      if (d.resolution && !['RESOLVED', 'CLOSED'].includes(d.status || t.status)) throw badRequest('A resolution can only be recorded on a resolved or closed ticket');
      set('resolution', d.resolution);
    }
    if (sets.length) await tx.$executeRawUnsafe(`UPDATE tickets SET ${sets.join(', ')} WHERE id = $${args.length + 1}::bigint`, ...args, id);
    return { th: await thread(id, tx), t };
  }, TX);
  if (notify) notifyMember(out.t.member_id, 'TICKET_RESOLVED', { ticket_id: id, subject: out.t.subject });
  res.json(out.th);
}));
router.use('/', admin);

export default router;
