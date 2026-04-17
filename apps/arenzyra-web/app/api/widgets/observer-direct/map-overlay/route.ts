const OBSERVER_BASE_URL =
  process.env.OBSERVER_BASE_URL ?? "http://127.0.0.1:10086";
const OBSERVER_REQUEST_TIMEOUT_MS = 1_500;

type CoordinateSystem = "WORLD" | "WORLD_BOTTOM_LEFT";
type MapOverlayProducer =
  | "observer-map-overlay"
  | "observer-leaderboard-derived-fallback";

type ObserverDirectMapOverlayPayload = {
  matchId: string;
  updatedAt: string;
  debug?: {
    producer?: MapOverlayProducer | null;
    totalPlayers?: number | null;
    positionedPlayers?: number | null;
    playerMarkers?: number | null;
    teamMarkers?: number | null;
    worldSize?: number | null;
    bounds?: {
      minX?: number | null;
      maxX?: number | null;
      minY?: number | null;
      maxY?: number | null;
    } | null;
  } | null;
  map: {
    mapName: string;
    worldSize: number;
    coordinateSystem?: CoordinateSystem | null;
  } | null;
  circle: {
    safeZone: { x: number; y: number; r: number } | null;
    nextZone: { x: number; y: number; r: number } | null;
    phaseIndex: number | null;
    status: string | null;
    counterSeconds: number | null;
    maxTimeSeconds: number | null;
    nextShrinkAt: string | null;
    timerRemaining: number | null;
    timeRemainingToNextPhase: number | null;
    phaseLabel: string | null;
  } | null;
  flightPath: {
    start: { x: number; y: number };
    end: { x: number; y: number };
    coordinateSystem?: CoordinateSystem | null;
  } | null;
  teamMarkers: Array<{
    teamId: string | null;
    x: number;
    y: number;
    alive?: boolean;
    playerCount: number;
    alivePlayers: number;
  }>;
  playerMarkers: Array<{
    playerId?: string | null;
    teamId?: string | null;
    x: number;
    y: number;
    alive?: boolean;
    knocked?: boolean;
  }>;
};

type ObserverLeaderboardPayload = {
  matchId: string;
  updatedAt: string;
  mapName?: string | null;
  leaderboard: Array<{
    teamId?: string | null;
    players?: Array<{
      playerId?: string | null;
      x?: number | null;
      y?: number | null;
      alive?: boolean;
      knocked?: boolean;
    }>;
  }>;
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
    coordinateSystem?: CoordinateSystem | null;
  } | null;
};

type RawMapOverlayPlayerMarker = {
  playerId?: string | null;
  teamId?: string | null;
  x: number;
  y: number;
  alive?: boolean;
  knocked?: boolean;
};

type RawMapOverlayTeamMarker = {
  teamId: string | null;
  x: number;
  y: number;
  alive?: boolean;
  playerCount: number;
  alivePlayers: number;
};

type RawCircle = {
  safeZone: { x: number; y: number; r: number } | null;
  nextZone: { x: number; y: number; r: number } | null;
  phaseIndex: number | null;
  status: string | null;
  counterSeconds: number | null;
  maxTimeSeconds: number | null;
  nextShrinkAt: string | null;
};

type RawFlightPath = {
  start: { x: number; y: number };
  end: { x: number; y: number };
  coordinateSystem?: CoordinateSystem | null;
} | null;

type MapOverlayConfig = {
  mapName: string;
  worldSize: number;
  coordinateSystem: CoordinateSystem;
  coordinateScaleHint: number;
};

