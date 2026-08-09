"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  assertLedgerAggregate,
  copyHeader,
  parseLedgerRestoreSql,
  summarizeLedger,
} = require("./parse-prisma-migration-ledger.cjs");

const restrictKey = "a".repeat(63);
const checksumA = "a".repeat(64);
const checksumB = "b".repeat(64);
const checksumC = "c".repeat(64);

function restoreSql(
  rows,
  { header = copyHeader, unrestrict = restrictKey } = {},
) {
  return [
    "-- PostgreSQL database dump",
    `\\restrict ${restrictKey}`,
    "SET statement_timeout = 0;",
    "SELECT pg_catalog.set_config('search_path', '', false);",
    header,
    ...rows,
    "\\.",
    `\\unrestrict ${unrestrict}`,
    "",
  ].join("\n");
}

function row({
  checksum,
  finished = "\\N",
  name,
  logs = "\\N",
  rolledBack = "\\N",
  steps = 0,
}) {
  return [
    "ignored-id",
    checksum,
    finished,
    name,
    logs,
    rolledBack,
    "ignored-started-at",
    String(steps),
  ].join("\t");
}

test("parser retains only approved fields and validates retry aggregates", () => {
  const records = parseLedgerRestoreSql(
    restoreSql([
      row({
        checksum: checksumA,
        finished: "2026-01-01 00:00:01+00",
        name: "20260101000000_initial",
        logs: "sensitive-log-must-not-cross-boundary",
        steps: 1,
      }),
      row({
        checksum: checksumB,
        name: "20260102000000_retry",
        rolledBack: "2026-01-02 00:00:01+00",
      }),
      row({
        checksum: checksumC,
        finished: "2026-01-02 00:00:02+00",
        name: "20260102000000_retry",
        steps: 1,
      }),
    ]),
  );

  assert.deepEqual(Object.keys(records[0]), [
    "migration_name",
    "checksum",
    "finished_at",
    "rolled_back_at",
    "applied_steps_count",
  ]);
  assert.doesNotMatch(JSON.stringify(records), /sensitive-log/);

  const summary = summarizeLedger(records);
  assertLedgerAggregate(summary, {
    total: 3,
    successful: 2,
    rolledBack: 1,
    activeUnfinished: 0,
  });
  assert.equal(summary.unique_successful_migration_names, 2);
  assert.equal(summary.rolled_back_checksum_drift_attempts, 1);
  assert.deepEqual(summary.rolled_back_checksum_drift_names, [
    "20260102000000_retry",
  ]);
});

test("parser rejects any extra COPY target", () => {
  assert.throws(
    () =>
      parseLedgerRestoreSql(
        restoreSql([], {
          header: "COPY public.users (id) FROM stdin;",
        }),
      ),
    /unexpected COPY target/i,
  );
});

test("parser rejects mismatched restrict envelopes", () => {
  assert.throws(
    () =>
      parseLedgerRestoreSql(
        restoreSql([], {
          unrestrict: "b".repeat(63),
        }),
      ),
    /envelope is incomplete/i,
  );
});

test("aggregate rejects active and duplicate successful migrations", () => {
  const records = parseLedgerRestoreSql(
    restoreSql([
      row({
        checksum: checksumA,
        finished: "2026-01-01 00:00:01+00",
        name: "20260101000000_duplicate",
        steps: 1,
      }),
      row({
        checksum: checksumA,
        finished: "2026-01-01 00:00:02+00",
        name: "20260101000000_duplicate",
        steps: 1,
      }),
      row({ checksum: checksumB, name: "20260102000000_active" }),
    ]),
  );
  const summary = summarizeLedger(records);
  assert.throws(
    () =>
      assertLedgerAggregate(summary, {
        total: 3,
        successful: 2,
        rolledBack: 0,
        activeUnfinished: 0,
      }),
    /active_unfinished|duplicated/i,
  );
});

test("committed historical evidence remains sanitized and non-authorizing", () => {
  const evidence = JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "docs",
        "codex",
        "PRODUCTION_PRISMA_LEDGER_HISTORICAL_SNAPSHOT_20260809.json",
      ),
      "utf8",
    ),
  );

  assert.equal(evidence.classification.state, "historical_snapshot_only");
  assert.match(evidence.classification.warning, /not release authorization/i);
  assert.deepEqual(evidence.sanitization.retained_record_fields, [
    "migration_name",
    "checksum",
    "finished_at",
    "rolled_back_at",
    "applied_steps_count",
  ]);
  assert.equal(evidence.sanitization.raw_sql_retained, false);
  assert.equal(evidence.sanitization.application_rows_retained, false);
  assert.equal(evidence.records.length, 107);
  for (const record of evidence.records) {
    assert.deepEqual(
      Object.keys(record),
      evidence.sanitization.retained_record_fields,
    );
  }

  const summary = summarizeLedger(evidence.records);
  assertLedgerAggregate(summary);
  assert.deepEqual(summary, evidence.aggregate);
  assert.equal(evidence.temporary_plaintext_cleanup.status, "verified_removed");
  assert.equal(evidence.comparisons.canonical_api_lineage.migration_count, 100);
  assert.deepEqual(
    evidence.comparisons.canonical_api_lineage
      .historical_successful_missing_from_source,
    [
      "20260801190000_pcob_raw_payload_bytes",
      "20260803110000_add_pubg_match_maps",
    ],
  );
  assert.equal(
    evidence.comparisons.canonical_api_lineage
      .source_name_order_is_prefix_of_historical,
    true,
  );
  assert.equal(
    evidence.comparisons.canonical_api_lineage
      .source_is_exact_name_checksum_prefix_of_historical,
    false,
  );
});
