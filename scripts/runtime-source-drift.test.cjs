"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { syncBrandIcons } = require("./sync-brand-icons.cjs");

const repoRoot = path.resolve(__dirname, "..");
const connectorAccessToken = "runtime-source-drift-connector-token";

const proxies = [
  {
    label: "Electron main process",
    rootFile: path.join(repoRoot, "main.cjs"),
    canonicalFile: path.join(
      repoRoot,
      "apps",
      "desktop",
      "electron",
      "main.cjs",
    ),
    target: "./apps/desktop/electron/main.cjs",
    safeToRequire: false,
  },
  {
    label: "Telemetry bridge",
    rootFile: path.join(repoRoot, "telemetryBridge.cjs"),
    canonicalFile: path.join(
      repoRoot,
      "apps",
      "desktop",
      "electron",
      "telemetryBridge.cjs",
    ),
    target: "./apps/desktop/electron/telemetryBridge.cjs",
    safeToRequire: true,
  },
  {
    label: "Map coordinate utilities",
    rootFile: path.join(repoRoot, "coordinate-utils.cjs"),
    canonicalFile: path.join(
      repoRoot,
      "apps",
      "desktop",
      "electron",
      "map-engine",
      "coordinate-utils.cjs",
    ),
    target: "./apps/desktop/electron/map-engine/coordinate-utils.cjs",
    safeToRequire: true,
  },
];

function normalizeContent(value) {
  return value.replace(/\r\n/g, "\n").trim();
}

test("root runtime files contain only pure canonical proxies", () => {
  for (const proxy of proxies) {
    const expected = `"use strict";\n\nmodule.exports = require("${proxy.target}");`;
    assert.equal(
      normalizeContent(fs.readFileSync(proxy.rootFile, "utf8")),
      expected,
      `${proxy.label} root copy must not contain runtime logic`,
    );
  }
});

test("safe root runtime proxies return the canonical module implementation", () => {
  for (const proxy of proxies.filter((entry) => entry.safeToRequire)) {
    assert.equal(
      require(proxy.rootFile),
      require(proxy.canonicalFile),
      `${proxy.label} root proxy must resolve to canonical implementation`,
    );
  }
});

test("Docker build context excludes credentials, archives, and local runtime data", () => {
  const patterns = fs
    .readFileSync(path.join(repoRoot, ".dockerignore"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\/$/, ""));

  for (const requiredPattern of [
    ".artifacts",
    ".tools",
    ".codex",
    ".codex-*",
    ".deploy-safety-backups",
    "/.scoped-release-backup-operator-*",
    ".worktrees",
    ".tmp-*",
    ".tmp_*",
    "tmp-*",
    "tmp_*",
    "_cleanup-archive",
    "backups",
    "deploy-artifacts",
    "deploy-backups",
    "production-backup-archive",
    "logs",
    "output",
    "vlc-help.txt",
    "docs/widget-style-previews",
    "recordings",
    "**/.env*",
    "**/*.pem",
    "**/*.key",
    "**/*.p12",
    "**/*.pfx",
    "**/*.crt",
    "**/*.bak",
    "**/*.dump",
    "**/*.sql",
    "**/*.tar",
    "**/*.tar.*",
    "**/*.zip",
    "**/scratch",
    "**/scratch/**",
    "**/user-data",
    "**/user-data/**",
    "apps/arenzyra-web/.arenzyra-data",
    "apps/arenzyra-web/artifacts",
    "apps/arenzyra-web/.next-playwright",
    "apps/arenzyra-web/public/downloads",
    "apps/arenzyra-web/.tmp",
    "apps/arenzyra-web/test-results",
  ]) {
    assert.ok(
      patterns.includes(requiredPattern),
      `${requiredPattern} must not enter Docker build contexts.`,
    );
  }

  assert.ok(patterns.includes("!**/.env.example"));
  assert.ok(patterns.includes("!**/.env.*.example"));
  assert.equal(
    patterns.some(
      (pattern) =>
        pattern.startsWith("!") &&
        pattern.includes(".env") &&
        !pattern.endsWith(".example"),
    ),
    false,
    "Only documented environment examples may be re-included.",
  );
});

