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
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : JSON.stringify(extra).slice(0, 300)); };
const fe = (r, k) => r[0] === 400 && r[1].details?.fieldErrors?.[k];

try {
  for (const t of ['suppliers', 'couriers']) {
    let r = await fetch(B + '/' + t); check(`${t}: no token -> 401`, r.status === 401);
    r = await call('GET', '/' + t, null, 'DISTRIBUTOR'); check(`${t}: distributor -> 403`, r[0] === 403, r);
    r = await call('GET', '/' + t, null, 'DEPO'); check(`${t}: depo role -> 403`, r[0] === 403, r);
  }

  // suppliers
  let r = await call('POST', '/suppliers', { name: '' }); check('supplier empty name -> 400', fe(r, 'name'), r);
  r = await call('POST', '/suppliers', { name: 'ZZTEST Sup', mobile: 'abc' }); check('bad mobile -> field error', fe(r, 'mobile'), r);
  r = await call('POST', '/suppliers', { name: 'ZZTEST Sup', email: 'not-an-email' }); check('bad email -> field error', fe(r, 'email'), r);
  r = await call('POST', '/suppliers', { name: 'ZZTEST Sup', gstin: '123' }); check('bad GSTIN -> field error', fe(r, 'gstin'), r);
  r = await call('POST', '/suppliers', { name: 'ZZTEST Sup', contact_person: ' Ravi ', mobile: '+91 98765-43210', email: 'a@b.co', gstin: '22aaaaa0000a1z5', address: '12 Main Rd' });
  check('create supplier (gstin upper-cased, trimmed)', r[0] === 201 && r[1].gstin === '22AAAAA0000A1Z5' && r[1].contact_person === 'Ravi' && r[1].active === true, r);
  const s1 = r[1];
  r = await call('POST', '/suppliers', { name: 'ZZTEST Blank', mobile: '', email: '', gstin: '', address: '' });
  check('blank optionals stored as null', r[0] === 201 && r[1].mobile === null && r[1].email === null && r[1].gstin === null, r);
  const s2 = r[1];
  r = await call('PUT', `/suppliers/${s1.id}`, { mobile: '12' }); check('update w/ bad mobile -> 400', fe(r, 'mobile'), r);
  r = await call('PUT', `/suppliers/${s1.id}`, { address: 'New address' }); check('partial update keeps other fields', r[0] === 200 && r[1].address === 'New address' && r[1].gstin === '22AAAAA0000A1Z5', r);
  r = await call('PUT', `/suppliers/${s2.id}`, { active: false }); check('deactivate supplier', r[0] === 200 && r[1].active === false, r);
  r = await call('GET', '/suppliers?q=zztest&active=true'); check('search + active filter', r[0] === 200 && r[1].total === 1 && r[1].rows[0].id === s1.id, r);
  r = await call('GET', '/suppliers?q=zztest&active=false'); check('inactive filter', r[0] === 200 && r[1].total === 1 && r[1].rows[0].id === s2.id, r);
  r = await call('GET', '/suppliers?q=22AAAAA0000A1Z5'); check('search by GSTIN', r[0] === 200 && r[1].total === 1, r);
  r = await call('GET', '/suppliers?q=zztest&limit=1&page=2'); check('supplier pagination', r[0] === 200 && r[1].rows.length === 1 && r[1].total === 2, r);
  r = await call('PUT', '/suppliers/999999999', { name: 'x' }); check('update missing supplier -> 404', r[0] === 404, r);

  // couriers
  r = await call('POST', '/couriers', { name: 'ZZTEST Cour', tracking_url_template: 'javascript:alert(1)' }); check('javascript: URL rejected', fe(r, 'tracking_url_template'), r);
  r = await call('POST', '/couriers', { name: 'ZZTEST Cour', tracking_url_template: 'ftp://x.com/{tracking_no}' }); check('non-http URL rejected', fe(r, 'tracking_url_template'), r);
  r = await call('POST', '/couriers', { name: '' }); check('courier empty name -> 400', fe(r, 'name'), r);
  r = await call('POST', '/couriers', { name: 'ZZTEST Cour', contact: '1800-111', tracking_url_template: 'https://track.example.com/?n={tracking_no}' });
  check('create courier', r[0] === 201 && r[1].tracking_url_template === 'https://track.example.com/?n={tracking_no}', r);
  const c1 = r[1];
  r = await call('POST', '/couriers', { name: 'ZZTEST NoUrl', tracking_url_template: '' }); check('blank tracking URL -> null', r[0] === 201 && r[1].tracking_url_template === null, r);
  const c2 = r[1];
  r = await call('PUT', `/couriers/${c1.id}`, { active: false }); check('deactivate courier', r[0] === 200 && r[1].active === false, r);
  r = await call('GET', '/couriers?q=zztest&active=true'); check('courier active filter', r[1].total === 1 && r[1].rows[0].id === c2.id, r);
  r = await call('GET', '/couriers?q=zztest'); check('courier search', r[1].total === 2, r);

  // downstream consumers still work: PO supplier list + depo courier list
  r = await call('GET', '/suppliers?active=true&limit=100'); check('dropdown list for POs works', r[0] === 200 && Array.isArray(r[1].rows), r);
} finally {
  await prisma.$executeRawUnsafe(`DELETE FROM suppliers WHERE name LIKE 'ZZTEST%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM couriers WHERE name LIKE 'ZZTEST%'`);
  const [left] = await prisma.$queryRawUnsafe(`SELECT (SELECT count(*) FROM suppliers WHERE name LIKE 'ZZTEST%')::int s, (SELECT count(*) FROM couriers WHERE name LIKE 'ZZTEST%')::int c`);
  console.log('cleanup leftovers', left, '| failures:', fails);
  await prisma.$disconnect();
}
