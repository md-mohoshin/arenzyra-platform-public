import { buildEvent } from "../core/eventBuilder";

export function mockMatch(matchId: string) {
  return [
    buildEvent({
      matchId,
      type: "MATCH_START",
      payload: { note: "mock start" },
      raw: { source: "mock" },
    }),

    buildEvent({
      matchId,
      type: "KILL",
      teamId: "TEAM_UUID_1",
      payload: { count: 1 },
      raw: { source: "mock", reason: "test kill" },
    }),

    buildEvent({
      matchId,
      type: "TEAM_PLACEMENT",
      teamId: "TEAM_UUID_1",
      payload: { placement: 1 },
      raw: { source: "mock" },
    }),

    buildEvent({
      matchId,
      type: "MATCH_END",
      payload: { note: "mock end" },
      raw: { source: "mock" },
    }),
  ];
}