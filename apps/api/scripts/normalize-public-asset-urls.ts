/**
 * Normalize stored media URLs so production clients never receive localhost
 * asset links. Run after deploying the URL normalization fix:
 *
 *   npx ts-node scripts/normalize-public-asset-urls.ts
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import { Pool } from 'pg';
import { normalizePublicAssetUrl } from '../src/common/public-asset-url.util';
import { resolveTeamLogoUrl } from '../src/common/team-branding.util';

config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

const pool = new Pool({ connectionString });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

type AssetRecord = {
  id: string;
  [field: string]: string | null;
};

type Updater = (
  id: string,
  data: Record<string, string | null>,
) => Promise<unknown>;

function collectNormalizedFields(
  record: AssetRecord,
  fields: string[],
): Record<string, string | null> {
  const data: Record<string, string | null> = {};
  for (const field of fields) {
    const current = record[field] ?? null;
    const normalized = normalizePublicAssetUrl(current);
    if (normalized !== current) {
      data[field] = normalized;
    }
  }
  return data;
}

function collectNormalizedTeamFields(
  record: AssetRecord,
): Record<string, string | null> {
  const data = collectNormalizedFields(record, [
    'logoUrl',
    'logoLightUrl',
    'logoDarkUrl',
  ]);
  const resolvedLogoUrl = resolveTeamLogoUrl(record.id, record.logoUrl, null);
  if (resolvedLogoUrl !== (record.logoUrl ?? null)) {
    data.logoUrl = resolvedLogoUrl;
  }
  return data;
}

async function normalizeRows(
  label: string,
  rows: AssetRecord[],
  fields: string[],
  update: Updater,
) {
  let updated = 0;
  for (const row of rows) {
    const data = collectNormalizedFields(row, fields);
    if (Object.keys(data).length === 0) {
      continue;
    }
    await update(row.id, data);
    updated += 1;
  }
  console.log(`${label} updated: ${updated}`);
}

async function main() {
  let teamsUpdated = 0;
  const teams = await prisma.team.findMany({
    select: {
      id: true,
      logoUrl: true,
      logoLightUrl: true,
      logoDarkUrl: true,
    },
  });
  for (const team of teams) {
    const data = collectNormalizedTeamFields(team);
    if (Object.keys(data).length === 0) {
      continue;
    }
    await prisma.team.update({ where: { id: team.id }, data });
    teamsUpdated += 1;
  }
  console.log(`Teams updated: ${teamsUpdated}`);

  await normalizeRows(
    'Players',
    await prisma.player.findMany({
      select: {
        id: true,
        photoUrl: true,
      },
    }),
    ['photoUrl'],
    (id, data) => prisma.player.update({ where: { id }, data }),
  );

  await normalizeRows(
    'Tournaments',
    await prisma.tournament.findMany({
      select: {
        id: true,
        logoUrl: true,
        bannerUrl: true,
      },
    }),
    ['logoUrl', 'bannerUrl'],
    (id, data) => prisma.tournament.update({ where: { id }, data }),
  );

  await normalizeRows(
    'Organization branding',
    await prisma.organizationBranding.findMany({
      select: {
        id: true,
        defaultTeamLogoUrl: true,
        defaultPlayerPhotoUrl: true,
      },
    }),
    ['defaultTeamLogoUrl', 'defaultPlayerPhotoUrl'],
    (id, data) => prisma.organizationBranding.update({ where: { id }, data }),
  );
}

main()
  .catch((err) => {
    console.error('normalize-public-asset-urls failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
