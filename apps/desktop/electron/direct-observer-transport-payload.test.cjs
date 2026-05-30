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

test("direct observer transport strips forbidden nested lifecycle and result fields before POST", () => {
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
  assert.equal(payload.teams[0].rank, undefined);
  assert.equal(payload.teams[0].finalPlacement, undefined);
  assert.equal(payload.kills[0].winner, undefined);
  assert.equal(payload.kills[0].isFinished, undefined);
  assert.equal(payload.circle.CircleIndex, 3);
  assert.equal(payload.circle.matchStatus, undefined);

  transport.clearTransientEvents();
  assert.deepEqual(transport.buildPayload({ matchId: "match-1" }).kills, []);
  assert.deepEqual(transport.buildPayload({ matchId: "match-1" }).circle, {});
});
