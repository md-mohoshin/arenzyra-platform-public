"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const sharp = require("sharp");

const {
  downloadAndSanitizeRemoteImage,
  resolveAllowedRemoteImageUrl,
} = require("./remote-image-policy.cjs");

async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("tenant media URLs cannot target localhost or private origins", () => {
  const apiBase = "https://api.arenzyra.example";
  for (const candidate of [
    "http://127.0.0.1:8080/admin",
    "http://localhost:8080/admin",
    "http://10.0.0.4/image.png",
    "http://169.254.169.254/latest/meta-data",
  ]) {
    assert.equal(resolveAllowedRemoteImageUrl(apiBase, candidate), null);
  }
});

test("remote image fetch rejects redirects, disguised SVG, and oversized bodies", async () => {
  const validPng = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const server = await startServer((req, res) => {
    if (req.url === "/redirect") {
      res.statusCode = 302;
      res.setHeader("Location", "/valid.png");
      res.end();
      return;
    }
    if (req.url === "/svg.png") {
      const body = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>");
      res.setHeader("Content-Type", "image/png");
      res.end(body);
      return;
    }
    if (req.url === "/oversized.png") {
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Length", "1024");
      res.end(Buffer.alloc(1024, 1));
      return;
    }
    res.setHeader("Content-Type", "image/png");
    res.end(validPng);
  });

  try {
    for (const [path, pattern, maxBytes] of [
      ["/redirect", /status code 302|redirect/i, 4096],
      ["/svg.png", /allowed raster format/i, 4096],
      ["/oversized.png", /maxContentLength|size limit/i, 128],
    ]) {
      await assert.rejects(
        downloadAndSanitizeRemoteImage({
          baseUrl: server.baseUrl,
          url: `${server.baseUrl}${path}`,
          maxBytes,
        }),
        pattern,
      );
    }

    const result = await downloadAndSanitizeRemoteImage({
      baseUrl: server.baseUrl,
      url: "/valid.png",
      maxBytes: 4096,
    });
    assert.equal(result.contentType, "image/png");
    assert.equal((await sharp(result.buffer).metadata()).format, "png");
  } finally {
    await server.close();
  }
});
