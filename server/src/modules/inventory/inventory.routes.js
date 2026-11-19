import { Router } from 'express';

const router = Router();

// TODO: implement inventory routes (routes -> controller -> service -> repository)
router.get('/', (_req, res) => res.json({ module: 'inventory', status: 'not implemented' }));

export default router;