const MAP_CONFIGS: Record<string, MapOverlayConfig> = {
  ERANGEL: {
    mapName: "ERANGEL",
    worldSize: 816_000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
    coordinateScaleHint: 102,
  },
  MIRAMAR: {
    mapName: "MIRAMAR",
    worldSize: 816_000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
    coordinateScaleHint: 102,
  },
  SANHOK: {
    mapName: "SANHOK",
    worldSize: 408_000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
    coordinateScaleHint: 102,
  },
  VIKENDI: {
    mapName: "VIKENDI",
    worldSize: 612_000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
    coordinateScaleHint: 102,
  },
  LIVIK: {
    mapName: "LIVIK",
    worldSize: 408_000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
    coordinateScaleHint: 102,
  },
  LIVIK_AFTERMATH: {
    mapName: "LIVIK AFTERMATH",
    worldSize: 408_000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
    coordinateScaleHint: 102,
  },
  KARAKIN: {
    mapName: "KARAKIN",
    worldSize: 204_000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
    coordinateScaleHint: 102,
  },
  NUSA: {
    mapName: "NUSA",
    worldSize: 102_000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
    coordinateScaleHint: 102,
  },
  RONDO: {
    mapName: "RONDO",
    worldSize: 816_000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
    coordinateScaleHint: 102,
  },
};

export const dynamic = "force-dynamic";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
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

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function resolveTimestampMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeMapKey(value: string | null | undefined): string | null {
  const normalized = textValue(value);
  if (!normalized) {
    return null;
  }
  return normalized.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function resolveMapConfig(mapName: string | null | undefined): MapOverlayConfig | null {
  const key = normalizeMapKey(mapName);
  return key ? MAP_CONFIGS[key] ?? null : null;
}

function detectCoordinateScale(
  mapConfig: MapOverlayConfig | null,
  values: Array<number | null | undefined>,
): number {
  const hint =
    mapConfig && Number.isFinite(mapConfig.coordinateScaleHint)
      ? mapConfig.coordinateScaleHint
      : 1;
  if (hint <= 1 || !mapConfig) {
    return 1;
  }

  const finiteValues = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value) && Math.abs(value) > 0,
  );
  if (finiteValues.length === 0) {
    return 1;
  }

  const maxValue = Math.max(...finiteValues.map((value) => Math.abs(value)));
  return maxValue <= mapConfig.worldSize / 20 ? hint : 1;
}

function scaleValue(value: number, scaleFactor: number): number {
  return Number.isFinite(value) ? value * scaleFactor : value;
}

function scaleCircle(
  circle: RawCircle | null,
  scaleFactor: number,
): ObserverDirectMapOverlayPayload["circle"] {
  if (!circle) {
    return null;
  }

  const nextShrinkAtMs = resolveTimestampMs(circle.nextShrinkAt ?? null);
  return {
    safeZone: circle.safeZone
      ? {
          x: scaleValue(circle.safeZone.x, scaleFactor),
          y: scaleValue(circle.safeZone.y, scaleFactor),
          r: scaleValue(circle.safeZone.r, scaleFactor),
        }
      : null,
    nextZone: circle.nextZone
      ? {
          x: scaleValue(circle.nextZone.x, scaleFactor),
          y: scaleValue(circle.nextZone.y, scaleFactor),
          r: scaleValue(circle.nextZone.r, scaleFactor),
        }
      : null,
    phaseIndex: circle.phaseIndex ?? null,
    status: circle.status ?? null,
    counterSeconds: circle.counterSeconds ?? null,
    maxTimeSeconds: circle.maxTimeSeconds ?? null,
    nextShrinkAt: circle.nextShrinkAt ?? null,
    timerRemaining:
      nextShrinkAtMs !== null ? Math.max(0, nextShrinkAtMs - Date.now()) : null,
    timeRemainingToNextPhase:
      nextShrinkAtMs !== null
        ? Math.max(0, Math.ceil((nextShrinkAtMs - Date.now()) / 1000))
        : null,
    phaseLabel:
      circle.phaseIndex !== null && circle.phaseIndex !== undefined
        ? `Phase ${circle.phaseIndex}`
        : null,
  };
}

function scaleFlightPath(
  flightPath: RawFlightPath,
  scaleFactor: number,
  coordinateSystem: CoordinateSystem | null,
): ObserverDirectMapOverlayPayload["flightPath"] {
  if (!flightPath) {
    return null;
  }

  return {
    start: {
      x: scaleValue(flightPath.start.x, scaleFactor),
      y: scaleValue(flightPath.start.y, scaleFactor),
    },
    end: {
      x: scaleValue(flightPath.end.x, scaleFactor),
      y: scaleValue(flightPath.end.y, scaleFactor),
    },
    coordinateSystem: flightPath.coordinateSystem ?? coordinateSystem ?? "WORLD",
  };
}

