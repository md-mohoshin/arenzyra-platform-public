import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { componentAuthorizationPolicy } from "./command-authorization";

const sourceRoot = path.resolve(__dirname);

function sourceFilesUnder(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(entryPath);
    if (!entry.isFile() || !entry.name.endsWith(".ts")) return [];
    if (entry.name.endsWith(".spec.ts") || entry.name === "test-env.ts") {
      return [];
    }
    return [entryPath];
  });
}

const sourceFiles = sourceFilesUnder(sourceRoot);

function extractedComponentIds(source: string) {
  const values = new Set<string>();
  const constants = new Map<string, string>();
  for (const match of source.matchAll(
    /const\s+([A-Z][A-Z0-9_]*)\s*=\s*["']([^"']+)["']/g,
  )) {
    constants.set(match[1], match[2]);
  }
  const patterns = [
    /(?:interaction\.)?customId\.startsWith\(\s*["'`]([^"'`]+)/g,
    /\.setCustomId\(\s*(["'`])([^"'`]+)\1\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const raw = (match[2] || match[1] || "")
        .replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (value, name) =>
          constants.get(name) ?? value,
        )
        .trim();
      if (raw.includes(":") || raw === "resultctl-session-select") {
        values.add(raw);
      }
    }
  }
  for (const match of source.matchAll(
    /(?:interaction\.)?customId\.startsWith\(\s*([A-Z][A-Z0-9_]*)\s*\)/g,
  )) {
    const value = constants.get(match[1]);
    if (value && value.includes(":")) values.add(value);
  }
  return values;
}

function representativeCustomId(extracted: string) {
  const literalPrefix = extracted.split("${", 1)[0];
  if (literalPrefix === "autoclean:full") {
    return "autoclean:full:confirm:session-inventory:2026-08-04:1800";
  }
  if (literalPrefix === "control:" || literalPrefix === "control-modal:") {
    return `${literalPrefix}join-scrim:session-inventory`;
  }
  if (literalPrefix === "resultctl-session-select") return literalPrefix;
  return literalPrefix.endsWith(":")
    ? `${literalPrefix}inventory`
    : literalPrefix;
}

test("every emitted or handled component family has an explicit authorization policy", () => {
  const extracted = new Set<string>();
  for (const filePath of sourceFiles) {
    const source = fs.readFileSync(filePath, "utf8");
    for (const value of extractedComponentIds(source)) extracted.add(value);
  }

  assert.ok(extracted.size >= 20, "component inventory unexpectedly found too few families");
  const unclassified = [...extracted].filter(
    (value) =>
      componentAuthorizationPolicy(representativeCustomId(value)) ===
      "unclassified",
  );
  assert.deepEqual(
    unclassified,
    [],
    `Classify new component families as staff or explicit self-service: ${unclassified.join(", ")}`,
  );
});

test("staff autocomplete authorizes before invoking data-producing handlers", () => {
  const botSource = fs.readFileSync(path.join(sourceRoot, "bot.ts"), "utf8");
  const start = botSource.indexOf("async function handleAutocomplete");
  const end = botSource.indexOf("async function handleMessageContextCommand", start);
  const handler = botSource.slice(start, end);
  const policyAt = handler.indexOf(
    'registration.authorization.policy === "staff"',
  );
  const authorizationAt = handler.indexOf(
    "sessionService.authorizeStaffCommand",
  );
  const executeAt = handler.indexOf("await autocomplete(interaction");
  assert.ok(policyAt >= 0, "autocomplete command policy check is missing");
  assert.ok(
    authorizationAt > policyAt,
    "autocomplete staff authorization runs before its policy check",
  );
  assert.ok(
    executeAt > authorizationAt,
    "autocomplete executes before staff authorization",
  );
  assert.match(handler, /if \(!authorization\.allowed\)[\s\S]*interaction\.respond\(\[\]\)/);
});

test("application command dispatch looks up classified metadata before pause and execution", () => {
  const botSource = fs.readFileSync(path.join(sourceRoot, "bot.ts"), "utf8");
  for (const [startMarker, endMarker, lookupMarker] of [
    [
      "async function handleCommand",
      "async function handleAutocomplete",
      "findSlashCommandRegistration(interaction.commandName)",
    ],
    [
      "async function handleMessageContextCommand",
      "async function authorizeSensitiveComponent",
      "findMessageContextCommandRegistration(",
    ],
  ]) {
    const start = botSource.indexOf(startMarker);
    const end = botSource.indexOf(endMarker, start);
    const handler = botSource.slice(start, end);
    const lookupAt = handler.indexOf(lookupMarker);
    const classifiedAt = handler.indexOf("hasClassifiedCommandAuthorization");
    const pauseAt = handler.indexOf("isInteractionChannelPaused");
    const policyAt = handler.indexOf(
      'registration.authorization.policy === "staff"',
    );
    const authorizationAt = handler.indexOf(
      "sessionService.authorizeStaffCommand",
    );
    const executeAt = handler.indexOf("registration.command.execute");

    assert.ok(lookupAt >= 0, `${startMarker} registry lookup is missing`);
    assert.ok(
      classifiedAt > lookupAt,
      `${startMarker} does not fail closed on missing policy metadata`,
    );
    assert.ok(
      pauseAt > classifiedAt,
      `${startMarker} checks pause state before command classification`,
    );
    assert.ok(policyAt > pauseAt, `${startMarker} staff policy check is missing`);
    assert.ok(
      authorizationAt > policyAt,
      `${startMarker} authorizes staff before checking command policy`,
    );
    assert.ok(
      executeAt > authorizationAt,
      `${startMarker} executes before central staff authorization`,
    );
  }
});
