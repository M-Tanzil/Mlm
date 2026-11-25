import jwt from 'jsonwebtoken';
import { config } from '../../src/core/config.js';
import { prisma } from '../../src/core/prisma.js';

const B = 'http://localhost:5059/api/inventory';
const tok = (role) => jwt.sign({ sub: '1', role }, config.jwt.accessSecret, { expiresIn: '5m' });
const call = async (m, p, body, role = 'SUPER_ADMIN') => {
  const r = await fetch(B + p, { method: m, headers: { authorization: 'Bearer ' + tok(role), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return [r.status, j];
};
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : JSON.stringify(extra).slice(0, 400)); };
const raw = (q, ...a) => prisma.$queryRawUnsafe(q, ...a);
const exec = (q, ...a) => prisma.$executeRawUnsafe(q, ...a);

let locId;
const bal = async (pid) => (await raw(`SELECT COALESCE(SUM(qty_change),0)::int q FROM stock_ledger WHERE location_id=$1::bigint AND product_id=$2::bigint`, locId, pid))[0].q;

try {
  const [{ id: catId }] = await raw(`INSERT INTO product_categories (name) VALUES ('ZZTEST Stock Cat') RETURNING id::int AS id`);
  const mkP = async (sku, active = true) => (await raw(`INSERT INTO products (category_id, sku, name, mrp, dp_price, active) VALUES ($1::bigint, $2, $2, 100, 80, $3) RETURNING id::int AS id`, catId, sku, active))[0].id;
  const p1 = await mkP('ZZTEST-S1'), p2 = await mkP('ZZTEST-S2'), p3 = await mkP('ZZTEST-S3'), pOff = await mkP('ZZTEST-SOFF', false);
  const mkS = async (name, active = true) => (await raw(`INSERT INTO suppliers (name, active) VALUES ($1, $2) RETURNING id::int AS id`, name, active))[0].id;
  const s1 = await mkS('ZZTEST Stock Sup'), sOff = await mkS('ZZTEST Stock Sup Off', false);
  locId = (await raw(`INSERT INTO locations (type, name) VALUES ('WAREHOUSE', 'ZZTEST Loc') RETURNING id::int AS id`))[0].id;

  // ---- authorization
  for (const p of ['/stock-inward', '/stock-report', '/stock-movements', '/stock-returns']) {
    const r = await fetch(B + p); check(`${p}: no token -> 401`, r.status === 401);
    const r2 = await call('GET', p, null, 'DISTRIBUTOR'); check(`${p}: distributor -> 403`, r2[0] === 403, r2);
  }

  // ---- inward validation (nothing may reach the ledger)
  const inw = (b) => call('POST', '/stock-inward', { mode: 'SUPPLIER_WISE', supplier_id: s1, location_id: locId, items: [{ product_id: p1, qty: 1 }], ...b });
  let r = await inw({ items: [{ product_id: p1, qty: 0 }] }); check('qty 0 -> 400', r[0] === 400, r);
  r = await inw({ items: [{ product_id: p1, qty: 99999999999 }] }); check('huge qty -> 400', r[0] === 400, r);
  r = await inw({ items: [{ product_id: p1, qty: 1, expiry_date: '2026-02-30' }] }); check('impossible expiry date -> 400', r[0] === 400, r);
  r = await inw({ items: [{ product_id: p1, qty: 1, expiry_date: 'tomorrow' }] }); check('non-date expiry -> 400', r[0] === 400, r);
  r = await inw({ items: [{ product_id: 999999999, qty: 1 }] }); check('unknown product -> 400', r[0] === 400 && /no longer exists/.test(r[1].error), r);
  r = await inw({ items: [{ product_id: pOff, qty: 1 }] }); check('inactive product -> 400', r[0] === 400 && /ZZTEST-SOFF/.test(r[1].error), r);
  r = await inw({ supplier_id: sOff }); check('inactive supplier -> 400', r[0] === 400 && /inactive/.test(r[1].error), r);
  r = await inw({ supplier_id: 999999999 }); check('unknown supplier -> 404', r[0] === 404, r);
  r = await inw({ location_id: 999999999 }); check('unknown location -> 400', r[0] === 400, r);
  r = await call('POST', '/stock-inward', { mode: 'PO_WISE', location_id: locId, items: [{ product_id: p1, qty: 1 }] }); check('PO mode without PO -> 400', r[0] === 400, r);
  r = await inw({ items: [] }); check('no items -> 400', r[0] === 400, r);
  check('rejected inward left the ledger empty', (await raw(`SELECT count(*)::int n FROM stock_ledger WHERE location_id=$1::bigint`, locId))[0].n === 0);

  // ---- supplier-wise inward + duplicate guard
  r = await inw({ invoice_no: 'INV-1', items: [{ product_id: p1, qty: 10, batch_no: 'B1', expiry_date: '2030-01-31' }] });
  check('supplier-wise inward 10 x p1', r[0] === 201 && /^GRN\d+/.test(r[1].inward_no), r);
  const grn1 = r[1];
  check('ledger +10 recorded', (await bal(p1)) === 10);
  const [it] = await raw(`SELECT batch_no, expiry_date::text d FROM stock_inward_items WHERE inward_id=$1::bigint`, grn1.id);
  check('batch + expiry saved', it.batch_no === 'B1' && it.d === '2030-01-31', it);
  r = await inw({ invoice_no: 'inv-1', items: [{ product_id: p1, qty: 10 }] }); check('same invoice again (any case) -> 409', r[0] === 409 && r[1].error.includes(grn1.inward_no), r);
  check('duplicate did not touch stock', (await bal(p1)) === 10);
  const race = await Promise.all([1, 2].map(() => inw({ invoice_no: 'INV-RACE', items: [{ product_id: p2, qty: 9 }] })));
  check('2 simultaneous identical receipts -> one 201, one 409', race.map((x) => x[0]).sort().join() === '201,409', race);
  check('only one receipt of p2 reached stock (9)', (await bal(p2)) === 9);
  r = await inw({ invoice_no: '', items: [{ product_id: p3, qty: 1 }] }); check('no invoice -> allowed (guard only applies with an invoice no)', r[0] === 201, r);

  // ---- PO-wise receiving
  const po = (await call('POST', '/purchase-orders', { supplier_id: s1, items: [{ product_id: p1, qty: 6, rate: 5 }, { product_id: p2, qty: 4, rate: 5 }] }))[1];
  const rcv = (poId, items) => call('POST', '/stock-inward', { mode: 'PO_WISE', po_id: poId, location_id: locId, items });
  r = await rcv(po.id, [{ product_id: p1, qty: 4 }]); check('PO receive 4 of 6 -> 201', r[0] === 201, r);
  r = await call('GET', `/purchase-orders/${po.id}`); check('PO now PARTIAL, p1 received 4', r[1].status === 'PARTIAL' && r[1].items.find((i) => i.product_id === p1).received_qty === 4, r);
  const before = await bal(p1);
  r = await rcv(po.id, [{ product_id: p1, qty: 3 }]); check('over-receive (pending 2) -> 400', r[0] === 400 && /more than/.test(r[1].error), r);
  check('over-receive changed nothing', (await bal(p1)) === before && (await raw(`SELECT received_qty r FROM purchase_order_items WHERE po_id=$1::bigint AND product_id=$2::bigint`, po.id, p1))[0].r === 4);
  r = await rcv(po.id, [{ product_id: p3, qty: 1 }]); check('product not on PO -> clear 400', r[0] === 400 && /not on this purchase order/.test(r[1].error), r);
  r = await rcv(po.id, [{ product_id: p1, qty: 2 }, { product_id: p2, qty: 4 }]); check('receive the rest -> 201', r[0] === 201, r);
  r = await call('GET', `/purchase-orders/${po.id}`); check('PO now CLOSED', r[1].status === 'CLOSED', r);
  r = await rcv(po.id, [{ product_id: p1, qty: 1 }]); check('receiving on a CLOSED PO -> 400', r[0] === 400 && /CLOSED/.test(r[1].error), r);

  const po2 = (await call('POST', '/purchase-orders', { supplier_id: s1, items: [{ product_id: p1, qty: 5, rate: 5 }] }))[1];
  const b2 = await bal(p1);
  const race2 = await Promise.all([1, 2].map(() => rcv(po2.id, [{ product_id: p1, qty: 5 }])));
  check('2 simultaneous full receipts of one PO -> one 201, one 400', race2.map((x) => x[0]).sort().join() === '201,400', race2);
  check('stock rose by 5, not 10', (await bal(p1)) === b2 + 5);
  check('PO received_qty is 5 (not 10)', (await raw(`SELECT received_qty r FROM purchase_order_items WHERE po_id=$1::bigint`, po2.id))[0].r === 5);

  // ---- returns: never below zero, even concurrently
  const retBody = (qty, product_id = p2) => ({ supplier_id: s1, location_id: locId, product_id, qty, reason: 'damaged' });
  const stockP2 = await bal(p2); // 9 + 4 = 13
  r = await call('POST', '/stock-returns', retBody(stockP2 + 1)); check('return more than stock -> 400', r[0] === 400 && /Only \d+ in stock/.test(r[1].error), r);
  r = await call('POST', '/stock-returns', { ...retBody(1), supplier_id: 999999999 }); check('return: unknown supplier -> 404', r[0] === 404, r);
  const half = Math.floor(stockP2 / 2) + 1; // two of these cannot both fit
  const race3 = await Promise.all([1, 2, 3].map(() => call('POST', '/stock-returns', retBody(half))));
  check('3 simultaneous returns that cannot all fit -> exactly one succeeds', race3.filter((x) => x[0] === 201).length === 1 && race3.filter((x) => x[0] === 400).length === 2, race3);
  check('stock is never negative', (await bal(p2)) === stockP2 - half && (await bal(p2)) >= 0);

  // ---- report
  const expected = Object.fromEntries((await raw(`SELECT product_id::int p, SUM(qty_change)::int q FROM stock_ledger WHERE location_id=$1::bigint GROUP BY product_id`, locId)).map((x) => [x.p, x.q]));
  r = await call('GET', `/stock-report?location_id=${locId}`);
  check('report qty matches ledger per product', r[0] === 200 && r[1].total === 3 && r[1].rows.every((x) => x.qty === expected[x.product_id]), r);
  const lowest = Math.min(...Object.values(expected));
  r = await call('GET', `/stock-report?location_id=${locId}&low=true&threshold=${lowest}`);
  check('low=true filters to qty <= threshold', r[0] === 200 && r[1].rows.length >= 1 && r[1].rows.every((x) => x.qty <= lowest && x.low === true), r);
  r = await call('GET', `/stock-report?location_id=${locId}&threshold=${lowest}`);
  check('low flag set per row without filter', r[1].rows.some((x) => x.low) && r[1].rows.some((x) => !x.low || r[1].rows.length === 1), r);
  r = await call('GET', `/stock-report?location_id=${locId}&limit=2&page=2`); check('report pagination (3 rows, 2/page)', r[1].total === 3 && r[1].rows.length === 1, r);
  r = await call('GET', `/stock-report?location_id=${locId}&q=zztest-s1`); check('report search by SKU', r[1].total === 1 && r[1].rows[0].sku === 'ZZTEST-S1', r);

  // ---- movements (history)
  const total = (await raw(`SELECT count(*)::int n FROM stock_ledger WHERE location_id=$1::bigint`, locId))[0].n;
  r = await call('GET', `/stock-movements?location_id=${locId}&limit=100`);
  check('movements list matches ledger row count', r[0] === 200 && r[1].total === total && r[1].rows.length === total, [total, r[1]?.total]);
  check('newest first', r[1].rows.every((x, i, a) => i === 0 || a[i - 1].id > x.id));
  const inRow = r[1].rows.find((x) => x.ref_no === grn1.inward_no);
  check('inward row shows GRN number as reference, +10', inRow && inRow.qty_change === 10 && inRow.txn_type === 'INWARD', inRow);
  check('return row shows SRT number, negative qty', r[1].rows.some((x) => x.txn_type === 'RETURN' && x.qty_change < 0 && /^SRT/.test(x.ref_no)), r[1].rows.filter((x) => x.txn_type === 'RETURN'));
  r = await call('GET', `/stock-movements?location_id=${locId}&txn_type=RETURN`); check('filter by type', r[1].total === 1 && r[1].rows[0].txn_type === 'RETURN', r);
  r = await call('GET', `/stock-movements?location_id=${locId}&q=zztest-s3`); check('filter by product search', r[1].total === 1, r);
  const today = new Date().toISOString().slice(0, 10);
  r = await call('GET', `/stock-movements?location_id=${locId}&from=${today}&to=${today}&limit=100`); check('date range (today) includes all rows', r[1].total === total, [total, r[1]]);
  r = await call('GET', `/stock-movements?location_id=${locId}&to=2000-01-01`); check('date range in the past -> none', r[1].total === 0, r);
  r = await call('GET', `/stock-movements?location_id=${locId}&limit=2&page=2`); check('movements pagination', r[1].rows.length === 2 && r[1].total === total, r);
  r = await call('GET', '/stock-movements?from=31-12-2026'); check('bad date -> 400', r[0] === 400, r);
  r = await call('GET', '/stock-movements?txn_type=inward;drop'); check('bad txn_type -> 400', r[0] === 400, r);
  r = await call('GET', '/stock-movements?location_id=abc'); check('bad location_id -> 400', r[0] === 400, r);

  // ---- inward list still works
  r = await call('GET', `/stock-inward?q=${grn1.inward_no}`); check('inward list search by GRN', r[0] === 200 && r[1].total === 1 && r[1].rows[0].total_qty === 10, r);
} finally {
  await exec(`DELETE FROM stock_ledger WHERE location_id IN (SELECT id FROM locations WHERE name LIKE 'ZZTEST%')`);
  await exec(`DELETE FROM stock_inward WHERE location_id IN (SELECT id FROM locations WHERE name LIKE 'ZZTEST%')`); // items cascade
  await exec(`DELETE FROM stock_returns WHERE location_id IN (SELECT id FROM locations WHERE name LIKE 'ZZTEST%')`);
  await exec(`DELETE FROM purchase_orders WHERE supplier_id IN (SELECT id FROM suppliers WHERE name LIKE 'ZZTEST%')`);
  await exec(`DELETE FROM products WHERE sku LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM product_categories WHERE name LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM suppliers WHERE name LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM locations WHERE name LIKE 'ZZTEST%'`);
  const [left] = await raw(`SELECT (SELECT count(*) FROM stock_ledger sl JOIN products p ON p.id = sl.product_id WHERE p.sku LIKE 'ZZTEST%')::int ledger, (SELECT count(*) FROM products WHERE sku LIKE 'ZZTEST%')::int p, (SELECT count(*) FROM suppliers WHERE name LIKE 'ZZTEST%')::int s, (SELECT count(*) FROM locations WHERE name LIKE 'ZZTEST%')::int l, (SELECT count(*) FROM product_categories WHERE name LIKE 'ZZTEST%')::int c`);
  console.log('cleanup leftovers', left, '| failures:', fails);
  await prisma.$disconnect();
}
