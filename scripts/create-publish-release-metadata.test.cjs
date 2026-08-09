"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  collectGitProvenance,
  collectBaseImageReferences,
  collectRuntimeImageReferences,
  collectReleaseFiles,
  contentDigest,
  createReleaseMetadata,
  authorizeReleaseProvenance,
  defaultGitComponents,
  defaultIncludedPaths,
} = require("./create-publish-release-metadata.cjs");

const repositoryRoot = path.resolve(__dirname, "..");

function writeFile(rootDir, relativePath, content) {
  const filePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

function runGit(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function initializeRepository(directory) {
  runGit(directory, ["init", "-q"]);
  runGit(directory, ["add", "--all"]);
  runGit(directory, [
    "-c",
    "user.name=Arenzyra Test",
    "-c",
    "user.email=release-test@invalid.example",
    "commit",
    "-qm",
    "initial",
  ]);
}

const collectFixtureReleaseFiles = (options) =>
  collectReleaseFiles({ ...options, requireTracked: false });
const fixtureContentDigest = (options) =>
  contentDigest({ ...options, requireTracked: false });

test("release inputs cover every production Compose build component", () => {
  const compose = fs.readFileSync(
    path.join(repositoryRoot, "infra", "docker-compose.publish.yml"),
    "utf8",
  );
  const contexts = [...compose.matchAll(/^\s+context:\s+([^\s]+)\s*$/gm)].map(
    (match) => match[1],
  );

  assert.deepEqual([...new Set(contexts)].sort(), [
    "..",
    "../apps/api",
    "../apps/media-ai-service",
  ]);
  for (const requiredPath of [
    ".dockerignore",
    "apps/api",
    "apps/arenzyra-web",
    "apps/discord-bot",
    "apps/media-ai-service",
    "packages/arenzyra-types",
    "infra/Caddyfile",
    "infra/docker-compose.publish.yml",
    "infra/docker-compose.discord-bot.remote.yml",
    "infra/production-database-object-policy.json",
    "infra/sql/bootstrap-production-roles.sql",
    "infra/sql/production-entitlement-inventory.sql",
    "scripts",
  ]) {
    assert.ok(
      defaultIncludedPaths.includes(requiredPath),
      `${requiredPath} should be a release digest input`,
    );
  }

  assert.deepEqual(
    defaultGitComponents.map(({ name, repoPath }) => [name, repoPath]),
    [
      ["ROOT", "."],
      ["API", "apps/api"],
      ["WEB", "apps/arenzyra-web"],
      ["DISCORD", "."],
      ["MEDIA", "."],
      ["INFRA", "."],
    ],
  );
});

test("release inputs cover the entire scripts tree without a brittle helper list", () => {
  assert.equal(defaultIncludedPaths.includes("scripts"), true);
  assert.deepEqual(
    defaultIncludedPaths.filter((relativePath) =>
      relativePath.startsWith("scripts/"),
    ),
    [],
  );

  const collectedScripts = new Set(
    collectReleaseFiles({
      rootDir: repositoryRoot,
      includedPaths: ["scripts"],
    }).map((filePath) =>
      path.relative(repositoryRoot, filePath).replace(/\\/g, "/"),
    ),
  );
  const deploymentEntrypoints = [
    "scripts/deploy-production.sh",
    "scripts/rollback-production-images.sh",
  ];
  const referencedHelpers = new Set();
  for (const entrypoint of deploymentEntrypoints) {
    const source = fs.readFileSync(
      path.join(repositoryRoot, entrypoint),
      "utf8",
    );
    for (const match of source.matchAll(
      /scripts\/[a-zA-Z0-9._/-]+\.(?:cjs|js|sh)/g,
    )) {
      if (fs.existsSync(path.join(repositoryRoot, match[0]))) {
        referencedHelpers.add(match[0]);
      }
    }
  }

  assert.ok(referencedHelpers.size > 0);
  for (const helper of referencedHelpers) {
    assert.equal(
      collectedScripts.has(helper),
      true,
      `${helper} must be covered by the scripts-tree release input`,
    );
  }
});

test("release inputs fail closed for quarantined commercial map sources", (t) => {
  const rootDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-release-map-quarantine-"),
  );
  t.after(() => fs.rmSync(rootDir, { force: true, recursive: true }));

  writeFile(
    rootDir,
    "scripts/reviewed-release-helper.cjs",
    "module.exports = {};\n",
  );
  writeFile(rootDir, "scripts/assets/neutral/preview.svg", "<svg/>\n");
  const includedPaths = ["scripts"];

  const initialFiles = collectFixtureReleaseFiles({ rootDir, includedPaths }).map(
    (filePath) => path.relative(rootDir, filePath).replace(/\\/g, "/"),
  );
  assert.deepEqual(initialFiles, [
    "scripts/assets/neutral/preview.svg",
    "scripts/reviewed-release-helper.cjs",
  ]);

  const rasterPath = writeFile(
    rootDir,
    "scripts/assets/pubgm-maps/erangel.png",
    "unapproved-raster-bytes\n",
  );
  assert.throws(
    () => collectFixtureReleaseFiles({ rootDir, includedPaths }),
    /Release input is quarantined.*scripts\/assets\/pubgm-maps\/erangel\.png/,
  );
  fs.rmSync(rasterPath);

  const generatorPath = writeFile(
    rootDir,
    "scripts/generate-pubgm-map-assets.mjs",
    "// quarantined single-purpose generator\n",
  );
  assert.throws(
    () => collectFixtureReleaseFiles({ rootDir, includedPaths }),
    /Release input is quarantined.*scripts\/generate-pubgm-map-assets\.mjs/,
  );
  fs.rmSync(generatorPath);

  assert.doesNotThrow(() => collectFixtureReleaseFiles({ rootDir, includedPaths }));
});

test("content digest changes for every release component and excludes local artifacts", (t) => {
  const rootDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-release-digest-"),
  );
  t.after(() => fs.rmSync(rootDir, { force: true, recursive: true }));

  const includedPaths = [
    "apps/api",
    "apps/arenzyra-web",
    "apps/discord-bot",
    "apps/media-ai-service",
    "packages/arenzyra-types",
    "infra/Caddyfile",
    "infra/docker-compose.publish.yml",
  ];
  const componentFiles = [
    "apps/api/src/api.ts",
    "apps/arenzyra-web/app/page.tsx",
    "apps/discord-bot/src/bot.ts",
    "apps/media-ai-service/main.py",
    "packages/arenzyra-types/src/index.ts",
    "infra/Caddyfile",
    "infra/docker-compose.publish.yml",
  ];
  for (const relativePath of componentFiles) {
    writeFile(rootDir, relativePath, `source:${relativePath}\n`);
  }
  writeFile(rootDir, "apps/api/.env", "DATABASE_URL=do-not-emit\n");
  writeFile(rootDir, "apps/arenzyra-web/.env.local", "TOKEN=do-not-emit\n");
  writeFile(
    rootDir,
    "apps/arenzyra-web/.env.production",
    "TOKEN=do-not-emit\n",
  );
  writeFile(
    rootDir,
    "apps/api/.env.example",
    "DATABASE_URL=reviewed-example\n",
  );
  writeFile(
    rootDir,
    "apps/arenzyra-web/.env.production.example",
    "TOKEN=reviewed-example\n",
  );
  writeFile(rootDir, "apps/api/private-key.pem", "do-not-emit\n");
  writeFile(rootDir, "apps/discord-bot/logs/runtime.log", "generated\n");
  writeFile(
    rootDir,
    "apps/arenzyra-web/.tmp-preview/capture.txt",
    "generated\n",
  );

  const initial = fixtureContentDigest({ rootDir, includedPaths }).digest;
  for (const relativePath of componentFiles) {
    const filePath = path.join(rootDir, relativePath);
    const original = fs.readFileSync(filePath);
    fs.appendFileSync(filePath, "changed\n");
    assert.notEqual(
      fixtureContentDigest({ rootDir, includedPaths }).digest,
      initial,
      `${relativePath} should affect the release digest`,
    );
    fs.writeFileSync(filePath, original);
  }

  for (const relativePath of [
    "apps/api/.env.example",
    "apps/arenzyra-web/.env.production.example",
  ]) {
    const filePath = path.join(rootDir, relativePath);
    const original = fs.readFileSync(filePath);
    fs.appendFileSync(filePath, "changed\n");
    assert.notEqual(
      fixtureContentDigest({ rootDir, includedPaths }).digest,
      initial,
      `${relativePath} is Docker-included and should affect the release digest`,
    );
    fs.writeFileSync(filePath, original);
  }

  fs.writeFileSync(
    path.join(rootDir, "apps/api/.env"),
    "DATABASE_URL=changed\n",
  );
  fs.writeFileSync(
    path.join(rootDir, "apps/arenzyra-web/.env.production"),
    "TOKEN=changed\n",
  );
  fs.appendFileSync(
    path.join(rootDir, "apps/discord-bot/logs/runtime.log"),
    "changed\n",
  );
  fs.appendFileSync(
    path.join(rootDir, "apps/arenzyra-web/.tmp-preview/capture.txt"),
    "changed\n",
  );
  fs.writeFileSync(path.join(rootDir, "apps/api/private-key.pem"), "changed\n");
  assert.equal(fixtureContentDigest({ rootDir, includedPaths }).digest, initial);

  const collected = collectFixtureReleaseFiles({ rootDir, includedPaths }).map(
    (filePath) => path.relative(rootDir, filePath).replace(/\\/g, "/"),
  );
  assert.deepEqual(
    collected.filter((filePath) => filePath.includes(".env")),
    ["apps/api/.env.example", "apps/arenzyra-web/.env.production.example"],
  );
  assert.equal(
    collected.some((filePath) => filePath.endsWith(".pem")),
    false,
  );
  assert.equal(
    collected.some((filePath) => filePath.includes("runtime.log")),
    false,
  );
  assert.equal(
    collected.some((filePath) => filePath.includes(".tmp-preview")),
    false,
  );
  assert.throws(
    () => collectFixtureReleaseFiles({ rootDir, includedPaths: ["../outside"] }),
    /escapes repository root/,
  );
});