function deriveEffectiveWorldSize(
  baseWorldSize: number | null | undefined,
  points: Array<{ x: number; y: number }>,
  circles: Array<{ x: number; y: number; r: number } | null | undefined>,
  flightPath: ObserverDirectMapOverlayPayload["flightPath"],
): number | null {
  const base =
    typeof baseWorldSize === "number" && Number.isFinite(baseWorldSize)
      ? baseWorldSize
      : null;
  if (!base) {
    return null;
  }
  return base;
}

function inferObservedWorldSize(
  points: Array<{ x: number; y: number }>,
  circles: Array<{ x: number; y: number; r: number } | null | undefined>,
  flightPath: ObserverDirectMapOverlayPayload["flightPath"],
): number | null {
  let observedMax = 0;
  for (const point of points) {
    observedMax = Math.max(observedMax, Math.abs(point.x), Math.abs(point.y));
  }
  for (const circle of circles) {
    if (!circle) {
      continue;
    }
    observedMax = Math.max(
      observedMax,
      Math.abs(circle.x - circle.r),
      Math.abs(circle.x + circle.r),
      Math.abs(circle.y - circle.r),
      Math.abs(circle.y + circle.r),
    );
  }
  if (flightPath) {
    observedMax = Math.max(
      observedMax,
      Math.abs(flightPath.start.x),
      Math.abs(flightPath.start.y),
      Math.abs(flightPath.end.x),
      Math.abs(flightPath.end.y),
    );
  }
  if (observedMax <= 0) {
    return null;
  }

  const candidate = Object.values(MAP_CONFIGS)
    .map((config) => config.worldSize)
    .sort((left, right) => left - right)
    .find((worldSize) => worldSize * 1.05 >= observedMax);
  return candidate ?? Math.ceil(observedMax / 1_000) * 1_000;
}

function buildTeamMarkersFromPlayers(
  playerMarkers: RawMapOverlayPlayerMarker[],
): RawMapOverlayTeamMarker[] {
  const teamsById = new Map<string, RawMapOverlayTeamMarker>();

  for (const marker of playerMarkers) {
    if (!marker.teamId) {
      continue;
    }

    const current = teamsById.get(marker.teamId) ?? {
      teamId: marker.teamId,
      x: 0,
      y: 0,
      alive: false,
      playerCount: 0,
      alivePlayers: 0,
    };
    current.x += marker.x;
    current.y += marker.y;
    current.playerCount += 1;
    if (marker.alive !== false) {
      current.alive = true;
      current.alivePlayers += 1;
    }
    teamsById.set(marker.teamId, current);
  }

  return Array.from(teamsById.values()).map((marker) => ({
    ...marker,
    x: marker.playerCount > 0 ? marker.x / marker.playerCount : marker.x,
    y: marker.playerCount > 0 ? marker.y / marker.playerCount : marker.y,
  }));
}

function buildDebugPayload(
  producer: MapOverlayProducer,
  playerMarkers: ObserverDirectMapOverlayPayload["playerMarkers"],
  teamMarkers: ObserverDirectMapOverlayPayload["teamMarkers"],
  worldSize: number | null,
  totals: {
    totalPlayers: number;
    positionedPlayers: number;
  },
): NonNullable<ObserverDirectMapOverlayPayload["debug"]> {
  const xs = playerMarkers.map((marker) => marker.x).filter(Number.isFinite);
  const ys = playerMarkers.map((marker) => marker.y).filter(Number.isFinite);

  return {
    producer,
    totalPlayers: totals.totalPlayers,
    positionedPlayers: totals.positionedPlayers,
    playerMarkers: playerMarkers.length,
    teamMarkers: teamMarkers.length,
    worldSize,
    bounds: {
      minX: xs.length > 0 ? Math.min(...xs) : null,
      maxX: xs.length > 0 ? Math.max(...xs) : null,
      minY: ys.length > 0 ? Math.min(...ys) : null,
      maxY: ys.length > 0 ? Math.max(...ys) : null,
    },
  };
}

