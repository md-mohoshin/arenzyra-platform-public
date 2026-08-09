import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import sharp from "sharp";

import {
  fetchRemoteRasterImage,
  resolveAllowedRemoteImageUrl,
} from "./remote-image";

test("tenant media URLs cannot target private services", () => {
  const options = { apiBaseUrl: "https://api.arenzyra.example" };
  for (const value of [
    "http://127.0.0.1:3000/private",
    "http://localhost:3000/private",
    "http://10.0.0.1/private",
    "http://169.254.169.254/latest/meta-data",
  ]) {
    assert.equal(resolveAllowedRemoteImageUrl(value, options), null);
  }
});

test("remote image download is bounded and rejects redirects", async (t) => {
  const validPng = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: 0, g: 100, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const server = http.createServer((request, response) => {
    if (request.url === "/redirect") {
      response.statusCode = 302;
      response.setHeader("Location", "/valid.png");
      response.end();
      return;
    }
    if (request.url === "/oversized.png") {
      response.setHeader("Content-Type", "image/png");
      response.setHeader("Content-Length", "1024");
      response.end(Buffer.alloc(1024, 1));
      return;
    }
    response.setHeader("Content-Type", "image/png");
    response.end(validPng);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const apiBaseUrl = `http://127.0.0.1:${address.port}`;

  await assert.rejects(
    fetchRemoteRasterImage(`${apiBaseUrl}/redirect`, { apiBaseUrl }),
    /redirect|fetch failed/i,
  );
  await assert.rejects(
    fetchRemoteRasterImage(`${apiBaseUrl}/oversized.png`, {
      apiBaseUrl,
      maxBytes: 128,
    }),
    /size|byte limit/i,
  );
  const image = await fetchRemoteRasterImage(`${apiBaseUrl}/valid.png`, {
    apiBaseUrl,
    maxBytes: 4096,
  });
  assert.equal(image.contentType, "image/png");
});
