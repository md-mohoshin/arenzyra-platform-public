#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const defaultOutput = path.join(repoRoot, "infra", ".env.release");
const quarantinedCommercialMapSourcePrefix = `${path.posix.join(
  "scripts",
  "assets",
  "pubgm-maps",
)}/`;
const quarantinedCommercialMapGenerator = path.posix.join(
  "scripts",
  "generate-pubgm-map-assets.mjs",
);

// These are the source inputs copied by the production Compose build contexts,
// plus the files that define the publish stack and its provenance gate. Keep the
// application and infrastructure roots explicit so environment files and
// unrelated local artifacts can never be pulled into release metadata. The
// entire scripts tree is deliberate: a newly introduced deployment helper must
// not be able to execute outside the release digest and checkout-safety gate.
const defaultIncludedPaths = Object.freeze([
  ".dockerignore",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "apps/api",
  "apps/arenzyra-web",
  "apps/discord-bot",
  "apps/media-ai-service",
  "packages/arenzyra-types",
  "infra/Caddyfile",
  "infra/docker-compose.publish.yml",
  "infra/docker-compose.discord-bot.remote.yml",
  "infra/production-api-migration-safety.json",
  "infra/production-database-object-policy.json",
  "infra/sql/bootstrap-production-roles.sql",
  "scripts",
]);

// API and web are embedded repositories in the local deployment workspace.
// Discord, media-ai, and infra are owned by the root repository, but receive
// explicit component fields so partial deployments retain useful provenance.
const defaultGitComponents = Object.freeze([
  Object.freeze({ name: "ROOT", repoPath: "." }),
  Object.freeze({ name: "API", repoPath: "apps/api" }),
  Object.freeze({ name: "WEB", repoPath: "apps/arenzyra-web" }),
  Object.freeze({ name: "DISCORD", repoPath: "." }),
  Object.freeze({ name: "MEDIA", repoPath: "." }),
  Object.freeze({ name: "INFRA", repoPath: "." }),
]);
const defaultDockerfiles = Object.freeze([
  "apps/api/Dockerfile",
  "apps/arenzyra-web/Dockerfile",
  "apps/discord-bot/Dockerfile",
  "apps/media-ai-service/Dockerfile",
]);
const defaultRuntimeComposeFiles = Object.freeze([
  "infra/docker-compose.publish.yml",
]);

const ignoredDirectoryNames = new Set([
  ".artifacts",
  ".codex",
  ".deploy-safety-backups",
  ".git",
  ".next",
  ".next-build",
  ".vscode",
  ".venv",
  "_cleanup-archive",
  "__pycache__",
  "backups",
  "chrome-cdp-profile",
  "coverage",
  "deploy-artifacts",
  "deploy-backups",
  "dist",
  "logs",
  "node_modules",
  "production-backup-archive",
  "recordings",
  "scratch",
  "test-results",
  "tmp",
  "user-data",
]);
const ignoredFileNames = new Set([
  ".arenzyra-build.json",
  ".arenzyra-release.json",
  ".DS_Store",
  ".env",
  ".env.local",
  ".env.release",
]);

function readFlag(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return fallback;
  }
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function toPosixRelative(rootDir, filePath) {
  return path.relative(rootDir, filePath).replace(/\\/g, "/");
}

function isQuarantinedCommercialMapSource(filePath, rootDir = repoRoot) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedFile = path.resolve(filePath);
  const relativePath = toPosixRelative(resolvedRoot, resolvedFile);
  if (relativePath === ".." || relativePath.startsWith("../")) {
    return false;
  }

  const normalizedPath = relativePath.toLowerCase();
  return (
    normalizedPath === quarantinedCommercialMapGenerator ||
    normalizedPath.startsWith(quarantinedCommercialMapSourcePrefix)
  );
}

function assertReleaseInputIsNotQuarantined(filePath, rootDir = repoRoot) {
  if (!isQuarantinedCommercialMapSource(filePath, rootDir)) {
    return;
  }

  throw new Error(
    `Release input is quarantined pending exact-byte redistribution approval: ${toPosixRelative(rootDir, filePath)}`,
  );
}

function isIgnoredTemporaryDirectory(name) {
  return (
    name === ".tmp" ||
    name.startsWith(".tmp-") ||
    name.startsWith(".tmp_") ||
    name.startsWith("tmp-") ||
    name.startsWith("tmp_")
  );
}

function isSafeEnvironmentExample(name) {
  return name === ".env.example" || /^\.env\..+\.example$/.test(name);
}

