import { Router } from 'express';

const router = Router();

// TODO: implement epin routes (routes -> controller -> service -> repository)
router.get('/', (_req, res) => res.json({ module: 'epin', status: 'not implemented' }));

export default router;
