import axios from "axios";
import { buildEvent } from "../core/eventBuilder";

export type PcobSnapshot = {
  status?: string;
  teams?: any[];
  results?: { teams?: any[] };
  [key: string]: any;
};

function normalizeBase(url: string) {
  return url.replace(/\/$/, "");
}

export async function fetchPcobSnapshot(
  pcobBaseUrl: string,
  token: string,
  matchId: string
): Promise<PcobSnapshot> {
  const base = normalizeBase(pcobBaseUrl);
  const res = await axios.get(`${base}/matches/${matchId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return res.data;
}

export function pcobSnapshotToEvents(matchId: string, snapshot: PcobSnapshot) {
  const events: any[] = [];
  const status = (snapshot?.status ?? "").toString().toLowerCase();

  if (["live", "running", "started", "in_progress", "in-progress"].includes(status)) {
    events.push(
      buildEvent({
        matchId,
        type: "MATCH_START",
        payload: { status },
        raw: { source: "pcob", snapshot },
      })
    );
  }

  if (["finished", "complete", "completed", "ended"].includes(status)) {
    events.push(
      buildEvent({
        matchId,
        type: "MATCH_END",
        payload: { status },
        raw: { source: "pcob", snapshot },
      })
    );
  }

  const teams = snapshot?.results?.teams ?? snapshot?.teams ?? [];
  if (Array.isArray(teams)) {
    teams.forEach((t: any, idx: number) => {
      const placement = t?.placement ?? t?.rank ?? t?.position ?? idx + 1;
      const kills = t?.kills ?? t?.elims ?? t?.eliminations ?? t?.frags;
      const teamId = t?.id ?? t?.teamId ?? t?.uuid ?? null;

      events.push(
        buildEvent({
          matchId,
          type: "TEAM_PLACEMENT",
          teamId,
          payload: {
            placement,
            ...(kills !== undefined ? { kills } : {}),
          },
          raw: { source: "pcob", team: t },
        })
      );
    });
  }

  return events;
}

export async function fetchPcobEvents(
  pcobBaseUrl: string,
  token: string,
  matchId: string
) {
  const snapshot = await fetchPcobSnapshot(pcobBaseUrl, token, matchId);
  return pcobSnapshotToEvents(matchId, snapshot);
}