const OBSERVER_BASE_URL =
  process.env.OBSERVER_BASE_URL ?? "http://127.0.0.1:10086";
const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3000";

type ObserverAchievementPayload = {
  matchId: string;
  eventId: string;
  type: string;
  player: {
    id: string | null;
    name: string | null;
    photoUrl: string | null;
  };
  team: {
    id: string | null;
    name: string | null;
    tag: string | null;
    logoUrl: string | null;
  };
  timestamp: string;
};

type ObserverDirectAchievementResponse = {
  matchId: string;
  updatedAt: string;
  events: ObserverAchievementPayload[];
};

type ObserverPlayerSnapshot = {
  ids: string[];
  primaryId: string | null;
  name: string | null;
  photoUrl: string | null;
  teamId: string | null;
  teamName: string | null;
};

type ObserverTeamSnapshot = {
  id: string;
  name: string | null;
  tag: string | null;
  logoUrl: string | null;
  alivePlayers: number;
  totalPlayers: number;
};

type DerivedKillEvent = {
  eventId: string;
  killerPlayerId: string | null;
  killerTeamId: string | null;
  killerName: string | null;
  victimPlayerId: string | null;
  victimTeamId: string | null;
  victimName: string | null;
  timestamp: number;
};

export const dynamic = "force-dynamic";

const MAX_DIRECT_ACHIEVEMENT_EVENTS = 50;
const DIRECT_ACHIEVEMENT_STREAK_WINDOW_MS = 8_000;
const FALLBACK_KILL_EVENT_GAP_MS = DIRECT_ACHIEVEMENT_STREAK_WINDOW_MS + 1_000;

function withoutDoubleKills(
  payload: ObserverDirectAchievementResponse,
): ObserverDirectAchievementResponse;
function withoutDoubleKills(payload: null): null;
function withoutDoubleKills(
  payload: ObserverDirectAchievementResponse | null,
): ObserverDirectAchievementResponse | null {
  if (!payload) {
    return null;
  }

  return {
    ...payload,
    events: (payload.events ?? []).filter((event) => event.type !== "DOUBLE_KILL"),
  };
}

function emptyPayload(matchId: string): ObserverDirectAchievementResponse {
  return {
    matchId,
    updatedAt: new Date().toISOString(),
    events: [],
  };
}

