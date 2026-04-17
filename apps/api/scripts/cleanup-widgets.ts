/**
 * WARNING:
 * This script deletes widget records and presets.
 * Running this in production may break backward compatibility
 * for existing OBS widget URLs.
 *
 * Cleanup and seed widget data to align with the new WidgetKit registry.
 *
 * - Removes Widget / WidgetPreset / WidgetVersion rows for deprecated widget keys.
 * - Seeds a minimal "live-ranking" widget, default preset, and stable version per organization.
 *
 * Run with:
 *   npx ts-node scripts/cleanup-widgets.ts
 */

import { PrismaClient, WidgetKind, WidgetVersionStatus, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const ALLOWED_KEYS = ['live-ranking'];
const DEFAULT_VERSION = '1.0.0';

if (process.env.NODE_ENV === "production") {
  const message =
    "Blocked: cleanup-widgets.ts must never run in production because it would delete widget records/presets and could break existing OBS widget URLs/keys.";
  console.error(message);
  throw new Error(message);
}

async function seedLiveRanking(orgId: string) {
  const widget = await prisma.widget.upsert({
    where: { organizationId_key: { organizationId: orgId, key: 'live-ranking' } },
    create: {
      organizationId: orgId,
      key: 'live-ranking',
      name: 'Live Ranking',
      description: 'Live ranking widget (WidgetKit)',
      kind: WidgetKind.LIVE_RANKING,
      config: Prisma.JsonNull,
    },
    update: {
      name: 'Live Ranking',
      kind: WidgetKind.LIVE_RANKING,
      config: Prisma.JsonNull,
    },
  });

  await prisma.widgetPreset.upsert({
    where: {
      organizationId_widgetKey_name: {
        organizationId: orgId,
        widgetKey: 'live-ranking',
        name: 'Default',
      },
    },
    create: {
      organizationId: orgId,
      widgetId: widget.id,
      widgetKey: 'live-ranking',
      name: 'Default',
      description: 'Default preset seeded by cleanup-widgets',
      config: Prisma.JsonNull,
      isDefault: true,
    },
    update: {
      widgetId: widget.id,
      isDefault: true,
      config: Prisma.JsonNull,
    },
  });

  await prisma.widgetVersion.upsert({
    where: {
      organizationId_widgetKey_version: {
        organizationId: orgId,
        widgetKey: 'live-ranking',
        version: DEFAULT_VERSION,
      },
    },
    create: {
      organizationId: orgId,
      widgetKey: 'live-ranking',
      version: DEFAULT_VERSION,
      status: WidgetVersionStatus.STABLE,
      configSchema: Prisma.JsonNull,
      publishedAt: new Date(),
    },
    update: {
      status: WidgetVersionStatus.STABLE,
      publishedAt: new Date(),
      configSchema: Prisma.JsonNull,
    },
  });
}

async function main() {
  console.log('Cleaning widget tables...');

  await prisma.widgetPreset.deleteMany({ where: { widgetKey: { notIn: ALLOWED_KEYS } } });
  await prisma.widgetVersion.deleteMany({ where: { widgetKey: { notIn: ALLOWED_KEYS } } });
  await prisma.widget.deleteMany({ where: { key: { notIn: ALLOWED_KEYS } } });

  const orgs = await prisma.organization.findMany({ select: { id: true } });
  console.log(`Seeding live-ranking for ${orgs.length} organization(s)...`);

  for (const org of orgs) {
    await seedLiveRanking(org.id);
  }

  console.log('Widget cleanup and seed completed.');
}

main()
  .catch((err) => {
    console.error('cleanup-widgets failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
