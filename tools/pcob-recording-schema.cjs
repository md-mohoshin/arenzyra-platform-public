const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const {
  resolveRecordingPacketsPath,
} = require("./pcob-live-utils.cjs");

const OBSERVED_SCHEMA_MANIFEST = "arenzyra.pcobObservedSchemaManifest.v1";
const RAW_EVENTS_SCHEMA = "arenzyra.pcobRawEvents.v1";
const RAW_EVENTS_ACK_SCHEMA = "arenzyra.pcobRawEventsAck.v1";

const SNAPSHOT_LIMITATIONS = Object.freeze([
  "The recorder polled /getobserversnapshot; it did not capture original PCOB HTTP requests.",
  "rawRoutePayloads retains only the latest payload per route, so same-route events can be overwritten between polls.",
  "Payloads were JSON-parsed and are not byte-faithful; synthetic rawBodyBase64 values are deterministic reserializations.",
  "Routes, optional fields, enum values, and array element shapes absent from the observed matches remain unknown.",
  "Request headers, query strings, original content types, exact arrival ordering, and upstream queue drops cannot be reconstructed.",
]);

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = canonicalize(value[key]);
    }
    return result;
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sortRecord(record) {
  return Object.fromEntries(
    Object.entries(record || {}).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

class SchemaAccumulator {
  constructor(document = null) {
    this.paths = new Map();
    if (document) {
      this.mergeDocument(document);
    }
  }

  observe(value, rootPath = "$") {
    this.#observe(value, rootPath);
  }

  #observe(value, fieldPath) {
    const type = valueType(value);
    let entry = this.paths.get(fieldPath);
    if (!entry) {
      entry = {
        types: new Set(),
        minArrayLength: null,
        maxArrayLength: null,
        unsafeNumberCount: 0,
      };
      this.paths.set(fieldPath, entry);
    }
    entry.types.add(type);

    if (type === "number" && !Number.isSafeInteger(value)) {
      entry.unsafeNumberCount += 1;
    }

    if (Array.isArray(value)) {
      entry.minArrayLength =
        entry.minArrayLength === null
          ? value.length
          : Math.min(entry.minArrayLength, value.length);
      entry.maxArrayLength =
        entry.maxArrayLength === null
          ? value.length
          : Math.max(entry.maxArrayLength, value.length);
      for (const item of value) {
        this.#observe(item, `${fieldPath}[]`);
      }
      return;
    }

    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        this.#observe(child, `${fieldPath}.${key}`);
      }
    }
  }

  merge(other) {
    const document =
      other instanceof SchemaAccumulator ? other.toDocument() : other;
    this.mergeDocument(document);
  }

  mergeDocument(document) {
    for (const [fieldPath, incoming] of Object.entries(document || {})) {
      let entry = this.paths.get(fieldPath);
      if (!entry) {
        entry = {
          types: new Set(),
          minArrayLength: null,
          maxArrayLength: null,
          unsafeNumberCount: 0,
        };
        this.paths.set(fieldPath, entry);
      }
      for (const type of incoming.types || []) {
        entry.types.add(type);
      }
      if (Number.isInteger(incoming.minArrayLength)) {
        entry.minArrayLength =
          entry.minArrayLength === null
            ? incoming.minArrayLength
            : Math.min(entry.minArrayLength, incoming.minArrayLength);
      }
      if (Number.isInteger(incoming.maxArrayLength)) {
        entry.maxArrayLength =
          entry.maxArrayLength === null
            ? incoming.maxArrayLength
            : Math.max(entry.maxArrayLength, incoming.maxArrayLength);
      }
      entry.unsafeNumberCount += Number(incoming.unsafeNumberCount || 0);
    }
  }

  toDocument() {
    const result = {};
    for (const [fieldPath, entry] of [...this.paths].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      result[fieldPath] = {
        types: [...entry.types].sort(),
        ...(entry.minArrayLength === null
          ? {}
          : {
              minArrayLength: entry.minArrayLength,
              maxArrayLength: entry.maxArrayLength,
            }),
        ...(entry.unsafeNumberCount > 0
          ? { unsafeNumberCount: entry.unsafeNumberCount }
          : {}),
      };
    }
    return result;
  }
}

function eventTimestamp(value, fallback) {
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString();
  }
  return fallback;
}

