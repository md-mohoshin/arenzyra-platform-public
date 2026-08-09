"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const POLICY_KEYS = Object.freeze([
  "schemaVersion",
  "databaseSchema",
  "sourceDigests",
  "apiRuntimeTables",
  "apiMigrationLedgers",
  "studioRuntimeTables",
  "studioMigrationLedgers",
  "apiEnumTypes",
  "apiFunctions",
  "apiTriggers",
  "sequences",
]);
const DIGEST_KEYS = Object.freeze([
  "apiPrismaSchemaSha256",
  "apiMigrationTreeSha256",
  "apiFunctionTriggerMigrationSha256",
  "studioMigrationSha256",
]);
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MIGRATION_SOURCE =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?\/migration\.sql$/;
const ENUM_POLICY_KEYS = Object.freeze(["name", "labels"]);
const FUNCTION_POLICY_KEYS = Object.freeze([
  "name",
  "ownerProfile",
  "kind",
  "identityArguments",
  "resultType",
  "language",
  "securityDefiner",
  "configuration",
  "volatility",
  "parallel",
  "strict",
  "leakproof",
  "returnsSet",
  "argumentDefaults",
  "cost",
  "rows",
  "sourceSha256",
  "sourceMigration",
  "sourceMigrationSha256",
]);
const TRIGGER_POLICY_KEYS = Object.freeze([
  "name",
  "ownerProfile",
  "tableName",
  "functionName",
  "functionIdentityArguments",
  "enabled",
  "internal",
  "timing",
  "level",
  "events",
  "updateColumns",
  "arguments",
  "condition",
  "sourceMigration",
  "sourceMigrationSha256",
]);
const FUNCTION_DEFAULTS = Object.freeze({
  ownerProfile: "api",
  kind: "f",
  identityArguments: "",
  resultType: "trigger",
  language: "plpgsql",
  securityDefiner: false,
  configuration: null,
  volatility: "volatile",
  parallel: "unsafe",
  strict: false,
  leakproof: false,
  returnsSet: false,
  argumentDefaults: 0,
  cost: 100,
  rows: 0,
});

function fail(message) {
  throw new Error(`Production database object policy is invalid: ${message}`);
}

function normalizedText(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function assertClosedObject(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length) {
    fail(`${label} has an unexpected shape`);
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) {
      fail(`${label} has an unexpected key`);
    }
  }
}

function validatedIdentifierArray(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string" || !IDENTIFIER.test(item)) {
      fail(`${label} contains an unsafe identifier`);
    }
    if (seen.has(item)) fail(`${label} contains a duplicate identifier`);
    seen.add(item);
  }
  return [...value];
}

function validatedEnumPolicies(value) {
  if (!Array.isArray(value)) fail("apiEnumTypes must be an array");
  const seenTypes = new Set();
  return value.map((item, index) => {
    const label = `apiEnumTypes[${index}]`;
    assertClosedObject(item, ENUM_POLICY_KEYS, label);
    if (typeof item.name !== "string" || !IDENTIFIER.test(item.name)) {
      fail(`${label}.name is not a safe identifier`);
    }
    if (seenTypes.has(item.name))
      fail("apiEnumTypes contains a duplicate type");
    seenTypes.add(item.name);
    if (!Array.isArray(item.labels) || item.labels.length === 0) {
      fail(`${label}.labels must be a non-empty array`);
    }
    const seenLabels = new Set();
    const labels = item.labels.map((enumLabel) => {
      if (
        typeof enumLabel !== "string" ||
        enumLabel.length === 0 ||
        enumLabel.includes("\u0000") ||
        Buffer.byteLength(enumLabel, "utf8") > 63
      ) {
        fail(`${label}.labels contains an invalid PostgreSQL enum label`);
      }
      if (seenLabels.has(enumLabel))
        fail(`${label}.labels contains a duplicate`);
      seenLabels.add(enumLabel);
      return enumLabel;
    });
    return { name: item.name, labels };
  });
}

function assertExactValue(actual, expected, label) {
  if (actual !== expected) fail(`${label} is not the reviewed value`);
}

function validatedMigrationSource(value, label) {
  if (typeof value !== "string" || !MIGRATION_SOURCE.test(value)) {
    fail(`${label} is not a safe migration source`);
  }
  return value;
}

