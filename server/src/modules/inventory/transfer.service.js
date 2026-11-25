// server/src/modules/inventory/transfer.service.js
import { prisma } from '../../core/prisma.js';
import { badRequest, notFound } from '../../core/errors.js';
import { TX, nextNo } from './helpers.js';

export async function getTransfer(db, tid) {
  const [t] = await db.$queryRawUnsafe(
    `SELECT t.id::int AS id, t.transfer_no, t.status, t.sent_at, t.accepted_at,
            t.from_location::int AS from_id, f.name AS from_name, t.to_location::int AS to_id, d.name AS to_name
       FROM stock_transfers t JOIN locations f ON f.id = t.from_location JOIN locations d ON d.id = t.to_location
      WHERE t.id = $1::bigint`, tid);
  if (!t) return null;
  t.items = await db.$queryRawUnsafe(
    `SELECT i.id::int AS id, i.product_id::int AS product_id, p.name AS product_name, p.sku, i.qty_sent, i.qty_accepted
       FROM stock_transfer_items i JOIN products p ON p.id = i.product_id WHERE i.transfer_id = $1::bigint ORDER BY i.id`, tid);
  return t;
}

/** Send stock: leaves the source immediately (TRANSFER_OUT). items: [{product_id, qty}] */
export async function createTransfer({ from_location, to_location, items }) {
  if (from_location === to_location) throw badRequest('From and To location must be different');
  const merged = new Map();
  items.forEach((i) => merged.set(i.product_id, (merged.get(i.product_id) || 0) + i.qty));
  const tid = await prisma.$transaction(async (tx) => {
    const locs = await tx.$queryRawUnsafe(
      `SELECT id FROM locations WHERE id IN ($1::bigint, $2::bigint) AND active = true`, from_location, to_location);
    if (locs.length !== 2) throw badRequest('Location not found');
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock($1::bigint)`, from_location);
    for (const [productId, qty] of merged) {
      const [{ q }] = await tx.$queryRawUnsafe(
        `SELECT COALESCE(SUM(qty_change),0)::int AS q FROM stock_ledger WHERE location_id = $1::bigint AND product_id = $2::bigint`,
        from_location, productId);
      if (q < qty) {
        const [p] = await tx.$queryRawUnsafe(`SELECT name FROM products WHERE id = $1::bigint`, productId);
        throw badRequest(`Only ${q} of ${p?.name || 'product'} in stock at the source location`);
      }
    }
    const transferNo = await nextNo(tx, 'transfer', 'TRF');
    const [{ id }] = await tx.$queryRawUnsafe(
      `INSERT INTO stock_transfers (transfer_no, from_location, to_location) VALUES ($1, $2::bigint, $3::bigint) RETURNING id::int AS id`,
      transferNo, from_location, to_location);
    for (const [productId, qty] of merged) {
      await tx.$executeRawUnsafe(
        `INSERT INTO stock_transfer_items (transfer_id, product_id, qty_sent) VALUES ($1::bigint, $2::bigint, $3)`, id, productId, qty);
      await tx.$executeRawUnsafe(
        `INSERT INTO stock_ledger (location_id, product_id, qty_change, txn_type, ref_type, ref_id)
         VALUES ($1::bigint, $2::bigint, $3, 'TRANSFER_OUT', 'stock_transfers', $4::bigint)`, from_location, productId, -qty, id);
    }
    return id;
  }, TX);
  return getTransfer(prisma, tid);
}

/** Accept: received qty goes to destination, shortfall back to source. onlyTo restricts to one destination (depo login). */
export async function acceptTransfer(tid, received, userId, onlyTo = null) {
  await prisma.$transaction(async (tx) => {
    const [t] = await tx.$queryRawUnsafe(
      `SELECT id::int AS id, status, from_location::int AS from_id, to_location::int AS to_id FROM stock_transfers WHERE id = $1::bigint FOR UPDATE`, tid);
    if (!t || (onlyTo && t.to_id !== onlyTo)) throw notFound('Transfer not found');
    if (t.status !== 'SENT') throw badRequest(`This transfer is already ${t.status}`);
    const items = await tx.$queryRawUnsafe(
      `SELECT id::int AS id, product_id::int AS product_id, qty_sent FROM stock_transfer_items WHERE transfer_id = $1::bigint`, tid);
    const given = new Map(received.map((i) => [i.id, i.qty_accepted]));
    for (const it of items) {
      const acc = given.get(it.id);
      if (acc === undefined) throw badRequest('Enter the received quantity for every product');
      if (acc > it.qty_sent) throw badRequest('Received quantity cannot be more than sent');
      await tx.$executeRawUnsafe(`UPDATE stock_transfer_items SET qty_accepted = $1 WHERE id = $2::bigint`, acc, it.id);
      for (const [loc, n] of [[t.to_id, acc], [t.from_id, it.qty_sent - acc]]) {
        if (n > 0) await tx.$executeRawUnsafe(
          `INSERT INTO stock_ledger (location_id, product_id, qty_change, txn_type, ref_type, ref_id)
           VALUES ($1::bigint, $2::bigint, $3, 'TRANSFER_IN', 'stock_transfers', $4::bigint)`, loc, it.product_id, n, tid);
      }
    }
    await tx.$executeRawUnsafe(
      `UPDATE stock_transfers SET status = 'ACCEPTED', accepted_at = now(), accepted_by = $1::bigint WHERE id = $2::bigint`, userId, tid);
  }, TX);
  return getTransfer(prisma, tid);
}

export async function rejectTransfer(tid, userId, onlyTo = null) {
  await prisma.$transaction(async (tx) => {
    const [t] = await tx.$queryRawUnsafe(
      `SELECT id::int AS id, status, from_location::int AS from_id, to_location::int AS to_id FROM stock_transfers WHERE id = $1::bigint FOR UPDATE`, tid);
    if (!t || (onlyTo && t.to_id !== onlyTo)) throw notFound('Transfer not found');
    if (t.status !== 'SENT') throw badRequest(`This transfer is already ${t.status}`);
    const items = await tx.$queryRawUnsafe(
      `SELECT id::int AS id, product_id::int AS product_id, qty_sent FROM stock_transfer_items WHERE transfer_id = $1::bigint`, tid);
    for (const it of items) {
      await tx.$executeRawUnsafe(`UPDATE stock_transfer_items SET qty_accepted = 0 WHERE id = $1::bigint`, it.id);
      await tx.$executeRawUnsafe(
        `INSERT INTO stock_ledger (location_id, product_id, qty_change, txn_type, ref_type, ref_id)
         VALUES ($1::bigint, $2::bigint, $3, 'TRANSFER_IN', 'stock_transfers', $4::bigint)`, t.from_id, it.product_id, it.qty_sent, tid);
    }
    await tx.$executeRawUnsafe(
      `UPDATE stock_transfers SET status = 'REJECTED', accepted_at = now(), accepted_by = $1::bigint WHERE id = $2::bigint`, userId, tid);
  }, TX);
  return getTransfer(prisma, tid);
}
