import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../core/prisma.js';
import { requireAuth } from '../../middleware/auth.js';
import { wrap } from '../inventory/helpers.js';
import { makeCrud } from '../inventory/crud.js';

const router = Router();

// any logged-in user (distributor panel): published news, events, achievers, gallery
router.get('/published', requireAuth, wrap(async (req, res) => {
  const type = String(req.query.type || '');
  const where = ['NEWS', 'EVENT', 'ACHIEVER', 'GALLERY'].includes(type) ? `AND type = '${type}'` : '';
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id::int AS id, type, title, body, media_url, to_char(event_date, 'YYYY-MM-DD') AS event_date, created_at
       FROM announcements WHERE published = true ${where} ORDER BY created_at DESC LIMIT 100`);
  res.json({ rows, total: rows.length });
}));

const opt = z.string().trim().transform((v) => (v === '' ? null : v)).nullish();
const date = z.string().trim().transform((v) => (v === '' ? null : v)).nullish().refine((v) => v == null || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use a valid date');
// admin CRUD ("active" in the API means "published")
router.use('/', makeCrud({
  table: 'announcements',
  from: 'announcements t',
  columns: `t.id::int AS id, t.type, t.title, t.body, t.media_url, to_char(t.event_date, 'YYYY-MM-DD') AS event_date, t.published AS active, t.created_at`,
  searchCols: ['t.title', 't.type'],
  aliases: { active: 'published' },
  schema: z.object({
    type: z.enum(['NEWS', 'EVENT', 'ACHIEVER', 'GALLERY']),
    title: z.string().trim().min(1), body: opt, media_url: opt, event_date: date, active: z.boolean().optional(),
  }),
}));

export default router;
