const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function source(name) {
  return fs.readFileSync(path.join(__dirname, name), "utf8");
}

test("desktop screenshot uploads bind matchId and retain private asset IDs", () => {
  const apiClient = source("apiClient.cjs");
  const main = source("main.cjs");
  const visualMode = source("visualModeService.cjs");

  assert.match(apiClient, /form\.append\("matchId", normalizedMatchId\)/);
  assert.match(
    apiClient,
    /createScreenshotUploadForm\(params\?\.filePath, params\?\.matchId\)/,
  );
  assert.match(apiClient, /\{ assetIds: evidenceIds \}/);
  assert.match(apiClient, /assetId \? \{ assetId \}/);
  assert.match(
    main,
    /upload\?\.assetId \|\| upload\?\.assets\?\.\[0\]\?\.assetId/,
  );
  assert.doesNotMatch(main, /public image URL/);
  assert.match(visualMode, /assetId: normalizeString\(payload\?\.assetId\)/);
  assert.match(visualMode, /imageUrl: null/);
});