test("database policy and only reviewed SQL sources affect release provenance", (t) => {
  const rootDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-release-sql-"),
  );
  t.after(() => fs.rmSync(rootDir, { force: true, recursive: true }));

  const includedPaths = ["apps/api", "apps/arenzyra-web", "infra"];
  const reviewedSql = [
    "apps/api/prisma/migrations/20260805000000_reviewed/migration.sql",
    "apps/arenzyra-web/scripts/studio-migrations/001_reviewed.sql",
    "infra/sql/bootstrap-production-roles.sql",
    "infra/sql/production-entitlement-inventory.sql",
  ];
  const excludedSqlAndDumps = [
    "apps/api/prisma/migrations/migration.sql",
    "apps/api/prisma/migrations/20260805000000_reviewed/extra.sql",
    "apps/api/prisma/migrations/20260805000000_reviewed/nested/migration.sql",
    "apps/arenzyra-web/scripts/studio-migrations/nested/002.sql",
    "apps/api/operator-copy.sql",
    "infra/sql/manual-production-copy.sql",
    "infra/sql/production.dump",
    "infra/sql/production.sql.gz",
  ];
  for (const relativePath of [...reviewedSql, ...excludedSqlAndDumps]) {
    writeFile(rootDir, relativePath, `source:${relativePath}\n`);
  }
  writeFile(rootDir, "apps/api/src/index.ts", "export {};\n");
  const objectPolicyPath = writeFile(
    rootDir,
    "infra/production-database-object-policy.json",
    "{}\n",
  );

  const initial = fixtureContentDigest({ rootDir, includedPaths }).digest;
  const collected = collectFixtureReleaseFiles({ rootDir, includedPaths }).map(
    (filePath) => path.relative(rootDir, filePath).replace(/\\/g, "/"),
  );
  for (const relativePath of reviewedSql) {
    assert.equal(collected.includes(relativePath), true, relativePath);
    const filePath = path.join(rootDir, relativePath);
    const original = fs.readFileSync(filePath);
    fs.appendFileSync(filePath, "reviewed change\n");
    assert.notEqual(
      fixtureContentDigest({ rootDir, includedPaths }).digest,
      initial,
      `${relativePath} must affect the release digest`,
    );
    fs.writeFileSync(filePath, original);
  }

  fs.appendFileSync(objectPolicyPath, "reviewed change\n");
  assert.notEqual(
    fixtureContentDigest({ rootDir, includedPaths }).digest,
    initial,
    "the production database object policy must affect the release digest",
  );
  fs.writeFileSync(objectPolicyPath, "{}\n");

  for (const relativePath of excludedSqlAndDumps) {
    assert.equal(collected.includes(relativePath), false, relativePath);
    fs.appendFileSync(path.join(rootDir, relativePath), "excluded change\n");
  }
  assert.equal(fixtureContentDigest({ rootDir, includedPaths }).digest, initial);
});