function deriveSyntheticStreamId(snapshot, fallbackSeed = "unknown") {
  const sessionId = String(snapshot?.sessionId || "").trim();
  const matchId = String(snapshot?.activeMatchId || "").trim();
  if (sessionId || matchId) {
    return `snapshot:${sessionId || "no-session"}:${matchId || "no-match"}`;
  }
  return `snapshot:${sha256(String(fallbackSeed)).slice(0, 24)}`;
}

function materializeSyntheticEvent(candidate, streamId, sequence) {
  const endpoint = String(candidate.endpoint || "/");
  const method = "POST";
  const query = typeof candidate.query === "string" ? candidate.query : "";
  const requestTarget = `${endpoint}${query ? `?${query}` : ""}`;
  const body = canonicalJson(candidate.payload ?? null);
  const bodyBuffer = Buffer.from(body, "utf8");
  const bodySha256 = sha256(bodyBuffer);
  const eventId = sha256(
    [
      streamId,
      sequence,
      candidate.receivedAt,
      method,
      requestTarget,
      bodySha256,
    ].join("\n"),
  );

  return {
    eventId,
    sequence,
    endpoint,
    requestTarget,
    method,
    receivedAt: candidate.receivedAt,
    contentType: "application/json",
    query,
    headers: {},
    rawBodyEncoding: "identity",
    rawBodyBase64: bodyBuffer.toString("base64"),
    rawBodyBytes: bodyBuffer.length,
    bodySha256,
    payload: candidate.payload ?? null,
    syntheticFromSnapshot: true,
  };
}

class SnapshotRawEventReconstructor {
  constructor(options = {}) {
    this.streamId = options.streamId || null;
    this.fallbackSeed = options.fallbackSeed || "unknown";
    this.nextSequence = Number.isSafeInteger(options.firstSequence)
      ? options.firstSequence
      : 1;
    this.packetCount = 0;
    this.seenRouteVersions = new Map();
    this.seenKillOccurrences = new Set();
    this.stats = {
      batches: 0,
      events: 0,
      initialStateEvents: 0,
      routeChangeEvents: 0,
      killHistoryEvents: 0,
      byEndpoint: {},
    };
  }

  #hasSeenRouteVersion(endpoint, receivedAt, payload) {
    let versions = this.seenRouteVersions.get(endpoint);
    if (!versions) {
      versions = new Set();
      this.seenRouteVersions.set(endpoint, versions);
    }
    const key = receivedAt || `missing:${sha256(canonicalJson(payload ?? null))}`;
    if (versions.has(key)) {
      return true;
    }
    versions.add(key);
    return false;
  }

  consume(packet, options = {}) {
    const materialize = options.materialize !== false;
    const snapshot = packet?.raw || {};
    this.streamId =
      this.streamId ||
      deriveSyntheticStreamId(
        snapshot,
        `${this.fallbackSeed}:${packet?.capturedAt || packet?.index || 0}`,
      );
    const fallbackReceivedAt = eventTimestamp(
      packet?.capturedAt,
      new Date(0).toISOString(),
    );
    const candidates = [];
    const wrappers = snapshot.rawRoutePayloads || {};
    const hasKillHistory = Array.isArray(snapshot.killInfoEntries);

    if (hasKillHistory) {
      const occurrenceCounts = new Map();
      const chronologicalEntries = [...snapshot.killInfoEntries].reverse();
      for (const entry of chronologicalEntries) {
        const receivedAtMs = Number(entry?.receivedAtMs);
        const receivedAt = Number.isFinite(receivedAtMs)
          ? new Date(receivedAtMs).toISOString()
          : fallbackReceivedAt;
        const payload = entry?.payload ?? null;
        const baseKey = `${receivedAt}\n${canonicalJson(payload)}`;
        const occurrence = (occurrenceCounts.get(baseKey) || 0) + 1;
        occurrenceCounts.set(baseKey, occurrence);
        const identity = `${baseKey}\n${occurrence}`;
        if (this.seenKillOccurrences.has(identity)) {
          continue;
        }
        this.seenKillOccurrences.add(identity);
        candidates.push({
          endpoint: "/setkillinfo",
          receivedAt,
          payload,
          occurrence,
          origin: "kill-history",
        });
      }
    }

    for (const endpoint of Object.keys(wrappers).sort()) {
      const wrapper = wrappers[endpoint] || {};
      const receivedAt = eventTimestamp(wrapper.receivedAt, fallbackReceivedAt);
      if (
        this.#hasSeenRouteVersion(endpoint, wrapper.receivedAt, wrapper.payload)
      ) {
        continue;
      }
      if (endpoint === "/setkillinfo" && hasKillHistory) {
        continue;
      }
      candidates.push({
        endpoint,
        receivedAt,
        payload: wrapper.payload ?? null,
        occurrence: 1,
        origin: this.packetCount === 0 ? "initial-state" : "route-change",
      });
    }

    candidates.sort((left, right) => {
      const leftMs = Date.parse(left.receivedAt);
      const rightMs = Date.parse(right.receivedAt);
      if (leftMs !== rightMs) return leftMs - rightMs;
      const endpointOrder = left.endpoint.localeCompare(right.endpoint);
      if (endpointOrder !== 0) return endpointOrder;
      const bodyOrder = canonicalJson(left.payload).localeCompare(
        canonicalJson(right.payload),
      );
      if (bodyOrder !== 0) return bodyOrder;
      return left.occurrence - right.occurrence;
    });

    const events = [];
    for (const candidate of candidates) {
      const sequence = this.nextSequence;
      this.nextSequence += 1;
      const event = materialize
        ? materializeSyntheticEvent(candidate, this.streamId, sequence)
        : {
            sequence,
            endpoint: candidate.endpoint,
            receivedAt: candidate.receivedAt,
            syntheticFromSnapshot: true,
          };
      events.push(event);
      this.stats.events += 1;
      this.stats.byEndpoint[candidate.endpoint] =
        (this.stats.byEndpoint[candidate.endpoint] || 0) + 1;
      if (candidate.origin === "kill-history") {
        this.stats.killHistoryEvents += 1;
      } else if (candidate.origin === "initial-state") {
        this.stats.initialStateEvents += 1;
      } else {
        this.stats.routeChangeEvents += 1;
      }
    }

    this.packetCount += 1;
    if (events.length === 0) {
      return null;
    }
    this.stats.batches += 1;
    return {
      schema: RAW_EVENTS_SCHEMA,
      streamId: this.streamId,
      firstSequence: events[0].sequence,
      lastSequence: events[events.length - 1].sequence,
      events,
      syntheticFromSnapshot: true,
    };
  }
}

