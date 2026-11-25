// server/src/modules/inventory/productImage.routes.js
// PUT /api/inventory/products/:id/image   (multipart, field name: image)
import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { prisma } from '../../core/prisma.js';
import { badRequest, notFound } from '../../core/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';

const uploadsDir = path.resolve('uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
const ALLOWED = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, cb) => cb(null, `product-${crypto.randomUUID()}${ALLOWED[file.mimetype]}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req, file, cb) =>
    ALLOWED[file.mimetype] ? cb(null, true) : cb(badRequest('Product image must be a PNG, JPG or WebP file')),
});

const router = Router();
router.use(requireAuth, requireRole('SUPER_ADMIN', 'ADMIN'));

const removeFile = (url) => url?.startsWith('/uploads/') && fs.promises.unlink(path.join(uploadsDir, path.basename(url))).catch(() => {});

router.put('/:id/image', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) throw badRequest('Choose an image file');
    const id = Number(req.params.id);
    const [old] = await prisma.$queryRawUnsafe(`SELECT image_url FROM products WHERE id = $1::bigint`, id);
    if (!old) { removeFile(`/uploads/${req.file.filename}`); throw notFound('Product not found'); }
    const url = `/uploads/${req.file.filename}`;
    await prisma.$executeRawUnsafe(`UPDATE products SET image_url = $1 WHERE id = $2::bigint`, url, id);
    removeFile(old.image_url);
    res.json({ image_url: url });
  } catch (e) {
    if (e?.code === 'LIMIT_FILE_SIZE') return next(badRequest('Image is too large (max 2 MB)'));
    next(e);
  }
});

router.delete('/:id/image', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [old] = await prisma.$queryRawUnsafe(`SELECT image_url FROM products WHERE id = $1::bigint`, id);
    if (!old) throw notFound('Product not found');
    await prisma.$executeRawUnsafe(`UPDATE products SET image_url = NULL WHERE id = $1::bigint`, id);
    removeFile(old.image_url);
    res.json({ image_url: null });
  } catch (e) { next(e); }
});

export default router;