test("provenance includes untracked root files and dirty embedded repositories", (t) => {
  const rootDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-release-git-"),
  );
  t.after(() => fs.rmSync(rootDir, { force: true, recursive: true }));

  writeFile(rootDir, ".gitignore", "apps/api/\napps/arenzyra-web/\n");
  writeFile(rootDir, "root.txt", "root\n");
  writeFile(rootDir, "apps/api/api.txt", "api\n");
  writeFile(rootDir, "apps/arenzyra-web/web.txt", "web\n");
  initializeRepository(rootDir);
  initializeRepository(path.join(rootDir, "apps/api"));
  initializeRepository(path.join(rootDir, "apps/arenzyra-web"));

  let provenance = collectGitProvenance({ rootDir });
  assert.equal(provenance.dirty, "false");
  assert.equal(provenance.hasCleanGitProvenance, true);
  assert.equal(
    provenance.components.every(
      (component) =>
        /^[0-9a-f]{12}$/.test(component.commit) && component.dirty === "false",
    ),
    true,
  );
  const cleanMetadata = createReleaseMetadata({
    rootDir,
    includedPaths: [
      "root.txt",
      "apps/api/api.txt",
      "apps/arenzyra-web/web.txt",
    ],
    dockerfiles: [],
    runtimeComposeFiles: [],
    builtAt: "2026-08-01T00:00:00.000Z",
  });
  const cleanOutput = cleanMetadata.lines.join("\n");
  assert.match(cleanOutput, /^ARENZYRA_BUILD_SOURCE=git$/m);
  assert.match(cleanOutput, /^ARENZYRA_BUILD_DIRTY=false$/m);
  assert.match(cleanOutput, /^ARENZYRA_GIT_COMMIT=[0-9a-f]{12}$/m);

  const rootSecretPath = writeFile(
    rootDir,
    "untracked-root-secret-name.txt",
    "password=must-not-appear\n",
  );
  provenance = collectGitProvenance({ rootDir });
  assert.equal(provenance.dirty, "true");
  assert.equal(
    provenance.components.find((component) => component.name === "ROOT").dirty,
    "true",
  );
  assert.equal(
    provenance.components.find((component) => component.name === "API").dirty,
    "false",
  );
  fs.rmSync(rootSecretPath);

  const apiUntrackedPath = writeFile(
    rootDir,
    "apps/api/untracked-api.txt",
    "api dirty\n",
  );
  provenance = collectGitProvenance({ rootDir });
  assert.equal(provenance.dirty, "true");
  assert.equal(
    provenance.components.find((component) => component.name === "API").dirty,
    "true",
  );
  assert.equal(
    provenance.components.find((component) => component.name === "WEB").dirty,
    "false",
  );
  fs.rmSync(apiUntrackedPath);

  writeFile(rootDir, "apps/arenzyra-web/untracked-web.txt", "web dirty\n");
  const metadata = createReleaseMetadata({
    rootDir,
    includedPaths: [
      "root.txt",
      "apps/api/api.txt",
      "apps/arenzyra-web/web.txt",
    ],
    dockerfiles: [],
    runtimeComposeFiles: [],
    builtAt: "2026-08-01T00:00:00.000Z",
  });
  const output = metadata.lines.join("\n");
  assert.equal(metadata.provenance.dirty, "true");
  assert.match(output, /^ARENZYRA_WEB_GIT_DIRTY=true$/m);
  assert.match(output, /^ARENZYRA_BUILD_DIRTY=true$/m);
  for (const componentName of [
    "ROOT",
    "API",
    "WEB",
    "DISCORD",
    "MEDIA",
    "INFRA",
  ]) {
    assert.match(
      output,
      new RegExp(`^ARENZYRA_${componentName}_GIT_COMMIT=[0-9a-f]{12}$`, "m"),
    );
  }
  assert.doesNotMatch(output, /untracked-web|must-not-appear|password/i);
});

