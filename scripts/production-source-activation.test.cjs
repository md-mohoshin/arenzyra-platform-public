"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");
const read = (relative) =>
  fs.readFileSync(path.join(repositoryRoot, relative), "utf8");

const activation = read("scripts/activate-production-reviewed-checkout.sh");
const bridge = read(
  "scripts/activate-production-reviewed-checkout-4d18-bridge.sh",
);
const bootstrap = read("scripts/bootstrap-production-reviewed-checkout.sh");
const dispatcher = read("scripts/production-reviewed-entrypoint.sh");
const windowsPublisher = read(
  "scripts/publish-production-reviewed-source.ps1",
);
const releaseMetadata = read("scripts/create-publish-release-metadata.cjs");
const retiredWidgetCompatibilityGate = read(
  "scripts/verify-production-retired-widget-compatibility.sh",
);
const publishGuide = read("infra/PUBLISH.md");

test("normal source activation locks before repeating exact current assembly verification", () => {
  const branch = dispatcher.slice(
    dispatcher.indexOf("  source-activate)"),
    dispatcher.indexOf("  source-inventory)"),
  );
  assert.match(branch, /\[ "\$#" -eq 7 \]/);
  assert.match(branch, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(branch, /\^\[0-9a-f\]\{64\}\$/);
  const lock = branch.indexOf("acquire_source_activation_lock");
  const root = branch.lastIndexOf("verify_repository ROOT");
  const nested = branch.indexOf("require_nested_assembly", root);
  const exec = branch.indexOf("activate-production-reviewed-checkout.sh", nested);
  assert.ok(lock >= 0 && lock < root && root < nested && nested < exec);
});

test("activation retains descriptor 8 through prepare, forward history, activation, and inventories", () => {
  assert.match(activation, /ARENZYRA_DEPLOY_LOCK_INHERITED/);
  assert.match(activation, /production_verify_lock_descriptor/);
  assert.match(activation, /merge-base --is-ancestor/);
  assert.match(activation, /verify_assembly "\$ROOT_PATH" "\$current_root"/);
  const firstInventory = activation.indexOf("run_current_inventory\n");
  const prepare = activation.indexOf("run_bootstrap prepare", firstInventory);
  const forward = activation.indexOf("verify_forward_assembly", prepare);
  const secondInventory = activation.indexOf("run_current_inventory", forward);
  const activate = activation.indexOf("run_bootstrap activate", secondInventory);
  const activeVerification = activation.indexOf(
    'verify_assembly "$ROOT_PATH" "$target_root"',
    activate,
  );
  const finalInventory = activation.indexOf(
    "production-source-inventory.sh",
    activeVerification,
  );
  assert.ok(
    firstInventory >= 0 &&
      firstInventory < prepare &&
      prepare < forward &&
      forward < secondInventory &&
      secondInventory < activate &&
      activate < activeVerification &&
      activeVerification < finalInventory,
  );
  assert.doesNotMatch(activation, /docker|compose|systemctl|rm\s+-rf/);
});

test("activation accepts only one exact no-mount three-archive incoming set", () => {
  assert.match(activation, /api\.git\.tar\\nroot\.git\.tar\\nweb\.git\.tar/);
  assert.match(activation, /0:0:600:1/);
  assert.match(activation, /1073741824/);
  assert.match(activation, /findmnt -rn -o TARGET/);
  assert.match(activation, /require_atomic_activation_filesystem/);
  assert.match(
    activation,
    /root_device" = "\$archive_device"/,
  );
  assert.match(activation, /release staging or archive already exists/);
  assert.match(activation, /ARENZYRA_ROOT_REPOSITORY_SHA256="\$root_hash"/);
  assert.match(activation, /ARENZYRA_API_REPOSITORY_SHA256="\$api_hash"/);
  assert.match(activation, /ARENZYRA_WEB_REPOSITORY_SHA256="\$web_hash"/);
  assert.match(bootstrap, /prior source preserved at/);
});

test("both activation paths re-attest the current Root before prepare and atomic swap", () => {
  for (const [label, source, inventoryToken, prepareToken, activateToken] of [
    [
      "normal",
      activation,
      "run_current_inventory",
      "run_bootstrap prepare",
      "run_bootstrap activate",
    ],
    [
      "4d18 bridge",
      bridge,
      "current-release-inventory",
      "run_current_bootstrap prepare",
      "run_current_bootstrap activate",
    ],
  ]) {
    const rootAttestation = 'require_safe_parent "$ROOT_PATH"\nrequire_no_mounts "$ROOT_PATH"';
    const firstAttestation = source.indexOf(rootAttestation);
    const firstInventory = source.indexOf(inventoryToken, firstAttestation);
    const prepare = source.indexOf(prepareToken, firstInventory);
    const secondAttestation = source.indexOf(rootAttestation, prepare);
    const secondInventory = source.indexOf(inventoryToken, secondAttestation);
    const finalAttestation = source.indexOf(rootAttestation, secondInventory);
    const activate = source.indexOf(activateToken, finalAttestation);
    assert.ok(
      firstAttestation >= 0 &&
        firstAttestation < firstInventory &&
        firstInventory < prepare &&
        prepare < secondAttestation &&
        secondAttestation < secondInventory &&
        secondInventory < finalAttestation &&
        finalAttestation < activate,
      `${label} must attest the physical current Root at every activation boundary`,
    );
  }
});

test("the one-time bridge is pinned to 4d18 and self-audits against staged target bytes", () => {
  assert.match(
    bridge,
    /COMPATIBLE_CURRENT_ROOT="4d18a9ad56d738e2992d0ca7564c4f8d553865a8"/,
  );
  assert.match(
    bridge,
    /COMPATIBLE_CURRENT_API="428ca9d6dd20c065314a1787f5de92bc4f9d8646"/,
  );
  assert.match(
    bridge,
    /COMPATIBLE_CURRENT_WEB="2ee104f6fcc22ef0b37a5c1f8b0b42df2ad076aa"/,
  );
  assert.match(bridge, /current_file scripts\/acquire-production-deploy-lock\.sh/);
  assert.match(bridge, /current_file scripts\/bootstrap-production-reviewed-checkout\.sh/);
  assert.match(bridge, /production-reviewed-entrypoint\.sh/);
  assert.match(
    bridge,
    /target_root}:scripts\/activate-production-reviewed-checkout-4d18-bridge\.sh/,
  );
  assert.match(bridge, /actual" = "\$expected_bridge_hash/);
  const lock = bridge.indexOf("load_current_lock");
  const firstInventory = bridge.indexOf("current-release-inventory", lock);
  const prepare = bridge.indexOf("run_current_bootstrap prepare", firstInventory);
  const selfAudit = bridge.indexOf("verify_executed_bridge", prepare);
  const activate = bridge.indexOf("run_current_bootstrap activate", selfAudit);
  const finalInventory = bridge.lastIndexOf("source-inventory");
  assert.ok(
    lock >= 0 &&
      lock < firstInventory &&
      firstInventory < prepare &&
      prepare < selfAudit &&
      selfAudit < activate &&
      activate < finalInventory,
  );
  assert.equal(Buffer.from(bridge).includes(13), false);
});

