#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { TextDecoder } = require("node:util");

const MAX_INPUT_BYTES = 512 * 1024;
const CANDIDATE_RELEASE = "git-20260815-131200234-84099e4622e9";
const CURRENT_RELEASE = "git-20260814-192205642-e04672c95be2";
const PREVIOUS_ROOT = "5e04ae1791ebb31261feaf460a484f182b4db6d4";
const API_COMMIT = "88efdad94d65c09c6d3bd73e4b874db915629859";
const WEB_COMMIT = "3d2cca1dd4267a7cb0e8b54a98ae4fbbee1289d4";
const PUBLISH_ENV_SHA256 = "b67321587a29effe5be41acf8900c37026f961a4b99e7e4755978360d5c2e688";
const CANDIDATE_IMAGES = Object.freeze({
  api: "sha256:a895c29c1398c0398b6a9fccf54a50aad8c62a6804fc154b12eb3f5a2ec55cde",
  web: "sha256:1513170fcd1fdf73481474833737ff61884dc64b0e683720f670a3994299dba1",
  "media-ai": "sha256:c918e11e7b0b400dbf4e75092e64408c3c444768c5b7d141bcefa72f5a959b33",
});
const RUNTIME_IMAGES = Object.freeze({
  api: "sha256:518ce5d035c9f6ebbd100ff570981cffa822484fa1971ec8649f808134095d9c",
  "media-ai": "sha256:9863f4cfa9defef7cfe7caf018c83bc277712df3c41fcc8baead1af2cbc0ec5f",
  web: "sha256:23cfef8c359a60379d18d6736d2067c7c2a9a2bc82e08e1c37a6e53ac4745923",
  "discord-bot": "sha256:e2db68104d3cf5a4f3ce543853b81725135b14a0f40f0246179b8e59bc88b0df",
});
const SERVICES = Object.freeze([
  "proxy",
  "postgres",
  "redis",
  "api",
  "media-ai",
  "web",
  "discord-bot",
]);
const RELEASE_ID = "git-[0-9]{8}-[0-9]{9}-[a-f0-9]{12}";
const SHA = "[a-f0-9]{64}";
const IMAGE = `sha256:${SHA}`;
const FILE_IDENTITY = "[0-9]+:[0-9]+:0:0:600:1:[1-9][0-9]*:[0-9]+";
const CURRENT_ROW = "POINTER name=CURRENT state=present release=git-20260814-192205642-e04672c95be2 identity=2049:9839382:0:0:600:1:36:1786735360 sha256=7d0e4bf965799e9a5b223e17671e7808cc322a0d7809b9a4356b093cbb8ae8db env-identity=2049:9839398:0:0:600:1:3624:1786735326 env-sha256=2032cbe2ce82366b2ea52fc56857ac056183ab321c9c0f1b4eac639251dfbd7d";
const PREVIOUS_ROW = "POINTER name=PREVIOUS state=present release=git-20260814-144159610-0487ee73b42b identity=2049:9839400:0:0:600:1:36:1786735360 sha256=7677a7e1ae454478eac14cceb152c44d6124707d8f5b7f46bbadf3ddb1160451 env-identity=2049:9839380:0:0:600:1:3624:1786718520 env-sha256=7204f01f0f5d5617806d9fb4e6d0c85b9e1e9b128f3e453adb7096d2868dadc3";
const CANDIDATE_ROW = "CANDIDATE release=git-20260815-131200234-84099e4622e9 env-identity=2049:9839406:0:0:600:1:3624:1786799521 env-sha256=3746d6736a025b9138aab01c0838a6225ded0205175bb2ea979d9e436aa8b47b";
const CANDIDATE_MANIFEST_ROWS = Object.freeze({
  api: "CANDIDATE_MANIFEST release=git-20260815-131200234-84099e4622e9 service=api state=present identity=2049:9839407:0:0:600:1:737:1786799712 sha256=a33ff91db207401f33a4c0339d632129a03452b90d7bd171c5913f9855d6288c image=sha256:a895c29c1398c0398b6a9fccf54a50aad8c62a6804fc154b12eb3f5a2ec55cde available=1 regenerated=1",
  web: "CANDIDATE_MANIFEST release=git-20260815-131200234-84099e4622e9 service=web state=present identity=2049:9839408:0:0:600:1:737:1786799712 sha256=a14eb7cd7cd651e9798c9c21308530b7c8cab6e65546bd2ded038f6a2a6bfadd image=sha256:1513170fcd1fdf73481474833737ff61884dc64b0e683720f670a3994299dba1 available=1 regenerated=1",
  "media-ai": "CANDIDATE_MANIFEST release=git-20260815-131200234-84099e4622e9 service=media-ai state=present identity=2049:9839409:0:0:600:1:747:1786799713 sha256=af744723b8bbc92b89444b1e5b6eaeca2a81652989d23f8c64a720575dd481bb image=sha256:c918e11e7b0b400dbf4e75092e64408c3c444768c5b7d141bcefa72f5a959b33 available=1 regenerated=1",
});
const RUNTIME_ROWS = Object.freeze({
  proxy: "RUNTIME proxy|e2d04448b54299284a343904fbb58d232377138d024a77b179ac1f7724f5a506|sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648|release=none|restart-count=0 health=healthy restarting=false restart-policy=unless-stopped",
  postgres: "RUNTIME postgres|01f50c1dc126f73291e5fd535615065bf6fe95a3d899b8413264030307683f6d|sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777|release=none|restart-count=4 health=healthy restarting=false restart-policy=unless-stopped",
  redis: "RUNTIME redis|e633814a7df0ca6ce048f83db6a47294046e42466627e9e1c0f9c1b0cee70ff1|sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2|release=none|restart-count=0 health=healthy restarting=false restart-policy=unless-stopped",
  api: "RUNTIME api|99302402f940589012fe2aea5dce626772ae7e438783c2ecafbb6ebbe3321671|sha256:518ce5d035c9f6ebbd100ff570981cffa822484fa1971ec8649f808134095d9c|release=git-20260813-183543163-6cac8fc79a7f|restart-count=0 health=healthy restarting=false restart-policy=unless-stopped",
  "media-ai": "RUNTIME media-ai|d858f9edfff2cc684bf982ca8cf48c7abf8881f616e25d6c96e901a611f0d6e5|sha256:9863f4cfa9defef7cfe7caf018c83bc277712df3c41fcc8baead1af2cbc0ec5f|release=git-20260813-025640764-d84603426146|restart-count=0 health=healthy restarting=false restart-policy=unless-stopped",
  web: "RUNTIME web|74e77c3f82b85065e175cd9d0dade381d75eedde298983463d36d6762932a486|sha256:23cfef8c359a60379d18d6736d2067c7c2a9a2bc82e08e1c37a6e53ac4745923|release=git-20260814-150749468-50e3ee9bc6e2|restart-count=0 health=healthy restarting=false restart-policy=unless-stopped",
  "discord-bot": "RUNTIME discord-bot|07c255f2f4f08ca70c51c3b10bd82b41ba9148d1f95dfe136f5f90dc4cbe8745|sha256:e2db68104d3cf5a4f3ce543853b81725135b14a0f40f0246179b8e59bc88b0df|release=git-20260814-192205642-e04672c95be2|restart-count=0 health=healthy restarting=false restart-policy=unless-stopped",
});

