"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { SENTINEL, FuseState } = require("@electron/fuses/dist/constants");
const {
  comparePayloadInventories,
  inventorySha256,
  parseSevenZipListing,
  readFuseWire,
  readPeCertificateTable,
  readPeSignatureBlob,
  verifySharpNativeRuntime,
} = require("./packaged-runtime-integrity-verifier.cjs");
const {
  REQUIRED_SHARP_NATIVE_RUNTIME_RELATIVE_PATHS,
  SHARP_NATIVE_PACKAGE_DESTINATION,
} = require("../apps/desktop/release/sharp-native-runtime-policy.cjs");

function archiveListing(entries) {
  return [
    "Path = fixture.zip",
    "Type = zip",
    "",
    "----------",
    ...entries.flatMap((entry) => [
      `Path = ${entry.path}`,
      `Folder = ${entry.directory ? "+" : "-"}`,
      `Size = ${entry.size || 0}`,
      `Attributes = ${entry.directory ? "D" : "A"}`,
      "Encrypted = -",
      "",
    ]),
  ].join("\n");
}

test("Sharp native runtime requires every DLL and node binary outside app.asar", () => {
  const dependencies = REQUIRED_SHARP_NATIVE_RUNTIME_RELATIVE_PATHS.map(
    (relativePath, index) => ({
      path: `${SHARP_NATIVE_PACKAGE_DESTINATION}/${relativePath}`,
      size: index + 1,
      sha256: String(index + 1).repeat(64),
      unpacked: true,
    }),
  );
  const archiveFiles = new Map(
    dependencies.map((entry) => {
      const externalPath = `resources/app.asar.unpacked/${entry.path}`;
      return [
        externalPath.toLowerCase(),
        {
          path: externalPath,
          size: entry.size,
          sha256: entry.sha256,
        },
      ];
    }),
  );

  assert.deepEqual(
    verifySharpNativeRuntime({ dependencies }, archiveFiles),
    dependencies.map((entry) => entry.path),
  );

  const packedDependencies = dependencies.map((entry) => ({
    ...entry,
    unpacked: entry.path.endsWith(".node") ? false : entry.unpacked,
  }));
  assert.throws(
    () => verifySharpNativeRuntime({ dependencies: packedDependencies }, archiveFiles),
    /native module must be unpacked beside app\.asar/,
  );

  archiveFiles.delete(
    `resources/app.asar.unpacked/${dependencies[1].path}`.toLowerCase(),
  );
  assert.throws(
    () => verifySharpNativeRuntime({ dependencies }, archiveFiles),
    /missing or differs outside app\.asar/,
  );
});

test("complete archive inventory parsing is exact and case-collision safe", () => {
  const entries = parseSevenZipListing(
    archiveListing([
      { path: "resources", directory: true },
      { path: "resources/app.asar", size: 12 },
    ]),
  );
  assert.equal(entries.size, 2);
  assert.equal(entries.get("resources/app.asar").size, 12);
  assert.throws(
    () =>
      parseSevenZipListing(
        archiveListing([
          { path: "resources/App.asar", size: 12 },
          { path: "resources/app.asar", size: 12 },
        ]),
      ),
    /duplicate or case-colliding/,
  );
});

test("payload comparison permits only the reviewed installer helper delta", () => {
  const shared = {
    path: "Arenzyra Observer Launcher.exe",
    size: 10,
    sha256: "a".repeat(64),
  };
  const installer = new Map([
    [shared.path.toLowerCase(), shared],
    [
      "resources/elevate.exe",
      {
        path: "resources/elevate.exe",
        size: 5,
        sha256: "b".repeat(64),
      },
    ],
  ]);
  const portable = new Map([[shared.path.toLowerCase(), { ...shared }]]);
  assert.doesNotThrow(() => comparePayloadInventories(installer, portable));
  portable.get(shared.path.toLowerCase()).sha256 = "c".repeat(64);
  assert.throws(
    () => comparePayloadInventories(installer, portable),
    /disagree/,
  );
});

test("fuse inspection requires the exact reviewed Electron wire", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-fuses-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = path.join(root, "launcher.exe");
  const expected = [
    FuseState.ENABLE,
    FuseState.DISABLE,
    FuseState.DISABLE,
    FuseState.DISABLE,
    FuseState.ENABLE,
    FuseState.ENABLE,
    FuseState.DISABLE,
    FuseState.ENABLE,
  ];
  fs.writeFileSync(
    executable,
    Buffer.concat([
      Buffer.alloc(64),
      Buffer.from(SENTINEL),
      Buffer.from([1, expected.length, ...expected]),
      Buffer.alloc(64),
    ]),
  );
  assert.deepEqual(readFuseWire(executable).values, expected);
  const bytes = fs.readFileSync(executable);
  bytes[64 + Buffer.byteLength(SENTINEL) + 2 + 5] = FuseState.DISABLE;
  fs.writeFileSync(executable, bytes);
  assert.throws(() => readFuseWire(executable), /fuse policy/);
});

test("PE signature binding hashes the exact bounded certificate table", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-pe-signature-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = path.join(root, "signed.exe");
  const bytes = Buffer.alloc(1024);
  bytes.writeUInt16LE(0x5a4d, 0);
  bytes.writeUInt32LE(0x80, 0x3c);
  bytes.write("PE\0\0", 0x80, "ascii");
  const optionalOffset = 0x80 + 24;
  bytes.writeUInt16LE(0x20b, optionalOffset);
  const certificateOffset = 512;
  const certificateSize = 32;
  bytes.writeUInt32LE(certificateOffset, optionalOffset + 112 + 32);
  bytes.writeUInt32LE(certificateSize, optionalOffset + 112 + 36);
  bytes.fill(0x5a, certificateOffset, certificateOffset + certificateSize);
  fs.writeFileSync(executable, bytes);
  assert.deepEqual(readPeSignatureBlob(executable), {
    sha256: crypto
      .createHash("sha256")
      .update(bytes.subarray(certificateOffset, certificateOffset + certificateSize))
      .digest("hex"),
    size: certificateSize,
  });
  assert.equal(readPeCertificateTable(executable).present, true);

  bytes.writeUInt32LE(0, optionalOffset + 112 + 32);
  bytes.writeUInt32LE(0, optionalOffset + 112 + 36);
  fs.writeFileSync(executable, bytes);
  assert.deepEqual(readPeCertificateTable(executable), {
    present: false,
    sha256: null,
    size: 0,
  });
  assert.throws(() => readPeSignatureBlob(executable), /no complete PE certificate table/);
});

test("inventory digests are deterministic and bind path, size, and bytes", () => {
  const one = [{ path: "a", size: 1, sha256: "a".repeat(64) }];
  assert.equal(inventorySha256(one), inventorySha256(one.map((entry) => ({ ...entry }))));
  assert.notEqual(
    inventorySha256(one),
    inventorySha256([{ ...one[0], size: 2 }]),
  );
});
