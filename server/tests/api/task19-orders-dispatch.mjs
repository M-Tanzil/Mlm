import jwt from 'jsonwebtoken';
import { config } from '../../src/core/config.js';
import { prisma } from '../../src/core/prisma.js';

const API = 'http://localhost:5059/api';
const tok = (role, sub = '1') => jwt.sign({ sub, role }, config.jwt.accessSecret, { expiresIn: '60m' });
const mk = (prefix) => async (m, p, body, token) => {
  const r = await fetch(API + prefix + p, { method: m, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return [r.status, j];
};
const adm = mk('/orders'), dep = mk('/depo'), shop = mk('/orders/my');
const SA = tok('SUPER_ADMIN');
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : JSON.stringify(extra).slice(0, 450)); };
const raw = (q, ...a) => prisma.$queryRawUnsafe(q, ...a);
const exec = (q, ...a) => prisma.$executeRawUnsafe(q, ...a);

try {
  // ---- fixtures
  const [{ id: catId }] = await raw(`INSERT INTO product_categories (name) VALUES ('ZZTEST Ord Cat') RETURNING id::int AS id`);
  const mkP = async (sku, price, gst, bv, active = true) => (await raw(`INSERT INTO products (category_id, sku, name, mrp, dp_price, bv, gst_percent, active) VALUES ($1::bigint, $2, $2, $3, $3, $4, $5, $6) RETURNING id::int AS id`, catId, sku, price, bv, gst, active))[0].id;
  const p1 = await mkP('ZZTEST-O1', 100, 18, 10), p2 = await mkP('ZZTEST-O2', 50, 5, 0), pOff = await mkP('ZZTEST-OOFF', 10, 0, 0, false);
  const mkUser = async (login, role) => (await raw(`INSERT INTO users (role_id, login_id, password_hash) SELECT id, $1, 'x' FROM roles WHERE code = $2 RETURNING id::int AS id`, login, role))[0].id;
  const uD1 = await mkUser('zztest_od1', 'DEPO'), uD2 = await mkUser('zztest_od2', 'DEPO');
  const uM1 = await mkUser('zztest_om1', 'DISTRIBUTOR'), uM2 = await mkUser('zztest_om2', 'DISTRIBUTOR');
  const mkLoc = async (name, owner, active = true) => (await raw(`INSERT INTO locations (type, name, owner_user_id, active) VALUES ('DEPO', $1, $2::bigint, $3) RETURNING id::int AS id`, name, owner, active))[0].id;
  const D1 = await mkLoc('ZZTEST Ord Depo 1', uD1), D2 = await mkLoc('ZZTEST Ord Depo 2', uD2), DOff = await mkLoc('ZZTEST Ord Depo Off', null, false);
  const mkMem = async (code, uid, n) => (await raw(`INSERT INTO members (member_code, user_id, path, depth, full_name) VALUES ($1, $2::bigint, $3::ltree, 0, $1) RETURNING id::int AS id`, code, uid, `zz${n}`))[0].id;
  await mkMem('ZZTEST-M1', uM1, 1); await mkMem('ZZTEST-M2', uM2, 2);
  const seed = (loc, pid, q) => exec(`INSERT INTO stock_ledger (location_id, product_id, qty_change, txn_type, ref_type) VALUES ($1::bigint, $2::bigint, $3, 'ADJUST', 'zztest')`, loc, pid, q);
  await seed(D1, p1, 10); await seed(D1, p2, 2);
  const bal = async (loc, pid) => (await raw(`SELECT COALESCE(SUM(qty_change),0)::int q FROM stock_ledger WHERE location_id=$1::bigint AND product_id=$2::bigint`, loc, pid))[0].q;
  const mkCour = async (name, active, tpl) => (await raw(`INSERT INTO couriers (name, active, tracking_url_template) VALUES ($1, $2, $3) RETURNING id::int AS id`, name, active, tpl))[0].id;
  const C1 = await mkCour('ZZTEST Courier', true, 'https://track.example.com/?n={tracking_no}');
  const C2 = await mkCour('ZZTEST Courier Off', false, null);
  const C3 = await mkCour('ZZTEST Courier Evil', true, 'javascript:alert({tracking_no})');
  const T = { D1: tok('DEPO', String(uD1)), D2: tok('DEPO', String(uD2)), M1: tok('DISTRIBUTOR', String(uM1)), M2: tok('DISTRIBUTOR', String(uM2)) };

  // ---- authorization
  let r = await fetch(API + '/orders'); check('no token -> 401', r.status === 401);
  r = await adm('GET', '', null, T.M1); check('distributor -> 403 on admin orders', r[0] === 403, r);
  r = await adm('GET', '', null, T.D1); check('depo -> 403 on admin orders', r[0] === 403, r);
  r = await dep('GET', '/orders', null, SA); check('admin -> 403 on depo orders', r[0] === 403, r);
  r = await shop('GET', '/orders', null, SA); check('admin -> 403 on distributor shop', r[0] === 403, r);

  // ---- place: validation
  const place = (b) => adm('POST', '', { member_code: 'ZZTEST-M1', location_id: D1, items: [{ product_id: p1, qty: 1 }], ...b }, SA);
  r = await place({ member_code: 'NOPE' }); check('unknown member -> 400', r[0] === 400, r);
  r = await place({ location_id: 999999999 }); check('unknown location -> 400', r[0] === 400, r);
  r = await place({ location_id: DOff }); check('inactive location -> 400', r[0] === 400, r);
  r = await place({ items: [] }); check('no items -> 400', r[0] === 400, r);
  r = await place({ items: [{ product_id: p1, qty: 0 }] }); check('qty 0 -> 400', r[0] === 400, r);
  r = await place({ items: [{ product_id: p1, qty: 99999999999 }] }); check('huge qty -> 400', r[0] === 400, r);
  r = await place({ items: [{ product_id: 999999999, qty: 1 }] }); check('unknown product -> 400', r[0] === 400, r);
  r = await place({ items: [{ product_id: pOff, qty: 1 }] }); check('inactive product -> 400', r[0] === 400, r);
  r = await place({ items: [{ product_id: p1, qty: 11 }] }); check('more than stock -> 400 w/ message', r[0] === 400 && /Only 10/.test(r[1].error), r);
  r = await place({ type: 'BOGUS' }); check('bad order type -> 400', r[0] === 400, r);
  check('rejected orders created nothing', (await raw(`SELECT count(*)::int n FROM orders WHERE location_id IN ($1::bigint,$2::bigint)`, D1, D2))[0].n === 0);

  // ---- place: ok. Prices come from the product master, never from the client.
  r = await place({ items: [{ product_id: p1, qty: 1, price: 1 }, { product_id: p1, qty: 1 }, { product_id: p2, qty: 1 }], total: 1, subtotal: 1 });
  const o1 = r[1];
  check('order: 2 x 100 + 1 x 50 -> subtotal 250, GST 38.5, total 288.5, BV 20 (client prices ignored, lines merged)',
    r[0] === 201 && o1.subtotal === 250 && o1.gst_amount === 38.5 && o1.total === 288.5 && o1.total_bv === 20 && o1.items.length === 2 && o1.status === 'PLACED' && o1.payment_status === 'PENDING' && /^ORD/.test(o1.order_no), r);
  check('placing does not touch stock', (await bal(D1, p1)) === 10 && (await bal(D1, p2)) === 2);

  // ---- read: list, filters, detail
  r = await adm('GET', `?q=${o1.order_no}`, null, SA); check('search by order no; dispatch columns present (null)', r[1].total === 1 && 'courier_name' in r[1].rows[0] && r[1].rows[0].tracking_no === null, r);
  r = await adm('GET', '?q=zztest-m1&limit=1', null, SA); check('search by member code', r[1].total === 1, r);
  r = await adm('GET', `?location_id=${D1}&status=PLACED`, null, SA); check('location + status filter', r[1].total === 1, r);
  r = await adm('GET', `?location_id=${D1}&payment_status=PAID`, null, SA); check('payment_status filter (none paid yet)', r[1].total === 0, r);
  r = await adm('GET', `/${o1.id}`, null, SA); check('detail has lines with stored price/GST', r[0] === 200 && r[1].items[0].price === 100 && r[1].items[0].gst_percent === 18 && r[1].member_name === 'ZZTEST-M1', r);
  r = await adm('GET', '/abc', null, SA); check('GET /abc -> 400 (not 500)', r[0] === 400, r);
  r = await adm('GET', '/999999999', null, SA); check('GET missing -> 404', r[0] === 404, r);
  r = await adm('PUT', '/abc/pay', null, SA); check('pay /abc -> 400', r[0] === 400, r);
  r = await adm('GET', '/member-lookup?code=ZZTEST-M1', null, SA); check('member lookup', r[0] === 200 && r[1].member_code === 'ZZTEST-M1', r);

  // ---- depo scoping
  r = await dep('GET', '/orders', null, T.D1); check('depo 1 sees its order', r[0] === 200 && r[1].total === 1, r);
  r = await dep('GET', '/orders', null, T.D2); check('depo 2 sees none', r[0] === 200 && r[1].total === 0, r);
  r = await dep('GET', '/orders?limit=-5', null, T.D1); check('limit=-5 -> 200 (was a 500)', r[0] === 200, r);
  r = await dep('GET', `/orders/${o1.id}`, null, T.D2); check("depo 2 cannot open depo 1's order -> 404", r[0] === 404, r);
  r = await dep('PUT', `/orders/${o1.id}/pay`, null, T.D2); check("depo 2 cannot pay it -> 404", r[0] === 404, r);
  r = await dep('PUT', `/orders/${o1.id}/dispatch`, {}, T.D2); check("depo 2 cannot dispatch it -> 404", r[0] === 404, r);
  r = await dep('PUT', `/orders/${o1.id}/cancel`, null, T.D1); check('depo has no cancel action -> 404', r[0] === 404, r);

  // ---- lifecycle: dispatch/deliver too early
  r = await dep('PUT', `/orders/${o1.id}/dispatch`, {}, T.D1); check('dispatch before payment -> 400', r[0] === 400, r);
  r = await dep('PUT', `/orders/${o1.id}/deliver`, null, T.D1); check('deliver before dispatch -> 400', r[0] === 400, r);

  // ---- pay (depo confirms payment): stock leaves now
  r = await dep('PUT', `/orders/${o1.id}/pay`, null, T.D1);
  check('pay -> CONFIRMED/PAID', r[0] === 200 && r[1].status === 'CONFIRMED' && r[1].payment_status === 'PAID', r);
  check('stock deducted exactly once (p1 10->8, p2 2->1)', (await bal(D1, p1)) === 8 && (await bal(D1, p2)) === 1);
  r = await dep('PUT', `/orders/${o1.id}/pay`, null, T.D1); check('pay again -> 400 (no second deduction)', r[0] === 400 && (await bal(D1, p1)) === 8, r);
  r = await adm('GET', `?payment_status=PAID&location_id=${D1}`, null, SA); check('payment_status=PAID filter', r[1].total === 1, r);

  // ---- dispatch: courier + tracking
  r = await dep('PUT', `/orders/${o1.id}/dispatch`, { courier_id: 999999999 }, T.D1); check('unknown courier -> 400 (clear message)', r[0] === 400 && /Courier not found/.test(r[1].error), r);
  r = await dep('PUT', `/orders/${o1.id}/dispatch`, { courier_id: C2 }, T.D1); check('inactive courier -> 400', r[0] === 400 && /inactive/.test(r[1].error), r);
  r = await dep('PUT', `/orders/${o1.id}/dispatch`, { courier_id: C1, tracking_no: 'x'.repeat(101) }, T.D1); check('tracking no > 100 chars -> 400', r[0] === 400, r);
  check('failed dispatches left the order CONFIRMED', (await raw(`SELECT status FROM orders WHERE id=$1::bigint`, o1.id))[0].status === 'CONFIRMED');
  r = await dep('PUT', `/orders/${o1.id}/dispatch`, { courier_id: C1, tracking_no: 'AB 12/3' }, T.D1);
  check('dispatch -> DISPATCHED with courier, tracking and a safe tracking link', r[0] === 200 && r[1].status === 'DISPATCHED' && r[1].courier_name === 'ZZTEST Courier' && r[1].tracking_no === 'AB 12/3'
    && r[1].tracking_url === 'https://track.example.com/?n=AB%2012%2F3' && !('tracking_url_template' in r[1]), r);
  r = await dep('PUT', `/orders/${o1.id}/dispatch`, { courier_id: C1 }, T.D1); check('dispatch again -> 400', r[0] === 400, r);
  r = await adm('PUT', `/${o1.id}/cancel`, null, SA); check('cannot cancel a dispatched order -> 400', r[0] === 400, r);
  r = await adm('GET', `?status=DISPATCHED&location_id=${D1}`, null, SA); check('dispatch history row shows courier, tracking, dispatched_at', r[1].total === 1 && r[1].rows[0].courier_name === 'ZZTEST Courier' && r[1].rows[0].tracking_no === 'AB 12/3' && r[1].rows[0].dispatched_at, r);
  r = await dep('PUT', `/orders/${o1.id}/deliver`, null, T.D1); check('deliver -> DELIVERED with delivered_at', r[0] === 200 && r[1].status === 'DELIVERED' && r[1].delivered_at, r);
  r = await dep('PUT', `/orders/${o1.id}/deliver`, null, T.D1); check('deliver again -> 400', r[0] === 400, r);
  r = await adm('PUT', `/${o1.id}/cancel`, null, SA); check('cannot cancel a delivered order -> 400', r[0] === 400, r);

  // ---- tracking link: unsafe template is never exposed; no courier template -> no link
  const o2 = (await place({ items: [{ product_id: p1, qty: 1 }] }))[1];
  await adm('PUT', `/${o2.id}/pay`, null, SA);
  r = await adm('PUT', `/${o2.id}/dispatch`, { courier_id: C3, tracking_no: 'T1' }, SA); check('javascript: template -> no tracking_url', r[0] === 200 && r[1].tracking_url === null, r);
  const o3 = (await place({ items: [{ product_id: p1, qty: 1 }] }))[1];
  await adm('PUT', `/${o3.id}/pay`, null, SA);
  r = await adm('PUT', `/${o3.id}/dispatch`, {}, SA); check('dispatch with no courier/tracking is allowed (handover at the depo)', r[0] === 200 && r[1].courier_name === null && r[1].tracking_url === null, r);
  const stockAfterThree = [await bal(D1, p1), await bal(D1, p2)]; // p1: 10 - 2 - 1 - 1 = 6

  // ---- cancel: unpaid / paid
  const o4 = (await place({ items: [{ product_id: p1, qty: 2 }] }))[1];
  r = await adm('PUT', `/${o4.id}/cancel`, null, SA); check('cancel unpaid -> CANCELLED, stock untouched', r[0] === 200 && r[1].status === 'CANCELLED' && r[1].payment_status === 'PENDING' && (await bal(D1, p1)) === stockAfterThree[0], r);
  r = await adm('PUT', `/${o4.id}/cancel`, null, SA); check('cancel twice -> 400', r[0] === 400, r);
  r = await adm('PUT', `/${o4.id}/pay`, null, SA); check('cannot pay a cancelled order -> 400', r[0] === 400, r);
  const o5 = (await place({ items: [{ product_id: p1, qty: 2 }] }))[1];
  await adm('PUT', `/${o5.id}/pay`, null, SA);
  check('paid order took 2 from stock', (await bal(D1, p1)) === stockAfterThree[0] - 2);
  r = await adm('PUT', `/${o5.id}/cancel`, null, SA); check('cancel paid -> CANCELLED + REFUND_DUE, stock returned', r[0] === 200 && r[1].payment_status === 'REFUND_DUE' && (await bal(D1, p1)) === stockAfterThree[0], r);
  r = await adm('GET', '?payment_status=REFUND_DUE&location_id=' + D1, null, SA); check('REFUND_DUE filter finds it', r[1].total === 1, r);

  // ---- stock re-checked at payment (placement does not reserve)
  await seed(D1, p2, 1 - (await bal(D1, p2))); // p2 stock = exactly 1
  const a = (await place({ items: [{ product_id: p2, qty: 1 }] }))[1];
  const b = (await place({ items: [{ product_id: p2, qty: 1 }] }))[1];
  r = await adm('PUT', `/${a.id}/pay`, null, SA); check('first order for the last unit pays', r[0] === 200, r);
  r = await adm('PUT', `/${b.id}/pay`, null, SA); check('second order for the same unit cannot be paid -> 400 "Only 0"', r[0] === 400 && /Only 0/.test(r[1].error), r);
  check('second order stays PLACED; stock is 0, never negative', (await raw(`SELECT status FROM orders WHERE id=$1::bigint`, b.id))[0].status === 'PLACED' && (await bal(D1, p2)) === 0);
  await adm('PUT', `/${b.id}/cancel`, null, SA);

  // ---- concurrency
  const c1 = (await place({ items: [{ product_id: p1, qty: 3 }] }))[1];
  const before = await bal(D1, p1);
  const racePay = await Promise.all([1, 2, 3].map(() => adm('PUT', `/${c1.id}/pay`, null, SA)));
  check('3 simultaneous payments -> exactly one succeeds', racePay.filter((x) => x[0] === 200).length === 1 && racePay.filter((x) => x[0] === 400).length === 2, racePay);
  check('stock deducted once (3)', (await bal(D1, p1)) === before - 3);
  const c2 = (await place({ items: [{ product_id: p1, qty: 2 }] }))[1];
  const before2 = await bal(D1, p1);
  const mix = await Promise.all([adm('PUT', `/${c2.id}/pay`, null, SA), adm('PUT', `/${c2.id}/cancel`, null, SA)]);
  const final = (await raw(`SELECT status, payment_status FROM orders WHERE id=$1::bigint`, c2.id))[0];
  check('pay vs cancel at the same moment -> consistent: CANCELLED and stock back to where it was', final.status === 'CANCELLED' && (await bal(D1, p1)) === before2 && mix.some((x) => x[0] === 200), { mix, final });

  // ---- distributor shop (touched by the id fix)
  r = await shop('GET', '/locations', null, T.M1); check('shop: locations lists active depots only', r[0] === 200 && r[1].rows.some((x) => x.id === D1) && !r[1].rows.some((x) => x.id === DOff), r);
  r = await shop('GET', `/products?location_id=${D1}&q=zztest-o1`, null, T.M1); check('shop: products show availability at the chosen depot', r[0] === 200 && r[1].rows[0].available === (await bal(D1, p1)), r);
  r = await shop('POST', '/orders', { location_id: D1, items: [{ product_id: p1, qty: 1 }] }, T.M1); check('shop: distributor places an order', r[0] === 201 && r[1].member_code === 'ZZTEST-M1', r);
  const so = r[1];
  r = await shop('POST', '/orders', { location_id: D1, items: [{ product_id: p1, qty: 99999999999 }] }, T.M1); check('shop: huge qty -> 400', r[0] === 400, r);
  r = await shop('GET', '/orders', null, T.M1); check('shop: my orders contain it', r[1].rows.some((x) => x.id === so.id), r);
  r = await shop('GET', '/orders', null, T.M2); check("shop: another distributor does not see it", !r[1].rows.some((x) => x.id === so.id), r);
  r = await shop('GET', `/orders/${so.id}`, null, T.M2); check("shop: another distributor cannot open it -> 404", r[0] === 404, r);
  r = await shop('GET', '/orders/abc', null, T.M1); check('shop: /orders/abc -> 400', r[0] === 400, r);
  r = await shop('PUT', `/orders/${so.id}/cancel`, null, T.M2); check("shop: another distributor cannot cancel it -> 404", r[0] === 404, r);
  r = await shop('PUT', `/orders/${so.id}/cancel`, null, T.M1); check('shop: owner cancels an unpaid order', r[0] === 200 && r[1].status === 'CANCELLED', r);
  const so2 = (await shop('POST', '/orders', { location_id: D1, items: [{ product_id: p1, qty: 1 }] }, T.M1))[1];
  await adm('PUT', `/${so2.id}/pay`, null, SA);
  r = await shop('PUT', `/orders/${so2.id}/cancel`, null, T.M1); check('shop: a paid order cannot be cancelled by the distributor -> 400', r[0] === 400, r);
  void D2;
} finally {
  const L = `(SELECT id FROM locations WHERE name LIKE 'ZZTEST%')`;
  await exec(`DELETE FROM dispatches WHERE order_id IN (SELECT id FROM orders WHERE location_id IN ${L})`);
  await exec(`DELETE FROM orders WHERE location_id IN ${L}`); // items cascade
  await exec(`DELETE FROM stock_ledger WHERE location_id IN ${L}`);
  await exec(`DELETE FROM members WHERE member_code LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM locations WHERE name LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'zztest%')`);
  await exec(`DELETE FROM users WHERE login_id LIKE 'zztest%'`);
  await exec(`DELETE FROM couriers WHERE name LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM products WHERE sku LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM product_categories WHERE name LIKE 'ZZTEST%'`);
  const [left] = await raw(`SELECT (SELECT count(*) FROM orders o JOIN locations l ON l.id=o.location_id WHERE l.name LIKE 'ZZTEST%')::int o, (SELECT count(*) FROM members WHERE member_code LIKE 'ZZTEST%')::int m, (SELECT count(*) FROM users WHERE login_id LIKE 'zztest%')::int u, (SELECT count(*) FROM couriers WHERE name LIKE 'ZZTEST%')::int c, (SELECT count(*) FROM products WHERE sku LIKE 'ZZTEST%')::int p, (SELECT count(*) FROM locations WHERE name LIKE 'ZZTEST%')::int l`);
  console.log('cleanup leftovers', left, '| failures:', fails);
  await prisma.$disconnect();
}
