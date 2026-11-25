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
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : JSON.stringify(extra).slice(0, 350)); };
const raw = (q, ...a) => prisma.$queryRawUnsafe(q, ...a);
const exec = (q, ...a) => prisma.$executeRawUnsafe(q, ...a);

try {
  // fixtures (prefixed ZZTEST, removed at the end)
  const [{ id: catId }] = await raw(`INSERT INTO product_categories (name) VALUES ('ZZTEST PO Cat') RETURNING id::int AS id`);
  const mkP = async (sku, active = true) => (await raw(`INSERT INTO products (category_id, sku, name, mrp, dp_price, active) VALUES ($1::bigint, $2, $2, 100, 80, $3) RETURNING id::int AS id`, catId, sku, active))[0].id;
  const p1 = await mkP('ZZTEST-PO-1'), p2 = await mkP('ZZTEST-PO-2'), pOff = await mkP('ZZTEST-PO-OFF', false);
  const mkS = async (name, active = true) => (await raw(`INSERT INTO suppliers (name, active) VALUES ($1, $2) RETURNING id::int AS id`, name, active))[0].id;
  const s1 = await mkS('ZZTEST PO Sup'), sOff = await mkS('ZZTEST PO Sup Off', false);

  let r = await fetch(B + '/purchase-orders'); check('no token -> 401', r.status === 401);
  r = await call('GET', '/purchase-orders', null, 'DISTRIBUTOR'); check('distributor -> 403', r[0] === 403, r);
  r = await call('POST', '/purchase-orders', { supplier_id: s1, items: [{ product_id: p1, qty: 1, rate: 1 }] }, 'DEPO'); check('depo -> 403 on create', r[0] === 403, r);

  const item = (product_id, qty = 5, rate = 10) => ({ product_id, qty, rate });
  const post = (b) => call('POST', '/purchase-orders', b);
  r = await post({ supplier_id: s1, items: [] }); check('no items -> 400', r[0] === 400, r);
  r = await post({ items: [item(p1)] }); check('no supplier -> 400', r[0] === 400, r);
  r = await post({ supplier_id: s1, items: [item(p1), item(p1)] }); check('duplicate product -> 400 w/ message', r[0] === 400 && /only once/.test(JSON.stringify(r[1].details)), r);
  r = await post({ supplier_id: s1, items: [item(p1, 0)] }); check('qty 0 -> 400', r[0] === 400, r);
  r = await post({ supplier_id: s1, items: [item(p1, 1.5)] }); check('fractional qty -> 400', r[0] === 400, r);
  r = await post({ supplier_id: s1, items: [item(p1, 99999999999)] }); check('huge qty -> 400 (not 500)', r[0] === 400, r);
  r = await post({ supplier_id: s1, items: [item(p1, 1, -5)] }); check('negative rate -> 400', r[0] === 400, r);
  r = await post({ supplier_id: s1, items: [item(p1, 1, 0.333)] }); check('3-decimal rate -> 400', r[0] === 400, r);
  r = await post({ supplier_id: 999999999, items: [item(p1)] }); check('unknown supplier -> 404', r[0] === 404, r);
  r = await post({ supplier_id: sOff, items: [item(p1)] }); check('inactive supplier -> 400', r[0] === 400 && /inactive/.test(r[1].error), r);
  r = await post({ supplier_id: s1, items: [item(pOff)] }); check('inactive product -> 400', r[0] === 400 && /ZZTEST-PO-OFF/.test(r[1].error), r);
  r = await post({ supplier_id: s1, items: [item(999999999)] }); check('unknown product -> 400', r[0] === 400 && /no longer exists/.test(r[1].error), r);
  const [{ n: before }] = await raw(`SELECT count(*)::int n FROM purchase_orders WHERE supplier_id = $1::bigint`, s1);
  check('rejected requests created no PO', before === 0, before);

  // valid create; client-sent total must be ignored
  r = await post({ supplier_id: s1, total: 1, items: [item(p1, 3, 12.5), item(p2, 2, 100.25)] });
  check('create PO: server total = 3*12.5 + 2*100.25 = 238', r[0] === 201 && r[1].total === 238 && r[1].status === 'OPEN' && /^PO\d{5,}$/.test(r[1].po_no) && r[1].items.length === 2 && r[1].items[0].received_qty === 0, r);
  const po1 = r[1];

  // parallel creates: unique numbers, none lost
  const par = await Promise.all([1, 2, 3].map(() => post({ supplier_id: s1, items: [item(p1, 1, 1)] })));
  const nos = par.map((x) => x[1]?.po_no);
  check('3 parallel creates -> 3 distinct PO numbers', par.every((x) => x[0] === 201) && new Set(nos).size === 3, par);

  // read
  r = await call('GET', `/purchase-orders/${po1.id}`); check('get detail', r[0] === 200 && r[1].supplier_name === 'ZZTEST PO Sup' && r[1].items[1].rate === 100.25, r);
  r = await call('GET', '/purchase-orders/abc'); check('GET /abc -> 400 (not 500)', r[0] === 400, r);
  r = await call('GET', '/purchase-orders/999999999'); check('GET missing -> 404', r[0] === 404, r);
  r = await call('GET', `/purchase-orders?q=${po1.po_no}`); check('search by PO no', r[0] === 200 && r[1].total === 1 && r[1].rows[0].ordered_qty === 5 && r[1].rows[0].received_qty === 0, r);
  r = await call('GET', '/purchase-orders?q=zztest+po+sup&limit=2&page=2'); check('pagination (4 POs, 2/page -> page 2 has 2)', r[0] === 200 && r[1].total === 4 && r[1].rows.length === 2, r);
  r = await call('GET', '/purchase-orders?q=zztest+po+sup&status=PARTIAL,CLOSED'); check('status filter (none yet)', r[0] === 200 && r[1].total === 0, r);

  // cancel
  r = await call('PUT', '/purchase-orders/abc/cancel'); check('cancel /abc -> 400', r[0] === 400, r);
  r = await call('PUT', '/purchase-orders/999999999/cancel'); check('cancel missing -> 404', r[0] === 404, r);
  const race = await Promise.all([call('PUT', `/purchase-orders/${po1.id}/cancel`), call('PUT', `/purchase-orders/${po1.id}/cancel`)]);
  check('2 simultaneous cancels -> exactly one wins', race.map((x) => x[0]).sort().join() === '200,400', race);
  r = await call('GET', `/purchase-orders/${po1.id}`); check('PO is CANCELLED', r[1].status === 'CANCELLED', r);
  r = await call('GET', '/purchase-orders?q=zztest+po+sup&status=CANCELLED'); check('status filter CANCELLED', r[1].total === 1, r);

  // a PO with goods received can no longer be cancelled
  const poR = par[0][1];
  await exec(`UPDATE purchase_order_items SET received_qty = 1 WHERE po_id = $1::bigint`, poR.id);
  await exec(`UPDATE purchase_orders SET status = 'CLOSED' WHERE id = $1::bigint`, poR.id);
  r = await call('PUT', `/purchase-orders/${poR.id}/cancel`); check('cannot cancel a received PO', r[0] === 400 && /OPEN/.test(r[1].error), r);
} finally {
  await exec(`DELETE FROM purchase_orders WHERE supplier_id IN (SELECT id FROM suppliers WHERE name LIKE 'ZZTEST%')`); // items cascade
  await exec(`DELETE FROM products WHERE sku LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM product_categories WHERE name LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM suppliers WHERE name LIKE 'ZZTEST%'`);
  const [left] = await raw(`SELECT (SELECT count(*) FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE s.name LIKE 'ZZTEST%')::int po, (SELECT count(*) FROM products WHERE sku LIKE 'ZZTEST%')::int p, (SELECT count(*) FROM suppliers WHERE name LIKE 'ZZTEST%')::int s, (SELECT count(*) FROM product_categories WHERE name LIKE 'ZZTEST%')::int c`);
  console.log('cleanup leftovers', left, '| failures:', fails);
  await prisma.$disconnect();
}
