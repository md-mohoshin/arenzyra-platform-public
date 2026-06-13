"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

const pairs = [
  {
    label: "Electron main process",
    canonical: path.join(repoRoot, "apps", "desktop", "electron", "main.cjs"),
    duplicate: path.join(repoRoot, "main.cjs"),
  },
  {
    label: "Telemetry bridge",
    canonical: path.join(repoRoot, "apps", "desktop", "electron", "telemetryBridge.cjs"),
    duplicate: path.join(repoRoot, "telemetryBridge.cjs"),
  },
  {
    label: "Map coordinate utilities",
    canonical: path.join(repoRoot, "apps", "desktop", "electron", "map-engine", "coordinate-utils.cjs"),
    duplicate: path.join(repoRoot, "coordinate-utils.cjs"),
  },
];

function normalizeContent(value) {
  return value.replace(/\r\n/g, "\n").trim();
}

function resolveProxyTarget(duplicatePath, content) {
  const normalized = normalizeContent(content);
  const match = normalized.match(
    /^["']use strict["'];\s*module\.exports\s*=\s*require\(["']([^"']+)["']\);$/,
  );
  if (!match) {
    return null;
  }
  return path.resolve(path.dirname(duplicatePath), match[1]);
}

const failures = [];

for (const pair of pairs) {
  if (!fs.existsSync(pair.duplicate)) {
    continue;
  }
  if (!fs.existsSync(pair.canonical)) {
    failures.push(`${pair.label}: canonical file missing at ${path.relative(repoRoot, pair.canonical)}`);
    continue;
  }

  const duplicateContent = fs.readFileSync(pair.duplicate, "utf8");
  const proxyTarget = resolveProxyTarget(pair.duplicate, duplicateContent);
  if (!proxyTarget || proxyTarget !== path.resolve(pair.canonical)) {
    failures.push(
      [
        `${pair.label}: duplicate runtime logic detected outside canonical source`,
        `  canonical: ${path.relative(repoRoot, pair.canonical)}`,
        `  duplicate: ${path.relative(repoRoot, pair.duplicate)}`,
        `  expected: root duplicate absent or a pure module.exports proxy to the canonical file`,
      ].join("\n"),
    );
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n\n"));
  process.exitCode = 1;
} else {
  console.log("Runtime source drift check passed.");
}
