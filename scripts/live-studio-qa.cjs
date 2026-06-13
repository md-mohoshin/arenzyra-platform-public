#!/usr/bin/env node

const crypto = require("node:crypto");

const smokePngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/WMXhQAAAABJRU5ErkJggg==",
  "base64",
);

const smokeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="white"/><circle cx="4" cy="4" r="3" fill="#e11d48"/></svg>`;
const smokeSvgDataUrl = `data:image/svg+xml;base64,${Buffer.from(smokeSvg).toString(
  "base64",
)}`;

function hasFlag(name) {
  return process.argv.includes(name);
}

function readFlag(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) return fallback;
  return process.argv[index + 1];
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

function normalizeOrigin(value) {
  return new URL(value).origin;
}

function absoluteUrl(origin, pathOrUrl) {
  return new URL(pathOrUrl, `${origin}/`).toString();
}

function normalizeAuthorization(value) {
  const clean = String(value ?? "").trim();
  if (!clean) return "";
  return /^(bearer|bot|basic)\s+/i.test(clean) ? clean : `Bearer ${clean}`;
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function readBody(response) {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return text;
    }
  }
  return text;
}

function bodyMessage(body) {
  if (body && typeof body === "object") {
    const message = body.message ?? body.error;
    if (Array.isArray(message)) return message.join(", ");
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  if (typeof body === "string" && body.trim()) return body.trim().slice(0, 240);
  return "";
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: "follow",
      ...options,
      signal: controller.signal,
      headers: {
        "cache-control": "no-cache",
        "ngrok-skip-browser-warning": "1",
        ...(options?.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function request(url, options, timeoutMs, expectedStatus = [200]) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  const body = await readBody(response);
  if (!expectedStatus.includes(response.status)) {
    const detail = bodyMessage(body);
    throw new Error(
      `${url} returned ${response.status}; expected ${expectedStatus.join(
        " or ",
      )}${detail ? `: ${detail}` : ""}`,
    );
  }
  return { response, body };
}

function jsonOptions(method, authorization, data) {
  return {
    method,
    headers: {
      Authorization: authorization,
      "content-type": "application/json",
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  };
}

async function login(apiOrigin, email, password, timeoutMs) {
  const { body } = await request(
    absoluteUrl(apiOrigin, "/auth/login"),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
    timeoutMs,
  );

  const token = body?.accessToken ?? body?.access_token;
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("Login succeeded but did not return an access token.");
  }
  return normalizeAuthorization(token);
}

function createDefaultBrandKit(now) {
  return {
    colors: [
      { id: "brand-cyan", name: "Arenzyra Cyan", value: "#22d3ee", createdAt: now },
      { id: "brand-slate", name: "Deep Slate", value: "#0f172a", createdAt: now },
    ],
    fonts: {
      heading: "Inter",
      body: "Inter",
      accent: "Roboto Mono",
    },
    logos: [],
    updatedAt: now,
  };
}

function createWorkspaceSnapshot(design) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    designs: [design],
    activeDesignId: design.id,
    designVersions: [],
    assets: [],
    elementPresets: [],
    customTemplates: [],
    brandKit: createDefaultBrandKit(now),
    updatedAt: now,
  };
}

function createSmokeDesign(label) {
  const now = new Date().toISOString();
  const idSuffix = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  const designId = `studio-live-qa-${label}-${idSuffix}`;

  return {
    schemaVersion: 1,
    id: designId,
    name: `Studio Live QA ${label}`,
    width: 320,
    height: 180,
    pages: [
      {
        id: "page-main",
        name: "Main",
        background: {
          color: "#101827",
          transparent: false,
        },
        timeline: {
          durationMs: 1000,
          fps: 12,
        },
        elements: [
          {
            id: "background-card",
            kind: "rect",
            name: "Background Card",
            x: 20,
            y: 20,
            width: 280,
            height: 140,
            rotation: 0,
            opacity: 1,
            visible: true,
            locked: false,
            fill: "#0f172a",
            stroke: "#22d3ee",
            strokeWidth: 2,
            radius: 12,
          },
          {
            id: "title",
            kind: "text",
            name: "Title",
            x: 40,
            y: 54,
            width: 240,
            height: 72,
            rotation: 0,
            opacity: 1,
            visible: true,
            locked: false,
            text: "Studio Live QA",
            fontFamily: "Inter",
            fontSize: 30,
            fontWeight: 800,
            fontStyle: "normal",
            textDecoration: "none",
            textAlign: "center",
            fill: "#ffffff",
            lineHeight: 1.08,
            letterSpacing: 0,
            dataBinding: {
              fieldId: "field-title",
              key: "title",
              role: "text",
            },
          },
        ],
      },
    ],
    activePageId: "page-main",
    dataFields: [
      {
        id: "field-title",
        key: "title",
        label: "Title",
        type: "text",
        sampleValue: "Studio Live QA",
        required: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    dataSets: [
      {
        id: "dataset-main",
        name: "QA Data",
        values: {
          title: "Studio Live QA",
        },
        createdAt: now,
        updatedAt: now,
      },
    ],
    activeDataSetId: "dataset-main",
    createdAt: now,
    updatedAt: now,
  };
}

async function runWorkspaceRead(webOrigin, authorization, timeoutMs) {
  const { body } = await request(
    absoluteUrl(webOrigin, "/api/studio/workspace"),
    jsonOptions("GET", authorization),
    timeoutMs,
  );

  if (body?.source !== "authenticated") {
    throw new Error(`Workspace source was ${body?.source ?? "missing"}, expected authenticated.`);
  }
  if (!body?.workspaceId) {
    throw new Error("Workspace response did not include workspaceId.");
  }
  console.log(`[ok] authenticated workspace read: ${body.workspaceId}`);
  return body;
}

async function runWorkspaceWrite(webOrigin, authorization, timeoutMs, design) {
  const original = await runWorkspaceRead(webOrigin, authorization, timeoutMs);
  const originalSnapshot = original.snapshot;
  const nextSnapshot = {
    ...originalSnapshot,
    designs: [...(originalSnapshot?.designs ?? []), design],
    activeDesignId: originalSnapshot?.activeDesignId ?? design.id,
    updatedAt: new Date().toISOString(),
  };

  await request(
    absoluteUrl(webOrigin, "/api/studio/workspace"),
    jsonOptions("PUT", authorization, { snapshot: nextSnapshot }),
    timeoutMs,
  );
  const updated = await runWorkspaceRead(webOrigin, authorization, timeoutMs);
  if (!updated.snapshot?.designs?.some((item) => item.id === design.id)) {
    throw new Error("Workspace write did not persist the QA design.");
  }
  console.log("[ok] authenticated workspace write");

  return async () => {
    await request(
      absoluteUrl(webOrigin, "/api/studio/workspace"),
      jsonOptions("PUT", authorization, { snapshot: originalSnapshot }),
      timeoutMs,
    );
    console.log("[ok] restored workspace snapshot");
  };
}

async function runMedia(webOrigin, authorization, timeoutMs) {
  await request(
    absoluteUrl(webOrigin, "/api/studio/media"),
    jsonOptions("GET", authorization),
    timeoutMs,
  );

  const form = new FormData();
  const blob = new Blob([smokePngBytes], { type: "image/png" });
  form.append("file", blob, "studio-live-qa.png");
  form.append("thumbnail", blob, "studio-live-qa-thumb.png");
  form.append("name", "studio-live-qa.png");
  form.append("width", "1");
  form.append("height", "1");
  form.append("tags", JSON.stringify(["qa", "live"]));

  const { body } = await request(
    absoluteUrl(webOrigin, "/api/studio/media"),
    {
      method: "POST",
      headers: { Authorization: authorization },
      body: form,
    },
    timeoutMs,
  );

  const assetId = body?.asset?.id;
  if (typeof assetId !== "string" || !assetId) {
    throw new Error("Media upload response did not include an asset id.");
  }
  if (!body.asset.src) {
    throw new Error("Media upload response did not include a media URL.");
  }

  const cleanup = async () => {
    await request(
      absoluteUrl(webOrigin, "/api/studio/media"),
      jsonOptions("DELETE", authorization, { assetIds: [assetId] }),
      timeoutMs,
    );
    console.log("[ok] deleted QA media");
  };

  try {
    await request(absoluteUrl(webOrigin, body.asset.src), { method: "GET" }, timeoutMs);
    if (body.asset.thumbnailSrc) {
      await request(absoluteUrl(webOrigin, body.asset.thumbnailSrc), { method: "GET" }, timeoutMs);
    }
  } catch (error) {
    await cleanup().catch(() => undefined);
    throw error;
  }

  console.log("[ok] media upload/read");
  return cleanup;
}

async function runImageJobs(
  webOrigin,
  authorization,
  timeoutMs,
  options = {},
) {
  const { body: capabilities } = await request(
    absoluteUrl(webOrigin, "/api/studio/image-jobs"),
    jsonOptions("GET", authorization),
    timeoutMs,
  );

  const serverLocal = capabilities?.providers?.find((provider) => provider.id === "server-local");
  if (!serverLocal?.enabled) {
    throw new Error("Server-local Studio image provider is not enabled.");
  }
  if (serverLocal.status !== "ready" || serverLocal.quality !== "fallback") {
    throw new Error("Server-local Studio image provider diagnostics are invalid.");
  }

  const removeBg = capabilities?.providers?.find((provider) => provider.id === "remove-bg");
  if (!removeBg) {
    throw new Error("Remove.bg Studio image provider diagnostics are missing.");
  }
  if (removeBg.quality !== "production") {
    throw new Error("Remove.bg Studio image provider is not marked as production quality.");
  }
  if (options.requireExternalProvider && !removeBg.enabled) {
    throw new Error(removeBg.statusMessage || "External Studio image provider is not configured.");
  }

  const mediaAi = capabilities?.providers?.find((provider) => provider.id === "media-ai");
  if (!mediaAi) {
    throw new Error("Media AI Studio image provider diagnostics are missing.");
  }
  if (
    mediaAi.quality !== "local-ai" ||
    !mediaAi.operations?.includes("remove-background")
  ) {
    throw new Error("Media AI Studio image provider diagnostics are invalid.");
  }
  if (options.requireLocalAiProvider && !mediaAi.enabled) {
    throw new Error(mediaAi.statusMessage || "Local Media AI provider is not configured.");
  }

  const operations = [
    ["remove-background", { background: { mode: "light", tolerance: 1, softness: 1 } }],
    ["enhance", { enhance: { preset: "auto", strength: 1 } }],
    ["upscale", { upscale: { scale: 2, sharpen: 0.2, enhance: true } }],
  ];

  for (const [operation, options] of operations) {
    const { body } = await request(
      absoluteUrl(webOrigin, "/api/studio/image-jobs"),
      jsonOptions("POST", authorization, {
        operation,
        provider: "server-local",
        source: {
          dataUrl: smokeSvgDataUrl,
          name: `studio-live-qa-${operation}.svg`,
        },
        options,
      }),
      timeoutMs,
    );
    if (body?.status !== "completed" || !body?.output?.src?.startsWith("data:image/png;base64,")) {
      throw new Error(`${operation} did not return a completed PNG result.`);
    }
    console.log(`[ok] image job ${operation}`);
  }

  if (options.testExternalProvider || options.requireExternalProvider) {
    if (!removeBg.enabled) {
      throw new Error(removeBg.statusMessage || "External Studio image provider is not configured.");
    }
    const { body } = await request(
      absoluteUrl(webOrigin, "/api/studio/image-jobs"),
      jsonOptions("POST", authorization, {
        operation: "remove-background",
        provider: "remove-bg",
        source: {
          dataUrl: smokeSvgDataUrl,
          name: "studio-live-qa-remove-bg.svg",
        },
        options: {
          background: { mode: "light", tolerance: 1, softness: 1 },
        },
      }),
      timeoutMs,
    );
    if (body?.provider !== "remove-bg" || body?.status !== "completed") {
      throw new Error("External remove.bg image job did not complete.");
    }
    console.log("[ok] external image provider remove-background");
  } else if (removeBg.enabled) {
    console.log("[ok] external image provider configured");
  } else {
    console.log("[ok] external image provider not configured; using fallback");
  }

  if (options.testLocalAiProvider || options.requireLocalAiProvider) {
    if (!mediaAi.enabled) {
      throw new Error(mediaAi.statusMessage || "Local Media AI provider is not configured.");
    }
    const { body } = await request(
      absoluteUrl(webOrigin, "/api/studio/image-jobs"),
      jsonOptions("POST", authorization, {
        operation: "remove-background",
        provider: "media-ai",
        source: {
          dataUrl: smokeSvgDataUrl,
          name: "studio-live-qa-media-ai.svg",
        },
        options: {
          background: { mode: "light", model: "general", tolerance: 1, softness: 1 },
        },
      }),
      timeoutMs,
    );
    if (body?.provider !== "media-ai" || body?.status !== "completed") {
      throw new Error("Local Media AI image job did not complete.");
    }
    console.log("[ok] local Media AI remove-background");
  } else if (mediaAi.enabled) {
    console.log("[ok] local Media AI provider configured");
  } else {
    console.log("[ok] local Media AI provider not configured; using server fallback");
  }
}

async function runPublishedRuntime(webOrigin, authorization, timeoutMs, design) {
  let publishId = "";
  const createPayload = {
    design,
    pageId: design.pages[0].id,
    dataSetId: "dataset-main",
    background: "page",
    fit: "contain",
  };

  const { body: publish } = await request(
    absoluteUrl(webOrigin, "/api/studio/published"),
    jsonOptions("POST", authorization, createPayload),
    timeoutMs,
  );
  publishId = publish?.snapshot?.id;
  if (typeof publishId !== "string" || !publishId) {
    throw new Error("Published runtime response did not include snapshot id.");
  }

  const cleanup = async () => {
    await request(
      absoluteUrl(webOrigin, `/api/studio/published/${encodeURIComponent(publishId)}`),
      jsonOptions("DELETE", authorization),
      timeoutMs,
    );
    console.log("[ok] deleted QA published runtime");
  };

  try {
    const runtimeUrl = absoluteUrl(webOrigin, publish.url);
    const { body: runtimeHtml } = await request(runtimeUrl, { method: "GET" }, timeoutMs);
    if (
      typeof runtimeHtml === "string" &&
      /Application error|Internal Server Error/i.test(runtimeHtml)
    ) {
      throw new Error("Published runtime page returned an application error.");
    }

    const { body: loadedSnapshot } = await request(
      absoluteUrl(webOrigin, `/api/studio/published/${encodeURIComponent(publishId)}`),
      jsonOptions("GET", authorization),
      timeoutMs,
    );
    if (loadedSnapshot?.snapshot?.design?.id !== design.id) {
      throw new Error("Published runtime API did not return the QA design.");
    }

    const updatedDesign = {
      ...design,
      name: `${design.name} Updated`,
      updatedAt: new Date().toISOString(),
    };
    await request(
      absoluteUrl(webOrigin, `/api/studio/published/${encodeURIComponent(publishId)}`),
      jsonOptions("PUT", authorization, {
        ...createPayload,
        design: updatedDesign,
        background: "checkerboard",
        fit: "cover",
      }),
      timeoutMs,
    );

    const { body: versions } = await request(
      absoluteUrl(webOrigin, `/api/studio/published/${encodeURIComponent(publishId)}?versions=1`),
      jsonOptions("GET", authorization),
      timeoutMs,
    );
    const versionId = versions?.versions?.[0]?.id;
    if (typeof versionId !== "string" || !versionId) {
      throw new Error("Published runtime version history was not created.");
    }

    await request(
      absoluteUrl(webOrigin, `/api/studio/published/${encodeURIComponent(publishId)}`),
      jsonOptions("POST", authorization, {
        action: "restore-version",
        versionId,
      }),
      timeoutMs,
    );
  } catch (error) {
    await cleanup().catch(() => undefined);
    throw error;
  }

  console.log("[ok] published runtime create/read/update/version restore");
  return cleanup;
}

async function runReview(webOrigin, authorization, timeoutMs, design) {
  let reviewId = "";
  const { body: created } = await request(
    absoluteUrl(webOrigin, "/api/studio/reviews"),
    jsonOptions("POST", authorization, {
      title: `${design.name} review`,
      design,
      pageId: design.pages[0].id,
      dataSetId: "dataset-main",
      background: "page",
      fit: "contain",
    }),
    timeoutMs,
  );

  reviewId = created?.review?.id;
  const token = created?.review?.token;
  if (typeof reviewId !== "string" || typeof token !== "string") {
    throw new Error("Review response did not include id and token.");
  }

  const cleanup = async () => {
    await request(
      absoluteUrl(webOrigin, `/api/studio/reviews/${encodeURIComponent(reviewId)}`),
      jsonOptions("PATCH", authorization, { status: "archived" }),
      timeoutMs,
    );
    console.log("[ok] archived QA review");
  };

  try {
    const { body: reviewHtml } = await request(
      absoluteUrl(webOrigin, created.url),
      { method: "GET" },
      timeoutMs,
    );
    if (
      typeof reviewHtml === "string" &&
      /Application error|Internal Server Error/i.test(reviewHtml)
    ) {
      throw new Error("Review page returned an application error.");
    }

    const { body: publicReview } = await request(
      absoluteUrl(webOrigin, `/api/studio/review-links/${encodeURIComponent(token)}`),
      { method: "GET" },
      timeoutMs,
    );
    if (publicReview?.review?.id !== reviewId) {
      throw new Error("Public review API did not return the QA review.");
    }
    const { body: comment } = await request(
      absoluteUrl(webOrigin, `/api/studio/review-links/${encodeURIComponent(token)}/comments`),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          authorName: "Studio QA",
          message: "Live QA review comment",
          pageId: design.pages[0].id,
          x: 64,
          y: 48,
        }),
      },
      timeoutMs,
    );

    const commentId = comment?.comment?.id;
    if (typeof commentId !== "string" || !commentId) {
      throw new Error("Review comment response did not include comment id.");
    }

    await request(
      absoluteUrl(
        webOrigin,
        `/api/studio/reviews/${encodeURIComponent(reviewId)}/comments/${encodeURIComponent(
          commentId,
        )}`,
      ),
      jsonOptions("PATCH", authorization, { status: "resolved" }),
      timeoutMs,
    );
  } catch (error) {
    await cleanup().catch(() => undefined);
    throw error;
  }

  console.log("[ok] review link/comment/resolve");
  return cleanup;
}

async function main() {
  if (hasFlag("--help")) {
    console.log(`Usage: node scripts/live-studio-qa.cjs [options]

