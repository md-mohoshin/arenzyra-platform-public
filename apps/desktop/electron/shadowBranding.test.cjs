"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const sharp = require("sharp");

const { generateShadowBranding } = require("./shadowBranding.cjs");

function createTransparentColor(color) {
  return {
    r: color.r,
    g: color.g,
    b: color.b,
    alpha: color.alpha,
  };
}

async function writePaddedLogo(filePath) {
  const innerLogoBuffer = await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 4,
      background: createTransparentColor({
        r: 255,
        g: 64,
        b: 64,
        alpha: 1,
      }),
    },
  })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: 400,
      height: 400,
      channels: 4,
      background: createTransparentColor({
        r: 0,
        g: 0,
        b: 0,
        alpha: 0,
      }),
    },
  })
    .composite([{ input: innerLogoBuffer, left: 150, top: 150 }])
    .png()
    .toFile(filePath);
}

test("branding generation trims transparent logo padding before ShadowTracker resize", async () => {
  const tempRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "shadow-branding-test-"),
  );

  try {
    const teamAssetsDir = path.join(tempRoot, "assets");
    const brandingConfigPath = path.join(tempRoot, "TeamLogoAndColor.ini");
    const defaultLogoPath = path.join(tempRoot, "default-logo.png");
    const sourceLogoPath = path.join(tempRoot, "source-logo.png");

    await fs.promises.mkdir(teamAssetsDir, { recursive: true });
    await writePaddedLogo(defaultLogoPath);
    await writePaddedLogo(sourceLogoPath);

    const result = await generateShadowBranding({
      matchId: "match-1",
      teamAssetsDir,
      brandingConfigPath,
      defaultLogoPath,
      shadowLogoTemplatePath: "",
      slots: [
        {
          slotNumber: 1,
          teamId: "team-1",
          localLogoPath: sourceLogoPath,
          team: {
            id: "team-1",
            name: "Team 1",
            tag: "T1",
            accentLight: "#FF4040",
          },
        },
      ],
    });

    assert.equal(result.ok, true);

    const generatedLogoPath = path.join(teamAssetsDir, "001.png");
    const metadata = await sharp(generatedLogoPath).metadata();
    const trimmed = await sharp(generatedLogoPath)
      .trim({
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        threshold: 1,
      })
      .toBuffer({ resolveWithObject: true });

    assert.equal(metadata.width, 256);
    assert.equal(metadata.height, 256);
    assert.ok(
      trimmed.info.width >= 230,
      `expected rendered logo width >= 230, got ${trimmed.info.width}`,
    );
    assert.ok(
      trimmed.info.height >= 230,
      `expected rendered logo height >= 230, got ${trimmed.info.height}`,
    );
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("branding cache is reused across match ids when slot inputs are unchanged", async () => {
  const tempRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "shadow-branding-cache-test-"),
  );

  try {
    const teamAssetsDir = path.join(tempRoot, "assets");
    const brandingConfigPath = path.join(tempRoot, "TeamLogoAndColor.ini");
    const defaultLogoPath = path.join(tempRoot, "default-logo.png");
    const sourceLogoPath = path.join(tempRoot, "source-logo.png");
    const slots = [
      {
        slotNumber: 1,
        teamId: "team-1",
        localLogoPath: sourceLogoPath,
        team: {
          id: "team-1",
          name: "Team 1",
          tag: "T1",
          accentLight: "#FF4040",
        },
      },
    ];

    await fs.promises.mkdir(teamAssetsDir, { recursive: true });
    await writePaddedLogo(defaultLogoPath);
    await writePaddedLogo(sourceLogoPath);

    const first = await generateShadowBranding({
      matchId: "match-1",
      teamAssetsDir,
      brandingConfigPath,
      defaultLogoPath,
      shadowLogoTemplatePath: "",
      slots,
    });
    const second = await generateShadowBranding({
      matchId: "match-2",
      teamAssetsDir,
      brandingConfigPath,
      defaultLogoPath,
      shadowLogoTemplatePath: "",
      slots,
    });

    assert.equal(first.renderedCount, 25);
    assert.equal(second.cacheHitCount, 25);
    assert.equal(second.renderedCount, 0);
    assert.equal(second.slots[0].matchId, "match-2");
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});