function buildOverlayPayload(args: {
  producer: MapOverlayProducer;
  matchId: string;
  updatedAt: string | null | undefined;
  mapName: string | null | undefined;
  mapWorldSize?: number | null | undefined;
  mapCoordinateSystem?: CoordinateSystem | null | undefined;
  circle: RawCircle | null;
  flightPath: RawFlightPath;
  rawPlayerMarkers: RawMapOverlayPlayerMarker[];
  rawTeamMarkers?: RawMapOverlayTeamMarker[] | null | undefined;
  totalPlayers: number;
  positionedPlayers: number;
}): ObserverDirectMapOverlayPayload {
  const mapConfig = resolveMapConfig(args.mapName);
  const coordinateSystem =
    args.mapCoordinateSystem ?? mapConfig?.coordinateSystem ?? "WORLD_BOTTOM_LEFT";
  const scaleFactor = detectCoordinateScale(mapConfig, [
    ...args.rawPlayerMarkers.flatMap((marker) => [marker.x, marker.y]),
    ...(args.rawTeamMarkers ?? []).flatMap((marker) => [marker.x, marker.y]),
    args.circle?.safeZone?.x,
    args.circle?.safeZone?.y,
    args.circle?.safeZone?.r,
    args.circle?.nextZone?.x,
    args.circle?.nextZone?.y,
    args.circle?.nextZone?.r,
    args.flightPath?.start.x,
    args.flightPath?.start.y,
    args.flightPath?.end.x,
    args.flightPath?.end.y,
  ]);
  const playerMarkers = args.rawPlayerMarkers.map((marker) => ({
    playerId: textValue(marker.playerId),
    teamId: textValue(marker.teamId),
    x: scaleValue(marker.x, scaleFactor),
    y: scaleValue(marker.y, scaleFactor),
    alive: marker.alive,
    knocked: marker.knocked,
  }));
  const teamMarkersSource =
    args.rawTeamMarkers && args.rawTeamMarkers.length > 0
      ? args.rawTeamMarkers.map((marker) => ({
          teamId: textValue(marker.teamId),
          x: scaleValue(marker.x, scaleFactor),
          y: scaleValue(marker.y, scaleFactor),
          alive: marker.alive,
          playerCount: Math.max(0, Math.trunc(numberValue(marker.playerCount) ?? 0)),
          alivePlayers: Math.max(0, Math.trunc(numberValue(marker.alivePlayers) ?? 0)),
        }))
      : buildTeamMarkersFromPlayers(playerMarkers);
  const circle = scaleCircle(args.circle, scaleFactor);
  const flightPath = scaleFlightPath(
    args.flightPath,
    scaleFactor,
    coordinateSystem,
  );
  const markerPoints = [
    ...playerMarkers.map((marker) => ({ x: marker.x, y: marker.y })),
    ...teamMarkersSource.map((marker) => ({ x: marker.x, y: marker.y })),
  ];
  const effectiveWorldSize = deriveEffectiveWorldSize(
    mapConfig?.worldSize ?? args.mapWorldSize ?? null,
    markerPoints,
    [circle?.safeZone, circle?.nextZone],
    flightPath,
  );
  const resolvedWorldSize =
    effectiveWorldSize ??
    args.mapWorldSize ??
    mapConfig?.worldSize ??
    inferObservedWorldSize(
      markerPoints,
      [circle?.safeZone, circle?.nextZone],
      flightPath,
    );
  const map =
    mapConfig || resolvedWorldSize
      ? {
          mapName: mapConfig?.mapName ?? textValue(args.mapName) ?? "UNKNOWN",
          worldSize: resolvedWorldSize ?? 0,
          coordinateSystem,
        }
      : null;

  return {
    matchId: textValue(args.matchId) ?? "observer-direct",
    updatedAt: textValue(args.updatedAt) ?? new Date().toISOString(),
    map,
    circle,
    flightPath,
    teamMarkers: teamMarkersSource,
    playerMarkers,
    debug: buildDebugPayload(
      args.producer,
      playerMarkers,
      teamMarkersSource,
      resolvedWorldSize ?? null,
      {
        totalPlayers: args.totalPlayers,
        positionedPlayers: args.positionedPlayers,
      },
    ),
  };
}

