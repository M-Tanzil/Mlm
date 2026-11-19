import { Router } from 'express';

const router = Router();

// TODO: implement network routes (routes -> controller -> service -> repository)
router.get('/', (_req, res) => res.json({ module: 'network', status: 'not implemented' }));

export default router;
