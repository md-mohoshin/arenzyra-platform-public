"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  resolveInstalledPackage,
} = require("./local-dependency-file-policy.cjs");

const DESKTOP_ROOT = path.resolve(__dirname, "..");
const WORKSPACE_ROOT = path.resolve(DESKTOP_ROOT, "..", "..");
const SHARP_NATIVE_PACKAGE = "@img/sharp-win32-x64";
const SHARP_NATIVE_VERSION = "0.35.3";
const SHARP_NATIVE_PACKAGE_DESTINATION =
  "node_modules/@img/sharp-win32-x64";
const REQUIRED_SHARP_NATIVE_RUNTIME_RELATIVE_PATHS = Object.freeze([
  "lib/libvips-42.dll",
  "lib/libvips-cpp-8.18.3.dll",
  "lib/sharp-win32-x64-0.35.3.node",
]);
const REQUIRED_SHARP_NATIVE_DLL_RELATIVE_PATHS = Object.freeze(
  REQUIRED_SHARP_NATIVE_RUNTIME_RELATIVE_PATHS.filter((relativePath) =>
    relativePath.endsWith(".dll"),
  ),
);

function comparablePath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function resolveSharpNativePackageDirectory({
  desktopRoot = DESKTOP_ROOT,
  workspaceRoot = WORKSPACE_ROOT,
} = {}) {
  const packageDirectory = resolveInstalledPackage(
    SHARP_NATIVE_PACKAGE,
    desktopRoot,
    workspaceRoot,
  );
  if (!packageDirectory) {
    throw new Error(
      `Required desktop native dependency is not installed: ${SHARP_NATIVE_PACKAGE}.`,
    );
  }

  const packageJsonPath = path.join(packageDirectory, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  if (
    packageJson?.name !== SHARP_NATIVE_PACKAGE ||
    packageJson?.version !== SHARP_NATIVE_VERSION
  ) {
    throw new Error(
      `Sharp native runtime must be ${SHARP_NATIVE_PACKAGE}@${SHARP_NATIVE_VERSION}.`,
    );
  }
  return packageDirectory;
}

function listSharpNativeRuntimeSourceFiles(options = {}) {
  const desktopRoot = path.resolve(options.desktopRoot || DESKTOP_ROOT);
  const packageDirectory = resolveSharpNativePackageDirectory({
    desktopRoot,
    workspaceRoot: path.resolve(options.workspaceRoot || WORKSPACE_ROOT),
  });

  return REQUIRED_SHARP_NATIVE_RUNTIME_RELATIVE_PATHS.map((relativePath) => {
    const filePath = path.resolve(
      packageDirectory,
      ...relativePath.split("/"),
    );
    const stat = fs.lstatSync(filePath);
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      Number(stat.nlink || 1) !== 1 ||
      comparablePath(fs.realpathSync.native(filePath)) !==
        comparablePath(filePath)
    ) {
      throw new Error(
        `Sharp native runtime input must be a regular unlinked file: ${filePath}.`,
      );
    }
    return {
      filePath,
      packagedPath: `${SHARP_NATIVE_PACKAGE_DESTINATION}/${relativePath}`,
      relativePath,
      unpackPattern: path
        .relative(desktopRoot, filePath)
        .replaceAll(path.sep, "/"),
    };
  });
}

function listSharpNativeRuntimeExtraResources(options = {}) {
  return listSharpNativeRuntimeSourceFiles(options)
    .filter((entry) => entry.relativePath.endsWith(".dll"))
    .map((entry) => ({
      from: entry.unpackPattern,
      to: `app.asar.unpacked/${entry.packagedPath}`,
    }));
}

module.exports = {
  DESKTOP_ROOT,
  REQUIRED_SHARP_NATIVE_DLL_RELATIVE_PATHS,
  REQUIRED_SHARP_NATIVE_RUNTIME_RELATIVE_PATHS,
  SHARP_NATIVE_PACKAGE,
  SHARP_NATIVE_PACKAGE_DESTINATION,
  SHARP_NATIVE_VERSION,
  listSharpNativeRuntimeExtraResources,
  listSharpNativeRuntimeSourceFiles,
  resolveSharpNativePackageDirectory,
};
