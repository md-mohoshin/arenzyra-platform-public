// Prisma config for running commands from the prisma/ directory.
import { config } from "dotenv";
import path from "node:path";
import { defineConfig } from "prisma/config";

// Load project root .env
config({ path: path.join(__dirname, "..", ".env") });

const databaseUrl = process.env["DATABASE_URL"];
const shadowDatabaseUrl = process.env["SHADOW_DATABASE_URL"];

export default defineConfig({
  schema: "schema.prisma",
  datasource: {
    url: databaseUrl,
    shadowDatabaseUrl,
  },
  migrations: {
    path: "migrations",
  },
});
