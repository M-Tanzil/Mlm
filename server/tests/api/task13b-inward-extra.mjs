import jwt from 'jsonwebtoken';
import { config } from '../../src/core/config.js';
const H = { authorization: 'Bearer ' + jwt.sign({ sub: '1', role: 'SUPER_ADMIN' }, config.jwt.accessSecret, { expiresIn: '2m' }), 'content-type': 'application/json' };
const B = 'http://localhost:5059/api/inventory';
let fails = 0;
const chk = (n, ok, x) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : JSON.stringify(x)); };
for (const d of ['31-12-2026', '2026-13-45', '2026-02-30', 'abc', '2026-1-1']) {
  const r = await fetch(`${B}/stock-movements?from=${d}`, { headers: H });
  chk(`movements from=${d} -> 400`, r.status === 400, r.status);
  const r2 = await fetch(`${B}/stock-inward`, { method: 'POST', headers: H, body: JSON.stringify({ mode: 'SUPPLIER_WISE', supplier_id: 1, location_id: 1, items: [{ product_id: 1, qty: 1, expiry_date: d }] }) });
  chk(`inward expiry=${d} -> 400`, r2.status === 400, r2.status);
}
const ok = await fetch(`${B}/stock-movements?from=2026-02-28&to=2026-03-01&limit=1`, { headers: H });
chk('valid dates -> 200', ok.status === 200, ok.status);
console.log('failures:', fails);
