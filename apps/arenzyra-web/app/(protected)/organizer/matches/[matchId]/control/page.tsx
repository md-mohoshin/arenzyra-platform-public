"use client";

import Image from "next/image";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Flame,
  PauseCircle,
  Play,
  RotateCcw,
  Shield,
  Skull,
  StopCircle,
  Users,
  X,
} from "lucide-react";
import { io, type Socket } from "socket.io-client";
import { API_URL, ApiError, apiFetch, ensureApiUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { CopyButton } from "@/components/ui/CopyButton";
import { getTelemetrySourceLabel } from "@/features/matches/match-form-payload";

const FALLBACK_LOGO = "/assets/defaults/default-team.png";
const LOBBY_STATUS_STYLES: Record<SlotLobbyStatus, string> = {
  READY: "border border-emerald-400/25 bg-emerald-500/10 text-emerald-100",
  WAITING: "border border-amber-400/25 bg-amber-500/10 text-amber-100",
  OFFLINE: "border border-white/10 bg-white/[0.04] text-white/60",
  EMPTY: "border border-white/10 bg-white/[0.03] text-white/45",
};

function SortablePlacementRow({
  matchSlotId,
  idx,
  teamMap,
}: {
  matchSlotId: string;
  idx: number;
  teamMap: Map<
    string,
    { matchSlotId: string; teamId: string; name: string; logo: string | null; slot: number | null }
  >;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: matchSlotId });
  const data = teamMap.get(matchSlotId);
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded border border-white/10 bg-white/5 px-3 py-2 cursor-grab active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <div className="text-right w-8 text-white/60">#{idx + 1}</div>
      <Image
        src={data?.logo ?? FALLBACK_LOGO}
        alt={data?.name ?? "team logo"}
        width={32}
        height={32}
        className="h-8 w-8 rounded object-cover border border-white/10"
        unoptimized
      />
      <div className="flex flex-col text-xs text-white/80">
        <span className="font-semibold text-white">
          {data?.name ?? data?.teamId ?? matchSlotId}
        </span>
        {data?.slot ? <span className="text-white/50">Slot {data.slot}</span> : null}
      </div>
    </div>
  );
}

type MatchDetail = {
  id: string;
  name?: string | null;
  matchNumber?: number | null;
  map?: string | null;
  status?: string | null;
  liveState?: string | null;
  endedReason?: string | null;
  dataSource?: string | null;
  dataMode?: string | null;
  slotCount?: number | null;
  tournamentId?: string | null;
  groupId?: string | null;
  tournament?: { id: string; name?: string | null; organizationId?: string | null } | null;
};

type SlotLobbyStatus = "EMPTY" | "WAITING" | "READY" | "OFFLINE";
type LobbyMode = "MANUAL" | "AUTO";

type SlotRow = {
  id: string;
  slotNumber: number;
  teamId?: string | null;
  lobbyStatus?: SlotLobbyStatus | null;
  playersInLobby?: number | null;
  team?: { id: string; name?: string | null; tag?: string | null; logoUrl?: string | null } | null;
};

type MatchTeamRow = {
  slot?: number | null;
  teamId: string;
  teamName: string;
  teamTag?: string | null;
  logoUrl?: string | null;
  logoLightUrl?: string | null;
  logoDarkUrl?: string | null;
  groupId?: string | null;
  group?: { id?: string | null; name?: string | null } | null;
};

type LiveSyncAuditEntry = {
  action: "OVERRIDE" | "RELEASE";
  timestamp: number;
  actorId?: string | null;
  source?: string | null;
  scope: {
    level: "MATCH" | "TEAM" | "PLAYER";
    teamId?: string | null;
    playerId?: string | null;
    fields?: string[] | null;
  };
};

type OverrideAuditSummary = {
  lastOverride?: LiveSyncAuditEntry | null;
  lastRelease?: LiveSyncAuditEntry | null;
};

type PlayerResultRow = {
  id: string;
  playerId?: string | null;
  name?: string | null;
  playerName?: string | null;
  kills: number;
  alive?: boolean | null;
  isAlive?: boolean | null;
  isKnocked?: boolean | null;
  knocked?: boolean | null;
  ownership?: {
    alive?: {
      owner?: string | null;
      override?: boolean;
      updatedAt?: number | null;
      actorId?: string | null;
      source?: string | null;
    } | null;
    knocked?: {
      owner?: string | null;
      override?: boolean;
      updatedAt?: number | null;
      actorId?: string | null;
      source?: string | null;
    } | null;
    kills?: {
      owner?: string | null;
      override?: boolean;
      updatedAt?: number | null;
      actorId?: string | null;
      source?: string | null;
    } | null;
  } | null;
  audit?: OverrideAuditSummary | null;
};

type ResultRow = {
  id: string;
  teamId: string;
  slot?: number | null;
  slotNumber?: number | null;
  wasPresentInMatch?: boolean | null;
  presenceStatus?: "ACTIVE" | "NO_SHOW" | "UNRESOLVED" | null;
  hasTelemetryPresence?: boolean;
  teamKills?: number | null;
  placement?: number | null;
  eliminatedOrder?: number | null;
  teamLocked?: boolean | null;
  eliminated?: boolean | null;
  eliminatedAt?: string | null;
  isLocked?: boolean | null;
  totalPoints?: number | null;
  manualTotalKills?: boolean | null;
  ownership?: {
    eliminated?: {
      owner?: string | null;
      override?: boolean;
      updatedAt?: number | null;
      actorId?: string | null;
      source?: string | null;
    } | null;
    placement?: {
      owner?: string | null;
      override?: boolean;
      updatedAt?: number | null;
      actorId?: string | null;
      source?: string | null;
    } | null;
    totalKills?: {
      owner?: string | null;
      override?: boolean;
      updatedAt?: number | null;
      actorId?: string | null;
      source?: string | null;
    } | null;
  } | null;
  audit?: OverrideAuditSummary | null;
  team?: {
    id: string;
    name?: string | null;
    tag?: string | null;
    logoUrl?: string | null;
    logoLightUrl?: string | null;
    logoDarkUrl?: string | null;
  } | null;
  players: PlayerResultRow[];
};

type ResultsResponse = {
  results: ResultRow[];
  data?: ResultRow[];
  locked?: boolean;
  lockedAt?: string | null;
  lockedBy?: string | null;
  lockReason?: string | null;
  lockState?: string | null;
  matchLocked?: boolean;
  aliveTeamsCount?: number | null;
  totalTeamsCount?: number;
  sourceMode?: string | null;
  lifecycleStatus?: string | null;
  slotLocked?: boolean;
  liveMirrorVersion?: number | null;
  liveSyncVersion?: number | null;
  noShowCount?: number;
  overrideAudit?: LiveSyncAuditEntry[];
  overrideReleaseAllowed?: boolean;
  overrideReleaseReason?: string | null;
};

type OverrideReleaseResponse = {
  ok?: boolean;
  released?: boolean;
  releasedPlayers?: number;
  releasedTeams?: number;
  version?: number | null;
};

type ControlState = {
  matchId: string;
  state: string | null;
  updatedAt?: string | null;
  updatedByUserId?: string | null;
  reason?: string | null;
  meta?: Record<string, unknown> | null;
  lifecycleStatus?: string | null;
  locks?: {
    lifecycleLocked: boolean;
    resultsLocked: boolean;
    slotLocked: boolean;
    resultLockState: "LOCKED" | "UNLOCKED";
    reason: string | null;
  };
};

type LiveControlSnapshot = {
  matchId: string;
  status: string | null;
  version?: number | null;
  startedAt?: string | null;
  endedAt?: string | null;
  updatedAt?: string | null;
  sourceMode?: string | null;
  observedPlayer?: {
    playerId?: string | null;
    externalPlayerId?: string | null;
    pubgPlayerId?: string | null;
    playerName?: string | null;
    playerIgn?: string | null;
    teamId?: string | null;
    teamName?: string | null;
    teamTag?: string | null;
    teamLogoUrl?: string | null;
  } | null;
  circle?: {
    phase?: number | null;
  } | null;
  summary?: {
    totalTeams?: number | null;
    aliveTeams?: number | null;
    totalPlayers?: number | null;
    alivePlayers?: number | null;
    winnerTeamId?: string | null;
    winnerSlot?: number | null;
  } | null;
  teams: Array<{
    teamId: string;
    name?: string | null;
    tag?: string | null;
    slot?: number | null;
    logoUrl?: string | null;
    kills: number;
    ownership?: {
      eliminated?: {
        owner?: string | null;
        override?: boolean;
        updatedAt?: number | null;
        actorId?: string | null;
        source?: string | null;
      };
      placement?: {
        owner?: string | null;
        override?: boolean;
        updatedAt?: number | null;
        actorId?: string | null;
        source?: string | null;
      };
      totalKills?: {
        owner?: string | null;
        override?: boolean;
        updatedAt?: number | null;
        actorId?: string | null;
        source?: string | null;
      };
    } | null;
    hasTelemetryPresence?: boolean;
    alivePlayers?: number | null;
    totalPlayers?: number | null;
    alive?: boolean;
    players?: Array<{
      id?: string | null;
      playerId?: string | null;
      externalPlayerId?: string | null;
      pubgPlayerId?: string | null;
      name?: string | null;
      ign?: string | null;
      alive?: boolean;
      knocked?: boolean;
      kills?: number | null;
      ownership?: {
        alive?: {
          owner?: string | null;
          override?: boolean;
          updatedAt?: number | null;
          actorId?: string | null;
          source?: string | null;
        };
        knocked?: {
          owner?: string | null;
          override?: boolean;
          updatedAt?: number | null;
          actorId?: string | null;
          source?: string | null;
        };
        kills?: {
          owner?: string | null;
          override?: boolean;
          updatedAt?: number | null;
          actorId?: string | null;
          source?: string | null;
        };
      } | null;
    }>;
  }>;
};

type RuntimeTelemetrySnapshot = {
  transportConnected: boolean;
  packetsReceiving: boolean;
  telemetryAccepted: boolean;
  telemetryActive: boolean;
  lastTransportAt?: string | null;
  lastPacketAt?: string | null;
  lastTransportSource?: string | null;
  lastAcceptedAt?: string | null;
  lastAcceptedSource?: string | null;
  lastAcceptedSequence?: number | null;
  lastIgnoredAt?: string | null;
  lastIgnoredReason?: string | null;
};

type RuntimeBindingSnapshot = {
  sessionId: string | null;
  adapterKey: string | null;
  dataSource: string | null;
  dataMode: string | null;
  telemetryProvider?: string | null;
  sourceMode?: "MANUAL" | "AUTO" | null;
  boundAt: string | null;
  lastSeenAt: string | null;
  isConfigured: boolean;
  isBound: boolean;
  isReady: boolean;
  pcobConfigured?: boolean;
  pcobBound?: boolean;
  pcobReady?: boolean;
};

type MatchControlPayload = LiveControlSnapshot & {
  matchStatus?: string | null;
  lifecycleStatus?: string | null;
  isLocked?: boolean;
  isFinalizing?: boolean;
  resultFinalized?: boolean;
  resultNeedsConfirmation?: boolean;
  resultAmbiguities?: Array<{
    code?: string | null;
    teamIds?: string[] | null;
    placementFrom?: number | null;
    placementTo?: number | null;
    detectedAt?: string | null;
    message?: string | null;
  }> | null;
  finalizationStartedAt?: string | null;
  finalizationDurationMs?: number | null;
  liveState?: string | null;
  controlStatus?: string | null;
  telemetry?: RuntimeTelemetrySnapshot;
  binding?: RuntimeBindingSnapshot;
  locks?: {
    lifecycleLocked: boolean;
    resultsLocked: boolean;
    slotLocked: boolean;
    resultLockState: "LOCKED" | "UNLOCKED";
    reason: string | null;
  };
};

type LiveControlTeam = LiveControlSnapshot["teams"][number];

function getLiveControlTeamAlivePlayers(team: LiveControlTeam) {
  if (typeof team.alivePlayers === "number") {
    return Math.max(team.alivePlayers, 0);
  }
  const hasPlayerAliveSignal =
    team.players?.some((player) => typeof player.alive === "boolean") ?? false;
  if (!hasPlayerAliveSignal) {
    return null;
  }
  return team.players?.filter((player) => player.alive === true).length ?? 0;
}

function getLiveControlTeamTotalPlayers(team: LiveControlTeam) {
  if (typeof team.totalPlayers === "number") {
    return Math.max(team.totalPlayers, 0);
  }
  if ((team.players?.length ?? 0) > 0) {
    return team.players?.length ?? 0;
  }
  return null;
}

function hasLiveControlTeamAliveSignal(team: LiveControlTeam) {
  return (
    typeof team.alive === "boolean" ||
    typeof team.alivePlayers === "number" ||
    (team.players?.some((player) => typeof player.alive === "boolean") ?? false)
  );
}

function hasLiveControlTeamPlayerSignal(team: LiveControlTeam) {
  return getLiveControlTeamTotalPlayers(team) !== null;
}

function hasLiveControlAliveCounts(teams: LiveControlSnapshot["teams"]) {
  return teams.some((team) => hasLiveControlTeamAliveSignal(team));
}

function hasLiveControlPlayerCounts(teams: LiveControlSnapshot["teams"]) {
  return teams.some((team) => hasLiveControlTeamPlayerSignal(team));
}

function isLiveControlTeamAlive(team: LiveControlTeam) {
  if (typeof team.alive === "boolean") {
    return team.alive;
  }
  const alivePlayers = getLiveControlTeamAlivePlayers(team);
  return alivePlayers !== null ? alivePlayers > 0 : false;
}

type CameraSuggestion = {
  matchId: string;
  teamId: string | null;
  playerId: string | null;
  reason: string;
  priority: number;
};

type CameraSuggestionResponse = {
  suggestions?: CameraSuggestion[];
};

type WidgetInstanceInfo = { id: string; key: string; obsUrl?: string };
type SlotTeamDragPayload = {
  type: "team";
  teamId: string;
  teamName: string;
  teamTag?: string | null;
  logoUrl: string | null;
  sourceSlotNumber: number | null;
};

type SlotDropPayload = {
  type: "slot";
  slotNumber: number;
  targetTeamId: string | null;
};

const widgetCatalog = [
  { key: "match-intro", label: "Match Intro", description: "Intro slate with match context" },
  { key: "team-lineup", label: "Team Lineup", description: "Team lineup slide for lobby" },
  { key: "live-ranking", label: "Live Ranking", description: "In-game live ranking overlay" },
  { key: "top-fragger", label: "Top Fragger", description: "Highlights the current top fragger" },
  { key: "overall-ranking", label: "Overall Ranking", description: "Post-match overall standings" },
] as const;

const tabs = [
  { key: "live", label: "Live Ops" },
  { key: "slots", label: "Lobby Slots" },
  { key: "results", label: "Results Desk" },
  { key: "widgets", label: "Broadcast" },
] as const;

type TabKey = (typeof tabs)[number]["key"];

type SaveState = "idle" | "saving" | "saved" | "error" | "locked";
type MatchLifecycleAction =
  | "start"
  | "COUNTDOWN"
  | "LIVE"
  | "PAUSED"
  | "ENDED"
  | "CONFIRMED"
  | "READY";

type MatchLifecycleLocks = {
  lifecycleLocked: boolean;
  resultsLocked: boolean;
  slotLocked: boolean;
  reason: string | null;
};

type MatchLifecycleActionConfig = {
  action: MatchLifecycleAction;
  label: string;
  busyLabel: string;
  icon: React.ReactNode;
  className: string;
};

type ResultsDisplayRow = {
  team: ResultRow;
  liveTeam: LiveControlSnapshot["teams"][number] | null;
  teamFallback: MatchTeamRow | null;
  players: PlayerResultRow[];
  displayKills: number;
  aliveCount: number;
  totalPlayerCount: number;
  knockedCount: number;
  aliveKnown: boolean;
  waitingForTelemetry: boolean;
  teamEliminated: boolean;
  teamLocked: boolean;
  usingLiveSnapshot: boolean;
  teamLogo: string;
  teamName: string;
  teamTag: string | null;
  slotNumber: number | null;
  playerKillTotal: number;
};

function computeAliveCount(players: PlayerResultRow[]) {
  return players.reduce((count, p) => {
    const alive = (p.alive ?? p.isAlive ?? true) === true;
    return alive ? count + 1 : count;
  }, 0);
}

function isPlacementEligibleTeam(team: ResultRow) {
  return team.presenceStatus !== "NO_SHOW";
}

function isMissingTeam(team: Pick<ResultRow, "presenceStatus">) {
  return team.presenceStatus === "NO_SHOW";
}

function normalizePlayerRows(players: PlayerResultRow[]) {
  return players.map((player) => {
    const alive = (player.alive ?? player.isAlive ?? true) === true;
    const knocked = alive ? (player.isKnocked ?? player.knocked ?? false) === true : false;
    return {
      ...player,
      kills: Number.isFinite(player.kills) ? Math.max(0, Number(player.kills)) : 0,
      alive,
      isAlive: alive,
      knocked,
      isKnocked: knocked,
    };
  });
}

function normalizeResultPlayers(
  players: PlayerResultRow[] | null | undefined,
): PlayerResultRow[] {
  return (
    normalizePlayerRows(
      (players ?? []).map((player) => ({
        ...player,
        name: player.name ?? player.playerName ?? player.playerId ?? "Player",
        kills: player.kills ?? 0,
        alive: player.alive ?? player.isAlive ?? null,
        isAlive: player.alive ?? player.isAlive ?? null,
        isKnocked: player.isKnocked ?? player.knocked ?? null,
        knocked: player.isKnocked ?? player.knocked ?? null,
      })),
    ) ?? []
  );
}

function normalizeLivePlayers(
  players: LiveControlSnapshot["teams"][number]["players"] | undefined,
  teamId: string,
): PlayerResultRow[] {
  return (
    normalizePlayerRows(
      (players ?? []).map((player, index) => {
        const resolvedPlayerId =
          player?.playerId ??
          player?.externalPlayerId ??
          player?.pubgPlayerId ??
          player?.id ??
          `${teamId}-player-${index + 1}`;
        const alive = player?.alive ?? null;
        const knocked = player?.knocked ?? null;
        return {
          id: player?.id ?? resolvedPlayerId,
          playerId: resolvedPlayerId,
          name: player?.name ?? player?.ign ?? resolvedPlayerId,
          playerName: player?.name ?? player?.ign ?? resolvedPlayerId,
          kills: player?.kills ?? 0,
          alive,
          isAlive: alive,
          isKnocked: knocked,
          knocked,
          ownership: player?.ownership ?? null,
        };
      }),
    ) ?? []
  );
}

function isUuid(value: string | null | undefined) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value ?? "",
  );
}

function toTeamPlayerSavePayload(player: PlayerResultRow) {
  const alive = (player.alive ?? player.isAlive ?? true) === true;
  const playerResultId = isUuid(player.id) ? player.id : undefined;
  const playerId =
    player.playerId ??
    (playerResultId ? `slot-player:${playerResultId}` : undefined);
  return {
    playerResultId,
    playerId,
    kills: Number.isFinite(player.kills) ? Number(player.kills) : 0,
    alive,
    knocked: alive ? (player.isKnocked ?? player.knocked ?? false) === true : false,
  };
}

function hasSamePersistedPlayerState(
  draftPlayers: PlayerResultRow[],
  persistedPlayers: PlayerResultRow[],
) {
  if (draftPlayers.length !== persistedPlayers.length) {
    return false;
  }

  const persistedById = new Map(
    persistedPlayers.map((player) => [player.id, toTeamPlayerSavePayload(player)] as const),
  );

  return draftPlayers.every((player) => {
    const persisted = persistedById.get(player.id);
    if (!persisted) {
      return false;
    }
    const next = toTeamPlayerSavePayload(player);
    return (
      persisted.playerResultId === next.playerResultId &&
      (persisted.playerId ?? null) === (next.playerId ?? null) &&
      persisted.kills === next.kills &&
      persisted.alive === next.alive &&
      persisted.knocked === next.knocked
    );
  });
}

function isLiveControlSnapshot(value: unknown): value is LiveControlSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const version =
    record.version === undefined ||
    record.version === null ||
    typeof record.version === "number";
  return typeof record.matchId === "string" && Array.isArray(record.teams) && version;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function formatAuditTimestamp(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleString();
}

function formatAuditActor(actorId?: string | null) {
  return actorId?.trim() ? actorId : null;
}

function formatAuditScope(scope?: LiveSyncAuditEntry["scope"] | null) {
  if (!scope) return "match";
  if (scope.level === "PLAYER") {
    return scope.playerId?.trim() ? `player ${scope.playerId}` : "player override";
  }
  if (scope.level === "TEAM") {
    return scope.teamId?.trim() ? `team ${scope.teamId}` : "team override";
  }
  return "match override";
}

function describeAuditEntry(
  entry?: LiveSyncAuditEntry | null,
  prefix?: string | null,
) {
  if (!entry) return null;
  const action =
    entry.action === "RELEASE" ? "released manual ownership" : "applied manual override";
  const scope = formatAuditScope(entry.scope);
  const actor = formatAuditActor(entry.actorId) ?? "system";
  const timestamp = formatAuditTimestamp(entry.timestamp);
  const fields =
    Array.isArray(entry.scope.fields) && entry.scope.fields.length > 0
      ? ` (${entry.scope.fields.join(", ")})`
      : "";
  const base = `${scope}${fields} ${action} by ${actor}${timestamp ? ` on ${timestamp}` : ""}`;
  return prefix ? `${prefix}: ${base}` : base;
}

function resolveResultsVersion(
  value?: Pick<ResultsResponse, "liveMirrorVersion" | "liveSyncVersion"> | null,
) {
  if (typeof value?.liveMirrorVersion === "number") {
    return value.liveMirrorVersion;
  }
  if (typeof value?.liveSyncVersion === "number") {
    return value.liveSyncVersion;
  }
  return null;
}

