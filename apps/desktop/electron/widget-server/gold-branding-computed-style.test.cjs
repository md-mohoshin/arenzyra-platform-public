"use strict";

const fs = require("node:fs");
const path = require("node:path");

const RESULT_MARKER = "ARENZYRA_GOLD_COMPUTED_STYLE=";
const WIDGET_SERVER_ROOT = __dirname;

function readPublicAsset(fileName) {
  return fs.readFileSync(
    path.join(WIDGET_SERVER_ROOT, "public", fileName),
    "utf8",
  );
}

function safeInlineScript(source) {
  return String(source).replace(/<\/script/gi, "<\\/script");
}

function buildFocusedHtml({ widgetKey, branding }) {
  const css = readPublicAsset("gold-focused-widget.css");
  const brandingClient = safeInlineScript(
    readPublicAsset("widget-branding-client.js"),
  );
  const bootstrap = JSON.stringify({
    widgetKey,
    organization: { branding },
    branding: {
      primaryColor: "#00e5ff",
      secondaryColor: "#2fc600",
      panel: "#fe293d",
    },
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html>
  <head><style>${css}</style></head>
  <body>
    <main class="gold-focused-root" id="gold-focused-root">
      <header class="gold-roster-header" id="gold-roster-header"></header>
      <article class="gold-roster-player" id="gold-roster-row" style="--health:50%;--row-delay:0ms">
        <div class="gold-player-copy"></div>
        <div class="gold-roster-portrait"></div>
        <div class="gold-health-block"><span><i id="gold-health-fill"></i></span></div>
      </article>
      <section class="gold-player-stats">
        <div class="gold-player-stat-row">
          <span></span><i id="gold-stat-gold"></i>
        </div>
      </section>
    </main>
    <script>window.__ARENZYRA_LOCAL_WIDGET_BOOTSTRAP__ = ${bootstrap};</script>
    <script>${brandingClient}</script>
  </body>
</html>`;
}

function buildGoldRingHtml({ branding }) {
  const css = readPublicAsset("obs-zone-closing-widget.css");
  const zoneClient = safeInlineScript(
    readPublicAsset("obs-zone-closing-widget.js"),
  );
  const bootstrap = JSON.stringify({
    widgetKey: "next-zone-update-gold-ring",
    displayMode: "next-zone-update",
    styleVariant: "gold-ring",
    revealWindowMs: 20000,
    wsPath: "/ws",
    organization: { branding },
    branding: {
      primaryColor: "#00e5ff",
      secondaryColor: "#2fc600",
      panel: "#fe293d",
    },
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html>
  <head><style>${css}</style></head>
  <body>
    <main class="obs-next-zone-update-root obs-next-zone-update-root--gold-ring" id="next-zone-update-root" data-style="gold-ring">
      <section class="next-zone-update-card next-zone-update-card--gold-ring">
        <div class="next-zone-update-gold-face" id="gold-ring-face">
          <div class="next-zone-update-gold-ring"></div>
          <strong class="next-zone-update-gold-metric" id="next-zone-update-alive">--</strong>
          <span class="next-zone-update-gold-metric-label" id="next-zone-update-metric-label">ALIVE</span>
        </div>
        <div class="next-zone-update-gold-footer" id="gold-ring-footer">
          <span id="next-zone-update-countdown">--:--</span>
          <strong><span id="next-zone-update-phase">STAGE --</span></strong>
        </div>
        <div class="next-zone-update-status" id="next-zone-update-status">WS OFFLINE</div>
      </section>
      <div class="next-zone-update-progress"><span id="next-zone-update-progress"></span></div>
    </main>
    <script>
      window.__ARENZYRA_LOCAL_WIDGET_BOOTSTRAP__ = ${bootstrap};
      window.WebSocket = class FakeWebSocket {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSED = 3;
        constructor() { this.readyState = 1; }
        addEventListener() {}
        close() { this.readyState = 3; }
      };
    </script>
    <script>${zoneClient}</script>
  </body>
</html>`;
}

function buildGoldRingMotionHtml() {
  const css = readPublicAsset("obs-zone-closing-widget.css");
  return `<!doctype html>
<html>
  <head>
    <style>${css}</style>
    <style>
      /* Headless Electron advertises reduced motion. Force only the playing
         phase back to production timing so Chromium can exercise the actual
         interpolation; preparing/reduced still use the production rules. */
      .obs-next-zone-update-root--gold-ring[data-gold-obs-motion="playing"] {
        transition:
          opacity 650ms cubic-bezier(0.16, 1, 0.3, 1),
          transform 650ms cubic-bezier(0.16, 1, 0.3, 1),
          filter 160ms ease !important;
      }
    </style>
  </head>
  <body>
    <main
      class="obs-next-zone-update-root obs-next-zone-update-root--gold-ring is-visible"
      id="next-zone-update-root"
      data-style="gold-ring"
      data-gold-obs-motion="playing"
    ></main>
  </body>
</html>`;
}

async function computedSnapshot(window, html, selectors) {
  await window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
  );
  return window.webContents.executeJavaScript(`(() => {
    const output = {};
    const selectors = ${JSON.stringify(selectors)};
    for (const [name, selector] of Object.entries(selectors)) {
      const element = document.querySelector(selector);
      const style = window.getComputedStyle(element);
      output[name] = {
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        color: style.color,
      };
    }
    const root = document.querySelector("#gold-focused-root, #next-zone-update-root");
    const rootStyle = window.getComputedStyle(root);
    output.tokens = {
      goldSolid: rootStyle.getPropertyValue("--gold-solid").trim(),
      nextZonePrimary: rootStyle.getPropertyValue("--next-zone-primary").trim(),
      nextZonePanel: rootStyle.getPropertyValue("--next-zone-panel").trim(),
    };
    return output;
  })()`);
}

async function goldRingMotionSnapshot(window) {
  await window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(buildGoldRingMotionHtml())}`,
  );
  return window.webContents.executeJavaScript(`(async () => {
    const root = document.getElementById("next-zone-update-root");
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay));
    const read = () => {
      const style = getComputedStyle(root);
      return {
        opacity: Number(style.opacity),
        transform: style.transform,
        transitionDuration: style.transitionDuration,
      };
    };

    await frame();
    const initial = read();
    root.classList.remove("is-visible");
    root.dataset.goldObsMotion = "preparing";
    await frame();
    const preparingFrameOne = read();
    await frame();
    const preparingFrameTwo = read();
    root.dataset.goldObsMotion = "playing";
    root.classList.add("is-visible");
    await frame();
    await wait(80);
    const entering = read();
    await wait(700);
    const entered = read();

    root.classList.remove("is-visible");
    root.dataset.goldObsMotion = "preparing";
    await frame();
    await frame();
    root.dataset.goldObsMotion = "reduced";
    root.classList.add("is-visible");
    await frame();
    const reduced = read();

    return {
      initial,
      preparingFrameOne,
      preparingFrameTwo,
      entering,
      entered,
      reduced,
    };
  })()`);
}

async function runElectronAudit() {
  const { app, BrowserWindow } = require("electron");
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    width: 1920,
    height: 1080,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const conflictingBranding = {
    primaryColor: "#FFF",
    primary: "#123456",
    secondaryColor: "#00e5ff",
    accent: "#2fc600",
    panel: "#fe293d",
    backgroundSolid: "#38bdf8",
  };
  const invalidBranding = {
    primaryColor: "url(https://invalid.test/gold)",
    primary: "rgb(0, 229, 255)",
    secondaryColor: "#00e5ff",
    accent: "#2fc600",
    panel: "#fe293d",
  };

  const results = {};
  for (const [name, widgetKey] of [
    ["rosterWhite", "gold-broadcast-focused-roster"],
    ["statsWhite", "gold-broadcast-player-stats"],
  ]) {
    results[name] = await computedSnapshot(
      window,
      buildFocusedHtml({ widgetKey, branding: conflictingBranding }),
      {
        root: "#gold-focused-root",
        rosterHeader: "#gold-roster-header",
        rosterRow: "#gold-roster-row",
        health: "#gold-health-fill",
        statGold: "#gold-stat-gold",
      },
    );
  }
  results.focusedFallback = await computedSnapshot(
    window,
    buildFocusedHtml({
      widgetKey: "gold-broadcast-focused-roster",
      branding: invalidBranding,
    }),
    { rosterHeader: "#gold-roster-header" },
  );
  results.focusedMissing = await computedSnapshot(
    window,
    buildFocusedHtml({
      widgetKey: "gold-broadcast-player-stats",
      branding: null,
    }),
    { statGold: "#gold-stat-gold" },
  );
  results.ringWhite = await computedSnapshot(
    window,
    buildGoldRingHtml({ branding: conflictingBranding }),
    {
      root: "#next-zone-update-root",
      face: "#gold-ring-face",
      footer: "#gold-ring-footer",
      status: "#next-zone-update-status",
      progress: "#next-zone-update-progress",
    },
  );
  results.ringFallback = await computedSnapshot(
    window,
    buildGoldRingHtml({ branding: invalidBranding }),
    {
      face: "#gold-ring-face",
      progress: "#next-zone-update-progress",
    },
  );
  results.ringMissing = await computedSnapshot(
    window,
    buildGoldRingHtml({ branding: null }),
    { progress: "#next-zone-update-progress" },
  );
  results.ringMotion = await goldRingMotionSnapshot(window);

  window.destroy();
  return results;
}

if (process.versions.electron) {
  const { app } = require("electron");
  runElectronAudit()
    .then((result) => {
      process.stdout.write(`${RESULT_MARKER}${JSON.stringify(result)}\n`);
      app.exit(0);
    })
    .catch((error) => {
      process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
      app.exit(1);
    });
} else {
  const test = require("node:test");
  const assert = require("node:assert/strict");
  const { execFile } = require("node:child_process");
  const { promisify } = require("node:util");
  const execFileAsync = promisify(execFile);

  function compactColor(value) {
    return String(value || "").replace(/\s+/g, "").toLowerCase();
  }

  test("launcher Gold branding resolves through the real Chromium cascade", async () => {
    const electronExecutable = require("electron");
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const { stdout, stderr } = await execFileAsync(
      electronExecutable,
      ["--headless", "--disable-gpu", "--no-sandbox", __filename],
      {
        cwd: path.resolve(WIDGET_SERVER_ROOT, "../../../.."),
        env,
        timeout: 30000,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
    );
    const markerIndex = stdout.lastIndexOf(RESULT_MARKER);
    assert.notEqual(
      markerIndex,
      -1,
      `Electron result missing. stderr: ${stderr}`,
    );
    const result = JSON.parse(
      stdout.slice(markerIndex + RESULT_MARKER.length).trim().split(/\r?\n/)[0],
    );

    for (const focused of [result.rosterWhite, result.statsWhite]) {
      assert.equal(focused.tokens.goldSolid, "#ffffff");
      assert.equal(
        compactColor(focused.rosterHeader.backgroundColor),
        "rgb(255,255,255)",
      );
      assert.equal(
        compactColor(focused.rosterRow.backgroundColor),
        "rgb(255,255,255)",
      );
      assert.equal(
        compactColor(focused.statGold.backgroundColor),
        "rgb(255,255,255)",
      );
      assert.equal(compactColor(focused.rosterHeader.color), "rgb(5,5,5)");
      assert.equal(compactColor(focused.health.backgroundColor), "rgb(47,198,0)");
      assert.equal(compactColor(focused.root.backgroundColor), "rgba(0,0,0,0)");
    }
    assert.equal(result.focusedFallback.tokens.goldSolid, "#eedd77");
    assert.equal(
      compactColor(result.focusedFallback.rosterHeader.backgroundColor),
      "rgb(238,221,119)",
    );
    assert.equal(result.focusedMissing.tokens.goldSolid, "#eedd77");
    assert.equal(
      compactColor(result.focusedMissing.statGold.backgroundColor),
      "rgb(238,221,119)",
    );

    assert.equal(result.ringWhite.tokens.goldSolid, "#ffffff");
    assert.equal(result.ringWhite.tokens.nextZonePrimary, "#ffffff");
    assert.equal(result.ringWhite.tokens.nextZonePanel, "#050505");
    assert.equal(
      compactColor(result.ringWhite.progress.backgroundColor),
      "rgb(255,255,255)",
    );
    assert.equal(compactColor(result.ringWhite.face.color), "rgb(5,5,5)");
    assert.equal(
      compactColor(result.ringWhite.footer.backgroundColor),
      "rgba(13,13,13,0.92)",
    );
    assert.equal(
      compactColor(result.ringWhite.status.backgroundColor),
      "rgb(254,41,61)",
    );
    assert.equal(compactColor(result.ringWhite.root.backgroundColor), "rgba(0,0,0,0)");
    assert.match(result.ringWhite.face.backgroundImage, /rgb\(255, 255, 255\)/);

    assert.equal(result.ringFallback.tokens.goldSolid, "#eedd77");
    assert.equal(
      compactColor(result.ringFallback.progress.backgroundColor),
      "rgb(238,221,119)",
    );
    assert.equal(result.ringMissing.tokens.goldSolid, "#eedd77");
    assert.equal(
      compactColor(result.ringMissing.progress.backgroundColor),
      "rgb(238,221,119)",
    );
    assert.doesNotMatch(result.ringWhite.face.backgroundImage, /99,\s*82,\s*5|#635205/i);
    for (const visibleGoldValue of [
      result.rosterWhite.rosterHeader.backgroundColor,
      result.rosterWhite.rosterRow.backgroundColor,
      result.statsWhite.statGold.backgroundColor,
      result.ringWhite.progress.backgroundColor,
      result.ringWhite.face.backgroundImage,
    ]) {
      assert.doesNotMatch(visibleGoldValue, /(?:rgb\()?0,\s*229,\s*255/i);
    }

    assert.equal(result.ringMotion.initial.opacity, 1);
    for (const preparing of [
      result.ringMotion.preparingFrameOne,
      result.ringMotion.preparingFrameTwo,
    ]) {
      assert.equal(preparing.opacity, 0);
      assert.match(preparing.transform, /-18\)?$/);
      assert.match(preparing.transitionDuration, /^0s(?:, 0s)*$/);
    }
    assert.ok(
      result.ringMotion.entering.opacity > 0 &&
        result.ringMotion.entering.opacity < 1,
      `Gold Ring should be between poses on its first entrance frame: ${JSON.stringify(result.ringMotion.entering)}`,
    );
    assert.equal(result.ringMotion.entered.opacity, 1);
    assert.match(result.ringMotion.entered.transform, /(?:none|0\))$/);
    assert.equal(result.ringMotion.reduced.opacity, 1);
    assert.match(result.ringMotion.reduced.transform, /(?:none|0\))$/);
    assert.match(result.ringMotion.reduced.transitionDuration, /^0s(?:, 0s)*$/);
  });
}
