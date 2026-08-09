"use strict";

const fs = require("node:fs");
const path = require("node:path");

const defaultRepoRoot = path.resolve(__dirname, "..");

function isExistingFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function syncAssetGroup({ sourcePath, targetPaths, label, log, warn }) {
  if (isExistingFile(sourcePath)) {
    for (const targetPath of targetPaths) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
      log(`Synced ${sourcePath} -> ${targetPath}`);
    }
    return { copied: [...targetPaths], retained: [] };
  }

  const missingTargets = targetPaths.filter(
    (targetPath) => !isExistingFile(targetPath),
  );
  if (missingTargets.length > 0) {
    throw new Error(
      `${label} source was not found (${sourcePath}) and bundled target file(s) are missing: ${missingTargets.join(", ")}`,
    );
  }

  warn(
    `${label} source was not found (${sourcePath}); retaining the bundled package input(s).`,
  );
  return { copied: [], retained: [...targetPaths] };
}

function syncBrandIcons({
  repoRoot = defaultRepoRoot,
  sourceIcon = path.join(
    repoRoot,
    "apps",
    "arenzyra-web",
    "app",
    "favicon.ico",
  ),
  sourceMark = path.join(repoRoot, "apps", "arenzyra-web", "app", "icon.png"),
  sourceDesktopMark = path.join(
    repoRoot,
    "assets",
    "brand",
    "arenzyra-mark.png",
  ),
  targetIcons = [
    path.join(repoRoot, "apps", "desktop", "build", "icon.ico"),
    path.join(repoRoot, "apps", "launcher", "build", "icon.ico"),
  ],
  targetMarks = [
    path.join(repoRoot, "apps", "desktop", "build", "default-team.png"),
  ],
  targetDesktopMarks = [
    path.join(
      repoRoot,
      "apps",
      "desktop",
      "src",
      "assets",
      "arenzyra-mark.png",
    ),
  ],
  log = console.log,
  warn = console.warn,
} = {}) {
  return {
    icons: syncAssetGroup({
      sourcePath: sourceIcon,
      targetPaths: targetIcons,
      label: "Brand icon",
      log,
      warn,
    }),
    marks: syncAssetGroup({
      sourcePath: sourceMark,
      targetPaths: targetMarks,
      label: "Brand mark",
      log,
      warn,
    }),
    desktopMarks: syncAssetGroup({
      sourcePath: sourceDesktopMark,
      targetPaths: targetDesktopMarks,
      label: "Desktop brand mark",
      log,
      warn,
    }),
  };
}

if (require.main === module) {
  syncBrandIcons();
}

module.exports = {
  syncBrandIcons,
};