function validatedFunctionPolicies(value) {
  if (!Array.isArray(value)) fail("apiFunctions must be an array");
  const seen = new Set();
  return value.map((item, index) => {
    const label = `apiFunctions[${index}]`;
    assertClosedObject(item, FUNCTION_POLICY_KEYS, label);
    if (typeof item.name !== "string" || !IDENTIFIER.test(item.name)) {
      fail(`${label}.name is not a safe identifier`);
    }
    const identity = `${item.name}(${item.identityArguments})`;
    if (seen.has(identity)) fail("apiFunctions contains a duplicate identity");
    seen.add(identity);
    for (const [key, expected] of Object.entries(FUNCTION_DEFAULTS)) {
      assertExactValue(item[key], expected, `${label}.${key}`);
    }
    validatedMigrationSource(item.sourceMigration, `${label}.sourceMigration`);
    if (
      typeof item.sourceMigrationSha256 !== "string" ||
      !SHA256.test(item.sourceMigrationSha256)
    ) {
      fail(`${label}.sourceMigrationSha256 must be a lowercase SHA-256 digest`);
    }
    if (
      typeof item.sourceSha256 !== "string" ||
      !SHA256.test(item.sourceSha256)
    ) {
      fail(`${label}.sourceSha256 must be a lowercase SHA-256 digest`);
    }
    return { ...item };
  });
}

function validatedTriggerPolicies(value, functionPolicies, apiRuntimeTables) {
  if (!Array.isArray(value)) fail("apiTriggers must be an array");
  const functions = new Map(
    functionPolicies.map((item) => [
      `${item.name}(${item.identityArguments})`,
      {
        sourceMigration: item.sourceMigration,
        sourceMigrationSha256: item.sourceMigrationSha256,
      },
    ]),
  );
  const runtimeTables = new Set(apiRuntimeTables);
  const seen = new Set();
  const referencedFunctions = new Set();
  const policies = value.map((item, index) => {
    const label = `apiTriggers[${index}]`;
    assertClosedObject(item, TRIGGER_POLICY_KEYS, label);
    for (const key of ["name", "tableName", "functionName"]) {
      if (typeof item[key] !== "string" || !IDENTIFIER.test(item[key])) {
        fail(`${label}.${key} is not a safe identifier`);
      }
    }
    const identity = `${item.tableName}.${item.name}`;
    if (seen.has(identity)) fail("apiTriggers contains a duplicate identity");
    seen.add(identity);
    if (!runtimeTables.has(item.tableName)) {
      fail(`${label}.tableName is not an API runtime table`);
    }
    assertExactValue(item.ownerProfile, "api", `${label}.ownerProfile`);
    assertExactValue(
      item.functionIdentityArguments,
      "",
      `${label}.functionIdentityArguments`,
    );
    assertExactValue(item.enabled, "O", `${label}.enabled`);
    assertExactValue(item.internal, false, `${label}.internal`);
    assertExactValue(item.timing, "BEFORE", `${label}.timing`);
    assertExactValue(item.level, "ROW", `${label}.level`);
    assertExactValue(item.condition, null, `${label}.condition`);
    validatedMigrationSource(item.sourceMigration, `${label}.sourceMigration`);
    if (
      typeof item.sourceMigrationSha256 !== "string" ||
      !SHA256.test(item.sourceMigrationSha256)
    ) {
      fail(`${label}.sourceMigrationSha256 must be a lowercase SHA-256 digest`);
    }
    if (!Array.isArray(item.arguments) || item.arguments.length !== 0) {
      fail(`${label}.arguments must be empty`);
    }
    if (!Array.isArray(item.events) || item.events.length === 0) {
      fail(`${label}.events must be a non-empty array`);
    }
    const eventSet = new Set();
    for (const event of item.events) {
      if (!["INSERT", "UPDATE", "DELETE", "TRUNCATE"].includes(event)) {
        fail(`${label}.events contains an unsupported event`);
      }
      if (eventSet.has(event)) fail(`${label}.events contains a duplicate`);
      eventSet.add(event);
    }
    const updateColumns = validatedIdentifierArray(
      item.updateColumns,
      `${label}.updateColumns`,
    );
    if (updateColumns.length > 0 && !eventSet.has("UPDATE")) {
      fail(`${label}.updateColumns requires an UPDATE event`);
    }
    const functionIdentity = `${item.functionName}(${item.functionIdentityArguments})`;
    if (!functions.has(functionIdentity)) {
      fail(`${label} references an unclassified function`);
    }
    assertExactValue(
      item.sourceMigration,
      functions.get(functionIdentity).sourceMigration,
      `${label}.sourceMigration`,
    );
    assertExactValue(
      item.sourceMigrationSha256,
      functions.get(functionIdentity).sourceMigrationSha256,
      `${label}.sourceMigrationSha256`,
    );
    referencedFunctions.add(functionIdentity);
    return {
      ...item,
      events: [...item.events],
      updateColumns,
      arguments: [],
    };
  });
  if (referencedFunctions.size !== functions.size) {
    fail("every API function must have an exact trigger wiring");
  }
  return policies;
}

