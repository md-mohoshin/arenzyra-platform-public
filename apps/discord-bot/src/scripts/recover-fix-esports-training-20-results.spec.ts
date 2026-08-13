import assert from "node:assert/strict";
import test from "node:test";
import type { MatchResultRowResponse } from "../api/api-client";
import {
  RECOVERY_GAMES,
  RECOVERY_GAMES_23,
  mapRecoveryRows,
  mapRecoveryRegistrations,
  mapRecoveryActiveTeams,
  recoveryTeamScore,
  recoveryRegistrationCandidates,
  recoveryRegistrationPlayerNames,
  selectRecoveryGuild,
  selectRecoverySession,
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

test("23:00 partial recovery maps every present team and omits absent teams", () => {
  const expected = RECOVERY_GAMES_23[1];
  const present = expected
    .filter((entry) => entry.team !== "PI" && entry.team !== "OUT_MAIN")
    .map((entry, index) => resultRow(entry.team, index));
  const mapped = mapRecoveryRows(present, expected, true);
  assert.equal(mapped.length, present.length);
  assert.ok(mapped.every((row) => row.teamId !== "team-PI" && row.teamId !== "team-OUT_MAIN"));
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

test("recovery resolves exactly one normalized Fix Esports guild", () => {
  assert.deepEqual(
    selectRecoveryGuild([
      { id: "other", name: "Another Guild" },
      { id: "fix", name: "FIX ESPORTS" },
    ]),
    { id: "fix", name: "FIX ESPORTS" },
  );
  assert.throws(() => selectRecoveryGuild([]), /guild count is 0/);
  assert.throws(
    () => selectRecoveryGuild([
      { id: "fix-1", name: "Fix Esports" },
      { id: "fix-2", name: "Fix-Esports" },
    ]),
    /guild count is 2/,
  );
});

test("recovery resolves only one exact or tightly related training session", () => {
  const exact = { name: "Fix Esports Traning Series 20:00", status: "ENDED" };
  assert.equal(
    selectRecoverySession([exact], ["Fix Esports Traning Series 20:00"], "20"),
    exact,
  );
  const related = { name: "Training Series - 20:00 PM", status: "ENDED" };
  assert.equal(
    selectRecoverySession([related], ["missing"], "20"),
    related,
  );
  assert.throws(
    () => selectRecoverySession([
      related,
      { name: "Older Training Series 20:00", status: "ARCHIVED" },
    ], ["missing"], "20"),
    /session count is 2/,
  );
});

test("recovery maps unique deleted registrations without restoring slots", () => {
  const registrations = ["SGE", "FPS", "NOVEX"].map((team, index) => ({
    id: `registration-${index}`,
    teamId: `team-${team}`,
    leaderDiscordUserId: null,
    managerDiscordUserIds: [],
    status: "REMOVED" as const,
    slotNumber: null,
    waitlistPosition: null,
    checkedInAt: null,
    confirmedAt: null,
    removedAt: "2026-08-13T00:00:00.000Z",
    removalReason: "cleared",
    note: null,
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    team: { id: `team-${team}`, name: team, tag: team, logoUrl: null, countryCode: null, region: null },
  }));
  assert.deepEqual(
    mapRecoveryRegistrations(registrations, ["NOVEX", "SGE", "FPS"]),
    [
      { key: "NOVEX", teamId: "team-NOVEX", label: "NOVEX" },
      { key: "SGE", teamId: "team-SGE", label: "SGE" },
      { key: "FPS", teamId: "team-FPS", label: "FPS" },
    ],
  );
});

test("deleted registration mapping uses retained roster player anchors", () => {
  const registration = {
    id: "registration-n1",
    teamId: "team-n1",
    leaderDiscordUserId: null,
    managerDiscordUserIds: [],
    tournamentRosterJson: { players: [{ ign: "N1 ANDYY" }] },
    status: "REMOVED" as const,
    slotNumber: null,
    waitlistPosition: null,
    checkedInAt: null,
    confirmedAt: null,
    removedAt: "2026-08-13T00:00:00.000Z",
    removalReason: "cleared",
    note: null,
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    team: { id: "team-n1", name: "Unknown", tag: null, logoUrl: null, countryCode: null, region: null },
  };
  const names = recoveryRegistrationPlayerNames(registration, ["Discord Name"]);
  assert.deepEqual(names, ["N1 ANDYY", "Discord Name"]);
  assert.deepEqual(
    mapRecoveryRegistrations([registration], ["N1"], new Map([["team-n1", names]])),
    [{ key: "N1", teamId: "team-n1", label: "Unknown" }],
  );
});

test("reconstruction maps only unique active organization teams", () => {
  const teams = [
    { id: "team-sge", name: "Unknown One", tag: null },
    { id: "team-fps", name: "Unknown Two", tag: "FPS" },
  ];
  const names = new Map<string, readonly string[]>([["team-sge", ["SGE VEGABOYYY"]]]);
  assert.deepEqual(mapRecoveryActiveTeams(teams, ["SGE", "FPS"], names), [
    { key: "SGE", teamId: "team-sge", label: "Unknown One" },
    { key: "FPS", teamId: "team-fps", label: "FPS" },
  ]);
});

test("reconstruction uses retained managers to disambiguate duplicate active tags", () => {
  const teams = [
    { id: "team-wrong", name: "SGE Academy", tag: "SGE" },
    { id: "team-right", name: "SGE Main", tag: "SGE" },
  ];
  const registration = {
    id: "registration-sge",
    teamId: "deleted-sge",
    leaderDiscordUserId: "111111111111111",
    managerDiscordUserIds: ["111111111111111"],
    status: "REMOVED" as const,
    slotNumber: null,
    waitlistPosition: null,
    checkedInAt: null,
    confirmedAt: null,
    removedAt: "2026-08-13T00:00:00.000Z",
    removalReason: "cleanup",
    note: null,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    team: null,
  };
  assert.deepEqual(
    mapRecoveryActiveTeams(
      teams,
      ["SGE"],
      new Map(),
      new Map([["SGE", registration]]),
      new Map([
        ["team-wrong", ["222222222222222"]],
        ["team-right", ["111111111111111"]],
      ]),
    ),
    [{ key: "SGE", teamId: "team-right", label: "SGE" }],
  );
});

test("reconstruction carries tied deleted tags into active manager disambiguation", () => {
  const registration = (id: string, manager: string) => ({
    id,
    teamId: `deleted-${id}`,
    leaderDiscordUserId: manager,
    managerDiscordUserIds: [manager],
    status: "REMOVED" as const,
    slotNumber: null,
    waitlistPosition: null,
    checkedInAt: null,
    confirmedAt: null,
    removedAt: "2026-08-13T00:00:00.000Z",
    removalReason: "cleanup",
    note: null,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    team: { id: `deleted-${id}`, name: "SGE", tag: "SGE", logoUrl: null, countryCode: null, region: null },
  });
  const tied = recoveryRegistrationCandidates(
    [registration("old", "111111111111111"), registration("current", "222222222222222")],
    ["SGE"],
  );
  assert.equal(tied.get("SGE")?.length, 2);
  assert.deepEqual(
    mapRecoveryActiveTeams(
      [
        { id: "team-wrong", name: "SGE Academy", tag: "SGE" },
        { id: "team-right", name: "SGE Main", tag: "SGE" },
      ],
      ["SGE"],
      new Map(),
      tied,
      new Map([
        ["team-wrong", ["333333333333333"]],
        ["team-right", ["222222222222222"]],
      ]),
    ),
    [{ key: "SGE", teamId: "team-right", label: "SGE" }],
  );
});

test("reconstruction defers missing deleted identity to unique active roster evidence", () => {
  const candidates = recoveryRegistrationCandidates([], ["OUT_MAIN"]);
  assert.deepEqual(candidates.get("OUT_MAIN"), []);
  assert.deepEqual(
    mapRecoveryActiveTeams(
      [
        { id: "team-out-main", name: "OUT", tag: "OUT" },
        { id: "team-out-other", name: "OUT", tag: "OUT" },
      ],
      ["OUT_MAIN"],
      new Map([["team-out-main", ["OUT XRP"]]]),
      candidates,
      new Map(),
    ),
    [{ key: "OUT_MAIN", teamId: "team-out-main", label: "OUT" }],
  );
});

test("reconstruction distinguishes shared 23:00 OUT labels by reviewed rosters", () => {
  assert.deepEqual(
    mapRecoveryActiveTeams(
      [
        { id: "team-main", name: "OUT", tag: "OUT" },
        { id: "team-44", name: "OUT", tag: "OUT" },
      ],
      ["OUT_MAIN", "OUT44"],
      new Map([
        ["team-main", ["OUT XRP"]],
        ["team-44", ["OUT GOAT 44"]],
      ]),
      recoveryRegistrationCandidates([], ["OUT_MAIN", "OUT44"]),
      new Map(),
    ),
    [
      { key: "OUT_MAIN", teamId: "team-main", label: "OUT" },
      { key: "OUT44", teamId: "team-44", label: "OUT" },
    ],
  );
});

test("reconstruction prefers exact registered team identity over duplicate labels", () => {
  const registration = {
    id: "registration-og",
    teamId: "team-exact",
    leaderDiscordUserId: "111111111111111",
    managerDiscordUserIds: ["111111111111111"],
    status: "REMOVED" as const,
    slotNumber: null,
    waitlistPosition: null,
    checkedInAt: null,
    confirmedAt: null,
    removedAt: "2026-08-13T00:00:00.000Z",
    removalReason: "cleanup",
    note: null,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    team: { id: "team-exact", name: "OG", tag: "OG", logoUrl: null, countryCode: null, region: null },
  };
  assert.deepEqual(
    mapRecoveryActiveTeams(
      [
        { id: "team-duplicate", name: "OG", tag: "OG" },
        { id: "team-exact", name: "OG", tag: "OG" },
      ],
      ["OG"],
      new Map(),
      new Map([["OG", registration]]),
      new Map([["team-duplicate", ["111111111111111"]]]),
    ),
    [{ key: "OG", teamId: "team-exact", label: "OG" }],
  );
});

test("reconstruction permits roster evidence when retained managers are stale", () => {
  const registration = {
    id: "registration-og",
    teamId: "deleted-og",
    leaderDiscordUserId: "111111111111111",
    managerDiscordUserIds: ["111111111111111"],
    tournamentRosterJson: { players: [{ ign: "OG GILL" }] },
    status: "REMOVED" as const,
    slotNumber: null,
    waitlistPosition: null,
    checkedInAt: null,
    confirmedAt: null,
    removedAt: "2026-08-13T00:00:00.000Z",
    removalReason: "cleanup",
    note: null,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    team: { id: "deleted-og", name: "OG", tag: "OG", logoUrl: null, countryCode: null, region: null },
  };
  assert.deepEqual(
    mapRecoveryActiveTeams(
      [
        { id: "team-label-only", name: "OG", tag: "OG" },
        { id: "team-roster", name: "OG", tag: "OG" },
      ],
      ["OG"],
      new Map([["team-roster", ["OG GILL"]]]),
      new Map([["OG", registration]]),
      new Map(),
    ),
    [{ key: "OG", teamId: "team-roster", label: "OG" }],
  );
});

test("reconstruction prefers the only actively managed duplicate label", () => {
  assert.deepEqual(
    mapRecoveryActiveTeams(
      [
        { id: "team-orphan", name: "OG", tag: "OG" },
        { id: "team-managed", name: "OG", tag: "OG" },
      ],
      ["OG"],
      new Map(),
      new Map(),
      new Map([["team-managed", ["111111111111111"]]]),
    ),
    [{ key: "OG", teamId: "team-managed", label: "OG" }],
  );
});

test("reconstruction uses retained branding to distinguish managed duplicates", () => {
  const registration = {
    id: "registration-out",
    teamId: "deleted-out",
    leaderDiscordUserId: null,
    managerDiscordUserIds: [],
    status: "REMOVED" as const,
    slotNumber: null,
    waitlistPosition: null,
    checkedInAt: null,
    confirmedAt: null,
    removedAt: "2026-08-13T00:00:00.000Z",
    removalReason: "cleanup",
    note: null,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    team: { id: "deleted-out", name: "OUT", tag: "OUT", logoUrl: "https://assets.example/out.png", countryCode: null, region: null },
  };
  assert.deepEqual(
    mapRecoveryActiveTeams(
      [
        { id: "team-other", name: "OUT", tag: "OUT", logoUrl: "https://assets.example/other.png" },
        { id: "team-out", name: "OUT", tag: "OUT", logoUrl: "https://assets.example/out.png" },
      ],
      ["OUT"],
      new Map(),
      new Map([["OUT", registration]]),
      new Map([
        ["team-other", ["111111111111111"]],
        ["team-out", ["222222222222222"]],
      ]),
    ),
    [{ key: "OUT", teamId: "team-out", label: "OUT" }],
  );
});

test("reconstruction uses the reviewed active Discord alias for duplicate OUT teams", () => {
  assert.deepEqual(
    mapRecoveryActiveTeams(
      [
        { id: "team-out", name: "OUT", tag: "OUT" },
        { id: "team-other-1", name: "Out", tag: "OUT" },
        { id: "team-other-2", name: "out", tag: "OUT" },
        { id: "team-other-3", name: "OUT", tag: "OUT" },
      ],
      ["OUT"],
      new Map([["team-out", ["DOMBIBOGGGGGG"]]]),
      new Map(),
      new Map([
        ["team-out", ["111111111111111"]],
        ["team-other-1", ["222222222222222"]],
        ["team-other-2", ["333333333333333"]],
        ["team-other-3", ["444444444444444", "555555555555555"]],
      ]),
    ),
    [{ key: "OUT", teamId: "team-out", label: "OUT" }],
  );
});
