"use strict";

const fs = require("node:fs");
const path = require("node:path");

function resolveWebBuildArtifact(webDir, distDir = ".next-build") {
  const supported = new Set([".next-build", ".next-playwright", ".next"]);
  if (!supported.has(distDir)) {
    throw new Error(`Unsupported Next.js dist directory: ${distDir}`);
  }
  const artifact = path.resolve(webDir, distDir, "BUILD_ID");
  if (!fs.existsSync(artifact) || !fs.statSync(artifact).isFile()) {
    throw new Error(`Web runtime BUILD_ID missing from active dist directory: ${artifact}`);
  }
  return artifact;
}

if (require.main === module) {
  const webDir = process.argv[2];
  const distDir = process.argv[3] || process.env.ARENZYRA_WEB_DIST_DIR || ".next-build";
  if (!webDir) {
    console.error("Usage: node health-artifact-policy.cjs <web-dir> [dist-dir]");
    process.exit(2);
  }
  try {
    console.log(resolveWebBuildArtifact(webDir, distDir));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = { resolveWebBuildArtifact };
