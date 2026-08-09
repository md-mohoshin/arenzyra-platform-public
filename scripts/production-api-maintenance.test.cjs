"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

function serviceBlock(compose, serviceName) {
  const match = compose.match(
    new RegExp(
      `\\n  ${serviceName}:\\r?\\n([\\s\\S]*?)(?=\\n  [a-zA-Z0-9_-]+:\\r?\\n|\\nvolumes:\\r?\\n)`,
    ),
  );
  assert.ok(match, `missing ${serviceName}`);
  return match[1];
}

test("production API maintenance is an exact authenticated IDP dry-run closure", () => {
  const wrapper = read("scripts/production-api-maintenance.sh");
  const block = wrapper.indexOf("PRODUCTION API MAINTENANCE BLOCKED");
  const dockerGuard = wrapper.indexOf(
    "source scripts/require-local-production-docker.sh",
  );
  const bootstrap = wrapper.indexOf(
    "verify_bootstrap_repository ROOT",
  );
  const sourceGate = wrapper.indexOf(
    "verify-production-release-source.cjs --check-checkout-only",
  );
  const exactSourceGate = wrapper.indexOf(
    '--release-env "$archived_release"',
    sourceGate,
  );
  const imageInspect = wrapper.indexOf("docker image inspect");
  const composeRun = wrapper.indexOf(
    "api-maintenance-idp-dry-run",
    imageInspect,
  );

  assert.ok(block >= 0);
  assert.ok(block < dockerGuard);
  assert.ok(bootstrap > block && bootstrap < dockerGuard);
  assert.ok(dockerGuard < sourceGate && sourceGate < imageInspect);
  assert.ok(exactSourceGate > sourceGate && exactSourceGate < imageInspect);
  assert.ok(imageInspect < composeRun);
  assert.match(wrapper.slice(0, dockerGuard), /GIT_NO_REPLACE_OBJECTS=1/);
  assert.match(wrapper.slice(0, dockerGuard), /--porcelain=v1 --untracked-files=all/);
  assert.match(wrapper, /exit 75/);
  assert.match(
    wrapper,
    /only authenticated IDP dry-run is available/,
  );
  assert.match(wrapper, /api-maintenance-idp-dry-run/);
  assert.doesNotMatch(wrapper, /api-maintenance-idp-(?:apply|validate)/);
  assert.doesNotMatch(wrapper, /youtube/i);
  assert.doesNotMatch(wrapper, /--allow-stopped-idp-maintenance/);
  assert.doesNotMatch(wrapper, /pg_stat_activity|pg_prepared_xacts/);
  assert.doesNotMatch(wrapper, /production-backup\.sh|create_backup/);
  assert.match(wrapper, /verify-production-database-roles\.sh/);
  assert.match(wrapper, /verify-production-api-capabilities\.cjs/);
  assert.match(wrapper, /--mode idp-maintenance/);
  assert.match(wrapper, /--assert-compose-json/);
  assert.doesNotMatch(wrapper, /--apply|--writers-stopped|BACKFILL_IDP_CREDENTIALS|VALIDATE_IDP_ENVELOPE_CONSTRAINT/);
  assert.match(wrapper, /verify-idp-maintenance-summary\.cjs[\s\S]*--preview/);
  assert.doesNotMatch(wrapper, /docker\s+(?:build|pull)\b/);
  assert.doesNotMatch(wrapper, /docker\s+compose\s+up\b/);
});

test("publish Compose exposes only the compiled IDP dry-run service", () => {
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
  assert.deepEqual(
    [...compose.matchAll(/^  (api-maintenance-[a-z0-9-]+):$/gm)].map(
      (match) => match[1],
    ),
    [
      "api-maintenance-idp-dry-run",
    ],
  );

  const expected = [
    [
      "api-maintenance-idp-dry-run",
      "MAINTENANCE_READ_DATABASE_URL",
      "dist-maintenance/scripts/backfill-idp-credentials.js",
    ],
  ];
  for (const [serviceName, databaseKey, compiledPath] of expected) {
    const service = serviceBlock(compose, serviceName);
    assert.match(service, /profiles: \["maintenance"\]/);
    assert.match(service, /image: "arenzyra-api:/);
    assert.match(service, /user: "1000:1000"/);
    assert.match(service, new RegExp(`DATABASE_URL: "\\$\\{${databaseKey}:`));
    assert.match(service, new RegExp(compiledPath.replaceAll(".", "\\.")));
    assert.match(service, /read_only: true/);
    assert.match(service, /noexec,nosuid,nodev/);
    assert.match(service, /cap_drop:\r?\n      - ALL/);
    assert.match(service, /no-new-privileges:true/);
    assert.match(service, /restart: "no"/);
    assert.doesNotMatch(service, /\n    (?:build|volumes|ports|entrypoint):/);
    assert.doesNotMatch(service, /(?:npx|ts-node|\.ts\b|\/bin\/sh|youtube)/i);
  }
  assert.doesNotMatch(compose, /api-maintenance-idp-(?:apply|validate)/);
  assert.doesNotMatch(compose, /api-maintenance-youtube/);
});

test("raw npm maintenance cannot execute the production mutation wrapper", () => {
  const manifest = JSON.parse(read("package.json"));
  assert.doesNotMatch(
    manifest.scripts["deploy:api-maintenance"],
    /production-api-maintenance\.sh/,
  );
  assert.equal(
    manifest.scripts["test:production-api-maintenance"],
    "node --test scripts/production-api-maintenance.test.cjs",
  );
});
