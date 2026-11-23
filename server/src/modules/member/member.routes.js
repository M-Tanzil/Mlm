import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { registerMember } from './member.service.js';

const router = Router();

const registerSchema = z.object({
  fullName: z.string().min(2),
  mobile: z.string().min(10).max(15).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6),
  sponsorCode: z.string().optional(), // admin only; distributors sponsor themselves
  parentCode: z.string().optional(), // optional manual placement
  position: z.enum(['L', 'R']).optional(),
  packageId: z.coerce.number().int().positive().optional(),
});

router.post(
  '/',
  requireAuth,
  requireRole('SUPER_ADMIN', 'ADMIN', 'DISTRIBUTOR'),
  async (req, res, next) => {
    try {
      const data = registerSchema.parse(req.body);
      res.status(201).json(await registerMember(req.user, data));
    } catch (e) {
      next(e);
    }
  }
);

export default router;