function validateRawEventsAck(ack, batch) {
  const errors = [];
  if (!ack || typeof ack !== "object") {
    return { ok: false, errors: ["rawEventsAck is missing"] };
  }
  if (ack.schema !== RAW_EVENTS_ACK_SCHEMA) {
    errors.push(
      `rawEventsAck.schema expected ${RAW_EVENTS_ACK_SCHEMA}, received ${String(ack.schema)}`,
    );
  }
  if (ack.streamId !== batch.streamId) {
    errors.push(
      `rawEventsAck.streamId expected ${batch.streamId}, received ${String(ack.streamId)}`,
    );
  }
  const highestContiguousSequence = ack.highestContiguousSequence;
  if (
    typeof highestContiguousSequence !== "number" ||
    !Number.isSafeInteger(highestContiguousSequence) ||
    highestContiguousSequence !== batch.lastSequence
  ) {
    errors.push(
      `rawEventsAck.highestContiguousSequence expected ${batch.lastSequence}, received ${String(ack.highestContiguousSequence)}`,
    );
  }
  const accepted = ack.accepted;
  const duplicates = ack.duplicates;
  const countsAreValid =
    typeof accepted === "number" &&
    Number.isSafeInteger(accepted) &&
    accepted >= 0 &&
    typeof duplicates === "number" &&
    Number.isSafeInteger(duplicates) &&
    duplicates >= 0;
  const accounted = accepted + duplicates;
  if (!countsAreValid || accounted !== batch.events.length) {
    errors.push(
      `rawEventsAck accounted for ${accounted}/${batch.events.length} events`,
    );
  }
  return { ok: errors.length === 0, errors };
}

async function* readJsonl(filePath) {
  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    const normalized = line.replace(/^\uFEFF/, "").trim();
    if (!normalized) continue;
    yield { line: normalized, lineNumber };
  }
}

function readRecordingMetadata(packetsPath) {
  const metadataPath = path.join(path.dirname(packetsPath), "metadata.json");
  if (!fs.existsSync(metadataPath)) return null;
  return JSON.parse(fs.readFileSync(metadataPath, "utf8"));
}

