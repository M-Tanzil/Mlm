// Bonus engine. Each bonus is a plugin: calculate(period, member) -> commission_ledger rows.
// Use source_ref as an idempotency key (UNIQUE member_id + bonus_code + source_ref).
export async function processBonus(job) {
  // job.name: 'realtime' (on order/joining event) | 'cutoff' (scheduled periodic bonuses)
  console.log('bonus job', job.name, job.data);
  // TODO: implement bonus plugins (see docs/Architecture.md section 4)
}
