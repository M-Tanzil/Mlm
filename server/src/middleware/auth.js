import jwt from 'jsonwebtoken';
import { config } from '../core/config.js';
import { unauthorized, forbidden } from '../core/errors.js';

export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(unauthorized());
  try {
    req.user = jwt.verify(token, config.jwt.accessSecret); // { sub, role }
    next();
  } catch {
    next(unauthorized('Invalid or expired token'));
  }
}

/** Usage: router.get('/x', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN'), handler) */
export const requireRole =
  (...roles) =>
  (req, _res, next) =>
    roles.includes(req.user?.role) ? next() : next(forbidden());
