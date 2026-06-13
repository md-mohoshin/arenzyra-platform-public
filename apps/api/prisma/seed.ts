import 'dotenv/config';
import path from 'node:path';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import { DEFAULT_GAMES } from '../src/modules/games/games.constants';
import { requireEnv } from '../src/common/config/require-env';
import { defaultRulesetConfigForGame } from '../src/common/game-rules.util';

const { PrismaClient, Role, FeatureKey } =
  prismaPkg as typeof import('@prisma/client');

// Ensure .env from project root is loaded when run from this directory
if (!process.env.DATABASE_URL) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const prismaAny = prisma as any;

async function main() {
  const email = requireEnv('PLATFORM_ADMIN_EMAIL');
  const password = requireEnv('PLATFORM_ADMIN_PASSWORD');
  const superAdminEmail = requireEnv('SUPERADMIN_EMAIL');
  const superAdminPassword = requireEnv('SUPERADMIN_PASSWORD');
  const orgName = 'Default Organization';
  const orgSlug = 'default-org';

  const hashed = await bcrypt.hash(password, 12);
  const superHashed = await bcrypt.hash(superAdminPassword, 12);

  const org = await prisma.organization.upsert({
    where: { slug: orgSlug },
    update: {},
    create: { name: orgName, slug: orgSlug },
  });

  let adminUser = await prisma.user.findUnique({
    where: { email },
  });

  if (adminUser) {
    if (!adminUser.organizationId) {
      adminUser = await prisma.user.update({
        where: { id: adminUser.id },
        data: { organizationId: org.id },
      });
      console.log('Linked Super Admin to default organization');
    } else {
      console.log('Super Admin already exists');
    }
  } else {
    adminUser = await prisma.user.create({
      data: {
        email,
        password: hashed,
        name: 'Super Admin',
        role: Role.SUPER_ADMIN,
        organizationId: org.id,
      },
    });
    console.log('Super Admin created');
    console.log('Email:', email);
    console.log('Password:', password);
  }

  // Seed requested SUPER ADMIN credentials
  const existingSuper = await prisma.user.findUnique({
    where: { email: superAdminEmail },
  });
  if (!existingSuper) {
    await prisma.user.create({
      data: {
        email: superAdminEmail,
        password: superHashed,
        name: 'Super Admin',
        role: Role.SUPER_ADMIN,
        organizationId: org.id,
      },
    });
    console.log('Super Admin (arenzyra) created');
    console.log('Email:', superAdminEmail);
    console.log('Password:', superAdminPassword);
  } else if (!existingSuper.deletedAt) {
    console.log('Super Admin (arenzyra) already exists');
  }

  await prisma.systemFlag.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      maintenanceMode: false,
      lockRegistrations: false,
      freezePayouts: false,
    },
  });

  await prisma.wallet.upsert({
    where: { organizationId: org.id },
    update: {},
    create: { organizationId: org.id, balance: 0 },
  });

  if (adminUser?.id) {
    await prisma.wallet.upsert({
      where: { userId: adminUser.id },
      update: {},
      create: { userId: adminUser.id, balance: 0 },
    });
  }

  // Enable all organizer features for default org
  const featureKeys = Object.values(FeatureKey);
  await Promise.all(
    featureKeys.map((key) =>
      prisma.organizerFeature.upsert({
        where: { organizationId_key: { organizationId: org.id, key } },
        update: { enabled: true },
        create: { organizationId: org.id, key, enabled: true },
      }),
    ),
  );

  // Seed default games (idempotent)
  await Promise.all(
    DEFAULT_GAMES.map((game) =>
      prismaAny.game.upsert({
        where: { key: game.key },
        update: { name: game.name },
        create: { key: game.key, name: game.name, isEnabled: true },
      }),
    ),
  );

  // Seed default rulesets per game (idempotent by game + name)
  const defaultRulesets: Array<{
    gameKey: (typeof prismaPkg.GameKey)[keyof typeof prismaPkg.GameKey];
    name: string;
    description: string;
    config: Record<string, unknown>;
  }> = [
    {
      gameKey: prismaPkg.GameKey.PUBG_MOBILE,
      name: 'Default BR (PUBG)',
      description: 'Battle royale scoring with placement and kill points',
      config: defaultRulesetConfigForGame(prismaPkg.GameKey.PUBG_MOBILE),
    },
    {
      gameKey: prismaPkg.GameKey.FREE_FIRE,
      name: 'Default BR (Free Fire)',
      description:
        'Free Fire battle royale scoring with 12-team placement and kill points',
      config: defaultRulesetConfigForGame(prismaPkg.GameKey.FREE_FIRE),
    },
    {
      gameKey: prismaPkg.GameKey.CALL_OF_DUTY,
      name: 'Default BR (Call of Duty Mobile)',
      description:
        'Call of Duty Mobile battle royale scoring with 25-team placement and kill points',
      config: defaultRulesetConfigForGame(prismaPkg.GameKey.CALL_OF_DUTY),
    },
    {
      gameKey: prismaPkg.GameKey.VALORANT,
      name: 'Default Round Wins (VALORANT)',
      description:
        'VALORANT 5v5 round-score match control with manual results until Riot API approval',
      config: defaultRulesetConfigForGame(prismaPkg.GameKey.VALORANT),
    },
    {
      gameKey: prismaPkg.GameKey.CRICKET,
      name: 'Default Cricket Points',
      description:
        'Cricket match workflow with manual score entry, fixtures, and points table',
      config: defaultRulesetConfigForGame(prismaPkg.GameKey.CRICKET),
    },
    {
      gameKey: prismaPkg.GameKey.CS2,
      name: 'Default Round Wins (CS2)',
      description: 'Round win scoring',
      config: { type: 'ROUND_WINS', roundWinPoints: 1, winBonus: 0 },
    },
  ];

  for (const rs of defaultRulesets) {
    const existing = await prismaAny.ruleset.findFirst({
      where: { gameKey: rs.gameKey, name: rs.name },
    });
    if (!existing) {
      await prismaAny.ruleset.create({
        data: {
          gameKey: rs.gameKey,
          name: rs.name,
          description: rs.description,
          config: rs.config,
          isDefault: true,
        },
      });
    } else {
      await prismaAny.ruleset.update({
        where: { id: existing.id },
        data: {
          description: rs.description,
          config: rs.config,
          isDefault: true,
        },
      });
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
