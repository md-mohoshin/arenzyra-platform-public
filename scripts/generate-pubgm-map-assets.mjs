import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("../apps/arenzyra-web/node_modules/sharp");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const OUTPUT_SIZE = 4096;
const FONT_STACK =
  "'Bahnschrift SemiCondensed','Roboto Condensed','Arial Narrow','Segoe UI',Arial,sans-serif";
const sourceRoot = path.join(repoRoot, "scripts", "assets", "pubgm-maps");

const outputRoots = [
  path.join(repoRoot, "apps", "arenzyra-web", "public", "maps"),
  path.join(repoRoot, "apps", "arenzyra-web", "public", "assets", "maps"),
  path.join(repoRoot, "apps", "desktop", "electron", "assets", "maps"),
];

const LABEL_STYLES = {
  hero: { size: 0.045, letterSpacing: 3.4, stroke: 26, opacity: 0.96 },
  large: { size: 0.034, letterSpacing: 2.8, stroke: 22, opacity: 0.94 },
  medium: { size: 0.026, letterSpacing: 2.1, stroke: 18, opacity: 0.92 },
  small: { size: 0.02, letterSpacing: 1.6, stroke: 14, opacity: 0.9 },
};

const MAPS = [
  {
    key: "erangel",
    source: "erangel.png",
    targets: {
      web: "erangel.png",
      webAssets: "erangel.png",
      desktop: "erangel.png",
    },
    labels: [],
  },
  {
    key: "miramar",
    source: "miramar.png",
    targets: {
      web: "miramar.png",
      webAssets: "miramar.png",
      desktop: "miramar.png",
    },
    labels: [
      { text: "Campo Militar", x: 0.88, y: 0.12, style: "medium" },
      { text: "Torre Ahumada", x: 0.74, y: 0.14, style: "medium" },
      { text: "La Cobreria", x: 0.36, y: 0.19, style: "medium" },
      { text: "Tierra Bronca", x: 0.84, y: 0.24, style: "medium" },
      { text: "Ruins", x: 0.08, y: 0.27, style: "small" },
      { text: "Trailer Park", x: 0.19, y: 0.34, style: "small" },
      { text: "Cruz del Valle", x: 0.70, y: 0.30, style: "medium" },
      { text: "Water Treatment", x: 0.59, y: 0.36, style: "medium" },
      { text: "El Pozo", x: 0.24, y: 0.39, style: "hero" },
      { text: "San Martin", x: 0.55, y: 0.50, style: "large" },
      { text: "Monte Nuevo", x: 0.34, y: 0.62, style: "medium" },
      { text: "Power Grid", x: 0.49, y: 0.60, style: "small" },
      { text: "Pecado", x: 0.52, y: 0.64, style: "large" },
      { text: "Minas Generales", x: 0.75, y: 0.67, style: "medium" },
      { text: "La Bendita", x: 0.71, y: 0.73, style: "large" },
      { text: "Los Leones", x: 0.67, y: 0.81, style: "hero" },
      { text: "Impala", x: 0.82, y: 0.79, style: "medium" },
      { text: "Valle del Mar", x: 0.19, y: 0.92, style: "large" },
      { text: "Chumacera", x: 0.45, y: 0.91, style: "large" },
      { text: "Puerto Paraiso", x: 0.87, y: 0.97, style: "large" },
    ],
  },
  {
    key: "sanhok",
    source: "sanhok.jpg",
    targets: {
      web: "sanhok.jpg",
      webAssets: "sanhok.jpg",
      desktop: "sanhok.jpg",
    },
    labels: [
      { text: "Ha Tinh", x: 0.16, y: 0.15, style: "medium" },
      { text: "Camp Alpha", x: 0.11, y: 0.17, style: "medium" },
      { text: "Paradise Resort", x: 0.55, y: 0.22, style: "medium" },
      { text: "Mongnai", x: 0.85, y: 0.17, style: "medium" },
      { text: "Ruins", x: 0.20, y: 0.41, style: "large" },
      { text: "Bootcamp", x: 0.48, y: 0.50, style: "hero" },
      { text: "Khao", x: 0.71, y: 0.39, style: "medium" },
      { text: "Camp Charlie", x: 0.87, y: 0.54, style: "medium" },
      { text: "Pai Nan", x: 0.44, y: 0.67, style: "large" },
      { text: "Bhan", x: 0.69, y: 0.68, style: "medium" },
      { text: "Camp Bravo", x: 0.58, y: 0.82, style: "medium" },
      { text: "Quarry", x: 0.24, y: 0.88, style: "large" },
      { text: "Lakawi", x: 0.15, y: 0.94, style: "medium" },
      { text: "Sahmee", x: 0.81, y: 0.88, style: "medium" },
      { text: "Docks", x: 0.93, y: 0.72, style: "medium" },
      { text: "Cave", x: 0.49, y: 0.92, style: "small" },
    ],
  },
  {
    key: "vikendi",
    source: "vikendi.jpg",
    targets: {
      web: "vikendi.jpg",
      webAssets: "vikendi.jpg",
      desktop: "vikendi.jpg",
    },
    labels: [
      { text: "Dino Park", x: 0.22, y: 0.20, style: "large" },
      { text: "Cosmodrome", x: 0.78, y: 0.16, style: "medium" },
      { text: "Dobro Mesto", x: 0.85, y: 0.32, style: "medium" },
      { text: "Abbey", x: 0.46, y: 0.29, style: "small" },
      { text: "Goroka", x: 0.50, y: 0.39, style: "large" },
      { text: "Castle", x: 0.54, y: 0.51, style: "hero" },
      { text: "Winery", x: 0.33, y: 0.51, style: "medium" },
      { text: "Port", x: 0.86, y: 0.53, style: "medium" },
      { text: "Cement Factory", x: 0.14, y: 0.61, style: "medium" },
      { text: "Podvosto", x: 0.68, y: 0.62, style: "medium" },
      { text: "Villa", x: 0.40, y: 0.62, style: "medium" },
      { text: "Cantra", x: 0.48, y: 0.73, style: "medium" },
      { text: "Volnova", x: 0.30, y: 0.83, style: "large" },
      { text: "Coal Mine", x: 0.17, y: 0.81, style: "small" },
      { text: "Trevno", x: 0.69, y: 0.84, style: "medium" },
    ],
  },
  {
    key: "livik",
    source: "livik.jpg",
    targets: {
      web: "livik.jpg",
      webAssets: "livik.jpg",
      desktop: "livik.jpg",
    },
    labels: [],
  },
  {
    key: "livik-aftermath",
    source: "livik-aftermath.png",
    targets: {
      web: "livik-aftermath.png",
      webAssets: "livik-aftermath.png",
      desktop: "livik-aftermath.png",
    },
    labels: [],
  },
  {
    key: "karakin",
    source: "karakin.jpg",
    targets: {
      web: "karakin.jpg",
      webAssets: "karakin.jpg",
      desktop: "karakin.jpg",
    },
    labels: [],
  },
  {
    key: "nusa",
    source: "nusa.png",
    targets: {
      web: "nusa.png",
      webAssets: "nusa.png",
      desktop: "nusa.png",
    },
    labels: [],
  },
  {
    key: "rondo",
    source: "rondo.webp",
    targets: {
      web: "rondo.webp",
      webAssets: "rondo.webp",
      desktop: "rondo.jpg",
    },
    labels: [],
  },
];

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function resolveLabelStyle(label) {
  return LABEL_STYLES[label.style] ?? LABEL_STYLES.medium;
}

