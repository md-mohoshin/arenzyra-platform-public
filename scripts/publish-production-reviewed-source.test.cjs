"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");
const publisher = path.join(
  repositoryRoot,
  "scripts",
  "publish-production-reviewed-source.ps1",
);
const powershell = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const tar = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "tar.exe",
);
const git = "C:\\Program Files\\Git\\cmd\\git.exe";

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${path.basename(executable)} failed:\n${result.stderr || result.stdout}`,
  );
  return result;
}

function createLinkedReleaseRepository(testRoot, name, targetFiles = {}) {
  const source = path.join(testRoot, `${name}-source`);
  const checkout = path.join(testRoot, `${name}-target`);
  fs.mkdirSync(source);
  run(git, ["init", "--initial-branch=main", source]);
  run(git, ["-C", source, "config", "core.autocrlf", "false"]);
  fs.writeFileSync(path.join(source, ".gitattributes"), "* text eol=lf\n", "utf8");
  fs.writeFileSync(path.join(source, "release.txt"), "current\n", "utf8");
  run(git, [
    "-c",
    "user.name=Arenzyra Test",
    "-c",
    "user.email=release-test@invalid.example",
    "-C",
    source,
    "add",
    ".gitattributes",
    "release.txt",
  ]);
  run(git, [
    "-c",
    "user.name=Arenzyra Test",
    "-c",
    "user.email=release-test@invalid.example",
    "-C",
    source,
    "commit",
    "-m",
    "current",
  ]);
  const current = run(git, ["-C", source, "rev-parse", "HEAD"]).stdout.trim();
  fs.writeFileSync(path.join(source, "release.txt"), "target\n", "utf8");
  for (const [relativePath, content] of Object.entries(targetFiles)) {
    const targetPath = path.join(source, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, "utf8");
  }
  run(git, ["-C", source, "add", "--all"]);
  run(git, [
    "-c",
    "user.name=Arenzyra Test",
    "-c",
    "user.email=release-test@invalid.example",
    "-C",
    source,
    "commit",
    "-m",
    "target",
  ]);
  const target = run(git, ["-C", source, "rev-parse", "HEAD"]).stdout.trim();
  run(git, ["-C", source, "worktree", "add", "--detach", checkout, target]);
  const gitPath = run(git, [
    "-C",
    checkout,
    "rev-parse",
    "--git-path",
    "objects/info/alternates",
  ]).stdout.trim();
  assert.equal(path.isAbsolute(gitPath), true, "fixture must exercise an absolute --git-path result");
  return { checkout, current, target };
}

test("Windows publisher packages three linked clean forward repositories", (t) => {
  if (process.platform !== "win32") {
    t.skip("the reviewed publisher is a Windows entrypoint");
    return;
  }
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-source-publisher-test-"),
  );
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const compatibilityGatePath =
    "scripts/verify-production-retired-widget-compatibility.sh";
  const compatibilityGateBytes = "#!/usr/bin/env bash\nexit 0\n";
  const root = createLinkedReleaseRepository(temporaryRoot, "root", {
    [compatibilityGatePath]: compatibilityGateBytes,
  });
  const api = createLinkedReleaseRepository(temporaryRoot, "api");
  const web = createLinkedReleaseRepository(temporaryRoot, "web");
  const bundle = path.join(temporaryRoot, "bundle");
  const result = run(powershell, [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    publisher,
    "-Action",
    "Package",
    "-BundleDirectory",
    bundle,
    "-ReleaseId",
    "source-publisher-test-01",
    "-RootRepository",
    root.checkout,
    "-ApiRepository",
    api.checkout,
    "-WebRepository",
    web.checkout,
    "-CurrentRootCommit",
    root.current,
    "-CurrentApiCommit",
    api.current,
    "-CurrentWebCommit",
    web.current,
    "-TargetRootCommit",
    root.target,
    "-TargetApiCommit",
    api.target,
    "-TargetWebCommit",
    web.target,
  ]);
  assert.match(result.stdout, /REVIEWED SOURCE PACKAGE COMPLETE/);
  const descriptor = JSON.parse(
    fs.readFileSync(path.join(bundle, "source-transfer.json"), "utf8"),
  );
  assert.equal(descriptor.schemaVersion, 1);
  for (const component of ["root", "api", "web"]) {
    assert.match(descriptor.archives[component].sha256, /^[0-9a-f]{64}$/);
    assert.ok(
      fs.statSync(path.join(bundle, `${component}.git.tar`)).size > 0,
    );
  }

  const extractedRoot = path.join(temporaryRoot, "root-extracted.git");
  fs.mkdirSync(extractedRoot);
  run(tar, [
    "-xf",
    path.join(bundle, "root.git.tar"),
    "-C",
    extractedRoot,
  ]);
  const packagedGate = run(git, [
    "-C",
    extractedRoot,
    "show",
    `${root.target}:${compatibilityGatePath}`,
  ]).stdout;
  assert.equal(packagedGate, compatibilityGateBytes);
});

test("Windows publisher parses its exact LF/base64 payload wrapper and arguments", (t) => {
  if (process.platform !== "win32") {
    t.skip("the reviewed publisher is a Windows entrypoint");
    return;
  }
  const result = run(powershell, [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    publisher,
    "-Action",
    "SelfTest",
    "-BundleDirectory",
    repositoryRoot,
  ]);
  assert.match(result.stdout, /REVIEWED SOURCE TRANSPORT SELF-TEST PASSED/);
});
