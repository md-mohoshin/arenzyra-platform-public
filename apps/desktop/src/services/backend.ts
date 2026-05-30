import type { AxiosInstance } from "axios";

export type LiveMatchMeta = {
  matchId: string;
  status: string;
  startedAt: string | null;
  updatedAt?: string | null;
};

export type LiveTeam = {
  id: string;
  name: string | null;
  tag: string | null;
  slot: number | null;
  logoUrl: string | null;
  color?: string | null;
  kills: number;
  placement: number | null;
  points: number | null;
  alivePlayers?: number | null;
  totalPlayers?: number | null;
  alive?: boolean;
};

export type LivePlayer = {
  id: string;
  ign: string | null;
  name: string | null;
  teamId: string | null;
  photoUrl: string | null;
};

export type KillEvent = {
  ts: number;
  killerTeamId?: string | null;
  killerName?: string | null;
  victimTeamId?: string | null;
  victimName?: string | null;
  weapon?: string | null;
};

export type CircleInfo = {
  phase?: number | null;
  radius?: number | null;
  shrinking?: boolean;
  nextShrinkAt?: number | null;
};

export type ObserverInfo = {
  playerName?: string | null;
  playerId?: string | null;
  teamId?: string | null;
};

export type BackendSnapshot = {
  match: LiveMatchMeta | null;
  teams: LiveTeam[];
  players: LivePlayer[];
  kills: KillEvent[];
  circle: CircleInfo | null;
  observer: ObserverInfo | null;
};

export async function fetchStatus(
  client: AxiosInstance,
  matchId: string,
): Promise<LiveMatchMeta | null> {
  try {
    // Use authenticated control endpoint to read latest status.
    const res = await client.get<unknown>(`/me/matches/${matchId}/control`);
    const data = res?.data as Record<string, unknown> | null;
    if (!data) return null;
    return {
      matchId,
      status: stringFrom(data.status) ?? "UNKNOWN",
      startedAt: stringFrom(data.startedAt) ?? null,
      updatedAt: stringFrom(data.updatedAt) ?? null,
    };
  } catch {
    return null;
  }
}

const stringFrom = (val: unknown): string | null => {
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  return null;
};

const numberFrom = (val: unknown): number | null => {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const parsed = Number(val);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const pickFirstString = (obj: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) {
    const v = obj[k];
    const str = stringFrom(v);
    if (str !== null) return str;
  }
  return null;
};

const pickFirstNumber = (obj: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) {
    const v = obj[k];
    const num = numberFrom(v);
    if (num !== null) return num;
  }
  return null;
};

const asRecord = (val: unknown): Record<string, unknown> | null =>
  val && typeof val === "object" ? (val as Record<string, unknown>) : null;

function normalizeTeams(raw: unknown): LiveTeam[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, idx) => {
      const rec = asRecord(item);
      if (!rec) return null;
      const id =
        pickFirstString(rec, ["id", "teamId", "team_id", "uuid", "team"]) ??
        `team-${idx + 1}`;
      return {
        id,
        name: pickFirstString(rec, ["name", "teamName"]) ?? null,
        tag:
          pickFirstString(rec, ["tag", "teamTag", "shortName", "short_name"]) ??
          null,
        slot:
          pickFirstNumber(rec, [
            "slot",
            "slotNumber",
            "teamNumber",
            "teamNo",
            "number",
            "rank",
          ]) ?? null,
        logoUrl:
          pickFirstString(rec, ["logoUrl", "logo", "image", "logo_url"]) ??
          null,
        color: pickFirstString(rec, ["color", "teamColor"]) ?? null,
        kills:
          pickFirstNumber(rec, [
            "kills",
            "kill",
            "elims",
            "eliminations",
            "frags",
            "killCount",
          ]) ?? 0,
        placement:
          pickFirstNumber(rec, ["placement", "rank", "position"]) ?? null,
        points: pickFirstNumber(rec, ["points", "score", "totalPoints"]),
        alivePlayers:
          pickFirstNumber(rec, [
            "alivePlayers",
            "aliveCount",
            "remainingPlayers",
            "remainPlayerNum",
          ]) ?? null,
        totalPlayers:
          pickFirstNumber(rec, [
            "totalPlayers",
            "playerCount",
            "size",
            "rosterSize",
          ]) ?? null,
        alive:
          rec.alivePlayers !== undefined && rec.alivePlayers !== null
            ? numberFrom(rec.alivePlayers) !== 0
            : rec.aliveCount !== undefined && rec.aliveCount !== null
              ? numberFrom(rec.aliveCount) !== 0
              : rec.remainingPlayers !== undefined && rec.remainingPlayers !== null
                ? numberFrom(rec.remainingPlayers) !== 0
                : rec.remainPlayerNum !== undefined && rec.remainPlayerNum !== null
                  ? numberFrom(rec.remainPlayerNum) !== 0
                  : undefined,
      } as LiveTeam;
    })
    .filter((t): t is LiveTeam => Boolean(t));
}

