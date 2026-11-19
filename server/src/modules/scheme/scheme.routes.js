import { Router } from 'express';

const router = Router();

// TODO: implement scheme routes (routes -> controller -> service -> repository)
router.get('/', (_req, res) => res.json({ module: 'scheme', status: 'not implemented' }));

export default router;
