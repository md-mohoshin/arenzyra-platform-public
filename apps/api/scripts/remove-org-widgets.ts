/**
 * Remove specific widgets for a single organization (transactional + scoped).
 *
 * Usage:
 *   npx ts-node scripts/remove-org-widgets.ts
 *
 * Safety guarantees:
 * - Filters by the fixed organizationId below (current impersonated org).
 * - Deletes in required order: WidgetInstance -> WidgetVersion -> WidgetPreset -> Widget.
 * - Runs in a single database transaction.
 */
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const ORGANIZATION_ID = '3ff7055f-8da8-41b2-befb-4e1532c6e8d4';
const TARGET_KEYS: string[] = [
  'match-info',
  'match-intro',
  'teams-lineup',
  'countdown',
  'overall-ranking',
];

const connectionString = process.env.DATABASE_URL ?? '';
if (!connectionString) {
  console.error('DATABASE_URL is not set. Aborting.');
  process.exit(1);
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool) as Prisma.PrismaClientOptions['adapter'];
const prisma = new PrismaClient({ adapter });

type DeleteCounts = {
  widgetInstances: number;
  widgetVersions: number;
  widgetPresets: number;
  widgets: number;
};

async function main() {
  console.log(
    `Deleting widgets for org ${ORGANIZATION_ID} with keys: ${TARGET_KEYS.join(
      ', ',
    )}`,
  );

  const result: DeleteCounts = await prisma.$transaction(async (tx) => {
    const widgetInstances = await tx.widgetInstance.deleteMany({
      where: {
        organizationId: ORGANIZATION_ID,
        widgetKey: { in: TARGET_KEYS },
      },
    });

    const widgetVersions = await tx.widgetVersion.deleteMany({
      where: {
        organizationId: ORGANIZATION_ID,
        widgetKey: { in: TARGET_KEYS },
      },
    });

    const widgetPresets = await tx.widgetPreset.deleteMany({
      where: {
        organizationId: ORGANIZATION_ID,
        widgetKey: { in: TARGET_KEYS },
      },
    });

    const widgets = await tx.widget.deleteMany({
      where: {
        organizationId: ORGANIZATION_ID,
        key: { in: TARGET_KEYS },
      },
    });

    return {
      widgetInstances: widgetInstances.count,
      widgetVersions: widgetVersions.count,
      widgetPresets: widgetPresets.count,
      widgets: widgets.count,
    };
  });

  console.log('Delete counts:', JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error('remove-org-widgets failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
