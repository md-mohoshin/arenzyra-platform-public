#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..");
const defaultManifestPath = path.join(
  repositoryRoot,
  "infra",
  "production-api-migration-safety.json",
);
const defaultMigrationsPath = path.join(
  repositoryRoot,
  "apps",
  "api",
  "prisma",
  "migrations",
);
const MAX_MIGRATION_NAME_BYTES = 255;
const MAX_CANDIDATE_MIGRATIONS = 4096;
const MAX_MIGRATION_SQL_BYTES = 16 * 1024 * 1024;
const MAX_MIGRATION_LEDGER_ROWS = 4096;
const MAX_MIGRATION_LEDGER_INPUT_BYTES = 16 * 1024 * 1024;
const LEGACY_RECONCILABLE_LEDGER_ROW = Object.freeze({
  migrationName: "20260308132829_widget_instance_permanent_keys",
  checksum:
    "c573af92b312df565eaf1d490dfafa3d6cc8a20220c87f39d659a62826628163",
});

const obviousContractPatterns = Object.freeze([
  Object.freeze({ name: "drop-column", pattern: /\bDROP\s+COLUMN\b/i }),
  Object.freeze({ name: "drop-table", pattern: /\bDROP\s+TABLE\b/i }),
  Object.freeze({ name: "drop-type", pattern: /\bDROP\s+TYPE\b/i }),
  Object.freeze({ name: "drop-domain", pattern: /\bDROP\s+DOMAIN\b/i }),
  Object.freeze({
    name: "rename-column",
    pattern: /\bALTER\s+TABLE\b[^;]*\bRENAME\s+COLUMN\b/is,
  }),
  Object.freeze({
    name: "rename-table",
    pattern: /\bALTER\s+TABLE\b[^;]*\bRENAME\s+TO\b/is,
  }),
  Object.freeze({
    name: "alter-column-type",
    pattern:
      /\bALTER\s+TABLE\b[^;]*\bALTER\s+(?:COLUMN\s+)?[^,;]+?\b(?:SET\s+DATA\s+)?TYPE\b/is,
  }),
  Object.freeze({
    name: "set-column-not-null",
    pattern:
      /\bALTER\s+TABLE\b[^;]*\bALTER\s+(?:COLUMN\s+)?[^,;]+?\bSET\s+NOT\s+NULL\b/is,
  }),
  Object.freeze({
    name: "drop-column-not-null",
    pattern:
      /\bALTER\s+TABLE\b[^;]*\bALTER\s+(?:COLUMN\s+)?[^,;]+?\bDROP\s+NOT\s+NULL\b/is,
  }),
  Object.freeze({
    name: "rename-type",
    pattern: /\bALTER\s+TYPE\b[^;]*\bRENAME\s+TO\b/is,
  }),
  Object.freeze({
    name: "rename-enum-value",
    pattern: /\bALTER\s+TYPE\b[^;]*\bRENAME\s+VALUE\b/is,
  }),
  Object.freeze({
    name: "drop-enum-value",
    pattern: /\bALTER\s+TYPE\b[^;]*\bDROP\s+VALUE\b/is,
  }),
  Object.freeze({
    name: "rename-type-attribute",
    pattern: /\bALTER\s+TYPE\b[^;]*\bRENAME\s+ATTRIBUTE\b/is,
  }),
  Object.freeze({
    name: "drop-type-attribute",
    pattern: /\bALTER\s+TYPE\b[^;]*\bDROP\s+ATTRIBUTE\b/is,
  }),
  Object.freeze({
    name: "alter-type-attribute-type",
    pattern: /\bALTER\s+TYPE\b[^;]*\bALTER\s+ATTRIBUTE\b[^;]*\bTYPE\b/is,
  }),
  Object.freeze({
    name: "move-type-schema",
    pattern: /\bALTER\s+TYPE\b[^;]*\bSET\s+SCHEMA\b/is,
  }),
]);