test("release collection rejects ignored Docker inputs and excludes reviewed runtime paths", (t) => {
  const rootDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-release-tracked-inputs-"),
  );
  t.after(() => fs.rmSync(rootDir, { force: true, recursive: true }));

  writeFile(rootDir, ".gitignore", "apps/api/\napps/arenzyra-web/\n");
  writeFile(rootDir, "root.txt", "root\n");
  writeFile(
    rootDir,
    "apps/api/.gitignore",
    "/public/ignored-but-docker-included.bin\n/public/assets/players/player_*\n/uploads/\n/storage/\n",
  );
  writeFile(
    rootDir,
    "apps/api/.dockerignore",
    "uploads\nstorage\npublic/assets/players/player_*\npublic/assets/teams/team_*\n",
  );
  writeFile(rootDir, "apps/api/public/tracked.txt", "tracked\n");
  writeFile(rootDir, "apps/arenzyra-web/web.txt", "web\n");
  initializeRepository(rootDir);
  initializeRepository(path.join(rootDir, "apps/api"));
  initializeRepository(path.join(rootDir, "apps/arenzyra-web"));

  const rogue = writeFile(
    rootDir,
    "apps/api/public/ignored-but-docker-included.bin",
    "unreviewed bytes\n",
  );
  assert.equal(collectGitProvenance({ rootDir }).dirty, "false");
  assert.throws(
    () =>
      collectReleaseFiles({
        rootDir,
        includedPaths: ["root.txt", "apps/api/public"],
      }),
    /not tracked by its owning Git repository: apps\/api\/public\/ignored-but-docker-included\.bin/,
  );
  fs.rmSync(rogue);

  writeFile(
    rootDir,
    "apps/api/public/assets/players/player_generated.png",
    "ignored generated asset\n",
  );
  writeFile(rootDir, "apps/api/uploads/runtime.bin", "runtime\n");
  writeFile(rootDir, "apps/api/storage/runtime.bin", "runtime\n");
  const collected = collectReleaseFiles({
    rootDir,
    includedPaths: ["apps/api"],
  }).map((filePath) => path.relative(rootDir, filePath).replace(/\\/g, "/"));
  assert.equal(collected.includes("apps/api/public/tracked.txt"), true);
  assert.equal(collected.some((entry) => /player_generated|uploads|storage/.test(entry)), false);

  const canonicalDockerIgnore = fs.readFileSync(
    path.join(repositoryRoot, "apps/api/.dockerignore"),
    "utf8",
  );
  assert.match(canonicalDockerIgnore, /^public\/assets\/players\/player_\*$/m);
  assert.match(canonicalDockerIgnore, /^public\/assets\/teams\/team_\*$/m);
});

