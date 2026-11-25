import jwt from 'jsonwebtoken';
import { config } from '../../src/core/config.js';
import { prisma } from '../../src/core/prisma.js';

const API = 'http://localhost:5059/api';
const tok = (role, sub = '1') => jwt.sign({ sub, role }, config.jwt.accessSecret, { expiresIn: '5m' });
const mk = (prefix) => async (m, p, body, token) => {
  const r = await fetch(API + prefix + p, { method: m, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return [r.status, j];
};
const adm = mk('/inventory'), dep = mk('/depo');
const SA = tok('SUPER_ADMIN'), AD = tok('ADMIN');
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : JSON.stringify(extra).slice(0, 400)); };
const raw = (q, ...a) => prisma.$queryRawUnsafe(q, ...a);
const exec = (q, ...a) => prisma.$executeRawUnsafe(q, ...a);

try {
  // fixtures: product, warehouse with stock
  const [{ id: catId }] = await raw(`INSERT INTO product_categories (name) VALUES ('ZZTEST Depo Cat') RETURNING id::int AS id`);
  const mkP = async (sku, active = true) => (await raw(`INSERT INTO products (category_id, sku, name, mrp, dp_price, active) VALUES ($1::bigint, $2, $2, 100, 80, $3) RETURNING id::int AS id`, catId, sku, active))[0].id;
  const p1 = await mkP('ZZTEST-D1'), pOff = await mkP('ZZTEST-DOFF', false);
  const W = (await raw(`INSERT INTO locations (type, name) VALUES ('WAREHOUSE', 'ZZTEST Warehouse') RETURNING id::int AS id`))[0].id;
  await exec(`INSERT INTO stock_ledger (location_id, product_id, qty_change, txn_type, ref_type) VALUES ($1::bigint, $2::bigint, 20, 'ADJUST', 'zztest')`, W, p1);
  const wBal = async () => (await raw(`SELECT COALESCE(SUM(qty_change),0)::int q FROM stock_ledger WHERE location_id=$1::bigint AND product_id=$2::bigint`, W, p1))[0].q;

  // ---------- admin: authorization + validation
  let r = await fetch(API + '/inventory/depos'); check('no token -> 401', r.status === 401);
  for (const role of ['DISTRIBUTOR', 'DEPO', 'FRANCHISE']) { r = await adm('GET', '/depos', null, tok(role)); check(`${role} -> 403 on admin depo list`, r[0] === 403, r); }
  const good = { type: 'DEPO', name: 'ZZTEST Depo One', city: 'Pune', state: 'MH', login_id: 'zztest_depo1', password: 'Passw0rd!x' };
  r = await adm('POST', '/depos', { ...good, name: '' }, SA); check('empty name -> 400', r[0] === 400, r);
  r = await adm('POST', '/depos', { ...good, type: 'WAREHOUSE' }, SA); check('type WAREHOUSE not allowed -> 400', r[0] === 400, r);
  r = await adm('POST', '/depos', { ...good, password: undefined }, SA); check('login without password -> 400', r[0] === 400, r);
  r = await adm('POST', '/depos', { ...good, password: 'short' }, SA); check('password < 8 -> 400', r[0] === 400, r);
  r = await adm('POST', '/depos', { ...good, login_id: 'bad id!' }, SA); check('bad login id chars -> 400', r[0] === 400, r);
  r = await adm('POST', '/depos', good, AD); check('ADMIN cannot create a login -> 403', r[0] === 403, r);
  check('rejected creates left no rows', (await raw(`SELECT count(*)::int n FROM locations WHERE name LIKE 'ZZTEST Depo%'`))[0].n === 0 && (await raw(`SELECT count(*)::int n FROM users WHERE login_id LIKE 'zztest%'`))[0].n === 0);

  // ---------- admin: create
  r = await adm('POST', '/depos', { type: 'FRANCHISE', name: 'ZZTEST Plain Franchise', pincode: '' }, AD); check('ADMIN can create a location without a login', r[0] === 201 && r[1].login_id === null && r[1].pincode === null, r);
  const plain = r[1];
  r = await adm('POST', '/depos', good, SA); check('SUPER_ADMIN creates depo + login', r[0] === 201 && r[1].login_id === 'zztest_depo1' && r[1].type === 'DEPO' && r[1].active === true && r[1].stock_units === 0, r);
  const d1 = r[1];
  const [u] = await raw(`SELECT r.code role, u.password_hash h, l.owner_user_id::int o, u.id::int uid FROM users u JOIN roles r ON r.id = u.role_id JOIN locations l ON l.owner_user_id = u.id WHERE u.login_id = 'zztest_depo1'`);
  check('user has role DEPO, hashed password, linked as owner', u.role === 'DEPO' && u.h.startsWith('$2') && !u.h.includes('Passw0rd') && u.o === u.uid, u);
  r = await adm('POST', '/depos', { ...good, name: 'ZZTEST Depo Dup', login_id: 'ZZTEST_DEPO1' }, SA); check('duplicate login (any case) -> 409', r[0] === 409, r);
  check('duplicate left no location behind', (await raw(`SELECT count(*)::int n FROM locations WHERE name = 'ZZTEST Depo Dup'`))[0].n === 0);
  r = await adm('POST', '/depos', { type: 'FRANCHISE', name: 'ZZTEST Franchise Two', login_id: 'zztest_fr2', password: 'Passw0rd!x' }, SA);
  check('franchise login gets role FRANCHISE', r[0] === 201 && (await raw(`SELECT r.code c FROM users u JOIN roles r ON r.id=u.role_id WHERE u.login_id='zztest_fr2'`))[0].c === 'FRANCHISE', r);
  const f2 = r[1];

  // ---------- admin: list / update
  r = await adm('GET', '/depos?q=zztest&limit=100', null, AD); check('list finds 3, excludes WAREHOUSE', r[0] === 200 && r[1].total === 3 && r[1].rows.every((x) => x.type !== 'WAREHOUSE'), r);
  r = await adm('GET', '/depos?q=zztest&type=FRANCHISE', null, AD); check('filter by type', r[1].total === 2, r);
  r = await adm('GET', '/depos?q=zztest_depo1', null, AD); check('search by login id', r[1].total === 1 && r[1].rows[0].id === d1.id, r);
  r = await adm('GET', '/depos?q=zztest&limit=2&page=2', null, AD); check('pagination', r[1].rows.length === 1 && r[1].total === 3, r);
  r = await adm('PUT', `/depos/${d1.id}`, { city: 'Mumbai' }, AD); check('partial update', r[0] === 200 && r[1].city === 'Mumbai' && r[1].name === 'ZZTEST Depo One', r);
  r = await adm('PUT', '/depos/abc', { city: 'x' }, AD); check('PUT /abc -> 400', r[0] === 400, r);
  r = await adm('PUT', `/depos/${d1.id}`, {}, AD); check('empty update -> 400', r[0] === 400, r);
  r = await adm('PUT', `/depos/${W}`, { name: 'hacked' }, AD); check('a WAREHOUSE cannot be edited here -> 404', r[0] === 404, r);
  r = await adm('PUT', `/depos/${d1.id}`, { type: 'FRANCHISE', owner_user_id: 1 }, AD); check('type/owner are not editable (ignored) -> nothing to update', r[0] === 400, r);

  // ---------- the new login really works, and the depo API sees its own location
  const lr = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ loginId: 'zztest_depo1', password: 'Passw0rd!x' }) });
  const lj = await lr.json(); check('depo logs in with the created credentials -> role DEPO', lr.status === 200 && lj.role === 'DEPO', lj);
  const DT = lj.accessToken;
  r = await dep('GET', '/me', null, DT); check('/depo/me returns own location', r[0] === 200 && r[1].id === d1.id, r);
  r = await dep('GET', '/me', null, AD); check('admin token -> 403 on depo API', r[0] === 403, r);
  const orphan = await dep('GET', '/me', null, tok('DEPO', String(u.uid + 999999))); check('depo login without a location -> 403', orphan[0] === 403, orphan);
  r = await dep('GET', '/products?q=zztest-d1', null, DT); check('depo product search', r[0] === 200 && r[1].rows.length === 1, r);
  r = await dep('GET', '/stock', null, DT); check('depo stock starts empty', r[0] === 200 && r[1].rows.length === 0, r);

  // ---------- PCR (depo side)
  r = await dep('POST', '/pcr', { items: [] }, DT); check('PCR: no items -> 400', r[0] === 400, r);
  r = await dep('POST', '/pcr', { items: [{ product_id: p1, qty: 0 }] }, DT); check('PCR: qty 0 -> 400', r[0] === 400, r);
  r = await dep('POST', '/pcr', { items: [{ product_id: p1, qty: 99999999999 }] }, DT); check('PCR: huge qty -> 400', r[0] === 400, r);
  r = await dep('POST', '/pcr', { items: [{ product_id: 999999999, qty: 1 }] }, DT); check('PCR: unknown product -> 400', r[0] === 400 && /not available/.test(r[1].error), r);
  r = await dep('POST', '/pcr', { items: [{ product_id: pOff, qty: 1 }] }, DT); check('PCR: inactive product -> 400', r[0] === 400, r);
  const mkPcr = async (qty) => (await dep('POST', '/pcr', { items: [{ product_id: p1, qty: qty - 1 }, { product_id: p1, qty: 1 }] }, DT))[1].id;
  const pcrBig = await mkPcr(50);   // more than the warehouse has
  const pcrOk = await mkPcr(8);     // duplicates merged into 8
  const pcrRace = await mkPcr(5);
  const pcrRej = await mkPcr(3);
  r = await dep('GET', '/pcr?limit=2', null, DT); check('depo PCR list paginated, with names and merged qty', r[0] === 200 && r[1].total === 4 && r[1].rows.length === 2 && r[1].rows[0].items[0].name === 'ZZTEST-D1' && r[1].rows[0].total_qty === 3, r);

  // ---------- PCR (admin side)
  r = await adm('GET', `/pcr?location_id=${d1.id}&status=PENDING`, null, AD); check('admin PCR list (location + status filter)', r[0] === 200 && r[1].total === 4 && r[1].rows[0].location_name === 'ZZTEST Depo One', r);
  r = await adm('GET', `/pcr?location_id=${d1.id}&limit=3&page=2`, null, AD); check('admin PCR pagination', r[1].rows.length === 1 && r[1].total === 4, r);
  const trfBefore = (await raw(`SELECT count(*)::int n FROM stock_transfers WHERE from_location=$1::bigint`, W))[0].n;
  r = await adm('PUT', `/pcr/${pcrBig}/approve`, { from_location: W }, AD); check('approve beyond warehouse stock -> 400', r[0] === 400 && /Only 20/.test(r[1].error), r);
  check('failed approve is atomic: still PENDING, no transfer, stock untouched', (await raw(`SELECT status FROM pcr WHERE id=$1::bigint`, pcrBig))[0].status === 'PENDING'
    && (await raw(`SELECT count(*)::int n FROM stock_transfers WHERE from_location=$1::bigint`, W))[0].n === trfBefore && (await wBal()) === 20);
  r = await adm('PUT', `/pcr/${pcrOk}/approve`, { from_location: d1.id }, AD); check('approve from the requester itself -> 400, stays PENDING', r[0] === 400 && (await raw(`SELECT status FROM pcr WHERE id=$1::bigint`, pcrOk))[0].status === 'PENDING', r);
  r = await adm('PUT', '/pcr/abc/approve', { from_location: W }, AD); check('approve /abc -> 400', r[0] === 400, r);
  r = await adm('PUT', '/pcr/999999999/approve', { from_location: W }, AD); check('approve missing -> 404', r[0] === 404, r);
  r = await adm('PUT', `/pcr/${pcrOk}/approve`, { from_location: W }, AD); check('approve 8 from warehouse -> APPROVED + transfer', r[0] === 200 && r[1].status === 'APPROVED' && /^TRF/.test(r[1].transfer_no), r);
  const trf = r[1];
  check('warehouse debited 8 immediately', (await wBal()) === 12);
  r = await adm('PUT', `/pcr/${pcrOk}/approve`, { from_location: W }, AD); check('approve again -> 400 (no second transfer)', r[0] === 400 && /already APPROVED/.test(r[1].error) && (await wBal()) === 12, r);
  r = await adm('PUT', `/pcr/${pcrOk}/reject`, null, AD); check('reject an approved PCR -> 404', r[0] === 404, r);
  const race = await Promise.all([1, 2].map(() => adm('PUT', `/pcr/${pcrRace}/approve`, { from_location: W }, AD)));
  check('2 simultaneous approvals -> exactly one wins', race.map((x) => x[0]).sort().join() === '200,400', race);
  check('only one transfer created for it (warehouse 12 -> 7)', (await wBal()) === 7);
  r = await adm('PUT', `/pcr/${pcrRej}/reject`, null, AD); check('reject a pending PCR', r[0] === 200 && r[1].status === 'REJECTED', r);
  r = await adm('GET', `/pcr?location_id=${d1.id}&status=APPROVED`, null, AD); check('status filter APPROVED = 2', r[1].total === 2, r);

  // ---------- depo accepts the stock (stock inward for depo)
  r = await dep('GET', '/transfers?status=SENT', null, DT); check('depo sees the 2 incoming transfers (with to_name)', r[0] === 200 && r[1].total === 2 && r[1].rows[0].to_name === 'ZZTEST Depo One', r);
  r = await dep('GET', '/transfers?limit=1&page=2', null, DT); check('depo transfers paginated', r[1].rows.length === 1 && r[1].total === 2, r);
  r = await dep('GET', '/transfers/abc', null, DT); check('GET /transfers/abc -> 400', r[0] === 400, r);
  const t = (await dep('GET', `/transfers/${trf.transfer_id}`, null, DT))[1];
  check('depo can open its transfer', t.to_id === d1.id && t.items[0].qty_sent === 8, t);
  r = await dep('PUT', `/transfers/${trf.transfer_id}/accept`, { items: [{ id: t.items[0].id, qty_accepted: 7 }] }, DT);
  check('depo accepts 7 of 8', r[0] === 200 && r[1].status === 'ACCEPTED', r);
  r = await dep('GET', '/stock', null, DT); check('depo stock now shows 7', r[1].rows.length === 1 && r[1].rows[0].qty === 7, r);
  check('the 1 short unit went back to the warehouse (7 + 1)', (await wBal()) === 8);
  // another depo must not see it
  r = await adm('POST', '/depos', { type: 'DEPO', name: 'ZZTEST Depo Other', login_id: 'zztest_depo3', password: 'Passw0rd!x' }, SA);
  const lj3 = await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ loginId: 'zztest_depo3', password: 'Passw0rd!x' }) })).json();
  r = await dep('GET', `/transfers/${trf.transfer_id}`, null, lj3.accessToken); check("another depo cannot open this depo's transfer -> 404", r[0] === 404, r);
  r = await dep('PUT', `/transfers/${trf.transfer_id}/reject`, null, lj3.accessToken); check("another depo cannot reject it -> 404", r[0] === 404, r);

  // ---------- deactivation guard
  const other = (await dep('GET', '/transfers?status=SENT', null, DT))[1].rows[0]; // the racing approval's transfer, still in transit
  r = await adm('PUT', `/depos/${d1.id}`, { active: false }, AD); check('cannot deactivate while a transfer is in transit -> 400', r[0] === 400 && /in transit/.test(r[1].error), r);
  const ot = (await dep('GET', `/transfers/${other.id}`, null, DT))[1];
  await dep('PUT', `/transfers/${other.id}/reject`, null, DT);
  r = await adm('PUT', `/depos/${d1.id}`, { active: false }, AD); check('after resolving it, deactivation works', r[0] === 200 && r[1].active === false, r);
  r = await dep('GET', '/me', null, DT); check('an inactive depo login is locked out of the depo API -> 403', r[0] === 403, r);
  r = await adm('GET', '/depos?q=zztest&active=false', null, AD); check('inactive filter', r[1].total === 1 && r[1].rows[0].id === d1.id, r);
  void plain; void f2; void ot;
} finally {
  const L = `(SELECT id FROM locations WHERE name LIKE 'ZZTEST%')`;
  await exec(`DELETE FROM pcr WHERE location_id IN ${L}`);
  await exec(`DELETE FROM stock_ledger WHERE location_id IN ${L}`);
  await exec(`DELETE FROM stock_transfers WHERE from_location IN ${L} OR to_location IN ${L}`);
  await exec(`DELETE FROM locations WHERE name LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM users WHERE login_id LIKE 'zztest%'`);
  await exec(`DELETE FROM products WHERE sku LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM product_categories WHERE name LIKE 'ZZTEST%'`);
  const [left] = await raw(`SELECT (SELECT count(*) FROM locations WHERE name LIKE 'ZZTEST%')::int l, (SELECT count(*) FROM users WHERE login_id LIKE 'zztest%')::int u, (SELECT count(*) FROM products WHERE sku LIKE 'ZZTEST%')::int p, (SELECT count(*) FROM pcr)::int pcr_total`);
  console.log('cleanup leftovers', left, '| failures:', fails);
  await prisma.$disconnect();
}