function increment(record, key, amount = 1) {
  const normalized = String(key ?? "null");
  record[normalized] = (record[normalized] || 0) + amount;
}

function newRouteAnalysis() {
  return {
    rawSchema: new SchemaAccumulator(),
    reducedSchema: new SchemaAccumulator(),
    versions: new Set(),
    snapshotPresence: 0,
    phases: {},
    firstPacket: null,
    lastPacket: null,
    firstReceivedAt: null,
    lastReceivedAt: null,
  };
}

function observeSnapshotWithoutRouteMaps(accumulator, snapshot) {
  accumulator.observe({}, "$");
  for (const [key, value] of Object.entries(snapshot || {})) {
    if (key === "routePayloads" || key === "rawRoutePayloads") continue;
    accumulator.observe(value, `$.${key}`);
  }
}

async function analyzeRecording(recordingPath, options = {}) {
  const packetsPath = resolveRecordingPacketsPath(recordingPath);
  if (!fs.existsSync(packetsPath)) {
    throw new Error(`Recording packets file not found: ${packetsPath}`);
  }
  const metadata = readRecordingMetadata(packetsPath);
  const recordingId =
    options.recordingId || path.basename(path.dirname(packetsPath));
  const snapshotSchema = new SchemaAccumulator();
  const routes = new Map();
  const reconstructor = new SnapshotRawEventReconstructor({
    streamId: options.streamId,
    fallbackSeed: recordingId,
  });
  const packetSchemas = {};
  const statuses = {};
  const endpoints = {};
  const maps = {};
  const phases = {};
  const parseErrors = [];
  const indexErrors = [];
  const hashErrors = [];
  const changeFlagErrors = [];
  const metadataErrors = [];
  const rawReducedRouteMismatches = [];
  let packetCount = 0;
  let okPacketCount = 0;
  let changedPacketCount = 0;
  let expectedIndex = null;
  let firstCapturedAt = null;
  let lastCapturedAt = null;
  let previousOkHash = null;

  for await (const { line, lineNumber } of readJsonl(packetsPath)) {
    let packet;
    try {
      packet = JSON.parse(line);
    } catch (error) {
      parseErrors.push({ lineNumber, message: error.message });
      continue;
    }

    packetCount += 1;
    increment(packetSchemas, packet.schema);
    increment(statuses, packet.status);
    increment(endpoints, packet.endpoint);
    firstCapturedAt ??= packet.capturedAt || null;
    lastCapturedAt = packet.capturedAt || lastCapturedAt;

    const packetIndex = Number(packet.index);
    if (expectedIndex === null) {
      expectedIndex = packetIndex;
    }
    if (!Number.isSafeInteger(packetIndex) || packetIndex !== expectedIndex) {
      indexErrors.push({
        lineNumber,
        expected: expectedIndex,
        actual: packet.index,
      });
      expectedIndex = Number.isSafeInteger(packetIndex)
        ? packetIndex + 1
        : expectedIndex + 1;
    } else {
      expectedIndex += 1;
    }

    if (packet.status !== "ok" || !packet.raw) {
      continue;
    }
    okPacketCount += 1;
    if (options.verifyHashes !== false) {
      const computedHash = sha256(JSON.stringify(packet.raw));
      if (packet.hash !== computedHash) {
        hashErrors.push({
          packetIndex,
          expected: packet.hash ?? null,
          actual: computedHash,
        });
      }
      const expectedChanged =
        previousOkHash === null || previousOkHash !== computedHash;
      if (packet.changed !== expectedChanged) {
        changeFlagErrors.push({
          packetIndex,
          expected: expectedChanged,
          actual: packet.changed,
        });
      }
      previousOkHash = computedHash;
    }
    if (packet.changed === true) changedPacketCount += 1;
    const summary = packet.summary || {};
    increment(maps, summary.mapName);
    increment(phases, summary.phase);
    const snapshot = packet.raw;

    if (options.includeSnapshotSchema !== false && packet.changed === true) {
      observeSnapshotWithoutRouteMaps(snapshotSchema, snapshot);
    }

    const rawRoutes = snapshot.rawRoutePayloads || {};
    const reducedRoutes = snapshot.routePayloads || {};
    const rawNames = Object.keys(rawRoutes).sort();
    const reducedNames = Object.keys(reducedRoutes).sort();
    if (canonicalJson(rawNames) !== canonicalJson(reducedNames)) {
      rawReducedRouteMismatches.push({
        packetIndex,
        rawOnly: rawNames.filter((name) => !reducedNames.includes(name)),
        reducedOnly: reducedNames.filter((name) => !rawNames.includes(name)),
      });
    }

    for (const endpoint of rawNames) {
      const wrapper = rawRoutes[endpoint] || {};
      let route = routes.get(endpoint);
      if (!route) {
        route = newRouteAnalysis();
        routes.set(endpoint, route);
      }
      route.snapshotPresence += 1;
      route.firstPacket ??= packetIndex;
      route.lastPacket = packetIndex;
      const versionKey =
        wrapper.receivedAt ||
        `missing:${sha256(canonicalJson(wrapper.payload ?? null))}`;
      if (route.versions.has(versionKey)) continue;
      route.versions.add(versionKey);
      route.firstReceivedAt ??= wrapper.receivedAt || null;
      route.lastReceivedAt = wrapper.receivedAt || route.lastReceivedAt;
      increment(route.phases, summary.phase);
      route.rawSchema.observe(wrapper.payload ?? null);
      if (Object.hasOwn(reducedRoutes, endpoint)) {
        route.reducedSchema.observe(reducedRoutes[endpoint]);
      }
    }

    const rawEvents = reconstructor.consume(packet, { materialize: false });
    if (rawEvents && typeof options.onRawEvents === "function") {
      await options.onRawEvents(rawEvents, packet);
    }
  }

  const routeResult = {};
  for (const [endpoint, route] of [...routes].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    routeResult[endpoint] = {
      observedVersions: route.versions.size,
      snapshotPresence: route.snapshotPresence,
      phases: sortRecord(route.phases),
      firstPacket: route.firstPacket,
      lastPacket: route.lastPacket,
      firstReceivedAt: route.firstReceivedAt,
      lastReceivedAt: route.lastReceivedAt,
      rawPayloadPaths: route.rawSchema.toDocument(),
      reducedPayloadPaths: route.reducedSchema.toDocument(),
    };
  }

  if (metadata) {
    const expectedCounts = {
      total: packetCount,
      ok: okPacketCount,
      error: packetCount - okPacketCount,
      changed: changedPacketCount,
    };
    for (const [key, actual] of Object.entries(expectedCounts)) {
      if (
        metadata.counts?.[key] !== undefined &&
        Number(metadata.counts[key]) !== actual
      ) {
        metadataErrors.push({
          property: `counts.${key}`,
          expected: metadata.counts[key],
          actual,
        });
      }
    }
    const packetBytes = fs.statSync(packetsPath).size;
    if (
      metadata.fileSizeBytes !== undefined &&
      Number(metadata.fileSizeBytes) !== packetBytes
    ) {
      metadataErrors.push({
        property: "fileSizeBytes",
        expected: metadata.fileSizeBytes,
        actual: packetBytes,
      });
    }
    if (
      metadata.endpoint &&
      !Object.hasOwn(endpoints, String(metadata.endpoint))
    ) {
      metadataErrors.push({
        property: "endpoint",
        expected: metadata.endpoint,
        actual: Object.keys(endpoints),
      });
    }
  }

  const result = {
    recordingId,
    packetsPath,
    metadata,
    packetCount,
    okPacketCount,
    changedPacketCount,
    parseErrors,
    indexErrors,
    hashErrors,
    changeFlagErrors,
    metadataErrors,
    rawReducedRouteMismatches,
    packetSchemas: sortRecord(packetSchemas),
    statuses: sortRecord(statuses),
    endpoints: sortRecord(endpoints),
    maps: sortRecord(maps),
    phases: sortRecord(phases),
    firstCapturedAt,
    lastCapturedAt,
    snapshotPaths: snapshotSchema.toDocument(),
    routes: routeResult,
    reconstructedRawEvents: {
      ...reconstructor.stats,
      byEndpoint: sortRecord(reconstructor.stats.byEndpoint),
      streamId: reconstructor.streamId,
      syntheticFromSnapshot: true,
    },
    limitations: [...SNAPSHOT_LIMITATIONS],
  };

  const killVersions = Number(
    result.routes["/setkillinfo"]?.observedVersions || 0,
  );
  result.reconstructedRawEvents.overwrittenKillEventsRecovered = Math.max(
    0,
    result.reconstructedRawEvents.killHistoryEvents - killVersions,
  );
  return result;
}

