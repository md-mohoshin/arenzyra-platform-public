#!/usr/bin/env node

const dns = require("node:dns/promises");
const fs = require("node:fs");
const path = require("node:path");

function readFlag(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) return fallback;
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function normalizeOrigin(value) {
  const parsed = new URL(value);
  return parsed.origin;
}

function hostFromOrigin(value) {
  return new URL(value).hostname;
}

function withPath(origin, pathname) {
  return new URL(pathname, `${origin}/`).toString();
}

async function resolveHost(host) {
  const [v4, v6] = await Promise.allSettled([
    dns.resolve4(host),
    dns.resolve6(host),
  ]);
  const addresses = [
    ...(v4.status === "fulfilled" ? v4.value : []),
    ...(v6.status === "fulfilled" ? v6.value : []),
  ];
  if (!addresses.length) {
    throw new Error(`DNS did not resolve for ${host}.`);
  }
  return addresses;
}

function readEnvValue(filePath, key) {
  if (!filePath || !fs.existsSync(filePath)) return "";
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsAt = trimmed.indexOf("=");
    if (equalsAt === -1 || trimmed.slice(0, equalsAt).trim() !== key) continue;
    let value = trimmed.slice(equalsAt + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return "";
}

async function fetchWithTimeout(url, timeoutMs, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "cache-control": "no-cache",
        "ngrok-skip-browser-warning": "1",
        ...headers,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readBody(response, asJson) {
  const text = await response.text();
  if (!asJson) return text;
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Expected JSON but received: ${text.slice(0, 120)}`);
  }
}

async function checkHttp(check, timeoutMs) {
  const response = await fetchWithTimeout(check.url, timeoutMs, check.headers);
  const body = await readBody(response, check.json);
  if (!check.status.includes(response.status)) {
    throw new Error(
      `${check.name} returned ${response.status}; expected ${check.status.join(" or ")}.`,
    );
  }
  if (check.contains && typeof body === "string" && !body.includes(check.contains)) {
    throw new Error(`${check.name} did not include ${check.contains}.`);
  }
  if (check.validate) check.validate(body, response);
  return response.status;
}

async function main() {
  if (hasFlag("--help")) {
    console.log(
      "Usage: node scripts/verify-publish.cjs [--web https://arenzyra.com] [--api https://api.arenzyra.com] [--env infra/.env.publish] [--skip-dns]",
    );
    return;
  }

  const webOrigin = normalizeOrigin(readFlag("--web", "https://arenzyra.com"));
  const apiOrigin = normalizeOrigin(readFlag("--api", "https://api.arenzyra.com"));
  const timeoutMs = Number(readFlag("--timeout-ms", "15000"));
  const envPath = path.resolve(readFlag("--env", "infra/.env.publish"));
  const healthToken =
    process.env.HEALTHCHECK_TOKEN?.trim() ||
    readEnvValue(envPath, "HEALTHCHECK_TOKEN");
  const skipDns = hasFlag("--skip-dns");
  const failures = [];

  console.log(`[publish-verify] web: ${webOrigin}`);
  console.log(`[publish-verify] api: ${apiOrigin}`);

  if (!skipDns) {
    for (const origin of [webOrigin, apiOrigin]) {
      const host = hostFromOrigin(origin);
      try {
        const addresses = await resolveHost(host);
        console.log(`[ok] dns ${host}: ${addresses.join(", ")}`);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  const checks = [
    {
      name: "web homepage",
      url: webOrigin,
      status: [200],
      contains: "Arenzyra",
    },
    {
      name: "web build version",
      url: withPath(webOrigin, "/api/version"),
      status: [200],
      json: true,
      validate(body) {
        if (!body || typeof body !== "object" || !body.buildId) {
          throw new Error("web build version did not include buildId.");
        }
      },
    },
    {
      name: "studio runtime page",
      url: withPath(webOrigin, "/studio/runtime"),
      status: [200],
      contains: "Studio",
    },
    {
      name: "studio workspace auth gate",
      url: withPath(webOrigin, "/api/studio/workspace"),
      status: [401, 403],
      json: true,
    },
    {
      name: "studio image jobs auth gate",
      url: withPath(webOrigin, "/api/studio/image-jobs"),
      status: [401, 403],
      json: true,
    },
    {
      name: "api liveness",
      url: withPath(apiOrigin, "/health/live"),
      status: [200],
      json: true,
      validate(body) {
        if (!body || body.status !== "ok") {
          throw new Error("api liveness did not report status=ok.");
        }
      },
    },
  ];

  if (healthToken) {
    checks.push({
      name: "api readiness",
      url: withPath(apiOrigin, "/health/ready"),
      status: [200],
      json: true,
      headers: { "X-Healthcheck-Token": healthToken },
      validate(body) {
        if (!body || body.status !== "ready") {
          throw new Error("api readiness did not report status=ready.");
        }
      },
    });
  } else {
    failures.push(
      `HEALTHCHECK_TOKEN was not available from the process or ${envPath}; protected readiness was not verified.`,
    );
  }

  for (const check of checks) {
    try {
      const status = await checkHttp(check, timeoutMs);
      console.log(`[ok] ${check.name}: ${status}`);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (failures.length) {
    console.error("\n[publish-verify] failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log("\n[publish-verify] OK");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
