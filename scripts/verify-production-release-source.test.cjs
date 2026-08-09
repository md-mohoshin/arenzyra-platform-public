"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  assertExactReleaseBytes,
  assertSecureStat,
  parseArguments,
  serializeReleaseMetadata,
} = require("./verify-production-release-source.cjs");

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
