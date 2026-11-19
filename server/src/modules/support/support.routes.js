import { Router } from 'express';

const router = Router();

// TODO: implement support routes (routes -> controller -> service -> repository)
router.get('/', (_req, res) => res.json({ module: 'support', status: 'not implemented' }));

export default router;
