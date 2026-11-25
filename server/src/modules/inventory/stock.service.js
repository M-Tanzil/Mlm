// server/src/modules/inventory/stock.service.js
// Shared stock helpers. Hand-off to Tanzil: deductStock(locationId, items).
import { prisma } from '../../core/prisma.js';
import { badRequest } from '../../core/errors.js';

/** Current quantity of one product at a location. */
export async function stockOf(db, locationId, productId) {
  const [{ q }] = await db.$queryRawUnsafe(
    `SELECT COALESCE(SUM(qty_change),0)::int AS q FROM stock_ledger WHERE location_id = $1::bigint AND product_id = $2::bigint`,
    locationId, productId);
  return q;
}

/** Throws if any item is short. items: [{product_id, qty}] */
export async function assertStock(db, locationId, items) {
  for (const it of items) {
    const q = await stockOf(db, locationId, it.product_id);
    if (q < it.qty) {
      const [p] = await db.$queryRawUnsafe(`SELECT name FROM products WHERE id = $1::bigint`, it.product_id);
      throw badRequest(`Only ${q} of ${p?.name || 'a product'} in stock at this location`);
    }
  }
}

/** Remove stock (SALE, JOINING_DISPATCH ...). Pass a transaction client, or nothing to use its own transaction. */
export async function deductStock(locationId, items, { txnType = 'SALE', refType = null, refId = null, tx = null } = {}) {
  const run = async (db) => {
    await db.$executeRawUnsafe(`SELECT pg_advisory_xact_lock($1::bigint)`, locationId);
    await assertStock(db, locationId, items);
    for (const it of items) {
      await db.$executeRawUnsafe(
        `INSERT INTO stock_ledger (location_id, product_id, qty_change, txn_type, ref_type, ref_id)
         VALUES ($1::bigint, $2::bigint, $3, $4, $5, $6::bigint)`, locationId, it.product_id, -it.qty, txnType, refType, refId);
    }
  };
  return tx ? run(tx) : prisma.$transaction(run, { maxWait: 10000, timeout: 30000 });
}

/** Put stock back (order cancelled, package returned). */
export async function addStock(tx, locationId, items, txnType, refType, refId) {
  for (const it of items) {
    await tx.$executeRawUnsafe(
      `INSERT INTO stock_ledger (location_id, product_id, qty_change, txn_type, ref_type, ref_id)
       VALUES ($1::bigint, $2::bigint, $3, $4, $5, $6::bigint)`, locationId, it.product_id, it.qty, txnType, refType, refId);
  }
}