function buildOverlayPayloadFromLeaderboard(
  payload: ObserverLeaderboardPayload,
  matchId: string,
): ObserverDirectMapOverlayPayload {
  const rows = Array.isArray(payload.leaderboard) ? payload.leaderboard : [];
  const rawPlayers = rows.flatMap((row) =>
    (row.players ?? []).flatMap((player) => {
      const x = numberValue(player?.x);
      const y = numberValue(player?.y);
      if (x === null || y === null) {
        return [];
      }

      return [
        {
          playerId: textValue(player?.playerId),
          teamId: textValue(row?.teamId),
          x,
          y,
          alive: player?.alive === true,
          knocked: player?.alive === true && player?.knocked === true,
        } satisfies RawMapOverlayPlayerMarker,
      ];
    }),
  );
  const totalPlayers = rows.reduce(
    (count, row) => count + (row.players?.length ?? 0),
    0,
  );

  return buildOverlayPayload({
    producer: "observer-leaderboard-derived-fallback",
    matchId: payload.matchId ?? matchId,
    updatedAt: payload.updatedAt,
    mapName: payload.mapName ?? null,
    circle: payload.circle
      ? {
          safeZone: payload.circle.safeZone ?? null,
          nextZone: payload.circle.nextZone ?? null,
          phaseIndex: payload.circle.phase ?? null,
          status: payload.circle.status ?? null,
          counterSeconds: payload.circle.counterSeconds ?? null,
          maxTimeSeconds: payload.circle.maxTimeSeconds ?? null,
          nextShrinkAt: payload.circle.nextShrinkAt ?? null,
        }
      : null,
    flightPath: payload.flightPath ?? null,
    rawPlayerMarkers: rawPlayers,
    totalPlayers,
    positionedPlayers: rawPlayers.length,
  });
}

function mergeOverlayCircle(
  primary: ObserverDirectMapOverlayPayload["circle"] | null | undefined,
  fallback: ObserverDirectMapOverlayPayload["circle"] | null | undefined,
): ObserverDirectMapOverlayPayload["circle"] | null {
  if (!primary && !fallback) {
    return null;
  }

  return {
    safeZone: primary?.safeZone ?? fallback?.safeZone ?? null,
    nextZone: primary?.nextZone ?? fallback?.nextZone ?? null,
    phaseIndex: primary?.phaseIndex ?? fallback?.phaseIndex ?? null,
    status: primary?.status ?? fallback?.status ?? null,
    counterSeconds: primary?.counterSeconds ?? fallback?.counterSeconds ?? null,
    maxTimeSeconds: primary?.maxTimeSeconds ?? fallback?.maxTimeSeconds ?? null,
    nextShrinkAt: primary?.nextShrinkAt ?? fallback?.nextShrinkAt ?? null,
    timerRemaining: primary?.timerRemaining ?? fallback?.timerRemaining ?? null,
    timeRemainingToNextPhase:
      primary?.timeRemainingToNextPhase ??
      fallback?.timeRemainingToNextPhase ??
      null,
    phaseLabel: primary?.phaseLabel ?? fallback?.phaseLabel ?? null,
  };
}

