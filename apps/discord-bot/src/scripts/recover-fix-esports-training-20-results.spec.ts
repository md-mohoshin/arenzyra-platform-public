import assert from "node:assert/strict";
import test from "node:test";
import type { MatchResultRowResponse } from "../api/api-client";
import {
  RECOVERY_GAMES,
  RECOVERY_GAMES_23,
  mapRecoveryRows,
  recoveryTeamScore,
  type RecoveryTeamKey,
} from "./recover-fix-esports-training-20-results";

function resultRow(
  team: RecoveryTeamKey,
  index: number,
  overrides: Partial<MatchResultRowResponse> = {},
): MatchResultRowResponse {
  return {
    id: `result-${index}`,
    matchId: "match",
    teamId: `team-${team}`,
    slot: index + 1,
    kills: 0,
    placement: null,
    placementPoints: 0,
    totalPoints: 0,
    wasPresentInMatch: true,
    team: { id: `team-${team}`, name: team, tag: team },
    players: [],
    ...overrides,
  };
}

test("reviewed screenshot tables are complete and internally consistent", () => {
  const expectedCounts = [18, 19, 19, 16];
  const expectedKillTotals = [54, 63, 116, 54];
  for (const game of [1, 2, 3, 4] as const) {
    const rows = RECOVERY_GAMES[game];
    assert.equal(rows.length, expectedCounts[game - 1]);
    assert.deepEqual(
      rows.map((row) => row.placement),
      Array.from({ length: rows.length }, (_, index) => index + 1),
    );
    assert.equal(new Set(rows.map((row) => row.team)).size, rows.length);
    assert.equal(
      rows.reduce((sum, row) => sum + row.kills, 0),
      expectedKillTotals[game - 1],
    );
    assert.ok(rows.every((row) => Number.isInteger(row.kills) && row.kills >= 0));
  }
});

test("reviewed 23:00 screenshot tables are complete and internally consistent", () => {
  const expectedCounts = [19, 19, 18, 17];
  const expectedKillTotals = [57, 70, 111, 60];
  for (const game of [1, 2, 3, 4] as const) {
    const rows = RECOVERY_GAMES_23[game];
    assert.equal(rows.length, expectedCounts[game - 1]);
    assert.deepEqual(
      rows.map((row) => row.placement),
      Array.from({ length: rows.length }, (_, index) => index + 1),
    );
    assert.equal(new Set(rows.map((row) => row.team)).size, rows.length);
    assert.equal(
      rows.reduce((sum, row) => sum + row.kills, 0),
      expectedKillTotals[game - 1],
    );
  }
});

test("each reviewed game maps uniquely to shuffled match-result teams", () => {
  for (const games of [RECOVERY_GAMES, RECOVERY_GAMES_23]) {
    for (const game of [1, 2, 3, 4] as const) {
      const expected = games[game];
      const current = expected
        .map((entry, index) => resultRow(entry.team, index))
        .reverse();
      const mapped = mapRecoveryRows(current, expected);
      assert.deepEqual(
        mapped.map(({ teamId, placement, kills }) => ({ teamId, placement, kills })),
        expected.map((entry) => ({
          teamId: `team-${entry.team}`,
          placement: entry.placement,
          kills: entry.kills,
        })),
      );
    }
  }
});

test("recovery rejects cleared or incomplete match snapshots", () => {
  const expected = RECOVERY_GAMES[1];
  const incomplete = expected
    .slice(1)
    .map((entry, index) => resultRow(entry.team, index));
  assert.throws(
    () => mapRecoveryRows(incomplete, expected),
    /active team count 17 does not match screenshot count 18/,
  );
});

test("player anchors recover a team when its stored tag and name are missing", () => {
  const row = resultRow("N1", 0, {
    team: { id: "team-N1", name: null, tag: null },
    players: [
      {
        id: "player-result",
        playerId: "player",
        name: "N1 ANDYY",
        kills: 0,
      },
    ],
  });
  assert.ok(recoveryTeamScore(row, "N1") > 0);
  assert.equal(recoveryTeamScore(row, "SGE"), 0);
});
