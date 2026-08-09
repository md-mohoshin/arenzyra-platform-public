"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_TEAM_LOGO_FILE_NAME = "default-team.png";

function isRegularFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function filesHaveSameContent(leftPath, rightPath) {
  try {
    const leftStats = fs.statSync(leftPath);
    const rightStats = fs.statSync(rightPath);
    if (!leftStats.isFile() || !rightStats.isFile()) {
      return false;
    }
    if (leftStats.size !== rightStats.size) {
      return false;
    }
    return fs.readFileSync(leftPath).equals(fs.readFileSync(rightPath));
  } catch {
    return false;
  }
}

function copyFileReplacingAtomically(sourcePath, targetPath) {
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`,
  );

  try {
    fs.copyFileSync(sourcePath, temporaryPath);
    try {
      fs.renameSync(temporaryPath, targetPath);
    } catch {
      // Antivirus or a short-lived reader can prevent a Windows rename. The
      // source remains intact, so fall back to a direct replacement.
      fs.copyFileSync(temporaryPath, targetPath);
    }
  } finally {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Nothing else needs to happen if the temporary file is already gone.
    }
  }
}

function ensureDefaultTeamLogo(options = {}) {
  const teamAssetsDir = String(options.teamAssetsDir || "").trim();
  if (!teamAssetsDir) {
    throw new Error("Team assets directory is required.");
  }

  const bundledDefaultTeamPath = String(
    options.bundledDefaultTeamPath || "",
  ).trim();
  const fallbackPngBuffer = options.fallbackPngBuffer;
  const targetPath = path.join(teamAssetsDir, DEFAULT_TEAM_LOGO_FILE_NAME);

  fs.mkdirSync(teamAssetsDir, { recursive: true });

  if (isRegularFile(bundledDefaultTeamPath)) {
    if (!filesHaveSameContent(bundledDefaultTeamPath, targetPath)) {
      copyFileReplacingAtomically(bundledDefaultTeamPath, targetPath);
      return { path: targetPath, refreshed: true, source: "bundled" };
    }
    return { path: targetPath, refreshed: false, source: "bundled" };
  }

  if (!isRegularFile(targetPath)) {
    if (!Buffer.isBuffer(fallbackPngBuffer) || fallbackPngBuffer.length === 0) {
      throw new Error("A fallback team logo buffer is required.");
    }
    fs.writeFileSync(targetPath, fallbackPngBuffer);
    return { path: targetPath, refreshed: true, source: "fallback" };
  }

  return { path: targetPath, refreshed: false, source: "existing" };
}

module.exports = {
  DEFAULT_TEAM_LOGO_FILE_NAME,
  ensureDefaultTeamLogo,
  filesHaveSameContent,
};
