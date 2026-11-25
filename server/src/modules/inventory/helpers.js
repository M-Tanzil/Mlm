// server/src/modules/inventory/helpers.js
import { badRequest } from '../../core/errors.js';

export const TX = { maxWait: 10000, timeout: 30000 }; // Prisma transaction limits

function mapDbError(e) {
  const m = String(e?.message || '');
  if (/duplicate key|23505/i.test(m)) return badRequest('That value already exists');
  if (/foreign key|23503/i.test(m)) return badRequest('This record is linked to other data');
  return e;
}
export const wrap = (fn) => (req, res, next) => fn(req, res).catch((e) => next(mapDbError(e)));

/** Next human-readable number, e.g. PO00001. Run inside a transaction. */
export async function nextNo(tx, name, prefix) {
  const [r] = await tx.$queryRawUnsafe(
    `INSERT INTO sequences (name, prefix, next_value) VALUES ($1, $2, 2)
     ON CONFLICT (name) DO UPDATE SET next_value = sequences.next_value + 1
     RETURNING prefix, (next_value - 1)::int AS n`, name, prefix);
  return `${r.prefix}${String(r.n).padStart(5, '0')}`;
}
