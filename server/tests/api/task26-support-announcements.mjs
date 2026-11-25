import jwt from 'jsonwebtoken';
import { config } from '../../src/core/config.js';
import { prisma } from '../../src/core/prisma.js';

const BASE = 'http://localhost:5059/api';
const tok = (role, sub) => jwt.sign({ sub: String(sub), role }, config.jwt.accessSecret, { expiresIn: '60m' });
const call = async (token, m, p, body) => {
  const r = await fetch(BASE + p, { method: m, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return [r.status, j];
};
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : JSON.stringify(extra).slice(0, 450)); };
const raw = (q, ...a) => prisma.$queryRawUnsafe(q, ...a);
const exec = (q, ...a) => prisma.$executeRawUnsafe(q, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (days) => new Date(Date.now() + days * 864e5).toISOString();

try {
  const mkUser = async (login, role, status = 'ACTIVE') => (await raw(`INSERT INTO users (role_id, login_id, password_hash, status) SELECT id, $1, 'x', $3 FROM roles WHERE code = $2 RETURNING id::int AS id`, login, role, status))[0].id;
  const uA1 = await mkUser('zztest_adm1', 'ADMIN'), uA2 = await mkUser('zztest_adm2', 'ADMIN'), uAB = await mkUser('zztest_admb', 'ADMIN', 'BLOCKED');
  const uM1 = await mkUser('zztest_tm1', 'DISTRIBUTOR'), uM2 = await mkUser('zztest_tm2', 'DISTRIBUTOR'), uD = await mkUser('zztest_td', 'DEPO');
  const mkMem = async (n, uid) => (await raw(`INSERT INTO members (member_code, user_id, path, depth, full_name) VALUES ($1, $2::bigint, $3::ltree, 0, $1) RETURNING id::int AS id`, `ZZTEST-T${n}`, uid, `zt${n}`))[0].id;
  await mkMem(1, uM1); await mkMem(2, uM2);
  const A1 = tok('ADMIN', uA1), A2 = tok('ADMIN', uA2), M1 = tok('DISTRIBUTOR', uM1), M2 = tok('DISTRIBUTOR', uM2), DP = tok('DEPO', uD);
  const noteCount = async (uid, tpl) => (await raw(`SELECT count(*)::int n FROM notifications WHERE user_id=$1::bigint AND template=$2`, uid, tpl))[0].n;

  // =============== SUPPORT TICKETS ===============
  let r = await fetch(BASE + '/support/tickets'); check('no token -> 401', r.status === 401);
  r = await call(M1, 'GET', '/support/tickets'); check('distributor -> 403 on admin tickets', r[0] === 403, r);
  r = await call(M1, 'GET', '/support/stats'); check('distributor -> 403 on stats', r[0] === 403, r);
  r = await call(A1, 'GET', '/support/my/tickets'); check('admin -> 403 on member tickets', r[0] === 403, r);
  r = await call(A1, 'GET', '/support/options'); check('options list', r[0] === 200 && r[1].categories.includes('PAYMENT') && r[1].statuses.length === 4, r);

  const mk = (b) => call(M1, 'POST', '/support/my/tickets', { subject: 'ZZTEST help', body: 'I need help', ...b });
  r = await mk({ subject: '' }); check('empty subject -> 400', r[0] === 400, r);
  r = await mk({ subject: 'x'.repeat(201) }); check('subject > 200 -> 400', r[0] === 400, r);
  r = await mk({ body: 'x'.repeat(5001) }); check('body > 5000 -> 400', r[0] === 400, r);
  r = await mk({ body: '   ' }); check('blank body -> 400', r[0] === 400, r);
  r = await mk({ category: 'MAGIC' }); check('bad category -> 400', r[0] === 400, r);
  r = await call(tok('DISTRIBUTOR', 999999999), 'POST', '/support/my/tickets', { subject: 's', body: 'b' }); check('no member profile -> 403', r[0] === 403, r);
  r = await mk({}); const t1 = r[1].id; check('create ticket (default GENERAL)', r[0] === 201 && t1, r);
  r = await mk({ category: 'PAYMENT', subject: 'ZZTEST payment' }); const t2 = r[1].id;
  r = await call(M1, 'GET', `/support/my/tickets/${t1}`); check('member opens own ticket: OPEN, first message, category, no assignee', r[0] === 200 && r[1].status === 'OPEN' && r[1].category === 'GENERAL' && r[1].messages.length === 1 && r[1].messages[0].from_admin === false && r[1].assigned_to === null, r);
  r = await call(M2, 'GET', `/support/my/tickets/${t1}`); check("another member can't read it -> 404", r[0] === 404, r);
  r = await call(M2, 'POST', `/support/my/tickets/${t1}/reply`, { body: 'hi' }); check("another member can't reply -> 404", r[0] === 404, r);
  r = await call(M1, 'GET', '/support/my/tickets/abc'); check('/abc -> 400', r[0] === 400, r);
  r = await call(M1, 'GET', '/support/my/tickets?limit=1&page=2'); check('my list paginated', r[0] === 200 && r[1].rows.length === 1 && r[1].total === 2 && r[1].page === 2, r);
  r = await call(M2, 'GET', '/support/my/tickets'); check('other member sees none', r[1].total === 0, r);

  // admin triage
  r = await call(A1, 'GET', '/support/tickets?q=zztest&status=OPEN'); check('admin list: search + status; includes member + last_message_at', r[0] === 200 && r[1].total === 2 && r[1].rows[0].member_code === 'ZZTEST-T1' && r[1].rows[0].last_message_at, r);
  r = await call(A1, 'GET', '/support/tickets?q=zztest&category=PAYMENT'); check('category filter', r[1].total === 1 && r[1].rows[0].id === t2, r);
  r = await call(A1, 'GET', '/support/tickets?q=zztest&assigned=none'); check('unassigned filter', r[1].total === 2, r);
  r = await call(A1, 'GET', '/support/tickets?assigned=abc'); check('bad assigned filter -> 400', r[0] === 400, r);
  r = await call(A1, 'GET', '/support/tickets?q=zztest&limit=1&page=2'); check('admin list paginated', r[1].rows.length === 1 && r[1].total === 2, r);
  r = await call(A1, 'GET', '/support/staff'); check('staff list: active admins only', r[0] === 200 && r[1].rows.some((x) => x.id === uA2) && !r[1].rows.some((x) => x.id === uAB) && !r[1].rows.some((x) => x.id === uM1), r);

  // assignment
  const put = (tid, b, t = A1) => call(t, 'PUT', `/support/tickets/${tid}`, b);
  r = await put(t1, { assigned_to: uM1 }); check("can't assign to a distributor -> 400", r[0] === 400, r);
  r = await put(t1, { assigned_to: uAB }); check("can't assign to a blocked admin -> 400", r[0] === 400, r);
  r = await put(t1, { assigned_to: 999999999 }); check("can't assign to an unknown user -> 400", r[0] === 400, r);
  r = await put(t1, { assigned_to: uA2, priority: 'HIGH', category: 'ORDER' }); check('assign + priority + category in one update', r[0] === 200 && r[1].assigned_to === uA2 && r[1].assigned_name === 'zztest_adm2' && r[1].priority === 'HIGH' && r[1].category === 'ORDER', r);
  r = await call(A2, 'GET', '/support/tickets?q=zztest&assigned=me'); check('"assigned to me" filter', r[1].total === 1 && r[1].rows[0].id === t1, r);
  r = await call(A1, 'GET', '/support/stats'); check('stats count unassigned open tickets', r[0] === 200 && r[1].open >= 2 && r[1].unassigned >= 1, r);
  r = await put(t1, { assigned_to: null }); check('unassign', r[0] === 200 && r[1].assigned_to === null, r);
  r = await put(t1, { status: 'BOGUS' }); check('bad status -> 400', r[0] === 400, r);
  r = await put(t1, { priority: 'URGENT' }); check('bad priority -> 400', r[0] === 400, r);
  r = await put(t1, {}); check('empty update -> 400', r[0] === 400, r);
  r = await put(999999999, { priority: 'LOW' }); check('missing -> 404', r[0] === 404, r);
  r = await put('abc', { priority: 'LOW' }); check('/abc -> 400', r[0] === 400, r);
  r = await put(t1, { priority: 'LOW' }, M1); check('distributor cannot update -> 403', r[0] === 403, r);

  // replies
  const reply = (tid, body, t = A1) => call(t, 'POST', `/support/tickets/${tid}/reply`, { body });
  r = await reply(t1, ''); check('empty reply -> 400', r[0] === 400, r);
  r = await reply(t1, 'x'.repeat(5001)); check('reply > 5000 -> 400', r[0] === 400, r);
  r = await reply(t1, 'We are looking into it'); check('admin reply: from_admin, OPEN -> IN_PROGRESS', r[0] === 201 && r[1].status === 'IN_PROGRESS' && r[1].messages.length === 2 && r[1].messages[1].from_admin === true, r);
  r = await reply(999999999, 'x'); check('reply to missing -> 404', r[0] === 404, r);
  const five = await Promise.all([1, 2, 3, 4, 5].map((i) => call(M1, 'POST', `/support/my/tickets/${t1}/reply`, { body: `more ${i}` })));
  check('5 simultaneous member replies all saved', five.every((x) => x[0] === 201) && (await raw(`SELECT count(*)::int n FROM ticket_messages WHERE ticket_id=$1::bigint`, t1))[0].n === 7, five.map((x) => x[0]));
  await sleep(4000);
  check('member was notified of the admin reply', (await noteCount(uM1, 'TICKET_REPLY')) === 1, await noteCount(uM1, 'TICKET_REPLY'));

  // resolution
  r = await put(t2, { resolution: 'fixed' }); check('resolution on an open ticket -> 400', r[0] === 400, r);
  const res3 = await Promise.all([1, 2, 3].map(() => put(t1, { status: 'RESOLVED', resolution: 'Refund issued' })));
  r = await call(A1, 'GET', `/support/tickets/${t1}`);
  check('3 simultaneous resolves -> RESOLVED with resolved_at + resolution', res3.every((x) => x[0] === 200) && r[1].status === 'RESOLVED' && r[1].resolved_at && r[1].resolution === 'Refund issued', { res3: res3.map((x) => x[0]), t: r[1] });
  await sleep(4000);
  check('resolved notification sent exactly once', (await noteCount(uM1, 'TICKET_RESOLVED')) === 1, await noteCount(uM1, 'TICKET_RESOLVED'));
  r = await put(t1, { status: 'CLOSED' }); check('RESOLVED -> CLOSED keeps resolved_at/resolution', r[0] === 200 && r[1].status === 'CLOSED' && r[1].resolution === 'Refund issued' && r[1].resolved_at, r);
  r = await call(M1, 'POST', `/support/my/tickets/${t1}/reply`, { body: 'one more' }); check('member reply on CLOSED -> 400', r[0] === 400, r);
  r = await reply(t1, 'x'); check('admin reply on CLOSED -> 400', r[0] === 400, r);
  r = await put(t1, { status: 'OPEN', resolution: 'ignored' }); check('admin reopens: resolved_at + resolution cleared', r[0] === 200 && r[1].status === 'OPEN' && r[1].resolved_at === null && r[1].resolution === null, r);
  await put(t1, { status: 'RESOLVED', resolution: 'Second fix' });
  r = await call(M1, 'POST', `/support/my/tickets/${t1}/reply`, { body: 'Still broken' }); check('member reply on RESOLVED reopens it and clears resolution', r[0] === 201 && r[1].status === 'OPEN' && r[1].resolved_at === null && r[1].resolution === null, r);
  r = await call(A1, 'GET', '/support/tickets?q=zztest&status=OPEN'); check('status filter after workflow', r[1].total === 2, r);

  // =============== ANNOUNCEMENTS ===============
  const an = (b) => call(A1, 'POST', '/announcements', { type: 'NEWS', title: 'ZZTEST news', ...b });
  r = await fetch(BASE + '/announcements/published'); check('published: no token -> 401', r.status === 401);
  r = await call(M1, 'POST', '/announcements', { type: 'NEWS', title: 'x' }); check('distributor cannot create -> 403', r[0] === 403, r);
  r = await call(M1, 'GET', '/announcements'); check('distributor cannot list admin view -> 403', r[0] === 403, r);
  r = await an({ type: 'MAGIC' }); check('bad type -> 400', r[0] === 400, r);
  r = await an({ title: '' }); check('empty title -> 400', r[0] === 400, r);
  r = await an({ title: 'x'.repeat(201) }); check('title > 200 -> 400', r[0] === 400, r);
  r = await an({ media_url: 'javascript:alert(1)' }); check('javascript: media link -> 400', r[0] === 400, r);
  r = await an({ event_date: '2026-02-31' }); check('impossible event date -> 400', r[0] === 400, r);
  r = await an({ audience: 'EVERYONE' }); check('bad audience -> 400', r[0] === 400, r);
  r = await an({ starts_at: 'not a date' }); check('bad start -> 400', r[0] === 400, r);
  r = await an({ starts_at: iso(2), expires_at: iso(1) }); check('expiry before start -> 400', r[0] === 400 && /expiry/.test(r[1].error), r);
  r = await an({ starts_at: iso(1), expires_at: iso(1) }); check('expiry equal to start -> 400', r[0] === 400, r);

  r = await an({ title: 'ZZTEST live all', body: 'hello', media_url: 'https://example.com/a.png', event_date: '2030-01-15' }); const aLive = r[1];
  check('create live announcement (defaults: audience ALL, published)', r[0] === 201 && aLive.visibility === 'LIVE' && aLive.audience === 'ALL' && aLive.published === true && aLive.event_date === '2030-01-15', r);
  const aDist = (await an({ title: 'ZZTEST dist only', audience: 'DISTRIBUTOR', type: 'ACHIEVER' }))[1];
  const aDepo = (await an({ title: 'ZZTEST depo only', audience: 'DEPO' }))[1];
  const aSched = (await an({ title: 'ZZTEST scheduled', starts_at: iso(2) }))[1];
  const aExp = (await an({ title: 'ZZTEST expired', starts_at: iso(-3), expires_at: iso(-1) }))[1];
  const aDraft = (await an({ title: 'ZZTEST draft', published: false }))[1];
  check('visibility computed: SCHEDULED / EXPIRED / DRAFT', aSched.visibility === 'SCHEDULED' && aExp.visibility === 'EXPIRED' && aDraft.visibility === 'DRAFT', [aSched.visibility, aExp.visibility, aDraft.visibility]);
  r = await call(A1, 'GET', '/announcements?q=zztest&visibility=LIVE'); check('admin filter visibility=LIVE (3)', r[1].total === 3, r);
  r = await call(A1, 'GET', '/announcements?q=zztest&audience=DEPO'); check('admin filter audience', r[1].total === 1 && r[1].rows[0].id === aDepo.id, r);
  r = await call(A1, 'GET', '/announcements?q=zztest&type=ACHIEVER'); check('admin filter type', r[1].total === 1, r);
  r = await call(A1, 'GET', '/announcements?q=zztest&limit=2&page=2'); check('admin list paginated', r[1].rows.length === 2 && r[1].total === 6, r);

  const titles = (x) => x[1].rows.map((a) => a.title);
  r = await call(M1, 'GET', '/announcements/published?limit=50'); const tm = titles(r);
  check('distributor sees live ALL + DISTRIBUTOR only', tm.includes('ZZTEST live all') && tm.includes('ZZTEST dist only') && !['ZZTEST depo only', 'ZZTEST scheduled', 'ZZTEST expired', 'ZZTEST draft'].some((t) => tm.includes(t)), tm.filter((t) => t.startsWith('ZZTEST')));
  r = await call(DP, 'GET', '/announcements/published?limit=50'); const td = titles(r);
  check('depo sees live ALL + DEPO only', td.includes('ZZTEST live all') && td.includes('ZZTEST depo only') && !td.includes('ZZTEST dist only') && !td.includes('ZZTEST draft'), td.filter((t) => t.startsWith('ZZTEST')));
  r = await call(A1, 'GET', '/announcements/published?limit=50'); const ta = titles(r);
  check('admin preview sees every live one', ta.includes('ZZTEST dist only') && ta.includes('ZZTEST depo only') && !ta.includes('ZZTEST scheduled'), ta.filter((t) => t.startsWith('ZZTEST')));
  r = await call(M1, 'GET', '/announcements/published?type=ACHIEVER&limit=50'); check('published type filter', r[1].rows.every((a) => a.type === 'ACHIEVER') && titles(r).includes('ZZTEST dist only'), r);
  r = await call(M1, 'GET', '/announcements/published?limit=1&page=1'); check('published paginated', r[1].rows.length === 1 && r[1].total >= 2, r);

  // edit
  r = await call(A1, 'PUT', `/announcements/${aSched.id}`, { starts_at: iso(-1) }); check('start moved to the past -> now LIVE', r[0] === 200 && r[1].visibility === 'LIVE', r);
  r = await call(A1, 'PUT', `/announcements/${aSched.id}`, { expires_at: iso(-5) }); check('edit making expiry < existing start -> 400', r[0] === 400, r);
  r = await call(A1, 'PUT', `/announcements/${aExp.id}`, { expires_at: null }); check('clear expiry -> LIVE again', r[0] === 200 && r[1].visibility === 'LIVE', r);
  r = await call(A1, 'PUT', `/announcements/${aLive.id}`, { published: false }); check('unpublish -> DRAFT, hidden from members', r[1].visibility === 'DRAFT' && !titles(await call(M1, 'GET', '/announcements/published?limit=50')).includes('ZZTEST live all'), r);
  r = await call(A1, 'PUT', `/announcements/${aLive.id}`, { published: true, title: 'ZZTEST live all (edited)', audience: 'DISTRIBUTOR' }); check('republish + edit title + audience', r[1].visibility === 'LIVE' && r[1].title.endsWith('(edited)') && r[1].audience === 'DISTRIBUTOR', r);
  r = await call(A1, 'PUT', `/announcements/${aLive.id}`, {}); check('empty update -> 400', r[0] === 400, r);
  r = await call(A1, 'PUT', '/announcements/999999999', { title: 'x' }); check('update missing -> 404', r[0] === 404, r);
  r = await call(A1, 'PUT', '/announcements/abc', { title: 'x' }); check('update /abc -> 400', r[0] === 400, r);

  // delete
  const del = await fetch(BASE + `/announcements/${aDraft.id}`, { method: 'DELETE', headers: { authorization: 'Bearer ' + A1 } });
  check('delete -> 204', del.status === 204);
  r = await call(A1, 'DELETE', `/announcements/${aDraft.id}`); check('delete again -> 404', r[0] === 404, r);
  r = await call(A1, 'DELETE', '/announcements/abc'); check('delete /abc -> 400', r[0] === 400, r);
  r = await call(M1, 'DELETE', `/announcements/${aDepo.id}`); check('distributor cannot delete -> 403', r[0] === 403, r);
} finally {
  await exec(`DELETE FROM tickets WHERE member_id IN (SELECT id FROM members WHERE member_code LIKE 'ZZTEST%')`);
  await exec(`DELETE FROM announcements WHERE title LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'zztest%')`);
  await exec(`DELETE FROM members WHERE member_code LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM users WHERE login_id LIKE 'zztest%'`);
  const [left] = await raw(`SELECT (SELECT count(*) FROM tickets WHERE subject LIKE 'ZZTEST%')::int t, (SELECT count(*) FROM announcements WHERE title LIKE 'ZZTEST%')::int a, (SELECT count(*) FROM users WHERE login_id LIKE 'zztest%')::int u, (SELECT count(*) FROM members WHERE member_code LIKE 'ZZTEST%')::int m`);
  console.log('cleanup leftovers', left, '| failures:', fails);
  await prisma.$disconnect();
}
