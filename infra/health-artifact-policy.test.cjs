"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { resolveWebBuildArtifact } = require("./health-artifact-policy.cjs");

test("normal web readiness ignores stale .next and requires .next-build", (t) => {
  const webDir = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-web-artifact-"));
  t.after(() => fs.rmSync(webDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(webDir, ".next"), { recursive: true });
  fs.writeFileSync(path.join(webDir, ".next", "BUILD_ID"), "stale");
  assert.throws(() => resolveWebBuildArtifact(webDir), /\.next-build/);

  fs.mkdirSync(path.join(webDir, ".next-build"), { recursive: true });
  fs.writeFileSync(path.join(webDir, ".next-build", "BUILD_ID"), "current");
  assert.equal(
    resolveWebBuildArtifact(webDir),
    path.resolve(webDir, ".next-build", "BUILD_ID"),
  );
});
