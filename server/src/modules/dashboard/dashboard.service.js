import { prisma } from '../../core/prisma.js';

export async function getAdminSummary() {
  const [totals, recent, attention, cycle] = await Promise.all([
    prisma.$queryRaw`
      SELECT count(*)::int AS total,
             (count(*) FILTER (WHERE joined_at >= date_trunc('day', now())))::int AS today,
             (count(*) FILTER (WHERE kyc_status = 'PENDING'))::int AS pending_kyc
        FROM members`,
    prisma.$queryRaw`
      SELECT m.member_code, m.full_name, m.kyc_status, m.joined_at,
             sp.member_code AS sponsor_code, pk.name AS package_name
        FROM members m
        LEFT JOIN members sp ON sp.id = m.sponsor_id
        LEFT JOIN packages pk ON pk.id = m.package_id
       ORDER BY m.id DESC
       LIMIT 5`,
    prisma.$queryRaw`
      SELECT
        (SELECT count(*) FROM epin_requests WHERE status = 'PENDING')::int AS epin_requests,
        (SELECT count(*) FROM joining_package_deliveries WHERE status = 'PENDING')::int AS packages_to_dispatch,
        (SELECT count(*) FROM stock_transfers WHERE status = 'SENT')::int AS transfers_waiting,
        (SELECT count(*) FROM tickets WHERE status = 'OPEN')::int AS open_tickets`,
    prisma.$queryRaw`
      SELECT status, period_from, period_to FROM payout_cycles ORDER BY id DESC LIMIT 1`,
  ]);

  const t = totals[0];
  const a = attention[0];
  return {
    totalMembers: t.total,
    joinedToday: t.today,
    pendingKyc: t.pending_kyc,
    recentJoinings: recent.map((r) => ({
      code: r.member_code,
      name: r.full_name,
      sponsor: r.sponsor_code,
      package: r.package_name,
      kyc: r.kyc_status,
      joinedAt: r.joined_at,
    })),
    attention: {
      epinRequests: a.epin_requests,
      packagesToDispatch: a.packages_to_dispatch,
      transfersWaiting: a.transfers_waiting,
      openTickets: a.open_tickets,
    },
    payoutCycle: cycle[0]
      ? { status: cycle[0].status, from: cycle[0].period_from, to: cycle[0].period_to }
      : null,
  };
}   
export async function getDistributorSummary(userId) {
  const [me] = await prisma.$queryRaw`
    SELECT m.id::text AS id, m.member_code, m.full_name, m.path::text AS path,
           pk.name AS package_name
      FROM members m
      LEFT JOIN packages pk ON pk.id = m.package_id
     WHERE m.user_id = ${userId}::bigint`;
  if (!me) return null;

  const [[down], [epins], volume, recent] = await Promise.all([
    prisma.$queryRaw`
      SELECT count(*)::int AS n FROM members
       WHERE path <@ ${me.path}::ltree AND id <> ${me.id}::bigint`,
    prisma.$queryRaw`SELECT count(*)::int AS n FROM epins WHERE issued_to = ${me.id}::bigint`,
    prisma.$queryRaw`
      SELECT left_volume::float8 AS l, right_volume::float8 AS r
        FROM binary_volume WHERE member_id = ${me.id}::bigint`,
    prisma.$queryRaw`
      SELECT m.full_name, m.joined_at, c.position AS leg
        FROM members m
        JOIN members c ON c.id = subpath(m.path, nlevel(${me.path}::ltree), 1)::text::bigint
       WHERE m.path <@ ${me.path}::ltree AND m.id <> ${me.id}::bigint
       ORDER BY m.id DESC
       LIMIT 5`,
  ]);

  return {
    name: me.full_name,
    code: me.member_code,
    package: me.package_name,
    downline: down.n,
    epinsReceived: epins.n,
    leftVolume: volume[0]?.l ?? 0,
    rightVolume: volume[0]?.r ?? 0,
    recentJoinings: recent.map((r) => ({ name: r.full_name, leg: r.leg, joinedAt: r.joined_at })),
  };
}