import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { getAdminSummary, getDistributorSummary } from './dashboard.service.js';
import { notFound } from '../../core/errors.js';

const router = Router();

router.get('/admin', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN'), async (_req, res, next) => {
  try {
    res.json(await getAdminSummary());
  } catch (e) {
    next(e);
  }
});

router.get('/distributor', requireAuth, requireRole('DISTRIBUTOR'), async (req, res, next) => {
  try {
    const data = await getDistributorSummary(req.user.sub);
    if (!data) throw notFound('No member profile for this user');
    res.json(data);
  } catch (e) {
    next(e);
  }
});

export default router;