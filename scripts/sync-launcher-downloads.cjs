const fs = require("node:fs");
const path = require("node:path");
const {
  assertSafeManifestReplacement,
  sha256File,
  verifyLauncherReleaseArtifacts,
} = require("./launcher-release-artifact-verifier.cjs");

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

function readOptionalJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return readJson(filePath);
}

function main() {
  const verified = verifyLauncherReleaseArtifacts({
    distDir: desktopDistDir,
    packageJsonPath: desktopPackageJsonPath,
  });
  const installer = verified.installer;
  const portableZip = verified.portableZip;

  ensureDir(webDownloadsDir);

  const installerOutputPath = path.join(
    webDownloadsDir,
    OUTPUT_FILES.installer,
  );
  const zipOutputPath = path.join(webDownloadsDir, OUTPUT_FILES.portableZip);

  const manifest = {
    version: verified.version,
    generatedAt: new Date().toISOString(),
    files: {
      installer: {
        path: `/downloads/launcher/${OUTPUT_FILES.installer}`,
        sourceFile: verified.names.installer,
        size: installer.size,
        sha256: installer.sha256,
      },
      portableZip: {
        path: `/downloads/launcher/${OUTPUT_FILES.portableZip}`,
        sourceFile: verified.names.portableZip,
        size: portableZip.size,
        sha256: portableZip.sha256,
      },
    },
    verifiedResources: installer.resources,
  };

  const manifestPath = path.join(webDownloadsDir, "manifest.json");
  assertSafeManifestReplacement(readOptionalJson(manifestPath), manifest);

  const installerSize = copyFile(installer.path, installerOutputPath);
  const zipSize = copyFile(portableZip.path, zipOutputPath);
  if (installerSize !== installer.size || zipSize !== portableZip.size) {
    throw new Error("Launcher artifact size changed during publication staging.");
  }
  if (
    sha256File(installerOutputPath) !== installer.sha256 ||
    sha256File(zipOutputPath) !== portableZip.sha256
  ) {
    throw new Error("Launcher artifact hash changed during publication staging.");
  }

  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  console.log(
    `[launcher-downloads] verified and synced ${verified.names.installer} and ${verified.names.portableZip} to ${webDownloadsDir}`,
  );
}

main();
