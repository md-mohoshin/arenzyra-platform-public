const OBSERVER_BASE_URL =
  process.env.OBSERVER_BASE_URL ?? "http://127.0.0.1:10086";
const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3000";
const PUBLIC_API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.API_PUBLIC_URL ??
  process.env.API_BASE_URL ??
  API_URL;
const DEFAULT_WIDGET_TEAM_NAME = "Arenzyra";
const DEFAULT_WIDGET_TEAM_TAG = "AZ";
const DEFAULT_TEAM_LOGO_PATH = "/assets/defaults/default-team.png";
const API_MEDIA_PREFIXES = [
  "/media/",
  "/uploads/",
  "/assets/logos/",
  "/assets/players/",
];

type ObserverLeaderboardPlayer = {
  playerId: string | null;
  playerName: string;
  avatarUrl: string | null;
  kills: number;
  alive: boolean;
  knocked: boolean;
  health: number | null;
  outsideBlueCircle?: boolean | null;
  x?: number | null;
  y?: number | null;
  hasDied: boolean | null;
  lifeTelemetryFresh?: boolean;
};

type ObserverLeaderboardRow = {
  rank: number;
  teamId: string | null;
  slot: number | null;
  teamName: string;
  teamTag: string | null;
  logoUrl: string | null;
  color: string | null;
  kills: number;
  alivePlayers: number;
  totalPlayers: number | null;
  placement: number | null;
  isEliminated: boolean;
  players?: ObserverLeaderboardPlayer[];
};

type ObserverLeaderboardPayload = {
  matchId: string;
  updatedAt: string;
  mapName?: string | null;
  teamsAlive: number;
  leaderboard: ObserverLeaderboardRow[];
  killFeed: [];
  playerCard: {
    playerId: string | null;
    name: string | null;
    avatarUrl: string | null;
    teamId: string | null;
    teamName: string | null;
    teamTag: string | null;
    logoUrl: string | null;
    color: string | null;
    kills: number;
    alive: boolean;
    damage: number | null;
  } | null;
  circle: {
    phase: number | null;
    status: string | null;
    counterSeconds: number | null;
    maxTimeSeconds: number | null;
    nextShrinkAt: string | null;
    safeZone: { x: number; y: number; r: number } | null;
    nextZone: { x: number; y: number; r: number } | null;
  } | null;
  flightPath: {
    start: { x: number; y: number };
    end: { x: number; y: number };
    coordinateSystem?: "WORLD" | "WORLD_BOTTOM_LEFT" | null;
  } | null;
  winner: {
    teamId: string | null;
    slot: number | null;
    teamName: string;
    teamTag: string | null;
    logoUrl: string | null;
    color: string | null;
    kills: number;
    alivePlayers: number;
    placement: number | null;
  } | null;
};

type RawObserverAggregate = {
  allinfo?: unknown;
  allInfo?: unknown;
  playerInfoList?: unknown;
  teamInfoList?: unknown;
  circleInfo?: unknown;
  routePayloads?: unknown;
  observer?: unknown;
  observingPlayer?: unknown;
};

type CanonicalMatchStatePayload =
  | (Partial<Omit<ObserverLeaderboardPayload, "leaderboard" | "killFeed">> & {
      leaderboard?: Array<Partial<ObserverLeaderboardRow>> | null;
      teams?: unknown[] | null;
      summary?: Record<string, unknown> | null;
      status?: string | null;
      killFeed?: unknown;
    })
  | null;

export const dynamic = "force-dynamic";

function emptyPayload(matchId: string): ObserverLeaderboardPayload {
  return {
    matchId,
    updatedAt: new Date().toISOString(),
    mapName: null,
    teamsAlive: 0,
    leaderboard: [],
    killFeed: [],
    playerCard: null,
    circle: null,
    flightPath: null,
    winner: null,
  };
}

function normalizeLookupText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function compactLookupText(value: string | null | undefined): string | null {
  const normalized = normalizeLookupText(value);
  if (!normalized) {
    return null;
  }

  const compact = normalized.replace(/[^a-z0-9]+/g, "");
  return compact.length > 0 ? compact : null;
}

function isPlaceholderLogoUrl(value: string | null | undefined): boolean {
  const normalized = normalizeLookupText(value);
  return normalized?.endsWith(DEFAULT_TEAM_LOGO_PATH) ?? false;
}

function usableLogoUrl(value: string | null | undefined): string | null {
  const normalized = normalizeApiMediaUrl(value);
  if (!normalized || isPlaceholderLogoUrl(normalized)) {
    return null;
  }
  return normalized;
}

function isPlaceholderTeamIdentity(value: string | null | undefined): boolean {
  const normalized = textValue(value);
  if (!normalized) {
    return false;
  }
  const compact = compactLookupText(normalized);
  if (!compact) {
    return false;
  }
  return (
    compact === "team" ||
    compact === "unknownteam" ||
    /^team\d+$/.test(compact) ||
    /^slot\d+$/.test(compact) ||
    /^s\d+$/.test(compact)
  );
}

function needsCanonicalTeamName(value: string | null | undefined): boolean {
  const normalized = textValue(value);
  return !normalized || isPlaceholderTeamIdentity(normalized);
}

function needsCanonicalTeamTag(value: string | null | undefined): boolean {
  const normalized = textValue(value);
  return !!normalized && isPlaceholderTeamIdentity(normalized);
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

function apiOrigin(): string | null {
  try {
    return new URL(API_URL).origin;
  } catch {
    return null;
  }
}

function publicApiOrigin(): string | null {
  try {
    return new URL(PUBLIC_API_URL).origin;
  } catch {
    return apiOrigin();
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "[::1]" ||
    normalized === "::1"
  );
}

function isInternalApiHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "api" || isLoopbackHostname(normalized);
}

