require('dotenv').config({ path: './.env' });
const { PrismaClient } = require('./node_modules/@prisma/client');
const { PrismaPg } = require('./node_modules/@prisma/adapter-pg');
const { Pool } = require('./node_modules/pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

// Prisma 7 client requires an adapter when using the "client" engine type.
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const p = new PrismaClient({ adapter });
(async () => {
  const manual = await p.match.findMany({
    select: {
      id: true,
      status: true,
      dataSource: true,
      tournament: { select: { organizationId: true } },
    },
  });
  for (const m of manual) {
    if (m.dataSource !== 'MANUAL') continue;
    const liveLike =
      m.status === 'LIVE' || m.status === 'ENDED' || m.status === 'OFFICIAL';
    const desired = liveLike
      ? { resultsManualLock: false, resultsForceUnlock: false }
      : { resultsManualLock: true, resultsForceUnlock: false };
    await p.matchControlState.upsert({
      where: { matchId: m.id },
      create: {
        matchId: m.id,
        state: 'READY',
        organizationId: m.tournament?.organizationId ?? undefined,
        ...desired,
      },
      update: desired,
    });
  }
  console.log('updated');
  await p.$disconnect();
})();
