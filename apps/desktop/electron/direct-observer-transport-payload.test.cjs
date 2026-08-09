"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createDirectObserverTransportState,
} = require("./direct-observer-transport-payload.cjs");

test("direct observer transport uses current team payload only and strips result fields", () => {
  const transport = createDirectObserverTransportState();

  transport.ingestTeamList({
    teamInfoList: [
      {
        teamId: "team-1",
        teamName: "Alpha",
        teamNo: 1,
        placement: 1,
        winnerTeamId: "team-1",
      },
    ],
  });
  assert.equal(
    transport.buildPayload({ matchId: "match-1" }).teams.length,
    1,
  );

  transport.ingestTeamList({ teamInfoList: [] });
  const payload = transport.buildPayload({ matchId: "match-1" });
  assert.deepEqual(payload.teams, []);
});

test("direct observer transport preserves live team rank and strips forbidden nested lifecycle and result fields before POST", () => {
  const transport = createDirectObserverTransportState();

  transport.ingestPlayerList({
    playerInfoList: [
      {
        playerId: "player-1",
        playerOpenId: "open-1",
        externalPlayerId: "external-1",
        playerName: "Player One",
        teamNo: 3,
        x: 10,
        y: 20,
        placement: 1,
        matchStatus: "FINISHED",
      },
    ],
  });
  transport.ingestTeamList({
    teamInfoList: [
      {
        teamId: "team-3",
        teamNo: 3,
        teamName: "Team Three",
        rank: 1,
        placement: 1,
        finalPlacement: 1,
      },
    ],
  });
  transport.ingestKillInfo({
    killerName: "Player One",
    victimName: "Player Two",
    winner: "team-3",
    isFinished: true,
  });
  transport.ingestCircleInfo({
    CircleIndex: 3,
    matchStatus: "FINISHED",
  });

  const payload = transport.buildPayload({ matchId: "match-1" });
  assert.equal(payload.players[0].playerOpenId, "open-1");
  assert.equal(payload.players[0].externalPlayerId, "external-1");
  assert.equal(payload.players[0].playerName, "Player One");
  assert.equal(payload.players[0].teamNo, 3);
  assert.equal(payload.players[0].placement, undefined);
  assert.equal(payload.players[0].matchStatus, undefined);
  assert.equal(payload.teams[0].rank, 1);
  assert.equal(payload.teams[0].placement, 1);
  assert.equal(payload.teams[0].finalPlacement, undefined);
  assert.equal(payload.kills[0].winner, undefined);
  assert.equal(payload.kills[0].isFinished, undefined);
  assert.equal(payload.circle.CircleIndex, 3);
  assert.equal(payload.circle.matchStatus, undefined);

  const cursor = transport.captureTransientCursor();
  transport.ingestKillInfo({ killerName: "Later", victimName: "Still queued" });
  transport.ingestCircleInfo({ CircleIndex: 4 });
  transport.ackTransientEvents(cursor);
  assert.equal(transport.buildPayload({ matchId: "match-1" }).kills.length, 1);
  assert.equal(
    transport.buildPayload({ matchId: "match-1" }).kills[0].killerName,
    "Later",
  );
  assert.equal(transport.buildPayload({ matchId: "match-1" }).circle.CircleIndex, 4);

  transport.clearTransientEvents();
  assert.deepEqual(transport.buildPayload({ matchId: "match-1" }).kills, []);
  assert.deepEqual(transport.buildPayload({ matchId: "match-1" }).circle, {});
});

test("direct observer transport queues rapid kills and ignores stale acknowledgements after reset", () => {
  const transport = createDirectObserverTransportState();
  transport.ingestKillInfo({ killerName: "One", victimName: "A" });
  transport.ingestKillInfo({ killerName: "Two", victimName: "B" });

  const cursor = transport.captureTransientCursor();
  assert.deepEqual(
    transport.buildPayload({ matchId: "match-1" }).kills.map((kill) => kill.killerName),
    ["One", "Two"],
  );

  transport.resetState();
  transport.ingestKillInfo({ killerName: "New game", victimName: "C" });
  transport.ackTransientEvents(cursor);
  assert.deepEqual(
    transport.buildPayload({ matchId: "match-1" }).kills.map((kill) => kill.killerName),
    ["New game"],
  );
});