Options:
  --web <origin>       Web origin. Default: https://arenzyra.com
  --api <origin>       API origin for email/password login. Default: https://api.arenzyra.com
  --token <token>      Bearer token or raw access token
  --service-token <t>  API service token; sent as Bot <token>
  --email <email>      Organizer email; use with --password
  --password <pass>    Organizer password; use with --email
  --timeout-ms <ms>    Per-request timeout. Default: 60000
  --include-workspace-write
                       Temporarily writes and restores the current Studio workspace snapshot
  --skip-image-ai      Skip remove-background/enhance/upscale jobs
  --require-external-image-provider
                       Fail unless the production external image provider is configured
  --test-external-image-provider
                       Run one external remove-background job when configured
  --require-local-ai-provider
                       Fail unless the no-key local Media AI provider is configured
  --test-local-ai-provider
                       Run one local Media AI remove-background job when configured
  --keep-artifacts     Do not delete temporary media/published/review artifacts

Env alternatives:
  STUDIO_QA_AUTH_TOKEN
  STUDIO_QA_SERVICE_TOKEN
  STUDIO_QA_EMAIL
  STUDIO_QA_PASSWORD
  STUDIO_QA_WEB_ORIGIN
  STUDIO_QA_API_ORIGIN
  STUDIO_QA_INCLUDE_WORKSPACE_WRITE=1
  STUDIO_QA_REQUIRE_EXTERNAL_IMAGE_PROVIDER=1
  STUDIO_QA_TEST_EXTERNAL_IMAGE_PROVIDER=1
  STUDIO_QA_REQUIRE_LOCAL_AI_PROVIDER=1
  STUDIO_QA_TEST_LOCAL_AI_PROVIDER=1
