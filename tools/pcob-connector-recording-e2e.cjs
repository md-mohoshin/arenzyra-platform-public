#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const axios = require('axios');

const {
  parseArgs,
  resolveRecordingPacketsPath,
  sleep,
  stringArg,
} = require('./pcob-live-utils.cjs');
const { readJsonl } = require('./pcob-recording-schema.cjs');
const {
  isLoopbackHostname,
  replayRecordingToConnector,
} = require('./pcob-local-connector-replay.cjs');

const LOOPBACK_HOST = '127.0.0.1';
const RAW_EVENT_SCHEMA = 'arenzyra.pcobRawEvents.v1';
const RAW_EVENT_ACK_SCHEMA = 'arenzyra.pcobRawEventsAck.v1';
const TELEMETRY_PATH = '/api/observer/telemetry';
const TEMP_PREFIX = 'arenzyra-pcob-connector-e2e-';
const MAX_BACKEND_BODY_BYTES = 12 * 1024 * 1024;

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function printHelp() {
  process.stdout.write([
    'PCOB connector recording end-to-end verifier',
    '',
    'Usage:',
    '  node tools/pcob-connector-recording-e2e.cjs --recording DIR_OR_JSONL [options]',
    '',
    'Options:',
    '  --recording PATH       Recording directory or packets.jsonl (required)',
    '  --speed N              Replay speed; 0 disables waits. Default: 10',
    '  --expected-map NAME    Optional expected final map',
    '  --help                 Show this help',
    '',
    'The verifier starts only isolated ephemeral loopback services and a temp spool.',
    '',
  ].join('\n'));
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textValue(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeMapName(value) {
  let normalized = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const aliases = {
    NEON: 'RONDO',
    NEONMAIN: 'RONDO',
    DIHOROTOK: 'VIKENDI',
    DIHOROTOKMAIN: 'VIKENDI',
    BALTIC: 'ERANGEL',
    BALTICMAIN: 'ERANGEL',
    DESERT: 'MIRAMAR',
    DESERTMAIN: 'MIRAMAR',
    SAVAGE: 'SANHOK',
    SAVAGEMAIN: 'SANHOK',
  };
  if (aliases[normalized]) return aliases[normalized];
  if (normalized.endsWith('MAIN')) {
    normalized = normalized.slice(0, -4);
  }
  return aliases[normalized] || normalized;
}

function flightPathFromObject(value) {
  if (!value || typeof value !== 'object') return null;
  const nested = value.flightPath;
  if (nested && typeof nested === 'object') {
    const startX = finiteNumber(nested.start && nested.start.x);
    const startY = finiteNumber(nested.start && nested.start.y);
    const endX = finiteNumber(nested.end && nested.end.x);
    const endY = finiteNumber(nested.end && nested.end.y);
    if ([startX, startY, endX, endY].every(Number.isFinite)) {
      return {
        start: { x: startX, y: startY },
        end: { x: endX, y: endY },
      };
    }
  }
  const startX = finiteNumber(
    value.PlaneStartLocX ?? value.planeStartLocX ?? value.PlaneStartX ?? value.planeStartX,
  );
  const startY = finiteNumber(
    value.PlaneStartLocY ?? value.planeStartLocY ?? value.PlaneStartY ?? value.planeStartY,
  );
  const endX = finiteNumber(
    value.PlaneStopLocX ?? value.planeStopLocX ?? value.PlaneStopX ?? value.planeStopX,
  );
  const endY = finiteNumber(
    value.PlaneStopLocY ?? value.planeStopLocY ?? value.PlaneStopY ?? value.planeStopY,
  );
  if (![startX, startY, endX, endY].every(Number.isFinite)) return null;
  return {
    start: { x: startX, y: startY },
    end: { x: endX, y: endY },
  };
}

async function inspectRecording(recording) {
  const packetsPath = path.resolve(resolveRecordingPacketsPath(recording));
  let inferredMap = null;
  let expectedFlightPath = null;
  let validPackets = 0;
  for await (const { line, lineNumber } of readJsonl(packetsPath)) {
    let packet;
    try {
      packet = JSON.parse(line);
    } catch (error) {
      throw new Error(
        'Invalid JSON at ' + packetsPath + ':' + lineNumber + ': ' + error.message,
      );
    }
    if (packet.status !== 'ok' || !packet.raw || typeof packet.raw !== 'object') {
      continue;
    }
    validPackets += 1;
    inferredMap =
      textValue(packet.raw.mapName) ||
      textValue(packet.summary && packet.summary.mapName) ||
      inferredMap;
    const rawGlobal =
      packet.raw.rawRoutePayloads &&
      packet.raw.rawRoutePayloads['/setgameglobalinfo'];
    const reducedGlobal =
      packet.raw.routePayloads &&
      packet.raw.routePayloads['/setgameglobalinfo'];
    const candidates = [
      rawGlobal && rawGlobal.payload,
      reducedGlobal,
      packet.raw.allInfo,
      packet.raw.normalized,
    ];
    for (const candidate of candidates) {
      expectedFlightPath = flightPathFromObject(candidate) || expectedFlightPath;
    }
  }
  assertCondition(validPackets > 0, 'Recording contains no successful snapshot packets');
  return {
    packetsPath,
    inferredMap,
    expectedFlightPath,
    validPackets,
  };
}

function normalizedPath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function createSafeTempRoot() {
  const tempParent = path.resolve(os.tmpdir());
  const root = fs.mkdtempSync(path.join(tempParent, TEMP_PREFIX));
  assertSafeTempRoot(root);
  return root;
}

function assertSafeTempRoot(root) {
  const resolved = path.resolve(root);
  const tempParent = path.resolve(os.tmpdir());
  assertCondition(
    normalizedPath(path.dirname(resolved)) === normalizedPath(tempParent),
    'Refusing temp cleanup outside the operating-system temp directory',
  );
  assertCondition(
    path.basename(resolved).startsWith(TEMP_PREFIX),
    'Refusing temp cleanup for an unexpected directory name',
  );
  const stat = fs.lstatSync(resolved);
  assertCondition(stat.isDirectory() && !stat.isSymbolicLink(), 'Unsafe temp root type');
  const realParent = fs.realpathSync.native(tempParent);
  const realRoot = fs.realpathSync.native(resolved);
  assertCondition(
    normalizedPath(path.dirname(realRoot)) === normalizedPath(realParent),
    'Refusing temp cleanup through a redirected path',
  );
  return resolved;
}

function removeSafeTempRoot(root) {
  const verified = assertSafeTempRoot(root);
  fs.rmSync(verified, { recursive: true, force: true });
}

function isLoopbackRemote(remoteAddress) {
  const value = String(remoteAddress || '').toLowerCase();
  return (
    value === '127.0.0.1' ||
    value === '::1' ||
    value.startsWith('127.') ||
    value.startsWith('::ffff:127.')
  );
}

function sendJson(response, status, body) {
  const encoded = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': String(encoded.length),
    'Cache-Control': 'no-store',
  });
  response.end(encoded);
}

