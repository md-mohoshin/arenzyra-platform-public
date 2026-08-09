#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const copyHeader =
  "COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;";
const defaultExpectedAggregate = Object.freeze({
  total: 107,
  successful: 102,
  rolledBack: 5,
  activeUnfinished: 0,
});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseNullableTimestamp(value, fieldName, rowNumber) {
  if (value === "\\N") {
    return null;
  }
  if (
    value.length > 40 ||
    /[\\\u0000-\u001f]/.test(value) ||
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:[+-]\d{2}(?::?\d{2})?)$/.test(
      value,
    )
  ) {
    throw new Error(`Invalid ${fieldName} at ledger row ${rowNumber}`);
  }

  const normalized = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new Error(`Unparseable ${fieldName} at ledger row ${rowNumber}`);
  }
  return value;
}

function parseLedgerRestoreSql(source) {
  if (typeof source !== "string") {
    throw new TypeError("Ledger restore source must be text");
  }
  if (Buffer.byteLength(source, "utf8") > 16 * 1024 * 1024) {
    throw new Error("Ledger restore source exceeds the 16 MiB safety bound");
  }

  const records = [];
  let insideCopy = false;
  let copyBlocks = 0;
  let copyTerminators = 0;
  let restrictKey = null;
  let unrestrictKey = null;

  for (const line of source.split(/\r?\n/)) {
    if (insideCopy) {
      if (line === "\\.") {
        insideCopy = false;
        copyTerminators += 1;
        continue;
      }

      const fields = line.split("\t");
      const rowNumber = records.length + 1;
      if (fields.length !== 8) {
        throw new Error(`Unexpected field count at ledger row ${rowNumber}`);
      }

      // Deliberately do not decode or retain id, logs, or started_at. Only the
      // five fields approved for sanitized historical evidence cross this
      // boundary.
      const checksum = fields[1];
      const migrationName = fields[3];
      const appliedSteps = fields[7];
      if (!/^[a-f0-9]{64}$/.test(checksum)) {
        throw new Error(`Invalid checksum at ledger row ${rowNumber}`);
      }
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/.test(migrationName)) {
        throw new Error(`Invalid migration name at ledger row ${rowNumber}`);
      }
      if (!/^\d+$/.test(appliedSteps)) {
        throw new Error(
          `Invalid applied step count at ledger row ${rowNumber}`,
        );
      }
      const appliedStepsCount = Number(appliedSteps);
      if (!Number.isSafeInteger(appliedStepsCount)) {
        throw new Error(`Unsafe applied step count at ledger row ${rowNumber}`);
      }

      records.push({
        migration_name: migrationName,
        checksum,
        finished_at: parseNullableTimestamp(
          fields[2],
          "finished_at",
          rowNumber,
        ),
        rolled_back_at: parseNullableTimestamp(
          fields[5],
          "rolled_back_at",
          rowNumber,
        ),
        applied_steps_count: appliedStepsCount,
      });
      continue;
    }

    if (line === copyHeader) {
      copyBlocks += 1;
      if (copyBlocks !== 1) {
        throw new Error("Ledger restore contains more than one COPY block");
      }
      insideCopy = true;
      continue;
    }
    if (line.startsWith("COPY ")) {
      throw new Error("Ledger restore contains an unexpected COPY target");
    }
    if (line === "" || line.startsWith("--") || /^SET [^;]+;$/.test(line)) {
      continue;
    }
    if (line === "SELECT pg_catalog.set_config('search_path', '', false);") {
      continue;
    }
    const restrictMatch = line.match(/^\\restrict ([A-Za-z0-9]{63})$/);
    if (restrictMatch) {
      if (restrictKey !== null) {
        throw new Error("Ledger restore contains duplicate restrict keys");
      }
      restrictKey = restrictMatch[1];
      continue;
    }
    const unrestrictMatch = line.match(/^\\unrestrict ([A-Za-z0-9]{63})$/);
    if (unrestrictMatch) {
      if (unrestrictKey !== null) {
        throw new Error("Ledger restore contains duplicate unrestrict keys");
      }
      unrestrictKey = unrestrictMatch[1];
      continue;
    }
    throw new Error("Ledger restore contains unexpected SQL outside COPY");
  }

  if (
    insideCopy ||
    copyBlocks !== 1 ||
    copyTerminators !== 1 ||
    restrictKey === null ||
    restrictKey !== unrestrictKey
  ) {
    throw new Error("Ledger restore COPY or restrict envelope is incomplete");
  }
  return records;
}

function sequenceDigest(records) {
  const material = `${records
    .map(({ migration_name, checksum }) => `${migration_name}\0${checksum}`)
    .join("\n")}\n`;
  return sha256(material);
}

