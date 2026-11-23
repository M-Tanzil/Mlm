import bcrypt from 'bcrypt';
import { prisma } from '../../core/prisma.js';
import { AppError, badRequest, forbidden, notFound } from '../../core/errors.js';

// Next human-readable member code: MB0000001, MB0000002, ...
async function nextMemberCode(tx) {
  const [row] = await tx.$queryRaw`
    INSERT INTO sequences (name, prefix, next_value) VALUES ('member', 'MB', 2)
    ON CONFLICT (name) DO UPDATE SET next_value = sequences.next_value + 1
    RETURNING prefix, (next_value - 1)::int AS num`;
  return `${row.prefix}${String(row.num).padStart(7, '0')}`;
}

async function findByCode(tx, code) {
  const [m] = await tx.$queryRaw`
    SELECT id::text AS id, member_code, path::text AS path, depth,
           sponsor_path::text AS sponsor_path
      FROM members WHERE member_code = ${code}`;
  return m;
}

// First free binary slot under the sponsor: shallowest level first, LEFT before RIGHT
async function autoPlace(tx, sponsorPath) {
  const [slot] = await tx.$queryRaw`
        SELECT m.id::text AS id, m.member_code, m.path::text AS path, m.depth, s.pos
      FROM members m
     CROSS JOIN (VALUES ('L'), ('R')) AS s(pos)
     WHERE m.path <@ ${sponsorPath}::ltree
       AND NOT EXISTS (SELECT 1 FROM members c WHERE c.parent_id = m.id AND c.position = s.pos)
     ORDER BY m.depth, m.id, s.pos
     LIMIT 1`;
  return slot;
}

export async function registerMember(actor, input) {
  const { fullName, mobile, email, password, sponsorCode, parentCode, position, packageId } = input;

  // Hash outside the transaction: bcrypt is slow and would eat into the transaction timeout
  const hash = await bcrypt.hash(password, 12);

  try {
    return await prisma.$transaction(
      async (tx) => {
        // 1. Who is the sponsor?
        let sponsor = null;
        if (actor.role === 'DISTRIBUTOR') {
          const [me] = await tx.$queryRaw`
            SELECT id::text AS id, member_code, path::text AS path, depth,
                   sponsor_path::text AS sponsor_path
              FROM members WHERE user_id = ${actor.sub}::bigint`;
          if (!me) throw forbidden('No member profile for this user');
          sponsor = me;
        } else if (sponsorCode) {
          sponsor = await findByCode(tx, sponsorCode);
          if (!sponsor) throw notFound('Sponsor not found');
        } else {
          const [{ c }] = await tx.$queryRaw`SELECT count(*)::int AS c FROM members`;
          if (c > 0) throw badRequest('sponsorCode is required');
          // else: this is the very first member (root of the tree)
        }

        // 2. Where in the binary tree?
        let parent = null;
        let pos = null;
        if (sponsor) {
          if (parentCode && position) {
            parent = await findByCode(tx, parentCode);
            if (!parent) throw notFound('Parent not found');
            const [{ ok }] = await tx.$queryRaw`
              SELECT (${parent.path}::ltree <@ ${sponsor.path}::ltree) AS ok`;
            if (!ok) throw badRequest('Parent is not in the sponsor binary downline');
            const [taken] = await tx.$queryRaw`
              SELECT 1 AS x FROM members WHERE parent_id = ${parent.id}::bigint AND position = ${position}`;
            if (taken) throw new AppError(409, 'That binary slot is already taken');
            pos = position;
          } else {
            const slot = await autoPlace(tx, sponsor.path);
            if (!slot) throw new AppError(500, 'No free slot found');
            parent = slot;
            pos = slot.pos;
          }
        }

        // 3. Login + member rows
        const memberCode = await nextMemberCode(tx);
        const [user] = await tx.$queryRaw`
          INSERT INTO users (role_id, login_id, email, mobile, password_hash)
          SELECT id, ${memberCode}, ${email ?? null}::citext, ${mobile ?? null}, ${hash}
            FROM roles WHERE code = 'DISTRIBUTOR'
          RETURNING id::text AS id`;

        const depth = parent ? parent.depth + 1 : 0;
        const [m] = await tx.$queryRaw`
          INSERT INTO members (member_code, user_id, sponsor_id, parent_id, position,
                               path, depth, package_id, full_name)
          VALUES (${memberCode}, ${user.id}::bigint, ${sponsor?.id ?? null}::bigint,
                  ${parent?.id ?? null}::bigint, ${pos}, 'tmp'::ltree, ${depth}::int,
                  ${packageId ?? null}::bigint, ${fullName})
          RETURNING id::text AS id`;

        // 4. Paths use the member id as the label (needs the id, so set after insert)
        const binaryPath = parent ? `${parent.path}.${m.id}` : m.id;
        const sponsorPath = sponsor ? `${sponsor.sponsor_path}.${m.id}` : m.id;
        await tx.$executeRaw`
          UPDATE members SET path = ${binaryPath}::ltree, sponsor_path = ${sponsorPath}::ltree
           WHERE id = ${m.id}::bigint`;
        await tx.$executeRaw`INSERT INTO binary_volume (member_id) VALUES (${m.id}::bigint)`;

        return {
          memberId: m.id,
          memberCode,
          loginId: memberCode,
          sponsorCode: sponsor?.member_code ?? null,
          parentCode: parent?.member_code ?? null,
          position: pos,
        };
      },
      { maxWait: 10000, timeout: 30000 }
    );
  } catch (e) {
    // 23505 = unique violation (email already used, or two people took the same slot)
    if (e?.meta?.code === '23505') {
      throw new AppError(409, 'Email or binary slot already in use');
    }
    throw e;
  }
}