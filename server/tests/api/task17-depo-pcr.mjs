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

try {
  const [{ id: catId }] = await raw(`INSERT INTO product_categories (name) VALUES ('ZZTEST Trf Cat') RETURNING id::int AS id`);
  const mkP = async (sku) => (await raw(`INSERT INTO products (category_id, sku, name, mrp, dp_price) VALUES ($1::bigint, $2, $2, 100, 80) RETURNING id::int AS id`, catId, sku))[0].id;
  const p1 = await mkP('ZZTEST-T1'), p2 = await mkP('ZZTEST-T2');
  const mkL = async (name, active = true) => (await raw(`INSERT INTO locations (type, name, active) VALUES ('WAREHOUSE', $1, $2) RETURNING id::int AS id`, name, active))[0].id;
  const A = await mkL('ZZTEST Loc A'), Bv = await mkL('ZZTEST Loc B'), Off = await mkL('ZZTEST Loc Off', false);
  const seed = async (loc, pid, q) => exec(`INSERT INTO stock_ledger (location_id, product_id, qty_change, txn_type, ref_type) VALUES ($1::bigint, $2::bigint, $3, 'ADJUST', 'zztest')`, loc, pid, q);
  await seed(A, p1, 10); await seed(A, p2, 5);
  const bal = async (loc, pid) => (await raw(`SELECT COALESCE(SUM(qty_change),0)::int q FROM stock_ledger WHERE location_id=$1::bigint AND product_id=$2::bigint`, loc, pid))[0].q;
  const ledgerRows = async () => (await raw(`SELECT count(*)::int n FROM stock_ledger WHERE location_id IN ($1::bigint, $2::bigint)`, A, Bv))[0].n;

  // ---- authorization
  let r = await fetch(B + '/stock-transfers'); check('no token -> 401', r.status === 401);
  for (const role of ['DISTRIBUTOR', 'DEPO']) { r = await call('GET', '/stock-transfers', null, role); check(`${role} -> 403`, r[0] === 403, r); }
  r = await call('POST', '/stock-transfers', { from_location: A, to_location: Bv, items: [{ product_id: p1, qty: 1 }] }, 'DISTRIBUTOR'); check('distributor cannot create', r[0] === 403, r);

  // ---- create: validation (no ledger rows, no transfers)
  const mk = (b) => call('POST', '/stock-transfers', { from_location: A, to_location: Bv, items: [{ product_id: p1, qty: 1 }], ...b });
  const rowsBefore = await ledgerRows();
  r = await mk({ to_location: A }); check('same from/to -> 400', r[0] === 400, r);
  r = await mk({ to_location: 999999999 }); check('unknown location -> 400', r[0] === 400, r);
  r = await mk({ to_location: Off }); check('inactive destination -> 400', r[0] === 400, r);
  r = await mk({ items: [] }); check('no items -> 400', r[0] === 400, r);
  r = await mk({ items: [{ product_id: p1, qty: 0 }] }); check('qty 0 -> 400', r[0] === 400, r);
  r = await mk({ items: [{ product_id: p1, qty: 99999999999 }] }); check('huge qty -> 400', r[0] === 400, r);
  r = await mk({ items: [{ product_id: p1, qty: 11 }] }); check('more than in stock -> 400 w/ message', r[0] === 400 && /Only 10/.test(r[1].error), r);
  r = await mk({ items: [{ product_id: p1, qty: 1 }, { product_id: p2, qty: 6 }] }); check('one short line fails the whole transfer', r[0] === 400, r);
  r = await mk({ items: [{ product_id: 999999999, qty: 1 }] }); check('unknown product -> 400', r[0] === 400, r);
  r = await mk({ from_location: Bv }); check('empty source -> 400', r[0] === 400, r);
  check('rejected requests wrote nothing', (await ledgerRows()) === rowsBefore && (await raw(`SELECT count(*)::int n FROM stock_transfers WHERE from_location IN ($1::bigint,$2::bigint)`, A, Bv))[0].n === 0);

  // ---- create: ok
  r = await mk({ items: [{ product_id: p1, qty: 6 }, { product_id: p2, qty: 3 }] });
  check('create T1 (6 x p1, 3 x p2)', r[0] === 201 && r[1].status === 'SENT' && /^TRF\d+/.test(r[1].transfer_no) && r[1].items.length === 2, r);
  const t1 = r[1];
  check('source debited immediately; destination untouched', (await bal(A, p1)) === 4 && (await bal(A, p2)) === 2 && (await bal(Bv, p1)) === 0);

  r = await mk({ items: [{ product_id: p1, qty: 2 }, { product_id: p1, qty: 1 }] });
  check('same product twice is merged into one line of 3', r[0] === 201 && r[1].items.length === 1 && r[1].items[0].qty_sent === 3, r);
  const t2 = r[1];
  check('A p1 = 1 now', (await bal(A, p1)) === 1);

  // ---- concurrency on the source stock
  const race = await Promise.all([1, 2, 3].map(() => mk({ items: [{ product_id: p1, qty: 1 }] })));
  check('3 simultaneous sends of the last unit -> exactly one succeeds', race.filter((x) => x[0] === 201).length === 1 && race.filter((x) => x[0] === 400).length === 2, race);
  check('source never negative', (await bal(A, p1)) === 0);
  const t3 = race.find((x) => x[0] === 201)[1];

  // ---- read
  r = await call('GET', `/stock-transfers/${t1.id}`); check('get detail', r[0] === 200 && r[1].from_name === 'ZZTEST Loc A' && r[1].to_name === 'ZZTEST Loc B', r);
  r = await call('GET', '/stock-transfers/abc'); check('GET /abc -> 400', r[0] === 400, r);
  r = await call('GET', '/stock-transfers/999999999'); check('GET missing -> 404', r[0] === 404, r);
  r = await call('GET', `/stock-transfers?q=${t1.transfer_no}`); check('search by transfer no', r[1].total === 1 && r[1].rows[0].total_qty === 9, r);
  r = await call('GET', '/stock-transfers?q=zztest+loc&status=SENT'); check('status filter SENT (T1,T2,T3)', r[1].total === 3, r);
  r = await call('GET', '/stock-transfers?q=zztest+loc&limit=2&page=2'); check('pagination (3 rows, 2/page)', r[1].rows.length === 1 && r[1].total === 3, r);

  // ---- accept: validation
  const [i1, i2] = t1.items;
  const acc = (id, items) => call('PUT', `/stock-transfers/${id}/accept`, { items });
  r = await acc(t1.id, [{ id: i1.id, qty_accepted: 6 }]); check('missing a product line -> 400', r[0] === 400 && /every product/.test(r[1].error), r);
  r = await acc(t1.id, [{ id: i1.id, qty_accepted: 7 }, { id: i2.id, qty_accepted: 3 }]); check('more than sent -> 400', r[0] === 400 && /more than sent/.test(r[1].error), r);
  r = await acc(t1.id, [{ id: i1.id, qty_accepted: 6 }, { id: i2.id, qty_accepted: 3 }, { id: 999999999, qty_accepted: 1 }]); check('unknown item id -> 400', r[0] === 400, r);
  r = await acc(t1.id, [{ id: i1.id, qty_accepted: 6 }, { id: i1.id, qty_accepted: 6 }]); check('duplicate item id -> 400', r[0] === 400, r);
  r = await acc(t1.id, [{ id: i1.id, qty_accepted: -1 }, { id: i2.id, qty_accepted: 3 }]); check('negative qty -> 400', r[0] === 400, r);
  r = await call('PUT', '/stock-transfers/abc/accept', { items: [{ id: 1, qty_accepted: 1 }] }); check('accept /abc -> 400', r[0] === 400, r);
  r = await acc(999999999, [{ id: 1, qty_accepted: 1 }]); check('accept missing transfer -> 404', r[0] === 404, r);
  check('failed accepts changed nothing', (await bal(Bv, p1)) === 0 && (await raw(`SELECT status FROM stock_transfers WHERE id=$1::bigint`, t1.id))[0].status === 'SENT');

  // ---- accept: partial receipt
  r = await acc(t1.id, [{ id: i1.id, qty_accepted: 4 }, { id: i2.id, qty_accepted: 3 }]);
  check('partial accept (4 of 6, 3 of 3)', r[0] === 200 && r[1].status === 'ACCEPTED' && r[1].accepted_at, r);
  check('destination got 4 + 3; shortfall of 2 went back to source', (await bal(Bv, p1)) === 4 && (await bal(Bv, p2)) === 3 && (await bal(A, p1)) === 2 && (await bal(A, p2)) === 2);
  r = await acc(t1.id, [{ id: i1.id, qty_accepted: 6 }, { id: i2.id, qty_accepted: 3 }]); check('accept again -> 400 (no double credit)', r[0] === 400 && /already ACCEPTED/.test(r[1].error), r);
  r = await call('PUT', `/stock-transfers/${t1.id}/reject`); check('reject an accepted transfer -> 400', r[0] === 400, r);
  check('no double credit', (await bal(Bv, p1)) === 4);

  // ---- accept vs reject at the same moment on T2 (3 x p1 in transit)
  const it2 = t2.items[0];
  const mix = await Promise.all([acc(t2.id, [{ id: it2.id, qty_accepted: 3 }]), call('PUT', `/stock-transfers/${t2.id}/reject`)]);
  check('simultaneous accept + reject -> exactly one wins', mix.map((x) => x[0]).sort().join() === '200,400', mix);
  const st2 = (await raw(`SELECT status FROM stock_transfers WHERE id=$1::bigint`, t2.id))[0].status;
  const exp = st2 === 'ACCEPTED' ? [2 + 0, 4 + 3] : [2 + 3, 4]; // [A p1, B p1]
  check('T2 stock follows the winner exactly once', (await bal(A, p1)) === exp[0] && (await bal(Bv, p1)) === exp[1], { st2, a: await bal(A, p1), b: await bal(Bv, p1) });

  // ---- reject T3 (1 x p1)
  r = await call('PUT', `/stock-transfers/${t3.id}/reject`);
  check('reject T3 -> REJECTED, qty_accepted 0', r[0] === 200 && r[1].status === 'REJECTED' && r[1].items[0].qty_accepted === 0, r);
  r = await call('PUT', `/stock-transfers/${t3.id}/reject`); check('reject twice -> 400', r[0] === 400, r);

  // ---- nothing is in transit now, so stock must be exactly conserved
  check('conservation p1: A + B = 10', (await bal(A, p1)) + (await bal(Bv, p1)) === 10, [await bal(A, p1), await bal(Bv, p1)]);
  check('conservation p2: A + B = 5', (await bal(A, p2)) + (await bal(Bv, p2)) === 5);
  check('no transfer left in SENT', (await raw(`SELECT count(*)::int n FROM stock_transfers WHERE status='SENT' AND from_location=$1::bigint`, A))[0].n === 0);

  // ---- history shows the movements with the transfer number
  r = await call('GET', `/stock-movements?location_id=${A}&txn_type=TRANSFER_OUT&limit=100`);
  check('movements: TRANSFER_OUT rows reference TRF numbers, negative', r[1].total === 4 && r[1].rows.every((x) => /^TRF/.test(x.ref_no) && x.qty_change < 0), r);
  r = await call('GET', `/stock-movements?location_id=${Bv}&txn_type=TRANSFER_IN&limit=100`);
  check('movements: destination TRANSFER_IN rows', r[1].total >= 2 && r[1].rows.every((x) => /^TRF/.test(x.ref_no) && x.qty_change > 0), r);
} finally {
  const L = `(SELECT id FROM locations WHERE name LIKE 'ZZTEST%')`;
  await exec(`DELETE FROM stock_ledger WHERE location_id IN ${L}`);
  await exec(`DELETE FROM stock_transfers WHERE from_location IN ${L} OR to_location IN ${L}`); // items cascade
  await exec(`DELETE FROM products WHERE sku LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM product_categories WHERE name LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM locations WHERE name LIKE 'ZZTEST%'`);
  const [left] = await raw(`SELECT (SELECT count(*) FROM products WHERE sku LIKE 'ZZTEST%')::int p, (SELECT count(*) FROM locations WHERE name LIKE 'ZZTEST%')::int l, (SELECT count(*) FROM product_categories WHERE name LIKE 'ZZTEST%')::int c`);
  console.log('cleanup leftovers', left, '| failures:', fails);
  await prisma.$disconnect();
}