function setDifference(left, right) {
  return [...left].filter((value) => !right.has(value));
}

function assertExactSet(actualValues, expectedValues, label) {
  const actual = new Set(actualValues);
  const expected = new Set(expectedValues);
  const extra = setDifference(actual, expected);
  const missing = setDifference(expected, actual);
  if (extra.length > 0 || missing.length > 0) {
    fail(
      `${label} differs from the repository (extra=${extra.length}, missing=${missing.length})`,
    );
  }
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertExactObjectSet(actualValues, expectedValues, key, label) {
  const actual = new Map(actualValues.map((value) => [key(value), value]));
  const expected = new Map(expectedValues.map((value) => [key(value), value]));
  assertExactSet(actual.keys(), expected.keys(), label);
  for (const [identity, expectedValue] of expected) {
    if (stableJson(actual.get(identity)) !== stableJson(expectedValue)) {
      fail(`${label} metadata differs for ${identity}`);
    }
  }
}

function parsePrismaTableNames(source) {
  const names = [];
  const modelPattern = /^model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)^\}/gm;
  for (const match of source.matchAll(modelPattern)) {
    const mapped = match[2].match(/^\s*@@map\("([^"]+)"\)\s*$/m);
    const name = mapped ? mapped[1] : match[1];
    if (!IDENTIFIER.test(name)) fail("Prisma contains an unsafe table name");
    names.push(name);
  }
  if (names.length === 0) fail("no Prisma models were found");
  if (new Set(names).size !== names.length) {
    fail("Prisma resolves more than one model to the same table");
  }
  return names;
}

function parsePrismaEnumPolicies(source) {
  const policies = [];
  const enumPattern = /^enum\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)^\}/gm;
  for (const match of source.matchAll(enumPattern)) {
    const mapped = match[2].match(/^\s*@@map\("([^"]+)"\)/m);
    const name = mapped ? mapped[1] : match[1];
    if (!IDENTIFIER.test(name)) fail("Prisma contains an unsafe enum name");
    const labels = [];
    for (const rawLine of match[2].split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//")) continue;
      if (line.startsWith("@@")) {
        if (!/^@@map\("[^"]+"\)$/.test(line)) {
          fail(`Prisma enum ${name} contains an unsupported block attribute`);
        }
        continue;
      }
      const value = line.match(
        /^([A-Za-z_][A-Za-z0-9_]*)(?:\s+@map\("([^"]+)"\))?(?:\s+\/\/.*)?$/,
      );
      if (!value) fail(`Prisma enum ${name} contains unsupported syntax`);
      labels.push(value[2] || value[1]);
    }
    policies.push({ name, labels });
  }
  if (policies.length === 0) fail("no Prisma enums were found");
  if (new Set(policies.map((item) => item.name)).size !== policies.length) {
    fail("Prisma resolves more than one enum to the same database type");
  }
  return validatedEnumPolicies(policies);
}

function parsePrismaEnumNames(source) {
  return parsePrismaEnumPolicies(source).map((item) => item.name);
}

function quotedIdentifierList(value, label) {
  const identifiers = [];
  let remaining = value.trim();
  while (remaining.length > 0) {
    const match = remaining.match(/^"([A-Za-z_][A-Za-z0-9_]*)"\s*(?:,\s*|$)/);
    if (!match) fail(`${label} contains an unsupported identifier list`);
    identifiers.push(match[1]);
    remaining = remaining.slice(match[0].length);
  }
  if (new Set(identifiers).size !== identifiers.length) {
    fail(`${label} contains a duplicate identifier`);
  }
  return identifiers;
}