const obviousDataImpactPatterns = Object.freeze([
  Object.freeze({
    name: "procedural-do-block",
    pattern: /(?:^|;)\s*DO\b/is,
  }),
  Object.freeze({ name: "delete-rows", pattern: /\bDELETE\s+FROM\b/i }),
  Object.freeze({ name: "truncate-rows", pattern: /\bTRUNCATE\b/i }),
  Object.freeze({
    name: "alter-column-set-default",
    pattern: /\bALTER\s+COLUMN\b[^;]*\bSET\s+DEFAULT\b/is,
  }),
  Object.freeze({
    name: "add-not-null-default-column",
    pattern:
      /\bADD\s+COLUMN\b(?=[^;]*\bNOT\s+NULL\b)(?=[^;]*\bDEFAULT\b)[^;]*/is,
  }),
]);

function assertSafeMigrationName(value, label = "migration name") {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > MAX_MIGRATION_NAME_BYTES ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?$/.test(value)
  ) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function assertUnambiguousMigrationNames(
  values,
  label = "candidate migration",
) {
  if (!Array.isArray(values)) {
    throw new Error(`${label} names must be an array.`);
  }
  if (values.length === 0) {
    throw new Error(`At least one ${label} is required.`);
  }
  if (values.length > MAX_CANDIDATE_MIGRATIONS) {
    throw new Error(`Too many ${label} directories.`);
  }

  const exactNames = new Set();
  const portableNames = new Map();
  return values.map((value) => {
    const name = assertSafeMigrationName(value, `${label} name`);
    if (exactNames.has(name)) {
      throw new Error(`Duplicate ${label} name.`);
    }
    exactNames.add(name);

    // Production runs on Linux, but release candidates are also reviewed and
    // assembled on case-insensitive filesystems. Names that collapse there are
    // not one portable, auditable Prisma lineage.
    const portableName = name.toLowerCase();
    const previousName = portableNames.get(portableName);
    if (previousName !== undefined && previousName !== name) {
      throw new Error(`Case-ambiguous ${label} names are not allowed.`);
    }
    portableNames.set(portableName, name);
    return name;
  });
}

function loadManifest(manifestPath = defaultManifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest?.schemaVersion !== 2) {
    throw new Error("Migration-safety manifest schemaVersion must be 2.");
  }
  const manifestFields = Object.keys(manifest).sort();
  const expectedManifestFields = [
    "contractMigrations",
    "dataImpactMigrations",
    "schemaVersion",
  ];
  if (
    manifestFields.length !== expectedManifestFields.length ||
    manifestFields.some(
      (field, index) => field !== expectedManifestFields[index],
    )
  ) {
    throw new Error("Migration-safety manifest has an unexpected schema.");
  }
  if (!Array.isArray(manifest.contractMigrations)) {
    throw new Error(
      "Migration-safety manifest contractMigrations must be an array.",
    );
  }
  if (!Array.isArray(manifest.dataImpactMigrations)) {
    throw new Error(
      "Migration-safety manifest dataImpactMigrations must be an array.",
    );
  }

  const seen = new Set();
  for (const entry of manifest.contractMigrations) {
    const name = assertSafeMigrationName(
      entry?.name,
      "manifest migration name",
    );
    if (seen.has(name)) {
      throw new Error(`Duplicate migration-safety manifest entry: ${name}`);
    }
    seen.add(name);
    if (entry.requiredWorkflow !== "controlled-maintenance") {
      throw new Error(
        `Contract migration ${name} must require controlled-maintenance.`,
      );
    }
    if (
      !Array.isArray(entry.oldWriterServices) ||
      entry.oldWriterServices.length === 0 ||
      entry.oldWriterServices.some(
        (service) =>
          typeof service !== "string" || !/^[a-z0-9-]+$/.test(service),
      )
    ) {
      throw new Error(
        `Contract migration ${name} must list oldWriterServices.`,
      );
    }
    if (typeof entry.reason !== "string" || entry.reason.trim().length < 20) {
      throw new Error(
        `Contract migration ${name} must include an auditable reason.`,
      );
    }
  }

  const seenDataImpact = new Set();
  for (const entry of manifest.dataImpactMigrations) {
    const name = assertSafeMigrationName(
      entry?.name,
      "data-impact manifest migration name",
    );
    if (seenDataImpact.has(name)) {
      throw new Error(
        `Duplicate data-impact migration-safety manifest entry: ${name}`,
      );
    }
    seenDataImpact.add(name);
    if (entry.requiredWorkflow !== "controlled-maintenance") {
      throw new Error(
        `Data-impact migration ${name} must require controlled-maintenance.`,
      );
    }
    if (entry.acceptanceRequirement !== "reviewed-controlled-maintenance") {
      throw new Error(
        `Data-impact migration ${name} must require reviewed controlled-maintenance acceptance.`,
      );
    }
    if (
      typeof entry.impactKind !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.impactKind)
    ) {
      throw new Error(
        `Data-impact migration ${name} must include a safe impactKind.`,
      );
    }
    if (typeof entry.reason !== "string" || entry.reason.trim().length < 20) {
      throw new Error(
        `Data-impact migration ${name} must include an auditable reason.`,
      );
    }
  }

  return manifest;
}