`);
    return;
  }

  const webOrigin = normalizeOrigin(
    readFlag("--web", process.env.STUDIO_QA_WEB_ORIGIN ?? "https://arenzyra.com"),
  );
  const apiOrigin = normalizeOrigin(
    readFlag("--api", process.env.STUDIO_QA_API_ORIGIN ?? "https://api.arenzyra.com"),
  );
  const timeoutMs = Number(readFlag("--timeout-ms", process.env.STUDIO_QA_TIMEOUT_MS ?? "60000"));
  const includeWorkspaceWrite =
    hasFlag("--include-workspace-write") ||
    truthy(process.env.STUDIO_QA_INCLUDE_WORKSPACE_WRITE);
  const skipImageAi = hasFlag("--skip-image-ai") || truthy(process.env.STUDIO_QA_SKIP_IMAGE_AI);
  const requireExternalImageProvider =
    hasFlag("--require-external-image-provider") ||
    truthy(process.env.STUDIO_QA_REQUIRE_EXTERNAL_IMAGE_PROVIDER);
  const testExternalImageProvider =
    hasFlag("--test-external-image-provider") ||
    truthy(process.env.STUDIO_QA_TEST_EXTERNAL_IMAGE_PROVIDER);
  const requireLocalAiProvider =
    hasFlag("--require-local-ai-provider") ||
    truthy(process.env.STUDIO_QA_REQUIRE_LOCAL_AI_PROVIDER);
  const testLocalAiProvider =
    hasFlag("--test-local-ai-provider") ||
    truthy(process.env.STUDIO_QA_TEST_LOCAL_AI_PROVIDER);
  const keepArtifacts = hasFlag("--keep-artifacts") || truthy(process.env.STUDIO_QA_KEEP_ARTIFACTS);
  const serviceToken = readFlag(
    "--service-token",
    process.env.STUDIO_QA_SERVICE_TOKEN ?? "",
  );
  const token = readFlag("--token", process.env.STUDIO_QA_AUTH_TOKEN ?? "");
  const email = readFlag("--email", process.env.STUDIO_QA_EMAIL ?? "");
  const password = readFlag("--password", process.env.STUDIO_QA_PASSWORD ?? "");
  const cleanupTasks = [];
  const cleanupWarnings = [];

  let authorization = serviceToken
    ? `Bot ${serviceToken.trim()}`
    : normalizeAuthorization(token);
  if (!authorization && email && password) {
    authorization = await login(apiOrigin, email, password, timeoutMs);
    console.log("[ok] logged in to API");
  }

  if (!authorization) {
    throw new Error(
      "Set STUDIO_QA_SERVICE_TOKEN, STUDIO_QA_AUTH_TOKEN, or STUDIO_QA_EMAIL/STUDIO_QA_PASSWORD to run authenticated live Studio QA.",
    );
  }

  console.log(`[studio-live-qa] web: ${webOrigin}`);
  console.log(`[studio-live-qa] api: ${apiOrigin}`);

  const design = createSmokeDesign("main");

  try {
    if (includeWorkspaceWrite) {
      cleanupTasks.push(
        await runWorkspaceWrite(webOrigin, authorization, timeoutMs, design),
      );
    } else {
      await runWorkspaceRead(webOrigin, authorization, timeoutMs);
    }

    if (!keepArtifacts) cleanupTasks.push(await runMedia(webOrigin, authorization, timeoutMs));
    else await runMedia(webOrigin, authorization, timeoutMs);

    if (!skipImageAi) {
      await runImageJobs(webOrigin, authorization, timeoutMs, {
        requireExternalProvider: requireExternalImageProvider,
        testExternalProvider: testExternalImageProvider,
        requireLocalAiProvider,
        testLocalAiProvider,
      });
    } else {
      console.log("[skip] image jobs");
    }

    if (!keepArtifacts) {
      cleanupTasks.push(await runPublishedRuntime(webOrigin, authorization, timeoutMs, design));
      cleanupTasks.push(await runReview(webOrigin, authorization, timeoutMs, design));
    } else {
      await runPublishedRuntime(webOrigin, authorization, timeoutMs, design);
      await runReview(webOrigin, authorization, timeoutMs, design);
    }
  } finally {
    if (!keepArtifacts) {
      for (const cleanup of cleanupTasks.reverse()) {
        try {
          await cleanup();
        } catch (error) {
          cleanupWarnings.push(safeMessage(error));
        }
      }
    }
  }

  if (cleanupWarnings.length) {
    console.warn("\n[studio-live-qa] cleanup warnings:");
    for (const warning of cleanupWarnings) console.warn(`- ${warning}`);
  }

  console.log("\n[studio-live-qa] OK");
}

main().catch((error) => {
  console.error(`[studio-live-qa] failed: ${safeMessage(error)}`);
  process.exit(1);
});
