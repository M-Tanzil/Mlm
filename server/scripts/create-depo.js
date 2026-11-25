// Usage: node scripts/create-depo.js "<Location name>" <DEPO|FRANCHISE> <login_id> <password> [city]
// Creates the login (users) and the location it owns, so the depo panel works.
import bcrypt from 'bcrypt';
import { prisma } from '../src/core/prisma.js';

const [name, type, loginId, password, city] = process.argv.slice(2);
if (!name || !['DEPO', 'FRANCHISE'].includes(type) || !loginId || !password) {
  console.log('Usage: node scripts/create-depo.js "<Location name>" <DEPO|FRANCHISE> <login_id> <password> [city]');
  process.exit(1);
}
const hash = await bcrypt.hash(password, 10);
const [u] = await prisma.$queryRawUnsafe(
  `INSERT INTO users (role_id, login_id, password_hash) SELECT id, $2, $3 FROM roles WHERE code = $1 RETURNING id::int AS id`, type, loginId, hash);
await prisma.$executeRawUnsafe(
  `INSERT INTO locations (type, name, city, owner_user_id) VALUES ($1, $2, $3, $4::bigint)`, type, name, city || null, u.id);
console.log(`Created ${type} "${name}" with login "${loginId}"`);
await prisma.$disconnect();