test("source bundles report unknown component commits without walking into a parent repo", (t) => {
  const parentDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-release-parent-"),
  );
  t.after(() => fs.rmSync(parentDir, { force: true, recursive: true }));
  writeFile(parentDir, ".gitignore", "bundle/\n");
  writeFile(parentDir, "parent.txt", "parent\n");
  const bundleDir = path.join(parentDir, "bundle");
  writeFile(bundleDir, "root.txt", "bundle\n");
  writeFile(bundleDir, "apps/api/api.txt", "api\n");
  writeFile(bundleDir, "apps/arenzyra-web/web.txt", "web\n");
  initializeRepository(parentDir);

  const provenance = collectGitProvenance({ rootDir: bundleDir });
  assert.equal(provenance.dirty, "unknown");
  assert.equal(provenance.hasCleanGitProvenance, false);
  assert.equal(
    provenance.components.every(
      (component) =>
        component.commit === "unavailable" && component.dirty === "unknown",
    ),
    true,
  );
});

test("release authorization fails closed and records explicit emergency overrides", () => {
  const metadata = {
    digest: "a".repeat(64),
    releaseId: "source-test",
    lines: [
      "ARENZYRA_BUILD_DIRTY=true",
      "ARENZYRA_PROVENANCE_OVERRIDE=false",
      "",
    ],
    provenance: {
      dirty: "true",
      hasCleanGitProvenance: false,
      components: [
        { name: "ROOT", commit: "abc123", dirty: "true" },
        { name: "API", commit: "unavailable", dirty: "unknown" },
      ],
    },
  };

  assert.throws(
    () => authorizeReleaseProvenance(metadata),
    /Release provenance is not clean and available/,
  );
  assert.throws(
    () =>
      authorizeReleaseProvenance(metadata, {
        allowOverride: true,
        overrideReason: "too short",
      }),
    /at least 12 characters/,
  );

  const audit = authorizeReleaseProvenance(metadata, {
    allowOverride: true,
    overrideReason: "Emergency rollback from reviewed source bundle",
    actor: "release-operator",
    overriddenAt: "2026-08-04T12:00:00.000Z",
  });
  assert.equal(audit.actor, "release-operator");
  assert.match(
    metadata.lines.join("\n"),
    /^ARENZYRA_PROVENANCE_OVERRIDE=true$/m,
  );
  assert.match(
    metadata.lines.join("\n"),
    /^ARENZYRA_PROVENANCE_OVERRIDE_REASON_SHA256=[0-9a-f]{64}$/m,
  );
});

