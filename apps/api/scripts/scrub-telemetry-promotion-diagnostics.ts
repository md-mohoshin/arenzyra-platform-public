/**
 * Remove player-level fields from persisted telemetry promotion diagnostics.
 *
 * Usage:
 *   npx ts-node scripts/scrub-telemetry-promotion-diagnostics.ts --dry-run
 *   npx ts-node scripts/scrub-telemetry-promotion-diagnostics.ts --yes
 *   npx ts-node scripts/scrub-telemetry-promotion-diagnostics.ts --match-id MATCH_ID --yes
 */
import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import {
  sanitizeTelemetryPromotionDiagnostics,
  summarizeTelemetryPromotionDiagnosticsScrub,
} from '../src/modules/telemetry/telemetry-promotion-diagnostics.util';

const connectionString = process.env.DATABASE_URL ?? '';
if (!connectionString) {
  console.error('DATABASE_URL is not set. Aborting.');
  process.exit(1);
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool) as Prisma.PrismaClientOptions['adapter'];
const prisma = new PrismaClient({ adapter });

const args = process.argv.slice(2);
const confirmed = args.includes('--yes');
const dryRun = args.includes('--dry-run') || !confirmed;

const readFlagValue = (flag: string): string | null => {
  const index = args.indexOf(flag);
  if (index < 0) {
    return null;
  }
  return args[index + 1] ?? null;
};

const matchId = readFlagValue('--match-id');

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

type ScrubbedMatchPreview = {
  matchId: string;
  organizationId: string;
  teamsTouched: number;
  rawPlayerNamesRemoved: number;
  rawPlayerIdentifiersRemoved: number;
  rosterPlayerNamesRemoved: number;
};

async function main() {
  if (args.includes('--help')) {
    console.log(
      [
        'Usage:',
        '  npx ts-node scripts/scrub-telemetry-promotion-diagnostics.ts --dry-run',
        '  npx ts-node scripts/scrub-telemetry-promotion-diagnostics.ts --yes',
        '  npx ts-node scripts/scrub-telemetry-promotion-diagnostics.ts --match-id MATCH_ID --yes',
      ].join('\n'),
    );
    return;
  }

  if (args.includes('--match-id') && !matchId) {
    console.error('--match-id requires a value.');
    process.exit(1);
  }

  const rows = await prisma.matchControlState.findMany({
    where: matchId ? { matchId } : undefined,
    select: {
      id: true,
      matchId: true,
      organizationId: true,
      metaJson: true,
    },
    orderBy: { updatedAt: 'desc' },
  });

  let scannedRows = 0;
  let candidateRows = 0;
  let updatedRows = 0;
  let totalRawPlayerNamesRemoved = 0;
  let totalRawPlayerIdentifiersRemoved = 0;
  let totalRosterPlayerNamesRemoved = 0;
  const matchesPreview: ScrubbedMatchPreview[] = [];

  for (const row of rows) {
    scannedRows += 1;
    const metaJson = asRecord(row.metaJson);
    if (!metaJson || !('telemetryPromotionDiagnostics' in metaJson)) {
      continue;
    }

    const summary = summarizeTelemetryPromotionDiagnosticsScrub(
      metaJson.telemetryPromotionDiagnostics,
    );
    if (summary.teamsTouched === 0) {
      continue;
    }

    candidateRows += 1;
    totalRawPlayerNamesRemoved += summary.rawPlayerNamesRemoved;
    totalRawPlayerIdentifiersRemoved += summary.rawPlayerIdentifiersRemoved;
    totalRosterPlayerNamesRemoved += summary.rosterPlayerNamesRemoved;
    matchesPreview.push({
      matchId: row.matchId,
      organizationId: row.organizationId,
      teamsTouched: summary.teamsTouched,
      rawPlayerNamesRemoved: summary.rawPlayerNamesRemoved,
      rawPlayerIdentifiersRemoved: summary.rawPlayerIdentifiersRemoved,
      rosterPlayerNamesRemoved: summary.rosterPlayerNamesRemoved,
    });

    if (dryRun) {
      continue;
    }

    const nextMetaJson = {
      ...metaJson,
      telemetryPromotionDiagnostics: sanitizeTelemetryPromotionDiagnostics(
        metaJson.telemetryPromotionDiagnostics,
      ),
    };

    await prisma.matchControlState.update({
      where: { id: row.id },
      data: {
        metaJson: nextMetaJson as Prisma.InputJsonValue,
      },
    });
    updatedRows += 1;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun,
        matchId: matchId ?? null,
        scannedRows,
        candidateRows,
        updatedRows,
        totalRawPlayerNamesRemoved,
        totalRawPlayerIdentifiersRemoved,
        totalRosterPlayerNamesRemoved,
        matchesPreview,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