test("brand sync safely retains bundled package inputs when the optional web repo is absent", () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-brand-sync-"),
  );
  const iconTarget = path.join(temporaryRoot, "desktop", "icon.ico");
  const markTarget = path.join(temporaryRoot, "desktop", "default-team.png");
  const desktopMarkTarget = path.join(
    temporaryRoot,
    "desktop",
    "arenzyra-mark.png",
  );

  try {
    fs.mkdirSync(path.dirname(iconTarget), { recursive: true });
    fs.writeFileSync(iconTarget, "bundled-icon");
    fs.writeFileSync(markTarget, "bundled-mark");
    fs.writeFileSync(desktopMarkTarget, "bundled-desktop-mark");

    const result = syncBrandIcons({
      sourceIcon: path.join(temporaryRoot, "missing", "favicon.ico"),
      sourceMark: path.join(temporaryRoot, "missing", "icon.png"),
      sourceDesktopMark: path.join(
        temporaryRoot,
        "missing",
        "arenzyra-mark.png",
      ),
      targetIcons: [iconTarget],
      targetMarks: [markTarget],
      targetDesktopMarks: [desktopMarkTarget],
      log: () => {},
      warn: () => {},
    });

    assert.deepEqual(result.icons, { copied: [], retained: [iconTarget] });
    assert.deepEqual(result.marks, { copied: [], retained: [markTarget] });
    assert.deepEqual(result.desktopMarks, {
      copied: [],
      retained: [desktopMarkTarget],
    });
    assert.equal(fs.readFileSync(iconTarget, "utf8"), "bundled-icon");
    assert.equal(fs.readFileSync(markTarget, "utf8"), "bundled-mark");
    assert.equal(
      fs.readFileSync(desktopMarkTarget, "utf8"),
      "bundled-desktop-mark",
    );
  } finally {
    const resolvedTemporaryRoot = path.resolve(temporaryRoot);
    assert.ok(resolvedTemporaryRoot.startsWith(path.resolve(os.tmpdir())));
    fs.rmSync(resolvedTemporaryRoot, { recursive: true, force: true });
  }
});

test("unknown scoped release backups remain outside Git and Docker inputs", () => {
  for (const ignoreFile of [".gitignore", ".dockerignore"]) {
    const lines = fs
      .readFileSync(path.join(repoRoot, ignoreFile), "utf8")
      .split(/\r?\n/);
    assert.equal(
      lines.filter(
        (line) => line === "/.scoped-release-backup-operator-*/",
      ).length,
      1,
      ignoreFile,
    );
  }
});

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function waitFor(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for connector state.");
}

async function waitForAsync(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for asynchronous connector state.");
}

test(
  "root PCOB connector rejects partial-name maps and accepts bounded aliases",
  { timeout: 15_000 },
  async () => {
    const connectorPort = await getFreePort();
    const connector = spawn(process.execPath, [path.join(repoRoot, "ob.js")], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(connectorPort),
        FORWARD_ENABLE: "false",
        OBSERVER_FORWARD_ENABLE: "false",
        PCOB_RAW_EVENT_CAPTURE_ENABLE: "false",
        OBTOOLS_VERBOSE_LOG: "false",
        ARENZYRA_FORCE_MAP_KEY: "",
        ARENZYRA_MAP_KEY: "",
        OBSERVER_MAP_NAME: "",
        OBSERVER_MAP_KEY: "",
        MATCH_MAP_NAME: "",
        MAP_NAME: "",
        ARENZYRA_PCOB_CONNECTOR_TOKEN: connectorAccessToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    try {
      let stdout = "";
      connector.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      await waitFor(() => stdout.includes("ObTools server listening"));

      const publishMap = async (mapName) => {
        const response = await fetch(
          `http://127.0.0.1:${connectorPort}/totalmessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ allinfo: { mapName } }),
          },
        );
        assert.equal(response.ok, true);
        await waitForAsync(async () => {
          const allInfoResponse = await fetch(
            `http://127.0.0.1:${connectorPort}/getallinfo`,
            { headers: { "X-Arenzyra-Connector-Token": connectorAccessToken } },
          );
          const allInfo = await allInfoResponse.json();
          return allInfo?.allinfo?.mapName === mapName;
        });
      };

      await publishMap("SUPERERANGELCLONE");
      const rejectedOverlay = await fetch(
        `http://127.0.0.1:${connectorPort}/widget/map-overlay`,
        { headers: { "X-Arenzyra-Connector-Token": connectorAccessToken } },
      ).then((response) => response.json());
      assert.equal(rejectedOverlay.map, null);

      await publishMap("MATCH_NEON_MAIN_VARIANT");
      const acceptedOverlay = await fetch(
        `http://127.0.0.1:${connectorPort}/widget/map-overlay`,
        { headers: { "X-Arenzyra-Connector-Token": connectorAccessToken } },
      ).then((response) => response.json());
      assert.equal(acceptedOverlay.map?.mapName, "RONDO");
      assert.equal(acceptedOverlay.map?.coordinateSystem, "WORLD");

      const supportedMaps = [
        "ERANGEL",
        "MIRAMAR",
        "SANHOK",
        "VIKENDI",
        "LIVIK",
        "LIVIK_AFTERMATH",
        "KARAKIN",
        "NUSA",
        "RONDO",
        "TAEGO",
        "DESTON",
        "PARAMO",
        "HAVEN",
      ];
      for (const mapName of supportedMaps) {
        await publishMap(mapName);
        const overlay = await fetch(
          `http://127.0.0.1:${connectorPort}/widget/map-overlay`,
          { headers: { "X-Arenzyra-Connector-Token": connectorAccessToken } },
        ).then((response) => response.json());
        assert.equal(overlay.map?.coordinateSystem, "WORLD", mapName);
      }
    } finally {
      const connectorExit =
        connector.exitCode !== null
          ? Promise.resolve(true)
          : new Promise((resolve) =>
              connector.once("exit", () => resolve(true)),
            );
      if (connector.exitCode === null) {
        connector.kill();
      }
      const exited = await Promise.race([
        connectorExit,
        new Promise((resolve) => setTimeout(() => resolve(false), 1_000)),
      ]);
      if (!exited && connector.exitCode === null) {
        connector.kill("SIGKILL");
      }
    }
  },
);

