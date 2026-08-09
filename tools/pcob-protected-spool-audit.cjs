#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const zlib = require("node:zlib");

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_SPOOLS = [
  path.join(
    REPO_ROOT,
    ".local-backups",
    "pcob-spool-ended-match-pre-recovery-20260802T214403",
  ),
  path.join(
    REPO_ROOT,
    ".local-backups",
    "pcob-spool-match7-pre-recovery-20260802T191753Z",
  ),
];

const PROTECTED_EXPECTATIONS = {
  "pcob-spool-ended-match-pre-recovery-20260802T214403": {
    eventsBytes: 118685516,
    eventsSha256: "E0C22AE76CD8DCB7883E49BD46FD441CC3827133C3AC1BBCA9F2A16D31C7F9D0",
    metadataBytes: 906,
    metadataSha256: "6D6D6D01FB4764E15257F443251D385246502BCC07F84DC168AAB570085FB59A",
    captured: 7638,
    finishedSequence: 7614,
    finalPlayers: 69,
    finalTeams: 18,
    finalKills: 107,
    winner: "NORTHSTARS",
    winnerKills: 14,
  },
  "pcob-spool-match7-pre-recovery-20260802T191753Z": {
    eventsBytes: 132626043,
    eventsSha256: "E67C7D814C0EE853760E67C1B00FD21135297F84E3515D49AB02E4B290283C2E",
    metadataBytes: 906,
    metadataSha256: "362D652A6D2F3FDDB5F89C0F86A9843A368DAE46FD082CBC8F342172F049E86C",
    captured: 8803,
    finishedSequence: 8781,
    finalPlayers: 73,
    finalTeams: 19,
    finalKills: 68,
    winner: "RentarNation",
    winnerKills: 13,
  },
  "3b7408f1-fab4-4864-b58c-32c641856cc7--4e9d779b-b89f-4cf0-b5ac-b0afccbeab09-b31ee5825faf": {
    eventsBytes: 58686787,
    eventsSha256: "E207AF921BC753F65AF7148B4360D7DC0B3AE06C73A5F90F3E315E0D4021B197",
    metadataBytes: 906,
    metadataSha256: "EA52D87DE16708603ECF3A83A1F732EB98BDDF5F7A3622DD0B29FDDCC5F2D987",
    captured: 4163,
    finishedSequence: 4150,
    finalPlayers: 67,
    finalTeams: 17,
    finalKills: 66,
    winner: "SelibonEsports",
    winnerKills: 15,
  },
};

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const spools = [];
  let inspectShapes = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--spool") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail("--spool requires a path");
      spools.push(path.resolve(value));
      index += 1;
      continue;
    }
    if (token.startsWith("--spool=")) {
      spools.push(path.resolve(token.slice("--spool=".length)));
      continue;
    }
    if (token === "--inspect-shapes") {
      inspectShapes = true;
      continue;
    }
    if (token === "--help") {
      return { help: true, spools: [], inspectShapes };
    }
    fail(`Unknown argument: ${token}`);
  }
  return {
    help: false,
    spools: spools.length > 0 ? spools : DEFAULT_SPOOLS,
    inspectShapes,
  };
}

function printHelp() {
  process.stdout.write(
    [
      "Read-only exact audit of protected Arenzyra PCOB spools.",
      "",
      "Usage:",
      "  node tools/pcob-protected-spool-audit.cjs [--spool PATH]...",
      "",
      "The tool opens only metadata.json and events.ndjson and writes nothing.",
      "",
    ].join("\n"),
  );
}

function decodeBody(event) {
  const encoded = event.rawBodyBase64;
  if (typeof encoded !== "string") fail(`sequence ${event.sequence}: body missing`);
  const exactBody = Buffer.from(encoded, "base64");
  const bodyHash = crypto
    .createHash("sha256")
    .update(exactBody)
    .digest("hex");
  if (exactBody.length !== Number(event.rawBodyBytes)) {
    fail(`sequence ${event.sequence}: rawBodyBytes mismatch`);
  }
  if (bodyHash !== event.bodySha256) {
    fail(`sequence ${event.sequence}: bodySha256 mismatch`);
  }
  let body = exactBody;
  const encoding = String(event.rawBodyEncoding || "identity").toLowerCase();
  if (encoding === "gzip") body = zlib.gunzipSync(body);
  else if (encoding === "deflate") body = zlib.inflateSync(body);
  else if (encoding === "br") body = zlib.brotliDecompressSync(body);
  else if (encoding !== "identity" && encoding !== "none") {
    fail(`sequence ${event.sequence}: unsupported body encoding ${encoding}`);
  }
  return { exactBody, body };
}