function normalizePlayers(raw: unknown): LivePlayer[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, idx) => {
      const rec = asRecord(item);
      if (!rec) return null;
      const id =
        pickFirstString(rec, ["id", "playerId", "uuid"]) ??
        `player-${idx + 1}`;
      return {
        id,
        ign:
          pickFirstString(rec, ["ign", "name", "playerName", "nickname"]) ??
          null,
        name: pickFirstString(rec, ["realName", "fullName", "name"]) ?? null,
        teamId:
          pickFirstString(rec, ["teamId", "team_id", "team", "teamUUID"]) ??
          null,
        photoUrl:
          pickFirstString(rec, ["photoUrl", "photo", "imageUrl", "avatar"]) ??
          null,
      } as LivePlayer;
    })
    .filter((p): p is LivePlayer => Boolean(p));
}

function normalizeKills(raw: unknown): KillEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const rec = asRecord(item);
      if (!rec) return null;
      const ts =
        pickFirstNumber(rec, ["ts", "timestamp", "time"]) ??
        Date.now();
      return {
        ts,
        killerTeamId: pickFirstString(rec, [
          "killerTeamId",
          "killerTeam",
          "teamId",
          "killer_team_id",
        ]),
        killerName: pickFirstString(rec, [
          "killerName",
          "killer",
          "killerPlayer",
        ]),
        victimTeamId: pickFirstString(rec, [
          "victimTeamId",
          "victimTeam",
          "targetTeamId",
        ]),
        victimName: pickFirstString(rec, ["victimName", "victim"]),
        weapon: pickFirstString(rec, ["weapon", "weaponName", "gun"]),
      } as KillEvent;
    })
    .filter((k): k is KillEvent => Boolean(k));
}

function normalizeCircle(raw: unknown): CircleInfo | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  return {
    phase: pickFirstNumber(rec, ["phase", "circlePhase", "zonePhase"]),
    radius: pickFirstNumber(rec, ["radius", "r", "size"]),
    shrinking:
      typeof rec.shrinking === "boolean"
        ? rec.shrinking
        : undefined,
    nextShrinkAt: pickFirstNumber(rec, ["nextShrinkAt", "nextPhaseAt"]),
  };
}

function normalizeObserver(raw: unknown): ObserverInfo | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  return {
    playerName:
      pickFirstString(rec, ["playerName", "ign", "name", "observer"]) ?? null,
    playerId: pickFirstString(rec, ["playerId", "id"]) ?? null,
    teamId: pickFirstString(rec, ["teamId", "team", "team_id"]) ?? null,
  };
}

function normalizeMatch(raw: unknown, matchId: string): LiveMatchMeta | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  return {
    matchId,
    status: pickFirstString(rec, ["status", "phase", "state"]) ?? "UNKNOWN",
    startedAt: pickFirstString(rec, ["startedAt", "startAt", "start"]) ?? null,
    updatedAt: pickFirstString(rec, ["updatedAt"]) ?? null,
  };
}

async function safeGet<T>(
  client: AxiosInstance,
  path: string,
  matchId: string,
): Promise<T | null> {
  try {
    const res = await client.get<T>(path, { params: { matchId } });
    return (res?.data as T | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function fetchSnapshot(
  client: AxiosInstance,
  matchId: string,
): Promise<BackendSnapshot> {
  const [live, teamsRes, playersRes, killsRes, circleRes, observerRes] =
    await Promise.all([
      safeGet<unknown>(client, "/match/live", matchId),
      safeGet<unknown>(client, "/match/teams", matchId),
      safeGet<unknown>(client, "/match/players", matchId),
      safeGet<unknown>(client, "/match/kills", matchId),
      safeGet<unknown>(client, "/match/circle", matchId),
      safeGet<unknown>(client, "/match/observer", matchId),
    ]);

  const liveTeams =
    normalizeTeams((live as Record<string, unknown> | null)?.teams) ||
    normalizeTeams(teamsRes);
  const livePlayers =
    normalizePlayers(
      (live as Record<string, unknown> | null)?.players ?? playersRes,
    ) ?? [];
  const liveKills =
    normalizeKills(
      (live as Record<string, unknown> | null)?.kills ?? killsRes,
    ) ?? [];

  return {
    match: normalizeMatch(live, matchId),
    teams: liveTeams,
    players: livePlayers,
    kills: liveKills,
    circle: normalizeCircle(
      (live as Record<string, unknown> | null)?.circle ?? circleRes,
    ),
    observer: normalizeObserver(
      (live as Record<string, unknown> | null)?.observer ?? observerRes,
    ),
  };
}

export async function pushLive(
  client: AxiosInstance,
  payload: { matchId: string; match?: LiveMatchMeta | null },
) {
  await client.post("/match/live/update", payload);
}

export async function pushTeams(client: AxiosInstance, payload: { matchId: string; teams: LiveTeam[] }) {
  await client.post("/match/teams/update", payload);
}

export async function pushPlayers(
  client: AxiosInstance,
  payload: { matchId: string; players: LivePlayer[] },
) {
  await client.post("/match/players/update", payload);
}

export async function pushKills(client: AxiosInstance, payload: { matchId: string; kills: KillEvent[] }) {
  await client.post("/match/kills/update", payload);
}

export async function pushCircle(client: AxiosInstance, payload: { matchId: string; circle: CircleInfo | null }) {
  await client.post("/match/circle/update", payload);
}

export async function pushBackpack(
  client: AxiosInstance,
  payload: { matchId: string; backpack: unknown },
) {
  await client.post("/match/backpack/update", payload);
}

export async function pushObserver(
  client: AxiosInstance,
  payload: { matchId: string; observer: ObserverInfo | null },
) {
  await client.post("/match/observer/update", payload);
}
