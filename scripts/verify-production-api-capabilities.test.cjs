"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  canonicalVerifierRelativePath,
  verifyCanonicalApiImageContract,
} = require("./verify-production-api-capabilities.cjs");

function fixture(t, verifierSource) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-canonical-api-contract-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const verifierPath = path.join(
    root,
    ...canonicalVerifierRelativePath.split("/"),
  );
  fs.mkdirSync(path.dirname(verifierPath), { recursive: true });
  if (verifierSource !== undefined) {
    fs.writeFileSync(verifierPath, verifierSource);
  }
  return root;
}

test("accepts only the canonical API source-boundary verifier contract", (t) => {
  const root = fixture(
    t,
    "exports.verifySourceBoundary = (root) => ({ mode: 'source', root, ok: true, failures: [] });\n",
  );
  const result = verifyCanonicalApiImageContract(root);
  assert.equal(result.ok, true);
  assert.equal(result.mode, "source");
  assert.deepEqual(result.failures, []);
});

test("fails closed when the canonical verifier is missing or malformed", (t) => {
  const missing = fixture(t);
  assert.throws(
    () => verifyCanonicalApiImageContract(missing),
    /boundary verifier is missing/,
  );

  const malformed = fixture(
    t,
    "exports.verifySourceBoundary = () => ({ ok: true, failures: [] });\n",
  );
  assert.throws(
    () => verifyCanonicalApiImageContract(malformed),
    /returned an invalid result/,
  );
});

test("propagates a canonical source-boundary denial without weakening it", (t) => {
  const root = fixture(
    t,
    "exports.verifySourceBoundary = () => ({ mode: 'source', ok: false, failures: ['runtime startup must not migrate'] });\n",
  );
  assert.deepEqual(verifyCanonicalApiImageContract(root), {
    mode: "source",
    ok: false,
    failures: ["runtime startup must not migrate"],
  });
});