function parseBody(event) {
  const { exactBody, body } = decodeBody(event);
  const text = body.toString("utf8");
  try {
    return { exactBody, body, text, parsed: JSON.parse(text) };
  } catch {
    return { exactBody, body, text, parsed: text };
  }
}

function expectedEventId(event) {
  return crypto
    .createHash("sha256")
    .update(
      [
        event.streamId,
        event.sequence,
        event.receivedAt,
        event.method,
        event.requestTarget,
        event.bodySha256,
      ].join("\n"),
    )
    .digest("hex");
}

function objectKeys(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
}

function finiteInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function summarizeTotalMessage(payload) {
  const teams = Array.isArray(payload?.TeamInfoList)
    ? payload.TeamInfoList
    : [];
  const players = Array.isArray(payload?.TotalPlayerList)
    ? payload.TotalPlayerList
    : [];
  const playersByTeam = new Map();
  for (const player of players) {
    const teamId = String(player?.teamId ?? "");
    if (!teamId) continue;
    const list = playersByTeam.get(teamId) || [];
    list.push(player);
    playersByTeam.set(teamId, list);
  }
  const rows = teams.map((team) => {
    const teamId = String(team?.teamId ?? "");
    const teamPlayers = playersByTeam.get(teamId) || [];
    const ranks = new Set(
      teamPlayers
        .map((player) => finiteInteger(player?.rank))
        .filter((rank) => rank !== null && rank > 0),
    );
    const rank = ranks.size === 1 ? [...ranks][0] : null;
    return {
      teamId,
      teamName:
        String(team?.teamName ?? teamPlayers[0]?.teamName ?? "").trim() || null,
      rank,
      kills: Math.max(0, finiteInteger(team?.killNum) ?? 0),
      playerKills: teamPlayers.reduce(
        (sum, player) => sum + Math.max(0, finiteInteger(player?.killNum) ?? 0),
        0,
      ),
      aliveMembers: Math.max(0, finiteInteger(team?.liveMemberNum) ?? 0),
      players: teamPlayers.length,
      playerRows: teamPlayers.map((player) => ({
        playerName: String(player?.playerName ?? "").trim() || null,
        pubgPlayerId: String(player?.uId ?? "").trim() || null,
        playerOpenId: String(player?.playerOpenId ?? "").trim() || null,
        kills: Math.max(0, finiteInteger(player?.killNum) ?? 0),
        assists: Math.max(0, finiteInteger(player?.assists) ?? 0),
        knocks: Math.max(0, finiteInteger(player?.knockouts) ?? 0),
        damage: Math.max(0, finiteInteger(player?.damage) ?? 0),
        rank: finiteInteger(player?.rank),
        died: player?.bHasDied === true,
      })),
    };
  });
  const expectedRanks = new Set(
    Array.from({ length: rows.length }, (_, index) => index + 1),
  );
  const actualRanks = new Set(rows.map((team) => team.rank));
  const placementsComplete =
    rows.length >= 2 &&
    rows.every((team) => Number.isInteger(team.rank)) &&
    actualRanks.size === rows.length &&
    [...expectedRanks].every((rank) => actualRanks.has(rank));
  const rankedTeams = [...rows].sort(
    (left, right) =>
      (left.rank ?? Number.MAX_SAFE_INTEGER) -
        (right.rank ?? Number.MAX_SAFE_INTEGER) ||
      left.teamId.localeCompare(right.teamId),
  );
  return {
    players: players.length,
    teams: rows.length,
    aliveTeams: rows.filter((team) => team.aliveMembers > 0).length,
    alivePlayers: rows.reduce((sum, team) => sum + team.aliveMembers, 0),
    totalKills: rows.reduce((sum, team) => sum + team.kills, 0),
    totalPlayerKills: rows.reduce((sum, team) => sum + team.playerKills, 0),
    placementsComplete,
    teamsByRank: rankedTeams,
  };
}

function compactSnapshot(event, summary) {
  return {
    sequence: event.sequence,
    receivedAt: event.receivedAt,
    ...summary,
  };
}

