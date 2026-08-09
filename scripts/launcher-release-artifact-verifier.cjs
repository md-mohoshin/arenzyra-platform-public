#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { isDeepStrictEqual } = require("node:util");

const repoRoot = path.resolve(__dirname, "..");

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function resolveSevenZip() {
  try {
    const resolved = require("7zip-bin").path7za;
    if (resolved && fs.existsSync(resolved)) {
      return resolved;
    }
  } catch {}

  throw new Error(
    "7zip-bin is required to verify the contents of launcher release artifacts.",
  );
}

function extractArchiveEntry(archivePath, entryPath, options = {}) {
  const sevenZipPath = options.sevenZipPath || resolveSevenZip();
  const result = spawnSync(
    sevenZipPath,
    ["e", "-so", path.resolve(archivePath), entryPath.replace(/\\/g, "/")],
    {
      encoding: null,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.status !== 0) {
    const detail = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8").trim()
      : String(result.stderr || "").trim();
    throw new Error(
      `Could not extract ${entryPath} from ${archivePath}${detail ? `: ${detail}` : ""}`,
    );
  }
  return Buffer.from(result.stdout || Buffer.alloc(0));
}

function extractArchiveEntries(archivePath, entryPaths, options = {}) {
  const sevenZipPath = options.sevenZipPath || resolveSevenZip();
  const destination = fs.mkdtempSync(
    path.join(options.tempRoot || require("node:os").tmpdir(), "arenzyra-launcher-verify-"),
  );
  try {
    const result = spawnSync(
      sevenZipPath,
      [
        "x",
        "-y",
        `-o${destination}`,
        path.resolve(archivePath),
        ...Array.from(new Set(entryPaths)).map((entry) =>
          entry.replace(/\\/g, "/"),
        ),
      ],
      {
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      },
    );
    if (result.status !== 0) {
      throw new Error(
        `Could not extract launcher verification set from ${archivePath}${result.stderr?.trim() ? `: ${result.stderr.trim()}` : ""}`,
      );
    }
    const extracted = new Map();
    for (const entryPath of entryPaths) {
      const filePath = path.join(destination, ...entryPath.split("/"));
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new Error(`Launcher archive entry is missing: ${entryPath}`);
      }
      extracted.set(entryPath, fs.readFileSync(filePath));
    }
    return extracted;
  } finally {
    fs.rmSync(destination, { recursive: true, force: true });
  }
}

function launcherArtifactNames(version) {
  const normalized = String(version || "").trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(normalized)) {
    throw new Error(`Invalid launcher version: ${version}`);
  }
  return {
    installer: `Arenzyra Observer Launcher Setup ${normalized}.exe`,
    portableZip: `Arenzyra Observer Launcher-${normalized}-win.zip`,
  };
}

function recursiveSourceEntries(sourceRoot, entryRoot) {
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new Error(`Launcher release source directory is missing: ${sourceRoot}`);
  }
  const entries = [];
  const visit = (directory) => {
    for (const item of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const sourcePath = path.join(directory, item.name);
      if (item.isDirectory()) {
        visit(sourcePath);
      } else if (item.isFile()) {
        const relative = path.relative(sourceRoot, sourcePath).replace(/\\/g, "/");
        entries.push({
          entryPath: `${entryRoot}/${relative}`,
          sourcePath,
        });
      }
    }
  };
  visit(sourceRoot);
  return entries;
}

function defaultSourceEntries(rootDir = repoRoot) {
  const desktopRoot = path.join(rootDir, "apps", "desktop");
  const entries = [
    {
      entryPath: "resources/connectors/ob.js",
      sourcePath: path.join(rootDir, "ob.js"),
    },
    {
      entryPath: "resources/connectors/direct-observer-transport-payload.cjs",
      sourcePath: path.join(
        rootDir,
        "apps",
        "desktop",
        "electron",
        "direct-observer-transport-payload.cjs",
      ),
    },
    {
      entryPath: "resources/connectors/observer-runtime-health.cjs",
      sourcePath: path.join(
        rootDir,
        "apps",
        "desktop",
        "electron",
        "observer-runtime-health.cjs",
      ),
    },
    {
      entryPath: "resources/connectors/observer-telemetry-contract.cjs",
      sourcePath: path.join(
        rootDir,
        "apps",
        "desktop",
        "electron",
        "observer-telemetry-contract.cjs",
      ),
    },
    {
      entryPath: "resources/icon.ico",
      sourcePath: path.join(desktopRoot, "build", "icon.ico"),
    },
    {
      entryPath: "resources/default-team.png",
      sourcePath: path.join(desktopRoot, "build", "default-team.png"),
    },
    {
      entryPath: "resources/default-player.png",
      sourcePath: path.join(desktopRoot, "build", "default-player.png"),
    },
    {
      entryPath: "resources/shadow-logo-template.svg",
      sourcePath: path.join(desktopRoot, "build", "shadow-logo-template.svg"),
    },
    ...recursiveSourceEntries(
      path.join(desktopRoot, "electron"),
      "resources/app/electron",
    ),
    {
      entryPath: "resources/app/dist/index.html",
      sourcePath: path.join(desktopRoot, "dist", "index.html"),
    },
    ...recursiveSourceEntries(
      path.join(desktopRoot, "dist", "assets"),
      "resources/app/dist/assets",
    ),
  ];
  return Array.from(
    new Map(entries.map((entry) => [entry.entryPath, entry])).values(),
  ).sort((left, right) => left.entryPath.localeCompare(right.entryPath));
}

