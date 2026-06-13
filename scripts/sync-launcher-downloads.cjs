const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const desktopDistDir = path.join(repoRoot, "apps", "desktop", "dist");
const webDownloadsDir = path.join(
  repoRoot,
  "apps",
  "arenzyra-web",
  "public",
  "downloads",
  "launcher",
);
const desktopPackageJsonPath = path.join(
  repoRoot,
  "apps",
  "desktop",
  "package.json",
);

const OUTPUT_FILES = {
  installer: "Arenzyra-Observer-Launcher-Setup.exe",
  portableZip: "Arenzyra-Observer-Launcher.zip",
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function copyFile(sourcePath, destinationPath) {
  fs.copyFileSync(sourcePath, destinationPath);
  return fs.statSync(destinationPath).size;
}

function pickArtifact(entries, matcher) {
  const matches = entries.filter((entry) => matcher.test(entry.name));
  matches.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return matches[0] || null;
}

function main() {
  if (!fs.existsSync(desktopDistDir)) {
    throw new Error(`Desktop dist directory is missing: ${desktopDistDir}`);
  }

  const desktopPackage = readJson(desktopPackageJsonPath);
  const distEntries = fs
    .readdirSync(desktopDistDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const fullPath = path.join(desktopDistDir, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        name: entry.name,
        fullPath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      };
    });

  const installer = pickArtifact(
    distEntries,
    /^Arenzyra Observer Launcher Setup .+\.exe$/i,
  );
  const portableZip = pickArtifact(
    distEntries,
    /^Arenzyra Observer Launcher-.+-win\.zip$/i,
  );

  if (!installer) {
    throw new Error("Could not find the launcher installer in apps/desktop/dist.");
  }

  if (!portableZip) {
    throw new Error("Could not find the launcher ZIP in apps/desktop/dist.");
  }

  ensureDir(webDownloadsDir);

  const installerOutputPath = path.join(
    webDownloadsDir,
    OUTPUT_FILES.installer,
  );
  const zipOutputPath = path.join(webDownloadsDir, OUTPUT_FILES.portableZip);

  const installerSize = copyFile(installer.fullPath, installerOutputPath);
  const zipSize = copyFile(portableZip.fullPath, zipOutputPath);

  const manifest = {
    version: String(desktopPackage.version || "").trim() || "0.0.0",
    generatedAt: new Date().toISOString(),
    files: {
      installer: {
        path: `/downloads/launcher/${OUTPUT_FILES.installer}`,
        sourceFile: installer.name,
        size: installerSize,
      },
      portableZip: {
        path: `/downloads/launcher/${OUTPUT_FILES.portableZip}`,
        sourceFile: portableZip.name,
        size: zipSize,
      },
    },
  };

  fs.writeFileSync(
    path.join(webDownloadsDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  console.log(
    `[launcher-downloads] synced ${installer.name} and ${portableZip.name} to ${webDownloadsDir}`,
  );
}

main();