function assertProtectedExpectation(name, report) {
  const expected = PROTECTED_EXPECTATIONS[name];
  if (!expected) return false;
  const actual = report.immutableInputs;
  const final = report.resultTimeline.final;
  const winner = final.teamsByRank.find((team) => team.rank === 1);
  const checks = [
    [actual.events.bytes, expected.eventsBytes, "events byte size"],
    [actual.events.sha256, expected.eventsSha256, "events SHA-256"],
    [actual.metadata.bytes, expected.metadataBytes, "metadata byte size"],
    [actual.metadata.sha256, expected.metadataSha256, "metadata SHA-256"],
    [report.stream.captured, expected.captured, "captured count"],
    [
      report.terminalTail.finished.sequence,
      expected.finishedSequence,
      "Finished sequence",
    ],
    [final.players, expected.finalPlayers, "final player count"],
    [final.teams, expected.finalTeams, "final team count"],
    [final.totalKills, expected.finalKills, "final kill total"],
    [winner?.teamName, expected.winner, "winner"],
    [winner?.kills, expected.winnerKills, "winner kills"],
    [final.totalPlayerKills, expected.finalKills, "final player kill total"],
    [report.terminalTail.finished.exactBodyUtf8, "Finished", "Finished body"],
    [report.terminalTail.finished.exactBodyBytes, 8, "Finished body bytes"],
  ];
  for (const [received, wanted, label] of checks) {
    if (received !== wanted) {
      fail(`${name}: ${label} mismatch (received ${received}, expected ${wanted})`);
    }
  }
  if (!final.placementsComplete || final.aliveTeams !== 1) {
    fail(`${name}: final placement/alive-team boundary is invalid`);
  }
  return true;
}

