import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import { config } from '../../src/core/config.js';
import { prisma } from '../../src/core/prisma.js';

const B = 'http://localhost:5059/api/inventory';
const tok = (role) => jwt.sign({ sub: '1', role }, config.jwt.accessSecret, { expiresIn: '5m' });
const H = (role = 'SUPER_ADMIN') => ({ authorization: 'Bearer ' + tok(role), 'content-type': 'application/json' });
const call = async (m, p, body, role) => {
  const r = await fetch(B + p, { method: m, headers: H(role), body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return [r.status, j];
};
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : JSON.stringify(extra).slice(0, 300)); };

try {
  // auth
  let r = await fetch(B + '/products'); check('no token -> 401', r.status === 401);
  r = await call('GET', '/products', null, 'DISTRIBUTOR'); check('distributor -> 403', r[0] === 403, r);

  // category
  r = await call('POST', '/categories', { name: '' }); check('empty category name -> 400', r[0] === 400, r);
  r = await call('POST', '/categories', { name: 'ZZTEST Cat' }); check('create category', r[0] === 201 && r[1].name === 'ZZTEST Cat', r);
  const cat = r[1];
  r = await call('POST', '/categories', { name: 'ZZTEST Cat' }); check('duplicate category -> 400', r[0] === 400, r);

  // product validation
  r = await call('POST', '/products', { category_id: cat.id, sku: '', name: 'x', mrp: -1, dp_price: 1, bv: 0, gst_percent: 120 });
  check('bad product -> 400 with fieldErrors', r[0] === 400 && r[1].details?.fieldErrors?.sku && r[1].details.fieldErrors.mrp && r[1].details.fieldErrors.gst_percent, r);
  r = await call('POST', '/products', { category_id: 999999999, sku: 'ZZTEST-BAD', name: 'x', mrp: 1, dp_price: 1, bv: 0, gst_percent: 0 });
  check('unknown category -> 400', r[0] === 400, r);

  const mk = (sku, name) => call('POST', '/products', { category_id: cat.id, sku, name, mrp: 100, dp_price: 80, bv: 10, gst_percent: 18, hsn_code: '' });
  r = await mk('ZZTEST-1', 'ZZTEST Prod One'); check('create product', r[0] === 201 && r[1].sku === 'ZZTEST-1' && r[1].category_name === 'ZZTEST Cat' && r[1].hsn_code === null, r);
  const p1 = r[1];
  r = await mk('ZZTEST-1', 'Dup'); check('duplicate SKU -> 400', r[0] === 400 && /already exists/.test(r[1].error), r);
  r = await mk('ZZTEST-2', 'ZZTEST Prod Two'); check('create 2nd product', r[0] === 201, r);
  const p2 = r[1];

  // list / search / filters / paging
  r = await call('GET', `/products?category_id=${cat.id}`); check('filter by category', r[0] === 200 && r[1].total === 2, r);
  r = await call('GET', `/products?category_id=${cat.id}&limit=1&page=2`); check('pagination page 2 of 2', r[0] === 200 && r[1].rows.length === 1 && r[1].total === 2 && r[1].rows[0].id === p1.id, r);
  r = await call('GET', '/products?q=zztest-2'); check('search by SKU (case-insens.)', r[0] === 200 && r[1].total === 1 && r[1].rows[0].id === p2.id, r);
  r = await call('GET', '/products?category_id=abc'); check('bad category filter -> 400', r[0] === 400, r);
  r = await call('GET', `/products?category_id=${cat.id}&q=one`); check('search + category filter together', r[0] === 200 && r[1].total === 1, r);

  // update + deactivate + active filters
  r = await call('PUT', `/products/${p1.id}`, { mrp: 120 }); check('update price', r[0] === 200 && r[1].mrp === 120, r);
  r = await call('PUT', `/products/${p1.id}`, {}); check('empty update -> 400', r[0] === 400, r);
  r = await call('PUT', '/products/999999999', { mrp: 1 }); check('update missing -> 404', r[0] === 404, r);
  r = await call('PUT', `/products/${p1.id}`, { active: false }); check('deactivate', r[0] === 200 && r[1].active === false, r);
  r = await call('GET', `/products?category_id=${cat.id}&active=true`); check('active=true excludes deactivated', r[1].total === 1, r);
  r = await call('GET', `/products?category_id=${cat.id}&active=false`); check('active=false shows only deactivated', r[1].total === 1 && r[1].rows[0].id === p1.id, r);

  // image upload
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const up = async (buf, type, name) => {
    const fd = new FormData(); fd.append('image', new Blob([buf], { type }), name);
    const rr = await fetch(`${B}/products/${p2.id}/image`, { method: 'PUT', headers: { authorization: 'Bearer ' + tok('SUPER_ADMIN') }, body: fd });
    return [rr.status, await rr.json().catch(() => null)];
  };
  r = await up(png, 'image/png', 'a.png'); check('upload png', r[0] === 200 && /^\/uploads\/product-/.test(r[1].image_url), r);
  const imgUrl = r[1]?.image_url;
  r = await up(Buffer.from('hello'), 'text/plain', 'a.txt'); check('non-image upload -> 400', r[0] === 400, r);
  r = await up(Buffer.alloc(2 * 1024 * 1024 + 10, 1), 'image/png', 'big.png'); check('oversize upload -> 400', r[0] === 400, r);
  const rs = await fetch('http://localhost:5059' + imgUrl); check('image is served', rs.status === 200);
  r = await call('DELETE', `/products/${p2.id}/image`); check('remove image', r[0] === 200 && r[1].image_url === null, r);
} finally {
  // cleanup: remove only rows created by this test
  const imgs = await prisma.$queryRawUnsafe(`SELECT image_url FROM products WHERE sku LIKE 'ZZTEST%' AND image_url IS NOT NULL`);
  for (const i of imgs) fs.rmSync(process.cwd() + i.image_url, { force: true });
  await prisma.$executeRawUnsafe(`DELETE FROM products WHERE sku LIKE 'ZZTEST%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM product_categories WHERE name LIKE 'ZZTEST%'`);
  const [left] = await prisma.$queryRawUnsafe(`SELECT (SELECT count(*) FROM products WHERE sku LIKE 'ZZTEST%')::int p, (SELECT count(*) FROM product_categories WHERE name LIKE 'ZZTEST%')::int c`);
  console.log('cleanup leftovers', left, '| failures:', fails);
  await prisma.$disconnect();
}
