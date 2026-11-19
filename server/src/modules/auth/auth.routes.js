import { Router } from 'express';
import { z } from 'zod';
import { login } from './auth.service.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();

const loginSchema = z.object({ loginId: z.string().min(3), password: z.string().min(6) });

router.post('/login', async (req, res, next) => {
  try {
    const { loginId, password } = loginSchema.parse(req.body);
    res.json(await login(loginId, password));
  } catch (e) {
    next(e);
  }
});

router.get('/me', requireAuth, (req, res) => res.json({ id: req.user.sub, role: req.user.role }));

export default router;
