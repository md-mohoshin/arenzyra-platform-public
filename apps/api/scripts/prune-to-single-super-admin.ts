/**
 * Danger: one-way cleanup helper.
 * Keeps exactly one SUPER_ADMIN user (by email), resetting its password and org,
 * and deletes all other users. Intended for local/dev databases only.
 *
 * Usage:
 *   KEEP_SUPER_EMAIL="<required>" KEEP_SUPER_PASSWORD="<required>" \
 *   npx ts-node scripts/prune-to-single-super-admin.ts
 */
import "dotenv/config";
import path from "node:path";
import * as bcrypt from "bcrypt";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

// Force Prisma to use the binary engine (WASM can fail under ts-node on Windows).
process.env.PRISMA_CLIENT_ENGINE_TYPE = process.env.PRISMA_CLIENT_ENGINE_TYPE || "binary";

// Require after engine choice is set to ensure the binary loader is used.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const prismaPkg = require("@prisma/client") as typeof import("@prisma/client");

// Ensure .env from project root is loaded when run from scripts/
if (!process.env.DATABASE_URL) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
}

// Force Prisma to use the Node-API (binary) engine to avoid WASM issues in ts-node.
if (!process.env.PRISMA_CLIENT_ENGINE_TYPE) {
  process.env.PRISMA_CLIENT_ENGINE_TYPE = "binary";
}

const { PrismaClient, Role, UserStatus, OrganizationStatus } = prismaPkg as typeof import("@prisma/client");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`REQUIRED ENV VARIABLE MISSING: ${name}`);
  }
  return value;
}

async function main() {
  const keepEmail = requireEnv("KEEP_SUPER_EMAIL");
  const keepPassword = requireEnv("KEEP_SUPER_PASSWORD");

  const hashed = await bcrypt.hash(keepPassword, 12);

  // Ensure there is at least one org to attach the super admin to.
  const org = await prisma.organization.upsert({
    where: { slug: "default-org" },
    update: { status: OrganizationStatus.APPROVED, deletedAt: null },
    create: {
      name: "Default Organization",
      slug: "default-org",
      status: OrganizationStatus.APPROVED,
    },
  });

  // Upsert the super admin we want to keep.
  const superUser = await prisma.user.upsert({
    where: { email: keepEmail },
    update: {
      password: hashed,
      role: Role.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      organizationId: org.id,
      deletedAt: null,
    },
    create: {
      email: keepEmail,
      password: hashed,
      name: "Super Admin",
      role: Role.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      organizationId: org.id,
    },
  });

  // Clean dependent rows that reference users.
  await prisma.auditLog.deleteMany({
    where: { userId: { not: superUser.id } },
  });
  await prisma.wallet.deleteMany({
    where: { userId: { not: superUser.id } },
  });
  await prisma.adminOrganizationLink.deleteMany({
    where: { adminId: { not: superUser.id } },
  });

  // Soft-delete and disable all other users to avoid FK cascades.
  const tombstonePassword = await bcrypt.hash(`disabled-${Date.now()}`, 12);
  const updated = await prisma.user.updateMany({
    where: { id: { not: superUser.id } },
    data: {
      deletedAt: new Date(),
      status: UserStatus.BANNED,
      password: tombstonePassword,
    },
  });

  console.log("Kept super admin:", superUser.email, superUser.id);
  console.log("Disabled users:", updated.count);
  console.log("Organization:", org.id, org.slug);
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
