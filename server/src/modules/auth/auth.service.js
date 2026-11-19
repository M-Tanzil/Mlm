import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { config } from '../../core/config.js';
import { prisma } from '../../core/prisma.js';
import { unauthorized } from '../../core/errors.js';

export async function login(loginId, password) {
  // raw query so this works regardless of the model names produced by `prisma db pull`
  const rows = await prisma.$queryRaw`
    SELECT u.id::text AS id, u.password_hash, u.status, r.code AS role
      FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.login_id = ${loginId}`;
  const user = rows[0];
  if (!user || user.status !== 'ACTIVE') throw unauthorized('Invalid credentials');
  if (!(await bcrypt.compare(password, user.password_hash))) throw unauthorized('Invalid credentials');

  await prisma.$executeRaw`UPDATE users SET last_login_at = now() WHERE id = ${BigInt(user.id)}`;

  const payload = { sub: user.id, role: user.role };
  return {
    accessToken: jwt.sign(payload, config.jwt.accessSecret, { expiresIn: config.jwt.accessTtl }),
    refreshToken: jwt.sign(payload, config.jwt.refreshSecret, { expiresIn: config.jwt.refreshTtl }),
    role: user.role,
  };
}
