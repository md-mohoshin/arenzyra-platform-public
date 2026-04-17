/**
 * Hard-delete a single match and clear the main Redis-backed runtime keys.
 *
 * Usage:
 *   npx ts-node scripts/hard-delete-match.ts MATCH_ID --yes
 *   npx ts-node scripts/hard-delete-match.ts MATCH_ID --dry-run
 */
import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import Redis from "ioredis";

const connectionString = process.env.DATABASE_URL ?? "";
if (!connectionString) {
  console.error("DATABASE_URL is not set. Aborting.");
  process.exit(1);
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool) as Prisma.PrismaClientOptions["adapter"];
const prisma = new PrismaClient({ adapter });

const args = process.argv.slice(2);
const matchId = args.find((arg) => !arg.startsWith("--")) ?? null;
const confirmed = args.includes("--yes");
const dryRun = args.includes("--dry-run");

const redisKeysForMatch = (id: string) => [
  `match-control:state:${id}`,
  `live-match:state:${id}`,
  `pcob:telemetry:snapshot:${id}`,
  `pcob:telemetry:dedupe:${id}`,
];

async function main() {
  if (!matchId) {
    console.error(
      "Usage: npx ts-node scripts/hard-delete-match.ts MATCH_ID [--yes] [--dry-run]",
    );
    process.exit(1);
  }

  const match = await prisma.match.findFirst({
    where: { id: matchId },
    select: {
      id: true,
      name: true,
      matchNumber: true,
      status: true,
      liveState: true,
      deletedAt: true,
      tournamentId: true,
      stageId: true,
      groupId: true,
      organizationId: true,
    },
  });

  if (!match) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          matchId,
          deleted: false,
          reason: "MATCH_NOT_FOUND",
        },
        null,
        2,
      ),
    );
    return;
  }

  const dependentCounts = {
    controlState: await prisma.matchControlState.count({ where: { matchId } }),
    events: await prisma.matchEvent.count({ where: { matchId } }),
    slots: await prisma.matchSlot.count({ where: { matchId } }),
    teams: await prisma.matchTeam.count({ where: { matchId } }),
    slotResults: await prisma.matchSlotResult.count({ where: { matchId } }),
    matchPlayers: await prisma.matchPlayer.count({ where: { matchId } }),
    telemetryLogs: await prisma.telemetryEventLog.count({ where: { matchId } }),
    widgetInstances: await prisma.widgetInstance.count({ where: { matchId } }),
  };

  const redisKeys = redisKeysForMatch(matchId);
  const preview = {
    ok: true,
    dryRun,
    confirmed,
    match: {
      id: match.id,
      name: match.name,
      matchNumber: match.matchNumber,
      status: match.status,
      liveState: match.liveState,
      deletedAt: match.deletedAt,
      tournamentId: match.tournamentId,
      stageId: match.stageId,
      groupId: match.groupId,
      organizationId: match.organizationId,
    },
    dependentCounts,
    redisKeys,
  };

  if (dryRun) {
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  if (!confirmed) {
    console.error(
      JSON.stringify(
        {
          ...preview,
          ok: false,
          reason: "CONFIRMATION_REQUIRED",
          message: "Re-run with --yes to hard-delete this match.",
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  await prisma.match.delete({ where: { id: matchId } });

  let redisDeletedKeys = 0;
  let redisWarning: string | null = null;
  const redisUrl = process.env.REDIS_URL?.trim() ?? "";
  if (redisUrl) {
    const redis = new Redis(redisUrl);
    try {
      redisDeletedKeys = await redis.del(...redisKeys);
    } catch (error) {
      redisWarning =
        error instanceof Error ? error.message : String(error ?? "Redis cleanup failed");
    } finally {
      redis.disconnect();
    }
  } else {
    redisWarning =
      "REDIS_URL not configured; restart the API if it is running with in-memory match state.";
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        matchId,
        deleted: true,
        cascadedCountsPreview: dependentCounts,
        redisDeletedKeys,
        redisWarning,
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
