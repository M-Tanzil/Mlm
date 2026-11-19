import { Router } from 'express';

const router = Router();

// TODO: implement package routes (routes -> controller -> service -> repository)
router.get('/', (_req, res) => res.json({ module: 'package', status: 'not implemented' }));

export default router;
