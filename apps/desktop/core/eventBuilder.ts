import { randomUUID } from "crypto";

export type ArenzyraEventType =
  | "MATCH_START"
  | "MATCH_END"
  | "KILL"
  | "TEAM_PLACEMENT";

let seq = 0;

export function buildEvent(params: {
  matchId: string;
  type: ArenzyraEventType;
  teamId?: string | null;
  playerId?: string | null;
  payload?: any;
  raw?: any;
}) {
  seq += 1;

  return {
    event_id: randomUUID(),
    match_id: params.matchId,
    seq,
    type: params.type,
    team_id: params.teamId ?? null,
    player_id: params.playerId ?? null,
    timestamp: new Date().toISOString(),
    payload: params.payload ?? {},
    raw_payload: params.raw ?? {},
  };
}