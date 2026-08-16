"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DESKTOP_ROOT = path.resolve(__dirname, "..");

function getRelativeDescendant(rootDirectory, candidateDirectory) {
  const relative = path.relative(rootDirectory, candidateDirectory);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return null;
  }
  return relative;
}

function resolveInstalledPackage(
  packageName,
  issuerDirectory,
  resolutionRoot = null,
) {
  let cursor = fs.realpathSync.native(issuerDirectory);
  const canonicalResolutionRoot = resolutionRoot
    ? fs.realpathSync.native(resolutionRoot)
    : null;
  if (
    canonicalResolutionRoot &&
    cursor !== canonicalResolutionRoot &&
    !getRelativeDescendant(canonicalResolutionRoot, cursor)
  ) {
    return null;
  }
  while (true) {
    const candidate = path.join(
      cursor,
      "node_modules",
      ...packageName.split("/"),
    );
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    if (canonicalResolutionRoot && cursor === canonicalResolutionRoot) return null;
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

function getDestinationKey(destination) {
  return process.platform === "win32"
    ? destination.toLowerCase()
    : destination;
}

function listNodeModuleDestinations(issuerDestination, packageName) {
  const packageSegments = packageName.split("/");
  const cursor = issuerDestination ? issuerDestination.split("/") : [];
  const destinations = [];
  while (true) {
    if (cursor.at(-1) !== "node_modules") {
      destinations.push(
        [...cursor, "node_modules", ...packageSegments].join("/"),
      );
    }
    if (cursor.length === 0) break;
    cursor.pop();
  }
  return destinations;
}

function chooseDependencyDestination({
  canonicalSource,
  destinations,
  issuerDestination,
  packageName,
  preferredDestination,
}) {
  const candidates = listNodeModuleDestinations(
    issuerDestination,
    packageName,
  );
  let firstUnassigned = null;
  for (const candidate of candidates) {
    const assignedSource = destinations.get(getDestinationKey(candidate));
    if (!assignedSource) {
      firstUnassigned ||= candidate;
      continue;
    }
    if (assignedSource === canonicalSource) {
      return { destination: candidate, isNew: false };
    }
    if (firstUnassigned) {
      return { destination: firstUnassigned, isNew: true };
    }
    throw new Error(
      `Desktop release dependency destination collision: ${candidate}`,
    );
  }
  return {
    destination: candidates.includes(preferredDestination)
      ? preferredDestination
      : firstUnassigned,
    isNew: true,
  };
}

function collectLocalDependencyFileSets({
  desktopRoot = DESKTOP_ROOT,
  workspaceRoot = path.resolve(desktopRoot, "..", ".."),
} = {}) {
  const canonicalDesktopRoot = fs.realpathSync.native(desktopRoot);
  const canonicalWorkspaceRoot = fs.realpathSync.native(workspaceRoot);
  if (
    canonicalDesktopRoot !== canonicalWorkspaceRoot &&
    !getRelativeDescendant(canonicalWorkspaceRoot, canonicalDesktopRoot)
  ) {
    throw new Error("Desktop release root must be inside its workspace root.");
  }
  const appPackage = JSON.parse(
    fs.readFileSync(path.join(canonicalDesktopRoot, "package.json"), "utf8"),
  );
  const queue = Object.keys(appPackage.dependencies || {}).map((name) => ({
    name,
    issuerDirectory: canonicalDesktopRoot,
    issuerDestination: "",
  }));
  const destinations = new Map();
  const fileSets = [];
  const localNodeModules = path.join(canonicalDesktopRoot, "node_modules");
  const workspaceNodeModules = path.join(canonicalWorkspaceRoot, "node_modules");

  while (queue.length > 0) {
    const { name, issuerDirectory, issuerDestination } = queue.shift();
    const packageDirectory = resolveInstalledPackage(
      name,
      issuerDirectory,
      canonicalWorkspaceRoot,
    );
    if (!packageDirectory) {
      throw new Error(
        `Desktop release dependency is not installed for ${name} from ${issuerDirectory}. ` +
          "Run the reviewed workspace npm ci before packaging.",
      );
    }
    const canonicalDirectory = fs.realpathSync.native(packageDirectory);
    const localRelative = getRelativeDescendant(
      localNodeModules,
      canonicalDirectory,
    );
    const workspaceRelative = getRelativeDescendant(
      workspaceNodeModules,
      canonicalDirectory,
    );
    const installedRelative = localRelative || workspaceRelative;
    if (!installedRelative) {
      throw new Error(
        `Desktop release dependency escaped the reviewed workspace node_modules roots: ${name} -> ${canonicalDirectory}`,
      );
    }
    const canonicalKey =
      process.platform === "win32"
        ? canonicalDirectory.toLowerCase()
        : canonicalDirectory;
    const preferredDestination = path
      .join("node_modules", installedRelative)
      .replaceAll(path.sep, "/");
    const { destination, isNew } = chooseDependencyDestination({
      canonicalSource: canonicalKey,
      destinations,
      issuerDestination,
      packageName: name,
      preferredDestination,
    });
    if (!isNew) continue;
    destinations.set(getDestinationKey(destination), canonicalKey);
    fileSets.push({
      from: canonicalDirectory,
      to: destination,
      filter: ["**/*"],
    });

    const dependencyPackage = JSON.parse(
      fs.readFileSync(path.join(canonicalDirectory, "package.json"), "utf8"),
    );
    for (const dependencyName of Object.keys({
      ...(dependencyPackage.dependencies || {}),
      ...(dependencyPackage.optionalDependencies || {}),
    })) {
      if (
        resolveInstalledPackage(
          dependencyName,
          canonicalDirectory,
          canonicalWorkspaceRoot,
        )
      ) {
        queue.push({
          name: dependencyName,
          issuerDirectory: canonicalDirectory,
          issuerDestination: destination,
        });
      } else if (dependencyPackage.dependencies?.[dependencyName]) {
        throw new Error(
          `Required desktop release dependency is missing: ${dependencyName} (required by ${dependencyPackage.name})`,
        );
      }
    }
  }

  return fileSets.sort((left, right) => left.to.localeCompare(right.to));
}

module.exports = {
  DESKTOP_ROOT,
  collectLocalDependencyFileSets,
  resolveInstalledPackage,
};
