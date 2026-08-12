"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  assertForwardRelease,
} = require("./verify-production-forward-release.cjs");

const previous = Object.freeze({
  ARENZYRA_ROOT_GIT_COMMIT: "1".repeat(12),
  ARENZYRA_API_GIT_COMMIT: "2".repeat(12),
  ARENZYRA_WEB_GIT_COMMIT: "3".repeat(12),
});
const candidates = Object.freeze({
  ROOT: "a".repeat(40),
  API: "b".repeat(40),
  WEB: "c".repeat(40),
});

test("accepts only when every candidate contains its deployed history", () => {
  const calls = [];
  assert.doesNotThrow(() =>
    assertForwardRelease({
      previous,
      candidates,
      isAncestor(component, oldCommit, candidateCommit) {
        calls.push([component.name, oldCommit, candidateCommit]);
        return true;
      },
    }),
  );
  assert.deepEqual(
    calls.map(([name]) => name),
    ["ROOT", "API", "WEB"],
  );
});

test("blocks a candidate branch that would drop an earlier deployed fix", () => {
  assert.throws(
    () =>
      assertForwardRelease({
        previous,
        candidates,
        isAncestor: (component) => component.name !== "API",
      }),
    /Candidate API history does not contain the deployed release/,
  );
});

test("rejects abbreviated candidates and malformed prior revisions", () => {
  assert.throws(
    () =>
      assertForwardRelease({
        previous,
        candidates: { ...candidates, WEB: "c".repeat(12) },
        isAncestor: () => true,
      }),
    /Candidate WEB release revision is not canonical/,
  );
  assert.throws(
    () =>
      assertForwardRelease({
        previous: { ...previous, ARENZYRA_ROOT_GIT_COMMIT: "invalid" },
        candidates,
        isAncestor: () => true,
      }),
    /Prior ROOT release revision is not canonical/,
  );
});
