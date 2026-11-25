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
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : JSON.stringify(extra).slice(0, 400)); };
const raw = (q, ...a) => prisma.$queryRawUnsafe(q, ...a);
const exec = (q, ...a) => prisma.$executeRawUnsafe(q, ...a);

let locId;
const bal = async (pid) => (await raw(`SELECT COALESCE(SUM(qty_change),0)::int q FROM stock_ledger WHERE location_id=$1::bigint AND product_id=$2::bigint`, locId, pid))[0].q;
const ledgerN = async () => (await raw(`SELECT count(*)::int n FROM stock_ledger WHERE location_id=$1::bigint`, locId))[0].n;

try {
  const [{ id: catId }] = await raw(`INSERT INTO product_categories (name) VALUES ('ZZTEST Rej Cat') RETURNING id::int AS id`);
  const mkP = async (sku) => (await raw(`INSERT INTO products (category_id, sku, name, mrp, dp_price) VALUES ($1::bigint, $2, $2, 100, 80) RETURNING id::int AS id`, catId, sku))[0].id;
  const p1 = await mkP('ZZTEST-R1'), p2 = await mkP('ZZTEST-R2');
  const s1 = (await raw(`INSERT INTO suppliers (name) VALUES ('ZZTEST Rej Sup') RETURNING id::int AS id`))[0].id;
  locId = (await raw(`INSERT INTO locations (type, name) VALUES ('WAREHOUSE', 'ZZTEST Rej Loc') RETURNING id::int AS id`))[0].id;

  const sw = (items, extra = {}) => call('POST', '/stock-inward', { mode: 'SUPPLIER_WISE', supplier_id: s1, location_id: locId, items, ...extra });

  // validation
  let r = await sw([{ product_id: p1, qty: 0, rejected_qty: 0 }]); check('accepted 0 + rejected 0 -> 400', r[0] === 400, r);
  r = await sw([{ product_id: p1, qty: 0 }]); check('accepted 0, rejected omitted -> 400', r[0] === 400, r);
  r = await sw([{ product_id: p1, qty: 5, rejected_qty: -1 }]); check('negative rejected -> 400', r[0] === 400, r);
  r = await sw([{ product_id: p1, qty: 5, rejected_qty: 99999999999 }]); check('huge rejected -> 400', r[0] === 400, r);
  r = await sw([{ product_id: p1, qty: 5, rejected_qty: 1.5 }]); check('fractional rejected -> 400', r[0] === 400, r);
  check('rejected requests wrote nothing', (await ledgerN()) === 0);

  // accepted + rejected on one line
  r = await sw([{ product_id: p1, qty: 8, rejected_qty: 2, batch_no: 'RB1' }], { invoice_no: 'REJ-1' });
  check('receive 8 accepted + 2 rejected', r[0] === 201, r);
  const g1 = r[1];
  check('only the 8 accepted entered stock', (await bal(p1)) === 8 && (await ledgerN()) === 1);
  const [row] = await raw(`SELECT qty, rejected_qty FROM stock_inward_items WHERE inward_id=$1::bigint`, g1.id);
  check('GRN line stores qty 8 and rejected 2', row.qty === 8 && row.rejected_qty === 2, row);
  r = await call('GET', `/stock-inward?q=${g1.inward_no}`);
  check('list shows accepted 8 / rejected 2', r[1].rows[0].total_qty === 8 && r[1].rows[0].total_rejected === 2, r);

  // omitted rejected_qty defaults to 0 (old clients keep working)
  r = await sw([{ product_id: p2, qty: 5 }], { invoice_no: 'REJ-2' });
  check('rejected_qty omitted -> accepted as before', r[0] === 201 && (await bal(p2)) === 5, r);
  r = await call('GET', `/stock-inward?q=${r[1].inward_no}`); check('list: rejected 0', r[1].rows[0].total_rejected === 0, r);

  // fully rejected line next to an accepted one; and a fully rejected GRN
  r = await sw([{ product_id: p1, qty: 3 }, { product_id: p2, qty: 0, rejected_qty: 4 }], { invoice_no: 'REJ-3' });
  check('mixed GRN: accepted line + fully rejected line', r[0] === 201 && (await bal(p1)) === 11 && (await bal(p2)) === 5, r);
  const before = await ledgerN();
  r = await sw([{ product_id: p2, qty: 0, rejected_qty: 7 }], { invoice_no: 'REJ-4' });
  check('fully rejected GRN -> 201, no ledger rows', r[0] === 201 && (await ledgerN()) === before, r);
  const [tot] = await raw(`SELECT sum(rejected_qty)::int r FROM stock_inward_items x JOIN stock_inward si ON si.id = x.inward_id WHERE si.location_id=$1::bigint`, locId);
  check('total rejected recorded = 2 + 4 + 7', tot.r === 13, tot);

  // PO-wise: only accepted counts against the PO
  const po = (await call('POST', '/purchase-orders', { supplier_id: s1, items: [{ product_id: p1, qty: 6, rate: 5 }] }))[1];
  const rcv = (items) => call('POST', '/stock-inward', { mode: 'PO_WISE', po_id: po.id, location_id: locId, items });
  const getPo = async () => (await call('GET', `/purchase-orders/${po.id}`))[1];
  r = await rcv([{ product_id: p1, qty: 0, rejected_qty: 6 }]); check('all-rejected delivery against the PO -> 201', r[0] === 201, r);
  let p = await getPo(); check('PO stays OPEN with 0 received (still cancellable)', p.status === 'OPEN' && p.items[0].received_qty === 0, p);
  const b0 = await bal(p1);
  r = await rcv([{ product_id: p1, qty: 4, rejected_qty: 2 }]); check('receive 4 accepted + 2 rejected on the PO', r[0] === 201, r);
  p = await getPo(); check('PO is PARTIAL; received counts only the 4 accepted', p.status === 'PARTIAL' && p.items[0].received_qty === 4, p);
  check('stock +4 only', (await bal(p1)) === b0 + 4);
  r = await rcv([{ product_id: p1, qty: 3, rejected_qty: 0 }]); check('cannot accept more than pending (2) even with rejects recorded', r[0] === 400 && /more than/.test(r[1].error), r);
  r = await rcv([{ product_id: p1, qty: 2, rejected_qty: 1 }]); check('replacement delivery of 2 closes the PO', r[0] === 201 && (await getPo()).status === 'CLOSED', r);
} finally {
  const L = `(SELECT id FROM locations WHERE name LIKE 'ZZTEST%')`;
  await exec(`DELETE FROM stock_ledger WHERE location_id IN ${L}`);
  await exec(`DELETE FROM stock_inward WHERE location_id IN ${L}`);
  await exec(`DELETE FROM purchase_orders WHERE supplier_id IN (SELECT id FROM suppliers WHERE name LIKE 'ZZTEST%')`);
  await exec(`DELETE FROM products WHERE sku LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM product_categories WHERE name LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM suppliers WHERE name LIKE 'ZZTEST%'`);
  await exec(`DELETE FROM locations WHERE name LIKE 'ZZTEST%'`);
  const [left] = await raw(`SELECT (SELECT count(*) FROM products WHERE sku LIKE 'ZZTEST%')::int p, (SELECT count(*) FROM suppliers WHERE name LIKE 'ZZTEST%')::int s, (SELECT count(*) FROM locations WHERE name LIKE 'ZZTEST%')::int l, (SELECT count(*) FROM stock_inward_items)::int items`);
  console.log('cleanup leftovers', left, '| failures:', fails);
  await prisma.$disconnect();
}