async function auditSpool(spoolPath, options) {
  const resolved = path.resolve(spoolPath);
  const metadataPath = path.join(resolved, "metadata.json");
  const eventsPath = path.join(resolved, "events.ndjson");
  const directoryStat = fs.statSync(resolved);
  if (!directoryStat.isDirectory()) fail(`Not a spool directory: ${resolved}`);
  const metadataBytes = fs.readFileSync(metadataPath);
  const metadata = JSON.parse(metadataBytes.toString("utf8"));
  const stream = fs.createReadStream(eventsPath);
  const fileHash = crypto.createHash("sha256");
  stream.on("data", (chunk) => fileHash.update(chunk));
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let count = 0;
  let expectedSequence = 1;
  let firstReceivedAt = null;
  let lastReceivedAt = null;
  let finished = null;
  const lifecycleTransitions = [];
  let lastTotalMessage = null;
  let totalMessageEventsAfterFinished = 0;
  let firstTotalAfterFinished = null;
  let firstCompletePlacementsAfterFinished = null;
  let firstSingleAliveAfterFinished = null;
  const endpoints = new Map();
  const shapes = new Map();
  const eventIds = new Set();

  for await (const line of lines) {
    if (!line.trim()) continue;
    count += 1;
    const event = JSON.parse(line);
    if (event.schema !== "arenzyra.pcobRawEvent.v1") {
      fail(`sequence ${event.sequence}: unexpected event schema`);
    }
    if (event.streamId !== metadata.streamId) {
      fail(`sequence ${event.sequence}: streamId mismatch`);
    }
    if (event.sequence !== expectedSequence) {
      fail(`expected sequence ${expectedSequence}, received ${event.sequence}`);
    }
    expectedSequence += 1;
    if (eventIds.has(event.eventId)) fail(`duplicate eventId at ${event.sequence}`);
    eventIds.add(event.eventId);
    if (event.eventId !== expectedEventId(event)) {
      fail(`sequence ${event.sequence}: eventId identity mismatch`);
    }
    const eventTime = Date.parse(event.receivedAt);
    if (!Number.isFinite(eventTime) || eventTime !== Number(event.receivedAtMs)) {
      fail(`sequence ${event.sequence}: invalid receivedAt`);
    }
    firstReceivedAt ??= event.receivedAt;
    lastReceivedAt = event.receivedAt;
    const endpoint = String(event.endpoint || "");
    endpoints.set(endpoint, (endpoints.get(endpoint) || 0) + 1);
    const body = parseBody(event);
    if (options.inspectShapes && !shapes.has(endpoint)) {
      shapes.set(endpoint, {
        sequence: event.sequence,
        type: Array.isArray(body.parsed) ? "array" : typeof body.parsed,
        keys: objectKeys(body.parsed),
        nestedKeys: Object.fromEntries(
          objectKeys(body.parsed)
            .filter((key) => objectKeys(body.parsed[key]).length > 0)
            .map((key) => [key, objectKeys(body.parsed[key])]),
        ),
      });
    }
    if (endpoint === "/setisingame") {
      const token = String(body.parsed && body.parsed.raw !== undefined
        ? body.parsed.raw
        : body.parsed)
        .trim()
        .replace(/^"|"$/g, "");
      lifecycleTransitions.push({
        sequence: event.sequence,
        receivedAt: event.receivedAt,
        token,
        exactBodyBytes: body.exactBody.length,
      });
      if (token.toLowerCase() === "finished") {
        finished = {
          sequence: event.sequence,
          receivedAt: event.receivedAt,
          exactBodyUtf8: body.text,
          exactBodyBytes: body.exactBody.length,
        };
      }
    }
    if (endpoint === "/totalmessage") {
      const summary = summarizeTotalMessage(body.parsed);
      lastTotalMessage = {
        sequence: event.sequence,
        receivedAt: event.receivedAt,
        summary,
      };
      if (finished) {
        totalMessageEventsAfterFinished += 1;
        firstTotalAfterFinished ??= compactSnapshot(event, summary);
        if (summary.placementsComplete) {
          firstCompletePlacementsAfterFinished ??= compactSnapshot(
            event,
            summary,
          );
        }
        if (summary.aliveTeams <= 1) {
          firstSingleAliveAfterFinished ??= compactSnapshot(event, summary);
        }
      }
    }
  }

  const stats = fs.statSync(eventsPath);
  if (count !== Number(metadata.counters?.captured)) {
    fail(`captured count mismatch: metadata=${metadata.counters?.captured}, file=${count}`);
  }
  if (Number(metadata.nextSequence) !== count + 1) {
    fail(`nextSequence mismatch: metadata=${metadata.nextSequence}, expected=${count + 1}`);
  }
  if (!finished) fail("No exact Finished transition found");
  if (!lastTotalMessage) fail("No TotalMessages event found");
  const finishedMs = Date.parse(finished.receivedAt);
  const lastTotalMs = Date.parse(lastTotalMessage.receivedAt);

  const report = {
    spoolPath: resolved,
    immutableInputs: {
      events: {
        bytes: stats.size,
        sha256: fileHash.digest("hex").toUpperCase(),
      },
      metadata: {
        bytes: metadataBytes.length,
        sha256: crypto
          .createHash("sha256")
          .update(metadataBytes)
          .digest("hex")
          .toUpperCase(),
      },
    },
    stream: {
      streamId: metadata.streamId,
      captured: count,
      acknowledgedSequence: metadata.acknowledgedSequence,
      closedAt: metadata.closedAt,
      firstReceivedAt,
      lastReceivedAt,
      contiguousSequences: true,
      uniqueEventIds: eventIds.size,
      endpoints: Object.fromEntries(
        [...endpoints].sort(([left], [right]) => left.localeCompare(right)),
      ),
      lifecycleTransitions,
    },
    terminalTail: {
      finished,
      lastTotalMessage: {
        sequence: lastTotalMessage.sequence,
        receivedAt: lastTotalMessage.receivedAt,
      },
      eventsAfterFinished: count - finished.sequence,
      sequenceSpanAfterFinished: lastTotalMessage.sequence - finished.sequence,
      totalMessageEventsAfterFinished,
      tailDurationMs: lastTotalMs - finishedMs,
    },
    resultTimeline: {
      firstTotalAfterFinished,
      firstCompletePlacementsAfterFinished,
      firstSingleAliveAfterFinished,
      final: compactSnapshot(lastTotalMessage, lastTotalMessage.summary),
    },
    ...(options.inspectShapes ? { shapes: Object.fromEntries(shapes) } : {}),
  };
  report.protectedExpectationVerified = assertProtectedExpectation(
    path.basename(resolved),
    report,
  );
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const reports = [];
  for (const spool of options.spools) {
    reports.push(await auditSpool(spool, options));
  }
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        mode: "read-only-protected-pcob-spool-audit",
        productionTouched: false,
        installedLauncherTouched: false,
        inputFilesWritten: false,
        reports,
      },
      null,
      2,
    ) + "\n",
  );
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      JSON.stringify({ ok: false, error: error.message || String(error) }, null, 2) +
        "\n",
    );
    process.exitCode = 1;
  });
}

module.exports = { auditSpool };