function isApiMediaPath(pathname: string): boolean {
  return API_MEDIA_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function normalizeApiMediaUrl(value: string | null | undefined): string | null {
  const normalized = textValue(value);
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("/assets/defaults/")) {
    return normalized;
  }

  const fetchOrigin = apiOrigin();
  const mediaOrigin = publicApiOrigin() ?? fetchOrigin;
  const parseBase = fetchOrigin ?? mediaOrigin;
  if (!parseBase) {
    return normalized;
  }

  try {
    const parsed = new URL(normalized, parseBase);
    if (parsed.pathname.startsWith("/assets/defaults/")) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }

    if (
      isApiMediaPath(parsed.pathname) &&
      mediaOrigin &&
      (parsed.origin === fetchOrigin ||
        parsed.origin === mediaOrigin ||
        isInternalApiHostname(parsed.hostname))
    ) {
      return `${mediaOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }

    return parsed.toString();
  } catch {
    return normalized;
  }
}

function payloadHasRows(
  payload: ObserverLeaderboardPayload | null | undefined,
): boolean {
  return (
    Array.isArray(payload?.leaderboard) &&
    payload.leaderboard.some(leaderboardRowHasPlayingEvidence)
  );
}

function normalizePayloadMediaUrls(
  payload: ObserverLeaderboardPayload,
): ObserverLeaderboardPayload {
  return {
    ...payload,
    leaderboard: Array.isArray(payload.leaderboard)
      ? payload.leaderboard.map((row) => ({
          ...row,
          logoUrl: normalizeApiMediaUrl(row.logoUrl),
          players: Array.isArray(row.players)
            ? row.players.map((player) => ({
                ...player,
                avatarUrl: normalizeApiMediaUrl(player.avatarUrl),
              }))
            : row.players,
        }))
      : [],
    playerCard: payload.playerCard
      ? {
          ...payload.playerCard,
          avatarUrl: normalizeApiMediaUrl(payload.playerCard.avatarUrl),
          logoUrl: normalizeApiMediaUrl(payload.playerCard.logoUrl),
        }
      : null,
    winner: payload.winner
      ? {
          ...payload.winner,
          logoUrl: normalizeApiMediaUrl(payload.winner.logoUrl),
        }
      : null,
  };
}

function createNoStoreResponse(payload: ObserverLeaderboardPayload) {
  return Response.json(
    normalizePayloadMediaUrls(filterPayloadPlayingRows(payload)),
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}

function slotFromNumericTeamId(value: string | null | undefined): number | null {
  const normalized = textValue(value);
  if (!normalized || !/^\d+$/.test(normalized)) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function slotFromPlaceholderTeamIdentity(
  value: string | null | undefined,
): number | null {
  const compact = compactLookupText(value);
  if (!compact) {
    return null;
  }

  const match = compact.match(/^(?:team|slot|s)(\d+)$/);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : null;
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

function booleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value !== 0;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const normalized = value.trim().toLowerCase();
    if (["true", "alive", "live", "running", "knocked", "down", "dbno"].includes(normalized)) {
      return true;
    }
    if (["false", "dead", "eliminated"].includes(normalized)) {
      return false;
    }
  }
  return null;
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

function isPositiveFiniteNumber(value: unknown): boolean {
  const numeric = numberValue(value);
  return numeric !== null && numeric > 0;
}

function hasExplicitNoShowPresence(
  record: Record<string, unknown> | null,
): boolean {
  return (
    booleanValue(record?.wasPresentInMatch) === false ||
    textValue(record?.presenceStatus)?.toUpperCase() === "NO_SHOW"
  );
}

function hasExplicitPlayingPresence(
  record: Record<string, unknown> | null,
): boolean {
  return (
    booleanValue(record?.wasPresentInMatch) === true ||
    textValue(record?.presenceStatus)?.toUpperCase() === "ACTIVE" ||
    booleanValue(record?.hasTelemetryPresence) === true
  );
}

function canonicalSourceHasPlayingEvidence(value: unknown): boolean {
  const record = asRecord(value);
  if (!record || hasExplicitNoShowPresence(record)) {
    return false;
  }

  return (
    hasExplicitPlayingPresence(record) ||
    asArray(record.players ?? record.Players).length > 0 ||
    isPositiveFiniteNumber(
      firstNumberValue(record, [
        "totalPlayers",
        "TotalPlayers",
        "totalPlayerCount",
        "playerCount",
      ]),
    ) ||
    isPositiveFiniteNumber(
      firstNumberValue(record, [
        "alivePlayers",
        "AlivePlayers",
        "aliveCount",
        "remainingPlayers",
      ]),
    ) ||
    isPositiveFiniteNumber(
      firstNumberValue(record, [
        "kills",
        "Kills",
        "killNum",
        "KillNum",
        "killCount",
      ]),
    ) ||
    isPositiveFiniteNumber(
      firstNumberValue(record, [
        "placement",
        "Placement",
        "finalPlacement",
        "rankIndex",
      ]),
    )
  );
}

function leaderboardRowHasPlayingEvidence(
  row: ObserverLeaderboardRow,
): boolean {
  const record = row as unknown as Record<string, unknown>;
  if (hasExplicitNoShowPresence(record)) {
    return false;
  }

  return (
    hasExplicitPlayingPresence(record) ||
    (Array.isArray(row.players) && row.players.length > 0) ||
    isPositiveFiniteNumber(row.totalPlayers) ||
    isPositiveFiniteNumber(row.alivePlayers) ||
    isPositiveFiniteNumber(row.kills) ||
    isPositiveFiniteNumber(row.placement)
  );
}

function filterPayloadPlayingRows(
  payload: ObserverLeaderboardPayload,
): ObserverLeaderboardPayload {
  const leaderboard = Array.isArray(payload.leaderboard)
    ? payload.leaderboard
        .filter(leaderboardRowHasPlayingEvidence)
        .map((row, index) => ({ ...row, rank: index + 1 }))
    : [];
  const inferredTeamsAlive = leaderboard.reduce(
    (count, row) =>
      count + (row.isEliminated !== true && row.alivePlayers > 0 ? 1 : 0),
    0,
  );
  const teamsAlive =
    typeof payload.teamsAlive === "number" &&
    Number.isFinite(payload.teamsAlive)
      ? payload.teamsAlive > leaderboard.length
        ? inferredTeamsAlive
        : Math.max(0, Math.trunc(payload.teamsAlive))
      : inferredTeamsAlive;
  const winner = payload.winner ?? null;
  const filteredWinner =
    winner &&
    leaderboard.some(
      (row) =>
        (winner.teamId && row.teamId === winner.teamId) ||
        (winner.slot !== null &&
          winner.slot !== undefined &&
          row.slot === winner.slot) ||
        row.teamName === winner.teamName,
    )
      ? winner
      : null;

  return {
    ...payload,
    teamsAlive,
    leaderboard,
    winner: filteredWinner,
  };
}

function collectObserverRecords(...sources: unknown[]): Record<string, unknown>[] {
  const queue = sources
    .map((source) => asRecord(source))
    .filter((source): source is Record<string, unknown> => source !== null);
  const visited = new Set<Record<string, unknown>>();
  const records: Record<string, unknown>[] = [];

  while (queue.length > 0) {
    const record = queue.shift();
    if (!record || visited.has(record)) {
      continue;
    }
    visited.add(record);
    records.push(record);

    for (const value of Object.values(record)) {
      const nested = asRecord(value);
      if (nested && !visited.has(nested)) {
        queue.push(nested);
      }
    }
  }

  return records;
}

function detectObserverCombatStarted(...sources: unknown[]): boolean | null {
  let currentTime: number | null = null;
  let fightingStartTime: number | null = null;
  let gameStartTime: number | null = null;

  for (const record of collectObserverRecords(...sources)) {
    if (currentTime === null) {
      currentTime = firstNumberValue(record, [
        "CurrentTime",
        "currentTime",
        "curTime",
        "CurTime",
      ]);
    }
    if (fightingStartTime === null) {
      fightingStartTime = firstNumberValue(record, [
        "FightingStartTime",
        "fightingStartTime",
        "FightStartTime",
        "fightStartTime",
      ]);
    }
    if (gameStartTime === null) {
      gameStartTime = firstNumberValue(record, [
        "GameStartTime",
        "gameStartTime",
        "StartTime",
        "startTime",
      ]);
    }
  }

  if (fightingStartTime !== null && currentTime !== null) {
    if (fightingStartTime > 0) {
      return currentTime >= fightingStartTime;
    }
    if ((gameStartTime ?? 0) > 0 || currentTime > 0) {
      return false;
    }
  }

  return null;
}

function extractObserverMapName(...sources: unknown[]): string | null {
  for (const source of sources) {
    const record = asRecord(source);
    const directValue = firstTextValue(record, [
      "mapName",
      "MapName",
      "map",
      "Map",
      "mapId",
      "MapId",
      "MapNameStr",
    ]);
    if (directValue) {
      return directValue;
    }

    if (!record) {
      continue;
    }

    for (const nested of Object.values(record)) {
      const nestedValue = firstTextValue(asRecord(nested), [
        "mapName",
        "MapName",
        "map",
        "Map",
        "mapId",
        "MapId",
        "MapNameStr",
      ]);
      if (nestedValue) {
        return nestedValue;
      }
    }
  }

  return null;
}

function isPlayerAlive(record: Record<string, unknown> | null): boolean {
  if (!record) {
    return true;
  }
  const explicitAlive = booleanValue(
    record.isAlive ?? record.IsAlive ?? record.alive ?? record.Alive ?? record.bAlive,
  );
  const explicitDead = booleanValue(
    record.hasDied ??
      record.HasDied ??
      record.bHasDied ??
      record.dead ??
      record.isDead ??
      record.eliminated,
  );
  if (explicitAlive === false || explicitDead === true) {
    return false;
  }

  const stateValue =
    record.liveState ??
    record.LiveState ??
    record.live_state ??
    record.state ??
    record.State ??
    record.status ??
    record.Status;
  const numeric = numberValue(stateValue);
  if (numeric !== null) {
    if (numeric === 1 || numeric === 5) {
      return false;
    }
    if (numeric === 0 || numeric === 3 || numeric === 4) {
      return true;
    }
  }

  const label = textValue(stateValue)?.toLowerCase() ?? null;
  if (label === "dead" || label === "eliminated") {
    return false;
  }
  if (label && ["alive", "live", "running", "down", "knocked", "dbno"].includes(label)) {
    return true;
  }

  const health = firstNumberValue(record, [
    "health",
    "Health",
    "hp",
    "HP",
    "currentHealth",
    "CurrentHealth",
  ]);
  if (health !== null) {
    return health > 0;
  }

  return true;
}

function isPlayerKnocked(record: Record<string, unknown> | null): boolean {
  if (!record) {
    return false;
  }
  const explicit = booleanValue(
    record.isKnocked ??
      record.IsKnocked ??
      record.knocked ??
      record.down ??
      record.isDown ??
      record.isDowned,
  );
  if (explicit !== null) {
    return explicit;
  }

  const stateValue =
    record.liveState ??
    record.LiveState ??
    record.state ??
    record.State ??
    record.status ??
    record.Status;
  const numeric = numberValue(stateValue);
  if (numeric !== null) {
    return numeric === 4;
  }

  const label = textValue(stateValue)?.toLowerCase() ?? null;
  return label === "knocked" || label === "down" || label === "dbno";
}

function formatSlotLabel(_slot: number | null): string {
  void _slot;
  return DEFAULT_WIDGET_TEAM_NAME;
}

function toZone(value: unknown): { x: number; y: number; r: number } | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const x = numberValue(
    record.x ?? record.X ?? record.cx ?? record.centerX ?? record.center_x,
  );
  const y = numberValue(
    record.y ?? record.Y ?? record.cy ?? record.centerY ?? record.center_y,
  );
  const r = numberValue(
    record.r ??
      record.R ??
      record.radius ??
      record.Radius ??
      record.Size ??
      record.size,
  );
  if (x === null || y === null || r === null) {
    return null;
  }
  return { x, y, r };
}

function extractPosition(payload: unknown): { x: number; y: number } | null {
  const record = asRecord(payload);
  const candidate =
    record?.position ??
    record?.location ??
    record?.pos ??
    record?.loc ??
    payload;
  const posRecord = asRecord(candidate);
  if (!posRecord) {
    return null;
  }

  const x = numberValue(
    posRecord.x ??
      posRecord.X ??
      posRecord.lon ??
      posRecord.lng ??
      posRecord.long ??
      null,
  );
  const y = numberValue(posRecord.y ?? posRecord.Y ?? posRecord.lat ?? null);
  if (x === null || y === null) {
    return null;
  }

  return { x, y };
}

function extractFlightPath(payload: unknown): {
  start: { x: number; y: number };
  end: { x: number; y: number };
  coordinateSystem?: "WORLD" | "WORLD_BOTTOM_LEFT" | null;
} | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  const pointFromKeys = (
    source: Record<string, unknown> | null,
    keys: string[],
  ) => {
    if (!source) {
      return null;
    }
    for (const key of keys) {
      const point = extractPosition(source[key]);
      if (point) {
        return point;
      }
    }
    return null;
  };

  const extractFlatPoint = (
    source: Record<string, unknown> | null,
    xKeys: string[],
    yKeys: string[],
  ) => {
    if (!source) {
      return null;
    }
    const x = firstNumberValue(source, xKeys);
    const y = firstNumberValue(source, yKeys);
    return x === null || y === null ? null : { x, y };
  };

  const startKeys = [
    "start",
    "startPoint",
    "startPos",
    "startPosition",
    "routeStart",
    "routeStartPos",
    "planeStart",
    "planeStartPos",
    "flightStart",
    "flightStartPos",
    "aircraftStart",
    "aircraftStartPos",
    "lineStart",
  ];
  const endKeys = [
    "end",
    "endPoint",
    "endPos",
    "endPosition",
    "routeEnd",
    "routeEndPos",
    "planeEnd",
    "planeEndPos",
    "flightEnd",
    "flightEndPos",
    "aircraftEnd",
    "aircraftEndPos",
    "lineEnd",
  ];

  const candidateRecords: Array<Record<string, unknown>> = [record];
  const routePayloads = asRecord(record.routePayloads);
  const routePayloadMap = asRecord(routePayloads?.routePayloads);
  if (routePayloads) {
    candidateRecords.push(routePayloads);
  }
  if (routePayloadMap) {
    candidateRecords.push(routePayloadMap);
  }
  for (const source of [record, routePayloads, routePayloadMap]) {
    if (!source) {
      continue;
    }
    for (const value of Object.values(source)) {
      const nested = asRecord(value);
      if (nested) {
        candidateRecords.push(nested);
      }
    }
  }
  for (const key of [
    "flightPath",
    "flightpath",
    "route",
    "Route",
    "planeRoute",
    "PlaneRoute",
    "flightRoute",
    "FlightRoute",
    "aircraftRoute",
    "AircraftRoute",
    "gameGlobalInfo",
    "GameGlobalInfo",
    "globalInfo",
    "GlobalInfo",
    "/setgameglobalinfo",
    "data",
    "Data",
  ]) {
    const nested = asRecord(record[key]);
    if (nested) {
      candidateRecords.push(nested);
    }
  }

  for (const candidate of candidateRecords) {
    const routePoints = asArray(
      candidate.routePoints ??
        candidate.RoutePoints ??
        candidate.points ??
        candidate.Points ??
        candidate.route ??
        candidate.Route ??
        null,
    );
    if (routePoints.length >= 2) {
      const start = extractPosition(routePoints[0]);
      const end = extractPosition(routePoints[routePoints.length - 1]);
      if (start && end) {
        return { start, end, coordinateSystem: "WORLD" };
      }
    }

    const start =
      pointFromKeys(candidate, startKeys) ??
      extractFlatPoint(
        candidate,
        [
          "startX",
          "StartX",
          "routeStartX",
          "planeStartX",
          "PlaneStartLocX",
          "flightStartX",
          "aircraftStartX",
          "lineStartX",
        ],
        [
          "startY",
          "StartY",
          "routeStartY",
          "planeStartY",
          "PlaneStartLocY",
          "flightStartY",
          "aircraftStartY",
          "lineStartY",
        ],
      );
    const end =
      pointFromKeys(candidate, endKeys) ??
      extractFlatPoint(
        candidate,
        [
          "endX",
          "EndX",
          "routeEndX",
          "planeEndX",
          "PlaneStopLocX",
          "flightEndX",
          "aircraftEndX",
          "lineEndX",
        ],
        [
          "endY",
          "EndY",
          "routeEndY",
          "planeEndY",
          "PlaneStopLocY",
          "flightEndY",
          "aircraftEndY",
          "lineEndY",
        ],
      );

    if (start && end) {
      return { start, end, coordinateSystem: "WORLD" };
    }
  }

  return null;
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return toIso(numeric);
    }
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return null;
}

function toFutureIso(
  value: unknown,
  referenceIso?: string | null,
): string | null {
  const referenceMs = referenceIso ? Date.parse(referenceIso) : Date.now();
  const baseMs = Number.isNaN(referenceMs) ? Date.now() : referenceMs;

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 0 && value <= 86_400) {
      return new Date(baseMs + value * 1000).toISOString();
    }
    return toIso(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      if (numeric >= 0 && numeric <= 86_400) {
        return new Date(baseMs + numeric * 1000).toISOString();
      }
      return toIso(numeric);
    }
    return toIso(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return null;
}

function hasCircleCoreFields(record: Record<string, unknown> | null): boolean {
  if (!record) {
    return false;
  }

  return (
    record.CircleArray !== undefined ||
    record.safeZone !== undefined ||
    record.safezone !== undefined ||
    record.blueZone !== undefined ||
    record.nextZone !== undefined ||
    record.nextzone !== undefined ||
    record.whiteZone !== undefined ||
    record.zoneCenter !== undefined ||
    record.zoneRadius !== undefined ||
    record.phase !== undefined ||
    record.phaseIndex !== undefined ||
    record.circlePhase !== undefined ||
    record.CircleIndex !== undefined ||
    record.circleIndex !== undefined ||
    record.CircleStatus !== undefined ||
    record.circleStatus !== undefined ||
    record.Counter !== undefined ||
    record.MaxTime !== undefined
  );
}

function circleCandidateScore(record: Record<string, unknown> | null): number {
  if (!record) {
    return -1;
  }

  let score = 0;
  if (Array.isArray(record.CircleArray) && record.CircleArray.length > 0) {
    score += 95;
  }
  if (
    (asRecord(record.safeZone) && Object.keys(asRecord(record.safeZone) ?? {}).length > 0) ||
    (asRecord(record.safezone) && Object.keys(asRecord(record.safezone) ?? {}).length > 0) ||
    (asRecord(record.blueZone) && Object.keys(asRecord(record.blueZone) ?? {}).length > 0)
  ) {
    score += 100;
  }
  if (
    (asRecord(record.nextZone) && Object.keys(asRecord(record.nextZone) ?? {}).length > 0) ||
    (asRecord(record.nextzone) && Object.keys(asRecord(record.nextzone) ?? {}).length > 0) ||
    (asRecord(record.whiteZone) && Object.keys(asRecord(record.whiteZone) ?? {}).length > 0)
  ) {
    score += 80;
  }
  if (record.zoneCenter !== undefined || record.zoneRadius !== undefined) {
    score += 60;
  }
  if (
    record.phase !== undefined ||
    record.phaseIndex !== undefined ||
    record.circlePhase !== undefined ||
    record.CircleIndex !== undefined ||
    record.circleIndex !== undefined
  ) {
    score += 20;
  }
  if (record.CircleStatus !== undefined || record.circleStatus !== undefined) {
    score += 10;
  }
  if (record.Counter !== undefined || record.MaxTime !== undefined) {
    score += 10;
  }

  return score;
}

function collectCircleCandidates(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload);
  if (!root) {
    return [];
  }

  const sources: Array<Record<string, unknown>> = [root];
  const allInfo = asRecord(root.allinfo ?? root.allInfo);
  const routePayloads = asRecord(root.routePayloads);
  const routePayloadMap = asRecord(routePayloads?.routePayloads);
  if (allInfo) {
    sources.push(allInfo);
  }
  if (routePayloads) {
    sources.push(routePayloads);
  }
  if (routePayloadMap) {
    sources.push(routePayloadMap);
  }

  const nestedKeys = [
    "circle",
    "circleInfo",
    "CircleInfo",
    "gameGlobalInfo",
    "GameGlobalInfo",
    "globalInfo",
    "GlobalInfo",
    "data",
    "Data",
    "/setcircleinfo",
    "/setgameglobalinfo",
  ];

  const candidates: Record<string, unknown>[] = [];
  const queue = [...sources];
  const visited = new Set<Record<string, unknown>>();

  while (queue.length > 0) {
    const source = queue.shift();
    if (!source || visited.has(source)) {
      continue;
    }
    visited.add(source);

    if (hasCircleCoreFields(source)) {
      candidates.push(source);
    }
    for (const key of nestedKeys) {
      const nested = asRecord(source[key]);
      if (nested && !visited.has(nested)) {
        queue.push(nested);
      }
    }

    for (const value of Object.values(source)) {
      const nested = asRecord(value);
      if (nested && !visited.has(nested)) {
        queue.push(nested);
      }
    }
  }

  return candidates;
}

function extractCircleRecord(payload: unknown): Record<string, unknown> | null {
  let best: Record<string, unknown> | null = null;
  let bestScore = -1;

  for (const candidate of collectCircleCandidates(payload)) {
    const score = circleCandidateScore(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function extractCirclePayload(
  payload: unknown,
  referenceIso?: string | null,
): ObserverLeaderboardPayload["circle"] | null {
  const candidates = collectCircleCandidates(payload).sort(
    (left, right) => circleCandidateScore(right) - circleCandidateScore(left),
  );

  let merged: ObserverLeaderboardPayload["circle"] | null = null;
  for (const candidate of candidates) {
    const next = buildCirclePayload(candidate, referenceIso);
    if (!next) {
      continue;
    }
    merged = mergeCirclePayload(merged, next);
  }

  return merged;
}

function buildCirclePayload(
  circleRecord: Record<string, unknown> | null,
  referenceIso?: string | null,
) {
  if (!circleRecord) {
    return null;
  }

  const counter =
    firstNumberValue(circleRecord, ["Counter", "counter"]) ?? null;
  const maxTime =
    firstNumberValue(circleRecord, ["MaxTime", "maxTime"]) ?? null;
  const nextShrinkAt =
    toFutureIso(
      circleRecord.nextShrinkAt ??
        circleRecord.nextShrinkTs ??
        circleRecord.nextShrinkTime ??
        circleRecord.zoneNextShrinkAt ??
        circleRecord.nextPhaseAt ??
        circleRecord.remainingTime ??
        circleRecord.countdown ??
        null,
      referenceIso,
    ) ??
    (counter !== null && maxTime !== null && maxTime >= counter
      ? toFutureIso(maxTime - counter, referenceIso)
      : null);
  const circleArray = asArray(circleRecord.CircleArray);
  const phaseIndex =
    firstNumberValue(circleRecord, [
      "phase",
      "phaseIndex",
      "circlePhase",
      "CircleIndex",
      "circleIndex",
    ]) ?? null;
  const circleArrayIndex =
    phaseIndex !== null && Number.isFinite(phaseIndex)
      ? Math.max(0, Math.trunc(phaseIndex) - 1)
      : 0;
  const safeZoneFromArray =
    circleArray.length > 0
      ? toZone(circleArray[Math.min(circleArrayIndex, circleArray.length - 1)])
      : null;
  const nextZoneFromArray =
    circleArray.length > circleArrayIndex + 1
      ? toZone(circleArray[circleArrayIndex + 1])
      : null;

  return {
    phase: phaseIndex,
    status:
      textValue(circleRecord.CircleStatus ?? circleRecord.circleStatus) ?? null,
    counterSeconds: counter,
    maxTimeSeconds: maxTime,
    nextShrinkAt,
    safeZone: toZone(
      circleRecord.safeZone ?? circleRecord.safezone ?? circleRecord.blueZone,
    ) ?? safeZoneFromArray,
    nextZone: toZone(
      circleRecord.nextZone ?? circleRecord.nextzone ?? circleRecord.whiteZone,
    ) ?? nextZoneFromArray,
  };
}

function fitSafeZoneFromPlayerSamples(
  samples: Array<{
    x: number;
    y: number;
    inside: boolean;
    rank?: number | null;
    survivalTime?: number | null;
  }>,
): { x: number; y: number; r: number } | null {
  const insideSamples = samples.filter((sample) => sample.inside);
  const outsideSamples = samples.filter((sample) => !sample.inside);
  if (insideSamples.length < 2 || outsideSamples.length < 1) {
    return null;
  }

  const centroid = insideSamples.reduce(
    (acc, sample) => {
      acc.x += sample.x;
      acc.y += sample.y;
      return acc;
    },
    { x: 0, y: 0 },
  );
  const cx = centroid.x / insideSamples.length;
  const cy = centroid.y / insideSamples.length;
  const r = insideSamples.reduce((max, sample) => {
    return Math.max(max, Math.hypot(sample.x - cx, sample.y - cy));
  }, 1);

  const allSamples = [...insideSamples, ...outsideSamples];
  const minX = Math.min(...allSamples.map((sample) => sample.x));
  const maxX = Math.max(...allSamples.map((sample) => sample.x));
  const minY = Math.min(...allSamples.map((sample) => sample.y));
  const maxY = Math.max(...allSamples.map((sample) => sample.y));
  const worldSize = Math.max(maxX - minX, maxY - minY, 8000);
  const smallestStep = Math.max(250, worldSize / 1024);

  const objective = (x: number, y: number, radius: number) => {
    let penalty = 0;

    for (const sample of insideSamples) {
      const gap = Math.hypot(sample.x - x, sample.y - y) - radius;
      if (gap > 0) {
        penalty += gap * gap * 12;
      }
    }

    for (const sample of outsideSamples) {
      const gap = radius - Math.hypot(sample.x - x, sample.y - y);
      if (gap > 0) {
        penalty += gap * gap * 18;
      }
    }

    // Prefer the smallest valid circle once classifications are satisfied.
    penalty += radius * 0.025;
    return penalty;
  };

  let best = { cx, cy, r, score: objective(cx, cy, r) };
  const baseSpan = Math.max(maxX - minX, maxY - minY, worldSize / 8);
  const steps: number[] = [];
  for (
    let step = Math.max(baseSpan / 2, smallestStep * 8);
    step >= smallestStep;
    step /= 2
  ) {
    steps.push(step);
  }

  for (const step of steps) {
    let improved = true;
    while (improved) {
      improved = false;
      const radiusDown = Math.max(smallestStep, best.r - step);
      const candidates = [
        { cx: best.cx + step, cy: best.cy, r: best.r },
        { cx: best.cx - step, cy: best.cy, r: best.r },
        { cx: best.cx, cy: best.cy + step, r: best.r },
        { cx: best.cx, cy: best.cy - step, r: best.r },
        { cx: best.cx + step, cy: best.cy + step, r: best.r },
        { cx: best.cx + step, cy: best.cy - step, r: best.r },
        { cx: best.cx - step, cy: best.cy + step, r: best.r },
        { cx: best.cx - step, cy: best.cy - step, r: best.r },
        { cx: best.cx, cy: best.cy, r: best.r + step },
        { cx: best.cx, cy: best.cy, r: radiusDown },
      ];

      for (const candidate of candidates) {
        const score = objective(candidate.cx, candidate.cy, candidate.r);
        if (score + 1 < best.score) {
          best = { ...candidate, score };
          improved = true;
        }
      }
    }
  }

  const insideViolations = insideSamples.filter(
    (sample) => Math.hypot(sample.x - best.cx, sample.y - best.cy) > best.r,
  ).length;
  const outsideViolations = outsideSamples.filter(
    (sample) => Math.hypot(sample.x - best.cx, sample.y - best.cy) < best.r,
  ).length;

  if (
    insideViolations > Math.max(1, Math.floor(insideSamples.length * 0.2)) ||
    outsideViolations > Math.max(2, Math.floor(outsideSamples.length * 0.35))
  ) {
    return null;
  }

  return {
    x: Math.round(best.cx),
    y: Math.round(best.cy),
    r: Math.round(best.r),
  };
}

function inferSafeZoneFromLegacyPlayerFlags(
  rawState: RawObserverAggregate,
  phaseIndex: number | null | undefined,
): { x: number; y: number; r: number } | null {
  const allInfo = asRecord(rawState.allinfo ?? rawState.allInfo) ?? {};
  const playerList = asArray(
    rawState.playerInfoList ??
      allInfo.TotalPlayerList ??
      allInfo.PlayerList,
  );
  if (playerList.length === 0) {
    return null;
  }

  const allSamples: Array<{
    x: number;
    y: number;
    inside: boolean;
    rank: number | null;
    survivalTime: number | null;
  }> = [];
  const activeSamples: Array<{
    x: number;
    y: number;
    inside: boolean;
    rank: number | null;
    survivalTime: number | null;
  }> = [];

  for (const player of playerList) {
    const record = asRecord(player);
    if (!record) {
      continue;
    }

    const outside = booleanValue(
      record.isOutsideBlueCircle ??
        record.outsideBlueCircle ??
        record.isOutsideSafeZone ??
        record.outsideSafeZone,
    );
    if (outside === null) {
      continue;
    }

    const position = extractPosition(record);
    if (!position) {
      continue;
    }

    const sample = {
      x: position.x,
      y: position.y,
      inside: !outside,
      rank: firstNumberValue(record, ["rank", "Rank"]),
      survivalTime: firstNumberValue(record, ["survivalTime", "SurvivalTime"]),
    };
    allSamples.push(sample);

    if (isPlayerAlive(record)) {
      activeSamples.push(sample);
    }
  }

  const latePlacementThreshold =
    typeof phaseIndex === "number" && Number.isFinite(phaseIndex) && phaseIndex >= 6
      ? 6
      : null;
  const latePlacementSamples =
    latePlacementThreshold !== null
      ? allSamples.filter(
          (sample) =>
            sample.rank !== null && sample.rank <= latePlacementThreshold,
        )
      : [];
  const recentSamples =
    allSamples.length > 0
      ? [...allSamples]
          .sort(
            (left, right) =>
              (right.survivalTime ?? 0) - (left.survivalTime ?? 0),
          )
          .slice(0, 16)
      : [];

  return (
    fitSafeZoneFromPlayerSamples(activeSamples) ??
    fitSafeZoneFromPlayerSamples(latePlacementSamples) ??
    fitSafeZoneFromPlayerSamples(recentSamples) ??
    fitSafeZoneFromPlayerSamples(allSamples)
  );
}

function mergeCirclePayload(
  primary: ObserverLeaderboardPayload["circle"] | null | undefined,
  fallback: ObserverLeaderboardPayload["circle"] | null | undefined,
): ObserverLeaderboardPayload["circle"] | null {
  if (!primary && !fallback) {
    return null;
  }

  return {
    phase: primary?.phase ?? fallback?.phase ?? null,
    status: primary?.status ?? fallback?.status ?? null,
    counterSeconds:
      primary?.counterSeconds ?? fallback?.counterSeconds ?? null,
    maxTimeSeconds:
      primary?.maxTimeSeconds ?? fallback?.maxTimeSeconds ?? null,
    nextShrinkAt: primary?.nextShrinkAt ?? fallback?.nextShrinkAt ?? null,
    safeZone: primary?.safeZone ?? fallback?.safeZone ?? null,
    nextZone: primary?.nextZone ?? fallback?.nextZone ?? null,
  };
}

function buildPlayerCardFromLeaderboardRows(
  rows: ObserverLeaderboardRow[],
  observerRaw: unknown,
) {
  const observer = asRecord(observerRaw);
  if (!observer || Object.keys(observer).length === 0) {
    return null;
  }

  const observerPlayerId = firstTextValue(observer, [
    "playerOpenId",
    "playerOpenID",
    "PlayerOpenId",
    "PlayerOpenID",
    "externalPlayerId",
    "externalId",
    "playerId",
    "playerID",
    "PlayerId",
    "PlayerID",
    "id",
    "ID",
  ]);
  const observerName = firstTextValue(observer, [
    "playerName",
    "PlayerName",
    "ign",
    "IGN",
    "name",
    "Name",
  ]);
  const observerTeamId = firstTextValue(observer, [
    "teamId",
    "teamID",
    "TeamId",
    "TeamID",
    "team_id",
  ]);
  const observerSlot = firstNumberValue(observer, [
    "slot",
    "Slot",
    "teamNo",
    "teamNumber",
    "teamIndex",
    "order",
  ]);
  const normalizedObserverName = observerName?.toLowerCase() ?? null;

  let matchedRow: ObserverLeaderboardRow | null = null;
  let matchedPlayer: ObserverLeaderboardPlayer | null = null;

  for (const row of rows) {
    for (const player of row.players ?? []) {
      if (observerPlayerId && player.playerId === observerPlayerId) {
        matchedRow = row;
        matchedPlayer = player;
        break;
      }
      if (
        !matchedPlayer &&
        normalizedObserverName &&
        player.playerName.trim().toLowerCase() === normalizedObserverName &&
        (!observerTeamId || row.teamId === observerTeamId)
      ) {
        matchedRow = row;
        matchedPlayer = player;
      }
    }
    if (matchedPlayer) {
      break;
    }
  }

  if (!matchedRow) {
    matchedRow =
      rows.find((row) => {
        if (observerTeamId && row.teamId === observerTeamId) {
          return true;
        }
        if (observerSlot !== null && row.slot === Math.trunc(observerSlot)) {
          return true;
        }
        return false;
      }) ?? null;
  }

  if (!matchedPlayer && matchedRow && normalizedObserverName) {
    matchedPlayer =
      matchedRow.players?.find(
        (player) => player.playerName.trim().toLowerCase() === normalizedObserverName,
      ) ?? null;
  }

  return {
    playerId: matchedPlayer?.playerId ?? observerPlayerId ?? null,
    name: matchedPlayer?.playerName ?? observerName ?? "Player",
    avatarUrl:
      firstTextValue(observer, ["avatarUrl", "AvatarUrl", "photoUrl", "PhotoUrl"]) ??
      matchedPlayer?.avatarUrl ??
      null,
    teamId: matchedRow?.teamId ?? observerTeamId ?? null,
    teamName:
      matchedRow?.teamName ??
      firstTextValue(observer, ["teamName", "TeamName", "name"]) ??
      null,
    teamTag:
      matchedRow?.teamTag ??
      firstTextValue(observer, ["teamTag", "tag", "Tag"]) ??
      null,
    logoUrl: matchedRow?.logoUrl ?? null,
    color: matchedRow?.color ?? null,
    kills:
      matchedPlayer?.kills ??
      Math.max(
        0,
        Math.trunc(
          firstNumberValue(observer, [
            "kills",
            "Kills",
            "killNum",
            "KillNum",
            "killCount",
          ]) ?? 0,
        ),
      ),
    alive: matchedPlayer?.alive ?? isPlayerAlive(observer),
    damage: firstNumberValue(observer, [
      "damage",
      "Damage",
      "damageDealt",
      "DamageDealt",
      "totalDamage",
      "TotalDamage",
      "damageValue",
      "DamageValue",
    ]),
  };
}

function playerHasPosition(
  player: ObserverLeaderboardPlayer | null | undefined,
): boolean {
  return Boolean(
    player &&
      typeof player.x === "number" &&
      Number.isFinite(player.x) &&
      typeof player.y === "number" &&
      Number.isFinite(player.y),
  );
}

function payloadHasPlayerPositions(
  payload: ObserverLeaderboardPayload | null | undefined,
): boolean {
  return Boolean(
    payload?.leaderboard.some((row) =>
      (row.players ?? []).some((player) => playerHasPosition(player)),
    ),
  );
}

function payloadPlayerRowCount(
  payload: ObserverLeaderboardPayload | null | undefined,
): number {
  if (!payload || !Array.isArray(payload.leaderboard)) {
    return 0;
  }

  return payload.leaderboard.reduce(
    (count, row) => count + (Array.isArray(row.players) ? row.players.length : 0),
    0,
  );
}

function payloadNeedsCanonicalRosterFallback(
  payload: ObserverLeaderboardPayload | null | undefined,
): boolean {
  return Boolean(
    !payload ||
      !Array.isArray(payload.leaderboard) ||
      payload.leaderboard.length === 0 ||
      payloadPlayerRowCount(payload) === 0,
  );
}

function playerLookupKey(teamId: string | null, playerName: string): string {
  return `${teamId ?? ""}:${playerName.trim().toLowerCase()}`;
}

function mergeDirectPayloadWithLegacyPositions(
  directPayload: ObserverLeaderboardPayload,
  legacyPayload: ObserverLeaderboardPayload,
): ObserverLeaderboardPayload {
  const legacyRowsByTeamId = new Map(
    legacyPayload.leaderboard
      .filter(
        (row): row is ObserverLeaderboardRow & { teamId: string } =>
          typeof row.teamId === "string" && row.teamId.length > 0,
      )
      .map((row) => [row.teamId, row]),
  );
  const legacyRowsBySlot = new Map(
    legacyPayload.leaderboard
      .filter(
        (row): row is ObserverLeaderboardRow & { slot: number } =>
          typeof row.slot === "number" && Number.isFinite(row.slot),
      )
      .map((row) => [row.slot, row]),
  );

  return {
    ...directPayload,
    leaderboard: directPayload.leaderboard.map((row) => {
      const legacyRow =
        (row.teamId ? legacyRowsByTeamId.get(row.teamId) : null) ??
        (typeof row.slot === "number" ? legacyRowsBySlot.get(row.slot) : null) ??
        null;
      const legacyPlayers = legacyRow?.players ?? [];
      const legacyById = new Map(
        legacyPlayers
          .filter(
            (player): player is ObserverLeaderboardPlayer & { playerId: string } =>
              typeof player.playerId === "string" && player.playerId.length > 0,
          )
          .map((player) => [player.playerId, player]),
      );
      const legacyByKey = new Map(
        legacyPlayers.map((player) => [
          playerLookupKey(row.teamId ?? legacyRow?.teamId ?? null, player.playerName),
          player,
        ]),
      );
      const directPlayers = row.players ?? [];
      const mergedPlayers =
        directPlayers.length > 0
          ? directPlayers.map((player) => {
              if (playerHasPosition(player)) {
                return player;
              }

              const legacyPlayer =
                (player.playerId ? legacyById.get(player.playerId) : null) ??
                legacyByKey.get(
                  playerLookupKey(row.teamId ?? legacyRow?.teamId ?? null, player.playerName),
                ) ??
                null;
              if (!legacyPlayer || !playerHasPosition(legacyPlayer)) {
                return player;
              }

              return {
                ...player,
                x: legacyPlayer.x ?? null,
                y: legacyPlayer.y ?? null,
              };
            })
          : legacyPlayers;

      return {
        ...row,
        players: mergedPlayers,
      };
    }),
  };
}

async function fetchObserverJson(path: string): Promise<{
  ok: boolean;
  status: number;
  data: unknown | null;
}> {
  try {
    const response = await fetch(`${OBSERVER_BASE_URL}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) {
      return { ok: false, status: response.status, data: null };
    }
    return {
      ok: true,
      status: response.status,
      data: (await response.json()) as unknown,
    };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

async function fetchApiJson(path: string): Promise<CanonicalMatchStatePayload> {
  try {
    const response = await fetch(`${API_URL}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) {
      return null;
    }

    return (await response.json()) as CanonicalMatchStatePayload;
  } catch {
    return null;
  }
}

async function fetchCanonicalMatchState(
  matchId: string,
): Promise<CanonicalMatchStatePayload> {
  const encodedMatchId = encodeURIComponent(matchId);
  const liveState = await fetchApiJson(`/api/matches/${encodedMatchId}/state`);
  if (canonicalStateHasRows(liveState)) {
    return liveState;
  }

  const widgetState = await fetchApiJson(
    `/api/observer/match/${encodedMatchId}/widget-state`,
  );
  return canonicalStateHasRows(widgetState)
    ? widgetState
    : liveState ?? widgetState;
}

function canonicalStateHasRows(canonical: CanonicalMatchStatePayload): boolean {
  return Boolean(
    canonical &&
      ((Array.isArray(canonical.leaderboard) &&
        canonical.leaderboard.some(canonicalSourceHasPlayingEvidence)) ||
        (Array.isArray(canonical.teams) &&
          canonical.teams.some(canonicalSourceHasPlayingEvidence))),
  );
}

function buildCanonicalPlayer(
  value: unknown,
  index: number,
): ObserverLeaderboardPlayer | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const playerId =
    firstTextValue(record, [
      "playerId",
      "playerID",
      "PlayerId",
      "PlayerID",
      "id",
      "ID",
      "externalPlayerId",
      "externalId",
    ]) ?? null;
  const playerName =
    firstTextValue(record, [
      "playerName",
      "PlayerName",
      "ign",
      "IGN",
      "name",
      "Name",
    ]) ??
    playerId ??
    `Player ${index + 1}`;
  const explicitAlive = booleanValue(
    record.alive ?? record.isAlive ?? record.IsAlive,
  );
  const explicitDead = booleanValue(
    record.hasDied ??
      record.HasDied ??
      record.dead ??
      record.isDead ??
      record.eliminated,
  );
  const alive = explicitAlive ?? (explicitDead === true ? false : true);
  const position = extractPosition(record.position ?? record.location ?? record);

  return {
    playerId,
    playerName,
    avatarUrl:
      firstTextValue(record, [
        "avatarUrl",
        "AvatarUrl",
        "photoUrl",
        "PhotoUrl",
      ]) ?? null,
    kills: Math.max(
      0,
      Math.trunc(
        firstNumberValue(record, [
          "kills",
          "Kills",
          "killNum",
          "KillNum",
          "killCount",
        ]) ?? 0,
      ),
    ),
    alive,
    knocked: alive ? isPlayerKnocked(record) : false,
    health:
      firstNumberValue(record, [
        "health",
        "Health",
        "hp",
        "HP",
        "currentHealth",
        "CurrentHealth",
      ]) ?? null,
    x: position?.x ?? null,
    y: position?.y ?? null,
    hasDied: explicitDead ?? (alive ? false : true),
    lifeTelemetryFresh: booleanValue(record.lifeTelemetryFresh) ?? false,
  };
}

function buildCanonicalLeaderboardRow(
  value: unknown,
  index: number,
): ObserverLeaderboardRow | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const players = asArray(record.players)
    .map((player, playerIndex) => buildCanonicalPlayer(player, playerIndex))
    .filter((player): player is ObserverLeaderboardPlayer => player !== null);
  const slotValue = firstNumberValue(record, [
    "slot",
    "Slot",
    "teamNo",
    "teamNumber",
    "teamIndex",
    "order",
  ]);
  const slot = slotValue === null ? null : Math.trunc(slotValue);
  const alivePlayers = Math.max(
    0,
    Math.trunc(
      firstNumberValue(record, [
        "alivePlayers",
        "AlivePlayers",
        "aliveCount",
        "remainingPlayers",
      ]) ?? players.filter((player) => player.alive).length,
    ),
  );
  const totalPlayersValue = firstNumberValue(record, [
    "totalPlayers",
    "TotalPlayers",
    "totalPlayerCount",
    "playerCount",
  ]);
  const totalPlayers =
    totalPlayersValue === null
      ? players.length || null
      : Math.max(0, Math.trunc(totalPlayersValue));
  const explicitEliminated = booleanValue(
    record.isEliminated ?? record.eliminated,
  );
  const explicitAlive = booleanValue(record.alive ?? record.isAlive);
  const isEliminated =
    explicitEliminated ??
    (explicitAlive !== null
      ? !explicitAlive
      : alivePlayers <= 0 && (totalPlayers ?? players.length) <= 0);

  return {
    rank: Math.max(
      1,
      Math.trunc(firstNumberValue(record, ["rank", "Rank"]) ?? index + 1),
    ),
    teamId:
      firstTextValue(record, [
        "teamId",
        "teamID",
        "TeamId",
        "TeamID",
        "id",
        "ID",
      ]) ?? null,
    slot,
    teamName:
      firstTextValue(record, ["teamName", "TeamName", "name", "Name"]) ??
      formatSlotLabel(slot),
    teamTag: firstTextValue(record, ["teamTag", "tag", "Tag"]),
    logoUrl:
      firstTextValue(record, [
        "logoUrl",
        "LogoUrl",
        "logoPicUrl",
        "logoPICUrl",
        "logo",
      ]) ?? null,
    color: firstTextValue(record, ["color", "Color"]),
    kills: Math.max(
      0,
      Math.trunc(
        firstNumberValue(record, [
          "kills",
          "Kills",
          "killNum",
          "KillNum",
          "killCount",
        ]) ?? 0,
      ),
    ),
    alivePlayers,
    totalPlayers,
    placement: (() => {
      const placement = firstNumberValue(record, [
        "placement",
        "Placement",
        "finalPlacement",
        "rankIndex",
      ]);
      return placement === null ? null : Math.max(1, Math.trunc(placement));
    })(),
    isEliminated,
    players,
  };
}

function rankCanonicalRows(
  rows: ObserverLeaderboardRow[],
  preserveOrder: boolean,
): ObserverLeaderboardRow[] {
  const ordered = preserveOrder
    ? rows
    : [...rows].sort((left, right) => {
        if (left.isEliminated !== right.isEliminated) {
          return left.isEliminated ? 1 : -1;
        }
        if (!left.isEliminated) {
          if (right.kills !== left.kills) {
            return right.kills - left.kills;
          }
          if (right.alivePlayers !== left.alivePlayers) {
            return right.alivePlayers - left.alivePlayers;
          }
        }
        const leftPlacement = left.placement ?? Number.MAX_SAFE_INTEGER;
        const rightPlacement = right.placement ?? Number.MAX_SAFE_INTEGER;
        if (leftPlacement !== rightPlacement) {
          return leftPlacement - rightPlacement;
        }
        const leftSlot = left.slot ?? Number.MAX_SAFE_INTEGER;
        const rightSlot = right.slot ?? Number.MAX_SAFE_INTEGER;
        if (leftSlot !== rightSlot) {
          return leftSlot - rightSlot;
        }
        return left.teamName.localeCompare(right.teamName);
      });

  return ordered.map((row, index) => ({
    ...row,
    rank: preserveOrder ? row.rank : index + 1,
  }));
}

function winnerFromCanonicalRows(
  rows: ObserverLeaderboardRow[],
  teamsAlive: number,
): ObserverLeaderboardPayload["winner"] {
  const winner =
    rows.find((row) => row.alivePlayers > 0 && teamsAlive === 1) ??
    rows.find((row) => row.placement === 1) ??
    null;
  if (!winner) {
    return null;
  }

  return {
    teamId: winner.teamId,
    slot: winner.slot,
    teamName: winner.teamName,
    teamTag: winner.teamTag,
    logoUrl: winner.logoUrl,
    color: winner.color,
    kills: winner.kills,
    alivePlayers: winner.alivePlayers,
    placement: winner.placement,
  };
}

function buildPayloadFromCanonicalState(
  matchId: string,
  canonical: CanonicalMatchStatePayload,
  seed?: ObserverLeaderboardPayload | null,
): ObserverLeaderboardPayload | null {
  const record = asRecord(canonical);
  if (!record) {
    return null;
  }

  const leaderboardSource = asArray(record.leaderboard);
  const teamSource =
    leaderboardSource.length > 0 ? leaderboardSource : asArray(record.teams);
  const rows = teamSource
    .filter(canonicalSourceHasPlayingEvidence)
    .map((row, index) => buildCanonicalLeaderboardRow(row, index))
    .filter(
      (row): row is ObserverLeaderboardRow =>
        row !== null && leaderboardRowHasPlayingEvidence(row),
    );
  if (rows.length === 0) {
    return null;
  }

  const rankedRows = rankCanonicalRows(rows, leaderboardSource.length > 0);
  const summary = asRecord(record.summary);
  const teamsAlive = Math.max(
    0,
    Math.trunc(
      firstNumberValue(record, ["teamsAlive"]) ??
        firstNumberValue(summary, ["aliveTeams", "teamsAlive"]) ??
        rankedRows.reduce(
          (count, row) => count + (row.alivePlayers > 0 ? 1 : 0),
          0,
        ),
    ),
  );
  const canonicalCircle = asRecord(record.circle)
    ? (record.circle as ObserverLeaderboardPayload["circle"])
    : null;
  const canonicalFlightPath = asRecord(record.flightPath)
    ? (record.flightPath as ObserverLeaderboardPayload["flightPath"])
    : null;
  const canonicalWinner = asRecord(record.winner)
    ? (record.winner as ObserverLeaderboardPayload["winner"])
    : winnerFromCanonicalRows(rankedRows, teamsAlive);

  return {
    matchId: textValue(record.matchId) ?? matchId,
    updatedAt:
      textValue(record.updatedAt) ?? seed?.updatedAt ?? new Date().toISOString(),
    mapName: textValue(record.mapName) ?? seed?.mapName ?? null,
    teamsAlive,
    leaderboard: rankedRows,
    killFeed: [],
    playerCard: asRecord(record.playerCard)
      ? (record.playerCard as ObserverLeaderboardPayload["playerCard"])
      : seed?.playerCard ?? null,
    circle: mergeCirclePayload(canonicalCircle, seed?.circle),
    flightPath: canonicalFlightPath ?? seed?.flightPath ?? null,
    winner: canonicalWinner ?? seed?.winner ?? null,
  };
}

function buildCanonicalFallbackPayload(
  matchId: string,
  canonical: CanonicalMatchStatePayload,
  seed?: ObserverLeaderboardPayload | null,
): ObserverLeaderboardPayload | null {
  const canonicalPayload = buildPayloadFromCanonicalState(matchId, canonical, seed);
  if (!canonicalPayload) {
    return null;
  }

  return enrichPayloadWithCanonicalState(canonicalPayload, canonical);
}

function applyResolvedPayloadFields(
  payload: ObserverLeaderboardPayload,
  options: {
    circle?: ObserverLeaderboardPayload["circle"] | null;
    playerCard?: ObserverLeaderboardPayload["playerCard"] | null;
    flightPath?: ObserverLeaderboardPayload["flightPath"] | null;
    mapName?: string | null;
  },
): ObserverLeaderboardPayload {
  return {
    ...payload,
    ...(options.circle
      ? {
          circle: mergeCirclePayload(payload.circle, options.circle),
        }
      : {}),
    ...(options.playerCard
      ? {
          playerCard: payload.playerCard ?? options.playerCard,
        }
      : {}),
    ...(options.flightPath
      ? {
          flightPath: payload.flightPath ?? options.flightPath,
        }
      : {}),
    ...(options.mapName
      ? {
          mapName: payload.mapName ?? options.mapName,
        }
      : {}),
  };
}

function normalizePreCombatPayload(
  payload: ObserverLeaderboardPayload | null | undefined,
): ObserverLeaderboardPayload | null {
  if (!payload) {
    return null;
  }

  const leaderboard = Array.isArray(payload.leaderboard)
    ? payload.leaderboard.filter(leaderboardRowHasPlayingEvidence).map((row, index) => {
        const players = Array.isArray(row.players)
          ? row.players.map((player) => ({
              ...player,
              alive: true,
              knocked: false,
              hasDied: false,
              lifeTelemetryFresh: false,
            }))
          : [];
        const totalPlayers =
          typeof row.totalPlayers === "number" &&
          Number.isFinite(row.totalPlayers) &&
          row.totalPlayers > 0
            ? Math.max(0, Math.trunc(row.totalPlayers))
            : players.length > 0
              ? players.length
              : null;
        const alivePlayers =
          typeof row.alivePlayers === "number" &&
          Number.isFinite(row.alivePlayers) &&
          row.alivePlayers > 0
            ? Math.max(0, Math.trunc(row.alivePlayers))
            : totalPlayers ?? (players.length > 0 ? players.length : 1);

        return {
          ...row,
          rank: index + 1,
          alivePlayers,
          totalPlayers,
          isEliminated: false,
          placement: null,
          players,
        };
      })
    : [];
  const inferredTeamsAlive = leaderboard.length;
  const teamsAlive =
    typeof payload.teamsAlive === "number" && Number.isFinite(payload.teamsAlive)
      ? Math.max(Math.trunc(payload.teamsAlive), inferredTeamsAlive)
      : inferredTeamsAlive;

  return {
    ...payload,
    updatedAt: textValue(payload.updatedAt) ?? new Date().toISOString(),
    teamsAlive,
    leaderboard,
    killFeed: [],
    winner: null,
  };
}

function leaderboardRowHasAlivePlayers(row: ObserverLeaderboardRow): boolean {
  if (
    typeof row.alivePlayers === "number" &&
    Number.isFinite(row.alivePlayers) &&
    row.alivePlayers > 0
  ) {
    return true;
  }

  return (
    row.players?.some(
      (player) =>
        player.lifeTelemetryFresh === true &&
        player.hasDied !== true &&
        player.alive === true,
    ) ?? false
  );
}

function shouldPreservePreCombatRoster(
  payload: ObserverLeaderboardPayload | null | undefined,
  combatStarted: boolean | null,
): boolean {
  if (
    combatStarted === true ||
    !payload ||
    payload.winner ||
    !Array.isArray(payload.leaderboard) ||
    payload.leaderboard.length === 0
  ) {
    return false;
  }

  return !payload.leaderboard.some(
    (row) => row.isEliminated !== true && leaderboardRowHasAlivePlayers(row),
  );
}

function payloadNeedsCanonicalEnrichment(
  payload: ObserverLeaderboardPayload,
): boolean {
  return (
    payloadNeedsCanonicalRosterFallback(payload) ||
    payload.leaderboard.some(
      (row) =>
        !usableLogoUrl(row.logoUrl) ||
        needsCanonicalTeamName(row.teamName) ||
        needsCanonicalTeamTag(row.teamTag),
    ) ||
    Boolean(
      payload.winner &&
        (!usableLogoUrl(payload.winner.logoUrl) ||
          needsCanonicalTeamName(payload.winner.teamName) ||
          needsCanonicalTeamTag(payload.winner.teamTag)),
    ) ||
    Boolean(
      payload.playerCard &&
        (!usableLogoUrl(payload.playerCard.logoUrl) ||
          needsCanonicalTeamName(payload.playerCard.teamName) ||
          needsCanonicalTeamTag(payload.playerCard.teamTag)),
    )
  );
}

function enrichPayloadWithCanonicalState(
  payload: ObserverLeaderboardPayload,
  canonical: CanonicalMatchStatePayload,
): ObserverLeaderboardPayload {
  if (!canonical) {
    return payload;
  }

  const rows =
    Array.isArray(canonical.leaderboard) && canonical.leaderboard.length > 0
      ? canonical.leaderboard.filter(canonicalSourceHasPlayingEvidence)
      : Array.isArray(canonical.teams)
        ? canonical.teams.filter(canonicalSourceHasPlayingEvidence)
        : [];
  type CanonicalTeamMeta = {
    teamName: string | null;
    teamTag: string | null;
    logoUrl: string | null;
    slot: number | null;
  };
  const byTeamId = new Map<string, CanonicalTeamMeta>();
  const bySlot = new Map<number, CanonicalTeamMeta>();
  const byTag = new Map<string, CanonicalTeamMeta>();
  const byName = new Map<string, CanonicalTeamMeta>();
  const byCompactName = new Map<string, CanonicalTeamMeta>();

  for (const row of rows) {
    const source = asRecord(row);
    const teamId = textValue(source?.teamId);
    const slot =
      typeof source?.slot === "number" && Number.isFinite(source.slot)
        ? Math.trunc(source.slot)
        : null;
    const teamTag = normalizeLookupText(textValue(source?.teamTag));
    const teamName = normalizeLookupText(textValue(source?.teamName));
    const compactTeamName = compactLookupText(textValue(source?.teamName));
    const meta: CanonicalTeamMeta = {
      teamName: textValue(source?.teamName),
      teamTag: textValue(source?.teamTag),
      logoUrl: usableLogoUrl(textValue(source?.logoUrl)),
      slot,
    };

    if (teamId && !byTeamId.has(teamId)) {
      byTeamId.set(teamId, meta);
    }
    if (slot !== null && !bySlot.has(slot)) {
      bySlot.set(slot, meta);
    }
    if (teamTag && !byTag.has(teamTag)) {
      byTag.set(teamTag, meta);
    }
    if (teamName && !byName.has(teamName)) {
      byName.set(teamName, meta);
    }
    if (compactTeamName && !byCompactName.has(compactTeamName)) {
      byCompactName.set(compactTeamName, meta);
    }
  }

  const resolveCanonicalMeta = ({
    teamId,
    slot,
    teamTag,
    teamName,
  }: {
    teamId?: string | null;
    slot?: number | null;
    teamTag?: string | null;
    teamName?: string | null;
  }): CanonicalTeamMeta | null => {
    const resolvedById = teamId ? byTeamId.get(teamId) ?? null : null;
    if (resolvedById) {
      return resolvedById;
    }

    const derivedSlot = slotFromNumericTeamId(teamId);
    if (derivedSlot !== null) {
      const resolvedByDerivedSlot = bySlot.get(derivedSlot) ?? null;
      if (resolvedByDerivedSlot) {
        return resolvedByDerivedSlot;
      }
    }

    if (typeof slot === "number" && Number.isFinite(slot)) {
      const resolvedBySlot = bySlot.get(Math.trunc(slot)) ?? null;
      if (resolvedBySlot) {
        return resolvedBySlot;
      }
    }

    const derivedPlaceholderSlot =
      slotFromPlaceholderTeamIdentity(teamName) ??
      slotFromPlaceholderTeamIdentity(teamTag);
    if (derivedPlaceholderSlot !== null) {
      const resolvedByPlaceholderSlot = bySlot.get(derivedPlaceholderSlot) ?? null;
      if (resolvedByPlaceholderSlot) {
        return resolvedByPlaceholderSlot;
      }
    }

    const normalizedTag = normalizeLookupText(teamTag);
    if (normalizedTag) {
      const resolvedByTag = byTag.get(normalizedTag) ?? null;
      if (resolvedByTag) {
        return resolvedByTag;
      }
    }

    const normalizedName = normalizeLookupText(teamName);
    if (normalizedName) {
      const resolvedByName = byName.get(normalizedName) ?? null;
      if (resolvedByName) {
        return resolvedByName;
      }
    }

    const compactName = compactLookupText(teamName);
    if (compactName) {
      return byCompactName.get(compactName) ?? null;
    }

    return null;
  };

  const resolveLogo = (
    currentLogoUrl: string | null | undefined,
    meta: CanonicalTeamMeta | null,
  ): string | null => usableLogoUrl(currentLogoUrl) ?? meta?.logoUrl ?? null;

  const resolveTeamName = (
    currentTeamName: string | null | undefined,
    canonicalTeamName: string | null | undefined,
    slot: number | null,
  ): string => {
    const current = textValue(currentTeamName);
    if (current && !needsCanonicalTeamName(current)) {
      return current;
    }
    const canonicalValue = textValue(canonicalTeamName);
    if (canonicalValue && !isPlaceholderTeamIdentity(canonicalValue)) {
      return canonicalValue;
    }
    return current ?? canonicalValue ?? formatSlotLabel(slot);
  };

  const resolveTeamTag = (
    currentTeamTag: string | null | undefined,
    canonicalTeamTag: string | null | undefined,
  ): string | null => {
    const current = textValue(currentTeamTag);
    if (current && !needsCanonicalTeamTag(current)) {
      return current;
    }
    const canonicalValue = textValue(canonicalTeamTag);
    if (canonicalValue && !isPlaceholderTeamIdentity(canonicalValue)) {
      return canonicalValue;
    }
    return DEFAULT_WIDGET_TEAM_TAG;
  };

  return {
    ...payload,
    leaderboard: payload.leaderboard.map((row) => {
      const meta = resolveCanonicalMeta({
        teamId: row.teamId,
        slot: row.slot,
        teamTag: row.teamTag,
        teamName: row.teamName,
      });
      const slot = row.slot ?? meta?.slot ?? null;
      return {
        ...row,
        slot,
        teamName: resolveTeamName(row.teamName, meta?.teamName, slot),
        teamTag: resolveTeamTag(row.teamTag, meta?.teamTag),
        logoUrl: resolveLogo(row.logoUrl, meta),
      };
    }),
    winner: payload.winner
      ? (() => {
          const meta = resolveCanonicalMeta({
            teamId: payload.winner.teamId,
            slot: payload.winner.slot,
            teamTag: payload.winner.teamTag,
            teamName: payload.winner.teamName,
          });
          const slot = payload.winner.slot ?? meta?.slot ?? null;
          return {
            ...payload.winner,
            slot,
            teamName: resolveTeamName(
              payload.winner.teamName,
              meta?.teamName,
              slot,
            ),
            teamTag: resolveTeamTag(payload.winner.teamTag, meta?.teamTag),
            logoUrl: resolveLogo(payload.winner.logoUrl, meta),
          };
        })()
      : null,
    playerCard: payload.playerCard
      ? (() => {
          const meta = resolveCanonicalMeta({
            teamId: payload.playerCard.teamId,
            teamTag: payload.playerCard.teamTag,
            teamName: payload.playerCard.teamName,
          });
          return {
            ...payload.playerCard,
            teamName:
              resolveTeamName(
                payload.playerCard.teamName,
                meta?.teamName,
                meta?.slot ?? null,
              ) ??
              null,
            teamTag: resolveTeamTag(payload.playerCard.teamTag, meta?.teamTag),
            logoUrl: resolveLogo(payload.playerCard.logoUrl, meta),
          };
        })()
      : null,
  };
}

function buildPayloadFromLegacyState(
  matchId: string,
  rawState: RawObserverAggregate,
): ObserverLeaderboardPayload {
  const allInfo = asRecord(rawState.allinfo ?? rawState.allInfo) ?? {};
  const teamList = asArray(
    rawState.teamInfoList ??
      allInfo.TeamInfoList ??
      allInfo.teamInfoList,
  );
  const playerList = asArray(
    rawState.playerInfoList ??
      allInfo.TotalPlayerList ??
      allInfo.PlayerList,
  );
  const playersByTeam = new Map<string, ObserverLeaderboardPlayer[]>();

  for (const player of playerList) {
    const record = asRecord(player);
    if (!record) {
      continue;
    }
    const teamId = firstTextValue(record, [
      "teamId",
      "teamID",
      "TeamId",
      "TeamID",
      "team_id",
    ]);
    const playerId =
      firstTextValue(record, [
        "playerOpenId",
        "playerOpenID",
        "PlayerOpenId",
        "PlayerOpenID",
        "openId",
        "OpenId",
        "openid",
      ]) ??
      firstTextValue(record, ["externalPlayerId", "externalId"]) ??
      firstTextValue(record, [
        "playerId",
        "playerID",
        "PlayerId",
        "PlayerID",
        "id",
        "ID",
      ]) ??
      firstTextValue(record, ["playerName", "PlayerName", "ign", "name"]);
    if (!playerId) {
      continue;
    }
    const alive = isPlayerAlive(record);
    const position = extractPosition(record);
    const normalizedPlayer: ObserverLeaderboardPlayer = {
      playerId,
      playerName:
        firstTextValue(record, ["playerName", "PlayerName", "ign", "IGN", "name"]) ??
        "Player",
      avatarUrl: null,
      kills: Math.max(
        0,
        Math.trunc(
          firstNumberValue(record, [
            "kills",
            "killNum",
            "killCount",
            "killnum",
            "kill_count",
          ]) ?? 0,
        ),
      ),
      alive,
      knocked: alive ? isPlayerKnocked(record) : false,
      health:
        firstNumberValue(record, [
          "health",
          "Health",
          "hp",
          "HP",
          "currentHealth",
          "CurrentHealth",
        ]) ?? null,
      x: position?.x ?? null,
      y: position?.y ?? null,
      hasDied: alive ? false : true,
      lifeTelemetryFresh: true,
    };
    const bucket = playersByTeam.get(teamId ?? "__unassigned__") ?? [];
    bucket.push(normalizedPlayer);
    playersByTeam.set(teamId ?? "__unassigned__", bucket);
  }

  const rows: ObserverLeaderboardRow[] = [];
  const seenTeamIds = new Set<string>();

  for (const team of teamList) {
    const record = asRecord(team);
    if (!record) {
      continue;
    }
    const teamId =
      firstTextValue(record, [
        "teamId",
        "teamID",
        "TeamId",
        "TeamID",
        "team",
        "id",
        "ID",
      ]) ??
      firstTextValue(record, ["teamName", "TeamName", "name"]);
    if (!teamId || seenTeamIds.has(teamId)) {
      continue;
    }
    seenTeamIds.add(teamId);

    const teamPlayers = playersByTeam.get(teamId) ?? [];
    const alivePlayers =
      firstNumberValue(record, [
        "alivePlayers",
        "AlivePlayers",
        "aliveCount",
        "remainPlayerNum",
        "remainingPlayers",
        "liveMemberNum",
        "LiveMemberNum",
        "aliveMemberNum",
        "AliveMemberNum",
      ]) ?? teamPlayers.filter((player) => player.alive).length;
    const totalPlayers =
      firstNumberValue(record, [
        "totalPlayers",
        "TotalPlayers",
        "totalPlayerCount",
        "playerCount",
        "memberNum",
        "playerNum",
      ]) ?? teamPlayers.length;
    const slotValue = firstNumberValue(record, [
      "slot",
      "Slot",
      "teamNo",
      "teamNumber",
      "teamIndex",
      "order",
    ]) ??
      slotFromNumericTeamId(teamId) ??
      slotFromPlaceholderTeamIdentity(
        firstTextValue(record, ["teamName", "TeamName", "name"]),
      ) ??
      slotFromPlaceholderTeamIdentity(
        firstTextValue(record, ["teamTag", "tag", "Tag"]),
      );
    rows.push({
      rank: 0,
      teamId,
      slot: slotValue === null ? null : Math.trunc(slotValue),
      teamName:
        firstTextValue(record, ["teamName", "TeamName", "name"]) ??
        formatSlotLabel(slotValue === null ? null : Math.trunc(slotValue)),
      teamTag: firstTextValue(record, ["teamTag", "tag", "Tag"]),
      logoUrl:
        firstTextValue(record, [
          "logoUrl",
          "LogoUrl",
          "logoPicUrl",
          "logoPICUrl",
          "logo",
        ]) ?? null,
      color: null,
      kills: Math.max(
        0,
        Math.trunc(
          firstNumberValue(record, ["kills", "Kills", "killNum", "KillNum", "killCount"]) ?? 0,
        ),
      ),
      alivePlayers: Math.max(0, Math.trunc(alivePlayers)),
      totalPlayers: Math.max(Math.trunc(alivePlayers), Math.trunc(totalPlayers)) || null,
      placement: (() => {
        const placement = firstNumberValue(record, ["rank", "Rank", "placement", "placementIndex"]);
        return placement === null ? null : Math.max(1, Math.trunc(placement));
      })(),
      isEliminated: Math.trunc(alivePlayers) <= 0,
      players: teamPlayers,
    });
  }

  for (const [teamId, teamPlayers] of playersByTeam.entries()) {
    if (teamId === "__unassigned__" || seenTeamIds.has(teamId)) {
      continue;
    }
    rows.push({
      rank: 0,
      teamId,
      slot: null,
      teamName: formatSlotLabel(null),
      teamTag: DEFAULT_WIDGET_TEAM_TAG,
      logoUrl: null,
      color: null,
      kills: Math.max(0, teamPlayers.reduce((sum, player) => sum + player.kills, 0)),
      alivePlayers: teamPlayers.filter((player) => player.alive).length,
      totalPlayers: teamPlayers.length || null,
      placement: null,
      isEliminated: teamPlayers.every((player) => !player.alive),
      players: teamPlayers,
    });
  }

  rows.sort((left, right) => {
    if (left.isEliminated !== right.isEliminated) {
      return left.isEliminated ? 1 : -1;
    }
    if (!left.isEliminated) {
      if (right.kills !== left.kills) {
        return right.kills - left.kills;
      }
      if (right.alivePlayers !== left.alivePlayers) {
        return right.alivePlayers - left.alivePlayers;
      }
    }
    const leftPlacement = left.placement ?? Number.MAX_SAFE_INTEGER;
    const rightPlacement = right.placement ?? Number.MAX_SAFE_INTEGER;
    if (leftPlacement !== rightPlacement) {
      return leftPlacement - rightPlacement;
    }
    const leftSlot = left.slot ?? Number.MAX_SAFE_INTEGER;
    const rightSlot = right.slot ?? Number.MAX_SAFE_INTEGER;
    if (leftSlot !== rightSlot) {
      return leftSlot - rightSlot;
    }
    return left.teamName.localeCompare(right.teamName);
  });

  const teamsAlive = rows.reduce(
    (count, row) => count + (row.alivePlayers > 0 ? 1 : 0),
    0,
  );
  const rankedRows = rows.map((row, index) => ({
    ...row,
    rank: index + 1,
    placement: row.placement ?? (teamsAlive === 1 && row.alivePlayers > 0 ? 1 : null),
  }));
  const winner =
    rankedRows.find((row) => row.alivePlayers > 0 && teamsAlive === 1) ??
    rankedRows.find((row) => row.placement === 1) ??
    null;
  const observingPlayer =
    asRecord(rawState.observer) ?? asRecord(rawState.observingPlayer);
  const routePayloads = asRecord(rawState.routePayloads);
  const mapName = extractObserverMapName(
    allInfo,
    routePayloads?.["/setgameglobalinfo"],
    routePayloads?.["/setcircleinfo"],
    rawState.circleInfo,
    playerList[0] ?? null,
    observingPlayer,
    rawState.routePayloads,
  );

  const rawCircle = extractCirclePayload(
    {
      circleInfo: rawState.circleInfo ?? null,
      routePayloads: rawState.routePayloads ?? null,
      allInfo,
    },
    new Date().toISOString(),
  );
  const inferredSafeZone =
    rawCircle?.safeZone ??
    inferSafeZoneFromLegacyPlayerFlags(rawState, rawCircle?.phase ?? null);
  const circle =
    rawCircle || inferredSafeZone
      ? {
          phase: rawCircle?.phase ?? null,
          status: rawCircle?.status ?? null,
          counterSeconds: rawCircle?.counterSeconds ?? null,
          maxTimeSeconds: rawCircle?.maxTimeSeconds ?? null,
          nextShrinkAt: rawCircle?.nextShrinkAt ?? null,
          safeZone: rawCircle?.safeZone ?? inferredSafeZone ?? null,
          nextZone: rawCircle?.nextZone ?? null,
        }
      : null;

  return {
    matchId,
    updatedAt: new Date().toISOString(),
    mapName,
    teamsAlive,
    leaderboard: rankedRows,
    killFeed: [],
    playerCard: buildPlayerCardFromLeaderboardRows(rankedRows, observingPlayer),
    circle,
    flightPath:
      extractFlightPath(rawState.routePayloads) ??
      extractFlightPath(rawState.allinfo ?? rawState.allInfo) ??
      null,
    winner: winner
      ? {
          teamId: winner.teamId,
          slot: winner.slot,
          teamName: winner.teamName,
          teamTag: winner.teamTag,
          logoUrl: winner.logoUrl,
          color: winner.color,
          kills: winner.kills,
          alivePlayers: winner.alivePlayers,
          placement: winner.placement,
        }
      : null,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const matchId = url.searchParams.get("matchId")?.trim() || "observer-direct";
  const launcherOnly = url.searchParams.get("launcherOnly") === "1";
  let effectiveMatchId = matchId;
  let canonicalState: CanonicalMatchStatePayload = null;

  let direct = await fetchObserverJson(
    `/widget/leaderboard?matchId=${encodeURIComponent(matchId)}`,
  );
  if (direct.status === 409) {
    const conflict = asRecord(direct.data);
    const observerMatchId = textValue(conflict?.activeMatchId);
    if (observerMatchId && observerMatchId !== effectiveMatchId) {
      effectiveMatchId = observerMatchId;
      direct = await fetchObserverJson(
        `/widget/leaderboard?matchId=${encodeURIComponent(observerMatchId)}`,
      );
    }
  }
  if (direct.ok && direct.data) {
    const directPayload = direct.data as ObserverLeaderboardPayload;
    const directPayloadRecord = asRecord(direct.data);
    const directCircle = asRecord(directPayloadRecord?.circle);
    const directCirclePhase =
      numberValue(directCircle?.phase) ??
      numberValue(directCircle?.phaseIndex) ??
      numberValue(directCircle?.CircleIndex);
    const shouldForcePhaseAwareCircleEnrichment =
      directCirclePhase !== null && directCirclePhase > 1;
    const needsCircleEnrichment =
      !directCircle ||
      directCircle.status === null ||
      directCircle.status === undefined ||
      directCircle.counterSeconds === null ||
      directCircle.counterSeconds === undefined ||
      directCircle.maxTimeSeconds === null ||
        directCircle.maxTimeSeconds === undefined ||
      (directCircle.nextShrinkAt === null ||
        directCircle.nextShrinkAt === undefined ||
        (directCircle.safeZone == null && directCircle.nextZone == null));
    const needsPlayerCardEnrichment = directPayload?.playerCard == null;
    const needsPositionEnrichment = !payloadHasPlayerPositions(directPayload);
    const needsMapName = !textValue(directPayload?.mapName);
    const needsAllInfoEnrichment =
      !launcherOnly ||
      needsPositionEnrichment ||
      needsCircleEnrichment ||
      needsMapName;
    const needsFlightPathEnrichment = directPayload?.flightPath == null;
    const needsRoutePayloadEnrichment =
      needsFlightPathEnrichment ||
      needsCircleEnrichment ||
      shouldForcePhaseAwareCircleEnrichment;
    const needsCanonicalEnrichment =
      !launcherOnly && payloadNeedsCanonicalEnrichment(directPayload);

    const [circleRes, observerRes, allInfoRes, playersRes, teamsRes, routePayloadsRes] = await Promise.all([
      needsCircleEnrichment
        ? fetchObserverJson("/getcircleinfo")
        : Promise.resolve({ ok: false, status: 404, data: null }),
      needsPlayerCardEnrichment
        ? fetchObserverJson("/getobservingplayer")
        : Promise.resolve({ ok: false, status: 404, data: null }),
      needsAllInfoEnrichment
        ? fetchObserverJson("/getallinfo")
        : Promise.resolve({ ok: false, status: 404, data: null }),
      needsPositionEnrichment
        ? fetchObserverJson("/gettotalplayerlist")
        : Promise.resolve({ ok: false, status: 404, data: null }),
      needsPositionEnrichment
        ? fetchObserverJson("/getteaminfolist")
        : Promise.resolve({ ok: false, status: 404, data: null }),
      needsRoutePayloadEnrichment
        ? fetchObserverJson("/getroutepayloads")
        : Promise.resolve({ ok: false, status: 404, data: null }),
    ]);
    const combatStarted = launcherOnly
      ? null
      : detectObserverCombatStarted(
          directPayloadRecord,
          allInfoRes.data,
          routePayloadsRes.data,
        );
    const shouldPreserveDirectPreCombatRoster =
      shouldPreservePreCombatRoster(directPayload, combatStarted);
    const shouldLoadCanonicalState =
      !launcherOnly &&
      (shouldPreserveDirectPreCombatRoster ||
        (needsCanonicalEnrichment && combatStarted === true));
    if (shouldLoadCanonicalState) {
      canonicalState = await fetchCanonicalMatchState(effectiveMatchId);
    }
    if (
      !shouldPreserveDirectPreCombatRoster &&
      !needsCircleEnrichment &&
      !needsPlayerCardEnrichment &&
      !needsPositionEnrichment &&
      !needsFlightPathEnrichment &&
      !needsCanonicalEnrichment &&
      !needsMapName
    ) {
      return createNoStoreResponse(directPayload);
    }
    const fallbackCircle = extractCirclePayload(
      {
        circleInfo: circleRes.data ?? null,
        routePayloads: routePayloadsRes.data ?? null,
        allInfo: allInfoRes.data ?? null,
      },
      directPayload.updatedAt ?? new Date().toISOString(),
    );
    const fallbackPlayerCard = needsPlayerCardEnrichment
      ? buildPlayerCardFromLeaderboardRows(
          Array.isArray(directPayload?.leaderboard) ? directPayload.leaderboard : [],
          observerRes.data,
        )
      : directPayload.playerCard;
    const fallbackLegacyPayload =
      (needsPositionEnrichment || needsCircleEnrichment || needsMapName) &&
      (allInfoRes.ok || playersRes.ok || teamsRes.ok)
        ? buildPayloadFromLegacyState(effectiveMatchId, {
            ...(asRecord(allInfoRes.data) ?? {}),
            playerInfoList:
              asRecord(playersRes.data)?.playerInfoList ?? playersRes.data ?? null,
            teamInfoList:
              asRecord(teamsRes.data)?.teamInfoList ?? teamsRes.data ?? null,
            circleInfo: circleRes.data ?? null,
            observer: observerRes.data ?? null,
            routePayloads: routePayloadsRes.data ?? null,
          })
        : null;
    const fallbackFlightPath =
      needsRoutePayloadEnrichment
        ? extractFlightPath(routePayloadsRes.data) ??
          extractFlightPath(allInfoRes.data) ??
          fallbackLegacyPayload?.flightPath ??
          null
        : directPayload.flightPath;
    const mergedFallbackCircle = mergeCirclePayload(
      fallbackCircle,
      fallbackLegacyPayload?.circle,
    );
    const resolvedCircle = shouldForcePhaseAwareCircleEnrichment
      ? mergeCirclePayload(
          mergedFallbackCircle,
          directPayload.circle,
        )
      : mergeCirclePayload(
          directPayload.circle,
          mergedFallbackCircle,
        );
    if (!directPayloadRecord) {
      return createNoStoreResponse(directPayload);
    }

    const resolvedMapName =
      textValue(directPayload.mapName) ??
      textValue(fallbackLegacyPayload?.mapName) ??
      null;
    if (shouldPreserveDirectPreCombatRoster) {
      let preCombatPayload =
        buildPayloadFromCanonicalState(
          effectiveMatchId,
          canonicalState,
          directPayload,
        ) ?? directPayload;
      preCombatPayload = applyResolvedPayloadFields(preCombatPayload, {
        circle: resolvedCircle,
        playerCard: fallbackPlayerCard,
        flightPath: fallbackFlightPath,
        mapName: resolvedMapName,
      });
      if (fallbackLegacyPayload && !payloadHasPlayerPositions(preCombatPayload)) {
        preCombatPayload = mergeDirectPayloadWithLegacyPositions(
          preCombatPayload,
          fallbackLegacyPayload,
        );
      }
      preCombatPayload = enrichPayloadWithCanonicalState(
        preCombatPayload,
        canonicalState,
      );
      return createNoStoreResponse(
        normalizePreCombatPayload(preCombatPayload) ??
          emptyPayload(effectiveMatchId),
      );
    }
    const mergedPayload = {
      ...directPayloadRecord,
      ...((needsCircleEnrichment || shouldForcePhaseAwareCircleEnrichment) &&
      resolvedCircle
        ? {
            circle: resolvedCircle,
          }
        : {}),
      ...(needsPlayerCardEnrichment && fallbackPlayerCard
        ? { playerCard: fallbackPlayerCard }
        : {}),
      ...(needsPositionEnrichment && fallbackLegacyPayload
        ? {
            leaderboard: mergeDirectPayloadWithLegacyPositions(
              directPayload,
              fallbackLegacyPayload,
            ).leaderboard,
          }
        : {}),
      ...(needsRoutePayloadEnrichment && fallbackFlightPath
        ? { flightPath: fallbackFlightPath }
        : {}),
      ...(resolvedMapName ? { mapName: resolvedMapName } : {}),
    } as ObserverLeaderboardPayload;
    const resolvedPayload = launcherOnly
      ? mergedPayload
      : enrichPayloadWithCanonicalState(
          mergedPayload,
          canonicalState,
        );
    if (!payloadHasRows(resolvedPayload)) {
      canonicalState =
        canonicalState ?? (await fetchCanonicalMatchState(effectiveMatchId));
      const canonicalFallback = buildCanonicalFallbackPayload(
        effectiveMatchId,
        canonicalState,
        mergedPayload,
      );
      if (canonicalFallback) {
        return createNoStoreResponse(canonicalFallback);
      }
    }

    return createNoStoreResponse(resolvedPayload);
  }

  const [allInfoRes, playersRes, teamsRes, circleRes, observerRes] = await Promise.all([
    fetchObserverJson("/getallinfo"),
    fetchObserverJson("/gettotalplayerlist"),
    fetchObserverJson("/getteaminfolist"),
    fetchObserverJson("/getcircleinfo"),
    fetchObserverJson("/getobservingplayer"),
  ]);

  const hasLegacyData =
    allInfoRes.ok || playersRes.ok || teamsRes.ok || circleRes.ok;
  const combatStarted = launcherOnly
    ? null
    : detectObserverCombatStarted(allInfoRes.data, circleRes.data);
  if (!hasLegacyData) {
    canonicalState = await fetchCanonicalMatchState(effectiveMatchId);
    const canonicalFallback = buildCanonicalFallbackPayload(
      effectiveMatchId,
      canonicalState,
    );
    return createNoStoreResponse(
      canonicalFallback ?? emptyPayload(effectiveMatchId),
    );
  }

  const legacyPayload = buildPayloadFromLegacyState(effectiveMatchId, {
    ...(asRecord(allInfoRes.data) ?? {}),
    playerInfoList:
      asRecord(playersRes.data)?.playerInfoList ?? playersRes.data ?? null,
    teamInfoList:
      asRecord(teamsRes.data)?.teamInfoList ?? teamsRes.data ?? null,
    circleInfo: circleRes.data ?? null,
    observer: observerRes.data ?? null,
    routePayloads: null,
  });
  const shouldPreserveLegacyPreCombatRoster =
    shouldPreservePreCombatRoster(legacyPayload, combatStarted);

  if (!launcherOnly && (combatStarted !== null || shouldPreserveLegacyPreCombatRoster)) {
    canonicalState = await fetchCanonicalMatchState(effectiveMatchId);
  }
  if (shouldPreserveLegacyPreCombatRoster) {
    let preCombatPayload =
      buildPayloadFromCanonicalState(
        effectiveMatchId,
        canonicalState,
        legacyPayload,
      ) ?? legacyPayload;
    if (!payloadHasPlayerPositions(preCombatPayload)) {
      preCombatPayload = mergeDirectPayloadWithLegacyPositions(
        preCombatPayload,
        legacyPayload,
      );
    }
    preCombatPayload = enrichPayloadWithCanonicalState(
      preCombatPayload,
      canonicalState,
    );
    return createNoStoreResponse(
      normalizePreCombatPayload(preCombatPayload) ??
        emptyPayload(effectiveMatchId),
    );
  }
  return createNoStoreResponse(
    enrichPayloadWithCanonicalState(
      legacyPayload,
      canonicalState,
    ),
  );
}
