"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  MAX_MIGRATION_LEDGER_INPUT_BYTES,
  MAX_MIGRATION_LEDGER_ROWS,
  assertUnambiguousMigrationNames,
  candidateMigrationMetadata,
  detectedContractOperations,
  detectedDataImpactOperations,
  evaluateMigrationSafety,
  loadManifest,
  migrationChecksum,
  parseMigrationLedger,
} = require("./verify-production-migration-safety.cjs");
const {
  parseEntitlementCounts,
  verifyEntitlementInvariants,
} = require("./verify-production-entitlement-invariants.cjs");
const {
  parseCount: parseApplicationRelationCount,
  verifyEmptyProductionTarget,
} = require("./verify-empty-production-target.cjs");
function fixture(t, migrations) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-migration-gate-"),
  );
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  for (const [name, sql] of Object.entries(migrations)) {
    const directory = path.join(root, name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "migration.sql"), sql);
  }
  return root;
}

function manifestFor(contractNames, dataImpactNames = []) {
  return {
    schemaVersion: 2,
    contractMigrations: contractNames.map((name) => ({
      name,
      requiredWorkflow: "controlled-maintenance",
      oldWriterServices: ["api"],
      reason: "The prior API reads and writes the removed database column.",
    })),
    dataImpactMigrations: dataImpactNames.map((name) => ({
      name,
      requiredWorkflow: "controlled-maintenance",
      acceptanceRequirement: "reviewed-controlled-maintenance",
      impactKind: "test-data-impact",
      reason:
        "The test migration deliberately changes existing persisted rows.",
    })),
  };
}

function ledgerRow(
  migrationName,
  checksum,
  { finished = true, rolledBack = false, appliedStepsCount = 1 } = {},
) {
  return {
    migrationName,
    checksum,
    finished,
    rolledBack,
    appliedStepsCount,
  };
}

function appliedMigrationLedger(migrationsPath, migrationNames) {
  const checksumByName = new Map(
    candidateMigrationMetadata(migrationsPath).map(({ name, checksum }) => [
      name,
      checksum,
    ]),
  );
  return migrationNames.map((name) => {
    assert.equal(
      checksumByName.has(name),
      true,
      `unknown fixture migration ${name}`,
    );
    return ledgerRow(name, checksumByName.get(name));
  });
}

test("routine release blocks a classified contract migration only while it is pending", (t) => {
  const migrationsPath = fixture(t, {
    baseline: 'CREATE TABLE "Example" ("id" TEXT);',
    contract: 'ALTER TABLE "Example" DROP COLUMN "legacy";',
  });
  const manifest = manifestFor(["contract"]);

  const pending = evaluateMigrationSafety({
    migrationLedger: appliedMigrationLedger(migrationsPath, ["baseline"]),
    manifest,
    migrationsPath,
  });
  assert.equal(pending.ok, false);
  assert.equal(pending.reason, "pending-old-writer-incompatible-migrations");
  assert.deepEqual(pending.divergentAppliedMigrations, []);
  assert.deepEqual(
    pending.pendingContract.map(({ name }) => name),
    ["contract"],
  );

  const applied = evaluateMigrationSafety({
    migrationLedger: appliedMigrationLedger(migrationsPath, [
      "baseline",
      "contract",
    ]),
    manifest,
    migrationsPath,
  });
  assert.equal(applied.ok, true);
  assert.deepEqual(applied.divergentAppliedMigrations, []);
  assert.equal(applied.reason, "no-pending-contract-or-data-impact-migrations");
});