function buildLabelSvg(labels) {
  if (!Array.isArray(labels) || labels.length === 0) {
    return null;
  }

  const textNodes = labels
    .map((label) => {
      const style = resolveLabelStyle(label);
      const fontSize = Math.round(OUTPUT_SIZE * style.size);
      const x = Math.round(label.x * OUTPUT_SIZE);
      const y = Math.round(label.y * OUTPUT_SIZE);
      const rotate = Number.isFinite(label.rotate) ? ` rotate(${label.rotate} ${x} ${y})` : "";
      return `
      <text
        x="${x}"
        y="${y}"
        text-anchor="middle"
        dominant-baseline="middle"
        fill="rgba(255,255,255,${style.opacity})"
        stroke="rgba(6,10,16,0.86)"
        stroke-width="${style.stroke}"
        paint-order="stroke fill"
        font-family="${FONT_STACK}"
        font-size="${fontSize}"
        font-weight="700"
        letter-spacing="${style.letterSpacing}"
        filter="url(#shadow)"
        transform="${rotate.trim() || ""}"
      >${escapeXml(label.text)}</text>`;
    })
    .join("");

  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${OUTPUT_SIZE}" height="${OUTPUT_SIZE}" viewBox="0 0 ${OUTPUT_SIZE} ${OUTPUT_SIZE}">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="${Math.round(OUTPUT_SIZE * 0.002)}" stdDeviation="${Math.round(
        OUTPUT_SIZE * 0.003,
      )}" flood-color="rgba(0,0,0,0.66)" />
    </filter>
  </defs>
  ${textNodes}
</svg>`,
  );
}

function applyFormat(pipeline, targetPath) {
  const extension = path.extname(targetPath).toLowerCase();

  if (extension === ".png") {
    return pipeline.png({
      compressionLevel: 9,
      adaptiveFiltering: true,
      palette: false,
    });
  }

  if (extension === ".webp") {
    return pipeline.webp({
      quality: 94,
      effort: 6,
    });
  }

  return pipeline.jpeg({
    quality: 94,
    mozjpeg: true,
  });
}

async function writeRenderedMap(map) {
  const sourcePath = path.join(sourceRoot, map.source);
  const sourceBuffer = await fs.readFile(sourcePath);
  const labelSvg = buildLabelSvg(map.labels);
  const composites = [];

  if (labelSvg) {
    composites.push({ input: labelSvg, blend: "over" });
  }

  const basePipeline = sharp(sourceBuffer)
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, {
      fit: "cover",
      position: "centre",
      kernel: sharp.kernel.lanczos3,
    })
    .sharpen({
      sigma: 1.1,
      m1: 0.9,
      m2: 2.4,
      x1: 2,
      y2: 10,
      y3: 20,
    });

  if (composites.length > 0) {
    basePipeline.composite(composites);
  }

  for (const [targetKey, fileName] of Object.entries(map.targets)) {
    const root =
      targetKey === "desktop"
        ? outputRoots[2]
        : targetKey === "webAssets"
          ? outputRoots[1]
          : outputRoots[0];
    const targetPath = path.join(root, fileName);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await applyFormat(basePipeline.clone(), targetPath).toFile(targetPath);
    console.log(`generated ${map.key} -> ${path.relative(repoRoot, targetPath)}`);
  }
}

async function main() {
  const requestedKeys = new Set(
    process.argv.slice(2).map((value) => String(value || "").trim().toLowerCase()),
  );
  const maps =
    requestedKeys.size > 0
      ? MAPS.filter(
          (map) =>
            requestedKeys.has(map.key) || requestedKeys.has(path.parse(map.source).name),
        )
      : MAPS;

  if (maps.length === 0) {
    throw new Error("No matching maps found for the requested generator arguments.");
  }

  for (const map of maps) {
    await writeRenderedMap(map);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