test("Windows publisher packages clean forward-only repositories and no-overwrite transfers", () => {
  assert.match(
    windowsPublisher,
    /ValidateSet\("Package", "Transfer", "Activate", "SelfTest"\)/,
  );
  assert.match(windowsPublisher, /status", "--porcelain=v1", "--untracked-files=all"/);
  assert.match(windowsPublisher, /merge-base", "--is-ancestor"/);
  assert.match(
    windowsPublisher,
    /CompatibilityApiCommit = "428ca9d6dd20c065314a1787f5de92bc4f9d8646"/,
  );
  assert.match(
    windowsPublisher,
    /CompatibilityWebCommit = "2ee104f6fcc22ef0b37a5c1f8b0b42df2ad076aa"/,
  );
  assert.match(windowsPublisher, /Assert-CompatibilityInputs/);
  assert.match(windowsPublisher, /\[IO\.Path\]::IsPathRooted\(\$gitPath\)/);
  assert.match(windowsPublisher, /bundle target already exists; source bundles are no-overwrite/);
  assert.match(windowsPublisher, /\[ ! -e "\$incoming" \] && \[ ! -L "\$incoming" \]/);
  assert.match(windowsPublisher, /root\.git\.tar\\nroot\.git\.tar|api\.git\.tar\\nroot\.git\.tar\\nweb\.git\.tar/);
  assert.match(windowsPublisher, /sha256sum -c/);
  assert.match(windowsPublisher, /SftpExecutable/);
  assert.match(windowsPublisher, /"-b", "-"/);
  assert.match(
    windowsPublisher,
    /\$sftpLines\.Add\("mkdir \/opt\/arenzyra-release-incoming\/\$release"\)/,
  );
  assert.match(windowsPublisher, /\$sftpLines\.Add\("chmod 0700/);
  assert.match(windowsPublisher, /\$sftpLines\.Add\("chmod 0600/);
  assert.doesNotMatch(windowsPublisher, /ScpExecutable|scp\.exe/);
  assert.doesNotMatch(windowsPublisher, /Remove-Item\s+-Recurse|git\s+clean/);
});

test("reviewed source packaging and activation preserve the committed compatibility gate", () => {
  assert.match(releaseMetadata, /defaultIncludedPaths[\s\S]*?"scripts"/);
  assert.match(
    retiredWidgetCompatibilityGate,
    /inspect-production-retired-widget-inventory\.sh[\s\S]*--require-deploy-compatible/,
  );
  assert.match(
    windowsPublisher,
    /fetch", "--no-tags", "--force",[\s\S]*\$Repository, "\$\{TargetCommit\}:refs\/heads\/reviewed"/,
  );
  assert.match(
    bootstrap,
    /clone --no-local "\$work\/repositories\/root\.git" "\$checkout"[\s\S]*checkout --detach "\$ARENZYRA_REVIEWED_ROOT_COMMIT"/,
  );
  assert.match(publishGuide, /Strict keys `style\.focal`/);
  assert.match(
    publishGuide,
    /Grandfathered keys `team-status` and `kill-feed` permit at most one active/,
  );
  assert.match(
    publishGuide,
    /inventory gate itself grants or reauthorizes no capability/,
  );
  assert.match(
    publishGuide,
    /already-existing, active legacy UUID,\s+generation-0 `team-status` and `kill-feed` capabilities/,
  );
  assert.match(
    publishGuide,
    /generation-1-or-newer or `wgt_` capability[\s\S]*remains non-authorizing/,
  );
  assert.match(
    publishGuide,
    /explicit\s+`isApproved=false` row also remains non-authorizing/,
  );
  assert.match(
    publishGuide,
    /New issuance, rotation, and approval enabling\s+\(`isApproved=true`\) remain denied/,
  );
  assert.match(
    publishGuide,
    /Monotonic unapproval\/revocation\s+\(`isApproved=false`\) remains permitted and is non-authorizing/,
  );
});

test("Windows publisher prevents PowerShell CRLF transport and pins strict OpenSSH", () => {
  assert.match(windowsPublisher, /StandardInput\.BaseStream\.Write/);
  assert.match(windowsPublisher, /Convert\]::ToBase64String/);
  assert.match(windowsPublisher, /base64 -d/);
  assert.match(windowsPublisher, /Payload\.Length -gt 16384/);
  assert.match(windowsPublisher, /remote payload contains a carriage return/);
  assert.match(windowsPublisher, /TemporaryPattern = "\/run\/arenzyra-source-entry\.XXXXXXXX"/);
  assert.match(windowsPublisher, /sha256sum/);
  assert.match(windowsPublisher, /compatibility bridge contains CR bytes/);
  assert.match(windowsPublisher, /"hash-object", "--stdin"/);
  assert.match(windowsPublisher, /Get-BytesSha256 \$payload/);
  assert.match(windowsPublisher, /SOURCE_TRANSPORT_SELF_TEST_OK args=11/);
  assert.match(windowsPublisher, /\[ "\$#" -eq 11 \]/);
  for (const option of [
    "BatchMode=yes",
    "CheckHostIP=yes",
    "ClearAllForwardings=yes",
    "ConnectionAttempts=1",
    "ConnectTimeout=10",
    "ForwardAgent=no",
    "GlobalKnownHostsFile=NUL",
    "IdentitiesOnly=yes",
    "PermitLocalCommand=no",
    "StrictHostKeyChecking=yes",
    "UserKnownHostsFile=",
  ]) {
    assert.match(windowsPublisher, new RegExp(option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(windowsPublisher, /Get-Content[^\n]*\|[^\n]*ssh/i);
});

test("runbook documents first-use trust, continuous lock, inventories, and preserved source", () => {
  assert.match(publishGuide, /Reviewed source transfer and activation from Windows/);
  assert.match(
    publishGuide,
    /source-20260815-widget-latency-01[\s\S]*must not be deleted or reused/,
  );
  assert.match(
    publishGuide,
    /source-20260815-widget-latency-02[\s\S]*verified and deleted through the reviewed source-retention[\s\S]*must never be reused/,
  );
  assert.match(
    publishGuide,
    /`source-20260815-widget-latency-03` evidence remains preserved/,
  );
  assert.match(
    publishGuide,
    /successfully activated\s+`source-20260815-widget-latency-04`[\s\S]*preserve its incoming, staging, archive, and source/,
  );
  assert.match(
    publishGuide,
    /successfully activated\s+`source-20260815-widget-latency-05`[\s\S]*preserve its incoming, staging, archive, and source/,
  );
  assert.match(
    publishGuide,
    /successfully\s+activated\s+`source-20260815-widget-latency-06`[\s\S]*preserve its incoming, staging, archive, and source/,
  );
  assert.match(
    publishGuide,
    /\$sourceRelease = 'source-20260815-widget-latency-07'/,
  );
  for (const [variable, commit] of [
    ["currentRoot", "d6390f2abb37f87e99988c49db31216c6187ffe1"],
    ["currentApi", "88efdad94d65c09c6d3bd73e4b874db915629859"],
    ["currentWeb", "3d2cca1dd4267a7cb0e8b54a98ae4fbbee1289d4"],
    ["targetApi", "88efdad94d65c09c6d3bd73e4b874db915629859"],
    ["targetWeb", "3d2cca1dd4267a7cb0e8b54a98ae4fbbee1289d4"],
  ]) {
    assert.match(publishGuide, new RegExp(`\\$${variable} = '${commit}'`));
  }
  assert.match(publishGuide, /4d18a9ad56d738e2992d0ca7564c4f8d553865a8/);
  assert.match(publishGuide, /428ca9d6dd20c065314a1787f5de92bc4f9d8646/);
  assert.match(publishGuide, /2ee104f6fcc22ef0b37a5c1f8b0b42df2ad076aa/);
  assert.match(publishGuide, /38cca5de4670ca123a4004e9fd6dfec6ccb48bcb/);
  assert.match(publishGuide, /descriptor 8/);
  assert.match(publishGuide, /clean forward-ancestry checks/);
  assert.match(publishGuide, /source-inventory/);
  assert.match(publishGuide, /prior source at\s+`\/opt\/arenzyra-source-archives\/<release>`/);
  assert.match(publishGuide, /Never replace these invocations with `Get-Content \.\.\. \| ssh`/);
  assert.match(publishGuide, /no pre-activation\s+remote shell mutates `\/opt`/);
  assert.match(publishGuide, /production_entry source-activate/);
  assert.match(publishGuide, /root@188\.245\.47\.45/);
  assert.match(publishGuide, /C:\\Users\\mohos\\\.ssh\\id_ed25519/);
  assert.match(publishGuide, /C:\\Users\\mohos\\\.ssh\\known_hosts/);
  assert.match(publishGuide, /Legacy SCP transport[\s\S]*not\s+used/);
  for (const option of [
    "-F NUL",
    "BatchMode=yes",
    "CheckHostIP=yes",
    "ClearAllForwardings=yes",
    "ConnectionAttempts=1",
    "ConnectTimeout=10",
    "ForwardAgent=no",
    "GlobalKnownHostsFile=NUL",
    "IdentitiesOnly=yes",
    "PermitLocalCommand=no",
    "StrictHostKeyChecking=yes",
    "UserKnownHostsFile",
    "-T",
  ]) {
    assert.match(
      publishGuide,
      new RegExp(option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
});
