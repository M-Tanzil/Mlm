import { prisma } from '../../core/prisma.js';
import { forbidden, notFound } from '../../core/errors.js';

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN'];

async function memberByUserId(userId) {
  const [m] = await prisma.$queryRaw`
    SELECT id::text AS id, member_code, path::text AS path, depth,
           sponsor_path::text AS sponsor_path
      FROM members WHERE user_id = ${userId}::bigint`;
  return m;
}

async function memberByCode(code) {
  const [m] = await prisma.$queryRaw`
    SELECT id::text AS id, member_code, path::text AS path, depth,
           sponsor_path::text AS sponsor_path
      FROM members WHERE member_code = ${code}`;
  return m;
}

// Works out which member the caller wants to look at, and checks they are allowed to see it.
// kind = 'binary' | 'generation'
async function resolveRoot(actor, code, kind) {
  if (ADMIN_ROLES.includes(actor.role)) {
    if (code) {
      const m = await memberByCode(code);
      if (!m) throw notFound('Member not found');
      return m;
    }
    // no code: start from the top of the tree
    const [top] = await prisma.$queryRaw`
      SELECT id::text AS id, member_code, path::text AS path, depth,
             sponsor_path::text AS sponsor_path
        FROM members WHERE parent_id IS NULL ORDER BY id LIMIT 1`;
    if (!top) throw notFound('No members yet');
    return top;
  }

  // Distributor: only their own downline
  const me = await memberByUserId(actor.sub);
  if (!me) throw forbidden('No member profile for this user');
  if (!code || code === me.member_code) return me;

  const target = await memberByCode(code);
  if (!target) throw notFound('Member not found');
  const [{ ok }] =
    kind === 'binary'
      ? await prisma.$queryRaw`SELECT (${target.path}::ltree <@ ${me.path}::ltree) AS ok`
      : await prisma.$queryRaw`SELECT (${target.sponsor_path}::ltree <@ ${me.sponsor_path}::ltree) AS ok`;
  if (!ok) throw forbidden('That member is not in your downline');
  return target;
}

// Binary tree, nested: { name, attributes, children }
export async function getBinaryTree(actor, code, depth) {
  const root = await resolveRoot(actor, code, 'binary');
  const maxDepth = root.depth + depth;

  const rows = await prisma.$queryRaw`
    SELECT m.id::text AS id, m.member_code, m.full_name, m.parent_id::text AS parent_id,
           m.position, m.depth, m.status, m.kyc_status, m.joined_at,
           sp.member_code AS sponsor_code, pk.name AS package_name,
           COALESCE(bv.left_volume, 0)::float8 AS left_volume,
           COALESCE(bv.right_volume, 0)::float8 AS right_volume
      FROM members m
      LEFT JOIN members sp ON sp.id = m.sponsor_id
      LEFT JOIN packages pk ON pk.id = m.package_id
      LEFT JOIN binary_volume bv ON bv.member_id = m.id
     WHERE m.path <@ ${root.path}::ltree AND m.depth <= ${maxDepth}::int
     ORDER BY m.depth, m.id`;

  const nodes = new Map();
  for (const r of rows) {
    nodes.set(r.id, {
      name: r.full_name,
      attributes: {
        code: r.member_code,
        position: r.position,
        status: r.status,
        depth: r.depth,
        kyc: r.kyc_status,
        joinedAt: r.joined_at,
        sponsor: r.sponsor_code,
        package: r.package_name,
        leftVolume: r.left_volume,
        rightVolume: r.right_volume,
      },
      children: [],
    });
  }
  for (const r of rows) {
    const parent = r.parent_id && nodes.get(r.parent_id);
    if (parent && r.id !== root.id) {
      // keep LEFT before RIGHT
      parent.children[r.position === 'L' ? 'unshift' : 'push'](nodes.get(r.id));
    }
  }
  return nodes.get(root.id);
}

// Sponsor downline grouped by level (level 1 = directly sponsored)
export async function getGenerationLevels(actor, code, levels) {
  const root = await resolveRoot(actor, code, 'generation');

  const rows = await prisma.$queryRaw`
    SELECT member_code, full_name, status, joined_at,
           (nlevel(sponsor_path) - nlevel(${root.sponsor_path}::ltree))::int AS level
      FROM members
     WHERE sponsor_path <@ ${root.sponsor_path}::ltree
       AND nlevel(sponsor_path) - nlevel(${root.sponsor_path}::ltree) BETWEEN 1 AND ${levels}::int
     ORDER BY level, id`;

  const grouped = new Map();
  for (const r of rows) {
    if (!grouped.has(r.level)) grouped.set(r.level, []);
    grouped.get(r.level).push({
      code: r.member_code,
      name: r.full_name,
      status: r.status,
      joinedAt: r.joined_at,
    });
  }
  return {
    root: root.member_code,
    total: rows.length,
    levels: [...grouped.entries()].map(([level, members]) => ({
      level,
      count: members.length,
      members,
    })),
  };
}
