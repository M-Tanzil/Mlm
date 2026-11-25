import http from 'node:http';
import jwt from 'jsonwebtoken';
import { config } from '../../src/core/config.js';
import { prisma } from '../../src/core/prisma.js';

process.env.SMS_API_URL = 'http://127.0.0.1:5058/sms';
process.env.SMS_API_KEY = 'test-key-123';
delete process.env.SMTP_HOST;
const svc = await import('../../src/modules/notification/notification.service.js');
const { processNotification } = await import('../../src/jobs/notification.job.js');

// ---- fake SMS gateway
let mode = 'ok'; const hits = [];
const gw = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => {
    hits.push({ auth: req.headers.authorization, body: b });
    if (mode === 'hang') return; // never answers
    res.statusCode = mode === 'ok' ? 200 : Number(mode); res.end('{}');
  });
});
await new Promise((r) => gw.listen(5058, '127.0.0.1', r));

const API = 'http://localhost:5059/api/notifications';
const tok = (role, sub = '1') => jwt.sign({ sub, role }, config.jwt.accessSecret, { expiresIn: '60m' });
const SA = tok('SUPER_ADMIN');
const call = async (m, p, token = SA) => {
  const r = await fetch(API + p, { method: m, headers: { authorization: 'Bearer ' + token } });
  let j = null; try { j = await r.json(); } catch {}
  return [r.status, j];
};
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : JSON.stringify(extra).slice(0, 450)); };
const raw = (q, ...a) => prisma.$queryRawUnsafe(q, ...a);
const exec = (q, ...a) => prisma.$executeRawUnsafe(q, ...a);
const row = async (id) => (await raw(`SELECT status, error, sent_at FROM notifications WHERE id=$1::bigint`, id))[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = console.error; // attempt() logs failures on purpose; keep the test output readable
let uid;
const mkRow = async (channel, recipient = '+910000000000', subject = 'ZZTEST subject') =>
  (await raw(`INSERT INTO notifications (user_id, channel, template, subject, body, recipient) VALUES ($1::bigint, $2, 'ZZTEST', $3, 'ZZTEST body', $4) RETURNING id::int AS id`, uid, channel, subject, recipient))[0].id;
const tryAttempt = async (id, o) => { try { return { ok: await svc.attempt(id, o) }; } catch (e) { return { err: e }; } };

try {
  console.error = () => {};
  uid = (await raw(`INSERT INTO users (role_id, login_id, password_hash, email, mobile) SELECT id, 'zztest_n1', 'x', 'zztest_n1@example.com', '+910000000001' FROM roles WHERE code='DISTRIBUTOR' RETURNING id::int AS id`))[0].id;

  // ---- auth
  let r = await fetch(API); check('no token -> 401', r.status === 401);
  const TD = tok('DISTRIBUTOR', String(uid));
  for (const p of ['', '/templates', '/stats']) { r = await call('GET', p, TD); check(`distributor -> 403 on admin GET ${p || '/'}`, r[0] === 403, r); }
  r = await call('PUT', '/1/resend', TD); check('distributor -> 403 on resend', r[0] === 403, r);

  // ---- templates
  r = await call('GET', '/templates'); const sq = r[1].rows?.find((t) => t.code === 'SCHEME_QUALIFIED');
  check('template list with variables', r[0] === 200 && sq && ['scheme', 'name', 'reward'].every((v) => sq.variables.includes(v)) && sq.channels.includes('EMAIL'), r);

  // ---- SMS happy path
  let id = await mkRow('SMS'); hits.length = 0; mode = 'ok';
  let a = await tryAttempt(id);
  const row1 = await row(id);
  check('SMS sent: row SENT with sent_at; gateway got key + number + text', a.ok === true && row1.status === 'SENT' && row1.sent_at && hits.length === 1
    && hits[0].auth === 'Bearer test-key-123' && JSON.parse(hits[0].body).to === '+910000000000' && JSON.parse(hits[0].body).message === 'ZZTEST body', { a, row1, hits });
  a = await tryAttempt(id); check('attempt on a SENT row does nothing (no second SMS)', a.ok === false && hits.length === 1, { a, hits: hits.length });

  // ---- failures + retry
  id = await mkRow('SMS'); mode = '500'; hits.length = 0;
  a = await tryAttempt(id); let rw = await row(id);
  check('gateway 500 -> FAILED, error stored, transient (retryable)', a.err?.permanent === false && rw.status === 'FAILED' && /answered 500/.test(rw.error), { a: a.err?.message, rw });
  mode = 'ok'; a = await tryAttempt(id); rw = await row(id);
  check('retry of the FAILED row succeeds, error cleared', a.ok === true && rw.status === 'SENT' && rw.error === null, { a, rw });
  id = await mkRow('SMS'); mode = '400'; a = await tryAttempt(id);
  check('gateway 400 -> permanent (not retried)', a.err?.permanent === true && (await row(id)).status === 'FAILED', a.err?.message);
  id = await mkRow('SMS'); mode = '429'; a = await tryAttempt(id);
  check('gateway 429 -> transient', a.err?.permanent === false, a.err?.message);
  mode = 'ok';
  process.env.SMS_API_URL = 'http://127.0.0.1:59999/sms';
  id = await mkRow('SMS'); a = await tryAttempt(id);
  check('gateway unreachable -> FAILED, transient', a.err?.permanent === false && /unreachable/.test((await row(id)).error), a.err?.message);
  delete process.env.SMS_API_URL;
  id = await mkRow('SMS'); a = await tryAttempt(id);
  check('SMS not configured -> permanent, clear message, no secrets in it', a.err?.permanent === true && /not configured/.test((await row(id)).error) && !/test-key/.test((await row(id)).error), a.err?.message);
  process.env.SMS_API_URL = 'http://127.0.0.1:5058/sms';
  mode = 'hang'; id = await mkRow('SMS'); const t0 = Date.now(); a = await tryAttempt(id);
  check('hung gateway -> times out (~10s), FAILED not stuck in SENDING', a.err && /timed out/.test((await row(id)).error) && Date.now() - t0 < 30000 && (await row(id)).status === 'FAILED', { ms: Date.now() - t0, rw: await row(id) });
  mode = 'ok';

  // ---- email without a mail setup
  id = await mkRow('EMAIL', 'a@example.com'); a = await tryAttempt(id);
  check('email: SMTP not configured -> permanent FAILED with a clear reason', a.err?.permanent === true && /SMTP is not configured/.test((await row(id)).error), a.err?.message);
  process.env.SMTP_HOST = 'smtp.invalid';
  id = await mkRow('EMAIL', 'a@example.com'); a = await tryAttempt(id);
  check('email: SMTP host unreachable -> FAILED (retryable) with the network reason', a.err && !a.err.permanent && /smtp\.invalid|ENOTFOUND|EAI_AGAIN/.test((await row(id)).error), a.err?.message);
  delete process.env.SMTP_HOST;

  // ---- concurrency: one row, five workers
  id = await mkRow('SMS'); hits.length = 0;
  await Promise.all([1, 2, 3, 4, 5].map(() => tryAttempt(id)));
  check('5 simultaneous attempts on one row -> exactly one SMS sent', hits.length === 1 && (await row(id)).status === 'SENT', hits.length);

  // ---- queue job: success / transient (retry) / permanent (no retry)
  id = await mkRow('SMS'); mode = 'ok';
  await processNotification({ data: { notificationId: id } }); check('job: sends and resolves', (await row(id)).status === 'SENT');
  id = await mkRow('SMS'); mode = '500'; let err;
  try { await processNotification({ data: { notificationId: id } }); } catch (e) { err = e; }
  check('job: transient failure throws a normal error so BullMQ retries', err && err.name !== 'UnrecoverableError', err?.name);
  mode = 'ok'; await processNotification({ data: { notificationId: id } });
  check('job: the retry then succeeds', (await row(id)).status === 'SENT');
  id = await mkRow('SMS'); mode = '400'; err = null;
  try { await processNotification({ data: { notificationId: id } }); } catch (e) { err = e; }
  check('job: permanent failure is UnrecoverableError (no retries)', err?.name === 'UnrecoverableError', err?.name);
  mode = 'ok';

  // ---- sendNotification: rows per channel, subject cannot be split across lines, in-app marked sent
  const ids = await svc.sendNotification(uid, 'SCHEME_QUALIFIED', { name: 'N', scheme: 'Gold\r\nBcc: evil@example.com', reward: 'R' });
  await sleep(6000);
  const sent = await raw(`SELECT channel, subject, status, recipient FROM notifications WHERE id = ANY($1::bigint[]) ORDER BY channel`, ids);
  check('one row per channel (EMAIL + INAPP); subject has no line breaks', sent.length === 2 && sent.every((s) => !/[\r\n]/.test(s.subject)) && sent.find((s) => s.channel === 'EMAIL').recipient === 'zztest_n1@example.com', sent);
  check('in-app row is SENT; email row is FAILED (no SMTP) and visible, not lost', sent.find((s) => s.channel === 'INAPP').status === 'SENT' && sent.find((s) => s.channel === 'EMAIL').status === 'FAILED', sent);
  try { await svc.sendNotification(uid, 'NOPE'); check('unknown template rejected', false); } catch { check('unknown template rejected', true); }

  // ---- admin log API
  r = await call('GET', '?channel=SMS&status=FAILED&q=zztest'); check('log: channel+status filter', r[0] === 200 && r[1].total >= 3 && r[1].rows.every((x) => x.channel === 'SMS' && x.status === 'FAILED'), r);
  r = await call('GET', '?template=SCHEME_QUALIFIED&q=zztest_n1'); check('log: template + search by login', r[1].total === 2, r);
  r = await call('GET', '?limit=2&page=2&q=zztest'); check('log: pagination', r[1].rows.length === 2 && r[1].page === 2 && r[1].total > 4, r);
  r = await call('GET', "?status=SENT'%20OR%20'1'='1"); check('log: injection attempt in status is ignored (no filter, no error)', r[0] === 200, r);
  r = await call('GET', '/stats'); check('stats: counts per channel/status', r[0] === 200 && r[1].rows.some((x) => x.channel === 'SMS' && x.status === 'SENT' && x.n >= 1), r);

  // ---- resend rules
  id = await mkRow('SMS'); mode = '500'; await tryAttempt(id); mode = 'ok';
  r = await call('PUT', `/${id}/resend`); check('resend a FAILED SMS -> SENT', r[0] === 200 && r[1].status === 'SENT', r);
  r = await call('PUT', `/${id}/resend`); check('resend a SENT one -> 400', r[0] === 400, r);
  const inapp = await mkRow('INAPP', null); r = await call('PUT', `/${inapp}/resend`); check('resend in-app -> 400', r[0] === 400, r);
  r = await call('PUT', '/abc/resend'); check('resend /abc -> 400', r[0] === 400, r);
  r = await call('PUT', '/999999999/resend'); check('resend missing -> 404', r[0] === 404, r);
  id = await mkRow('SMS'); await exec(`UPDATE notifications SET status='SENDING' WHERE id=$1::bigint`, id);
  r = await call('PUT', `/${id}/resend`); check('recent SENDING row is left alone -> 400', r[0] === 400, r);
  await exec(`UPDATE notifications SET created_at = now() - interval '1 hour' WHERE id=$1::bigint`, id);
  r = await call('PUT', `/${id}/resend`); check('SENDING for 15+ min (crashed sender) can be resent', r[0] === 200 && r[1].status === 'SENT', r);

  // ---- my in-app list
  r = await call('GET', '/mine?limit=1', TD); check('/mine paginated, own rows only', r[0] === 200 && r[1].limit === 1 && r[1].rows.length === 1 && r[1].total >= 1, r);
} finally {
  console.error = quiet;
  await exec(`DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'zztest%')`);
  await exec(`DELETE FROM users WHERE login_id LIKE 'zztest%'`);
  const [left] = await raw(`SELECT (SELECT count(*) FROM users WHERE login_id LIKE 'zztest%')::int u, (SELECT count(*) FROM notifications WHERE template = 'ZZTEST')::int n`);
  console.log('cleanup leftovers', left, '| failures:', fails);
  gw.closeAllConnections?.(); gw.close();
  await prisma.$disconnect();
}

