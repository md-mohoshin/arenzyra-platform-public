/**
 * Backfill default team logos and player photos where missing.
 *
 * Run with:
 *   npx ts-node scripts/backfill-default-logos.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_TEAM_LOGO = '/assets/defaults/default-team.png';
const DEFAULT_PLAYER_PHOTO = '/assets/defaults/default-player.png';

async function main() {
  const [teams, players] = await prisma.$transaction([
    prisma.team.updateMany({
      where: { logoUrl: null, deletedAt: null },
      data: { logoUrl: DEFAULT_TEAM_LOGO },
    }),
    prisma.player.updateMany({
      where: { photoUrl: null, deletedAt: null },
      data: { photoUrl: DEFAULT_PLAYER_PHOTO },
    }),
  ]);

  console.log(`Teams updated: ${teams.count}`);
  console.log(`Players updated: ${players.count}`);
}

main()
  .catch((err) => {
    console.error('backfill-default-logos failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
