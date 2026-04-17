/**
 * Soft-delete an organization and unassign all users/admin links from it.
 *
 * Usage:
 *   npx ts-node scripts/delete-org.ts ORG_ID
 */
import "dotenv/config";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL ?? "";
if (!connectionString) {
  console.error("DATABASE_URL is not set. Aborting.");
  process.exit(1);
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool) as Prisma.PrismaClientOptions["adapter"];
const prisma = new PrismaClient({ adapter });

async function main() {
  const orgId = process.argv[2];
  if (!orgId) {
    console.error("Usage: npx ts-node scripts/delete-org.ts ORG_ID");
    process.exit(1);
  }

  const now = new Date();

  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) {
    console.log("Organization not found, nothing to do.");
    return;
  }

  const users = await prisma.user.updateMany({
    where: { organizationId: orgId },
    data: { organizationId: null },
  });

  const links = await prisma.adminOrganizationLink.deleteMany({
    where: { organizationId: orgId },
  });

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      deletedAt: now,
      isActive: false,
      slug: `${org.slug ?? "org"}__deleted__${now.getTime()}`,
      name: `${org.name ?? "Organization"} (deleted ${now.toISOString()})`,
    },
  });

  console.log(
    JSON.stringify(
      {
        orgId,
        usersUnassigned: users.count,
        adminLinksRemoved: links.count,
        orgSoftDeleted: true,
      },
      null,
      2,
    ),
  );
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