function hasDockerIgnoredSensitiveExtension(name) {
  return /(?:\.(?:7z|bak|cer|crt|der|dump|jks|key|keystore|log|p12|pem|pfx|pyc|rar|sql|tar|zip)|\.sql\.gz|\.tar\..+)$/i.test(
    name,
  );
}

function isReviewedSqlSource(filePath, rootDir = repoRoot) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedFile = path.resolve(filePath);
  const relativePath = toPosixRelative(resolvedRoot, resolvedFile);
  if (relativePath === ".." || relativePath.startsWith("../")) {
    return false;
  }

  return (
    /^apps\/api\/prisma\/migrations\/[^/]+\/migration\.sql$/.test(
      relativePath,
    ) ||
    /^apps\/arenzyra-web\/scripts\/studio-migrations\/[^/]+\.sql$/.test(
      relativePath,
    ) ||
    relativePath === "infra/sql/bootstrap-production-roles.sql"
  );
}

function shouldIgnore(filePath, entry, { rootDir = repoRoot } = {}) {
  if (
    entry.isDirectory() &&
    (ignoredDirectoryNames.has(entry.name) ||
      entry.name.startsWith(".codex-") ||
      isIgnoredTemporaryDirectory(entry.name))
  ) {
    return true;
  }

  if (!entry.isFile()) {
    return false;
  }

  if (
    ignoredFileNames.has(entry.name) &&
    !isSafeEnvironmentExample(entry.name)
  ) {
    return true;
  }

  if (
    (entry.name === ".env" || entry.name.startsWith(".env.")) &&
    !isSafeEnvironmentExample(entry.name)
  ) {
    return true;
  }

  if (hasDockerIgnoredSensitiveExtension(entry.name)) {
    return !isReviewedSqlSource(filePath, rootDir);
  }

  return false;
}

function collectFiles(targetPath, files, rootDir) {
  const stat = fs.lstatSync(targetPath);
  if (stat.isSymbolicLink()) {
    throw new Error(
      `Release input must not be a symbolic link: ${toPosixRelative(repoRoot, targetPath)}`,
    );
  }
  if (stat.isFile()) {
    // Keep this check ahead of ignore processing so a renamed or ignored file
    // cannot silently restore the quarantined commercial-map source boundary.
    assertReleaseInputIsNotQuarantined(targetPath, rootDir);
    const entry = {
      isFile: () => true,
      isDirectory: () => false,
      name: path.basename(targetPath),
    };
    if (!shouldIgnore(targetPath, entry, { rootDir })) {
      files.add(targetPath);
    }
    return;
  }
  if (!stat.isDirectory()) {
    return;
  }

  const entries = fs
    .readdirSync(targetPath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const childPath = path.join(targetPath, entry.name);
    if (shouldIgnore(childPath, entry, { rootDir })) {
      continue;
    }
    collectFiles(childPath, files, rootDir);
  }
}

function collectReleaseFiles({
  rootDir = repoRoot,
  includedPaths = defaultIncludedPaths,
} = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const files = new Set();

  for (const relativePath of includedPaths) {
    const targetPath = path.resolve(resolvedRoot, relativePath);
    const relativeTarget = toPosixRelative(resolvedRoot, targetPath);
    if (
      relativeTarget === ".." ||
      relativeTarget.startsWith("../") ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error(`Release input escapes repository root: ${relativePath}`);
    }
    if (!fs.existsSync(targetPath)) {
      throw new Error(`Release input is missing: ${relativePath}`);
    }
    collectFiles(targetPath, files, resolvedRoot);
  }

  return [...files].sort((left, right) =>
    toPosixRelative(resolvedRoot, left).localeCompare(
      toPosixRelative(resolvedRoot, right),
    ),
  );
}

function contentDigest(options = {}) {
  const rootDir = path.resolve(options.rootDir || repoRoot);
  const files = collectReleaseFiles({
    rootDir,
    includedPaths: options.includedPaths || defaultIncludedPaths,
  });

  const digest = crypto.createHash("sha256");
  for (const filePath of files) {
    const fileDigest = crypto
      .createHash("sha256")
      .update(fs.readFileSync(filePath))
      .digest("hex");
    digest.update(`${toPosixRelative(rootDir, filePath)}\0${fileDigest}\n`);
  }
  return { digest: digest.digest("hex"), fileCount: files.length };
}

