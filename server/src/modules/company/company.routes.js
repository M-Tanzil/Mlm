import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { prisma } from '../../core/prisma.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { badRequest } from '../../core/errors.js';

export const uploadsDir = path.resolve('uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, cb) => cb(null, `logo-${crypto.randomUUID()}${ALLOWED[file.mimetype]}`),
  }),
  limits: { fileSize: 1024 * 1024 }, // 1 MB
  fileFilter: (_req, file, cb) =>
    ALLOWED[file.mimetype] ? cb(null, true) : cb(badRequest('Logo must be a PNG, JPG or WebP image')),
});

const router = Router();

// Any logged-in user: company name and logo (shown in every panel's sidebar)
router.get('/', requireAuth, async (_req, res, next) => {
  try {
    const rows = await prisma.$queryRaw`SELECT name, logo_url FROM company_info ORDER BY id LIMIT 1`;
    res.json(rows[0] || { name: 'Company', logo_url: null });
  } catch (e) {
    next(e);
  }
});

// Super Admin only: change the logo
router.put('/logo', requireAuth, requireRole('SUPER_ADMIN'), upload.single('logo'), async (req, res, next) => {
  try {
    if (!req.file) throw badRequest('Choose an image file (field name: logo)');
    const url = `/uploads/${req.file.filename}`;

    const existing = await prisma.$queryRaw`SELECT id, logo_url FROM company_info ORDER BY id LIMIT 1`;
    if (existing[0]) {
      await prisma.$executeRaw`UPDATE company_info SET logo_url = ${url} WHERE id = ${existing[0].id}`;
      // remove the old file, if it was one of ours
      const old = existing[0].logo_url;
      if (old?.startsWith('/uploads/')) fs.promises.unlink(path.join(uploadsDir, path.basename(old))).catch(() => {});
    } else {
      await prisma.$executeRaw`INSERT INTO company_info (name, logo_url) VALUES ('Company', ${url})`;
    }
    res.json({ logo_url: url });
  } catch (e) {
    next(e);
  }
});

export default router;