function migrationSourceRecords(migrationRoot, files) {
  return files.map((file) => ({
    sourceMigration: path
      .relative(migrationRoot, file)
      .split(path.sep)
      .join("/"),
    source: normalizedText(file),
  }));
}

function parseApiFunctionPolicies(sources) {
  const policies = [];
  const identities = new Set();
  const createPattern = /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/gi;
  const declarationPattern =
    /\bCREATE\s+FUNCTION\s+"([A-Za-z_][A-Za-z0-9_]*)"\s*\(([^)]*)\)\s*RETURNS\s+([A-Za-z_][A-Za-z0-9_]*)\s+AS\s+\$\$([\s\S]*?)\$\$\s+LANGUAGE\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/gi;
  for (const { sourceMigration, source } of sources) {
    const declarations = [...source.matchAll(declarationPattern)];
    const createCount = [...source.matchAll(createPattern)].length;
    if (declarations.length !== createCount) {
      fail(`${sourceMigration} contains an unsupported function declaration`);
    }
    for (const match of declarations) {
      const identityArguments = match[2].trim();
      if (identityArguments !== "") {
        fail(`${sourceMigration} contains an unsupported function signature`);
      }
      const policy = {
        name: match[1],
        ...FUNCTION_DEFAULTS,
        resultType: match[3].toLowerCase(),
        language: match[5].toLowerCase(),
        sourceSha256: sha256(match[4]),
        sourceMigration,
        sourceMigrationSha256: sha256(source),
      };
      const identity = `${policy.name}(${policy.identityArguments})`;
      if (identities.has(identity)) {
        fail("API migrations contain a duplicate function identity");
      }
      identities.add(identity);
      policies.push(policy);
    }
  }
  return policies;
}

function parseTriggerEvents(value, label) {
  const events = [];
  let updateColumns = [];
  for (const rawEvent of value.trim().split(/\s+OR\s+/i)) {
    const event = rawEvent.trim();
    const update = event.match(/^UPDATE(?:\s+OF\s+([\s\S]+))?$/i);
    if (update) {
      events.push("UPDATE");
      updateColumns = update[1]
        ? quotedIdentifierList(update[1], `${label} UPDATE OF`)
        : [];
    } else if (/^(INSERT|DELETE|TRUNCATE)$/i.test(event)) {
      events.push(event.toUpperCase());
    } else {
      fail(`${label} contains an unsupported trigger event`);
    }
  }
  if (new Set(events).size !== events.length) {
    fail(`${label} contains a duplicate trigger event`);
  }
  return { events, updateColumns };
}

function parseApiTriggerPolicies(sources) {
  const policies = [];
  const identities = new Set();
  const createPattern =
    /\bCREATE\s+(?:(?:OR\s+REPLACE)\s+)?(?:CONSTRAINT\s+|EVENT\s+)?TRIGGER\b/gi;
  const declarationPattern =
    /\bCREATE\s+TRIGGER\s+"([A-Za-z_][A-Za-z0-9_]*)"\s+(BEFORE|AFTER|INSTEAD\s+OF)\s+([\s\S]*?)\s+ON\s+"([A-Za-z_][A-Za-z0-9_]*)"\s+FOR\s+EACH\s+(ROW|STATEMENT)\s+EXECUTE\s+FUNCTION\s+"([A-Za-z_][A-Za-z0-9_]*)"\s*\(([^)]*)\)\s*;/gi;
  for (const { sourceMigration, source } of sources) {
    const declarations = [...source.matchAll(declarationPattern)];
    const createCount = [...source.matchAll(createPattern)].length;
    if (declarations.length !== createCount) {
      fail(`${sourceMigration} contains an unsupported trigger declaration`);
    }
    for (const match of declarations) {
      if (match[7].trim() !== "") {
        fail(`${sourceMigration} contains trigger arguments`);
      }
      const { events, updateColumns } = parseTriggerEvents(
        match[3],
        `${sourceMigration}:${match[1]}`,
      );
      const policy = {
        name: match[1],
        ownerProfile: "api",
        tableName: match[4],
        functionName: match[6],
        functionIdentityArguments: "",
        enabled: "O",
        internal: false,
        timing: match[2].replace(/\s+/g, " ").toUpperCase(),
        level: match[5].toUpperCase(),
        events,
        updateColumns,
        arguments: [],
        condition: null,
        sourceMigration,
        sourceMigrationSha256: sha256(source),
      };
      const identity = `${policy.tableName}.${policy.name}`;
      if (identities.has(identity)) {
        fail("API migrations contain a duplicate trigger identity");
      }
      identities.add(identity);
      policies.push(policy);
    }
  }
  return policies;
}

