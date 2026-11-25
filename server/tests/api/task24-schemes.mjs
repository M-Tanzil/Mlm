import jwt from 'jsonwebtoken';
import { config } from '../../src/core/config.js';
import { prisma } from '../../src/core/prisma.js';

const API = 'http://localhost:5059/api/schemes';
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
const mkS = (o) => ({ name: 'ZZTEST S', target_type: 'BV', target_value: 100, reward: 'Phone', start_date: '2020-01-01', end_date: '2020-01-31', ...o });

try {
  const mkUser = async (n) => (await raw(`INSERT INTO users (role_id, login_id, password_hash) SELECT id, $1, 'x' FROM roles WHERE code = 'DISTRIBUTOR' RETURNING id::int AS id`, `zztest_s${n}`))[0].id;
  const u = [0, await mkUser(1), await mkUser(2), await mkUser(3)];
  const mkMem = async (n, userId, path, sponsor = null) => (await raw(
    `INSERT INTO members (member_code, user_id, path, depth, full_name, sponsor_id, sponsor_path) VALUES ($1, $2::bigint, $3::ltree, 0, $1, $4::bigint, $5::ltree) RETURNING id::int AS id`,
    `ZZTEST-S${n}`, userId, `zs${n}`, sponsor, sponsor ? `zsp1.zsp${n}` : `zsp${n}`))[0].id;
  const m1 = await mkMem(1, u[1], 'x'), m2 = await mkMem(2, u[2], 'x'), m3 = await mkMem(3, u[3], 'x');
  const [{ id: loc }] = await raw(`INSERT INTO locations (type, name) VALUES ('DEPO', 'ZZTEST Scheme Depo') RETURNING id::int AS id`);
  let on = 0;
  const order = async (mid, bv, { total = bv, status = 'CONFIRMED', pay = 'PAID', type = 'REPURCHASE', at = '2020-01-15' } = {}) =>
    (await raw(`INSERT INTO orders (order_no, member_id, location_id, type, subtotal, gst_amount, total, total_bv, status, payment_status, created_at)
                VALUES ($1, $2::bigint, $3::bigint, $4, $5::numeric, 0, $5::numeric, $6::numeric, $7, $8, $9::timestamptz) RETURNING id::int AS id`, `ZZTEST-SO${++on}`, mid, loc, type, total, bv, status, pay, at))[0].id;

  // auth
  let r = await fetch(API); check('no token -> 401', r.status === 401);
  r = await call('GET', '', null, tok('DISTRIBUTOR', String(u[1]))); check('distributor -> 403 on admin list', r[0] === 403, r);
  r = await call('GET', '/my', null); check('admin -> 403 on /my', r[0] === 403, r);

  // validation
  r = await call('POST', '', mkS({ end_date: '2019-12-31' })); check('end before start -> 400', r[0] === 400 && /End date/.test(r[1].error), r);
  r = await call('POST', '', mkS({ start_date: '2020-02-31' })); check('impossible date -> 400', r[0] === 400, r);
  r = await call('POST', '', mkS({ target_value: 0 })); check('target 0 -> 400', r[0] === 400, r);
  r = await call('POST', '', mkS({ target_value: 1e12 })); check('target too large -> 400 (not a DB error)', r[0] === 400, r);
  r = await call('POST', '', mkS({ reward: '' })); check('no reward -> 400', r[0] === 400, r);
  r = await call('POST', '', mkS({ target_type: 'MAGIC' })); check('bad target type -> 400', r[0] === 400, r);
  r = await call('POST', '', mkS({ name: 'x'.repeat(151) })); check('name > 150 -> 400', r[0] === 400, r);

  // BV scheme: auto-recalc on create picks up existing orders
  await order(m1, 60); await order(m1, 50); await order(m2, 30); await order(m3, 40);
  const oCancel = await order(m2, 500, { status: 'CANCELLED' }); void oCancel;
  await order(m2, 500, { pay: 'PENDING', status: 'PLACED' });
  await order(m2, 500, { at: '2019-12-31' }); await order(m2, 500, { at: '2020-02-01' });
  r = await call('POST', '', mkS({ name: 'ZZTEST BV' })); const bv = r[1];
  check('create -> 201, phase ENDED (window in 2020), 1 qualifier', r[0] === 201 && bv.phase === 'ENDED' && bv.qualified_count === 1, r);
  r = await call('GET', `/${bv.id}/qualifiers`); const byCode = Object.fromEntries(r[1].rows.map((x) => [x.member_code, x]));
  check('m1 110 qualified; m2 30 (cancelled/unpaid/out-of-window ignored); m3 40', byCode['ZZTEST-S1']?.progress === 110 && byCode['ZZTEST-S1'].qualified && byCode['ZZTEST-S2']?.progress === 30 && !byCode['ZZTEST-S2'].qualified && byCode['ZZTEST-S3']?.progress === 40, r);
  r = await call('GET', `/${bv.id}/qualifiers?qualified=true`); check('qualified filter', r[1].total === 1 && r[1].rows[0].member_code === 'ZZTEST-S1', r);
  r = await call('GET', `/${bv.id}/qualifiers?limit=1&page=2`); check('qualifiers paginated', r[1].total === 3 && r[1].rows.length === 1 && r[1].limit === 1, r);

  // REPURCHASE counts rupees of repurchase orders only
  await order(m3, 0, { total: 500, type: 'RESALE' }); await order(m3, 0, { total: 80 });
  r = await call('POST', '', mkS({ name: 'ZZTEST REP', target_type: 'REPURCHASE', target_value: 999999 }));
  r = await call('GET', `/${r[1].id}/qualifiers`); check('REPURCHASE: rupees of repurchase-type orders only (m3 = 40 + 80, RESALE 500 ignored)', r[1].rows.find((x) => x.member_code === 'ZZTEST-S3')?.progress === 120, r);

  // once qualified, always qualified; others drop to 0 when their orders vanish
  r = await call('PUT', `/${bv.id}`, { target_value: 100000 }); check('raising the target is allowed', r[0] === 200 && r[1].target_value === 100000, r);
  r = await call('GET', `/${bv.id}/qualifiers?qualified=true`); check('raising the target does not un-qualify', r[1].total === 1, r);
  await exec(`UPDATE orders SET status='CANCELLED' WHERE member_id = $1::bigint AND order_no LIKE 'ZZTEST%'`, m2);
  await call('POST', `/${bv.id}/recalculate`);
  r = await call('GET', `/${bv.id}/qualifiers`); check('member whose orders were all cancelled falls back to 0', r[1].rows.find((x) => x.member_code === 'ZZTEST-S2')?.progress === 0, r);
  await exec(`UPDATE orders SET status='CANCELLED' WHERE member_id = $1::bigint AND order_no LIKE 'ZZTEST%'`, m1);
  await call('POST', `/${bv.id}/recalculate`);
  r = await call('GET', `/${bv.id}/qualifiers?qualified=true`); check('qualified member stays qualified after cancelling', r[1].total === 1, r);

  // update rules
  r = await call('PUT', `/${bv.id}`, { end_date: '2019-06-01' }); check('partial update that makes end < start -> 400', r[0] === 400, r);
  r = await call('PUT', `/${bv.id}`, {}); check('empty update -> 400', r[0] === 400, r);
  r = await call('PUT', '/999999999', { name: 'x' }); check('update missing -> 404', r[0] === 404, r);
  r = await call('PUT', '/abc', { name: 'x' }); check('update /abc -> 400', r[0] === 400, r);
  r = await call('GET', '/abc/qualifiers'); check('qualifiers /abc -> 400', r[0] === 400, r);
  r = await call('POST', '/999999999/recalculate'); check('recalculate missing -> 404', r[0] === 404, r);

  // notification sent once even if recalcs overlap
  await exec(`UPDATE orders SET status='CONFIRMED' WHERE member_id = $1::bigint AND order_no LIKE 'ZZTEST%'`, m3);
  r = await call('POST', '', mkS({ name: 'ZZTEST Notify', target_value: 100 })); const nf = r[1];
  check('m3 (40+80 repurchase rows count BV 40) not qualified yet', (await call('GET', `/${nf.id}/qualifiers?qualified=true`))[1].total === 0);
  await order(m3, 70);
  const race = await Promise.all([1, 2, 3].map(() => call('POST', `/${nf.id}/recalculate`)));
  check('3 simultaneous recalcs -> exactly one reports the new qualifier', race.every((x) => x[0] === 200) && race.reduce((a, x) => a + x[1].newly_qualified, 0) === 1, race);
  await new Promise((s) => setTimeout(s, 1500));
  const notes = (await raw(`SELECT count(*)::int n FROM notifications WHERE user_id = $1::bigint`, u[3]))[0].n;
  check('member notified once (not three times)', notes === 1, notes);

  // phases + filters + inactive
  r = await call('POST', '', mkS({ name: 'ZZTEST Future', start_date: '2090-01-01', end_date: '2090-12-31', target_value: 999999999 })); const fut = r[1];
  check('future window -> UPCOMING', fut.phase === 'UPCOMING', r);
  r = await call('POST', '', mkS({ name: 'ZZTEST Running', start_date: '2020-01-01', end_date: '2090-12-31', target_value: 999999999 })); const run = r[1];
  check('open window -> RUNNING', run.phase === 'RUNNING', r);
  r = await call('POST', '', mkS({ name: 'ZZTEST Off', start_date: '2020-01-01', end_date: '2090-12-31', target_value: 999999999, active: false })); const off = r[1];
  check('inactive -> INACTIVE', off.phase === 'INACTIVE' && off.active === false, r);
  r = await call('GET', '?q=zztest&active=false'); check('active=false filter', r[1].total === 1 && r[1].rows[0].id === off.id, r);
  r = await call('GET', '?q=zztest&target_type=REPURCHASE'); check('target_type filter', r[1].total === 1, r);
  r = await call('PUT', `/${off.id}`, { active: true }); check('activate -> RUNNING', r[0] === 200 && r[1].phase === 'RUNNING', r);
  r = await call('PUT', `/${off.id}`, { active: false });

  // DIRECTS + NEW_JOINING (created inactive so no real member is ever notified)
  const mk2 = await mkMem(4, await mkUser(4), 'x', m1), mk3 = await mkMem(5, await mkUser(5), 'x', m1); void mk2; void mk3;
  const today = new Date().toISOString().slice(0, 10);
  r = await call('POST', '', mkS({ name: 'ZZTEST Directs', target_type: 'DIRECTS', target_value: 2, start_date: today, end_date: '2090-12-31', active: false }));
  await call('POST', `/${r[1].id}/recalculate`);
  r = await call('GET', `/${r[1].id}/qualifiers?qualified=true`); check('DIRECTS: sponsor with 2 new directs qualifies', r[1].rows.some((x) => x.member_code === 'ZZTEST-S1' && x.progress === 2), r);
  r = await call('POST', '', mkS({ name: 'ZZTEST NewJoin', target_type: 'NEW_JOINING', target_value: 2, start_date: today, end_date: '2090-12-31', active: false }));
  await call('POST', `/${r[1].id}/recalculate`);
  r = await call('GET', `/${r[1].id}/qualifiers?qualified=true`); check('NEW_JOINING: downline joins count', r[1].rows.some((x) => x.member_code === 'ZZTEST-S1' && x.progress >= 2), r);

  // member view
  const T1 = tok('DISTRIBUTOR', String(u[1])), T2 = tok('DISTRIBUTOR', String(u[2]));
  r = await call('GET', '/my?limit=50', null, T1); const names1 = r[1].rows.map((x) => x.name);
  check('/my: winner sees the ended scheme they won, with qualified + progress', r[0] === 200 && r[1].rows.find((x) => x.name === 'ZZTEST BV')?.qualified === true, r);
  check('/my: running + upcoming schemes shown; inactive hidden', names1.includes('ZZTEST Running') && names1.includes('ZZTEST Future') && !names1.includes('ZZTEST Off'), names1);
  r = await call('GET', '/my?limit=50', null, T2); check("/my: non-winner doesn't see the ended scheme", !r[1].rows.map((x) => x.name).includes('ZZTEST BV') && r[1].rows.map((x) => x.name).includes('ZZTEST Running'), r[1].rows.map((x) => x.name));
  r = await call('GET', '/my?limit=1&page=1', null, T1); check('/my paginated', r[1].rows.length === 1 && r[1].total > 1, r);
  r = await call('GET', '/my', null, tok('DISTRIBUTOR', '999999999')); check('/my without a member profile -> 403', r[0] === 403, r);
} finally {
  const S = `(SELECT id FROM schemes WHERE name LIKE 'ZZTEST%')`;
  await exec(`DELETE FROM scheme_qualifiers WHERE scheme_id IN ${S}`);
  await exec(`DELETE FROM schemes WHERE name LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM orders WHERE order_no LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'zztest%')`);
  await exec(`DELETE FROM members WHERE member_code LIKE 'ZZTEST%' AND sponsor_id IS NOT NULL`);
  await exec(`DELETE FROM members WHERE member_code LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM locations WHERE name LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM users WHERE login_id LIKE 'zztest%'`);
  const [left] = await raw(`SELECT (SELECT count(*) FROM schemes WHERE name LIKE 'ZZTEST%')::int s, (SELECT count(*) FROM members WHERE member_code LIKE 'ZZTEST%')::int m, (SELECT count(*) FROM orders WHERE order_no LIKE 'ZZTEST%')::int o, (SELECT count(*) FROM users WHERE login_id LIKE 'zztest%')::int u, (SELECT count(*) FROM locations WHERE name LIKE 'ZZTEST%')::int l`);
  console.log('cleanup leftovers', left, '| failures:', fails);
  await prisma.$disconnect();
}

