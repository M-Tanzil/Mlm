import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { getBinaryTree, getGenerationLevels } from './network.service.js';

const router = Router();
const allowed = requireRole('SUPER_ADMIN', 'ADMIN', 'DISTRIBUTOR');

const binaryQuery = z.object({ depth: z.coerce.number().int().min(1).max(10).default(3) });
const levelQuery = z.object({ levels: z.coerce.number().int().min(1).max(15).default(5) });

// code is optional: distributors default to themselves, admins to the top of the tree
router.get('/binary/:code?', requireAuth, allowed, async (req, res, next) => {
  try {
    const { depth } = binaryQuery.parse(req.query);
    res.json(await getBinaryTree(req.user, req.params.code, depth));
  } catch (e) {
    next(e);
  }
});

router.get('/generation/:code?', requireAuth, allowed, async (req, res, next) => {
  try {
    const { levels } = levelQuery.parse(req.query);
    res.json(await getGenerationLevels(req.user, req.params.code, levels));
  } catch (e) {
    next(e);
  }
});

export default router;