function requireOne(lines, predicate, description) {
  const matches = lines.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(`${description} must appear exactly once.`);
  }
  return matches[0];
}

function verifyInventory(text) {
  if (
    typeof text !== "string" ||
    text.length === 0 ||
    text.includes("\0") ||
    text.includes("\r") ||
    !text.endsWith("\n")
  ) {
    throw new Error("Inventory must be non-empty canonical LF text.");
  }
  const lines = text.slice(0, -1).split("\n");
  if (lines.length !== 19 || lines.some((line) => line.length === 0)) {
    throw new Error("Inventory does not match the exact 19-line schema.");
  }

  const header = requireOne(
    lines,
    (line) => line.startsWith("INTERRUPTED_DEPLOY_INVENTORY root-free-kib-before="),
    "Inventory header",
  );
  if (!/^INTERRUPTED_DEPLOY_INVENTORY root-free-kib-before=[0-9]+ root-free-kib-after=[0-9]+$/.test(header)) {
    throw new Error("Inventory free-space header is invalid.");
  }

  const source = requireOne(lines, (line) => line.startsWith("SOURCE "), "Source row");
  const sourceMatch = source.match(/^SOURCE root=([a-f0-9]{40}) api=([a-f0-9]{40}) web=([a-f0-9]{40})$/);
  if (
    !sourceMatch ||
    sourceMatch[1] === PREVIOUS_ROOT ||
    sourceMatch[2] !== API_COMMIT ||
    sourceMatch[3] !== WEB_COMMIT
  ) {
    throw new Error("Source row is not the exact API/Web assembly.");
  }

  const current = requireOne(
    lines,
    (line) => line.startsWith("POINTER name=CURRENT "),
    "CURRENT row",
  );
  if (current !== CURRENT_ROW) throw new Error("CURRENT row is not exact.");

  const previous = requireOne(
    lines,
    (line) => line.startsWith("POINTER name=PREVIOUS "),
    "PREVIOUS row",
  );
  if (previous !== PREVIOUS_ROW) throw new Error("PREVIOUS row is not exact.");

  const publishEnvironment = requireOne(
    lines,
    (line) => line.startsWith("PUBLISH_ENV "),
    "Publish environment row",
  );
  if (!new RegExp(`^PUBLISH_ENV identity=${FILE_IDENTITY} sha256=${PUBLISH_ENV_SHA256}$`).test(publishEnvironment)) {
    throw new Error("Publish environment row is invalid.");
  }

  const window = requireOne(
    lines,
    (line) => line.startsWith("CANDIDATE_WINDOW "),
    "Candidate window row",
  );
  if (window !== "CANDIDATE_WINDOW start=2026-08-15T13:00:00.000Z end=2026-08-15T14:00:00.000Z matching=1 other=0") {
    throw new Error("Candidate window is not the reviewed bounded result.");
  }

  const candidate = requireOne(
    lines,
    (line) => line.startsWith("CANDIDATE release="),
    "Candidate row",
  );
  if (candidate !== CANDIDATE_ROW) {
    throw new Error("Candidate row is not exact.");
  }

  const manifestLines = lines.filter((line) => line.startsWith("CANDIDATE_MANIFEST "));
  if (manifestLines.length !== 3) throw new Error("Exactly three candidate manifests are required.");
  const manifestServices = new Set();
  for (const line of manifestLines) {
    const match = line.match(/ service=(api|web|media-ai) /);
    if (
      !match ||
      manifestServices.has(match[1]) ||
      CANDIDATE_MANIFEST_ROWS[match[1]] !== line
    ) {
      throw new Error("A candidate manifest row is invalid, duplicated, or not image-bound.");
    }
    manifestServices.add(match[1]);
  }
  if (manifestServices.size !== 3) throw new Error("Candidate manifest services are incomplete.");

  const readiness = requireOne(
    lines,
    (line) => line.startsWith("CANDIDATE_READINESS "),
    "Candidate readiness row",
  );
  if (readiness !== `CANDIDATE_READINESS release=${CANDIDATE_RELEASE} manifests=3 ready-images=3 state=immutable-build-complete`) {
    throw new Error("Candidate readiness is not complete.");
  }

  const runtimeLines = lines.filter((line) => line.startsWith("RUNTIME "));
  if (runtimeLines.length !== SERVICES.length) throw new Error("Exactly seven runtime rows are required.");
  const runtimeServices = new Set();
  for (const line of runtimeLines) {
    const match = line.match(/^RUNTIME (proxy|postgres|redis|api|media-ai|web|discord-bot)\|/);
    if (!match || runtimeServices.has(match[1]) || RUNTIME_ROWS[match[1]] !== line) {
      throw new Error("A runtime row is invalid or duplicated.");
    }
    runtimeServices.add(match[1]);
  }
  if (runtimeServices.size !== SERVICES.length) throw new Error("Runtime services are incomplete.");

  requireOne(
    lines,
    (line) => line === "INTERRUPTED_DEPLOY_INVENTORY_COMPLETE mutation=none",
    "Inventory completion row",
  );
  return { candidateRelease: CANDIDATE_RELEASE };
}

function main() {
  try {
    if (process.argv.length !== 2) throw new Error("No arguments are accepted.");
    const bytes = fs.readFileSync(0);
    if (bytes.length === 0 || bytes.length > MAX_INPUT_BYTES) {
      throw new Error("Inventory byte size is outside policy.");
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const result = verifyInventory(text);
    process.stdout.write(`INTERRUPTED FULL RESUME INVENTORY VERIFIED release=${result.candidateRelease}\n`);
  } catch (error) {
    process.stderr.write(`INTERRUPTED FULL RESUME INVENTORY BLOCKED: ${error.message}\n`);
    process.exitCode = 75;
  }
}

if (require.main === module) main();

module.exports = {
  API_COMMIT,
  CANDIDATE_IMAGES,
  CANDIDATE_RELEASE,
  CURRENT_RELEASE,
  MAX_INPUT_BYTES,
  RUNTIME_IMAGES,
  SERVICES,
  WEB_COMMIT,
  verifyInventory,
};
