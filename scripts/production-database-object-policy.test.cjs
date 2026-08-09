"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  checkRepository,
  loadPolicy,
  parseApiFunctionPolicies,
  parseApiTriggerPolicies,
  parsePrismaEnumPolicies,
  parsePrismaTableNames,
  parseStudioTableNames,
  validatePolicyShape,
} = require("./production-database-object-policy.cjs");

const repositoryRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(
  repositoryRoot,
  "infra/production-database-object-policy.json",
);

function readPolicy() {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

const studioFunctionTriggerMigration =
  "20260809200000_studio_widget_release_foundation/migration.sql";
const studioFunctionTriggerMigrationSha256 =
  "3f7a501dba9fe89661c52ec5eaad973189b155763fe65214c6b055168c09f27b";

test("Studio function and trigger policy binds the exact forward migration", () => {
  const policy = readPolicy();
  assert.equal(
    policy.sourceDigests.apiFunctionTriggerMigrationSha256,
    studioFunctionTriggerMigrationSha256,
  );
  for (const item of [...policy.apiFunctions, ...policy.apiTriggers]) {
    assert.equal(item.sourceMigration, studioFunctionTriggerMigration);
    assert.equal(
      item.sourceMigrationSha256,
      studioFunctionTriggerMigrationSha256,
    );
  }
});

test("committed object policy exactly matches every reviewed repository object", () => {
  const { policy, counts } = loadPolicy({ manifestPath, repositoryRoot });
  assert.equal(counts.apiTables, 131);
  assert.equal(counts.studioTables, 6);
  assert.equal(counts.ledgers, 2);
  assert.equal(counts.enumTypes, 69);
  assert.equal(counts.functions, 2);
  assert.equal(counts.triggers, 2);
  assert.equal(counts.sequences, 0);
  assert.equal(policy.apiRuntimeTables.includes("match_players"), true);
  assert.equal(policy.apiRuntimeTables.includes("Sponsor"), true);
  assert.deepEqual(policy.apiMigrationLedgers, ["_prisma_migrations"]);
  assert.deepEqual(policy.studioMigrationLedgers, ["StudioSchemaMigration"]);
  assert.equal(policy.apiEnumTypes.length, 69);
  assert.deepEqual(
    policy.apiEnumTypes.find((item) => item.name === "StudioWidgetTarget")
      .labels,
    ["OBS_BROWSER", "DISCORD_PNG"],
  );
  assert.deepEqual(
    policy.apiFunctions.map((item) => item.name),
    [
      "enforceStudioWidgetReleaseRevisionOwner",
      "enforceStudioWidgetRevisionReleaseOwner",
    ],
  );
  assert.deepEqual(
    policy.apiTriggers.map((item) => `${item.tableName}.${item.name}`),
    [
      "StudioWidgetRelease.StudioWidgetRelease_revision_widget_owner",
      "StudioWidgetRevision.StudioWidgetRevision_release_widget_owner",
    ],
  );
});

test("policy parser honors Prisma table mappings and Studio declarations", () => {
  assert.deepEqual(
    parsePrismaTableNames(
      `model Example {\n  id String @id\n  @@map("mapped_table")\n}\n`,
    ),
    ["mapped_table"],
  );
  assert.deepEqual(
    parseStudioTableNames(
      'CREATE TABLE IF NOT EXISTS "StudioOne" ("id" TEXT);\n' +
        'CREATE TABLE IF NOT EXISTS "StudioTwo" ("id" TEXT);\n',
    ),
    ["StudioOne", "StudioTwo"],
  );
  assert.deepEqual(
    parsePrismaEnumPolicies(
      'enum Example {\n  SOURCE @map("stored-value")\n  OTHER\n  @@map("MappedEnum")\n}\n',
    ),
    [{ name: "MappedEnum", labels: ["stored-value", "OTHER"] }],
  );
});

test("migration parser seals exact function bodies and trigger wirings", () => {
  const policy = readPolicy();
  const sourceMigrations = new Set([
    ...policy.apiFunctions.map((item) => item.sourceMigration),
    ...policy.apiTriggers.map((item) => item.sourceMigration),
  ]);
  assert.equal(sourceMigrations.size, 1);
  const sourceMigration = [...sourceMigrations][0];
  const source = fs
    .readFileSync(
      path.join(repositoryRoot, "apps/api/prisma/migrations", sourceMigration),
      "utf8",
    )
    .replace(/\r\n?/g, "\n");
  const functions = parseApiFunctionPolicies([{ sourceMigration, source }]);
  const triggers = parseApiTriggerPolicies([{ sourceMigration, source }]);
  assert.equal(functions.length, 2);
  assert.deepEqual(
    functions.map(({ sourceSha256 }) => sourceSha256),
    policy.apiFunctions.map(({ sourceSha256 }) => sourceSha256),
  );
  assert.deepEqual(triggers[0].events, ["INSERT", "UPDATE"]);
  assert.deepEqual(triggers[0].updateColumns, ["widgetId", "revisionId"]);
  assert.deepEqual(triggers[1].events, ["UPDATE"]);
  assert.deepEqual(triggers[1].updateColumns, ["widgetId"]);
  assert.match(
    policy.sourceDigests.apiFunctionTriggerMigrationSha256,
    /^[a-f0-9]{64}$/,
  );
});

test("policy schema is closed and classifications cannot overlap", () => {
  const unknown = readPolicy();
  unknown.unreviewed = true;
  assert.throws(
    () => validatePolicyShape(unknown),
    /unexpected shape|unexpected key/,
  );

  const overlap = readPolicy();
  overlap.studioRuntimeTables.push(overlap.apiRuntimeTables[0]);
  assert.throws(
    () => validatePolicyShape(overlap),
    /classified more than once/,
  );

  const definer = readPolicy();
  definer.apiFunctions[0].securityDefiner = true;
  assert.throws(() => validatePolicyShape(definer), /not the reviewed value/);

  const unknownEnumAttribute =
    'enum Example {\n  VALUE\n  @@schema("other")\n}\n';
  assert.throws(
    () => parsePrismaEnumPolicies(unknownEnumAttribute),
    /unsupported block attribute/,
  );
});

test("repository drift blocks even when table names are unchanged", () => {
  const policy = readPolicy();
  policy.sourceDigests.apiPrismaSchemaSha256 = "0".repeat(64);
  validatePolicyShape(policy);
  assert.throws(
    () => checkRepository(policy, repositoryRoot),
    /does not match the reviewed repository/,
  );
});

test("unclassified or missing Prisma tables fail closed", () => {
  const extra = readPolicy();
  extra.apiRuntimeTables.push("UnreviewedSecretTable");
  validatePolicyShape(extra);
  assert.throws(
    () => checkRepository(extra, repositoryRoot),
    /differs from the repository/,
  );

  const missing = readPolicy();
  missing.apiRuntimeTables = missing.apiRuntimeTables.slice(1);
  validatePolicyShape(missing);
  assert.throws(
    () => checkRepository(missing, repositoryRoot),
    /differs from the repository/,
  );
});

test("enum labels, function metadata, and trigger wiring drift fail closed", () => {
  const enumDrift = readPolicy();
  enumDrift.apiEnumTypes[0].labels.reverse();
  validatePolicyShape(enumDrift);
  assert.throws(
    () => checkRepository(enumDrift, repositoryRoot),
    /apiEnumTypes metadata differs/,
  );

  const functionDrift = readPolicy();
  functionDrift.apiFunctions[0].sourceSha256 = "0".repeat(64);
  validatePolicyShape(functionDrift);
  assert.throws(
    () => checkRepository(functionDrift, repositoryRoot),
    /apiFunctions metadata differs/,
  );

  const triggerDrift = readPolicy();
  triggerDrift.apiTriggers[0].updateColumns.reverse();
  validatePolicyShape(triggerDrift);
  assert.throws(
    () => checkRepository(triggerDrift, repositoryRoot),
    /apiTriggers metadata differs/,
  );
});

test("unsupported trigger variants do not evade the migration parser", () => {
  for (const declaration of [
    'CREATE OR REPLACE TRIGGER "unsafe" BEFORE INSERT ON "T" FOR EACH ROW EXECUTE FUNCTION "f"();',
    'CREATE CONSTRAINT TRIGGER "unsafe" AFTER INSERT ON "T" FOR EACH ROW EXECUTE FUNCTION "f"();',
    'CREATE EVENT TRIGGER "unsafe" ON ddl_command_start EXECUTE FUNCTION "f"();',
  ]) {
    assert.throws(
      () =>
        parseApiTriggerPolicies([
          { sourceMigration: "unsafe/migration.sql", source: declaration },
        ]),
      /unsupported trigger declaration/,
    );
  }
});

test("CLI emits only canonical base64 when requested", () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(__dirname, "production-database-object-policy.cjs"),
      "--manifest",
      manifestPath,
      "--repository-root",
      repositoryRoot,
      "--print-base64",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^[A-Za-z0-9+/]+={0,2}$/);
  assert.ok(result.stdout.length < 65536);
  const decoded = JSON.parse(
    Buffer.from(result.stdout, "base64").toString("utf8"),
  );
  assert.equal(decoded.schemaVersion, 1);
  assert.equal(decoded.apiRuntimeTables.length, 131);
  assert.equal(decoded.apiEnumTypes.length, 69);
  assert.equal(decoded.apiFunctions.length, 2);
  assert.equal(decoded.apiTriggers.length, 2);
  assert.equal(result.stderr, "");
});
