"use client";
/* eslint-disable @next/next/no-img-element */

import { API_URL, ensureApiUrl } from "@/lib/api";
import {
  fetchPublicMatchControlSnapshot,
  getControlLifecycleStatus,
  isControlFinalized,
  isControlFinalizing,
  isControlLive,
  type MatchRuntimeControlSnapshot,
} from "@/features/matches/match-control-runtime";
import {
  DEFAULT_BRANDING_STATE,
  buildBrandingCssVars,
  buildBrandingState,
  darkenHexColor,
  gradientDirectionToAngle,
  normalizeHexColor,
  WIDGET_THEME_OVERRIDE_CSS,
  type BrandingState,
} from "@/lib/branding";
import {
  useFixedWidgetCanvasScale,
  WIDGET_CANVAS_HEIGHT,
  WIDGET_CANVAS_WIDTH,
} from "@/components/widgets/fixed-widget-canvas";
import {
  useObserverDirectLeaderboard,
  type ObserverLeaderboardPayload,
  type ObserverLeaderboardPlayer,
  type ObserverLeaderboardRow,
} from "@/features/widgets/realtime/use-observer-direct-leaderboard";
import {
  useObserverDirectMapOverlay,
  type ObserverDirectMapOverlayPayload,
} from "@/features/widgets/realtime/use-observer-direct-map-overlay";
import { useObserverDirectAchievements } from "@/features/widgets/realtime/use-observer-direct-achievements";
import { MAP_CALIBRATION } from "./mapCalibration";
import { useSearchParams } from "next/navigation";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode, WheelEvent as ReactWheelEvent } from "react";
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

type LiveWidgetKey =
  | "teams-alive"
  | "leaderboard"
  | "overall-live-ranking"
  | "match-lower-third"
  | "kill-feed"
  | "player-card"
  | "player-photo"
  | "map-overlay"
  | "next-zone-update"
  | "wwcd"
  | "winner"
  | "fight-alert"
  | "achievement-alert"
  | "team-eliminated-alert";

export type LiveWidgetCatalogItem = {
  key: LiveWidgetKey;
  title: string;
  description: string;
};

export const LIVE_WIDGETS: LiveWidgetCatalogItem[] = [
  {
    key: "teams-alive",
    title: "Teams Alive",
    description:
      "PMGC-inspired survival counter with branded team pulse and live match context.",
  },
  {
    key: "leaderboard",
    title: "Leaderboard",
    description:
      "Right-side live standings board with placement, kills, and survival state.",
  },
  {
    key: "overall-live-ranking",
    title: "Overall Live Ranking",
    description:
      "Current group or tournament standings updated live with the active match total points.",
  },
  {
    key: "match-lower-third",
    title: "Match Lower Third",
    description:
      "Bottom-left live match identification bar with tournament, stage, match, and map context.",
  },
  {
    key: "kill-feed",
    title: "Kill Feed",
    description:
      "Compact elimination stack for active fights, tuned for clean OBS framing.",
  },
  {
    key: "player-card",
    title: "Player Card",
    description:
      "Left-side focused player portrait with team branding, kills, and damage summary.",
  },
  {
    key: "player-photo",
    title: "Player Photo",
    description:
      "Bottom-right live player portrait driven by the current playerId-linked spotlight feed.",
  },
  {
    key: "map-overlay",
    title: "Live Map",
    description:
      "PUBG Mobile-style live map with safe zone, next zone, player positions, blue-zone shading, and auto focus.",
  },
  {
    key: "next-zone-update",
    title: "Next Zone Update",
    description:
      "Top-center next-zone countdown that appears only during the final 20 seconds before the zone change.",
  },
  {
    key: "wwcd",
    title: "WWCD",
    description:
      "Dedicated Winner Winner Chicken Dinner slate that auto-reveals when live telemetry resolves the final team alive.",
  },
  {
    key: "winner",
    title: "Winner",
    description:
      "Victory slate for chicken dinner moments with team branding and finish context.",
  },
  {
    key: "fight-alert",
    title: "Fight Alert",
    description:
      "Live battle banner for high-attention fights detected from observer telemetry.",
  },
  {
    key: "achievement-alert",
    title: "Achievement Alert",
    description:
      "Left-center live popup for streaks, clutch plays, and team wipes from the observer achievement event stream.",
  },
  {
    key: "team-eliminated-alert",
    title: "Team Eliminated Alert",
    description:
      "Center-lower elimination alert driven by backend-issued observer team elimination events.",
  },
];

type MatchStateLeaderboardRow = {
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
  players?: MatchStateLeaderboardPlayer[];
};

type MatchStateLeaderboardPlayer = {
  playerId: string | null;
  playerName: string;
  avatarUrl: string | null;
  kills: number;
  alive: boolean;
  knocked: boolean;
  health: number | null;
  hasDied: boolean | null;
  lifeTelemetryFresh?: boolean;
};

type MatchStateKillFeedEntry = {
  id: string;
  killerPlayerId?: string | null;
  killerName: string | null;
  killerTeamId?: string | null;
  killerTeam: string | null;
  victimPlayerId?: string | null;
  victimName: string | null;
  victimTeamId?: string | null;
  victimTeam: string | null;
  weapon: string | null;
  tsIso: string | null;
  isKnock?: boolean;
  isThirst?: boolean;
  isSelf?: boolean;
  isZone?: boolean;
  isReviveRelated?: boolean;
};

type MatchStatePlayerCard = {
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
};

type MatchStateCircle = {
  phase: number | null;
  status: string | null;
  counterSeconds: number | null;
  maxTimeSeconds: number | null;
  nextShrinkAt: string | null;
  safeZone: { x: number; y: number; r: number } | null;
  nextZone: { x: number; y: number; r: number } | null;
};

type MatchStateWinner = {
  teamId: string | null;
  slot: number | null;
  teamName: string;
  teamTag: string | null;
  logoUrl: string | null;
  color: string | null;
  kills: number;
  alivePlayers: number;
  placement: number | null;
};

type MatchStatePayload = {
  matchId: string;
  updatedAt: string;
  teamsAlive: number;
  leaderboard: MatchStateLeaderboardRow[];
  killFeed: MatchStateKillFeedEntry[];
  playerCard: MatchStatePlayerCard | null;
  circle: MatchStateCircle | null;
  winner: MatchStateWinner | null;
};

type ObserverStateUpdatePayload = {
  matchId: string;
  leaderboard: MatchStateLeaderboardRow[];
  teamsAlive: number;
  timestamp: string;
};

type ObserverKillFeedUpdateEntry = {
  id: string;
  timestamp: string | null;
  killerPlayerId: string | null;
  killerName: string | null;
  killerTeamId: string | null;
  killerTeamName: string | null;
  victimPlayerId: string | null;
  victimName: string | null;
  victimTeamId: string | null;
  victimTeamName: string | null;
  weapon: string | null;
  isKnock: boolean;
  isThirst: boolean;
  isSelf: boolean;
  isZone: boolean;
  isReviveRelated: boolean;
};

type ObserverKillFeedUpdatePayload = {
  matchId: string;
  entries: ObserverKillFeedUpdateEntry[];
  sequence: number;
  emittedAt: string;
};

type ObserverMatchFinishedPayload = {
  matchId: string;
  winnerTeamId: string | null;
  winnerTeamName: string | null;
  finalLeaderboard: MatchStateLeaderboardRow[];
  finishedAt: string;
};

type PublicMatchSlotResult = {
  matchId: string;
  teamId: string | null;
  slotNumber: number | null;
  wasPresentInMatch?: boolean | null;
  presenceStatus?: "ACTIVE" | "NO_SHOW" | "UNRESOLVED" | null;
  placement?: number | null;
  eliminatedAt?: string | null;
  totalKills?: number | null;
  kills?: number | null;
  totalPoints?: number | null;
  points?: number | null;
  team?: {
    id?: string | null;
    name?: string | null;
    tag?: string | null;
    logoUrl?: string | null;
  } | null;
  players?: Array<{
    playerId?: string | null;
    externalPlayerId?: string | null;
    playerName?: string | null;
    name?: string | null;
    photoUrl?: string | null;
    kills?: number | null;
    knocks?: number | null;
    isKnocked?: boolean | null;
    isAlive?: boolean | null;
    alive?: boolean | null;
  }> | null;
};

type RealtimeLiveMatchPayload = {
  matchId: string;
  updatedAt?: string | null;
  summary?: {
    aliveTeams?: number | null;
  } | null;
  circle?: {
    phase?: number | null;
    nextShrinkAt?: number | string | null;
    safeZone?: { x: number; y: number; r: number } | null;
    nextZone?: { x: number; y: number; r: number } | null;
  } | null;
  teams: Array<unknown>;
};

type MapOverlayConfig = {
  mapName: string;
  imageUrl: string;
  worldSize: number;
  coordinateSystem: "WORLD" | "WORLD_BOTTOM_LEFT";
  notes?: string;
};

type MapOverlayCircle = {
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
};

type MapOverlayTeamMarker = {
  teamId: string | null;
  x: number;
  y: number;
  alive?: boolean;
  playerCount: number;
  alivePlayers: number;
};

type MapOverlayPlayerMarker = {
  playerId?: string;
  teamId?: string | null;
  x: number;
  y: number;
  alive?: boolean;
  knocked?: boolean;
};

type MapOverlayPayload = {
  matchId: string;
  updatedAt: string | null;
  source: MapOverlayPayloadSource | null;
  map: MapOverlayConfig | null;
  circle: MapOverlayCircle | null;
  flightPath: {
    start: { x: number; y: number };
    end: { x: number; y: number };
    coordinateSystem?: MapOverlayConfig["coordinateSystem"] | null;
  } | null;
  teamMarkers: MapOverlayTeamMarker[];
  playerMarkers: MapOverlayPlayerMarker[];
};

type MapOverlayPayloadSource =
  | "preview"
  | "direct-map"
  | "leaderboard-fallback"
  | "runtime-circle"
  | "backend-fallback";

type MapOverlaySourceSelection = {
  overall: MapOverlayPayloadSource | null;
  map: MapOverlayPayloadSource | null;
  circle: MapOverlayPayloadSource | null;
  flightPath: MapOverlayPayloadSource | null;
  markers: MapOverlayPayloadSource | null;
};

type ResolvedMapOverlayPayload = {
  payload: MapOverlayPayload | null;
  selection: MapOverlaySourceSelection;
};

type RenderedMapOverlayPlayerMarker = MapOverlayPlayerMarker & {
  renderKey: string;
  renderOpacity: number;
  interpolationAlpha: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  isExiting: boolean;
  teleportDistance: number;
};

type MapOverlayPlayerInterpolationEntry = {
  key: string;
  marker: MapOverlayPlayerMarker;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startedAtMs: number;
  isExiting: boolean;
};

type MapOverlayPlayerInterpolationState = {
  signature: string;
  matchId: string | null;
  worldSize: number | null;
  entries: Map<string, MapOverlayPlayerInterpolationEntry>;
};

type MapOverlayInterpolationDebugPlayer = {
  key: string;
  playerId: string | null;
  teamId: string | null;
  prevX: number;
  prevY: number;
  nextX: number;
  nextY: number;
  currentX: number;
  currentY: number;
  alpha: number;
  isExiting: boolean;
  teleportDistance: number;
};

type MapOverlayDebugInfo = {
  source: MapOverlayPayloadSource | null;
  updatedAt: string | null;
  payloadAgeMs: number | null;
  stale: boolean;
  rawPlayerCount: number;
  rawTeamCount: number;
  renderedPlayerCount: number;
  renderedTeamCount: number;
  teamMarkerMode:
    | "none"
    | "direct-team-markers"
    | "derived-centroids"
    | "team-fallback";
  interpolationActive: boolean;
  missingPositionCount: number;
  interpolationPlayers: MapOverlayInterpolationDebugPlayer[];
  teleportingPlayers: MapOverlayInterpolationDebugPlayer[];
};

type FightAlertPayload = {
  matchId: string;
  fightId: string;
  teams: Array<{
    teamId: string | null;
    teamName: string;
    teamTag: string | null;
    logoUrl: string | null;
    slot: number | null;
  }>;
  eventCount: number;
  distance: number | null;
  distanceUnit: string | null;
  roles?: {
    left: "attack" | "defend" | "trade" | null;
    right: "attack" | "defend" | "trade" | null;
  } | null;
  startedAt: string;
  lastEventAt: string;
};

type WinnerEventPayload = {
  matchId: string;
  teamId: string | null;
  teamName: string;
  teamTag: string | null;
  logoUrl: string | null;
};

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

type ObserverTeamEliminationPayload = {
  matchId: string;
  eventId: string;
  teamId: string;
  teamName: string;
  placement: number | null;
  kills: number;
  eliminatedAt: string;
};

type AchievementAlertDisplay = {
  id: string;
  matchId: string;
  playerId: string | null;
  playerName: string;
  playerPhotoUrl: string | null;
  teamId: string | null;
  teamName: string | null;
  teamTag: string | null;
  teamLogoUrl: string | null;
  achievementType: string;
  title: string;
  accentColor: string;
  timestamp: string;
};

type TeamEliminatedAlertDisplay = {
  id: string;
  matchId: string;
  teamId: string;
  teamName: string;
  kills: number;
  placement: number | null;
  accentColor: string;
  eliminatedAt: string;
};

type ActiveMatchPayload = {
  id: string;
  matchId: string;
  tournamentId: string | null;
  stageId: string | null;
  groupId: string | null;
  status: string | null;
  liveState: string | null;
  matchNumber: number | string | null;
  matchName: string | null;
  map: string | null;
  tournamentName: string | null;
  tournamentLogo: string | null;
  sponsors?: ActiveMatchSponsor[] | null;
  stageName: string | null;
  startsAt: string | null;
  endedAt: string | null;
};

type ActiveMatchSponsor = {
  id: string;
  name: string;
  logoUrl?: string | null;
  tier?: string | null;
  priority?: number | null;
  displayOrder?: number | null;
  websiteUrl?: string | null;
  rotationIntervalSeconds?: number | null;
  isActive?: boolean | null;
};

type BrandingEventPayload = {
  organizationId: string;
  branding: Partial<BrandingState>;
};

type OverallStandingsMatchRow = {
  matchId: string;
  matchNumber: number | string | null;
  mapName: string | null;
  placement: number | null;
  kills: number | null;
  placementPoints: number;
  totalPoints: number;
  playedAt: string | Date;
};

type OverallStandingsRow = {
  rank?: number;
  teamId: string;
  teamName: string | null;
  teamTag: string | null;
  teamLogo: string | null;
  matchesPlayed: number;
  totalKills: number;
  totalPlacementPoints: number;
  totalPoints: number;
  bestPlacement: number | null;
  lastMatchPlacement: number | null;
  perMatch: OverallStandingsMatchRow[];
};

type OverallStandingsPayload = {
  scope: "TOURNAMENT" | "STAGE" | "GROUP";
  scopeId: string;
  computedAt: string;
  matchCountUsed: number;
  rows: OverallStandingsRow[];
};

type WidgetContextResponse = {
  organizationId?: string | null;
  organizationSlug?: string | null;
  branding?: Partial<BrandingState> | null;
  matchId?: string | null;
  liveMatchId?: string | null;
  liveState?: string | null;
  status?: string | null;
};

type WidgetApprovalRecord = {
  widgetKey: string;
  isApproved: boolean;
  approvedAt: string | null;
  approvedBy: string | null;
};

type WidgetAccessResponse = {
  organizationId: string;
  organizationSlug: string;
  widgetKey: string;
  enforced: boolean;
  allowed: boolean;
  approval: WidgetApprovalRecord | null;
};

type WidgetRuntimeStatus = "loading" | "ready" | "waiting" | "error";

type WidgetSourceMode = "AUTO" | "MANUAL" | "HYBRID" | "PCOB";

type WidgetRuntime = {
  widgetKey: string;
  status: WidgetRuntimeStatus;
  preview: boolean;
  clean: boolean;
  organizationId: string | null;
  organizationSlug: string | null;
  matchId: string | null;
  tournamentId: string | null;
  stageId: string | null;
  groupId: string | null;
  matchName: string | null;
  matchNumber: number | string | null;
  tournamentName: string | null;
  tournamentLogo: string | null;
  sponsors: ActiveMatchSponsor[];
  stageName: string | null;
  map: string | null;
  branding: BrandingState;
  payload: MatchStatePayload;
  fightAlert: FightAlertPayload | null;
  lastEventAt: string | null;
  error: string | null;
  usingPreviewData: boolean;
  widgetAccessDenied: boolean;
  widgetApprovalEnforced: boolean;
  widgetApproval: WidgetApprovalRecord | null;
  control: MatchRuntimeControlSnapshot | null;
  lifecycleStatus: string | null;
  sourceMode: WidgetSourceMode;
  isFinalizing: boolean;
  resultFinalized: boolean;
  canConsumeLiveTelemetry: boolean;
  canUseObserverDirect: boolean;
};

const SOCKET_URL = new URL("/realtime", API_URL).toString();
const CONTEXT_POLL_MS = 12_000;
const STATE_POLL_MS = 4_000;
const MAP_STATE_POLL_MS = 2_000;
const NEXT_ZONE_STATE_POLL_MS = 1_000;
const NEXT_ZONE_MAP_STATE_POLL_MS = 1_000;
const DIRECT_MAP_OVERLAY_STALE_MS = 3_000;
const FIGHT_ALERT_LINGER_MS = 6_000;
const ACHIEVEMENT_ALERT_DISPLAY_MS = 3_800;
const ACHIEVEMENT_ALERT_TRANSITION_MS = 260;
const PREVIEW_ACHIEVEMENT_INTERVAL_MS = 4_400;
const TEAM_ELIMINATED_ALERT_DISPLAY_MS = 4_100;
const TEAM_ELIMINATED_ALERT_TRANSITION_MS = 280;
const PREVIEW_TEAM_ELIMINATED_INTERVAL_MS = 5_000;
const MAP_OVERLAY_MANUAL_RESET_MS = 5_000;
const MAP_OVERLAY_PLAYER_INTERPOLATION_MS = 650;
const MAP_OVERLAY_PLAYER_EXIT_MS = 900;
const MAP_OVERLAY_DEBUG_TELEPORT_DISTANCE_RATIO = 0.06;
const RANKING_ROW_MOVE_MS = 420;
const RANKING_ROW_FADE_MS = 220;
const MAP_OVERLAY_MANUAL_MAX_SCALE = 5;
const PREVIEW_RANKING_CYCLE_MS = 2_600;
const PREVIEW_MATCH_ID = "preview-match";
const DEFAULT_TEAM_LOGO_URL = "/assets/defaults/default-team.png";
const DEFAULT_PLAYER_PHOTO_URL = "/assets/defaults/default-player.png";
const DEFAULT_WIDGET_TEAM_NAME = "Arenzyra";
const DEFAULT_WIDGET_TEAM_TAG = "AZ";
const WIDGET_APPROVAL_ERROR = "Widget approval required for this organization.";
const PREVIEW_CLOCK_BASE_MS = Date.parse("2026-03-11T19:22:00.000Z");
const PREVIEW_MAP_NEXT_SHRINK_AT = new Date(
  PREVIEW_CLOCK_BASE_MS + 34_000,
).toISOString();
const PREVIEW_NEXT_ZONE_TARGET_MS = PREVIEW_CLOCK_BASE_MS + 18_000;

const LOCAL_MAP_OVERLAY_ASSETS: Record<string, MapOverlayConfig> = {
  ERANGEL: {
    mapName: "ERANGEL",
    imageUrl: "/maps/erangel.png",
    worldSize: 8000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
  },
  MIRAMAR: {
    mapName: "MIRAMAR",
    imageUrl: "/maps/miramar.png",
    worldSize: 8000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
  },
  SANHOK: {
    mapName: "SANHOK",
    imageUrl: "/maps/sanhok.jpg",
    worldSize: 4000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
  },
  VIKENDI: {
    mapName: "VIKENDI",
    imageUrl: "/maps/vikendi.jpg",
    worldSize: 6000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
  },
  LIVIK: {
    mapName: "LIVIK",
    imageUrl: "/maps/livik.jpg",
    worldSize: 4000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
  },
  LIVIK_AFTERMATH: {
    mapName: "LIVIK AFTERMATH",
    imageUrl: "/maps/livik-aftermath.png",
    worldSize: 4000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
  },
  KARAKIN: {
    mapName: "KARAKIN",
    imageUrl: "/maps/karakin.jpg",
    worldSize: 2000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
  },
  NUSA: {
    mapName: "NUSA",
    imageUrl: "/maps/nusa.png",
    worldSize: 1000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
  },
  RONDO: {
    mapName: "RONDO",
    imageUrl: "/maps/rondo.jpg",
    worldSize: 8000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
  },
};

const CANONICAL_LIVE_MAP_OVERLAY_WORLD_SIZES: Record<string, number> = {
  ERANGEL: 816_000,
  MIRAMAR: 816_000,
  SANHOK: 408_000,
  VIKENDI: 612_000,
  LIVIK: 408_000,
  LIVIK_AFTERMATH: 408_000,
  KARAKIN: 204_000,
  NUSA: 102_000,
  RONDO: 816_000,
};

const MAP_OVERLAY_RENDER_WORLD_SIZE = 8_000;
const MAP_OVERLAY_COMPACT_COORDINATE_WORLD_SIZE = 8_000;
const MAP_OVERLAY_FULL_COORDINATE_WORLD_SIZE = 800_000;
const MAP_OVERLAY_FULL_COORDINATE_THRESHOLD = 100_000;
const MAP_OVERLAY_FULL_COORDINATE_DIVISOR = 100;

type MapOverlayDetectedWorldSize =
  | typeof MAP_OVERLAY_COMPACT_COORDINATE_WORLD_SIZE
  | typeof MAP_OVERLAY_FULL_COORDINATE_WORLD_SIZE;

function previewLeaderboardPlayers(
  players: Array<
    Partial<
      Pick<
        MatchStateLeaderboardPlayer,
        | "alive"
        | "knocked"
        | "health"
        | "hasDied"
        | "playerName"
        | "avatarUrl"
        | "kills"
      >
    >
  >,
): MatchStateLeaderboardPlayer[] {
  return players.map((player, index) => ({
    playerId: `preview-player-${index + 1}`,
    playerName: player.playerName ?? `Player ${index + 1}`,
    avatarUrl: player.avatarUrl ?? null,
    kills: player.kills ?? 0,
    alive: player.alive ?? false,
    knocked: player.knocked ?? false,
    health: player.health ?? null,
    hasDied: player.hasDied ?? null,
    lifeTelemetryFresh: true,
  }));
}

const PREVIEW_STATE: MatchStatePayload = {
  matchId: PREVIEW_MATCH_ID,
  updatedAt: "2026-03-11T19:22:00.000Z",
  teamsAlive: 9,
  leaderboard: [
    {
      rank: 1,
      teamId: "team-1",
      slot: 3,
      teamName: "Arenzyra",
      teamTag: "AZ",
      logoUrl: null,
      color: "#00d1ff",
      kills: 11,
      alivePlayers: 4,
      totalPlayers: 4,
      placement: 1,
      isEliminated: false,
      players: previewLeaderboardPlayers([
        { alive: true, knocked: false, health: 100 },
        { alive: true, knocked: false, health: 88 },
        { alive: true, knocked: false, health: 73 },
        { alive: true, knocked: false, health: 54 },
      ]),
    },
    {
      rank: 2,
      teamId: "team-2",
      slot: 12,
      teamName: "Nova Legacy",
      teamTag: "NVL",
      logoUrl: null,
      color: "#f6a623",
      kills: 8,
      alivePlayers: 3,
      totalPlayers: 4,
      placement: 2,
      isEliminated: false,
      players: previewLeaderboardPlayers([
        { alive: true, knocked: false, health: 96 },
        { alive: true, knocked: false, health: 61 },
        { alive: true, knocked: true, health: 24 },
        { alive: false, knocked: false, health: 0, hasDied: true },
      ]),
    },
    {
      rank: 3,
      teamId: "team-3",
      slot: 7,
      teamName: "Rogue Orbit",
      teamTag: "RGO",
      logoUrl: null,
      color: "#8b5cf6",
      kills: 7,
      alivePlayers: 2,
      totalPlayers: 4,
      placement: 3,
      isEliminated: false,
      players: previewLeaderboardPlayers([
        { alive: true, knocked: false, health: 85 },
        { alive: true, knocked: false, health: 45 },
        { alive: false, knocked: false, health: 0, hasDied: true },
        { alive: false, knocked: false, health: 0, hasDied: true },
      ]),
    },
    {
      rank: 4,
      teamId: "team-4",
      slot: 18,
      teamName: "Titan Circle",
      teamTag: "TNC",
      logoUrl: null,
      color: "#22c55e",
      kills: 6,
      alivePlayers: 2,
      totalPlayers: 4,
      placement: 4,
      isEliminated: false,
      players: previewLeaderboardPlayers([
        { alive: true, knocked: false, health: 62 },
        { alive: true, knocked: true, health: 18 },
        { alive: false, knocked: false, health: 0, hasDied: true },
        { alive: false, knocked: false, health: 0, hasDied: true },
      ]),
    },
    {
      rank: 5,
      teamId: "team-5",
      slot: 9,
      teamName: "Apex Horizon",
      teamTag: "APX",
      logoUrl: null,
      color: "#ef4444",
      kills: 5,
      alivePlayers: 1,
      totalPlayers: 4,
      placement: 5,
      isEliminated: false,
      players: previewLeaderboardPlayers([
        { alive: true, knocked: true, health: 12 },
        { alive: false, knocked: false, health: 0, hasDied: true },
        { alive: false, knocked: false, health: 0, hasDied: true },
        { alive: false, knocked: false, health: 0, hasDied: true },
      ]),
    },
    {
      rank: 6,
      teamId: "team-6",
      slot: 2,
      teamName: "Lunar Wolves",
      teamTag: "LNW",
      logoUrl: null,
      color: "#14b8a6",
      kills: 4,
      alivePlayers: 0,
      totalPlayers: 4,
      placement: 6,
      isEliminated: true,
      players: previewLeaderboardPlayers([
        { alive: false, knocked: false, health: 0, hasDied: true },
        { alive: false, knocked: false, health: 0, hasDied: true },
        { alive: false, knocked: false, health: 0, hasDied: true },
        { alive: false, knocked: false, health: 0, hasDied: true },
      ]),
    },
  ],
  killFeed: [
    {
      id: "kill-1",
      killerName: "AZ Haze",
      killerTeam: "AZ",
      victimName: "APX Rune",
      victimTeam: "APX",
      weapon: "M416",
      tsIso: "2026-03-11T19:21:42.000Z",
    },
    {
      id: "kill-2",
      killerName: "NVL Frost",
      killerTeam: "NVL",
      victimName: "LNW Miro",
      victimTeam: "LNW",
      weapon: "DP-28",
      tsIso: "2026-03-11T19:21:30.000Z",
    },
    {
      id: "kill-3",
      killerName: "RGO Ash",
      killerTeam: "RGO",
      victimName: "TNC Vale",
      victimTeam: "TNC",
      weapon: "AKM",
      tsIso: "2026-03-11T19:21:12.000Z",
    },
  ],
  playerCard: {
    playerId: "player-1",
    name: "AZ Haze",
    avatarUrl: null,
    teamId: "team-1",
    teamName: "Arenzyra",
    teamTag: "AZ",
    logoUrl: null,
    color: "#00d1ff",
    kills: 5,
    alive: true,
    damage: 728,
  },
  circle: null,
  winner: {
    teamId: "team-1",
    slot: 3,
    teamName: "Arenzyra",
    teamTag: "AZ",
    logoUrl: null,
    color: "#00d1ff",
    kills: 14,
    alivePlayers: 3,
    placement: 1,
  },
};

const PREVIEW_ACTIVE_MATCH: ActiveMatchPayload = {
  id: PREVIEW_MATCH_ID,
  matchId: PREVIEW_MATCH_ID,
  tournamentId: "preview-tournament",
  stageId: "preview-stage",
  groupId: "preview-group",
  status: "LIVE",
  liveState: "LIVE",
  matchNumber: 7,
  matchName: "Match 07",
  map: "Erangel",
  tournamentName: "Arenzyra Championship",
  tournamentLogo: "/assets/defaults/default-team.png",
  sponsors: [
    {
      id: "preview-sponsor-1",
      name: "Redline",
      logoUrl: "/assets/defaults/default-team.png",
      rotationIntervalSeconds: 15,
      displayOrder: 1,
    },
    {
      id: "preview-sponsor-2",
      name: "Aether",
      logoUrl: "/assets/defaults/default-team.png",
      rotationIntervalSeconds: 15,
      displayOrder: 2,
    },
  ],
  stageName: "Final Day",
  startsAt: "2026-03-11T19:10:00.000Z",
  endedAt: null,
};

const PREVIEW_MAP_OVERLAY_STATE: MapOverlayPayload = {
  matchId: PREVIEW_MATCH_ID,
  updatedAt: new Date(PREVIEW_CLOCK_BASE_MS).toISOString(),
  source: "preview",
  map: LOCAL_MAP_OVERLAY_ASSETS.ERANGEL,
  circle: {
    safeZone: { x: 5450, y: 3820, r: 1820 },
    nextZone: { x: 5980, y: 3475, r: 920 },
    phaseIndex: 4,
    status: "2",
    counterSeconds: 12,
    maxTimeSeconds: 34,
    nextShrinkAt: PREVIEW_MAP_NEXT_SHRINK_AT,
    timerRemaining: 34_000,
    timeRemainingToNextPhase: 34,
    phaseLabel: "Phase 4",
  },
  flightPath: {
    start: { x: 920, y: 7420 },
    end: { x: 6940, y: 1180 },
  },
  teamMarkers: [
    { teamId: "team-1", x: 5850, y: 3620, alive: true, playerCount: 4, alivePlayers: 4 },
    { teamId: "team-2", x: 5325, y: 3920, alive: true, playerCount: 3, alivePlayers: 3 },
    { teamId: "team-3", x: 6175, y: 3270, alive: true, playerCount: 2, alivePlayers: 2 },
    { teamId: "team-4", x: 4710, y: 4160, alive: true, playerCount: 2, alivePlayers: 2 },
    { teamId: "team-5", x: 5580, y: 3050, alive: true, playerCount: 1, alivePlayers: 1 },
  ],
  playerMarkers: [
    { playerId: "player-1", teamId: "team-1", x: 5770, y: 3655, alive: true },
    { playerId: "player-2", teamId: "team-1", x: 5895, y: 3595, alive: true },
    { playerId: "player-3", teamId: "team-1", x: 5950, y: 3680, alive: true },
    { playerId: "player-4", teamId: "team-1", x: 5805, y: 3550, alive: true },
    { playerId: "player-5", teamId: "team-2", x: 5250, y: 3865, alive: true },
    { playerId: "player-6", teamId: "team-2", x: 5385, y: 3975, alive: true },
    { playerId: "player-7", teamId: "team-2", x: 5350, y: 3910, knocked: true, alive: true },
    { playerId: "player-8", teamId: "team-3", x: 6210, y: 3235, alive: true },
    { playerId: "player-9", teamId: "team-3", x: 6145, y: 3315, alive: true },
    { playerId: "player-10", teamId: "team-4", x: 4680, y: 4200, alive: true },
    { playerId: "player-11", teamId: "team-4", x: 4750, y: 4120, alive: true },
    { playerId: "player-12", teamId: "team-5", x: 5560, y: 3010, knocked: true, alive: true },
  ],
};

const PREVIEW_OVERALL_STANDINGS: OverallStandingsPayload = {
  scope: "GROUP",
  scopeId: "preview-group",
  computedAt: "2026-03-12T12:00:00.000Z",
  matchCountUsed: 4,
  rows: PREVIEW_STATE.leaderboard.map((row, index) => {
    const historicalKills = Math.max(0, row.kills + 6 - index);
    const historicalPlacementPoints = Math.max(8, 34 - index * 2);
    return {
      rank: index + 1,
      teamId: row.teamId ?? `preview-team-${index + 1}`,
      teamName: row.teamName,
      teamTag: row.teamTag,
      teamLogo: row.logoUrl,
      matchesPlayed: 4,
      totalKills: historicalKills,
      totalPlacementPoints: historicalPlacementPoints,
      totalPoints: historicalKills + historicalPlacementPoints,
      bestPlacement: Math.min(index + 1, 4),
      lastMatchPlacement: Math.min(index + 1, 6),
      perMatch: [
        {
          matchId: "preview-match-1",
          matchNumber: 1,
          mapName: "Erangel",
          placement: Math.min(index + 1, 8),
          kills: Math.max(0, row.kills - 1),
          placementPoints: Math.max(0, 10 - index),
          totalPoints: Math.max(0, row.kills - 1) + Math.max(0, 10 - index),
          playedAt: "2026-03-01T12:00:00.000Z",
        },
        {
          matchId: "preview-match-2",
          matchNumber: 2,
          mapName: "Miramar",
          placement: Math.min(index + 2, 10),
          kills: Math.max(0, row.kills - 2),
          placementPoints: Math.max(0, 8 - index),
          totalPoints: Math.max(0, row.kills - 2) + Math.max(0, 8 - index),
          playedAt: "2026-03-01T14:00:00.000Z",
        },
        {
          matchId: "preview-match-3",
          matchNumber: 3,
          mapName: "Sanhok",
          placement: Math.min(index + 1, 9),
          kills: Math.max(0, row.kills - 1),
          placementPoints: Math.max(0, 7 - index),
          totalPoints: Math.max(0, row.kills - 1) + Math.max(0, 7 - index),
          playedAt: "2026-03-01T16:00:00.000Z",
        },
        {
          matchId: PREVIEW_MATCH_ID,
          matchNumber: 4,
          mapName: "Erangel",
          placement: row.rank,
          kills: row.kills,
          placementPoints: placementPointsForRank(row.rank),
          totalPoints: row.kills + placementPointsForRank(row.rank),
          playedAt: "2026-03-01T18:00:00.000Z",
        },
      ],
    };
  }),
};

const PREVIEW_FIGHT_ALERTS: FightAlertPayload[] = [
  {
    matchId: PREVIEW_MATCH_ID,
    fightId: "fight-1",
    teams: [
      {
        teamId: "team-1",
        teamName: "Arenzyra",
        teamTag: "AZ",
        logoUrl: null,
        slot: 3,
      },
      {
        teamId: "team-2",
        teamName: "Nova Legacy",
        teamTag: "NVL",
        logoUrl: null,
        slot: 4,
      },
    ],
    eventCount: 5,
    distance: 38,
    distanceUnit: "m",
    roles: {
      left: "attack",
      right: "defend",
    },
    startedAt: "2026-03-11T19:21:14.000Z",
    lastEventAt: "2026-03-11T19:21:42.000Z",
  },
  {
    matchId: PREVIEW_MATCH_ID,
    fightId: "fight-2",
    teams: [
      {
        teamId: "team-3",
        teamName: "Titan Core",
        teamTag: "TNC",
        logoUrl: null,
        slot: 7,
      },
      {
        teamId: "team-4",
        teamName: "Rogue Apex",
        teamTag: "RGA",
        logoUrl: null,
        slot: 8,
      },
    ],
    eventCount: 4,
    distance: 52,
    distanceUnit: "m",
    roles: {
      left: "trade",
      right: "trade",
    },
    startedAt: "2026-03-11T19:21:12.000Z",
    lastEventAt: "2026-03-11T19:21:40.000Z",
  },
  {
    matchId: PREVIEW_MATCH_ID,
    fightId: "fight-3",
    teams: [
      {
        teamId: "team-5",
        teamName: "Arc Phoenix",
        teamTag: "ARC",
        logoUrl: null,
        slot: 10,
      },
      {
        teamId: "team-6",
        teamName: "Storm Unit",
        teamTag: "STM",
        logoUrl: null,
        slot: 11,
      },
    ],
    eventCount: 3,
    distance: 67,
    distanceUnit: "m",
    roles: {
      left: "defend",
      right: "attack",
    },
    startedAt: "2026-03-11T19:21:10.000Z",
    lastEventAt: "2026-03-11T19:21:38.000Z",
  },
  {
    matchId: PREVIEW_MATCH_ID,
    fightId: "fight-4",
    teams: [
      {
        teamId: "team-7",
        teamName: "Black Harbor",
        teamTag: "BHK",
        logoUrl: null,
        slot: 14,
      },
      {
        teamId: "team-8",
        teamName: "Zenith Nine",
        teamTag: "ZN9",
        logoUrl: null,
        slot: 15,
      },
    ],
    eventCount: 4,
    distance: 81,
    distanceUnit: "m",
    roles: {
      left: "attack",
      right: "defend",
    },
    startedAt: "2026-03-11T19:21:08.000Z",
    lastEventAt: "2026-03-11T19:21:34.000Z",
  },
  {
    matchId: PREVIEW_MATCH_ID,
    fightId: "fight-5",
    teams: [
      {
        teamId: "team-9",
        teamName: "Quantum Rise",
        teamTag: "QTR",
        logoUrl: null,
        slot: 18,
      },
      {
        teamId: "team-10",
        teamName: "Orbit Wolves",
        teamTag: "ORB",
        logoUrl: null,
        slot: 19,
      },
    ],
    eventCount: 2,
    distance: 96,
    distanceUnit: "m",
    roles: {
      left: "defend",
      right: "attack",
    },
    startedAt: "2026-03-11T19:21:04.000Z",
    lastEventAt: "2026-03-11T19:21:28.000Z",
  },
];

const PREVIEW_FIGHT_ALERT = PREVIEW_FIGHT_ALERTS[0];

function normalizeWidgetSourceMode(raw?: string | null): WidgetSourceMode {
  const source = (raw ?? "").trim().toUpperCase();
  if (source === "PCOB") return "PCOB";
  if (source === "HYBRID") return "HYBRID";
  if (source === "MANUAL") return "MANUAL";
  return "AUTO";
}

function getWidgetControlSourceValue(
  control?: MatchRuntimeControlSnapshot | null,
) {
  const values = [
    control?.binding?.telemetryProvider,
    control?.binding?.sourceMode,
    control?.binding?.dataSource,
    control?.binding?.dataMode,
  ];

  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

const PREVIEW_LEADERBOARD_FIGHT_MARKERS: Record<
  string,
  {
    kind: "attack" | "defend" | "trade";
    label: string;
    color: string;
  }
> = {
  "team-1": {
    kind: "attack",
    label: "â–¶",
    color: "#ff8b5c",
  },
  "team-2": {
    kind: "defend",
    label: "â—€",
    color: "#ffd36a",
  },
  "team-3": {
    kind: "trade",
    label: "â‡„",
    color: "#8fd8ff",
  },
  "team-4": {
    kind: "trade",
    label: "â‡„",
    color: "#8fd8ff",
  },
};

const PREVIEW_ACHIEVEMENT_PRESETS: ObserverAchievementPayload[] = [
  {
    matchId: PREVIEW_MATCH_ID,
    eventId: "preview-achievement-1",
    type: "TRIPLE_KILL",
    player: {
      id: "preview-player-1",
      name: "AZ Haze",
      photoUrl: null,
    },
    team: {
      id: "team-1",
      name: "Arenzyra",
      tag: "AZ",
      logoUrl: null,
    },
    timestamp: "2026-03-11T19:21:15.000Z",
  },
  {
    matchId: PREVIEW_MATCH_ID,
    eventId: "preview-achievement-2",
    type: "GRENADE_KILL",
    player: {
      id: "preview-player-2",
      name: "NVL Frost",
      photoUrl: null,
    },
    team: {
      id: "team-2",
      name: "Nova Legacy",
      tag: "NVL",
      logoUrl: null,
    },
    timestamp: "2026-03-11T19:21:20.000Z",
  },
  {
    matchId: PREVIEW_MATCH_ID,
    eventId: "preview-achievement-3",
    type: "TEAM_WIPE",
    player: {
      id: "preview-player-3",
      name: "RGO Ash",
      photoUrl: null,
    },
    team: {
      id: "team-3",
      name: "Rogue Orbit",
      tag: "RGO",
      logoUrl: null,
    },
    timestamp: "2026-03-11T19:21:25.000Z",
  },
  {
    matchId: PREVIEW_MATCH_ID,
    eventId: "preview-achievement-4",
    type: "CLUTCH",
    player: {
      id: "preview-player-4",
      name: "TNC Vale",
      photoUrl: null,
    },
    team: {
      id: "team-4",
      name: "Titan Circle",
      tag: "TNC",
      logoUrl: null,
    },
    timestamp: "2026-03-11T19:21:30.000Z",
  },
  {
    matchId: PREVIEW_MATCH_ID,
    eventId: "preview-achievement-5",
    type: "QUADRA_KILL",
    player: {
      id: "preview-player-5",
      name: "APX Rune",
      photoUrl: null,
    },
    team: {
      id: "team-5",
      name: "Apex Horizon",
      tag: "APX",
      logoUrl: null,
    },
    timestamp: "2026-03-11T19:21:35.000Z",
  },
  {
    matchId: PREVIEW_MATCH_ID,
    eventId: "preview-achievement-6",
    type: "VEHICLE_KILL",
    player: {
      id: "preview-player-6",
      name: "ARC Drift",
      photoUrl: null,
    },
    team: {
      id: "team-6",
      name: "Arc Raiders",
      tag: "ARC",
      logoUrl: null,
    },
    timestamp: "2026-03-11T19:21:40.000Z",
  },
];

const PREVIEW_TEAM_ELIMINATION_PRESETS: ObserverTeamEliminationPayload[] = [
  {
    matchId: PREVIEW_MATCH_ID,
    eventId: "preview-elim-1",
    teamId: "team-6",
    teamName: "Lunar Wolves",
    kills: 4,
    placement: 16,
    eliminatedAt: "2026-03-11T19:21:26.000Z",
  },
  {
    matchId: PREVIEW_MATCH_ID,
    eventId: "preview-elim-2",
    teamId: "team-5",
    teamName: "Apex Horizon",
    kills: 7,
    placement: 11,
    eliminatedAt: "2026-03-11T19:21:31.000Z",
  },
  {
    matchId: PREVIEW_MATCH_ID,
    eventId: "preview-elim-3",
    teamId: "team-4",
    teamName: "Titan Circle",
    kills: 9,
    placement: 7,
    eliminatedAt: "2026-03-11T19:21:38.000Z",
  },
];

function emptyMatchState(matchId: string | null): MatchStatePayload {
  return {
    matchId: matchId ?? PREVIEW_MATCH_ID,
    updatedAt: new Date().toISOString(),
    teamsAlive: 0,
    leaderboard: [],
    killFeed: [],
    playerCard: null,
    circle: null,
    winner: null,
  };
}

function parseStateTimestamp(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildLeaderboardSocketState(
  payload: ObserverStateUpdatePayload,
): MatchStatePayload {
  return {
    ...emptyMatchState(payload.matchId),
    matchId: payload.matchId,
    updatedAt: payload.timestamp,
    teamsAlive:
      typeof payload.teamsAlive === "number" && Number.isFinite(payload.teamsAlive)
        ? Math.max(0, Math.floor(payload.teamsAlive))
        : 0,
    leaderboard: Array.isArray(payload.leaderboard) ? payload.leaderboard : [],
  };
}

function normalizeKillFeedEntries(
  entries: MatchStateKillFeedEntry[],
): MatchStateKillFeedEntry[] {
  const seen = new Set<string>();
  const deduped: MatchStateKillFeedEntry[] = [];

  for (const entry of entries) {
    const entryId = entry.id?.trim();
    if (!entryId || seen.has(entryId)) {
      continue;
    }

    seen.add(entryId);
    deduped.push(entry);
  }

  return deduped;
}

function buildKillFeedRestState(
  payload: MatchStatePayload,
): MatchStatePayload {
  return {
    ...emptyMatchState(payload.matchId),
    matchId: payload.matchId,
    updatedAt: payload.updatedAt,
    killFeed: normalizeKillFeedEntries(payload.killFeed ?? []),
  };
}

function buildKillFeedSocketState(
  payload: ObserverKillFeedUpdatePayload,
  entries = normalizeKillFeedEntries(
    payload.entries.map<MatchStateKillFeedEntry>((entry) => ({
      id: entry.id,
      killerPlayerId: entry.killerPlayerId,
      killerName: entry.killerName,
      killerTeamId: entry.killerTeamId,
      killerTeam: entry.killerTeamName,
      victimPlayerId: entry.victimPlayerId,
      victimName: entry.victimName,
      victimTeamId: entry.victimTeamId,
      victimTeam: entry.victimTeamName,
      weapon: entry.weapon,
      tsIso: entry.timestamp,
      isKnock: entry.isKnock,
      isThirst: entry.isThirst,
      isSelf: entry.isSelf,
      isZone: entry.isZone,
      isReviveRelated: entry.isReviveRelated,
    })),
  ),
): MatchStatePayload {
  return {
    ...emptyMatchState(payload.matchId),
    matchId: payload.matchId,
    updatedAt: payload.emittedAt,
    killFeed: entries,
  };
}

function toWinnerFromLeaderboardRow(
  row: MatchStateLeaderboardRow | null | undefined,
): MatchStateWinner | null {
  if (!row) {
    return null;
  }

  return {
    teamId: row.teamId ?? null,
    slot: row.slot ?? null,
    teamName: row.teamName,
    teamTag: row.teamTag ?? null,
    logoUrl: row.logoUrl ?? null,
    color: row.color ?? null,
    kills: row.kills ?? 0,
    alivePlayers: row.alivePlayers ?? 0,
    placement: row.placement ?? row.rank ?? null,
  };
}

function isMatchStatePayload(value: unknown): value is MatchStatePayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<MatchStatePayload>;
  return (
    typeof candidate.matchId === "string" &&
    Array.isArray(candidate.leaderboard) &&
    Array.isArray(candidate.killFeed)
  );
}

function isObserverStateUpdatePayload(
  value: unknown,
): value is ObserverStateUpdatePayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ObserverStateUpdatePayload>;
  return (
    typeof candidate.matchId === "string" &&
    Array.isArray(candidate.leaderboard) &&
    typeof candidate.timestamp === "string" &&
    typeof candidate.teamsAlive === "number"
  );
}

function isObserverKillFeedUpdatePayload(
  value: unknown,
): value is ObserverKillFeedUpdatePayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ObserverKillFeedUpdatePayload>;
  return (
    typeof candidate.matchId === "string" &&
    Array.isArray(candidate.entries) &&
    typeof candidate.sequence === "number" &&
    typeof candidate.emittedAt === "string"
  );
}

function isObserverMatchFinishedPayload(
  value: unknown,
): value is ObserverMatchFinishedPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ObserverMatchFinishedPayload>;
  return (
    typeof candidate.matchId === "string" &&
    Array.isArray(candidate.finalLeaderboard) &&
    typeof candidate.finishedAt === "string" &&
    (typeof candidate.winnerTeamId === "string" ||
      candidate.winnerTeamId === null ||
      candidate.winnerTeamId === undefined) &&
    (typeof candidate.winnerTeamName === "string" ||
      candidate.winnerTeamName === null ||
      candidate.winnerTeamName === undefined)
  );
}

function isRealtimeLiveMatchPayload(
  value: unknown,
): value is RealtimeLiveMatchPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<RealtimeLiveMatchPayload>;
  return (
    typeof candidate.matchId === "string" &&
    Array.isArray(candidate.teams) &&
    !Array.isArray((candidate as Partial<MatchStatePayload>).leaderboard)
  );
}

function payloadHasData(payload: MatchStatePayload | null | undefined): boolean {
  if (!payload) return false;
  return (
    payload.teamsAlive > 0 ||
    payload.leaderboard.length > 0 ||
    payload.killFeed.length > 0 ||
    payload.playerCard !== null ||
    payload.circle !== null ||
    payload.winner !== null
  );
}

const DIRECT_LEADERBOARD_STALE_MS = 3_000;

function normalizeObserverTeamIdentity(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function compactObserverTeamIdentity(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeObserverTeamIdentity(value);
  if (!normalized) {
    return null;
  }

  const compact = normalized.replace(/[^a-z0-9]+/g, "");
  return compact.length > 0 ? compact : null;
}

function isPlaceholderObserverTeamIdentity(
  value: string | null | undefined,
): boolean {
  const compact = compactObserverTeamIdentity(value);
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

function hasMeaningfulObserverTeamIdentity(
  value: string | null | undefined,
): boolean {
  const normalized = normalizeObserverTeamIdentity(value);
  return Boolean(normalized) && !isPlaceholderObserverTeamIdentity(normalized);
}

function buildObserverLeaderboardFallbackLookup(
  payload: MatchStatePayload | null | undefined,
) {
  const byTeamId = new Map<string, MatchStateLeaderboardRow>();
  const bySlot = new Map<number, MatchStateLeaderboardRow>();

  for (const row of payload?.leaderboard ?? []) {
    if (row.teamId && !byTeamId.has(row.teamId)) {
      byTeamId.set(row.teamId, row);
    }
    if (typeof row.slot === "number" && Number.isFinite(row.slot) && !bySlot.has(row.slot)) {
      bySlot.set(row.slot, row);
    }
  }

  return { byTeamId, bySlot };
}

function payloadDowngradesObserverIdentity(
  payload: MatchStatePayload | null | undefined,
  fallbackPayload: MatchStatePayload | null | undefined,
): boolean {
  if (!payload || !fallbackPayload || fallbackPayload.leaderboard.length === 0) {
    return false;
  }

  const fallbackLookup = buildObserverLeaderboardFallbackLookup(fallbackPayload);
  for (const row of payload.leaderboard) {
    const fallbackRow =
      (row.teamId ? fallbackLookup.byTeamId.get(row.teamId) : undefined) ??
      (typeof row.slot === "number" && Number.isFinite(row.slot)
        ? fallbackLookup.bySlot.get(row.slot)
        : undefined) ??
      null;
    if (!fallbackRow) {
      continue;
    }

    const nameDowngraded =
      !hasMeaningfulObserverTeamIdentity(row.teamName) &&
      hasMeaningfulObserverTeamIdentity(fallbackRow.teamName);
    const tagDowngraded =
      Boolean(row.teamTag) &&
      isPlaceholderObserverTeamIdentity(row.teamTag) &&
      hasMeaningfulObserverTeamIdentity(fallbackRow.teamTag);

    if (nameDowngraded || tagDowngraded) {
      return true;
    }
  }

  return false;
}

function isObserverPayloadFresh(
  payload:
    | MatchStatePayload
    | ObserverLeaderboardPayload
    | null
    | undefined,
  nowTs: number,
  maxAgeMs = DIRECT_LEADERBOARD_STALE_MS,
): boolean {
  if (!payloadHasData(payload as MatchStatePayload | null | undefined)) {
    return false;
  }

  const updatedAt = parseStateTimestamp(payload?.updatedAt);
  if (updatedAt <= 0) {
    return false;
  }

  return nowTs - updatedAt <= maxAgeMs;
}

function shouldRenderDirectLeaderboard(
  payload: MatchStatePayload | null | undefined,
  nowTs: number,
  fallbackPayload?: MatchStatePayload | null,
): boolean {
  if (!isObserverPayloadFresh(payload, nowTs)) {
    return false;
  }
  if (!payload || payload.leaderboard.length === 0) {
    return false;
  }
  if (payload.teamsAlive <= 1) {
    return false;
  }
  if (payloadDowngradesObserverIdentity(payload, fallbackPayload)) {
    return false;
  }
  return true;
}

function normalizeMapOverlayKey(value: string | null | undefined) {
  return value
    ?.trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "") ?? "";
}

function resolveLocalMapOverlayAsset(
  value: string | null | undefined,
): MapOverlayConfig | null {
  const normalized = normalizeMapOverlayKey(value);
  if (!normalized) {
    return null;
  }

  const aliases: Record<string, string> = {
    AFTERMATH: "LIVIK_AFTERMATH",
    LIVIKAFTERMATH: "LIVIK_AFTERMATH",
  };

  if (LOCAL_MAP_OVERLAY_ASSETS[normalized]) {
    return LOCAL_MAP_OVERLAY_ASSETS[normalized];
  }
  if (aliases[normalized] && LOCAL_MAP_OVERLAY_ASSETS[aliases[normalized]]) {
    return LOCAL_MAP_OVERLAY_ASSETS[aliases[normalized]];
  }

  const directMatch = Object.entries(LOCAL_MAP_OVERLAY_ASSETS).find(([key]) =>
    normalized.includes(key),
  );
  if (directMatch) {
    return directMatch[1];
  }

  const aliasMatch = Object.entries(aliases).find(([key]) =>
    normalized.includes(key),
  );
  if (aliasMatch) {
    return LOCAL_MAP_OVERLAY_ASSETS[aliasMatch[1]] ?? null;
  }

  return null;
}

function resolveCanonicalMapOverlayWorldSize(
  value: string | null | undefined,
): number | null {
  const normalized = normalizeMapOverlayKey(value);
  if (!normalized) {
    return null;
  }

  const aliases: Record<string, string> = {
    AFTERMATH: "LIVIK_AFTERMATH",
    LIVIKAFTERMATH: "LIVIK_AFTERMATH",
  };
  if (CANONICAL_LIVE_MAP_OVERLAY_WORLD_SIZES[normalized]) {
    return CANONICAL_LIVE_MAP_OVERLAY_WORLD_SIZES[normalized];
  }
  if (
    aliases[normalized] &&
    CANONICAL_LIVE_MAP_OVERLAY_WORLD_SIZES[aliases[normalized]]
  ) {
    return CANONICAL_LIVE_MAP_OVERLAY_WORLD_SIZES[aliases[normalized]] ?? null;
  }

  const directMatch = Object.entries(CANONICAL_LIVE_MAP_OVERLAY_WORLD_SIZES).find(
    ([key]) => normalized.includes(key),
  );
  if (directMatch) {
    return directMatch[1];
  }

  const aliasMatch = Object.entries(aliases).find(([key]) =>
    normalized.includes(key),
  );
  if (aliasMatch) {
    return CANONICAL_LIVE_MAP_OVERLAY_WORLD_SIZES[aliasMatch[1]] ?? null;
  }

  return null;
}

function mapOverlayHasRenderableData(
  payload: MapOverlayPayload | null | undefined,
): boolean {
  return Boolean(
    payload?.map &&
      (payload.circle?.safeZone ||
        payload.circle?.nextZone ||
        payload.flightPath ||
        payload.teamMarkers.length > 0 ||
      payload.playerMarkers.length > 0),
  );
}

function mergeMatchStateCircle(
  primary: MatchStateCircle | null | undefined,
  fallback: MatchStateCircle | null | undefined,
): MatchStateCircle | null {
  if (!primary && !fallback) {
    return null;
  }

  return {
    phase: primary?.phase ?? fallback?.phase ?? null,
    status: primary?.status ?? fallback?.status ?? null,
    counterSeconds: primary?.counterSeconds ?? fallback?.counterSeconds ?? null,
    maxTimeSeconds: primary?.maxTimeSeconds ?? fallback?.maxTimeSeconds ?? null,
    nextShrinkAt: primary?.nextShrinkAt ?? fallback?.nextShrinkAt ?? null,
    safeZone: primary?.safeZone ?? fallback?.safeZone ?? null,
    nextZone: primary?.nextZone ?? fallback?.nextZone ?? null,
  };
}

function mergeMapOverlayCircle(
  primary: MapOverlayCircle | null | undefined,
  fallback: MapOverlayCircle | null | undefined,
): MapOverlayCircle | null {
  if (!primary && !fallback) {
    return null;
  }

  return {
    safeZone: primary?.safeZone ?? fallback?.safeZone ?? null,
    nextZone: primary?.nextZone ?? fallback?.nextZone ?? null,
    phaseIndex: primary?.phaseIndex ?? fallback?.phaseIndex ?? null,
    status: primary?.status ?? fallback?.status ?? null,
    counterSeconds:
      primary?.counterSeconds ?? fallback?.counterSeconds ?? null,
    maxTimeSeconds:
      primary?.maxTimeSeconds ?? fallback?.maxTimeSeconds ?? null,
    nextShrinkAt: primary?.nextShrinkAt ?? fallback?.nextShrinkAt ?? null,
    timerRemaining: primary?.timerRemaining ?? fallback?.timerRemaining ?? null,
    timeRemainingToNextPhase:
      primary?.timeRemainingToNextPhase ??
      fallback?.timeRemainingToNextPhase ??
      null,
    phaseLabel: primary?.phaseLabel ?? fallback?.phaseLabel ?? null,
  };
}

function mergeMapOverlayPayload(
  primary: MapOverlayPayload | null | undefined,
  fallback: MapOverlayPayload | null | undefined,
  mapOverride?: MapOverlayConfig | null,
): MapOverlayPayload | null {
  return resolveMapOverlayPayload([primary, fallback], mapOverride).payload;
}

function formatMapOverlaySourceLabel(
  source: MapOverlayPayloadSource | null | undefined,
): string {
  switch (source) {
    case "direct-map":
      return "direct-map";
    case "leaderboard-fallback":
      return "leaderboard-fallback";
    case "runtime-circle":
      return "runtime-circle";
    case "backend-fallback":
      return "backend-fallback";
    case "preview":
      return "preview";
    default:
      return "none";
  }
}

function mapOverlaySourcePriority(
  source: MapOverlayPayloadSource | null | undefined,
): number {
  switch (source) {
    case "direct-map":
      return 5;
    case "backend-fallback":
      return 4;
    case "leaderboard-fallback":
      return 3;
    case "runtime-circle":
      return 2;
    case "preview":
      return 1;
    default:
      return 0;
  }
}

function getMapOverlayPayloadUpdatedAtMs(
  payload: MapOverlayPayload | null | undefined,
): number {
  if (!payload?.updatedAt) {
    return 0;
  }
  return resolveTimestampMs(payload.updatedAt) ?? 0;
}

function compareMapOverlayPayloadFreshness(
  left: MapOverlayPayload | null | undefined,
  right: MapOverlayPayload | null | undefined,
): number {
  const leftUpdatedAtMs = getMapOverlayPayloadUpdatedAtMs(left);
  const rightUpdatedAtMs = getMapOverlayPayloadUpdatedAtMs(right);

  if (leftUpdatedAtMs !== rightUpdatedAtMs) {
    return leftUpdatedAtMs - rightUpdatedAtMs;
  }

  return mapOverlaySourcePriority(left?.source) - mapOverlaySourcePriority(right?.source);
}

function isMapOverlayPayloadFresh(
  payload: MapOverlayPayload | null | undefined,
  nowMs: number,
  maxAgeMs = DIRECT_MAP_OVERLAY_STALE_MS,
): boolean {
  if (!payload) {
    return false;
  }

  const updatedAtMs = getMapOverlayPayloadUpdatedAtMs(payload);
  if (updatedAtMs <= 0) {
    return false;
  }

  return nowMs - updatedAtMs <= maxAgeMs;
}

function mapOverlayCircleHasData(
  circle: MapOverlayCircle | null | undefined,
): boolean {
  if (!circle) {
    return false;
  }

  return Boolean(
    circle.safeZone ||
      circle.nextZone ||
      circle.phaseIndex !== null ||
      circle.status !== null ||
      circle.counterSeconds !== null ||
      circle.maxTimeSeconds !== null ||
      circle.nextShrinkAt !== null,
  );
}

function mapOverlayMarkersHaveData(
  payload: MapOverlayPayload | null | undefined,
): boolean {
  return Boolean(
    payload &&
      (payload.teamMarkers.length > 0 || payload.playerMarkers.length > 0),
  );
}

function pickMapOverlaySectionSource(
  candidates: MapOverlayPayload[],
  predicate: (payload: MapOverlayPayload) => boolean,
): MapOverlayPayload | null {
  for (const payload of candidates) {
    if (predicate(payload)) {
      return payload;
    }
  }

  return null;
}

function resolveMapOverlayPayload(
  candidates: Array<MapOverlayPayload | null | undefined>,
  mapOverride?: MapOverlayConfig | null,
): ResolvedMapOverlayPayload {
  const availableCandidates = candidates
    .filter((payload): payload is MapOverlayPayload => payload !== null && payload !== undefined)
    .sort((left, right) => compareMapOverlayPayloadFreshness(right, left));

  if (availableCandidates.length === 0 && !mapOverride) {
    return {
      payload: null,
      selection: {
        overall: null,
        map: null,
        circle: null,
        flightPath: null,
        markers: null,
      },
    };
  }

  const mapSource =
    pickMapOverlaySectionSource(availableCandidates, (payload) => payload.map !== null) ??
    null;
  const circleSource =
    pickMapOverlaySectionSource(availableCandidates, (payload) =>
      mapOverlayCircleHasData(payload.circle),
    ) ?? null;
  const flightPathSource =
    pickMapOverlaySectionSource(
      availableCandidates,
      (payload) => payload.flightPath !== null,
    ) ?? null;
  const markersSource =
    pickMapOverlaySectionSource(availableCandidates, mapOverlayMarkersHaveData) ?? null;
  const selectedPayloads = [
    mapSource,
    circleSource,
    flightPathSource,
    markersSource,
  ].filter((payload): payload is MapOverlayPayload => payload !== null);
  const overallSourcePayload = [...selectedPayloads].sort((left, right) =>
    compareMapOverlayPayloadFreshness(right, left),
  )[0] ?? availableCandidates[0] ?? null;

  return {
    payload: {
      matchId:
        overallSourcePayload?.matchId ??
        availableCandidates[0]?.matchId ??
        PREVIEW_MATCH_ID,
      updatedAt: overallSourcePayload?.updatedAt ?? null,
      source: overallSourcePayload?.source ?? null,
      map: mapSource?.map ?? mapOverride ?? null,
      circle: circleSource?.circle ?? null,
      flightPath: flightPathSource?.flightPath ?? null,
      teamMarkers: markersSource?.teamMarkers ?? [],
      playerMarkers: markersSource?.playerMarkers ?? [],
    },
    selection: {
      overall: overallSourcePayload?.source ?? null,
      map: mapSource?.source ?? null,
      circle: circleSource?.source ?? null,
      flightPath: flightPathSource?.source ?? null,
      markers: markersSource?.source ?? null,
    },
  };
}

function getMapOverlayPayloadSignature(
  payload: MapOverlayPayload | null | undefined,
) {
  if (!payload) {
    return "null";
  }

  return JSON.stringify({
    matchId: payload.matchId,
    updatedAt: payload.updatedAt ?? null,
    source: payload.source ?? null,
    map: payload.map
      ? {
          mapName: payload.map.mapName,
          imageUrl: payload.map.imageUrl,
          worldSize: payload.map.worldSize,
          coordinateSystem: payload.map.coordinateSystem,
          notes: payload.map.notes ?? null,
        }
      : null,
    circle: payload.circle
      ? {
          safeZone: payload.circle.safeZone,
          nextZone: payload.circle.nextZone,
          phaseIndex: payload.circle.phaseIndex,
          status: payload.circle.status,
          counterSeconds: payload.circle.counterSeconds,
          maxTimeSeconds: payload.circle.maxTimeSeconds,
          nextShrinkAt: payload.circle.nextShrinkAt,
          timerRemaining: payload.circle.timerRemaining,
          timeRemainingToNextPhase: payload.circle.timeRemainingToNextPhase,
          phaseLabel: payload.circle.phaseLabel,
        }
      : null,
    flightPath: payload.flightPath,
    teamMarkers: payload.teamMarkers.map((marker) => ({
      teamId: marker.teamId ?? null,
      x: marker.x,
      y: marker.y,
      alive: marker.alive ?? null,
      playerCount: marker.playerCount,
      alivePlayers: marker.alivePlayers,
    })),
    playerMarkers: payload.playerMarkers.map((marker) => ({
      playerId: marker.playerId ?? null,
      teamId: marker.teamId ?? null,
      x: marker.x,
      y: marker.y,
      alive: marker.alive ?? null,
      knocked: marker.knocked ?? null,
    })),
  });
}

function clampMapOverlay(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeMapOverlayRawPoint(
  x: number,
  y: number,
  worldSize: number,
  coordinateSystem: MapOverlayConfig["coordinateSystem"] = "WORLD",
) {
  const normalizedCoordinateEpsilon = 0.001;
  const usesNormalizedCoordinates =
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= -normalizedCoordinateEpsilon &&
    x <= 1 + normalizedCoordinateEpsilon &&
    y >= -normalizedCoordinateEpsilon &&
    y <= 1 + normalizedCoordinateEpsilon;

  if (usesNormalizedCoordinates) {
    return {
      x: clampMapOverlay(x, 0, 1),
      y: clampMapOverlay(y, 0, 1),
    };
  }

  const safeWorldSize = Number.isFinite(worldSize) && worldSize > 0 ? worldSize : 1;
  const normalizedX = clampMapOverlay(x / safeWorldSize, 0, 1);
  const normalizedY = clampMapOverlay(y / safeWorldSize, 0, 1);

  return {
    x: normalizedX,
    y:
      coordinateSystem === "WORLD_BOTTOM_LEFT"
        ? clampMapOverlay(1 - normalizedY, 0, 1)
        : normalizedY,
  };
}

function applyMapOverlayCalibration(
  normalizedX: number,
  normalizedY: number,
  mapName: string | null | undefined,
) {
  const calibration =
    normalizeMapOverlayKey(mapName) === "ERANGEL"
      ? MAP_CALIBRATION.ERANGEL
      : {
          left: 0,
          right: 1,
          top: 0,
          bottom: 1,
        };

  const mappedX =
    calibration.left + normalizedX * (calibration.right - calibration.left);
  const mappedY =
    calibration.top + normalizedY * (calibration.bottom - calibration.top);

  return {
    mappedX: clampMapOverlay(mappedX, 0, 1),
    mappedY: clampMapOverlay(mappedY, 0, 1),
  };
}

function normalizeMapOverlayPoint(
  x: number,
  y: number,
  worldSize: number,
  coordinateSystem: MapOverlayConfig["coordinateSystem"] = "WORLD",
  mapName: string | null | undefined = null,
) {
  const rawPoint = normalizeMapOverlayRawPoint(
    x,
    y,
    worldSize,
    coordinateSystem,
  );
  const calibratedPoint = applyMapOverlayCalibration(
    rawPoint.x,
    rawPoint.y,
    mapName,
  );

  return {
    rawX: rawPoint.x,
    rawY: rawPoint.y,
    mappedX: calibratedPoint.mappedX,
    mappedY: calibratedPoint.mappedY,
    left: clampMapOverlay(calibratedPoint.mappedX * 100, 0, 100),
    top: clampMapOverlay(calibratedPoint.mappedY * 100, 0, 100),
  };
}

function normalizeMapOverlayFlightPathPoint(
  x: number,
  y: number,
  worldSize: number,
  coordinateSystem: MapOverlayConfig["coordinateSystem"] = "WORLD",
  mapName: string | null | undefined = null,
) {
  return normalizeMapOverlayPoint(x, y, worldSize, coordinateSystem, mapName);
}

function buildMapOverlayCoordinateDebugSamples(
  payload: MapOverlayPayload | null | undefined,
  detectedWorldSize: MapOverlayDetectedWorldSize | null,
) {
  if (!payload || detectedWorldSize === null) {
    return [];
  }

  const coordinateSystem =
    payload.map?.coordinateSystem ?? "WORLD_BOTTOM_LEFT";

  return payload.playerMarkers
    .filter(
      (marker) => Number.isFinite(marker.x) && Number.isFinite(marker.y),
    )
    .slice(0, 3)
    .map((marker) => {
      const normalizedX = scaleMapOverlayCoordinateToRenderWorld(
        marker.x,
        detectedWorldSize,
      );
      const normalizedY = scaleMapOverlayCoordinateToRenderWorld(
        marker.y,
        detectedWorldSize,
      );
      const point = normalizeMapOverlayPoint(
        normalizedX,
        normalizedY,
        MAP_OVERLAY_RENDER_WORLD_SIZE,
        coordinateSystem,
        payload.map?.mapName ?? null,
      );

      return {
        playerId: marker.playerId ?? null,
        teamId: marker.teamId ?? null,
        rawX: Math.round(marker.x),
        rawY: Math.round(marker.y),
        normalizedX: Number(normalizedX.toFixed(2)),
        normalizedY: Number(normalizedY.toFixed(2)),
        left: Number(point.left.toFixed(2)),
        top: Number(point.top.toFixed(2)),
      };
    });
}

function buildPubgmBlueZoneMaskStyle(
  point: { left: number; top: number },
  diameter: number,
  clean = false,
): CSSProperties {
  const radius = Math.max(diameter / 2, 0);
  const clearStop = Math.max(radius - 0.5, 0);
  const edgeStop = Math.max(radius + 0.45, 0);
  const glowStop = Math.min(radius + 6.2, 100);

  return {
    background: [
      `radial-gradient(circle at ${point.left}% ${point.top}%, transparent 0%, transparent ${clearStop}%, ${alphaColor(
        "#f7fbff",
        0.14,
      )} ${Math.max(radius - 0.1, 0)}%, ${alphaColor("#8bd7ff", 0.24)} ${Math.max(
        radius + 0.1,
        0,
      )}%, ${alphaColor("#4497ff", 0.54)} ${edgeStop}%, ${alphaColor(
        "#2058d4",
        clean ? 0.3 : 0.38,
      )} ${glowStop}%, ${alphaColor("#163a99", clean ? 0.24 : 0.3)} 100%)`,
      `radial-gradient(circle at ${point.left}% ${point.top}%, transparent 0%, transparent ${Math.max(
        radius - 1.4,
        0,
      )}%, ${alphaColor("#86e7ff", 0.08)} ${Math.max(radius + 1.8, 0)}%, transparent ${Math.max(
        radius + 5.4,
        0,
      )}%)`,
    ].join(", "),
  };
}

function buildPubgmSafeZoneGlowStyle(
  point: { left: number; top: number },
  diameter: number,
): CSSProperties {
  return {
    left: `${point.left}%`,
    top: `${point.top}%`,
    width: `${diameter}%`,
    height: `${diameter}%`,
    transform: "translate(-50%, -50%) scale(1.01)",
    border: `1px solid ${alphaColor("#7fd2ff", 0.34)}`,
    boxShadow: `0 0 0 1px ${alphaColor("#9fdfff", 0.12)}, 0 0 22px ${alphaColor(
      "#58aeff",
      0.18,
    )}`,
  };
}

function buildPubgmSafeZoneRingStyle(
  point: { left: number; top: number },
  diameter: number,
): CSSProperties {
  return {
    left: `${point.left}%`,
    top: `${point.top}%`,
    width: `${diameter}%`,
    height: `${diameter}%`,
    transform: "translate(-50%, -50%)",
    borderColor: alphaColor("#ffffff", 0.96),
    boxShadow: `0 0 0 1px ${alphaColor("#ffffff", 0.14)}, inset 0 0 0 1px ${alphaColor(
      "#ffffff",
      0.1,
    )}`,
  };
}

function buildPubgmNextZoneRingStyle(
  point: { left: number; top: number },
  diameter: number,
): CSSProperties {
  return {
    left: `${point.left}%`,
    top: `${point.top}%`,
    width: `${diameter}%`,
    height: `${diameter}%`,
    transform: "translate(-50%, -50%)",
    borderColor: alphaColor("#ffffff", 0.76),
    boxShadow: `0 0 0 1px ${alphaColor("#102044", 0.08)}, 0 0 18px ${alphaColor(
      "#ffffff",
      0.06,
    )}`,
  };
}

function interpolateMapOverlayZone(
  from: { x: number; y: number; r: number },
  to: { x: number; y: number; r: number },
  progress: number,
) {
  const safeProgress = clampMapOverlay(progress, 0, 1);
  return {
    x: from.x + (to.x - from.x) * safeProgress,
    y: from.y + (to.y - from.y) * safeProgress,
    r: from.r + (to.r - from.r) * safeProgress,
  };
}

function resolveMapOverlayClosingProgress(
  circle: MapOverlayCircle | null | undefined,
  nowMs: number,
) {
  if (!circle || resolveNextZoneMode(circle.status ?? null) !== "closing") {
    return null;
  }

  const maxTimeSeconds = circle.maxTimeSeconds;
  if (
    typeof maxTimeSeconds !== "number" ||
    !Number.isFinite(maxTimeSeconds) ||
    maxTimeSeconds <= 0
  ) {
    return null;
  }

  const nextShrinkAtMs = resolveTimestampMs(circle.nextShrinkAt ?? null);
  if (nextShrinkAtMs !== null && Number.isFinite(nowMs)) {
    const remainingSeconds = Math.max(0, (nextShrinkAtMs - nowMs) / 1000);
    return clampMapOverlay(1 - remainingSeconds / maxTimeSeconds, 0, 1);
  }

  const counterSeconds = circle.counterSeconds;
  if (
    typeof counterSeconds === "number" &&
    Number.isFinite(counterSeconds) &&
    counterSeconds >= 0
  ) {
    return clampMapOverlay(counterSeconds / maxTimeSeconds, 0, 1);
  }

  return null;
}

function resolveRenderedMapOverlaySafeZone(
  circle: MapOverlayCircle | null | undefined,
  nowMs: number,
) {
  const safeZone = circle?.safeZone ?? null;
  const nextZone = circle?.nextZone ?? null;
  if (!safeZone || !nextZone) {
    return safeZone;
  }

  const closingProgress = resolveMapOverlayClosingProgress(circle, nowMs);
  if (closingProgress === null) {
    return safeZone;
  }

  return interpolateMapOverlayZone(safeZone, nextZone, closingProgress);
}

function buildMapOverlayPreviewPayload(
  mapName: string | null,
  matchId: string | null,
): MapOverlayPayload {
  const fallbackMap =
    resolveLocalMapOverlayAsset(mapName) ?? PREVIEW_MAP_OVERLAY_STATE.map;

  return {
    ...PREVIEW_MAP_OVERLAY_STATE,
    matchId: matchId ?? PREVIEW_MATCH_ID,
    map: fallbackMap,
  };
}

function deriveEffectiveMapOverlayWorldSize(
  baseWorldSize: number | null | undefined,
  points: Array<{ x: number; y: number }>,
  circles: Array<{ x: number; y: number; r: number } | null | undefined>,
  flightPath?: MapOverlayPayload["flightPath"],
) {
  const base =
    typeof baseWorldSize === "number" && Number.isFinite(baseWorldSize)
      ? baseWorldSize
      : null;
  if (!base) {
    return null;
  }
  return base;
}

function scaleMapOverlayCoordinateToRenderWorld(
  value: number,
  detectedWorldSize: MapOverlayDetectedWorldSize,
) {
  return detectedWorldSize === MAP_OVERLAY_FULL_COORDINATE_WORLD_SIZE
    ? value / MAP_OVERLAY_FULL_COORDINATE_DIVISOR
    : value;
}

function detectMapOverlayPayloadWorldSize(
  payload: MapOverlayPayload | null | undefined,
): MapOverlayDetectedWorldSize | null {
  if (!payload) {
    return null;
  }

  let observedMax =
    typeof payload.map?.worldSize === "number" &&
    Number.isFinite(payload.map.worldSize)
      ? Math.abs(payload.map.worldSize)
      : 0;

  for (const marker of payload.playerMarkers) {
    observedMax = Math.max(observedMax, Math.abs(marker.x), Math.abs(marker.y));
  }
  for (const marker of payload.teamMarkers) {
    observedMax = Math.max(observedMax, Math.abs(marker.x), Math.abs(marker.y));
  }
  for (const zone of [payload.circle?.safeZone ?? null, payload.circle?.nextZone ?? null]) {
    if (!zone) {
      continue;
    }
    observedMax = Math.max(
      observedMax,
      Math.abs(zone.x),
      Math.abs(zone.y),
      Math.abs(zone.r),
    );
  }
  if (payload.flightPath) {
    observedMax = Math.max(
      observedMax,
      Math.abs(payload.flightPath.start.x),
      Math.abs(payload.flightPath.start.y),
      Math.abs(payload.flightPath.end.x),
      Math.abs(payload.flightPath.end.y),
    );
  }

  if (!Number.isFinite(observedMax) || observedMax <= 0) {
    return null;
  }

  return observedMax > MAP_OVERLAY_FULL_COORDINATE_THRESHOLD
    ? MAP_OVERLAY_FULL_COORDINATE_WORLD_SIZE
    : MAP_OVERLAY_COMPACT_COORDINATE_WORLD_SIZE;
}

function detectMapOverlayWorldSizeFromCandidates(
  candidates: Array<MapOverlayPayload | null | undefined>,
): MapOverlayDetectedWorldSize | null {
  for (const candidate of candidates) {
    const detectedWorldSize = detectMapOverlayPayloadWorldSize(candidate);
    if (detectedWorldSize !== null) {
      return detectedWorldSize;
    }
  }

  return null;
}

function normalizeMapOverlayPayloadForRender(
  payload: MapOverlayPayload | null | undefined,
  lockedDetectedWorldSize: MapOverlayDetectedWorldSize | null,
): MapOverlayPayload | null {
  if (!payload) {
    return null;
  }

  const detectedWorldSize =
    detectMapOverlayPayloadWorldSize(payload) ??
    lockedDetectedWorldSize ??
    MAP_OVERLAY_COMPACT_COORDINATE_WORLD_SIZE;

  const normalizePoint = (point: { x: number; y: number } | null | undefined) =>
    point
      ? {
          x: scaleMapOverlayCoordinateToRenderWorld(point.x, detectedWorldSize),
          y: scaleMapOverlayCoordinateToRenderWorld(point.y, detectedWorldSize),
        }
      : null;
  const normalizeZone = (
    zone: { x: number; y: number; r: number } | null | undefined,
  ) =>
    zone
      ? {
          x: scaleMapOverlayCoordinateToRenderWorld(zone.x, detectedWorldSize),
          y: scaleMapOverlayCoordinateToRenderWorld(zone.y, detectedWorldSize),
          r: scaleMapOverlayCoordinateToRenderWorld(zone.r, detectedWorldSize),
        }
      : null;

  return {
    ...payload,
    map: payload.map
      ? {
          ...payload.map,
          worldSize: MAP_OVERLAY_RENDER_WORLD_SIZE,
        }
      : payload.map,
    circle: payload.circle
      ? {
          ...payload.circle,
          safeZone: normalizeZone(payload.circle.safeZone),
          nextZone: normalizeZone(payload.circle.nextZone),
        }
      : payload.circle,
    flightPath: payload.flightPath
      ? {
          ...payload.flightPath,
          start: normalizePoint(payload.flightPath.start)!,
          end: normalizePoint(payload.flightPath.end)!,
        }
      : payload.flightPath,
    teamMarkers: payload.teamMarkers.map((marker) => ({
      ...marker,
      x: scaleMapOverlayCoordinateToRenderWorld(marker.x, detectedWorldSize),
      y: scaleMapOverlayCoordinateToRenderWorld(marker.y, detectedWorldSize),
    })),
    playerMarkers: payload.playerMarkers.map((marker) => ({
      ...marker,
      x: scaleMapOverlayCoordinateToRenderWorld(marker.x, detectedWorldSize),
      y: scaleMapOverlayCoordinateToRenderWorld(marker.y, detectedWorldSize),
    })),
  };
}

function clipLineToMapBounds(
  point: { x: number; y: number },
  direction: { x: number; y: number },
  worldSize: number,
): { start: { x: number; y: number }; end: { x: number; y: number } } | null {
  const intersections: Array<{ x: number; y: number; t: number }> = [];
  const epsilon = 1e-6;

  const pushIntersection = (t: number) => {
    const x = point.x + direction.x * t;
    const y = point.y + direction.y * t;
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < -epsilon ||
      x > worldSize + epsilon ||
      y < -epsilon ||
      y > worldSize + epsilon
    ) {
      return;
    }
    const clampedX = clampMapOverlay(x, 0, worldSize);
    const clampedY = clampMapOverlay(y, 0, worldSize);
    const duplicate = intersections.some(
      (candidate) =>
        Math.abs(candidate.x - clampedX) < 1 &&
        Math.abs(candidate.y - clampedY) < 1,
    );
    if (!duplicate) {
      intersections.push({ x: clampedX, y: clampedY, t });
    }
  };

  if (Math.abs(direction.x) > epsilon) {
    pushIntersection((0 - point.x) / direction.x);
    pushIntersection((worldSize - point.x) / direction.x);
  }
  if (Math.abs(direction.y) > epsilon) {
    pushIntersection((0 - point.y) / direction.y);
    pushIntersection((worldSize - point.y) / direction.y);
  }

  if (intersections.length < 2) {
    return null;
  }

  intersections.sort((left, right) => left.t - right.t);
  const start = intersections[0];
  const end = intersections[intersections.length - 1];
  if (!start || !end) {
    return null;
  }

  return {
    start: { x: start.x, y: start.y },
    end: { x: end.x, y: end.y },
  };
}

function inferFlightPathFromDirectPayload(
  payload: ObserverLeaderboardPayload | null | undefined,
  worldSizeHint: number | null | undefined,
): { start: { x: number; y: number }; end: { x: number; y: number } } | null {
  if (!payload) {
    return null;
  }

  const phase = payload.circle?.phase ?? null;
  if (phase !== null && phase > 1) {
    return null;
  }

  const samples = payload.leaderboard.flatMap((row) =>
    (row.players ?? [])
      .filter(
        (player) => directPlayerHasMapPosition(player) && player.alive === true,
      )
      .map((player) => ({
        x: player.x as number,
        y: player.y as number,
      })),
  );
  if (samples.length < 12) {
    return null;
  }

  const worldSize =
    typeof worldSizeHint === "number" && Number.isFinite(worldSizeHint)
      ? worldSizeHint
      : 8000;
  const mean = samples.reduce(
    (acc, sample) => {
      acc.x += sample.x;
      acc.y += sample.y;
      return acc;
    },
    { x: 0, y: 0 },
  );
  mean.x /= samples.length;
  mean.y /= samples.length;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const sample of samples) {
    const dx = sample.x - mean.x;
    const dy = sample.y - mean.y;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  const trace = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const discriminant = Math.max(0, trace * trace - 4 * det);
  const eigenValue = (trace + Math.sqrt(discriminant)) / 2;
  let direction =
    Math.abs(sxy) > 1e-6
      ? { x: eigenValue - syy, y: sxy }
      : sxx >= syy
        ? { x: 1, y: 0 }
        : { x: 0, y: 1 };
  const magnitude = Math.hypot(direction.x, direction.y);
  if (!Number.isFinite(magnitude) || magnitude <= 1e-6) {
    return null;
  }
  direction = {
    x: direction.x / magnitude,
    y: direction.y / magnitude,
  };

  const projections = samples.map(
    (sample) =>
      (sample.x - mean.x) * direction.x + (sample.y - mean.y) * direction.y,
  );
  const span = Math.max(...projections) - Math.min(...projections);
  if (!Number.isFinite(span) || span < worldSize * 0.12) {
    return null;
  }

  return clipLineToMapBounds(mean, direction, worldSize);
}

function directPlayerHasMapPosition(
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

function countObserverLeaderboardPlayers(
  payload: ObserverLeaderboardPayload | null | undefined,
): { totalPlayers: number; positionedPlayers: number } {
  if (!payload) {
    return { totalPlayers: 0, positionedPlayers: 0 };
  }

  let totalPlayers = 0;
  let positionedPlayers = 0;
  for (const row of payload.leaderboard) {
    for (const player of row.players ?? []) {
      totalPlayers += 1;
      if (directPlayerHasMapPosition(player)) {
        positionedPlayers += 1;
      }
    }
  }

  return {
    totalPlayers,
    positionedPlayers,
  };
}

function resolveObserverDirectMapPayloadSource(
  payload: ObserverDirectMapOverlayPayload | null | undefined,
): MapOverlayPayloadSource {
  return payload?.debug?.producer === "observer-leaderboard-derived-fallback"
    ? "leaderboard-fallback"
    : "direct-map";
}

function buildMapOverlayPayloadFromDirect(
  mapName: string | null,
  matchId: string | null,
  payload: ObserverLeaderboardPayload | null | undefined,
): MapOverlayPayload | null {
  if (!payload) {
    return null;
  }

  const map = resolveLocalMapOverlayAsset(payload.mapName ?? mapName);
  const liveWorldSize =
    resolveCanonicalMapOverlayWorldSize(payload.mapName ?? mapName) ??
    map?.worldSize ??
    null;
  const playerMarkers: MapOverlayPlayerMarker[] = [];

  for (const row of payload.leaderboard) {
    for (const player of row.players ?? []) {
      if (!directPlayerHasMapPosition(player)) {
        continue;
      }

      playerMarkers.push({
        playerId: player.playerId ?? undefined,
        teamId: row.teamId,
        x: player.x!,
        y: player.y!,
        alive: player.alive,
        knocked: player.alive === true && player.knocked === true,
      });
    }
  }

  const teamsById = new Map<string, MapOverlayTeamMarker>();
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

  const teamMarkers = Array.from(teamsById.values()).map((marker) => ({
    ...marker,
    x: marker.playerCount > 0 ? marker.x / marker.playerCount : marker.x,
    y: marker.playerCount > 0 ? marker.y / marker.playerCount : marker.y,
  }));
  const markerPoints = [
    ...playerMarkers.map((marker) => ({ x: marker.x, y: marker.y })),
    ...teamMarkers.map((marker) => ({ x: marker.x, y: marker.y })),
  ];
  const provisionalWorldSize = deriveEffectiveMapOverlayWorldSize(
    liveWorldSize,
    markerPoints,
    [payload.circle?.safeZone, payload.circle?.nextZone],
    null,
  );
  const directFlightPath = payload.flightPath
    ? {
        ...payload.flightPath,
        coordinateSystem: payload.flightPath.coordinateSystem ?? "WORLD",
      }
    : null;
  const inferredFlightPath =
    directFlightPath == null
      ? (() => {
          const inferred = inferFlightPathFromDirectPayload(
            payload,
            provisionalWorldSize ?? map?.worldSize ?? null,
          );
          if (!inferred) {
            return null;
          }
          return {
            ...inferred,
            coordinateSystem: map?.coordinateSystem ?? "WORLD_BOTTOM_LEFT",
          };
        })()
      : null;
  const flightPath = directFlightPath ?? inferredFlightPath ?? null;
  const effectiveWorldSize = deriveEffectiveMapOverlayWorldSize(
    liveWorldSize,
    markerPoints,
    [payload.circle?.safeZone, payload.circle?.nextZone],
    flightPath,
  );
  const nextShrinkAtMs = resolveTimestampMs(payload.circle?.nextShrinkAt ?? null);

  return {
    matchId: payload.matchId || matchId || PREVIEW_MATCH_ID,
    updatedAt: payload.updatedAt ?? null,
    source: "leaderboard-fallback",
    map:
      map && effectiveWorldSize
        ? {
            ...map,
            worldSize: effectiveWorldSize,
          }
        : map,
    circle: payload.circle
      ? {
          safeZone: payload.circle.safeZone ?? null,
          nextZone: payload.circle.nextZone ?? null,
          phaseIndex: payload.circle.phase ?? null,
          status: payload.circle.status ?? null,
          counterSeconds: payload.circle.counterSeconds ?? null,
          maxTimeSeconds: payload.circle.maxTimeSeconds ?? null,
          nextShrinkAt: payload.circle.nextShrinkAt ?? null,
          timerRemaining:
            nextShrinkAtMs !== null ? Math.max(0, nextShrinkAtMs - Date.now()) : null,
          timeRemainingToNextPhase:
            nextShrinkAtMs !== null
              ? Math.max(0, Math.ceil((nextShrinkAtMs - Date.now()) / 1000))
              : null,
          phaseLabel:
            payload.circle.phase !== null && payload.circle.phase !== undefined
              ? `Phase ${payload.circle.phase}`
              : null,
        }
      : null,
    flightPath,
    teamMarkers,
    playerMarkers,
  };
}

function buildMapOverlayPayloadFromObserverDirectMap(
  payload: ObserverDirectMapOverlayPayload | null | undefined,
): MapOverlayPayload | null {
  if (!payload) {
    return null;
  }

  const localMap = resolveLocalMapOverlayAsset(payload.map?.mapName ?? null);
  const source = resolveObserverDirectMapPayloadSource(payload);
  const normalizedPlayerMarkers = (payload.playerMarkers ?? [])
    .filter(
      (marker) => Number.isFinite(marker.x) && Number.isFinite(marker.y),
    )
    .map((marker) => ({
      ...marker,
      playerId: marker.playerId ?? undefined,
    }));
  const normalizedTeamMarkers = (payload.teamMarkers ?? []).filter(
    (marker) => Number.isFinite(marker.x) && Number.isFinite(marker.y),
  );
  const flightPath = payload.flightPath
    ? {
        ...payload.flightPath,
        coordinateSystem:
          payload.flightPath.coordinateSystem ??
          payload.map?.coordinateSystem ??
          localMap?.coordinateSystem ??
          "WORLD",
      }
    : null;
  const effectiveWorldSize = deriveEffectiveMapOverlayWorldSize(
    payload.map?.worldSize ??
      resolveCanonicalMapOverlayWorldSize(payload.map?.mapName ?? localMap?.mapName) ??
      localMap?.worldSize ??
      null,
    [
      ...normalizedPlayerMarkers.map((marker) => ({
        x: marker.x,
        y: marker.y,
      })),
      ...normalizedTeamMarkers.map((marker) => ({
        x: marker.x,
        y: marker.y,
      })),
    ],
    [payload.circle?.safeZone ?? null, payload.circle?.nextZone ?? null],
    flightPath,
  );
  const map =
    localMap && (payload.map || effectiveWorldSize)
      ? {
          ...localMap,
          worldSize:
            effectiveWorldSize ??
            payload.map?.worldSize ??
            resolveCanonicalMapOverlayWorldSize(
              payload.map?.mapName ?? localMap.mapName,
            ) ??
            localMap.worldSize,
          coordinateSystem:
            payload.map?.coordinateSystem ?? localMap.coordinateSystem,
        }
      : localMap;

  return {
    matchId: payload.matchId || PREVIEW_MATCH_ID,
    updatedAt: payload.updatedAt ?? null,
    source,
    map,
    circle: payload.circle ?? null,
    flightPath,
    teamMarkers: normalizedTeamMarkers,
    playerMarkers: normalizedPlayerMarkers,
  };
}

function resolveMapOverlayPlayerMarkerKey(
  marker: MapOverlayPlayerMarker,
  index: number,
): string {
  const playerId = marker.playerId?.trim();
  if (playerId) {
    return playerId;
  }

  return `${marker.teamId ?? "team"}:${index}`;
}

function buildMapOverlayPlayerSnapshotSignature(
  payload: MapOverlayPayload | null | undefined,
): string {
  if (!payload) {
    return "null";
  }

  return JSON.stringify({
    matchId: payload.matchId,
    updatedAt: payload.updatedAt ?? null,
    worldSize: payload.map?.worldSize ?? null,
    source: payload.source ?? null,
    playerMarkers: payload.playerMarkers.map((marker, index) => ({
      key: resolveMapOverlayPlayerMarkerKey(marker, index),
      teamId: marker.teamId ?? null,
      x: marker.x,
      y: marker.y,
      alive: marker.alive ?? null,
      knocked: marker.knocked ?? null,
    })),
  });
}

function interpolateMapOverlayValue(
  from: number,
  to: number,
  progress: number,
): number {
  return from + (to - from) * progress;
}

function buildRenderedPlayerMarkersFromInterpolationState(
  interpolationState: MapOverlayPlayerInterpolationState | null,
  nowMs: number,
): RenderedMapOverlayPlayerMarker[] {
  if (!interpolationState) {
    return [];
  }

  const rendered: RenderedMapOverlayPlayerMarker[] = [];
  for (const entry of interpolationState.entries.values()) {
    const durationMs = entry.isExiting
      ? MAP_OVERLAY_PLAYER_EXIT_MS
      : MAP_OVERLAY_PLAYER_INTERPOLATION_MS;
    const progress = clampMapOverlay(
      (nowMs - entry.startedAtMs) / Math.max(durationMs, 1),
      0,
      1,
    );

    if (entry.isExiting && progress >= 1) {
      continue;
    }

    const teleportDistance = Math.hypot(
      entry.toX - entry.fromX,
      entry.toY - entry.fromY,
    );
    rendered.push({
      ...entry.marker,
      x: interpolateMapOverlayValue(entry.fromX, entry.toX, progress),
      y: interpolateMapOverlayValue(entry.fromY, entry.toY, progress),
      renderKey: entry.key,
      renderOpacity: entry.isExiting ? 1 - progress : 1,
      interpolationAlpha: progress,
      fromX: entry.fromX,
      fromY: entry.fromY,
      toX: entry.toX,
      toY: entry.toY,
      isExiting: entry.isExiting,
      teleportDistance,
    });
  }

  return rendered;
}

function buildMapOverlayPlayerInterpolationState(
  previousState: MapOverlayPlayerInterpolationState | null,
  nextPayload: MapOverlayPayload | null,
  nowMs: number,
): MapOverlayPlayerInterpolationState | null {
  if (!nextPayload) {
    return null;
  }

  const signature = buildMapOverlayPlayerSnapshotSignature(nextPayload);
  if (previousState?.signature === signature) {
    return previousState;
  }

  const shouldReset =
    previousState === null ||
    previousState.matchId !== nextPayload.matchId ||
    previousState.worldSize !== (nextPayload.map?.worldSize ?? null);
  const previousRenderedMarkers = shouldReset
    ? []
    : buildRenderedPlayerMarkersFromInterpolationState(previousState, nowMs);
  const previousMarkersByKey = new Map(
    previousRenderedMarkers.map((marker) => [marker.renderKey, marker] as const),
  );
  const nextEntries = new Map<string, MapOverlayPlayerInterpolationEntry>();

  nextPayload.playerMarkers.forEach((marker, index) => {
    const key = resolveMapOverlayPlayerMarkerKey(marker, index);
    const previousMarker = previousMarkersByKey.get(key) ?? null;

    nextEntries.set(key, {
      key,
      marker: { ...marker },
      fromX: previousMarker?.x ?? marker.x,
      fromY: previousMarker?.y ?? marker.y,
      toX: marker.x,
      toY: marker.y,
      startedAtMs: nowMs,
      isExiting: false,
    });
    previousMarkersByKey.delete(key);
  });

  for (const [key, marker] of previousMarkersByKey.entries()) {
    nextEntries.set(key, {
      key,
      marker: {
        playerId: marker.playerId,
        teamId: marker.teamId,
        x: marker.x,
        y: marker.y,
        alive: marker.alive,
        knocked: marker.knocked,
      },
      fromX: marker.x,
      fromY: marker.y,
      toX: marker.x,
      toY: marker.y,
      startedAtMs: nowMs,
      isExiting: true,
    });
  }

  return {
    signature,
    matchId: nextPayload.matchId,
    worldSize: nextPayload.map?.worldSize ?? null,
    entries: nextEntries,
  };
}

function resolveMapOverlayTeamMarkerMode(
  payload: MapOverlayPayload | null,
  renderedPlayers: RenderedMapOverlayPlayerMarker[],
): MapOverlayDebugInfo["teamMarkerMode"] {
  if (!payload || payload.teamMarkers.length === 0) {
    return "none";
  }

  if (payload.source === "direct-map") {
    return "direct-team-markers";
  }

  if (renderedPlayers.length === 0) {
    return "team-fallback";
  }

  return "derived-centroids";
}

function deriveInterpolatedMapOverlayTeamMarkers(
  payload: MapOverlayPayload | null,
  renderedPlayers: RenderedMapOverlayPlayerMarker[],
): MapOverlayTeamMarker[] {
  if (!payload) {
    return [];
  }

  const teamMarkerMode = resolveMapOverlayTeamMarkerMode(payload, renderedPlayers);
  if (teamMarkerMode !== "derived-centroids") {
    return payload.teamMarkers;
  }

  const rawTeamMarkersById = new Map(
    payload.teamMarkers
      .filter(
        (marker): marker is MapOverlayTeamMarker & { teamId: string } =>
          typeof marker.teamId === "string" && marker.teamId.length > 0,
      )
      .map((marker) => [marker.teamId, marker] as const),
  );
  const aggregatedTeamMarkers = new Map<
    string,
    {
      x: number;
      y: number;
      weight: number;
      playerCount: number;
      alivePlayers: number;
    }
  >();

  for (const marker of renderedPlayers) {
    if (!marker.teamId) {
      continue;
    }

    const current = aggregatedTeamMarkers.get(marker.teamId) ?? {
      x: 0,
      y: 0,
      weight: 0,
      playerCount: 0,
      alivePlayers: 0,
    };
    const weight = Math.max(marker.renderOpacity, 0.01);
    current.x += marker.x * weight;
    current.y += marker.y * weight;
    current.weight += weight;
    current.playerCount += 1;
    if (marker.alive !== false) {
      current.alivePlayers += 1;
    }
    aggregatedTeamMarkers.set(marker.teamId, current);
  }

  const orderedTeamIds = new Set<string>();
  for (const marker of payload.teamMarkers) {
    if (marker.teamId) {
      orderedTeamIds.add(marker.teamId);
    }
  }
  for (const marker of renderedPlayers) {
    if (marker.teamId) {
      orderedTeamIds.add(marker.teamId);
    }
  }

  const renderedTeamMarkers: MapOverlayTeamMarker[] = [];
  for (const teamId of orderedTeamIds) {
    const rawMarker = rawTeamMarkersById.get(teamId) ?? null;
    const aggregated = aggregatedTeamMarkers.get(teamId) ?? null;
    if (!rawMarker && !aggregated) {
      continue;
    }

    if (aggregated && aggregated.weight > 0) {
      renderedTeamMarkers.push({
        teamId,
        x: aggregated.x / aggregated.weight,
        y: aggregated.y / aggregated.weight,
        alive:
          rawMarker?.alive ?? aggregated.alivePlayers > 0,
        playerCount: rawMarker?.playerCount ?? aggregated.playerCount,
        alivePlayers: rawMarker?.alivePlayers ?? aggregated.alivePlayers,
      });
      continue;
    }

    if (rawMarker) {
      renderedTeamMarkers.push(rawMarker);
    }
  }

  return renderedTeamMarkers;
}

function useInterpolatedMapOverlayPayload(
  payload: MapOverlayPayload | null,
  nowMs: number,
  debugRealtime = false,
): {
  payload: MapOverlayPayload | null;
  renderedPlayers: RenderedMapOverlayPlayerMarker[];
  debugInfo: MapOverlayDebugInfo;
} {
  const playerSnapshotSignature = useMemo(
    () => buildMapOverlayPlayerSnapshotSignature(payload),
    [payload],
  );
  const [interpolationState, setInterpolationState] =
    useState<MapOverlayPlayerInterpolationState | null>(() =>
      buildMapOverlayPlayerInterpolationState(null, payload, Date.now()),
    );

  useLayoutEffect(() => {
    setInterpolationState((current) =>
      buildMapOverlayPlayerInterpolationState(current, payload, Date.now()),
    );
  }, [payload, playerSnapshotSignature]);

  const renderedPlayers = useMemo(() => {
    if (!payload) {
      return [] as RenderedMapOverlayPlayerMarker[];
    }

    const interpolatedMarkers = buildRenderedPlayerMarkersFromInterpolationState(
      interpolationState,
      nowMs,
    );
    if (interpolatedMarkers.length > 0 || payload.playerMarkers.length === 0) {
      return interpolatedMarkers;
    }

    return payload.playerMarkers.map((marker, index) => ({
      ...marker,
      renderKey: resolveMapOverlayPlayerMarkerKey(marker, index),
      renderOpacity: 1,
      interpolationAlpha: 1,
      fromX: marker.x,
      fromY: marker.y,
      toX: marker.x,
      toY: marker.y,
      isExiting: false,
      teleportDistance: 0,
    }));
  }, [interpolationState, nowMs, payload]);

  const teamMarkerMode = useMemo(
    () => resolveMapOverlayTeamMarkerMode(payload, renderedPlayers),
    [payload, renderedPlayers],
  );
  const renderedTeamMarkers = useMemo(
    () => deriveInterpolatedMapOverlayTeamMarkers(payload, renderedPlayers),
    [payload, renderedPlayers],
  );
  const payloadUpdatedAtMs = useMemo(
    () => resolveTimestampMs(payload?.updatedAt ?? null),
    [payload?.updatedAt],
  );
  const payloadAgeMs =
    payloadUpdatedAtMs !== null ? Math.max(0, nowMs - payloadUpdatedAtMs) : null;
  const stale = payloadAgeMs !== null && payloadAgeMs > DIRECT_MAP_OVERLAY_STALE_MS;
  const interpolationPlayers = useMemo(
    () =>
      renderedPlayers.map((marker) => ({
        key: marker.renderKey,
        playerId: marker.playerId ?? null,
        teamId: marker.teamId ?? null,
        prevX: Math.round(marker.fromX),
        prevY: Math.round(marker.fromY),
        nextX: Math.round(marker.toX),
        nextY: Math.round(marker.toY),
        currentX: Math.round(marker.x),
        currentY: Math.round(marker.y),
        alpha: Number(marker.interpolationAlpha.toFixed(3)),
        isExiting: marker.isExiting,
        teleportDistance: Math.round(marker.teleportDistance),
      })),
    [renderedPlayers],
  );
  const teleportDistanceThreshold = useMemo(() => {
    const worldSize = payload?.map?.worldSize ?? null;
    if (worldSize === null || !Number.isFinite(worldSize)) {
      return Number.POSITIVE_INFINITY;
    }

    return Math.max(
      worldSize * MAP_OVERLAY_DEBUG_TELEPORT_DISTANCE_RATIO,
      40_000,
    );
  }, [payload?.map?.worldSize]);
  const teleportingPlayers = useMemo(
    () =>
      interpolationPlayers.filter(
        (player) => player.teleportDistance >= teleportDistanceThreshold,
      ),
    [interpolationPlayers, teleportDistanceThreshold],
  );
  const missingPositionCount = useMemo(
    () =>
      payload?.playerMarkers.filter(
        (marker) => !Number.isFinite(marker.x) || !Number.isFinite(marker.y),
      ).length ?? 0,
    [payload],
  );
  const interpolationActive = useMemo(
    () =>
      renderedPlayers.some(
        (marker) => marker.interpolationAlpha < 0.999 || marker.isExiting,
      ),
    [renderedPlayers],
  );
  const debugInfo = useMemo(
    () => ({
      source: payload?.source ?? null,
      updatedAt: payload?.updatedAt ?? null,
      payloadAgeMs,
      stale,
      rawPlayerCount: payload?.playerMarkers.length ?? 0,
      rawTeamCount: payload?.teamMarkers.length ?? 0,
      renderedPlayerCount: renderedPlayers.length,
      renderedTeamCount: renderedTeamMarkers.length,
      teamMarkerMode,
      interpolationActive,
      missingPositionCount,
      interpolationPlayers,
      teleportingPlayers,
    }),
    [
      interpolationActive,
      interpolationPlayers,
      missingPositionCount,
      payload?.playerMarkers.length,
      payload?.teamMarkers.length,
      payload?.source,
      payload?.updatedAt,
      payloadAgeMs,
      renderedPlayers.length,
      renderedTeamMarkers.length,
      stale,
      teamMarkerMode,
      teleportingPlayers,
    ],
  );
  const lastStaleWarningKeyRef = useRef<string | null>(null);
  const lastTeleportWarningKeyRef = useRef<string | null>(null);
  const lastMissingPositionWarningKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!debugRealtime) {
      return;
    }

    console.debug("[map-overlay][interpolation]", {
      source: formatMapOverlaySourceLabel(debugInfo.source),
      updatedAt: debugInfo.updatedAt,
      ageMs: debugInfo.payloadAgeMs,
      stale: debugInfo.stale,
      normalizedPlayerCount: debugInfo.rawPlayerCount,
      normalizedTeamCount: debugInfo.rawTeamCount,
      renderedPlayerCount: debugInfo.renderedPlayerCount,
      renderedTeamCount: debugInfo.renderedTeamCount,
      teamMarkerMode: debugInfo.teamMarkerMode,
      interpolationActive: debugInfo.interpolationActive,
      missingPositionCount: debugInfo.missingPositionCount,
      teleportCount: debugInfo.teleportingPlayers.length,
    });
    console.debug("[map-overlay][markers][normalized-rendered]", {
      source: formatMapOverlaySourceLabel(debugInfo.source),
      updatedAt: debugInfo.updatedAt,
      normalized: {
        playerMarkers: debugInfo.rawPlayerCount,
        teamMarkers: debugInfo.rawTeamCount,
      },
      rendered: {
        playerMarkers: debugInfo.renderedPlayerCount,
        teamMarkers: debugInfo.renderedTeamCount,
      },
      teamMarkerMode: debugInfo.teamMarkerMode,
    });
    if (debugInfo.interpolationPlayers.length > 0) {
      console.debug(
        "[map-overlay][interpolation][players]",
        debugInfo.interpolationPlayers,
      );
    }
  }, [
    debugRealtime,
    debugInfo,
    nowMs,
  ]);

  useEffect(() => {
    if (!debugRealtime) {
      return;
    }

    if (!debugInfo.stale || !payload) {
      lastStaleWarningKeyRef.current = null;
      return;
    }

    const warningKey = `${payload.matchId}:${payload.source ?? "none"}:${payload.updatedAt ?? "none"}`;
    if (lastStaleWarningKeyRef.current === warningKey) {
      return;
    }
    lastStaleWarningKeyRef.current = warningKey;
    console.warn("[map-overlay][stale-render]", {
      source: formatMapOverlaySourceLabel(payload.source),
      updatedAt: payload.updatedAt ?? null,
      ageMs: debugInfo.payloadAgeMs,
    });
  }, [
    debugInfo.payloadAgeMs,
    debugInfo.stale,
    debugRealtime,
    payload,
  ]);

  useEffect(() => {
    if (!debugRealtime) {
      return;
    }

    if (!payload || debugInfo.teleportingPlayers.length === 0) {
      lastTeleportWarningKeyRef.current = null;
      return;
    }

    const warningKey = `${payload.matchId}:${payload.updatedAt ?? "none"}:${debugInfo.teleportingPlayers
      .map((player) => player.key)
      .join(",")}`;
    if (lastTeleportWarningKeyRef.current === warningKey) {
      return;
    }
    lastTeleportWarningKeyRef.current = warningKey;
    console.warn("[map-overlay][teleport]", {
      source: formatMapOverlaySourceLabel(payload.source),
      updatedAt: payload.updatedAt ?? null,
      threshold: Math.round(teleportDistanceThreshold),
      players: debugInfo.teleportingPlayers,
    });
  }, [
    debugInfo.teleportingPlayers,
    debugRealtime,
    payload,
    teleportDistanceThreshold,
  ]);

  useEffect(() => {
    if (!debugRealtime) {
      return;
    }

    if (!payload || debugInfo.missingPositionCount <= 0) {
      lastMissingPositionWarningKeyRef.current = null;
      return;
    }

    const warningKey = `${payload.matchId}:${payload.updatedAt ?? "none"}:${debugInfo.missingPositionCount}`;
    if (lastMissingPositionWarningKeyRef.current === warningKey) {
      return;
    }
    lastMissingPositionWarningKeyRef.current = warningKey;
    console.warn("[map-overlay][missing-position]", {
      source: formatMapOverlaySourceLabel(payload.source),
      updatedAt: payload.updatedAt ?? null,
      missingPositionCount: debugInfo.missingPositionCount,
    });
  }, [
    debugInfo.missingPositionCount,
    debugRealtime,
    payload,
  ]);

  return useMemo(
    () => ({
      payload: payload
        ? {
            ...payload,
            teamMarkers: renderedTeamMarkers,
            playerMarkers: renderedPlayers.map(
              ({
                renderKey: _renderKey,
                renderOpacity: _renderOpacity,
                interpolationAlpha: _interpolationAlpha,
                fromX: _fromX,
                fromY: _fromY,
                toX: _toX,
                toY: _toY,
                isExiting: _isExiting,
                teleportDistance: _teleportDistance,
                ...marker
              }) => marker,
            ),
          }
        : null,
      renderedPlayers,
      debugInfo,
    }),
    [debugInfo, payload, renderedPlayers, renderedTeamMarkers],
  );
}

function sortFightAlertsByDistance(alerts: FightAlertPayload[]): FightAlertPayload[] {
  return [...alerts].sort((left, right) => {
    const leftDistance = left.distance ?? Number.POSITIVE_INFINITY;
    const rightDistance = right.distance ?? Number.POSITIVE_INFINITY;
    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }
    if (right.eventCount !== left.eventCount) {
      return right.eventCount - left.eventCount;
    }
    return (
      parseStateTimestamp(right.lastEventAt) - parseStateTimestamp(left.lastEventAt)
    );
  });
}

function buildDirectFightAlerts(
  runtime: WidgetRuntime,
  payload: ObserverLeaderboardPayload | null | undefined,
): FightAlertPayload[] {
  if (!payload || !shouldRenderDirectLeaderboard(payload, Date.now())) {
    return [];
  }

  const mapConfig = resolveLocalMapOverlayAsset(runtime.map);
  const rowsByTeamId = new Map(
    payload.leaderboard
      .filter(
        (row): row is ObserverLeaderboardRow & { teamId: string } =>
          typeof row.teamId === "string" && row.teamId.length > 0,
      )
      .map((row) => [row.teamId, row]),
  );
  const livePlayers = payload.leaderboard.flatMap((row) =>
    (row.players ?? [])
      .filter(
        (player) =>
          row.teamId &&
          player.alive === true &&
          directPlayerHasMapPosition(player),
      )
      .map((player) => ({
        teamId: row.teamId as string,
        playerId: player.playerId,
        x: player.x as number,
        y: player.y as number,
        knocked: player.knocked === true,
      })),
  );

  if (livePlayers.length < 2) {
    return [];
  }

  const effectiveWorldSize =
    deriveEffectiveMapOverlayWorldSize(
      mapConfig?.worldSize ?? null,
      livePlayers.map((player) => ({ x: player.x, y: player.y })),
      [],
      payload.flightPath ?? null,
    ) ??
    mapConfig?.worldSize ??
    8000;
  const distanceThreshold = clampMapOverlay(
    effectiveWorldSize * 0.028,
    120,
    26_000,
  );

  const pairStats = new Map<
    string,
    {
      teamIds: [string, string];
      pairCount: number;
      minDistance: number;
      involvedPlayers: Set<string>;
      knockedInvolved: boolean;
      nearbyPlayerCounts: Map<string, number>;
      knockedCounts: Map<string, number>;
    }
  >();

  for (let index = 0; index < livePlayers.length; index += 1) {
    const left = livePlayers[index];
    for (let nextIndex = index + 1; nextIndex < livePlayers.length; nextIndex += 1) {
      const right = livePlayers[nextIndex];
      if (left.teamId === right.teamId) {
        continue;
      }

      const distance = Math.hypot(left.x - right.x, left.y - right.y);
      if (distance > distanceThreshold) {
        continue;
      }

      const orderedTeamIds = [left.teamId, right.teamId].sort() as [string, string];
      const pairKey = orderedTeamIds.join("|");
      const current = pairStats.get(pairKey) ?? {
        teamIds: orderedTeamIds,
        pairCount: 0,
        minDistance: Number.POSITIVE_INFINITY,
        involvedPlayers: new Set<string>(),
        knockedInvolved: false,
        nearbyPlayerCounts: new Map<string, number>(),
        knockedCounts: new Map<string, number>(),
      };
      current.pairCount += 1;
      current.minDistance = Math.min(current.minDistance, distance);
      if (left.playerId) {
        current.involvedPlayers.add(left.playerId);
      }
      if (right.playerId) {
        current.involvedPlayers.add(right.playerId);
      }
      if (left.knocked || right.knocked) {
        current.knockedInvolved = true;
      }
      current.nearbyPlayerCounts.set(
        left.teamId,
        (current.nearbyPlayerCounts.get(left.teamId) ?? 0) + 1,
      );
      current.nearbyPlayerCounts.set(
        right.teamId,
        (current.nearbyPlayerCounts.get(right.teamId) ?? 0) + 1,
      );
      if (left.knocked) {
        current.knockedCounts.set(
          left.teamId,
          (current.knockedCounts.get(left.teamId) ?? 0) + 1,
        );
      }
      if (right.knocked) {
        current.knockedCounts.set(
          right.teamId,
          (current.knockedCounts.get(right.teamId) ?? 0) + 1,
        );
      }
      pairStats.set(pairKey, current);
    }
  }

  const sortedPairs = Array.from(pairStats.values())
    .filter(
      (pair) => pair.pairCount >= 2 || pair.involvedPlayers.size >= 3 || pair.knockedInvolved,
    )
    .sort((left, right) => {
      if (left.minDistance !== right.minDistance) {
        return left.minDistance - right.minDistance;
      }
      if (right.pairCount !== left.pairCount) {
        return right.pairCount - left.pairCount;
      }
      if (right.involvedPlayers.size !== left.involvedPlayers.size) {
        return right.involvedPlayers.size - left.involvedPlayers.size;
      }
      return left.teamIds.join("|").localeCompare(right.teamIds.join("|"));
    });

  const alerts: FightAlertPayload[] = [];
  for (const pair of sortedPairs) {
    const teams = pair.teamIds
      .map((teamId) => rowsByTeamId.get(teamId))
      .filter((row): row is ObserverLeaderboardRow & { teamId: string } => Boolean(row))
      .map((row) => ({
        teamId: row.teamId,
        teamName: row.teamName,
        teamTag: row.teamTag,
        logoUrl: row.logoUrl,
        slot: row.slot,
      }));

    if (teams.length < 2) {
      continue;
    }

    const fightId = `direct-fight:${payload.matchId}:${pair.teamIds.join("|")}`;
    const eventCount = Math.max(
      2,
      Math.min(9, Math.max(pair.pairCount, pair.involvedPlayers.size)),
    );
    const timestamp = payload.updatedAt ?? new Date().toISOString();
    const [leftTeamId, rightTeamId] = pair.teamIds;
    const leftKnocked = pair.knockedCounts.get(leftTeamId) ?? 0;
    const rightKnocked = pair.knockedCounts.get(rightTeamId) ?? 0;
    const leftKills = rowsByTeamId.get(leftTeamId)?.kills ?? 0;
    const rightKills = rowsByTeamId.get(rightTeamId)?.kills ?? 0;
    const leftNearbyPlayers = pair.nearbyPlayerCounts.get(leftTeamId) ?? 0;
    const rightNearbyPlayers = pair.nearbyPlayerCounts.get(rightTeamId) ?? 0;

    let roles: FightAlertPayload["roles"] = null;
    if (leftKnocked > 0 || rightKnocked > 0) {
      if (leftKnocked > 0 && rightKnocked > 0) {
        roles = { left: "trade", right: "trade" };
      } else if (leftKnocked > rightKnocked) {
        roles = { left: "defend", right: "attack" };
      } else if (rightKnocked > leftKnocked) {
        roles = { left: "attack", right: "defend" };
      }
    } else if (leftKills !== rightKills) {
      roles =
        leftKills > rightKills
          ? { left: "attack", right: "defend" }
          : { left: "defend", right: "attack" };
    } else if (leftNearbyPlayers !== rightNearbyPlayers) {
      roles =
        leftNearbyPlayers > rightNearbyPlayers
          ? { left: "attack", right: "defend" }
          : { left: "defend", right: "attack" };
    } else {
      roles = { left: "trade", right: "trade" };
    }

    alerts.push({
      matchId: payload.matchId,
      fightId,
      teams,
      eventCount,
      distance: Math.max(1, Math.round(pair.minDistance)),
      distanceUnit: "m",
      roles,
      startedAt: timestamp,
      lastEventAt: timestamp,
    });
  }

  return alerts.slice(0, 10);
}

function shortenMapMarkerLabel(value: string) {
  const cleaned = value.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (cleaned.length <= 4) {
    return cleaned;
  }
  return cleaned.slice(0, 4);
}

function alphaColor(
  value: string | null | undefined,
  alpha: number,
  fallback = "rgba(255,255,255,0.12)",
) {
  if (!value) return fallback;
  try {
    const normalized = normalizeHexColor(value);
    const parsed = Number.parseInt(normalized.slice(1), 16);
    const red = (parsed >> 16) & 255;
    const green = (parsed >> 8) & 255;
    const blue = parsed & 255;
    return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(alpha, 1))})`;
  } catch {
    return fallback;
  }
}

function buildBrandBackdrop(branding: BrandingState) {
  if (branding.mode === "gradient") {
    return `linear-gradient(${gradientDirectionToAngle(
      branding.gradientDirection,
    )}, ${branding.gradientStart}, ${branding.gradientEnd})`;
  }

  return branding.backgroundSolid;
}

function formatTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function normalizeAchievementKey(value: string | null | undefined) {
  if (!value) return "LIVE_ACHIEVEMENT";
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toUpperCase();
  return normalized.length > 0 ? normalized : "LIVE_ACHIEVEMENT";
}

function formatAchievementTitle(value: string | null | undefined) {
  const key = normalizeAchievementKey(value);
  const aliases: Record<string, string> = {
    "3_KILLS": "3 KILLS",
    AIRDROP_LOOTED: "AIRDROP LOOTED",
    CARE_PACKAGE_SECURED: "AIRDROP LOOTED",
    CLUTCH: "CLUTCH",
    DOUBLE_KILL: "DOUBLE KILL",
    FIRST_BLOOD: "FIRST BLOOD",
    GRENADE_KILL: "GRENADE KILL",
    HEADSHOT: "HEADSHOT",
    LONGEST_SHOT: "LONGEST SHOT",
    MATCH_WINNER: "CHICKEN DINNER",
    MOLOTOV_KILL: "MOLOTOV KILL",
    QUADRA_KILL: "4 KILLS",
    REVENGE: "REVENGE",
    REVENGE_KILL: "REVENGE",
    TEAM_WIPE: "TEAM WIPE",
    TRIPLE_KILL: "3 KILLS",
    VEHICLE_KILL: "VEHICLE KILL",
  };

  return aliases[key] ?? key.replace(/_/g, " ");
}

function resolveAchievementToneColor(
  value: string | null | undefined,
  branding: BrandingState,
) {
  const key = normalizeAchievementKey(value);
  switch (key) {
    case "AIRDROP_LOOTED":
    case "CARE_PACKAGE_SECURED":
      return branding.accent;
    case "CLUTCH":
      return resolveLiveToneColor(branding);
    case "GRENADE_KILL":
    case "MOLOTOV_KILL":
      return branding.accent;
    case "HEADSHOT":
      return branding.accent;
    case "LONGEST_SHOT":
      return branding.secondaryColor;
    case "VEHICLE_KILL":
      return branding.secondaryColor;
    case "TEAM_WIPE":
      return branding.accent;
    default:
      return branding.primaryColor;
  }
}

function buildAchievementDisplay(
  payload: ObserverAchievementPayload,
  branding: BrandingState,
): AchievementAlertDisplay {
  const achievementType = normalizeAchievementKey(payload.type);
  const playerName = payload.player.name?.trim() || "Featured Player";

  return {
    id: payload.eventId,
    matchId: payload.matchId ?? PREVIEW_MATCH_ID,
    playerId: payload.player.id ?? null,
    playerName,
    playerPhotoUrl: payload.player.photoUrl ?? null,
    teamId: payload.team.id ?? null,
    teamName: payload.team.name?.trim() || null,
    teamTag: payload.team.tag?.trim() || null,
    teamLogoUrl: payload.team.logoUrl ?? null,
    achievementType,
    title: formatAchievementTitle(achievementType),
    accentColor: resolveAchievementToneColor(achievementType, branding),
    timestamp: payload.timestamp,
  };
}

function buildTeamRowKey(row: MatchStateLeaderboardRow) {
  return row.teamId ?? [row.slot ?? "x", row.teamTag ?? row.teamName ?? row.rank].join(":");
}

function buildOverallRankingRowKey(row: OverallLiveRankingRow) {
  return row.teamId ?? [row.slot ?? "x", row.teamTag ?? row.teamName ?? row.rank].join(":");
}

function buildPreviewRankingOrder(totalRows: number, phase: number) {
  const order = Array.from({ length: totalRows }, (_, index) => index);

  if (totalRows < 2) {
    return order;
  }

  const activeRows = Math.min(totalRows, 5);
  switch (phase % 4) {
    case 1:
      if (activeRows > 2) {
        [order[1], order[2]] = [order[2], order[1]];
      }
      break;
    case 2:
      [order[0], order[1]] = [order[1], order[0]];
      break;
    case 3:
      if (activeRows > 3) {
        const promoted = order.splice(2, 1)[0];
        if (promoted !== undefined) {
          order.unshift(promoted);
        }
      }
      break;
    default:
      break;
  }

  return order;
}

function buildPreviewLeaderboardRows(
  rows: MatchStateLeaderboardRow[],
  phase: number,
) {
  const order = buildPreviewRankingOrder(rows.length, phase);

  return order.map((sourceIndex, displayIndex) => {
    const identityRow = rows[sourceIndex]!;
    const slotRow = rows[displayIndex] ?? identityRow;

    return {
      ...identityRow,
      rank: displayIndex + 1,
      kills: slotRow.kills,
      alivePlayers: slotRow.alivePlayers,
      totalPlayers: slotRow.totalPlayers,
      placement: slotRow.placement,
      isEliminated: slotRow.isEliminated,
      players: slotRow.players,
    };
  });
}

function buildPreviewOverallRankingRows(
  rows: OverallLiveRankingRow[],
  phase: number,
) {
  const order = buildPreviewRankingOrder(rows.length, phase);

  return order.map((sourceIndex, displayIndex) => {
    const identityRow = rows[sourceIndex]!;
    const slotRow = rows[displayIndex] ?? identityRow;

    return {
      ...identityRow,
      rank: displayIndex + 1,
      kills: slotRow.kills,
      alivePlayers: slotRow.alivePlayers,
      totalPlayers: slotRow.totalPlayers,
      players: slotRow.players,
      totalPoints: slotRow.totalPoints,
      sortKills: slotRow.sortKills,
    };
  });
}

function buildTeamEliminatedDisplay(
  payload: ObserverTeamEliminationPayload,
  branding: BrandingState,
): TeamEliminatedAlertDisplay {
  return {
    id: payload.eventId,
    matchId: payload.matchId,
    teamId: payload.teamId,
    teamName: payload.teamName?.trim() || DEFAULT_WIDGET_TEAM_NAME,
    kills: Math.max(0, payload.kills ?? 0),
    placement:
      typeof payload.placement === "number" && Number.isFinite(payload.placement)
        ? Math.max(1, Math.trunc(payload.placement))
        : null,
    accentColor: branding.accent,
    eliminatedAt: payload.eliminatedAt,
  };
}

function buildDirectTeamEliminationEvent(
  payload: Pick<MatchStatePayload, "matchId" | "updatedAt">,
  row: Pick<
    MatchStateLeaderboardRow,
    "teamId" | "slot" | "rank" | "teamName" | "teamTag" | "placement" | "kills"
  >,
  fallbackPlacement?: number | null,
): ObserverTeamEliminationPayload {
  const teamId =
    row.teamId ??
    `slot:${typeof row.slot === "number" && Number.isFinite(row.slot) ? row.slot : row.rank}`;
  return {
    matchId: payload.matchId,
    eventId: `${payload.matchId}:${teamId}:${payload.updatedAt}`,
    teamId,
    teamName: row.teamName?.trim() || row.teamTag?.trim() || DEFAULT_WIDGET_TEAM_NAME,
    placement:
      typeof row.placement === "number" && Number.isFinite(row.placement)
        ? Math.max(1, Math.trunc(row.placement))
        : typeof fallbackPlacement === "number" && Number.isFinite(fallbackPlacement)
          ? Math.max(1, Math.trunc(fallbackPlacement))
          : null,
    kills: Math.max(0, Math.trunc(row.kills ?? 0)),
    eliminatedAt: payload.updatedAt,
  };
}

function formatAgo(value: string | null | undefined) {
  if (!value) return "No packets yet";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "No packets yet";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 5) return "Updated now";
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `Updated ${minutes}m ago`;
}

function resolveTimestampMs(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function useWidgetClock(preview: boolean, tickMs = 1000) {
  const [nowMs, setNowMs] = useState<number>(
    preview ? PREVIEW_CLOCK_BASE_MS : Number.NaN,
  );

  useEffect(() => {
    const realStartMs = Date.now();
    const baseMs = preview ? PREVIEW_CLOCK_BASE_MS : realStartMs;

    const tick = () => {
      setNowMs(baseMs + (Date.now() - realStartMs));
    };

    tick();
    const interval = window.setInterval(tick, tickMs);
    return () => window.clearInterval(interval);
  }, [preview, tickMs]);

  return nowMs;
}

function formatCountdownClock(totalSeconds: number) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatTeamLabel(
  teamTag: string | null | undefined,
  teamName: string | null | undefined,
  slot?: number | null,
) {
  if (teamTag?.trim()) return teamTag.trim();
  if (
    typeof teamName === "string" &&
    teamName.startsWith("[LIVE] ") &&
    Number.isFinite(slot ?? NaN)
  ) {
    return DEFAULT_WIDGET_TEAM_TAG;
  }
  if (teamName?.trim()) return teamName.trim();
  return DEFAULT_WIDGET_TEAM_TAG;
}

function formatSlot(slot: number | null | undefined) {
  if (!Number.isFinite(slot ?? NaN)) return "--";
  return `S${String(slot).padStart(2, "0")}`;
}

function placementPointsForRank(rank: number | null | undefined) {
  switch (rank ?? 0) {
    case 1:
      return 10;
    case 2:
      return 6;
    case 3:
      return 5;
    case 4:
      return 4;
    case 5:
      return 3;
    case 6:
      return 2;
    case 7:
    case 8:
      return 1;
    default:
      return 0;
  }
}

function resolveStandingsScope(runtime: WidgetRuntime) {
  if (runtime.groupId) {
    return {
      scope: "GROUP" as const,
      scopeId: runtime.groupId,
      url: `${API_URL}/api/groups/${encodeURIComponent(runtime.groupId)}/standings`,
    };
  }
  if (runtime.stageId) {
    return {
      scope: "STAGE" as const,
      scopeId: runtime.stageId,
      url: `${API_URL}/api/stages/${encodeURIComponent(runtime.stageId)}/standings`,
    };
  }
  if (runtime.tournamentId) {
    return {
      scope: "TOURNAMENT" as const,
      scopeId: runtime.tournamentId,
      url: `${API_URL}/live/standings/${encodeURIComponent(runtime.tournamentId)}`,
    };
  }
  return null;
}

type OverallLiveRankingRow = {
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
  players?: MatchStateLeaderboardPlayer[];
  totalPoints: number;
  sortKills: number;
};

function overallRankingDensity(totalRows: number) {
  if (totalRows <= 8) {
    return {
      containerWidth: "w-[470px] max-w-[calc(100vw-4rem)]",
      containerPadding: "pb-4.5 pl-4.5 pr-2.5 pt-4.5",
      paddingY: 36,
      headerText: "text-[2.2rem]",
      rankText: "text-[2.1rem]",
      rowClass: "rounded-[20px] py-2",
      metaClass:
        "grid-cols-[60px_146px_76px_58px_72px] gap-2 pl-3.5 pr-1.5",
      teamText: "text-[13px]",
      statText: "text-[1.1rem]",
      totalText: "text-[1.15rem]",
      logoSize: 28,
      titleTracking: "tracking-[0.16em]",
      stackClass: "space-y-1.5",
    };
  }

  if (totalRows <= 16) {
    return {
      containerWidth: "w-[390px] max-w-[calc(100vw-4rem)]",
      containerPadding: "pb-3.5 pl-3.5 pr-2 pt-3.5",
      paddingY: 28,
      headerText: "text-[1.6rem]",
      rankText: "text-[1.4rem]",
      rowClass: "rounded-[16px] py-1.5",
      metaClass:
        "grid-cols-[44px_116px_62px_46px_60px] gap-1.5 pl-2.5 pr-1",
      teamText: "text-[12px]",
      statText: "text-[0.98rem]",
      totalText: "text-[1rem]",
      logoSize: 20,
      titleTracking: "tracking-[0.12em]",
      stackClass: "space-y-1",
    };
  }

  if (totalRows <= 20) {
    return {
      containerWidth: "w-[360px] max-w-[calc(100vw-4rem)]",
      containerPadding: "pb-3 pl-3 pr-1.5 pt-3",
      paddingY: 24,
      headerText: "text-[1.45rem]",
      rankText: "text-[1.2rem]",
      rowClass: "rounded-[14px] py-1.25",
      metaClass:
        "grid-cols-[40px_104px_56px_42px_56px] gap-1 pl-2 pr-0.75",
      teamText: "text-[11px]",
      statText: "text-[0.92rem]",
      totalText: "text-[0.94rem]",
      logoSize: 17,
      titleTracking: "tracking-[0.11em]",
      stackClass: "space-y-0.5",
    };
  }

  return {
    containerWidth: "w-[332px] max-w-[calc(100vw-4rem)]",
    containerPadding: "pb-2.5 pl-2.5 pr-1.25 pt-2.5",
    paddingY: 20,
    headerText: "text-[1.28rem]",
    rankText: "text-[1.05rem]",
    rowClass: "rounded-[12px] py-1",
    metaClass: "grid-cols-[36px_94px_50px_38px_52px] gap-1 pl-2 pr-0.5",
    teamText: "text-[10px]",
    statText: "text-[0.86rem]",
    totalText: "text-[0.9rem]",
    logoSize: 15,
    titleTracking: "tracking-[0.1em]",
    stackClass: "space-y-0.5",
  };
}

function overallRankingPanelWidth(totalRows: number) {
  if (totalRows <= 8) return 470;
  if (totalRows <= 16) return 390;
  if (totalRows <= 20) return 360;
  return 332;
}

function buildRankingPanelVisuals(
  branding: BrandingState,
  toneColor: string,
  rowTone: string,
  highlightTone: string,
) {
  const panelTop = darkenHexColor(branding.effectiveBackground, 0.08);
  const panelBottom = darkenHexColor(branding.effectiveBackground, 0.18);

  return {
    headerCardStyle: {
      background: [
        `linear-gradient(135deg, ${alphaColor(
          toneColor,
          0.22,
        )}, transparent 58%)`,
        `linear-gradient(90deg, transparent 0%, ${alphaColor(
          highlightTone,
          0.12,
        )} 56%, transparent 100%)`,
        `linear-gradient(180deg, ${alphaColor(
          panelTop,
          0.94,
        )}, ${alphaColor(panelBottom, 0.98)})`,
      ].join(", "),
      borderColor: alphaColor(toneColor, 0.28),
      boxShadow: `inset 0 1px 0 ${alphaColor(
        "#ffffff",
        0.04,
      )}, 0 18px 42px ${alphaColor("#000000", 0.14)}`,
    } satisfies CSSProperties,
    headerDividerStyle: {
      background: `linear-gradient(90deg, transparent, ${alphaColor(
        toneColor,
        0.22,
      )}, transparent)`,
    } satisfies CSSProperties,
    headerTextShadow: `0 1px 0 ${alphaColor(
      "#000000",
      0.72,
    )}, 0 0 14px ${alphaColor("#000000", 0.2)}`,
    rowTextShadow: `0 1px 0 ${alphaColor("#000000", 0.72)}`,
    rowBorderColor: alphaColor(rowTone, 0.24),
    rowBackground: (highlighted: boolean) =>
      [
        highlighted
          ? `linear-gradient(90deg, ${alphaColor(
              highlightTone,
              0.22,
            )}, ${alphaColor(rowTone, 0.1)} 56%, transparent 100%)`
          : `linear-gradient(90deg, ${alphaColor(
              toneColor,
              0.08,
            )}, transparent 58%)`,
        `linear-gradient(180deg, ${alphaColor(
          panelTop,
          highlighted ? 0.42 : 0.26,
        )}, ${alphaColor(panelBottom, highlighted ? 0.34 : 0.22)})`,
      ].join(", "),
  };
}

function leaderboardDensity(totalRows: number) {
  if (totalRows <= 8) {
    return {
      containerWidth: "w-[430px] max-w-[calc(100vw-4rem)]",
      containerPadding: "pb-4.5 pl-4.5 pr-2.5 pt-4.5",
      paddingY: 36,
      headerText: "text-[2.4rem]",
      rankText: "text-[2.3rem]",
      rowClass: "rounded-[20px] py-2",
      metaClass: "grid-cols-[68px_156px_82px_82px] gap-2 pl-3.5 pr-1.5",
      teamText: "text-[13px]",
      statText: "text-[1.15rem]",
      logoSize: 30,
      titleTracking: "tracking-[0.18em]",
      stackClass: "space-y-1.5",
    };
  }

  if (totalRows <= 16) {
    return {
      containerWidth: "w-[340px] max-w-[calc(100vw-4rem)]",
      containerPadding: "pb-3.5 pl-3.5 pr-2 pt-3.5",
      paddingY: 28,
      headerText: "text-[1.7rem]",
      rankText: "text-[1.45rem]",
      rowClass: "rounded-[16px] py-1.5",
      metaClass: "grid-cols-[50px_124px_68px_68px] gap-1.5 pl-2.5 pr-1",
      teamText: "text-[12px]",
      statText: "text-[1rem]",
      logoSize: 22,
      titleTracking: "tracking-[0.13em]",
      stackClass: "space-y-1",
    };
  }

  if (totalRows <= 20) {
    return {
      containerWidth: "w-[308px] max-w-[calc(100vw-4rem)]",
      containerPadding: "pb-3 pl-3 pr-1.5 pt-3",
      paddingY: 24,
      headerText: "text-[1.5rem]",
      rankText: "text-[1.25rem]",
      rowClass: "rounded-[14px] py-1.25",
      metaClass: "grid-cols-[44px_108px_60px_60px] gap-1 pl-2 pr-0.75",
      teamText: "text-[11px]",
      statText: "text-[0.95rem]",
      logoSize: 18,
      titleTracking: "tracking-[0.12em]",
      stackClass: "space-y-0.5",
    };
  }

  return {
    containerWidth: "w-[286px] max-w-[calc(100vw-4rem)]",
    containerPadding: "pb-2.5 pl-2.5 pr-1.25 pt-2.5",
    paddingY: 20,
    headerText: "text-[1.35rem]",
    rankText: "text-[1.1rem]",
    rowClass: "rounded-[12px] py-1",
    metaClass: "grid-cols-[38px_98px_54px_54px] gap-1 pl-2 pr-0.5",
    teamText: "text-[10px]",
    statText: "text-[0.9rem]",
    logoSize: 16,
    titleTracking: "tracking-[0.1em]",
    stackClass: "space-y-0.5",
  };
}

function sortLeaderboardDisplayRows(
  rows: MatchStateLeaderboardRow[],
): MatchStateLeaderboardRow[] {
  const aliveRows = rows.filter(
    (row) => row.alivePlayers > 0 && row.isEliminated !== true,
  );
  const eliminatedRows = rows.filter(
    (row) => row.alivePlayers <= 0 || row.isEliminated === true,
  );
  const guaranteedPlacement = aliveRows.length > 0 ? aliveRows.length : 1;

  const sortedAlive = [...aliveRows].sort((left, right) => {
    const leftPoints =
      placementPointsForRank(guaranteedPlacement) + (left.kills ?? 0);
    const rightPoints =
      placementPointsForRank(guaranteedPlacement) + (right.kills ?? 0);
    if (rightPoints !== leftPoints) {
      return rightPoints - leftPoints;
    }
    if ((right.kills ?? 0) !== (left.kills ?? 0)) {
      return (right.kills ?? 0) - (left.kills ?? 0);
    }
    if ((right.alivePlayers ?? 0) !== (left.alivePlayers ?? 0)) {
      return (right.alivePlayers ?? 0) - (left.alivePlayers ?? 0);
    }
    const leftSlot = left.slot ?? Number.MAX_SAFE_INTEGER;
    const rightSlot = right.slot ?? Number.MAX_SAFE_INTEGER;
    if (leftSlot !== rightSlot) {
      return leftSlot - rightSlot;
    }
    return left.teamName.localeCompare(right.teamName);
  });

  const sortedEliminated = [...eliminatedRows].sort((left, right) => {
    const leftEliminationOrder =
      left.placement ?? left.rank ?? Number.MAX_SAFE_INTEGER;
    const rightEliminationOrder =
      right.placement ?? right.rank ?? Number.MAX_SAFE_INTEGER;
    if (leftEliminationOrder !== rightEliminationOrder) {
      return leftEliminationOrder - rightEliminationOrder;
    }
    if ((right.kills ?? 0) !== (left.kills ?? 0)) {
      return (right.kills ?? 0) - (left.kills ?? 0);
    }
    const leftSlot = left.slot ?? Number.MAX_SAFE_INTEGER;
    const rightSlot = right.slot ?? Number.MAX_SAFE_INTEGER;
    if (leftSlot !== rightSlot) {
      return leftSlot - rightSlot;
    }
    return left.teamName.localeCompare(right.teamName);
  });

  return [...sortedAlive, ...sortedEliminated].map((row, index) => ({
    ...row,
    rank: index + 1,
  }));
}

function useLeaderboardFit(paddingY: number) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [bodyHeight, setBodyHeight] = useState<number | null>(null);
  const scaleRef = useRef(1);
  const bodyHeightRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const header = headerRef.current;
    const content = contentRef.current;

    if (!viewport || !header || !content) return;

    let frameId = 0;

    const measure = () => {
      frameId = 0;

      const availableHeight = Math.max(
        0,
        viewport.clientHeight - header.offsetHeight - paddingY,
      );
      const naturalHeight = content.scrollHeight;
      const nextScale =
        availableHeight > 0 && naturalHeight > 0
          ? Math.min(1, availableHeight / naturalHeight)
          : 1;
      const nextBodyHeight =
        naturalHeight > 0
          ? availableHeight > 0
            ? Math.min(naturalHeight, availableHeight)
            : naturalHeight
          : 0;

      if (Math.abs(scaleRef.current - nextScale) >= 0.01) {
        scaleRef.current = nextScale;
        setScale(nextScale);
      }

      if (
        bodyHeightRef.current === null ||
        Math.abs(bodyHeightRef.current - nextBodyHeight) >= 1
      ) {
        bodyHeightRef.current = nextBodyHeight;
        setBodyHeight(nextBodyHeight);
      }
    };

    const scheduleMeasure = () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(measure);
    };

    scheduleMeasure();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            scheduleMeasure();
          });

    resizeObserver?.observe(viewport);
    resizeObserver?.observe(header);
    resizeObserver?.observe(content);
    window.addEventListener("resize", scheduleMeasure);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [paddingY]);

  return { viewportRef, headerRef, contentRef, bodyHeight, scale };
}

function useSingleLineAutoFit(
  text: string,
  minFontPx: number,
  maxFontPx: number,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const element = textRef.current;

    if (!container || !element) return;

    let frameId = 0;

    const measure = () => {
      frameId = 0;

      const availableWidth = Math.floor(container.clientWidth);
      if (availableWidth <= 0) {
        return;
      }

      const applyFontSize = (fontSize: number) => {
        element.style.fontSize = `${fontSize}px`;
      };

      applyFontSize(maxFontPx);
      if (element.scrollWidth <= availableWidth) {
        return;
      }

      let low = minFontPx;
      let high = maxFontPx;
      let best = minFontPx;

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        applyFontSize(mid);

        if (element.scrollWidth <= availableWidth) {
          best = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      applyFontSize(best);
    };

    const scheduleMeasure = () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(measure);
    };

    scheduleMeasure();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            scheduleMeasure();
          });

    resizeObserver?.observe(container);
    window.addEventListener("resize", scheduleMeasure);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [maxFontPx, minFontPx, text]);

  return { containerRef, textRef };
}

function useAnimatedRankingRowOrder(rowKeys: string[]) {
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const previousTopByKeyRef = useRef(new Map<string, number>());
  const hasMeasuredRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);
  const rowKeysSignature = JSON.stringify(rowKeys);
  const orderedKeys = useMemo<string[]>(
    () => JSON.parse(rowKeysSignature) as string[],
    [rowKeysSignature],
  );

  useLayoutEffect(() => {
    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const nextTopByKey = new Map<string, number>();
    const animatedElements: HTMLDivElement[] = [];
    const previousTopByKey = previousTopByKeyRef.current;

    for (const key of orderedKeys) {
      const element = rowRefs.current.get(key);
      if (!element) continue;

      const nextTop = element.offsetTop;
      nextTopByKey.set(key, nextTop);

      if (!hasMeasuredRef.current) {
        element.style.transform = "";
        element.style.opacity = "";
        element.style.transition = "";
        continue;
      }

      const previousTop = previousTopByKey.get(key);
      if (previousTop === undefined) {
        element.style.transition = "none";
        element.style.transform = "translateY(10px)";
        element.style.opacity = "0";
        animatedElements.push(element);
        continue;
      }

      const deltaY = previousTop - nextTop;
      if (Math.abs(deltaY) < 0.5) {
        element.style.transform = "";
        element.style.opacity = "";
        continue;
      }

      element.style.transition = "none";
      element.style.transform = `translateY(${deltaY}px)`;
      element.style.opacity = "1";
      animatedElements.push(element);
    }

    if (animatedElements.length > 0) {
      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null;
        for (const element of animatedElements) {
          element.style.transition = `transform ${RANKING_ROW_MOVE_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${RANKING_ROW_FADE_MS}ms ease-out`;
          element.style.transform = "translateY(0)";
          element.style.opacity = "1";
        }
      });
    }

    previousTopByKeyRef.current = nextTopByKey;
    hasMeasuredRef.current = true;

    return () => {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [orderedKeys]);

  const bindRow = (key: string) => (node: HTMLDivElement | null) => {
    if (node) {
      rowRefs.current.set(key, node);
      node.style.willChange = "transform, opacity";
    } else {
      rowRefs.current.delete(key);
    }
  };

  return { bindRow };
}

function usePreviewRankingPhase(enabled: boolean, totalRows: number) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!enabled || totalRows < 2) {
      return;
    }

    const interval = window.setInterval(() => {
      setPhase((current) => (current + 1) % 4);
    }, PREVIEW_RANKING_CYCLE_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [enabled, totalRows]);

  return enabled && totalRows >= 2 ? phase : 0;
}

function pickTeamColor(
  teamColor: string | null | undefined,
  branding: BrandingState,
) {
  if (teamColor) return teamColor;
  return branding.primaryColor;
}

function resolveLiveToneColor(branding: BrandingState) {
  return branding.liveColor === DEFAULT_BRANDING_STATE.liveColor
    ? branding.secondaryColor
    : branding.liveColor;
}

function resolveWidgetToneColor(
  branding: BrandingState,
  emphasis: "primary" | "accent" | "secondary" | "live" = "primary",
) {
  switch (emphasis) {
    case "accent":
      return branding.accent;
    case "secondary":
      return branding.secondaryColor;
    case "live":
      return resolveLiveToneColor(branding);
    case "primary":
    default:
      return branding.primaryColor;
  }
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

async function fetchFinalizedMatchState(
  matchId: string,
  organizationId: string,
  signal?: AbortSignal,
): Promise<MatchStatePayload> {
  const response = await fetch(
    `${API_URL}/public/matches/${encodeURIComponent(
      matchId,
    )}/results/slots?${new URLSearchParams({ organizationId }).toString()}`,
    {
      cache: "no-store",
      signal,
    },
  );
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    slots?: PublicMatchSlotResult[] | null;
  };
  return buildFinalizedResultsState(matchId, payload.slots ?? []);
}

async function fetchManualLiveResultsState(
  matchId: string,
  organizationId: string,
  signal?: AbortSignal,
): Promise<MatchStatePayload> {
  const response = await fetch(
    `${API_URL}/public/matches/${encodeURIComponent(
      matchId,
    )}/results/slots?${new URLSearchParams({ organizationId }).toString()}`,
    {
      cache: "no-store",
      signal,
    },
  );
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    slots?: PublicMatchSlotResult[] | null;
  };
  return buildManualLiveResultsState(matchId, payload.slots ?? []);
}

function compareFinalizedSlotResults(
  left: PublicMatchSlotResult,
  right: PublicMatchSlotResult,
) {
  const leftPlacement = left.placement ?? Number.MAX_SAFE_INTEGER;
  const rightPlacement = right.placement ?? Number.MAX_SAFE_INTEGER;
  if (leftPlacement !== rightPlacement) {
    return leftPlacement - rightPlacement;
  }

  const leftPoints = left.totalPoints ?? left.points ?? 0;
  const rightPoints = right.totalPoints ?? right.points ?? 0;
  if (rightPoints !== leftPoints) {
    return rightPoints - leftPoints;
  }

  const leftKills = left.totalKills ?? left.kills ?? 0;
  const rightKills = right.totalKills ?? right.kills ?? 0;
  if (rightKills !== leftKills) {
    return rightKills - leftKills;
  }

  const leftSlot = left.slotNumber ?? Number.MAX_SAFE_INTEGER;
  const rightSlot = right.slotNumber ?? Number.MAX_SAFE_INTEGER;
  if (leftSlot !== rightSlot) {
    return leftSlot - rightSlot;
  }

  return (left.team?.name ?? left.team?.tag ?? left.teamId ?? "").localeCompare(
    right.team?.name ?? right.team?.tag ?? right.teamId ?? "",
  );
}

function isPublicSlotResultPresent(result: PublicMatchSlotResult) {
  return (
    result.wasPresentInMatch !== false &&
    result.presenceStatus !== "NO_SHOW" &&
    Boolean(result.teamId ?? result.team?.id)
  );
}

function buildManualLiveResultsState(
  matchId: string,
  slotResults: PublicMatchSlotResult[],
): MatchStatePayload {
  const competitiveResults = slotResults.filter(isPublicSlotResultPresent);
  const leaderboard = competitiveResults.map((result, index) => {
    const players = (result.players ?? []).map<MatchStateLeaderboardPlayer>(
      (player, playerIndex) => {
        const alive = player.alive ?? player.isAlive ?? false;
        return {
          playerId:
            player.playerId ??
            player.externalPlayerId ??
            `slot-${result.slotNumber ?? index + 1}-player-${playerIndex + 1}`,
          playerName:
            player.playerName ??
            player.name ??
            `Player ${playerIndex + 1}`,
          avatarUrl: player.photoUrl ?? null,
          kills: Math.max(0, player.kills ?? 0),
          alive,
          knocked: player.isKnocked ?? (player.knocks ?? 0) > 0,
          health: null,
          hasDied: !alive,
        };
      },
    );
    const totalPlayers = players.length > 0 ? players.length : null;
    const alivePlayers = players.filter((player) => player.alive).length;
    const isEliminated =
      Boolean(result.eliminatedAt) ||
      (totalPlayers !== null && alivePlayers <= 0);

    return {
      rank: index + 1,
      teamId: result.teamId ?? result.team?.id ?? null,
      slot: result.slotNumber ?? null,
      teamName:
        result.team?.name ??
        result.team?.tag ??
        formatSlot(result.slotNumber ?? index + 1),
      teamTag: result.team?.tag ?? null,
      logoUrl: result.team?.logoUrl ?? null,
      color: null,
      kills: Math.max(0, result.totalKills ?? result.kills ?? 0),
      alivePlayers,
      totalPlayers,
      placement: result.placement ?? null,
      isEliminated,
      players,
    };
  });
  const teamsAlive = leaderboard.filter(
    (row) => row.alivePlayers > 0 && row.isEliminated !== true,
  ).length;
  const winner =
    teamsAlive === 1
      ? toWinnerFromLeaderboardRow(
          leaderboard.find(
            (row) => row.alivePlayers > 0 && row.isEliminated !== true,
          ) ?? null,
        )
      : null;

  return {
    ...emptyMatchState(matchId),
    matchId,
    updatedAt: new Date().toISOString(),
    teamsAlive,
    leaderboard,
    winner,
  };
}

function buildFinalizedResultsState(
  matchId: string,
  slotResults: PublicMatchSlotResult[],
): MatchStatePayload {
  const orderedResults = [...slotResults].sort(compareFinalizedSlotResults);
  const leaderboard = orderedResults.map((result, index) => ({
    rank: index + 1,
    teamId: result.teamId ?? result.team?.id ?? null,
    slot: result.slotNumber ?? null,
    teamName:
      result.team?.name ??
      result.team?.tag ??
      formatSlot(result.slotNumber ?? index + 1),
    teamTag: result.team?.tag ?? null,
    logoUrl: result.team?.logoUrl ?? null,
    color: null,
    kills: Math.max(0, result.totalKills ?? result.kills ?? 0),
    alivePlayers: 0,
    totalPlayers: null,
    placement: result.placement ?? index + 1,
    isEliminated: true,
    players: [],
  }));
  const winner = toWinnerFromLeaderboardRow(
    leaderboard.find((row) => row.placement === 1) ?? leaderboard[0] ?? null,
  );

  return {
    ...emptyMatchState(matchId),
    matchId,
    updatedAt: new Date().toISOString(),
    teamsAlive: 0,
    leaderboard,
    winner,
  };
}

function normalizeOverallRankingLookup(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function compactOverallRankingLookup(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeOverallRankingLookup(value);
  if (!normalized) {
    return null;
  }

  const compact = normalized.replace(/[^a-z0-9]+/g, "");
  return compact.length > 0 ? compact : null;
}

function buildOverallLiveRankingRows(
  runtime: WidgetRuntime,
  standings: OverallStandingsPayload | null,
): OverallLiveRankingRow[] {
  const liveRows = runtime.payload.leaderboard;
  const standingsByTeamId = new Map<string, OverallStandingsRow>();
  const standingsByTag = new Map<string, OverallStandingsRow>();
  const standingsByName = new Map<string, OverallStandingsRow>();
  const standingsByCompactName = new Map<string, OverallStandingsRow>();

  for (const standing of standings?.rows ?? []) {
    standingsByTeamId.set(standing.teamId, standing);

    const normalizedTag = normalizeOverallRankingLookup(standing.teamTag);
    if (normalizedTag && !standingsByTag.has(normalizedTag)) {
      standingsByTag.set(normalizedTag, standing);
    }

    const normalizedName = normalizeOverallRankingLookup(standing.teamName);
    if (normalizedName && !standingsByName.has(normalizedName)) {
      standingsByName.set(normalizedName, standing);
    }

    const compactName = compactOverallRankingLookup(standing.teamName);
    if (compactName && !standingsByCompactName.has(compactName)) {
      standingsByCompactName.set(compactName, standing);
    }
  }

  const rows: OverallLiveRankingRow[] = liveRows.map((liveRow) => {
    const matchedStanding =
      (liveRow.teamId ? standingsByTeamId.get(liveRow.teamId) : undefined) ??
      (liveRow.teamTag
        ? standingsByTag.get(normalizeOverallRankingLookup(liveRow.teamTag) ?? "")
        : undefined) ??
      standingsByName.get(normalizeOverallRankingLookup(liveRow.teamName) ?? "") ??
      standingsByCompactName.get(
        compactOverallRankingLookup(liveRow.teamName) ?? "",
      ) ??
      null;

    const previousMatches = (matchedStanding?.perMatch ?? []).filter(
      (match) => match.matchId !== runtime.matchId,
    );
    const basePoints = previousMatches.reduce(
      (sum, match) => sum + (match.totalPoints ?? 0),
      0,
    );
    const baseKills = previousMatches.reduce(
      (sum, match) => sum + (match.kills ?? 0),
      0,
    );
    const livePlacement = liveRow.placement ?? liveRow.rank ?? null;
    const currentMatchPoints =
      placementPointsForRank(livePlacement) + liveRow.kills;

    return {
      rank: 0,
      teamId: matchedStanding?.teamId ?? liveRow.teamId,
      slot: liveRow.slot,
      teamName: liveRow.teamName ?? matchedStanding?.teamName ?? "TEAM",
      teamTag: liveRow.teamTag ?? matchedStanding?.teamTag ?? null,
      logoUrl: liveRow.logoUrl ?? matchedStanding?.teamLogo ?? null,
      color: liveRow.color,
      kills: liveRow.kills,
      alivePlayers: liveRow.alivePlayers,
      totalPlayers: liveRow.totalPlayers,
      players: liveRow.players,
      totalPoints: basePoints + currentMatchPoints,
      sortKills: baseKills + liveRow.kills,
    };
  });

  return rows
    .sort((left, right) => {
      if (right.totalPoints !== left.totalPoints) {
        return right.totalPoints - left.totalPoints;
      }
      if (right.sortKills !== left.sortKills) {
        return right.sortKills - left.sortKills;
      }
      if (right.alivePlayers !== left.alivePlayers) {
        return right.alivePlayers - left.alivePlayers;
      }
      return formatTeamLabel(left.teamTag, left.teamName, left.slot).localeCompare(
        formatTeamLabel(right.teamTag, right.teamName, right.slot),
      );
    })
    .map((row, index) => ({
      ...row,
      rank: index + 1,
    }));
}

function useOverallStandings(runtime: WidgetRuntime) {
  const scope = useMemo(() => resolveStandingsScope(runtime), [runtime]);
  const [standings, setStandings] = useState<OverallStandingsPayload | null>(
    runtime.preview ? PREVIEW_OVERALL_STANDINGS : null,
  );

  useEffect(() => {
    if (runtime.preview) {
      setStandings(PREVIEW_OVERALL_STANDINGS);
      return;
    }

    if (!scope) {
      setStandings(null);
      return;
    }

    let cancelled = false;

    const loadStandings = async () => {
      try {
        const nextStandings = await fetchJson<OverallStandingsPayload>(scope.url);
        if (cancelled) return;
        setStandings(nextStandings);
      } catch {
        if (cancelled) return;
        setStandings(null);
      }
    };

    void loadStandings();
    const interval = window.setInterval(() => {
      void loadStandings();
    }, CONTEXT_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [runtime.preview, scope]);

  return useMemo(
    () => buildOverallLiveRankingRows(runtime, standings),
    [runtime, standings],
  );
}

function useMapOverlayState(
  runtime: WidgetRuntime,
  directPayload?: ObserverLeaderboardPayload | null,
  options?: {
    launcherOnly?: boolean;
    directMapPayload?: MapOverlayPayload | null;
    launcherError?: string | null;
    launcherLoading?: boolean;
    debugRealtime?: boolean;
  },
) {
  const launcherOnly = options?.launcherOnly === true;
  const runtimeMapName =
    options?.directMapPayload?.map?.mapName ??
    directPayload?.mapName ??
    runtime.map;
  const runtimeMatchId = runtime.matchId;
  const runtimePreview = runtime.preview;
  const runtimeCanConsumeLiveTelemetry = runtime.canConsumeLiveTelemetry;
  const runtimeWidgetKey = runtime.widgetKey;
  const runtimePayloadMatchId = runtime.payload.matchId;
  const runtimePayloadUpdatedAt = runtime.payload.updatedAt;
  const runtimeCircle = runtime.payload.circle;
  const directMapPayloadInput = options?.directMapPayload ?? null;
  const launcherError = options?.launcherError ?? null;
  const launcherLoading = options?.launcherLoading === true;
  const debugRealtime = options?.debugRealtime === true;
  const runtimeMapFallback = useMemo(
    () => resolveLocalMapOverlayAsset(runtimeMapName),
    [runtimeMapName],
  );
  const normalizedRuntimeMapFallback = useMemo(
    () =>
      runtimeMapFallback
        ? {
            ...runtimeMapFallback,
            worldSize: MAP_OVERLAY_RENDER_WORLD_SIZE,
          }
        : runtimeMapFallback,
    [runtimeMapFallback],
  );
  const [lockedDetectedWorldSize, setLockedDetectedWorldSize] =
    useState<MapOverlayDetectedWorldSize | null>(null);
  useEffect(() => {
    setLockedDetectedWorldSize(null);
  }, [runtimeMatchId, runtimePreview]);
  const previewPayload = useMemo(
    () => buildMapOverlayPreviewPayload(runtimeMapName, runtimeMatchId),
    [runtimeMapName, runtimeMatchId],
  );
  const runtimeCirclePayload = useMemo(() => {
    if (runtimePreview || !runtimeCircle || launcherOnly) {
      return null;
    }

    return {
      matchId: runtimeMatchId ?? runtimePayloadMatchId ?? PREVIEW_MATCH_ID,
      updatedAt: runtimePayloadUpdatedAt ?? null,
      source: "runtime-circle",
      map: runtimeMapFallback,
      circle: {
        safeZone: runtimeCircle.safeZone ?? null,
        nextZone: runtimeCircle.nextZone ?? null,
        phaseIndex: runtimeCircle.phase ?? null,
        status: runtimeCircle.status ?? null,
        counterSeconds: runtimeCircle.counterSeconds ?? null,
        maxTimeSeconds: runtimeCircle.maxTimeSeconds ?? null,
        nextShrinkAt: runtimeCircle.nextShrinkAt ?? null,
        timerRemaining: null,
        timeRemainingToNextPhase: null,
        phaseLabel:
          runtimeCircle.phase !== null &&
          runtimeCircle.phase !== undefined
            ? `Phase ${runtimeCircle.phase}`
            : null,
      },
      flightPath: null,
      teamMarkers: [],
      playerMarkers: [],
    } satisfies MapOverlayPayload;
  }, [
    launcherOnly,
    runtimeCircle,
    runtimeMapFallback,
    runtimeMatchId,
    runtimePayloadMatchId,
    runtimePayloadUpdatedAt,
      runtimePreview,
  ]);
  const leaderboardFallbackPayload = useMemo(
    () =>
      runtimePreview
        ? null
        : buildMapOverlayPayloadFromDirect(
            runtimeMapName,
            runtimeMatchId,
            directPayload ?? null,
          ),
    [
      directPayload,
      runtimeMapName,
      runtimeMatchId,
      runtimePreview,
    ],
  );
  const detectedWorldSize = useMemo(
    () =>
      lockedDetectedWorldSize ??
      detectMapOverlayWorldSizeFromCandidates([
        directMapPayloadInput,
        leaderboardFallbackPayload,
        runtimeCirclePayload,
      ]),
    [
      directMapPayloadInput,
      leaderboardFallbackPayload,
      lockedDetectedWorldSize,
      runtimeCirclePayload,
    ],
  );
  useEffect(() => {
    if (runtimePreview || lockedDetectedWorldSize !== null || detectedWorldSize === null) {
      return;
    }

    setLockedDetectedWorldSize(detectedWorldSize);
  }, [
    detectedWorldSize,
    lockedDetectedWorldSize,
    runtimePreview,
  ]);
  const normalizedDirectMapPayloadInput = useMemo(
    () =>
      normalizeMapOverlayPayloadForRender(
        directMapPayloadInput,
        detectedWorldSize,
      ),
    [detectedWorldSize, directMapPayloadInput],
  );
  const normalizedLeaderboardFallbackPayload = useMemo(
    () =>
      normalizeMapOverlayPayloadForRender(
        leaderboardFallbackPayload,
        detectedWorldSize,
      ),
    [detectedWorldSize, leaderboardFallbackPayload],
  );
  const normalizedRuntimeCirclePayload = useMemo(
    () =>
      normalizeMapOverlayPayloadForRender(
        runtimeCirclePayload,
        detectedWorldSize,
      ),
    [detectedWorldSize, runtimeCirclePayload],
  );
  const immediateResolution = useMemo(
    () =>
      runtimePreview
        ? {
            payload: previewPayload,
            selection: {
              overall: "preview" as const,
              map: "preview" as const,
              circle: "preview" as const,
              flightPath: "preview" as const,
              markers: "preview" as const,
            },
          }
        : resolveMapOverlayPayload(
            launcherOnly
              ? [
                  normalizedDirectMapPayloadInput,
                  normalizedLeaderboardFallbackPayload,
                ]
              : [
                  normalizedDirectMapPayloadInput,
                  normalizedLeaderboardFallbackPayload,
                  normalizedRuntimeCirclePayload,
                ],
            normalizedRuntimeMapFallback,
          ),
    [
      launcherOnly,
      normalizedDirectMapPayloadInput,
      normalizedLeaderboardFallbackPayload,
      normalizedRuntimeCirclePayload,
      normalizedRuntimeMapFallback,
      previewPayload,
      runtimePreview,
    ],
  );
  const immediatePayload = immediateResolution.payload;
  const pollMs =
    runtimeWidgetKey === "next-zone-update"
      ? NEXT_ZONE_MAP_STATE_POLL_MS
      : MAP_STATE_POLL_MS;
  const [payload, setPayload] = useState<MapOverlayPayload | null>(
    runtimePreview ? previewPayload : immediatePayload,
  );
  const [status, setStatus] = useState<WidgetRuntimeStatus>(
    runtimePreview
      ? "ready"
      : mapOverlayHasRenderableData(immediatePayload)
        ? "ready"
        : "waiting",
  );
  const [error, setError] = useState<string | null>(null);
  const latestAppliedPayloadRef = useRef<MapOverlayPayload | null>(
    runtimePreview ? previewPayload : immediatePayload,
  );
  useEffect(() => {
    if (!debugRealtime || runtimePreview) {
      return;
    }

    console.debug("[map-overlay][coords][scale-lock]", {
      matchId: runtimeMatchId ?? PREVIEW_MATCH_ID,
      detectedWorldSize,
    });
  }, [
    debugRealtime,
    detectedWorldSize,
    runtimeMatchId,
    runtimePreview,
  ]);
  useEffect(() => {
    if (!debugRealtime || runtimePreview) {
      return;
    }

    console.debug("[map-overlay][incoming][direct-map]", {
      updatedAt: directMapPayloadInput?.updatedAt ?? null,
      source: formatMapOverlaySourceLabel(directMapPayloadInput?.source),
      renderable: mapOverlayHasRenderableData(normalizedDirectMapPayloadInput),
      fresh: isMapOverlayPayloadFresh(normalizedDirectMapPayloadInput, Date.now()),
      detectedWorldSize,
      playerMarkers: normalizedDirectMapPayloadInput?.playerMarkers.length ?? 0,
      teamMarkers: normalizedDirectMapPayloadInput?.teamMarkers.length ?? 0,
      samples: buildMapOverlayCoordinateDebugSamples(
        directMapPayloadInput,
        detectedWorldSize,
      ),
    });
  }, [
    debugRealtime,
    detectedWorldSize,
    directMapPayloadInput,
    normalizedDirectMapPayloadInput,
    runtimePreview,
  ]);
  useEffect(() => {
    if (!debugRealtime || runtimePreview) {
      return;
    }

    console.debug("[map-overlay][incoming][leaderboard-fallback]", {
      updatedAt: leaderboardFallbackPayload?.updatedAt ?? null,
      source: formatMapOverlaySourceLabel(leaderboardFallbackPayload?.source),
      renderable: mapOverlayHasRenderableData(normalizedLeaderboardFallbackPayload),
      fresh: isMapOverlayPayloadFresh(
        normalizedLeaderboardFallbackPayload,
        Date.now(),
      ),
      detectedWorldSize,
      playerMarkers:
        normalizedLeaderboardFallbackPayload?.playerMarkers.length ?? 0,
      teamMarkers:
        normalizedLeaderboardFallbackPayload?.teamMarkers.length ?? 0,
      samples: buildMapOverlayCoordinateDebugSamples(
        leaderboardFallbackPayload,
        detectedWorldSize,
      ),
    });
  }, [
    debugRealtime,
    detectedWorldSize,
    leaderboardFallbackPayload,
    normalizedLeaderboardFallbackPayload,
    runtimePreview,
  ]);
  const applyResolvedMapOverlayState = useEffectEvent(
    (
      nextPayload: MapOverlayPayload | null,
      nextStatus: WidgetRuntimeStatus,
      nextError: string | null,
      selection: MapOverlaySourceSelection,
      reason: string,
    ) => {
      const latestAppliedPayload = latestAppliedPayloadRef.current;
      if (
        nextPayload &&
        latestAppliedPayload &&
        compareMapOverlayPayloadFreshness(nextPayload, latestAppliedPayload) < 0
      ) {
        if (debugRealtime) {
          console.debug("[map-overlay][freshness][rejected]", {
            reason,
            currentUpdatedAt: latestAppliedPayload.updatedAt,
            nextUpdatedAt: nextPayload.updatedAt,
            currentSource: formatMapOverlaySourceLabel(latestAppliedPayload.source),
            nextSource: formatMapOverlaySourceLabel(nextPayload.source),
            selection,
          });
        }
        return;
      }

      const nextSignature = getMapOverlayPayloadSignature(nextPayload);
      setPayload((current) =>
        getMapOverlayPayloadSignature(current) === nextSignature
          ? current
          : nextPayload,
      );
      latestAppliedPayloadRef.current = nextPayload;
      setStatus((current) =>
        current === nextStatus ? current : nextStatus,
      );
      setError((current) => (current === nextError ? current : nextError));
      if (debugRealtime) {
        console.debug("[map-overlay][source]", {
          reason,
          overall: formatMapOverlaySourceLabel(nextPayload?.source),
          selection,
        });
        console.debug("[map-overlay][freshness][accepted]", {
          reason,
          updatedAt: nextPayload?.updatedAt ?? null,
          source: formatMapOverlaySourceLabel(nextPayload?.source),
          selection,
        });
      }
    },
  );

  useEffect(() => {
    if (runtimePreview) {
      applyResolvedMapOverlayState(
        previewPayload,
        "ready",
        null,
        immediateResolution.selection,
        "preview",
      );
      return;
    }

    if (launcherOnly) {
      const hasRenderableImmediatePayload = mapOverlayHasRenderableData(
        immediatePayload,
      );
      applyResolvedMapOverlayState(
        immediatePayload,
        hasRenderableImmediatePayload
          ? "ready"
          : launcherError
            ? "error"
            : launcherLoading
              ? "loading"
              : "waiting",
        hasRenderableImmediatePayload ? null : launcherError,
        immediateResolution.selection,
        "launcher-only",
      );
      return;
    }

    if (immediatePayload && mapOverlayHasRenderableData(immediatePayload)) {
      applyResolvedMapOverlayState(
        immediatePayload,
        "ready",
        null,
        immediateResolution.selection,
        "immediate",
      );
    }

    if (!runtimeMatchId) {
      applyResolvedMapOverlayState(
        immediatePayload,
        mapOverlayHasRenderableData(immediatePayload) ? "ready" : "waiting",
        null,
        immediateResolution.selection,
        "no-match",
      );
      return;
    }

    if (!runtimeCanConsumeLiveTelemetry) {
      applyResolvedMapOverlayState(
        immediatePayload,
        mapOverlayHasRenderableData(immediatePayload) ? "ready" : "waiting",
        null,
        immediateResolution.selection,
        "telemetry-disabled",
      );
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadMapState = async () => {
      try {
        const nextState = await fetchJson<MapOverlayPayload>(
          `${API_URL}/api/matches/${encodeURIComponent(
            runtimeMatchId ?? "",
          )}/overlay/map/state`,
          controller.signal,
        );

        if (cancelled) return;

        const nextDetectedWorldSize =
          lockedDetectedWorldSize ??
          detectMapOverlayWorldSizeFromCandidates([
            directMapPayloadInput,
            leaderboardFallbackPayload,
            runtimeCirclePayload,
            nextState,
          ]) ??
          MAP_OVERLAY_COMPACT_COORDINATE_WORLD_SIZE;
        if (lockedDetectedWorldSize === null) {
          setLockedDetectedWorldSize((current) => current ?? nextDetectedWorldSize);
        }
        const resolvedMap = nextState.map ?? runtimeMapFallback;
        const fallbackState: MapOverlayPayload = {
          matchId: nextState.matchId ?? runtimeMatchId ?? PREVIEW_MATCH_ID,
          updatedAt: nextState.updatedAt ?? null,
          source: "backend-fallback",
          map: resolvedMap,
          circle: nextState.circle ?? null,
          flightPath: nextState.flightPath ?? null,
          teamMarkers: nextState.teamMarkers ?? [],
          playerMarkers: nextState.playerMarkers ?? [],
        };
        const normalizedFallbackState = normalizeMapOverlayPayloadForRender(
          fallbackState,
          nextDetectedWorldSize,
        );
        if (debugRealtime) {
          console.debug("[map-overlay][incoming][backend-fallback]", {
            updatedAt: normalizedFallbackState?.updatedAt ?? null,
            source: formatMapOverlaySourceLabel(normalizedFallbackState?.source),
            renderable: mapOverlayHasRenderableData(normalizedFallbackState),
            detectedWorldSize: nextDetectedWorldSize,
            playerMarkers: normalizedFallbackState?.playerMarkers.length ?? 0,
            teamMarkers: normalizedFallbackState?.teamMarkers.length ?? 0,
            samples: buildMapOverlayCoordinateDebugSamples(
              fallbackState,
              nextDetectedWorldSize,
            ),
          });
        }
        const mergedState = resolveMapOverlayPayload(
          [
            normalizeMapOverlayPayloadForRender(
              directMapPayloadInput,
              nextDetectedWorldSize,
            ),
            normalizedFallbackState,
            normalizeMapOverlayPayloadForRender(
              leaderboardFallbackPayload,
              nextDetectedWorldSize,
            ),
            normalizeMapOverlayPayloadForRender(
              runtimeCirclePayload,
              nextDetectedWorldSize,
            ),
          ],
          normalizedRuntimeMapFallback,
        );

        applyResolvedMapOverlayState(
          mergedState.payload,
          mapOverlayHasRenderableData(mergedState.payload) ? "ready" : "waiting",
          null,
          mergedState.selection,
          "backend-merge",
        );
      } catch (nextError) {
        if (cancelled || controller.signal.aborted) return;
        if (immediatePayload && mapOverlayHasRenderableData(immediatePayload)) {
          applyResolvedMapOverlayState(
            immediatePayload,
            "ready",
            null,
            immediateResolution.selection,
            "fallback-immediate",
          );
          return;
        }
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to load tactical map state.",
        );
        setStatus("error");
      }
    };

    setStatus(
      immediatePayload && mapOverlayHasRenderableData(immediatePayload)
        ? "ready"
        : "loading",
    );
    void loadMapState();
    const interval = window.setInterval(() => {
      void loadMapState();
    }, pollMs);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      controller.abort();
    };
  }, [
    launcherError,
    launcherLoading,
    launcherOnly,
    directMapPayloadInput,
    leaderboardFallbackPayload,
    lockedDetectedWorldSize,
    normalizedRuntimeMapFallback,
    pollMs,
    immediatePayload,
    immediateResolution.selection,
    previewPayload,
    runtimeCanConsumeLiveTelemetry,
    runtimeMapName,
    runtimeMatchId,
    runtimePreview,
    runtimeMapFallback,
    runtimeCirclePayload,
    debugRealtime,
  ]);

  return {
    payload: runtimePreview ? previewPayload : payload,
    status: runtimePreview ? ("ready" as const) : status,
    error,
    usingPreviewData: runtimePreview,
  };
}

function useWwcdFeed(runtime: WidgetRuntime) {
  const [armed, setArmed] = useState(runtime.preview);
  const [visible, setVisible] = useState(false);
  const showFrameRef = useRef<number | null>(null);
  const lastTriggeredEventRef = useRef<string | null>(null);
  const clearPendingAnimation = useEffectEvent(() => {
    if (showFrameRef.current !== null) {
      window.cancelAnimationFrame(showFrameRef.current);
      showFrameRef.current = null;
    }
  });

  const reveal = useEffectEvent(() => {
    clearPendingAnimation();

    if (!armed) {
      setArmed(true);
    }

    showFrameRef.current = window.requestAnimationFrame(() => {
      setVisible(true);
      showFrameRef.current = null;
    });
    console.info("[Widget] WWCD triggered");
  });

  useEffect(() => {
    clearPendingAnimation();
    lastTriggeredEventRef.current = null;
    setArmed(runtime.preview);
    setVisible(false);

    if (runtime.preview) {
      showFrameRef.current = window.requestAnimationFrame(() => {
        setVisible(true);
        showFrameRef.current = null;
      });
    }

    return () => {
      clearPendingAnimation();
    };
  }, [runtime.matchId, runtime.preview]);

  useEffect(() => {
    if (runtime.preview) {
      return;
    }

    if (!runtime.payload.winner) {
      return;
    }

    const eventKey = `${runtime.payload.matchId}:${runtime.payload.updatedAt}`;
    if (lastTriggeredEventRef.current === eventKey) {
      return;
    }

    lastTriggeredEventRef.current = eventKey;
    reveal();
  }, [
    runtime.payload.matchId,
    runtime.payload.updatedAt,
    runtime.payload.winner,
    runtime.preview,
  ]);

  return {
    armed,
    visible,
  };
}

type MapOverlayViewport = {
  scale: number;
  translateX: number;
  translateY: number;
  focusMode: "full" | "zone" | "players" | "tactical";
};

type MapOverlayManualTransform = Pick<
  MapOverlayViewport,
  "scale" | "translateX" | "translateY"
>;

type MapOverlayTeamSummary = {
  teamId: string;
  slot: number | null;
  label: string;
  shortLabel: string;
  teamName: string;
  logoUrl: string | null;
  color: string;
  kills: number;
  alivePlayers: number;
  totalPlayers: number;
  standingPlayers: number;
  knockedPlayers: number;
  deadPlayers: number;
  isEliminated: boolean;
  anchor: { x: number; y: number };
  distanceToFocus: number;
};

function clampMapOverlayTranslate(scale: number, translate: number) {
  return clampMapOverlay(translate, 100 - 100 * scale, 0);
}

function resolveMapOverlayViewportAnchor(
  payload: MapOverlayPayload,
  markers: Array<{ x: number; y: number }>,
) {
  if (payload.circle?.nextZone) {
    return { x: payload.circle.nextZone.x, y: payload.circle.nextZone.y };
  }

  if (payload.circle?.safeZone) {
    return { x: payload.circle.safeZone.x, y: payload.circle.safeZone.y };
  }

  if (markers.length === 0) {
    return null;
  }

  return {
    x: markers.reduce((sum, marker) => sum + marker.x, 0) / markers.length,
    y: markers.reduce((sum, marker) => sum + marker.y, 0) / markers.length,
  };
}

function selectMapOverlayTacticalBounds(
  payload: MapOverlayPayload,
  worldSize: number,
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  const finitePlayers = payload.playerMarkers.filter(
    (marker) => Number.isFinite(marker.x) && Number.isFinite(marker.y),
  );
  const finiteTeams = payload.teamMarkers.filter(
    (marker) => Number.isFinite(marker.x) && Number.isFinite(marker.y),
  );
  const livePlayers = finitePlayers.filter((marker) => marker.alive !== false);
  const liveTeams = finiteTeams.filter((marker) => marker.alive !== false);
  const teamAnchors = (liveTeams.length > 0 ? liveTeams : finiteTeams).filter(
    (marker): marker is MapOverlayTeamMarker & { teamId: string } =>
      typeof marker.teamId === "string" && marker.teamId.length > 0,
  );
  const anchor = resolveMapOverlayViewportAnchor(
    payload,
    livePlayers.length > 0
      ? livePlayers
      : liveTeams.length > 0
        ? liveTeams
        : finitePlayers.length > 0
          ? finitePlayers
          : finiteTeams,
  );
  const clusterRadius = clampMapOverlay(
    (payload.circle?.nextZone?.r ?? payload.circle?.safeZone?.r ?? worldSize * 0.16) *
      0.72,
    worldSize * 0.1,
    worldSize * 0.24,
  );

  let selectedPlayers = livePlayers;
  let selectedTeams = liveTeams.length > 0 ? liveTeams : finiteTeams;

  if (teamAnchors.length > 0) {
    let bestTeamIds = new Set<string>();
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const marker of teamAnchors) {
      const members = teamAnchors.filter((candidate) => {
        return (
          Math.hypot(candidate.x - marker.x, candidate.y - marker.y) <=
          clusterRadius
        );
      });
      const centerX =
        members.reduce((sum, candidate) => sum + candidate.x, 0) / members.length;
      const centerY =
        members.reduce((sum, candidate) => sum + candidate.y, 0) / members.length;
      const averageDistance =
        members.reduce(
          (sum, candidate) =>
            sum + Math.hypot(candidate.x - centerX, candidate.y - centerY),
          0,
        ) / members.length;
      const anchorDistance = anchor
        ? Math.hypot(centerX - anchor.x, centerY - anchor.y)
        : 0;
      const score = members.length * 10_000 - averageDistance * 6 - anchorDistance;

      if (score > bestScore) {
        bestScore = score;
        bestTeamIds = new Set(members.map((candidate) => candidate.teamId));
      }
    }

    if (bestTeamIds.size > 0) {
      const clusteredPlayers = livePlayers.filter(
        (marker) => marker.teamId && bestTeamIds.has(marker.teamId),
      );
      const clusteredTeams = teamAnchors.filter((marker) =>
        bestTeamIds.has(marker.teamId),
      );
      if (clusteredPlayers.length > 0 || clusteredTeams.length > 0) {
        selectedPlayers = clusteredPlayers;
        selectedTeams = clusteredTeams;
      }
    }
  }

  const tacticalSource =
    selectedPlayers.length > 0
      ? selectedPlayers
      : selectedTeams.length > 0
        ? selectedTeams
        : finitePlayers.length > 0
          ? finitePlayers
          : finiteTeams;
  const limitedSource =
    anchor && tacticalSource.length > 0
      ? [...tacticalSource]
          .sort((left, right) => {
            return (
              Math.hypot(left.x - anchor.x, left.y - anchor.y) -
              Math.hypot(right.x - anchor.x, right.y - anchor.y)
            );
          })
          .slice(0, tacticalSource === selectedPlayers ? 24 : 10)
      : tacticalSource;

  if (limitedSource.length === 0) {
    return null;
  }

  let minX = worldSize;
  let maxX = 0;
  let minY = worldSize;
  let maxY = 0;

  for (const marker of limitedSource) {
    minX = Math.min(minX, marker.x);
    maxX = Math.max(maxX, marker.x);
    minY = Math.min(minY, marker.y);
    maxY = Math.max(maxY, marker.y);
  }

  return { minX, maxX, minY, maxY };
}

function buildMapOverlayViewport(
  payload: MapOverlayPayload | null,
  focusOverride: MapOverlayViewport["focusMode"] | null = null,
): MapOverlayViewport {
  const worldSize = payload?.map?.worldSize ?? null;
  if (!payload?.map || !worldSize) {
    return { scale: 1, translateX: 0, translateY: 0, focusMode: "full" };
  }

  const safeZone = payload.circle?.safeZone ?? null;
  const nextZone = payload.circle?.nextZone ?? null;
  const markerFocusSource =
    payload.playerMarkers.length > 0 ? payload.playerMarkers : payload.teamMarkers;
  const requestedFocusMode =
    focusOverride ??
    (safeZone || nextZone
      ? "zone"
      : markerFocusSource.length > 0
        ? "players"
        : "full");
  const shouldForceFull = requestedFocusMode === "full";

  if (shouldForceFull) {
    return { scale: 1, translateX: 0, translateY: 0, focusMode: "full" };
  }

  let minX = worldSize;
  let maxX = 0;
  let minY = worldSize;
  let maxY = 0;
  let focusMode: MapOverlayViewport["focusMode"] =
    focusOverride ?? "full";

  const includePoint = (x: number, y: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };

  const includeCircle = (circle: { x: number; y: number; r: number }) => {
    includePoint(circle.x - circle.r, circle.y - circle.r);
    includePoint(circle.x + circle.r, circle.y + circle.r);
  };

  if (requestedFocusMode === "tactical") {
    const tacticalBounds = selectMapOverlayTacticalBounds(payload, worldSize);
    if (tacticalBounds) {
      includePoint(tacticalBounds.minX, tacticalBounds.minY);
      includePoint(tacticalBounds.maxX, tacticalBounds.maxY);
      focusMode = "tactical";
    }
  }

  if (focusMode === "full" && requestedFocusMode === "zone") {
    if (safeZone) {
      includeCircle(safeZone);
      focusMode = "zone";
    }
    if (nextZone) {
      includeCircle(nextZone);
      focusMode = "zone";
    }
  }

  if (
    focusMode === "full" &&
    (requestedFocusMode === "players" || requestedFocusMode === "tactical")
  ) {
    for (const marker of markerFocusSource) {
      includePoint(marker.x, marker.y);
    }
    if (markerFocusSource.length > 0) {
      focusMode = "players";
    }
  }

  if (focusMode === "full") {
    return { scale: 1, translateX: 0, translateY: 0, focusMode };
  }

  const baseSpan = Math.max(maxX - minX, maxY - minY);
  const minWindow =
    focusMode === "zone"
      ? worldSize * 0.18
      : focusMode === "tactical"
        ? worldSize * 0.11
        : worldSize * 0.24;
  const paddedSpan = clampMapOverlay(
    baseSpan *
      (focusMode === "zone"
        ? 1.28
        : focusMode === "tactical"
          ? 1.45
          : 1.7),
    minWindow,
    worldSize,
  );
  const halfSpan = paddedSpan / 2;
  const centerX = clampMapOverlay((minX + maxX) / 2, halfSpan, worldSize - halfSpan);
  const centerY = clampMapOverlay((minY + maxY) / 2, halfSpan, worldSize - halfSpan);
  const scale = clampMapOverlay(
    worldSize / Math.max(paddedSpan, worldSize * 0.12),
    1,
    focusMode === "zone"
      ? 4.25
      : focusMode === "tactical"
        ? 5.2
        : 3.35,
  );
  const focusPoint = normalizeMapOverlayPoint(
    centerX,
    centerY,
    worldSize,
    payload.map.coordinateSystem,
    payload.map.mapName,
  );
  const halfWindowPct = 50 / scale;
  const clampedLeft = clampMapOverlay(
    focusPoint.left,
    halfWindowPct,
    100 - halfWindowPct,
  );
  const clampedTop = clampMapOverlay(
    focusPoint.top,
    halfWindowPct,
    100 - halfWindowPct,
  );

  return {
    scale,
    translateX: 50 - clampedLeft * scale,
    translateY: 50 - clampedTop * scale,
    focusMode,
  };
}

function resolveMapOverlayTeamsAlive(
  runtimePayload: MatchStatePayload,
  overlay: MapOverlayPayload | null | undefined,
) {
  const payloadTeamsAlive =
    typeof runtimePayload.teamsAlive === "number" &&
    Number.isFinite(runtimePayload.teamsAlive)
      ? Math.max(0, Math.trunc(runtimePayload.teamsAlive))
      : 0;
  const leaderboardTeamsAlive = Array.isArray(runtimePayload.leaderboard)
    ? runtimePayload.leaderboard.filter((row) => (row.alivePlayers ?? 0) > 0).length
    : 0;
  const overlayTeamsAlive = Array.isArray(overlay?.teamMarkers)
    ? overlay.teamMarkers.filter((marker) => marker.alive !== false).length
    : 0;

  return Math.max(payloadTeamsAlive, leaderboardTeamsAlive, overlayTeamsAlive);
}

function TeamLogo({
  logoUrl,
  label,
  color,
  size = 44,
  chrome = "framed",
  fit = "cover",
}: {
  logoUrl?: string | null;
  label: string;
  color: string;
  size?: number;
  chrome?: "framed" | "bare";
  fit?: "cover" | "contain";
}) {
  const src = ensureApiUrl(logoUrl ?? DEFAULT_TEAM_LOGO_URL);
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <div
      className={`vx-team-logo flex shrink-0 items-center justify-center overflow-hidden ${
        chrome === "framed" ? "rounded-[14px] border" : ""
      }`}
      style={{
        width: size,
        height: size,
        borderColor:
          chrome === "framed" ? alphaColor(color, 0.34) : "transparent",
        background:
          chrome === "framed"
            ? `linear-gradient(180deg, ${alphaColor(
                color,
                0.28,
              )}, ${alphaColor(darkenHexColor(color, 0.55), 0.9)})`
            : "transparent",
        boxShadow:
          chrome === "framed" ? `0 0 24px ${alphaColor(color, 0.2)}` : "none",
      }}
    >
      {src ? (
        <img
          src={src}
          alt={label}
          className={`h-full w-full ${fit === "contain" ? "object-contain" : "object-cover"}`}
          draggable={false}
        />
      ) : (
        <span
          className={`text-white ${
            chrome === "framed"
              ? "text-sm font-semibold tracking-[0.18em]"
              : "text-lg font-black tracking-[0.16em]"
          }`}
        >
          {initials || DEFAULT_WIDGET_TEAM_TAG}
        </span>
      )}
    </div>
  );
}

type RotatingLogoItem = {
  id: string;
  label: string;
  logoUrl: string | null;
  kind: "tournament" | "sponsor";
};

function RotatingBrandLogo({
  items,
  toneColor,
  showKindLabel = true,
  logoSize = 72,
  logoChrome = "framed",
  logoFit = "cover",
}: {
  items: RotatingLogoItem[];
  toneColor: string;
  showKindLabel?: boolean;
  logoSize?: number;
  logoChrome?: "framed" | "bare";
  logoFit?: "cover" | "contain";
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const itemsKey = items
    .map((item) =>
      [item.kind, item.id, item.logoUrl ?? "", item.label].join(":"),
    )
    .join("|");
  const safeIndex = items.length > 0 ? activeIndex % items.length : 0;

  useEffect(() => {
    setActiveIndex(0);
    setVisible(true);
  }, [itemsKey]);

  useEffect(() => {
    if (items.length <= 1) {
      return;
    }

    const interval = window.setInterval(() => {
      setVisible(false);
      window.setTimeout(() => {
        setActiveIndex((current) => (current + 1) % items.length);
        setVisible(true);
      }, 180);
    }, 15_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [items.length, itemsKey]);

  const activeItem = items[safeIndex] ?? null;
  if (!activeItem) {
    return null;
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="transition-opacity duration-200"
        style={{ opacity: visible ? 1 : 0 }}
      >
        <TeamLogo
          logoUrl={activeItem.logoUrl}
          label={activeItem.label}
          color={toneColor}
          size={logoSize}
          chrome={logoChrome}
          fit={logoFit}
        />
      </div>
      {showKindLabel ? (
        <div
          className="text-center text-[9px] font-semibold uppercase tracking-[0.24em]"
          style={readableTextStyle("label")}
        >
          {activeItem.kind === "tournament" ? "Tournament" : "Sponsor"}
        </div>
      ) : null}
    </div>
  );
}

function AliveBars({
  alivePlayers,
  totalPlayers,
  players,
  color,
  compact,
}: {
  alivePlayers: number;
  totalPlayers?: number | null;
  players?: MatchStateLeaderboardPlayer[];
  color: string;
  compact?: boolean;
}) {
  const slots = Math.max(1, Math.min(4, totalPlayers ?? players?.length ?? 4));
  const barWidth = compact ? 4 : 5;
  const barHeight = compact ? 11 : 14;
  const orderedPlayers =
    Array.isArray(players) && players.length > 0
      ? [...players]
          .slice(0, slots)
          .sort((left, right) => {
            const leftStanding =
              left.hasDied !== true && left.alive === true && left.knocked !== true;
            const rightStanding =
              right.hasDied !== true &&
              right.alive === true &&
              right.knocked !== true;
            if (leftStanding !== rightStanding) {
              return Number(rightStanding) - Number(leftStanding);
            }

            const leftKnocked =
              left.hasDied !== true && left.alive === true && left.knocked === true;
            const rightKnocked =
              right.hasDied !== true &&
              right.alive === true &&
              right.knocked === true;
            if (leftKnocked !== rightKnocked) {
              return Number(rightKnocked) - Number(leftKnocked);
            }

            const leftDead = left.hasDied === true || left.alive !== true;
            const rightDead = right.hasDied === true || right.alive !== true;
            if (leftDead !== rightDead) {
              return Number(leftDead) - Number(rightDead);
            }

            return 0;
          })
      : null;
  const normalizedPlayers =
    orderedPlayers;
  const hasFreshPlayerTelemetry =
    normalizedPlayers?.some((player) => player.lifeTelemetryFresh === true) ??
    false;
  const activeBars = Math.max(0, Math.min(slots, alivePlayers));

  return (
    <div className="flex items-end justify-center gap-[3px]">
      {Array.from({ length: slots }, (_, index) => {
        const player = hasFreshPlayerTelemetry
          ? (normalizedPlayers?.[index] ?? null)
          : null;
        const playerFresh = player?.lifeTelemetryFresh === true;
        const alive =
          playerFresh
            ? player.hasDied === true
              ? false
              : player.alive
            : index < activeBars;
        const knocked = playerFresh && alive && player.knocked === true;
        const healthRatio =
          playerFresh &&
          player.health !== null &&
          player.health !== undefined
            ? Math.max(0, Math.min(1, player.health / 100))
            : alive
              ? knocked
                ? 0.28
                : 1
              : 0;
        const fillHeight = alive
          ? `${Math.max(16, Math.round(healthRatio * 100))}%`
          : "0%";
        const knockedBase = "#f97316";
        const knockedHighlight = "#fdba74";
        const fillColor = knocked
          ? knockedBase
          : alphaColor(color, alive ? 0.94 : 0.16);

        return (
          <span
            key={index}
            className="relative overflow-hidden rounded-[2px] border"
            style={{
              width: `${barWidth}px`,
              height: `${barHeight}px`,
              borderColor: alive
                ? knocked
                  ? alphaColor(knockedBase, 0.92)
                  : alphaColor(color, 0.55)
                : "rgba(255,255,255,0.08)",
              background: knocked
                ? alphaColor(knockedBase, 0.2)
                : "rgba(255,255,255,0.08)",
              boxShadow: alive
                ? `0 0 10px ${alphaColor(
                    knocked ? knockedBase : color,
                    knocked ? 0.4 : 0.18,
                  )}`
                : "none",
            }}
          >
            <span
              className="absolute inset-x-0 bottom-0 rounded-[1px]"
              style={{
                height: fillHeight,
                background: alive
                  ? knocked
                    ? `linear-gradient(180deg, ${alphaColor(
                        knockedHighlight,
                        0.98,
                      )}, ${alphaColor(fillColor, 0.95)})`
                    : `linear-gradient(180deg, ${alphaColor(
                        "#ffffff",
                        0.98,
                      )}, ${fillColor})`
                  : "transparent",
              }}
            />
            {knocked ? (
              <>
                <span
                  className="absolute inset-x-0 top-[2px] h-[2px] rounded-full"
                  style={{ background: alphaColor(knockedHighlight, 0.98) }}
                />
                <span
                  className="absolute inset-0"
                  style={{
                    background:
                      "repeating-linear-gradient(135deg, rgba(255,255,255,0.06) 0 2px, transparent 2px 4px)",
                    opacity: 0.75,
                  }}
                />
              </>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

function SignalPill({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "accent" | "live";
}) {
  const style: CSSProperties =
    tone === "accent"
      ? {
          borderColor: "var(--vx-accent-soft)",
          background: "var(--vx-accent-wash)",
          color: "var(--vx-badge-text, #ffffff)",
        }
      : tone === "live"
        ? {
            borderColor: "var(--vx-live-soft)",
            background: "var(--vx-live-wash)",
            color: "var(--vx-badge-text, #ffffff)",
          }
        : {
            borderColor: "var(--vx-border, rgba(255,255,255,0.12))",
            background: "rgba(255,255,255,0.06)",
            color: "var(--vx-text-label, rgba(255,255,255,0.72))",
            textShadow:
              "var(--vx-text-shadow-soft, 0 1px 0 rgba(0,0,0,0.72))",
          };

  return (
    <span
      className="inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em]"
      style={style}
    >
      {children}
    </span>
  );
}

type ReadableTextRole = "eyebrow" | "label" | "meta" | "muted" | "hint";

function readableTextStyle(role: ReadableTextRole = "meta"): CSSProperties {
  switch (role) {
    case "eyebrow":
      return {
        color: "var(--vx-text-eyebrow, rgba(255,255,255,0.76))",
        textShadow:
          "var(--vx-text-shadow-strong, 0 1px 0 rgba(0,0,0,0.82))",
      };
    case "label":
      return {
        color: "var(--vx-text-label, rgba(255,255,255,0.7))",
        textShadow:
          "var(--vx-text-shadow-soft, 0 1px 0 rgba(0,0,0,0.72))",
      };
    case "muted":
      return {
        color: "var(--vx-text-muted-strong, rgba(255,255,255,0.6))",
        textShadow:
          "var(--vx-text-shadow-soft, 0 1px 0 rgba(0,0,0,0.72))",
      };
    case "hint":
      return {
        color: "var(--vx-text-hint, rgba(255,255,255,0.56))",
        textShadow:
          "var(--vx-text-shadow-soft, 0 1px 0 rgba(0,0,0,0.72))",
      };
    case "meta":
    default:
      return {
        color: "var(--vx-text-meta, rgba(255,255,255,0.66))",
        textShadow:
          "var(--vx-text-shadow-soft, 0 1px 0 rgba(0,0,0,0.72))",
      };
  }
}

function readableEmptyStateStyle(): CSSProperties {
  return {
    color: "var(--vx-text-muted-strong, rgba(255,255,255,0.6))",
    textShadow:
      "var(--vx-text-shadow-soft, 0 1px 0 rgba(0,0,0,0.72))",
  };
}

const LIVE_READABLE_FRAME_CSS = `
  .vx-live-readable-frame :is(div, section, article)[class*="rounded-"][class*="border"]:not(.vx-team-logo):not([class*="rounded-full"]):not([class*="rounded-[2px]"]) {
    background: var(--vx-live-card-bg) !important;
    border-color: var(--vx-live-card-border) !important;
    box-shadow: var(--vx-live-card-shadow) !important;
  }

  .vx-live-readable-frame [class*="text-white/"] {
    color: var(--vx-live-muted-text) !important;
  }
`;

function BroadcastFrame({
  runtime,
  toneColor,
  className,
  style,
  transparent = false,
  children,
}: {
  runtime: WidgetRuntime;
  toneColor: string;
  className: string;
  style?: CSSProperties;
  transparent?: boolean;
  children: ReactNode;
}) {
  const cleanFrame = runtime.clean;
  const brandBackdrop = buildBrandBackdrop(runtime.branding);
  const shellVeilTop = alphaColor(
    runtime.branding.effectiveBackground,
    cleanFrame ? 0.46 : 0.54,
  );
  const shellVeilBottom = alphaColor(
    darkenHexColor(runtime.branding.effectiveBackground, 0.08),
    cleanFrame ? 0.72 : 0.8,
  );
  const brandedWash = alphaColor(toneColor, cleanFrame ? 0.16 : 0.12);
  const accentWash = alphaColor(runtime.branding.accent, cleanFrame ? 0.1 : 0.08);
  const readableFrameVars = {
    "--vx-live-card-bg": [
      `linear-gradient(135deg, ${alphaColor(toneColor, 0.22)} 0%, ${alphaColor(
        runtime.branding.effectiveBackground,
        0.9,
      )} 38%, ${alphaColor(
        darkenHexColor(runtime.branding.effectiveBackground, 0.1),
        0.98,
      )} 100%)`,
      `linear-gradient(90deg, ${alphaColor(
        runtime.branding.accent,
        0.08,
      )}, transparent 72%)`,
    ].join(", "),
    "--vx-live-card-border": alphaColor(toneColor, 0.42),
    "--vx-live-card-shadow": `0 16px 46px ${alphaColor("#000000", 0.26)}`,
    "--vx-live-primary-text": alphaColor(runtime.branding.textPrimary, 0.98),
    "--vx-live-muted-text": alphaColor(runtime.branding.textPrimary, 0.82),
    "--vx-text-eyebrow": alphaColor(runtime.branding.textPrimary, 0.86),
    "--vx-text-label": alphaColor(runtime.branding.textPrimary, 0.84),
    "--vx-text-meta": alphaColor(runtime.branding.textPrimary, 0.82),
    "--vx-text-muted-strong": alphaColor(runtime.branding.textPrimary, 0.82),
    "--vx-text-hint": alphaColor(runtime.branding.textPrimary, 0.8),
  } as CSSProperties;

  return (
    <div
      className={`vx-live-readable-frame relative overflow-hidden border ${cleanFrame || transparent ? "" : "backdrop-blur-xl"} ${className}`}
      style={{
        ...readableFrameVars,
        borderColor: alphaColor(toneColor, 0.28),
        background: transparent
          ? "transparent"
          : [
              `linear-gradient(135deg, ${brandedWash} 0%, ${accentWash} 28%, transparent 62%)`,
              `linear-gradient(180deg, ${shellVeilTop}, ${shellVeilBottom})`,
              brandBackdrop,
            ].join(", "),
        boxShadow: cleanFrame || transparent
          ? "none"
          : `0 32px 110px ${alphaColor(toneColor, 0.16)}`,
        clipPath:
          "polygon(24px 0, 100% 0, 100% calc(100% - 24px), calc(100% - 24px) 100%, 0 100%, 0 24px)",
        ...style,
      }}
    >
      <style>{LIVE_READABLE_FRAME_CSS}</style>
      {transparent ? null : (
        <>
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: [
                `linear-gradient(135deg, ${alphaColor(toneColor, 0.18)}, transparent 34%)`,
                `linear-gradient(90deg, ${alphaColor(toneColor, 0.05)} 1px, transparent 1px)`,
                `linear-gradient(180deg, ${alphaColor(toneColor, 0.04)} 1px, transparent 1px)`,
              ].join(", "),
              backgroundSize: "100% 100%, 28px 28px, 28px 28px",
              opacity: 0.8,
            }}
          />
          <div
            className="pointer-events-none absolute left-0 top-0 h-1 w-40"
            style={{
              background: `linear-gradient(90deg, ${toneColor}, transparent)`,
            }}
          />
          <div
            className="pointer-events-none absolute right-0 top-0 h-1 w-24"
            style={{
              background: `linear-gradient(270deg, ${alphaColor(
                runtime.branding.accent,
                0.96,
              )}, transparent)`,
            }}
          />
          <div
            className="pointer-events-none absolute bottom-0 right-0 h-32 w-40"
            style={{
              background: `radial-gradient(circle at 100% 100%, ${alphaColor(
                toneColor,
                cleanFrame ? 0.18 : 0.14,
              )} 0%, transparent 68%)`,
            }}
          />
          <div
            className="pointer-events-none absolute inset-x-8 top-16 h-px"
            style={{
              background: `linear-gradient(90deg, transparent, ${alphaColor(
                toneColor,
                0.24,
              )}, transparent)`,
            }}
          />
        </>
      )}
      <div className="relative">{children}</div>
    </div>
  );
}

function StatTile({
  label,
  value,
  toneColor,
}: {
  label: string;
  value: string | number;
  toneColor: string;
}) {
  return (
    <div
      className="rounded-[22px] border px-4 py-4 text-center"
      style={{
        borderColor: alphaColor(toneColor, 0.2),
        background: `linear-gradient(180deg, ${alphaColor(
          toneColor,
          0.18,
        )}, rgba(255,255,255,0.03))`,
      }}
    >
      <div className="text-3xl font-black leading-none text-white">{value}</div>
      <div
        className="mt-2 text-[10px] uppercase tracking-[0.24em]"
        style={readableTextStyle("label")}
      >
        {label}
      </div>
    </div>
  );
}

function WidgetSurface({
  runtime,
  anchor = "start",
  align = "stretch",
  fullBleed = false,
  transparentPreview = false,
  children,
}: {
  runtime: WidgetRuntime;
  anchor?: "start" | "end" | "center";
  align?: "stretch" | "start" | "end" | "center";
  fullBleed?: boolean;
  transparentPreview?: boolean;
  children: ReactNode;
}) {
  const liveToneColor = resolveLiveToneColor(runtime.branding);
  const cssVars = {
    ...buildBrandingCssVars(runtime.branding),
    "--vx-accent-soft": alphaColor(runtime.branding.accent, 0.24),
    "--vx-accent-wash": alphaColor(runtime.branding.accent, 0.14),
    "--vx-live-soft": alphaColor(liveToneColor, 0.24),
    "--vx-live-wash": alphaColor(liveToneColor, 0.14),
    "--vx-text-eyebrow": alphaColor(runtime.branding.textPrimary, 0.76),
    "--vx-text-label": alphaColor(runtime.branding.textPrimary, 0.7),
    "--vx-text-meta": alphaColor(runtime.branding.textPrimary, 0.66),
    "--vx-text-muted-strong": alphaColor(runtime.branding.textPrimary, 0.6),
    "--vx-text-hint": alphaColor(runtime.branding.textPrimary, 0.56),
    "--vx-text-shadow-soft": `0 1px 0 ${alphaColor(
      "#000000",
      0.76,
    )}, 0 0 10px ${alphaColor("#000000", 0.18)}`,
    "--vx-text-shadow-strong": `0 1px 0 ${alphaColor(
      "#000000",
      0.82,
    )}, 0 0 16px ${alphaColor("#000000", 0.22)}`,
  } as CSSProperties;
  const brandBackdrop = buildBrandBackdrop(runtime.branding);
  const showPreviewChrome =
    runtime.preview && !runtime.clean && !transparentPreview;
  const previewBackground = showPreviewChrome
    ? [
        `radial-gradient(circle at 20% 0%, ${alphaColor(
          runtime.branding.primaryColor,
          0.18,
        )}, transparent 36%)`,
        `radial-gradient(circle at 100% 100%, ${alphaColor(
          runtime.branding.accent,
          0.14,
        )}, transparent 26%)`,
        `linear-gradient(180deg, ${alphaColor(
          runtime.branding.effectiveBackground,
          0.22,
        )}, ${alphaColor(
          darkenHexColor(runtime.branding.effectiveBackground, 0.08),
          0.42,
        )})`,
        brandBackdrop,
      ].join(", ")
    : "transparent";
  const justifyContent =
    anchor === "center"
      ? "center"
      : anchor === "end"
        ? "flex-end"
        : "flex-start";
  const alignItems =
    align === "center"
      ? "center"
      : align === "end"
        ? "flex-end"
        : align === "start"
          ? "flex-start"
          : "stretch";
  const { viewportRef, scale, scaledWidth, scaledHeight } =
    useFixedWidgetCanvasScale();

  return (
    <div
      ref={viewportRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden bg-transparent"
    >
      <div
        className="relative shrink-0"
        style={{
          width: `${scaledWidth}px`,
          height: `${scaledHeight}px`,
        }}
      >
        <main
          className="vx-widget-theme absolute left-0 top-0 relative flex box-border overflow-hidden"
          style={{
            ...cssVars,
            width: `${WIDGET_CANVAS_WIDTH}px`,
            height: `${WIDGET_CANVAS_HEIGHT}px`,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            background: previewBackground,
            color: runtime.branding.textPrimary,
            paddingLeft: fullBleed ? "0" : "2rem",
            paddingRight: fullBleed ? "0" : "2rem",
            paddingTop: fullBleed ? "0" : "2rem",
            paddingBottom: showPreviewChrome
              ? fullBleed
                ? "0"
                : "6rem"
              : fullBleed
                ? "0"
                : "2rem",
          }}
        >
          <style>{WIDGET_THEME_OVERRIDE_CSS}</style>
          {showPreviewChrome ? (
            <>
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage: [
                    `linear-gradient(90deg, ${alphaColor(
                      runtime.branding.primaryColor,
                      0.05,
                    )} 1px, transparent 1px)`,
                    `linear-gradient(180deg, ${alphaColor(
                      runtime.branding.primaryColor,
                      0.04,
                    )} 1px, transparent 1px)`,
                  ].join(", "),
                  backgroundSize: "48px 48px, 48px 48px",
                  opacity: 0.55,
                }}
              />
              <div
                className="pointer-events-none absolute left-[-10%] top-[-12%] h-[420px] w-[420px] rounded-full blur-3xl"
                style={{
                  background: alphaColor(runtime.branding.primaryColor, 0.16),
                }}
              />
              <div
                className="pointer-events-none absolute bottom-[-18%] right-[-8%] h-[360px] w-[360px] rounded-full blur-3xl"
                style={{
                  background: alphaColor(runtime.branding.accent, 0.12),
                }}
              />
            </>
          ) : null}
          <div
            className="relative flex h-full w-full box-border"
            style={{ justifyContent, alignItems }}
          >
            {children}
          </div>
          {showPreviewChrome ? (
            <div className="pointer-events-none absolute inset-x-8 bottom-6 flex items-center justify-between">
              <div className="flex flex-wrap gap-2">
                <SignalPill tone="accent">
                  {runtime.organizationSlug ?? "preview"}
                </SignalPill>
                <SignalPill>{runtime.matchId ?? "live auto"}</SignalPill>
                <SignalPill tone={runtime.status === "ready" ? "live" : "default"}>
                  {runtime.usingPreviewData ? "preview data" : runtime.status}
                </SignalPill>
              </div>
              <SignalPill>{formatAgo(runtime.lastEventAt)}</SignalPill>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}

function WidgetEmptyState({
  runtime,
  title,
  subtitle,
}: {
  runtime: WidgetRuntime;
  title: string;
  subtitle: string;
}) {
  if (!runtime.preview && runtime.status !== "error") {
    return null;
  }

  const errorTone = resolveWidgetToneColor(runtime.branding, "accent");

  return (
    <WidgetSurface runtime={runtime} anchor="center">
      <div
        className="max-w-xl rounded-[28px] border p-8"
        style={{
          borderColor: alphaColor(runtime.branding.primaryColor, 0.24),
          background: `linear-gradient(180deg, ${alphaColor(
            runtime.branding.effectiveBackground,
            0.9,
          )}, ${alphaColor(
            darkenHexColor(runtime.branding.effectiveBackground, 0.08),
            0.96,
          )})`,
          boxShadow: runtime.branding.shadow,
        }}
      >
        <div
          className="text-[11px] font-semibold uppercase tracking-[0.3em]"
          style={readableTextStyle("label")}
        >
          Arenzyra TELEMETRY
        </div>
        <div className="mt-4 text-4xl font-black uppercase tracking-[0.22em] text-white">
          {title}
        </div>
        <p
          className="mt-4 text-sm leading-7"
          style={readableTextStyle("muted")}
        >
          {subtitle}
        </p>
        {runtime.error ? (
          <div
            className="mt-5 rounded-2xl border px-4 py-3 text-sm"
            style={{
              borderColor: alphaColor(errorTone, 0.18),
              background: alphaColor(errorTone, 0.12),
              color: runtime.branding.textPrimary,
            }}
          >
            {runtime.error}
          </div>
        ) : null}
      </div>
    </WidgetSurface>
  );
}

function useWidgetRuntime(
  widgetKey: LiveWidgetKey,
  options?: {
    externalPayload?: boolean;
    skipLiveStatePayload?: boolean;
  },
): WidgetRuntime {
  const searchParams = useSearchParams();
  const preview = searchParams.get("preview") === "true";
  const clean = searchParams.get("clean") === "1" || !preview;
  const organizationSlug = searchParams.get("orgSlug")?.trim() || null;
  const explicitMatchId = searchParams.get("matchId")?.trim() || null;
  const usesExternalPayload = options?.externalPayload === true;
  const skipLiveStatePayload = options?.skipLiveStatePayload === true;

  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [resolvedMatchId, setResolvedMatchId] = useState<string | null>(
    explicitMatchId,
  );
  const [activeMatch, setActiveMatch] = useState<ActiveMatchPayload | null>(
    preview ? PREVIEW_ACTIVE_MATCH : null,
  );
  const [branding, setBranding] = useState<BrandingState>(
    DEFAULT_BRANDING_STATE,
  );
  const [payload, setPayload] = useState<MatchStatePayload | null>(null);
  const [control, setControl] = useState<MatchRuntimeControlSnapshot | null>(null);
  const [widgetAccess, setWidgetAccess] = useState<WidgetAccessResponse | null>(
    null,
  );
  const [status, setStatus] = useState<WidgetRuntimeStatus>(
    preview ? "ready" : "loading",
  );
  const [fightAlert, setFightAlert] = useState<FightAlertPayload | null>(null);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const isTeamsAliveWidget = widgetKey === "teams-alive";
  const isLeaderboardWidget = widgetKey === "leaderboard";
  const isKillFeedWidget = widgetKey === "kill-feed";
  const isOverallLiveRankingWidget = widgetKey === "overall-live-ranking";
  const isAchievementAlertWidget = widgetKey === "achievement-alert";
  const isTeamEliminatedAlertWidget = widgetKey === "team-eliminated-alert";
  const isWwcdWidget = widgetKey === "wwcd";
  const isWinnerWidget = widgetKey === "winner";
  const [teamsAliveSocketConnected, setTeamsAliveSocketConnected] =
    useState(false);
  const teamsAliveHadSocketConnectionRef = useRef(false);
  const latestTeamsAliveTimestampRef = useRef(0);
  const [leaderboardSocketConnected, setLeaderboardSocketConnected] =
    useState(false);
  const leaderboardHadSocketConnectionRef = useRef(false);
  const latestLeaderboardTimestampRef = useRef(0);
  const [killFeedSocketConnected, setKillFeedSocketConnected] = useState(false);
  const killFeedHadSocketConnectionRef = useRef(false);
  const killFeedNeedsResyncRef = useRef(false);
  const latestKillFeedSequenceRef = useRef(0);
  const latestKillFeedAppliedAtRef = useRef(0);
  const [, setMatchFinishedSocketConnected] = useState(false);
  const matchFinishedHadSocketConnectionRef = useRef(false);
  const matchFinishedNeedsResyncRef = useRef(false);
  const latestMatchFinishedTimestampRef = useRef(0);
  const fightAlertTimeoutRef = useRef<number | null>(null);
  const refreshTimeoutRef = useRef<number | null>(null);
  const statePollMs =
    widgetKey === "next-zone-update" ? NEXT_ZONE_STATE_POLL_MS : STATE_POLL_MS;
  const lifecycleStatus = preview ? "LIVE" : getControlLifecycleStatus(control);
  const isCanonicalLive = preview || isControlLive(control);
  const isCanonicalFinalizing = !preview && isControlFinalizing(control);
  const isCanonicalFinalized = !preview && isControlFinalized(control);
  const sourceMode = preview
    ? ("AUTO" as WidgetSourceMode)
    : normalizeWidgetSourceMode(getWidgetControlSourceValue(control));
  const canUseObserverDirect = preview || sourceMode !== "MANUAL";
  const leaderboardLiveDataManagedExternally =
    isLeaderboardWidget && usesExternalPayload && canUseObserverDirect;
  const usesObserverStateRuntime =
    canUseObserverDirect &&
    (isTeamsAliveWidget || isLeaderboardWidget || isKillFeedWidget);
  const usesMatchFinishedRuntime =
    isWinnerWidget || (isWwcdWidget && canUseObserverDirect);
  const usesFinalizedResultsRuntime =
    isLeaderboardWidget || isOverallLiveRankingWidget || usesMatchFinishedRuntime;
  const usesAchievementAlertRuntime = isAchievementAlertWidget;
  const usesTeamEliminationRuntime =
    isTeamEliminatedAlertWidget && canUseObserverDirect;
  const shouldSkipLiveStatePayload =
    skipLiveStatePayload && canUseObserverDirect;
  const canConsumeLiveTelemetry = preview || isCanonicalLive;
  const usesManualLeaderboardResultsState =
    isLeaderboardWidget && !canUseObserverDirect;
  const liveStateUrl =
    resolvedMatchId && canConsumeLiveTelemetry
      ? isLeaderboardWidget
        ? canUseObserverDirect
          ? `${API_URL}/api/matches/${encodeURIComponent(
              resolvedMatchId,
            )}/state`
          : organizationId
            ? `${API_URL}/public/matches/${encodeURIComponent(
                resolvedMatchId,
              )}/results/slots?${new URLSearchParams({
                organizationId,
              }).toString()}`
            : null
        : usesObserverStateRuntime
          ? `${API_URL}/api/observer/match-state/${encodeURIComponent(
              resolvedMatchId,
            )}`
          : usesMatchFinishedRuntime
            ? null
            : `${API_URL}/api/observer/match/${encodeURIComponent(
                resolvedMatchId,
              )}/widget-state`
      : null;
  const isCanonicalStatePending =
    !preview && Boolean(resolvedMatchId) && !control && !controlError;
  const shouldUseFinalizedResults =
    !preview && isCanonicalFinalized && usesFinalizedResultsRuntime;
  const scheduleRefresh = useEffectEvent(() => {
    if (refreshTimeoutRef.current !== null) {
      return;
    }

    refreshTimeoutRef.current = window.setTimeout(() => {
      refreshTimeoutRef.current = null;
      setRefreshVersion((current) => current + 1);
    }, 120);
  });

  useEffect(() => {
    if (!isTeamsAliveWidget) {
      return;
    }

    teamsAliveHadSocketConnectionRef.current = false;
    latestTeamsAliveTimestampRef.current = 0;
    setTeamsAliveSocketConnected(false);
  }, [isTeamsAliveWidget, resolvedMatchId]);

  useEffect(() => {
    if (!isLeaderboardWidget) {
      return;
    }

    leaderboardHadSocketConnectionRef.current = false;
    latestLeaderboardTimestampRef.current = 0;
    setLeaderboardSocketConnected(false);
  }, [isLeaderboardWidget, resolvedMatchId]);

  useEffect(() => {
    if (!isKillFeedWidget) {
      return;
    }

    killFeedHadSocketConnectionRef.current = false;
    killFeedNeedsResyncRef.current = false;
    latestKillFeedSequenceRef.current = 0;
    latestKillFeedAppliedAtRef.current = 0;
    setKillFeedSocketConnected(false);
  }, [isKillFeedWidget, resolvedMatchId]);

  useEffect(() => {
    if (!usesMatchFinishedRuntime) {
      return;
    }

    matchFinishedHadSocketConnectionRef.current = false;
    matchFinishedNeedsResyncRef.current = false;
    latestMatchFinishedTimestampRef.current = 0;
    setMatchFinishedSocketConnected(false);
  }, [resolvedMatchId, usesMatchFinishedRuntime]);

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current !== null) {
        window.clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!organizationSlug) {
      setWidgetAccess(null);
      return;
    }

    let cancelled = false;

    const loadAccess = async () => {
      try {
        const nextAccess = await fetchJson<WidgetAccessResponse>(
          `${API_URL}/api/widgets/access?${new URLSearchParams({
            orgSlug: organizationSlug,
            widgetKey,
          }).toString()}`,
        );

        if (cancelled) return;
        setWidgetAccess(nextAccess);

        if (!nextAccess.allowed) {
          setError(WIDGET_APPROVAL_ERROR);
          setStatus("error");
        }
      } catch (nextError) {
        if (cancelled) return;
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to resolve widget approval.",
        );
        setStatus(preview ? "ready" : "error");
      }
    };

    void loadAccess();
    const interval = window.setInterval(() => {
      void loadAccess();
    }, CONTEXT_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [organizationSlug, preview, widgetKey]);

  const widgetAccessDenied = widgetAccess?.allowed === false;

  useEffect(() => {
    if (!organizationSlug) {
      setOrganizationId(null);
      setResolvedMatchId(explicitMatchId);
      setStatus(preview ? "ready" : "error");
      setError(preview ? null : "Missing orgSlug in widget URL.");
      return;
    }

    let cancelled = false;

    const loadContext = async () => {
      try {
        const context = await fetchJson<WidgetContextResponse>(
          `${API_URL}/api/organizations/${encodeURIComponent(
            organizationSlug,
          )}/widget-context`,
        );

        if (cancelled) return;

        setOrganizationId(context.organizationId ?? null);
        setBranding(buildBrandingState(context.branding ?? {}));
        setError(null);

        const nextMatchId =
          explicitMatchId ?? context.matchId ?? context.liveMatchId ?? null;
        setResolvedMatchId(nextMatchId);

        if (!nextMatchId && !preview) {
          setStatus("waiting");
        }
      } catch (nextError) {
        if (cancelled) return;

        if (!explicitMatchId) {
          setResolvedMatchId(null);
        }
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to load widget context.",
        );
        setStatus(preview ? "ready" : "error");
      }
    };

    void loadContext();
    const interval = window.setInterval(() => {
      void loadContext();
    }, CONTEXT_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [explicitMatchId, organizationSlug, preview]);

  useEffect(() => {
    if (widgetAccessDenied) {
      setActiveMatch(null);
      return;
    }

    if (!organizationSlug) {
      setActiveMatch(preview ? PREVIEW_ACTIVE_MATCH : null);
      return;
    }

    let cancelled = false;
    const metadataUrl = explicitMatchId
      ? `${API_URL}/api/organizations/${encodeURIComponent(
          organizationSlug,
        )}/matches/${encodeURIComponent(explicitMatchId)}`
      : `${API_URL}/api/organizations/${encodeURIComponent(
          organizationSlug,
        )}/active-match`;

    const loadMatchMetadata = async () => {
      try {
        const nextMatch = await fetchJson<ActiveMatchPayload | null>(metadataUrl);

        if (cancelled) return;
        setActiveMatch(nextMatch);
      } catch {
        if (cancelled) return;
        setActiveMatch(preview ? PREVIEW_ACTIVE_MATCH : null);
      }
    };

    void loadMatchMetadata();
    const interval = window.setInterval(() => {
      void loadMatchMetadata();
    }, CONTEXT_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [explicitMatchId, organizationSlug, preview, widgetAccessDenied]);

  useEffect(() => {
    if (preview) {
      setControl(null);
      setControlError(null);
      return;
    }

    if (widgetAccessDenied) {
      setControl(null);
      setControlError(null);
      return;
    }

    if (!resolvedMatchId || !organizationId) {
      setControl(null);
      setControlError(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadControl = async () => {
      try {
        const nextControl = await fetchPublicMatchControlSnapshot(
          resolvedMatchId,
          organizationId,
          controller.signal,
        );
        if (cancelled) {
          return;
        }

        setControl(nextControl);
        setControlError(null);
      } catch (nextError) {
        if (cancelled || controller.signal.aborted) {
          return;
        }

        setControl(null);
        setControlError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to load canonical runtime control.",
        );
      }
    };

    void loadControl();
    const interval = window.setInterval(() => {
      void loadControl();
    }, statePollMs);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      controller.abort();
    };
  }, [
    organizationId,
    preview,
    refreshVersion,
    resolvedMatchId,
    statePollMs,
    widgetAccessDenied,
  ]);

  useEffect(() => {
    if (
      usesObserverStateRuntime ||
      usesMatchFinishedRuntime ||
      shouldSkipLiveStatePayload ||
      usesAchievementAlertRuntime ||
      usesTeamEliminationRuntime
    ) {
      return undefined;
    }

    if (widgetAccessDenied) {
      setPayload(null);
      setLastEventAt(null);
      setStatus("error");
      return;
    }

    if (!resolvedMatchId) {
      setPayload(null);
      setLastEventAt(null);
      setStatus(preview ? "ready" : organizationSlug ? "waiting" : "error");
      return;
    }

    if (shouldUseFinalizedResults) {
      return undefined;
    }

    if (controlError) {
      setPayload(null);
      setLastEventAt(control?.updatedAt ?? null);
      setError(controlError);
      setStatus("error");
      return;
    }

    if (isCanonicalStatePending) {
      setPayload(null);
      setLastEventAt(null);
      setError(null);
      setStatus("loading");
      return;
    }

    if (!liveStateUrl) {
      setPayload(null);
      setLastEventAt(control?.updatedAt ?? null);
      setError(null);
      setStatus(preview ? "ready" : organizationSlug ? "waiting" : "error");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    setPayload((current) =>
      current?.matchId === resolvedMatchId ? current : null,
    );
    setStatus("loading");

    const loadState = async () => {
      try {
        const nextState =
          usesManualLeaderboardResultsState && organizationId
            ? await fetchManualLiveResultsState(
                resolvedMatchId,
                organizationId,
                controller.signal,
              )
            : await fetchJson<MatchStatePayload>(
                liveStateUrl,
                controller.signal,
              );

        if (cancelled) return;
        setPayload(nextState);
        setLastEventAt(nextState.updatedAt ?? null);
        setError(null);
        setStatus(payloadHasData(nextState) || preview ? "ready" : "waiting");
      } catch (nextError) {
        if (cancelled || controller.signal.aborted) return;
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to load match state.",
        );
        setStatus(preview ? "ready" : "error");
      }
    };

    void loadState();
    const interval = !preview
      ? window.setInterval(() => {
          void loadState();
        }, statePollMs)
      : null;

    return () => {
      cancelled = true;
      if (interval !== null) {
        window.clearInterval(interval);
      }
      controller.abort();
    };
  }, [
    control?.updatedAt,
    controlError,
    isCanonicalStatePending,
    organizationId,
    organizationSlug,
    preview,
    refreshVersion,
    resolvedMatchId,
    statePollMs,
    shouldUseFinalizedResults,
    liveStateUrl,
    usesManualLeaderboardResultsState,
    usesAchievementAlertRuntime,
    usesMatchFinishedRuntime,
    usesObserverStateRuntime,
    shouldSkipLiveStatePayload,
    usesTeamEliminationRuntime,
    widgetAccessDenied,
  ]);

  useEffect(() => {
    if (!usesAchievementAlertRuntime) {
      return;
    }

    if (widgetAccessDenied) {
      setPayload(null);
      setLastEventAt(null);
      setStatus("error");
      return;
    }

    setPayload(null);
    setLastEventAt(null);
    setError(null);
    setStatus(preview ? "ready" : resolvedMatchId ? "ready" : organizationSlug ? "waiting" : "error");
  }, [
    organizationSlug,
    preview,
    resolvedMatchId,
    usesAchievementAlertRuntime,
    widgetAccessDenied,
  ]);

  useEffect(() => {
    if (!usesTeamEliminationRuntime) {
      return;
    }

    if (widgetAccessDenied) {
      setPayload(null);
      setLastEventAt(null);
      setStatus("error");
      return;
    }

    setPayload(null);
    setLastEventAt(null);
    setError(null);
    setStatus(preview ? "ready" : resolvedMatchId ? "ready" : organizationSlug ? "waiting" : "error");
  }, [
    organizationSlug,
    preview,
    resolvedMatchId,
    usesTeamEliminationRuntime,
    widgetAccessDenied,
  ]);

  useEffect(() => {
    if (!isTeamsAliveWidget || !usesObserverStateRuntime) {
      return undefined;
    }

    if (widgetAccessDenied) {
      setPayload(null);
      setLastEventAt(null);
      setStatus("error");
      return;
    }

    if (!resolvedMatchId) {
      setPayload(null);
      setLastEventAt(null);
      setStatus(preview ? "ready" : organizationSlug ? "waiting" : "error");
      return;
    }

    if (controlError) {
      setPayload(null);
      setLastEventAt(control?.updatedAt ?? null);
      setError(controlError);
      setStatus("error");
      return;
    }

    if (isCanonicalStatePending) {
      setPayload(null);
      setLastEventAt(null);
      setError(null);
      setStatus("loading");
      return;
    }

    if (!liveStateUrl) {
      setPayload(null);
      setLastEventAt(control?.updatedAt ?? null);
      setError(null);
      setStatus(preview ? "ready" : organizationSlug ? "waiting" : "error");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    setPayload((current) =>
      current?.matchId === resolvedMatchId ? current : null,
    );
    setStatus("loading");

    const loadState = async () => {
      console.info("[Widget] TeamsAlive fallback to REST");

      try {
        const nextState = await fetchJson<MatchStatePayload>(
          liveStateUrl,
          controller.signal,
        );

        if (cancelled) return;
        const nextTimestamp = parseStateTimestamp(nextState.updatedAt);
        if (nextTimestamp < latestTeamsAliveTimestampRef.current) {
          return;
        }

        latestTeamsAliveTimestampRef.current = nextTimestamp;
        const nextRuntimeState = buildLeaderboardSocketState({
          matchId: nextState.matchId,
          leaderboard: nextState.leaderboard,
          teamsAlive: nextState.teamsAlive,
          timestamp: nextState.updatedAt,
        });
        setPayload(nextRuntimeState);
        setLastEventAt(nextState.updatedAt ?? null);
        setError(null);
        setStatus(
          payloadHasData(nextRuntimeState) || preview ? "ready" : "waiting",
        );
      } catch (nextError) {
        if (cancelled || controller.signal.aborted) return;
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to load match state.",
        );
        setStatus(preview ? "ready" : "error");
      }
    };

    void loadState();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    control?.updatedAt,
    controlError,
    isCanonicalStatePending,
    isTeamsAliveWidget,
    organizationSlug,
    preview,
    refreshVersion,
    resolvedMatchId,
    liveStateUrl,
    usesObserverStateRuntime,
    widgetAccessDenied,
  ]);

  useEffect(() => {
    if (
      !isTeamsAliveWidget ||
      !usesObserverStateRuntime ||
      preview ||
      widgetAccessDenied ||
      !resolvedMatchId ||
      !liveStateUrl ||
      teamsAliveSocketConnected
    ) {
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadState = async () => {
      console.info("[Widget] TeamsAlive fallback to REST");

      try {
        const nextState = await fetchJson<MatchStatePayload>(
          liveStateUrl,
          controller.signal,
        );

        if (cancelled) return;
        const nextTimestamp = parseStateTimestamp(nextState.updatedAt);
        if (nextTimestamp < latestTeamsAliveTimestampRef.current) {
          return;
        }

        latestTeamsAliveTimestampRef.current = nextTimestamp;
        const nextRuntimeState = buildLeaderboardSocketState({
          matchId: nextState.matchId,
          leaderboard: nextState.leaderboard,
          teamsAlive: nextState.teamsAlive,
          timestamp: nextState.updatedAt,
        });
        setPayload(nextRuntimeState);
        setLastEventAt(nextState.updatedAt ?? null);
        setError(null);
        setStatus(payloadHasData(nextRuntimeState) ? "ready" : "waiting");
      } catch (nextError) {
        if (cancelled || controller.signal.aborted) return;
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to load match state.",
        );
        setStatus("error");
      }
    };

    if (teamsAliveHadSocketConnectionRef.current) {
      void loadState();
    }

    const interval = window.setInterval(() => {
      void loadState();
    }, statePollMs);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      controller.abort();
    };
  }, [
    isTeamsAliveWidget,
    teamsAliveSocketConnected,
    preview,
    refreshVersion,
    resolvedMatchId,
    statePollMs,
    liveStateUrl,
    usesObserverStateRuntime,
    widgetAccessDenied,
  ]);

  useEffect(() => {
    if (
      !isLeaderboardWidget ||
      !usesObserverStateRuntime ||
      leaderboardLiveDataManagedExternally
    ) {
      return undefined;
    }

    if (widgetAccessDenied) {
      setPayload(null);
      setLastEventAt(null);
      setStatus("error");
      return;
    }

    if (!resolvedMatchId) {
      setPayload(null);
      setLastEventAt(null);
      setStatus(preview ? "ready" : organizationSlug ? "waiting" : "error");
      return;
    }

    if (shouldUseFinalizedResults) {
      return undefined;
    }

    if (controlError) {
      setPayload(null);
      setLastEventAt(control?.updatedAt ?? null);
      setError(controlError);
      setStatus("error");
      return;
    }

    if (isCanonicalStatePending) {
      setPayload(null);
      setLastEventAt(null);
      setError(null);
      setStatus("loading");
      return;
    }

    if (!liveStateUrl) {
      setPayload(null);
      setLastEventAt(control?.updatedAt ?? null);
      setError(null);
      setStatus(preview ? "ready" : organizationSlug ? "waiting" : "error");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    setPayload((current) =>
      current?.matchId === resolvedMatchId ? current : null,
    );
    setStatus("loading");

    const loadState = async () => {
      console.info("[Widget] Leaderboard fallback to REST");

      try {
        const nextState = await fetchJson<MatchStatePayload>(
          liveStateUrl,
          controller.signal,
        );

        if (cancelled) return;
        const nextTimestamp = parseStateTimestamp(nextState.updatedAt);
        if (nextTimestamp < latestLeaderboardTimestampRef.current) {
          return;
        }

        latestLeaderboardTimestampRef.current = nextTimestamp;
        setPayload(nextState);
        setLastEventAt(nextState.updatedAt ?? null);
        setError(null);
        setStatus(payloadHasData(nextState) || preview ? "ready" : "waiting");
      } catch (nextError) {
        if (cancelled || controller.signal.aborted) return;
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to load match state.",
        );
        setStatus(preview ? "ready" : "error");
      }
    };

    void loadState();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    control?.updatedAt,
    controlError,
    isCanonicalStatePending,
    isLeaderboardWidget,
    leaderboardLiveDataManagedExternally,
    organizationSlug,
    preview,
    refreshVersion,
    resolvedMatchId,
    shouldUseFinalizedResults,
    liveStateUrl,
    usesObserverStateRuntime,
    widgetAccessDenied,
  ]);

  useEffect(() => {
    if (
      !isLeaderboardWidget ||
      !usesObserverStateRuntime ||
      leaderboardLiveDataManagedExternally ||
      preview ||
      widgetAccessDenied ||
      !resolvedMatchId ||
      !liveStateUrl ||
      leaderboardSocketConnected
    ) {
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadState = async () => {
      console.info("[Widget] Leaderboard fallback to REST");

      try {
        const nextState = await fetchJson<MatchStatePayload>(
          liveStateUrl,
          controller.signal,
        );

        if (cancelled) return;
        const nextTimestamp = parseStateTimestamp(nextState.updatedAt);
        if (nextTimestamp < latestLeaderboardTimestampRef.current) {
          return;
        }

        latestLeaderboardTimestampRef.current = nextTimestamp;
        setPayload(nextState);
        setLastEventAt(nextState.updatedAt ?? null);
        setError(null);
        setStatus(payloadHasData(nextState) ? "ready" : "waiting");
      } catch (nextError) {
        if (cancelled || controller.signal.aborted) return;
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to load match state.",
        );
        setStatus("error");
      }
    };

    if (leaderboardHadSocketConnectionRef.current) {
      void loadState();
    }

    const interval = window.setInterval(() => {
      void loadState();
    }, statePollMs);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      controller.abort();
    };
  }, [
    isLeaderboardWidget,
    leaderboardLiveDataManagedExternally,
    leaderboardSocketConnected,
    preview,
    refreshVersion,
    resolvedMatchId,
    statePollMs,
    liveStateUrl,
    usesObserverStateRuntime,
    widgetAccessDenied,
  ]);

  useEffect(() => {
    if (!isKillFeedWidget || !usesObserverStateRuntime) {
      return undefined;
    }

    if (widgetAccessDenied) {
      setPayload(null);
      setLastEventAt(null);
      setStatus("error");
      return;
    }

    if (!resolvedMatchId) {
      setPayload(null);
      setLastEventAt(null);
      setStatus(preview ? "ready" : organizationSlug ? "waiting" : "error");
      return;
    }

    if (controlError) {
      setPayload(null);
      setLastEventAt(control?.updatedAt ?? null);
      setError(controlError);
      setStatus("error");
      return;
    }

    if (isCanonicalStatePending) {
      setPayload(null);
      setLastEventAt(null);
      setError(null);
      setStatus("loading");
      return;
    }

    if (!liveStateUrl) {
      setPayload(null);
      setLastEventAt(control?.updatedAt ?? null);
      setError(null);
      setStatus(preview ? "ready" : organizationSlug ? "waiting" : "error");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    setPayload((current) =>
      current?.matchId === resolvedMatchId ? current : null,
    );
    setStatus("loading");

    const loadState = async () => {
      console.info("[Widget] Kill feed fallback to REST");

      try {
        const nextState = await fetchJson<MatchStatePayload>(
          liveStateUrl,
          controller.signal,
        );

        if (cancelled) return;
        const nextAppliedAt = parseStateTimestamp(nextState.updatedAt);
        if (nextAppliedAt < latestKillFeedAppliedAtRef.current) {
          return;
        }

        const nextRuntimeState = buildKillFeedRestState(nextState);
        if (nextRuntimeState.killFeed.length !== nextState.killFeed.length) {
          console.info("[Widget] Kill feed duplicate ignored");
        }

        latestKillFeedAppliedAtRef.current = nextAppliedAt;
        setPayload(nextRuntimeState);
        setLastEventAt(nextState.updatedAt ?? null);
        setError(null);
        setStatus(
          payloadHasData(nextRuntimeState) || preview ? "ready" : "waiting",
        );
      } catch (nextError) {
        if (cancelled || controller.signal.aborted) return;
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to load match state.",
        );
        setStatus(preview ? "ready" : "error");
      }
    };

    void loadState();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    control?.updatedAt,
    controlError,
    isCanonicalStatePending,
    isKillFeedWidget,
    organizationSlug,
    preview,
    refreshVersion,
    resolvedMatchId,
    liveStateUrl,
    usesObserverStateRuntime,
    widgetAccessDenied,
  ]);

  useEffect(() => {
    if (
      !isKillFeedWidget ||
      !usesObserverStateRuntime ||
      preview ||
      widgetAccessDenied ||
      !resolvedMatchId ||
      !liveStateUrl ||
      killFeedSocketConnected
    ) {
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadState = async () => {
      console.info("[Widget] Kill feed fallback to REST");

      try {
        const nextState = await fetchJson<MatchStatePayload>(
          liveStateUrl,
          controller.signal,
        );

        if (cancelled) return;
        const nextAppliedAt = parseStateTimestamp(nextState.updatedAt);
        if (nextAppliedAt < latestKillFeedAppliedAtRef.current) {
          return;
        }

        const nextRuntimeState = buildKillFeedRestState(nextState);
        if (nextRuntimeState.killFeed.length !== nextState.killFeed.length) {
          console.info("[Widget] Kill feed duplicate ignored");
        }

        latestKillFeedAppliedAtRef.current = nextAppliedAt;
        setPayload(nextRuntimeState);
        setLastEventAt(nextState.updatedAt ?? null);
        setError(null);
        setStatus(payloadHasData(nextRuntimeState) ? "ready" : "waiting");
      } catch (nextError) {
        if (cancelled || controller.signal.aborted) return;
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to load match state.",
        );
        setStatus("error");
      }
    };

    if (killFeedHadSocketConnectionRef.current) {
      void loadState();
    }

    const interval = window.setInterval(() => {
      void loadState();
    }, statePollMs);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      controller.abort();
    };
  }, [
    isKillFeedWidget,
    killFeedSocketConnected,
    preview,
    refreshVersion,
    resolvedMatchId,
    statePollMs,
    liveStateUrl,
    usesObserverStateRuntime,
    widgetAccessDenied,
  ]);

  useEffect(() => {
    if (!usesFinalizedResultsRuntime) {
      return undefined;
    }

    if (widgetAccessDenied) {
      setPayload(null);
      setLastEventAt(null);
      setStatus("error");
      return;
    }

    if (!resolvedMatchId) {
      setPayload(null);
      setLastEventAt(null);
      setStatus(preview ? "ready" : organizationSlug ? "waiting" : "error");
      return;
    }

    if (controlError) {
      setPayload(null);
      setLastEventAt(control?.updatedAt ?? null);
      setError(controlError);
      setStatus("error");
      return;
    }

    if (isCanonicalStatePending) {
      setPayload(null);
      setLastEventAt(null);
      setError(null);
      setStatus("loading");
      return;
    }

    if (!shouldUseFinalizedResults) {
      setPayload(null);
      setLastEventAt(control?.updatedAt ?? null);
      setError(null);
      setStatus(preview ? "ready" : organizationSlug ? "waiting" : "error");
      return;
    }

    if (!organizationId) {
      setPayload(null);
      setLastEventAt(control?.updatedAt ?? null);
      setError("Missing organizationId for finalized widget results.");
      setStatus("error");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    setPayload((current) =>
      current?.matchId === resolvedMatchId ? current : null,
    );
    setStatus("loading");

    const loadState = async () => {
      try {
        const nextState = await fetchFinalizedMatchState(
          resolvedMatchId,
          organizationId,
          controller.signal,
        );

        if (cancelled) {
          return;
        }

        const updatedAt = control?.updatedAt ?? nextState.updatedAt;
        const nextTimestamp = parseStateTimestamp(updatedAt);
        if (nextTimestamp < latestMatchFinishedTimestampRef.current) {
          return;
        }

        latestMatchFinishedTimestampRef.current = nextTimestamp;
        const finalizedState = {
          ...nextState,
          updatedAt,
        };
        setPayload(finalizedState);
        setLastEventAt(updatedAt ?? null);
        setError(null);
        setStatus(payloadHasData(finalizedState) || preview ? "ready" : "waiting");
      } catch (nextError) {
        if (cancelled || controller.signal.aborted) {
          return;
        }

        setError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to load finalized results.",
        );
        setStatus(preview ? "ready" : "error");
      }
    };

    void loadState();
    const interval = !preview
      ? window.setInterval(() => {
          void loadState();
        }, statePollMs)
      : null;

    return () => {
      cancelled = true;
      if (interval !== null) {
        window.clearInterval(interval);
      }
      controller.abort();
    };
  }, [
    control?.updatedAt,
    controlError,
    isCanonicalStatePending,
    organizationId,
    organizationSlug,
    preview,
    refreshVersion,
    resolvedMatchId,
    shouldUseFinalizedResults,
    statePollMs,
    usesFinalizedResultsRuntime,
    widgetAccessDenied,
  ]);

  useEffect(() => {
    if (
      usesAchievementAlertRuntime ||
      usesTeamEliminationRuntime ||
      leaderboardLiveDataManagedExternally
    ) {
      return undefined;
    }
    if (widgetAccessDenied) return undefined;
    if (!organizationSlug) return undefined;

    const query: Record<string, string> = {};
    if (resolvedMatchId) query.matchId = resolvedMatchId;
    if (organizationId) query.organizationId = organizationId;
    if (!query.matchId && !query.organizationId) return undefined;

    const socket = io(SOCKET_URL, {
      transports: ["websocket"],
      query,
      forceNew: true,
    });
    socket.on("connect", () => {
      if (isTeamsAliveWidget) {
        teamsAliveHadSocketConnectionRef.current = true;
        setTeamsAliveSocketConnected(true);
        console.info("[Widget] TeamsAlive socket connected");
      }

      if (isLeaderboardWidget) {
        leaderboardHadSocketConnectionRef.current = true;
        setLeaderboardSocketConnected(true);
        console.info("[Widget] Leaderboard socket connected");
      }

      if (isKillFeedWidget) {
        const shouldResync =
          killFeedHadSocketConnectionRef.current ||
          killFeedNeedsResyncRef.current;
        killFeedHadSocketConnectionRef.current = true;
        setKillFeedSocketConnected(true);
        console.info("[Widget] Kill feed socket connected");
        if (shouldResync) {
          killFeedNeedsResyncRef.current = false;
          scheduleRefresh();
        }
      }

      if (usesMatchFinishedRuntime) {
        const shouldResync =
          matchFinishedHadSocketConnectionRef.current ||
          matchFinishedNeedsResyncRef.current;
        matchFinishedHadSocketConnectionRef.current = true;
        setMatchFinishedSocketConnected(true);
        if (shouldResync) {
          matchFinishedNeedsResyncRef.current = false;
          scheduleRefresh();
        }
      }
    });

    if (isTeamsAliveWidget && usesObserverStateRuntime) {
      socket.on("observer:state:update", (nextState: unknown) => {
        if (!isObserverStateUpdatePayload(nextState)) {
          return;
        }

        const nextTimestamp = parseStateTimestamp(nextState.timestamp);
        if (nextTimestamp < latestTeamsAliveTimestampRef.current) {
          return;
        }

        latestTeamsAliveTimestampRef.current = nextTimestamp;
        console.info("[Widget] TeamsAlive update received");
        scheduleRefresh();
      });
      socket.on("match_state_updated", (nextState: unknown) => {
        if (!isRealtimeLiveMatchPayload(nextState)) {
          return;
        }

        const nextTimestamp = parseStateTimestamp(nextState.updatedAt);
        if (nextTimestamp < latestTeamsAliveTimestampRef.current) {
          return;
        }

        latestTeamsAliveTimestampRef.current = nextTimestamp;
        console.info("[Widget] TeamsAlive canonical update received");
        scheduleRefresh();
      });
    } else if (isLeaderboardWidget && usesObserverStateRuntime) {
      socket.on("observer:state:update", (nextState: unknown) => {
        if (!isObserverStateUpdatePayload(nextState)) {
          return;
        }

        const nextTimestamp = parseStateTimestamp(nextState.timestamp);
        if (nextTimestamp < latestLeaderboardTimestampRef.current) {
          return;
        }

        latestLeaderboardTimestampRef.current = nextTimestamp;
        console.info("[Widget] Leaderboard update received");
        scheduleRefresh();
      });
      socket.on("match_state_updated", (nextState: unknown) => {
        if (!isRealtimeLiveMatchPayload(nextState)) {
          return;
        }

        const nextTimestamp = parseStateTimestamp(nextState.updatedAt);
        if (nextTimestamp < latestLeaderboardTimestampRef.current) {
          return;
        }

        latestLeaderboardTimestampRef.current = nextTimestamp;
        console.info("[Widget] Leaderboard canonical update received");
        scheduleRefresh();
      });
    } else if (isKillFeedWidget && usesObserverStateRuntime) {
      socket.on("observer:killfeed:update", (nextState: unknown) => {
        if (!isObserverKillFeedUpdatePayload(nextState)) {
          return;
        }

        const nextAppliedAt = parseStateTimestamp(nextState.emittedAt);
        if (
          nextState.sequence < latestKillFeedSequenceRef.current ||
          (nextState.sequence === latestKillFeedSequenceRef.current &&
            nextAppliedAt <= latestKillFeedAppliedAtRef.current)
        ) {
          console.info("[Widget] Kill feed duplicate ignored");
          return;
        }

        if (buildKillFeedSocketState(nextState).killFeed.length !== nextState.entries.length) {
          console.info("[Widget] Kill feed duplicate ignored");
        }

        latestKillFeedSequenceRef.current = nextState.sequence;
        latestKillFeedAppliedAtRef.current = nextAppliedAt;
        console.info("[Widget] Kill feed update received");
        scheduleRefresh();
      });
    } else if (usesMatchFinishedRuntime) {
      socket.on("observer:match:finished", (nextState: unknown) => {
        if (!isObserverMatchFinishedPayload(nextState)) {
          return;
        }

        const nextTimestamp = parseStateTimestamp(nextState.finishedAt);
        if (nextTimestamp <= latestMatchFinishedTimestampRef.current) {
          return;
        }

        latestMatchFinishedTimestampRef.current = nextTimestamp;
        matchFinishedNeedsResyncRef.current = false;
        console.info("[Widget] Match finished event received");
        scheduleRefresh();
      });
    } else {
      socket.on("match:update", (nextState: unknown) => {
        if (isMatchStatePayload(nextState)) {
          if (nextState.matchId === resolvedMatchId) {
            scheduleRefresh();
          }
          return;
        }

        if (!isRealtimeLiveMatchPayload(nextState)) {
          return;
        }

        if (nextState.matchId === resolvedMatchId) {
          scheduleRefresh();
        }
      });
    }

    socket.on("match:winner", (winner: WinnerEventPayload) => {
      if (isTeamsAliveWidget || isKillFeedWidget || usesMatchFinishedRuntime) {
        return;
      }
      if (winner.matchId === resolvedMatchId) {
        scheduleRefresh();
      }
    });

    socket.on("fight:detected", (nextAlert: FightAlertPayload) => {
      if (
        isTeamsAliveWidget ||
        isKillFeedWidget ||
        usesMatchFinishedRuntime ||
        !canConsumeLiveTelemetry
      ) {
        return;
      }

      setFightAlert(nextAlert);
      setLastEventAt(nextAlert.lastEventAt ?? new Date().toISOString());
      setStatus("ready");

      if (fightAlertTimeoutRef.current) {
        window.clearTimeout(fightAlertTimeoutRef.current);
      }
      fightAlertTimeoutRef.current = window.setTimeout(() => {
        setFightAlert(null);
      }, FIGHT_ALERT_LINGER_MS);
    });

    socket.on(
      "organization:branding-updated",
      (nextBranding: BrandingEventPayload) => {
        setBranding(buildBrandingState(nextBranding.branding ?? {}));
      },
    );

    socket.on("disconnect", () => {
      if (isTeamsAliveWidget) {
        setTeamsAliveSocketConnected(false);
      }
      if (isLeaderboardWidget) {
        setLeaderboardSocketConnected(false);
      }
      if (isKillFeedWidget) {
        setKillFeedSocketConnected(false);
        if (killFeedHadSocketConnectionRef.current) {
          killFeedNeedsResyncRef.current = true;
        }
      }
      if (usesMatchFinishedRuntime) {
        setMatchFinishedSocketConnected(false);
        if (matchFinishedHadSocketConnectionRef.current) {
          matchFinishedNeedsResyncRef.current = true;
        }
      }
    });

    socket.on("connect_error", (nextError: Error) => {
      if (isTeamsAliveWidget) {
        setTeamsAliveSocketConnected(false);
      }
      if (isLeaderboardWidget) {
        setLeaderboardSocketConnected(false);
      }
      if (isKillFeedWidget) {
        setKillFeedSocketConnected(false);
      }
      if (usesMatchFinishedRuntime) {
        setMatchFinishedSocketConnected(false);
      }
      if (preview) return;
      setError(nextError.message || "Realtime connection failed.");
    });

    return () => {
      socket.disconnect();
      if (fightAlertTimeoutRef.current) {
        window.clearTimeout(fightAlertTimeoutRef.current);
        fightAlertTimeoutRef.current = null;
      }
    };
  }, [
    canConsumeLiveTelemetry,
    isTeamsAliveWidget,
    isLeaderboardWidget,
    isKillFeedWidget,
    isAchievementAlertWidget,
    isTeamEliminatedAlertWidget,
    leaderboardLiveDataManagedExternally,
    organizationId,
    organizationSlug,
    preview,
    resolvedMatchId,
    usesAchievementAlertRuntime,
    usesMatchFinishedRuntime,
    usesObserverStateRuntime,
    usesTeamEliminationRuntime,
    widgetAccessDenied,
  ]);

  const usingPreviewData =
    preview && !widgetAccessDenied && !payloadHasData(payload);
  const effectivePayload = usingPreviewData
    ? PREVIEW_STATE
    : payload ?? emptyMatchState(resolvedMatchId);
  const effectiveFightAlert =
    fightAlert ??
    (preview && !widgetAccessDenied ? PREVIEW_FIGHT_ALERT : null);
  const effectiveError = error ?? controlError;

  return useMemo(
    () => ({
      widgetKey,
      status,
      preview,
      clean,
      organizationId,
      organizationSlug,
      matchId: resolvedMatchId,
      tournamentId: activeMatch?.tournamentId ?? null,
      stageId: activeMatch?.stageId ?? null,
      groupId: activeMatch?.groupId ?? null,
      matchName: activeMatch?.matchName ?? null,
      matchNumber: activeMatch?.matchNumber ?? null,
      tournamentName: activeMatch?.tournamentName ?? null,
      tournamentLogo: activeMatch?.tournamentLogo ?? null,
      sponsors: activeMatch?.sponsors ?? [],
      stageName: activeMatch?.stageName ?? null,
      map: activeMatch?.map ?? null,
      branding,
      payload: effectivePayload,
      fightAlert: effectiveFightAlert,
      lastEventAt,
      error: effectiveError,
      usingPreviewData,
      widgetAccessDenied,
      widgetApprovalEnforced: widgetAccess?.enforced ?? false,
      widgetApproval: widgetAccess?.approval ?? null,
      control,
      lifecycleStatus,
      sourceMode,
      isFinalizing: isCanonicalFinalizing,
      resultFinalized: isCanonicalFinalized,
      canConsumeLiveTelemetry,
      canUseObserverDirect,
    }),
    [
      branding,
      canUseObserverDirect,
      canConsumeLiveTelemetry,
      control,
      effectiveFightAlert,
      effectivePayload,
      effectiveError,
      isCanonicalFinalized,
      isCanonicalFinalizing,
      lastEventAt,
      lifecycleStatus,
      organizationId,
      organizationSlug,
      clean,
      preview,
      resolvedMatchId,
      activeMatch?.tournamentId,
      activeMatch?.stageId,
      activeMatch?.groupId,
      activeMatch?.matchName,
      activeMatch?.matchNumber,
      activeMatch?.tournamentName,
      activeMatch?.tournamentLogo,
      activeMatch?.sponsors,
      activeMatch?.stageName,
      activeMatch?.map,
      status,
      sourceMode,
      usingPreviewData,
      widgetAccessDenied,
      widgetAccess?.enforced,
      widgetAccess?.approval,
      widgetKey,
    ],
  );
}

function useAchievementAlertFeed(runtime: WidgetRuntime) {
  const previewFeed = useMemo(
    () =>
      PREVIEW_ACHIEVEMENT_PRESETS.map((payload) =>
        buildAchievementDisplay(payload, runtime.branding),
      ),
    [runtime.branding],
  );
  const directState = useObserverDirectAchievements(runtime.matchId, {
    enabled: !runtime.preview && Boolean(runtime.matchId),
    preferCanonical: !runtime.canUseObserverDirect,
  });
  const [queue, setQueue] = useState<AchievementAlertDisplay[]>([]);
  const [active, setActive] = useState<AchievementAlertDisplay | null>(null);
  const [visible, setVisible] = useState(false);
  const processedEventIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setQueue([]);
    setActive(null);
    setVisible(false);
    processedEventIdsRef.current = new Set();
  }, [runtime.matchId, runtime.preview]);

  useEffect(() => {
    if (active || queue.length === 0) {
      return;
    }

    const [next, ...rest] = queue;
    setQueue(rest);
    setActive(next);
    setVisible(true);
  }, [active, queue]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const hideTimer = window.setTimeout(() => {
      setVisible(false);
    }, ACHIEVEMENT_ALERT_DISPLAY_MS);
    const clearTimer = window.setTimeout(() => {
      setActive(null);
    }, ACHIEVEMENT_ALERT_DISPLAY_MS + ACHIEVEMENT_ALERT_TRANSITION_MS);

    return () => {
      window.clearTimeout(hideTimer);
      window.clearTimeout(clearTimer);
    };
  }, [active]);

  useEffect(() => {
    if (!runtime.preview || previewFeed.length === 0) {
      return;
    }

    let currentIndex = 0;
    setQueue([previewFeed[0]]);

    const interval = window.setInterval(() => {
      currentIndex = (currentIndex + 1) % previewFeed.length;
      setQueue((current) => [...current, previewFeed[currentIndex]]);
    }, PREVIEW_ACHIEVEMENT_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [previewFeed, runtime.preview]);

  useEffect(() => {
    if (runtime.preview || !runtime.matchId || !directState.data) {
      return;
    }
    const directPayload = directState.data;

    const nextDisplays: AchievementAlertDisplay[] = [];
    for (const event of [...directPayload.events].sort((left, right) => {
        const leftTimestamp = parseStateTimestamp(left.timestamp);
        const rightTimestamp = parseStateTimestamp(right.timestamp);
        if (leftTimestamp !== rightTimestamp) {
          return leftTimestamp - rightTimestamp;
        }
        return left.eventId.localeCompare(right.eventId);
      })) {
      if (processedEventIdsRef.current.has(event.eventId)) {
        continue;
      }

      processedEventIdsRef.current.add(event.eventId);
      nextDisplays.push(buildAchievementDisplay(event, runtime.branding));
    }

    if (nextDisplays.length === 0) {
      return;
    }

    console.info("[Widget] Achievement direct event received");
    setQueue((current) =>
      [...current, ...nextDisplays].sort((left, right) => {
        const leftTimestamp = parseStateTimestamp(left.timestamp);
        const rightTimestamp = parseStateTimestamp(right.timestamp);
        if (leftTimestamp !== rightTimestamp) {
          return leftTimestamp - rightTimestamp;
        }
        return left.id.localeCompare(right.id);
      }),
    );
  }, [directState.data, runtime.branding, runtime.matchId, runtime.preview]);

  return {
    active,
    visible,
  };
}

function AchievementAlertPanel({ runtime }: { runtime: WidgetRuntime }) {
  const { active, visible } = useAchievementAlertFeed(runtime);

  if (!active) {
    return null;
  }

  const toneColor = active.accentColor;
  const teamLabel = formatTeamLabel(active.teamTag, active.teamName);
  const teamMeta = active.teamName ?? teamLabel;
  const playerPhotoSrc =
    ensureApiUrl(active.playerPhotoUrl) ?? DEFAULT_PLAYER_PHOTO_URL;

  return (
    <WidgetSurface runtime={runtime}>
      <div className="pointer-events-none absolute left-1 top-1/2 -translate-y-1/2 sm:left-2">
        <div
          className="transition-all duration-300"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible
              ? "translate3d(0, 0, 0)"
              : "translate3d(-28px, 0, 0)",
          }}
        >
          <BroadcastFrame
            runtime={runtime}
            toneColor={toneColor}
            className="w-[450px] rounded-[30px] p-4"
            style={{
              background: [
                `linear-gradient(135deg, ${alphaColor(
                  toneColor,
                  0.12,
                )} 0%, ${alphaColor(runtime.branding.accent, 0.08)} 28%, transparent 62%)`,
                `linear-gradient(180deg, ${alphaColor(
                  runtime.branding.effectiveBackground,
                  0.34,
                )}, ${alphaColor(
                  darkenHexColor(runtime.branding.effectiveBackground, 0.08),
                  0.54,
                )})`,
              ].join(", "),
            }}
          >
            <div className="flex items-center gap-4">
              <div
                className="relative flex h-[104px] w-[104px] shrink-0 items-end justify-center overflow-hidden rounded-[24px] border"
                style={{
                  borderColor: alphaColor(toneColor, 0.24),
                  background: [
                    `radial-gradient(circle at 50% 18%, ${alphaColor(
                      toneColor,
                      0.26,
                    )}, transparent 54%)`,
                    `linear-gradient(180deg, ${alphaColor(
                      toneColor,
                      0.22,
                    )}, ${alphaColor(darkenHexColor(toneColor, 0.7), 0.82)})`,
                  ].join(", "),
                  boxShadow: `0 18px 44px ${alphaColor(toneColor, 0.14)}`,
                }}
              >
                <img
                  src={playerPhotoSrc}
                  alt={active.playerName}
                  className="relative z-[1] h-full w-full object-contain object-bottom px-1.5 pb-0 pt-1.5"
                  draggable={false}
                />
                <div
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-16"
                  style={{
                    background: `linear-gradient(180deg, transparent, ${alphaColor(
                      darkenHexColor(runtime.branding.panel, 0.22),
                      0.92,
                    )})`,
                  }}
                />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <SignalPill tone="accent">Live Achievement</SignalPill>
                  {teamLabel ? (
                    <div
                      className="truncate text-[10px] font-semibold uppercase tracking-[0.28em]"
                      style={readableTextStyle("meta")}
                    >
                      {teamLabel}
                    </div>
                  ) : null}
                </div>

                <div className="mt-3 text-[30px] font-black uppercase leading-[0.92] tracking-[0.16em] text-white">
                  {active.title}
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border"
                    style={{
                      borderColor: alphaColor(toneColor, 0.22),
                      background: alphaColor(toneColor, 0.12),
                    }}
                  >
                    <TeamLogo
                      logoUrl={active.teamLogoUrl}
                      label={teamLabel || active.playerName}
                      color={toneColor}
                      size={28}
                      chrome="bare"
                      fit="contain"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[17px] font-semibold uppercase tracking-[0.14em] text-white">
                      {active.playerName}
                    </div>
                    {teamMeta ? (
                      <div
                        className="mt-1 truncate text-[10px] uppercase tracking-[0.26em]"
                        style={readableTextStyle("label")}
                      >
                        {teamMeta}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </BroadcastFrame>
        </div>
      </div>
    </WidgetSurface>
  );
}

function useTeamEliminatedFeed(runtime: WidgetRuntime) {
  const previewFeed = useMemo(
    () =>
      PREVIEW_TEAM_ELIMINATION_PRESETS.map((payload) =>
        buildTeamEliminatedDisplay(payload, runtime.branding),
      ),
    [runtime.branding],
  );
  const directState = useObserverDirectLeaderboard(runtime.matchId, {
    enabled:
      runtime.canUseObserverDirect &&
      !runtime.preview &&
      Boolean(runtime.matchId),
  });
  const [queue, setQueue] = useState<TeamEliminatedAlertDisplay[]>([]);
  const [active, setActive] = useState<TeamEliminatedAlertDisplay | null>(null);
  const [visible, setVisible] = useState(false);
  const processedEventIdsRef = useRef<Set<string>>(new Set());
  const lastDirectPayloadKeyRef = useRef<string | null>(null);
  const previousDirectRowsRef = useRef<
    Map<string, { alivePlayers: number; isEliminated: boolean }>
  >(new Map());

  useEffect(() => {
    setQueue([]);
    setActive(null);
    setVisible(false);
    processedEventIdsRef.current = new Set();
    lastDirectPayloadKeyRef.current = null;
    previousDirectRowsRef.current = new Map();
  }, [runtime.matchId, runtime.preview]);

  useEffect(() => {
    if (active || queue.length === 0) {
      return;
    }

    const [next, ...rest] = queue;
    setQueue(rest);
    setActive(next);
    setVisible(true);
  }, [active, queue]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const hideTimer = window.setTimeout(() => {
      setVisible(false);
    }, TEAM_ELIMINATED_ALERT_DISPLAY_MS);
    const clearTimer = window.setTimeout(() => {
      setActive(null);
    }, TEAM_ELIMINATED_ALERT_DISPLAY_MS + TEAM_ELIMINATED_ALERT_TRANSITION_MS);

    return () => {
      window.clearTimeout(hideTimer);
      window.clearTimeout(clearTimer);
    };
  }, [active]);

  useEffect(() => {
    if (!runtime.preview || previewFeed.length === 0) {
      return;
    }

    let currentIndex = 0;
    setQueue([previewFeed[0]]);

    const interval = window.setInterval(() => {
      currentIndex = (currentIndex + 1) % previewFeed.length;
      setQueue((current) => [...current, previewFeed[currentIndex]]);
    }, PREVIEW_TEAM_ELIMINATED_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [previewFeed, runtime.preview]);

  useEffect(() => {
    const directPayload =
      runtime.canUseObserverDirect ? directState.data : runtime.payload;
    if (
      runtime.preview ||
      !runtime.matchId ||
      !directPayload ||
      !payloadHasData(directPayload)
    ) {
      return;
    }

    const payloadKey = `${directPayload.matchId}:${directPayload.updatedAt}`;
    if (lastDirectPayloadKeyRef.current === payloadKey) {
      return;
    }
    lastDirectPayloadKeyRef.current = payloadKey;

    const currentRows = new Map<string, { alivePlayers: number; isEliminated: boolean }>();
    const newlyEliminated: ObserverLeaderboardRow[] = [];

    for (const row of directPayload.leaderboard) {
      const teamKey =
        row.teamId ??
        `slot:${typeof row.slot === "number" && Number.isFinite(row.slot) ? row.slot : row.rank}`;
      const alivePlayers =
        typeof row.alivePlayers === "number" && Number.isFinite(row.alivePlayers)
          ? Math.max(0, Math.trunc(row.alivePlayers))
          : 0;
      const isEliminated = row.isEliminated === true || alivePlayers <= 0;
      currentRows.set(teamKey, { alivePlayers, isEliminated });

      const previous = previousDirectRowsRef.current.get(teamKey);
      if (!previous) {
        continue;
      }

      const becameEliminated =
        previous.alivePlayers > 0 &&
        (isEliminated || alivePlayers <= 0);
      if (!becameEliminated) {
        continue;
      }
      newlyEliminated.push(row);
    }

    previousDirectRowsRef.current = currentRows;
    if (newlyEliminated.length === 0) {
      return;
    }

    const nextDisplays: TeamEliminatedAlertDisplay[] = [];
    const basePlacement = Math.max(
      1,
      Math.trunc(directPayload.teamsAlive) + 1,
    );

    newlyEliminated
      .sort((left, right) => {
        const leftRank = Number.isFinite(left.rank) ? left.rank : Number.MAX_SAFE_INTEGER;
        const rightRank = Number.isFinite(right.rank) ? right.rank : Number.MAX_SAFE_INTEGER;
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }
        const leftKills = Math.max(0, Math.trunc(left.kills ?? 0));
        const rightKills = Math.max(0, Math.trunc(right.kills ?? 0));
        if (rightKills !== leftKills) {
          return rightKills - leftKills;
        }
        return (left.teamName ?? "").localeCompare(right.teamName ?? "");
      })
      .forEach((row, index) => {
        const event = buildDirectTeamEliminationEvent(
          directPayload,
          row,
          basePlacement + index,
        );
        if (processedEventIdsRef.current.has(event.eventId)) {
          return;
        }

        processedEventIdsRef.current.add(event.eventId);
        nextDisplays.push(buildTeamEliminatedDisplay(event, runtime.branding));
      });

    if (nextDisplays.length === 0) {
      return;
    }

    console.info("[Widget] Team eliminated direct event received");
    setQueue((current) =>
      [...current, ...nextDisplays].sort((left, right) => {
        const leftTimestamp = parseStateTimestamp(left.eliminatedAt);
        const rightTimestamp = parseStateTimestamp(right.eliminatedAt);
        if (leftTimestamp !== rightTimestamp) {
          return leftTimestamp - rightTimestamp;
        }
        return left.id.localeCompare(right.id);
      }),
    );
  }, [
    directState.data,
    runtime.branding,
    runtime.canUseObserverDirect,
    runtime.matchId,
    runtime.payload,
    runtime.preview,
  ]);

  return {
    active,
    visible,
  };
}

function TeamEliminatedAlertPanel({ runtime }: { runtime: WidgetRuntime }) {
  const { active, visible } = useTeamEliminatedFeed(runtime);

  if (!active) {
    return null;
  }

  const toneColor = resolveWidgetToneColor(runtime.branding, "accent");
  const teamColor = pickTeamColor(active.accentColor, runtime.branding);
  const placementLabel = Number.isFinite(active.placement ?? NaN)
    ? `#${active.placement}`
    : "--";

  return (
    <WidgetSurface runtime={runtime}>
      <div className="pointer-events-none absolute left-1/2 top-[10%] -translate-x-1/2">
        <div
          className="transition-all duration-300"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible
              ? "translate3d(0, 0, 0) scale(1)"
              : "translate3d(0, 20px, 0) scale(0.98)",
          }}
        >
          <BroadcastFrame
            runtime={runtime}
            toneColor={toneColor}
            className="w-[516px] rounded-[32px] px-5 py-[18px]"
            transparent
          >
            <div className="relative flex items-center gap-4">
              <div
                className="flex h-24 w-24 shrink-0 items-center justify-center rounded-[24px] border"
                style={{
                  borderColor: alphaColor(toneColor, 0.26),
                  background: `linear-gradient(180deg, ${alphaColor(
                    toneColor,
                    0.18,
                  )}, ${alphaColor(darkenHexColor(toneColor, 0.7), 0.78)})`,
                  boxShadow: `0 18px 44px ${alphaColor(toneColor, 0.14)}`,
                }}
              >
                <TeamLogo
                  logoUrl={null}
                  label={active.teamName}
                  color={teamColor}
                  size={68}
                  chrome="bare"
                  fit="contain"
                />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5">
                  <span
                    className="inline-flex items-center rounded-full border px-3.5 py-1 text-[10px] font-semibold uppercase tracking-[0.24em]"
                    style={{
                      borderColor: alphaColor(toneColor, 0.34),
                      background: alphaColor(toneColor, 0.16),
                      color: runtime.branding.badgeText,
                    }}
                  >
                    Team Eliminated
                  </span>
                  <div
                    className="truncate text-[9px] font-semibold uppercase tracking-[0.24em]"
                    style={readableTextStyle("label")}
                  >
                    {active.teamName}
                  </div>
                </div>

                <div className="mt-2.5 text-[30px] font-black uppercase leading-[0.92] tracking-[0.14em] text-white">
                  ELIMINATED
                </div>

                <div className="mt-2.5 flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[22px] font-black uppercase tracking-[0.12em] text-white">
                      {active.teamName}
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-2.5">
                    <StatTile
                      label="Place"
                      value={placementLabel}
                      toneColor={toneColor}
                    />
                    <StatTile
                      label="Kills"
                      value={active.kills}
                      toneColor={toneColor}
                    />
                  </div>
                </div>
              </div>
            </div>
          </BroadcastFrame>
        </div>
      </div>
    </WidgetSurface>
  );
}

function MapOverlayPanel({
  runtime,
  mapState,
  debugRealtime = false,
}: {
  runtime: WidgetRuntime;
  mapState: ReturnType<typeof useMapOverlayState>;
  debugRealtime?: boolean;
}) {
  const overlay = mapState.payload;
  const previewViewportModes: Array<MapOverlayViewport["focusMode"]> = [
    "full",
    "tactical",
    "zone",
    "players",
  ];
  const [previewViewportIndex, setPreviewViewportIndex] = useState(0);
  const [manualTransform, setManualTransform] = useState<MapOverlayManualTransform | null>(null);
  const [isDraggingMap, setIsDraggingMap] = useState(false);
  const mapPanelRef = useRef<HTMLDivElement | null>(null);
  const manualResetTimeoutRef = useRef<number | null>(null);
  const nowMs = useWidgetClock(runtime.preview, 250);
  const dragStateRef = useRef<{
    startClientX: number;
    startClientY: number;
    originTranslateX: number;
    originTranslateY: number;
    scale: number;
  } | null>(null);
  const missingPlayerPositionWarningRef = useRef<string | null>(null);
  const {
    payload: displayOverlay,
    renderedPlayers,
    debugInfo,
  } =
    useInterpolatedMapOverlayPayload(overlay, nowMs, debugRealtime);
  const map = displayOverlay?.map ?? null;
  const previewFocusMode = runtime.preview
    ? previewViewportModes[previewViewportIndex] ?? "full"
    : "tactical";
  const expectedLivePlayerCount = runtime.payload.leaderboard.reduce((sum, row) => {
    const rowPlayerCount =
      row.players?.filter(
        (player) =>
          player.hasDied !== true &&
          (player.alive === true || player.knocked === true),
      ).length ?? 0;
    return sum + Math.max(row.alivePlayers ?? 0, rowPlayerCount);
  }, 0);
  const missingLivePlayerCount =
    expectedLivePlayerCount > 0
      ? Math.max(expectedLivePlayerCount - (overlay?.playerMarkers.length ?? 0), 0)
      : 0;

  useEffect(() => {
    if (!runtime.preview) {
      setPreviewViewportIndex(0);
      return;
    }

    setPreviewViewportIndex(0);
    const interval = window.setInterval(() => {
      setPreviewViewportIndex((current) => (current + 1) % previewViewportModes.length);
    }, 3_800);

    return () => {
      window.clearInterval(interval);
    };
  }, [runtime.preview, previewViewportModes.length]);

  useEffect(() => {
    return () => {
      if (manualResetTimeoutRef.current !== null) {
        window.clearTimeout(manualResetTimeoutRef.current);
      }
    };
  }, []);

  const clearManualResetTimeout = () => {
    if (manualResetTimeoutRef.current !== null) {
      window.clearTimeout(manualResetTimeoutRef.current);
      manualResetTimeoutRef.current = null;
    }
  };

  const scheduleManualReset = () => {
    clearManualResetTimeout();
    manualResetTimeoutRef.current = window.setTimeout(() => {
      dragStateRef.current = null;
      setIsDraggingMap(false);
      setManualTransform(null);
      manualResetTimeoutRef.current = null;
    }, MAP_OVERLAY_MANUAL_RESET_MS);
  };

  useEffect(() => {
    if (!isDraggingMap) {
      return;
    }

    const refreshManualReset = () => {
      if (manualResetTimeoutRef.current !== null) {
        window.clearTimeout(manualResetTimeoutRef.current);
      }
      manualResetTimeoutRef.current = window.setTimeout(() => {
        dragStateRef.current = null;
        setIsDraggingMap(false);
        setManualTransform(null);
        manualResetTimeoutRef.current = null;
      }, MAP_OVERLAY_MANUAL_RESET_MS);
    };

    const handleMouseMove = (event: MouseEvent) => {
      const dragState = dragStateRef.current;
      const panel = mapPanelRef.current;
      if (!dragState || !panel) {
        return;
      }

      const rect = panel.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }

      const nextTranslateX = clampMapOverlayTranslate(
        dragState.scale,
        dragState.originTranslateX + ((event.clientX - dragState.startClientX) / rect.width) * 100,
      );
      const nextTranslateY = clampMapOverlayTranslate(
        dragState.scale,
        dragState.originTranslateY + ((event.clientY - dragState.startClientY) / rect.height) * 100,
      );

      setManualTransform({
        scale: dragState.scale,
        translateX: nextTranslateX,
        translateY: nextTranslateY,
      });
      refreshManualReset();
    };

    const handleMouseUp = () => {
      dragStateRef.current = null;
      setIsDraggingMap(false);
      refreshManualReset();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingMap]);

  useEffect(() => {
    if (!debugRealtime || !displayOverlay || !map) {
      return;
    }

    const renderedSafeZone = resolveRenderedMapOverlaySafeZone(
      displayOverlay.circle,
      nowMs,
    );
    const viewportOverlay =
      displayOverlay.circle && renderedSafeZone
        ? {
            ...displayOverlay,
            circle: {
              ...displayOverlay.circle,
              safeZone: renderedSafeZone,
            },
          }
        : displayOverlay;
    const viewport = buildMapOverlayViewport(viewportOverlay, previewFocusMode);
    const displayViewport = manualTransform
      ? { ...viewport, ...manualTransform }
      : viewport;
    const showPlayerMarkers = renderedPlayers.length > 0;
    const showDirectTeamMarkers =
      debugInfo.teamMarkerMode === "direct-team-markers" &&
      displayOverlay.teamMarkers.length > 0;
    const showTeamFallbackMarkers =
      !showPlayerMarkers && displayOverlay.teamMarkers.length > 0;
    const renderedMarkerMode = manualTransform
      ? "manual"
      : showPlayerMarkers && showDirectTeamMarkers
        ? "players+direct-team-markers"
        : showPlayerMarkers
          ? "player-markers"
          : showTeamFallbackMarkers
            ? "team-fallback"
            : "none";
    const renderedTeamMarkerCount =
      showDirectTeamMarkers || showTeamFallbackMarkers
        ? displayOverlay.teamMarkers.length
        : 0;

    console.debug("[map-overlay][render]", {
      source: formatMapOverlaySourceLabel(displayOverlay.source),
      updatedAt: displayOverlay.updatedAt ?? null,
      overlayPlayerCount: displayOverlay.playerMarkers.length,
      overlayTeamCount: displayOverlay.teamMarkers.length,
      renderedPlayerCount: debugInfo.renderedPlayerCount,
      renderedTeamCount: renderedTeamMarkerCount,
      interpolationActive: debugInfo.interpolationActive,
      teamMarkerMode: debugInfo.teamMarkerMode,
      renderedMarkerMode,
      viewportMode: manualTransform ? "manual" : displayViewport.focusMode,
      usingDirectTeamMarkers: showDirectTeamMarkers,
      usingTeamFallbackMarkers: showTeamFallbackMarkers,
    });
  }, [
    debugInfo.interpolationActive,
    debugInfo.renderedPlayerCount,
    debugInfo.teamMarkerMode,
    debugRealtime,
    displayOverlay,
    manualTransform,
    map,
    nowMs,
    previewFocusMode,
    renderedPlayers.length,
  ]);

  useEffect(() => {
    if (!debugRealtime || !displayOverlay || missingLivePlayerCount <= 0) {
      if (missingLivePlayerCount <= 0) {
        missingPlayerPositionWarningRef.current = null;
      }
      return;
    }

    const warningKey = `${displayOverlay.matchId}:${displayOverlay.updatedAt ?? "none"}:${missingLivePlayerCount}`;
    if (missingPlayerPositionWarningRef.current === warningKey) {
      return;
    }
    missingPlayerPositionWarningRef.current = warningKey;
    console.warn("[map-overlay][missing-player-positions]", {
      source: formatMapOverlaySourceLabel(displayOverlay.source),
      updatedAt: displayOverlay.updatedAt ?? null,
      expectedLivePlayerCount,
      overlayPlayerCount: overlay?.playerMarkers.length ?? 0,
      missingLivePlayerCount,
    });
  }, [
    debugRealtime,
    displayOverlay,
    expectedLivePlayerCount,
    missingLivePlayerCount,
    overlay?.playerMarkers.length,
  ]);

  if (!displayOverlay || !map) {
    return null;
  }

  const toneColor = runtime.branding.primaryColor;
  const teamsAlive = resolveMapOverlayTeamsAlive(runtime.payload, displayOverlay);
  const renderedSafeZone = resolveRenderedMapOverlaySafeZone(
    displayOverlay.circle,
    nowMs,
  );
  const viewportOverlay =
    displayOverlay.circle && renderedSafeZone
      ? {
          ...displayOverlay,
          circle: {
            ...displayOverlay.circle,
            safeZone: renderedSafeZone,
          },
        }
      : displayOverlay;
  const viewport = buildMapOverlayViewport(viewportOverlay, previewFocusMode);
  const displayViewport = manualTransform ? { ...viewport, ...manualTransform } : viewport;
  const safeZone = renderedSafeZone;
  const nextZone = displayOverlay.circle?.nextZone ?? null;
  const safePoint = safeZone
    ? normalizeMapOverlayPoint(
        safeZone.x,
        safeZone.y,
        map.worldSize,
        map.coordinateSystem,
        map.mapName,
      )
    : null;
  const nextPoint = nextZone
    ? normalizeMapOverlayPoint(
        nextZone.x,
        nextZone.y,
        map.worldSize,
        map.coordinateSystem,
        map.mapName,
      )
    : null;
  const flightPath = displayOverlay.flightPath ?? null;
  const flightStartPoint = flightPath
    ? normalizeMapOverlayFlightPathPoint(
        flightPath.start.x,
        flightPath.start.y,
        map.worldSize,
        flightPath.coordinateSystem ?? "WORLD",
        map.mapName,
      )
    : null;
  const flightEndPoint = flightPath
    ? normalizeMapOverlayFlightPathPoint(
        flightPath.end.x,
        flightPath.end.y,
        map.worldSize,
        flightPath.coordinateSystem ?? "WORLD",
        map.mapName,
      )
    : null;
  const safeDiameter = safeZone ? (safeZone.r / map.worldSize) * 200 : 0;
  const nextDiameter = nextZone ? (nextZone.r / map.worldSize) * 200 : 0;
  const teamsById = new Map(
    runtime.payload.leaderboard
      .filter((row) => row.teamId)
      .map((row) => [row.teamId as string, row]),
  );
  const teamMarkersById = new Map(
    displayOverlay.teamMarkers
      .filter((marker) => marker.teamId)
      .map((marker) => [marker.teamId as string, marker]),
  );
  const showPlayerMarkers = renderedPlayers.length > 0;
  const showDirectTeamMarkers =
    debugInfo.teamMarkerMode === "direct-team-markers" &&
    displayOverlay.teamMarkers.length > 0;
  const showTeamFallbackMarkers =
    !showPlayerMarkers && displayOverlay.teamMarkers.length > 0;
  const playerMarkerBaseSize =
    renderedPlayers.length > 52
      ? 16
      : renderedPlayers.length > 36
        ? 18
        : 20;
  const teamMarkerBaseSize =
    displayOverlay.teamMarkers.length > 24
      ? 22
      : displayOverlay.teamMarkers.length > 14
        ? 24
        : 26;
  const playerMarkerRenderScale = clampMapOverlay(
    1 / Math.pow(displayViewport.scale, 0.92),
    0.42,
    1,
  );
  const teamMarkerRenderScale = clampMapOverlay(
    1 / Math.pow(displayViewport.scale, 0.86),
    0.55,
    1.04,
  );
  const playerMarkerGlowFactor = clampMapOverlay(
    1 / Math.pow(displayViewport.scale, 0.58),
    0.5,
    1,
  );
  const showTeamCountBadge =
    showPlayerMarkers &&
    (displayViewport.focusMode === "full" || displayViewport.scale <= 1.28);
  const mapLayerTransform = `translate(${displayViewport.translateX}%, ${displayViewport.translateY}%) scale(${displayViewport.scale})`;
  const panelSize = runtime.clean ? "min(96vw, 94vh)" : "min(92vw, 90vh)";
  const canPanMap = displayViewport.scale > 1.02;
  const teamAliveCounts = new Map<string, number>();
  const teamRepresentativeKeyById = new Map<string, string>();
  const teamRepresentativeDistanceById = new Map<string, number>();

  for (const [index, marker] of renderedPlayers.entries()) {
    const teamId = marker.teamId ?? null;
    if (!teamId) {
      continue;
    }

    if (marker.alive !== false) {
      teamAliveCounts.set(teamId, (teamAliveCounts.get(teamId) ?? 0) + 1);
    }

    const teamAnchor = teamMarkersById.get(teamId);
    const referenceX = teamAnchor?.x ?? marker.x;
    const referenceY = teamAnchor?.y ?? marker.y;
    const distance = Math.hypot(marker.x - referenceX, marker.y - referenceY);
    const markerKey = marker.renderKey ?? marker.playerId ?? `${teamId}-${index}`;
    const currentBest = teamRepresentativeDistanceById.get(teamId);

    if (currentBest === undefined || distance < currentBest) {
      teamRepresentativeDistanceById.set(teamId, distance);
      teamRepresentativeKeyById.set(teamId, markerKey);
    }
  }

  const focusSource =
    renderedPlayers.length > 0
      ? renderedPlayers
      : displayOverlay.playerMarkers.length > 0
        ? displayOverlay.playerMarkers
        : displayOverlay.teamMarkers;
  const focusAnchor =
    nextZone ??
    safeZone ??
    (focusSource.length > 0
      ? {
          x: focusSource.reduce((sum, marker) => sum + marker.x, 0) / focusSource.length,
          y: focusSource.reduce((sum, marker) => sum + marker.y, 0) / focusSource.length,
        }
      : null);
  const pickNearestTeamId = (
    markers: Array<{ teamId?: string | null; x: number; y: number }>,
  ) => {
    if (!focusAnchor) {
      return null;
    }

    let bestTeamId: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const marker of markers) {
      const teamId = marker.teamId ?? null;
      if (!teamId) {
        continue;
      }

      const distance = Math.hypot(marker.x - focusAnchor.x, marker.y - focusAnchor.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestTeamId = teamId;
      }
    }

    return bestTeamId;
  };
  const focusedTeamId =
    pickNearestTeamId(
      displayOverlay.playerMarkers.filter(
        (marker) => marker.knocked === true && marker.alive !== false,
      ),
    ) ??
    pickNearestTeamId(
      displayOverlay.teamMarkers.filter((marker) => marker.alive !== false),
    );
  const debugUpdatedAtLabel = displayOverlay.updatedAt
    ? `${formatTime(displayOverlay.updatedAt)} / ${formatAgo(displayOverlay.updatedAt)}`
    : "--";
  const renderedTeamMarkerCount =
    showDirectTeamMarkers || showTeamFallbackMarkers
      ? displayOverlay.teamMarkers.length
      : 0;
  const debugWarnings = [
    debugInfo.stale && debugInfo.payloadAgeMs !== null
      ? `stale ${Math.ceil(debugInfo.payloadAgeMs / 1000)}s`
      : null,
    debugInfo.teleportingPlayers.length > 0
      ? `teleport ${debugInfo.teleportingPlayers.length}`
      : null,
    missingLivePlayerCount > 0
      ? `missing ${missingLivePlayerCount}`
      : null,
    debugInfo.missingPositionCount > 0
      ? `invalid ${debugInfo.missingPositionCount}`
      : null,
  ].filter((value): value is string => value !== null);

  const flightLine =
    flightStartPoint && flightEndPoint
      ? {
          left: flightStartPoint.left,
          top: flightStartPoint.top,
          length: Math.hypot(
            flightEndPoint.left - flightStartPoint.left,
            flightEndPoint.top - flightStartPoint.top,
          ),
          angle:
            (Math.atan2(
              flightEndPoint.top - flightStartPoint.top,
              flightEndPoint.left - flightStartPoint.left,
            ) *
              180) /
            Math.PI,
        }
      : null;

  const handleMapWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();

    const panel = mapPanelRef.current;
    if (!panel) {
      return;
    }

    const rect = panel.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const baseTransform = manualTransform ?? {
      scale: viewport.scale,
      translateX: viewport.translateX,
      translateY: viewport.translateY,
    };
    const zoomFactor = event.deltaY < 0 ? 1.14 : 1 / 1.14;
    const nextScale = clampMapOverlay(
      baseTransform.scale * zoomFactor,
      1,
      MAP_OVERLAY_MANUAL_MAX_SCALE,
    );
    const cursorX = ((event.clientX - rect.left) / rect.width) * 100;
    const cursorY = ((event.clientY - rect.top) / rect.height) * 100;
    const mapX = (cursorX - baseTransform.translateX) / baseTransform.scale;
    const mapY = (cursorY - baseTransform.translateY) / baseTransform.scale;
    const nextTranslateX = clampMapOverlayTranslate(
      nextScale,
      cursorX - mapX * nextScale,
    );
    const nextTranslateY = clampMapOverlayTranslate(
      nextScale,
      cursorY - mapY * nextScale,
    );

    setManualTransform({
      scale: nextScale,
      translateX: nextTranslateX,
      translateY: nextTranslateY,
    });
    scheduleManualReset();
  };

  const handleMapMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !canPanMap) {
      return;
    }

    event.preventDefault();
    clearManualResetTimeout();

    const baseTransform = manualTransform ?? {
      scale: viewport.scale,
      translateX: viewport.translateX,
      translateY: viewport.translateY,
    };

    setManualTransform(baseTransform);
    dragStateRef.current = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      originTranslateX: baseTransform.translateX,
      originTranslateY: baseTransform.translateY,
      scale: baseTransform.scale,
    };
    setIsDraggingMap(true);
  };

  return (
    <WidgetSurface runtime={runtime} anchor="center" transparentPreview>
      <div className="absolute inset-0 flex items-center justify-center px-6 py-5">
        <div
          ref={mapPanelRef}
          className={`pointer-events-auto relative overflow-hidden rounded-[30px] border select-none ${
            canPanMap ? (isDraggingMap ? "cursor-grabbing" : "cursor-grab") : "cursor-default"
          }`}
          onWheel={handleMapWheel}
          onMouseDown={handleMapMouseDown}
          style={{
            width: panelSize,
            height: panelSize,
            touchAction: "none",
            borderColor: alphaColor(toneColor, 0.38),
            background: [
              `linear-gradient(180deg, ${alphaColor(
                darkenHexColor(runtime.branding.effectiveBackground, 0.04),
                runtime.clean ? 0.1 : 0.18,
              )}, ${alphaColor(darkenHexColor(runtime.branding.effectiveBackground, 0.14), runtime.clean ? 0.16 : 0.24)})`,
              `radial-gradient(circle at 0% 0%, ${alphaColor(
                toneColor,
                runtime.clean ? 0.16 : 0.22,
              )} 0%, transparent 34%)`,
              `radial-gradient(circle at 100% 100%, ${alphaColor(
                runtime.branding.accent,
                runtime.clean ? 0.08 : 0.14,
              )} 0%, transparent 28%)`,
            ].join(", "),
            boxShadow: runtime.clean
              ? `0 0 0 1px ${alphaColor(toneColor, 0.08)}`
              : `0 28px 90px ${alphaColor(toneColor, 0.18)}`,
          }}
        >
          <div className="absolute inset-0">
            <div
              className="absolute inset-0"
              style={{
                transformOrigin: "0 0",
                transform: mapLayerTransform,
                transition: "transform 1600ms cubic-bezier(0.22, 1, 0.36, 1)",
                willChange: "transform",
              }}
            >
              <img
                src={map.imageUrl}
                alt={`${map.mapName} tactical map`}
                className="absolute inset-0 h-full w-full select-none object-fill"
                draggable={false}
                style={{
                  filter: "saturate(1.06) contrast(1.04) brightness(1.02)",
                }}
              />

              <div
                className="absolute inset-0"
                style={{
                  backgroundImage: [
                    `linear-gradient(90deg, ${alphaColor("#ffffff", 0.06)} 1px, transparent 1px)`,
                    `linear-gradient(180deg, ${alphaColor("#ffffff", 0.06)} 1px, transparent 1px)`,
                  ].join(", "),
                  backgroundSize: "6% 6%, 6% 6%",
                  mixBlendMode: "screen",
                }}
              />

              {safePoint && safeDiameter > 0 ? (
                <div
                  className="absolute inset-0"
                  style={buildPubgmBlueZoneMaskStyle(
                    safePoint,
                    safeDiameter,
                    runtime.clean,
                  )}
                />
              ) : null}

              {flightLine && flightStartPoint && flightEndPoint ? (
                <>
                  <div
                    className="absolute h-[0.26%] rounded-full"
                    style={{
                      left: `${flightLine.left}%`,
                      top: `${flightLine.top}%`,
                      width: `${flightLine.length}%`,
                      transform: `translateY(-50%) rotate(${flightLine.angle}deg)`,
                      transformOrigin: "0 50%",
                      background: `linear-gradient(90deg, ${alphaColor(
                        "#fff7cc",
                        0.28,
                      )}, ${alphaColor("#ffe88a", 0.88)}, ${alphaColor(
                        "#fff7cc",
                        0.28,
                      )})`,
                      boxShadow: `0 0 18px ${alphaColor("#ffe88a", 0.2)}`,
                    }}
                  />
                  <div
                    className="absolute h-[0.72%] rounded-full"
                    style={{
                      left: `${flightLine.left}%`,
                      top: `${flightLine.top}%`,
                      width: `${flightLine.length}%`,
                      transform: `translateY(-50%) rotate(${flightLine.angle}deg)`,
                      transformOrigin: "0 50%",
                      background: `linear-gradient(90deg, ${alphaColor(
                        "#fff7cc",
                        0,
                      )}, ${alphaColor("#ffe88a", 0.18)}, ${alphaColor(
                        "#fff7cc",
                        0,
                      )})`,
                    }}
                  />
                  <span
                    className="absolute block rounded-full border"
                    style={{
                      left: `${flightStartPoint.left}%`,
                      top: `${flightStartPoint.top}%`,
                      width: "1.04%",
                      height: "1.04%",
                      minWidth: 8,
                      minHeight: 8,
                      transform: "translate(-50%, -50%)",
                      borderColor: alphaColor("#fff7cc", 0.82),
                      background: alphaColor("#ffe88a", 0.2),
                      boxShadow: `0 0 10px ${alphaColor("#ffe88a", 0.16)}`,
                    }}
                  />
                  <span
                    className="absolute block rounded-full border"
                    style={{
                      left: `${flightEndPoint.left}%`,
                      top: `${flightEndPoint.top}%`,
                      width: "1.04%",
                      height: "1.04%",
                      minWidth: 8,
                      minHeight: 8,
                      transform: "translate(-50%, -50%)",
                      borderColor: alphaColor("#fff7cc", 0.82),
                      background: alphaColor("#ffe88a", 0.2),
                      boxShadow: `0 0 10px ${alphaColor("#ffe88a", 0.16)}`,
                    }}
                  />
                </>
              ) : null}

              {safePoint && safeDiameter > 0 ? (
                <>
                  <div
                    className="absolute rounded-full"
                    style={buildPubgmSafeZoneGlowStyle(
                      safePoint,
                      safeDiameter,
                    )}
                  />
                  <div
                    className="absolute rounded-full border"
                    style={buildPubgmSafeZoneRingStyle(
                      safePoint,
                      safeDiameter,
                    )}
                  />
                </>
              ) : null}

              {nextPoint && nextDiameter > 0 ? (
                <div
                  className="absolute rounded-full border"
                  style={buildPubgmNextZoneRingStyle(
                    nextPoint,
                    nextDiameter,
                  )}
                />
              ) : null}

              {showPlayerMarkers
                ? renderedPlayers.map((marker, index) => {
                    const point = normalizeMapOverlayPoint(
                      marker.x,
                      marker.y,
                      map.worldSize,
                      map.coordinateSystem,
                      map.mapName,
                    );
                    console.log("[MAP][CALIBRATION]", {
                      rawX: point.rawX,
                      rawY: point.rawY,
                      mappedX: point.mappedX,
                      mappedY: point.mappedY,
                    });
                    const row =
                      marker.teamId ? teamsById.get(marker.teamId) ?? null : null;
                    const markerColor =
                      marker.knocked === true
                        ? "#f59e0b"
                        : marker.alive === false
                          ? "#94a3b8"
                          : row?.color ?? runtime.branding.primaryColor;
                    const logoSrc =
                      ensureApiUrl(row?.logoUrl ?? DEFAULT_TEAM_LOGO_URL) ??
                      DEFAULT_TEAM_LOGO_URL;
                    const label = formatTeamLabel(row?.teamTag, row?.teamName, row?.slot);
                    const markerKey = marker.renderKey ?? marker.playerId ?? `${marker.teamId ?? "team"}-${index}`;
                    const aliveCount =
                      marker.teamId ? (teamAliveCounts.get(marker.teamId) ?? 0) : 0;
                    const isTeamRepresentative =
                      marker.teamId !== undefined &&
                      marker.teamId !== null &&
                      teamRepresentativeKeyById.get(marker.teamId) === markerKey;
                    const shouldShowCount =
                      showTeamCountBadge && isTeamRepresentative && aliveCount > 1;
                    const shouldPulse =
                      marker.alive !== false &&
                      isTeamRepresentative &&
                      marker.teamId !== null &&
                      marker.teamId !== undefined &&
                      marker.teamId === focusedTeamId;
                    const borderColor =
                      marker.knocked === true
                        ? alphaColor("#f59e0b", 0.82)
                        : marker.alive === false
                          ? alphaColor("#cbd5e1", 0.16)
                          : alphaColor("#ffffff", 0.18);
                    const outerGlowColor =
                      marker.knocked === true ? "#f59e0b" : markerColor;

                    return (
                      <div
                        key={`player-marker-${markerKey}`}
                        className="absolute"
                        style={{
                          left: `${point.left}%`,
                          top: `${point.top}%`,
                        }}
                      >
                        <div
                          className="relative"
                          style={{
                            transform: `translate(-50%, -50%) scale(${playerMarkerRenderScale})`,
                            transformOrigin: "center center",
                          }}
                        >
                          {shouldPulse ? (
                            <span
                              className="pointer-events-none absolute rounded-full animate-pulse"
                              style={{
                                inset: -5,
                                border: `1px solid ${alphaColor(
                                  outerGlowColor,
                                  0.22 * playerMarkerGlowFactor,
                                )}`,
                                boxShadow: `0 0 ${10 + 8 * playerMarkerGlowFactor}px ${alphaColor(
                                  outerGlowColor,
                                  0.12 * playerMarkerGlowFactor,
                                )}`,
                              }}
                            />
                          ) : null}
                          <div
                            className="relative flex items-center justify-center overflow-hidden rounded-full border backdrop-blur-sm"
                            style={{
                              width: playerMarkerBaseSize,
                              height: playerMarkerBaseSize,
                              borderWidth: marker.knocked === true ? 1.3 : 1,
                              borderColor,
                              background: alphaColor(
                                "#020617",
                                marker.alive === false ? 0.2 : 0.32,
                              ),
                              boxShadow:
                                marker.knocked === true
                                  ? `0 0 0 1px ${alphaColor(
                                      "#f59e0b",
                                      0.14 * playerMarkerGlowFactor,
                                    )}, 0 0 ${8 + 6 * playerMarkerGlowFactor}px ${alphaColor(
                                      "#f59e0b",
                                      0.12 * playerMarkerGlowFactor,
                                    )}`
                                  : `0 0 0 1px ${alphaColor(
                                      markerColor,
                                      0.04 * playerMarkerGlowFactor,
                                    )}, 0 3px ${8 + 6 * playerMarkerGlowFactor}px ${alphaColor(
                                      "#020617",
                                      0.1 * playerMarkerGlowFactor,
                                    )}`,
                              opacity:
                                (marker.alive === false ? 0.34 : 1) *
                                marker.renderOpacity,
                            }}
                            title={label}
                          >
                            <img
                              src={logoSrc}
                              alt={label}
                              className="h-[72%] w-[72%] object-contain"
                              draggable={false}
                              style={{
                                filter:
                                  marker.alive === false
                                    ? "grayscale(1) brightness(0.5) contrast(0.78)"
                                    : "drop-shadow(0 0 4px rgba(255,255,255,0.06))",
                              }}
                            />
                            <div
                              className="pointer-events-none absolute inset-0 rounded-full"
                              style={{
                                background: `linear-gradient(180deg, ${alphaColor(
                                  "#ffffff",
                                  0.05,
                                )}, transparent 42%, ${alphaColor("#000000", 0.1)})`,
                              }}
                            />
                            {shouldShowCount ? (
                              <span
                                className="absolute -right-1 -top-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full border px-1 text-[8px] font-semibold leading-none text-white"
                                style={{
                                  borderColor: alphaColor("#ffffff", 0.14),
                                  background: alphaColor("#020617", 0.82),
                                  boxShadow: `0 0 0 1px ${alphaColor("#020617", 0.22)}`,
                                }}
                              >
                                {aliveCount}
                              </span>
                            ) : null}
                            {marker.knocked === true ? (
                              <span
                                className="absolute -bottom-[1px] -right-[1px] h-2 w-2 rounded-full border border-black/30 bg-amber-400"
                                style={{
                                  boxShadow: `0 0 ${6 + 4 * playerMarkerGlowFactor}px ${alphaColor(
                                    "#f59e0b",
                                    0.22 * playerMarkerGlowFactor,
                                  )}`,
                                }}
                              />
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })
                : null}

              {showDirectTeamMarkers
                ? displayOverlay.teamMarkers.map((marker, index) => {
                    const point = normalizeMapOverlayPoint(
                      marker.x,
                      marker.y,
                      map.worldSize,
                      map.coordinateSystem,
                      map.mapName,
                    );
                    const row =
                      marker.teamId ? teamsById.get(marker.teamId) ?? null : null;
                    const label = formatTeamLabel(
                      row?.teamTag,
                      row?.teamName,
                      row?.slot,
                    );
                    const shortLabel =
                      row?.teamTag?.trim() ||
                      (row?.slot !== null && row?.slot !== undefined
                        ? formatSlot(row.slot)
                        : shortenMapMarkerLabel(label));
                    const slotLabel =
                      row?.slot !== null && row?.slot !== undefined
                        ? String(row.slot)
                        : shortLabel.slice(0, 3).toUpperCase();
                    const markerColor = pickTeamColor(row?.color, runtime.branding);
                    const aliveCount =
                      typeof marker.alivePlayers === "number"
                        ? marker.alivePlayers
                        : row?.alivePlayers ?? 0;
                    const markerKey = marker.teamId ?? `direct-team-${index}`;
                    const shouldPulse =
                      marker.alive !== false &&
                      marker.teamId !== null &&
                      marker.teamId !== undefined &&
                      marker.teamId === focusedTeamId;
                    const shouldShowText =
                      displayViewport.focusMode === "tactical" ||
                      displayViewport.scale >= 1.12;

                    return (
                      <div
                        key={`direct-team-marker-${markerKey}`}
                        className="absolute"
                        style={{
                          left: `${point.left}%`,
                          top: `${point.top}%`,
                        }}
                      >
                        <div
                          className="relative"
                          style={{
                            transform: `translate(-50%, -50%) scale(${teamMarkerRenderScale})`,
                            transformOrigin: "center center",
                          }}
                        >
                          {shouldPulse ? (
                            <span
                              className="pointer-events-none absolute rounded-full animate-pulse"
                              style={{
                                inset: -10,
                                border: `1px solid ${alphaColor(markerColor, 0.28)}`,
                                boxShadow: `0 0 16px ${alphaColor(markerColor, 0.2)}`,
                              }}
                            />
                          ) : null}
                          <span
                            className="pointer-events-none absolute rounded-full border"
                            style={{
                              left: -3,
                              top: "50%",
                              width: 9,
                              height: 9,
                              transform: "translate(-50%, -50%)",
                              borderColor: alphaColor("#ffffff", 0.3),
                              background: alphaColor(
                                markerColor,
                                marker.alive === false ? 0.34 : 0.92,
                              ),
                              boxShadow: `0 0 10px ${alphaColor(markerColor, 0.16)}`,
                            }}
                          />
                          <div
                            className="relative ml-2.5 flex items-center gap-1.5 rounded-full border px-1.5 py-[3px] backdrop-blur-sm"
                            style={{
                              borderColor:
                                marker.alive === false
                                  ? alphaColor("#cbd5e1", 0.18)
                                  : alphaColor(markerColor, 0.34),
                              background: alphaColor(
                                "#020617",
                                marker.alive === false ? 0.44 : 0.68,
                              ),
                              boxShadow: `0 4px 14px ${alphaColor("#020617", 0.16)}`,
                              opacity: marker.alive === false ? 0.52 : 0.96,
                            }}
                            title={label}
                          >
                            <span
                              className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[8px] font-black leading-none text-white"
                              style={{
                                background: alphaColor(
                                  markerColor,
                                  marker.alive === false ? 0.36 : 0.92,
                                ),
                                boxShadow: `0 0 0 1px ${alphaColor("#ffffff", 0.12)}`,
                              }}
                            >
                              {slotLabel}
                            </span>
                            {shouldShowText ? (
                              <span className="max-w-[72px] truncate text-[8px] font-semibold uppercase tracking-[0.12em] text-white">
                                {shortLabel}
                              </span>
                            ) : null}
                            {aliveCount > 0 ? (
                              <span
                                className="text-[8px] font-semibold leading-none"
                                style={{ color: alphaColor("#f8fafc", 0.82) }}
                              >
                                {aliveCount}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })
                : null}

              {!showPlayerMarkers && showTeamFallbackMarkers
                ? displayOverlay.teamMarkers.map((marker, index) => {
                      const point = normalizeMapOverlayPoint(
                        marker.x,
                        marker.y,
                        map.worldSize,
                        map.coordinateSystem,
                        map.mapName,
                      );
                      const row =
                        marker.teamId ? teamsById.get(marker.teamId) ?? null : null;
                      const label = formatTeamLabel(
                        row?.teamTag,
                        row?.teamName,
                        row?.slot,
                      );
                      const markerColor =
                        marker.alive === false
                          ? "#94a3b8"
                          : row?.color ?? runtime.branding.primaryColor;
                      const logoSrc =
                        ensureApiUrl(row?.logoUrl ?? DEFAULT_TEAM_LOGO_URL) ??
                        DEFAULT_TEAM_LOGO_URL;
                      const aliveCount =
                        typeof marker.alivePlayers === "number"
                          ? marker.alivePlayers
                          : row?.alivePlayers ?? 0;
                      const markerKey = marker.teamId ?? `team-marker-${index}`;
                      const shouldPulse =
                        marker.alive !== false &&
                        marker.teamId !== null &&
                        marker.teamId !== undefined &&
                        marker.teamId === focusedTeamId;

                      return (
                        <div
                          key={`team-marker-${markerKey}`}
                          className="absolute"
                          style={{
                            left: `${point.left}%`,
                            top: `${point.top}%`,
                          }}
                        >
                          <div
                            className="relative"
                            style={{
                              transform: `translate(-50%, -50%) scale(${teamMarkerRenderScale})`,
                              transformOrigin: "center center",
                            }}
                          >
                            {shouldPulse ? (
                              <span
                                className="pointer-events-none absolute rounded-full animate-pulse"
                                style={{
                                  inset: -7,
                                  border: `1px solid ${alphaColor(markerColor, 0.26)}`,
                                  boxShadow: `0 0 14px ${alphaColor(markerColor, 0.18)}`,
                                }}
                              />
                            ) : null}
                            <div
                              className="relative flex items-center justify-center overflow-hidden rounded-full border backdrop-blur-sm"
                              style={{
                                width: teamMarkerBaseSize,
                                height: teamMarkerBaseSize,
                                borderWidth: 1.2,
                                borderColor:
                                  marker.alive === false
                                    ? alphaColor("#cbd5e1", 0.18)
                                    : alphaColor("#ffffff", 0.22),
                                background: alphaColor(
                                  "#020617",
                                  marker.alive === false ? 0.24 : 0.38,
                                ),
                                boxShadow:
                                  marker.alive === false
                                    ? `0 0 0 1px ${alphaColor("#cbd5e1", 0.06)}, 0 3px 10px ${alphaColor("#020617", 0.08)}`
                                    : `0 0 0 1px ${alphaColor(markerColor, 0.08)}, 0 4px 12px ${alphaColor("#020617", 0.14)}`,
                              }}
                              title={label}
                            >
                              <img
                                src={logoSrc}
                                alt={label}
                                className="h-[74%] w-[74%] object-contain"
                                draggable={false}
                                style={{
                                  filter:
                                    marker.alive === false
                                      ? "grayscale(1) brightness(0.56) contrast(0.82)"
                                      : "drop-shadow(0 0 4px rgba(255,255,255,0.08))",
                                }}
                              />
                              <div
                                className="pointer-events-none absolute inset-0 rounded-full"
                                style={{
                                  background: `linear-gradient(180deg, ${alphaColor(
                                    "#ffffff",
                                    0.05,
                                  )}, transparent 42%, ${alphaColor("#000000", 0.12)})`,
                                }}
                              />
                              {aliveCount > 0 ? (
                                <span
                                  className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full border px-1 text-[8px] font-semibold leading-none text-white"
                                  style={{
                                    borderColor: alphaColor("#ffffff", 0.16),
                                    background:
                                      marker.alive === false
                                        ? alphaColor("#334155", 0.9)
                                        : alphaColor("#020617", 0.86),
                                    boxShadow: `0 0 0 1px ${alphaColor("#020617", 0.22)}`,
                                  }}
                                >
                                  {aliveCount}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })
                : null}
            </div>
          </div>

          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: `linear-gradient(180deg, ${alphaColor(
                "#020617",
                0.04,
              )}, transparent 18%, transparent 78%, ${alphaColor("#020617", 0.18)})`,
            }}
          />

          <div className="pointer-events-none absolute inset-0 rounded-[30px] border border-white/[0.06]" />

          <div className="pointer-events-none absolute left-5 right-5 top-5 flex items-start justify-between gap-4">
            <div className="flex flex-wrap gap-2">
              <SignalPill tone="accent">{map.mapName}</SignalPill>
              {teamsAlive > 0 ? <SignalPill>{teamsAlive} Teams Alive</SignalPill> : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {displayOverlay.circle?.phaseLabel ? (
                <SignalPill>{displayOverlay.circle.phaseLabel}</SignalPill>
              ) : null}
              <SignalPill tone="live">
                {manualTransform
                  ? "Manual Zoom"
                  : runtime.preview
                    ? `Preview ${displayViewport.focusMode === "tactical"
                        ? "Tactical"
                        : displayViewport.focusMode === "zone"
                        ? "Zone"
                        : displayViewport.focusMode === "players"
                          ? "Players"
                          : "Full"}`
                    : displayViewport.focusMode === "tactical"
                      ? "Tactical"
                      : displayViewport.focusMode === "zone"
                      ? "Auto Zoom"
                      : "Full Map"}
              </SignalPill>
            </div>
          </div>

          {debugRealtime ? (
            <div
              className="pointer-events-none absolute left-5 top-20 z-10 max-w-[280px] rounded-2xl border px-3 py-2 backdrop-blur-md"
              style={{
                borderColor: alphaColor("#ffffff", 0.12),
                background: alphaColor("#020617", 0.72),
                boxShadow: `0 10px 30px ${alphaColor("#020617", 0.24)}`,
              }}
            >
              <div
                className="text-[9px] font-semibold uppercase tracking-[0.28em]"
                style={readableTextStyle("eyebrow")}
              >
                Live Map Debug
              </div>
              <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] font-medium leading-tight">
                <span style={readableTextStyle("muted")}>Source</span>
                <span className="font-mono text-white">
                  {formatMapOverlaySourceLabel(displayOverlay.source)}
                </span>
                <span style={readableTextStyle("muted")}>Updated</span>
                <span className="font-mono text-white">{debugUpdatedAtLabel}</span>
                <span style={readableTextStyle("muted")}>Players</span>
                <span className="font-mono text-white">{debugInfo.renderedPlayerCount}</span>
                <span style={readableTextStyle("muted")}>Teams</span>
                <span className="font-mono text-white">{renderedTeamMarkerCount}</span>
                <span style={readableTextStyle("muted")}>Interp</span>
                <span className="font-mono text-white">
                  {debugInfo.interpolationActive ? "yes" : "no"}
                </span>
                <span style={readableTextStyle("muted")}>Team Mode</span>
                <span className="font-mono text-white">{debugInfo.teamMarkerMode}</span>
                <span style={readableTextStyle("muted")}>Viewport</span>
                <span className="font-mono text-white">
                  {manualTransform ? "manual" : displayViewport.focusMode}
                </span>
              </div>
              {debugWarnings.length > 0 ? (
                <div
                  className="mt-2 border-t pt-2 text-[10px] font-semibold uppercase tracking-[0.18em]"
                  style={{
                    ...readableTextStyle("label"),
                    borderColor: alphaColor("#ffffff", 0.08),
                  }}
                >
                  {debugWarnings.join(" / ")}
                </div>
              ) : null}
            </div>
          ) : null}

          {runtime.preview ? (
            <div
              className="pointer-events-none absolute bottom-5 right-5 flex items-center gap-4 rounded-full border border-white/10 bg-black/30 px-4 py-2 text-[10px] uppercase tracking-[0.22em] backdrop-blur-sm"
              style={readableTextStyle("muted")}
            >
              <span className="inline-flex items-center gap-2">
                <span
                  className="flex h-4 w-4 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-black/30"
                />
                Player team logo
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                Knocked
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-slate-400" />
                Eliminated
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </WidgetSurface>
  );
}

function PmgcMapOverlayPanel({
  runtime,
  mapState,
}: {
  runtime: WidgetRuntime;
  mapState: ReturnType<typeof useMapOverlayState>;
}) {
  const overlay = mapState.payload;
  const map = overlay?.map ?? null;
  const previewViewportModes: Array<MapOverlayViewport["focusMode"]> = [
    "full",
    "zone",
    "players",
    "zone",
  ];
  const [previewViewportIndex, setPreviewViewportIndex] = useState(0);
  const nowMs = useWidgetClock(runtime.preview, 250);

  useEffect(() => {
    if (!runtime.preview) {
      setPreviewViewportIndex(0);
      return;
    }

    setPreviewViewportIndex(0);
    const interval = window.setInterval(() => {
      setPreviewViewportIndex((current) => (current + 1) % previewViewportModes.length);
    }, 3_800);

    return () => {
      window.clearInterval(interval);
    };
  }, [runtime.preview, previewViewportModes.length]);

  const leaderboardTeamsById = useMemo(
    () =>
      new Map(
        runtime.payload.leaderboard
          .filter(
            (row): row is MatchStateLeaderboardRow & { teamId: string } =>
              typeof row.teamId === "string" && row.teamId.length > 0,
          )
          .map((row) => [row.teamId, row]),
      ),
    [runtime.payload.leaderboard],
  );

  const teamSummaries = useMemo(() => {
    if (!overlay) {
      return [] as MapOverlayTeamSummary[];
    }

    const teamMarkersById = new Map(
      overlay.teamMarkers
        .filter(
          (marker): marker is MapOverlayTeamMarker & { teamId: string } =>
            typeof marker.teamId === "string" && marker.teamId.length > 0,
        )
        .map((marker) => [marker.teamId, marker]),
    );
    const playersByTeamId = new Map<string, MapOverlayPlayerMarker[]>();
    for (const marker of overlay.playerMarkers) {
      if (!marker.teamId) continue;
      const current = playersByTeamId.get(marker.teamId) ?? [];
      current.push(marker);
      playersByTeamId.set(marker.teamId, current);
    }

    const focusAnchor = overlay.circle?.nextZone
      ? { x: overlay.circle.nextZone.x, y: overlay.circle.nextZone.y }
      : overlay.circle?.safeZone
        ? { x: overlay.circle.safeZone.x, y: overlay.circle.safeZone.y }
        : overlay.teamMarkers.length > 0
          ? {
              x:
                overlay.teamMarkers.reduce((sum, marker) => sum + marker.x, 0) /
                overlay.teamMarkers.length,
              y:
                overlay.teamMarkers.reduce((sum, marker) => sum + marker.y, 0) /
                overlay.teamMarkers.length,
            }
          : overlay.playerMarkers.length > 0
            ? {
                x:
                  overlay.playerMarkers.reduce((sum, marker) => sum + marker.x, 0) /
                  overlay.playerMarkers.length,
                y:
                  overlay.playerMarkers.reduce((sum, marker) => sum + marker.y, 0) /
                  overlay.playerMarkers.length,
              }
            : null;

    const teamIds = new Set<string>();
    for (const marker of overlay.teamMarkers) {
      if (marker.teamId) teamIds.add(marker.teamId);
    }
    for (const marker of overlay.playerMarkers) {
      if (marker.teamId) teamIds.add(marker.teamId);
    }

    return Array.from(teamIds)
      .map((teamId) => {
        const row = leaderboardTeamsById.get(teamId) ?? null;
        const teamMarker = teamMarkersById.get(teamId) ?? null;
        const livePlayers = playersByTeamId.get(teamId) ?? [];
        const rowPlayers = row?.players ?? [];
        const anchor =
          teamMarker ??
          (livePlayers.length > 0
            ? {
                x:
                  livePlayers.reduce((sum, marker) => sum + marker.x, 0) /
                  livePlayers.length,
                y:
                  livePlayers.reduce((sum, marker) => sum + marker.y, 0) /
                  livePlayers.length,
              }
            : null);

        if (!anchor) {
          return null;
        }

        let standingPlayers = 0;
        let knockedPlayers = 0;
        let deadPlayers = 0;

        if (livePlayers.length > 0) {
          for (const player of livePlayers) {
            if (player.alive === false) deadPlayers += 1;
            else if (player.knocked === true) knockedPlayers += 1;
            else standingPlayers += 1;
          }
        } else {
          for (const player of rowPlayers) {
            if (player.alive === true && player.knocked === true && player.hasDied !== true) {
              knockedPlayers += 1;
            } else if (player.alive === true && player.hasDied !== true) {
              standingPlayers += 1;
            } else {
              deadPlayers += 1;
            }
          }
        }

        const sourceAlivePlayers =
          typeof row?.alivePlayers === "number"
            ? row.alivePlayers
            : typeof teamMarker?.alivePlayers === "number"
              ? teamMarker.alivePlayers
              : standingPlayers + knockedPlayers;
        const baseTotalPlayers =
          typeof row?.totalPlayers === "number" && Number.isFinite(row.totalPlayers)
            ? row.totalPlayers
            : typeof teamMarker?.playerCount === "number" &&
                Number.isFinite(teamMarker.playerCount)
              ? teamMarker.playerCount
              : livePlayers.length > 0
                ? livePlayers.length
                : rowPlayers.length > 0
                  ? rowPlayers.length
                  : 4;
        const totalPlayers = Math.max(
          baseTotalPlayers,
          sourceAlivePlayers,
          standingPlayers + knockedPlayers + deadPlayers,
          1,
        );
        const isEliminated =
          row?.isEliminated === true ||
          teamMarker?.alive === false ||
          sourceAlivePlayers <= 0;
        const alivePlayers = isEliminated
          ? 0
          : Math.max(sourceAlivePlayers, standingPlayers + knockedPlayers);

        knockedPlayers = Math.min(knockedPlayers, alivePlayers);
        if (standingPlayers + knockedPlayers < alivePlayers) {
          standingPlayers = alivePlayers - knockedPlayers;
        }
        deadPlayers = Math.max(deadPlayers, totalPlayers - alivePlayers);

        const label = formatTeamLabel(row?.teamTag, row?.teamName, row?.slot);

        return {
          teamId,
          slot: row?.slot ?? null,
          label,
          shortLabel:
            row?.teamTag?.trim() ||
            (row?.slot !== null && row?.slot !== undefined
              ? formatSlot(row.slot)
              : shortenMapMarkerLabel(label)),
          teamName: row?.teamName ?? label,
          logoUrl: row?.logoUrl ?? null,
          color: pickTeamColor(row?.color, runtime.branding),
          kills: row?.kills ?? 0,
          alivePlayers,
          totalPlayers,
          standingPlayers: isEliminated ? 0 : standingPlayers,
          knockedPlayers: isEliminated ? 0 : knockedPlayers,
          deadPlayers: isEliminated ? totalPlayers : deadPlayers,
          isEliminated,
          anchor: { x: anchor.x, y: anchor.y },
          distanceToFocus: focusAnchor
            ? Math.hypot(anchor.x - focusAnchor.x, anchor.y - focusAnchor.y)
            : Number.POSITIVE_INFINITY,
        } satisfies MapOverlayTeamSummary;
      })
      .filter((team): team is MapOverlayTeamSummary => team !== null);
  }, [overlay, leaderboardTeamsById, runtime.branding]);

  const teamSummariesById = useMemo(
    () => new Map(teamSummaries.map((team) => [team.teamId, team])),
    [teamSummaries],
  );

  const railTeams = useMemo(() => {
    const byId = new Map(teamSummaries.map((team) => [team.teamId, team]));
    const ordered: MapOverlayTeamSummary[] = [];

    for (const row of sortLeaderboardDisplayRows(runtime.payload.leaderboard)) {
      if (!row.teamId) continue;
      const summary = byId.get(row.teamId);
      if (!summary) continue;
      ordered.push(summary);
      byId.delete(row.teamId);
    }

    return [
      ...ordered,
      ...Array.from(byId.values()).sort((left, right) => {
        if (left.isEliminated !== right.isEliminated) {
          return left.isEliminated ? 1 : -1;
        }
        if (right.knockedPlayers !== left.knockedPlayers) {
          return right.knockedPlayers - left.knockedPlayers;
        }
        if (right.kills !== left.kills) {
          return right.kills - left.kills;
        }
        if (left.distanceToFocus !== right.distanceToFocus) {
          return left.distanceToFocus - right.distanceToFocus;
        }
        return left.label.localeCompare(right.label);
      }),
    ].slice(0, 10);
  }, [runtime.payload.leaderboard, teamSummaries]);

  if (!overlay || !map) {
    return null;
  }

  const toneColor = runtime.branding.primaryColor;
  const liveToneColor = resolveLiveToneColor(runtime.branding);
  const teamsAlive = resolveMapOverlayTeamsAlive(runtime.payload, overlay);
  const playersAlive = teamSummaries.reduce((sum, team) => sum + team.alivePlayers, 0);
  const knockedPlayers = teamSummaries.reduce(
    (sum, team) => sum + team.knockedPlayers,
    0,
  );
  const matchLabel =
    runtime.matchName ??
    (runtime.matchNumber !== null && runtime.matchNumber !== undefined
      ? `Match ${runtime.matchNumber}`
      : "Match");
  const tournamentLabel = runtime.tournamentName ?? "Live Match";
  const viewport = buildMapOverlayViewport(
    overlay,
    runtime.preview ? previewViewportModes[previewViewportIndex] ?? "full" : null,
  );
  const safeZone = overlay.circle?.safeZone ?? null;
  const nextZone = overlay.circle?.nextZone ?? null;
  const safePoint = safeZone
    ? normalizeMapOverlayPoint(
        safeZone.x,
        safeZone.y,
        map.worldSize,
        map.coordinateSystem,
        map.mapName,
      )
    : null;
  const nextPoint = nextZone
    ? normalizeMapOverlayPoint(
        nextZone.x,
        nextZone.y,
        map.worldSize,
        map.coordinateSystem,
        map.mapName,
      )
    : null;
  const safeDiameter = safeZone ? (safeZone.r / map.worldSize) * 200 : 0;
  const nextDiameter = nextZone ? (nextZone.r / map.worldSize) * 200 : 0;
  const nextShrinkAtMs = resolveTimestampMs(overlay.circle?.nextShrinkAt ?? null);
  const remainingSeconds =
    nextShrinkAtMs !== null
      ? Math.max(0, Math.ceil((nextShrinkAtMs - nowMs) / 1000))
      : typeof overlay.circle?.timeRemainingToNextPhase === "number"
        ? Math.max(0, Math.ceil(overlay.circle.timeRemainingToNextPhase))
        : typeof overlay.circle?.timerRemaining === "number"
          ? Math.max(0, Math.ceil(overlay.circle.timerRemaining / 1000))
          : null;
  const phaseLabel =
    overlay.circle?.phaseLabel ??
    (overlay.circle?.phaseIndex !== null && overlay.circle?.phaseIndex !== undefined
      ? `Phase ${overlay.circle.phaseIndex}`
      : "Live Zone");
  const focusModeLabel =
    viewport.focusMode === "zone"
      ? "Zone Focus"
      : viewport.focusMode === "players"
        ? "Player Focus"
        : "Full Map";
  const highlightedTeamId =
    railTeams.find((team) => !team.isEliminated && team.knockedPlayers > 0)?.teamId ??
    railTeams.find((team) => !team.isEliminated)?.teamId ??
    null;
  const mapLayerTransform = `translate(${viewport.translateX}%, ${viewport.translateY}%) scale(${viewport.scale})`;
  const playerMarkerRenderScale = clampMapOverlay(
    1 / Math.pow(viewport.scale, 0.82),
    0.6,
    1,
  );
  const teamChipRenderScale = clampMapOverlay(
    1 / Math.pow(viewport.scale, 0.76),
    0.7,
    1.04,
  );
  const displayPlayers = overlay.playerMarkers.filter(
    (marker) => marker.teamId && marker.alive !== false,
  );
  const mapTeams = [...teamSummaries].sort((left, right) => {
    if (left.isEliminated !== right.isEliminated) {
      return left.isEliminated ? -1 : 1;
    }
    if (left.teamId === highlightedTeamId) return 1;
    if (right.teamId === highlightedTeamId) return -1;
    if (left.distanceToFocus !== right.distanceToFocus) {
      return right.distanceToFocus - left.distanceToFocus;
    }
    return left.label.localeCompare(right.label);
  });
  return (
    <WidgetSurface runtime={runtime} anchor="center" transparentPreview>
      <div className="absolute inset-0 flex items-center justify-center px-4 py-4 sm:px-6 sm:py-5">
        <div className="grid w-full max-w-[1460px] grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_292px]">
          <div
            className="relative aspect-square overflow-hidden rounded-[34px] border"
            style={{
              borderColor: alphaColor(toneColor, 0.34),
              background: [
                `linear-gradient(180deg, ${alphaColor(
                  darkenHexColor(runtime.branding.effectiveBackground, 0.03),
                  0.28,
                )}, ${alphaColor(darkenHexColor(runtime.branding.effectiveBackground, 0.16), 0.42)})`,
                `radial-gradient(circle at 0% 0%, ${alphaColor(
                  toneColor,
                  0.18,
                )} 0%, transparent 34%)`,
                `radial-gradient(circle at 100% 100%, ${alphaColor(
                  runtime.branding.accent,
                  0.14,
                )} 0%, transparent 28%)`,
              ].join(", "),
              boxShadow: runtime.clean
                ? `0 0 0 1px ${alphaColor(toneColor, 0.08)}`
                : `0 32px 100px ${alphaColor(toneColor, 0.2)}`,
            }}
          >
            <div className="absolute inset-0">
              <div
                className="absolute inset-0"
                style={{
                  transformOrigin: "0 0",
                  transform: mapLayerTransform,
                  transition: "transform 1600ms cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              >
                <img
                  src={map.imageUrl}
                  alt={`${map.mapName} tactical map`}
                  className="absolute inset-0 h-full w-full object-fill"
                  draggable={false}
                  style={{ filter: "saturate(0.94) contrast(1.08) brightness(0.92)" }}
                />
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage: [
                      `linear-gradient(90deg, ${alphaColor("#ffffff", 0.05)} 1px, transparent 1px)`,
                      `linear-gradient(180deg, ${alphaColor("#ffffff", 0.05)} 1px, transparent 1px)`,
                    ].join(", "),
                    backgroundSize: "6% 6%, 6% 6%",
                  }}
                />
                {safePoint && safeDiameter > 0 ? (
                  <div
                    className="absolute inset-0"
                    style={buildPubgmBlueZoneMaskStyle(
                      safePoint,
                      safeDiameter,
                      runtime.clean,
                    )}
                  />
                ) : null}
                {safePoint && safeDiameter > 0 ? (
                  <>
                    <div
                      className="absolute rounded-full"
                      style={buildPubgmSafeZoneGlowStyle(
                        safePoint,
                        safeDiameter,
                      )}
                    />
                    <div
                      className="absolute rounded-full border"
                      style={buildPubgmSafeZoneRingStyle(
                        safePoint,
                        safeDiameter,
                      )}
                    />
                  </>
                ) : null}
                {nextPoint && nextDiameter > 0 ? (
                  <div
                    className="absolute rounded-full border"
                    style={buildPubgmNextZoneRingStyle(
                      nextPoint,
                      nextDiameter,
                    )}
                  />
                ) : null}
                {displayPlayers.map((marker, index) => {
                  const point = normalizeMapOverlayPoint(
                    marker.x,
                    marker.y,
                    map.worldSize,
                    map.coordinateSystem,
                    map.mapName,
                  );
                  console.log("[MAP][CALIBRATION]", {
                    rawX: point.rawX,
                    rawY: point.rawY,
                    mappedX: point.mappedX,
                    mappedY: point.mappedY,
                  });
                  const team =
                    marker.teamId ? teamSummariesById.get(marker.teamId) ?? null : null;
                  const markerColor =
                    marker.knocked === true ? "#f59e0b" : team?.color ?? toneColor;
                  return (
                    <div
                      key={`pmgc-map-player-${marker.playerId ?? `${marker.teamId ?? "team"}-${index}`}`}
                      className="absolute"
                      style={{ left: `${point.left}%`, top: `${point.top}%` }}
                    >
                      <span
                        className={`block border ${
                          marker.knocked === true ? "rotate-45 rounded-[3px]" : "rounded-full"
                        }`}
                        style={{
                          width: 10,
                          height: 10,
                          transform: `translate(-50%, -50%) scale(${playerMarkerRenderScale})`,
                          borderColor:
                            marker.knocked === true
                              ? alphaColor("#fff7ed", 0.88)
                              : alphaColor("#ffffff", 0.72),
                          background: alphaColor(markerColor, 0.94),
                          boxShadow: `0 0 10px ${alphaColor(markerColor, 0.22)}`,
                        }}
                      />
                    </div>
                  );
                })}
                {mapTeams.map((team) => {
                  const point = normalizeMapOverlayPoint(
                    team.anchor.x,
                    team.anchor.y,
                    map.worldSize,
                    map.coordinateSystem,
                    map.mapName,
                  );
                  const statusTone = team.isEliminated
                    ? "#64748b"
                    : team.knockedPlayers > 0
                      ? "#f59e0b"
                      : team.color;
                  return (
                    <div
                      key={`pmgc-map-team-${team.teamId}`}
                      className="absolute"
                      style={{
                        left: `${point.left}%`,
                        top: `${point.top}%`,
                        opacity: team.isEliminated ? 0.42 : 1,
                        zIndex: team.teamId === highlightedTeamId ? 4 : 2,
                      }}
                    >
                      <div
                        className="relative"
                        style={{
                          transform: `translate(-50%, -118%) scale(${teamChipRenderScale})`,
                        }}
                      >
                        <span
                          className="absolute left-1/2 top-full h-4 w-px -translate-x-1/2"
                          style={{
                            background: `linear-gradient(180deg, ${alphaColor(
                              statusTone,
                              0.64,
                            )}, transparent)`,
                          }}
                        />
                        <div
                          className="min-w-[68px] rounded-[16px] border px-2.5 py-2 text-center backdrop-blur-md"
                          style={{
                            borderColor: alphaColor(statusTone, 0.36),
                            background: [
                              `linear-gradient(135deg, ${alphaColor(
                                statusTone,
                                0.22,
                              )}, transparent 68%)`,
                              `linear-gradient(180deg, ${alphaColor(
                                "#020617",
                                0.88,
                              )}, ${alphaColor("#020617", 0.72)})`,
                            ].join(", "),
                          }}
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className="rounded-[7px] px-1.5 py-[2px] text-[8px] font-black uppercase tracking-[0.22em] text-white"
                              style={{ background: alphaColor(statusTone, 0.24) }}
                            >
                              {team.shortLabel}
                            </span>
                            <span className="ml-auto text-[10px] font-black text-white">
                              {team.alivePlayers}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="pointer-events-none absolute left-5 right-5 top-5 flex items-start justify-between gap-3">
              <div
                className="rounded-[24px] border px-4 py-3 backdrop-blur-md"
                style={{
                  borderColor: alphaColor(toneColor, 0.24),
                  background: `linear-gradient(180deg, ${alphaColor(
                    "#020617",
                    0.74,
                  )}, ${alphaColor("#020617", 0.58)})`,
                }}
              >
                <div
                  className="text-[9px] font-semibold uppercase tracking-[0.34em]"
                  style={readableTextStyle("eyebrow")}
                >
                  PUBG Mobile Live Map
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <div className="text-[1.45rem] font-black uppercase tracking-[0.14em] text-white">
                    {map.mapName}
                  </div>
                  <SignalPill tone="accent">{matchLabel}</SignalPill>
                </div>
                <div
                  className="mt-2 text-[10px] uppercase tracking-[0.28em]"
                  style={readableTextStyle("meta")}
                >
                  {tournamentLabel}
                </div>
              </div>

              <div
                className="rounded-[24px] border px-4 py-3 text-right backdrop-blur-md"
                style={{
                  borderColor: alphaColor(runtime.branding.accent, 0.28),
                  background: `linear-gradient(180deg, ${alphaColor(
                    "#020617",
                    0.78,
                  )}, ${alphaColor("#020617", 0.62)})`,
                }}
              >
                <div
                  className="text-[9px] font-semibold uppercase tracking-[0.34em]"
                  style={readableTextStyle("eyebrow")}
                >
                  {phaseLabel}
                </div>
                <div className="mt-1 text-[1.45rem] font-black uppercase tracking-[0.12em] text-white">
                  {remainingSeconds !== null ? formatCountdownClock(remainingSeconds) : "LIVE"}
                </div>
                <div
                  className="mt-2 text-[10px] uppercase tracking-[0.24em]"
                  style={readableTextStyle("meta")}
                >
                  {focusModeLabel}
                </div>
              </div>
            </div>

            <div className="pointer-events-none absolute bottom-5 left-5 right-5 flex flex-wrap items-center justify-between gap-3">
              <div
                className="flex flex-wrap items-center gap-3 rounded-[22px] border px-4 py-2.5 backdrop-blur-md"
                style={{
                  borderColor: alphaColor("#ffffff", 0.12),
                  background: alphaColor("#020617", 0.52),
                }}
              >
                <span className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.24em]" style={readableTextStyle("muted")}>
                  <span className="h-2.5 w-2.5 rounded-full bg-white" />
                  Safe
                </span>
                <span className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.24em]" style={readableTextStyle("muted")}>
                  <span className="h-2.5 w-2.5 rotate-45" style={{ background: alphaColor(runtime.branding.accent, 0.94) }} />
                  Next
                </span>
                <span className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.24em]" style={readableTextStyle("muted")}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: alphaColor(liveToneColor, 0.94) }} />
                  Alive
                </span>
                <span className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.24em]" style={readableTextStyle("muted")}>
                  <span className="h-2.5 w-2.5 rotate-45 bg-amber-400" />
                  Knocked
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <SignalPill tone="live">{teamsAlive} Teams Alive</SignalPill>
                <SignalPill>{playersAlive} Players</SignalPill>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <BroadcastFrame
              runtime={runtime}
              toneColor={toneColor}
              className="rounded-[30px] p-4"
            >
              <div className="grid grid-cols-3 gap-2.5">
                <StatTile label="Teams Alive" value={teamsAlive} toneColor={liveToneColor} />
                <StatTile label="Players Alive" value={playersAlive} toneColor={toneColor} />
                <StatTile label="Knocked" value={knockedPlayers} toneColor={runtime.branding.accent} />
              </div>
            </BroadcastFrame>

            <BroadcastFrame
              runtime={runtime}
              toneColor={toneColor}
              className="rounded-[30px] p-4 sm:col-span-2 xl:col-span-1"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[9px] font-semibold uppercase tracking-[0.34em]" style={readableTextStyle("eyebrow")}>
                    Live Field
                  </div>
                  <div className="mt-1 text-[1rem] font-black uppercase tracking-[0.14em] text-white">
                    Leaderboard-linked teams
                  </div>
                </div>
                <SignalPill tone={knockedPlayers > 0 ? "accent" : "live"}>
                  {knockedPlayers > 0 ? `${knockedPlayers} knocked` : "stable"}
                </SignalPill>
              </div>

              <div className="mt-4 space-y-2.5">
                {railTeams.length > 0 ? (
                  railTeams.map((team) => {
                    const totalCells = Math.max(team.totalPlayers, 1);
                    const states = [
                      ...Array.from({ length: Math.max(team.standingPlayers, 0) }, () => "alive" as const),
                      ...Array.from({ length: Math.max(team.knockedPlayers, 0) }, () => "knocked" as const),
                      ...Array.from({ length: Math.max(totalCells - team.standingPlayers - team.knockedPlayers, 0) }, () => "dead" as const),
                    ].slice(0, totalCells);

                    return (
                      <div
                        key={`pmgc-map-rail-${team.teamId}`}
                        className="rounded-[22px] border px-3 py-3"
                        style={{
                          borderColor: alphaColor(
                            team.isEliminated
                              ? "#64748b"
                              : team.knockedPlayers > 0
                                ? "#f59e0b"
                                : team.color,
                            0.24,
                          ),
                          background: `linear-gradient(180deg, ${alphaColor(
                            team.color,
                            team.isEliminated ? 0.06 : 0.14,
                          )}, rgba(255,255,255,0.02))`,
                          opacity: team.isEliminated ? 0.62 : 1,
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className="inline-flex h-8 min-w-[38px] items-center justify-center rounded-[10px] px-2 text-[11px] font-black uppercase tracking-[0.2em] text-white"
                            style={{ background: alphaColor(team.color, 0.24) }}
                          >
                            {team.shortLabel}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-black uppercase tracking-[0.12em] text-white">
                              {team.label}
                            </div>
                            <div className="mt-1 text-[9px] uppercase tracking-[0.24em]" style={readableTextStyle("meta")}>
                              {team.kills} Kills
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1">
                              {states.map((state, index) => (
                                <span
                                  key={`${team.teamId}-cell-${index}`}
                                  className="block h-3.5 w-[5px] rounded-full"
                                  style={{
                                    background:
                                      state === "alive"
                                        ? alphaColor(team.color, 0.96)
                                        : state === "knocked"
                                          ? alphaColor("#f59e0b", 0.96)
                                          : alphaColor("#475569", 0.9),
                                  }}
                                />
                              ))}
                            </div>
                            <span className="min-w-[18px] text-right text-[15px] font-black leading-none text-white">
                              {team.alivePlayers}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-[22px] border px-4 py-5 text-sm" style={readableEmptyStateStyle()}>
                    Waiting for team markers.
                  </div>
                )}
              </div>
            </BroadcastFrame>
          </div>
        </div>
      </div>
    </WidgetSurface>
  );
}

void PmgcMapOverlayPanel;

function resolveNextZoneMode(status: string | null): "closing" | "waiting" | null {
  const normalized = status?.trim().toLowerCase() ?? null;
  if (!normalized) {
    return null;
  }

  const numericStatus = Number(normalized);
  if (Number.isFinite(numericStatus)) {
    // The direct observer feed currently exposes raw enum-like values here.
    // Preserve the observed waiting/closing distinction, but let the widget
    // render from the countdown timer rather than assuming only "closing" is valid.
    if (numericStatus === 0) {
      return "waiting";
    }
    if (numericStatus === 2) {
      return "closing";
    }
    return null;
  }

  if (
    normalized.includes("clos") ||
    normalized.includes("shrink") ||
    normalized.includes("move") ||
    normalized.includes("collapse")
  ) {
    return "closing";
  }

  if (
    normalized.includes("wait") ||
    normalized.includes("idle") ||
    normalized.includes("hold") ||
    normalized.includes("next")
  ) {
    return "waiting";
  }

  return null;
}

function getNextZoneCircleDelta(
  previousCircle: MatchStateCircle | null,
  nextCircle: MatchStateCircle | null,
): number {
  if (!previousCircle || !nextCircle) {
    return 0;
  }

  const previousSafeZone = previousCircle.safeZone;
  const nextSafeZone = nextCircle.safeZone;
  const previousNextZone = previousCircle.nextZone;
  const nextNextZone = nextCircle.nextZone;

  const safeZoneDelta =
    previousSafeZone && nextSafeZone
      ? Math.max(
          Math.abs(previousSafeZone.x - nextSafeZone.x),
          Math.abs(previousSafeZone.y - nextSafeZone.y),
          Math.abs(previousSafeZone.r - nextSafeZone.r),
        )
      : 0;
  const nextZoneDelta =
    previousNextZone && nextNextZone
      ? Math.max(
          Math.abs(previousNextZone.x - nextNextZone.x),
          Math.abs(previousNextZone.y - nextNextZone.y),
          Math.abs(previousNextZone.r - nextNextZone.r),
        )
      : 0;

  return Math.max(safeZoneDelta, nextZoneDelta);
}

function NextZoneUpdatePanel({
  runtime,
  mapState,
}: {
  runtime: WidgetRuntime;
  mapState: ReturnType<typeof useMapOverlayState>;
}) {
  const toneColor = runtime.branding.accent || runtime.branding.primaryColor;
  const nowMs = useWidgetClock(runtime.preview, 250);
  const [previewTargetMs, setPreviewTargetMs] = useState(
    PREVIEW_NEXT_ZONE_TARGET_MS,
  );

  useEffect(() => {
    if (runtime.preview) {
      setPreviewTargetMs(PREVIEW_NEXT_ZONE_TARGET_MS);
    }
  }, [runtime.preview]);

  useEffect(() => {
    if (!runtime.preview) {
      return;
    }

    if (previewTargetMs - nowMs <= 0) {
      setPreviewTargetMs(nowMs + 20_000);
    }
  }, [nowMs, previewTargetMs, runtime.preview]);

  const fallbackTimerRemaining = mapState.payload?.circle?.timerRemaining;
  const fallbackTimeRemainingToNextPhase =
    mapState.payload?.circle?.timeRemainingToNextPhase;
  const liveTargetMs =
    resolveTimestampMs(
      runtime.payload.circle?.nextShrinkAt ??
        mapState.payload?.circle?.nextShrinkAt ??
        null,
    ) ??
    (typeof fallbackTimerRemaining === "number" &&
    Number.isFinite(fallbackTimerRemaining)
      ? nowMs + fallbackTimerRemaining
      : typeof fallbackTimeRemainingToNextPhase === "number" &&
          Number.isFinite(fallbackTimeRemainingToNextPhase)
        ? nowMs + fallbackTimeRemainingToNextPhase * 1000
        : null);
  const targetMs = runtime.preview ? previewTargetMs : liveTargetMs;
  const remainingSeconds =
    targetMs !== null && Number.isFinite(nowMs)
      ? Math.max(0, Math.ceil((targetMs - nowMs) / 1000))
      : null;
  const currentCircle = useMemo<MatchStateCircle | null>(() => {
    const fallbackCircle = mapState.payload?.circle
      ? {
          phase: mapState.payload.circle.phaseIndex ?? null,
          status: null,
          counterSeconds: mapState.payload.circle.counterSeconds ?? null,
          maxTimeSeconds: mapState.payload.circle.maxTimeSeconds ?? null,
          nextShrinkAt: mapState.payload.circle.nextShrinkAt ?? null,
          safeZone: mapState.payload.circle.safeZone ?? null,
          nextZone: mapState.payload.circle.nextZone ?? null,
        }
      : null;

    return mergeMatchStateCircle(runtime.payload.circle, fallbackCircle);
  }, [mapState.payload?.circle, runtime.payload.circle]);
  const [previousCircleState, setPreviousCircleState] = useState<{
    circle: MatchStateCircle | null;
    phase: number | null;
    mode: "closing" | "waiting" | "unknown";
  } | null>(null);
  const phase =
    runtime.preview
      ? 4
      : runtime.payload.circle?.phase ??
        mapState.payload?.circle?.phaseIndex ??
        null;
  const explicitMode = runtime.preview
    ? "closing"
    : resolveNextZoneMode(currentCircle?.status ?? null);
  const samePhase =
    previousCircleState !== null &&
    previousCircleState.phase !== null &&
    phase !== null &&
    previousCircleState.phase === phase;
  const circleDelta = samePhase
    ? getNextZoneCircleDelta(previousCircleState?.circle ?? null, currentCircle)
    : 0;
  const mode: "closing" | "waiting" | "unknown" =
    explicitMode ??
    (samePhase && circleDelta > 0.5
      ? "closing"
      : samePhase &&
          previousCircleState?.mode === "closing" &&
          remainingSeconds !== null &&
          remainingSeconds > 0
        ? "closing"
        : remainingSeconds !== null
          ? "waiting"
          : "unknown");

  useEffect(() => {
    if (runtime.preview || !currentCircle) {
      return;
    }

    setPreviousCircleState({
      circle: currentCircle,
      phase,
      mode,
    });
  }, [currentCircle, mode, phase, runtime.preview]);
  const shouldShow =
    runtime.preview ||
    (mode === "closing" &&
      remainingSeconds !== null &&
      remainingSeconds > 0 &&
      remainingSeconds <= 20);

  if (!shouldShow) {
    return null;
  }

  const phaseLabel =
    Number.isFinite(phase ?? NaN) ? `Phase ${phase}` : "Zone Update";
  const frameBackdrop =
    runtime.branding.mode === "gradient"
      ? `linear-gradient(${gradientDirectionToAngle(
          runtime.branding.gradientDirection,
        )}, ${alphaColor(runtime.branding.gradientStart, 0.34)}, ${alphaColor(
          runtime.branding.gradientEnd,
          0.28,
        )})`
      : alphaColor(runtime.branding.backgroundSolid, 0.32);
  const frameBackground = [
    `linear-gradient(135deg, ${alphaColor(runtime.branding.primaryColor, 0.1)} 0%, ${alphaColor(
      runtime.branding.accent,
      0.08,
    )} 30%, transparent 72%)`,
    frameBackdrop,
  ].join(", ");

  return (
    <WidgetSurface runtime={runtime} transparentPreview>
      <div className="pointer-events-none absolute left-1/2 top-[-1.2%] -translate-x-1/2">
        <BroadcastFrame
          runtime={runtime}
          toneColor={toneColor}
          className="w-[548px] rounded-[18px] px-4 py-2.5"
          style={{
            background: frameBackground,
            boxShadow: runtime.clean
              ? "none"
              : `0 24px 90px ${alphaColor(runtime.branding.primaryColor, 0.1)}`,
          }}
        >
          <div className="relative flex items-center gap-3">
            <div className="relative h-9 w-9 shrink-0">
              <span
                className="absolute inset-0 rounded-full border"
                style={{ borderColor: alphaColor(toneColor, 0.32) }}
              />
              <span
                className="absolute inset-[6px] rounded-full border"
                style={{ borderColor: alphaColor(toneColor, 0.52) }}
              />
              <span
                className="absolute inset-[13px] rounded-full"
                style={{ background: alphaColor(toneColor, 0.92) }}
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5">
                <span
                  className="text-[8px] font-semibold uppercase tracking-[0.28em]"
                  style={readableTextStyle("hint")}
                >
                  {phaseLabel}
                </span>
                <span
                  className="h-[1px] flex-1"
                  style={{
                    background: `linear-gradient(90deg, ${alphaColor(
                      toneColor,
                      0.5,
                    )}, transparent)`,
                  }}
                />
              </div>
              <div className="mt-1.5 flex items-center gap-3">
                <div className="text-[18px] font-black uppercase tracking-[0.14em] text-white">
                  Next Zone Update
                </div>
                <div
                  className="text-[9px] uppercase tracking-[0.22em]"
                  style={readableTextStyle("meta")}
                >
                  {remainingSeconds !== null && remainingSeconds <= 5
                    ? "Zone update now"
                    : "Final 20 seconds before update"}
                </div>
              </div>
            </div>

            <div
              className="shrink-0 rounded-[14px] border px-3 py-2 text-center"
              style={{
                borderColor: alphaColor(toneColor, 0.24),
                background: `linear-gradient(90deg, ${alphaColor(
                  toneColor,
                  0.18,
                )}, rgba(255,255,255,0.03))`,
              }}
            >
              <div className="text-[24px] font-black leading-none text-white">
                {formatCountdownClock(remainingSeconds ?? 0)}
              </div>
              <div
                className="mt-1 text-[8px] uppercase tracking-[0.24em]"
                style={readableTextStyle("label")}
              >
                Remaining
              </div>
            </div>
          </div>
        </BroadcastFrame>
      </div>
    </WidgetSurface>
  );
}

function TeamsAlivePanel({ runtime }: { runtime: WidgetRuntime }) {
  const aliveRows = runtime.payload.leaderboard
    .filter((row) => !row.isEliminated && row.alivePlayers > 0)
    .sort((left, right) => {
      if (right.alivePlayers !== left.alivePlayers) {
        return right.alivePlayers - left.alivePlayers;
      }
      return left.rank - right.rank;
    })
    .slice(0, 4);
  const surfaceTone = resolveWidgetToneColor(runtime.branding);

  return (
    <WidgetSurface runtime={runtime}>
      <BroadcastFrame
        runtime={runtime}
        toneColor={runtime.branding.primaryColor}
        className="w-[540px] rounded-[30px] p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.34em]"
              style={readableTextStyle("eyebrow")}
            >
              Survival Tracker
            </div>
            <div className="mt-3 flex items-end gap-4">
              <div className="text-7xl font-black leading-none text-white">
                {runtime.payload.teamsAlive}
              </div>
              <div
                className="pb-2 text-sm uppercase tracking-[0.24em]"
                style={readableTextStyle("muted")}
              >
                Alive
              </div>
            </div>
          </div>
          <SignalPill tone="live">{formatAgo(runtime.lastEventAt)}</SignalPill>
        </div>

        <div
          className="mt-6 grid gap-3 rounded-[26px] border p-4"
          style={{
            borderColor: alphaColor(runtime.branding.primaryColor, 0.18),
            background: `linear-gradient(180deg, ${alphaColor(
              runtime.branding.primaryColor,
              0.1,
            )}, rgba(255,255,255,0.02))`,
          }}
        >
          {aliveRows.length > 0 ? (
            aliveRows.map((row) => {
              const teamColor = pickTeamColor(row.color, runtime.branding);
              return (
                <div
                  key={`${row.teamId ?? row.teamName}-${row.rank}`}
                  className="flex items-center justify-between rounded-[20px] border px-4 py-3"
                  style={{
                    borderColor: alphaColor(surfaceTone, 0.22),
                    background: `linear-gradient(90deg, ${alphaColor(
                      surfaceTone,
                      0.18,
                    )}, rgba(255,255,255,0.03))`,
                  }}
                >
                  <div className="flex items-center gap-3">
                    <TeamLogo
                      logoUrl={row.logoUrl}
                      label={formatTeamLabel(row.teamTag, row.teamName, row.slot)}
                      color={teamColor}
                      size={40}
                    />
                    <div>
                      <div className="text-sm font-semibold uppercase tracking-[0.16em] text-white">
                        {formatTeamLabel(row.teamTag, row.teamName, row.slot)}
                      </div>
                      <div
                        className="text-xs uppercase tracking-[0.22em]"
                        style={readableTextStyle("label")}
                      >
                        {formatSlot(row.slot)} / Rank {row.rank}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-black leading-none text-white">
                      {row.alivePlayers}
                    </div>
                    <div
                      className="mt-1 text-[11px] uppercase tracking-[0.24em]"
                      style={readableTextStyle("muted")}
                    >
                      Players Alive
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div
              className="rounded-[20px] border border-white/10 px-4 py-5 text-sm"
              style={readableEmptyStateStyle()}
            >
              Waiting for alive-team packets.
            </div>
          )}
        </div>
      </BroadcastFrame>
    </WidgetSurface>
  );
}

function LeaderboardPanel({ runtime }: { runtime: WidgetRuntime }) {
  const tournamentLabel = runtime.tournamentName ?? "Tournament";
  const previewPhase = usePreviewRankingPhase(
    runtime.preview,
    runtime.payload.leaderboard.length,
  );
  const rows = useMemo(
    () =>
      sortLeaderboardDisplayRows(
        runtime.preview
          ? buildPreviewLeaderboardRows(runtime.payload.leaderboard, previewPhase)
          : runtime.payload.leaderboard,
      ),
    [previewPhase, runtime.payload.leaderboard, runtime.preview],
  );
  const density = leaderboardDensity(rows.length);
  const { viewportRef, headerRef, contentRef, bodyHeight, scale } =
    useLeaderboardFit(density.paddingY);
  const animatedRowOrder = useAnimatedRankingRowOrder(
    rows.map((row) => buildTeamRowKey(row)),
  );
  const stageTone = resolveWidgetToneColor(runtime.branding);
  const rowTone = resolveWidgetToneColor(runtime.branding);
  const highlightTone = resolveWidgetToneColor(runtime.branding, "accent");
  const visuals = buildRankingPanelVisuals(
    runtime.branding,
    stageTone,
    rowTone,
    highlightTone,
  );
  const {
    containerRef: tournamentLabelContainerRef,
    textRef: tournamentLabelTextRef,
  } = useSingleLineAutoFit(tournamentLabel, 6, 10);
  const topOffset = runtime.clean ? 236 : 188;
  const rightOffset = runtime.clean ? -14 : -8;
  const frameBackdrop =
    runtime.branding.mode === "gradient"
      ? `linear-gradient(${gradientDirectionToAngle(
          runtime.branding.gradientDirection,
        )}, ${alphaColor(runtime.branding.gradientStart, 0.34)}, ${alphaColor(
          runtime.branding.gradientEnd,
          0.28,
        )})`
      : alphaColor(runtime.branding.backgroundSolid, 0.32);
  const frameBackground = [
    `linear-gradient(135deg, ${alphaColor(runtime.branding.primaryColor, 0.1)} 0%, ${alphaColor(
      runtime.branding.accent,
      0.08,
    )} 30%, transparent 72%)`,
    frameBackdrop,
  ].join(", ");

  return (
    <WidgetSurface runtime={runtime} anchor="end">
      <div
        ref={viewportRef}
        className="relative flex w-full items-start justify-end"
        style={{
          marginTop: `${topOffset}px`,
          marginRight: `${rightOffset}px`,
          height: `calc(100% - ${topOffset}px)`,
        }}
      >
        {runtime.clean ? null : (
          <>
            <div
              className="pointer-events-none absolute inset-y-[18%] right-[16%] w-[34vw] max-w-[620px] min-w-[320px]"
              style={{
                background: `linear-gradient(90deg, transparent 0%, ${alphaColor(
                  stageTone,
                  runtime.preview ? 0.07 : 0.03,
                )} 44%, ${alphaColor(runtime.branding.effectiveBackground, runtime.preview ? 0.13 : 0.065)} 100%)`,
                filter: "blur(12px)",
                opacity: runtime.preview ? 0.92 : 0.72,
                clipPath:
                  "polygon(18% 0, 100% 0, 100% 100%, 0 100%, 0 20%)",
              }}
            />
            <div
              className="pointer-events-none absolute bottom-[20%] right-[15%] h-[1px] w-[36vw] max-w-[640px] min-w-[320px]"
              style={{
                background: `linear-gradient(90deg, transparent, ${alphaColor(
                  stageTone,
                  runtime.preview ? 0.18 : 0.1,
                )}, transparent)`,
              }}
            />
          </>
        )}
        <BroadcastFrame
          runtime={runtime}
          toneColor={runtime.branding.primaryColor}
          className={`${density.containerWidth} max-h-full self-start rounded-[32px] ${density.containerPadding}`}
          style={{
            background: frameBackground,
            boxShadow: runtime.clean
              ? "none"
              : `0 24px 90px ${alphaColor(runtime.branding.primaryColor, 0.1)}`,
          }}
        >
          <div
            ref={headerRef}
            className="overflow-hidden rounded-[18px] border"
            style={visuals.headerCardStyle}
          >
            <div className="px-3 pb-2 pt-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div
                    ref={tournamentLabelContainerRef}
                    className="min-w-0 overflow-hidden"
                  >
                    <div
                      ref={tournamentLabelTextRef}
                      className="truncate whitespace-nowrap text-[10px] font-semibold uppercase leading-[1.35] tracking-[0.22em] text-white/68"
                      style={{ textShadow: visuals.headerTextShadow }}
                    >
                      {tournamentLabel}
                    </div>
                  </div>
                  <div className="mt-0.5 flex items-end justify-between gap-3">
                    <div
                      className={`min-w-0 font-black uppercase text-white ${density.teamText} ${density.titleTracking}`}
                      style={{ textShadow: visuals.headerTextShadow }}
                    >
                      Live Ranking
                    </div>
                    <div
                      className="max-w-[52%] shrink truncate text-right text-[9px] font-semibold uppercase tracking-[0.24em] text-white/64"
                      style={{ textShadow: visuals.headerTextShadow }}
                    >
                      {runtime.matchName ?? "Match"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="h-px" style={visuals.headerDividerStyle} />
            <div
              className={`grid ${density.metaClass} py-2 text-[9px] font-semibold uppercase tracking-[0.22em]`}
              style={{
                ...readableTextStyle("muted"),
                textShadow: visuals.headerTextShadow,
              }}
            >
              <div>Rank</div>
              <div>Team</div>
              <div className="text-center">Alive</div>
              <div className="text-center">Kills</div>
            </div>
          </div>

          <div
            className="mt-2 overflow-hidden"
            style={
              bodyHeight !== null
                ? { height: `${Math.max(0, bodyHeight)}px` }
                : undefined
            }
          >
            {rows.length > 0 ? (
              <div
                ref={contentRef}
                className={density.stackClass}
                style={{
                  transform: `scaleY(${scale})`,
                  transformOrigin: "top right",
                }}
              >
                {rows.map((row) => {
                  const teamColor = pickTeamColor(row.color, runtime.branding);
                  const rowKey = buildTeamRowKey(row);
                  const previewFightMarker =
                    runtime.preview && row.teamId
                      ? PREVIEW_LEADERBOARD_FIGHT_MARKERS[row.teamId] ?? null
                      : null;
                  return (
                    <div key={rowKey} ref={animatedRowOrder.bindRow(rowKey)}>
                      <div
                        className={`relative overflow-hidden grid ${density.metaClass} items-center border ${density.rowClass}`}
                        style={{
                          borderColor: visuals.rowBorderColor,
                          background: previewFightMarker
                            ? [
                                `linear-gradient(90deg, ${alphaColor(
                                  previewFightMarker.color,
                                  previewFightMarker.kind === "trade" ? 0.08 : 0.1,
                                )}, rgba(255,255,255,0.01) 24%, rgba(255,255,255,0.01) 76%, ${alphaColor(
                                  previewFightMarker.color,
                                  previewFightMarker.kind === "trade" ? 0.08 : 0.06,
                                )})`,
                                visuals.rowBackground(row.rank <= 3),
                              ].join(", ")
                            : visuals.rowBackground(row.rank <= 3),
                          textShadow: visuals.rowTextShadow,
                        }}
                      >
                        {previewFightMarker ? (
                          <>
                            <div
                              className="pointer-events-none absolute inset-y-0 left-0 w-[3px]"
                              style={{
                                background: alphaColor(
                                  previewFightMarker.color,
                                  previewFightMarker.kind === "defend" ? 0.1 : 0.9,
                                ),
                              }}
                            />
                            <div
                              className="pointer-events-none absolute inset-y-0 right-0 w-[3px]"
                              style={{
                                background: alphaColor(
                                  previewFightMarker.color,
                                  previewFightMarker.kind === "attack" ? 0.1 : 0.9,
                                ),
                              }}
                            />
                          </>
                        ) : null}
                        <div
                          className={`${density.rankText} font-black leading-none text-white`}
                        >
                          {row.rank}
                        </div>
                        <div className="flex min-w-0 items-center gap-1.5">
                          <TeamLogo
                            logoUrl={row.logoUrl}
                            label={formatTeamLabel(row.teamTag, row.teamName, row.slot)}
                            color={teamColor}
                            size={density.logoSize}
                          />
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-1.5">
                              {previewFightMarker ? (
                                <span
                                  className="shrink-0 rounded-full border px-1.5 py-[1px] text-[9px] font-black leading-none text-white"
                                  style={{
                                    color: previewFightMarker.color,
                                    borderColor: alphaColor(previewFightMarker.color, 0.24),
                                    background: alphaColor(previewFightMarker.color, 0.12),
                                  }}
                                >
                                  {previewFightMarker.label}
                                </span>
                              ) : null}
                              <div
                                className={`truncate font-semibold uppercase tracking-[0.16em] text-white ${density.teamText}`}
                              >
                                {formatTeamLabel(row.teamTag, row.teamName, row.slot)}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="flex justify-center">
                          <AliveBars
                            alivePlayers={row.alivePlayers}
                            totalPlayers={row.totalPlayers}
                            players={row.players}
                            color={teamColor}
                            compact={density.logoSize <= 18}
                          />
                        </div>
                        <div
                          className={`text-center ${density.statText} font-black leading-none text-white`}
                        >
                          {row.kills}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                className="rounded-[22px] border border-white/10 px-5 py-6 text-sm"
                style={readableEmptyStateStyle()}
              >
                Waiting for leaderboard packets.
              </div>
            )}
          </div>
        </BroadcastFrame>
      </div>
    </WidgetSurface>
  );
}

function OverallLiveRankingPanel({ runtime }: { runtime: WidgetRuntime }) {
  const baseRows = useOverallStandings(runtime);
  const previewPhase = usePreviewRankingPhase(runtime.preview, baseRows.length);
  const rows = useMemo(
    () =>
      runtime.preview
        ? buildPreviewOverallRankingRows(baseRows, previewPhase)
        : baseRows,
    [baseRows, previewPhase, runtime.preview],
  );
  const density = overallRankingDensity(rows.length);
  const { viewportRef, headerRef, contentRef, bodyHeight, scale } =
    useLeaderboardFit(density.paddingY);
  const animatedRowOrder = useAnimatedRankingRowOrder(
    rows.map((row) => buildOverallRankingRowKey(row)),
  );
  const stageTone = resolveWidgetToneColor(runtime.branding);
  const rowTone = resolveWidgetToneColor(runtime.branding);
  const highlightTone = resolveWidgetToneColor(runtime.branding, "accent");
  const visuals = buildRankingPanelVisuals(
    runtime.branding,
    stageTone,
    rowTone,
    highlightTone,
  );
  const frameBackdrop =
    runtime.branding.mode === "gradient"
      ? `linear-gradient(${gradientDirectionToAngle(
          runtime.branding.gradientDirection,
        )}, ${alphaColor(runtime.branding.gradientStart, 0.34)}, ${alphaColor(
          runtime.branding.gradientEnd,
          0.28,
        )})`
      : alphaColor(runtime.branding.backgroundSolid, 0.32);
  const frameBackground = [
    `linear-gradient(135deg, ${alphaColor(runtime.branding.primaryColor, 0.1)} 0%, ${alphaColor(
      runtime.branding.accent,
      0.08,
    )} 30%, transparent 72%)`,
    frameBackdrop,
  ].join(", ");
  const topOffset = runtime.clean ? 236 : 188;
  const rightOffset = runtime.clean ? -14 : -8;

  return (
    <WidgetSurface runtime={runtime} anchor="end">
      <div
        ref={viewportRef}
        className="relative flex w-full items-start justify-end"
        style={{
          marginTop: `${topOffset}px`,
          marginRight: `${rightOffset}px`,
          height: `calc(100% - ${topOffset}px)`,
        }}
      >
        {runtime.clean ? null : (
          <>
            <div
              className="pointer-events-none absolute inset-y-[18%] right-[16%] w-[34vw] max-w-[620px] min-w-[320px]"
              style={{
                background: `linear-gradient(90deg, transparent 0%, ${alphaColor(
                  stageTone,
                  runtime.preview ? 0.07 : 0.03,
                )} 44%, ${alphaColor(runtime.branding.effectiveBackground, runtime.preview ? 0.13 : 0.065)} 100%)`,
                filter: "blur(12px)",
                opacity: runtime.preview ? 0.92 : 0.72,
                clipPath:
                  "polygon(18% 0, 100% 0, 100% 100%, 0 100%, 0 20%)",
              }}
            />
            <div
              className="pointer-events-none absolute bottom-[20%] right-[15%] h-[1px] w-[36vw] max-w-[640px] min-w-[320px]"
              style={{
                background: `linear-gradient(90deg, transparent, ${alphaColor(
                  stageTone,
                  runtime.preview ? 0.18 : 0.1,
                )}, transparent)`,
              }}
            />
          </>
        )}
        <BroadcastFrame
          runtime={runtime}
          toneColor={runtime.branding.primaryColor}
          className={`${density.containerWidth} max-h-full self-start rounded-[32px] ${density.containerPadding}`}
          style={{
            background: frameBackground,
            boxShadow: runtime.clean
              ? "none"
              : `0 24px 90px ${alphaColor(runtime.branding.primaryColor, 0.1)}`,
          }}
        >
          <div
            ref={headerRef}
            className="overflow-hidden rounded-[18px] border"
            style={visuals.headerCardStyle}
          >
            <div className="px-3 pb-2 pt-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div
                    className="text-[10px] font-semibold uppercase leading-[1.35] tracking-[0.34em] text-white/68"
                    style={{ textShadow: visuals.headerTextShadow }}
                  >
                    {runtime.tournamentName ?? "Tournament"}
                  </div>
                  <div className="mt-0.5 flex items-end justify-between gap-3">
                    <div
                      className={`min-w-0 font-black uppercase text-white ${density.teamText} ${density.titleTracking}`}
                      style={{ textShadow: visuals.headerTextShadow }}
                    >
                      Overall Live Ranking
                    </div>
                    <div
                      className="max-w-[52%] shrink truncate text-right text-[9px] font-semibold uppercase tracking-[0.24em] text-white/64"
                      style={{ textShadow: visuals.headerTextShadow }}
                    >
                      {runtime.matchName ?? "Match"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="h-px" style={visuals.headerDividerStyle} />
            <div
              className={`grid ${density.metaClass} py-2 text-[9px] font-semibold uppercase tracking-[0.22em]`}
              style={{
                ...readableTextStyle("muted"),
                textShadow: visuals.headerTextShadow,
              }}
            >
              <div>Rank</div>
              <div>Team</div>
              <div className="text-center">Alive</div>
              <div className="text-center">Kills</div>
              <div className="text-center">Total</div>
            </div>
          </div>

          <div
            className="mt-2 overflow-hidden"
            style={
              bodyHeight !== null
                ? { height: `${Math.max(0, bodyHeight)}px` }
                : undefined
            }
          >
            {rows.length > 0 ? (
              <div
                ref={contentRef}
                className={density.stackClass}
                style={{
                  transform: `scaleY(${scale})`,
                  transformOrigin: "top right",
                }}
              >
                {rows.map((row) => {
                  const teamColor = pickTeamColor(row.color, runtime.branding);
                  const rowKey = buildOverallRankingRowKey(row);
                  return (
                    <div key={rowKey} ref={animatedRowOrder.bindRow(rowKey)}>
                      <div
                        className={`grid ${density.metaClass} items-center border ${density.rowClass}`}
                        style={{
                          borderColor: visuals.rowBorderColor,
                          background: visuals.rowBackground(row.rank <= 3),
                          textShadow: visuals.rowTextShadow,
                        }}
                      >
                        <div
                          className={`${density.rankText} font-black leading-none text-white`}
                        >
                          {row.rank}
                        </div>
                        <div className="flex min-w-0 items-center gap-1.5">
                          <TeamLogo
                            logoUrl={row.logoUrl}
                            label={formatTeamLabel(row.teamTag, row.teamName, row.slot)}
                            color={teamColor}
                            size={density.logoSize}
                          />
                          <div className="min-w-0">
                            <div
                              className={`truncate font-semibold uppercase tracking-[0.16em] text-white ${density.teamText}`}
                            >
                              {formatTeamLabel(row.teamTag, row.teamName, row.slot)}
                            </div>
                          </div>
                        </div>
                        <div className="flex justify-center">
                          <AliveBars
                            alivePlayers={row.alivePlayers}
                            totalPlayers={row.totalPlayers}
                            players={row.players}
                            color={teamColor}
                            compact={density.logoSize <= 18}
                          />
                        </div>
                        <div
                          className={`text-center ${density.statText} font-black leading-none text-white`}
                        >
                          {row.kills}
                        </div>
                        <div
                          className={`text-center ${density.totalText} font-black leading-none text-white`}
                        >
                          {row.totalPoints}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                className="rounded-[22px] border border-white/10 px-5 py-6 text-sm"
                style={readableEmptyStateStyle()}
              >
                Waiting for overall live ranking packets.
              </div>
            )}
          </div>
        </BroadcastFrame>
      </div>
    </WidgetSurface>
  );
}

function MatchLowerThirdPanel({ runtime }: { runtime: WidgetRuntime }) {
  const tournamentLabel = runtime.tournamentName ?? "Tournament";
  const matchLabel = runtime.matchName ?? "Match";
  const mapLabel = runtime.map ?? "Map";
  const stageLabel = runtime.stageName?.trim() || null;
  const toneColor = runtime.branding.primaryColor;
  const accentColor = runtime.branding.accent;
  const rotatingLogos = useMemo<RotatingLogoItem[]>(() => {
    const items: RotatingLogoItem[] = [];

    if (runtime.tournamentLogo) {
      items.push({
        id: "tournament-logo",
        label: tournamentLabel,
        logoUrl: runtime.tournamentLogo,
        kind: "tournament",
      });
    }

    for (const sponsor of runtime.sponsors) {
      if (!sponsor.logoUrl) continue;
      items.push({
        id: sponsor.id,
        label: sponsor.name,
        logoUrl: sponsor.logoUrl ?? null,
        kind: "sponsor",
      });
    }

    if (items.length === 0) {
      items.push({
        id: "tournament-fallback",
        label: tournamentLabel,
        logoUrl: null,
        kind: "tournament",
      });
    }

    return items;
  }, [runtime.sponsors, runtime.tournamentLogo, tournamentLabel]);

  return (
    <WidgetSurface runtime={runtime}>
      <div
        className="absolute inline-block max-w-[calc(100vw-3rem)] align-top"
        style={{
          left: "-2rem",
          bottom: runtime.preview && !runtime.clean ? "-6rem" : "-2rem",
        }}
      >
        <div className="relative pt-8">
          {stageLabel ? (
            <div className="pointer-events-none absolute left-5 top-0 z-10">
              <div
                className="inline-flex max-w-[calc(100vw-18rem)] items-center overflow-hidden border px-4 py-2 text-center"
                style={{
                  borderColor: alphaColor(toneColor, 0.24),
                  background: [
                    `linear-gradient(135deg, ${alphaColor(
                      toneColor,
                      0.22,
                    )}, transparent 62%)`,
                    `linear-gradient(180deg, ${alphaColor(
                      darkenHexColor(runtime.branding.panel, 0.36),
                      0.84,
                    )}, ${alphaColor(
                      darkenHexColor(runtime.branding.panel, 0.68),
                      0.96,
                    )})`,
                  ].join(", "),
                  clipPath:
                    "polygon(0 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 0 100%, 12px 50%)",
                  boxShadow: `0 14px 34px ${alphaColor(toneColor, 0.12)}`,
                }}
              >
                <div
                  className="pointer-events-none absolute inset-x-0 top-0 h-px"
                  style={{
                    background: `linear-gradient(90deg, transparent, ${alphaColor(
                      toneColor,
                      0.52,
                    )}, transparent)`,
                  }}
                />
                <div className="truncate text-[0.74rem] font-black uppercase leading-none tracking-[0.24em] text-white">
                  {stageLabel}
                </div>
              </div>
            </div>
          ) : null}
          <div className="pointer-events-none absolute left-[184px] top-0 z-10">
            <div className="relative inline-block max-w-[calc(100vw-18rem)]">
              <div
                aria-hidden="true"
                className="invisible overflow-hidden whitespace-nowrap text-[2.7rem] font-black uppercase leading-none tracking-[0.12em]"
              >
                {matchLabel}
              </div>
              <div
                className="absolute right-0 top-0 inline-flex w-fit max-w-[calc(100vw-10rem)] items-center justify-center overflow-hidden rounded-[18px] border px-4 py-3 text-center"
                style={{
                  borderColor: alphaColor(accentColor, 0.26),
                  background: [
                    `linear-gradient(135deg, ${alphaColor(
                      accentColor,
                      0.22,
                    )}, transparent 62%)`,
                    `linear-gradient(180deg, ${alphaColor(
                      darkenHexColor(runtime.branding.panel, 0.42),
                      0.84,
                    )}, ${alphaColor(
                      darkenHexColor(runtime.branding.panel, 0.7),
                      0.96,
                    )})`,
                  ].join(", "),
                  clipPath:
                    "polygon(0 12px, 12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%)",
                  boxShadow: `0 16px 42px ${alphaColor(accentColor, 0.14)}`,
                }}
              >
                <div
                  className="pointer-events-none absolute inset-x-0 top-0 h-px"
                  style={{
                    background: `linear-gradient(90deg, transparent, ${alphaColor(
                      accentColor,
                      0.58,
                    )}, transparent)`,
                  }}
                />
                <div className="truncate text-[1.18rem] font-black uppercase leading-none tracking-[0.18em] text-white">
                  {mapLabel}
                </div>
              </div>
            </div>
          </div>
          <BroadcastFrame
            runtime={runtime}
            toneColor={toneColor}
            className="inline-block rounded-[30px] px-0 py-0"
          >
            <div className="relative overflow-hidden rounded-[30px]">
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background: [
                    `radial-gradient(circle at 0% 50%, ${alphaColor(
                      toneColor,
                      0.22,
                    )} 0%, transparent 32%)`,
                    `radial-gradient(circle at 100% 50%, ${alphaColor(
                      accentColor,
                      0.16,
                    )} 0%, transparent 30%)`,
                    `linear-gradient(90deg, ${alphaColor(
                      darkenHexColor(runtime.branding.panel, 0.74),
                      0.96,
                    )}, ${alphaColor(
                      darkenHexColor(runtime.branding.panel, 0.58),
                      0.84,
                    )})`,
                  ].join(", "),
                }}
              />
              <div
                className="pointer-events-none absolute inset-y-0 left-[156px] w-px"
                style={{
                  background: `linear-gradient(180deg, transparent, ${alphaColor(
                    toneColor,
                    0.28,
                  )}, transparent)`,
                }}
              />
              <div
                className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
                style={{
                  background: `linear-gradient(90deg, transparent, ${alphaColor(
                    toneColor,
                    0.72,
                  )}, ${alphaColor(accentColor, 0.74)}, transparent)`,
                }}
              />
              <div
                className="pointer-events-none absolute bottom-3 left-[172px] right-10 h-px"
                style={{
                  background: `linear-gradient(90deg, transparent, ${alphaColor(
                    toneColor,
                    0.24,
                  )}, transparent)`,
                }}
              />
              <div className="relative grid min-h-[128px] grid-cols-[156px_auto] items-stretch">
                <div
                  className="relative flex items-center justify-center px-3 py-3"
                  style={{
                    clipPath:
                      "polygon(0 18px, 18px 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%)",
                  }}
                >
                  <RotatingBrandLogo
                    items={rotatingLogos}
                    toneColor={toneColor}
                    showKindLabel={false}
                    logoSize={108}
                    logoChrome="bare"
                    logoFit="contain"
                  />
                </div>
                <div className="relative px-7 py-4 pr-8">
                  <div
                    className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.34em]"
                    style={readableTextStyle("muted")}
                  >
                    {tournamentLabel}
                  </div>
                  <div className="mt-3">
                    <div className="whitespace-nowrap text-[2.7rem] font-black uppercase leading-none tracking-[0.12em] text-white">
                      {matchLabel}
                    </div>
                    <div
                      className="mt-3 h-[12px] w-[132px]"
                      style={{
                        background: `linear-gradient(90deg, ${toneColor}, ${alphaColor(
                          accentColor,
                          0.12,
                        )})`,
                        clipPath:
                          "polygon(0 0, calc(100% - 18px) 0, 100% 100%, 18px 100%)",
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </BroadcastFrame>
        </div>
      </div>
    </WidgetSurface>
  );
}

function KillFeedPanel({ runtime }: { runtime: WidgetRuntime }) {
  const items = runtime.payload.killFeed.slice(0, 5);

  return (
    <WidgetSurface runtime={runtime} anchor="end">
      <div className="w-[580px] space-y-3">
        <div className="flex items-center justify-between px-1">
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.34em]"
            style={readableTextStyle("eyebrow")}
          >
            Elimination Feed
          </div>
          <SignalPill>{formatAgo(runtime.lastEventAt)}</SignalPill>
        </div>
        {items.length > 0 ? (
          items.map((entry) => (
            <BroadcastFrame
              key={entry.id}
              runtime={runtime}
              toneColor={runtime.branding.primaryColor}
              className="rounded-[24px] px-5 py-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-semibold uppercase tracking-[0.15em] text-white">
                    <span>{entry.killerName ?? "Unknown"}</span>
                    <span
                      className="text-[10px] tracking-[0.28em]"
                      style={readableTextStyle("hint")}
                    >
                      eliminated
                    </span>
                    <span>{entry.victimName ?? "Unknown"}</span>
                  </div>
                  <div
                    className="mt-2 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.22em]"
                    style={readableTextStyle("label")}
                  >
                    <span>{entry.killerTeam ?? "TEAM"}</span>
                    <span>/</span>
                    <span>{entry.weapon ?? "Weapon"}</span>
                    <span>/</span>
                    <span>{entry.victimTeam ?? "TEAM"}</span>
                  </div>
                </div>
                <SignalPill>{formatTime(entry.tsIso)}</SignalPill>
              </div>
            </BroadcastFrame>
          ))
        ) : (
          <BroadcastFrame
            runtime={runtime}
            toneColor={runtime.branding.primaryColor}
            className="rounded-[24px] px-5 py-5 text-sm"
            style={readableEmptyStateStyle()}
          >
            Waiting for kill-feed packets.
          </BroadcastFrame>
        )}
      </div>
    </WidgetSurface>
  );
}

function PlayerCardPanel({ runtime }: { runtime: WidgetRuntime }) {
  const player = runtime.payload.playerCard;

  if (!player && !runtime.preview) {
    return null;
  }

  const displayPlayer = player ?? PREVIEW_STATE.playerCard;
  const toneColor = resolveWidgetToneColor(runtime.branding);
  const teamColor = pickTeamColor(displayPlayer?.color, runtime.branding);

  if (!displayPlayer) {
    return null;
  }

  const photoSrc = displayPlayer.avatarUrl
    ? ensureApiUrl(displayPlayer.avatarUrl) ?? DEFAULT_PLAYER_PHOTO_URL
    : DEFAULT_PLAYER_PHOTO_URL;
  const teamLabel = formatTeamLabel(displayPlayer.teamTag, displayPlayer.teamName);

  return (
    <WidgetSurface runtime={runtime}>
      <div className="pointer-events-none absolute left-0 top-[42%] -translate-y-1/2">
        <BroadcastFrame
          runtime={runtime}
          toneColor={toneColor}
          className="w-[420px] rounded-[28px] p-4"
        >
          <div className="grid grid-cols-[112px_minmax(0,1fr)] items-stretch gap-4">
            <div
              className="relative overflow-hidden rounded-[24px] border"
              style={{
                borderColor: alphaColor(toneColor, 0.24),
                background: `linear-gradient(180deg, ${alphaColor(
                  toneColor,
                  0.2,
                )}, ${alphaColor(darkenHexColor(toneColor, 0.7), 0.76)})`,
                boxShadow: `0 16px 36px ${alphaColor(toneColor, 0.14)}`,
              }}
            >
              <img
                src={photoSrc}
                alt={displayPlayer.name ?? "Focused Player"}
                className="h-full w-full object-cover object-top"
                draggable={false}
              />
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 h-14"
                style={{
                  background: `linear-gradient(180deg, transparent, ${alphaColor(
                    darkenHexColor(runtime.branding.panel, 0.18),
                    0.94,
                  )})`,
                }}
              />
              <div className="absolute bottom-2 left-2">
                <TeamLogo
                  logoUrl={displayPlayer.logoUrl}
                  label={teamLabel}
                  color={teamColor}
                  size={32}
                  chrome="bare"
                  fit="contain"
                />
              </div>
            </div>

            <div className="min-w-0">
              <div
                className="text-[9px] font-semibold uppercase tracking-[0.3em]"
                style={readableTextStyle("eyebrow")}
              >
                Focused Player
              </div>
              <div className="mt-2 truncate text-[28px] font-black uppercase tracking-[0.12em] text-white">
                {displayPlayer.name ?? "Unknown Player"}
              </div>
              <div
                className="mt-3 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.22em]"
                style={readableTextStyle("muted")}
              >
                <SignalPill tone="accent">{teamLabel}</SignalPill>
                <SignalPill tone={displayPlayer.alive ? "live" : "default"}>
                  {displayPlayer.alive ? "Alive" : "Eliminated"}
                </SignalPill>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <div
                  className="rounded-[18px] border px-3 py-3"
                  style={{
                    borderColor: alphaColor(toneColor, 0.2),
                    background: `linear-gradient(180deg, ${alphaColor(
                      toneColor,
                      0.16,
                    )}, rgba(255,255,255,0.03))`,
                  }}
                >
                  <div className="text-[28px] font-black leading-none text-white">
                    {displayPlayer.kills}
                  </div>
                  <div
                    className="mt-1.5 text-[9px] uppercase tracking-[0.24em]"
                    style={readableTextStyle("label")}
                  >
                    Kills
                  </div>
                </div>
                <div
                  className="rounded-[18px] border px-3 py-3"
                  style={{
                    borderColor: alphaColor(toneColor, 0.2),
                    background: `linear-gradient(180deg, ${alphaColor(
                      toneColor,
                      0.16,
                    )}, rgba(255,255,255,0.03))`,
                  }}
                >
                  <div className="text-[28px] font-black leading-none text-white">
                    {Math.round(displayPlayer.damage ?? 0)}
                  </div>
                  <div
                    className="mt-1.5 text-[9px] uppercase tracking-[0.24em]"
                    style={readableTextStyle("label")}
                  >
                    Damage
                  </div>
                </div>
              </div>
            </div>
          </div>
        </BroadcastFrame>
      </div>
    </WidgetSurface>
  );
}

function PlayerPhotoPanel({ runtime }: { runtime: WidgetRuntime }) {
  const player = runtime.payload.playerCard;

  if (!player && !runtime.preview) {
    return null;
  }

  const displayPlayer = player ?? PREVIEW_STATE.playerCard;
  const toneColor = resolveWidgetToneColor(runtime.branding);

  if (!displayPlayer) {
    return null;
  }

  const photoSrc = displayPlayer.avatarUrl
    ? ensureApiUrl(displayPlayer.avatarUrl) ?? DEFAULT_PLAYER_PHOTO_URL
    : DEFAULT_PLAYER_PHOTO_URL;
  const totalRows =
    runtime.payload.leaderboard.length > 0
      ? runtime.payload.leaderboard.length
      : PREVIEW_STATE.leaderboard.length;
  const overallRankingWidth = overallRankingPanelWidth(totalRows);
  const surfaceBottomInset = runtime.preview && !runtime.clean ? 96 : 32;
  const bottomOffset = 12 - surfaceBottomInset;
  const rightOffset =
    overallRankingWidth + (runtime.clean ? -14 : -8) + 24;

  return (
    <WidgetSurface runtime={runtime}>
      <div
        className="pointer-events-none absolute"
        style={{
          bottom: `${bottomOffset}px`,
          right: `${rightOffset}px`,
        }}
      >
        <div
          className="relative h-[214px] w-[156px] overflow-hidden rounded-[30px] border"
          style={{
            borderColor: alphaColor(toneColor, 0.24),
            background: `linear-gradient(180deg, ${alphaColor(
              toneColor,
              0.2,
            )}, ${alphaColor(darkenHexColor(toneColor, 0.74), 0.8)})`,
            boxShadow: `0 24px 56px ${alphaColor(toneColor, 0.18)}`,
          }}
        >
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-12"
            style={{
              background: `linear-gradient(180deg, ${alphaColor(
                toneColor,
                0.16,
              )}, transparent)`,
            }}
          />
          <img
            src={photoSrc}
            alt={displayPlayer.name ?? "Focused Player"}
            className="absolute inset-0 h-full w-full object-contain object-bottom"
            draggable={false}
          />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-20"
            style={{
              background: `linear-gradient(180deg, transparent, ${alphaColor(
                darkenHexColor(runtime.branding.panel, 0.12),
                0.94,
              )})`,
            }}
          />
        </div>
      </div>
    </WidgetSurface>
  );
}

function WinnerPanel({ runtime }: { runtime: WidgetRuntime }) {
  const winner = runtime.payload.winner;
  const lastRenderedEventRef = useRef<string | null>(null);
  const displayWinner = winner ?? PREVIEW_STATE.winner;

  useEffect(() => {
    if (runtime.preview || !winner) {
      return;
    }

    const renderKey = `${runtime.payload.matchId}:${runtime.payload.updatedAt}`;
    if (lastRenderedEventRef.current === renderKey) {
      return;
    }

    lastRenderedEventRef.current = renderKey;
    console.info("[Widget] Winner rendered");
  }, [
    runtime.payload.matchId,
    runtime.payload.updatedAt,
    runtime.preview,
    winner,
  ]);

  if (!displayWinner && !runtime.preview) {
    return null;
  }
  if (!displayWinner) {
    return null;
  }

  const toneColor = resolveWidgetToneColor(runtime.branding);
  const teamColor = pickTeamColor(displayWinner.color, runtime.branding);

  return (
    <WidgetSurface runtime={runtime} anchor="center">
      <BroadcastFrame
        runtime={runtime}
        toneColor={toneColor}
        className="w-[780px] rounded-[34px] px-8 py-8 text-center"
      >
        <div
          className="text-[10px] font-semibold uppercase tracking-[0.36em]"
          style={readableTextStyle("eyebrow")}
        >
          Match Winner
        </div>
        <div className="mt-4 text-5xl font-black uppercase tracking-[0.2em] text-white">
          Chicken Dinner
        </div>
        <div className="mt-8 flex justify-center">
          <TeamLogo
            logoUrl={displayWinner.logoUrl}
            label={formatTeamLabel(displayWinner.teamTag, displayWinner.teamName)}
            color={teamColor}
            size={96}
          />
        </div>
        <div className="mt-5 text-3xl font-black uppercase tracking-[0.16em] text-white">
          {displayWinner.teamName}
        </div>
        <div className="mt-5 flex justify-center gap-3">
          <SignalPill tone="accent">
            {displayWinner.teamTag ?? formatSlot(displayWinner.slot)}
          </SignalPill>
          <SignalPill>{displayWinner.kills} kills</SignalPill>
          <SignalPill tone="live">
            {displayWinner.alivePlayers} alive
          </SignalPill>
        </div>
      </BroadcastFrame>
    </WidgetSurface>
  );
}

function WwcdPanel({
  runtime,
  visible,
}: {
  runtime: WidgetRuntime;
  visible: boolean;
}) {
  const winner = runtime.payload.winner ?? (runtime.preview ? PREVIEW_STATE.winner : null);
  if (!winner) {
    return null;
  }

  const liveWinner =
    runtime.payload.winner?.teamId && runtime.payload.winner.teamId === winner.teamId
      ? runtime.payload.winner
      : runtime.preview
        ? PREVIEW_STATE.winner
        : null;
  const brandPrimary = runtime.branding.primaryColor;
  const brandAccent = runtime.branding.accent;
  const toneColor = resolveWidgetToneColor(runtime.branding, "accent");
  const wwcdWords = ["Winner", "Winner", "Chicken", "Dinner"] as const;
  const stackOffset =
    runtime.preview && !runtime.clean
      ? "clamp(112px, 12vh, 144px)"
      : "clamp(96px, 10vh, 128px)";
  const heroGradient = `linear-gradient(118deg, #ffffff 0%, ${alphaColor(
    brandPrimary,
    0.94,
  )} 28%, ${alphaColor(brandAccent, 0.96)} 54%, #ffffff 76%, ${alphaColor(
    brandPrimary,
    0.9,
  )} 100%)`;
  const heroSweep = `linear-gradient(90deg, transparent 0%, ${alphaColor(
    brandAccent,
    0.08,
  )} 22%, ${alphaColor(brandPrimary, 0.52)} 50%, ${alphaColor(
    "#ffffff",
    0.82,
  )} 66%, transparent 100%)`;
  const heroGlow = `radial-gradient(circle at 50% 50%, ${alphaColor(
    brandAccent,
    0.22,
  )}, transparent 68%)`;

  return (
    <WidgetSurface runtime={runtime} anchor="center" align="center" fullBleed>
      <div
        className="h-full w-full transition-[opacity,transform,filter] duration-500 ease-out"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible
            ? "translate3d(0, 0, 0) scale(1)"
            : "translate3d(0, 36px, 0) scale(0.94)",
          filter: visible ? "blur(0px)" : "blur(12px)",
        }}
      >
        <BroadcastFrame
          runtime={runtime}
          toneColor={toneColor}
          className="relative h-full w-full overflow-hidden rounded-none px-10 py-10 text-center sm:px-16 sm:py-14"
          style={{ clipPath: "none" }}
        >
          <div
            className="pointer-events-none absolute inset-x-10 top-0 h-px origin-center transition-transform duration-700 ease-out"
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? "scaleX(1)" : "scaleX(0.24)",
              background: `linear-gradient(90deg, transparent, ${alphaColor(
                brandAccent,
                0.92,
              )}, transparent)`,
            }}
          />
          <div
            className="pointer-events-none absolute left-[-10%] top-[-22%] h-[280px] w-[280px] rounded-full blur-3xl transition-all duration-700 ease-out"
            style={{
              opacity: visible ? 1 : 0.18,
              transform: visible
                ? "translate3d(0, 0, 0) scale(1)"
                : "translate3d(-26px, -20px, 0) scale(0.84)",
              background: alphaColor(brandPrimary, 0.2),
            }}
          />
          <div
            className="pointer-events-none absolute bottom-[-18%] right-[-8%] h-[260px] w-[260px] rounded-full blur-3xl transition-all duration-700 ease-out"
            style={{
              opacity: visible ? 1 : 0.18,
              transform: visible
                ? "translate3d(0, 0, 0) scale(1)"
                : "translate3d(20px, 20px, 0) scale(0.82)",
              background: alphaColor(brandAccent, 0.18),
            }}
          />

          <div className="relative flex h-full w-full items-center justify-center">
            <div
              className="flex w-full max-w-[1560px] flex-col items-center"
              style={{ transform: `translateY(${stackOffset})` }}
            >
              <div
                className="w-full transition-all duration-500 ease-out"
                style={{
                  opacity: visible ? 1 : 0,
                  transform: visible
                    ? "translate3d(0, 0, 0)"
                    : "translate3d(0, -12px, 0)",
                  transitionDelay: visible ? "90ms" : "0ms",
                }}
              >
              <div
                className="text-[10px] font-semibold uppercase tracking-[0.36em]"
                style={readableTextStyle("eyebrow")}
              >
                WWCD
              </div>
              <div className="relative mt-5 overflow-hidden rounded-[30px] px-4 py-4">
                <div
                  className="pointer-events-none absolute inset-x-[10%] top-1/2 h-[140px] -translate-y-1/2 rounded-full blur-[42px]"
                  style={{
                    opacity: visible ? 1 : 0,
                    background: heroGlow,
                    animation: visible
                      ? "wwcdGlowPulse 3.4s ease-in-out 1.2s infinite"
                      : undefined,
                  }}
                />
                <div
                  className="pointer-events-none absolute left-[-28%] top-1/2 h-[76px] w-[48%] -translate-y-1/2 skew-x-[-22deg] blur-[12px]"
                  style={{
                    opacity: visible ? 0.94 : 0,
                    background: heroSweep,
                    animation: visible
                      ? "wwcdHeroSweep 4.8s linear 1.05s infinite"
                      : undefined,
                  }}
                />
                <div className="relative flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
                  {wwcdWords.map((word, index) => (
                    <span
                      key={`${word}-${index}`}
                      className="inline-block"
                      style={{
                        opacity: visible ? 1 : 0,
                        transform: visible
                          ? "translate3d(0, 0, 0) scale(1)"
                          : "translate3d(0, 24px, 0) scale(0.9)",
                        filter: visible ? "blur(0px)" : "blur(10px)",
                        transitionProperty: "opacity, transform, filter",
                        transitionDuration: "560ms",
                        transitionTimingFunction: "cubic-bezier(0.2, 0.8, 0.2, 1)",
                        transitionDelay: visible ? `${140 + index * 90}ms` : "0ms",
                      }}
                    >
                      <span
                        className="inline-block text-[58px] font-black uppercase leading-none tracking-[0.16em] sm:text-[88px] lg:text-[112px]"
                        style={{
                          backgroundImage: heroGradient,
                          backgroundSize: "220% 100%",
                          backgroundPosition: `${index * 12}% 50%`,
                          WebkitBackgroundClip: "text",
                          WebkitTextFillColor: "transparent",
                          filter: `drop-shadow(0 0 14px ${alphaColor(
                            brandAccent,
                            0.22,
                          )})`,
                          willChange: "transform, background-position, filter",
                          animation: visible
                            ? [
                                `wwcdWordFloat 3.2s ease-in-out ${1.12 + index * 0.14}s infinite`,
                                `wwcdWordShine 5.6s linear ${1.04 + index * 0.16}s infinite`,
                              ].join(", ")
                            : undefined,
                        }}
                      >
                        {word}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
              <div
                className="mt-4 text-[14px] uppercase tracking-[0.4em] sm:text-[16px]"
                style={readableTextStyle("label")}
              >
                Canonical finalized results confirmed.
              </div>
              </div>

              <div
                className="relative mt-12 flex w-full justify-center transition-all duration-500 ease-out"
                style={{
                  opacity: visible ? 1 : 0,
                  transform: visible
                    ? "translate3d(0, 0, 0) scale(1)"
                    : "translate3d(0, 28px, 0) scale(0.92)",
                  transitionDelay: visible ? "170ms" : "0ms",
                }}
              >
                <div
                  className="w-full max-w-[1040px] rounded-[36px] border px-10 py-8 sm:px-14 sm:py-10"
                  style={{
                    borderColor: alphaColor(brandAccent, 0.24),
                    background: [
                      `radial-gradient(circle at 50% 0%, ${alphaColor(
                        brandPrimary,
                        0.18,
                      )}, transparent 58%)`,
                      `linear-gradient(180deg, ${alphaColor(
                        brandAccent,
                        0.18,
                      )}, rgba(255,255,255,0.03))`,
                    ].join(", "),
                    boxShadow: `0 24px 56px ${alphaColor(brandAccent, 0.16)}`,
                  }}
                >
                  <div className="flex flex-col items-center justify-center gap-6 sm:flex-row sm:gap-8">
                    <div className="flex shrink-0 justify-center">
                      <TeamLogo
                        logoUrl={winner.logoUrl}
                        label={formatTeamLabel(winner.teamTag, winner.teamName, winner.slot)}
                        color={pickTeamColor(winner.color, runtime.branding)}
                        size={132}
                      />
                    </div>
                    <div className="min-w-0 text-center sm:text-left">
                      <div className="text-4xl font-black uppercase tracking-[0.14em] text-white sm:text-5xl">
                        {winner.teamName ?? "Awaiting Winner"}
                      </div>
                      <div
                        className="mt-3 text-sm uppercase tracking-[0.28em] sm:text-base"
                        style={readableTextStyle("meta")}
                      >
                        {runtime.tournamentName ?? "Arenzyra Championship"}
                        {runtime.map ? ` / ${runtime.map}` : ""}
                      </div>
                      <div className="mt-6 flex flex-wrap justify-center gap-3 sm:justify-start">
                        <SignalPill tone="accent">
                          {winner.teamTag ?? formatSlot(winner.slot)}
                        </SignalPill>
                        <SignalPill tone="live">Last team alive</SignalPill>
                        {liveWinner ? <SignalPill>{liveWinner.kills} kills</SignalPill> : null}
                        {liveWinner ? (
                          <SignalPill tone="live">{liveWinner.alivePlayers} alive</SignalPill>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <style jsx>{`
            @keyframes wwcdGlowPulse {
              0%,
              100% {
                transform: translate3d(0, -50%, 0) scale(0.94);
                opacity: 0.4;
              }
              50% {
                transform: translate3d(0, -50%, 0) scale(1.08);
                opacity: 0.92;
              }
            }

            @keyframes wwcdHeroSweep {
              0% {
                transform: translate3d(-24%, -50%, 0) skewX(-22deg);
                opacity: 0;
              }
              16% {
                opacity: 0.48;
              }
              44% {
                opacity: 0.88;
              }
              100% {
                transform: translate3d(248%, -50%, 0) skewX(-22deg);
                opacity: 0;
              }
            }

            @keyframes wwcdWordFloat {
              0%,
              100% {
                transform: translate3d(0, 0, 0) scale(1);
                filter: brightness(1) drop-shadow(0 0 12px rgba(255, 255, 255, 0.08));
              }
              50% {
                transform: translate3d(0, -5px, 0) scale(1.035);
                filter: brightness(1.12)
                  drop-shadow(0 0 18px rgba(255, 255, 255, 0.18));
              }
            }

            @keyframes wwcdWordShine {
              0% {
                background-position: 0% 50%;
              }
              100% {
                background-position: 220% 50%;
              }
            }
          `}</style>
        </BroadcastFrame>
      </div>
    </WidgetSurface>
  );
}

function FightAlertPanel({
  runtime,
  fights,
}: {
  runtime: WidgetRuntime;
  fights: FightAlertPayload[];
}) {
  if (!fights.length && !runtime.preview) {
    return null;
  }

  const displayFights = fights.length > 0 ? fights : PREVIEW_FIGHT_ALERTS;
  const roleVisuals: Record<
    NonNullable<NonNullable<FightAlertPayload["roles"]>["left"]>,
    { label: string; textColor: string; backgroundAlpha: number; borderAlpha: number }
  > = {
    attack: {
      label: "FIRE",
      textColor: "#ff8b5c",
      backgroundAlpha: 0.18,
      borderAlpha: 0.28,
    },
    defend: {
      label: "HIT",
      textColor: "#ffd36a",
      backgroundAlpha: 0.16,
      borderAlpha: 0.24,
    },
    trade: {
      label: "X",
      textColor: "#8fd8ff",
      backgroundAlpha: 0.16,
      borderAlpha: 0.26,
    },
  };

  return (
    <WidgetSurface runtime={runtime} anchor="end" align="start">
      <BroadcastFrame
        runtime={runtime}
        toneColor={runtime.branding.primaryColor}
        className="mt-4 mr-4 w-[660px] rounded-[24px] p-3"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.3em]"
              style={readableTextStyle("eyebrow")}
            >
              Fight Monitor
            </div>
            <div className="mt-0.5 text-[12px] font-black uppercase tracking-[0.14em] text-white">
              Closest fights first
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SignalPill tone="accent">{displayFights.length} lines</SignalPill>
            <SignalPill tone="live">observer utility</SignalPill>
          </div>
        </div>

        <div className="mt-2.5 space-y-1">
          {displayFights.map((fight) => {
            const teams = fight.teams.length ? fight.teams : PREVIEW_FIGHT_ALERT.teams;
            const left = teams[0];
            const right = teams[1];
            const leftRole = fight.roles?.left ?? null;
            const rightRole = fight.roles?.right ?? null;
            const leftRoleVisual = leftRole ? roleVisuals[leftRole] : null;
            const rightRoleVisual = rightRole ? roleVisuals[rightRole] : null;
            const leftPrimaryLabel =
              left?.slot !== null && left?.slot !== undefined
                ? formatSlot(left.slot)
                : formatTeamLabel(left?.teamTag, left?.teamName);
            const rightPrimaryLabel =
              right?.slot !== null && right?.slot !== undefined
                ? formatSlot(right.slot)
                : formatTeamLabel(right?.teamTag, right?.teamName);

            return (
              <div
                key={fight.fightId}
                className="grid grid-cols-[minmax(0,1fr)_96px_minmax(0,1fr)] items-center gap-2 rounded-[14px] border px-2.5 py-1.5"
                style={{
                  borderColor: alphaColor(runtime.branding.primaryColor, 0.14),
                  background: `linear-gradient(90deg, ${leftRoleVisual ? alphaColor(
                    leftRoleVisual.textColor,
                    0.08,
                  ) : alphaColor(
                    runtime.branding.primaryColor,
                    0.09,
                  )}, rgba(255,255,255,0.015) 54%, ${rightRoleVisual ? alphaColor(
                    rightRoleVisual.textColor,
                    0.07,
                  ) : alphaColor(
                    runtime.branding.accent,
                    0.06,
                  )})`,
                }}
              >
                <div className="flex min-w-0 items-center justify-self-end gap-2">
                  <div className="min-w-0 text-right">
                    <div className="flex items-baseline justify-end gap-2 whitespace-nowrap">
                      {leftRoleVisual ? (
                        <span
                          className="shrink-0 rounded-full border px-1.5 py-[2px] text-[8px] font-black uppercase tracking-[0.16em]"
                          style={{
                            color: leftRoleVisual.textColor,
                            borderColor: alphaColor(
                              leftRoleVisual.textColor,
                              leftRoleVisual.borderAlpha,
                            ),
                            background: alphaColor(
                              leftRoleVisual.textColor,
                              leftRoleVisual.backgroundAlpha,
                            ),
                          }}
                        >
                          {leftRoleVisual.label}
                        </span>
                      ) : null}
                      <span className="shrink-0 text-[13px] font-black uppercase tracking-[0.14em] text-white">
                        {leftPrimaryLabel}
                      </span>
                      <span
                        className="truncate text-[11px] uppercase tracking-[0.16em]"
                        style={readableTextStyle("meta")}
                      >
                        {left?.teamName ?? "Team One"}
                      </span>
                    </div>
                  </div>
                  <TeamLogo
                    logoUrl={left?.logoUrl}
                    label={formatTeamLabel(left?.teamTag, left?.teamName)}
                    color={runtime.branding.primaryColor}
                    size={22}
                  />
                </div>
                <div className="text-center">
                  <div
                    className="text-[12px] font-black uppercase tracking-[0.16em] text-white"
                  >
                    {fight.distance ?? "--"}
                    {fight.distanceUnit ?? "m"}{" "}
                    <span
                      className="text-[10px] font-semibold uppercase tracking-[0.18em]"
                      style={readableTextStyle("label")}
                    >
                      / {fight.eventCount} act
                    </span>
                  </div>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <TeamLogo
                    logoUrl={right?.logoUrl}
                    label={formatTeamLabel(right?.teamTag, right?.teamName)}
                    color={runtime.branding.accent}
                    size={22}
                  />
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2 whitespace-nowrap">
                      <span className="shrink-0 text-[13px] font-black uppercase tracking-[0.14em] text-white">
                        {rightPrimaryLabel}
                      </span>
                      <span
                        className="truncate text-[11px] uppercase tracking-[0.16em]"
                        style={readableTextStyle("meta")}
                      >
                        {right?.teamName ?? "Team Two"}
                      </span>
                      {rightRoleVisual ? (
                        <span
                          className="shrink-0 rounded-full border px-1.5 py-[2px] text-[8px] font-black uppercase tracking-[0.16em]"
                          style={{
                            color: rightRoleVisual.textColor,
                            borderColor: alphaColor(
                              rightRoleVisual.textColor,
                              rightRoleVisual.borderAlpha,
                            ),
                            background: alphaColor(
                              rightRoleVisual.textColor,
                              rightRoleVisual.backgroundAlpha,
                            ),
                          }}
                        >
                          {rightRoleVisual.label}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </BroadcastFrame>
    </WidgetSurface>
  );
}

export function TeamsAliveWidget() {
  const runtime = useWidgetRuntime("teams-alive");

  if (runtime.widgetAccessDenied) {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Teams Alive is not approved for this organization."
      />
    );
  }
  if (!runtime.preview && runtime.status === "waiting") {
    return null;
  }
  if (
    !runtime.preview &&
    runtime.status === "loading" &&
    runtime.payload.leaderboard.length === 0
  ) {
    return null;
  }
  if (runtime.status === "error") {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="WAITING"
        subtitle="Connect ShadowTracker telemetry or provide a valid matchId to start the Teams Alive widget."
      />
    );
  }

  return <TeamsAlivePanel runtime={runtime} />;
}

export function LeaderboardWidget() {
  const baseRuntime = useWidgetRuntime("leaderboard", {
    externalPayload: true,
  });
  const directState = useObserverDirectLeaderboard(baseRuntime.matchId, {
    enabled:
      !baseRuntime.preview &&
      !baseRuntime.widgetAccessDenied &&
      Boolean(baseRuntime.matchId) &&
      baseRuntime.canConsumeLiveTelemetry &&
      baseRuntime.canUseObserverDirect,
  });
  const [stableDirectPayload, setStableDirectPayload] =
    useState<MatchStatePayload | null>(null);
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    setStableDirectPayload(null);
  }, [baseRuntime.matchId, baseRuntime.preview]);
  useEffect(() => {
    if (baseRuntime.preview) {
      return;
    }
    const timer = window.setInterval(() => setNowTs(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [baseRuntime.preview]);
  const hasRenderableDirectPayload = shouldRenderDirectLeaderboard(
    directState.data,
    nowTs,
    stableDirectPayload,
  );
  useEffect(() => {
    if (hasRenderableDirectPayload && directState.data) {
      setStableDirectPayload((current) =>
        current === directState.data ? current : directState.data,
      );
    }
  }, [directState.data, hasRenderableDirectPayload]);
  const effectiveDirectPayload =
    hasRenderableDirectPayload && directState.data
      ? directState.data
      : stableDirectPayload;
  const runtime = useMemo<WidgetRuntime>(() => {
    if (
      baseRuntime.preview ||
      baseRuntime.widgetAccessDenied ||
      !baseRuntime.matchId ||
      !baseRuntime.canConsumeLiveTelemetry ||
      !baseRuntime.canUseObserverDirect
    ) {
      return baseRuntime;
    }

    const status: WidgetRuntimeStatus = effectiveDirectPayload
      ? "ready"
      : directState.error
        ? "waiting"
        : directState.isLoading
          ? "loading"
          : "waiting";

    return {
      ...baseRuntime,
      status,
      payload: effectiveDirectPayload ?? emptyMatchState(baseRuntime.matchId),
      lastEventAt:
        effectiveDirectPayload?.updatedAt ??
        directState.lastEventAt ??
        baseRuntime.lastEventAt,
      error: null,
      usingPreviewData: baseRuntime.usingPreviewData && !effectiveDirectPayload,
    };
  }, [
    baseRuntime,
    effectiveDirectPayload,
    directState.error,
    directState.isLoading,
    directState.lastEventAt,
  ]);

  if (runtime.widgetAccessDenied) {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Leaderboard is not approved for this organization."
      />
    );
  }
  if (!runtime.preview && runtime.status === "waiting") {
    return null;
  }
  if (
    !runtime.preview &&
    runtime.status === "loading" &&
    runtime.payload.leaderboard.length === 0
  ) {
    return null;
  }
  if (runtime.status === "error") {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="WAITING"
        subtitle="Connect ShadowTracker telemetry or provide a valid matchId to start the Leaderboard widget."
      />
    );
  }

  return <LeaderboardPanel runtime={runtime} />;
}

export function OverallLiveRankingWidget() {
  const baseRuntime = useWidgetRuntime("overall-live-ranking");
  const directState = useObserverDirectLeaderboard(baseRuntime.matchId, {
    enabled:
      !baseRuntime.preview &&
      !baseRuntime.widgetAccessDenied &&
      Boolean(baseRuntime.matchId) &&
      baseRuntime.canConsumeLiveTelemetry &&
      baseRuntime.canUseObserverDirect,
  });
  const [stableDirectPayload, setStableDirectPayload] =
    useState<MatchStatePayload | null>(null);
  useEffect(() => {
    setStableDirectPayload(null);
  }, [baseRuntime.matchId, baseRuntime.preview]);
  useEffect(() => {
    if (directState.data && payloadHasData(directState.data)) {
      setStableDirectPayload((current) =>
        current === directState.data ? current : directState.data,
      );
    }
  }, [directState.data]);
  const effectiveDirectPayload =
    directState.data && payloadHasData(directState.data)
      ? directState.data
      : stableDirectPayload;
  const hasDirectPayload =
    Boolean(effectiveDirectPayload) && payloadHasData(effectiveDirectPayload);
  const runtime = useMemo<WidgetRuntime>(() => {
    if (
      baseRuntime.preview ||
      baseRuntime.widgetAccessDenied ||
      !baseRuntime.matchId ||
      !baseRuntime.canConsumeLiveTelemetry ||
      !baseRuntime.canUseObserverDirect
    ) {
      return baseRuntime;
    }

    const payload =
      hasDirectPayload && effectiveDirectPayload
        ? effectiveDirectPayload
        : emptyMatchState(baseRuntime.matchId);
    const status: WidgetRuntimeStatus =
      directState.isLoading && !hasDirectPayload
        ? "loading"
        : hasDirectPayload
          ? "ready"
          : directState.error
            ? "waiting"
            : "waiting";

    return {
      ...baseRuntime,
      status,
      payload,
      lastEventAt:
        effectiveDirectPayload?.updatedAt ??
        directState.lastEventAt ??
        baseRuntime.lastEventAt,
      error: null,
      usingPreviewData: baseRuntime.usingPreviewData && !hasDirectPayload,
    };
  }, [
    baseRuntime,
    directState.error,
    directState.isLoading,
    directState.lastEventAt,
    effectiveDirectPayload,
    hasDirectPayload,
  ]);

  if (runtime.widgetAccessDenied) {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Overall Live Ranking is not approved for this organization."
      />
    );
  }
  if (!runtime.preview && runtime.status === "waiting") {
    return null;
  }
  if (runtime.status === "error") {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="WAITING"
        subtitle="Connect ShadowTracker telemetry or provide a valid matchId to start the Overall Live Ranking widget."
      />
    );
  }

  return <OverallLiveRankingPanel runtime={runtime} />;
}

export function MatchLowerThirdWidget() {
  const runtime = useWidgetRuntime("match-lower-third");

  if (runtime.widgetAccessDenied) {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Match Lower Third is not approved for this organization."
      />
    );
  }
  if (!runtime.preview && !runtime.canConsumeLiveTelemetry) {
    return null;
  }
  if (!runtime.preview && !runtime.matchName && !runtime.tournamentName) {
    return null;
  }
  if (
    runtime.status === "error" &&
    !runtime.matchName &&
    !runtime.tournamentName
  ) {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="WAITING"
        subtitle="Start an AUTO source live match or provide preview mode to render the Match Lower Third widget."
      />
    );
  }

  return <MatchLowerThirdPanel runtime={runtime} />;
}

export function KillFeedWidget() {
  const runtime = useWidgetRuntime("kill-feed");

  if (runtime.widgetAccessDenied) {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Kill Feed is not approved for this organization."
      />
    );
  }
  if (!runtime.preview && runtime.status === "waiting") {
    return null;
  }
  if (runtime.status === "error") {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="WAITING"
        subtitle="Connect ShadowTracker telemetry or provide a valid matchId to start the Kill Feed widget."
      />
    );
  }

  return <KillFeedPanel runtime={runtime} />;
}

export function PlayerCardWidget() {
  const runtime = useWidgetRuntime("player-card");

  if (runtime.widgetAccessDenied) {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Player Card is not approved for this organization."
      />
    );
  }
  if (!runtime.preview && runtime.status === "waiting") {
    return null;
  }
  if (runtime.status === "error") {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="WAITING"
        subtitle="Connect ShadowTracker telemetry or provide a valid matchId to start the Player Card widget."
      />
    );
  }

  return <PlayerCardPanel runtime={runtime} />;
}

export function PlayerPhotoWidget() {
  const baseRuntime = useWidgetRuntime("player-photo");
  const directState = useObserverDirectLeaderboard(baseRuntime.matchId, {
    enabled:
      !baseRuntime.preview &&
      !baseRuntime.widgetAccessDenied &&
      Boolean(baseRuntime.matchId) &&
      baseRuntime.canConsumeLiveTelemetry &&
      baseRuntime.canUseObserverDirect,
  });
  const mergedPlayerCard = useMemo(() => {
    const directPlayer = directState.data?.playerCard;
    if (!directPlayer) {
      return null;
    }

    const canonicalPlayer = baseRuntime.payload.playerCard;
    const normalizedDirectName = directPlayer.name?.trim().toLowerCase() ?? null;
    const normalizedCanonicalName =
      canonicalPlayer?.name?.trim().toLowerCase() ?? null;
    const normalizedDirectTeamTag = directPlayer.teamTag?.trim().toLowerCase() ?? null;
    const normalizedCanonicalTeamTag =
      canonicalPlayer?.teamTag?.trim().toLowerCase() ?? null;
    const samePlayer =
      directPlayer.playerId && canonicalPlayer?.playerId
        ? directPlayer.playerId === canonicalPlayer.playerId
        : normalizedDirectName !== null &&
          normalizedDirectName === normalizedCanonicalName &&
          ((directPlayer.teamId && canonicalPlayer?.teamId
            ? directPlayer.teamId === canonicalPlayer.teamId
            : false) ||
            (normalizedDirectTeamTag !== null &&
            normalizedCanonicalTeamTag !== null
              ? normalizedDirectTeamTag === normalizedCanonicalTeamTag
              : false));

    return {
      ...directPlayer,
      avatarUrl:
        directPlayer.avatarUrl ??
        (samePlayer ? canonicalPlayer?.avatarUrl ?? null : null),
      teamId: directPlayer.teamId ?? (samePlayer ? canonicalPlayer?.teamId ?? null : null),
      teamName:
        directPlayer.teamName ?? (samePlayer ? canonicalPlayer?.teamName ?? null : null),
      teamTag:
        directPlayer.teamTag ?? (samePlayer ? canonicalPlayer?.teamTag ?? null : null),
      logoUrl:
        directPlayer.logoUrl ?? (samePlayer ? canonicalPlayer?.logoUrl ?? null : null),
      color: directPlayer.color ?? (samePlayer ? canonicalPlayer?.color ?? null : null),
      damage: directPlayer.damage ?? (samePlayer ? canonicalPlayer?.damage ?? null : null),
    };
  }, [baseRuntime.payload.playerCard, directState.data?.playerCard]);
  const hasDirectPlayerCard = Boolean(mergedPlayerCard);
  const runtime = useMemo<WidgetRuntime>(() => {
    if (
      baseRuntime.preview ||
      baseRuntime.widgetAccessDenied ||
      !baseRuntime.matchId ||
      !baseRuntime.canConsumeLiveTelemetry ||
      !baseRuntime.canUseObserverDirect
    ) {
      return baseRuntime;
    }

    const status: WidgetRuntimeStatus =
      directState.isLoading && !hasDirectPlayerCard
        ? "loading"
        : hasDirectPlayerCard
          ? "ready"
          : "waiting";

    return {
      ...baseRuntime,
      status,
      payload: hasDirectPlayerCard
        ? {
            ...baseRuntime.payload,
            playerCard: mergedPlayerCard,
          }
        : emptyMatchState(baseRuntime.matchId),
      lastEventAt: directState.lastEventAt ?? baseRuntime.lastEventAt,
      error: null,
      usingPreviewData: baseRuntime.usingPreviewData && !hasDirectPlayerCard,
    };
  }, [
    baseRuntime,
    directState.isLoading,
    directState.lastEventAt,
    hasDirectPlayerCard,
    mergedPlayerCard,
  ]);

  if (runtime.widgetAccessDenied) {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Player Photo is not approved for this organization."
      />
    );
  }
  if (!runtime.preview && runtime.status === "waiting") {
    return null;
  }
  if (runtime.status === "error") {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="WAITING"
        subtitle="Connect ShadowTracker telemetry or provide a valid matchId to start the Player Photo widget."
      />
    );
  }

  return <PlayerPhotoPanel runtime={runtime} />;
}

export function MapOverlayWidget() {
  const baseRuntime = useWidgetRuntime("map-overlay", {
    skipLiveStatePayload: true,
  });
  const searchParams = useSearchParams();
  const showRealtimeDebug = searchParams.get("realtimeDebug") === "true";
  const requestedDirectMatchId = baseRuntime.matchId ?? "observer-direct";
  const directState = useObserverDirectLeaderboard(requestedDirectMatchId, {
    enabled:
      !baseRuntime.preview &&
      !baseRuntime.widgetAccessDenied &&
      baseRuntime.canUseObserverDirect,
    launcherOnly: false,
  });
  const observerDirectMatchId =
    directState.data?.matchId ?? requestedDirectMatchId;
  const directMapState = useObserverDirectMapOverlay(observerDirectMatchId, {
    enabled:
      !baseRuntime.preview &&
      !baseRuntime.widgetAccessDenied &&
      baseRuntime.canUseObserverDirect,
  });
  const leaderboardPlayerStats = useMemo(
    () => countObserverLeaderboardPlayers(directState.data),
    [directState.data],
  );
  const [stableDirectPayload, setStableDirectPayload] =
    useState<ObserverLeaderboardPayload | null>(null);
  const [stableDirectMapPayload, setStableDirectMapPayload] =
    useState<MapOverlayPayload | null>(null);
  const freshnessNowMs = useWidgetClock(baseRuntime.preview, 250);
  useEffect(() => {
    setStableDirectPayload(null);
    setStableDirectMapPayload(null);
  }, [baseRuntime.preview, requestedDirectMatchId]);
  useEffect(() => {
    if (directState.data && payloadHasData(directState.data)) {
      setStableDirectPayload((current) =>
        current === directState.data ? current : directState.data,
      );
    }
  }, [directState.data]);
  const nextDirectMapPayload = useMemo(
    () => buildMapOverlayPayloadFromObserverDirectMap(directMapState.data),
    [directMapState.data],
  );
  useEffect(() => {
    if (nextDirectMapPayload && mapOverlayHasRenderableData(nextDirectMapPayload)) {
      const nextSignature = getMapOverlayPayloadSignature(nextDirectMapPayload);
      setStableDirectMapPayload((current) =>
        getMapOverlayPayloadSignature(current) === nextSignature
          ? current
          : nextDirectMapPayload,
      );
    }
  }, [nextDirectMapPayload]);
  const effectiveDirectPayload =
    directState.data && isObserverPayloadFresh(directState.data, freshnessNowMs)
      ? directState.data
      : isObserverPayloadFresh(stableDirectPayload, freshnessNowMs)
        ? stableDirectPayload
        : null;
  const effectiveDirectMapPayload =
    nextDirectMapPayload &&
    mapOverlayHasRenderableData(nextDirectMapPayload) &&
    isMapOverlayPayloadFresh(nextDirectMapPayload, freshnessNowMs)
      ? nextDirectMapPayload
      : isMapOverlayPayloadFresh(stableDirectMapPayload, freshnessNowMs)
        ? stableDirectMapPayload
        : null;
  useEffect(() => {
    if (!showRealtimeDebug || baseRuntime.preview) {
      return;
    }

    console.debug("[map-overlay][hook][leaderboard]", {
      updatedAt: directState.data?.updatedAt ?? null,
      fresh: isObserverPayloadFresh(directState.data, Date.now()),
      leaderboardRows: directState.data?.leaderboard.length ?? 0,
      teamsAlive: directState.data?.teamsAlive ?? 0,
      totalPlayers: leaderboardPlayerStats.totalPlayers,
      positionedPlayers: leaderboardPlayerStats.positionedPlayers,
      error: directState.error,
    });
  }, [
    baseRuntime.preview,
    directState.data,
    directState.error,
    leaderboardPlayerStats.positionedPlayers,
    leaderboardPlayerStats.totalPlayers,
    showRealtimeDebug,
  ]);
  useEffect(() => {
    if (!showRealtimeDebug || baseRuntime.preview) {
      return;
    }

    console.debug("[map-overlay][hook][direct-map]", {
      updatedAt: nextDirectMapPayload?.updatedAt ?? null,
      source: formatMapOverlaySourceLabel(nextDirectMapPayload?.source),
      producer: directMapState.data?.debug?.producer ?? null,
      fresh: isMapOverlayPayloadFresh(nextDirectMapPayload, Date.now()),
      renderable: mapOverlayHasRenderableData(nextDirectMapPayload),
      totalPlayers:
        directMapState.data?.debug?.totalPlayers ??
        directMapState.data?.playerMarkers.length ??
        0,
      positionedPlayers:
        directMapState.data?.debug?.positionedPlayers ??
        directMapState.data?.playerMarkers.length ??
        0,
      rawPlayerMarkers: directMapState.data?.playerMarkers.length ?? 0,
      normalizedPlayerMarkers: nextDirectMapPayload?.playerMarkers.length ?? 0,
      teamMarkers: nextDirectMapPayload?.teamMarkers.length ?? 0,
      rawMarkerTypes: {
        playerMarkers: directMapState.data?.playerMarkers.length ?? 0,
        teamMarkers: directMapState.data?.teamMarkers.length ?? 0,
        labels: 0,
        iconTypes: 0,
      },
      normalizedMarkerTypes: {
        playerMarkers: nextDirectMapPayload?.playerMarkers.length ?? 0,
        teamMarkers: nextDirectMapPayload?.teamMarkers.length ?? 0,
        labels: 0,
        iconTypes: 0,
      },
      leaderboardPlayers: leaderboardPlayerStats.totalPlayers,
      leaderboardPositionedPlayers: leaderboardPlayerStats.positionedPlayers,
      rawWorldSize:
        directMapState.data?.debug?.worldSize ??
        directMapState.data?.map?.worldSize ??
        null,
      effectiveWorldSize: nextDirectMapPayload?.map?.worldSize ?? null,
      bounds: directMapState.data?.debug?.bounds ?? null,
      error: directMapState.error,
    });
  }, [
    baseRuntime.preview,
    directMapState.error,
    directMapState.data,
    leaderboardPlayerStats.positionedPlayers,
    leaderboardPlayerStats.totalPlayers,
    nextDirectMapPayload,
    showRealtimeDebug,
  ]);
  useEffect(() => {
    if (!showRealtimeDebug || baseRuntime.preview) {
      return;
    }

    const directPositionedPlayerCount =
      directMapState.data?.debug?.positionedPlayers ??
      directMapState.data?.playerMarkers.length ??
      0;
    const normalizedPlayerCount = nextDirectMapPayload?.playerMarkers.length ?? 0;
    if (
      directPositionedPlayerCount <= 0 ||
      directPositionedPlayerCount === normalizedPlayerCount
    ) {
      return;
    }

    console.warn("[map-overlay][direct-map][normalization-mismatch]", {
      producer: directMapState.data?.debug?.producer ?? null,
      updatedAt: directMapState.data?.updatedAt ?? null,
      directPositionedPlayerCount,
      normalizedPlayerCount,
      leaderboardPositionedPlayers: leaderboardPlayerStats.positionedPlayers,
      bounds: directMapState.data?.debug?.bounds ?? null,
    });
  }, [
    baseRuntime.preview,
    directMapState.data,
    leaderboardPlayerStats.positionedPlayers,
    nextDirectMapPayload?.playerMarkers.length,
    showRealtimeDebug,
  ]);
  const alignedDirectPayload =
    effectiveDirectPayload &&
    (observerDirectMatchId === "observer-direct" ||
      effectiveDirectPayload.matchId === observerDirectMatchId)
      ? effectiveDirectPayload
      : null;
  const alignedDirectMapPayload =
    effectiveDirectMapPayload &&
    (observerDirectMatchId === "observer-direct" ||
      effectiveDirectMapPayload.matchId === observerDirectMatchId)
      ? effectiveDirectMapPayload
      : null;
  const hasDirectPayload =
    Boolean(alignedDirectPayload) && payloadHasData(alignedDirectPayload);
  const hasDirectMapPayload =
    Boolean(alignedDirectMapPayload) &&
    mapOverlayHasRenderableData(alignedDirectMapPayload);
  const resolvedMatchId =
    alignedDirectPayload?.matchId ??
    alignedDirectMapPayload?.matchId ??
    baseRuntime.matchId;
  const runtime = useMemo<WidgetRuntime>(() => {
    if (
      baseRuntime.preview ||
      baseRuntime.widgetAccessDenied ||
      !baseRuntime.canUseObserverDirect
    ) {
      return baseRuntime;
    }

    return {
      ...baseRuntime,
      matchId: resolvedMatchId,
      status:
        (directState.isLoading || directMapState.isLoading) &&
        !hasDirectPayload &&
        !hasDirectMapPayload
          ? "loading"
          : hasDirectPayload || hasDirectMapPayload
            ? "ready"
            : "waiting",
      payload:
        hasDirectPayload && alignedDirectPayload
          ? alignedDirectPayload
          : emptyMatchState(resolvedMatchId ?? observerDirectMatchId),
      lastEventAt:
        directMapState.lastEventAt ??
        directState.lastEventAt ??
        baseRuntime.lastEventAt,
      error:
        hasDirectPayload || hasDirectMapPayload
          ? null
          : directMapState.error ?? directState.error ?? baseRuntime.error,
      usingPreviewData: false,
    };
  }, [
    alignedDirectPayload,
    baseRuntime,
    directMapState.isLoading,
    directMapState.lastEventAt,
    directMapState.error,
    directState.isLoading,
    directState.lastEventAt,
    directState.error,
    observerDirectMatchId,
    hasDirectPayload,
    hasDirectMapPayload,
    resolvedMatchId,
  ]);
  const mapState = useMapOverlayState(
    runtime,
    alignedDirectPayload as ObserverLeaderboardPayload | null,
    {
      launcherOnly: false,
      directMapPayload: alignedDirectMapPayload,
      launcherError: directMapState.error,
      launcherLoading: directMapState.isLoading,
      debugRealtime: showRealtimeDebug,
    },
  );

  if (runtime.widgetAccessDenied) {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Live Map is not approved for this organization."
      />
    );
  }
  if (mapState.status === "error" && !runtime.preview) {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="WAITING"
        subtitle={
          mapState.error ??
          "Live Map becomes active once a live match has valid map telemetry and a supported map asset."
        }
      />
    );
  }
  if (!runtime.preview && mapState.status === "waiting") {
    return null;
  }
  if (!mapOverlayHasRenderableData(mapState.payload)) {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="WAITING"
        subtitle="Live Map needs a supported live map plus active circle or player position telemetry."
      />
    );
  }

  return (
    <MapOverlayPanel
      runtime={runtime}
      mapState={mapState}
      debugRealtime={showRealtimeDebug}
    />
  );
}

export function NextZoneUpdateWidget() {
  const baseRuntime = useWidgetRuntime("next-zone-update");
  const directState = useObserverDirectLeaderboard(baseRuntime.matchId, {
    enabled:
      !baseRuntime.preview &&
      !baseRuntime.widgetAccessDenied &&
      Boolean(baseRuntime.matchId) &&
      baseRuntime.canConsumeLiveTelemetry &&
      baseRuntime.canUseObserverDirect,
  });
  const [stableDirectPayload, setStableDirectPayload] =
    useState<MatchStatePayload | null>(null);
  useEffect(() => {
    setStableDirectPayload(null);
  }, [baseRuntime.matchId, baseRuntime.preview]);
  useEffect(() => {
    if (directState.data && payloadHasData(directState.data)) {
      setStableDirectPayload((current) =>
        current === directState.data ? current : directState.data,
      );
    }
  }, [directState.data]);
  const effectiveDirectPayload =
    directState.data && payloadHasData(directState.data)
      ? directState.data
      : stableDirectPayload;
  const alignedDirectPayload =
    effectiveDirectPayload &&
    effectiveDirectPayload.matchId === baseRuntime.matchId
      ? effectiveDirectPayload
      : null;
  const runtime = useMemo<WidgetRuntime>(() => {
    if (
      baseRuntime.preview ||
      baseRuntime.widgetAccessDenied ||
      !baseRuntime.matchId ||
      !baseRuntime.canConsumeLiveTelemetry ||
      !baseRuntime.canUseObserverDirect
    ) {
      return baseRuntime;
    }

    const baseCircle = baseRuntime.payload.circle;
    const directCircle = alignedDirectPayload?.circle ?? null;
    const mergedCircle = mergeMatchStateCircle(directCircle, baseCircle);
    const hasMergedCircle =
      mergedCircle !== null &&
      (mergedCircle.nextShrinkAt !== null ||
        mergedCircle.phase !== null ||
        mergedCircle.safeZone !== null ||
        mergedCircle.nextZone !== null ||
        mergedCircle.status !== null);

    return {
      ...baseRuntime,
      payload: hasMergedCircle
        ? {
            ...baseRuntime.payload,
            circle: mergedCircle,
          }
        : baseRuntime.payload,
      lastEventAt: directState.lastEventAt ?? baseRuntime.lastEventAt,
      error: hasMergedCircle ? null : baseRuntime.error,
    };
  }, [
    alignedDirectPayload,
    baseRuntime,
    directState.lastEventAt,
  ]);
  const mapState = useMapOverlayState(runtime);

  if (runtime.widgetAccessDenied) {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Next Zone Update is not approved for this organization."
      />
    );
  }
  if (runtime.status === "error" && !runtime.preview && !runtime.matchId) {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="WAITING"
        subtitle="Next Zone Update becomes active during the final 20 seconds before the next safe-zone change."
      />
    );
  }
  if (!runtime.preview && !runtime.matchId) {
    return null;
  }

  return <NextZoneUpdatePanel runtime={runtime} mapState={mapState} />;
}

export function WwcdWidget() {
  const baseRuntime = useWidgetRuntime("wwcd");
  const [stickyMatchId, setStickyMatchId] = useState<string | null>(
    baseRuntime.matchId,
  );
  const [directWinnerPayload, setDirectWinnerPayload] =
    useState<MatchStatePayload | null>(null);
  useEffect(() => {
    if (!baseRuntime.matchId) {
      return;
    }

    setStickyMatchId((current) =>
      current === baseRuntime.matchId ? current : baseRuntime.matchId,
    );
    setDirectWinnerPayload((current) =>
      current?.matchId === baseRuntime.matchId ? current : null,
    );
  }, [baseRuntime.matchId]);
  const directState = useObserverDirectLeaderboard(stickyMatchId, {
    enabled:
      !baseRuntime.preview &&
      !baseRuntime.widgetAccessDenied &&
      Boolean(stickyMatchId) &&
      baseRuntime.canUseObserverDirect,
  });
  useEffect(() => {
    if (
      directState.data &&
      directState.data.winner &&
      directState.data.teamsAlive <= 1
    ) {
      setDirectWinnerPayload((current) =>
        current === directState.data ? current : directState.data,
      );
    }
  }, [directState.data]);
  const runtime = useMemo<WidgetRuntime>(() => {
    if (
      baseRuntime.preview ||
      baseRuntime.widgetAccessDenied ||
      !stickyMatchId
    ) {
      return baseRuntime;
    }

    if (!baseRuntime.canUseObserverDirect) {
      return {
        ...baseRuntime,
        matchId: stickyMatchId,
        status: baseRuntime.payload.winner ? "ready" : baseRuntime.status,
        error: baseRuntime.payload.winner ? null : baseRuntime.error,
      };
    }

    const effectivePayload =
      directWinnerPayload ?? emptyMatchState(stickyMatchId);
    const hasWinner = Boolean(directWinnerPayload?.winner);
    return {
      ...baseRuntime,
      matchId: stickyMatchId,
      status: hasWinner ? "ready" : "waiting",
      payload: effectivePayload,
      lastEventAt:
        directWinnerPayload?.updatedAt ??
        directState.lastEventAt ??
        baseRuntime.lastEventAt,
      error: null,
      usingPreviewData: false,
    };
  }, [
    baseRuntime,
    directState.lastEventAt,
    directWinnerPayload,
    stickyMatchId,
  ]);
  const wwcdFeed = useWwcdFeed(runtime);
  const winner =
    runtime.payload.winner ?? (runtime.preview ? PREVIEW_STATE.winner : null);

  if (runtime.widgetAccessDenied) {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="WWCD is not approved for this organization."
      />
    );
  }
  if (!runtime.preview && !runtime.matchId) {
    return null;
  }
  if (!runtime.preview && !wwcdFeed.armed) {
    return null;
  }
  if (!winner && !runtime.preview) {
    return null;
  }
  if (runtime.status === "error" && !runtime.preview) {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="WAITING"
        subtitle={
        runtime.error ??
          "WWCD appears once ob.js confirms the last surviving team."
        }
      />
    );
  }

  return (
    <WwcdPanel
      runtime={runtime}
      visible={wwcdFeed.visible}
    />
  );
}

export function WinnerWidget() {
  const runtime = useWidgetRuntime("winner");

  if (runtime.widgetAccessDenied) {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Winner is not approved for this organization."
      />
    );
  }
  if (!runtime.preview && runtime.isFinalizing) {
    return (
      <WidgetEmptyState
        runtime={{ ...runtime, status: "error" }}
        title="FINALIZING"
        subtitle="Canonical match end detected. Winner waits for finalized results before rendering."
      />
    );
  }
  if (runtime.status === "error") {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="WAITING"
        subtitle={
          runtime.error ??
          "Winner widget becomes active only after canonical results are finalized."
        }
      />
    );
  }
  if (!runtime.preview && !runtime.payload.winner) {
    return null;
  }

  return <WinnerPanel runtime={runtime} />;
}

export function TeamEliminatedAlertWidget() {
  const runtime = useWidgetRuntime("team-eliminated-alert");

  if (runtime.widgetAccessDenied) {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Team Eliminated Alert is not approved for this organization."
      />
    );
  }
  if (runtime.status === "error" && !runtime.preview && !runtime.matchId) {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="WAITING"
        subtitle="Team Eliminated Alert listens for backend-issued observer team elimination events once a match is active."
      />
    );
  }
  if (!runtime.preview && !runtime.matchId) {
    return null;
  }

  return <TeamEliminatedAlertPanel runtime={runtime} />;
}

export function AchievementAlertWidget() {
  const runtime = useWidgetRuntime("achievement-alert");

  if (runtime.widgetAccessDenied) {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Achievement Alert is not approved for this organization."
      />
    );
  }
  if (runtime.status === "error" && !runtime.preview && !runtime.matchId) {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="WAITING"
        subtitle="Achievement Alert listens for live observer achievement events once a match is active."
      />
    );
  }
  if (!runtime.preview && !runtime.matchId) {
    return null;
  }

  return <AchievementAlertPanel runtime={runtime} />;
}

export function FightAlertWidget() {
  const baseRuntime = useWidgetRuntime("fight-alert");
  const directState = useObserverDirectLeaderboard(baseRuntime.matchId, {
    enabled:
      !baseRuntime.preview &&
      !baseRuntime.widgetAccessDenied &&
      Boolean(baseRuntime.matchId) &&
      baseRuntime.canConsumeLiveTelemetry &&
      baseRuntime.canUseObserverDirect,
  });
  const [directFightAlerts, setDirectFightAlerts] = useState<FightAlertPayload[]>(
    baseRuntime.preview ? PREVIEW_FIGHT_ALERTS : [],
  );
  const clearFightAlertTimeoutRef = useRef<number | null>(null);
  const directFightCandidates = useMemo(
    () => buildDirectFightAlerts(baseRuntime, directState.data),
    [baseRuntime, directState.data],
  );

  useEffect(() => {
    if (clearFightAlertTimeoutRef.current !== null) {
      window.clearTimeout(clearFightAlertTimeoutRef.current);
      clearFightAlertTimeoutRef.current = null;
    }
    setDirectFightAlerts(baseRuntime.preview ? PREVIEW_FIGHT_ALERTS : []);
  }, [baseRuntime.matchId, baseRuntime.preview]);

  useEffect(() => {
    if (baseRuntime.preview) {
      setDirectFightAlerts(PREVIEW_FIGHT_ALERTS);
      return;
    }

    setDirectFightAlerts((current) => {
      const currentById = new Map(current.map((fight) => [fight.fightId, fight]));
      const nextById = new Map<string, FightAlertPayload>();

      for (const candidate of directFightCandidates) {
        const existing = currentById.get(candidate.fightId);
        nextById.set(candidate.fightId, {
          ...candidate,
          startedAt: existing?.startedAt ?? candidate.startedAt,
        });
      }

      const nowMs = Date.now();
      for (const existing of current) {
        if (nextById.has(existing.fightId)) {
          continue;
        }
        const lastEventAtMs = resolveTimestampMs(existing.lastEventAt) ?? nowMs;
        if (nowMs - lastEventAtMs < FIGHT_ALERT_LINGER_MS) {
          nextById.set(existing.fightId, existing);
        }
      }

      const sorted = sortFightAlertsByDistance(Array.from(nextById.values())).slice(0, 10);
      const unchanged =
        sorted.length === current.length &&
        sorted.every((fight, index) => {
          const currentFight = current[index];
          return (
            currentFight &&
            currentFight.fightId === fight.fightId &&
            currentFight.eventCount === fight.eventCount &&
            currentFight.distance === fight.distance &&
            currentFight.lastEventAt === fight.lastEventAt
          );
        });
      return unchanged ? current : sorted;
    });
  }, [
    baseRuntime.preview,
    directFightCandidates,
  ]);

  useEffect(() => {
    return () => {
      if (clearFightAlertTimeoutRef.current !== null) {
        window.clearTimeout(clearFightAlertTimeoutRef.current);
      }
    };
  }, []);

  const runtime = useMemo<WidgetRuntime>(() => {
    if (
      baseRuntime.preview ||
      baseRuntime.widgetAccessDenied ||
      !baseRuntime.matchId ||
      !baseRuntime.canConsumeLiveTelemetry ||
      !baseRuntime.canUseObserverDirect
    ) {
      return {
        ...baseRuntime,
        fightAlert: baseRuntime.preview ? PREVIEW_FIGHT_ALERT : baseRuntime.fightAlert,
      };
    }

    const effectiveFightAlerts =
      directFightAlerts.length > 0
        ? directFightAlerts
        : baseRuntime.fightAlert
          ? [baseRuntime.fightAlert]
          : [];
    const effectiveFightAlert = effectiveFightAlerts[0] ?? null;

    return {
      ...baseRuntime,
      status:
        directState.isLoading && !effectiveFightAlert
          ? "loading"
          : effectiveFightAlert
            ? "ready"
            : baseRuntime.status,
      fightAlert: effectiveFightAlert,
      lastEventAt:
        effectiveFightAlert?.lastEventAt ??
        directState.lastEventAt ??
        baseRuntime.lastEventAt,
      error: effectiveFightAlert ? null : baseRuntime.error,
      usingPreviewData: baseRuntime.usingPreviewData && !effectiveFightAlert,
    };
  }, [
    baseRuntime,
    directFightAlerts,
    directState.isLoading,
    directState.lastEventAt,
  ]);

  if (runtime.widgetAccessDenied) {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Fight Alert is not approved for this organization."
      />
    );
  }
  if (runtime.status === "error") {
    return (
      <WidgetEmptyState
        runtime={runtime}
        title="WAITING"
        subtitle="Fight Alert becomes active when direct observer telemetry detects nearby live teams."
      />
    );
  }

  const fights =
    directFightAlerts.length > 0
      ? directFightAlerts
      : runtime.fightAlert
        ? [runtime.fightAlert]
        : [];

  if (!runtime.preview && fights.length === 0) {
    return null;
  }

  return <FightAlertPanel runtime={runtime} fights={fights} />;
}
