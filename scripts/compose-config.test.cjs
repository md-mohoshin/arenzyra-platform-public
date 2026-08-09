"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");

function requiredComposeEnvironment(composeText) {
  const env = { ...process.env };
  for (const match of composeText.matchAll(/\$\{([A-Z0-9_]+):\?[^}]+\}/g)) {
    env[match[1]] = "compose-config-test";
  }
  return env;
}

for (const composeFile of [
  "infra/docker-compose.publish.yml",
  "infra/docker-compose.yml",
]) {
  test(`${composeFile} renders as valid Compose configuration`, (t) => {
    const composeText = fs.readFileSync(
      path.join(repositoryRoot, composeFile),
      "utf8",
    );
    const probe = spawnSync("docker", ["compose", "version"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    if (probe.error?.code === "ENOENT") {
      t.skip("Docker Compose is unavailable");
      return;
    }
    assert.equal(probe.status, 0, probe.stderr || probe.stdout);

    const result = spawnSync(
      "docker",
      ["compose", "-f", composeFile, "config", "--quiet"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: requiredComposeEnvironment(composeText),
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}