function migrationChecksum(sqlBytes) {
  return crypto.createHash("sha256").update(sqlBytes).digest("hex");
}

function loadCandidateMigrations(migrationsPath = defaultMigrationsPath) {
  const migrationNames = assertUnambiguousMigrationNames(
    fs
      .readdirSync(migrationsPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  ).sort();

  return migrationNames.map((name) => {
    const sqlPath = path.join(migrationsPath, name, "migration.sql");
    let stat;
    try {
      stat = fs.lstatSync(sqlPath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(`Migration SQL is missing: ${name}`);
      }
      throw error;
    }
    if (!stat.isFile()) {
      throw new Error(`Migration SQL must be a regular file: ${name}`);
    }
    if (
      !Number.isSafeInteger(stat.size) ||
      stat.size > MAX_MIGRATION_SQL_BYTES
    ) {
      throw new Error(
        `Migration SQL exceeds the release-safety size limit: ${name}`,
      );
    }
    const sqlBytes = fs.readFileSync(sqlPath);
    if (
      sqlBytes.length !== stat.size ||
      sqlBytes.length > MAX_MIGRATION_SQL_BYTES
    ) {
      throw new Error(`Migration SQL changed while being inspected: ${name}`);
    }
    return Object.freeze({
      name,
      checksum: migrationChecksum(sqlBytes),
      sql: sqlBytes.toString("utf8"),
    });
  });
}

function candidateMigrationMetadata(migrationsPath = defaultMigrationsPath) {
  return loadCandidateMigrations(migrationsPath).map(({ name, checksum }) =>
    Object.freeze({ name, checksum }),
  );
}

function maskSqlRange(characters, start, end) {
  for (let index = start; index < end; index += 1) {
    if (characters[index] !== "\r" && characters[index] !== "\n") {
      characters[index] = " ";
    }
  }
}

function sqlCodeForDetection(sql) {
  const source = String(sql);
  const characters = source.split("");
  let index = 0;

  while (index < source.length) {
    if (source.startsWith("--", index)) {
      const end = source.indexOf("\n", index + 2);
      const commentEnd = end === -1 ? source.length : end;
      maskSqlRange(characters, index, commentEnd);
      index = commentEnd;
      continue;
    }

    if (source.startsWith("/*", index)) {
      const start = index;
      let depth = 1;
      index += 2;
      while (index < source.length && depth > 0) {
        if (source.startsWith("/*", index)) {
          depth += 1;
          index += 2;
        } else if (source.startsWith("*/", index)) {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (depth !== 0) {
        throw new Error(
          "Migration SQL contains an unterminated block comment.",
        );
      }
      maskSqlRange(characters, start, index);
      continue;
    }

    if (source[index] === "'" || source[index] === '"') {
      const quote = source[index];
      const start = index;
      let closed = false;
      index += 1;
      while (index < source.length) {
        if (source[index] === quote) {
          if (source[index + 1] === quote) {
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        if (quote === "'" && source[index] === "\\") {
          index += Math.min(2, source.length - index);
        } else {
          index += 1;
        }
      }
      if (!closed) {
        throw new Error("Migration SQL contains an unterminated quoted value.");
      }
      maskSqlRange(characters, start, index);
      continue;
    }

    if (source[index] === "$") {
      const delimiterMatch = source
        .slice(index)
        .match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (delimiterMatch) {
        const delimiter = delimiterMatch[0];
        const start = index;
        const end = source.indexOf(delimiter, index + delimiter.length);
        if (end === -1) {
          throw new Error(
            "Migration SQL contains an unterminated dollar-quoted value.",
          );
        }
        index = end + delimiter.length;
        maskSqlRange(characters, start, index);
        continue;
      }
    }

    index += 1;
  }

  return characters.join("");
}

function containsRowUpdate(sqlCode) {
  return sqlCode.split(";").some((rawStatement) => {
    const statement = rawStatement.trim();
    if (/^UPDATE\b/i.test(statement)) return true;
    if (/^WITH\b/i.test(statement) && /\bUPDATE\b/i.test(statement)) {
      return true;
    }
    if (
      /^INSERT\b/i.test(statement) &&
      /\bON\s+CONFLICT\b[\s\S]*\bDO\s+UPDATE\s+SET\b/i.test(statement)
    ) {
      return true;
    }
    return (
      /^MERGE\b/i.test(statement) &&
      /\b(?:THEN\s+)?UPDATE\s+SET\b/i.test(statement)
    );
  });
}

function detectedContractOperations(sql) {
  const sqlCode = sqlCodeForDetection(sql);
  return obviousContractPatterns
    .filter(({ pattern }) => pattern.test(sqlCode))
    .map(({ name }) => name);
}

function detectedDataImpactOperations(sql) {
  const sqlCode = sqlCodeForDetection(sql);
  return [
    ...(containsRowUpdate(sqlCode) ? ["update-rows"] : []),
    ...obviousDataImpactPatterns
      .filter(({ pattern }) => pattern.test(sqlCode))
      .map(({ name }) => name),
  ];
}

const migrationLedgerFields = Object.freeze([
  "appliedStepsCount",
  "checksum",
  "finished",
  "migrationName",
  "rolledBack",
]);

function validateMigrationLedgerRow(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Migration ledger row ${index + 1} must be an object.`);
  }
  const fields = Object.keys(value).sort();
  if (
    fields.length !== migrationLedgerFields.length ||
    fields.some(
      (field, fieldIndex) => field !== migrationLedgerFields[fieldIndex],
    )
  ) {
    throw new Error(
      `Migration ledger row ${index + 1} has an incomplete or unexpected schema.`,
    );
  }

  const migrationName = assertSafeMigrationName(
    value.migrationName,
    `database migration name in ledger row ${index + 1}`,
  );
  if (
    typeof value.checksum !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.checksum)
  ) {
    throw new Error(
      `Migration ledger row ${index + 1} has an invalid SHA-256 checksum.`,
    );
  }
  if (typeof value.finished !== "boolean") {
    throw new Error(
      `Migration ledger row ${index + 1} has an invalid finished state.`,
    );
  }
  if (typeof value.rolledBack !== "boolean") {
    throw new Error(
      `Migration ledger row ${index + 1} has an invalid rolledBack state.`,
    );
  }
  if (
    !Number.isSafeInteger(value.appliedStepsCount) ||
    value.appliedStepsCount < 0
  ) {
    throw new Error(
      `Migration ledger row ${index + 1} has an invalid appliedStepsCount.`,
    );
  }

  return Object.freeze({
    migrationName,
    checksum: value.checksum,
    finished: value.finished,
    rolledBack: value.rolledBack,
    appliedStepsCount: value.appliedStepsCount,
  });
}

function parseMigrationLedger(input) {
  const serialized = String(input);
  if (
    Buffer.byteLength(serialized, "utf8") > MAX_MIGRATION_LEDGER_INPUT_BYTES
  ) {
    throw new Error("Migration ledger input exceeds the safety limit.");
  }
  const lines = serialized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > MAX_MIGRATION_LEDGER_ROWS) {
    throw new Error("Migration ledger has too many rows.");
  }
  const rows = lines.map((line, index) => {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`Migration ledger row ${index + 1} is not valid JSON.`);
    }
    return validateMigrationLedgerRow(value, index);
  });
  return Object.freeze(rows);
}

function evaluateMigrationSafety({
  migrationLedger = [],
  manifest = loadManifest(),
  migrationsPath = defaultMigrationsPath,
  noOldWriters = false,
  deferDataImpact = false,
  verifiedEmptyTarget = false,
  requireAppliedMigration = false,
  allowLegacyWidgetKeyLedgerReconcile = false,
}) {
  if (deferDataImpact && verifiedEmptyTarget) {
    throw new Error(
      "Data-impact verification cannot be both deferred and empty-target verified.",
    );
  }
  if ((deferDataImpact || verifiedEmptyTarget) && !noOldWriters) {
    throw new Error(
      "Data-impact deferral or empty-target verification requires noOldWriters.",
    );
  }
  if (
    allowLegacyWidgetKeyLedgerReconcile &&
    (!noOldWriters || !deferDataImpact || verifiedEmptyTarget)
  ) {
    throw new Error(
      "Legacy widget-key ledger reconciliation requires the controlled no-old-writers data-impact deferral.",
    );
  }
  const ledgerRows = [...migrationLedger].map((row, index) =>
    validateMigrationLedgerRow(row, index),
  );
  const candidateMigrations = loadCandidateMigrations(migrationsPath);
  const candidateMetadata = candidateMigrations.map(({ name, checksum }) => ({
    name,
    checksum,
  }));
  const candidateByName = new Map(
    candidateMigrations.map((migration) => [migration.name, migration]),
  );
  const migrationNames = candidateMigrations.map(({ name }) => name);
  const knownMigrations = new Set(migrationNames);
  const incompleteLedgerRows = ledgerRows.filter(
    ({ finished, rolledBack, appliedStepsCount }) =>
      (!finished && !rolledBack) ||
      (finished && !rolledBack && appliedStepsCount === 0),
  );
  const legacyReconcileRows = incompleteLedgerRows.filter(
    ({ migrationName, checksum, finished, rolledBack, appliedStepsCount }) =>
      migrationName === LEGACY_RECONCILABLE_LEDGER_ROW.migrationName &&
      checksum === LEGACY_RECONCILABLE_LEDGER_ROW.checksum &&
      finished &&
      !rolledBack &&
      appliedStepsCount === 0,
  );
  const activeLegacyRows = ledgerRows.filter(
    ({ migrationName, finished, rolledBack }) =>
      migrationName === LEGACY_RECONCILABLE_LEDGER_ROW.migrationName &&
      finished &&
      !rolledBack,
  );
  const candidateLegacyMigration = candidateByName.get(
    LEGACY_RECONCILABLE_LEDGER_ROW.migrationName,
  );
  const legacyLedgerReconcilePending =
    allowLegacyWidgetKeyLedgerReconcile &&
    legacyReconcileRows.length === 1 &&
    activeLegacyRows.length === 1 &&
    candidateLegacyMigration?.checksum ===
      LEGACY_RECONCILABLE_LEDGER_ROW.checksum
      ? legacyReconcileRows
          .map(({ migrationName, checksum, appliedStepsCount }) => ({
            migrationName,
            checksum,
            appliedStepsCount,
          }))
      : [];
  const permittedLegacyReconcileRow =
    legacyLedgerReconcilePending.length === 1 ? legacyReconcileRows[0] : null;
  const incompleteMigrationLedgerRows = incompleteLedgerRows
    .filter((row) => row !== permittedLegacyReconcileRow)
    .map(({ migrationName, checksum, appliedStepsCount }) => ({
      migrationName,
      checksum,
      appliedStepsCount,
    }));
  if (incompleteMigrationLedgerRows.length > 0) {
    return {
      ok: false,
      reason: "database-migration-ledger-incomplete",
      candidateMigrations: candidateMetadata,
      incompleteMigrationLedgerRows,
      ambiguousMigrationLedgerRows: [],
      checksumMismatches: [],
      divergentAppliedMigrations: [],
      pendingContract: [],
      unclassifiedContract: [],
      pendingDataImpact: [],
      unclassifiedDataImpact: [],
    };
  }

  const impossibleLedgerRows = ledgerRows.filter(
    ({ finished, rolledBack }) => finished && rolledBack,
  );
  const activeRowsByName = new Map();
  for (const row of ledgerRows) {
    if (!row.finished || row.rolledBack) continue;
    const rows = activeRowsByName.get(row.migrationName) ?? [];
    rows.push(row);
    activeRowsByName.set(row.migrationName, rows);
  }
  const ambiguousMigrationLedgerRows = [
    ...impossibleLedgerRows.map(({ migrationName, checksum }) => ({
      migrationName,
      checksum,
      reason: "finished-and-rolled-back",
    })),
    ...[...activeRowsByName.entries()]
      .filter(([, rows]) => rows.length !== 1)
      .map(([migrationName, rows]) => ({
        migrationName,
        checksums: rows.map(({ checksum }) => checksum),
        reason: "multiple-finished-not-rolled-back-rows",
      })),
  ];
  if (ambiguousMigrationLedgerRows.length > 0) {
    return {
      ok: false,
      reason: "database-migration-ledger-ambiguous",
      candidateMigrations: candidateMetadata,
      incompleteMigrationLedgerRows,
      ambiguousMigrationLedgerRows,
      checksumMismatches: [],
      divergentAppliedMigrations: [],
      pendingContract: [],
      unclassifiedContract: [],
      pendingDataImpact: [],
      unclassifiedDataImpact: [],
    };
  }

  const appliedRows = [...activeRowsByName.values()].map(([row]) => row);
  if (requireAppliedMigration && appliedRows.length === 0) {
    return {
      ok: false,
      reason: "database-migration-ledger-has-no-applied-migration",
      candidateMigrations: candidateMetadata,
      incompleteMigrationLedgerRows,
      ambiguousMigrationLedgerRows,
      checksumMismatches: [],
      migrationLineageMismatches: [],
      divergentAppliedMigrations: [],
      pendingContract: [],
      unclassifiedContract: [],
      pendingDataImpact: [],
      unclassifiedDataImpact: [],
    };
  }
  const applied = new Set(
    appliedRows.map(({ migrationName }) => migrationName),
  );
  const divergentAppliedMigrations = [...applied]
    .filter((name) => !knownMigrations.has(name))
    .sort();
  if (divergentAppliedMigrations.length > 0) {
    return {
      ok: false,
      reason: "database-migration-history-diverges-from-source",
      candidateMigrations: candidateMetadata,
      incompleteMigrationLedgerRows,
      ambiguousMigrationLedgerRows,
      checksumMismatches: [],
      divergentAppliedMigrations,
      pendingContract: [],
      unclassifiedContract: [],
      pendingDataImpact: [],
      unclassifiedDataImpact: [],
    };
  }
  const checksumMismatches = appliedRows
    .filter(
      ({ migrationName, checksum }) =>
        candidateByName.get(migrationName).checksum !== checksum,
    )
    .map(({ migrationName, checksum }) => ({
      migrationName,
      databaseChecksum: checksum,
      candidateChecksum: candidateByName.get(migrationName).checksum,
    }))
    .sort((left, right) =>
      left.migrationName.localeCompare(right.migrationName),
    );
  if (checksumMismatches.length > 0) {
    return {
      ok: false,
      reason: "database-migration-checksum-mismatch",
      candidateMigrations: candidateMetadata,
      incompleteMigrationLedgerRows,
      ambiguousMigrationLedgerRows,
      checksumMismatches,
      divergentAppliedMigrations,
      pendingContract: [],
      unclassifiedContract: [],
      pendingDataImpact: [],
      unclassifiedDataImpact: [],
    };
  }
  const expectedAppliedPrefix = migrationNames.slice(0, appliedRows.length);
  const migrationLineageMismatches = appliedRows
    .map(({ migrationName }, index) => ({
      position: index + 1,
      expectedMigrationName: expectedAppliedPrefix[index],
      databaseMigrationName: migrationName,
    }))
    .filter(
      ({ expectedMigrationName, databaseMigrationName }) =>
        expectedMigrationName !== databaseMigrationName,
    );
  if (migrationLineageMismatches.length > 0) {
    return {
      ok: false,
      reason: "database-migration-lineage-is-not-candidate-prefix",
      candidateMigrations: candidateMetadata,
      incompleteMigrationLedgerRows,
      ambiguousMigrationLedgerRows,
      checksumMismatches,
      migrationLineageMismatches,
      divergentAppliedMigrations,
      pendingContract: [],
      unclassifiedContract: [],
      pendingDataImpact: [],
      unclassifiedDataImpact: [],
    };
  }
  const manifestByName = new Map(
    manifest.contractMigrations.map((entry) => [entry.name, entry]),
  );
  const dataImpactByName = new Map(
    manifest.dataImpactMigrations.map((entry) => [entry.name, entry]),
  );

  for (const name of manifestByName.keys()) {
    if (!knownMigrations.has(name)) {
      throw new Error(`Manifest migration directory is missing: ${name}`);
    }
    const operations = detectedContractOperations(
      candidateByName.get(name).sql,
    );
    if (operations.length === 0) {
      throw new Error(
        `Manifest contract migration has no detected contract operation: ${name}`,
      );
    }
  }
  for (const name of dataImpactByName.keys()) {
    if (!knownMigrations.has(name)) {
      throw new Error(
        `Data-impact manifest migration directory is missing: ${name}`,
      );
    }
  }

  const pendingContract = [];
  const unclassifiedContract = [];
  const pendingDataImpact = [];
  const unclassifiedDataImpact = [];
  for (const name of migrationNames) {
    if (applied.has(name)) continue;
    const { checksum, sql } = candidateByName.get(name);
    const contractOperations = detectedContractOperations(sql);
    const dataImpactOperations = detectedDataImpactOperations(sql);
    const contractClassification = manifestByName.get(name);
    const dataImpactClassification = dataImpactByName.get(name);

    if (contractOperations.length > 0) {
      if (!contractClassification) {
        unclassifiedContract.push({
          name,
          checksum,
          operations: contractOperations,
        });
      } else {
        pendingContract.push({
          name,
          checksum,
          operations: contractOperations,
          oldWriterServices: contractClassification.oldWriterServices,
          reason: contractClassification.reason,
        });
      }
    }

    if (dataImpactClassification) {
      pendingDataImpact.push({
        name,
        checksum,
        operations: dataImpactOperations,
        impactKind: dataImpactClassification.impactKind,
        reason: dataImpactClassification.reason,
      });
    } else if (dataImpactOperations.length > 0) {
      unclassifiedDataImpact.push({
        name,
        checksum,
        operations: dataImpactOperations,
      });
    }
  }

  if (unclassifiedContract.length > 0 && !noOldWriters) {
    return {
      ok: false,
      reason: "unclassified-destructive-migrations",
      candidateMigrations: candidateMetadata,
      incompleteMigrationLedgerRows,
      ambiguousMigrationLedgerRows,
      checksumMismatches,
      divergentAppliedMigrations,
      pendingContract,
      unclassifiedContract,
      pendingDataImpact,
      unclassifiedDataImpact,
    };
  }
  if (pendingContract.length > 0 && !noOldWriters) {
    return {
      ok: false,
      reason: "pending-old-writer-incompatible-migrations",
      candidateMigrations: candidateMetadata,
      incompleteMigrationLedgerRows,
      ambiguousMigrationLedgerRows,
      checksumMismatches,
      divergentAppliedMigrations,
      pendingContract,
      unclassifiedContract,
      pendingDataImpact,
      unclassifiedDataImpact,
    };
  }
  if (
    unclassifiedDataImpact.length > 0 &&
    !deferDataImpact &&
    !verifiedEmptyTarget
  ) {
    return {
      ok: false,
      reason: "unclassified-data-impact-migrations",
      candidateMigrations: candidateMetadata,
      incompleteMigrationLedgerRows,
      ambiguousMigrationLedgerRows,
      checksumMismatches,
      divergentAppliedMigrations,
      pendingContract,
      unclassifiedContract,
      pendingDataImpact,
      unclassifiedDataImpact,
    };
  }
  if (
    pendingDataImpact.length > 0 &&
    !deferDataImpact &&
    !verifiedEmptyTarget
  ) {
    return {
      ok: false,
      reason: "pending-data-impact-migrations",
      candidateMigrations: candidateMetadata,
      incompleteMigrationLedgerRows,
      ambiguousMigrationLedgerRows,
      checksumMismatches,
      divergentAppliedMigrations,
      pendingContract,
      unclassifiedContract,
      pendingDataImpact,
      unclassifiedDataImpact,
    };
  }
  return {
    ok: true,
    reason:
      legacyLedgerReconcilePending.length === 1
        ? "verified-no-old-writers-data-impact-deferred-legacy-ledger-reconcile-pending"
        : verifiedEmptyTarget
          ? "verified-empty-target-no-old-writers"
          : deferDataImpact
            ? "verified-no-old-writers-data-impact-deferred"
            : noOldWriters
              ? "verified-no-old-writers"
              : "no-pending-contract-or-data-impact-migrations",
    candidateMigrations: candidateMetadata,
    incompleteMigrationLedgerRows,
    ambiguousMigrationLedgerRows,
    checksumMismatches,
    divergentAppliedMigrations,
    pendingContract,
    unclassifiedContract,
    pendingDataImpact,
    unclassifiedDataImpact,
    legacyLedgerReconcilePending,
  };
}

function flagValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  if (index === process.argv.length - 1) {
    throw new Error(`${name} requires a value.`);
  }
  return process.argv[index + 1];
}

function main() {
  const noOldWriters = process.argv.includes("--no-old-writers");
  const deferDataImpact = process.argv.includes("--defer-data-impact");
  const verifiedEmptyTarget = process.argv.includes("--verified-empty-target");
  const requireAppliedMigration = process.argv.includes(
    "--require-applied-migration",
  );
  const allowLegacyWidgetKeyLedgerReconcile = process.argv.includes(
    "--allow-legacy-widget-key-ledger-reconcile",
  );
  const appliedInput = fs.readFileSync(0, "utf8");
  const manifestPath = path.resolve(
    flagValue("--manifest", defaultManifestPath),
  );
  const migrationsPath = path.resolve(
    flagValue("--migrations", defaultMigrationsPath),
  );
  const result = evaluateMigrationSafety({
    migrationLedger: parseMigrationLedger(appliedInput),
    manifest: loadManifest(manifestPath),
    migrationsPath,
    noOldWriters,
    deferDataImpact,
    verifiedEmptyTarget,
    requireAppliedMigration,
    allowLegacyWidgetKeyLedgerReconcile,
  });

  if (!result.ok) {
    process.stderr.write(
      `DEPLOYMENT BLOCKED: ${result.reason}\n` +
        `${JSON.stringify(result, null, 2)}\n` +
        "Use the reviewed controlled-maintenance/expand-contract procedure in infra/PUBLISH.md.\n" +
        "No migration, build, backfill, or service change was performed by this gate.\n",
    );
    process.exitCode = 75;
    return;
  }
  process.stdout.write(
    `MIGRATION SAFETY GATE PASSED reason=${result.reason} ` +
      `candidate_migrations=${result.candidateMigrations.length} ` +
      `pending_contract=${result.pendingContract.length} ` +
      `pending_data_impact=${result.pendingDataImpact.length} ` +
      `unclassified_data_impact=${result.unclassifiedDataImpact.length} ` +
      `legacy_ledger_reconcile_pending=${result.legacyLedgerReconcilePending.length}\n`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `MIGRATION SAFETY GATE ERROR: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 2;
  }
}

module.exports = {
  MAX_MIGRATION_LEDGER_INPUT_BYTES,
  MAX_MIGRATION_LEDGER_ROWS,
  LEGACY_RECONCILABLE_LEDGER_ROW,
  assertUnambiguousMigrationNames,
  candidateMigrationMetadata,
  detectedContractOperations,
  detectedDataImpactOperations,
  evaluateMigrationSafety,
  loadManifest,
  migrationChecksum,
  parseMigrationLedger,
};
