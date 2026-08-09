"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  assertConnectorInstallPlan,
  assertPathHasNoLinks,
  assertVerifiedRuntimeInputs,
  atomicReplaceVerifiedFiles,
  createSanitizedConnectorEnv,
  inspectWindowsProcessIntegrity,
  resolveTrustedWindowsCommand,
  sha256File,
} = require("./connector-runtime-security.cjs");

const trustedWindowsExecPath = "C:\\Program Files\\Arenzyra\\Arenzyra.exe";

function inspectTrustedWindowsPath(candidatePath, { kind }) {
  return {
    exists: true,
    isDirectory: kind === "directory",
    isFile: kind === "file",
    isReparsePoint: false,
    isSymbolicLink: false,
    nlink: 1,
    realpath: candidatePath,
  };
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-connector-security-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const resources = path.join(root, "resources", "connectors");
  const installRoot = path.join(root, "PCOB");
  const executable = path.join(
    installRoot,
    "WindowsNoEditor",
    "ShadowTrackerExtra",
    "Binaries",
    "Win64",
    "ShadowTrackerExtra.exe",
  );
  fs.mkdirSync(resources, { recursive: true });
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.mkdirSync(path.join(installRoot, "ObToolsNew"), { recursive: true });
  fs.writeFileSync(executable, "exe");
  const source = path.join(resources, "ob.js");
  fs.writeFileSync(source, "source");
  return { executable, installRoot, resources, root, source };
}

test("connector install plan rejects targets outside the selected PCOB root", (t) => {
  const value = fixture(t);
  assert.throws(
    () =>
      assertConnectorInstallPlan({
        sourceFiles: [value.source],
        targetFiles: [path.join(value.root, "outside", "ob.js")],
        allowedTargetRoots: [value.installRoot],
        shadowTrackerPath: value.executable,
      }),
    { code: "ARENZYRA_CONNECTOR_TARGET_ESCAPE" },
  );
});

test("connector install plan rejects a symlink or junction in the target tree", (t) => {
  const value = fixture(t);
  const linkedDirectory = path.join(value.installRoot, "LinkedTools");
  try {
    fs.symlinkSync(value.resources, linkedDirectory, "junction");
  } catch (error) {
    t.skip(`Junction creation is unavailable: ${error.code || error.message}`);
    return;
  }
  assert.throws(
    () => assertPathHasNoLinks(path.join(linkedDirectory, "ob.js"), { requireFile: true }),
    { code: "ARENZYRA_CONNECTOR_REPARSE_POINT" },
  );
});

test("managed runtime inputs are bound to their resource root and exact hashes", (t) => {
  const value = fixture(t);
  const hash = sha256File(value.source);
  assert.equal(
    assertVerifiedRuntimeInputs({
      trustedRoot: value.resources,
      files: [{ path: value.source, sha256: hash }],
    }),
    true,
  );
  fs.writeFileSync(value.source, "replaced");
  assert.throws(
    () =>
      assertVerifiedRuntimeInputs({
        trustedRoot: value.resources,
        files: [{ path: value.source, sha256: hash }],
      }),
    { code: "ARENZYRA_CONNECTOR_RUNTIME_HASH_MISMATCH" },
  );
});

test("connector child environment drops ambient Node, shell, and Git injection", () => {
  const axiosRoot = path.resolve("trusted-a", "node_modules", "axios");
  const expressRoot = path.resolve("trusted-b", "node_modules", "express");
  const env = createSanitizedConnectorEnv({
    parentEnv: {
      SystemRoot: "C:\\Windows",
      NODE_OPTIONS: "--require=C:\\attacker.js",
      NODE_PATH: "C:\\shadow-modules",
      BASH_ENV: "C:\\attacker.sh",
      GIT_CONFIG_COUNT: "1",
      PATH: "C:\\attacker-bin",
    },
    overrides: {
      PORT: "10086",
      NODE_OPTIONS: "--inspect",
      GIT_DIR: "C:\\repo",
    },
    dependencyRoots: {
      axios: axiosRoot,
      express: expressRoot,
    },
    electronRunAsNode: true,
  });
  assert.equal(env.SystemRoot, "C:\\Windows");
  assert.equal(env.PORT, "10086");
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.NODE_PATH, undefined);
  assert.equal(env.BASH_ENV, undefined);
  assert.equal(env.GIT_CONFIG_COUNT, undefined);
  assert.equal(env.GIT_DIR, undefined);
  assert.equal(env.PATH, undefined);
  assert.equal(env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(env.ARENZYRA_MANAGED_CONNECTOR, "1");
  assert.deepEqual(JSON.parse(env.ARENZYRA_CONNECTOR_DEPENDENCY_MAP), {
    axios: axiosRoot,
    express: expressRoot,
  });
});