function parseStudioTableNames(source) {
  const names = [];
  const tablePattern =
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+"([A-Za-z_][A-Za-z0-9_]*)"/gi;
  for (const match of source.matchAll(tablePattern)) names.push(match[1]);
  if (names.length === 0) fail("no Studio migration tables were found");
  if (new Set(names).size !== names.length) {
    fail("Studio migration contains duplicate table declarations");
  }
  return names;
}

function listSqlFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.endsWith(".sql"))
        files.push(absolute);
      else if (entry.isSymbolicLink())
        fail("migration tree contains a symlink");
    }
  }
  visit(root);
  return files;
}

function migrationTreeSha256(root) {
  const digest = crypto.createHash("sha256");
  const files = listSqlFiles(root);
  if (files.length === 0) fail("API migration tree has no SQL files");
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    digest.update(relative, "utf8");
    digest.update(Buffer.from([0]));
    digest.update(normalizedText(file), "utf8");
    digest.update(Buffer.from([0]));
  }
  return { digest: digest.digest("hex"), files };
}

function canonicalPolicy(policy) {
  const sort = (values) =>
    [...values].sort((left, right) =>
      left === right ? 0 : left < right ? -1 : 1,
    );
  return {
    schemaVersion: policy.schemaVersion,
    databaseSchema: policy.databaseSchema,
    sourceDigests: {
      apiPrismaSchemaSha256: policy.sourceDigests.apiPrismaSchemaSha256,
      apiMigrationTreeSha256: policy.sourceDigests.apiMigrationTreeSha256,
      apiFunctionTriggerMigrationSha256:
        policy.sourceDigests.apiFunctionTriggerMigrationSha256,
      studioMigrationSha256: policy.sourceDigests.studioMigrationSha256,
    },
    apiRuntimeTables: sort(policy.apiRuntimeTables),
    apiMigrationLedgers: sort(policy.apiMigrationLedgers),
    studioRuntimeTables: sort(policy.studioRuntimeTables),
    studioMigrationLedgers: sort(policy.studioMigrationLedgers),
    apiEnumTypes: [...policy.apiEnumTypes].sort((left, right) =>
      left.name === right.name ? 0 : left.name < right.name ? -1 : 1,
    ),
    apiFunctions: [...policy.apiFunctions].sort((left, right) =>
      left.name === right.name ? 0 : left.name < right.name ? -1 : 1,
    ),
    apiTriggers: [...policy.apiTriggers].sort((left, right) => {
      const leftIdentity = `${left.tableName}.${left.name}`;
      const rightIdentity = `${right.tableName}.${right.name}`;
      return leftIdentity === rightIdentity
        ? 0
        : leftIdentity < rightIdentity
          ? -1
          : 1;
    }),
    sequences: sort(policy.sequences),
  };
}