test(
  "root PCOB connector forwards same-route bursts in strict FIFO order",
  { timeout: 15_000 },
  async () => {
    const connectorPort = await getFreePort();
    const receivedSequences = [];
    let activeRequests = 0;
    let maximumConcurrentRequests = 0;
    const receiver = http.createServer((request, response) => {
      const chunks = [];
      activeRequests += 1;
      maximumConcurrentRequests = Math.max(
        maximumConcurrentRequests,
        activeRequests,
      );
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        receivedSequences.push(payload.sequence);
        setTimeout(() => {
          activeRequests -= 1;
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/json");
          response.end('{"ok":true}');
        }, 10);
      });
    });
    await new Promise((resolve, reject) => {
      receiver.once("error", reject);
      receiver.listen(0, "127.0.0.1", resolve);
    });
    const receiverAddress = receiver.address();
    const connector = spawn(process.execPath, [path.join(repoRoot, "ob.js")], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(connectorPort),
        FORWARD_ENABLE: "true",
        FORWARD_BASE_URL: `http://127.0.0.1:${receiverAddress.port}`,
        OBSERVER_FORWARD_ENABLE: "false",
        PCOB_RAW_EVENT_CAPTURE_ENABLE: "false",
        OBTOOLS_VERBOSE_LOG: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    try {
      let stdout = "";
      connector.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      await waitFor(() => stdout.includes("ObTools server listening"));

      const expectedSequences = Array.from(
        { length: 24 },
        (_, index) => index + 1,
      );
      const responses = await Promise.all(
        expectedSequences.map((sequence) =>
          fetch(`http://127.0.0.1:${connectorPort}/setkillinfo`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sequence }),
          }),
        ),
      );
      assert.equal(
        responses.every((response) => response.ok),
        true,
      );
      await waitFor(
        () =>
          receivedSequences.length === expectedSequences.length &&
          activeRequests === 0,
      );

      assert.deepEqual(receivedSequences, expectedSequences);
      assert.equal(maximumConcurrentRequests, 1);
    } finally {
      const connectorExit =
        connector.exitCode !== null
          ? Promise.resolve(true)
          : new Promise((resolve) =>
              connector.once("exit", () => resolve(true)),
            );
      if (connector.exitCode === null) {
        connector.kill();
      }
      const exited = await Promise.race([
        connectorExit,
        new Promise((resolve) => setTimeout(() => resolve(false), 1_000)),
      ]);
      if (!exited && connector.exitCode === null) {
        connector.kill("SIGKILL");
      }
      receiver.closeAllConnections?.();
      await new Promise((resolve) => receiver.close(resolve));
    }
  },
);
