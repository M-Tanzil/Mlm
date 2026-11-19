import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
// Use prisma.$transaction([...]) or prisma.$transaction(async (tx) => {...})
// for joining, orders, ledger writes and payouts.
// ltree columns (path, sponsor_path) are not modelled by Prisma: use prisma.$queryRaw.
