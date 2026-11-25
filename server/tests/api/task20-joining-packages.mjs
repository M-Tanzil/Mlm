import jwt from 'jsonwebtoken';
import { config } from '../../src/core/config.js';
import { prisma } from '../../src/core/prisma.js';

const API = 'http://localhost:5059/api/orders';
const tok = (role, sub = '1') => jwt.sign({ sub, role }, config.jwt.accessSecret, { expiresIn: '60m' });
const SA = tok('SUPER_ADMIN');
const call = async (m, p, body, token = SA) => {
  const r = await fetch(API + p, { method: m, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return [r.status, j];
};
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : JSON.stringify(extra).slice(0, 450)); };
const raw = (q, ...a) => prisma.$queryRawUnsafe(q, ...a);
const exec = (q, ...a) => prisma.$executeRawUnsafe(q, ...a);

try {
  const [{ id: cat }] = await raw(`INSERT INTO product_categories (name) VALUES ('ZZTEST Pkg Cat') RETURNING id::int AS id`);
  const mkP = async (sku) => (await raw(`INSERT INTO products (category_id, sku, name, mrp, dp_price, bv, gst_percent, active) VALUES ($1::bigint, $2, $2, 10, 10, 0, 0, true) RETURNING id::int AS id`, cat, sku))[0].id;
  const p1 = await mkP('ZZTEST-K1'), p2 = await mkP('ZZTEST-K2');
  const [{ id: pk }] = await raw(`INSERT INTO packages (name, price, bv) VALUES ('ZZTEST Package', 1000, 10) RETURNING id::int AS id`);
  const [{ id: pkEmpty }] = await raw(`INSERT INTO packages (name, price, bv) VALUES ('ZZTEST Empty Package', 1, 0) RETURNING id::int AS id`);
  await exec(`INSERT INTO package_items (package_id, product_id, qty) VALUES ($1::bigint,$2::bigint,2),($1::bigint,$3::bigint,1)`, pk, p1, p2);
  const mkMem = async (code, n) => {
    const [u] = await raw(`INSERT INTO users (role_id, login_id, password_hash) SELECT id, $1, 'x' FROM roles WHERE code = 'DISTRIBUTOR' RETURNING id::int AS id`, `zztest_k${n}`);
    return (await raw(`INSERT INTO members (member_code, user_id, path, depth, full_name) VALUES ($1, $2::bigint, $3::ltree, 0, $1) RETURNING id::int AS id`, code, u.id, `zk${n}`))[0].id;
  };
  await mkMem('ZZTEST-K1', 1); await mkMem('ZZTEST-K2', 2); await mkMem('ZZTEST-K3', 3);
  const mkLoc = async (name, active) => (await raw(`INSERT INTO locations (type, name, active) VALUES ('DEPO', $1, $2) RETURNING id::int AS id`, name, active))[0].id;
  const L = await mkLoc('ZZTEST Pkg Depo', true), LOff = await mkLoc('ZZTEST Pkg Depo Off', false);
  const bal = async (pid) => (await raw(`SELECT COALESCE(SUM(qty_change),0)::int q FROM stock_ledger WHERE location_id=$1::bigint AND product_id=$2::bigint`, L, pid))[0].q;
  const seed = (pid, q) => exec(`INSERT INTO stock_ledger (location_id, product_id, qty_change, txn_type, ref_type) VALUES ($1::bigint,$2::bigint,$3,'ADJUST','zztest')`, L, pid, q);
  await seed(p1, 5); await seed(p2, 1);
  const [{ id: C1 }] = await raw(`INSERT INTO couriers (name, active) VALUES ('ZZTEST PkgCourier', true) RETURNING id::int AS id`);
  const [{ id: C2 }] = await raw(`INSERT INTO couriers (name, active) VALUES ('ZZTEST PkgCourier Off', false) RETURNING id::int AS id`);

  // auth
  let r = await fetch(API + '/joining-deliveries'); check('no token -> 401', r.status === 401);
  r = await call('GET', '/joining-deliveries', null, tok('DISTRIBUTOR')); check('distributor -> 403', r[0] === 403, r);
  r = await call('GET', '/joining-deliveries', null, tok('DEPO')); check('depo -> 403', r[0] === 403, r);

  // create (manual) + idempotency
  r = await call('POST', '/joining-deliveries', { member_code: 'NOPE', package_id: pk }); check('unknown member -> 400', r[0] === 400, r);
  r = await call('POST', '/joining-deliveries', { member_code: 'ZZTEST-K1', package_id: 999999999 }); check('unknown package -> 400', r[0] === 400, r);
  r = await call('POST', '/joining-deliveries', { member_code: 'ZZTEST-K1', package_id: pk }); const d1 = r[1]; check('queue a delivery', r[0] === 201 && d1.id, r);
  r = await call('POST', '/joining-deliveries', { member_code: 'ZZTEST-K1', package_id: pk }); check('same member+package again -> 400 (no duplicate)', r[0] === 400, r);
  const { createJoiningDelivery } = await import('../../src/modules/order/joining.routes.js');
  const [x, y] = await Promise.all([1, 2].map(async () => createJoiningDelivery({ member_id: (await raw(`SELECT id::int AS id FROM members WHERE member_code='ZZTEST-K2'`))[0].id, package_id: pk })));
  check('two simultaneous MEMBER_JOINED-style calls -> one row', (await raw(`SELECT count(*)::int n FROM joining_package_deliveries d JOIN members m ON m.id=d.member_id WHERE m.member_code='ZZTEST-K2'`))[0].n === 1 && (!!x.existing !== !!y.existing), { x, y });
  const d2 = (await raw(`SELECT d.id::int AS id FROM joining_package_deliveries d JOIN members m ON m.id=d.member_id WHERE m.member_code='ZZTEST-K2'`))[0];

  // read
  r = await call('GET', '/joining-deliveries?q=zztest-k1'); check('search by member + pagination shape', r[0] === 200 && r[1].total === 1 && r[1].limit === 20 && r[1].rows[0].return_status === null, r);
  r = await call('GET', '/joining-deliveries?status=PENDING&limit=-3'); check('status filter, bad limit tolerated', r[0] === 200 && r[1].total >= 2 && r[1].limit === 1, r);
  r = await call('GET', `/joining-deliveries/${d1.id}`); check('detail has package items', r[0] === 200 && r[1].items.length === 2 && r[1].package_name === 'ZZTEST Package', r);
  r = await call('GET', '/joining-deliveries/abc'); check('/abc -> 400', r[0] === 400, r);
  r = await call('GET', '/joining-deliveries/999999999'); check('missing -> 404', r[0] === 404, r);

  // premature actions
  r = await call('PUT', `/joining-deliveries/${d1.id}/deliver`); check('deliver before dispatch -> 400', r[0] === 400, r);
  r = await call('POST', '/package-returns', { delivery_id: d1.id }); check('return before dispatch -> 400', r[0] === 400, r);

  // dispatch validation
  const disp = (id, b) => call('PUT', `/joining-deliveries/${id}/dispatch`, b);
  r = await disp(d1.id, {}); check('no location -> 400', r[0] === 400, r);
  r = await disp(d1.id, { location_id: LOff }); check('inactive location -> 400', r[0] === 400, r);
  r = await disp(d1.id, { location_id: 999999999 }); check('unknown location -> 400', r[0] === 400, r);
  r = await disp(d1.id, { location_id: L, courier_id: C2 }); check('inactive courier -> 400', r[0] === 400, r);
  r = await disp(d1.id, { location_id: L, courier_id: 999999999 }); check('unknown courier -> 400', r[0] === 400, r);
  r = await disp(d1.id, { location_id: L, tracking_no: 'x'.repeat(101) }); check('tracking > 100 -> 400', r[0] === 400, r);
  check('failed dispatches took no stock', (await bal(p1)) === 5 && (await bal(p2)) === 1);

  // stock shortage: d2 first takes the only p2, so d1 then fails and rolls back fully
  const race = await Promise.all([disp(d1.id, { location_id: L }), disp(d2.id, { location_id: L })]);
  check('two deliveries racing for the last unit of p2: one wins, one gets 400', race.filter((z) => z[0] === 200).length === 1 && race.filter((z) => z[0] === 400).length === 1, race);
  const winner = race[0][0] === 200 ? d1.id : d2.id, loser = winner === d1.id ? d2.id : d1.id;
  check('stock deducted once: p1 5->3, p2 1->0, never negative', (await bal(p1)) === 3 && (await bal(p2)) === 0);
  check('loser stays PENDING (rolled back)', (await raw(`SELECT status FROM joining_package_deliveries WHERE id=$1::bigint`, loser))[0].status === 'PENDING');
  r = await disp(winner, { location_id: L }); check('dispatch again -> 400', r[0] === 400, r);
  // empty package
  const [{ id: dEmpty }] = await raw(`INSERT INTO joining_package_deliveries (member_id, package_id) SELECT id, $1::bigint FROM members WHERE member_code='ZZTEST-K3' RETURNING id::int AS id`, pkEmpty);
  r = await disp(dEmpty, { location_id: L }); check('package with no products -> 400', r[0] === 400, r);

  // returns: request / duplicates / confirm / reject
  r = await call('POST', '/package-returns', { delivery_id: winner, reason: 'x'.repeat(501) }); check('reason > 500 -> 400', r[0] === 400, r);
  r = await call('POST', '/package-returns', { delivery_id: 999999999 }); check('return for missing delivery -> 404', r[0] === 404, r);
  const dup = await Promise.all([1, 2, 3].map(() => call('POST', '/package-returns', { delivery_id: winner, reason: 'damaged' })));
  check('3 simultaneous return requests -> exactly one created', dup.filter((z) => z[0] === 201).length === 1 && dup.filter((z) => z[0] === 400).length === 2, dup);
  const ret = dup.find((z) => z[0] === 201)[1];
  r = await call('PUT', `/joining-deliveries/${winner}/deliver`); check('cannot deliver while a return is requested -> 400', r[0] === 400, r);
  r = await call('GET', '/package-returns?status=REQUESTED&q=zztest'); check('returns list filter', r[0] === 200 && r[1].total === 1 && r[1].rows[0].location_name === 'ZZTEST Pkg Depo', r);
  r = await call('GET', '/joining-deliveries?q=zztest'); check('delivery list shows return_status', r[1].rows.find((z) => z.id === winner).return_status === 'REQUESTED', r);
  const cr = await Promise.all([call('PUT', `/package-returns/${ret.id}/confirm`), call('PUT', `/package-returns/${ret.id}/reject`), call('PUT', `/package-returns/${ret.id}/confirm`)]);
  const final = (await raw(`SELECT status FROM package_returns WHERE id=$1::bigint`, ret.id))[0].status;
  const stockNow = [await bal(p1), await bal(p2)];
  check('confirm x2 + reject at once -> one outcome; stock consistent with it',
    cr.filter((z) => z[0] === 200).length === 1 && (final === 'CONFIRMED' ? stockNow[0] === 5 && stockNow[1] === 1 : final === 'REJECTED' && stockNow[0] === 3 && stockNow[1] === 0), { cr, final, stockNow });
  r = await call('PUT', `/package-returns/${ret.id}/confirm`); check('settled return cannot be confirmed again -> 400 (stock not doubled)', r[0] === 400 && (await bal(p1)) === stockNow[0], r);
  r = await call('PUT', '/package-returns/abc/confirm'); check('/abc -> 400', r[0] === 400, r);
  r = await call('PUT', '/package-returns/999999999/confirm'); check('missing -> 404', r[0] === 404, r);
  if (final === 'CONFIRMED') {
    r = await call('POST', '/package-returns', { delivery_id: winner }); check('already-returned delivery cannot be returned again -> 400', r[0] === 400, r);
  } else {
    r = await call('POST', '/package-returns', { delivery_id: winner }); check('after a rejection a new return may be requested', r[0] === 201, r);
  }

  // deliver a different delivery normally: dispatch the loser after restocking
  await seed(p2, 1);
  r = await disp(loser, { location_id: L, courier_id: C1, tracking_no: 'PK1' }); check('dispatch with courier + tracking', r[0] === 200, r);
  r = await call('PUT', `/joining-deliveries/${loser}/deliver`); check('deliver -> DELIVERED', r[0] === 200 && r[1].status === 'DELIVERED', r);
  r = await call('PUT', `/joining-deliveries/${loser}/deliver`); check('deliver again -> 400', r[0] === 400, r);
  r = await call('GET', `/joining-deliveries/${loser}`); check('detail shows courier, tracking, delivered_at', r[1].courier_name === 'ZZTEST PkgCourier' && r[1].tracking_no === 'PK1' && r[1].delivered_at, r);
  r = await call('POST', '/package-returns', { delivery_id: loser, reason: 'wrong size' }); check('return after delivery is allowed', r[0] === 201, r);
  const rj = r[1];
  r = await call('PUT', `/package-returns/${rj.id}/reject`); check('reject -> REJECTED, no stock movement', r[0] === 200 && r[1].status === 'REJECTED', r);
  r = await call('PUT', `/package-returns/${rj.id}/reject`); check('reject twice -> 400', r[0] === 400, r);
} finally {
  const D = `(SELECT id FROM joining_package_deliveries WHERE member_id IN (SELECT id FROM members WHERE member_code LIKE 'ZZTEST%'))`;
  await exec(`DELETE FROM package_returns WHERE delivery_id IN ${D} OR member_id IN (SELECT id FROM members WHERE member_code LIKE 'ZZTEST%')`);
  await exec(`DELETE FROM joining_package_deliveries WHERE id IN ${D}`);
  await exec(`DELETE FROM stock_ledger WHERE location_id IN (SELECT id FROM locations WHERE name LIKE 'ZZTEST%')`);
  await exec(`DELETE FROM members WHERE member_code LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM locations WHERE name LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM users WHERE login_id LIKE 'zztest%'`);
  await exec(`DELETE FROM couriers WHERE name LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM package_items WHERE package_id IN (SELECT id FROM packages WHERE name LIKE 'ZZTEST%')`);
  await exec(`DELETE FROM packages WHERE name LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM products WHERE sku LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM product_categories WHERE name LIKE 'ZZTEST%'`);
  const [left] = await raw(`SELECT (SELECT count(*) FROM members WHERE member_code LIKE 'ZZTEST%')::int m, (SELECT count(*) FROM packages WHERE name LIKE 'ZZTEST%')::int pk, (SELECT count(*) FROM products WHERE sku LIKE 'ZZTEST%')::int p, (SELECT count(*) FROM locations WHERE name LIKE 'ZZTEST%')::int l, (SELECT count(*) FROM couriers WHERE name LIKE 'ZZTEST%')::int c`);
  console.log('cleanup leftovers', left, '| failures:', fails);
  await prisma.$disconnect();
}