function normalizeObserverMapOverlayPayload(
  payload: unknown,
  matchId: string,
): ObserverDirectMapOverlayPayload | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  const rawPlayerMarkers = asArray(record.playerMarkers).flatMap((marker) => {
    const next = asRecord(marker);
    const x = numberValue(next?.x);
    const y = numberValue(next?.y);
    if (x === null || y === null) {
      return [];
    }

    return [
      {
        playerId: textValue(next?.playerId),
        teamId: textValue(next?.teamId),
        x,
        y,
        alive: next?.alive === true,
        knocked: next?.knocked === true,
      } satisfies RawMapOverlayPlayerMarker,
    ];
  });
  const rawTeamMarkers = asArray(record.teamMarkers).flatMap((marker) => {
    const next = asRecord(marker);
    const x = numberValue(next?.x);
    const y = numberValue(next?.y);
    if (x === null || y === null) {
      return [];
    }

    return [
      {
        teamId: textValue(next?.teamId),
        x,
        y,
        alive: next?.alive === true,
        playerCount: Math.max(0, Math.trunc(numberValue(next?.playerCount) ?? 0)),
        alivePlayers: Math.max(0, Math.trunc(numberValue(next?.alivePlayers) ?? 0)),
      } satisfies RawMapOverlayTeamMarker,
    ];
  });
  const map = asRecord(record.map);
  const circle = asRecord(record.circle);
  const flightPath = asRecord(record.flightPath);
  const safeZone = asRecord(circle?.safeZone);
  const nextZone = asRecord(circle?.nextZone);
  const start = asRecord(flightPath?.start);
  const end = asRecord(flightPath?.end);

  return buildOverlayPayload({
    producer: "observer-map-overlay",
    matchId: textValue(record.matchId) ?? matchId,
    updatedAt: textValue(record.updatedAt),
    mapName: textValue(map?.mapName),
    mapWorldSize: numberValue(map?.worldSize),
    mapCoordinateSystem:
      textValue(map?.coordinateSystem) === "WORLD"
        ? "WORLD"
        : textValue(map?.coordinateSystem) === "WORLD_BOTTOM_LEFT"
          ? "WORLD_BOTTOM_LEFT"
          : null,
    circle: circle
      ? {
          safeZone:
            safeZone &&
            numberValue(safeZone.x) !== null &&
            numberValue(safeZone.y) !== null &&
            numberValue(safeZone.r) !== null
              ? {
                  x: numberValue(safeZone.x)!,
                  y: numberValue(safeZone.y)!,
                  r: numberValue(safeZone.r)!,
                }
              : null,
          nextZone:
            nextZone &&
            numberValue(nextZone.x) !== null &&
            numberValue(nextZone.y) !== null &&
            numberValue(nextZone.r) !== null
              ? {
                  x: numberValue(nextZone.x)!,
                  y: numberValue(nextZone.y)!,
                  r: numberValue(nextZone.r)!,
                }
              : null,
          phaseIndex: numberValue(circle.phaseIndex),
          status: textValue(circle.status),
          counterSeconds: numberValue(circle.counterSeconds),
          maxTimeSeconds: numberValue(circle.maxTimeSeconds),
          nextShrinkAt: textValue(circle.nextShrinkAt),
        }
      : null,
    flightPath:
      start &&
      end &&
      numberValue(start.x) !== null &&
      numberValue(start.y) !== null &&
      numberValue(end.x) !== null &&
      numberValue(end.y) !== null
        ? {
            start: {
              x: numberValue(start.x)!,
              y: numberValue(start.y)!,
            },
            end: {
              x: numberValue(end.x)!,
              y: numberValue(end.y)!,
            },
            coordinateSystem:
              textValue(flightPath?.coordinateSystem) === "WORLD"
                ? "WORLD"
                : textValue(flightPath?.coordinateSystem) === "WORLD_BOTTOM_LEFT"
                  ? "WORLD_BOTTOM_LEFT"
                  : null,
          }
        : null,
    rawPlayerMarkers,
    rawTeamMarkers,
    totalPlayers: rawPlayerMarkers.length,
    positionedPlayers: rawPlayerMarkers.length,
  });
}

