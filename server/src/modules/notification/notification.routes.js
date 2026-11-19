import { Router } from 'express';

const router = Router();

// TODO: implement notification routes (routes -> controller -> service -> repository)
router.get('/', (_req, res) => res.json({ module: 'notification', status: 'not implemented' }));

export default router;