test("managed dependency map supports distinct trusted package roots without NODE_PATH", () => {
  const dependencyRoots = Object.fromEntries(
    ["axios", "express"].map((packageName) => [
      packageName,
      path.dirname(require.resolve(`${packageName}/package.json`)),
    ]),
  );
  const env = createSanitizedConnectorEnv({ dependencyRoots });
  const resolved = JSON.parse(env.ARENZYRA_CONNECTOR_DEPENDENCY_MAP);
  assert.equal(env.NODE_PATH, undefined);
  assert.doesNotThrow(() => require(resolved.axios));
  assert.doesNotThrow(() => require(resolved.express));
});

test("connector replacement uses verified same-directory atomic temp files", (t) => {
  const value = fixture(t);
  const directoryPath = path.join(value.installRoot, "ObToolsNew");
  const targetPath = path.join(directoryPath, "ob.js");
  fs.writeFileSync(targetPath, "old");
  const results = atomicReplaceVerifiedFiles({
    directoryPath,
    replacements: [{ targetPath, data: Buffer.from("new") }],
    validateDirectory: () =>
      assertConnectorInstallPlan({
        sourceFiles: [value.source],
        targetFiles: [targetPath],
        allowedTargetRoots: [value.installRoot],
        shadowTrackerPath: value.executable,
      }),
  });
  assert.equal(fs.readFileSync(targetPath, "utf8"), "new");
  assert.equal(results[0].sha256, sha256File(targetPath));
  assert.deepEqual(
    fs.readdirSync(directoryPath).filter((name) => name.endsWith(".tmp")),
    [],
  );
});

test("connector replacement repeats validation around every atomic replace", (t) => {
  const value = fixture(t);
  const directoryPath = path.join(value.installRoot, "ObToolsNew");
  const contexts = [];
  atomicReplaceVerifiedFiles({
    directoryPath,
    replacements: [
      { targetPath: path.join(directoryPath, "ob.js"), data: "one" },
      { targetPath: path.join(directoryPath, "support.cjs"), data: "two" },
    ],
    validateDirectory: (context) => contexts.push({ ...context }),
  });
  assert.equal(
    contexts.filter((context) => context.phase === "before-replace").length,
    2,
  );
  assert.equal(
    contexts.filter((context) => context.phase === "after-replace").length,
    2,
  );
  assert.deepEqual(
    contexts
      .filter((context) => context.phase === "before-replace")
      .map((context) => path.basename(context.targetPath)),
    ["ob.js", "support.cjs"],
  );
});

test("connector replacement rejects directory substitution at the pre-replace hook", (t) => {
  const value = fixture(t);
  const directoryPath = path.join(value.installRoot, "ObToolsNew");
  const movedDirectoryPath = path.join(value.installRoot, "ObToolsOriginal");
  const targetPath = path.join(directoryPath, "ob.js");
  fs.writeFileSync(targetPath, "trusted-old");
  assert.throws(
    () =>
      atomicReplaceVerifiedFiles({
        directoryPath,
        replacements: [{ targetPath, data: Buffer.from("new") }],
        hooks: {
          beforeReplace() {
            fs.renameSync(directoryPath, movedDirectoryPath);
            fs.mkdirSync(directoryPath);
          },
        },
      }),
    { code: "ARENZYRA_CONNECTOR_DIRECTORY_CHANGED" },
  );
  assert.equal(fs.existsSync(targetPath), false);
  assert.equal(
    fs.readFileSync(path.join(movedDirectoryPath, "ob.js"), "utf8"),
    "trusted-old",
  );
});

test("connector staging never overwrites or removes a pre-existing temp path", (t) => {
  const value = fixture(t);
  const directoryPath = path.join(value.installRoot, "ObToolsNew");
  const targetPath = path.join(directoryPath, "ob.js");
  const suffix = "aa".repeat(16);
  const occupiedTempPath = path.join(
    directoryPath,
    `.arenzyra-ob.js-${suffix}.tmp`,
  );
  fs.writeFileSync(occupiedTempPath, "attacker-owned");
  assert.throws(
    () =>
      atomicReplaceVerifiedFiles({
        directoryPath,
        replacements: [{ targetPath, data: Buffer.from("new") }],
        randomBytesImpl: () => Buffer.alloc(16, 0xaa),
      }),
    (error) => error?.code === "EEXIST",
  );
  assert.equal(fs.readFileSync(occupiedTempPath, "utf8"), "attacker-owned");
  assert.equal(fs.existsSync(targetPath), false);
});

test("connector replacement refuses a multiply linked target", (t) => {
  const value = fixture(t);
  const directoryPath = path.join(value.installRoot, "ObToolsNew");
  const targetPath = path.join(directoryPath, "ob.js");
  fs.writeFileSync(targetPath, "old");
  fs.linkSync(targetPath, path.join(directoryPath, "second-link.js"));
  assert.throws(
    () =>
      atomicReplaceVerifiedFiles({
        directoryPath,
        replacements: [{ targetPath, data: "new" }],
      }),
    { code: "ARENZYRA_CONNECTOR_HARD_LINK" },
  );
  assert.equal(fs.readFileSync(targetPath, "utf8"), "old");
});

