"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const node_path_1 = __importDefault(require("node:path"));
const client_1 = __importDefault(require("@prisma/client"));
const adapter_pg_1 = require("@prisma/adapter-pg");
const pg_1 = require("pg");
const bcrypt = __importStar(require("bcrypt"));
const { PrismaClient, Role, FeatureKey } = client_1.default;
if (!process.env.DATABASE_URL) {
    require("dotenv").config({ path: node_path_1.default.join(__dirname, "..", ".env") });
}
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
function requireEnv(name) {
    const value = process.env[name];
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`REQUIRED ENV VARIABLE MISSING: ${name}`);
    }
    return value;
}
async function main() {
    const email = requireEnv("PLATFORM_ADMIN_EMAIL");
    const password = requireEnv("PLATFORM_ADMIN_PASSWORD");
    const superAdminEmail = requireEnv("SUPERADMIN_EMAIL");
    const superAdminPassword = requireEnv("SUPERADMIN_PASSWORD");
    const orgName = "Default Organization";
    const orgSlug = "default-org";
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
            console.log("Linked Super Admin to default organization");
        }
        else {
            console.log("Super Admin already exists");
        }
    }
    else {
        adminUser = await prisma.user.create({
            data: {
                email,
                password: hashed,
                name: "Super Admin",
                role: Role.SUPER_ADMIN,
                organizationId: org.id,
            },
        });
        console.log("Super Admin created");
        console.log("Email:", email);
        console.log("Password:", password);
    }
    const existingSuper = await prisma.user.findUnique({
        where: { email: superAdminEmail },
    });
    if (!existingSuper) {
        await prisma.user.create({
            data: {
                email: superAdminEmail,
                password: superHashed,
                name: "Super Admin",
                role: Role.SUPER_ADMIN,
                organizationId: org.id,
            },
        });
        console.log("Super Admin (arenzyra) created");
        console.log("Email:", superAdminEmail);
        console.log("Password:", superAdminPassword);
    }
    else if (!existingSuper.deletedAt) {
        console.log("Super Admin (arenzyra) already exists");
    }
    await prisma.systemFlag.upsert({
        where: { id: "singleton" },
        update: {},
        create: {
            id: "singleton",
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
    const featureKeys = Object.values(FeatureKey);
    await Promise.all(featureKeys.map((key) => prisma.organizerFeature.upsert({
        where: { organizationId_key: { organizationId: org.id, key } },
        update: { enabled: true },
        create: { organizationId: org.id, key, enabled: true },
    })));
    const defaultRulesets = [
        {
            gameKey: client_1.default.GameKey.PUBG_MOBILE,
            name: "Default BR (PUBG)",
            description: "Battle royale scoring with placement and kill points",
            config: {
                type: "BR_POINTS",
                placementPoints: {
                    1: 10,
                    2: 6,
                    3: 5,
                    4: 4,
                    5: 3,
                    6: 2,
                    7: 1,
                    8: 1,
                },
                killPoints: 1,
                maxTeams: 25,
            },
        },
        {
            gameKey: client_1.default.GameKey.FREE_FIRE,
            name: "Default BR (Free Fire)",
            description: "Battle royale scoring with placement and kill points",
            config: {
                type: "BR_POINTS",
                placementPoints: {
                    1: 10,
                    2: 6,
                    3: 5,
                    4: 4,
                    5: 3,
                    6: 2,
                    7: 1,
                    8: 1,
                },
                killPoints: 1,
                maxTeams: 25,
            },
        },
        {
            gameKey: client_1.default.GameKey.VALORANT,
            name: "Default Round Wins (VALORANT)",
            description: "Round win scoring",
            config: { type: "ROUND_WINS", roundWinPoints: 1, winBonus: 0 },
        },
        {
            gameKey: client_1.default.GameKey.CS2,
            name: "Default Round Wins (CS2)",
            description: "Round win scoring",
            config: { type: "ROUND_WINS", roundWinPoints: 1, winBonus: 0 },
        },
    ];
    for (const rs of defaultRulesets) {
        const existing = await prisma.ruleset.findFirst({
            where: { gameKey: rs.gameKey, name: rs.name },
        });
        if (!existing) {
            await prisma.ruleset.create({
                data: {
                    gameKey: rs.gameKey,
                    name: rs.name,
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
//# sourceMappingURL=seed.js.map
