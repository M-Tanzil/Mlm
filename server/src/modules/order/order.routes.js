import { Router } from 'express';

const router = Router();

// TODO: implement order routes (routes -> controller -> service -> repository)
router.get('/', (_req, res) => res.json({ module: 'order', status: 'not implemented' }));

export default router;
