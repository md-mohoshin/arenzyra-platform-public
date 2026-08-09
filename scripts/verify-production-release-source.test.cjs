"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  assertExactReleaseBytes,
  assertNoGitObjectSubstitution,
  assertSecureStat,
  parseArguments,
  serializeReleaseMetadata,
} = require("./verify-production-release-source.cjs");

function substitutionFixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-git-substitution-"));
}

function fakeStat({
  uid = 0,
  gid = 0,
  mode = 0o100644,
  nlink = 1,
  file = true,
  directory = false,
  symlink = false,
} = {}) {
  return {
    uid,
    gid,
    mode,
    nlink,
    isFile: () => file,
    isDirectory: () => directory,
    isSymbolicLink: () => symlink,
  };
}

test("production source stat policy rejects alternate owners, writable paths, links, and symlinks", () => {
  assert.doesNotThrow(() =>
    assertSecureStat(fakeStat(), "source", { requireSingleLink: true }),
  );
  for (const stat of [
    fakeStat({ uid: 1000 }),
    fakeStat({ gid: 1000 }),
    fakeStat({ mode: 0o100664 }),
    fakeStat({ nlink: 2 }),
    fakeStat({ symlink: true }),
  ]) {
    assert.throws(() =>
      assertSecureStat(stat, "source", { requireSingleLink: true }),
    );
  }
});

test("release source comparison is exact and byte preserving", () => {
  const metadata = { lines: ["A=one", "B=two", ""] };
  const bytes = serializeReleaseMetadata(metadata);
  assert.equal(bytes.toString("utf8"), "A=one\nB=two\n");
  assert.doesNotThrow(() => assertExactReleaseBytes(bytes, metadata));
  assert.throws(() =>
    assertExactReleaseBytes(Buffer.concat([bytes, Buffer.from("\n")]), metadata),
  );
});

test("production source verifier accepts only its two closed CLI modes", () => {
  assert.deepEqual(parseArguments(["--check-checkout-only"]), {
    checkoutOnly: true,
    releaseEnvironmentFile: null,
  });
  assert.deepEqual(parseArguments(["--release-env", "/archive/release.env"]), {
    checkoutOnly: false,
    releaseEnvironmentFile: "/archive/release.env",
  });
  for (const argumentsList of [
    [],
    ["--release-env"],
    ["--check-checkout-only", "unexpected"],
    ["--release-env", "/archive/release.env", "unexpected"],
  ]) {
    assert.throws(() => parseArguments(argumentsList), /Usage:/);
  }
});

test("production source rejects Git grafts, alternates, and replacement refs", (t) => {
  const gitDirectory = substitutionFixture();
  t.after(() => fs.rmSync(gitDirectory, { recursive: true, force: true }));
  assert.doesNotThrow(() =>
    assertNoGitObjectSubstitution(gitDirectory, "fixture"),
  );

  for (const relativePath of [
    path.join("info", "grafts"),
    path.join("objects", "info", "alternates"),
    path.join("refs", "replace"),
  ]) {
    const target = path.join(gitDirectory, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (path.extname(target)) fs.writeFileSync(target, "replacement\n");
    else fs.mkdirSync(target, { recursive: true });
    assert.throws(
      () => assertNoGitObjectSubstitution(gitDirectory, "fixture"),
      /object substitution/,
    );
    fs.rmSync(target, { recursive: true, force: true });
  }

  fs.writeFileSync(
    path.join(gitDirectory, "packed-refs"),
    `${"a".repeat(40)} refs/replace/${"b".repeat(40)}\n`,
  );
  assert.throws(
    () => assertNoGitObjectSubstitution(gitDirectory, "fixture"),
    /packed Git replacement ref/,
  );
});