async function readRequestBody(request, maximumBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maximumBytes) {
      throw new Error('telemetry_request_too_large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function decodeCanonicalBase64(value) {
  assertCondition(
    typeof value === 'string' &&
      value.length % 4 === 0 &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(value),
    'rawBodyBase64 is not canonical base64',
  );
  const decoded = Buffer.from(value, 'base64');
  assertCondition(
    decoded.toString('base64') === value,
    'rawBodyBase64 has a non-canonical representation',
  );
  return decoded;
}

function eventMetadataSignature(event) {
  return JSON.stringify({
    eventId: event.eventId,
    sequence: event.sequence,
    endpoint: event.endpoint,
    requestTarget: event.requestTarget,
    method: event.method,
    receivedAt: event.receivedAt,
    contentType: event.contentType ?? null,
    query: event.query,
    headers: event.headers,
    rawBodyBytes: event.rawBodyBytes,
    bodySha256: event.bodySha256,
  });
}

function validateTransportEvent(event, streamId, expectedSequence) {
  assertCondition(event && typeof event === 'object', 'raw event must be an object');
  assertCondition(
    Number.isSafeInteger(event.sequence) && event.sequence === expectedSequence,
    'raw event sequence is not contiguous within its envelope',
  );
  assertCondition(event.method === 'POST', 'raw event method must be POST');
  assertCondition(
    typeof event.requestTarget === 'string' &&
      event.requestTarget.startsWith('/') &&
      !event.requestTarget.startsWith('//') &&
      Buffer.byteLength(event.requestTarget) <= 16 * 1024,
    'raw event requestTarget is unsafe',
  );
  const separator = event.requestTarget.indexOf('?');
  const expectedEndpoint =
    separator >= 0 ? event.requestTarget.slice(0, separator) : event.requestTarget;
  const expectedQuery =
    separator >= 0 ? event.requestTarget.slice(separator + 1) : '';
  assertCondition(event.endpoint === expectedEndpoint, 'endpoint/requestTarget mismatch');
  assertCondition(event.query === expectedQuery, 'query/requestTarget mismatch');
  assertCondition(
    event.contentType === null || typeof event.contentType === 'string',
    'contentType must be a string or null',
  );
  assertCondition(
    event.headers && typeof event.headers === 'object' && !Array.isArray(event.headers),
    'raw event headers must be an object',
  );
  assertCondition(
    typeof event.receivedAt === 'string' && Number.isFinite(Date.parse(event.receivedAt)),
    'raw event receivedAt is invalid',
  );
  assertCondition(
    event.rawBodyEncoding === 'identity' || event.rawBodyEncoding === 'gzip',
    'unsupported rawBodyEncoding',
  );
  let body = decodeCanonicalBase64(event.rawBodyBase64);
  if (event.rawBodyEncoding === 'gzip') {
    body = zlib.gunzipSync(body);
  }
  assertCondition(
    Number.isSafeInteger(event.rawBodyBytes) &&
      event.rawBodyBytes >= 0 &&
      event.rawBodyBytes === body.length,
    'rawBodyBytes does not match decoded body',
  );
  const bodySha256 = crypto.createHash('sha256').update(body).digest('hex');
  assertCondition(
    event.bodySha256 === bodySha256,
    'bodySha256 does not match decoded body',
  );
  const expectedEventId = crypto
    .createHash('sha256')
    .update(
      streamId +
        '\n' +
        event.sequence +
        '\n' +
        event.receivedAt +
        '\n' +
        event.method +
        '\n' +
        event.requestTarget +
        '\n' +
        bodySha256,
    )
    .digest('hex');
  assertCondition(event.eventId === expectedEventId, 'raw eventId is invalid');
  return {
    signature: eventMetadataSignature(event),
    endpoint: event.endpoint,
  };
}

function sortedObject(value) {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function createFakeAckBackend() {
  const state = {
    requests: 0,
    rawBatches: 0,
    legacySnapshots: 0,
    streamId: null,
    highestContiguousSequence: 0,
    events: new Map(),
    routeCounts: {},
    validationErrors: [],
  };

  function acceptEnvelope(envelope) {
    assertCondition(
      envelope && typeof envelope === 'object',
      'rawEvents must be an object',
    );
    assertCondition(envelope.schema === RAW_EVENT_SCHEMA, 'unexpected rawEvents schema');
    assertCondition(
      typeof envelope.streamId === 'string' && envelope.streamId.length > 0,
      'rawEvents streamId is missing',
    );
    assertCondition(
      state.streamId === null || state.streamId === envelope.streamId,
      'multiple raw event streams were received',
    );
    state.streamId = envelope.streamId;
    assertCondition(
      Array.isArray(envelope.events) && envelope.events.length > 0,
      'empty rawEvents envelopes are forbidden',
    );
    assertCondition(
      Number.isSafeInteger(envelope.firstSequence) &&
        Number.isSafeInteger(envelope.lastSequence) &&
        envelope.firstSequence >= 1 &&
        envelope.lastSequence === envelope.firstSequence + envelope.events.length - 1,
      'rawEvents envelope sequence bounds are invalid',
    );
    let accepted = 0;
    let duplicates = 0;
    const validated = [];
    for (let index = 0; index < envelope.events.length; index += 1) {
      const event = envelope.events[index];
      const sequence = envelope.firstSequence + index;
      const result = validateTransportEvent(event, envelope.streamId, sequence);
      const existing = state.events.get(sequence);
      if (existing) {
        assertCondition(
          existing.signature === result.signature,
          'duplicate sequence changed metadata',
        );
        duplicates += 1;
      } else {
        accepted += 1;
      }
      validated.push({ event, result, existing });
    }
    for (const record of validated) {
      if (record.existing) continue;
      state.events.set(record.event.sequence, record.result);
      state.routeCounts[record.result.endpoint] =
        (state.routeCounts[record.result.endpoint] || 0) + 1;
    }
    while (state.events.has(state.highestContiguousSequence + 1)) {
      state.highestContiguousSequence += 1;
    }
    state.rawBatches += 1;
    return {
      schema: RAW_EVENT_ACK_SCHEMA,
      streamId: envelope.streamId,
      highestContiguousSequence: state.highestContiguousSequence,
      accepted,
      duplicates,
    };
  }

  const server = http.createServer(async (request, response) => {
    state.requests += 1;
    try {
      assertCondition(
        isLoopbackRemote(request.socket.remoteAddress),
        'non-loopback backend request rejected',
      );
      assertCondition(
        request.method === 'POST' && request.url === TELEMETRY_PATH,
        'unexpected fake-backend route',
      );
      const body = await readRequestBody(request, MAX_BACKEND_BODY_BYTES);
      const payload = JSON.parse(body.toString('utf8'));
      assertCondition(
        payload && typeof payload === 'object' && !Array.isArray(payload),
        'telemetry payload must be an object',
      );
      if (!Object.prototype.hasOwnProperty.call(payload, 'rawEvents')) {
        state.legacySnapshots += 1;
        sendJson(response, 200, { ok: true });
        return;
      }
      const acknowledgement = acceptEnvelope(payload.rawEvents);
      sendJson(response, 200, {
        ok: true,
        rawEventsAck: acknowledgement,
      });
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      state.validationErrors.push(message);
      sendJson(response, 422, { ok: false, error: message });
    }
  });

  return {
    server,
    state,
    snapshot() {
      return {
        requests: state.requests,
        rawBatches: state.rawBatches,
        legacySnapshots: state.legacySnapshots,
        streamId: state.streamId,
        highestContiguousSequence: state.highestContiguousSequence,
        uniqueEvents: state.events.size,
        sequences: Array.from(state.events.keys()).sort((left, right) => left - right),
        routeCounts: sortedObject(state.routeCounts),
        validationErrors: [...state.validationErrors],
      };
    },
  };
}

async function listenLoopback(server) {
  server.listen(0, LOOPBACK_HOST);
  await once(server, 'listening');
  const address = server.address();
  assertCondition(address && typeof address === 'object', 'Backend did not bind a port');
  return address.port;
}

async function allocateFreeLoopbackPort() {
  const server = net.createServer();
  server.listen(0, LOOPBACK_HOST);
  await once(server, 'listening');
  const address = server.address();
  assertCondition(address && typeof address === 'object', 'Could not allocate connector port');
  const port = address.port;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

function boundedOutputAppend(current, chunk) {
  const next = current + chunk.toString('utf8');
  return next.length <= 64 * 1024 ? next : next.slice(next.length - 64 * 1024);
}

async function startConnector(options) {
  const repositoryRoot = path.resolve(__dirname, '..');
  const connectorPath = path.join(repositoryRoot, 'ob.js');
  assertCondition(fs.statSync(connectorPath).isFile(), 'ob.js was not found');
  const output = { stdout: '', stderr: '' };
  const child = spawn(process.execPath, [connectorPath], {
    cwd: repositoryRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HOST: LOOPBACK_HOST,
      BIND_HOST: LOOPBACK_HOST,
      PORT: String(options.port),
      FORWARD_ENABLE: 'false',
      FORWARD_BASE_URL: 'http://127.0.0.1:9',
      OBSERVER_FORWARD_ENABLE: 'true',
      API_BASE_URL: options.backendBase,
      MATCH_ID: options.matchId,
      OBSERVER_MATCH_ID: options.matchId,
      PCOB_MATCH_ID: options.matchId,
      OBSERVER_SESSION_ID: options.sessionId,
      SESSION_ID: options.sessionId,
      OBSERVER_FEED_TOKEN: '',
      ARENZYRA_OBSERVER_FEED_TOKEN: '',
      // Snapshot recordings retained mapName as derived snapshot metadata, not
      // as a recoverable PCOB route. Supply the same verified match-map input
      // that the launcher normally gives the connector, while clearing every
      // inherited alternative override.
      ARENZYRA_FORCE_MAP_KEY: options.expectedMap,
      ARENZYRA_MAP_KEY: '',
      OBSERVER_MAP_NAME: '',
      OBSERVER_MAP_KEY: '',
      MATCH_MAP_NAME: '',
      MAP_NAME: '',
      PCOB_EVENT_SPOOL_DIR: path.join(options.tempRoot, 'spool'),
      PCOB_RAW_EVENT_CAPTURE_ENABLE: 'true',
      ARENZYRA_PCOB_CONNECTOR_TOKEN: options.localReadToken,
      // Keep the production default at one second. This isolated verifier can
      // drain large recordings faster without weakening batching or ACK rules.
      OBSERVER_TELEMETRY_INTERVAL_MS: '100',
      OBTOOLS_VERBOSE_LOG: 'false',
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      ALL_PROXY: '',
      http_proxy: '',
      https_proxy: '',
      all_proxy: '',
      NO_PROXY: '127.0.0.1,localhost,::1',
      no_proxy: '127.0.0.1,localhost,::1',
    },
  });
  child.stdout.on('data', (chunk) => {
    output.stdout = boundedOutputAppend(output.stdout, chunk);
  });
  child.stderr.on('data', (chunk) => {
    output.stderr = boundedOutputAppend(output.stderr, chunk);
  });
  await Promise.race([
    once(child, 'spawn'),
    once(child, 'error').then(([error]) => Promise.reject(error)),
  ]);
  return { child, output };
}

function childFailureMessage(connector) {
  const pieces = [
    'isolated connector exited before verification completed',
    connector.output.stderr.trim(),
    connector.output.stdout.trim(),
  ].filter(Boolean);
  return pieces.join(': ');
}

function childIsStopped(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForConnectorHealth(
  client,
  connectorBase,
  connector,
  timeoutMs,
  localReadToken,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (childIsStopped(connector.child)) {
      throw new Error(childFailureMessage(connector));
    }
    try {
      const response = await client.get(connectorBase + '/health', {
        headers: { 'X-Arenzyra-Connector-Token': localReadToken },
        validateStatus: () => true,
      });
      if (
        response.status === 200 &&
        response.data &&
        response.data.status === 'ok' &&
        response.data.rawEventStatus === 'ok'
      ) {
        assertCondition(
          response.data.forwardEnabled === false,
          'isolated connector legacy forwarding was not disabled',
        );
        return response.data;
      }
      lastError = new Error('health response was not ready');
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(
    'Timed out waiting for isolated connector health' +
      (lastError && lastError.message ? ': ' + lastError.message : ''),
  );
}

async function getProtectedMetrics(client, connectorBase, token) {
  const response = await client.get(connectorBase + '/debug/pcob-event-metrics', {
    headers: { 'X-Arenzyra-Connector-Token': token },
    validateStatus: () => true,
  });
  assertCondition(
    response.status === 200,
    'Protected connector metrics returned HTTP ' + response.status,
  );
  return response.data;
}

async function waitForQueuesToDrain(options) {
  const deadline = Date.now() + options.timeoutMs;
  let lastMetrics = null;
  let lastBackend = null;
  while (Date.now() < deadline) {
    if (childIsStopped(options.connector.child)) {
      throw new Error(childFailureMessage(options.connector));
    }
    lastBackend = options.backend.snapshot();
    assertCondition(
      lastBackend.validationErrors.length === 0,
      'Fake backend rejected telemetry: ' + lastBackend.validationErrors.join('; '),
    );
    lastMetrics = await getProtectedMetrics(
      options.client,
      options.connectorBase,
      options.localReadToken,
    );
    const drained =
      lastBackend.uniqueEvents === options.expectedEvents &&
      lastBackend.highestContiguousSequence === options.expectedEvents &&
      lastMetrics &&
      lastMetrics.rawEvents &&
      lastMetrics.rawEvents.acknowledgedSequence === options.expectedEvents &&
      lastMetrics.rawEvents.pendingEvents === 0 &&
      lastMetrics.handlerQueue &&
      lastMetrics.handlerQueue.pendingEvents === 0 &&
      lastMetrics.forwardQueue &&
      lastMetrics.forwardQueue.pendingEvents === 0;
    if (drained) {
      return { metrics: lastMetrics, backend: lastBackend };
    }
    await sleep(100);
  }
  throw new Error(
    'Timed out draining connector queues: ' +
      JSON.stringify({
        expectedEvents: options.expectedEvents,
        backend: lastBackend,
        metrics: lastMetrics,
      }),
  );
}

function assertAllNumericZero(value, label) {
  assertCondition(value && typeof value === 'object', label + ' metrics are missing');
  for (const [key, count] of Object.entries(value)) {
    assertCondition(
      typeof count === 'number' && count === 0,
      label + '.' + key + ' expected 0, received ' + count,
    );
  }
}

function assertRouteCounts(actual, expected, label) {
  const normalizedActual = sortedObject(actual);
  const normalizedExpected = sortedObject(expected);
  assertCondition(
    JSON.stringify(normalizedActual) === JSON.stringify(normalizedExpected),
    label +
      ' route counts differ: expected ' +
      JSON.stringify(normalizedExpected) +
      ', received ' +
      JSON.stringify(normalizedActual),
  );
}

function assertRetainedRouteCountsAreBounded(actual, expected) {
  for (const [endpoint, count] of Object.entries(actual)) {
    assertCondition(
      Object.prototype.hasOwnProperty.call(expected, endpoint),
      'Connector retained an unexpected route: ' + endpoint,
    );
    assertCondition(
      Number.isSafeInteger(count) && count >= 0 && count <= expected[endpoint],
      'Connector retained route count is outside its lifetime total: ' + endpoint,
    );
  }
}

function connectorRouteCounts(metrics) {
  return Object.fromEntries(
    (metrics.rawEvents.routes || [])
      .map((route) => [route.endpoint, route.retainedEvents])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function assertContiguousSequences(sequences, expectedCount) {
  assertCondition(
    sequences.length === expectedCount,
    'Unique raw event count does not equal posted reconstructed count',
  );
  for (let index = 0; index < expectedCount; index += 1) {
    assertCondition(
      sequences[index] === index + 1,
      'Raw event sequence gap at expected sequence ' + (index + 1),
    );
  }
}

function flightPathCoordinates(value) {
  if (!value || typeof value !== 'object') return null;
  const coordinates = {
    start: {
      x: finiteNumber(value.start && value.start.x),
      y: finiteNumber(value.start && value.start.y),
    },
    end: {
      x: finiteNumber(value.end && value.end.x),
      y: finiteNumber(value.end && value.end.y),
    },
  };
  return [
    coordinates.start.x,
    coordinates.start.y,
    coordinates.end.x,
    coordinates.end.y,
  ].every(Number.isFinite)
    ? coordinates
    : null;
}

function assertFlightPathEquals(actual, expected, label) {
  const normalized = flightPathCoordinates(actual);
  assertCondition(normalized, label + ' flightPath is missing or invalid');
  for (const point of ['start', 'end']) {
    for (const axis of ['x', 'y']) {
      assertCondition(
        Math.abs(normalized[point][axis] - expected[point][axis]) < 1e-9,
        label + ' flightPath ' + point + '.' + axis + ' differs from recording',
      );
    }
  }
  return normalized;
}

async function getJson(client, url) {
  const response = await client.get(url, { validateStatus: () => true });
  assertCondition(response.status === 200, url + ' returned HTTP ' + response.status);
  return response.data;
}

function validateFinalWidgets(leaderboard, mapOverlay, expectedMap, expectedFlightPath) {
  const expectedNormalizedMap = normalizeMapName(expectedMap);
  assertCondition(
    normalizeMapName(leaderboard && leaderboard.mapName) === expectedNormalizedMap,
    'Leaderboard map does not match expected map',
  );
  assertCondition(
    mapOverlay &&
      mapOverlay.map &&
      normalizeMapName(mapOverlay.map.mapName) === expectedNormalizedMap,
    'Map overlay map does not match expected map',
  );
  assertCondition(
    Number.isFinite(finiteNumber(mapOverlay.map.worldSize)) &&
      finiteNumber(mapOverlay.map.worldSize) > 0,
    'Map overlay worldSize is invalid',
  );
  assertCondition(
    mapOverlay.map.coordinateSystem === 'WORLD',
    'PCOB map overlay must use the top-left WORLD coordinate frame',
  );
  assertCondition(
    Array.isArray(mapOverlay.playerMarkers) && Array.isArray(mapOverlay.teamMarkers),
    'Map overlay marker arrays are missing',
  );
  const leaderboardFlightPath = assertFlightPathEquals(
    leaderboard.flightPath,
    expectedFlightPath,
    'Leaderboard',
  );
  const overlayFlightPath = flightPathCoordinates(mapOverlay.flightPath);
  assertCondition(overlayFlightPath, 'Map overlay flightPath is missing or invalid');
  const deltaX = overlayFlightPath.end.x - overlayFlightPath.start.x;
  const deltaY = overlayFlightPath.end.y - overlayFlightPath.start.y;
  assertCondition(
    Math.hypot(deltaX, deltaY) > 0,
    'Map overlay flightPath must be non-degenerate',
  );
  return {
    mapName: mapOverlay.map.mapName,
    worldSize: finiteNumber(mapOverlay.map.worldSize),
    coordinateSystem: mapOverlay.map.coordinateSystem,
    leaderboardFlightPath,
    overlayFlightPath,
    playerMarkers: mapOverlay.playerMarkers.length,
    teamMarkers: mapOverlay.teamMarkers.length,
  };
}

async function stopConnector(connector) {
  if (!connector || childIsStopped(connector.child)) return;
  const gracefulExit = once(connector.child, 'exit');
  connector.child.kill('SIGTERM');
  await Promise.race([
    gracefulExit,
    sleep(5000),
  ]);
  if (!childIsStopped(connector.child)) {
    const forcedExit = once(connector.child, 'exit');
    connector.child.kill('SIGKILL');
    await Promise.race([
      forcedExit,
      sleep(5000),
    ]);
  }
  assertCondition(
    childIsStopped(connector.child),
    'Could not stop the exact isolated connector child',
  );
}

async function closeServer(server) {
  if (!server || !server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function executeE2e(options) {
  const inspection = await inspectRecording(options.recording);
  const expectedMap = options.expectedMap || inspection.inferredMap;
  assertCondition(expectedMap, 'Could not infer a map; provide --expected-map');
  if (options.expectedMap && inspection.inferredMap) {
    assertCondition(
      normalizeMapName(options.expectedMap) === normalizeMapName(inspection.inferredMap),
      '--expected-map conflicts with the recording map',
    );
  }
  assertCondition(
    inspection.expectedFlightPath,
    'Recording has no reconstructable setgameglobalinfo flightPath',
  );

  const tempRoot = createSafeTempRoot();
  const fakeBackend = createFakeAckBackend();
  let connector = null;
  let result = null;
  let primaryError = null;
  const cleanupErrors = [];
  try {
    const backendPort = await listenLoopback(fakeBackend.server);
    const connectorPort = await allocateFreeLoopbackPort();
    const backendBase = 'http://' + LOOPBACK_HOST + ':' + backendPort;
    const connectorBase = 'http://' + LOOPBACK_HOST + ':' + connectorPort;
    assertCondition(
      isLoopbackHostname(new URL(backendBase).hostname) &&
        isLoopbackHostname(new URL(connectorBase).hostname),
      'E2E endpoints must be loopback-only',
    );
    const matchId = 'pcob-e2e-match-' + crypto.randomUUID();
    const sessionId = 'pcob-e2e-session-' + crypto.randomUUID();
    const localReadToken = crypto.randomBytes(32).toString('hex');
    connector = await startConnector({
      port: connectorPort,
      backendBase,
      matchId,
      sessionId,
      expectedMap,
      tempRoot,
      localReadToken,
    });
    const client = axios.create({
      timeout: 10000,
      proxy: false,
      maxRedirects: 0,
      maxBodyLength: Infinity,
    });
    const health = await waitForConnectorHealth(
      client,
      connectorBase,
      connector,
      15000,
      localReadToken,
    );
    const replay = await replayRecordingToConnector({
      recording: inspection.packetsPath,
      connectorBase,
      speed: options.speed,
      timeoutMs: 10000,
      send: true,
    });
    assertCondition(
      replay.postedEvents === replay.reconstructedEvents,
      'Not every reconstructed recording event was posted',
    );
    assertCondition(replay.postedEvents > 0, 'Recording reconstructed no route events');

    const drained = await waitForQueuesToDrain({
      client,
      connectorBase,
      connector,
      backend: fakeBackend,
      localReadToken,
      expectedEvents: replay.postedEvents,
      timeoutMs: 30000,
    });
    const metrics = drained.metrics;
    const backend = drained.backend;
    assertContiguousSequences(backend.sequences, replay.postedEvents);
    assertCondition(
      backend.streamId === metrics.rawEvents.streamId,
      'Fake backend and connector stream IDs differ',
    );
    assertCondition(
      metrics.rawEvents.counters.captured === replay.postedEvents,
      'Connector captured count does not equal posted reconstructed count',
    );
    assertCondition(metrics.rawEvents.status === 'ok', 'Raw event spool is not healthy');
    assertCondition(metrics.rawEvents.full === false, 'Raw event spool unexpectedly filled');
    assertCondition(
      metrics.rawEvents.initializationError === null &&
        metrics.rawEvents.blockedEvent === null,
      'Raw event spool reported an initialization or delivery block',
    );
    assertAllNumericZero(metrics.rawEvents.drops, 'rawEvents.drops');
    assertAllNumericZero(metrics.rawEvents.rejected, 'rawEvents.rejected');
    assertCondition(
      metrics.handlerQueue.droppedEvents === 0 &&
        metrics.forwardQueue.droppedEvents === 0,
      'Connector handler or forwarding queue dropped events',
    );
    for (const counterName of [
      'appendFailures',
      'corruptJournalRecords',
      'deliveryFailures',
      'acknowledgementErrors',
      'missingAcknowledgements',
      'noProgressAcknowledgements',
      'partialAcknowledgements',
    ]) {
      assertCondition(
        metrics.rawEvents.counters[counterName] === 0,
        'rawEvents.counters.' + counterName + ' expected 0',
      );
    }
    assertRouteCounts(backend.routeCounts, replay.byEndpoint, 'Fake backend');
    const retainedRouteCounts = connectorRouteCounts(metrics);
    // The connector deliberately compacts acknowledged journal records, so
    // per-route connector metrics describe only its bounded retained tail.
    // Lifetime, lossless route totals are asserted against the ACK backend.
    assertRetainedRouteCountsAreBounded(retainedRouteCounts, replay.byEndpoint);

    const query = '?matchId=' + encodeURIComponent(matchId);
    const leaderboard = await getJson(
      client,
      connectorBase + '/widget/leaderboard' + query,
    );
    const mapOverlay = await getJson(
      client,
      connectorBase + '/widget/map-overlay' + query,
    );
    const finalState = validateFinalWidgets(
      leaderboard,
      mapOverlay,
      expectedMap,
      inspection.expectedFlightPath,
    );

    result = {
      ok: true,
      mode: 'isolated-loopback-e2e',
      recording: inspection.packetsPath,
      speed: options.speed,
      safety: {
        loopbackOnly: true,
        legacyForwardingDisabled: health.forwardEnabled === false,
        observerForwardingTarget: 'fake-loopback',
        ephemeralConnectorPort: true,
        ephemeralBackendPort: true,
        temporarySpool: true,
        configuredMapMatchesRecording:
          normalizeMapName(expectedMap) ===
          normalizeMapName(inspection.inferredMap),
      },
      replay: {
        packetsRead: replay.packetsRead,
        reconstructedEvents: replay.reconstructedEvents,
        postedEvents: replay.postedEvents,
        firstSequence: replay.firstSequence,
        lastSequence: replay.lastSequence,
        routes: replay.byEndpoint,
      },
      connector: {
        streamId: metrics.rawEvents.streamId,
        capturedEvents: metrics.rawEvents.counters.captured,
        acknowledgedSequence: metrics.rawEvents.acknowledgedSequence,
        pending: {
          rawEvents: metrics.rawEvents.pendingEvents,
          handlerQueue: metrics.handlerQueue.pendingEvents,
          forwardQueue: metrics.forwardQueue.pendingEvents,
        },
        drops: metrics.rawEvents.drops,
        rejected: metrics.rawEvents.rejected,
        queueDrops: {
          handlerQueue: metrics.handlerQueue.droppedEvents,
          forwardQueue: metrics.forwardQueue.droppedEvents,
        },
        retainedRoutes: retainedRouteCounts,
      },
      fakeBackend: {
        requests: backend.requests,
        rawBatches: backend.rawBatches,
        legacySnapshots: backend.legacySnapshots,
        uniqueEvents: backend.uniqueEvents,
        highestContiguousSequence: backend.highestContiguousSequence,
        routes: backend.routeCounts,
        validationErrors: backend.validationErrors,
      },
      final: finalState,
    };
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await stopConnector(connector);
    } catch (error) {
      cleanupErrors.push('connector: ' + error.message);
    }
    try {
      await closeServer(fakeBackend.server);
    } catch (error) {
      cleanupErrors.push('backend: ' + error.message);
    }
    try {
      removeSafeTempRoot(tempRoot);
    } catch (error) {
      cleanupErrors.push('temp: ' + error.message);
    }
  }
  if (primaryError) {
    if (cleanupErrors.length > 0) {
      primaryError.message += '; cleanup errors: ' + cleanupErrors.join('; ');
    }
    throw primaryError;
  }
  assertCondition(cleanupErrors.length === 0, 'Cleanup failed: ' + cleanupErrors.join('; '));
  return result;
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  if (args.help === true) {
    printHelp();
    return;
  }
  const recording = stringArg(args, 'recording', '');
  assertCondition(recording, '--recording is required');
  const speed = args.speed === undefined ? 10 : Number(args.speed);
  assertCondition(
    Number.isFinite(speed) && speed >= 0 && speed <= 1000,
    '--speed must be a finite number from 0 through 1000',
  );
  const expectedMap = stringArg(args, 'expected-map', '');
  const report = await executeE2e({
    recording,
    speed,
    expectedMap,
  });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      JSON.stringify(
        {
          ok: false,
          error: error && error.message ? error.message : String(error),
        },
        null,
        2,
      ) + '\n',
    );
    process.exitCode = 1;
  });
}

module.exports = {
  createFakeAckBackend,
  executeE2e,
  inspectRecording,
  normalizeMapName,
  validateTransportEvent,
};