test("routine release blocks classified data impact even when old writers are absent", (t) => {
  const migrationsPath = fixture(t, {
    backfill: 'UPDATE "Example" SET "canonical" = true;',
  });
  const manifest = manifestFor([], ["backfill"]);

  for (const noOldWriters of [false, true]) {
    const result = evaluateMigrationSafety({
      migrationLedger: [],
      manifest,
      migrationsPath,
      noOldWriters,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "pending-data-impact-migrations");
    assert.deepEqual(result.pendingDataImpact[0].operations, ["update-rows"]);
  }

  const applied = evaluateMigrationSafety({
    migrationLedger: appliedMigrationLedger(migrationsPath, ["backfill"]),
    manifest,
    migrationsPath,
  });
  assert.equal(applied.ok, true);
});

test("first deploy defers data impact only until a separate empty-target proof", (t) => {
  const migrationsPath = fixture(t, {
    backfill: 'UPDATE "Example" SET "canonical" = true;',
  });
  const manifest = manifestFor([], ["backfill"]);

  const deferred = evaluateMigrationSafety({
    migrationLedger: [],
    manifest,
    migrationsPath,
    noOldWriters: true,
    deferDataImpact: true,
  });
  assert.equal(deferred.ok, true);
  assert.equal(deferred.reason, "verified-no-old-writers-data-impact-deferred");

  const empty = evaluateMigrationSafety({
    migrationLedger: [],
    manifest,
    migrationsPath,
    noOldWriters: true,
    verifiedEmptyTarget: true,
  });
  assert.equal(empty.ok, true);
  assert.equal(empty.reason, "verified-empty-target-no-old-writers");

  assert.throws(
    () =>
      evaluateMigrationSafety({
        migrationLedger: [],
        manifest,
        migrationsPath,
        verifiedEmptyTarget: true,
      }),
    /requires noOldWriters/,
  );
});

test("unclassified pending row and default changes fail closed", (t) => {
  const cases = {
    update: 'UPDATE "Example" SET "value" = 1;',
    delete: 'DELETE FROM "Example";',
    truncate: 'TRUNCATE TABLE "Example";',
    set_default: 'ALTER TABLE "Example" ALTER COLUMN "value" SET DEFAULT 1;',
    add_required_default:
      'ALTER TABLE "Example" ADD COLUMN "value" INTEGER NOT NULL DEFAULT 1;',
  };

  for (const [name, sql] of Object.entries(cases)) {
    const migrationsPath = fixture(t, { [name]: sql });
    const result = evaluateMigrationSafety({
      migrationLedger: [],
      manifest: manifestFor([]),
      migrationsPath,
    });
    assert.equal(result.ok, false, name);
    assert.equal(result.reason, "unclassified-data-impact-migrations", name);
    assert.equal(result.unclassifiedDataImpact[0].name, name);
  }
});

test("data-impact operation detection distinguishes additive-only SQL", () => {
  assert.deepEqual(
    detectedDataImpactOperations(`
      UPDATE "A" SET "value" = 1;
      DELETE FROM "B";
      TRUNCATE TABLE "C";
      ALTER TABLE "D" ALTER COLUMN "value" SET DEFAULT 1;
      ALTER TABLE "E" ADD COLUMN "value" INTEGER NOT NULL DEFAULT 1;
    `),
    [
      "update-rows",
      "delete-rows",
      "truncate-rows",
      "alter-column-set-default",
      "add-not-null-default-column",
    ],
  );
  assert.deepEqual(
    detectedDataImpactOperations(
      'CREATE TABLE "A" ("id" TEXT); ALTER TABLE "A" ADD COLUMN "note" TEXT;',
    ),
    [],
  );
  assert.deepEqual(
    detectedDataImpactOperations(
      'ALTER TABLE "A" ADD COLUMN "required" TEXT DEFAULT \'x\' NOT NULL;',
    ),
    ["add-not-null-default-column"],
  );
  assert.deepEqual(
    detectedDataImpactOperations(`
      -- UPDATE "Commented" SET "value" = 1;
      ALTER TABLE "Child" ADD CONSTRAINT "child_parent_fkey"
        FOREIGN KEY ("parentId") REFERENCES "Parent"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
      CREATE TRIGGER "touch" BEFORE UPDATE ON "Child"
        FOR EACH ROW EXECUTE FUNCTION "touch_updated_at"();
      SELECT 'UPDATE "Quoted" SET "value" = 1';
    `),
    [],
  );
  assert.deepEqual(
    detectedDataImpactOperations(`
      WITH candidates AS (SELECT 1)
      UPDATE "A" AS target SET "value" = 1 FROM candidates;
      INSERT INTO "B" ("id") VALUES (1)
        ON CONFLICT ("id") DO UPDATE SET "id" = EXCLUDED."id";
    `),
    ["update-rows"],
  );
  assert.deepEqual(
    detectedDataImpactOperations(`
      DO $migration$
      BEGIN
        EXECUTE 'ALTER TABLE "A" DROP COLUMN "legacy"';
        UPDATE "A" SET "value" = 1;
      END
      $migration$;
    `),
    ["procedural-do-block"],
  );
});

test("an unclassified procedural block cannot pass on an old-writer waiver", (t) => {
  const migrationsPath = fixture(t, {
    procedural: `
      DO $$
      BEGIN
        EXECUTE 'UPDATE "Example" SET "value" = 1';
      END
      $$;
    `,
  });
  const result = evaluateMigrationSafety({
    migrationLedger: [],
    manifest: manifestFor([]),
    migrationsPath,
    noOldWriters: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "unclassified-data-impact-migrations");
  assert.deepEqual(
    result.unclassifiedDataImpact.map(({ name, operations }) => ({
      name,
      operations,
    })),
    [{ name: "procedural", operations: ["procedural-do-block"] }],
  );
});

test("contract detection covers nullability, type, and enum replacement forms", () => {
  const cases = [
    [
      "alter-column-type",
      'ALTER TABLE "A" ALTER COLUMN "value" TYPE BIGINT USING "value"::BIGINT;',
    ],
    [
      "alter-column-type",
      'ALTER TABLE "A" ALTER "value" SET DATA TYPE BIGINT;',
    ],
    [
      "set-column-not-null",
      'ALTER TABLE "A" ALTER COLUMN "value" SET NOT NULL;',
    ],
    [
      "drop-column-not-null",
      'ALTER TABLE "A" ALTER COLUMN "value" DROP NOT NULL;',
    ],
    ["rename-type", 'ALTER TYPE "OldState" RENAME TO "OldState_retired";'],
    [
      "rename-enum-value",
      "ALTER TYPE \"State\" RENAME VALUE 'OLD' TO 'LEGACY';",
    ],
    ["drop-enum-value", "ALTER TYPE \"State\" DROP VALUE 'LEGACY';"],
    [
      "rename-type-attribute",
      'ALTER TYPE "Composite" RENAME ATTRIBUTE "old" TO "current";',
    ],
    ["drop-type-attribute", 'ALTER TYPE "Composite" DROP ATTRIBUTE "legacy";'],
    [
      "alter-type-attribute-type",
      'ALTER TYPE "Composite" ALTER ATTRIBUTE "value" TYPE BIGINT;',
    ],
    ["move-type-schema", 'ALTER TYPE "State" SET SCHEMA "archive";'],
    ["drop-type", 'DROP TYPE "OldState";'],
    ["drop-domain", 'DROP DOMAIN "LegacyIdentifier";'],
  ];

  for (const [expected, sql] of cases) {
    assert.equal(detectedContractOperations(sql).includes(expected), true, sql);
  }
  assert.deepEqual(
    detectedContractOperations('ALTER TYPE "OldState" RENAME TO "NewState";'),
    ["rename-type"],
  );
  assert.deepEqual(
    detectedContractOperations(`
      -- ALTER TABLE "A" DROP COLUMN "hidden";
      SELECT 'DROP TYPE "Hidden"';
      CREATE TABLE "ALTER TYPE State RENAME TO Other" ("id" TEXT);
    `),
    [],
  );
});

test("an unclassified destructive migration fails closed for existing writers", (t) => {
  const migrationsPath = fixture(t, {
    surprise: 'DROP TABLE "ImportantData";',
  });
  const result = evaluateMigrationSafety({
    migrationLedger: [],
    manifest: manifestFor([]),
    migrationsPath,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unclassified-destructive-migrations");
  assert.deepEqual(
    {
      name: result.unclassifiedContract[0].name,
      operations: result.unclassifiedContract[0].operations,
    },
    { name: "surprise", operations: ["drop-table"] },
  );
});

test("verified empty first deployment has no old-writer compatibility race", (t) => {
  const migrationsPath = fixture(t, {
    contract: 'ALTER TABLE "Example" DROP COLUMN "legacy";',
  });
  const result = evaluateMigrationSafety({
    migrationLedger: [],
    manifest: manifestFor(["contract"]),
    migrationsPath,
    noOldWriters: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.reason, "verified-no-old-writers");
});

test("empty-target proof accepts only a strict zero aggregate", () => {
  assert.deepEqual(
    verifyEmptyProductionTarget(parseApplicationRelationCount("0")),
    {
      ok: true,
      reason: "production-target-has-zero-application-relations",
      applicationRelationCount: 0,
    },
  );
  assert.equal(
    verifyEmptyProductionTarget(parseApplicationRelationCount("1")).reason,
    "production-target-is-not-empty",
  );
  for (const malformed of ["", "-1", "1.0", " 0", "0\n", "word"]) {
    assert.throws(() => parseApplicationRelationCount(malformed));
  }
});

test("entitlement aggregate verification fails closed for every invalid state", () => {
  const valid = parseEntitlementCounts([
    "6",
    "2",
    "0",
    "2",
    "0",
    "2",
    "0",
    "0",
  ]);
  assert.equal(verifyEntitlementInvariants(valid).ok, true);

  for (const [label, values] of [
    ["active", ["6", "2", "1", "2", "0", "2", "0", "0"]],
    ["trialing", ["6", "2", "0", "2", "1", "2", "0", "0"]],
    ["expired", ["6", "2", "0", "2", "0", "2", "1", "0"]],
    ["unknown", ["7", "2", "0", "2", "0", "2", "0", "1"]],
  ]) {
    const result = verifyEntitlementInvariants(parseEntitlementCounts(values));
    assert.equal(result.ok, false, label);
    assert.equal(result.reason, "inconsistent-production-entitlements");
  }

  const mismatch = parseEntitlementCounts([
    "7",
    "2",
    "0",
    "2",
    "0",
    "2",
    "0",
    "0",
  ]);
  assert.equal(
    verifyEntitlementInvariants(mismatch).reason,
    "aggregate-state-count-mismatch",
  );
  assert.throws(() => parseEntitlementCounts(["0"]));
  assert.throws(() =>
    parseEntitlementCounts(["0", "0", "0", "0", "0", "0", "0", "1x"]),
  );
});

test("candidate migration metadata hashes the exact SQL bytes", (t) => {
  const sql = Buffer.from("SELECT 1;\r\n", "utf8");
  const migrationsPath = fixture(t, { exact: sql });
  assert.deepEqual(candidateMigrationMetadata(migrationsPath), [
    { name: "exact", checksum: migrationChecksum(sql) },
  ]);
  assert.notEqual(
    migrationChecksum(sql),
    migrationChecksum(Buffer.from("SELECT 1;\n", "utf8")),
  );
});

test("candidate migration names fail closed on duplicate or portable ambiguity", () => {
  assert.deepEqual(assertUnambiguousMigrationNames(["001_one", "002_two"]), [
    "001_one",
    "002_two",
  ]);
  assert.throws(
    () => assertUnambiguousMigrationNames(["001_one", "001_one"]),
    /Duplicate candidate migration name/,
  );
  assert.throws(
    () => assertUnambiguousMigrationNames(["001_Name", "001_name"]),
    /Case-ambiguous candidate migration names/,
  );
  assert.throws(() => assertUnambiguousMigrationNames([]), /At least one/);
  assert.throws(
    () => assertUnambiguousMigrationNames(["001_trailing."]),
    /Invalid candidate migration name/,
  );
});

test("database migration ledger input requires closed, complete JSON rows", () => {
  const valid = ledgerRow("one", "a".repeat(64));
  assert.deepEqual(parseMigrationLedger(`${JSON.stringify(valid)}\n`), [valid]);
  assert.deepEqual(parseMigrationLedger(""), []);

  for (const malformed of [
    "one\n",
    JSON.stringify({ ...valid, checksum: "short" }),
    JSON.stringify({ ...valid, checksum: "A".repeat(64) }),
    JSON.stringify({ ...valid, migrationName: "name; DROP TABLE x" }),
    JSON.stringify({ ...valid, finished: 1 }),
    JSON.stringify({ ...valid, extra: true }),
    JSON.stringify({
      migrationName: valid.migrationName,
      checksum: valid.checksum,
      finished: valid.finished,
      rolledBack: valid.rolledBack,
    }),
  ]) {
    assert.throws(() => parseMigrationLedger(malformed));
  }
});

test("malformed ledger values are rejected without echoing their contents", () => {
  const sensitiveValue = "sensitive-ledger/private-material";
  assert.throws(
    () =>
      parseMigrationLedger(
        JSON.stringify(ledgerRow(sensitiveValue, "a".repeat(64))),
      ),
    (error) => {
      assert.doesNotMatch(error.message, /sensitive-ledger|private-material/);
      return true;
    },
  );
});

test("database migration ledger input is bounded by bytes and row count", () => {
  const valid = JSON.stringify(ledgerRow("one", "a".repeat(64)));
  assert.throws(
    () =>
      parseMigrationLedger(
        Array.from({ length: MAX_MIGRATION_LEDGER_ROWS + 1 }, () => valid).join(
          "\n",
        ),
      ),
    /too many rows/,
  );
  assert.throws(
    () =>
      parseMigrationLedger("x".repeat(MAX_MIGRATION_LEDGER_INPUT_BYTES + 1)),
    /input exceeds the safety limit/,
  );
});

test("applied migration checksum mismatch fails closed", (t) => {
  const migrationsPath = fixture(t, { baseline: "SELECT 1;\n" });
  const result = evaluateMigrationSafety({
    migrationLedger: [ledgerRow("baseline", "f".repeat(64))],
    manifest: manifestFor([]),
    migrationsPath,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "database-migration-checksum-mismatch");
  assert.deepEqual(result.checksumMismatches, [
    {
      migrationName: "baseline",
      databaseChecksum: "f".repeat(64),
      candidateChecksum: migrationChecksum(Buffer.from("SELECT 1;\n")),
    },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /SELECT 1/);
});

test("unfinished and ambiguous migration ledger rows fail closed", (t) => {
  const migrationsPath = fixture(t, { baseline: "SELECT 1;" });
  const checksum = candidateMigrationMetadata(migrationsPath)[0].checksum;

  const incomplete = evaluateMigrationSafety({
    migrationLedger: [
      ledgerRow("baseline", checksum, {
        finished: false,
        rolledBack: false,
        appliedStepsCount: 0,
      }),
    ],
    manifest: manifestFor([]),
    migrationsPath,
  });
  assert.equal(incomplete.reason, "database-migration-ledger-incomplete");

  const zeroStepFinished = evaluateMigrationSafety({
    migrationLedger: [
      ledgerRow("baseline", checksum, {
        finished: true,
        rolledBack: false,
        appliedStepsCount: 0,
      }),
    ],
    manifest: manifestFor([]),
    migrationsPath,
  });
  assert.equal(zeroStepFinished.reason, "database-migration-ledger-incomplete");

  const ambiguous = evaluateMigrationSafety({
    migrationLedger: [
      ledgerRow("baseline", checksum),
      ledgerRow("baseline", checksum),
    ],
    manifest: manifestFor([]),
    migrationsPath,
  });
  assert.equal(ambiguous.reason, "database-migration-ledger-ambiguous");

  const retried = evaluateMigrationSafety({
    migrationLedger: [
      ledgerRow("baseline", checksum, {
        finished: false,
        rolledBack: true,
        appliedStepsCount: 0,
      }),
      ledgerRow("baseline", checksum),
    ],
    manifest: manifestFor([]),
    migrationsPath,
  });
  assert.equal(retried.ok, true);
});

test("a non-first target requires at least one successfully applied migration", (t) => {
  const migrationsPath = fixture(t, { baseline: "SELECT 1;" });
  const checksum = candidateMigrationMetadata(migrationsPath)[0].checksum;

  for (const migrationLedger of [
    [],
    [
      ledgerRow("baseline", checksum, {
        finished: false,
        rolledBack: true,
        appliedStepsCount: 0,
      }),
    ],
  ]) {
    const result = evaluateMigrationSafety({
      migrationLedger,
      manifest: manifestFor([]),
      migrationsPath,
      requireAppliedMigration: true,
    });
    assert.equal(
      result.reason,
      "database-migration-ledger-has-no-applied-migration",
    );
  }
});

test("successfully applied migrations must be the ordered candidate prefix", (t) => {
  const migrationsPath = fixture(t, {
    "001_first": "SELECT 1;",
    "002_second": "SELECT 2;",
    "003_third": "SELECT 3;",
  });
  const checksums = new Map(
    candidateMigrationMetadata(migrationsPath).map(({ name, checksum }) => [
      name,
      checksum,
    ]),
  );

  const missingEarlierMigration = evaluateMigrationSafety({
    migrationLedger: [
      ledgerRow("001_first", checksums.get("001_first")),
      ledgerRow("003_third", checksums.get("003_third")),
    ],
    manifest: manifestFor([]),
    migrationsPath,
    requireAppliedMigration: true,
  });
  assert.equal(
    missingEarlierMigration.reason,
    "database-migration-lineage-is-not-candidate-prefix",
  );
  assert.deepEqual(missingEarlierMigration.migrationLineageMismatches, [
    {
      position: 2,
      expectedMigrationName: "002_second",
      databaseMigrationName: "003_third",
    },
  ]);

  const reorderedHistory = evaluateMigrationSafety({
    migrationLedger: [
      ledgerRow("002_second", checksums.get("002_second")),
      ledgerRow("001_first", checksums.get("001_first")),
    ],
    manifest: manifestFor([]),
    migrationsPath,
    requireAppliedMigration: true,
  });
  assert.equal(
    reorderedHistory.reason,
    "database-migration-lineage-is-not-candidate-prefix",
  );

  const validPrefix = evaluateMigrationSafety({
    migrationLedger: [
      ledgerRow("001_first", checksums.get("001_first")),
      ledgerRow("002_second", checksums.get("002_second")),
    ],
    manifest: manifestFor([]),
    migrationsPath,
    requireAppliedMigration: true,
  });
  assert.equal(validPrefix.ok, true);
});

test("production ledger collection emits every checksum and row state as JSON", () => {
  const gate = fs.readFileSync(
    path.join(__dirname, "production-release-safety-gate.sh"),
    "utf8",
  );
  assert.match(gate, /row_to_json\(ledger_row\)::text/);
  assert.match(gate, /octet_length\(migration_name\) BETWEEN 1 AND 255/);
  assert.match(gate, /octet_length\(checksum\) = 64/);
  assert.match(gate, /finished_at IS NOT NULL AS finished/);
  assert.match(gate, /rolled_back_at IS NOT NULL AS \\"rolledBack\\"/);
  assert.match(gate, /applied_steps_count AS \\"appliedStepsCount\\"/);
  assert.match(gate, /ORDER BY started_at, migration_name, id/);
  assert.match(gate, /LIMIT 4097/);
  assert.match(gate, /--require-applied-migration/);
  assert.match(gate, /default_transaction_read_only=on/);
  assert.match(gate, /statement_timeout=30000/);
  assert.match(gate, /lock_timeout=5000/);
  assert.doesNotMatch(gate, /(?:MIGRATION_)?DATABASE_URL/);
  assert.doesNotMatch(gate, /WHERE\s+finished_at\s+IS\s+NOT\s+NULL/i);
});

test("applied database history absent from source fails closed as divergent", (t) => {
  const migrationsPath = fixture(t, {
    baseline: 'CREATE TABLE "Example" ("id" TEXT);',
  });
  const result = evaluateMigrationSafety({
    migrationLedger: [
      ...appliedMigrationLedger(migrationsPath, ["baseline"]),
      ledgerRow("future_remote_migration", "b".repeat(64)),
    ],
    manifest: manifestFor([]),
    migrationsPath,
    noOldWriters: true,
    verifiedEmptyTarget: true,
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.reason,
    "database-migration-history-diverges-from-source",
  );
  assert.deepEqual(result.divergentAppliedMigrations, [
    "future_remote_migration",
  ]);
});

test("the production manifest is a closed canonical-lineage policy", () => {
  const manifest = loadManifest();
  assert.deepEqual(manifest, {
    schemaVersion: 2,
    contractMigrations: [],
    dataImpactMigrations: [],
  });
});

test("legacy candidate-only migration policy fields fail closed", (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-migration-manifest-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manifestPath = path.join(root, "policy.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      schemaVersion: 2,
      contractMigrations: [],
      dataImpactMigrations: [],
      idpCredentialStorage: { storageMigration: "absent-candidate" },
    }),
  );
  assert.throws(() => loadManifest(manifestPath), /unexpected schema/);
});
