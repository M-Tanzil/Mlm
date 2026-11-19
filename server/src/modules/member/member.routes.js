import { Router } from 'express';

const router = Router();

// TODO: implement member routes (routes -> controller -> service -> repository)
router.get('/', (_req, res) => res.json({ module: 'member', status: 'not implemented' }));

export default router;