test("Windows integrity inspection fails closed and recognizes high integrity", () => {
  assert.equal(
    inspectWindowsProcessIntegrity({
      platform: "win32",
      env: { SystemRoot: "C:\\Windows" },
      execPath: trustedWindowsExecPath,
      inspectPath: inspectTrustedWindowsPath,
      spawnSyncImpl: () => ({
        status: 0,
        stdout: '"Mandatory Label\\High Mandatory Level","S-1-16-12288"',
      }),
    }),
    "elevated",
  );
  assert.equal(
    inspectWindowsProcessIntegrity({
      platform: "win32",
      env: { SystemRoot: "C:\\Windows" },
      execPath: trustedWindowsExecPath,
      inspectPath: inspectTrustedWindowsPath,
      spawnSyncImpl: () => ({ status: 1, stdout: "" }),
    }),
    "unknown",
  );
});

test("Windows integrity inspection rejects redirected or inconsistent roots", () => {
  let spawnCalls = 0;
  const spawnSyncImpl = () => {
    spawnCalls += 1;
    return {
      status: 0,
      stdout: '"Mandatory Label\\Medium Mandatory Level","S-1-16-8192"',
    };
  };
  assert.equal(
    inspectWindowsProcessIntegrity({
      platform: "win32",
      env: { SystemRoot: "C:\\Users\\attacker\\Windows" },
      execPath: trustedWindowsExecPath,
      inspectPath: inspectTrustedWindowsPath,
      spawnSyncImpl,
    }),
    "unknown",
  );
  assert.equal(
    inspectWindowsProcessIntegrity({
      platform: "win32",
      env: { SystemRoot: "C:\\Windows", WINDIR: "D:\\Windows" },
      execPath: trustedWindowsExecPath,
      inspectPath: inspectTrustedWindowsPath,
      spawnSyncImpl,
    }),
    "unknown",
  );
  assert.equal(spawnCalls, 0);
});

test("trusted Windows command resolution uses absolute System32 paths and a minimal env", () => {
  const resolved = resolveTrustedWindowsCommand("powershell", {
    platform: "win32",
    execPath: trustedWindowsExecPath,
    env: {
      SystemRoot: "C:\\Windows",
      WINDIR: "C:\\Windows",
      SystemDrive: "C:",
      PATH: "C:\\attacker",
      NODE_OPTIONS: "--require=C:\\attacker.js",
    },
    inspectPath: inspectTrustedWindowsPath,
  });
  assert.equal(
    resolved.executablePath,
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
  assert.deepEqual(resolved.env, {
    SystemDrive: "C:",
    SystemRoot: "C:\\Windows",
    WINDIR: "C:\\Windows",
  });
});

test("trusted Windows command resolution rejects ambient drive changes and linked binaries", () => {
  assert.throws(
    () =>
      resolveTrustedWindowsCommand("whoami", {
        platform: "win32",
        execPath: trustedWindowsExecPath,
        env: { SystemRoot: "D:\\Windows" },
        inspectPath: inspectTrustedWindowsPath,
      }),
    { code: "ARENZYRA_WINDOWS_ROOT_MISMATCH" },
  );
  assert.throws(
    () =>
      resolveTrustedWindowsCommand("taskkill", {
        platform: "win32",
        execPath: trustedWindowsExecPath,
        env: { SystemRoot: "C:\\Windows" },
        inspectPath: (candidatePath, details) => ({
          ...inspectTrustedWindowsPath(candidatePath, details),
          ...(candidatePath.toLowerCase().endsWith("taskkill.exe")
            ? { nlink: 2 }
            : {}),
        }),
      }),
    { code: "ARENZYRA_WINDOWS_SYSTEM_PATH_UNTRUSTED" },
  );
});

test("launcher repair and spawn paths keep elevation out of mutable scripts", () => {
  const source = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  assert.doesNotMatch(source, /Start-Process[\s\S]*-Verb\s+RunAs/i);
  assert.doesNotMatch(source, /runElevatedConnectorCopy/);
  assert.match(source, /assertManagedConnectorInstallPlan\(/);
  assert.match(source, /atomicReplaceVerifiedFiles\(/);
  assert.doesNotMatch(source, /fs\.copyFileSync\(/);
  assert.doesNotMatch(source, /function writeConnectorManifest\(/);
  assert.match(source, /status:\s*[\s\S]*"elevated-launcher-refused"/);
  assert.match(source, /Arenzyra will not elevate mutable connector files/);
  assert.match(source, /prepareManagedConnectorRuntimeInputs\(connector\)/);
  assert.match(
    source,
    /createSanitizedConnectorEnv\([\s\S]*dependencyRoots:\s*options\.dependencyRoots/,
  );
  const spawnFunction = source.slice(
    source.indexOf("function spawnNodeScript("),
    source.indexOf("\nfunction sleep", source.indexOf("function spawnNodeScript(")),
  );
  assert.doesNotMatch(spawnFunction, /NODE_PATH|NODE_OPTIONS|\.\.\.process\.env/);
  assert.match(spawnFunction, /process\.execPath/);
});