test("release metadata requires and records version-and-digest pinned base images", (t) => {
  const rootDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-base-images-"),
  );
  t.after(() => fs.rmSync(rootDir, { force: true, recursive: true }));
  const digest = "a".repeat(64);
  writeFile(
    rootDir,
    "apps/example/Dockerfile",
    `FROM node:22.23.2-bookworm@sha256:${digest} AS base\nFROM base AS build\n`,
  );

  assert.deepEqual(
    collectBaseImageReferences({
      rootDir,
      dockerfiles: ["apps/example/Dockerfile"],
    }),
    [
      {
        dockerfile: "apps/example/Dockerfile",
        line: 1,
        image: `node:22.23.2-bookworm@sha256:${digest}`,
        stage: "base",
      },
    ],
  );

  writeFile(rootDir, "apps/example/Dockerfile", "FROM node:22-bookworm\n");
  assert.throws(
    () =>
      collectBaseImageReferences({
        rootDir,
        dockerfiles: ["apps/example/Dockerfile"],
      }),
    /not version-and-digest pinned/,
  );
});

test("release metadata rejects floating external runtime images", (t) => {
  const rootDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-runtime-images-"),
  );
  t.after(() => fs.rmSync(rootDir, { force: true, recursive: true }));
  const digest = "b".repeat(64);
  writeFile(
    rootDir,
    "infra/compose.yml",
    `services:\n  db:\n    image: postgres:16.14-alpine@sha256:${digest}\n  api:\n    image: arenzyra-api:\${ARENZYRA_RELEASE_ID}\n`,
  );
  assert.equal(
    collectRuntimeImageReferences({
      rootDir,
      composeFiles: ["infra/compose.yml"],
    }).length,
    1,
  );
  writeFile(
    rootDir,
    "infra/compose.yml",
    "services:\n  db:\n    image: postgres:16-alpine\n",
  );
  assert.throws(
    () =>
      collectRuntimeImageReferences({
        rootDir,
        composeFiles: ["infra/compose.yml"],
      }),
    /runtime image is not version-and-digest pinned/,
  );
});