function formatMatchTimer(
  startedAt?: string | null,
  endedAt?: string | null,
  nowTs = Date.now(),
) {
  if (!startedAt) return "--:--";
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return "--:--";
  const end = endedAt ? new Date(endedAt).getTime() : nowTs;
  const safeEnd = Number.isNaN(end) ? nowTs : end;
  const totalSeconds = Math.max(0, Math.floor((safeEnd - start) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

function formatCirclePhase(phase?: number | null) {
  if (phase === null || phase === undefined || Number.isNaN(phase)) {
    return "Pending";
  }
  return `Phase ${phase}`;
}

function badgeTone(state?: string | null) {
  const key = (state ?? "").toUpperCase();
  if (key === "LIVE") return "bg-emerald-500/20 text-emerald-100 border-emerald-400/40";
  if (key === "PAUSED") return "bg-amber-500/20 text-amber-100 border-amber-400/40";
  if (key === "ENDED" || key === "CONFIRMED") return "bg-blue-500/20 text-blue-100 border-blue-400/40";
  if (key === "READY" || key === "COUNTDOWN") return "bg-cyan-500/20 text-cyan-100 border-cyan-400/40";
  return "bg-white/10 text-white/70 border-white/20";
}

function normalizeMatchSource(raw?: string | null) {
  const source = (raw ?? "").toUpperCase();
  if (source === "PCOB") return "PCOB";
  if (source === "HYBRID") return "HYBRID";
  if (source === "MANUAL") return "MANUAL";
  return "AUTO";
}

function isTelemetryDrivenSource(raw?: string | null) {
  return normalizeMatchSource(raw) !== "MANUAL";
}

function getControlSourceValue(
  control?: MatchControlPayload | null,
  fallback?: string | null,
) {
  const values = [
    control?.binding?.telemetryProvider,
    control?.binding?.sourceMode,
    control?.binding?.dataSource,
    control?.binding?.dataMode,
    control?.sourceMode,
    fallback,
  ];

  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function sourceBadgeTone(source?: string | null) {
  if (normalizeMatchSource(source) === "MANUAL") {
    return "bg-gray-500/15 text-gray-300 border-white/15";
  }
  return "bg-cyan-500/20 text-cyan-100 border-cyan-400/40";
}

function formatRuntimeTelemetryState(
  telemetry?: RuntimeTelemetrySnapshot | null,
  options?: { resultFinalized?: boolean; isFinalizing?: boolean },
) {
  if (options?.resultFinalized) return "FINALIZED";
  if (options?.isFinalizing) return "FINALIZING";
  if (telemetry?.telemetryActive) return "ACTIVE";
  if (telemetry?.telemetryAccepted) return "ACCEPTED";
  if (telemetry?.packetsReceiving) return "RECEIVING";
  if (telemetry?.transportConnected) return "CONNECTED";
  return "WAITING";
}

function formatBindingState(binding?: RuntimeBindingSnapshot | null) {
  if (!binding) return "NOT CONFIGURED";
  if (binding.isReady) return "READY";
  if (binding.isBound) return "BOUND";
  if (binding.isConfigured) return "CONFIGURED";
  return "NOT CONFIGURED";
}

type OwnershipField = {
  owner?: string | null;
  override?: boolean;
  updatedAt?: number | null;
  actorId?: string | null;
  source?: string | null;
} | null | undefined;

type OwnershipDescriptor = {
  label: string;
  detail: string;
  className: string;
};

function isManualOwnership(ownership: OwnershipField) {
  return (ownership?.owner ?? "").toUpperCase() === "MANUAL" && ownership?.override === true;
}

function describeOwnership(
  ownership: OwnershipField,
  fallback: { label: string; detail: string; className?: string },
): OwnershipDescriptor {
  const owner = (ownership?.owner ?? "").toUpperCase();
  const updatedAt = formatAuditTimestamp(ownership?.updatedAt ?? null);
  const actor = formatAuditActor(ownership?.actorId);
  const source = ownership?.source?.trim();
  const ownershipMeta = [source ? `via ${source}` : null, actor ? `by ${actor}` : null, updatedAt ? `on ${updatedAt}` : null]
    .filter(Boolean)
    .join(" ");
  if (owner === "MANUAL" && ownership?.override) {
    return {
      label: "Manual override",
      detail:
        ownershipMeta
          ? `Operator-owned ${ownershipMeta}. Telemetry will not overwrite this field until the override is explicitly released.`
          : "Operator-owned value. Telemetry will not overwrite this field until the override is explicitly released.",
      className:
        "border-amber-400/30 bg-amber-500/15 text-amber-100",
    };
  }
  if (owner === "MANUAL") {
    return {
      label: "Manual-owned",
      detail: ownershipMeta
        ? `Operator is the current owner for this field ${ownershipMeta}.`
        : "Operator is the current owner for this field.",
      className:
        "border-amber-400/25 bg-amber-500/10 text-amber-100/90",
    };
  }
  if (owner === "TELEMETRY") {
    return {
      label: "Telemetry-owned",
      detail: "Live telemetry currently owns this field.",
      className:
        "border-cyan-400/25 bg-cyan-500/[0.08] text-cyan-100",
    };
  }
  if (owner === "SYSTEM") {
    return {
      label: "Rule-derived",
      detail: "Canonical backend rules derive this field.",
      className:
        "border-violet-400/25 bg-violet-500/[0.08] text-violet-100",
    };
  }
  return {
    label: fallback.label,
    detail: fallback.detail,
    className:
      fallback.className ??
      "border-white/15 bg-white/[0.06] text-white/75",
  };
}

function hasPlayerManualOverride(player: PlayerResultRow) {
  return (
    isManualOwnership(player.ownership?.alive) ||
    isManualOwnership(player.ownership?.knocked) ||
    isManualOwnership(player.ownership?.kills)
  );
}

function hasTeamManualOverride(team: ResultRow) {
  return (
    isManualOwnership(team.ownership?.placement) ||
    isManualOwnership(team.ownership?.eliminated) ||
    isManualOwnership(team.ownership?.totalKills) ||
    team.players.some((player) => hasPlayerManualOverride(player))
  );
}

function TagBadge({
  descriptor,
  className = "",
}: {
  descriptor: OwnershipDescriptor;
  className?: string;
}) {
  return (
    <span
      title={descriptor.detail}
      className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.04em] ${descriptor.className} ${className}`.trim()}
    >
      {descriptor.label}
    </span>
  );
}

function FieldMeta({
  descriptor,
  disabledReason,
}: {
  descriptor: OwnershipDescriptor;
  disabledReason?: string | null;
}) {
  return (
    <div className="mt-1.5 space-y-1">
      <TagBadge descriptor={descriptor} className="max-w-full" />
      {disabledReason ? (
        <div className="text-[10px] leading-4 text-amber-100/75">{disabledReason}</div>
      ) : null}
    </div>
  );
}

function getMatchLifecycleActionConfig(
  action: MatchLifecycleAction,
  lifecycleStatus?: string | null,
): MatchLifecycleActionConfig {
  if (action === "start") {
    return {
      action,
      label: "START MATCH",
      busyLabel: "Starting...",
      icon: <Play className="h-4 w-4" />,
      className:
        "border-emerald-400/40 bg-emerald-500/15 text-emerald-100 hover:border-emerald-300/60 hover:bg-emerald-500/25",
    };
  }
  if (action === "COUNTDOWN") {
    return {
      action,
      label: "START COUNTDOWN",
      busyLabel: "Starting countdown...",
      icon: <Activity className="h-4 w-4" />,
      className:
        "border-cyan-400/40 bg-cyan-500/15 text-cyan-100 hover:border-cyan-300/60 hover:bg-cyan-500/25",
    };
  }
  if (action === "LIVE") {
    const normalizedStatus = (lifecycleStatus ?? "").toUpperCase();
    const label = normalizedStatus === "PAUSED" ? "RESUME MATCH" : "GO LIVE";
    const busyLabel = normalizedStatus === "PAUSED" ? "Resuming..." : "Going live...";
    return {
      action,
      label,
      busyLabel,
      icon: <Play className="h-4 w-4" />,
      className:
        "border-emerald-400/40 bg-emerald-500/15 text-emerald-100 hover:border-emerald-300/60 hover:bg-emerald-500/25",
    };
  }
  if (action === "PAUSED") {
    const normalizedStatus = (lifecycleStatus ?? "").toUpperCase();
    return {
      action,
      label: normalizedStatus === "COUNTDOWN" ? "PAUSE COUNTDOWN" : "PAUSE MATCH",
      busyLabel: "Pausing...",
      icon: <PauseCircle className="h-4 w-4" />,
      className:
        "border-amber-400/40 bg-amber-500/15 text-amber-100 hover:border-amber-300/60 hover:bg-amber-500/25",
    };
  }
  if (action === "ENDED") {
    return {
      action,
      label: "END MATCH",
      busyLabel: "Ending...",
      icon: <StopCircle className="h-4 w-4" />,
      className:
        "border-red-400/40 bg-red-500/15 text-red-100 hover:border-red-300/60 hover:bg-red-500/25",
    };
  }
  if (action === "CONFIRMED") {
    return {
      action,
      label: "CONFIRM RESULTS",
      busyLabel: "Confirming...",
      icon: <CheckCircle2 className="h-4 w-4" />,
      className:
        "border-blue-400/40 bg-blue-500/15 text-blue-100 hover:border-blue-300/60 hover:bg-blue-500/25",
    };
  }
  return {
    action,
    label: "RESET TO READY",
    busyLabel: "Resetting...",
    icon: <RotateCcw className="h-4 w-4" />,
    className:
      "border-amber-400/40 bg-amber-500/12 text-amber-100 hover:border-amber-300/60 hover:bg-amber-500/20",
  };
}

function resolveMatchLifecycleActions(params: {
  lifecycleStatus?: string | null;
  locks?: MatchLifecycleLocks | null;
}): MatchLifecycleActionConfig[] {
  const lifecycleStatus = (params.lifecycleStatus ?? "READY").toUpperCase();
  const lifecycleLocked = params.locks?.lifecycleLocked ?? false;

  if (lifecycleLocked && lifecycleStatus !== "ENDED" && lifecycleStatus !== "FINISHED") {
    return [];
  }

  if (lifecycleStatus === "READY") {
    return [
      getMatchLifecycleActionConfig("start", lifecycleStatus),
      getMatchLifecycleActionConfig("COUNTDOWN", lifecycleStatus),
    ];
  }
  if (lifecycleStatus === "COUNTDOWN") {
    return [
      getMatchLifecycleActionConfig("LIVE", lifecycleStatus),
      getMatchLifecycleActionConfig("PAUSED", lifecycleStatus),
      getMatchLifecycleActionConfig("READY", lifecycleStatus),
    ];
  }
  if (lifecycleStatus === "LIVE") {
    return [
      getMatchLifecycleActionConfig("PAUSED", lifecycleStatus),
      getMatchLifecycleActionConfig("ENDED", lifecycleStatus),
    ];
  }
  if (lifecycleStatus === "PAUSED") {
    return [
      getMatchLifecycleActionConfig("LIVE", lifecycleStatus),
      getMatchLifecycleActionConfig("ENDED", lifecycleStatus),
      getMatchLifecycleActionConfig("READY", lifecycleStatus),
    ];
  }
  if (lifecycleStatus === "ENDED") {
    return [
      getMatchLifecycleActionConfig("CONFIRMED", lifecycleStatus),
      getMatchLifecycleActionConfig("READY", lifecycleStatus),
    ];
  }
  if (lifecycleStatus === "FINISHED") {
    return [getMatchLifecycleActionConfig("READY", lifecycleStatus)];
  }

  return [];
}

function realtimeSocketUrl() {
  const normalizedBase = API_URL.endsWith("/") ? API_URL : `${API_URL}/`;
  return new URL("/realtime", normalizedBase).toString();
}

type CameraSuggestionSocketLease = {
  socket: Socket;
  refCount: number;
  disposeTimer: number | null;
};

const CAMERA_SUGGESTION_SOCKET_DISPOSE_DELAY_MS = 500;
const cameraSuggestionSocketLeases = new Map<string, CameraSuggestionSocketLease>();

function acquireCameraSuggestionSocket(matchId: string): {
  socket: Socket;
  created: boolean;
} {
  const existing = cameraSuggestionSocketLeases.get(matchId);
  if (existing) {
    if (existing.disposeTimer !== null) {
      window.clearTimeout(existing.disposeTimer);
      existing.disposeTimer = null;
    }
    existing.refCount += 1;
    return { socket: existing.socket, created: false };
  }

  const socket = io(realtimeSocketUrl(), {
    transports: ["websocket"],
    query: { matchId },
    forceNew: true,
    autoConnect: false,
  });
  cameraSuggestionSocketLeases.set(matchId, {
    socket,
    refCount: 1,
    disposeTimer: null,
  });
  return { socket, created: true };
}

function releaseCameraSuggestionSocket(matchId: string) {
  const lease = cameraSuggestionSocketLeases.get(matchId);
  if (!lease) {
    return;
  }

  lease.refCount = Math.max(0, lease.refCount - 1);
  if (lease.refCount > 0 || lease.disposeTimer !== null) {
    return;
  }

  lease.disposeTimer = window.setTimeout(() => {
    const current = cameraSuggestionSocketLeases.get(matchId);
    if (!current || current !== lease || current.refCount > 0) {
      return;
    }

    current.socket.disconnect();
    cameraSuggestionSocketLeases.delete(matchId);
  }, CAMERA_SUGGESTION_SOCKET_DISPOSE_DELAY_MS);
}

function isCameraSuggestion(value: unknown): value is CameraSuggestion {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.matchId === "string" &&
    typeof record.reason === "string" &&
    typeof record.priority === "number" &&
    (typeof record.teamId === "string" || record.teamId === null || record.teamId === undefined) &&
    (typeof record.playerId === "string" || record.playerId === null || record.playerId === undefined)
  );
}

function cameraSuggestionKey(suggestion: CameraSuggestion) {
  return [
    suggestion.matchId,
    suggestion.reason,
    suggestion.teamId ?? "no-team",
    suggestion.playerId ?? "no-player",
    String(suggestion.priority),
  ].join(":");
}

function mergeCameraSuggestions(
  current: CameraSuggestion[],
  incoming: CameraSuggestion,
) {
  const nextKey = cameraSuggestionKey(incoming);
  return [incoming, ...current.filter((item) => cameraSuggestionKey(item) !== nextKey)].slice(0, 6);
}

function priorityTone(priority: number) {
  if (priority >= 100) {
    return "border-red-400/40 bg-red-500/15 text-red-100";
  }
  if (priority >= 95) {
    return "border-amber-400/40 bg-amber-500/15 text-amber-100";
  }
  return "border-cyan-400/40 bg-cyan-500/15 text-cyan-100";
}

export default function MatchControlPage() {
  const params = useParams<{ matchId: string }>();
  const matchId = params?.matchId ?? "";
  const [client] = useState(() => new QueryClient());

  if (!matchId) {
    return <div className="text-red-300">Match id missing.</div>;
  }

  return (
    <QueryClientProvider client={client}>
      <MatchControlPanel matchId={matchId} />
    </QueryClientProvider>
  );
}

function MatchOpsDeck({
  matchId,
  matchName,
  matchNumber,
  mapName,
  tournamentName,
  status,
  matchEndedReason,
  sourceBadge,
  liveState,
  controlState,
  resultRows,
  telemetry,
  binding,
  resultFinalized,
  isFinalizing,
  liveSnapshotVersion,
}: {
  matchId: string;
  matchName?: string | null;
  matchNumber?: number | null;
  mapName?: string | null;
  tournamentName?: string | null;
  status?: string | null;
  matchEndedReason?: string | null;
  sourceBadge?: string | null;
  liveState: LiveControlSnapshot | null;
  controlState: ControlState | null;
  resultRows: ResultRow[];
  telemetry: RuntimeTelemetrySnapshot | null;
  binding: RuntimeBindingSnapshot | null;
  resultFinalized: boolean;
  isFinalizing: boolean;
  liveSnapshotVersion?: number | null;
}) {
  const liveTeams = liveState?.teams ?? [];
  const liveTeamsHaveAliveCounts = hasLiveControlAliveCounts(liveTeams);
  const liveTeamsHavePlayerCounts = hasLiveControlPlayerCounts(liveTeams);
  const normalizedSource = normalizeMatchSource(sourceBadge);
  const isManualSource = normalizedSource === "MANUAL";
  const hasFreshLiveTelemetry = telemetry?.telemetryActive === true;
  const isTelemetryStaleLiveMatch =
    !isManualSource &&
    !resultFinalized &&
    !isFinalizing &&
    (status ?? "").toUpperCase() === "LIVE" &&
    !hasFreshLiveTelemetry;
  const competitiveResultRows = resultRows.filter((row) => !isMissingTeam(row));
  const missingTeamsCount = resultRows.filter((row) => isMissingTeam(row)).length;
  const manualResultRowsAvailable = isManualSource && competitiveResultRows.length > 0;
  const manualTotalTeams = manualResultRowsAvailable ? competitiveResultRows.length : null;
  const manualAliveTeams = manualResultRowsAvailable
    ? competitiveResultRows.filter((row) => !(row.eliminated ?? Boolean(row.eliminatedAt))).length
    : null;
  const manualTotalPlayers = manualResultRowsAvailable
    ? competitiveResultRows.reduce((sum, row) => sum + row.players.length, 0)
    : null;
  const manualAlivePlayers = manualResultRowsAvailable
    ? competitiveResultRows.reduce((sum, row) => {
        return (
          sum +
          row.players.filter((player) => player.alive ?? player.isAlive ?? false).length
        );
      }, 0)
    : null;
  const manualTotalKills = manualResultRowsAvailable
    ? competitiveResultRows.reduce((sum, row) => sum + (row.teamKills ?? 0), 0)
    : null;
  const totalTeams =
    (resultFinalized ? competitiveResultRows.length : null) ??
    manualTotalTeams ??
    liveState?.summary?.totalTeams ??
    (liveTeams.length > 0 ? liveTeams.length : null) ??
    (competitiveResultRows.length > 0 ? competitiveResultRows.length : null);
  const aliveTeams =
    (resultFinalized
      ? competitiveResultRows.some((row) => row.placement === 1)
        ? 1
        : 0
      : null) ??
    manualAliveTeams ??
    liveState?.summary?.aliveTeams ??
    (liveTeamsHaveAliveCounts
      ? liveTeams.filter((team) => isLiveControlTeamAlive(team)).length
      : null) ??
    (competitiveResultRows.length > 0
      ? competitiveResultRows.filter((row) => !(row.eliminated ?? Boolean(row.eliminatedAt))).length
      : null);
  const totalPlayers =
    (resultFinalized
      ? competitiveResultRows.reduce((sum, row) => sum + row.players.length, 0)
      : null) ??
    manualTotalPlayers ??
    liveState?.summary?.totalPlayers ??
    (liveTeamsHavePlayerCounts
      ? liveTeams.reduce((sum, team) => {
          return sum + (getLiveControlTeamTotalPlayers(team) ?? 0);
        }, 0)
      : null) ??
    (competitiveResultRows.length > 0
      ? competitiveResultRows.reduce((sum, row) => sum + row.players.length, 0)
      : null);
  const alivePlayers =
    manualAlivePlayers ??
    liveState?.summary?.alivePlayers ??
    (liveTeamsHaveAliveCounts
      ? liveTeams.reduce((sum, team) => {
          return sum + (getLiveControlTeamAlivePlayers(team) ?? 0);
        }, 0)
      : null) ??
    (resultRows.length > 0
      ? resultRows.reduce((sum, row) => {
          return (
            sum +
            row.players.filter((player) => player.alive ?? player.isAlive ?? false).length
          );
        }, 0)
      : null);
  const totalKills =
    resultFinalized
      ? competitiveResultRows.reduce((sum, row) => sum + (row.teamKills ?? 0), 0)
      : manualTotalKills !== null
      ? manualTotalKills
      : liveTeams.length > 0
      ? liveTeams.reduce((sum, team) => sum + team.kills, 0)
      : competitiveResultRows.reduce((sum, row) => sum + (row.teamKills ?? 0), 0);
  const totalKillsLabel =
    resultFinalized || isFinalizing || hasFreshLiveTelemetry || isManualSource
      ? String(totalKills)
      : "—";
  const circlePhaseLabel = isTelemetryStaleLiveMatch
    ? "Waiting"
    : formatCirclePhase(liveState?.circle?.phase);
  const observedPlayerLabel =
    liveState?.observedPlayer?.playerName ??
    liveState?.observedPlayer?.playerIgn ??
    "Waiting for live POV";
  const observedTeamLabel =
    liveState?.observedPlayer?.teamName ??
    liveState?.observedPlayer?.teamTag ??
    "Awaiting team";
  const updatedLabel =
    liveState?.updatedAt || controlState?.updatedAt
      ? formatDate(liveState?.updatedAt ?? controlState?.updatedAt)
      : "Waiting for first packet";
  const telemetrySourceLabel = getTelemetrySourceLabel(normalizedSource);
  const runtimeTelemetryState = formatRuntimeTelemetryState(telemetry, {
    resultFinalized,
    isFinalizing,
  });
  const runtimeBindingState = formatBindingState(binding);
  const hasAutoEndedConflict =
    (status ?? "").toUpperCase() === "ENDED" &&
    (matchEndedReason ?? "").toUpperCase() === "AUTO_ENDED_BY_NEW_LIVE_MATCH" &&
    typeof aliveTeams === "number" &&
    aliveTeams > 1;
  const controlReason =
    hasAutoEndedConflict
      ? `${aliveTeams} teams still marked alive after auto-end.`
      : resultFinalized
        ? "Results finalized."
        : isFinalizing
          ? "Finalizing."
        : isManualSource && (status ?? "").toUpperCase() === "LIVE"
          ? "Manual source is active. Results Desk controls live counts."
        : isTelemetryStaleLiveMatch
          ? "Live lifecycle is active, but observer telemetry is stale. Waiting for fresh packets."
      : controlState?.reason ??
        (status === "LIVE"
          ? "Live."
          : status === "ENDED"
            ? "Ended."
            : "Ready.");
  const matchLabel =
    matchName ?? (matchNumber ? `Match ${matchNumber}` : "Match Control");
  const timerLabel = formatMatchTimer(liveState?.startedAt, liveState?.endedAt);

  return (
    <div className="rounded-[24px] border border-cyan-400/20 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_40%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(3,7,18,0.96))] p-4 shadow-2xl shadow-black/35 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-[0.3em] text-cyan-200/70">
              Match Control
            </p>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                {matchLabel}
              </h1>
              {status ? (
                <span className={`rounded-full border px-3 py-1 text-[11px] ${badgeTone(status)}`}>
                  {status}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span
              className={`rounded-full border px-3 py-1 ${sourceBadgeTone(normalizedSource)}`}
            >
              {telemetrySourceLabel}
            </span>
            {mapName ? (
              <span className="rounded-full border border-blue-400/35 bg-blue-500/15 px-3 py-1 text-blue-100">
                {mapName.toUpperCase()}
              </span>
            ) : null}
            {tournamentName ? (
              <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-white/70">
                {tournamentName}
              </span>
            ) : null}
            {typeof liveSnapshotVersion === "number" ? (
              <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1 text-emerald-100">
                Mirror v{liveSnapshotVersion}
              </span>
            ) : null}
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-white/60">
              <span className="font-mono">{matchId}</span>
              <CopyButton text={matchId} label="Copy ID" />
            </div>
          </div>
        </div>

        <div className="min-w-[220px] max-w-sm rounded-2xl border border-white/10 bg-black/25 px-3.5 py-3 shadow-lg shadow-black/20">
          <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.18em] text-white/45">
            <span>Last Sync</span>
            <span className="text-white/65">Timer {timerLabel}</span>
          </div>
          <div className="mt-2 text-base font-semibold text-white">{updatedLabel}</div>
          <div className="mt-2 text-xs leading-5 text-white/55">{controlReason}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
        <LiveMetricCard
          label="Alive Teams"
          value={`${aliveTeams ?? "—"}/${totalTeams ?? "—"}`}
          icon={<Shield className="h-4 w-4" />}
          accent="border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
        />
        {missingTeamsCount > 0 ? (
          <LiveMetricCard
            label="Missing Teams"
            value={String(missingTeamsCount)}
            icon={<Users className="h-4 w-4" />}
            accent="border-slate-400/30 bg-slate-500/10 text-slate-100"
          />
        ) : null}
        <LiveMetricCard
          label="Alive Players"
          value={`${alivePlayers ?? "—"}/${totalPlayers ?? "—"}`}
          icon={<Users className="h-4 w-4" />}
          accent="border-cyan-400/30 bg-cyan-500/10 text-cyan-100"
        />
        <LiveMetricCard
          label="Total Kills"
          value={totalKillsLabel}
          icon={<Skull className="h-4 w-4" />}
          accent="border-blue-400/30 bg-blue-500/10 text-blue-100"
        />
        <LiveMetricCard
          label="Circle Phase"
          value={circlePhaseLabel}
          icon={<Activity className="h-4 w-4" />}
          accent="border-violet-400/30 bg-violet-500/10 text-violet-100"
        />
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(250px,0.64fr)]">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4 shadow-lg shadow-black/15">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/45">
                Control Health
              </p>
              <h2 className="mt-1 text-base font-semibold text-white">Live Authority</h2>
            </div>
            <div
              className={`rounded-full border px-3 py-1 text-[11px] ${sourceBadgeTone(normalizedSource)}`}
            >
              {telemetrySourceLabel}
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">
                Match State
              </div>
              <div className="mt-1.5 text-sm font-semibold text-white">{status || "READY"}</div>
              <div className="mt-1 text-[11px] leading-5 text-white/50">
                Lifecycle
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">
                Telemetry Source
              </div>
              <div className="mt-1.5 text-sm font-semibold text-white">{telemetrySourceLabel}</div>
              <div className="mt-1 text-[11px] leading-5 text-white/50">
                Stale mirror packets are ignored
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">
                Telemetry Status
              </div>
              <div className="mt-1.5 text-sm font-semibold text-white">{runtimeTelemetryState}</div>
              <div className="mt-1 text-[11px] leading-5 text-white/50">
                Canonical `/control` snapshot
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">
                Binding
              </div>
              <div className="mt-1.5 text-sm font-semibold text-white">{runtimeBindingState}</div>
              <div className="mt-1 text-[11px] leading-5 text-white/50">
                {binding?.telemetryProvider ??
                  binding?.sourceMode ??
                  binding?.dataSource ??
                  binding?.dataMode ??
                  "No telemetry binding configured."}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-orange-300/18 bg-[linear-gradient(180deg,rgba(249,115,22,0.1),rgba(15,23,42,0.64))] p-4 shadow-lg shadow-black/20">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/45">
                Observer Focus
              </p>
              <h2 className="mt-1 flex items-center gap-2 text-base font-semibold text-white">
                <Flame className="h-4 w-4 text-orange-300" />
                Current POV Priority
              </h2>
            </div>
            <div className={`rounded-full border px-2.5 py-1 text-[11px] ${badgeTone(status)}`}>
              {status || "READY"}
            </div>
          </div>
          <div className="mt-3 rounded-xl border border-white/10 bg-black/30 p-3.5">
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">Player</div>
            <div className="mt-1.5 text-base font-semibold text-white">{observedPlayerLabel}</div>
            <div className="mt-3 text-[10px] uppercase tracking-[0.18em] text-white/45">Team</div>
            <div className="mt-1.5 text-sm text-white/70">{observedTeamLabel}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WidgetsTab({
  widgets,
  instances,
  onEnable,
  busy,
  error,
  orgReady,
}: {
  widgets: ReadonlyArray<{ key: string; label: string; description: string }>;
  instances: Record<string, WidgetInstanceInfo>;
  onEnable: (widgetType: string) => void;
  busy: string | null;
  error: string | null;
  orgReady: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Broadcast Widgets</h2>
            <p className="text-sm text-white/60">OBS/browser overlays.</p>
          </div>
        </div>

        {error ? (
          <div className="mt-3 rounded border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        {!orgReady ? (
          <div className="mt-3 rounded border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            Organization context is required to enable widgets.
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {widgets.map((w) => {
            const instance = instances[w.key];
            return (
              <div
                key={w.key}
                className="rounded-lg border border-white/10 bg-black/40 p-4 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-white">{w.label}</div>
                    <div className="text-xs text-white/60">{w.description}</div>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-1 text-[11px] ${instance ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-100" : "border-white/20 bg-white/5 text-white/60"}`}
                  >
                    {instance ? "Enabled" : "Disabled"}
                  </span>
                </div>

                {instance?.obsUrl ? (
                  <div className="flex items-center gap-2 text-xs text-white/70">
                    <span className="truncate">{instance.obsUrl}</span>
                    <CopyButton text={instance.obsUrl} label="Copy URL" />
                  </div>
                ) : null}

                <div className="flex justify-end">
                  <button
                    onClick={() => onEnable(w.key)}
                    disabled={busy === w.key || !orgReady}
                    className="rounded bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow hover:bg-indigo-500 disabled:opacity-50"
                  >
                    {busy === w.key ? "Enabling..." : instance ? "Refresh / Reuse" : "Enable"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ResultsTab({
  results,
  draft,
  setDraft,
  dirty,
  blocked,
  onDirty,
  locked,
  matchLocked,
  lockReason,
  onReset,
  saving,
  status,
  error,
  loading,
  onAutoSave,
  aliveTeams,
  totalTeams,
  sourceMode,
  matchStatus,
  matchId,
  onPlacementsSaved,
  teams,
  liveTeams,
  liveSnapshotVersion,
  overrideReleaseAllowed,
  overrideReleaseReason,
  overrideBusyKey,
  overrideNotice,
  overrideError,
  resultsEditBusy,
  resultsEditNotice,
  resultFinalized,
  orgReady,
  onToggleResultsEditing,
  onReleaseMatchOverrides,
  onReleaseTeamOverrides,
}: {
  results: ResultRow[];
  draft: Record<string, PlayerResultRow[]>;
  setDraft: React.Dispatch<React.SetStateAction<Record<string, PlayerResultRow[]>>>;
  dirty: Record<string, boolean>;
  blocked: Record<string, boolean>;
  onDirty: (teamId: string) => void;
  locked: boolean;
  matchLocked: boolean;
  lockReason: string | null;
  onReset: (teamId: string) => void;
  saving: string | null;
  status: Record<string, SaveState>;
  error: string | null;
  loading: boolean;
  onAutoSave: (teamId: string) => void;
  aliveTeams?: number | null;
  totalTeams?: number | null;
  sourceMode?: string | null;
  matchStatus?: string | null;
  matchId: string;
  onPlacementsSaved: () => Promise<void>;
  teams: MatchTeamRow[];
  liveTeams: LiveControlSnapshot["teams"];
  liveSnapshotVersion?: number | null;
  overrideReleaseAllowed: boolean;
  overrideReleaseReason: string | null;
  overrideBusyKey: string | null;
  overrideNotice: string | null;
  overrideError: string | null;
  resultsEditBusy: "unlock" | "lock" | null;
  resultsEditNotice: string | null;
  resultFinalized: boolean;
  orgReady: boolean;
  onToggleResultsEditing: (enableEditing: boolean) => Promise<void>;
  onReleaseMatchOverrides: () => Promise<void>;
  onReleaseTeamOverrides: (teamId: string, teamName: string) => Promise<void>;
}) {
  const hasInitialised = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [placementModalOpen, setPlacementModalOpen] = useState(false);
  const [placementDraft, setPlacementDraft] = useState<string[]>([]);
  const [placementError, setPlacementError] = useState<string | null>(null);
  const [placementSaving, setPlacementSaving] = useState(false);
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const normalizedSourceMode = (sourceMode ?? "MANUAL").toUpperCase();
  const telemetryDrivenSource = isTelemetryDrivenSource(normalizedSourceMode);
  const resultsLocked = locked || matchLocked;
  const editable = !resultsLocked;
  const hasDirtyTeams = Object.values(dirty).some(Boolean);
  const finalizedTelemetryResults = telemetryDrivenSource && resultFinalized;
  const reopenedForManualEditing = finalizedTelemetryResults && !resultsLocked;
  const resultsEditBusyLabel =
    resultsEditBusy === "unlock"
      ? "Opening editor..."
      : resultsEditBusy === "lock"
        ? "Locking results..."
        : null;
  const editResultsDisabledReason =
    !orgReady
      ? "Organization context is required."
      : resultsEditBusy === "unlock"
        ? "Reopening finalized results..."
        : null;
  const lockResultsDisabledReason =
    !orgReady
      ? "Organization context is required."
      : resultsEditBusy === "lock"
        ? "Locking results..."
        : hasDirtyTeams
          ? "Save or reset pending edits before locking results again."
          : saving
            ? "Wait for the current save to finish."
            : null;
  const resultsLockMessage = lockReason || "Results are locked.";

  const updateTeamDraft = useCallback(
    (teamId: string, updater: (rows: PlayerResultRow[]) => PlayerResultRow[]) => {
      setDraft((prev) => {
        const current = prev[teamId] ?? [];
        const nextRows = normalizePlayerRows(updater(current));
        return { ...prev, [teamId]: nextRows };
      });
    },
    [setDraft],
  );

  useEffect(() => {
    if (Object.values(dirty).some(Boolean)) return;

    setDraft((prev) => {
      let changed = false;
      const next: typeof prev = { ...prev };

      results.forEach((team) => {
        const players = prev[team.teamId] ?? [];
        if (!players.length) return;

        const updated = normalizePlayerRows(players);
        const mutated =
          updated.length !== players.length ||
          updated.some((p, idx) => {
            const current = players[idx];
            return (
              p.isKnocked !== current.isKnocked ||
              p.knocked !== current.knocked ||
              p.isAlive !== current.isAlive ||
              p.alive !== current.alive
            );
          });

        if (mutated) {
          next[team.teamId] = updated;
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [results, setDraft, dirty]);

  useEffect(() => {
    if (!hasInitialised.current) {
      hasInitialised.current = true;
      return;
    }

    if (resultsLocked) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    const dirtyTeams = Object.keys(dirty).filter(
      (teamId) => dirty[teamId] && !blocked[teamId],
    );
    if (!dirtyTeams.length) return;

    debounceRef.current = setTimeout(() => {
      dirtyTeams.forEach((teamId) => onAutoSave(teamId));
      debounceRef.current = null;
    }, 800);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [blocked, dirty, draft, onAutoSave, resultsLocked]);

  const globalSaveState: SaveState = useMemo(() => {
    if (resultsLocked) return 'locked';
    if (Object.values(status).some((s) => s === 'error')) return 'error';
    if (saving) return 'saving';
    if (Object.keys(dirty).some((t) => dirty[t])) return 'idle';
    return 'saved';
  }, [dirty, resultsLocked, saving, status]);

  const teamsById = useMemo(() => {
    const map = new Map<string, MatchTeamRow>();
    teams.forEach((t) => map.set(t.teamId, t));
    return map;
  }, [teams]);
  const liveTeamsById = useMemo(() => {
    const map = new Map<string, LiveControlSnapshot["teams"][number]>();
    liveTeams.forEach((team) => map.set(team.teamId, team));
    return map;
  }, [liveTeams]);
  const displayRows = useMemo<ResultsDisplayRow[]>(() => {
    return results
      .map((team) => {
        const liveTeam = liveTeamsById.get(team.teamId) ?? null;
        const teamFallback = teamsById.get(team.teamId) ?? null;
        const draftPlayers = draft[team.teamId] ?? [];
        const persistedPlayers = normalizeResultPlayers(team.players);
        const livePlayers = normalizeLivePlayers(liveTeam?.players, team.teamId);
        const liveSnapshotAvailable =
          telemetryDrivenSource &&
          Boolean(
            liveTeam &&
              (liveTeam.hasTelemetryPresence === true ||
                livePlayers.length > 0 ||
                liveTeam.alivePlayers != null ||
                liveTeam.totalPlayers != null ||
                liveTeam.kills > 0),
          );
        const usingLiveSnapshot =
          liveSnapshotAvailable &&
          draftPlayers.length === 0 &&
          persistedPlayers.length === 0;
        const players = usingLiveSnapshot
          ? livePlayers
          : draftPlayers.length > 0
            ? draftPlayers
            : persistedPlayers;
        const aliveCount = usingLiveSnapshot
          ? liveTeam?.alivePlayers ?? computeAliveCount(players)
          : computeAliveCount(players);
        const totalPlayerCount = usingLiveSnapshot
          ? liveTeam?.totalPlayers ??
            Math.max(players.length, liveTeam?.alivePlayers ?? 0)
          : players.length;
        const knockedCount = players.filter(
          (player) =>
            (player.alive ?? player.isAlive ?? true) === true &&
            (player.isKnocked ?? player.knocked ?? false),
        ).length;
        const aliveKnown = usingLiveSnapshot
          ? liveTeam?.alivePlayers != null ||
            liveTeam?.alive === false ||
            players.length > 0
          : players.length > 0;
        const waitingForTelemetry =
          telemetryDrivenSource && !liveSnapshotAvailable && players.length === 0;
        const eliminatedOrderFlag =
          team.eliminatedOrder !== undefined && team.eliminatedOrder !== null;
        const eliminatedValue = team.eliminated ?? team.eliminatedAt ?? null;
        const teamEliminated =
          !waitingForTelemetry &&
          (Boolean(eliminatedValue) ||
            eliminatedOrderFlag ||
            (aliveKnown && aliveCount === 0));
        const teamLocked = Boolean(team.teamLocked ?? team.isLocked ?? teamEliminated);
        const teamLogo =
          ensureApiUrl(
            liveTeam?.logoUrl ??
              team.team?.logoUrl ??
              team.team?.logoLightUrl ??
              team.team?.logoDarkUrl ??
              teamFallback?.logoUrl ??
              null,
          ) ?? FALLBACK_LOGO;
        const playerKillTotal = players.reduce(
          (sum, player) => sum + (Number(player.kills) || 0),
          0,
        );
        const manualKillOverride = team.manualTotalKills === true;

        return {
          team,
          liveTeam,
          teamFallback,
          players,
          displayKills: usingLiveSnapshot
            ? liveTeam?.kills ??
              playerKillTotal
            : manualKillOverride
              ? (team.teamKills ?? playerKillTotal)
              : playerKillTotal,
          aliveCount,
          totalPlayerCount,
          knockedCount,
          aliveKnown,
          waitingForTelemetry,
          teamEliminated,
          teamLocked,
          usingLiveSnapshot,
          teamLogo,
          teamName:
            liveTeam?.name ??
            liveTeam?.tag ??
            team.team?.name ??
            teamFallback?.teamName ??
            team.teamId,
          teamTag: liveTeam?.tag ?? team.team?.tag ?? teamFallback?.teamTag ?? null,
          playerKillTotal,
          slotNumber:
            liveTeam?.slot ??
            team.slot ??
            team.slotNumber ??
            teamFallback?.slot ??
            null,
        };
      })
      .sort((left, right) => {
        const leftMissing = isMissingTeam(left.team);
        const rightMissing = isMissingTeam(right.team);
        if (leftMissing !== rightMissing) {
          return leftMissing ? 1 : -1;
        }
        if (left.teamEliminated !== right.teamEliminated) {
          return left.teamEliminated ? 1 : -1;
        }
        if (!left.teamEliminated) {
          return (left.slotNumber ?? 0) - (right.slotNumber ?? 0);
        }
        const leftPlacement = left.team.placement ?? Number.POSITIVE_INFINITY;
        const rightPlacement = right.team.placement ?? Number.POSITIVE_INFINITY;
        if (leftPlacement !== rightPlacement) {
          return leftPlacement - rightPlacement;
        }
        return (left.slotNumber ?? 0) - (right.slotNumber ?? 0);
      });
  }, [draft, liveTeamsById, results, teamsById, telemetryDrivenSource]);
  const liveTeamsHaveAliveCounts = useMemo(
    () => hasLiveControlAliveCounts(liveTeams),
    [liveTeams],
  );
  const competitiveDisplayRows = useMemo(
    () => displayRows.filter((row) => !isMissingTeam(row.team)),
    [displayRows],
  );
  const missingDisplayRows = useMemo(
    () => displayRows.filter((row) => isMissingTeam(row.team)),
    [displayRows],
  );
  const missingTeamsCount = missingDisplayRows.length;
  const firstMissingIndex = useMemo(
    () => displayRows.findIndex((row) => isMissingTeam(row.team)),
    [displayRows],
  );
  const resolvedAliveTeams = useMemo(() => {
    if (finalizedTelemetryResults && competitiveDisplayRows.length > 0) {
      return competitiveDisplayRows.some((row) => row.team.placement === 1) ? 1 : 0;
    }
    if (liveTeamsHaveAliveCounts) {
      return liveTeams.filter((team) => isLiveControlTeamAlive(team)).length;
    }
    if (competitiveDisplayRows.length > 0) {
      return competitiveDisplayRows.filter((row) => !row.teamEliminated && row.aliveCount > 0).length;
    }
    return aliveTeams ?? null;
  }, [
    aliveTeams,
    competitiveDisplayRows,
    finalizedTelemetryResults,
    liveTeams,
    liveTeamsHaveAliveCounts,
  ]);
  const resolvedTotalTeams = useMemo(() => {
    if (finalizedTelemetryResults && competitiveDisplayRows.length > 0) {
      return competitiveDisplayRows.length;
    }
    if (liveTeams.length > 0) {
      return liveTeams.length;
    }
    if (competitiveDisplayRows.length > 0) {
      return competitiveDisplayRows.length;
    }
    return totalTeams ?? results.length;
  }, [competitiveDisplayRows, finalizedTelemetryResults, liveTeams, results.length, totalTeams]);
  const liveFallbackCount = useMemo(
    () => displayRows.filter((row) => row.usingLiveSnapshot).length,
    [displayRows],
  );
  const manualOverrideTeamsCount = useMemo(
    () => results.filter((team) => hasTeamManualOverride(team)).length,
    [results],
  );
  const releaseAllBusy = overrideBusyKey === "match";
  const releaseActionBusy = overrideBusyKey !== null;
  const releaseAllDisabledReason =
    manualOverrideTeamsCount === 0
      ? "No manual overrides are active."
      : !overrideReleaseAllowed
        ? overrideReleaseReason ?? "Override release is not available."
        : null;

  const placementRows = useMemo(
    () => results.filter((team) => isPlacementEligibleTeam(team)),
    [results],
  );

  const teamMap = useMemo(() => {
    const map = new Map<
      string,
      { matchSlotId: string; teamId: string; name: string; logo: string | null; slot: number | null }
    >();
    placementRows.forEach((r) => {
      const fallback = teamsById.get(r.teamId) ?? null;
      const logoCandidate =
        r.team?.logoUrl ??
        r.team?.logoLightUrl ??
        r.team?.logoDarkUrl ??
        fallback?.logoUrl ??
        null;
      map.set(r.id, {
        matchSlotId: r.id,
        teamId: r.teamId,
        name: r.team?.name ?? fallback?.teamName ?? r.teamId,
        slot: r.slot ?? r.slotNumber ?? fallback?.slot ?? null,
        logo: ensureApiUrl(logoCandidate) ?? FALLBACK_LOGO,
      });
    });
    return map;
  }, [placementRows, teamsById]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setPlacementDraft((items) => {
      const oldIndex = items.indexOf(active.id as string);
      const newIndex = items.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return items;
      return arrayMove(items, oldIndex, newIndex);
    });
  };

  const openPlacementModal = () => {
    if (resultsLocked) return;
    const data = placementRows ?? [];
    const sorted = [...data].sort((a, b) => (a.placement ?? 999) - (b.placement ?? 999));
    const draft = Array.from({ length: data.length }).map((_, idx) => sorted[idx]?.id ?? "");
    setPlacementDraft(draft);
    setPlacementError(null);
    setPlacementModalOpen(true);
  };

  const validatePlacementDraft = () => {
    const ids = placementDraft
      .map((slotId) => teamMap.get(slotId)?.teamId ?? "")
      .filter(Boolean);
    if (ids.length !== placementDraft.length) {
      return "All placements must have a slot selected";
    }
    const unique = new Set(ids);
    if (unique.size !== ids.length) {
      return "Each slot must appear exactly once";
    }
    return null;
  };

  const savePlacements = async () => {
    if (resultsLocked) {
      setPlacementError(resultsLockMessage);
      return;
    }
    const err = validatePlacementDraft();
    if (err) {
      setPlacementError(err);
      return;
    }
    setPlacementError(null);
    setPlacementSaving(true);
    try {
      const payload = placementDraft.map((matchSlotId, idx) => {
        const info = teamMap.get(matchSlotId);
        return {
          teamId: info?.teamId ?? "",
          placement: idx + 1,
        };
      });
      await apiFetch(`/me/matches/${matchId}/results/placements`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placements: payload }),
      });
      await onPlacementsSaved();
      setPlacementModalOpen(false);
    } catch (e) {
      setPlacementError(
        (e as { body?: string })?.body ?? 'Failed to save placements.',
      );
    } finally {
      setPlacementSaving(false);
    }
  };

  const reviveTeam = useCallback(
    (teamId: string) => {
      updateTeamDraft(teamId, (rows) => {
        if (!rows.length) return rows;
        const revived = rows.map((row, idx) =>
          idx === 0
            ? {
                ...row,
                alive: true,
                isAlive: true,
                knocked: false,
                isKnocked: false,
              }
            : row,
        );
        return normalizePlayerRows(revived);
      });
      onDirty(teamId);
    },
    [onDirty, updateTeamDraft],
  );

  const toggleExpandedTeam = useCallback((teamId: string) => {
    setExpandedTeamId((current) => (current === teamId ? null : teamId));
  }, []);

  useEffect(() => {
    if (!expandedTeamId) return;
    if (!displayRows.some((row) => row.team.teamId === expandedTeamId)) {
      setExpandedTeamId(null);
    }
  }, [displayRows, expandedTeamId]);

  return (
    <div className="space-y-4">
      <div className="space-y-4 rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-black p-5 sm:p-6 shadow-lg shadow-black/40">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.24em] text-white/40">Match Results</p>
            <h2 className="text-[28px] font-bold leading-tight text-white">Results Desk</h2>
          </div>

          <div className="flex flex-col gap-3 xl:min-w-[360px] xl:items-end">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-cyan-400/20 bg-cyan-500/[0.08] px-3 py-1.5 font-medium text-cyan-100">
                {sourceMode ?? "MANUAL"} SOURCE
              </span>
              <span className="rounded-full border border-white/15 bg-white/[0.08] px-3 py-1.5 font-medium text-white/80">
                {matchStatus ?? "—"}
              </span>
              {typeof liveSnapshotVersion === "number" ? (
                <span className="rounded-full border border-emerald-400/25 bg-emerald-500/[0.08] px-3 py-1.5 font-medium text-emerald-100">
                  Mirror v{liveSnapshotVersion}
                </span>
              ) : null}
              <span
                className={`rounded-full border px-3 py-1.5 ${
                  globalSaveState === "saved"
                    ? "border-emerald-400/25 bg-emerald-500/[0.08] text-emerald-100"
                    : globalSaveState === "saving"
                      ? "border-amber-400/25 bg-amber-500/[0.08] text-amber-100"
                      : globalSaveState === "error"
                        ? "border-red-400/25 bg-red-500/[0.08] text-red-100"
                        : "border-white/15 bg-white/[0.08] text-white/70"
                }`}
              >
                {globalSaveState === "saved"
                  ? "Saved"
                  : globalSaveState === "saving"
                    ? "Saving..."
                    : globalSaveState === "error"
                      ? "Save failed"
                      : globalSaveState === "locked"
                        ? "Locked"
                        : "Pending autosave"}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/[0.08] px-3 py-1.5 text-emerald-100">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="text-emerald-50/80">Alive Teams</span>
                <span className="font-semibold text-white">
                  {resolvedAliveTeams ?? "—"} / {resolvedTotalTeams ?? results.length}
                </span>
              </div>
              {missingTeamsCount > 0 ? (
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-400/20 bg-slate-500/[0.08] px-3 py-1.5 text-slate-100">
                  <span className="h-2 w-2 rounded-full bg-slate-300" />
                  <span className="text-slate-100/80">Missing Teams</span>
                  <span className="font-semibold text-white">{missingTeamsCount}</span>
                </div>
              ) : null}
              <button
                type="button"
                className="rounded-full border border-indigo-400/25 bg-indigo-500/[0.08] px-3.5 py-1.5 font-semibold text-indigo-100 transition hover:border-indigo-300/50 hover:bg-indigo-500/[0.14] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={resultsLocked}
                title={resultsLocked ? resultsLockMessage : "Open placement editor"}
                onClick={openPlacementModal}
              >
                Edit Placements
              </button>
              {finalizedTelemetryResults ? (
                <button
                  type="button"
                  disabled={Boolean(
                    reopenedForManualEditing
                      ? lockResultsDisabledReason
                      : editResultsDisabledReason,
                  )}
                  title={
                    reopenedForManualEditing
                      ? lockResultsDisabledReason ?? "Lock results again"
                      : editResultsDisabledReason ??
                        "Reopen finalized results for manual editing"
                  }
                  onClick={() => void onToggleResultsEditing(!reopenedForManualEditing)}
                  className={`rounded-full border px-3.5 py-1.5 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    reopenedForManualEditing
                      ? "border-amber-400/25 bg-amber-500/[0.08] text-amber-100 hover:border-amber-300/50 hover:bg-amber-500/[0.14]"
                      : "border-emerald-400/25 bg-emerald-500/[0.08] text-emerald-100 hover:border-emerald-300/50 hover:bg-emerald-500/[0.14]"
                  }`}
                >
                  {resultsEditBusyLabel ??
                    (reopenedForManualEditing ? "Lock Results" : "Edit Results")}
                </button>
              ) : null}
              {manualOverrideTeamsCount > 0 ? (
                <button
                  type="button"
                  disabled={Boolean(releaseAllDisabledReason) || releaseActionBusy}
                  title={
                    releaseAllBusy
                      ? "Releasing all manual overrides..."
                      : releaseAllDisabledReason ?? "Release all active manual overrides."
                  }
                  onClick={() => void onReleaseMatchOverrides()}
                  className="rounded-full border border-amber-400/25 bg-amber-500/[0.08] px-3.5 py-1.5 font-semibold text-amber-100 transition hover:border-amber-300/50 hover:bg-amber-500/[0.14] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {releaseAllBusy ? "Releasing overrides..." : "Release all overrides"}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {finalizedTelemetryResults && resultsLocked ? (
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.06] px-3.5 py-2.5 text-sm text-emerald-100/90">
            Results finalized. Use <span className="font-semibold">Edit Results</span> to reopen.
          </div>
        ) : null}

        {reopenedForManualEditing ? (
          <div className="rounded-xl border border-amber-400/20 bg-amber-500/[0.06] px-3.5 py-2.5 text-sm text-amber-100/90">
            Finalized results reopened for manual edits. Lock again when review is done.
          </div>
        ) : null}

        {resultsEditNotice ? (
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.06] px-3.5 py-2.5 text-sm text-emerald-100/90">
            {resultsEditNotice}
          </div>
        ) : null}

        {resultsLocked && !finalizedTelemetryResults ? (
          <div className="rounded-xl border border-amber-400/20 bg-amber-500/[0.06] px-3.5 py-2.5 text-sm text-amber-100/90">
            {resultsLockMessage}
          </div>
        ) : null}

        {normalizedSourceMode !== "MANUAL" && !finalizedTelemetryResults ? (
          <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/[0.06] px-3.5 py-2.5 text-sm text-cyan-100/90">
            Editing here creates manual overrides.
          </div>
        ) : null}

        {liveFallbackCount > 0 ? (
          <div className="rounded-xl border border-sky-400/20 bg-sky-500/[0.06] px-3.5 py-2.5 text-sm text-sky-100/90">
            {liveFallbackCount} {liveFallbackCount === 1 ? "team is" : "teams are"} using live fallback.
          </div>
        ) : null}

        {manualOverrideTeamsCount > 0 ? (
          <div className="rounded-xl border border-amber-400/20 bg-amber-500/[0.06] px-3.5 py-2.5 text-sm text-amber-100/90">
            Overrides active on {manualOverrideTeamsCount}{" "}
            {manualOverrideTeamsCount === 1 ? "team" : "teams"}.{" "}
            {overrideReleaseAllowed
              ? "Release when telemetry should take ownership again."
              : overrideReleaseReason ?? "Override release is not available in the current state."}
          </div>
        ) : null}

        {overrideNotice ? (
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.06] px-3.5 py-2.5 text-sm text-emerald-100/90">
            {overrideNotice}
          </div>
        ) : null}

        {overrideError ? (
          <div className="rounded-xl border border-red-400/20 bg-red-500/[0.06] px-3.5 py-2.5 text-sm text-red-100/90">
            {overrideError}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-red-400/20 bg-red-500/[0.06] px-3.5 py-2.5 text-sm text-red-100/90">
            {error}
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="grid grid-flow-row-dense gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div
              key={`skeleton-${idx}`}
              className="h-24 rounded-xl border border-white/10 bg-white/5 animate-pulse"
            />
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white/70">
          No results available yet.
        </div>
      ) : (
        <>
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {displayRows.map((row, index) => {
            const team = row.team;
            const players = row.players;
            const aliveCount = row.aliveCount;
            const knockedCount = row.knockedCount;
            const maxKnocked = Math.max(aliveCount - 1, 0);
            const knockLimitReached = knockedCount >= maxKnocked;
            const isLastAliveTeam =
              resolvedAliveTeams === 1 && aliveCount > 0 && !row.teamEliminated;
            const waitingForTelemetry = row.waitingForTelemetry;
            const teamEliminated = row.teamEliminated;
            const teamLocked = row.teamLocked;
            const teamMissing = team.presenceStatus === "NO_SHOW";
            const allowRevive = editable;
            const isSelected = expandedTeamId === team.teamId;
            const isExpanded = false;
            const derivedStatus: SaveState =
              resultsLocked
                ? 'locked'
                : teamLocked && !allowRevive
                  ? 'locked'
                  : saving === team.teamId
                    ? 'saving'
                    : status[team.teamId] ?? (dirty[team.teamId] ? 'idle' : 'saved');

            const statusLabel =
              waitingForTelemetry
                ? 'Waiting for telemetry'
                : derivedStatus === 'locked'
                ? teamEliminated
                  ? 'Team eliminated • Locked'
                  : 'Locked'
                : derivedStatus === 'saving'
                  ? 'Saving...'
                  : derivedStatus === 'error'
                    ? 'Save failed (retrying...)'
                    : dirty[team.teamId]
                      ? 'Pending autosave'
                      : 'Saved';

            const statusTone =
              waitingForTelemetry
                ? 'text-cyan-200'
                : derivedStatus === 'error'
                ? 'text-red-200'
                : derivedStatus === 'locked'
                  ? 'text-amber-200'
                  : derivedStatus === 'saving'
                    ? 'text-amber-100'
                    : 'text-emerald-200';

            const disableAlive = !editable || teamEliminated || isLastAliveTeam;
            const disableKnocked = !editable || teamEliminated || isLastAliveTeam;
            const teamPlacementDescriptor = describeOwnership(
              team.ownership?.placement ?? row.liveTeam?.ownership?.placement,
              {
                label: "Auto-derived placement",
                detail: "Placement comes from the canonical backend placement derivation.",
                className: "border-blue-400/25 bg-blue-500/[0.08] text-blue-100",
              },
            );
            const teamEliminationDescriptor = describeOwnership(
              team.ownership?.eliminated ?? row.liveTeam?.ownership?.eliminated,
              {
                label: "Auto-derived elimination",
                detail: "Elimination comes from canonical player/team state resolution.",
                className: "border-amber-400/25 bg-amber-500/[0.08] text-amber-100",
              },
            );
            const teamKillsDescriptor = describeOwnership(
              team.ownership?.totalKills ?? row.liveTeam?.ownership?.totalKills,
              team.manualTotalKills
                ? {
                    label: "Manual total override",
                    detail: "Team total kills are overriding the player kill aggregate.",
                    className: "border-cyan-400/25 bg-cyan-500/[0.12] text-cyan-100",
                  }
                : {
                    label: "Player aggregate",
                    detail: "Team total kills are derived from the summed player kills shown below.",
                    className: "border-cyan-400/15 bg-cyan-500/[0.08] text-cyan-100",
                  },
            );
            const dataSourceDescriptor = row.usingLiveSnapshot
              ? {
                  label: "Live mirror fallback",
                  detail:
                    "This team card is currently rendering from the versioned live mirror because persisted player rows are empty.",
                  className:
                    "border-sky-400/25 bg-sky-500/[0.08] text-sky-100",
                }
              : row.liveTeam
                ? {
                    label: "Persisted + live context",
                    detail:
                      "Editable fields come from persisted referee results while live mirror context remains visible for operator awareness.",
                    className:
                      "border-white/15 bg-white/[0.06] text-white/75",
                  }
                : {
                    label: "Persisted results",
                    detail:
                      "This team card is rendering from persisted referee result rows. Edits save back to the same rows.",
                    className:
                      "border-white/15 bg-white/[0.06] text-white/75",
                  };
            const teamHasOverrides =
              isManualOwnership(team.ownership?.placement) ||
              isManualOwnership(team.ownership?.eliminated) ||
              isManualOwnership(team.ownership?.totalKills) ||
              players.some((player) => hasPlayerManualOverride(player));
            const teamReleaseBusy = overrideBusyKey === `team:${team.teamId}`;
            const teamReleaseDisabledReason =
              !teamHasOverrides
                ? "No manual overrides are active on this team."
                : !overrideReleaseAllowed
                  ? overrideReleaseReason ?? "Override release is not available."
                  : releaseActionBusy && !teamReleaseBusy
                    ? "Another override release is currently in progress."
                    : null;
            const teamAuditLines = [
              describeAuditEntry(team.audit?.lastOverride ?? null, "Last override"),
              describeAuditEntry(team.audit?.lastRelease ?? null, "Last release"),
            ].filter((entry): entry is string => Boolean(entry));
            const reviveDisabledReason = !teamEliminated
              ? "Revive is only available after the team is eliminated."
              : !editable
                ? resultsLockMessage
                : null;

            return (
              <React.Fragment key={team.id}>
                {firstMissingIndex === index ? (
                  <div className="md:col-span-2 xl:col-span-3 2xl:col-span-4">
                    <div className="rounded-2xl border border-slate-400/20 bg-slate-500/[0.08] px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-100">Missing Teams</div>
                          <div className="mt-1 text-xs text-slate-200/75">
                            Assigned but absent from the live match. Excluded from standings and widgets.
                          </div>
                        </div>
                        <span className="rounded-full border border-slate-400/30 bg-slate-500/[0.08] px-3 py-1 text-xs font-semibold text-slate-100">
                          {missingTeamsCount}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : null}
                <div
                  className={`rounded-2xl border bg-gradient-to-br from-slate-900/85 via-slate-950/80 to-black/95 p-4 shadow-lg shadow-black/25 ${
                    isSelected
                      ? "border-cyan-400/35 shadow-cyan-950/20"
                      : waitingForTelemetry
                        ? 'border-cyan-400/20'
                        : teamEliminated
                          ? 'border-amber-400/30'
                          : 'border-white/10'
                  }`}
                >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <Image
                      src={row.teamLogo}
                      alt={row.teamName}
                      width={40}
                      height={40}
                      className="h-10 w-10 shrink-0 rounded-lg border border-white/10 object-cover"
                      unoptimized
                    />
                    <div className="min-w-0 space-y-1">
                      <div className="truncate text-base font-semibold leading-tight text-white">
                        {row.teamName}
                      </div>
                      <span className="inline-flex rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
                        Slot {row.slotNumber ?? "—"}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleExpandedTeam(team.teamId)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-semibold text-white/75 transition hover:border-white/35 hover:text-white"
                  >
                    {isSelected ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    {isSelected ? "Collapse" : "Expand"}
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-white/75">
                  <span
                    title={teamPlacementDescriptor.detail}
                    className="whitespace-nowrap rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1"
                  >
                    <span className="text-white/45">P</span>{" "}
                    <span className="font-semibold text-white">{team.placement ?? "—"}</span>
                  </span>
                  <span
                    title={teamKillsDescriptor.detail}
                    className={`whitespace-nowrap rounded-full border px-2.5 py-1 ${
                      team.manualTotalKills
                        ? "border-cyan-300/30 bg-cyan-500/[0.16]"
                        : "border-cyan-400/15 bg-cyan-500/[0.08]"
                    }`}
                  >
                    <span className="text-cyan-100/70">Kills</span>{" "}
                    <span className="font-semibold text-cyan-200">{row.displayKills}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-emerald-400/15 bg-emerald-500/[0.08] px-2.5 py-1">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    <span className="text-emerald-100/70">Alive</span>
                    <span className="font-semibold text-white">
                      {aliveCount}/{row.totalPlayerCount || 0}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-400/15 bg-amber-500/[0.08] px-2.5 py-1">
                    <span className="h-2 w-2 rounded-full bg-amber-400" />
                    <span className="text-amber-100/70">Knocked</span>
                    <span className="font-semibold text-white">
                      {knockedCount}/{row.totalPlayerCount || 0}
                    </span>
                  </span>
                </div>

                {isExpanded ? (
                  <div className="mt-4 space-y-3.5 border-t border-white/10 pt-3.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1">
                        {row.teamTag ? (
                          <div className="text-[11px] text-white/45">{row.teamTag}</div>
                        ) : null}
                        {teamMissing ? (
                          <div className="inline-flex items-center gap-1 rounded-full border border-rose-400/35 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-100">
                            Missing • Excluded from rankings and widgets
                          </div>
                        ) : null}
                        {isLastAliveTeam && (team.placement === 1 || team.placement === null) ? (
                          <div className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-100">
                            Winner • Placement 1
                          </div>
                        ) : null}
                      </div>
                      <div className={`text-[11px] ${statusTone}`}>{statusLabel}</div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <TagBadge descriptor={dataSourceDescriptor} />
                      <TagBadge descriptor={teamKillsDescriptor} />
                      <TagBadge descriptor={teamPlacementDescriptor} />
                      <TagBadge descriptor={teamEliminationDescriptor} />
                      {teamHasOverrides ? (
                        <TagBadge
                          descriptor={{
                            label: "Overrides active",
                            detail:
                              teamReleaseDisabledReason ??
                              "Manual ownership is active on this team. Use Release overrides below to return ownership to telemetry where applicable.",
                            className:
                              "border-amber-400/25 bg-amber-500/[0.08] text-amber-100",
                          }}
                        />
                      ) : null}
                    </div>

                    {teamAuditLines.length > 0 ? (
                      <div className="space-y-1 text-[10px] text-white/45">
                        {teamAuditLines.map((line) => (
                          <div key={line}>{line}</div>
                        ))}
                      </div>
                    ) : null}

                    {waitingForTelemetry ? (
                      <div className="rounded-lg border border-cyan-400/20 bg-cyan-500/[0.06] px-3 py-2 text-xs text-cyan-100/90">
                        Waiting for telemetry. Player rows are not ready yet.
                      </div>
                    ) : row.usingLiveSnapshot && players.length === 0 ? (
                      <div className="rounded-lg border border-cyan-400/20 bg-cyan-500/[0.06] px-3 py-2 text-xs text-cyan-100/90">
                        Live summary only. Detailed player rows have not arrived yet.
                      </div>
                    ) : teamEliminated ? (
                      <div className="rounded-lg border border-amber-400/20 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-100/90">
                        Team eliminated. Revive to edit players.
                      </div>
                    ) : null}

                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="text-[10px] uppercase tracking-[0.18em] text-white/40">
                          <tr>
                            <th className="px-2 py-2 text-left">Player</th>
                            <th className="px-2 py-2 text-left">Kills</th>
                            <th className="px-2 py-2 text-left">Alive</th>
                            <th className="px-2 py-2 text-left">Knocked</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {players.map((p) => {
                            const alive = (p.alive ?? p.isAlive ?? true) === true;
                            const isLastAlive = alive && aliveCount === 1;
                            const alreadyKnocked = p.isKnocked ?? p.knocked ?? false;
                            const knockDisabled =
                              disableKnocked || !alive || isLastAlive || (knockLimitReached && !alreadyKnocked);
                            const playerAuditLines = [
                              describeAuditEntry(p.audit?.lastOverride ?? null, "Last override"),
                              describeAuditEntry(p.audit?.lastRelease ?? null, "Last release"),
                            ].filter((entry): entry is string => Boolean(entry));
                            const killsDescriptor = describeOwnership(p.ownership?.kills, {
                              label: "Persisted result",
                              detail:
                                "This kill value is currently coming from persisted result rows.",
                            });
                            const aliveDescriptor = describeOwnership(p.ownership?.alive, {
                              label: "Persisted result",
                              detail:
                                "This alive state is currently coming from persisted result rows.",
                            });
                            const knockedDescriptor = describeOwnership(p.ownership?.knocked, {
                              label: "Persisted result",
                              detail:
                                "This knocked state is currently coming from persisted result rows.",
                            });
                            const killsDisabledReason = !editable ? resultsLockMessage : null;
                            const aliveDisabledReason = !editable
                              ? resultsLockMessage
                              : teamEliminated
                                ? allowRevive
                                  ? "Use Revive team to restore the squad before changing individual alive states."
                                  : "Team is eliminated and cannot be edited in the current source mode."
                                : isLastAliveTeam
                                  ? "The last surviving team is locked while it remains the winner."
                                  : null;
                            const knockDisabledReason = !editable
                              ? resultsLockMessage
                              : teamEliminated
                                ? allowRevive
                                  ? "Use Revive team before changing knocked state."
                                  : "Team is eliminated and cannot be edited in the current source mode."
                                : !alive
                                  ? "Only alive players can be marked knocked."
                                  : isLastAlive
                                    ? "The last alive player cannot be marked knocked."
                                    : knockLimitReached && !alreadyKnocked
                                      ? "Only one surviving player can remain not knocked."
                                      : isLastAliveTeam
                                        ? "The last surviving team is locked while it remains the winner."
                                        : null;

                            return (
                              <tr key={p.id} className="text-white/90">
                                <td className="px-2 py-2 align-top">
                                  <div className="font-medium text-white">
                                    {p.name ?? p.playerId ?? 'Player'}
                                  </div>
                                  <div className="mt-1 text-[10px] text-white/45">
                                    {p.playerId ?? p.id}
                                  </div>
                                  {playerAuditLines.length > 0 ? (
                                    <div className="mt-1.5 space-y-0.5 text-[10px] text-white/35">
                                      {playerAuditLines.map((line) => (
                                        <div key={line}>{line}</div>
                                      ))}
                                    </div>
                                  ) : null}
                                </td>
                                <td className="px-2 py-2">
                                  <div className="flex flex-col">
                                    <input
                                      type="number"
                                      min={0}
                                      title={killsDisabledReason ?? killsDescriptor.detail}
                                      className="w-20 rounded border border-cyan-400/20 bg-black/60 px-2 py-1 text-cyan-100 font-semibold focus:border-cyan-300 focus:outline-none"
                                      value={p.kills ?? 0}
                                      disabled={!editable}
                                      onChange={(e) => {
                                        const value = Math.max(0, Number(e.target.value) || 0);
                                        updateTeamDraft(team.teamId, (rows) =>
                                          rows.map((row) => (row.id === p.id ? { ...row, kills: value } : row)),
                                        );
                                        onDirty(team.teamId);
                                      }}
                                    />
                                    <FieldMeta
                                      descriptor={killsDescriptor}
                                      disabledReason={killsDisabledReason}
                                    />
                                  </div>
                                </td>
                                <td className="px-2 py-2">
                                  <div className="flex flex-col">
                                    <input
                                      type="checkbox"
                                      checked={alive}
                                      title={aliveDisabledReason ?? aliveDescriptor.detail}
                                      disabled={!editable || (disableAlive && !(allowRevive && teamEliminated))}
                                      onChange={(e) => {
                                        const checked = e.target.checked;
                                        updateTeamDraft(team.teamId, (rows) =>
                                          rows.map((row) =>
                                            row.id === p.id
                                              ? {
                                                  ...row,
                                                  alive: checked,
                                                  isAlive: checked,
                                                  knocked: checked ? row.knocked : false,
                                                  isKnocked: checked ? row.isKnocked : false,
                                                }
                                              : row,
                                          ),
                                        );
                                        onDirty(team.teamId);
                                      }}
                                      className="h-4 w-4 accent-emerald-500"
                                    />
                                    <FieldMeta
                                      descriptor={aliveDescriptor}
                                      disabledReason={aliveDisabledReason}
                                    />
                                  </div>
                                </td>
                                <td className="px-2 py-2">
                                  <div className="flex flex-col">
                                    <input
                                      type="checkbox"
                                      checked={(p.isKnocked ?? p.knocked ?? false) === true}
                                      title={knockDisabledReason ?? knockedDescriptor.detail}
                                      disabled={!editable || knockDisabled}
                                      onChange={(e) => {
                                        const checked = e.target.checked;
                                        updateTeamDraft(team.teamId, (rows) =>
                                          rows.map((row) =>
                                            row.id === p.id
                                              ? {
                                                  ...row,
                                                  isKnocked: checked,
                                                  knocked: checked,
                                                  isAlive: checked ? true : row.isAlive,
                                                  alive: checked ? true : row.alive,
                                                }
                                              : row,
                                          ),
                                        );
                                        onDirty(team.teamId);
                                      }}
                                      className="h-4 w-4 accent-amber-500"
                                    />
                                    <FieldMeta
                                      descriptor={knockedDescriptor}
                                      disabledReason={knockDisabledReason}
                                    />
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/60">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-emerald-400" />
                          Alive {aliveCount}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-amber-400" />
                          Knocked {knockedCount}/{maxKnocked}
                        </span>
                        <span
                          title={teamKillsDescriptor.detail}
                          className="inline-flex items-center gap-1.5"
                        >
                          <span className="h-2 w-2 rounded-full bg-cyan-400" />
                          Team Kills {row.displayKills}
                          {team.manualTotalKills
                            ? ` · Override (players ${row.playerKillTotal})`
                            : " · Aggregate"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {teamEliminated ? (
                          <button
                            type="button"
                            onClick={() => reviveTeam(team.teamId)}
                            disabled={!allowRevive}
                            title={reviveDisabledReason ?? "Restore team to editable state"}
                            className="rounded border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-100 hover:border-emerald-300/50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Revive team
                          </button>
                        ) : null}
                        {teamHasOverrides ? (
                          <button
                            type="button"
                            onClick={() => void onReleaseTeamOverrides(team.teamId, row.teamName)}
                            disabled={Boolean(teamReleaseDisabledReason) || releaseActionBusy}
                            title={
                              teamReleaseBusy
                                ? "Releasing team overrides..."
                                : teamReleaseDisabledReason ??
                                  "Release manual ownership for this team and its players."
                            }
                            className="rounded border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold text-amber-100 hover:border-amber-300/50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {teamReleaseBusy ? "Releasing..." : "Release overrides"}
                          </button>
                        ) : null}
                        <button
                          onClick={() => onReset(team.teamId)}
                          title="Reset unsaved draft values back to persisted results"
                          className="rounded border border-white/20 px-3 py-1 text-[11px] font-semibold text-white hover:border-white/40 disabled:opacity-60"
                          disabled={!editable || saving === team.teamId}
                        >
                          Reset draft
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
                </div>
                {isSelected ? (
                  <div className="md:col-span-2 xl:col-span-3 2xl:col-span-4">
                    <ExpandedResultsTeamPanel
                      row={row}
                      isLastAliveTeam={isLastAliveTeam}
                      editable={editable}
                      resultsLocked={resultsLocked}
                      resultsLockMessage={resultsLockMessage}
                      dirty={dirty}
                      saving={saving}
                      status={status}
                      releaseActionBusy={releaseActionBusy}
                      overrideReleaseAllowed={overrideReleaseAllowed}
                      overrideReleaseReason={overrideReleaseReason}
                      overrideBusyKey={overrideBusyKey}
                      onClose={() => setExpandedTeamId(null)}
                      onDirty={onDirty}
                      onReset={onReset}
                      onReleaseTeamOverrides={onReleaseTeamOverrides}
                      onReviveTeam={reviveTeam}
                      updateTeamDraft={updateTeamDraft}
                    />
                  </div>
                ) : null}
              </React.Fragment>
            );
          })}
        </div>
        </>
      )}

      {placementModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-3xl rounded-2xl border border-white/15 bg-slate-900 text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-white/50">Placement Editor</div>
                <div className="text-lg font-semibold">Set Final Placements</div>
              </div>
              <button
                onClick={() => setPlacementModalOpen(false)}
                className="rounded border border-white/20 px-3 py-1 text-sm font-semibold hover:border-white/40"
              >
                Close
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-4 py-3 space-y-3">
              {placementError ? (
                <div className="rounded border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                  {placementError}
                </div>
              ) : null}

              <div className="space-y-2 text-xs text-white/60">
                Drag teams to reorder. First item becomes placement #1.
              </div>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={placementDraft} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {placementDraft.map((matchSlotId, idx) => (
                      <SortablePlacementRow
                        key={matchSlotId}
                        matchSlotId={matchSlotId}
                        idx={idx}
                        teamMap={teamMap}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>

            <div className="flex items-center justify-between border-t border-white/10 px-4 py-3">
              <div className="text-xs text-white/60">
                {resultsLocked
                  ? resultsLockMessage
                  : "Each team must be selected exactly once. Saving placements updates persisted results."}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPlacementModalOpen(false)}
                  className="rounded border border-white/20 px-3 py-1 text-sm font-semibold hover:border-white/40"
                  type="button"
                >
                  Cancel
                </button>
                <button
                  onClick={savePlacements}
                  disabled={placementSaving || resultsLocked}
                  className="rounded border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-sm font-semibold text-emerald-100 hover:border-emerald-300/50 disabled:opacity-60"
                  type="button"
                >
                  {placementSaving ? 'Saving...' : 'Save Placements'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ExpandedResultsTeamPanel({
  row,
  isLastAliveTeam,
  editable,
  resultsLocked,
  resultsLockMessage,
  dirty,
  saving,
  status,
  releaseActionBusy,
  overrideReleaseAllowed,
  overrideReleaseReason,
  overrideBusyKey,
  onClose,
  onDirty,
  onReset,
  onReleaseTeamOverrides,
  onReviveTeam,
  updateTeamDraft,
}: {
  row: ResultsDisplayRow;
  isLastAliveTeam: boolean;
  editable: boolean;
  resultsLocked: boolean;
  resultsLockMessage: string;
  dirty: Record<string, boolean>;
  saving: string | null;
  status: Record<string, SaveState>;
  releaseActionBusy: boolean;
  overrideReleaseAllowed: boolean;
  overrideReleaseReason: string | null;
  overrideBusyKey: string | null;
  onClose: () => void;
  onDirty: (teamId: string) => void;
  onReset: (teamId: string) => void;
  onReleaseTeamOverrides: (teamId: string, teamName: string) => Promise<void>;
  onReviveTeam: (teamId: string) => void;
  updateTeamDraft: (teamId: string, updater: (rows: PlayerResultRow[]) => PlayerResultRow[]) => void;
}) {
  const team = row.team;
  const players = row.players;
  const aliveCount = row.aliveCount;
  const knockedCount = row.knockedCount;
  const maxKnocked = Math.max(aliveCount - 1, 0);
  const knockLimitReached = knockedCount >= maxKnocked;
  const waitingForTelemetry = row.waitingForTelemetry;
  const teamEliminated = row.teamEliminated;
  const teamLocked = row.teamLocked;
  const teamMissing = team.presenceStatus === "NO_SHOW";
  const derivedStatus: SaveState =
    resultsLocked
      ? "locked"
      : teamLocked && !editable
        ? "locked"
        : saving === team.teamId
          ? "saving"
          : status[team.teamId] ?? (dirty[team.teamId] ? "idle" : "saved");
  const detailStatusLabel =
    teamMissing
      ? "Missing"
      : waitingForTelemetry
        ? "Waiting"
        : derivedStatus === "locked"
          ? teamEliminated
            ? "Eliminated"
            : "Locked"
          : derivedStatus === "saving"
            ? "Saving"
            : derivedStatus === "error"
              ? "Error"
              : dirty[team.teamId]
                ? "Pending"
                : "Saved";
  const detailStatusTone =
    teamMissing
      ? "border-rose-400/30 bg-rose-500/10 text-rose-100"
      : waitingForTelemetry
        ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-100"
        : derivedStatus === "locked"
          ? "border-amber-400/30 bg-amber-500/10 text-amber-100"
          : derivedStatus === "saving"
            ? "border-amber-400/30 bg-amber-500/10 text-amber-100"
            : derivedStatus === "error"
              ? "border-red-400/30 bg-red-500/10 text-red-100"
              : "border-emerald-400/25 bg-emerald-500/10 text-emerald-100";
  const teamHasOverrides =
    isManualOwnership(team.ownership?.placement) ||
    isManualOwnership(team.ownership?.eliminated) ||
    isManualOwnership(team.ownership?.totalKills) ||
    players.some((player) => hasPlayerManualOverride(player));
  const teamReleaseBusy = overrideBusyKey === `team:${team.teamId}`;
  const teamReleaseDisabledReason =
    !teamHasOverrides
      ? "No manual overrides are active on this team."
      : !overrideReleaseAllowed
        ? overrideReleaseReason ?? "Override release is not available."
        : releaseActionBusy && !teamReleaseBusy
          ? "Another override release is currently in progress."
          : null;
  const reviveDisabledReason = !teamEliminated
    ? "Revive is only available after the team is eliminated."
    : !editable
      ? resultsLockMessage
      : null;
  const teamNotice = teamMissing
    ? "Missing team. Excluded from standings and widgets."
    : waitingForTelemetry
      ? "Waiting for telemetry. Player rows are not ready yet."
      : row.usingLiveSnapshot && players.length === 0
        ? "Live summary only. Detailed player rows have not arrived yet."
        : teamEliminated
          ? "Team eliminated. Revive to edit players."
          : null;
  const teamNoticeClass = teamMissing
    ? "border-rose-400/20 bg-rose-500/[0.06] text-rose-100/90"
    : waitingForTelemetry || (row.usingLiveSnapshot && players.length === 0)
      ? "border-cyan-400/20 bg-cyan-500/[0.06] text-cyan-100/90"
      : "border-amber-400/20 bg-amber-500/[0.06] text-amber-100/90";

  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-black p-5 shadow-lg shadow-black/30">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Image
            src={row.teamLogo}
            alt={row.teamName}
            width={48}
            height={48}
            className="h-12 w-12 shrink-0 rounded-xl border border-white/10 object-cover"
            unoptimized
          />
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.22em] text-white/40">Team Detail</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-semibold text-white">{row.teamName}</h3>
              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${detailStatusTone}`}>
                {detailStatusLabel}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-semibold text-white/75 transition hover:border-white/35 hover:text-white"
          >
            <ChevronUp className="h-3.5 w-3.5" />
            Collapse
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 font-semibold text-white/70">
          Slot {row.slotNumber ?? "—"}
        </span>
        <span className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 font-semibold text-white/70">
          P {team.placement ?? "—"}
        </span>
        <span className="rounded-full border border-cyan-400/20 bg-cyan-500/[0.08] px-2.5 py-1 font-semibold text-cyan-100">
          Kills {row.displayKills}
        </span>
        <span className="rounded-full border border-emerald-400/20 bg-emerald-500/[0.08] px-2.5 py-1 font-semibold text-emerald-100">
          Alive {aliveCount}/{row.totalPlayerCount || 0}
        </span>
        <span className="rounded-full border border-amber-400/20 bg-amber-500/[0.08] px-2.5 py-1 font-semibold text-amber-100">
          Knocked {knockedCount}/{row.totalPlayerCount || 0}
        </span>
        {teamHasOverrides ? (
          <span className="rounded-full border border-amber-400/25 bg-amber-500/[0.08] px-2.5 py-1 font-semibold text-amber-100">
            Overrides
          </span>
        ) : null}
        {row.usingLiveSnapshot ? (
          <span className="rounded-full border border-sky-400/25 bg-sky-500/[0.08] px-2.5 py-1 font-semibold text-sky-100">
            Live Fallback
          </span>
        ) : null}
        {isLastAliveTeam && (team.placement === 1 || team.placement === null) ? (
          <span className="rounded-full border border-emerald-400/25 bg-emerald-500/[0.08] px-2.5 py-1 font-semibold text-emerald-100">
            Winner
          </span>
        ) : null}
      </div>

      {teamNotice ? (
        <div className={`mt-4 rounded-xl border px-3.5 py-2.5 text-sm ${teamNoticeClass}`}>
          {teamNotice}
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
        {players.length === 0 ? (
          <div className="px-4 py-6 text-sm text-white/55">No player rows available.</div>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="border-b border-white/10 text-[10px] uppercase tracking-[0.18em] text-white/40">
              <tr>
                <th className="px-4 py-3 text-left">Player</th>
                <th className="px-4 py-3 text-left">Kills</th>
                <th className="px-4 py-3 text-left">Alive</th>
                <th className="px-4 py-3 text-left">Knocked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {players.map((player) => {
                const alive = (player.alive ?? player.isAlive ?? true) === true;
                const isLastAlive = alive && aliveCount === 1;
                const alreadyKnocked = (player.isKnocked ?? player.knocked ?? false) === true;
                const knockDisabled =
                  !editable ||
                  teamEliminated ||
                  isLastAliveTeam ||
                  !alive ||
                  isLastAlive ||
                  (knockLimitReached && !alreadyKnocked);
                const playerHasOverride = hasPlayerManualOverride(player);
                const killsDisabledReason = !editable ? resultsLockMessage : null;
                const aliveDisabledReason = !editable
                  ? resultsLockMessage
                  : teamEliminated
                    ? "Revive team before editing players."
                    : isLastAliveTeam
                      ? "Winner is locked."
                      : null;
                const knockDisabledReason = !editable
                  ? resultsLockMessage
                  : teamEliminated
                    ? "Revive team before editing players."
                    : !alive
                      ? "Only alive players can be knocked."
                      : isLastAlive
                        ? "Last alive player cannot be knocked."
                        : knockLimitReached && !alreadyKnocked
                          ? "Only one surviving player can remain clear."
                          : isLastAliveTeam
                            ? "Winner is locked."
                            : null;

                return (
                  <tr key={player.id} className="text-white/90">
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="font-medium text-white"
                          title={player.playerId ?? player.id ?? undefined}
                        >
                          {player.name ?? player.playerName ?? player.playerId ?? "Player"}
                        </span>
                        {playerHasOverride ? (
                          <span className="rounded-full border border-amber-400/25 bg-amber-500/[0.08] px-2 py-0.5 text-[10px] font-semibold text-amber-100">
                            Manual
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min={0}
                        title={killsDisabledReason ?? undefined}
                        className="w-20 rounded-lg border border-cyan-400/20 bg-black/60 px-3 py-2 font-semibold text-cyan-100 focus:border-cyan-300 focus:outline-none disabled:opacity-60"
                        value={player.kills ?? 0}
                        disabled={!editable}
                        onChange={(event) => {
                          const value = Math.max(0, Number(event.target.value) || 0);
                          updateTeamDraft(team.teamId, (rows) =>
                            rows.map((rowItem) =>
                              rowItem.id === player.id ? { ...rowItem, kills: value } : rowItem,
                            ),
                          );
                          onDirty(team.teamId);
                        }}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <label
                        title={aliveDisabledReason ?? undefined}
                        className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border ${
                          alive
                            ? "border-emerald-400/25 bg-emerald-500/[0.08]"
                            : "border-white/10 bg-white/[0.04]"
                        } ${!editable || teamEliminated || isLastAliveTeam ? "cursor-not-allowed" : "cursor-pointer"}`}
                      >
                        <input
                          type="checkbox"
                          checked={alive}
                          disabled={!editable || teamEliminated || isLastAliveTeam}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            updateTeamDraft(team.teamId, (rows) =>
                              rows.map((rowItem) =>
                                rowItem.id === player.id
                                  ? {
                                      ...rowItem,
                                      alive: checked,
                                      isAlive: checked,
                                      knocked: checked ? rowItem.knocked : false,
                                      isKnocked: checked ? rowItem.isKnocked : false,
                                    }
                                  : rowItem,
                              ),
                            );
                            onDirty(team.teamId);
                          }}
                          className="h-4 w-4 accent-emerald-500"
                        />
                      </label>
                    </td>
                    <td className="px-4 py-3">
                      <label
                        title={knockDisabledReason ?? undefined}
                        className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border ${
                          alreadyKnocked
                            ? "border-amber-400/25 bg-amber-500/[0.08]"
                            : "border-white/10 bg-white/[0.04]"
                        } ${knockDisabled ? "cursor-not-allowed" : "cursor-pointer"}`}
                      >
                        <input
                          type="checkbox"
                          checked={alreadyKnocked}
                          disabled={knockDisabled}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            updateTeamDraft(team.teamId, (rows) =>
                              rows.map((rowItem) =>
                                rowItem.id === player.id
                                  ? {
                                      ...rowItem,
                                      isKnocked: checked,
                                      knocked: checked,
                                      isAlive: checked ? true : rowItem.isAlive,
                                      alive: checked ? true : rowItem.alive,
                                    }
                                  : rowItem,
                              ),
                            );
                            onDirty(team.teamId);
                          }}
                          className="h-4 w-4 accent-amber-500"
                        />
                      </label>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-white/10 pt-4">
          {teamEliminated ? (
            <button
              type="button"
              onClick={() => onReviveTeam(team.teamId)}
              disabled={!editable}
              title={reviveDisabledReason ?? "Restore team"}
              className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-100 transition hover:border-emerald-300/50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Revive Team
            </button>
          ) : null}
          {teamHasOverrides ? (
            <button
              type="button"
              onClick={() => void onReleaseTeamOverrides(team.teamId, row.teamName)}
              disabled={Boolean(teamReleaseDisabledReason) || releaseActionBusy}
              title={
                teamReleaseBusy
                  ? "Releasing overrides..."
                  : teamReleaseDisabledReason ?? "Release overrides"
              }
              className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-100 transition hover:border-amber-300/50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {teamReleaseBusy ? "Releasing..." : "Release Overrides"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onReset(team.teamId)}
            title="Reset unsaved draft values"
            className="rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold text-white transition hover:border-white/40 disabled:opacity-60"
            disabled={!editable || saving === team.teamId}
          >
            Reset Draft
          </button>
      </div>
    </div>
  );
}

function MatchControlPanel({ matchId }: { matchId: string }) {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const liveSnapshotVersionRef = useRef(0);
  const resultsSnapshotVersionRef = useRef(0);
  const realtimeRefetchTimerRef = useRef<number | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("live");

  useEffect(() => {
    const tabParam = (searchParams?.get("tab") ?? "").toLowerCase();
    if (tabParam && tabs.some((t) => t.key === tabParam)) {
      setActiveTab(tabParam as TabKey);
    }
  }, [searchParams]);

  const handleTabChange = useCallback(
    (tab: TabKey) => {
      setActiveTab(tab);
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("tab", tab);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const {
    data: match,
    isLoading: matchLoading,
    error: matchError,
  } = useQuery<MatchDetail>({
    queryKey: ["match", matchId],
    queryFn: async () => {
      const res = await apiFetch(`/me/matches/${matchId}`, { cache: "no-store" });
      const json = await res.json();
      return (json?.data as MatchDetail) ?? (json as MatchDetail);
    },
    refetchInterval: 5000,
  });

  const cachedControl =
    queryClient.getQueryData<MatchControlPayload>(["match-control", matchId]) ?? null;
  const slotLobbyMode: LobbyMode =
    normalizeMatchSource(
      getControlSourceValue(cachedControl, match?.dataSource ?? match?.dataMode ?? null),
    ) === "MANUAL"
      ? "MANUAL"
      : "AUTO";
  const matchSourceBadge = normalizeMatchSource(
    getControlSourceValue(cachedControl, match?.dataSource ?? match?.dataMode ?? null),
  );

  const orgId = useMemo(() => {
    const actingOrg = (user as unknown as { actingOrgId?: string | null })?.actingOrgId ?? null;
    return user?.organizationId ?? actingOrg ?? match?.tournament?.organizationId ?? null;
  }, [match?.tournament?.organizationId, user]);

  const slotsQuery = useQuery<SlotRow[]>({
    queryKey: ["slots", matchId],
    queryFn: async () => {
      const res = await apiFetch(`/me/matches/${matchId}/slots`, { cache: "no-store" });
      const json = await res.json();
      return Array.isArray(json) ? json : (json?.data as SlotRow[]) ?? [];
    },
    refetchInterval: slotLobbyMode === "AUTO" ? 5000 : false,
  });

  const teamsQuery = useQuery<MatchTeamRow[]>({
    queryKey: ["teams", matchId],
    queryFn: async () => {
      const res = await apiFetch(`/me/matches/${matchId}/teams`, { cache: "no-store" });
      const json = await res.json();
      if (Array.isArray(json)) return json as MatchTeamRow[];
      if (Array.isArray(json?.data)) return json.data as MatchTeamRow[];
      if (Array.isArray(json?.teams)) return json.teams as MatchTeamRow[];
      return [];
    },
  });

  const filteredTeams = useMemo(() => {
    const groupId = (match as { groupId?: string | null } | null)?.groupId ?? null;
    const list = teamsQuery.data ?? [];
    if (!groupId) return list;
    return list.filter((t) => {
      const gid = t.groupId ?? t.group?.id ?? null;
      // If team has no group info, allow it (avoids hiding data when backend doesn't send groupId).
      if (!gid) return true;
      return gid === groupId;
    });
  }, [match, teamsQuery.data]);

  const resultsQuery = useQuery<ResultsResponse>({
    queryKey: ["results", matchId],
    queryFn: async () => {
      const res = await apiFetch(`/me/matches/${matchId}/results`, { cache: "no-store" });
      const json = await res.json();
      const data = Array.isArray(json)
        ? (json as ResultRow[])
        : (json?.data as ResultRow[]) ?? (json?.results as ResultRow[]) ?? [];
      const lockedFlag = Boolean(json?.matchLocked ?? json?.locked ?? json?.resultsLocked);
      const payload: ResultsResponse = {
        results: data,
        data,
        locked: lockedFlag,
        matchLocked: lockedFlag,
        lockedAt: (json?.lockedAt as string | null | undefined) ?? null,
        lockedBy: (json?.lockedBy as string | null | undefined) ?? null,
        lockReason: (json?.lockReason as string | null | undefined) ?? null,
        lockState: (json?.lockState as string | null | undefined) ?? null,
        aliveTeamsCount:
          (json?.aliveTeamsCount as number | null | undefined) ??
          (Array.isArray(data)
            ? data.filter((t) => !(t.eliminated ?? t.eliminatedAt)).length
            : null),
        totalTeamsCount: (json?.totalTeamsCount as number | null | undefined) ?? data.length,
        sourceMode: (json?.sourceMode as string | null | undefined) ?? null,
        lifecycleStatus: (json?.lifecycleStatus as string | null | undefined) ?? null,
        slotLocked: Boolean(json?.slotLocked ?? false),
        liveMirrorVersion: (json?.liveMirrorVersion as number | null | undefined) ?? null,
        liveSyncVersion: (json?.liveSyncVersion as number | null | undefined) ?? null,
        overrideAudit: Array.isArray(json?.overrideAudit)
          ? (json.overrideAudit as LiveSyncAuditEntry[])
          : [],
        overrideReleaseAllowed: Boolean(json?.overrideReleaseAllowed ?? false),
        overrideReleaseReason:
          (json?.overrideReleaseReason as string | null | undefined) ?? null,
      };
      const payloadVersion = resolveResultsVersion(payload);
      if (
        payloadVersion !== null &&
        payloadVersion < resultsSnapshotVersionRef.current
      ) {
        return (
          queryClient.getQueryData<ResultsResponse>(["results", matchId]) ?? payload
        );
      }
      return payload;
    },
  });

  const controlQuery = useQuery<MatchControlPayload>({
    queryKey: ["match-control", matchId],
    queryFn: async () => {
      const res = await apiFetch(`/me/matches/${matchId}/control`, {
        cache: "no-store",
      });
      const payload = (await res.json()) as MatchControlPayload;
      const payloadVersion =
        typeof payload?.version === "number" ? payload.version : null;
      if (
        payloadVersion !== null &&
        payloadVersion < liveSnapshotVersionRef.current
      ) {
        return (
          queryClient.getQueryData<MatchControlPayload>(["match-control", matchId]) ??
          payload
        );
      }
      return payload;
    },
    refetchInterval: activeTab === "live" ? 3000 : 5000,
  });

  useEffect(() => {
    const version = controlQuery.data?.version;
    if (typeof version === "number" && version > liveSnapshotVersionRef.current) {
      liveSnapshotVersionRef.current = version;
    }
  }, [controlQuery.data?.version]);

  useEffect(() => {
    const version = resolveResultsVersion(resultsQuery.data ?? null);
    if (typeof version === "number" && version > resultsSnapshotVersionRef.current) {
      resultsSnapshotVersionRef.current = version;
    }
  }, [resultsQuery.data]);

  const liveStateQuery = useMemo(
    () => ({
      data: controlQuery.data ?? null,
      isLoading: controlQuery.isLoading,
      error: controlQuery.error,
      refetch: controlQuery.refetch,
    }),
    [controlQuery.data, controlQuery.error, controlQuery.isLoading, controlQuery.refetch],
  );

  const controlStateQuery = useMemo(
    () => ({
      data: controlQuery.data
        ? ({
            matchId: controlQuery.data.matchId,
            state: controlQuery.data.controlStatus ?? controlQuery.data.status ?? null,
            updatedAt: controlQuery.data.updatedAt ?? null,
            updatedByUserId: null,
            reason: null,
            meta: null,
            lifecycleStatus: controlQuery.data.lifecycleStatus ?? null,
            locks: controlQuery.data.locks,
          } as ControlState)
        : null,
      isLoading: controlQuery.isLoading,
      error: controlQuery.error,
      refetch: controlQuery.refetch,
    }),
    [controlQuery.data, controlQuery.error, controlQuery.isLoading, controlQuery.refetch],
  );

  const controlLockQuery = useMemo(
    () => ({
      data: controlQuery.data
        ? {
            ok: true,
            control: {
              lifecycleStatus: controlQuery.data.lifecycleStatus ?? null,
              resultsLocked: controlQuery.data.locks?.resultsLocked ?? false,
              slotLocked: controlQuery.data.locks?.slotLocked ?? false,
              lifecycleLocked: controlQuery.data.locks?.lifecycleLocked ?? false,
              lockState:
                controlQuery.data.locks?.resultLockState ??
                ((controlQuery.data.locks?.resultsLocked ?? false) ? "LOCKED" : "UNLOCKED"),
              lockReason: controlQuery.data.locks?.reason ?? null,
              manualLock: false,
              forceUnlock: false,
              status: controlQuery.data.matchStatus ?? null,
              liveState: controlQuery.data.liveState ?? null,
              locks: controlQuery.data.locks,
            },
          }
        : null,
      refetch: controlQuery.refetch,
    }),
    [controlQuery.data, controlQuery.refetch],
  );

  useEffect(() => {
    const socket = io(realtimeSocketUrl(), {
      transports: ["websocket"],
      query: { matchId },
      forceNew: true,
      autoConnect: false,
    });

    const handleRealtimeState = (payload: unknown) => {
      if (!isLiveControlSnapshot(payload) || payload.matchId !== matchId) {
        return;
      }

      const payloadVersion =
        typeof payload.version === "number" ? payload.version : null;
      if (
        payloadVersion !== null &&
        payloadVersion <= liveSnapshotVersionRef.current
      ) {
        return;
      }

      if (payloadVersion !== null) {
        liveSnapshotVersionRef.current = payloadVersion;
      }

      if (realtimeRefetchTimerRef.current !== null) {
        return;
      }

      realtimeRefetchTimerRef.current = window.setTimeout(() => {
        realtimeRefetchTimerRef.current = null;
        void queryClient.refetchQueries({
          queryKey: ["match-control", matchId],
          exact: true,
        });
        void queryClient.refetchQueries({
          queryKey: ["results", matchId],
          exact: true,
        });
      }, 500);
    };

    socket.on("match_state_updated", handleRealtimeState);
    const connectTimer = window.setTimeout(() => {
      socket.connect();
    }, 0);

    return () => {
      window.clearTimeout(connectTimer);
      if (realtimeRefetchTimerRef.current !== null) {
        window.clearTimeout(realtimeRefetchTimerRef.current);
        realtimeRefetchTimerRef.current = null;
      }
      socket.off("match_state_updated", handleRealtimeState);
      if (socket.connected) {
        socket.disconnect();
      }
    };
  }, [matchId, queryClient]);

  const [slotBusy, setSlotBusy] = useState<number | null>(null);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [slotNotice, setSlotNotice] = useState<string | null>(null);
  const [slotSyncing, setSlotSyncing] = useState(false);
  const [slotSyncConfirmOpen, setSlotSyncConfirmOpen] = useState(false);

  const [controlError, setControlError] = useState<string | null>(null);
  const [controlBusy, setControlBusy] = useState<MatchLifecycleAction | null>(null);

  const [resultsDraft, setResultsDraft] = useState<Record<string, PlayerResultRow[]>>({});
  const [resultsDirty, setResultsDirty] = useState<Record<string, boolean>>({});
  const [resultsBlocked, setResultsBlocked] = useState<Record<string, boolean>>({});
  const [resultsSaving, setResultsSaving] = useState<string | null>(null);
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [resultsStatus, setResultsStatus] = useState<Record<string, SaveState>>({});
  const [resultsLock, setResultsLock] = useState<{
    locked: boolean;
    reason: string | null;
    lockedAt: string | null;
    lockedBy: string | null;
  }>({
    locked: false,
    reason: null,
    lockedAt: null,
    lockedBy: null,
  });
  const [resultsEditBusy, setResultsEditBusy] = useState<"unlock" | "lock" | null>(null);
  const [resultsEditNotice, setResultsEditNotice] = useState<string | null>(null);
  const [overrideBusyKey, setOverrideBusyKey] = useState<string | null>(null);
  const [overrideNotice, setOverrideNotice] = useState<string | null>(null);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const [widgetState, setWidgetState] = useState<Record<string, WidgetInstanceInfo>>({});
  const [widgetBusy, setWidgetBusy] = useState<string | null>(null);
  const [widgetError, setWidgetError] = useState<string | null>(null);

  const canonicalControl = controlQuery.data ?? null;
  const canonicalLifecycleStatus = (
    canonicalControl?.lifecycleStatus ??
    "READY"
  ).toUpperCase();
  const canonicalResultFinalized = canonicalControl?.resultFinalized === true;
  const canonicalResultNeedsConfirmation =
    canonicalControl?.resultNeedsConfirmation === true;
  const canonicalResultAmbiguities =
    canonicalControl?.resultAmbiguities?.filter(Boolean) ?? [];
  const canonicalIsFinalizing =
    canonicalControl?.isFinalizing === true ||
    (canonicalLifecycleStatus === "ENDED" && !canonicalResultFinalized);
  const canonicalResultsLocked = canonicalControl?.locks?.resultsLocked ?? false;
  const canonicalResultsLockReason =
    canonicalControl?.locks?.reason ??
    (canonicalResultsLocked ? "Results are locked." : null);
  const canonicalSlotLocked = canonicalControl?.locks?.slotLocked ?? false;
  const canonicalLifecycleLocked =
    canonicalControl?.locks?.lifecycleLocked ?? false;
  const canonicalSourceValue = getControlSourceValue(
    canonicalControl,
    match?.dataSource ?? match?.dataMode ?? null,
  );
  const canonicalSourceMode = normalizeMatchSource(canonicalSourceValue);
  const resultRowsForPanels = resultsQuery.data?.results ?? resultsQuery.data?.data ?? [];
  const canonicalLiveState =
    canonicalLifecycleStatus === "LIVE" ? canonicalControl : null;
  const livePanelResultRows =
    canonicalLifecycleStatus === "LIVE" && canonicalSourceMode !== "MANUAL"
      ? []
      : resultRowsForPanels;
  const canonicalLocks = useMemo<MatchLifecycleLocks>(
    () => ({
      lifecycleLocked: canonicalLifecycleLocked,
      resultsLocked: canonicalResultsLocked,
      slotLocked: canonicalSlotLocked,
      reason: canonicalResultsLockReason,
    }),
    [
      canonicalLifecycleLocked,
      canonicalResultsLockReason,
      canonicalResultsLocked,
      canonicalSlotLocked,
    ],
  );

  useEffect(() => {
    // Avoid clobbering unsaved local edits while autosave is pending.
    if (Object.values(resultsDirty).some(Boolean)) return;

    const rows = resultsQuery.data?.results ?? resultsQuery.data?.data ?? [];
    if (!rows) return;
    const lockedNow = canonicalResultsLocked;
    const next: Record<string, PlayerResultRow[]> = {};
    rows.forEach((team) => {
      next[team.teamId] =
        normalizePlayerRows(
          team.players?.map((p) => ({
            ...p,
            kills: p.kills ?? 0,
            alive: p.alive ?? p.isAlive ?? null,
            isAlive: p.alive ?? p.isAlive ?? null,
            isKnocked: p.isKnocked ?? p.knocked ?? null,
            knocked: p.isKnocked ?? p.knocked ?? null,
          })) ?? [],
        ) ?? [];
    });

    setResultsDraft((prev) => {
      // shallow compare to avoid needless state updates
      const keys = Object.keys(next);
      if (
        keys.length === Object.keys(prev).length &&
        keys.every((k) => prev[k] === next[k])
      ) {
        return prev;
      }
      return next;
    });

    if (Object.keys(resultsDirty).length) {
      setResultsDirty({});
    }
    setResultsBlocked({});
    setResultsStatus((prev) => {
      const nextStatus: Record<string, SaveState> = { ...prev };
      rows.forEach((team) => {
        nextStatus[team.teamId] =
          lockedNow || Boolean(team.teamLocked ?? team.isLocked) ? "locked" : "saved";
      });
      return nextStatus;
    });
  }, [
    canonicalResultsLocked,
    resultsDirty,
    resultsQuery.data,
  ]);

  useEffect(() => {
    setResultsLock((prev) => ({
      locked: canonicalResultsLocked,
      reason: canonicalResultsLockReason,
      lockedAt:
        canonicalResultsLocked
          ? prev.lockedAt ??
            resultsQuery.data?.lockedAt ??
            new Date().toISOString()
          : null,
      lockedBy:
        canonicalResultsLocked ? prev.lockedBy ?? resultsQuery.data?.lockedBy ?? null : null,
    }));
    setResultsStatus((prev) => {
      const next = { ...prev };
      Object.keys(resultsDraft).forEach((teamId) => {
        next[teamId] = canonicalResultsLocked ? "locked" : "saved";
      });
      return next;
    });
  }, [
    canonicalResultsLocked,
    canonicalResultsLockReason,
    resultsQuery.data?.lockedAt,
    resultsQuery.data?.lockedBy,
    resultsDraft,
  ]);

  useEffect(() => {
    if (!slotNotice) return;
    const timer = window.setTimeout(() => {
      setSlotNotice(null);
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [slotNotice]);

  useEffect(() => {
    if (!overrideNotice) return;
    const timer = window.setTimeout(() => {
      setOverrideNotice(null);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [overrideNotice]);

  useEffect(() => {
    if (!resultsEditNotice) return;
    const timer = window.setTimeout(() => {
      setResultsEditNotice(null);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [resultsEditNotice]);

  const maxSlotNumber = useMemo(() => {
    const existing = Math.max(...((slotsQuery.data ?? []).map((s) => s.slotNumber)), 0);
    const declared = match?.slotCount ?? 0;
    return Math.max(existing, declared, 0) || 16;
  }, [match?.slotCount, slotsQuery.data]);

  const markTeamDirty = useCallback((teamId: string) => {
    setResultsDirty((prev) => ({ ...prev, [teamId]: true }));
    setResultsStatus((prev) => ({ ...prev, [teamId]: "idle" }));
    setResultsBlocked((prev) => {
      if (!prev[teamId]) return prev;
      const next = { ...prev };
      delete next[teamId];
      return next;
    });
  }, []);

  const markTeamClean = useCallback(
    (teamId: string) => {
      setResultsDirty((prev) => {
        if (!prev[teamId]) return prev;
        const next = { ...prev };
        delete next[teamId];
        return next;
      });
      setResultsBlocked((prev) => {
        if (!prev[teamId]) return prev;
        const next = { ...prev };
        delete next[teamId];
        return next;
      });
      setResultsStatus((prev) => ({ ...prev, [teamId]: resultsLock.locked ? "locked" : "saved" }));
    },
    [resultsLock.locked],
  );

  const slotsLocked = canonicalSlotLocked;
  const slotLockMessage =
    controlLockQuery.data?.control?.locks?.reason ??
    controlLockQuery.data?.control?.lockReason ??
    (slotsLocked
      ? `Slots are locked while the match lifecycle is ${canonicalLifecycleStatus}.`
      : null) ??
    "Slots are locked for the current match lifecycle state.";

  const handleAssignSlot = async (slotNumber: number, teamId: string) => {
    if (slotsLocked) {
      setSlotError(slotLockMessage);
      return;
    }
    if (!teamId) {
      setSlotError("Select a team to assign");
      return;
    }
    setSlotBusy(slotNumber);
    setSlotError(null);
    setSlotNotice(null);
    try {
      await apiFetch(`/me/matches/${matchId}/slots`, {
        method: "POST",
        body: JSON.stringify({ slotNumber, teamId }),
      });
      await Promise.all([
        slotsQuery.refetch(),
        teamsQuery.refetch(),
        resultsQuery.refetch(),
        controlQuery.refetch(),
      ]);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to assign slot";
      setSlotError(msg);
    } finally {
      setSlotBusy(null);
    }
  };

  const handleDropTeamToSlot = useCallback(
    async ({
      teamId,
      sourceSlotNumber,
      targetSlotNumber,
      targetTeamId,
    }: {
      teamId: string;
      sourceSlotNumber: number | null;
      targetSlotNumber: number;
      targetTeamId: string | null;
    }) => {
      if (slotsLocked) {
        setSlotError(slotLockMessage);
        return;
      }
      if (!teamId) return;
      if (sourceSlotNumber === targetSlotNumber) return;

      setSlotBusy(targetSlotNumber);
      setSlotError(null);
      setSlotNotice(null);
      try {
        await apiFetch(`/me/matches/${matchId}/slots`, {
          method: "POST",
          body: JSON.stringify({ slotNumber: targetSlotNumber, teamId }),
        });

        if (
          sourceSlotNumber !== null &&
          targetTeamId &&
          targetTeamId !== teamId
        ) {
          await apiFetch(`/me/matches/${matchId}/slots`, {
            method: "POST",
            body: JSON.stringify({
              slotNumber: sourceSlotNumber,
              teamId: targetTeamId,
            }),
          });
        }

        await Promise.all([
          slotsQuery.refetch(),
          teamsQuery.refetch(),
          resultsQuery.refetch(),
          controlQuery.refetch(),
        ]);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : "Failed to reassign slot";
        setSlotError(msg);
      } finally {
        setSlotBusy(null);
      }
    },
    [controlQuery, matchId, resultsQuery, slotLockMessage, slotsLocked, slotsQuery, teamsQuery],
  );

  const handleClearSlot = async (slotNumber: number) => {
    if (slotsLocked) {
      setSlotError(slotLockMessage);
      return;
    }
    setSlotBusy(slotNumber);
    setSlotError(null);
    setSlotNotice(null);
    try {
      await apiFetch(`/me/matches/${matchId}/slots/${slotNumber}/team`, { method: "DELETE" });
      await Promise.all([
        slotsQuery.refetch(),
        teamsQuery.refetch(),
        resultsQuery.refetch(),
        controlQuery.refetch(),
      ]);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to clear slot";
      setSlotError(msg);
    } finally {
      setSlotBusy(null);
    }
  };

  const handleSetSlotLobbyStatus = async (
    slotNumber: number,
    lobbyStatus: SlotLobbyStatus,
  ) => {
    if (slotsLocked) {
      setSlotError(slotLockMessage);
      return;
    }
    setSlotBusy(slotNumber);
    setSlotError(null);
    setSlotNotice(null);
    try {
      await apiFetch(`/me/matches/${matchId}/slots/${slotNumber}/lobby`, {
        method: "PATCH",
        body: JSON.stringify({ lobbyStatus }),
      });
      await slotsQuery.refetch();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to update lobby status";
      setSlotError(msg);
    } finally {
      setSlotBusy(null);
    }
  };

  const syncFromPreviousMatch = useCallback(
    async (overwrite: boolean) => {
      setSlotSyncing(true);
      setSlotError(null);
      setSlotNotice(null);
      try {
        const res = await apiFetch(`/me/matches/${matchId}/slots/sync-previous`, {
          method: "POST",
          body: JSON.stringify({ overwrite }),
        });
        const json = (await res.json().catch(() => ({}))) as { message?: string };
        await Promise.all([
          slotsQuery.refetch(),
          teamsQuery.refetch(),
          resultsQuery.refetch(),
          controlQuery.refetch(),
        ]);
        setSlotNotice(json.message ?? "Teams synced from previous match.");
        return true;
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : "Failed to sync teams from previous match";
        setSlotError(msg);
        return false;
      } finally {
        setSlotSyncing(false);
      }
    },
    [controlQuery, matchId, resultsQuery, slotsQuery, teamsQuery],
  );

  const handleSyncFromPreviousMatch = useCallback(async () => {
    if (slotsLocked) {
      setSlotError(slotLockMessage);
      return;
    }

    const hasAssignedTeams = (slotsQuery.data ?? []).some((slot) => Boolean(slot.teamId));
    if (hasAssignedTeams) {
      setSlotSyncConfirmOpen(true);
      return;
    }

    await syncFromPreviousMatch(hasAssignedTeams);
  }, [slotLockMessage, slotsLocked, slotsQuery.data, syncFromPreviousMatch]);

  const handleConfirmSyncFromPreviousMatch = useCallback(async () => {
    const synced = await syncFromPreviousMatch(true);
    if (synced) {
      setSlotSyncConfirmOpen(false);
    }
  }, [syncFromPreviousMatch]);

  const handleCancelSyncFromPreviousMatch = useCallback(() => {
    if (slotSyncing) return;
    setSlotSyncConfirmOpen(false);
  }, [slotSyncing]);

  const handleControlAction = useCallback(
    async (action: MatchLifecycleAction) => {
      let endpoint = `/me/matches/${matchId}/control/status`;
      let requestBody: string | undefined;
      let failureMessage = "Unable to update match lifecycle";

      if (action === "start") {
        endpoint = `/me/matches/${matchId}/control/start`;
        failureMessage = "Unable to start match";
      } else if (action === "ENDED") {
        endpoint = `/me/matches/${matchId}/control/end`;
        failureMessage = "Unable to end match";
      } else {
        requestBody = JSON.stringify({ status: action });
        failureMessage =
          action === "COUNTDOWN"
            ? "Unable to start countdown"
            : action === "LIVE"
              ? "Unable to set match live"
              : action === "PAUSED"
                ? "Unable to pause match"
                : action === "CONFIRMED"
                  ? "Unable to confirm match"
                  : "Unable to reset match";
      }

      setControlBusy(action);
      setControlError(null);
      try {
        await apiFetch(endpoint, {
          method: "POST",
          ...(requestBody ? { body: requestBody } : {}),
        });

        const refreshes: Array<Promise<unknown>> = [
          queryClient.refetchQueries({ queryKey: ["match", matchId], exact: true }),
          controlQuery.refetch(),
          resultsQuery.refetch(),
        ];
        await Promise.all(refreshes);

      } catch (err) {
        const msg = err instanceof ApiError ? err.message : failureMessage;
        setControlError(msg);
      } finally {
        setControlBusy(null);
      }
    },
    [
      controlQuery,
      matchId,
      queryClient,
      resultsQuery,
    ],
  );

  const handleResultsSave = useCallback(
    async (teamId: string) => {
      const players = resultsDraft[teamId] ?? [];
      const teamSnapshot =
        resultsQuery.data?.results?.find((t) => t.teamId === teamId) ??
        resultsQuery.data?.data?.find((t) => t.teamId === teamId);
      const persistedPlayers = normalizeResultPlayers(teamSnapshot?.players);
      const payloadPlayers = players.map((player) => toTeamPlayerSavePayload(player));

      const matchLockedNow = canonicalResultsLocked;

      if (matchLockedNow) {
        setResultsStatus((prev) => ({ ...prev, [teamId]: "locked" }));
        setResultsDirty((prev) => {
          const next = { ...prev };
          delete next[teamId];
          return next;
        });
        return;
      }

      if (payloadPlayers.length === 0 || hasSamePersistedPlayerState(players, persistedPlayers)) {
        markTeamClean(teamId);
        setResultsStatus((prev) => ({ ...prev, [teamId]: "saved" }));
        setResultsBlocked((prev) => {
          const next = { ...prev };
          delete next[teamId];
          return next;
        });
        return;
      }

      setResultsSaving(teamId);
      setResultsStatus((prev) => ({ ...prev, [teamId]: "saving" }));
      setResultsError(null);
      try {
        await apiFetch(`/me/matches/${matchId}/results/team/${teamId}/players`, {
          method: "PATCH",
          body: JSON.stringify({ players: payloadPlayers }),
        });
        await Promise.all([
          resultsQuery.refetch(),
          queryClient.invalidateQueries({ queryKey: ["match", matchId] }),
          controlQuery.refetch(),
        ]);
        markTeamClean(teamId);
        setResultsStatus((prev) => ({ ...prev, [teamId]: "saved" }));
        setResultsBlocked((prev) => {
          const next = { ...prev };
          delete next[teamId];
          return next;
        });
      } catch (err) {
        let msg = err instanceof ApiError ? err.message : "Failed to save results";
        if (err instanceof ApiError) {
          if (err.status === 409) {
            let reason = msg;
            try {
              const parsed = JSON.parse(err.body ?? "{}");
              reason = parsed?.message ?? msg;
            } catch {
              /* ignore parse failure */
            }
            setResultsLock({
              locked: true,
              reason: reason ?? "Results are locked.",
              lockedAt: new Date().toISOString(),
              lockedBy: null,
            });
            setResultsStatus((prev) => ({ ...prev, [teamId]: "locked" }));
            setResultsDirty({});
            setResultsBlocked({});
            return;
          }
          try {
            const parsed = JSON.parse(err.body ?? "{}");
            msg = parsed?.message ?? msg;
          } catch {
            /* ignore parse failure */
          }
          if (process.env.NODE_ENV !== "production") {
            // Surface validation errors during development to help debugging payload mismatches.
            console.error("results save failed", {
              payload: payloadPlayers,
              error: err.body ?? err,
            });
          }
        }
        setResultsError(msg);
        setResultsStatus((prev) => ({ ...prev, [teamId]: "error" }));
        setResultsBlocked((prev) => ({ ...prev, [teamId]: true }));
      } finally {
        setResultsSaving(null);
      }
    },
    [
      canonicalResultsLocked,
      controlQuery,
      markTeamClean,
      matchId,
      queryClient,
      resultsDraft,
      resultsQuery,
    ],
  );

  const handleResultsReset = (teamId: string) => {
    const original =
      resultsQuery.data?.results?.find((t) => t.teamId === teamId) ??
      resultsQuery.data?.data?.find((t) => t.teamId === teamId);
    if (!original) return;
    setResultsDraft((prev) => ({
      ...prev,
      [teamId]:
        normalizePlayerRows(
          original.players?.map((p) => ({
            ...p,
            kills: p.kills ?? 0,
            alive: p.alive ?? p.isAlive ?? null,
            isAlive: p.alive ?? p.isAlive ?? null,
            isKnocked: p.isKnocked ?? p.knocked ?? null,
            knocked: p.isKnocked ?? p.knocked ?? null,
          })) ?? [],
        ) ?? [],
    }));
    markTeamClean(teamId);
  };

  const refreshAfterOverrideRelease = useCallback(
    async (version?: number | null) => {
      if (typeof version === "number" && version > liveSnapshotVersionRef.current) {
        liveSnapshotVersionRef.current = version;
      }
      if (
        typeof version === "number" &&
        version > resultsSnapshotVersionRef.current
      ) {
        resultsSnapshotVersionRef.current = version;
      }
      await Promise.all([
        resultsQuery.refetch(),
        controlQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["match", matchId] }),
      ]);
    },
    [
      controlQuery,
      matchId,
      queryClient,
      resultsQuery,
    ],
  );

  const handleReleaseMatchOverrides = useCallback(async () => {
    const releaseAllowed = resultsQuery.data?.overrideReleaseAllowed ?? false;
    const releaseReason =
      resultsQuery.data?.overrideReleaseReason ?? "Override release is not available.";
    const activeOverrideTeams =
      resultsQuery.data?.results?.filter((team) => hasTeamManualOverride(team)).length ?? 0;

    if (activeOverrideTeams === 0) {
      setOverrideError("No manual overrides are active.");
      return;
    }
    if (!releaseAllowed) {
      setOverrideError(releaseReason);
      return;
    }
    const confirmed = window.confirm(
      `Release all manual overrides for this match? Telemetry may take ownership again immediately where applicable.`,
    );
    if (!confirmed) return;

    setOverrideBusyKey("match");
    setOverrideError(null);
    setOverrideNotice(null);
    try {
      const res = await apiFetch(`/me/matches/${matchId}/results/overrides/release`, {
        method: "POST",
      });
      const json = (await res.json()) as OverrideReleaseResponse | { data?: OverrideReleaseResponse };
      const payload = (json as { data?: OverrideReleaseResponse })?.data ?? (json as OverrideReleaseResponse);
      await refreshAfterOverrideRelease(payload?.version ?? null);
      setOverrideNotice(
        payload?.released
          ? `Released ${payload.releasedPlayers ?? 0} player override${payload?.releasedPlayers === 1 ? "" : "s"} and ${payload.releasedTeams ?? 0} team override${payload?.releasedTeams === 1 ? "" : "s"} for this match.`
          : "No manual overrides were active for this match.",
      );
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to release match overrides";
      setOverrideError(msg);
    } finally {
      setOverrideBusyKey(null);
    }
  }, [matchId, refreshAfterOverrideRelease, resultsQuery.data]);

  const handleReleaseTeamOverrides = useCallback(
    async (teamId: string, teamName: string) => {
      const releaseAllowed = resultsQuery.data?.overrideReleaseAllowed ?? false;
      const releaseReason =
        resultsQuery.data?.overrideReleaseReason ?? "Override release is not available.";
      const team =
        resultsQuery.data?.results?.find((entry) => entry.teamId === teamId) ??
        resultsQuery.data?.data?.find((entry) => entry.teamId === teamId);

      if (!team || !hasTeamManualOverride(team)) {
        setOverrideError(`No manual overrides are active for ${teamName}.`);
        return;
      }
      if (!releaseAllowed) {
        setOverrideError(releaseReason);
        return;
      }
      const confirmed = window.confirm(
        `Release all manual overrides for ${teamName}? Telemetry may take ownership again immediately where applicable.`,
      );
      if (!confirmed) return;

      setOverrideBusyKey(`team:${teamId}`);
      setOverrideError(null);
      setOverrideNotice(null);
      try {
        const res = await apiFetch(
          `/me/matches/${matchId}/results/team/${teamId}/overrides/release`,
          {
            method: "POST",
          },
        );
        const json =
          (await res.json()) as OverrideReleaseResponse | { data?: OverrideReleaseResponse };
        const payload =
          (json as { data?: OverrideReleaseResponse })?.data ??
          (json as OverrideReleaseResponse);
        await refreshAfterOverrideRelease(payload?.version ?? null);
        setOverrideNotice(
          payload?.released
            ? `Released overrides for ${teamName}. ${payload.releasedPlayers ?? 0} player bundle${payload?.releasedPlayers === 1 ? "" : "s"} and ${payload.releasedTeams ?? 0} team bundle${payload?.releasedTeams === 1 ? "" : "s"} were cleared.`
            : `No manual overrides were active for ${teamName}.`,
        );
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : "Failed to release team overrides";
        setOverrideError(msg);
      } finally {
        setOverrideBusyKey(null);
      }
    },
    [matchId, refreshAfterOverrideRelease, resultsQuery.data],
  );

  const handleToggleResultsEditing = useCallback(
    async (enableEditing: boolean) => {
      if (!orgId) {
        setResultsError("Organization context is required to change result editing mode.");
        return;
      }

      setResultsEditBusy(enableEditing ? "unlock" : "lock");
      setResultsEditNotice(null);
      setResultsError(null);
      try {
        await apiFetch(`/org/${orgId}/matches/${matchId}/control/results-lock`, {
          method: "POST",
          body: JSON.stringify({ locked: !enableEditing }),
        });
        await Promise.all([
          controlQuery.refetch(),
          resultsQuery.refetch(),
          queryClient.invalidateQueries({ queryKey: ["match", matchId] }),
        ]);
        setResultsEditNotice(
          enableEditing
            ? "Results reopened for manual editing."
            : "Results locked again after manual review.",
        );
      } catch (err) {
        const msg =
          err instanceof ApiError ? err.message : "Failed to update result editing mode";
        setResultsError(msg);
      } finally {
        setResultsEditBusy(null);
      }
    },
    [controlQuery, matchId, orgId, queryClient, resultsQuery],
  );

  const handleEnableWidget = async (widgetType: string) => {
    if (!orgId) {
      setWidgetError("Organization required to enable widgets.");
      return;
    }
    setWidgetBusy(widgetType);
    setWidgetError(null);
    try {
      const res = await apiFetch("/api/widgets/instances", {
        method: "POST",
        body: JSON.stringify({
          widgetType,
          organizationId: orgId,
          tournamentId: match?.tournamentId ?? undefined,
          matchId,
        }),
      });
      const json = (await res.json()) as WidgetInstanceInfo;
      setWidgetState((prev) => ({ ...prev, [widgetType]: json }));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to enable widget";
      setWidgetError(msg);
    } finally {
      setWidgetBusy(null);
    }
  };

  const headline =
    matchLoading && !match
      ? "Loading match..."
      : matchError
        ? (matchError as Error).message
        : null;
  const headerMatchStatus = canonicalLifecycleStatus;
  const headerSourceBadge = normalizeMatchSource(canonicalSourceValue);
  const headerLifecycleActions = resolveMatchLifecycleActions({
    lifecycleStatus: headerMatchStatus,
    locks: canonicalLocks,
  });
  const canSyncFromPreviousMatch = (match?.matchNumber ?? 0) > 1;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/10 bg-gradient-to-br from-white/6 via-white/3 to-black/55 p-2.5 shadow-lg shadow-black/25 sm:p-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={`rounded-full border px-3 py-1.5 text-[13px] font-semibold transition ${
                  activeTab === tab.key
                    ? "border-cyan-400/60 bg-cyan-500/20 text-white shadow-lg shadow-cyan-500/20"
                    : "border-white/10 bg-white/5 text-white/70 hover:border-white/30 hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 xl:justify-end">
            {headerLifecycleActions.length > 0 ? (
              headerLifecycleActions.map((action) => (
                <button
                  key={action.action}
                  onClick={() => void handleControlAction(action.action)}
                  disabled={controlBusy === action.action || !orgId}
                  title={!orgId ? "Organization context is required." : undefined}
                  className={`inline-flex min-h-[42px] items-center justify-center gap-2 rounded-full border px-4 py-2 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${action.className}`}
                  type="button"
                >
                  {action.icon}
                  <span>{controlBusy === action.action ? action.busyLabel : action.label}</span>
                </button>
              ))
            ) : (
              <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[13px] text-white/55">
                No live actions
              </div>
            )}
          </div>
        </div>
      </div>

      {headline ? (
        <div className="rounded-lg border border-white/15 bg-white/5 px-4 py-3 text-sm text-white/70">
          {headline}
        </div>
      ) : null}

      {controlError ? (
        <div className="rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {controlError}
        </div>
      ) : null}

      {canonicalResultNeedsConfirmation ? (
        <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-50">
          <p className="font-semibold">Auto-finalized with ambiguous placements</p>
          <p className="mt-1 text-amber-100/80">
            Telemetry could not confidently order one or more elimination groups.
            Review the results before treating them as fully confirmed.
          </p>
          {canonicalResultAmbiguities.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-100/75">
              {canonicalResultAmbiguities.slice(0, 3).map((ambiguity, index) => (
                <li key={`${ambiguity.code ?? "ambiguity"}-${index}`}>
                  {ambiguity.message ??
                    `Placements ${ambiguity.placementFrom ?? "?"}-${ambiguity.placementTo ?? "?"} require review.`}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {activeTab === "slots" ? (
        <SlotsTab
          slots={slotsQuery.data ?? []}
          teams={filteredTeams}
          loading={slotsQuery.isLoading || teamsQuery.isLoading}
          maxSlotNumber={maxSlotNumber}
          slotBusy={slotBusy}
          error={slotError}
          onAssign={handleAssignSlot}
          onClear={handleClearSlot}
          onDropTeam={handleDropTeamToSlot}
          lobbyMode={slotLobbyMode}
          onSetLobbyStatus={handleSetSlotLobbyStatus}
          slotsLocked={slotsLocked}
          slotLockReason={slotLockMessage}
          slotNotice={slotNotice}
          canSyncFromPreviousMatch={canSyncFromPreviousMatch}
          onSyncFromPreviousMatch={handleSyncFromPreviousMatch}
          syncBusy={slotSyncing}
          syncConfirmOpen={slotSyncConfirmOpen}
          onCancelSyncConfirm={handleCancelSyncFromPreviousMatch}
          onConfirmSyncFromPreviousMatch={handleConfirmSyncFromPreviousMatch}
        />
      ) : null}

      {activeTab === "live" ? (
        <div className="space-y-4">
          <MatchOpsDeck
            matchId={matchId}
            matchName={match?.name ?? null}
            matchNumber={match?.matchNumber ?? null}
            mapName={match?.map ?? null}
            tournamentName={match?.tournament?.name ?? null}
            status={headerMatchStatus}
            matchEndedReason={match?.endedReason ?? null}
            sourceBadge={headerSourceBadge}
            liveState={canonicalLiveState}
            controlState={controlStateQuery.data ?? null}
            resultRows={livePanelResultRows}
            telemetry={canonicalControl?.telemetry ?? null}
            binding={canonicalControl?.binding ?? null}
            resultFinalized={canonicalResultFinalized}
            isFinalizing={canonicalIsFinalizing}
            liveSnapshotVersion={canonicalLiveState?.version ?? null}
          />

          <LiveControlTab
            matchId={matchId}
            matchStatus={headerMatchStatus}
            sourceMode={canonicalSourceValue ?? matchSourceBadge}
            liveState={canonicalLiveState}
            resultRows={livePanelResultRows}
            controlState={controlStateQuery.data ?? null}
            telemetry={canonicalControl?.telemetry ?? null}
            binding={canonicalControl?.binding ?? null}
            resultFinalized={canonicalResultFinalized}
            isFinalizing={canonicalIsFinalizing}
            loading={controlStateQuery.isLoading || liveStateQuery.isLoading}
            error={controlError ?? (controlStateQuery.error as Error | null)?.message ?? null}
          />
        </div>
      ) : null}

      {activeTab === "results" ? (
        <ResultsTab
          results={resultsQuery.data?.results ?? resultsQuery.data?.data ?? []}
          teams={filteredTeams ?? []}
          loading={resultsQuery.isLoading}
          draft={resultsDraft}
          setDraft={setResultsDraft}
          dirty={resultsDirty}
          blocked={resultsBlocked}
          onDirty={markTeamDirty}
          onReset={handleResultsReset}
          saving={resultsSaving}
          status={resultsStatus}
          error={resultsError}
          locked={resultsLock.locked}
          matchLocked={resultsLock.locked}
          lockReason={
            resultsLock.reason ?? canonicalResultsLockReason
          }
          onAutoSave={handleResultsSave}
          aliveTeams={resultsQuery.data?.aliveTeamsCount ?? null}
          totalTeams={resultsQuery.data?.totalTeamsCount ?? null}
          sourceMode={canonicalSourceValue ?? null}
          matchStatus={headerMatchStatus}
          matchId={matchId}
          liveTeams={canonicalLiveState?.teams ?? []}
          liveSnapshotVersion={
            canonicalLiveState?.version ??
            resultsQuery.data?.liveMirrorVersion ??
            resultsQuery.data?.liveSyncVersion ??
            null
          }
          overrideReleaseAllowed={resultsQuery.data?.overrideReleaseAllowed ?? false}
          overrideReleaseReason={resultsQuery.data?.overrideReleaseReason ?? null}
          overrideBusyKey={overrideBusyKey}
          overrideNotice={overrideNotice}
          overrideError={overrideError}
          resultsEditBusy={resultsEditBusy}
          resultsEditNotice={resultsEditNotice}
          resultFinalized={canonicalResultFinalized}
          orgReady={Boolean(orgId)}
          onToggleResultsEditing={handleToggleResultsEditing}
          onReleaseMatchOverrides={handleReleaseMatchOverrides}
          onReleaseTeamOverrides={handleReleaseTeamOverrides}
          onPlacementsSaved={async () => {
            await resultsQuery.refetch();
          }}
        />
      ) : null}

      {activeTab === "widgets" ? (
        <WidgetsTab
          widgets={widgetCatalog}
          instances={widgetState}
          onEnable={handleEnableWidget}
          busy={widgetBusy}
          error={widgetError}
          orgReady={Boolean(orgId)}
        />
      ) : null}
    </div>
  );
}

function LiveMetricCard({
  label,
  value,
  hint,
  icon,
  accent,
}: {
  label: string;
  value: string;
  hint?: string | null;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-3 shadow-sm shadow-black/15">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">{label}</p>
          <div className="mt-1.5 text-xl font-semibold leading-none text-white sm:text-[1.65rem]">
            {value}
          </div>
          {hint ? (
            <p className="mt-1.5 text-[11px] leading-5 text-white/55">{hint}</p>
          ) : null}
        </div>
        <div className={`rounded-lg border px-2.5 py-2 ${accent}`}>{icon}</div>
      </div>
    </div>
  );
}

function LiveControlTab({
  matchId,
  matchStatus,
  sourceMode,
  liveState,
  resultRows,
  controlState,
  telemetry,
  binding,
  resultFinalized,
  isFinalizing,
  loading,
  error,
}: {
  matchId: string;
  matchStatus: string | null;
  sourceMode: string | null;
  liveState: LiveControlSnapshot | null;
  resultRows: ResultRow[];
  controlState: ControlState | null;
  telemetry: RuntimeTelemetrySnapshot | null;
  binding: RuntimeBindingSnapshot | null;
  resultFinalized: boolean;
  isFinalizing: boolean;
  loading: boolean;
  error: string | null;
}) {
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [cameraSuggestions, setCameraSuggestions] = useState<CameraSuggestion[]>([]);
  const [selectedSuggestionKey, setSelectedSuggestionKey] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setCameraSuggestions([]);
    setSelectedSuggestionKey(null);

    const fetchInitialSuggestions = async () => {
      try {
        const res = await apiFetch(`/api/observer/match/${matchId}/camera-suggestions`, {
          cache: "no-store",
        });
        const json = (await res.json()) as CameraSuggestionResponse;
        const suggestions = Array.isArray(json?.suggestions)
          ? json.suggestions.filter(isCameraSuggestion)
          : [];
        if (cancelled) return;
        setCameraSuggestions(suggestions.slice(0, 6));
        setSelectedSuggestionKey(
          suggestions[0] ? cameraSuggestionKey(suggestions[0]) : null,
        );
      } catch {
        if (!cancelled) {
          setCameraSuggestions([]);
        }
      }
    };

    void fetchInitialSuggestions();

    const { socket, created } = acquireCameraSuggestionSocket(matchId);
    const handleCameraSuggest = (incoming: unknown) => {
      if (!isCameraSuggestion(incoming) || incoming.matchId !== matchId || cancelled) {
        return;
      }

      setCameraSuggestions((current) => mergeCameraSuggestions(current, incoming));
      setSelectedSuggestionKey((current) => current ?? cameraSuggestionKey(incoming));
    };

    socket.on("camera:suggest", handleCameraSuggest);
    if (created) {
      socket.connect();
    }

    return () => {
      cancelled = true;
      socket.off("camera:suggest", handleCameraSuggest);
      releaseCameraSuggestionSocket(matchId);
    };
  }, [matchId]);

  const currentState = (matchStatus ?? "READY").toUpperCase();
  const normalizedSource = normalizeMatchSource(liveState?.sourceMode ?? sourceMode ?? null);
  const telemetrySourceLabel = getTelemetrySourceLabel(normalizedSource);
  const runtimeTelemetryState = formatRuntimeTelemetryState(telemetry, {
    resultFinalized,
    isFinalizing,
  });
  const runtimeBindingState = formatBindingState(binding);
  const liveTeams = useMemo(() => liveState?.teams ?? [], [liveState?.teams]);
  const matchTimer = formatMatchTimer(liveState?.startedAt ?? null, liveState?.endedAt ?? null, nowTs);
  const updatedLabel = formatDate(liveState?.updatedAt ?? controlState?.updatedAt ?? null);
  const selectedSuggestion = useMemo(() => {
    if (cameraSuggestions.length === 0) return null;
    return (
      cameraSuggestions.find((suggestion) => {
        return cameraSuggestionKey(suggestion) === selectedSuggestionKey;
      }) ?? cameraSuggestions[0]
    );
  }, [cameraSuggestions, selectedSuggestionKey]);
  const selectedSuggestionDetails = useMemo(() => {
    if (!selectedSuggestion) return null;

    const liveTeam =
      liveTeams.find((team) => team.teamId === selectedSuggestion.teamId) ?? null;
    const livePlayer =
      liveTeam?.players?.find((player) => {
        return (
          player.id === selectedSuggestion.playerId ||
          player.playerId === selectedSuggestion.playerId ||
          player.externalPlayerId === selectedSuggestion.playerId ||
          player.pubgPlayerId === selectedSuggestion.playerId
        );
      }) ?? null;
    const resultPlayer =
      resultRows
        .find((row) => row.teamId === selectedSuggestion.teamId)
        ?.players.find((player) => {
          return (
            player.id === selectedSuggestion.playerId ||
            player.playerId === selectedSuggestion.playerId
          );
        }) ?? null;

    return {
      teamLabel:
        liveTeam?.name ??
        liveTeam?.tag ??
        selectedSuggestion.teamId ??
        "Unknown team",
      playerLabel:
        livePlayer?.name ??
        livePlayer?.ign ??
        resultPlayer?.name ??
        resultPlayer?.playerName ??
        selectedSuggestion.playerId ??
        "Auto POV",
    };
  }, [liveTeams, resultRows, selectedSuggestion]);

  useEffect(() => {
    if (cameraSuggestions.length === 0) {
      if (selectedSuggestionKey !== null) {
        setSelectedSuggestionKey(null);
      }
      return;
    }

    if (
      !selectedSuggestionKey ||
      !cameraSuggestions.some(
        (suggestion) => cameraSuggestionKey(suggestion) === selectedSuggestionKey,
      )
    ) {
      setSelectedSuggestionKey(cameraSuggestionKey(cameraSuggestions[0]));
    }
  }, [cameraSuggestions, selectedSuggestionKey]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
      <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-black p-4 sm:p-5 shadow-lg shadow-black/30 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-white/45">Live Ops</p>
            <h2 className="text-2xl font-bold text-white">Control State</h2>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className={`rounded-full border px-3 py-1 ${badgeTone(currentState)}`}>
                {currentState}
              </span>
              <span className={`rounded-full border px-3 py-1 ${sourceBadgeTone(normalizedSource)}`}>
                {telemetrySourceLabel}
              </span>
            </div>
          </div>
          <div className="text-right text-xs text-white/55">
            <div>Updated</div>
            <div className="mt-1 text-sm text-white/80">{updatedLabel}</div>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        {resultFinalized ? (
          <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
            Results finalized. Use Results Desk for standings.
          </div>
        ) : null}

        {!resultFinalized && isFinalizing ? (
          <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            Match ended. Finalization is still running.
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-black/40 px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">State</div>
            <div className="mt-2 text-lg font-semibold text-white">
              {loading ? "Loading..." : currentState}
            </div>
            {controlState?.reason ? (
              <div className="mt-1 text-xs text-white/55">{controlState.reason}</div>
            ) : null}
          </div>

          <div className="rounded-xl border border-white/10 bg-black/40 px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Timer</div>
            <div className="mt-2 text-lg font-semibold text-white">{matchTimer}</div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/40 px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">
              Telemetry
            </div>
            <div className="mt-2 text-lg font-semibold text-white">{runtimeTelemetryState}</div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/40 px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Binding</div>
            <div className="mt-2 text-lg font-semibold text-white">{runtimeBindingState}</div>
            <div className="mt-1 text-xs text-white/45">
              {binding?.telemetryProvider ??
                binding?.sourceMode ??
                binding?.dataSource ??
                binding?.dataMode ??
                "Not configured"}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-orange-500/10 via-red-500/5 to-black p-4 sm:p-5 shadow-lg shadow-black/20">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-white/45">
              Observer Assist
            </p>
            <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold text-white">
              <Flame className="h-4 w-4 text-orange-300" />
              Suggested POV
            </h3>
          </div>
          {selectedSuggestion ? (
            <span
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${priorityTone(
                selectedSuggestion.priority,
              )}`}
            >
              Priority {selectedSuggestion.priority}
            </span>
          ) : null}
        </div>

        {selectedSuggestion && selectedSuggestionDetails ? (
          <button
            type="button"
            onClick={() => setSelectedSuggestionKey(cameraSuggestionKey(selectedSuggestion))}
            className="mt-4 w-full rounded-2xl border border-orange-300/30 bg-black/40 p-4 text-left transition hover:border-orange-200/50 hover:bg-black/50"
          >
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-white/45">
                      Team
                    </div>
                    <div className="mt-1 text-base font-semibold text-white">
                      {selectedSuggestionDetails.teamLabel}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-white/45">
                      Player
                    </div>
                    <div className="mt-1 text-base font-semibold text-white">
                      {selectedSuggestionDetails.playerLabel}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-white/45">
                      Reason
                    </div>
                    <div className="mt-1 text-base font-semibold text-white">
                      {selectedSuggestion.reason}
                    </div>
                  </div>
                </div>
          </button>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-black/30 px-4 py-5 text-sm text-white/55">
            Waiting for live POV.
          </div>
        )}

        {cameraSuggestions.length > 0 ? (
          <div className="mt-4 space-y-2">
            <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">
              Suggestions
            </div>
            {cameraSuggestions.map((suggestion) => {
              const isSelected =
                cameraSuggestionKey(suggestion) === selectedSuggestionKey;
              const team =
                liveTeams.find((item) => item.teamId === suggestion.teamId) ?? null;
              const livePlayer =
                team?.players?.find((player) => {
                  return (
                    player.id === suggestion.playerId ||
                    player.playerId === suggestion.playerId ||
                    player.externalPlayerId === suggestion.playerId ||
                    player.pubgPlayerId === suggestion.playerId
                  );
                }) ?? null;
              const resultPlayer =
                resultRows
                  .find((row) => row.teamId === suggestion.teamId)
                  ?.players.find((player) => {
                    return (
                      player.id === suggestion.playerId ||
                      player.playerId === suggestion.playerId
                    );
                  }) ?? null;
              const teamLabel = team?.name ?? team?.tag ?? suggestion.teamId ?? "Unknown team";
              const playerLabel =
                livePlayer?.name ??
                livePlayer?.ign ??
                resultPlayer?.name ??
                resultPlayer?.playerName ??
                suggestion.playerId ??
                "Auto POV";

              return (
                <button
                  key={cameraSuggestionKey(suggestion)}
                  type="button"
                  onClick={() => setSelectedSuggestionKey(cameraSuggestionKey(suggestion))}
                  className={`flex w-full items-start justify-between gap-3 rounded-xl border px-3 py-3 text-left transition ${
                    isSelected
                      ? "border-orange-300/50 bg-orange-500/15"
                      : "border-white/10 bg-black/30 hover:border-white/20 hover:bg-black/40"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white">
                      {teamLabel}
                    </div>
                    <div className="mt-1 truncate text-sm text-white/75">{playerLabel}</div>
                    <div className="mt-1 text-xs text-white/50">{suggestion.reason}</div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${priorityTone(
                      suggestion.priority,
                    )}`}
                  >
                    {suggestion.priority}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DraggableSlotTeam({
  teamId,
  teamName,
  teamTag,
  logoUrl,
  sourceSlotNumber,
  disabled,
  variant = "panel",
}: {
  teamId: string;
  teamName: string;
  teamTag?: string | null;
  logoUrl?: string | null;
  sourceSlotNumber: number | null;
  disabled?: boolean;
  variant?: "panel" | "slot";
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `slot-team-${teamId}`,
    data: {
      type: "team",
      teamId,
      teamName,
      teamTag: teamTag ?? null,
      logoUrl: logoUrl ?? null,
      sourceSlotNumber,
    } satisfies SlotTeamDragPayload,
    disabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    opacity: isDragging ? 0.55 : 1,
  };
  const src = ensureApiUrl(logoUrl) ?? FALLBACK_LOGO;
  const isPanelItem = variant === "panel";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${
        isPanelItem
          ? "flex w-full items-center gap-2 rounded-lg border border-cyan-400/10 bg-slate-950/70 px-2 py-1.5"
          : "flex w-full min-w-0 items-center gap-2.5"
      } ${disabled ? "cursor-not-allowed opacity-60" : "cursor-grab active:cursor-grabbing"} ${
        isPanelItem && !disabled ? "hover:border-cyan-300/20 hover:bg-slate-900/80" : ""
      }`}
      onPointerDown={
        isPanelItem
          ? undefined
          : (e) => {
              e.stopPropagation();
            }
      }
      {...attributes}
      {...listeners}
    >
      <div
        className={`shrink-0 rounded-lg border border-white/10 bg-white/5 ${
          isPanelItem ? "h-8 w-8" : "h-8 w-8"
        }`}
      >
        <Image
          src={src}
          alt={teamName}
          width={isPanelItem ? 32 : 32}
          height={isPanelItem ? 32 : 32}
          className="h-full w-full object-cover"
          unoptimized
        />
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <div
          className={`${
            isPanelItem ? "truncate text-[13px]" : "truncate text-[13px]"
          } font-semibold text-white`}
        >
          {teamName}
        </div>
        {teamTag ? (
          <div
            className={`${
              isPanelItem ? "mt-0.5 truncate text-[10px]" : "mt-0.5 truncate text-[10px]"
            } text-white/50`}
          >
            {teamTag}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DroppableSlotCard({
  slotNumber,
  teamId,
  busy,
  disabled,
  onOpenPicker,
  children,
}: {
  slotNumber: number;
  teamId: string | null;
  busy: boolean;
  disabled: boolean;
  onOpenPicker: (slotNumber: number) => void;
  children: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `slot-drop-${slotNumber}`,
    data: {
      type: "slot",
      slotNumber,
      targetTeamId: teamId,
    } satisfies SlotDropPayload,
    disabled: busy || disabled,
  });

  const interactionDisabled = busy || disabled;

  return (
    <div
      ref={setNodeRef}
      role="button"
      aria-disabled={interactionDisabled}
      tabIndex={interactionDisabled ? -1 : 0}
      onClick={() => {
        if (!interactionDisabled) onOpenPicker(slotNumber);
      }}
      onKeyDown={(e) => {
        if (interactionDisabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenPicker(slotNumber);
        }
      }}
      className={`relative min-h-[108px] rounded-[18px] border p-3 text-left shadow-lg shadow-black/15 transition ${
        isOver
          ? "border-sky-300/70 bg-white/[0.08] ring-2 ring-sky-400/45 shadow-[0_0_24px_rgba(56,189,248,0.22)]"
          : teamId
            ? "border-cyan-400/20 bg-slate-950/80 hover:border-cyan-300/35 hover:bg-slate-900/90"
            : "border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/[0.04]"
      } ${interactionDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
    >
      {children}
    </div>
  );
}

function SlotsTab({
  slots,
  teams,
  loading,
  maxSlotNumber,
  slotBusy,
  error,
  onAssign,
  onClear,
  onDropTeam,
  lobbyMode,
  onSetLobbyStatus,
  slotsLocked,
  slotLockReason,
  slotNotice,
  canSyncFromPreviousMatch,
  onSyncFromPreviousMatch,
  syncBusy,
  syncConfirmOpen,
  onCancelSyncConfirm,
  onConfirmSyncFromPreviousMatch,
}: {
  slots: SlotRow[];
  teams: MatchTeamRow[];
  loading: boolean;
  maxSlotNumber: number;
  slotBusy: number | null;
  error: string | null;
  onAssign: (slotNumber: number, teamId: string) => void;
  onClear: (slotNumber: number) => void;
  onDropTeam: (params: {
    teamId: string;
    sourceSlotNumber: number | null;
    targetSlotNumber: number;
    targetTeamId: string | null;
  }) => Promise<void>;
  lobbyMode: LobbyMode;
  onSetLobbyStatus: (slotNumber: number, lobbyStatus: SlotLobbyStatus) => Promise<void> | void;
  slotsLocked: boolean;
  slotLockReason: string | null;
  slotNotice: string | null;
  canSyncFromPreviousMatch: boolean;
  onSyncFromPreviousMatch: () => Promise<void>;
  syncBusy: boolean;
  syncConfirmOpen: boolean;
  onCancelSyncConfirm: () => void;
  onConfirmSyncFromPreviousMatch: () => Promise<void>;
}) {
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [teamSearch, setTeamSearch] = useState("");

  const slotMap = new Map<number, SlotRow>();
  slots.forEach((s) => slotMap.set(s.slotNumber, s));
  const rows = Array.from({ length: maxSlotNumber }, (_, idx) => idx + 1).map((num) => ({
    slotNumber: num,
    slot: slotMap.get(num) ?? null,
  }));

  const slotSummary = useMemo(
    () =>
      rows.reduce(
        (acc, { slot }) => {
          if (!slot?.teamId) {
            acc.empty += 1;
            return acc;
          }

          const status =
            (slot.lobbyStatus as SlotLobbyStatus | null) ??
            (lobbyMode === "MANUAL" ? "WAITING" : "OFFLINE");

          if (status === "READY") acc.ready += 1;
          else if (status === "WAITING") acc.waiting += 1;
          else if (status === "OFFLINE") acc.offline += 1;
          else acc.empty += 1;

          return acc;
        },
        { ready: 0, waiting: 0, offline: 0, empty: 0 },
      ),
    [lobbyMode, rows],
  );

  const teamsById = useMemo(() => {
    const map = new Map<string, MatchTeamRow>();
    teams.forEach((t) => map.set(t.teamId, t));
    return map;
  }, [teams]);

  const assignedSlotsByTeam = useMemo(() => {
    const map = new Map<string, number>();
    slots.forEach((slot) => {
      if (slot.teamId) map.set(slot.teamId, slot.slotNumber);
    });
    return map;
  }, [slots]);

  const unassignedTeams = useMemo(
    () => teams.filter((team) => !assignedSlotsByTeam.has(team.teamId)),
    [assignedSlotsByTeam, teams],
  );
  const filteredUnassignedTeams = useMemo(() => {
    const query = teamSearch.trim().toLowerCase();
    if (!query) return unassignedTeams;
    return unassignedTeams.filter((team) => {
      const fields = [team.teamName, team.teamTag ?? ""];
      return fields.some((value) => value.toLowerCase().includes(query));
    });
  }, [teamSearch, unassignedTeams]);

  const slotSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
  );

  const slotInteractionsDisabled = slotsLocked || slotBusy !== null || syncBusy;
  const summaryItems = [
    {
      label: "Ready",
      value: slotSummary.ready,
      tone: "border-emerald-400/20 bg-emerald-500/[0.08] text-emerald-100",
    },
    {
      label: "Waiting",
      value: slotSummary.waiting,
      tone: "border-amber-400/20 bg-amber-500/[0.08] text-amber-100",
    },
    {
      label: "Offline",
      value: slotSummary.offline,
      tone: "border-white/10 bg-white/[0.04] text-white/70",
    },
    {
      label: "Empty",
      value: slotSummary.empty,
      tone: "border-white/10 bg-white/[0.03] text-white/70",
    },
  ] as const;
  const openPicker = (slotNumber: number) => {
    if (slotsLocked) return;
    setPickerSlot(slotNumber);
  };
  const closePicker = () => setPickerSlot(null);

  const handleSelectTeam = (teamId: string) => {
    if (!pickerSlot || slotsLocked) return;
    onAssign(pickerSlot, teamId);
    closePicker();
  };

  const handleSlotDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (slotsLocked) {
        return;
      }
      const activeData = event.active.data.current as SlotTeamDragPayload | undefined;
      const overData = event.over?.data.current as SlotDropPayload | undefined;
      if (!activeData || !overData || activeData.type !== "team" || overData.type !== "slot") {
        return;
      }
      if (activeData.sourceSlotNumber === overData.slotNumber) {
        return;
      }
      void onDropTeam({
        teamId: activeData.teamId,
        sourceSlotNumber: activeData.sourceSlotNumber,
        targetSlotNumber: overData.slotNumber,
        targetTeamId: overData.targetTeamId,
      });
    },
    [onDropTeam, slotsLocked],
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 via-white/0 to-black/60 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-white">Lobby Slots</h2>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-white/60">
                {maxSlotNumber} slots
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {summaryItems.map((item) => (
                <div
                  key={item.label}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${item.tone}`}
                >
                  <span className="uppercase tracking-[0.16em] text-white/60">{item.label}</span>
                  <span className="text-sm text-white">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {canSyncFromPreviousMatch ? (
              <button
                type="button"
                onClick={() => void onSyncFromPreviousMatch()}
                disabled={slotInteractionsDisabled}
                title={slotsLocked ? (slotLockReason ?? "Slots are locked.") : undefined}
                className="rounded-full border border-sky-400/30 bg-sky-500/10 px-3.5 py-2 text-xs font-semibold text-sky-100 transition hover:border-sky-300/50 hover:bg-sky-500/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {syncBusy ? "Syncing..." : "Sync Previous Match"}
              </button>
            ) : null}
          </div>
        </div>

        {error ? (
          <div className="mt-3 rounded border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        {slotsLocked ? (
          <div className="mt-3 rounded border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70">
            {slotLockReason ?? "Slots are locked for the current lifecycle state."}
          </div>
        ) : null}

        <DndContext sensors={slotSensors} collisionDetection={closestCenter} onDragEnd={handleSlotDragEnd}>
          <div
            className={`mt-4 grid items-start gap-4 lg:grid-cols-[272px_minmax(0,1fr)] ${
              slotsLocked ? "opacity-80" : ""
            }`}
          >
            <div className="self-start rounded-xl border border-cyan-400/10 bg-slate-950/55 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] uppercase tracking-[0.22em] text-white/50">
                  Unassigned Teams
                </div>
                <span className="rounded-full border border-cyan-400/10 bg-cyan-500/[0.06] px-2 py-0.5 text-[10px] font-semibold text-cyan-100/80">
                  {filteredUnassignedTeams.length}
                </span>
              </div>

              <div className="mt-3">
                <input
                  type="search"
                  value={teamSearch}
                  onChange={(event) => setTeamSearch(event.target.value)}
                  placeholder="Search teams..."
                  className="w-full rounded-lg border border-cyan-400/10 bg-black/35 px-3 py-1.5 text-[13px] text-white placeholder:text-white/30 focus:border-sky-400/40 focus:outline-none"
                />
              </div>

              <div className="slots-unassigned-scroll mt-3 max-h-[500px] space-y-1 overflow-y-auto pr-1">
                {loading ? (
                  Array.from({ length: 6 }).map((_, idx) => (
                    <div
                      key={`team-skeleton-${idx}`}
                      className="h-10 rounded-lg border border-cyan-400/10 bg-slate-950/60 animate-pulse"
                    />
                  ))
                ) : filteredUnassignedTeams.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-cyan-400/10 bg-black/25 px-3 py-2 text-xs text-white/50">
                    {teamSearch.trim()
                      ? "No teams match your search."
                      : "All teams are currently assigned to slots."}
                  </div>
                ) : (
                  filteredUnassignedTeams.map((team) => (
                    <DraggableSlotTeam
                      key={team.teamId}
                      teamId={team.teamId}
                      teamName={team.teamName}
                      teamTag={team.teamTag ?? null}
                      logoUrl={team.logoUrl ?? null}
                      sourceSlotNumber={null}
                      disabled={slotInteractionsDisabled}
                      variant="panel"
                    />
                  ))
                )}
              </div>
            </div>

            <div className="min-w-0">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {loading
                ? Array.from({ length: Math.min(maxSlotNumber, 10) }, (_, idx) => (
                    <div
                      key={`skeleton-${idx}`}
                      className="min-h-[108px] rounded-[18px] border border-white/10 bg-white/5 animate-pulse"
                    />
                  ))
                : rows.map(({ slotNumber, slot }) => {
                      const teamFromSlots = slot?.team;
                      const teamFromList = slot?.teamId ? teamsById.get(slot.teamId) : null;
                      const teamName = teamFromSlots?.name ?? teamFromList?.teamName ?? "Empty";
                      const teamTag = teamFromSlots?.tag ?? teamFromList?.teamTag ?? null;
                      const logoUrl = teamFromSlots?.logoUrl ?? teamFromList?.logoUrl ?? null;
                      const teamId = slot?.teamId ?? null;
                      const slotLabel = `#${String(slotNumber).padStart(2, "0")}`;
                      const lobbyStatus: SlotLobbyStatus = !teamId
                        ? "EMPTY"
                        : (slot?.lobbyStatus as SlotLobbyStatus | null) ??
                          (lobbyMode === "MANUAL" ? "WAITING" : "OFFLINE");
                      const nextManualStatus: SlotLobbyStatus =
                        lobbyStatus === "READY" ? "WAITING" : "READY";
                      const playersInLobby = slot?.playersInLobby ?? 0;
                      const playersInLobbyLabel =
                        lobbyMode === "AUTO" && playersInLobby > 0 ? `${playersInLobby} in lobby` : null;

                      return (
                        <DroppableSlotCard
                          key={slotNumber}
                          slotNumber={slotNumber}
                          teamId={teamId}
                          busy={slotBusy === slotNumber}
                          disabled={slotsLocked}
                          onOpenPicker={openPicker}
                        >
                          <div className="flex h-full flex-col gap-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="text-[11px] font-semibold tracking-[0.16em] text-cyan-400/90">
                                {slotLabel}
                              </div>
                              {teamId ? (
                                <button
                                  type="button"
                                  aria-label="Unassign team"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void onClear(slotNumber);
                                  }}
                                  onPointerDown={(event) => {
                                    event.stopPropagation();
                                  }}
                                  disabled={slotInteractionsDisabled}
                                  title={slotsLocked ? (slotLockReason ?? "Slots are locked.") : "Unassign team"}
                                  className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/35 transition hover:border-red-400/35 hover:bg-red-500/10 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              ) : null}
                            </div>

                            <div className="flex min-h-0 flex-1 flex-col justify-center">
                              {teamId ? (
                                <DraggableSlotTeam
                                  teamId={teamId}
                                  teamName={teamName}
                                  teamTag={teamTag}
                                  logoUrl={logoUrl ?? null}
                                  sourceSlotNumber={slotNumber}
                                  disabled={slotInteractionsDisabled}
                                  variant="slot"
                                />
                              ) : (
                                <div className="flex h-full items-center text-sm font-medium text-white/35">
                                  Empty
                                </div>
                              )}
                            </div>

                            {teamId ? (
                              <div className="mt-auto flex flex-wrap items-center gap-2 text-[10px] text-white/60">
                                {playersInLobbyLabel ? (
                                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-white/55">
                                    {playersInLobbyLabel}
                                  </span>
                                ) : null}
                                {lobbyMode === "MANUAL" ? (
                                  <button
                                    type="button"
                                    aria-label={`Set lobby status ${nextManualStatus.toLowerCase()}`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void onSetLobbyStatus(slotNumber, nextManualStatus);
                                    }}
                                    onPointerDown={(event) => {
                                      event.stopPropagation();
                                    }}
                                    disabled={slotInteractionsDisabled}
                                    title={
                                      slotsLocked
                                        ? (slotLockReason ?? "Slots are locked.")
                                        : nextManualStatus === "READY"
                                          ? "Mark team ready"
                                          : "Mark team waiting"
                                    }
                                    className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition ${LOBBY_STATUS_STYLES[lobbyStatus]} disabled:cursor-not-allowed disabled:opacity-60`}
                                  >
                                    {lobbyStatus}
                                  </button>
                                ) : (
                                  <span
                                    className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${LOBBY_STATUS_STYLES[lobbyStatus]}`}
                                  >
                                    {lobbyStatus}
                                  </span>
                                )}
                              </div>
                            ) : null}
                          </div>
                        </DroppableSlotCard>
                      );
                    })}
              </div>
            </div>
          </div>
        </DndContext>
      </div>

      {slotNotice ? (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-emerald-400/40 bg-emerald-500/15 px-4 py-3 text-sm font-medium text-emerald-50 shadow-2xl shadow-emerald-950/40">
          {slotNotice}
        </div>
      ) : null}

      {syncConfirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-xl border border-white/10 bg-black/90 p-5 shadow-lg shadow-black/40">
            <div className="flex flex-col items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-amber-400/30 bg-amber-500/10 text-xl font-semibold text-amber-100">
                !
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-white">Sync Teams From Previous Match</h3>
                <div className="text-sm text-white/70">
                  This replaces the current slot teams with the previous match setup.
                </div>
              </div>

              <div className="flex w-full justify-end gap-2">
                <button
                  type="button"
                  onClick={onCancelSyncConfirm}
                  disabled={syncBusy}
                  className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 transition hover:border-white/30 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void onConfirmSyncFromPreviousMatch()}
                  disabled={syncBusy}
                  className="rounded-lg border border-sky-400/35 bg-sky-500/10 px-4 py-2 text-sm font-semibold text-sky-100 transition hover:border-sky-300/60 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {syncBusy ? "Syncing..." : "Sync Teams"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <style jsx global>{`
        .slots-unassigned-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(34, 211, 238, 0.28) rgba(15, 23, 42, 0.35);
        }

        .slots-unassigned-scroll::-webkit-scrollbar {
          width: 10px;
        }

        .slots-unassigned-scroll::-webkit-scrollbar-track {
          background: rgba(15, 23, 42, 0.35);
          border-radius: 9999px;
        }

        .slots-unassigned-scroll::-webkit-scrollbar-thumb {
          background: rgba(34, 211, 238, 0.28);
          border: 2px solid rgba(15, 23, 42, 0.45);
          border-radius: 9999px;
        }

        .slots-unassigned-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(34, 211, 238, 0.4);
        }
      `}</style>

      {pickerSlot && !slotsLocked ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-black/90 p-4 shadow-2xl shadow-black/40">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-white/50">Slot {pickerSlot}</p>
                <h3 className="text-lg font-semibold text-white">Assign team</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={closePicker}
                  className="rounded-full border border-white/20 px-2 py-1 text-xs text-white hover:border-white/40"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="mt-3 max-h-96 overflow-y-auto space-y-2">
              {teams.length === 0 ? (
                <div className="rounded border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/60">
                  No tournament teams available to assign.
                </div>
              ) : (
                teams.map((team) => (
                  <button
                    key={team.teamId}
                    onClick={() => handleSelectTeam(team.teamId)}
                    disabled={slotsLocked || slotBusy === pickerSlot}
                    className="flex w-full items-start gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left hover:border-indigo-400 disabled:opacity-50"
                  >
                    <div className="h-10 w-10 shrink-0 rounded-lg border border-white/10 bg-white/5">
                      <Image
                        src={ensureApiUrl(team.logoUrl) ?? FALLBACK_LOGO}
                        alt={team.teamName}
                        width={40}
                        height={40}
                        className="h-full w-full rounded-lg object-cover"
                        unoptimized
                      />
                    </div>
                    <div className="flex-1 leading-tight">
                      <div className="text-sm font-semibold text-white break-words">{team.teamName}</div>
                      {team.teamTag ? (
                        <div className="mt-1 text-xs text-white/55">{team.teamTag}</div>
                      ) : null}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}