function compareOverlayCompleteness(
  left: ObserverDirectMapOverlayPayload | null,
  right: ObserverDirectMapOverlayPayload | null,
): number {
  const leftPlayers = left?.playerMarkers.length ?? 0;
  const rightPlayers = right?.playerMarkers.length ?? 0;
  if (leftPlayers !== rightPlayers) {
    return leftPlayers - rightPlayers;
  }

  const leftTeams = left?.teamMarkers.length ?? 0;
  const rightTeams = right?.teamMarkers.length ?? 0;
  if (leftTeams !== rightTeams) {
    return leftTeams - rightTeams;
  }

  return (
    (resolveTimestampMs(left?.updatedAt ?? null) ?? 0) -
    (resolveTimestampMs(right?.updatedAt ?? null) ?? 0)
  );
}

function resolveObserverConflictMatchId(payload: unknown): string | null {
  return textValue(asRecord(payload)?.activeMatchId);
}

async function fetchObserverJson(path: string): Promise<{
  ok: boolean;
  status: number;
  data: unknown | null;
}> {
  try {
    const response = await fetch(`${OBSERVER_BASE_URL}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(OBSERVER_REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    let data: unknown | null = null;
    if (text.trim()) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        data = null;
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      data,
    };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

async function fetchLocalLeaderboardPayload(
  request: Request,
  matchId: string,
): Promise<ObserverLeaderboardPayload | null> {
  try {
    const target = new URL(
      "/api/widgets/observer-direct/leaderboard",
      request.url,
    );
    target.searchParams.set("matchId", matchId);
    target.searchParams.set("launcherOnly", "1");
    const response = await fetch(target, {
      cache: "no-store",
      signal: AbortSignal.timeout(OBSERVER_REQUEST_TIMEOUT_MS + 1_000),
    });
    if (!response.ok) {
      return null;
    }

    return (await response.json()) as ObserverLeaderboardPayload;
  } catch {
    return null;
  }
}

function emptyPayload(matchId: string): ObserverDirectMapOverlayPayload {
  return {
    matchId,
    updatedAt: new Date().toISOString(),
    debug: null,
    map: null,
    circle: null,
    flightPath: null,
    teamMarkers: [],
    playerMarkers: [],
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedMatchId =
    url.searchParams.get("matchId")?.trim() || "observer-direct";

  let effectiveMatchId = requestedMatchId;
  let [mapOverlayResponse, leaderboardPayload] = await Promise.all([
    fetchObserverJson(
      `/widget/map-overlay?matchId=${encodeURIComponent(effectiveMatchId)}`,
    ),
    fetchLocalLeaderboardPayload(request, effectiveMatchId),
  ]);

  const conflictMatchId =
    resolveObserverConflictMatchId(mapOverlayResponse.data) ??
    textValue(leaderboardPayload?.matchId);
  if (conflictMatchId && conflictMatchId !== effectiveMatchId) {
    effectiveMatchId = conflictMatchId;
    [mapOverlayResponse, leaderboardPayload] = await Promise.all([
      fetchObserverJson(
        `/widget/map-overlay?matchId=${encodeURIComponent(effectiveMatchId)}`,
      ),
      fetchLocalLeaderboardPayload(request, effectiveMatchId),
    ]);
  }

  const directPayload =
    mapOverlayResponse.ok && mapOverlayResponse.data
      ? normalizeObserverMapOverlayPayload(
          mapOverlayResponse.data,
          effectiveMatchId,
        )
      : null;
  const leaderboardFallback =
    leaderboardPayload
      ? buildOverlayPayloadFromLeaderboard(leaderboardPayload, effectiveMatchId)
      : null;
  const selectedPayload =
    compareOverlayCompleteness(directPayload, leaderboardFallback) >= 0
      ? directPayload ?? leaderboardFallback
      : leaderboardFallback ?? directPayload;

  const mergedPayload = selectedPayload
    ? {
        ...selectedPayload,
        circle: mergeOverlayCircle(
          selectedPayload.circle,
          selectedPayload === directPayload
            ? leaderboardFallback?.circle
            : directPayload?.circle,
        ),
      }
    : null;

  return Response.json(mergedPayload ?? emptyPayload(effectiveMatchId), {
    headers: { "Cache-Control": "no-store" },
  });
}
