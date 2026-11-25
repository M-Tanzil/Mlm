// Measures the candidate indexes of prisma/sql/006_performance_indexes.sql on synthetic data.
//   cd server && node tests/perf-indexes.mjs
// Everything happens in TEMP tables inside one transaction that is rolled back: no real table is read or written.
import { prisma } from '../src/core/prisma.js';

const ms = async (tx, sql) => {
  const [r] = await tx.$queryRawUnsafe(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`);
  const plan = r['QUERY PLAN'][0];
  const node = JSON.stringify(plan.Plan);
  return { ms: plan['Execution Time'], scan: /Index (Only )?Scan|Bitmap Index/.test(node) ? 'index' : 'seq scan' };
};

const QUERIES = {
  'order detail: items of one order (order_items.order_id)': 'SELECT * FROM t_items WHERE order_id = 54321',
  'ticket thread: messages of one ticket (ticket_messages.ticket_id)': 'SELECT * FROM t_msgs WHERE ticket_id = 777 ORDER BY id',
  'my in-app notifications (notifications.user_id)': `SELECT * FROM t_notes WHERE user_id = 123 AND channel = 'INAPP' ORDER BY id DESC LIMIT 20`,
  'depo order list: location + status, newest first (orders)': `SELECT * FROM t_orders WHERE location_id = 7 AND status = 'CONFIRMED' ORDER BY created_at DESC LIMIT 20`,
  'return status per delivery (package_returns.delivery_id)': `SELECT status FROM t_returns WHERE delivery_id = 4242 AND status IN ('REQUESTED','CONFIRMED') LIMIT 1`,
};
const INDEXES = [
  'CREATE INDEX ON t_items(order_id)',
  'CREATE INDEX ON t_msgs(ticket_id)',
  'CREATE INDEX ON t_notes(user_id, id DESC)',
  'CREATE INDEX ON t_orders(location_id, status, created_at DESC)',
  'CREATE INDEX ON t_returns(delivery_id, status)',
];

class Rollback extends Error {}
const out = {};
try {
  await prisma.$transaction(async (tx) => {
    const q = (s) => tx.$executeRawUnsafe(s);
    await q(`CREATE TEMP TABLE t_orders AS SELECT g AS id, g % 5000 AS member_id, g % 40 AS location_id,
      (ARRAY['PLACED','CONFIRMED','DISPATCHED','DELIVERED'])[1 + g % 4] AS status, now() - (g || ' minutes')::interval AS created_at FROM generate_series(1, 200000) g`);
    await q(`CREATE TEMP TABLE t_items AS SELECT g AS id, 1 + (g % 200000) AS order_id, g % 300 AS product_id, 1 AS qty FROM generate_series(1, 600000) g`);
    await q(`CREATE TEMP TABLE t_msgs AS SELECT g AS id, 1 + (g % 40000) AS ticket_id, 'x' || g AS body FROM generate_series(1, 300000) g`);
    await q(`CREATE TEMP TABLE t_notes AS SELECT g AS id, 1 + (g % 5000) AS user_id, (ARRAY['INAPP','EMAIL','SMS'])[1 + g % 3] AS channel FROM generate_series(1, 600000) g`);
    await q(`CREATE TEMP TABLE t_returns AS SELECT g AS id, g AS delivery_id, (ARRAY['REQUESTED','CONFIRMED','REJECTED'])[1 + g % 3] AS status FROM generate_series(1, 100000) g`);
    for (const t of ['t_orders', 't_items', 't_msgs', 't_notes', 't_returns']) await q(`ANALYZE ${t}`);
    for (const [name, sql] of Object.entries(QUERIES)) out[name] = { before: await ms(tx, sql) };
    for (const i of INDEXES) await q(i);
    for (const t of ['t_orders', 't_items', 't_msgs', 't_notes', 't_returns']) await q(`ANALYZE ${t}`);
    for (const [name, sql] of Object.entries(QUERIES)) out[name].after = await ms(tx, sql);
    throw new Rollback('done'); // discard everything
  }, { timeout: 170_000, maxWait: 30_000 });
} catch (e) {
  if (!(e instanceof Rollback) && !/done/.test(e.message)) throw e;
} finally { await prisma.$disconnect(); }
for (const [name, r] of Object.entries(out)) {
  const f = (x) => `${x.ms.toFixed(2).padStart(9)} ms (${x.scan})`;
  console.log(`${name}\n   without index: ${f(r.before)}\n   with index:    ${f(r.after)}   x${(r.before.ms / Math.max(r.after.ms, 0.01)).toFixed(0)} faster`);
}