function validatePolicyShape(policy) {
  assertClosedObject(policy, POLICY_KEYS, "policy");
  assertClosedObject(policy.sourceDigests, DIGEST_KEYS, "sourceDigests");
  if (policy.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (policy.databaseSchema !== "public") {
    fail("databaseSchema must be public");
  }
  for (const key of DIGEST_KEYS) {
    if (
      typeof policy.sourceDigests[key] !== "string" ||
      !SHA256.test(policy.sourceDigests[key])
    ) {
      fail(`${key} must be a lowercase SHA-256 digest`);
    }
  }

  for (const key of [
    "apiRuntimeTables",
    "apiMigrationLedgers",
    "studioRuntimeTables",
    "studioMigrationLedgers",
    "sequences",
  ]) {
    policy[key] = validatedIdentifierArray(policy[key], key);
  }

  policy.apiEnumTypes = validatedEnumPolicies(policy.apiEnumTypes);
  policy.apiFunctions = validatedFunctionPolicies(policy.apiFunctions);
  policy.apiTriggers = validatedTriggerPolicies(
    policy.apiTriggers,
    policy.apiFunctions,
    policy.apiRuntimeTables,
  );

  const classified = [
    ...policy.apiRuntimeTables,
    ...policy.apiMigrationLedgers,
    ...policy.studioRuntimeTables,
    ...policy.studioMigrationLedgers,
    ...policy.sequences,
  ];
  if (new Set(classified).size !== classified.length) {
    fail("an object is classified more than once");
  }
  if (
    policy.apiMigrationLedgers.length !== 1 ||
    policy.apiMigrationLedgers[0] !== "_prisma_migrations" ||
    policy.studioMigrationLedgers.length !== 1 ||
    policy.studioMigrationLedgers[0] !== "StudioSchemaMigration"
  ) {
    fail("migration ledger classification is not exact");
  }
  if (policy.sequences.length !== 0) {
    fail("schemaVersion 1 forbids sequences until dependency policy is added");
  }
  if (
    policy.apiEnumTypes.length !== 69 ||
    policy.apiFunctions.length !== 2 ||
    policy.apiTriggers.length !== 2
  ) {
    fail("enum, function, and trigger classification counts are not exact");
  }
  return policy;
}

function checkRepository(policy, repositoryRoot) {
  const prismaPath = path.join(repositoryRoot, "apps/api/prisma/schema.prisma");
  const migrationRoot = path.join(repositoryRoot, "apps/api/prisma/migrations");
  const studioPath = path.join(
    repositoryRoot,
    "apps/arenzyra-web/scripts/studio-migrations/001_initial.sql",
  );
  const prismaSource = normalizedText(prismaPath);
  const studioSource = normalizedText(studioPath);
  const migrationTree = migrationTreeSha256(migrationRoot);

  assertExactSet(
    policy.apiRuntimeTables,
    parsePrismaTableNames(prismaSource),
    "apiRuntimeTables",
  );
  assertExactSet(
    policy.studioRuntimeTables,
    parseStudioTableNames(studioSource),
    "studioRuntimeTables",
  );
  assertExactObjectSet(
    policy.apiEnumTypes,
    parsePrismaEnumPolicies(prismaSource),
    (item) => item.name,
    "apiEnumTypes",
  );

  const migrationSources = migrationSourceRecords(
    migrationRoot,
    migrationTree.files,
  );
  assertExactObjectSet(
    policy.apiFunctions,
    parseApiFunctionPolicies(migrationSources),
    (item) => `${item.name}(${item.identityArguments})`,
    "apiFunctions",
  );
  assertExactObjectSet(
    policy.apiTriggers,
    parseApiTriggerPolicies(migrationSources),
    (item) => `${item.tableName}.${item.name}`,
    "apiTriggers",
  );

  const functionTriggerSources = new Set([
    ...policy.apiFunctions.map((item) => item.sourceMigration),
    ...policy.apiTriggers.map((item) => item.sourceMigration),
  ]);
  if (functionTriggerSources.size !== 1) {
    fail("API functions and triggers must bind one reviewed migration source");
  }
  const functionTriggerSourceDigests = new Set([
    ...policy.apiFunctions.map((item) => item.sourceMigrationSha256),
    ...policy.apiTriggers.map((item) => item.sourceMigrationSha256),
  ]);
  if (
    functionTriggerSourceDigests.size !== 1 ||
    !functionTriggerSourceDigests.has(
      policy.sourceDigests.apiFunctionTriggerMigrationSha256,
    )
  ) {
    fail(
      "API functions and triggers must bind the reviewed migration source digest",
    );
  }
  const functionTriggerSource = [...functionTriggerSources][0];
  const functionTriggerMigrationPath = path.resolve(
    migrationRoot,
    ...functionTriggerSource.split("/"),
  );
  const relativeFunctionTriggerMigration = path.relative(
    migrationRoot,
    functionTriggerMigrationPath,
  );
  if (
    relativeFunctionTriggerMigration === ".." ||
    relativeFunctionTriggerMigration.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeFunctionTriggerMigration)
  ) {
    fail("API function/trigger migration source escapes the migration root");
  }
  let functionTriggerMigrationStat;
  try {
    functionTriggerMigrationStat = fs.lstatSync(functionTriggerMigrationPath);
  } catch {
    fail("API function/trigger migration source is missing");
  }
  if (
    !functionTriggerMigrationStat.isFile() ||
    functionTriggerMigrationStat.isSymbolicLink()
  ) {
    fail("API function/trigger migration source is not a regular file");
  }

  if (/\bautoincrement\s*\(/.test(prismaSource)) {
    fail("Prisma schema contains an unclassified sequence source");
  }
  for (const file of migrationTree.files) {
    const source = normalizedText(file);
    if (/\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?SEQUENCE\b/i.test(source)) {
      fail("API migrations contain an unclassified sequence");
    }
    if (
      /\b(?:ALTER|DROP)\s+(?:FUNCTION|PROCEDURE|AGGREGATE|ROUTINE)\b/i.test(
        source,
      ) ||
      /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:PROCEDURE|AGGREGATE|ROUTINE)\b/i.test(
        source,
      ) ||
      /\b(?:ALTER|DROP)\s+(?:(?:CONSTRAINT|EVENT)\s+)?TRIGGER\b/i.test(
        source,
      ) ||
      /\bALTER\s+TABLE\b[\s\S]{0,500}\b(?:ENABLE|DISABLE)\s+(?:(?:ALWAYS|REPLICA)\s+)?TRIGGER\b/i.test(
        source,
      )
    ) {
      fail("API migrations contain unsupported routine or trigger DDL");
    }
  }

  const observedDigests = {
    apiPrismaSchemaSha256: sha256(prismaSource),
    apiMigrationTreeSha256: migrationTree.digest,
    apiFunctionTriggerMigrationSha256: sha256(
      normalizedText(functionTriggerMigrationPath),
    ),
    studioMigrationSha256: sha256(studioSource),
  };
  for (const key of DIGEST_KEYS) {
    if (policy.sourceDigests[key] !== observedDigests[key]) {
      fail(`${key} does not match the reviewed repository`);
    }
  }
  return {
    apiTables: policy.apiRuntimeTables.length,
    studioTables: policy.studioRuntimeTables.length,
    ledgers:
      policy.apiMigrationLedgers.length + policy.studioMigrationLedgers.length,
    enumTypes: policy.apiEnumTypes.length,
    functions: policy.apiFunctions.length,
    triggers: policy.apiTriggers.length,
    sequences: policy.sequences.length,
  };
}