function timestampMilliseconds(value) {
  return Date.parse(value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
}

function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function summarizeLedger(records) {
  const successful = records.filter(
    ({ finished_at, rolled_back_at }) =>
      finished_at !== null && rolled_back_at === null,
  );
  const rolledBack = records.filter(
    ({ rolled_back_at }) => rolled_back_at !== null,
  );
  const activeUnfinished = records.filter(
    ({ finished_at, rolled_back_at }) =>
      finished_at === null && rolled_back_at === null,
  );
  const conflicting = records.filter(
    ({ finished_at, rolled_back_at }) =>
      finished_at !== null && rolled_back_at !== null,
  );

  const successfulByName = new Map();
  for (const record of successful) {
    const values = successfulByName.get(record.migration_name) || [];
    values.push(record);
    successfulByName.set(record.migration_name, values);
  }
  const duplicateSuccessfulNames = [...successfulByName.entries()]
    .filter(([, values]) => values.length > 1)
    .map(([name]) => name)
    .sort();

  const sanitizedRows = new Map();
  for (const record of records) {
    const key = JSON.stringify(record);
    sanitizedRows.set(key, (sanitizedRows.get(key) || 0) + 1);
  }
  const exactDuplicateSanitizedRows = [...sanitizedRows.values()].filter(
    (count) => count > 1,
  ).length;

  const orphanRolledBackAttempts = [];
  const rolledBackChecksumDrift = [];
  for (const record of rolledBack) {
    const matchingSuccess = successfulByName.get(record.migration_name) || [];
    if (matchingSuccess.length !== 1) {
      orphanRolledBackAttempts.push(record.migration_name);
    } else if (matchingSuccess[0].checksum !== record.checksum) {
      rolledBackChecksumDrift.push(record.migration_name);
    }
  }

  const chronological = [...successful].sort((left, right) => {
    const timeDifference =
      timestampMilliseconds(left.finished_at) -
      timestampMilliseconds(right.finished_at);
    return (
      timeDifference || compareAscii(left.migration_name, right.migration_name)
    );
  });
  const lexical = [...successful].sort((left, right) =>
    compareAscii(left.migration_name, right.migration_name),
  );
  const successfulSequenceSha256 = sequenceDigest(successful);
  const chronologicalSequenceSha256 = sequenceDigest(chronological);
  const lexicalSequenceSha256 = sequenceDigest(lexical);

  return {
    total: records.length,
    successful: successful.length,
    rolled_back: rolledBack.length,
    active_unfinished: activeUnfinished.length,
    conflicting_finished_and_rolled_back: conflicting.length,
    unique_successful_migration_names: successfulByName.size,
    duplicate_successful_migration_names: duplicateSuccessfulNames,
    exact_duplicate_sanitized_rows: exactDuplicateSanitizedRows,
    orphan_rolled_back_attempts: orphanRolledBackAttempts.sort(),
    rolled_back_checksum_drift_attempts: rolledBackChecksumDrift.length,
    rolled_back_checksum_drift_names: [
      ...new Set(rolledBackChecksumDrift),
    ].sort(),
    successful_sequence_sha256: successfulSequenceSha256,
    chronological_sequence_sha256: chronologicalSequenceSha256,
    lexical_sequence_sha256: lexicalSequenceSha256,
    file_order_matches_finished_chronology:
      successfulSequenceSha256 === chronologicalSequenceSha256,
    finished_chronology_matches_lexical_order:
      chronologicalSequenceSha256 === lexicalSequenceSha256,
    sanitized_records_sha256: sha256(`${JSON.stringify(records)}\n`),
  };
}

function assertLedgerAggregate(summary, expected = defaultExpectedAggregate) {
  const problems = [];
  if (summary.total !== expected.total) {
    problems.push(`total=${summary.total}, expected ${expected.total}`);
  }
  if (summary.successful !== expected.successful) {
    problems.push(
      `successful=${summary.successful}, expected ${expected.successful}`,
    );
  }
  if (summary.rolled_back !== expected.rolledBack) {
    problems.push(
      `rolled_back=${summary.rolled_back}, expected ${expected.rolledBack}`,
    );
  }
  if (summary.active_unfinished !== expected.activeUnfinished) {
    problems.push(
      `active_unfinished=${summary.active_unfinished}, expected ${expected.activeUnfinished}`,
    );
  }
  if (summary.conflicting_finished_and_rolled_back !== 0) {
    problems.push("finished and rolled-back timestamps overlap");
  }
  if (summary.duplicate_successful_migration_names.length !== 0) {
    problems.push("successful migration names are duplicated");
  }
  if (summary.exact_duplicate_sanitized_rows !== 0) {
    problems.push("sanitized ledger rows are duplicated exactly");
  }
  if (summary.orphan_rolled_back_attempts.length !== 0) {
    problems.push("rolled-back attempts lack one successful retry");
  }
  if (problems.length > 0) {
    throw new Error(
      `Prisma migration ledger invariant failed: ${problems.join("; ")}`,
    );
  }
}

function parseArguments(argv) {
  const options = { summaryOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--input" && argv[index + 1]) {
      options.input = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--summary-only") {
      options.summaryOnly = true;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
    }
  }
  if (!options.input) {
    throw new Error(
      "Usage: parse-prisma-migration-ledger.cjs --input FILE [--summary-only]",
    );
  }
  return options;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const inputPath = path.resolve(options.input);
  const input = fs.lstatSync(inputPath);
  if (
    !input.isFile() ||
    input.isSymbolicLink() ||
    input.size > 16 * 1024 * 1024
  ) {
    throw new Error("Ledger restore input must be a bounded regular file");
  }
  const records = parseLedgerRestoreSql(fs.readFileSync(inputPath, "utf8"));
  const summary = summarizeLedger(records);
  assertLedgerAggregate(summary);
  const result = options.summaryOnly ? summary : { summary, records };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  assertLedgerAggregate,
  copyHeader,
  defaultExpectedAggregate,
  parseLedgerRestoreSql,
  sequenceDigest,
  summarizeLedger,
};
