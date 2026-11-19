import { Router } from 'express';

const router = Router();

// TODO: implement announcement routes (routes -> controller -> service -> repository)
router.get('/', (_req, res) => res.json({ module: 'announcement', status: 'not implemented' }));

export default router;