function gitValue(cwd, args) {
  try {
    return execFileSync("git", ["--no-optional-locks", ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function samePath(left, right) {
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function inspectGitRepository(repositoryPath) {
  const resolvedPath = path.resolve(repositoryPath);
  if (!fs.existsSync(resolvedPath)) {
    return { commit: "unavailable", dirty: "unknown" };
  }

  const topLevel = gitValue(resolvedPath, ["rev-parse", "--show-toplevel"]);
  if (!topLevel || !samePath(topLevel, resolvedPath)) {
    // Do not accidentally attribute an absent embedded repository to a parent
    // repository discovered by Git's normal upward directory search.
    return { commit: "unavailable", dirty: "unknown" };
  }

  const commit = gitValue(resolvedPath, ["rev-parse", "--short=12", "HEAD"]);
  const status = gitValue(resolvedPath, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);

  return {
    commit: commit || "unavailable",
    dirty: status === null ? "unknown" : status === "" ? "false" : "true",
  };
}

function collectGitProvenance({
  rootDir = repoRoot,
  components = defaultGitComponents,
} = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const repositoryCache = new Map();
  const componentStates = components.map((component) => {
    const repositoryPath = path.resolve(resolvedRoot, component.repoPath);
    const cacheKey =
      process.platform === "win32"
        ? repositoryPath.toLowerCase()
        : repositoryPath;
    if (!repositoryCache.has(cacheKey)) {
      repositoryCache.set(cacheKey, inspectGitRepository(repositoryPath));
    }
    return {
      name: component.name,
      ...repositoryCache.get(cacheKey),
    };
  });
  const repositoryStates = [...repositoryCache.values()];
  const hasDirtyRepository = repositoryStates.some(
    (state) => state.dirty === "true",
  );
  const hasUnknownRepository = repositoryStates.some(
    (state) => state.dirty === "unknown" || state.commit === "unavailable",
  );
  const dirty = hasDirtyRepository
    ? "true"
    : hasUnknownRepository
      ? "unknown"
      : "false";

  return {
    components: componentStates,
    dirty,
    hasCleanGitProvenance:
      repositoryStates.length > 0 &&
      repositoryStates.every(
        (state) => state.dirty === "false" && state.commit !== "unavailable",
      ),
  };
}

function formatTimestamp(value) {
  return value.replace(/[-:.]/g, "").replace("T", "-").replace("Z", "");
}

function collectBaseImageReferences({
  rootDir = repoRoot,
  dockerfiles = defaultDockerfiles,
} = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const references = [];

  for (const relativeDockerfile of dockerfiles) {
    const dockerfilePath = path.resolve(resolvedRoot, relativeDockerfile);
    const relativeTarget = toPosixRelative(resolvedRoot, dockerfilePath);
    if (
      relativeTarget === ".." ||
      relativeTarget.startsWith("../") ||
      path.isAbsolute(relativeDockerfile)
    ) {
      throw new Error(
        `Release base-image Dockerfile escapes repository root: ${relativeDockerfile}`,
      );
    }
    if (!fs.existsSync(dockerfilePath)) {
      throw new Error(
        `Release base-image Dockerfile is missing: ${relativeDockerfile}`,
      );
    }

    const stages = new Set();
    const lines = fs.readFileSync(dockerfilePath, "utf8").split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const match = line.match(
        /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?\s*$/i,
      );
      if (!match) {
        continue;
      }

      const image = match[1];
      const stage = String(match[2] || "").toLowerCase();
      if (!stages.has(image.toLowerCase())) {
        if (!/^[^@\s]+:[^@\s]+@sha256:[a-f0-9]{64}$/i.test(image)) {
          throw new Error(
            `Release base image is not version-and-digest pinned: ${relativeDockerfile}:${
              index + 1
            } (${image}). Update and verify the registry digest before releasing.`,
          );
        }
        references.push({
          dockerfile: relativeDockerfile.replace(/\\/g, "/"),
          line: index + 1,
          image,
          stage: stage || null,
        });
      }
      if (stage) {
        stages.add(stage);
      }
    }
  }

  return references;
}

function collectRuntimeImageReferences({
  rootDir = repoRoot,
  composeFiles = defaultRuntimeComposeFiles,
} = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const references = [];
  for (const relativeComposeFile of composeFiles) {
    const composePath = path.resolve(resolvedRoot, relativeComposeFile);
    const relativeTarget = toPosixRelative(resolvedRoot, composePath);
    if (
      relativeTarget === ".." ||
      relativeTarget.startsWith("../") ||
      path.isAbsolute(relativeComposeFile)
    ) {
      throw new Error(
        `Runtime image input escapes repository root: ${relativeComposeFile}`,
      );
    }
    if (!fs.existsSync(composePath)) {
      throw new Error(
        `Runtime image Compose file is missing: ${relativeComposeFile}`,
      );
    }
    const lines = fs.readFileSync(composePath, "utf8").split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const match = line.match(/^\s*image:\s*["']?([^"'\s#]+)["']?\s*$/i);
      if (!match) continue;
      const image = match[1];
      if (image.startsWith("arenzyra-")) continue;
      if (!/^[^@\s]+:[^@\s]+@sha256:[a-f0-9]{64}$/i.test(image)) {
        throw new Error(
          `Release runtime image is not version-and-digest pinned: ${relativeComposeFile}:${
            index + 1
          } (${image}). Update and verify the registry digest before releasing.`,
        );
      }
      references.push({
        composeFile: relativeComposeFile.replace(/\\/g, "/"),
        line: index + 1,
        image,
      });
    }
  }
  return references;
}

function createReleaseMetadata({
  rootDir = repoRoot,
  includedPaths = defaultIncludedPaths,
  gitComponents = defaultGitComponents,
  dockerfiles = defaultDockerfiles,
  runtimeComposeFiles = defaultRuntimeComposeFiles,
  builtAt = new Date().toISOString(),
} = {}) {
  const { digest, fileCount } = contentDigest({ rootDir, includedPaths });
  const baseImages = collectBaseImageReferences({ rootDir, dockerfiles });
  const baseImagesJson = JSON.stringify(baseImages);
  const baseImagesDigest = crypto
    .createHash("sha256")
    .update(baseImagesJson)
    .digest("hex");
  const runtimeImages = collectRuntimeImageReferences({
    rootDir,
    composeFiles: runtimeComposeFiles,
  });
  const runtimeImagesJson = JSON.stringify(runtimeImages);
  const runtimeImagesDigest = crypto
    .createHash("sha256")
    .update(runtimeImagesJson)
    .digest("hex");
  const provenance = collectGitProvenance({
    rootDir,
    components: gitComponents,
  });
  const releaseSource = provenance.hasCleanGitProvenance
    ? "git"
    : "source-digest";
  const releaseId = `${releaseSource}-${formatTimestamp(builtAt)}-${digest.slice(0, 12)}`;
  const rootComponent = provenance.components.find(
    (component) => component.name === "ROOT",
  );
  const revision = provenance.hasCleanGitProvenance
    ? rootComponent?.commit || `source-${digest.slice(0, 12)}`
    : `source-${digest.slice(0, 12)}`;
  const lines = [
    "# Generated release metadata. This file contains no secrets.",
    `ARENZYRA_RELEASE_ID=${releaseId}`,
    `ARENZYRA_SOURCE_DIGEST=sha256:${digest}`,
    `ARENZYRA_BUILD_ID=${releaseId}`,
    `ARENZYRA_GIT_COMMIT=${revision}`,
    `ARENZYRA_BUILD_AT=${builtAt}`,
    `ARENZYRA_BUILD_SOURCE=${releaseSource}`,
    `ARENZYRA_BUILD_DIRTY=${provenance.dirty}`,
    `ARENZYRA_BASE_IMAGES_SHA256=sha256:${baseImagesDigest}`,
    `ARENZYRA_BASE_IMAGES_B64=${Buffer.from(baseImagesJson, "utf8").toString(
      "base64url",
    )}`,
    `ARENZYRA_RUNTIME_IMAGES_SHA256=sha256:${runtimeImagesDigest}`,
    `ARENZYRA_RUNTIME_IMAGES_B64=${Buffer.from(
      runtimeImagesJson,
      "utf8",
    ).toString("base64url")}`,
    "ARENZYRA_PROVENANCE_OVERRIDE=false",
  ];

  for (const component of provenance.components) {
    lines.push(`ARENZYRA_${component.name}_GIT_COMMIT=${component.commit}`);
    lines.push(`ARENZYRA_${component.name}_GIT_DIRTY=${component.dirty}`);
  }
  lines.push("");

  return {
    digest,
    baseImages,
    baseImagesDigest,
    runtimeImages,
    runtimeImagesDigest,
    fileCount,
    lines,
    provenance,
    releaseId,
  };
}

function provenanceProblems(metadata) {
  return metadata.provenance.components.filter(
    (component) =>
      component.dirty !== "false" || component.commit === "unavailable",
  );
}

function metadataSafeValue(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_.@-]/g, "_");
}

function authorizeReleaseProvenance(
  metadata,
  {
    allowOverride = false,
    overrideReason = "",
    actor = process.env.SUDO_USER ||
      process.env.USER ||
      process.env.USERNAME ||
      "unknown",
    overriddenAt = new Date().toISOString(),
  } = {},
) {
  const problems = provenanceProblems(metadata);
  if (problems.length === 0 && metadata.provenance.hasCleanGitProvenance) {
    return null;
  }

  const problemSummary = problems
    .map(
      (component) =>
        `${component.name}(commit=${component.commit},dirty=${component.dirty})`,
    )
    .join(", ");
  if (!allowOverride) {
    throw new Error(
      `Release provenance is not clean and available: ${problemSummary || "unknown repository state"}. ` +
        "Commit or remove all root and embedded repository changes before deploying. " +
        "Emergency override requires --allow-dirty-provenance, --override-reason, and an append-only audit log.",
    );
  }

  const normalizedReason = String(overrideReason || "").trim();
  if (normalizedReason.length < 12) {
    throw new Error(
      "Emergency provenance override requires --override-reason with at least 12 characters.",
    );
  }

  const audit = {
    event: "arenzyra.release.provenance_override",
    at: overriddenAt,
    actor: String(actor || "unknown"),
    reason: normalizedReason,
    releaseId: metadata.releaseId,
    sourceDigest: `sha256:${metadata.digest}`,
    problems,
  };
  const overrideIndex = metadata.lines.indexOf(
    "ARENZYRA_PROVENANCE_OVERRIDE=false",
  );
  if (overrideIndex !== -1) {
    metadata.lines[overrideIndex] = "ARENZYRA_PROVENANCE_OVERRIDE=true";
  }
  const insertionIndex = Math.max(0, metadata.lines.length - 1);
  metadata.lines.splice(
    insertionIndex,
    0,
    `ARENZYRA_PROVENANCE_OVERRIDE_ACTOR=${metadataSafeValue(audit.actor)}`,
    `ARENZYRA_PROVENANCE_OVERRIDE_AT=${audit.at}`,
    `ARENZYRA_PROVENANCE_OVERRIDE_REASON_SHA256=${crypto
      .createHash("sha256")
      .update(normalizedReason)
      .digest("hex")}`,
  );
  return audit;
}

function appendOverrideAudit(auditPath, audit) {
  fs.mkdirSync(path.dirname(auditPath), { recursive: true, mode: 0o700 });
  fs.appendFileSync(auditPath, `${JSON.stringify(audit)}\n`, { mode: 0o600 });
}

function writeReleaseMetadata(outputPath, metadata) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, metadata.lines.join("\n"), { mode: 0o600 });
  fs.renameSync(temporaryPath, outputPath);
}

