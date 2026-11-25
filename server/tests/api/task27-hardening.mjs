// Task #27-29 hardening: production error output, startup config check, login rate limit, and that normal auth still works.
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../../src/core/prisma.js';
import { failureLimiter } from '../../src/middleware/rateLimit.js';

const API = 'http://localhost:5059/api';
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : JSON.stringify(extra).slice(0, 450)); };
const raw = (q, ...a) => prisma.$queryRawUnsafe(q, ...a);
const post = async (p, body, token) => {
  const r = await fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return [r.status, j, r.headers];
};
const GOOD = { JWT_ACCESS_SECRET: 'a'.repeat(36) + 'Xk3pQ7', JWT_REFRESH_SECRET: 'b'.repeat(36) + 'Qm9wZ2', CLIENT_URL: 'https://app.example.com' };
const runIndex = (env) => spawnSync(process.execPath, ['src/index.js'], { env: { ...process.env, NODE_ENV: 'production', PORT: '5057', ...env }, encoding: 'utf8', timeout: 20000 });

try {
  // ---- 1. production error handler hides internals; development and client errors are unchanged
  const probe = `
    import { errorHandler } from './src/middleware/error.js';
    import { z } from 'zod';
    const call = (err) => { let out; errorHandler(err, {}, { status(c) { out = { c }; return this; }, json(b) { out.b = b; } }, () => {}); return out; };
    const db = Object.assign(new Error('Invalid \`prisma.$queryRawUnsafe()\` invocation: column "secret_col" of table "users" does not exist'), { details: { sql: 'SELECT 1' } });
    const bad = Object.assign(new Error('Member ID not found'), { status: 400 });
    let zerr; try { z.string().parse(1); } catch (e) { zerr = e; }
    console.log(JSON.stringify({ srv: call(db), bad: call(bad), zod: call(zerr) }));`;
  const probeRun = (env) => JSON.parse(spawnSync(process.execPath, ['--input-type=module', '-e', probe], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 20000 }).stdout.trim().split('\n').pop());
  let p = probeRun({ NODE_ENV: 'production' });
  check('production: unexpected 500 -> generic message, no details', p.srv.c === 500 && p.srv.b.error === 'Server error' && p.srv.b.details === undefined && !JSON.stringify(p.srv).includes('secret_col'), p.srv);
  check('production: client errors keep their message', p.bad.c === 400 && p.bad.b.error === 'Member ID not found', p.bad);
  check('production: validation errors still 400 with field details', p.zod.c === 400 && p.zod.b.details, p.zod);
  p = probeRun({ NODE_ENV: 'development' });
  check('development: 500 still shows the real message (debugging)', p.srv.c === 500 && /secret_col/.test(p.srv.b.error), p.srv);

  // ---- 2. production refuses to start with unsafe configuration (and never prints a secret)
  const cases = [
    ['missing JWT secrets', { JWT_ACCESS_SECRET: '', JWT_REFRESH_SECRET: '' }, ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']],
    ['same secret twice', { JWT_ACCESS_SECRET: GOOD.JWT_ACCESS_SECRET, JWT_REFRESH_SECRET: GOOD.JWT_ACCESS_SECRET }, ['different']],
    ['short secret', { JWT_ACCESS_SECRET: 'short-secret-value', JWT_REFRESH_SECRET: GOOD.JWT_REFRESH_SECRET }, ['JWT_ACCESS_SECRET']],
    ['placeholder secret', { JWT_ACCESS_SECRET: 'change-me-change-me-change-me-12345', JWT_REFRESH_SECRET: GOOD.JWT_REFRESH_SECRET }, ['JWT_ACCESS_SECRET']],
    ['no CLIENT_URL', { CLIENT_URL: '' }, ['CLIENT_URL']],
    ['no DATABASE_URL', { DATABASE_URL: '' }, ['DATABASE_URL']],
    ['queue on without Redis', { USE_QUEUE: 'true', REDIS_URL: '' }, ['REDIS_URL']],
  ];
  for (const [name, env, mention] of cases) {
    const r = runIndex({ ...GOOD, ...env });
    const text = `${r.stderr}${r.stdout}`;
    const leaked = [GOOD.JWT_ACCESS_SECRET, GOOD.JWT_REFRESH_SECRET, 'short-secret-value', 'change-me-change'].some((s) => text.includes(s));
    check(`production refuses to start: ${name}`, r.status !== 0 && mention.every((m) => text.includes(m)) && !leaked, { status: r.status, text: text.slice(0, 300) });
  }
  // a valid production config starts, serves health, and CORS allows only CLIENT_URL
  const child = spawn(process.execPath, ['src/index.js'], { env: { ...process.env, NODE_ENV: 'production', PORT: '5057', ...GOOD }, stdio: 'ignore' });
  let health = null;
  for (let i = 0; i < 30 && !health; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { const r = await fetch('http://localhost:5057/api/health', { headers: { origin: 'https://app.example.com' } }); health = { s: r.status, cors: r.headers.get('access-control-allow-origin') }; } catch { /* not up yet */ }
  }
  const evil = await fetch('http://localhost:5057/api/health', { headers: { origin: 'https://evil.example.org' } }).then((r) => r.headers.get('access-control-allow-origin')).catch(() => 'err');
  child.kill();
  check('valid production config starts; health ok; CORS = CLIENT_URL only', health?.s === 200 && health.cors === 'https://app.example.com' && evil !== 'https://evil.example.org', { health, evil });
  const dev = spawn(process.execPath, ['src/index.js'], { env: { ...process.env, NODE_ENV: 'development', PORT: '5056', JWT_ACCESS_SECRET: '', JWT_REFRESH_SECRET: '' }, stdio: 'ignore' });
  let devUp = false;
  for (let i = 0; i < 30 && !devUp; i++) { await new Promise((r) => setTimeout(r, 500)); try { devUp = (await fetch('http://localhost:5056/api/health')).ok; } catch { /* not up yet */ } }
  dev.kill();
  check('development still starts without strict config', devUp);

  // ---- 3. limiter logic in isolation
  const lim = failureLimiter({ windowMs: 60_000, buckets: [{ name: 't-id', max: 3, key: (r) => r.k, resetOnSuccess: true }, { name: 't-ip', max: 50, key: () => 'ip' }] });
  const fire = (k, status) => {
    const res = Object.assign(new EventEmitter(), { statusCode: status, headers: {}, set(h, v) { this.headers[h] = v; return this; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
    let passed = false; lim({ k }, res, () => { passed = true; });
    if (passed) res.emit('finish');
    return { passed, res };
  };
  fire('a', 401); fire('a', 401); fire('a', 401);
  let x = fire('a', 200);
  check('3 failures for one key block the 4th request (429 + Retry-After)', !x.passed && x.res.statusCode === 429 && Number(x.res.headers['Retry-After']) > 0, x.res.body);
  x = fire('b', 401); check('another key is unaffected', x.passed);
  fire('c', 401); fire('c', 401); fire('c', 200);
  x = fire('c', 401); fire('c', 401);
  x = fire('c', 401); check('a success clears the per-key counter (typos before the right password are forgiven)', x.passed, x.res.body);
  const blocked = [fire('a', 401), fire('a', 401), fire('a', 401)];
  check('blocked requests are not counted again (window does not extend)', blocked.every((r) => !r.passed));

  // ---- 4. real login flow through the running API: normal auth is unharmed, brute force is not
  const hash = await bcrypt.hash('Correct-Horse-9', 10);
  const mkUser = async (login, status = 'ACTIVE') => (await raw(`INSERT INTO users (role_id, login_id, password_hash, status) SELECT id, $1, $2, $3 FROM roles WHERE code = 'DISTRIBUTOR' RETURNING id::int AS id`, login, hash, status))[0].id;
  await mkUser('zztest_rl1'); await mkUser('zztest_rl2'); await mkUser('zztest_rlb', 'BLOCKED');
  let r = await post('/auth/login', { loginId: 'zztest_rl2', password: 'Correct-Horse-9' });
  check('login works: tokens + role returned', r[0] === 200 && r[1].accessToken && r[1].refreshToken && r[1].role === 'DISTRIBUTOR', r[1]);
  const me = await fetch(API + '/auth/me', { headers: { authorization: 'Bearer ' + r[1].accessToken } }).then((x) => x.json());
  check('access token works on /auth/me', me.role === 'DISTRIBUTOR' && me.id, me);
  const rf = await post('/auth/refresh', { refreshToken: r[1].refreshToken });
  check('refresh works', rf[0] === 200 && rf[1].accessToken, rf);
  check('refresh with a garbage token -> 401', (await post('/auth/refresh', { refreshToken: 'nope' }))[0] === 401);
  check('wrong password -> 401', (await post('/auth/login', { loginId: 'zztest_rl2', password: 'wrong-password' }))[0] === 401);
  check('blocked user -> 401', (await post('/auth/login', { loginId: 'zztest_rlb', password: 'Correct-Horse-9' }))[0] === 401);
  check('no token -> 401 on a protected route', (await fetch(API + '/orders')).status === 401);
  check('token signed with the wrong secret -> 401', (await fetch(API + '/auth/me', { headers: { authorization: 'Bearer ' + jwt.sign({ sub: '1', role: 'SUPER_ADMIN' }, 'not-the-secret') } })).status === 401);

  for (let i = 0; i < 9; i++) await post('/auth/login', { loginId: 'zztest_rl1', password: 'wrong-password' });
  r = await post('/auth/login', { loginId: 'zztest_rl1', password: 'Correct-Horse-9' });
  check('9 typos then the right password still logs in', r[0] === 200, r);
  for (let i = 0; i < 10; i++) await post('/auth/login', { loginId: 'zztest_rl1', password: 'wrong-password' });
  r = await post('/auth/login', { loginId: 'zztest_rl1', password: 'Correct-Horse-9' });
  check('10 failures lock that login ID: even the right password -> 429 with Retry-After', r[0] === 429 && Number(r[2].get('retry-after')) > 0, [r[0], r[1]]);
  r = await post('/auth/login', { loginId: 'ZZTEST_RL1', password: 'Correct-Horse-9' });
  check('lock is case-insensitive on the login ID', r[0] === 429, r[0]);
  r = await post('/auth/login', { loginId: 'zztest_rl2', password: 'Correct-Horse-9' });
  check('other users on the same IP can still log in', r[0] === 200, r);
} finally {
  await raw(`DELETE FROM users WHERE login_id LIKE 'zztest_rl%'`);
  const [left] = await raw(`SELECT count(*)::int u FROM users WHERE login_id LIKE 'zztest_rl%'`);
  console.log('cleanup leftovers', left, '| failures:', fails);
  await prisma.$disconnect();
}
