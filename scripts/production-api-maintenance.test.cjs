"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

test("unsupported API maintenance blocks before every external action", () => {
  const wrapper = read("scripts/production-api-maintenance.sh");
  const block = wrapper.indexOf("PRODUCTION API MAINTENANCE BLOCKED");

  assert.ok(block >= 0);
  assert.match(wrapper, /exit 75/);
  assert.match(
    wrapper,
    /No Docker, database, backup, migration, or service action was attempted/,
  );
  assert.doesNotMatch(wrapper, /docker\s+(?:compose|run|exec|inspect|image)/);
  assert.doesNotMatch(wrapper, /production-deploy-preflight\.sh/);
  assert.doesNotMatch(wrapper, /production-backup\.sh/);
  assert.doesNotMatch(wrapper, /dist-maintenance/);
});

test("publish Compose exposes one-shot migrations but no maintenance profile", () => {
  const compose = read("infra/docker-compose.publish.yml");
  const migration = compose.match(
    /\n  api-migrate:\r?\n([\s\S]*?)(?=\n  [a-zA-Z0-9_-]+:\r?\n|\nvolumes:\r?\n)/,
  )?.[1];

  assert.ok(migration);
  assert.match(migration, /profiles: \["migration"\]/);
  assert.match(
    migration,
    /command: \["\.\/node_modules\/\.bin\/prisma", "migrate", "deploy"\]/,
  );
  assert.doesNotMatch(compose, /api-maintenance-/);
  assert.doesNotMatch(compose, /profiles: \["maintenance"\]/);
  assert.doesNotMatch(compose, /dist-maintenance/);
});

test("the package command is an explicit blocker, not an absent or runtime-failing command", () => {
  const manifest = JSON.parse(read("package.json"));
  assert.equal(
    manifest.scripts["deploy:api-maintenance"],
    "bash scripts/production-api-maintenance.sh",
  );
  assert.equal(
    manifest.scripts["test:production-api-maintenance"],
    "node --test scripts/production-api-maintenance.test.cjs",
  );
});