function loadPolicy({ manifestPath, repositoryRoot, verifyRepository = true }) {
  let policy;
  try {
    policy = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    fail("manifest could not be read as JSON");
  }
  validatePolicyShape(policy);
  const counts = verifyRepository
    ? checkRepository(policy, repositoryRoot)
    : null;
  return { policy: canonicalPolicy(policy), counts };
}

function parseArguments(argv) {
  let manifestPath;
  let repositoryRoot;
  let printBase64 = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--manifest" && argv[index + 1]) {
      manifestPath = argv[index + 1];
      index += 1;
    } else if (argument === "--repository-root" && argv[index + 1]) {
      repositoryRoot = argv[index + 1];
      index += 1;
    } else if (argument === "--print-base64") {
      printBase64 = true;
    } else {
      fail("unsupported command-line option");
    }
  }
  if (!manifestPath || !repositoryRoot)
    fail("manifest and repository root are required");
  return { manifestPath, repositoryRoot, printBase64 };
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const { policy, counts } = loadPolicy({
      manifestPath: path.resolve(options.manifestPath),
      repositoryRoot: path.resolve(options.repositoryRoot),
    });
    if (options.printBase64) {
      process.stdout.write(
        Buffer.from(JSON.stringify(policy), "utf8").toString("base64"),
      );
      return;
    }
    process.stdout.write(
      `PRODUCTION DATABASE OBJECT POLICY VERIFIED api_tables=${counts.apiTables} ` +
        `studio_tables=${counts.studioTables} ledgers=${counts.ledgers} ` +
        `enum_types=${counts.enumTypes} functions=${counts.functions} ` +
        `triggers=${counts.triggers} sequences=${counts.sequences}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Policy validation failed"}\n`,
    );
    process.exitCode = 75;
  }
}

if (require.main === module) main();

module.exports = {
  canonicalPolicy,
  checkRepository,
  loadPolicy,
  migrationTreeSha256,
  parseApiFunctionPolicies,
  parseApiTriggerPolicies,
  parsePrismaEnumPolicies,
  parsePrismaEnumNames,
  parsePrismaTableNames,
  parseStudioTableNames,
  validatePolicyShape,
};