function inspectLauncherArchive({
  archivePath,
  expectedVersion,
  expectedPackage = {
    name: "arenzyra-observer-launcher",
    version: expectedVersion,
  },
  sourceEntries = defaultSourceEntries(),
  sevenZipPath,
}) {
  const entryPaths = Array.from(
    new Set([
      "resources/app/package.json",
      ...sourceEntries.map((entry) => entry.entryPath),
    ]),
  );
  const packagedEntries = extractArchiveEntries(archivePath, entryPaths, {
    sevenZipPath,
  });
  const packageBuffer = packagedEntries.get("resources/app/package.json");
  let packaged;
  try {
    packaged = JSON.parse(packageBuffer.toString("utf8"));
  } catch (error) {
    throw new Error(
      `Packaged launcher package.json is invalid in ${archivePath}: ${error.message}`,
    );
  }
  for (const field of [
    "name",
    "version",
    "private",
    "type",
    "description",
    "author",
    "main",
    "dependencies",
  ]) {
    if (
      Object.prototype.hasOwnProperty.call(expectedPackage, field) &&
      !isDeepStrictEqual(packaged[field], expectedPackage[field])
    ) {
      throw new Error(
        `Packaged launcher package.json ${field} mismatch in ${archivePath}`,
      );
    }
  }

  const resources = {};
  for (const sourceEntry of sourceEntries) {
    if (!fs.existsSync(sourceEntry.sourcePath)) {
      throw new Error(`Launcher release source is missing: ${sourceEntry.sourcePath}`);
    }
    const expectedHash = sha256File(sourceEntry.sourcePath);
    const packagedBuffer = packagedEntries.get(sourceEntry.entryPath);
    if (!packagedBuffer) {
      throw new Error(
        `Launcher archive entry is missing: ${sourceEntry.entryPath}`,
      );
    }
    const packagedHash = sha256Buffer(packagedBuffer);
    if (packagedHash !== expectedHash) {
      throw new Error(
        `Stale launcher resource in ${archivePath}: ${sourceEntry.entryPath} expected ${expectedHash}, received ${packagedHash}`,
      );
    }
    resources[sourceEntry.entryPath] = {
      sha256: packagedHash,
      size: packagedBuffer.length,
    };
  }

  const stat = fs.statSync(archivePath);
  return {
    path: path.resolve(archivePath),
    size: stat.size,
    sha256: sha256File(archivePath),
    version: expectedVersion,
    resources,
  };
}

function verifyLauncherReleaseArtifacts({
  distDir = path.join(repoRoot, "apps", "desktop", "dist"),
  packageJsonPath = path.join(
    repoRoot,
    "apps",
    "desktop",
    "package.json",
  ),
  sourceEntries = defaultSourceEntries(),
  sevenZipPath,
} = {}) {
  const desktopPackage = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const version = String(desktopPackage.version || "").trim();
  const names = launcherArtifactNames(version);
  const installerPath = path.join(distDir, names.installer);
  const portableZipPath = path.join(distDir, names.portableZip);
  for (const artifactPath of [installerPath, portableZipPath]) {
    if (!fs.existsSync(artifactPath)) {
      throw new Error(`Expected launcher artifact is missing: ${artifactPath}`);
    }
  }

  const installer = inspectLauncherArchive({
    archivePath: installerPath,
    expectedVersion: version,
    expectedPackage: desktopPackage,
    sourceEntries,
    sevenZipPath,
  });
  const portableZip = inspectLauncherArchive({
    archivePath: portableZipPath,
    expectedVersion: version,
    expectedPackage: desktopPackage,
    sourceEntries,
    sevenZipPath,
  });

  for (const sourceEntry of sourceEntries) {
    const installerHash = installer.resources[sourceEntry.entryPath]?.sha256;
    const zipHash = portableZip.resources[sourceEntry.entryPath]?.sha256;
    if (!installerHash || installerHash !== zipHash) {
      throw new Error(
        `Launcher artifacts disagree for ${sourceEntry.entryPath}`,
      );
    }
  }

  return { version, names, installer, portableZip };
}

function samePublishedArtifacts(existingManifest, nextManifest) {
  return (
    existingManifest?.files?.installer?.sha256 ===
      nextManifest?.files?.installer?.sha256 &&
    existingManifest?.files?.portableZip?.sha256 ===
      nextManifest?.files?.portableZip?.sha256
  );
}

function assertSafeManifestReplacement(existingManifest, nextManifest) {
  if (!existingManifest || existingManifest.version !== nextManifest.version) {
    return;
  }
  if (!samePublishedArtifacts(existingManifest, nextManifest)) {
    throw new Error(
      `Refusing to replace launcher ${nextManifest.version} with different artifacts. Increment the launcher version instead.`,
    );
  }
}

function main() {
  const result = verifyLauncherReleaseArtifacts();
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        version: result.version,
        installer: {
          size: result.installer.size,
          sha256: result.installer.sha256,
        },
        portableZip: {
          size: result.portableZip.size,
          sha256: result.portableZip.sha256,
        },
        resources: result.installer.resources,
      },
      null,
      2,
    )}\n`,
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  assertSafeManifestReplacement,
  defaultSourceEntries,
  extractArchiveEntry,
  extractArchiveEntries,
  inspectLauncherArchive,
  launcherArtifactNames,
  samePublishedArtifacts,
  sha256File,
  verifyLauncherReleaseArtifacts,
};
