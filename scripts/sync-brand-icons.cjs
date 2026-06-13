const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const sourceIcon = path.join(repoRoot, "apps", "arenzyra-web", "app", "favicon.ico");
const sourceMark = path.join(repoRoot, "apps", "arenzyra-web", "app", "icon.png");
const targetIcons = [
  path.join(repoRoot, "apps", "desktop", "build", "icon.ico"),
  path.join(repoRoot, "apps", "launcher", "build", "icon.ico"),
];
const targetMarks = [
  path.join(repoRoot, "apps", "desktop", "build", "default-team.png"),
];

if (!fs.existsSync(sourceIcon)) {
  throw new Error(`Source icon not found: ${sourceIcon}`);
}

if (!fs.existsSync(sourceMark)) {
  throw new Error(`Source brand mark not found: ${sourceMark}`);
}

for (const targetIcon of targetIcons) {
  fs.mkdirSync(path.dirname(targetIcon), { recursive: true });
  fs.copyFileSync(sourceIcon, targetIcon);
  console.log(`Synced ${sourceIcon} -> ${targetIcon}`);
}

for (const targetMark of targetMarks) {
  fs.mkdirSync(path.dirname(targetMark), { recursive: true });
  fs.copyFileSync(sourceMark, targetMark);
  console.log(`Synced ${sourceMark} -> ${targetMark}`);
}
