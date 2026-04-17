/**
 * Backfill canonical match telemetry provider state and clear stale PCOB fields.
 *
 * Run with:
 *   npx ts-node scripts/backfill-match-telemetry-provider.ts
 *   npx ts-node scripts/backfill-match-telemetry-provider.ts --apply
 */

import 'dotenv/config';
import {
  MATCH_TELEMETRY_BACKFILL_SELECT,
  analyzeMatchTelemetryBackfill,
  type MatchTelemetryBackfillFixCategory,
  type MatchTelemetryBackfillReviewCategory,
} from '../src/common/match-telemetry-backfill.util';
import { PrismaService } from '../src/db/prisma.service';

const prisma = new PrismaService();
const DEFAULT_BATCH_SIZE = 200;
const MANUAL_REVIEW_SAMPLE_LIMIT = 25;

type BackfillOptions = {
  apply: boolean;
};

type ManualReviewRow = {
  id: string;
  categories: MatchTelemetryBackfillReviewCategory[];
  notes: string[];
  dataSource: string;
  dataMode: string;
  pcobMode: string;
  pcobSessionId: string;
  adapterKey: string;
};

const formatNullable = (value: unknown): string =>
  value === null || value === undefined || value === ''
    ? 'null'
    : String(value);

const sortEntries = <T extends string>(
  counts: Map<T, number>,
): Array<[T, number]> =>
  Array.from(counts.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );

const addCounts = <T extends string>(
  counts: Map<T, number>,
  categories: T[],
) => {
  categories.forEach((category) => {
    counts.set(category, (counts.get(category) ?? 0) + 1);
  });
};

const parseArgs = (argv: string[]): BackfillOptions => ({
  apply: argv.includes('--apply'),
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const fixCounts = new Map<MatchTelemetryBackfillFixCategory, number>();
  const reviewCounts = new Map<MatchTelemetryBackfillReviewCategory, number>();
  const manualReviewRows: ManualReviewRow[] = [];

  let scanned = 0;
  let unchanged = 0;
  let normalized = 0;
  let applied = 0;
  let flagged = 0;
  let cursorId: string | null = null;

  while (true) {
    const rows = await prisma.match.findMany({
      where: { deletedAt: null },
      orderBy: { id: 'asc' },
      take: DEFAULT_BATCH_SIZE,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      select: MATCH_TELEMETRY_BACKFILL_SELECT,
    });

    if (!rows.length) break;

    for (const row of rows) {
      scanned += 1;
      const result = analyzeMatchTelemetryBackfill(row);

      if (result.action === 'manual-review') {
        flagged += 1;
        addCounts(reviewCounts, result.reviewCategories);
        if (manualReviewRows.length < MANUAL_REVIEW_SAMPLE_LIMIT) {
          manualReviewRows.push({
            id: row.id,
            categories: result.reviewCategories,
            notes: result.notes,
            dataSource: formatNullable(row.dataSource),
            dataMode: formatNullable(row.dataMode),
            pcobMode: formatNullable(row.pcobMode),
            pcobSessionId: formatNullable(row.pcobSessionId),
            adapterKey: formatNullable(row.adapterKey),
          });
        }
        continue;
      }

      if (result.action === 'normalize') {
        normalized += 1;
        addCounts(fixCounts, result.fixCategories);
        if (options.apply) {
          await prisma.match.update({
            where: { id: row.id },
            data: result.data,
          });
          applied += 1;
        }
        continue;
      }

      unchanged += 1;
    }

    cursorId = rows[rows.length - 1]?.id ?? null;
  }

  console.log(`Mode: ${options.apply ? 'apply' : 'dry-run'}`);
  console.log(`Rows scanned: ${scanned}`);
  console.log(`Rows normalized automatically: ${normalized}`);
  console.log(`Rows unchanged: ${unchanged}`);
  if (options.apply) {
    console.log(`Rows updated: ${applied}`);
  }
  console.log(`Rows flagged for manual review: ${flagged}`);

  console.log('Fix categories:');
  const fixEntries = sortEntries(fixCounts);
  if (!fixEntries.length) {
    console.log('  none');
  } else {
    fixEntries.forEach(([category, count]) => {
      console.log(`  ${category}: ${count}`);
    });
  }

  console.log('Manual review categories:');
  const reviewEntries = sortEntries(reviewCounts);
  if (!reviewEntries.length) {
    console.log('  none');
  } else {
    reviewEntries.forEach(([category, count]) => {
      console.log(`  ${category}: ${count}`);
    });
  }

  console.log('Manual review sample rows:');
  if (!manualReviewRows.length) {
    console.log('  none');
  } else {
    manualReviewRows.forEach((row) => {
      console.log(
        `  ${row.id} categories=${row.categories.join(',')} dataSource=${row.dataSource} dataMode=${row.dataMode} pcobMode=${row.pcobMode} pcobSessionId=${row.pcobSessionId} adapterKey=${row.adapterKey}`,
      );
      row.notes.forEach((note) => console.log(`    note=${note}`));
    });
  }
}

main()
  .catch((err) => {
    console.error('backfill-match-telemetry-provider failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.onModuleDestroy();
  });