function mergePathDocuments(documents) {
  const accumulator = new SchemaAccumulator();
  for (const document of documents) accumulator.merge(document);
  return accumulator.toDocument();
}

function manifestSource(analysis, recordingPath) {
  const routeVersions = {};
  for (const [endpoint, route] of Object.entries(analysis.routes)) {
    routeVersions[endpoint] = route.observedVersions;
  }
  return {
    id: analysis.recordingId,
    recording: recordingPath,
    packetCount: analysis.packetCount,
    okPacketCount: analysis.okPacketCount,
    changedPacketCount: analysis.changedPacketCount,
    endpoints: Object.keys(analysis.endpoints),
    maps: analysis.maps,
    phases: analysis.phases,
    routeVersions: sortRecord(routeVersions),
    reconstructedEventCount: analysis.reconstructedRawEvents.events,
    recoveredOverwrittenKillEvents:
      analysis.reconstructedRawEvents.overwrittenKillEventsRecovered,
  };
}

function buildObservedManifest(analyses, options = {}) {
  const sources = analyses
    .map((analysis, index) =>
      manifestSource(
        analysis,
        options.recordingPaths?.[index] || analysis.packetsPath,
      ),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const endpoints = new Set();
  for (const analysis of analyses) {
    for (const endpoint of Object.keys(analysis.routes)) endpoints.add(endpoint);
  }
  const routes = {};
  for (const endpoint of [...endpoints].sort()) {
    const observations = {};
    const rawDocuments = [];
    const reducedDocuments = [];
    for (const analysis of analyses) {
      const route = analysis.routes[endpoint];
      if (!route) continue;
      observations[analysis.recordingId] = {
        observedVersions: route.observedVersions,
        phases: route.phases,
      };
      rawDocuments.push(route.rawPayloadPaths);
      reducedDocuments.push(route.reducedPayloadPaths);
    }
    const rawPayloadPaths = mergePathDocuments(rawDocuments);
    const unknownArrayElementPaths = Object.entries(rawPayloadPaths)
      .filter(
        ([fieldPath, entry]) =>
          entry.types.includes("array") &&
          entry.maxArrayLength === 0 &&
          !Object.hasOwn(rawPayloadPaths, `${fieldPath}[]`),
      )
      .map(([fieldPath]) => fieldPath)
      .sort();
    routes[endpoint] = {
      observations: sortRecord(observations),
      rawPayloadPaths,
      reducedPayloadPaths: mergePathDocuments(reducedDocuments),
      ...(unknownArrayElementPaths.length
        ? { unknownArrayElementPaths }
        : {}),
    };
  }

  return {
    schema: OBSERVED_SCHEMA_MANIFEST,
    version: 1,
    captureModel: {
      endpoint: "/getobserversnapshot",
      pollIntervalMs: 250,
      rawRoutePayloadSemantics: "latest-payload-per-route",
      rawEventsReconstruction: "synthetic-lower-bound",
    },
    sources,
    observerSnapshotPaths: mergePathDocuments(
      analyses.map((analysis) => analysis.snapshotPaths),
    ),
    routes,
    limitations: [...SNAPSHOT_LIMITATIONS],
  };
}

function comparePathDocuments(expected, actual, options = {}) {
  const exact = options.exact !== false;
  const missing = [];
  const unexpected = [];
  const typeMismatches = [];
  const observationMismatches = [];
  for (const [fieldPath, expectedEntry] of Object.entries(expected || {})) {
    const actualEntry = actual?.[fieldPath];
    if (!actualEntry) {
      if (exact) missing.push(fieldPath);
      continue;
    }
    const expectedTypes = new Set(expectedEntry.types || []);
    const actualTypes = new Set(actualEntry.types || []);
    const badActual = [...actualTypes].filter((type) => !expectedTypes.has(type));
    const absentExpected = exact
      ? [...expectedTypes].filter((type) => !actualTypes.has(type))
      : [];
    if (badActual.length || absentExpected.length) {
      typeMismatches.push({
        path: fieldPath,
        expected: [...expectedTypes].sort(),
        actual: [...actualTypes].sort(),
      });
    }
    if (exact) {
      for (const key of ["minArrayLength", "maxArrayLength"]) {
        if ((expectedEntry[key] ?? null) !== (actualEntry[key] ?? null)) {
          observationMismatches.push({
            path: fieldPath,
            property: key,
            expected: expectedEntry[key] ?? null,
            actual: actualEntry[key] ?? null,
          });
        }
      }
      const expectedUnsafe = Number(expectedEntry.unsafeNumberCount || 0) > 0;
      const actualUnsafe = Number(actualEntry.unsafeNumberCount || 0) > 0;
      if (expectedUnsafe !== actualUnsafe) {
        observationMismatches.push({
          path: fieldPath,
          property: "hasUnsafeNumbers",
          expected: expectedUnsafe,
          actual: actualUnsafe,
        });
      }
    }
  }
  for (const fieldPath of Object.keys(actual || {})) {
    if (!Object.hasOwn(expected || {}, fieldPath)) unexpected.push(fieldPath);
  }
  return {
    ok:
      missing.length === 0 &&
      unexpected.length === 0 &&
      typeMismatches.length === 0 &&
      observationMismatches.length === 0,
    missing: missing.sort(),
    unexpected: unexpected.sort(),
    typeMismatches,
    observationMismatches,
  };
}

function compareObservedManifest(expected, actual, options = {}) {
  const exact = options.exact !== false;
  const errors = [];
  const expectedRoutes = Object.keys(expected.routes || {}).sort();
  const actualRoutes = Object.keys(actual.routes || {}).sort();
  if (exact && canonicalJson(expectedRoutes) !== canonicalJson(actualRoutes)) {
    errors.push({
      scope: "routes",
      missing: expectedRoutes.filter((route) => !actualRoutes.includes(route)),
      unexpected: actualRoutes.filter((route) => !expectedRoutes.includes(route)),
    });
  } else {
    const unexpected = actualRoutes.filter((route) => !expectedRoutes.includes(route));
    if (unexpected.length) {
      errors.push({ scope: "routes", missing: [], unexpected });
    }
  }

  for (const endpoint of actualRoutes) {
    if (!expected.routes?.[endpoint]) continue;
    for (const key of ["rawPayloadPaths", "reducedPayloadPaths"]) {
      const comparison = comparePathDocuments(
        expected.routes[endpoint][key],
        actual.routes[endpoint][key],
        { exact },
      );
      if (!comparison.ok) {
        errors.push({ scope: `${endpoint}.${key}`, ...comparison });
      }
    }
  }

  if (options.compareSnapshot !== false) {
    const comparison = comparePathDocuments(
      expected.observerSnapshotPaths,
      actual.observerSnapshotPaths,
      { exact },
    );
    if (!comparison.ok) {
      errors.push({ scope: "observerSnapshotPaths", ...comparison });
    }
  }

  if (options.compareSources === true) {
    const expectedSources = new Map(
      (expected.sources || []).map((source) => [source.id, source]),
    );
    for (const source of actual.sources || []) {
      const baseline = expectedSources.get(source.id);
      if (!baseline) {
        errors.push({ scope: `source.${source.id}`, message: "unexpected source" });
        continue;
      }
      for (const key of [
        "packetCount",
        "okPacketCount",
        "changedPacketCount",
        "reconstructedEventCount",
        "recoveredOverwrittenKillEvents",
      ]) {
        if (source[key] !== baseline[key]) {
          errors.push({
            scope: `source.${source.id}.${key}`,
            expected: baseline[key],
            actual: source[key],
          });
        }
      }
      if (canonicalJson(source.routeVersions) !== canonicalJson(baseline.routeVersions)) {
        errors.push({
          scope: `source.${source.id}.routeVersions`,
          expected: baseline.routeVersions,
          actual: source.routeVersions,
        });
      }
      for (const key of ["endpoints", "maps", "phases"]) {
        if (canonicalJson(source[key]) !== canonicalJson(baseline[key])) {
          errors.push({
            scope: `source.${source.id}.${key}`,
            expected: baseline[key],
            actual: source[key],
          });
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  OBSERVED_SCHEMA_MANIFEST,
  RAW_EVENTS_ACK_SCHEMA,
  RAW_EVENTS_SCHEMA,
  SNAPSHOT_LIMITATIONS,
  SchemaAccumulator,
  SnapshotRawEventReconstructor,
  analyzeRecording,
  buildObservedManifest,
  canonicalJson,
  compareObservedManifest,
  comparePathDocuments,
  deriveSyntheticStreamId,
  materializeSyntheticEvent,
  readJsonl,
  validateRawEventsAck,
};