function resolveUpdatedAt(
  events: ObserverAchievementPayload[],
  fallback?: string | null,
): string {
  const newestEvent = [...events].sort((left, right) => {
    const leftTimestamp = Date.parse(left.timestamp);
    const rightTimestamp = Date.parse(right.timestamp);
    if (leftTimestamp !== rightTimestamp) {
      return rightTimestamp - leftTimestamp;
    }
    return right.eventId.localeCompare(left.eventId);
  })[0];

  return newestEvent?.timestamp ?? fallback ?? new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function textValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function resolveObserverConflictMatchId(payload: unknown): string | null {
  return textValue(asRecord(payload)?.activeMatchId);
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function timestampMsValue(value: unknown): number | null {
  const numeric = numberValue(value);
  if (numeric !== null) {
    return numeric;
  }

  const text = textValue(value);
  if (!text) {
    return null;
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstTextValue(
  record: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = textValue(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function firstNumberValue(
  record: Record<string, unknown> | null,
  keys: string[],
): number | null {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = numberValue(record[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

async function fetchApiAchievements(
  matchId: string,
): Promise<ObserverDirectAchievementResponse | null> {
  const response = await fetch(
    `${API_URL}/api/observer/match/${encodeURIComponent(matchId)}/achievements`,
    {
      cache: "no-store",
    },
  );

  if (response.status === 404) {
    return emptyPayload(matchId);
  }

  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(
      message || `API achievements request failed (${response.status})`,
    );
  }

  const events = (await response.json()) as ObserverAchievementPayload[];
  return withoutDoubleKills({
    matchId,
    updatedAt: resolveUpdatedAt(events),
    events,
  });
}

async function fetchObserverJson(path: string): Promise<{
  ok: boolean;
  status: number;
  data: unknown | null;
}> {
  try {
    const response = await fetch(`${OBSERVER_BASE_URL}${path}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data: null,
      };
    }

    return {
      ok: true,
      status: response.status,
      data: await response.json(),
    };
  } catch {
    return {
      ok: false,
      status: 500,
      data: null,
    };
  }
}

function normalizeLookup(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeObserverPlayers(payload: unknown): ObserverPlayerSnapshot[] {
  const root = asRecord(payload);
  const list = asArray(root?.playerInfoList ?? payload);

  return list.flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) {
      return [];
    }

    const ids = [
      firstTextValue(record, [
        "playerOpenId",
        "playerOpenID",
        "PlayerOpenId",
        "PlayerOpenID",
      ]),
      firstTextValue(record, [
        "uId",
        "uid",
        "UID",
        "playerId",
        "playerID",
        "PlayerId",
        "PlayerID",
      ]),
    ].filter((value): value is string => Boolean(value));

    return [
      {
        ids: Array.from(new Set(ids)),
        primaryId: ids[0] ?? null,
        name: firstTextValue(record, [
          "playerName",
          "PlayerName",
          "name",
          "Name",
          "ign",
          "IGN",
        ]),
        photoUrl:
          firstTextValue(record, ["picUrl", "photoUrl", "avatarUrl"]) ?? null,
        teamId: firstTextValue(record, [
          "teamId",
          "teamID",
          "TeamId",
          "TeamID",
        ]),
        teamName: firstTextValue(record, [
          "teamName",
          "TeamName",
          "name",
          "Name",
        ]),
      } satisfies ObserverPlayerSnapshot,
    ];
  });
}

function normalizeObserverTeams(
  payload: unknown,
  players: ObserverPlayerSnapshot[],
): ObserverTeamSnapshot[] {
  const root = asRecord(payload);
  const list = asArray(root?.teamInfoList ?? payload);
  const playerCounts = new Map<string, number>();

  for (const player of players) {
    if (!player.teamId) {
      continue;
    }
    playerCounts.set(player.teamId, (playerCounts.get(player.teamId) ?? 0) + 1);
  }

  const teams = list.flatMap((entry) => {
    const record = asRecord(entry);
    const teamId = firstTextValue(record, [
      "teamId",
      "teamID",
      "TeamId",
      "TeamID",
      "team",
      "id",
      "ID",
    ]);
    if (!record || !teamId) {
      return [];
    }

    const totalPlayers =
      firstNumberValue(record, [
        "totalPlayers",
        "TotalPlayers",
        "memberNum",
        "playerNum",
      ]) ??
      playerCounts.get(teamId) ??
      0;

    return [
      {
        id: teamId,
        name: firstTextValue(record, ["teamName", "TeamName", "name", "Name"]),
        tag: firstTextValue(record, ["teamTag", "tag", "Tag"]),
        logoUrl:
          firstTextValue(record, [
            "logoUrl",
            "LogoUrl",
            "logoPicUrl",
            "logoPICUrl",
            "logo",
          ]) ?? null,
        alivePlayers:
          firstNumberValue(record, [
            "liveMemberNum",
            "LiveMemberNum",
            "alivePlayers",
            "aliveCount",
            "AlivePlayers",
          ]) ?? 0,
        totalPlayers: Math.max(0, Math.trunc(totalPlayers)),
      } satisfies ObserverTeamSnapshot,
    ];
  });

  if (teams.length > 0) {
    return teams;
  }

  return Array.from(playerCounts.entries()).map(([teamId, totalPlayers]) => {
    const firstPlayer = players.find((player) => player.teamId === teamId) ?? null;
    return {
      id: teamId,
      name: firstPlayer?.teamName ?? null,
      tag: null,
      logoUrl: null,
      alivePlayers: 0,
      totalPlayers,
    };
  });
}

function normalizeRawKillEvents(
  payload: unknown,
  playersById: Map<string, ObserverPlayerSnapshot>,
  playersByName: Map<string, ObserverPlayerSnapshot>,
): DerivedKillEvent[] {
  const candidates: Array<{
    record: Record<string, unknown>;
    sequence: number;
  }> = [];

  const collectCandidates = (value: unknown, depth = 0) => {
    if (depth > 4 || value === null || value === undefined) {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        collectCandidates(item, depth + 1);
      }
      return;
    }

    const record = asRecord(value);
    if (!record) {
      return;
    }

    let expanded = false;
    for (const nested of [
      record.events,
      record.killInfo,
      record.KillInfo,
      record.killList,
      record.KillList,
      record.kills,
      record.list,
      record.data,
    ]) {
      if (Array.isArray(nested) && nested.length > 0) {
        expanded = true;
        collectCandidates(nested, depth + 1);
      }
    }

    if (!expanded) {
      candidates.push({
        record,
        sequence: candidates.length,
      });
    }
  };

  collectCandidates(payload);

  const events: DerivedKillEvent[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const record = candidate.record;
    const resultStatus = firstTextValue(record, [
      "ResultHealthStatus",
      "resultHealthStatus",
      "healthStatus",
    ]);
    if (resultStatus && resultStatus !== "1") {
      continue;
    }

    const killerPlayerId =
      firstTextValue(record, [
        "killerPlayerId",
        "killerPlayerID",
        "killerPlayerExternalId",
        "killerId",
        "killerID",
        "killerOpenId",
        "killerOpenID",
        "CauserUID",
        "causerUid",
        "AttackerUID",
        "attackerUid",
      ]) ?? null;
    const victimPlayerId =
      firstTextValue(record, [
        "victimPlayerId",
        "victimPlayerID",
        "victimPlayerExternalId",
        "victimId",
        "victimID",
        "deadPlayerId",
        "VictimUID",
        "victimUid",
      ]) ?? null;
    const killerName =
      firstTextValue(record, [
        "killerName",
        "killerIgn",
        "killerPlayerName",
        "killer",
        "CauserName",
        "causerName",
        "AttackerName",
        "attackerName",
      ]) ?? null;
    const victimName =
      firstTextValue(record, [
        "victimName",
        "victimIgn",
        "victimPlayerName",
        "victim",
        "VictimName",
      ]) ?? null;

    if (!killerPlayerId && !killerName && !victimPlayerId && !victimName) {
      continue;
    }

    const killerPlayer =
      (killerPlayerId ? playersById.get(killerPlayerId) : null) ??
      (killerName ? playersByName.get(normalizeLookup(killerName)) : null) ??
      null;
    const victimPlayer =
      (victimPlayerId ? playersById.get(victimPlayerId) : null) ??
      (victimName ? playersByName.get(normalizeLookup(victimName)) : null) ??
      null;
    const killerTeamIdRaw =
      firstTextValue(record, [
        "killerTeamId",
        "killerTeamID",
        "attackerTeamId",
        "attackerTeamID",
        "AttackerTeamId",
        "AttackerTeamID",
        "CauserTeamId",
        "causerTeamId",
        "teamId",
      ]) ?? null;
    const victimTeamIdRaw =
      firstTextValue(record, [
        "victimTeamId",
        "victimTeamID",
        "VictimTeamId",
        "VictimTeamID",
        "deadTeamId",
        "DeadTeamId",
      ]) ?? null;

    const rawTimestamp =
      firstNumberValue(record, [
        "timestamp",
        "Timestamp",
        "ts",
        "time",
        "eventTime",
      ]) ??
      (() => {
        const timestampText = firstTextValue(record, [
          "timestamp",
          "Timestamp",
          "ts",
          "time",
          "eventTime",
        ]);
        if (!timestampText) {
          return null;
        }
        return timestampMsValue(timestampText);
      })();
    const relativeTimestampSeconds = firstNumberValue(record, [
      "CurGameTime",
      "curGameTime",
      "GameTime",
      "gameTime",
    ]);
    const timestamp =
      rawTimestamp ??
      (relativeTimestampSeconds !== null
        ? Math.trunc(relativeTimestampSeconds * 1000)
        : (candidate.sequence + 1) * FALLBACK_KILL_EVENT_GAP_MS);
    const timeKey =
      rawTimestamp !== null
        ? `ts:${Math.trunc(rawTimestamp)}`
        : relativeTimestampSeconds !== null
          ? `gt:${Math.trunc(relativeTimestampSeconds * 1000)}`
          : `ord:${candidate.sequence}`;

    const eventId =
      firstTextValue(record, ["killId", "KillId", "id", "ID", "eventId"]) ??
      [
        killerPlayerId ?? killerName ?? killerTeamIdRaw ?? "unknown-killer",
        victimPlayerId ?? victimName ?? victimTeamIdRaw ?? "unknown-victim",
        victimTeamIdRaw ?? "unknown-team",
        timeKey,
      ].join(":");

    if (seen.has(eventId)) {
      continue;
    }
    seen.add(eventId);

    events.push({
      eventId,
      killerPlayerId: killerPlayer?.primaryId ?? killerPlayerId,
      killerTeamId: killerTeamIdRaw ?? killerPlayer?.teamId ?? null,
      killerName: killerPlayer?.name ?? killerName,
      victimPlayerId: victimPlayer?.primaryId ?? victimPlayerId,
      victimTeamId: victimTeamIdRaw ?? victimPlayer?.teamId ?? null,
      victimName: victimPlayer?.name ?? victimName,
      timestamp,
    });
  }

  events.sort((left, right) => {
    if (left.timestamp !== right.timestamp) {
      return left.timestamp - right.timestamp;
    }
    return left.eventId.localeCompare(right.eventId);
  });

  return events;
}

function buildDerivedObserverAchievements(input: {
  matchId: string;
  killsPayload: unknown;
  teamsPayload: unknown;
  playersPayload: unknown;
  updatedAt: string;
}): ObserverDirectAchievementResponse {
  const players = normalizeObserverPlayers(input.playersPayload);
  const teams = normalizeObserverTeams(input.teamsPayload, players);
  const playersById = new Map<string, ObserverPlayerSnapshot>();
  const playersByName = new Map<string, ObserverPlayerSnapshot>();
  const teamsById = new Map<string, ObserverTeamSnapshot>();
  const teamRemainingPlayers = new Map<string, number>();

  for (const player of players) {
    for (const id of player.ids) {
      playersById.set(id, player);
    }
    if (player.name) {
      playersByName.set(normalizeLookup(player.name), player);
    }
  }

  for (const team of teams) {
    teamsById.set(team.id, team);
    teamRemainingPlayers.set(
      team.id,
      Math.max(team.totalPlayers, team.alivePlayers),
    );
  }

  const kills = normalizeRawKillEvents(
    input.killsPayload,
    playersById,
    playersByName,
  );
  const streaksByPlayer = new Map<
    string,
    Array<{ eventId: string; timestamp: number }>
  >();
  const seenVictimsByTeam = new Map<string, Set<string>>();
  const emitted = new Set<string>();
  const events: ObserverAchievementPayload[] = [];
  let firstBloodEmitted = false;

  const pushEvent = (event: ObserverAchievementPayload | null) => {
    if (!event || emitted.has(event.eventId)) {
      return;
    }
    emitted.add(event.eventId);
    events.push(event);
  };

  for (const kill of kills) {
    const killerPlayer =
      (kill.killerPlayerId ? playersById.get(kill.killerPlayerId) : null) ??
      (kill.killerName
        ? playersByName.get(normalizeLookup(kill.killerName))
        : null) ??
      null;
    const killerTeamId = kill.killerTeamId ?? killerPlayer?.teamId ?? null;
    const killerTeam = killerTeamId ? teamsById.get(killerTeamId) ?? null : null;
    const killerIdentity =
      killerPlayer?.primaryId ??
      kill.killerPlayerId ??
      killerPlayer?.name ??
      kill.killerName ??
      null;
    const timestamp = new Date(kill.timestamp).toISOString();
    const hasKillerIdentity =
      Boolean(killerPlayer?.primaryId) ||
      Boolean(kill.killerPlayerId) ||
      Boolean(killerPlayer?.name) ||
      Boolean(kill.killerName);

    if (!firstBloodEmitted && hasKillerIdentity) {
      firstBloodEmitted = true;
      pushEvent({
        matchId: input.matchId,
        eventId: `${input.matchId}:FIRST_BLOOD:${kill.eventId}`,
        type: "FIRST_BLOOD",
        player: {
          id: killerPlayer?.primaryId ?? kill.killerPlayerId,
          name: killerPlayer?.name ?? kill.killerName,
          photoUrl: killerPlayer?.photoUrl ?? null,
        },
        team: {
          id: killerTeamId,
          name: killerTeam?.name ?? killerPlayer?.teamName ?? null,
          tag: killerTeam?.tag ?? null,
          logoUrl: killerTeam?.logoUrl ?? null,
        },
        timestamp,
      });
    }

    if (killerIdentity) {
      const streak = (streaksByPlayer.get(killerIdentity) ?? []).filter(
        (entry) =>
          kill.timestamp - entry.timestamp <= DIRECT_ACHIEVEMENT_STREAK_WINDOW_MS,
      );
      streak.push({ eventId: kill.eventId, timestamp: kill.timestamp });
      streaksByPlayer.set(killerIdentity, streak);

      const streakType =
        streak.length === 3
          ? "TRIPLE_KILL"
          : streak.length >= 4
            ? "QUADRA_KILL"
            : null;

      pushEvent(
        streakType
          ? {
              matchId: input.matchId,
              eventId: `${input.matchId}:${streakType}:${kill.eventId}`,
              type: streakType,
              player: {
                id: killerPlayer?.primaryId ?? kill.killerPlayerId,
                name: killerPlayer?.name ?? kill.killerName,
                photoUrl: killerPlayer?.photoUrl ?? null,
              },
              team: {
                id: killerTeamId,
                name: killerTeam?.name ?? killerPlayer?.teamName ?? null,
                tag: killerTeam?.tag ?? null,
                logoUrl: killerTeam?.logoUrl ?? null,
              },
              timestamp,
            }
          : null,
      );
    }

    const victimTeamId = kill.victimTeamId;
    if (!victimTeamId || !teamRemainingPlayers.has(victimTeamId)) {
      continue;
    }

    const victimKey =
      kill.victimPlayerId ??
      [victimTeamId, kill.victimName ?? "unknown-victim", kill.eventId].join(":");
    const seenVictims = seenVictimsByTeam.get(victimTeamId) ?? new Set<string>();
    if (seenVictims.has(victimKey)) {
      continue;
    }
    seenVictims.add(victimKey);
    seenVictimsByTeam.set(victimTeamId, seenVictims);

    const remaining = Math.max(
      0,
      Math.trunc(teamRemainingPlayers.get(victimTeamId) ?? 0) - 1,
    );
    teamRemainingPlayers.set(victimTeamId, remaining);

    if (remaining !== 0 || !killerIdentity) {
      continue;
    }

    pushEvent({
      matchId: input.matchId,
      eventId: `${input.matchId}:TEAM_WIPE:${kill.eventId}`,
      type: "TEAM_WIPE",
      player: {
        id: killerPlayer?.primaryId ?? kill.killerPlayerId,
        name: killerPlayer?.name ?? kill.killerName,
        photoUrl: killerPlayer?.photoUrl ?? null,
      },
      team: {
        id: killerTeamId,
        name: killerTeam?.name ?? killerPlayer?.teamName ?? null,
        tag: killerTeam?.tag ?? null,
        logoUrl: killerTeam?.logoUrl ?? null,
      },
      timestamp,
    });

    if (killerTeamId && (killerTeam?.alivePlayers ?? 0) === 1) {
      pushEvent({
        matchId: input.matchId,
        eventId: `${input.matchId}:CLUTCH:${kill.eventId}`,
        type: "CLUTCH",
        player: {
          id: killerPlayer?.primaryId ?? kill.killerPlayerId,
          name: killerPlayer?.name ?? kill.killerName,
          photoUrl: killerPlayer?.photoUrl ?? null,
        },
        team: {
          id: killerTeamId,
          name: killerTeam?.name ?? killerPlayer?.teamName ?? null,
          tag: killerTeam?.tag ?? null,
          logoUrl: killerTeam?.logoUrl ?? null,
        },
        timestamp,
      });
    }
  }

  const trimmedEvents = events.slice(-MAX_DIRECT_ACHIEVEMENT_EVENTS);
  return withoutDoubleKills({
    matchId: input.matchId,
    updatedAt: resolveUpdatedAt(trimmedEvents, input.updatedAt),
    events: trimmedEvents,
  });
}

async function fetchDerivedObserverAchievements(
  matchId: string,
): Promise<ObserverDirectAchievementResponse | null> {
  const [killsRes, teamsRes, playersRes] = await Promise.all([
    fetchObserverJson("/getkillinfo"),
    fetchObserverJson("/getteaminfolist"),
    fetchObserverJson("/gettotalplayerlist"),
  ]);

  if (!killsRes.ok && !teamsRes.ok && !playersRes.ok) {
    return null;
  }

  const fallbackUpdatedAt = new Date().toISOString();
  return buildDerivedObserverAchievements({
    matchId,
    killsPayload: killsRes.data,
    teamsPayload: teamsRes.data,
    playersPayload: playersRes.data,
    updatedAt: fallbackUpdatedAt,
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedMatchId =
    url.searchParams.get("matchId")?.trim() || "observer-direct";
  const preferCanonical = url.searchParams.get("preferCanonical") === "true";
  let effectiveMatchId = requestedMatchId;

  if (preferCanonical) {
    try {
      return Response.json(
        (await fetchApiAchievements(effectiveMatchId)) ??
          emptyPayload(effectiveMatchId),
      );
    } catch {
      return Response.json(emptyPayload(effectiveMatchId));
    }
  }

  try {
    let observerResponse = await fetch(
      `${OBSERVER_BASE_URL}/widget/achievements?matchId=${encodeURIComponent(
        effectiveMatchId,
      )}`,
      {
        cache: "no-store",
      },
    );

    if (observerResponse.status === 409) {
      const conflictPayload = await observerResponse.json().catch(() => null);
      const conflictMatchId = resolveObserverConflictMatchId(conflictPayload);
      if (conflictMatchId && conflictMatchId !== effectiveMatchId) {
        effectiveMatchId = conflictMatchId;
        observerResponse = await fetch(
          `${OBSERVER_BASE_URL}/widget/achievements?matchId=${encodeURIComponent(
            effectiveMatchId,
          )}`,
          {
            cache: "no-store",
          },
        );
      }
    }

    if (observerResponse.ok) {
      const payload = withoutDoubleKills(
        (await observerResponse.json()) as ObserverDirectAchievementResponse,
      );
      if (Array.isArray(payload.events) && payload.events.length > 0) {
        return Response.json(payload);
      }

      const derivedPayload =
        await fetchDerivedObserverAchievements(effectiveMatchId);
      if (derivedPayload && derivedPayload.events.length > 0) {
        return Response.json(derivedPayload);
      }

      return Response.json(
        (await fetchApiAchievements(effectiveMatchId)) ??
          payload ??
          emptyPayload(effectiveMatchId),
      );
    }

    const derivedPayload =
      await fetchDerivedObserverAchievements(effectiveMatchId);
    if (derivedPayload && derivedPayload.events.length > 0) {
      return Response.json(derivedPayload);
    }

    return Response.json(
      (await fetchApiAchievements(effectiveMatchId)) ??
        emptyPayload(effectiveMatchId),
    );
  } catch {
    try {
      const derivedPayload =
        await fetchDerivedObserverAchievements(effectiveMatchId);
      if (derivedPayload && derivedPayload.events.length > 0) {
        return Response.json(derivedPayload);
      }

      return Response.json(
        (await fetchApiAchievements(effectiveMatchId)) ??
          emptyPayload(effectiveMatchId),
      );
    } catch {
      return Response.json(emptyPayload(effectiveMatchId));
    }
  }
}
