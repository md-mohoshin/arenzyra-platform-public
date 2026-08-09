"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { syncBrandIcons } = require("./sync-brand-icons.cjs");

function makeTempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-brand-assets-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

test("brand sync copies each explicit source group", (t) => {
  const root = makeTempRoot(t);
  const sourceIcon = path.join(root, "sources", "icon.ico");
  const sourceMark = path.join(root, "sources", "app-icon.png");
  const sourceDesktopMark = path.join(root, "sources", "mark.png");
  const iconTargets = [path.join(root, "targets", "desktop.ico")];
  const markTargets = [path.join(root, "targets", "default-team.png")];
  const desktopMarkTargets = [path.join(root, "targets", "mark.png")];

  writeFile(sourceIcon, "icon-source");
  writeFile(sourceMark, "team-source");
  writeFile(sourceDesktopMark, "desktop-mark-source");

  const result = syncBrandIcons({
    sourceIcon,
    sourceMark,
    sourceDesktopMark,
    targetIcons: iconTargets,
    targetMarks: markTargets,
    targetDesktopMarks: desktopMarkTargets,
    log: () => {},
    warn: () => {},
  });

  assert.deepEqual(result.icons.copied, iconTargets);
  assert.deepEqual(result.marks.copied, markTargets);
  assert.deepEqual(result.desktopMarks.copied, desktopMarkTargets);
  assert.equal(fs.readFileSync(iconTargets[0], "utf8"), "icon-source");
  assert.equal(fs.readFileSync(markTargets[0], "utf8"), "team-source");
  assert.equal(
    fs.readFileSync(desktopMarkTargets[0], "utf8"),
    "desktop-mark-source",
  );
});

test("brand sync retains checked-in inputs when optional sources are absent", (t) => {
  const root = makeTempRoot(t);
  const iconTarget = path.join(root, "targets", "icon.ico");
  const markTarget = path.join(root, "targets", "default-team.png");
  const desktopMarkTarget = path.join(root, "targets", "mark.png");
  writeFile(iconTarget, "retained-icon");
  writeFile(markTarget, "retained-team");
  writeFile(desktopMarkTarget, "retained-mark");

  const result = syncBrandIcons({
    sourceIcon: path.join(root, "missing", "icon.ico"),
    sourceMark: path.join(root, "missing", "app-icon.png"),
    sourceDesktopMark: path.join(root, "missing", "mark.png"),
    targetIcons: [iconTarget],
    targetMarks: [markTarget],
    targetDesktopMarks: [desktopMarkTarget],
    log: () => {},
    warn: () => {},
  });

  assert.deepEqual(result.icons.retained, [iconTarget]);
  assert.deepEqual(result.marks.retained, [markTarget]);
  assert.deepEqual(result.desktopMarks.retained, [desktopMarkTarget]);
  assert.equal(fs.readFileSync(iconTarget, "utf8"), "retained-icon");
  assert.equal(fs.readFileSync(markTarget, "utf8"), "retained-team");
  assert.equal(fs.readFileSync(desktopMarkTarget, "utf8"), "retained-mark");
});

test("checked-in desktop brand and player fallbacks stay project-local", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const canonicalMark = fs.readFileSync(
    path.join(repoRoot, "assets", "brand", "arenzyra-mark.png"),
  );
  const desktopMark = fs.readFileSync(
    path.join(
      repoRoot,
      "apps",
      "desktop",
      "src",
      "assets",
      "arenzyra-mark.png",
    ),
  );
  const playerSvg = fs.readFileSync(
    path.join(repoRoot, "apps", "desktop", "build", "default-player.svg"),
    "utf8",
  );

  assert.deepEqual(desktopMark, canonicalMark);
  assert.match(playerSvg, /<svg\b/);
  assert.doesNotMatch(playerSvg, /<script\b|<foreignObject\b/i);
  assert.doesNotMatch(playerSvg, /\son[a-z]+\s*=|\b(?:xlink:)?href\s*=/i);
});
