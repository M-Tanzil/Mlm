import { Router } from 'express';

const router = Router();

// TODO: implement kyc routes (routes -> controller -> service -> repository)
router.get('/', (_req, res) => res.json({ module: 'kyc', status: 'not implemented' }));

export default router;
