import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { componentAuthorizationPolicy } from "./command-authorization";

const sourceRoot = path.resolve(__dirname);
const sourceFiles = [
  "bot.ts",
  "services/control-panel.service.ts",
  "services/message-registration.service.ts",
  "services/session.service.ts",
  "services/staff-task.service.ts",
  "services/ticket.service.ts",
].map((relativePath) => path.join(sourceRoot, relativePath));

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
  const authorizationAt = handler.indexOf("commandRequiresStaff(interaction.commandName)");
  const executeAt = handler.indexOf("await command.autocomplete");
  assert.ok(authorizationAt >= 0, "autocomplete staff authorization is missing");
  assert.ok(executeAt > authorizationAt, "autocomplete executes before staff authorization");
  assert.match(handler, /if \(!authorization\.allowed\)[\s\S]*interaction\.respond\(\[\]\)/);
});
