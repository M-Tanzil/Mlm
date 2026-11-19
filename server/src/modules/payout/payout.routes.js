import { Router } from 'express';

const router = Router();

// TODO: implement payout routes (routes -> controller -> service -> repository)
router.get('/', (_req, res) => res.json({ module: 'payout', status: 'not implemented' }));

export default router;
