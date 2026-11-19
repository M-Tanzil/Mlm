import { Router } from 'express';

const router = Router();

// TODO: implement commission routes (routes -> controller -> service -> repository)
router.get('/', (_req, res) => res.json({ module: 'commission', status: 'not implemented' }));

export default router;
