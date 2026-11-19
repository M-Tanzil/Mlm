import { Router } from 'express';

const router = Router();

// TODO: implement depo routes (routes -> controller -> service -> repository)
router.get('/', (_req, res) => res.json({ module: 'depo', status: 'not implemented' }));

export default router;
