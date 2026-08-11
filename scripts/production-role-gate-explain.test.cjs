"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const parser = path.join(__dirname, "parse-production-role-gate-explain.cjs");

function run(input) {
  return spawnSync(process.execPath, [parser], {
    encoding: "utf8",
    input: typeof input === "string" ? input : JSON.stringify(input),
  });
}

test("role-gate explain parser emits only bounded branch counts", () => {
  const result = run([
    {
      Plan: {
        "Node Type": "Aggregate",
        Plans: [
          {
            "Node Type": "Append",
            Plans: [
              { "Node Type": "Result", "Actual Rows": 0, "Actual Loops": 1 },
              { "Node Type": "Result", "Actual Rows": 2, "Actual Loops": 1 },
              { "Node Type": "Result", "Actual Rows": 1, "Actual Loops": 3 },
            ],
          },
        ],
      },
    },
  ]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "branches=3 violating=2:2,3:3 total=5");
  assert.equal(result.stderr, "");
});

test("role-gate explain parser rejects malformed or unbounded plans", () => {
  for (const input of ["{}", "[]", "not-json", JSON.stringify([{ Plan: {} }])]) {
    const result = run(input);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
  }
});
