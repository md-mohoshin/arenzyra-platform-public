/**
 * WARNING:
 * This script permanently deletes organizations and cascades to OBS widget instances.
 * NEVER run this script in production.
 * Running this in prod will irreversibly break OBS browser source URLs.
 *
 * Hard delete specific organizations and all dependent records.
 * Update the orgIds array below with the targets to remove.
 *
 * Run: npx ts-node scripts/purge-orgs.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

// Force Prisma to use the binary engine (avoid WASM issues).
process.env.PRISMA_CLIENT_ENGINE_TYPE = process.env.PRISMA_CLIENT_ENGINE_TYPE || "binary";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaClient } = require("@prisma/client") as typeof import("@prisma/client");

if (process.env.NODE_ENV === "production") {
  const message =
    "Blocked: purge-orgs.ts must never run in production because it would delete organizations and destroy OBS widget instances/keys, breaking browser source URLs.";
  console.error(message);
  throw new Error(message);
}

// IDs to delete (fill from the user request)
const orgIds = [
  "427bc219-df8e-4334-af3e-0c674d785f34",
  "2e403f82-0fed-4e2f-a08c-984e5b6494c0",
];

// Ensure DB URL present
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  if (orgIds.length === 0) {
    console.log("No org IDs specified.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.adminOrganizationLink.deleteMany({ where: { organizationId: { in: orgIds } } });
    await tx.organizerFeature.deleteMany({ where: { organizationId: { in: orgIds } } });
    await tx.organizationFeature.deleteMany({ where: { organizationId: { in: orgIds } } });
    await tx.organizationBranding.deleteMany({ where: { organizationId: { in: orgIds } } });
    await tx.widget.deleteMany({ where: { organizationId: { in: orgIds } } });
    await tx.widgetPreset.deleteMany({ where: { organizationId: { in: orgIds } } });
    await tx.widgetVersion.deleteMany({ where: { organizationId: { in: orgIds } } });
    await tx.oBSScene.deleteMany({ where: { organizationId: { in: orgIds } } });
    await tx.oBSTemplate.deleteMany({ where: { organizationId: { in: orgIds } } });
    await tx.tournamentTeam.deleteMany({ where: { team: { organizationId: { in: orgIds } } } });
    await tx.teamAlias.deleteMany({ where: { team: { organizationId: { in: orgIds } } } });
    await tx.match.deleteMany({ where: { organizationId: { in: orgIds } } });
    await tx.ruleset.deleteMany({ where: { orgId: { in: orgIds } } });
    await tx.tournament.deleteMany({ where: { organizationId: { in: orgIds } } });
    await tx.team.deleteMany({ where: { organizationId: { in: orgIds } } });
    await tx.player.deleteMany({ where: { organizationId: { in: orgIds } } });
    await tx.walletTransaction.deleteMany({
      where: { wallet: { organizationId: { in: orgIds } } },
    });
    await tx.wallet.deleteMany({ where: { organizationId: { in: orgIds } } });
    await tx.user.deleteMany({ where: { organizationId: { in: orgIds } } });
    await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  console.log("Deleted orgs:", orgIds);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