function main() {
  const outputPath = path.resolve(readFlag("--output", defaultOutput));
  const metadata = createReleaseMetadata();
  const allowOverride = hasFlag("--allow-dirty-provenance");
  const overrideReason = readFlag("--override-reason", "");
  if (overrideReason && !allowOverride) {
    throw new Error(
      "--override-reason is valid only with --allow-dirty-provenance.",
    );
  }
  const audit = authorizeReleaseProvenance(metadata, {
    allowOverride,
    overrideReason,
  });
  if (audit) {
    const defaultAuditPath =
      "/var/log/arenzyra/release-provenance-overrides.jsonl";
    const auditPath = path.resolve(
      readFlag(
        "--override-audit-log",
        process.env.ARENZYRA_PROVENANCE_OVERRIDE_AUDIT_LOG || defaultAuditPath,
      ),
    );
    appendOverrideAudit(auditPath, audit);
    console.error(
      `[release-metadata] EMERGENCY OVERRIDE ${JSON.stringify(audit)}`,
    );
  }
  writeReleaseMetadata(outputPath, metadata);
  console.log(
    `[release-metadata] ${metadata.releaseId} (${metadata.fileCount} files, sha256:${metadata.digest.slice(0, 12)}...)`,
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  appendOverrideAudit,
  authorizeReleaseProvenance,
  collectGitProvenance,
  collectBaseImageReferences,
  collectRuntimeImageReferences,
  collectReleaseFiles,
  contentDigest,
  createReleaseMetadata,
  defaultGitComponents,
  defaultIncludedPaths,
  defaultDockerfiles,
  defaultRuntimeComposeFiles,
  inspectGitRepository,
  isQuarantinedCommercialMapSource,
  isReviewedSqlSource,
  provenanceProblems,
  shouldIgnore,
  writeReleaseMetadata,
};
