"use client";
/* eslint-disable @next/next/no-img-element */

import { API_URL, ensureApiUrl } from "@/lib/api";
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
  fetchMatchControlSnapshot,
  getControlLifecycleStatus,
  getControlRuntimeBadge,
  isControlFinalized,
  isControlFinalizing,
  type MatchRuntimeControlSnapshot,
} from "@/features/matches/match-control-runtime";
import { useWidgetRealtime } from "../../features/widgets/realtime/use-widget-realtime";
import { useSearchParams } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

type ActiveMatchPayload = {
  id: string;
  matchId: string;
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
  id: string | null;
  name: string | null;
  logoUrl: string | null;
  tier: string | null;
  displayOrder?: number | null;
  websiteUrl?: string | null;
  rotationIntervalSeconds?: number | null;
};

type WidgetContextResponse = {
  organizationId?: string | null;
  organizationSlug?: string | null;
  branding?: Partial<BrandingState> | null;
};

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
  winner: MatchStateWinner | null;
};

type WinnerEventPayload = {
  matchId: string;
  teamId: string | null;
  teamName: string;
  teamTag: string | null;
  logoUrl: string | null;
};

type BrandingEventPayload = {
  organizationId: string;
  branding: Partial<BrandingState>;
};

type WidgetRuntimeStatus = "loading" | "ready" | "waiting" | "error";

type OrganizerWidgetRuntime = {
  widgetKey: OrganizerWidgetKey;
  preview: boolean;
  status: WidgetRuntimeStatus;
  organizationId: string | null;
  matchId: string | null;
  branding: BrandingState;
  match: ActiveMatchPayload | null;
  control: MatchRuntimeControlSnapshot | null;
  state: MatchStatePayload | null;
  lastEventAt: string | null;
  error: string | null;
  usingPreviewData: boolean;
  widgetAccessDenied: boolean;
  widgetApprovalEnforced: boolean;
  widgetApproval: WidgetApprovalRecord | null;
};

type OrganizerWidgetKey =
  | "countdown"
  | "match-intro"
  | "teams-lineup"
  | "map-card"
  | "lobby-slot-list"
  | "sponsor-banner"
  | "next-match"
  | "team-status"
  | "match-results"
  | "match-summary"
  | "head-to-head-comparison"
  | "winner-celebration"
  | "overall-standings"
  | "mvp-top-fragger"
  | "next-match-break"
  | "points-breakdown";

type MatchSlotPayload = {
  id: string;
  matchId: string;
  slotNumber: number;
  teamId: string | null;
  lobbyStatus: string | null;
  playersInLobby: number | null;
  attendanceStatus: string | null;
  team: {
    id: string;
    name: string | null;
    tag: string | null;
    logoUrl: string | null;
    accentLight: string | null;
    accentDark: string | null;
  } | null;
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

type WidgetEnvelope<T> = {
  meta?: {
    updatedAt?: string | null;
    matchId?: string | null;
    tournamentId?: string | null;
    organizationId?: string | null;
    dataSource?: string | null;
    controlState?: string | null;
    aliveTeams?: number | null;
    resultFinalized?: boolean | null;
    finalizedAt?: string | null;
    winnerTeamId?: string | null;
    branding?: Partial<BrandingState> | null;
  } | null;
  data: T;
};

type PostMatchOverallRow = {
  rank: number;
  previousRank: number | null;
  trend: "UP" | "DOWN" | "SAME" | null;
  teamId: string;
  teamTag: string;
  teamName: string | null;
  teamLogoUrl: string | null;
  slot?: number | null;
  matchKills: number;
  matchPoints: number;
  overallKills: number;
  placementPoints: number;
  totalPoints: number;
  totalKills: number;
  matchesPlayed: number;
  brandLight?: {
    primaryColor?: string | null;
  } | null;
  brandDark?: {
    primaryColor?: string | null;
  } | null;
};

type PostMatchOverallPayload = {
  version: "v1";
  state: {
    matchId: string;
    tournamentId?: string | null;
    scope: "TOURNAMENT" | "STAGE" | "GROUP";
    scopeId: string;
    status: string | null;
    lastUpdateIso?: string | null;
    reasons: string[];
    resultFinalized?: boolean | null;
    finalizedAt?: string | null;
  };
  header: {
    tournament?: string | null;
    stage?: string | null;
    group?: string | null;
    matchLabel?: string | null;
    map?: string | null;
  };
  rows: PostMatchOverallRow[];
};

type PostMatchPointsBreakdownRow = {
  rank: number;
  placement: number | null;
  teamId: string;
  teamTag: string | null;
  teamName: string | null;
  teamLogoUrl: string | null;
  slot?: number | null;
  kills: number;
  placementPoints: number;
  killPoints: number;
  adjustmentPoints: number;
  totalPoints: number;
  brandLight?: {
    primaryColor?: string | null;
  } | null;
  brandDark?: {
    primaryColor?: string | null;
  } | null;
};

type PostMatchPointsBreakdownPayload = {
  version: "v1";
  state: {
    matchId: string;
    tournamentId?: string | null;
    status: string | null;
    lastUpdateIso?: string | null;
    reasons: string[];
    resultFinalized?: boolean | null;
    finalizedAt?: string | null;
  };
  header: {
    tournament?: string | null;
    stage?: string | null;
    group?: string | null;
    matchLabel?: string | null;
    map?: string | null;
  };
  summary: {
    teams: number;
    placementPointsTotal: number;
    killPointsTotal: number;
    adjustmentPointsTotal: number;
    totalPointsTotal: number;
  };
  rows: PostMatchPointsBreakdownRow[];
};

type MatchResultSummaryHighlight = {
  title:
    | "Most Aggressive Team"
    | "Deadliest Player"
    | "Grenade King"
    | "Road Rage";
  name: string;
  value: number;
  kind: "team" | "player" | "event";
  detail?: string | null;
};

type MatchResultSummaryPayload = {
  version: "v2";
  state: {
    matchId: string;
    tournamentId?: string | null;
    status?: string | null;
    lastUpdateIso?: string | null;
    reasons: string[];
  };
  header: {
    tournament?: string | null;
    match?: string | null;
    map?: string | null;
  };
  stats: {
    totalKills: number | null;
    totalKnocks: number | null;
    totalDamage: number | null;
    totalAssists: number | null;
    grenadeKills: number | null;
    vehicleKills: number | null;
    matchDurationSeconds: number | null;
    totalTeams: number | null;
  } | null;
  highlights: MatchResultSummaryHighlight[];
};

type MvpPlayerPayload = {
  playerId: string | null;
  ign: string;
  photoUrl: string | null;
  teamId: string | null;
  teamName: string | null;
  teamLogo: string | null;
  kills: number;
  assists: number;
  placement: number | null;
  survivalTime: number | null;
  mvpScore: number;
};

type MvpStatePayload = {
  finalized: boolean;
  player: MvpPlayerPayload | null;
  version: number;
  show: boolean;
  matchStatus: string | null;
};

type TopFraggerStatePayload = {
  matchId: string;
  modeLive?: string | null;
  modeFinal?: string | null;
  finalizedAt: string | null;
  auto: {
    playerId: string | null;
    kills: number;
  };
  overrideLive: {
    enabled: boolean;
    playerId: string | null;
  };
  overrideFinal: {
    enabled: boolean;
    playerId: string | null;
  };
  final: {
    playerId: string | null;
    kills: number | null;
  };
  version: number;
  updatedAt: string | null;
  active: {
    playerId: string | null;
    kills: number;
    playerName: string;
    playerPhoto: string | null;
    teamTag: string | null;
    teamLogo: string | null;
  } | null;
};

const SOCKET_URL = new URL("/realtime", API_URL).toString();
const POLL_MS = 15_000;
const STATE_POLL_MS = 4_000;
const CONTROL_POLL_MS = 4_000;
const MATCH_INTRO_DELAY_MS = 10_000;
const MATCH_INTRO_DISPLAY_MS = 6_500;
const MATCH_INTRO_EXIT_MS = 700;
const DEFAULT_TEAM_LOGO_URL = "/assets/defaults/default-team.png";
const DEFAULT_PLAYER_PHOTO_URL = "/assets/defaults/default-player.png";
const DEFAULT_WIDGET_TEAM_NAME = "Arenzyra";
const DEFAULT_WIDGET_TEAM_TAG = "AZ";
const TRANSPARENT_PIXEL_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6XcUu0AAAAASUVORK5CYII=";
const WIDGET_APPROVAL_ERROR = "Widget approval required for this organization.";
const PREVIEW_CLOCK_BASE_MS = Date.parse("2026-03-14T00:00:00.000Z");
const PREVIEW_MATCH_STARTS_AT = new Date(
  PREVIEW_CLOCK_BASE_MS + 22 * 60 * 1000,
).toISOString();
const PREVIEW_NEXT_MATCH_STARTS_AT = new Date(
  PREVIEW_CLOCK_BASE_MS + 52 * 60 * 1000,
).toISOString();
const PREVIEW_STATE_UPDATED_AT = new Date(
  PREVIEW_CLOCK_BASE_MS - 90 * 1000,
).toISOString();

const PREVIEW_MATCH: ActiveMatchPayload = {
  id: "preview-match",
  matchId: "preview-match",
  status: "LIVE",
  liveState: "LIVE",
  matchNumber: 7,
  matchName: "Match 07",
  map: "Erangel",
  tournamentName: "Arenzyra Championship",
  tournamentLogo: null,
  sponsors: [
    {
      id: "preview-sponsor-1",
      name: "HyperFuel",
      logoUrl: null,
      tier: "Title",
      websiteUrl: null,
      rotationIntervalSeconds: 8,
    },
    {
      id: "preview-sponsor-2",
      name: "DropZone Energy",
      logoUrl: null,
      tier: "Partner",
      websiteUrl: null,
      rotationIntervalSeconds: 8,
    },
    {
      id: "preview-sponsor-3",
      name: "Aegis Phones",
      logoUrl: null,
      tier: "Tech",
      websiteUrl: null,
      rotationIntervalSeconds: 8,
    },
  ],
  stageName: "Final Day",
  startsAt: PREVIEW_MATCH_STARTS_AT,
  endedAt: null,
};

const PREVIEW_NEXT_MATCH: ActiveMatchPayload = {
  id: "preview-match-next",
  matchId: "preview-match-next",
  status: "DRAFT",
  liveState: "READY",
  matchNumber: 8,
  matchName: "Match 08",
  map: "Miramar",
  tournamentName: "Arenzyra Championship",
  tournamentLogo: null,
  sponsors: PREVIEW_MATCH.sponsors ?? [],
  stageName: "Final Day",
  startsAt: PREVIEW_NEXT_MATCH_STARTS_AT,
  endedAt: null,
};

const PREVIEW_STATE: MatchStatePayload = {
  matchId: "preview-match",
  updatedAt: PREVIEW_STATE_UPDATED_AT,
  teamsAlive: 6,
  leaderboard: [
    {
      rank: 1,
      teamId: "t1",
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
    },
    {
      rank: 2,
      teamId: "t2",
      slot: 12,
      teamName: "Nova Legacy",
      teamTag: "NVL",
      logoUrl: null,
      color: "#f59e0b",
      kills: 8,
      alivePlayers: 3,
      totalPlayers: 4,
      placement: 2,
      isEliminated: false,
    },
    {
      rank: 3,
      teamId: "t3",
      slot: 7,
      teamName: "Rogue Orbit",
      teamTag: "RGO",
      logoUrl: null,
      color: "#8b5cf6",
      kills: 6,
      alivePlayers: 2,
      totalPlayers: 4,
      placement: 3,
      isEliminated: false,
    },
    {
      rank: 4,
      teamId: "t4",
      slot: 18,
      teamName: "Titan Circle",
      teamTag: "TNC",
      logoUrl: null,
      color: "#22c55e",
      kills: 4,
      alivePlayers: 1,
      totalPlayers: 4,
      placement: 4,
      isEliminated: false,
    },
    {
      rank: 5,
      teamId: "t5",
      slot: 9,
      teamName: "Apex Horizon",
      teamTag: "APX",
      logoUrl: null,
      color: "#ef4444",
      kills: 3,
      alivePlayers: 0,
      totalPlayers: 4,
      placement: 5,
      isEliminated: true,
    },
  ],
  winner: {
    teamId: "t1",
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

const PREVIEW_POST_MATCH_OVERALL: PostMatchOverallPayload = {
  version: "v1",
  state: {
    matchId: PREVIEW_MATCH.matchId,
    tournamentId: "preview-tournament",
    scope: "TOURNAMENT",
    scopeId: "preview-tournament",
    status: "ENDED",
    lastUpdateIso: PREVIEW_STATE_UPDATED_AT,
    reasons: [],
    resultFinalized: true,
    finalizedAt: PREVIEW_STATE_UPDATED_AT,
  },
  header: {
    tournament: PREVIEW_MATCH.tournamentName,
    stage: PREVIEW_MATCH.stageName,
    group: null,
    matchLabel: formatMatchNumber(PREVIEW_MATCH.matchNumber),
    map: PREVIEW_MATCH.map,
  },
  rows: [
    {
      rank: 1,
      previousRank: 2,
      trend: "UP",
      teamId: "t1",
      teamTag: "AZ",
      teamName: "Arenzyra",
      teamLogoUrl: null,
      slot: 3,
      matchKills: 14,
      matchPoints: 29,
      overallKills: 39,
      placementPoints: 32,
      totalPoints: 71,
      totalKills: 39,
      matchesPlayed: 4,
      brandLight: { primaryColor: "#00d1ff" },
      brandDark: { primaryColor: "#082f49" },
    },
    {
      rank: 2,
      previousRank: 1,
      trend: "DOWN",
      teamId: "t2",
      teamTag: "NVL",
      teamName: "Nova Legacy",
      teamLogoUrl: null,
      slot: 12,
      matchKills: 10,
      matchPoints: 22,
      overallKills: 35,
      placementPoints: 33,
      totalPoints: 68,
      totalKills: 35,
      matchesPlayed: 4,
      brandLight: { primaryColor: "#f59e0b" },
      brandDark: { primaryColor: "#451a03" },
    },
    {
      rank: 3,
      previousRank: 3,
      trend: "SAME",
      teamId: "t3",
      teamTag: "RGO",
      teamName: "Rogue Orbit",
      teamLogoUrl: null,
      slot: 7,
      matchKills: 8,
      matchPoints: 18,
      overallKills: 30,
      placementPoints: 31,
      totalPoints: 61,
      totalKills: 30,
      matchesPlayed: 4,
      brandLight: { primaryColor: "#8b5cf6" },
      brandDark: { primaryColor: "#2e1065" },
    },
    {
      rank: 4,
      previousRank: 5,
      trend: "UP",
      teamId: "t4",
      teamTag: "TNC",
      teamName: "Titan Circle",
      teamLogoUrl: null,
      slot: 18,
      matchKills: 6,
      matchPoints: 14,
      overallKills: 24,
      placementPoints: 32,
      totalPoints: 56,
      totalKills: 24,
      matchesPlayed: 4,
      brandLight: { primaryColor: "#22c55e" },
      brandDark: { primaryColor: "#052e16" },
    },
    {
      rank: 5,
      previousRank: 4,
      trend: "DOWN",
      teamId: "t5",
      teamTag: "APX",
      teamName: "Apex Horizon",
      teamLogoUrl: null,
      slot: 9,
      matchKills: 4,
      matchPoints: 10,
      overallKills: 20,
      placementPoints: 30,
      totalPoints: 50,
      totalKills: 20,
      matchesPlayed: 4,
      brandLight: { primaryColor: "#ef4444" },
      brandDark: { primaryColor: "#450a0a" },
    },
    {
      rank: 6,
      previousRank: 6,
      trend: "SAME",
      teamId: "t8",
      teamTag: "TMP",
      teamName: "Tempest Force",
      teamLogoUrl: null,
      slot: 1,
      matchKills: 3,
      matchPoints: 7,
      overallKills: 16,
      placementPoints: 27,
      totalPoints: 43,
      totalKills: 16,
      matchesPlayed: 4,
      brandLight: { primaryColor: "#38bdf8" },
      brandDark: { primaryColor: "#0f172a" },
    },
  ],
};

const PREVIEW_POST_MATCH_POINTS_BREAKDOWN: PostMatchPointsBreakdownPayload = {
  version: "v1",
  state: {
    matchId: PREVIEW_MATCH.matchId,
    tournamentId: "preview-tournament",
    status: "ENDED",
    lastUpdateIso: PREVIEW_STATE_UPDATED_AT,
    reasons: [],
    resultFinalized: true,
    finalizedAt: PREVIEW_STATE_UPDATED_AT,
  },
  header: {
    tournament: PREVIEW_MATCH.tournamentName,
    stage: PREVIEW_MATCH.stageName,
    group: null,
    matchLabel: formatMatchNumber(PREVIEW_MATCH.matchNumber),
    map: PREVIEW_MATCH.map,
  },
  summary: {
    teams: 6,
    placementPointsTotal: 55,
    killPointsTotal: 45,
    adjustmentPointsTotal: 1,
    totalPointsTotal: 101,
  },
  rows: [
    {
      rank: 1,
      placement: 1,
      teamId: "t1",
      teamTag: "AZ",
      teamName: "Arenzyra",
      teamLogoUrl: null,
      slot: 3,
      kills: 14,
      placementPoints: 15,
      killPoints: 14,
      adjustmentPoints: 0,
      totalPoints: 29,
      brandLight: { primaryColor: "#00d1ff" },
      brandDark: { primaryColor: "#082f49" },
    },
    {
      rank: 2,
      placement: 2,
      teamId: "t2",
      teamTag: "NVL",
      teamName: "Nova Legacy",
      teamLogoUrl: null,
      slot: 12,
      kills: 10,
      placementPoints: 12,
      killPoints: 10,
      adjustmentPoints: 0,
      totalPoints: 22,
      brandLight: { primaryColor: "#f59e0b" },
      brandDark: { primaryColor: "#451a03" },
    },
    {
      rank: 3,
      placement: 3,
      teamId: "t3",
      teamTag: "RGO",
      teamName: "Rogue Orbit",
      teamLogoUrl: null,
      slot: 7,
      kills: 8,
      placementPoints: 10,
      killPoints: 8,
      adjustmentPoints: 0,
      totalPoints: 18,
      brandLight: { primaryColor: "#8b5cf6" },
      brandDark: { primaryColor: "#2e1065" },
    },
    {
      rank: 4,
      placement: 5,
      teamId: "t5",
      teamTag: "APX",
      teamName: "Apex Horizon",
      teamLogoUrl: null,
      slot: 9,
      kills: 10,
      placementPoints: 6,
      killPoints: 10,
      adjustmentPoints: 1,
      totalPoints: 17,
      brandLight: { primaryColor: "#ef4444" },
      brandDark: { primaryColor: "#450a0a" },
    },
    {
      rank: 5,
      placement: 4,
      teamId: "t4",
      teamTag: "TNC",
      teamName: "Titan Circle",
      teamLogoUrl: null,
      slot: 18,
      kills: 6,
      placementPoints: 8,
      killPoints: 6,
      adjustmentPoints: 0,
      totalPoints: 14,
      brandLight: { primaryColor: "#22c55e" },
      brandDark: { primaryColor: "#052e16" },
    },
    {
      rank: 6,
      placement: 6,
      teamId: "t8",
      teamTag: "TMP",
      teamName: "Tempest Force",
      teamLogoUrl: null,
      slot: 1,
      kills: 4,
      placementPoints: 4,
      killPoints: 4,
      adjustmentPoints: 0,
      totalPoints: 8,
      brandLight: { primaryColor: "#38bdf8" },
      brandDark: { primaryColor: "#0f172a" },
    },
  ],
};

const PREVIEW_MATCH_RESULT_SUMMARY: MatchResultSummaryPayload = {
  version: "v2",
  state: {
    matchId: PREVIEW_MATCH.matchId,
    tournamentId: "preview-tournament",
    status: "LIVE",
    lastUpdateIso: PREVIEW_STATE_UPDATED_AT,
    reasons: [],
  },
  header: {
    tournament: PREVIEW_MATCH.tournamentName,
    match: formatMatchNumber(PREVIEW_MATCH.matchNumber),
    map: PREVIEW_MATCH.map,
  },
  stats: {
    totalKills: 72,
    totalKnocks: 109,
    totalDamage: 18460,
    totalAssists: 58,
    grenadeKills: 6,
    vehicleKills: 2,
    matchDurationSeconds: 1968,
    totalTeams: 16,
  },
  highlights: [
    {
      title: "Most Aggressive Team",
      name: "Arenzyra",
      value: 14,
      kind: "team",
      detail: "Kills",
    },
    {
      title: "Deadliest Player",
      name: "Aster",
      value: 7,
      kind: "player",
      detail: "Kills",
    },
    {
      title: "Grenade King",
      name: "NovaRex",
      value: 3,
      kind: "player",
      detail: "Grenade Kills",
    },
  ],
};

const PREVIEW_MVP_STATE: MvpStatePayload = {
  finalized: true,
  player: {
    playerId: "preview-mvp-player",
    ign: "Falcon Ace",
    photoUrl: null,
    teamId: "t1",
    teamName: "Arenzyra",
    teamLogo: null,
    kills: 9,
    assists: 4,
    placement: 1,
    survivalTime: null,
    mvpScore: 62,
  },
  version: 1,
  show: false,
  matchStatus: "ENDED",
};

const PREVIEW_TOP_FRAGGER_STATE: TopFraggerStatePayload = {
  matchId: PREVIEW_MATCH.matchId,
  modeLive: "AUTO",
  modeFinal: "AUTO",
  finalizedAt: PREVIEW_STATE_UPDATED_AT,
  auto: {
    playerId: "preview-top-fragger",
    kills: 11,
  },
  overrideLive: {
    enabled: false,
    playerId: null,
  },
  overrideFinal: {
    enabled: false,
    playerId: null,
  },
  final: {
    playerId: "preview-top-fragger",
    kills: 11,
  },
  version: 1,
  updatedAt: PREVIEW_STATE_UPDATED_AT,
  active: {
    playerId: "preview-top-fragger",
    kills: 11,
    playerName: "Nova Clutch",
    playerPhoto: null,
    teamTag: "NVL",
    teamLogo: null,
  },
};

const PREVIEW_SLOTS: MatchSlotPayload[] = [
  {
    id: "slot-1",
    matchId: PREVIEW_MATCH.matchId,
    slotNumber: 1,
    teamId: "t8",
    lobbyStatus: "READY",
    playersInLobby: 4,
    attendanceStatus: null,
    team: {
      id: "t8",
      name: "Tempest Force",
      tag: "TMP",
      logoUrl: null,
      accentLight: "#38bdf8",
      accentDark: "#0f172a",
    },
  },
  {
    id: "slot-2",
    matchId: PREVIEW_MATCH.matchId,
    slotNumber: 2,
    teamId: "t6",
    lobbyStatus: "READY",
    playersInLobby: 4,
    attendanceStatus: null,
    team: {
      id: "t6",
      name: "Lunar Wolves",
      tag: "LNW",
      logoUrl: null,
      accentLight: "#14b8a6",
      accentDark: "#052e2b",
    },
  },
  {
    id: "slot-3",
    matchId: PREVIEW_MATCH.matchId,
    slotNumber: 3,
    teamId: "t1",
    lobbyStatus: "READY",
    playersInLobby: 4,
    attendanceStatus: null,
    team: {
      id: "t1",
      name: "Arenzyra",
      tag: "AZ",
      logoUrl: null,
      accentLight: "#00d1ff",
      accentDark: "#082f49",
    },
  },
  {
    id: "slot-4",
    matchId: PREVIEW_MATCH.matchId,
    slotNumber: 4,
    teamId: "t9",
    lobbyStatus: "READY",
    playersInLobby: 4,
    attendanceStatus: null,
    team: {
      id: "t9",
      name: "Circuit Breakers",
      tag: "CBR",
      logoUrl: null,
      accentLight: "#f97316",
      accentDark: "#431407",
    },
  },
  {
    id: "slot-5",
    matchId: PREVIEW_MATCH.matchId,
    slotNumber: 5,
    teamId: "t10",
    lobbyStatus: "CHECKING",
    playersInLobby: 3,
    attendanceStatus: null,
    team: {
      id: "t10",
      name: "Night Shift",
      tag: "NST",
      logoUrl: null,
      accentLight: "#e879f9",
      accentDark: "#3b0764",
    },
  },
  {
    id: "slot-6",
    matchId: PREVIEW_MATCH.matchId,
    slotNumber: 6,
    teamId: "t11",
    lobbyStatus: "READY",
    playersInLobby: 4,
    attendanceStatus: null,
    team: {
      id: "t11",
      name: "Echo Unit",
      tag: "ECH",
      logoUrl: null,
      accentLight: "#f43f5e",
      accentDark: "#4c0519",
    },
  },
  {
    id: "slot-7",
    matchId: PREVIEW_MATCH.matchId,
    slotNumber: 7,
    teamId: "t3",
    lobbyStatus: "READY",
    playersInLobby: 4,
    attendanceStatus: null,
    team: {
      id: "t3",
      name: "Rogue Orbit",
      tag: "RGO",
      logoUrl: null,
      accentLight: "#8b5cf6",
      accentDark: "#2e1065",
    },
  },
  {
    id: "slot-8",
    matchId: PREVIEW_MATCH.matchId,
    slotNumber: 8,
    teamId: "t12",
    lobbyStatus: "READY",
    playersInLobby: 4,
    attendanceStatus: null,
    team: {
      id: "t12",
      name: "Atlas Core",
      tag: "ATC",
      logoUrl: null,
      accentLight: "#facc15",
      accentDark: "#422006",
    },
  },
  {
    id: "slot-9",
    matchId: PREVIEW_MATCH.matchId,
    slotNumber: 9,
    teamId: "t5",
    lobbyStatus: "READY",
    playersInLobby: 4,
    attendanceStatus: null,
    team: {
      id: "t5",
      name: "Apex Horizon",
      tag: "APX",
      logoUrl: null,
      accentLight: "#ef4444",
      accentDark: "#450a0a",
    },
  },
  {
    id: "slot-10",
    matchId: PREVIEW_MATCH.matchId,
    slotNumber: 10,
    teamId: "t13",
    lobbyStatus: "CHECKING",
    playersInLobby: 2,
    attendanceStatus: null,
    team: {
      id: "t13",
      name: "Solar Tide",
      tag: "SLR",
      logoUrl: null,
      accentLight: "#84cc16",
      accentDark: "#1a2e05",
    },
  },
  {
    id: "slot-11",
    matchId: PREVIEW_MATCH.matchId,
    slotNumber: 11,
    teamId: "t14",
    lobbyStatus: "READY",
    playersInLobby: 4,
    attendanceStatus: null,
    team: {
      id: "t14",
      name: "Zenith Crew",
      tag: "ZTH",
      logoUrl: null,
      accentLight: "#22c55e",
      accentDark: "#052e16",
    },
  },
  {
    id: "slot-12",
    matchId: PREVIEW_MATCH.matchId,
    slotNumber: 12,
    teamId: "t2",
    lobbyStatus: "READY",
    playersInLobby: 4,
    attendanceStatus: null,
    team: {
      id: "t2",
      name: "Nova Legacy",
      tag: "NVL",
      logoUrl: null,
      accentLight: "#f59e0b",
      accentDark: "#451a03",
    },
  },
  {
    id: "slot-13",
    matchId: PREVIEW_MATCH.matchId,
    slotNumber: 13,
    teamId: "t15",
    lobbyStatus: "OFFLINE",
    playersInLobby: 0,
    attendanceStatus: "MISSED",
    team: {
      id: "t15",
      name: "Vector Pulse",
      tag: "VPL",
      logoUrl: null,
      accentLight: "#06b6d4",
      accentDark: "#083344",
    },
  },
  {
    id: "slot-14",
    matchId: PREVIEW_MATCH.matchId,
    slotNumber: 14,
    teamId: "t4",
    lobbyStatus: "READY",
    playersInLobby: 4,
    attendanceStatus: null,
    team: {
      id: "t4",
      name: "Titan Circle",
      tag: "TNC",
      logoUrl: null,
      accentLight: "#22c55e",
      accentDark: "#052e16",
    },
  },
  {
    id: "slot-15",
    matchId: PREVIEW_MATCH.matchId,
    slotNumber: 15,
    teamId: "t16",
    lobbyStatus: "READY",
    playersInLobby: 4,
    attendanceStatus: null,
    team: {
      id: "t16",
      name: "Blue Ember",
      tag: "BLE",
      logoUrl: null,
      accentLight: "#60a5fa",
      accentDark: "#172554",
    },
  },
  {
    id: "slot-16",
    matchId: PREVIEW_MATCH.matchId,
    slotNumber: 16,
    teamId: "t17",
    lobbyStatus: "CHECKING",
    playersInLobby: 1,
    attendanceStatus: null,
    team: {
      id: "t17",
      name: "Northwind",
      tag: "NWD",
      logoUrl: null,
      accentLight: "#a78bfa",
      accentDark: "#312e81",
    },
  },
];

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

function formatMatchNumber(value: number | string | null) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `Match ${value.toString().padStart(2, "0")}`;
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return "TBD";
}

function formatSlot(slot: number | null | undefined) {
  if (!Number.isFinite(slot ?? NaN)) return "--";
  return `S${String(slot).padStart(2, "0")}`;
}

function formatTeamLabel(
  tag: string | null | undefined,
  name: string | null | undefined,
  slot?: number | null,
) {
  if (tag?.trim()) return tag.trim();
  if (
    typeof name === "string" &&
    name.startsWith("[LIVE] ") &&
    Number.isFinite(slot ?? NaN)
  ) {
    return DEFAULT_WIDGET_TEAM_TAG;
  }
  if (name?.trim()) return name.trim();
  return DEFAULT_WIDGET_TEAM_TAG;
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function toDateMs(value: string | null | undefined) {
  if (!value) return Number.NaN;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function formatStatus(status: string | null | undefined) {
  if (!status) return "Waiting";
  return status.replace(/_/g, " ");
}

function getOrganizerPreviewStatusLabel(match: ActiveMatchPayload | null) {
  return formatStatus(match?.status ?? match?.liveState ?? "ready");
}

function getOrganizerRuntimeStatusLabel(
  control: MatchRuntimeControlSnapshot | null,
  previewMatch?: ActiveMatchPayload | null,
) {
  if (previewMatch) {
    return getOrganizerPreviewStatusLabel(previewMatch);
  }

  return formatStatus(getControlRuntimeBadge(control));
}

function getOrganizerRuntimeLifecycleStatus(
  control: MatchRuntimeControlSnapshot | null,
  previewMatch?: ActiveMatchPayload | null,
) {
  if (previewMatch) {
    return (previewMatch.status ?? previewMatch.liveState ?? "").trim().toUpperCase() || null;
  }

  return getControlLifecycleStatus(control);
}

function formatSignedPoints(value: number | null | undefined) {
  if (!Number.isFinite(value ?? Number.NaN)) return "0";
  if ((value ?? 0) > 0) return `+${value}`;
  return String(value ?? 0);
}

function formatWholeNumber(value: number | null | undefined) {
  if (!Number.isFinite(value ?? Number.NaN)) return "--";
  return Math.round(value ?? 0).toLocaleString("en-US");
}

function formatDurationClock(seconds: number | null | undefined) {
  if (!Number.isFinite(seconds ?? Number.NaN)) return "--";
  const totalSeconds = Math.max(0, Math.round(seconds ?? 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainder = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainder
      .toString()
      .padStart(2, "0")}`;
  }

  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function formatRelativeCountdown(targetIso: string | null | undefined, nowMs: number) {
  if (!targetIso) return "TBD";
  const targetMs = new Date(targetIso).getTime();
  if (Number.isNaN(targetMs)) return "TBD";
  if (!Number.isFinite(nowMs)) return "--";

  const diffMs = Math.max(0, targetMs - nowMs);
  const totalMinutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  }
  return `${minutes}m`;
}

function formatSlotLobbyStatus(slot: MatchSlotPayload) {
  if (slot.attendanceStatus === "MISSED") return "Missed";
  return formatStatus(slot.lobbyStatus ?? "waiting");
}

function getSlotTone(slot: MatchSlotPayload, branding: BrandingState) {
  return slot.team?.accentLight ?? branding.primaryColor;
}

function sortSponsors(sponsors: ActiveMatchSponsor[] | null | undefined) {
  return [...(sponsors ?? [])].sort((left, right) => {
    const leftOrder = Number.isFinite(left.displayOrder ?? NaN)
      ? (left.displayOrder as number)
      : Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isFinite(right.displayOrder ?? NaN)
      ? (right.displayOrder as number)
      : Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return (left.name ?? "").localeCompare(right.name ?? "");
  });
}

function useWidgetClock(preview: boolean) {
  const [now, setNow] = useState<number>(
    preview ? PREVIEW_CLOCK_BASE_MS : Number.NaN,
  );

  useEffect(() => {
    const realStartMs = Date.now();
    const baseMs = preview ? PREVIEW_CLOCK_BASE_MS : realStartMs;

    const tick = () => {
      setNow(baseMs + (Date.now() - realStartMs));
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [preview]);

  return now;
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

function previewStateHasData(state: MatchStatePayload | null) {
  return !!state && (state.leaderboard.length > 0 || state.winner !== null);
}

const ORGANIZER_POST_MATCH_STATES = new Set([
  "ENDED",
  "FINISHED",
  "COMPLETED",
  "CONFIRMED",
  "POST_MATCH",
]);

function isOrganizerPostMatchState(value: string | null | undefined) {
  return ORGANIZER_POST_MATCH_STATES.has(
    (value ?? "").toString().trim().toUpperCase(),
  );
}

function isOrganizerPostMatchConfirmed(
  runtime: OrganizerWidgetRuntime,
  extraStatus?: string | null | undefined,
) {
  if (runtime.preview) return true;
  if (isControlFinalized(runtime.control) || isControlFinalizing(runtime.control)) {
    return true;
  }
  if (runtime.state?.winner) return true;
  if ((runtime.state?.teamsAlive ?? Number.POSITIVE_INFINITY) <= 1) {
    return true;
  }
  return isOrganizerPostMatchState(extraStatus);
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
    placement: row.placement ?? row.rank ?? 1,
  };
}

function isMatchStatePayload(value: unknown): value is MatchStatePayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<MatchStatePayload>;
  return (
    typeof candidate.matchId === "string" &&
    Array.isArray(candidate.leaderboard)
  );
}

function TeamLogo({
  logoUrl,
  label,
  color,
  size = 56,
}: {
  logoUrl: string | null | undefined;
  label: string;
  color: string;
  size?: number;
}) {
  const normalizedLogoUrl =
    typeof logoUrl === "string" && logoUrl.trim() === TRANSPARENT_PIXEL_DATA_URL
      ? null
      : logoUrl;
  const src = ensureApiUrl(normalizedLogoUrl ?? DEFAULT_TEAM_LOGO_URL);
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-[16px] border"
      style={{
        width: size,
        height: size,
        borderColor: alphaColor(color, 0.28),
        background: `linear-gradient(180deg, ${alphaColor(
          color,
          0.18,
        )}, ${alphaColor(darkenHexColor(color, 0.58), 0.88)})`,
        boxShadow: `0 0 24px ${alphaColor(color, 0.18)}`,
      }}
    >
      {src ? (
        <img src={src} alt={label} className="h-full w-full object-cover" />
      ) : (
        <span className="text-sm font-black uppercase tracking-[0.2em] text-white">
          {initials || DEFAULT_WIDGET_TEAM_TAG}
        </span>
      )}
    </div>
  );
}

function PlayerPortrait({
  photoUrl,
  label,
  color,
  size = 140,
}: {
  photoUrl: string | null | undefined;
  label: string;
  color: string;
  size?: number;
}) {
  const src = ensureApiUrl(photoUrl ?? DEFAULT_PLAYER_PHOTO_URL) ?? DEFAULT_PLAYER_PHOTO_URL;
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <div
      className="overflow-hidden rounded-[26px] border"
      style={{
        width: size,
        height: Math.round(size * 1.18),
        borderColor: alphaColor(color, 0.24),
        background: `linear-gradient(180deg, ${alphaColor(
          color,
          0.16,
        )}, ${alphaColor(darkenHexColor(color, 0.64), 0.92)})`,
        boxShadow: `0 0 28px ${alphaColor(color, 0.16)}`,
      }}
    >
      {src ? (
        <div
          aria-label={label}
          className="h-full w-full bg-cover bg-center bg-no-repeat"
          role="img"
          style={{ backgroundImage: `url(${src})` }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xl font-black uppercase tracking-[0.22em] text-white">
          {initials || DEFAULT_WIDGET_TEAM_TAG}
        </div>
      )}
    </div>
  );
}

function StatusPill({
  children,
  color,
}: {
  children: ReactNode;
  color: string;
}) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-white"
      style={{
        borderColor: alphaColor(color, 0.24),
        background: alphaColor(color, 0.14),
      }}
    >
      {children}
    </span>
  );
}

function IntroBrandPanel({
  label,
  subtitle,
  logoUrl,
  fallback,
  color,
  compact = false,
}: {
  label: string;
  subtitle: string;
  logoUrl: string | null | undefined;
  fallback: string;
  color: string;
  compact?: boolean;
}) {
  const src = ensureApiUrl(logoUrl ?? null);

  return (
    <div
      className={`relative overflow-hidden rounded-[24px] border ${
        compact ? "px-4 py-3" : "px-5 py-4"
      }`}
      style={{
        borderColor: alphaColor(color, 0.22),
        background: [
          `linear-gradient(135deg, ${alphaColor(color, 0.18)}, transparent 68%)`,
          `linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))`,
        ].join(", "),
        boxShadow: `0 18px 42px ${alphaColor(color, compact ? 0.1 : 0.14)}`,
      }}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background: `linear-gradient(90deg, transparent, ${alphaColor(
            color,
            0.56,
          )}, transparent)`,
        }}
      />
      <div className={compact ? "flex items-center gap-3" : "flex items-center gap-4"}>
        <div
          className={
            compact
              ? "flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[18px] border"
              : "flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-[18px] border"
          }
          style={{
            borderColor: alphaColor(color, 0.24),
            background: `linear-gradient(180deg, ${alphaColor(
              color,
              0.16,
            )}, rgba(255,255,255,0.04))`,
          }}
        >
          {src ? (
            <img
              src={src}
              alt={label}
              className="h-full w-full object-contain p-3"
            />
          ) : (
            <span className="px-3 text-center text-sm font-black uppercase tracking-[0.22em] text-white">
              {fallback}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <div className="text-[9px] font-semibold uppercase tracking-[0.3em] text-white/42">
            {subtitle}
          </div>
          <div
            className={
              compact
                ? "mt-1 truncate text-sm font-semibold uppercase tracking-[0.12em] text-white"
                : "mt-1 truncate text-base font-semibold uppercase tracking-[0.12em] text-white"
            }
          >
            {label}
          </div>
        </div>
      </div>
    </div>
  );
}

function WidgetStage({
  runtime,
  children,
  align = "center",
}: {
  runtime: OrganizerWidgetRuntime;
  children: ReactNode;
  align?: "start" | "center" | "end";
}) {
  const cssVars = buildBrandingCssVars(runtime.branding) as CSSProperties;
  const brandBackdrop = buildBrandBackdrop(runtime.branding);
  const justifyContent =
    align === "start"
      ? "flex-start"
      : align === "end"
        ? "flex-end"
        : "center";
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
          className="vx-widget-theme absolute left-0 top-0 relative flex box-border overflow-hidden px-8 py-8"
          style={{
            ...cssVars,
            width: `${WIDGET_CANVAS_WIDTH}px`,
            height: `${WIDGET_CANVAS_HEIGHT}px`,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            background: runtime.preview
              ? [
                  `radial-gradient(circle at 20% 0%, ${alphaColor(
                    runtime.branding.primaryColor,
                    0.16,
                  )}, transparent 36%)`,
                  `radial-gradient(circle at 100% 100%, ${alphaColor(
                    runtime.branding.accent,
                    0.12,
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
              : "transparent",
          }}
        >
          <style>{WIDGET_THEME_OVERRIDE_CSS}</style>
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: [
                `linear-gradient(90deg, ${alphaColor(
                  runtime.branding.primaryColor,
                  0.04,
                )} 1px, transparent 1px)`,
                `linear-gradient(180deg, ${alphaColor(
                  runtime.branding.primaryColor,
                  0.03,
                )} 1px, transparent 1px)`,
              ].join(", "),
              backgroundSize: "44px 44px, 44px 44px",
              opacity: runtime.preview ? 0.6 : 0,
            }}
          />
          <div
            className="relative flex h-full w-full box-border"
            style={{ justifyContent }}
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

const POST_MATCH_TRANSPARENT_FRAME_CSS = `
  .vx-post-match-transparent-frame :is(div, section, article)[class*="rounded-"][class*="border"]:not([class*="rounded-full"]) {
    background: var(--vx-post-card-bg) !important;
    border-color: var(--vx-post-card-border) !important;
    box-shadow: var(--vx-post-card-shadow) !important;
  }

  .vx-post-match-transparent-frame [class*="text-white/"] {
    color: var(--vx-post-muted-text) !important;
  }

  .vx-post-match-transparent-frame [class*="text-[var(--vx-muted)]"] {
    color: var(--vx-post-muted-text) !important;
  }

  .vx-post-match-transparent-frame [class*="text-[var(--vx-text)]"] {
    color: var(--vx-post-primary-text) !important;
  }
`;

function Frame({
  runtime,
  tone,
  className,
  backgroundMode = "default",
  children,
}: {
  runtime: OrganizerWidgetRuntime;
  tone: string;
  className: string;
  backgroundMode?: "default" | "transparent";
  children: ReactNode;
}) {
  const brandBackdrop = buildBrandBackdrop(runtime.branding);
  const transparentFrameVars =
    backgroundMode === "transparent"
      ? ({
          "--vx-post-card-bg": [
            `linear-gradient(135deg, ${alphaColor(tone, 0.24)} 0%, ${alphaColor(
              runtime.branding.effectiveBackground,
              0.92,
            )} 36%, ${alphaColor(
              darkenHexColor(runtime.branding.effectiveBackground, 0.1),
              0.98,
            )} 100%)`,
            `linear-gradient(90deg, ${alphaColor(
              runtime.branding.accent,
              0.1,
            )}, transparent 72%)`,
          ].join(", "),
          "--vx-post-card-border": alphaColor(tone, 0.42),
          "--vx-post-card-shadow": `0 18px 52px ${alphaColor("#000000", 0.28)}`,
          "--vx-post-primary-text": alphaColor(runtime.branding.textPrimary, 0.98),
          "--vx-post-muted-text": alphaColor(runtime.branding.textPrimary, 0.82),
          "--vx-text": alphaColor(runtime.branding.textPrimary, 0.98),
          "--vx-muted": alphaColor(runtime.branding.textPrimary, 0.82),
          "--vx-border": alphaColor(tone, 0.42),
          "--vx-bg-base": alphaColor(runtime.branding.effectiveBackground, 0.94),
        } as CSSProperties)
      : null;

  return (
    <section
      className={`relative overflow-hidden border ${backgroundMode === "default" ? "backdrop-blur-xl" : "vx-post-match-transparent-frame"} ${className}`}
      style={{
        ...(transparentFrameVars ?? {}),
        borderColor: alphaColor(tone, 0.26),
        background:
          backgroundMode === "transparent"
            ? "transparent"
            : [
                `linear-gradient(135deg, ${alphaColor(tone, 0.18)}, transparent 26%)`,
                `linear-gradient(180deg, ${alphaColor(
                  runtime.branding.effectiveBackground,
                  0.38,
                )}, ${alphaColor(
                  darkenHexColor(runtime.branding.effectiveBackground, 0.08),
                  0.58,
                )})`,
                brandBackdrop,
              ].join(", "),
        boxShadow: `0 34px 110px ${alphaColor(tone, 0.16)}`,
        clipPath:
          "polygon(24px 0, 100% 0, 100% calc(100% - 24px), calc(100% - 24px) 100%, 0 100%, 0 24px)",
      }}
    >
      {backgroundMode === "transparent" ? (
        <style>{POST_MATCH_TRANSPARENT_FRAME_CSS}</style>
      ) : null}
      {backgroundMode === "default" ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(135deg, ${alphaColor(
              tone,
              0.18,
            )}, transparent 26%)`,
          }}
        />
      ) : null}
      <div
        className="pointer-events-none absolute left-0 top-0 h-1 w-40"
        style={{ background: `linear-gradient(90deg, ${tone}, transparent)` }}
      />
      <div className="relative">{children}</div>
    </section>
  );
}

function WaitingState({
  runtime,
  title,
  subtitle,
}: {
  runtime: OrganizerWidgetRuntime;
  title: string;
  subtitle: string;
}) {
  return (
    <WidgetStage runtime={runtime} align="center">
      <Frame
        runtime={runtime}
        tone={runtime.branding.primaryColor}
        className="w-[760px] rounded-[32px] px-8 py-8 text-center"
      >
        <div className="text-[10px] font-semibold uppercase tracking-[0.34em] text-white/42">
          Arenzyra BROADCAST
        </div>
        <div className="mt-4 text-4xl font-black uppercase tracking-[0.18em] text-white">
          {title}
        </div>
        <p className="mt-4 text-sm leading-7 text-white/60">{subtitle}</p>
        {runtime.error ? (
          <div className="mt-5 rounded-2xl border border-red-400/18 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {runtime.error}
          </div>
        ) : null}
      </Frame>
    </WidgetStage>
  );
}

function useOrganizerMatchControl(
  matchId: string | null,
  options?: {
    enabled?: boolean;
    preview?: boolean;
    pollMs?: number;
    refreshToken?: number;
  },
) {
  const enabled = options?.enabled ?? true;
  const preview = options?.preview ?? false;
  const pollMs = options?.pollMs ?? CONTROL_POLL_MS;
  const refreshToken = options?.refreshToken ?? 0;
  const [control, setControl] = useState<MatchRuntimeControlSnapshot | null>(null);

  useEffect(() => {
    if (!enabled || preview || !matchId) {
      setControl(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadControl = async () => {
      try {
        const payload = await fetchMatchControlSnapshot(matchId, controller.signal);
        if (cancelled) {
          return;
        }

        setControl(payload);
      } catch {
        // Keep the last canonical /control snapshot during transient failures.
      }
    };

    void loadControl();
    const interval = window.setInterval(() => {
      void loadControl();
    }, pollMs);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [enabled, matchId, pollMs, preview, refreshToken]);

  return control;
}

function useOrganizerWidgetRuntime(
  orgSlug: string,
  widgetKey: OrganizerWidgetKey,
  options?: {
    skipActiveMatch?: boolean;
  },
): OrganizerWidgetRuntime {
  const searchParams = useSearchParams();
  const explicitMatchId = searchParams.get("matchId")?.trim() || null;
  const preview = searchParams.get("preview") === "true";

  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [widgetAccess, setWidgetAccess] = useState<WidgetAccessResponse | null>(
    null,
  );
  const [branding, setBranding] = useState<BrandingState>(
    DEFAULT_BRANDING_STATE,
  );
  const [match, setMatch] = useState<ActiveMatchPayload | null>(null);
  const [state, setState] = useState<MatchStatePayload | null>(null);
  const [status, setStatus] = useState<WidgetRuntimeStatus>(
    preview ? "ready" : "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const [realtimeRefreshToken, setRealtimeRefreshToken] = useState(0);
  const realtimeRefreshTimerRef = useRef<number | null>(null);
  const skipActiveMatch = options?.skipActiveMatch ?? false;

  useEffect(
    () => () => {
      if (realtimeRefreshTimerRef.current !== null) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    const loadAccess = async () => {
      try {
        const payload = await fetchJson<WidgetAccessResponse>(
          `${API_URL}/api/widgets/access?${new URLSearchParams({
            orgSlug,
            widgetKey,
          }).toString()}`,
        );
        if (cancelled) return;
        setWidgetAccess(payload);
        if (!payload.allowed) {
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
        if (!preview) {
          setStatus("error");
        }
      }
    };

    void loadAccess();
    const interval = window.setInterval(() => void loadAccess(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [orgSlug, preview, widgetKey]);

  const widgetAccessDenied = widgetAccess?.allowed === false;

  useEffect(() => {
    if (widgetAccessDenied) {
      setMatch(null);
      return;
    }

    let cancelled = false;

    const syncContext = async () => {
      try {
        const payload = await fetchJson<WidgetContextResponse>(
          `${API_URL}/api/organizations/${encodeURIComponent(
            orgSlug,
          )}/widget-context`,
        );
        if (cancelled) return;
        setOrganizationId(payload.organizationId ?? null);
        setBranding(buildBrandingState(payload.branding ?? {}));
        setError(null);
      } catch (nextError) {
        if (cancelled) return;
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to load widget context.",
        );
        if (!preview) {
          setStatus("error");
        }
      }
    };

    void syncContext();
    const interval = window.setInterval(() => void syncContext(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [orgSlug, preview, widgetAccessDenied]);

  useEffect(() => {
    if (skipActiveMatch) {
      setMatch(preview ? PREVIEW_MATCH : null);
      return undefined;
    }

    let cancelled = false;

    const syncActiveMatch = async () => {
      try {
        const payload = await fetchJson<ActiveMatchPayload>(
          `${API_URL}/api/organizations/${encodeURIComponent(
            orgSlug,
          )}/active-match`,
        );
        if (cancelled) return;
        setMatch(payload);
        setError(null);
        setStatus("ready");
      } catch (nextError) {
        if (cancelled) return;
        setMatch(null);
        if (!preview) {
          setStatus("waiting");
        }
        if (
          nextError instanceof Error &&
          !nextError.message.startsWith("404")
        ) {
          setError(nextError.message);
        }
      }
    };

    void syncActiveMatch();
    const interval = window.setInterval(() => void syncActiveMatch(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [orgSlug, preview, realtimeRefreshToken, skipActiveMatch]);

  const resolvedMatchId = explicitMatchId ?? match?.matchId ?? match?.id ?? null;
  const control = useOrganizerMatchControl(resolvedMatchId, {
    enabled: !widgetAccessDenied,
    preview,
    pollMs: CONTROL_POLL_MS,
    refreshToken: realtimeRefreshToken,
  });

  useEffect(() => {
    if (widgetAccessDenied) {
      setState(null);
      if (!preview) {
        setStatus("error");
      }
      return;
    }

    if (!resolvedMatchId) {
      setState(null);
      if (!preview) {
        setStatus((current) => (current === "error" ? current : "waiting"));
      }
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const syncState = async () => {
      try {
        const payload = await fetchJson<MatchStatePayload>(
          `${API_URL}/api/observer/match/${encodeURIComponent(
            resolvedMatchId,
          )}/widget-state`,
          controller.signal,
        );
        if (cancelled) return;
        setState(payload);
        setLastEventAt(payload.updatedAt ?? null);
        setError(null);
        setStatus(previewStateHasData(payload) || preview ? "ready" : "waiting");
      } catch (nextError) {
        if (cancelled || controller.signal.aborted) return;
        if (!preview) {
          setStatus("error");
        }
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to load widget state.",
        );
      }
    };

    void syncState();
    const interval = !preview
      ? window.setInterval(() => {
          void syncState();
        }, STATE_POLL_MS)
      : null;
    return () => {
      cancelled = true;
      if (interval !== null) {
        window.clearInterval(interval);
      }
      controller.abort();
    };
  }, [preview, realtimeRefreshToken, resolvedMatchId, widgetAccessDenied]);

  useEffect(() => {
    if (widgetAccessDenied) return undefined;
    if (!resolvedMatchId && !organizationId) return undefined;

    const query: Record<string, string> = {};
    if (resolvedMatchId) query.matchId = resolvedMatchId;
    if (organizationId) query.organizationId = organizationId;

    const socket = io(SOCKET_URL, {
      transports: ["websocket"],
      query,
      forceNew: true,
    });

    socket.on("match:update", (payload: unknown) => {
      if (
        !isMatchStatePayload(payload) ||
        (resolvedMatchId && payload.matchId !== resolvedMatchId)
      ) {
        return;
      }

      if (realtimeRefreshTimerRef.current !== null) {
        return;
      }

      realtimeRefreshTimerRef.current = window.setTimeout(() => {
        realtimeRefreshTimerRef.current = null;
        setRealtimeRefreshToken((current) => current + 1);
      }, 500);
    });

    socket.on("match:winner", (winner: WinnerEventPayload) => {
      if (resolvedMatchId && winner.matchId !== resolvedMatchId) {
        return;
      }

      if (realtimeRefreshTimerRef.current !== null) {
        return;
      }

      realtimeRefreshTimerRef.current = window.setTimeout(() => {
        realtimeRefreshTimerRef.current = null;
        setRealtimeRefreshToken((current) => current + 1);
      }, 500);
    });

    socket.on(
      "organization:branding-updated",
      (payload: BrandingEventPayload) => {
        setBranding(buildBrandingState(payload.branding ?? {}));
      },
    );

    socket.on("connect_error", (nextError: Error) => {
      if (!preview) {
        setError(nextError.message || "Realtime connection failed.");
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [
    organizationId,
    preview,
    resolvedMatchId,
    widgetAccessDenied,
  ]);

  const usingPreviewData =
    preview && !widgetAccessDenied && !match && !previewStateHasData(state);

  return useMemo(
    () => ({
      widgetKey,
      preview,
      status,
      organizationId,
      matchId: resolvedMatchId,
      branding,
      match: usingPreviewData ? PREVIEW_MATCH : match,
      control: usingPreviewData ? null : control,
      state: usingPreviewData ? PREVIEW_STATE : state,
      lastEventAt,
      error,
      usingPreviewData,
      widgetAccessDenied,
      widgetApprovalEnforced: widgetAccess?.enforced ?? false,
      widgetApproval: widgetAccess?.approval ?? null,
    }),
    [
      widgetKey,
      preview,
      status,
      organizationId,
      resolvedMatchId,
      branding,
      usingPreviewData,
      match,
      control,
      state,
      lastEventAt,
      error,
      widgetAccessDenied,
      widgetAccess?.enforced,
      widgetAccess?.approval,
    ],
  );
}

function useOrganizerMatchSlots(runtime: OrganizerWidgetRuntime) {
  const resolvedMatchId = runtime.match?.matchId ?? runtime.matchId ?? null;
  const [remoteSlots, setRemoteSlots] = useState<{
    matchId: string;
    slots: MatchSlotPayload[];
  } | null>(null);
  const [status, setStatus] = useState<WidgetRuntimeStatus>(
    runtime.preview ? "ready" : "waiting",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!resolvedMatchId) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadSlots = async () => {
      try {
        const payload = await fetchJson<{ slots: MatchSlotPayload[] }>(
          `${API_URL}/api/observer/match/${encodeURIComponent(resolvedMatchId)}/slots`,
          controller.signal,
        );
        if (cancelled) return;
        setRemoteSlots({
          matchId: resolvedMatchId,
          slots: (payload.slots ?? []).slice().sort((left, right) => left.slotNumber - right.slotNumber),
        });
        setStatus("ready");
        setError(null);
      } catch (nextError) {
        if (cancelled || controller.signal.aborted) return;
        setStatus(runtime.preview ? "ready" : "error");
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to load match slots.",
        );
      }
    };

    void loadSlots();
    const interval = window.setInterval(() => {
      void loadSlots();
    }, POLL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [resolvedMatchId, runtime.preview]);

  const slots =
    resolvedMatchId && remoteSlots?.matchId === resolvedMatchId
      ? remoteSlots.slots
      : runtime.preview
        ? PREVIEW_SLOTS
        : [];

  return {
    slots,
    status: runtime.preview && slots.length > 0 ? "ready" : status,
    error,
  };
}

function useOrganizerNextMatch(orgSlug: string, preview: boolean) {
  const [nextMatch, setNextMatch] = useState<ActiveMatchPayload | null>(
    preview ? PREVIEW_NEXT_MATCH : null,
  );
  const [status, setStatus] = useState<WidgetRuntimeStatus>(
    preview ? "ready" : "loading",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const loadNextMatch = async () => {
      try {
        const payload = await fetchJson<ActiveMatchPayload>(
          `${API_URL}/api/organizations/${encodeURIComponent(orgSlug)}/next-match`,
          controller.signal,
        );
        if (cancelled) return;
        setNextMatch(payload);
        setStatus("ready");
        setError(null);
      } catch (nextError) {
        if (cancelled || controller.signal.aborted) return;
        setNextMatch(preview ? PREVIEW_NEXT_MATCH : null);
        setStatus(preview ? "ready" : "waiting");
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to load next match.",
        );
      }
    };

    void loadNextMatch();
    const interval = window.setInterval(() => {
      void loadNextMatch();
    }, POLL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [orgSlug, preview]);

  return { match: nextMatch, status, error };
}

function useOrganizerLatestFinishedMatch(
  orgSlug: string,
  runtime: OrganizerWidgetRuntime,
) {
  const [resolvedMatch, setResolvedMatch] = useState<ActiveMatchPayload | null>(
    runtime.preview ? PREVIEW_MATCH : null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (runtime.preview) {
      setResolvedMatch(PREVIEW_MATCH);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadLatestFinishedMatch = async () => {
      if (runtime.widgetAccessDenied) {
        if (cancelled) return;
        setResolvedMatch(null);
        setError(null);
        return;
      }

      try {
        const nextMatch = await fetchJson<ActiveMatchPayload>(
          `${API_URL}/api/organizations/${encodeURIComponent(
            orgSlug,
          )}/latest-finished-match`,
          controller.signal,
        );
        if (cancelled) return;
        setResolvedMatch(nextMatch);
        setError(null);
      } catch (nextError) {
        if (cancelled || controller.signal.aborted) return;
        setResolvedMatch(null);
        if (
          nextError instanceof Error &&
          !nextError.message.startsWith("404")
        ) {
          setError(nextError.message);
        } else {
          setError(null);
        }
      }
    };

    void loadLatestFinishedMatch();
    const interval = window.setInterval(() => {
      void loadLatestFinishedMatch();
    }, POLL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [orgSlug, runtime.preview, runtime.widgetAccessDenied]);

  return {
    match: resolvedMatch,
    error,
  };
}

function useOrganizerPostMatchOverall(
  orgSlug: string,
  runtime: OrganizerWidgetRuntime,
) {
  const [resolvedMatch, setResolvedMatch] = useState<ActiveMatchPayload | null>(
    runtime.preview ? PREVIEW_MATCH : null,
  );
  const [payload, setPayload] = useState<PostMatchOverallPayload | null>(
    runtime.preview ? PREVIEW_POST_MATCH_OVERALL : null,
  );
  const [status, setStatus] = useState<WidgetRuntimeStatus>(
    runtime.preview ? "ready" : "waiting",
  );
  const [error, setError] = useState<string | null>(null);
  const resolvedMatchId = resolvedMatch?.matchId ?? null;

  useEffect(() => {
    if (runtime.preview) {
      setResolvedMatch(PREVIEW_MATCH);
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadLatestFinishedMatch = async () => {
      if (runtime.widgetAccessDenied) {
        if (cancelled) return;
        setResolvedMatch(null);
        return;
      }

      try {
        const nextMatch = await fetchJson<ActiveMatchPayload>(
          `${API_URL}/api/organizations/${encodeURIComponent(
            orgSlug,
          )}/latest-finished-match`,
          controller.signal,
        );
        if (cancelled) return;
        setResolvedMatch(nextMatch);
      } catch (nextError) {
        if (cancelled || controller.signal.aborted) return;
        setResolvedMatch(null);
        if (
          nextError instanceof Error &&
          !nextError.message.startsWith("404")
        ) {
          setError(nextError.message);
          setStatus("error");
        }
      }
    };

    void loadLatestFinishedMatch();
    const interval = window.setInterval(() => {
      void loadLatestFinishedMatch();
    }, POLL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [orgSlug, runtime.preview, runtime.widgetAccessDenied]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const previewPayload = runtime.preview ? PREVIEW_POST_MATCH_OVERALL : null;

    const loadPostMatchOverall = async () => {
      if (runtime.widgetAccessDenied) {
        if (cancelled) return;
        setPayload(previewPayload);
        setStatus(runtime.preview ? "ready" : "error");
        setError(WIDGET_APPROVAL_ERROR);
        return;
      }

      if (!resolvedMatchId) {
        if (cancelled) return;
        setPayload(previewPayload);
        setStatus(runtime.preview ? "ready" : "waiting");
        setError(null);
        return;
      }

      try {
        const query = new URLSearchParams({ matchId: resolvedMatchId });
        if (runtime.organizationId) {
          query.set("organizationId", runtime.organizationId);
        }

        const response = await fetchJson<WidgetEnvelope<PostMatchOverallPayload>>(
          `${API_URL}/widgets/post-match-overall-ranking?${query.toString()}`,
          controller.signal,
        );

        if (cancelled) return;

        const nextPayload = response.data;
        setPayload(nextPayload);
        setStatus(nextPayload.rows.length > 0 || runtime.preview ? "ready" : "waiting");
        setError(null);
      } catch (nextError) {
        if (cancelled || controller.signal.aborted) return;
        setPayload(previewPayload);
        setStatus(runtime.preview ? "ready" : "error");
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to load post-match standings.",
        );
      }
    };

    void loadPostMatchOverall();
    const interval =
      !runtime.preview && !runtime.widgetAccessDenied && resolvedMatchId
        ? window.setInterval(() => {
            void loadPostMatchOverall();
          }, POLL_MS)
        : null;

    return () => {
      cancelled = true;
      controller.abort();
      if (interval !== null) {
        window.clearInterval(interval);
      }
    };
  }, [
    resolvedMatchId,
    runtime.organizationId,
    runtime.preview,
    runtime.widgetAccessDenied,
  ]);

  return {
    match: resolvedMatch,
    payload: payload ?? (runtime.preview ? PREVIEW_POST_MATCH_OVERALL : null),
    status,
    error,
  };
}

function useOrganizerPostMatchPointsBreakdown(
  orgSlug: string,
  runtime: OrganizerWidgetRuntime,
) {
  const [resolvedMatch, setResolvedMatch] = useState<ActiveMatchPayload | null>(
    runtime.preview ? PREVIEW_MATCH : null,
  );
  const [payload, setPayload] = useState<PostMatchPointsBreakdownPayload | null>(
    runtime.preview ? PREVIEW_POST_MATCH_POINTS_BREAKDOWN : null,
  );
  const [status, setStatus] = useState<WidgetRuntimeStatus>(
    runtime.preview ? "ready" : "waiting",
  );
  const [error, setError] = useState<string | null>(null);
  const resolvedMatchId = resolvedMatch?.matchId ?? null;

  useEffect(() => {
    if (runtime.preview) {
      setResolvedMatch(PREVIEW_MATCH);
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadLatestFinishedMatch = async () => {
      if (runtime.widgetAccessDenied) {
        if (cancelled) return;
        setResolvedMatch(null);
        return;
      }

      try {
        const nextMatch = await fetchJson<ActiveMatchPayload>(
          `${API_URL}/api/organizations/${encodeURIComponent(
            orgSlug,
          )}/latest-finished-match`,
          controller.signal,
        );
        if (cancelled) return;
        setResolvedMatch(nextMatch);
      } catch (nextError) {
        if (cancelled || controller.signal.aborted) return;
        setResolvedMatch(null);
        if (
          nextError instanceof Error &&
          !nextError.message.startsWith("404")
        ) {
          setError(nextError.message);
          setStatus("error");
        }
      }
    };

    void loadLatestFinishedMatch();
    const interval = window.setInterval(() => {
      void loadLatestFinishedMatch();
    }, POLL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [orgSlug, runtime.preview, runtime.widgetAccessDenied]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const previewPayload = runtime.preview ? PREVIEW_POST_MATCH_POINTS_BREAKDOWN : null;

    const loadPointsBreakdown = async () => {
      if (runtime.widgetAccessDenied) {
        if (cancelled) return;
        setPayload(previewPayload);
        setStatus(runtime.preview ? "ready" : "error");
        setError(WIDGET_APPROVAL_ERROR);
        return;
      }

      if (!resolvedMatchId) {
        if (cancelled) return;
        setPayload(previewPayload);
        setStatus(runtime.preview ? "ready" : "waiting");
        setError(null);
        return;
      }

      try {
        const query = new URLSearchParams({ matchId: resolvedMatchId });
        if (runtime.organizationId) {
          query.set("organizationId", runtime.organizationId);
        }

        const response = await fetchJson<
          WidgetEnvelope<PostMatchPointsBreakdownPayload>
        >(
          `${API_URL}/widgets/post-match-points-breakdown?${query.toString()}`,
          controller.signal,
        );

        if (cancelled) return;

        const nextPayload = response.data;
        setPayload(nextPayload);
        setStatus(nextPayload.rows.length > 0 || runtime.preview ? "ready" : "waiting");
        setError(null);
      } catch (nextError) {
        if (cancelled || controller.signal.aborted) return;
        setPayload(previewPayload);
        setStatus(runtime.preview ? "ready" : "error");
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to load points breakdown.",
        );
      }
    };

    void loadPointsBreakdown();
    const interval =
      !runtime.preview && !runtime.widgetAccessDenied && resolvedMatchId
        ? window.setInterval(() => {
            void loadPointsBreakdown();
          }, POLL_MS)
        : null;

    return () => {
      cancelled = true;
      controller.abort();
      if (interval !== null) {
        window.clearInterval(interval);
      }
    };
  }, [
    resolvedMatchId,
    runtime.organizationId,
    runtime.preview,
    runtime.widgetAccessDenied,
  ]);

  return {
    match: resolvedMatch,
    payload:
      payload ?? (runtime.preview ? PREVIEW_POST_MATCH_POINTS_BREAKDOWN : null),
    status,
    error,
  };
}

function useOrganizerMatchResultSummary(
  orgSlug: string,
  runtime: OrganizerWidgetRuntime,
) {
  const [resolvedMatch, setResolvedMatch] = useState<ActiveMatchPayload | null>(
    runtime.preview ? PREVIEW_MATCH : null,
  );
  const [payload, setPayload] = useState<MatchResultSummaryPayload | null>(
    runtime.preview ? PREVIEW_MATCH_RESULT_SUMMARY : null,
  );
  const [status, setStatus] = useState<WidgetRuntimeStatus>(
    runtime.preview ? "ready" : "waiting",
  );
  const [error, setError] = useState<string | null>(null);
  const resolvedMatchId = resolvedMatch?.matchId ?? null;

  useEffect(() => {
    if (runtime.preview) {
      setResolvedMatch(PREVIEW_MATCH);
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadLatestFinishedMatch = async () => {
      if (runtime.widgetAccessDenied) {
        if (cancelled) return;
        setResolvedMatch(null);
        return;
      }

      try {
        const nextMatch = await fetchJson<ActiveMatchPayload>(
          `${API_URL}/api/organizations/${encodeURIComponent(
            orgSlug,
          )}/latest-finished-match`,
          controller.signal,
        );
        if (cancelled) return;
        setResolvedMatch(nextMatch);
      } catch (nextError) {
        if (cancelled || controller.signal.aborted) return;
        setResolvedMatch(null);
        if (
          nextError instanceof Error &&
          !nextError.message.startsWith("404")
        ) {
          setError(nextError.message);
          setStatus("error");
        }
      }
    };

    void loadLatestFinishedMatch();
    const interval = window.setInterval(() => {
      void loadLatestFinishedMatch();
    }, POLL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [orgSlug, runtime.preview, runtime.widgetAccessDenied]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const previewPayload = runtime.preview ? PREVIEW_MATCH_RESULT_SUMMARY : null;

    const loadMatchSummary = async () => {
      if (runtime.preview) {
        if (cancelled) return;
        setPayload(previewPayload);
        setStatus("ready");
        setError(null);
        return;
      }

      if (runtime.widgetAccessDenied) {
        if (cancelled) return;
        setPayload(previewPayload);
        setStatus(runtime.preview ? "ready" : "error");
        setError(WIDGET_APPROVAL_ERROR);
        return;
      }

      if (!resolvedMatchId) {
        if (cancelled) return;
        setPayload(previewPayload);
        setStatus(runtime.preview ? "ready" : "waiting");
        setError(null);
        return;
      }

      try {
        const response = await fetchJson<WidgetEnvelope<MatchResultSummaryPayload>>(
          `${API_URL}/widgets/match-result-summary?${new URLSearchParams({
            matchId: resolvedMatchId,
          }).toString()}`,
          controller.signal,
        );

        if (cancelled) return;

        const nextPayload = response.data;
        setPayload(nextPayload);
        setStatus(nextPayload.stats || runtime.preview ? "ready" : "waiting");
        setError(null);
      } catch (nextError) {
        if (cancelled || controller.signal.aborted) return;
        setPayload(previewPayload);
        setStatus(runtime.preview ? "ready" : "error");
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to load match summary.",
        );
      }
    };

    void loadMatchSummary();
    const interval =
      !runtime.preview && !runtime.widgetAccessDenied && resolvedMatchId
        ? window.setInterval(() => {
            void loadMatchSummary();
          }, POLL_MS)
        : null;

    return () => {
      cancelled = true;
      controller.abort();
      if (interval !== null) {
        window.clearInterval(interval);
      }
    };
  }, [resolvedMatchId, runtime.preview, runtime.widgetAccessDenied]);

  return {
    payload: payload ?? (runtime.preview ? PREVIEW_MATCH_RESULT_SUMMARY : null),
    match: resolvedMatch,
    status,
    error,
  };
}

function useOrganizerMvpState(
  runtime: OrganizerWidgetRuntime,
  resolvedMatchIdOverride?: string | null,
) {
  const resolvedMatchId =
    resolvedMatchIdOverride ?? runtime.match?.matchId ?? runtime.matchId ?? null;
  const [payload, setPayload] = useState<MvpStatePayload | null>(
    runtime.preview ? PREVIEW_MVP_STATE : null,
  );
  const [status, setStatus] = useState<WidgetRuntimeStatus>(
    runtime.preview ? "ready" : "waiting",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (runtime.preview) {
      setPayload(PREVIEW_MVP_STATE);
      setStatus("ready");
      setError(null);
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadMvp = async () => {
      if (runtime.widgetAccessDenied) {
        if (cancelled) return;
        setPayload(null);
        setStatus("error");
        setError(WIDGET_APPROVAL_ERROR);
        return;
      }

      if (!resolvedMatchId) {
        if (cancelled) return;
        setPayload(null);
        setStatus("waiting");
        setError(null);
        return;
      }

      try {
        const query = new URLSearchParams({ matchId: resolvedMatchId });
        if (runtime.organizationId) {
          query.set("organizationId", runtime.organizationId);
        }

        const nextPayload = await fetchJson<MvpStatePayload>(
          `${API_URL}/widgets/mvp/state/current?${query.toString()}`,
          controller.signal,
        );
        if (cancelled) return;
        setPayload(nextPayload);
        setStatus(nextPayload.player ? "ready" : "waiting");
        setError(null);
      } catch (nextError) {
        if (cancelled || controller.signal.aborted) return;
        setPayload(null);
        setStatus("error");
        setError(
          nextError instanceof Error ? nextError.message : "Unable to load MVP state.",
        );
      }
    };

    void loadMvp();
    const interval =
      !runtime.widgetAccessDenied && resolvedMatchId
        ? window.setInterval(() => {
            void loadMvp();
          }, POLL_MS)
        : null;

    return () => {
      cancelled = true;
      controller.abort();
      if (interval !== null) {
        window.clearInterval(interval);
      }
    };
  }, [
    resolvedMatchId,
    runtime.organizationId,
    runtime.preview,
    runtime.widgetAccessDenied,
  ]);

  return {
    payload: payload ?? (runtime.preview ? PREVIEW_MVP_STATE : null),
    status,
    error,
  };
}

function useOrganizerTopFraggerState(
  runtime: OrganizerWidgetRuntime,
  resolvedMatchIdOverride?: string | null,
) {
  const resolvedMatchId =
    resolvedMatchIdOverride ?? runtime.match?.matchId ?? runtime.matchId ?? null;
  const [payload, setPayload] = useState<TopFraggerStatePayload | null>(
    runtime.preview ? PREVIEW_TOP_FRAGGER_STATE : null,
  );
  const [status, setStatus] = useState<WidgetRuntimeStatus>(
    runtime.preview ? "ready" : "waiting",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (runtime.preview) {
      setPayload(PREVIEW_TOP_FRAGGER_STATE);
      setStatus("ready");
      setError(null);
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadTopFragger = async () => {
      if (runtime.widgetAccessDenied) {
        if (cancelled) return;
        setPayload(null);
        setStatus("error");
        setError(WIDGET_APPROVAL_ERROR);
        return;
      }

      if (!resolvedMatchId) {
        if (cancelled) return;
        setPayload(null);
        setStatus("waiting");
        setError(null);
        return;
      }

      try {
        const query = new URLSearchParams({
          matchId: resolvedMatchId,
          mode: "final",
        });
        if (runtime.organizationId) {
          query.set("organizationId", runtime.organizationId);
        }

        const nextPayload = await fetchJson<TopFraggerStatePayload>(
          `${API_URL}/widgets/top-fragger/state/current?${query.toString()}`,
          controller.signal,
        );
        if (cancelled) return;
        setPayload(nextPayload);
        setStatus(nextPayload.active ? "ready" : "waiting");
        setError(null);
      } catch (nextError) {
        if (cancelled || controller.signal.aborted) return;
        setPayload(null);
        setStatus("error");
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to load top-fragger state.",
        );
      }
    };

    void loadTopFragger();
    const interval =
      !runtime.widgetAccessDenied && resolvedMatchId
        ? window.setInterval(() => {
            void loadTopFragger();
          }, POLL_MS)
        : null;

    return () => {
      cancelled = true;
      controller.abort();
      if (interval !== null) {
        window.clearInterval(interval);
      }
    };
  }, [
    resolvedMatchId,
    runtime.organizationId,
    runtime.preview,
    runtime.widgetAccessDenied,
  ]);

  return {
    payload: payload ?? (runtime.preview ? PREVIEW_TOP_FRAGGER_STATE : null),
    status,
    error,
  };
}

export function CountdownOrgWidget({ orgSlug }: { orgSlug: string }) {
  const runtime = useOrganizerWidgetRuntime(orgSlug, "countdown");
  const now = useWidgetClock(runtime.preview);

  if (runtime.widgetAccessDenied) {
    return (
      <WaitingState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Countdown is not approved for this organization."
      />
    );
  }

  const match = runtime.match;

  if (!match && !runtime.preview && runtime.status !== "ready") {
    return (
      <WaitingState
        runtime={runtime}
        title="WAITING"
        subtitle="Countdown becomes active when the organizer has an active or upcoming match."
      />
    );
  }

  const startTime = match?.startsAt ? new Date(match.startsAt).getTime() : null;
  const totalSeconds =
    startTime !== null && Number.isFinite(now)
      ? Math.floor(Math.max(0, startTime - now) / 1000)
      : null;
  const countdownValues =
    totalSeconds === null
      ? ["--", "--", "--"]
      : [
          Math.floor(totalSeconds / 3600).toString().padStart(2, "0"),
          Math.floor((totalSeconds % 3600) / 60)
            .toString()
            .padStart(2, "0"),
          Math.floor(totalSeconds % 60).toString().padStart(2, "0"),
        ];
  const runtimeLifecycleStatus = getOrganizerRuntimeLifecycleStatus(
    runtime.control,
    runtime.preview ? match : null,
  );
  const isLive = runtimeLifecycleStatus === "LIVE";
  const isEnded =
    runtimeLifecycleStatus === "ENDED" || isControlFinalized(runtime.control);
  const tone = runtime.branding.primaryColor;

  return (
    <WidgetStage runtime={runtime} align="center">
      <Frame
        runtime={runtime}
        tone={tone}
        className="w-full max-w-5xl rounded-[34px] px-8 py-10"
      >
        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center gap-2">
            <StatusPill color={tone}>{match?.tournamentName ?? "Tournament"}</StatusPill>
            <StatusPill color={runtime.branding.accent}>
              {getOrganizerRuntimeStatusLabel(
                runtime.control,
                runtime.preview ? match : null,
              )}
            </StatusPill>
          </div>

          <div className="mt-6 text-[10px] font-semibold uppercase tracking-[0.34em] text-white/42">
            Broadcast Countdown
          </div>
          <h1 className="mt-4 text-5xl font-black uppercase tracking-[0.18em] text-white">
            {formatMatchNumber(match?.matchNumber ?? null)}
          </h1>
          <div className="mt-3 text-sm uppercase tracking-[0.28em] text-white/55">
            {(match?.map ?? "Map TBD")} / {(match?.stageName ?? "Stage TBD")}
          </div>

          <div className="mt-10 flex items-center justify-center gap-4">
            {isLive ? (
              <div className="text-5xl font-black uppercase tracking-[0.24em] text-emerald-300">
                Live Now
              </div>
            ) : isEnded ? (
              <div className="text-5xl font-black uppercase tracking-[0.18em] text-amber-300">
                Match Complete
              </div>
            ) : (
              countdownValues.map((value, index) => (
                <div key={`${value}-${index}`} className="flex items-center gap-4">
                  <div
                    className="min-w-[150px] rounded-[26px] border px-6 py-6"
                    style={{
                      borderColor: alphaColor(tone, 0.22),
                      background: `linear-gradient(180deg, ${alphaColor(
                        tone,
                        0.16,
                      )}, rgba(255,255,255,0.03))`,
                    }}
                  >
                    <div className="font-mono text-6xl font-black tracking-[0.08em] text-white">
                      {value}
                    </div>
                  </div>
                  {index < 2 ? (
                    <div className="pb-6 text-5xl font-black text-white/70">:</div>
                  ) : null}
                </div>
              ))
            )}
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="rounded-[22px] border border-white/10 bg-white/[0.03] px-5 py-4 text-left">
              <div className="text-[10px] uppercase tracking-[0.3em] text-white/40">Starts</div>
              <div className="mt-2 text-xl font-bold text-white">
                {formatTimestamp(match?.startsAt)}
              </div>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-white/[0.03] px-5 py-4 text-left">
              <div className="text-[10px] uppercase tracking-[0.3em] text-white/40">Tournament</div>
              <div className="mt-2 text-xl font-bold text-white">
                {match?.tournamentName ?? "TBD"}
              </div>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-white/[0.03] px-5 py-4 text-left">
              <div className="text-[10px] uppercase tracking-[0.3em] text-white/40">Map</div>
              <div className="mt-2 text-xl font-bold text-white">
                {match?.map ?? "TBD"}
              </div>
            </div>
          </div>
        </div>
      </Frame>
    </WidgetStage>
  );
}

export function MatchIntroOrgWidget({ orgSlug }: { orgSlug: string }) {
  const runtime = useOrganizerWidgetRuntime(orgSlug, "match-intro");
  const match = runtime.match;
  const now = useWidgetClock(runtime.preview);
  const previousMatchIdRef = useRef<string | null>(null);
  const previousLiveRef = useRef(false);
  const [liveDetectedAtMs, setLiveDetectedAtMs] = useState<number | null>(null);

  const tone = runtime.branding.primaryColor;
  const accent = runtime.branding.accent;
  const sponsors = sortSponsors(match?.sponsors).filter((sponsor) =>
    Boolean(sponsor.name?.trim() || sponsor.logoUrl),
  );
  const primarySponsor = sponsors[0] ?? null;
  const secondarySponsors = sponsors.slice(primarySponsor ? 1 : 0, primarySponsor ? 3 : 2);
  const lifecycleStatus = getOrganizerRuntimeLifecycleStatus(
    runtime.control,
    runtime.preview ? match : null,
  );
  const isLive = lifecycleStatus === "LIVE";
  const scheduledStartMs = toDateMs(match?.startsAt);
  const scheduledStartFresh =
    Number.isFinite(scheduledStartMs) &&
    Number.isFinite(now) &&
    now >= scheduledStartMs &&
    now - scheduledStartMs <= 120_000;

  useEffect(() => {
    const nextMatchId = match?.matchId ?? match?.id ?? null;

    if (nextMatchId !== previousMatchIdRef.current) {
      previousMatchIdRef.current = nextMatchId;
      previousLiveRef.current = isLive;
      setLiveDetectedAtMs(null);
      return;
    }

    if (isLive && !previousLiveRef.current && Number.isFinite(now)) {
      setLiveDetectedAtMs(now);
    }

    previousLiveRef.current = isLive;
  }, [isLive, match?.id, match?.matchId, now]);

  if (runtime.widgetAccessDenied) {
    return (
      <WaitingState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Match Intro is not approved for this organization."
      />
    );
  }

  if (!match && !runtime.preview) {
    return null;
  }

  if (!match) {
    return (
      <WaitingState
        runtime={runtime}
        title="WAITING"
        subtitle="Match Intro becomes active when the organizer has an active match."
      />
    );
  }

  const revealAnchorMs = runtime.preview
    ? now
    : liveDetectedAtMs ?? (isLive && scheduledStartFresh ? scheduledStartMs : Number.NaN);
  const revealAtMs = Number.isFinite(revealAnchorMs)
    ? revealAnchorMs + MATCH_INTRO_DELAY_MS
    : Number.NaN;
  const hideAtMs = Number.isFinite(revealAtMs)
    ? revealAtMs + MATCH_INTRO_DISPLAY_MS
    : Number.NaN;
  const elapsedSinceReveal =
    Number.isFinite(revealAtMs) && Number.isFinite(now) ? now - revealAtMs : Number.NaN;
  const shouldRender =
    runtime.preview ||
    (Number.isFinite(elapsedSinceReveal) &&
      elapsedSinceReveal >= 0 &&
      Number.isFinite(hideAtMs) &&
      now < hideAtMs);

  if (!shouldRender) {
    return null;
  }

  const isExiting =
    !runtime.preview && Number.isFinite(hideAtMs) && now >= hideAtMs - MATCH_INTRO_EXIT_MS;
  const animationName = isExiting
    ? "arenzyraMatchIntroExit"
    : "arenzyraMatchIntroReveal";
  const animationDuration = isExiting ? MATCH_INTRO_EXIT_MS : 950;
  const tournamentLabel = match?.tournamentName?.trim() || "Tournament";
  const stageLabel = match?.stageName?.trim().toUpperCase() || "STAGE TBD";
  const mapLabel = match?.map?.trim().toUpperCase() || "MAP TBD";
  const matchLabel = formatMatchNumber(match?.matchNumber ?? null).toUpperCase();
  const matchSubtitle = match?.matchName?.trim() || `${stageLabel} / ${mapLabel}`;
  const statusLabel = isLive
    ? "Live"
    : getOrganizerRuntimeStatusLabel(
        runtime.control,
        runtime.preview ? match : null,
      );
  const sponsorFallback =
    primarySponsor?.name
      ?.split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") ?? "SP";
  const tournamentFallback =
    tournamentLabel
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || DEFAULT_WIDGET_TEAM_TAG;

  return (
    <WidgetStage runtime={runtime} align="center">
      <Frame
        runtime={runtime}
        tone={tone}
        className="w-full max-w-[1100px] rounded-[38px] px-0 py-0"
      >
        <section
          className="relative overflow-hidden px-8 py-8 lg:px-10 lg:py-9"
          style={{
            animation: `${animationName} ${animationDuration}ms cubic-bezier(0.22, 1, 0.36, 1) both`,
          }}
        >
          <style jsx>{`
            @keyframes arenzyraMatchIntroReveal {
              0% {
                opacity: 0;
                transform: translateY(38px) scale(0.96);
                filter: blur(10px);
              }
              60% {
                opacity: 1;
                transform: translateY(0) scale(1.01);
                filter: blur(0);
              }
              100% {
                opacity: 1;
                transform: translateY(0) scale(1);
                filter: blur(0);
              }
            }

            @keyframes arenzyraMatchIntroExit {
              0% {
                opacity: 1;
                transform: translateY(0) scale(1);
                filter: blur(0);
              }
              100% {
                opacity: 0;
                transform: translateY(-24px) scale(0.985);
                filter: blur(8px);
              }
            }

            @keyframes arenzyraMatchIntroSweep {
              0% {
                transform: translateX(-140%) skewX(-24deg);
                opacity: 0;
              }
              18% {
                opacity: 0.8;
              }
              45% {
                opacity: 0.32;
              }
              100% {
                transform: translateX(180%) skewX(-24deg);
                opacity: 0;
              }
            }

            @keyframes arenzyraMatchIntroPulse {
              0%,
              100% {
                opacity: 0.36;
                transform: scale(1);
              }
              50% {
                opacity: 0.72;
                transform: scale(1.04);
              }
            }
          `}</style>
          <div
            className="pointer-events-none absolute right-8 top-0 text-[120px] font-black uppercase leading-none tracking-[0.22em] text-white/5 lg:text-[190px]"
            style={{ textShadow: `0 0 40px ${alphaColor(accent, 0.08)}` }}
          >
            {mapLabel}
          </div>
          <div
            className="pointer-events-none absolute -left-10 top-8 h-48 w-48 rounded-full blur-3xl"
            style={{
              background: alphaColor(tone, 0.24),
              animation: "arenzyraMatchIntroPulse 3.6s ease-in-out infinite",
            }}
          />
          <div
            className="pointer-events-none absolute -right-16 bottom-0 h-56 w-56 rounded-full blur-3xl"
            style={{ background: alphaColor(accent, 0.18) }}
          />
          <div
            className="pointer-events-none absolute inset-y-0 left-[-18%] w-[38%]"
            style={{
              background: `linear-gradient(90deg, transparent, ${alphaColor(
                "#ffffff",
                0.18,
              )}, transparent)`,
              animation: "arenzyraMatchIntroSweep 3.2s ease-out infinite",
            }}
          />

          <div className="relative grid gap-8 lg:grid-cols-[156px_minmax(0,1fr)_252px] lg:items-center">
            <div className="relative">
              <div
                className="absolute inset-2 rounded-[30px] blur-2xl"
                style={{ background: alphaColor(tone, 0.24) }}
              />
              <div
                className="relative overflow-hidden rounded-[32px] border px-5 py-5"
                style={{
                  borderColor: alphaColor(tone, 0.28),
                  background: [
                    `linear-gradient(135deg, ${alphaColor(tone, 0.24)}, transparent 62%)`,
                    `linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))`,
                  ].join(", "),
                }}
              >
                <div
                  className="flex h-[132px] items-center justify-center overflow-hidden rounded-[26px] border"
                  style={{
                    borderColor: alphaColor(tone, 0.24),
                    background: `linear-gradient(180deg, ${alphaColor(
                      tone,
                      0.16,
                    )}, rgba(255,255,255,0.04))`,
                  }}
                >
                  {match?.tournamentLogo ? (
                    <img
                      src={ensureApiUrl(match.tournamentLogo) ?? DEFAULT_TEAM_LOGO_URL}
                      alt={tournamentLabel}
                      className="h-full w-full object-contain p-5"
                    />
                  ) : (
                    <span className="px-4 text-center text-3xl font-black uppercase tracking-[0.24em] text-white">
                      {tournamentFallback}
                    </span>
                  )}
                </div>
                <div className="mt-4 text-[9px] font-semibold uppercase tracking-[0.32em] text-white/44">
                  Tournament Logo
                </div>
              </div>
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill color={tone}>Match Intro</StatusPill>
                <StatusPill color={accent}>{stageLabel}</StatusPill>
                <StatusPill color={darkenHexColor(tone, 0.18)}>{statusLabel}</StatusPill>
              </div>

              <div className="mt-5 text-[10px] font-semibold uppercase tracking-[0.38em] text-white/42">
                Global Broadcast Feed
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
                <h1 className="text-5xl font-black uppercase tracking-[0.18em] text-white lg:text-7xl">
                  {matchLabel}
                </h1>
                <div className="pb-2 text-sm font-semibold uppercase tracking-[0.42em] text-white/52 lg:text-base">
                  {stageLabel}
                </div>
              </div>
              <div
                className="mt-4 inline-flex max-w-full items-center rounded-full border px-4 py-2 text-sm font-semibold uppercase tracking-[0.3em] text-white"
                style={{
                  borderColor: alphaColor(accent, 0.22),
                  background: `linear-gradient(90deg, ${alphaColor(
                    accent,
                    0.16,
                  )}, rgba(255,255,255,0.03))`,
                }}
              >
                {mapLabel}
              </div>
              <div className="mt-5 max-w-2xl text-lg font-medium uppercase tracking-[0.16em] text-white/72 lg:text-2xl">
                {matchSubtitle}
              </div>
            </div>

            <div className="space-y-3">
              {primarySponsor ? (
                <IntroBrandPanel
                  label={primarySponsor.name ?? "Sponsor"}
                  subtitle="Presented By"
                  logoUrl={primarySponsor.logoUrl}
                  fallback={sponsorFallback}
                  color={accent}
                />
              ) : (
                <div
                  className="rounded-[24px] border px-5 py-4"
                  style={{
                    borderColor: alphaColor(accent, 0.18),
                    background: `linear-gradient(180deg, ${alphaColor(
                      accent,
                      0.14,
                    )}, rgba(255,255,255,0.03))`,
                  }}
                >
                  <div className="text-[9px] font-semibold uppercase tracking-[0.3em] text-white/42">
                    Broadcast Layer
                  </div>
                  <div className="mt-2 text-lg font-semibold uppercase tracking-[0.14em] text-white">
                    Premium Match Intro
                  </div>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                {[
                  ["Starts", formatTimestamp(match?.startsAt)],
                  ["Stage", stageLabel],
                  ["Status", statusLabel.toUpperCase()],
                ].map(([label, value], index) => (
                  <div
                    key={label}
                    className="rounded-[22px] border px-4 py-4"
                    style={{
                      borderColor:
                        index === 2
                          ? alphaColor(accent, 0.24)
                          : alphaColor(tone, 0.18),
                      background:
                        index === 2
                          ? `linear-gradient(135deg, ${alphaColor(
                              accent,
                              0.16,
                            )}, rgba(255,255,255,0.02))`
                          : "rgba(255,255,255,0.03)",
                    }}
                  >
                    <div className="text-[9px] font-semibold uppercase tracking-[0.3em] text-white/42">
                      {label}
                    </div>
                    <div className="mt-2 text-lg font-black uppercase tracking-[0.14em] text-white">
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="relative mt-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div
              className="relative overflow-hidden rounded-[28px] border px-6 py-5"
              style={{
                borderColor: alphaColor(tone, 0.24),
                background: [
                  `linear-gradient(135deg, ${alphaColor(tone, 0.18)}, transparent 48%)`,
                  `linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))`,
                ].join(", "),
              }}
            >
              <div className="text-[10px] font-semibold uppercase tracking-[0.34em] text-white/42">
                Map Spotlight
              </div>
              <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="text-4xl font-black uppercase tracking-[0.18em] text-white lg:text-5xl">
                    {mapLabel}
                  </div>
                  <div className="mt-3 text-sm uppercase tracking-[0.28em] text-white/55">
                    {tournamentLabel} / {stageLabel}
                  </div>
                </div>
                <div
                  className="inline-flex items-center rounded-full border px-4 py-2 text-sm font-semibold uppercase tracking-[0.26em] text-white"
                  style={{
                    borderColor: alphaColor(accent, 0.26),
                    background: alphaColor(accent, 0.14),
                  }}
                >
                  {statusLabel}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-start gap-3 lg:justify-end">
              {secondarySponsors.length > 0 ? (
                secondarySponsors.map((sponsor, index) => (
                  <IntroBrandPanel
                    key={sponsor.id ?? sponsor.name ?? `intro-sponsor-${index + 1}`}
                    label={sponsor.name ?? "Sponsor"}
                    subtitle="Partner"
                    logoUrl={sponsor.logoUrl}
                    fallback={
                      sponsor.name
                        ?.split(/\s+/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((part) => part[0]?.toUpperCase())
                        .join("") ?? "SP"
                    }
                    color={index % 2 === 0 ? tone : accent}
                    compact
                  />
                ))
              ) : (
                <div
                  className="rounded-[22px] border px-4 py-3 text-right"
                  style={{
                    borderColor: alphaColor(accent, 0.18),
                    background: "rgba(255,255,255,0.03)",
                  }}
                >
                  <div className="text-[9px] font-semibold uppercase tracking-[0.3em] text-white/42">
                    Tournament
                  </div>
                  <div className="mt-2 text-sm font-semibold uppercase tracking-[0.16em] text-white">
                    {tournamentLabel}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </Frame>
    </WidgetStage>
  );
}

export function TeamsLineupOrgWidget({ orgSlug }: { orgSlug: string }) {
  const runtime = useOrganizerWidgetRuntime(orgSlug, "teams-lineup");
  const match = runtime.match;
  const slotsState = useOrganizerMatchSlots(runtime);

  if (runtime.widgetAccessDenied) {
    return (
      <WaitingState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Teams Lineup is not approved for this organization."
      />
    );
  }

  if (!match && !runtime.preview && runtime.status !== "ready") {
    return (
      <WaitingState
        runtime={runtime}
        title="WAITING"
        subtitle="Teams Lineup needs an active or upcoming match to render."
      />
    );
  }

  const slots = slotsState.slots.filter((slot) => slot.teamId || slot.team);
  if (slots.length === 0 && !runtime.preview) {
    return (
      <WaitingState
        runtime={runtime}
        title="WAITING"
        subtitle={
          slotsState.error ??
          "Teams Lineup needs assigned match slots before it can render."
        }
      />
    );
  }

  const visibleSlots = slots.slice(0, 16);
  const tone = runtime.branding.primaryColor;

  return (
    <WidgetStage runtime={runtime} align="center">
      <Frame
        runtime={runtime}
        tone={tone}
        className="w-full max-w-6xl rounded-[36px] px-8 py-8"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/8 pb-5">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.34em] text-white/42">
              Teams Lineup
            </div>
            <div className="mt-2 text-4xl font-black uppercase tracking-[0.16em] text-white">
              {formatMatchNumber(match?.matchNumber ?? null)}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusPill color={tone}>{match?.tournamentName ?? "Tournament"}</StatusPill>
              <StatusPill color={runtime.branding.accent}>
                {match?.stageName ?? "Stage"}
              </StatusPill>
              <StatusPill color={darkenHexColor(tone, 0.24)}>
                {match?.map ?? "Map TBD"}
              </StatusPill>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[22px] border border-white/10 bg-white/[0.03] px-5 py-4">
              <div className="text-[10px] uppercase tracking-[0.3em] text-white/40">
                Teams
              </div>
              <div className="mt-2 text-2xl font-bold text-white">{visibleSlots.length}</div>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-white/[0.03] px-5 py-4">
              <div className="text-[10px] uppercase tracking-[0.3em] text-white/40">
                Lobby
              </div>
              <div className="mt-2 text-2xl font-bold text-white">
                {slotsState.status === "ready" ? "Ready" : "Syncing"}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {visibleSlots.map((slot) => {
            const toneColor = getSlotTone(slot, runtime.branding);
            const teamLabel = formatTeamLabel(
              slot.team?.tag ?? null,
              slot.team?.name ?? null,
              slot.slotNumber,
            );

            return (
              <div
                key={slot.id}
                className="rounded-[24px] border p-4"
                style={{
                  borderColor: alphaColor(toneColor, 0.22),
                  background: `linear-gradient(180deg, ${alphaColor(
                    toneColor,
                    0.16,
                  )}, rgba(255,255,255,0.03))`,
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.28em] text-white/42">
                      {formatSlot(slot.slotNumber)}
                    </div>
                    <div className="mt-2 text-lg font-black uppercase tracking-[0.14em] text-white">
                      {teamLabel}
                    </div>
                  </div>
                  <StatusPill color={toneColor}>
                    {formatSlotLobbyStatus(slot)}
                  </StatusPill>
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <TeamLogo
                    logoUrl={slot.team?.logoUrl}
                    label={teamLabel}
                    color={toneColor}
                    size={54}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold uppercase tracking-[0.14em] text-white/82">
                      {slot.team?.name ?? DEFAULT_WIDGET_TEAM_NAME}
                    </div>
                    <div className="mt-1 text-xs uppercase tracking-[0.22em] text-white/45">
                      {slot.playersInLobby ?? 0}/4 players in lobby
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Frame>
    </WidgetStage>
  );
}

export function MapCardOrgWidget({ orgSlug }: { orgSlug: string }) {
  const runtime = useOrganizerWidgetRuntime(orgSlug, "map-card");
  const searchParams = useSearchParams();
  const showRealtimeDebug = searchParams.get("realtimeDebug") === "true";
  const realtime = useWidgetRealtime({
    orgSlug,
    widgetKey: "map-card",
    matchId: runtime.matchId,
    enabled: !runtime.preview,
  });
  const match = runtime.match;

  useEffect(() => {
    if (realtime.lastMessage?.type !== "widget_realtime_event") {
      return;
    }

    console.debug(
      "[map-card][widget-realtime]",
      realtime.lastMessage.payload,
    );
  }, [realtime.lastMessage]);

  if (runtime.widgetAccessDenied) {
    return (
      <WaitingState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Map Card is not approved for this organization."
      />
    );
  }

  if (!match && !runtime.preview && runtime.status !== "ready") {
    return (
      <WaitingState
        runtime={runtime}
        title="WAITING"
        subtitle="Map Card needs an active or upcoming match to render."
      />
    );
  }

  const tone = runtime.branding.accent;
  const mapLabel = match?.map ?? "Map TBD";

  return (
    <WidgetStage runtime={runtime} align="center">
      <Frame
        runtime={runtime}
        tone={tone}
        className="w-full max-w-6xl rounded-[38px] px-0 py-0"
      >
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="relative overflow-hidden px-8 py-10">
            {showRealtimeDebug ? (
              <div className="absolute right-4 top-4 z-20 rounded-[14px] border border-white/12 bg-black/55 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/72 backdrop-blur">
                <div>Realtime {realtime.connectionState}</div>
                <div className="mt-1 text-white/48">
                  {realtime.lastMessage?.topic ?? realtime.lastMessage?.type ?? "waiting"}
                </div>
              </div>
            ) : null}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background: `radial-gradient(circle at 18% 18%, ${alphaColor(
                  tone,
                  0.22,
                )}, transparent 32%)`,
              }}
            />
            <div className="relative">
              <div className="flex flex-wrap gap-2">
                <StatusPill color={runtime.branding.primaryColor}>
                  {match?.tournamentName ?? "Tournament"}
                </StatusPill>
                <StatusPill color={runtime.branding.accent}>
                  {match?.stageName ?? "Stage"}
                </StatusPill>
              </div>
              <div className="mt-6 text-[10px] font-semibold uppercase tracking-[0.34em] text-white/42">
                Map Card
              </div>
              <div className="mt-5 text-7xl font-black uppercase leading-none tracking-[0.16em] text-white">
                {mapLabel}
              </div>
              <div className="mt-5 text-2xl font-semibold uppercase tracking-[0.12em] text-white/76">
                {match?.matchName ?? formatMatchNumber(match?.matchNumber ?? null)}
              </div>
              <div className="mt-8 flex flex-wrap gap-3">
                <div className="rounded-[22px] border border-white/10 bg-white/[0.03] px-5 py-4">
                  <div className="text-[10px] uppercase tracking-[0.3em] text-white/40">
                    Match
                  </div>
                  <div className="mt-2 text-xl font-bold text-white">
                    {formatMatchNumber(match?.matchNumber ?? null)}
                  </div>
                </div>
                <div className="rounded-[22px] border border-white/10 bg-white/[0.03] px-5 py-4">
                  <div className="text-[10px] uppercase tracking-[0.3em] text-white/40">
                    Starts
                  </div>
                  <div className="mt-2 text-xl font-bold text-white">
                    {formatTimestamp(match?.startsAt)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            className="relative overflow-hidden border-l border-white/8 px-6 py-10"
            style={{
              background: `linear-gradient(180deg, ${alphaColor(
                tone,
                0.22,
              )}, rgba(255,255,255,0.02))`,
            }}
          >
            <div className="text-[10px] font-semibold uppercase tracking-[0.34em] text-white/42">
              Broadcast Context
            </div>
            <div className="mt-4 space-y-4">
              {[
                ["Tournament", match?.tournamentName ?? "TBD"],
                ["Stage", match?.stageName ?? "TBD"],
                [
                  "Status",
                  getOrganizerRuntimeStatusLabel(
                    runtime.control,
                    runtime.preview ? match : null,
                  ),
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-[22px] border border-white/10 bg-black/10 px-4 py-4"
                >
                  <div className="text-[10px] uppercase tracking-[0.26em] text-white/38">
                    {label}
                  </div>
                  <div className="mt-2 text-xl font-bold text-white">{value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Frame>
    </WidgetStage>
  );
}

export function LobbySlotListOrgWidget({ orgSlug }: { orgSlug: string }) {
  const runtime = useOrganizerWidgetRuntime(orgSlug, "lobby-slot-list");
  const match = runtime.match;
  const slotsState = useOrganizerMatchSlots(runtime);

  if (runtime.widgetAccessDenied) {
    return (
      <WaitingState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Lobby / Slot List is not approved for this organization."
      />
    );
  }

  if (!match && !runtime.preview && runtime.status !== "ready") {
    return (
      <WaitingState
        runtime={runtime}
        title="WAITING"
        subtitle="Lobby / Slot List needs an active or upcoming match to render."
      />
    );
  }

  const slots = slotsState.slots.slice(0, 16);
  if (slots.length === 0 && !runtime.preview) {
    return (
      <WaitingState
        runtime={runtime}
        title="WAITING"
        subtitle={
          slotsState.error ??
          "Lobby / Slot List needs assigned slots before it can render."
        }
      />
    );
  }

  const readyCount = slots.filter(
    (slot) => formatSlotLobbyStatus(slot).toLowerCase() === "ready",
  ).length;

  return (
    <WidgetStage runtime={runtime} align="center">
      <Frame
        runtime={runtime}
        tone={runtime.branding.primaryColor}
        className="w-full max-w-6xl rounded-[34px] px-6 py-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/8 pb-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.34em] text-white/42">
              Lobby / Slot List
            </div>
            <div className="mt-2 text-3xl font-black uppercase tracking-[0.16em] text-white">
              {formatMatchNumber(match?.matchNumber ?? null)}
            </div>
            <div className="mt-2 text-sm uppercase tracking-[0.24em] text-white/55">
              {(match?.tournamentName ?? "Tournament")} / {(match?.map ?? "Map")}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill color={runtime.branding.primaryColor}>
              {readyCount}/{slots.length} ready
            </StatusPill>
            <StatusPill color={runtime.branding.accent}>
              {match?.stageName ?? "Stage"}
            </StatusPill>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-[88px_minmax(0,1fr)_112px_104px] gap-3 px-3 text-[10px] font-semibold uppercase tracking-[0.26em] text-white/38">
          <div>Slot</div>
          <div>Team</div>
          <div className="text-center">Players</div>
          <div className="text-right">Status</div>
        </div>

        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {slots.map((slot) => {
            const toneColor = getSlotTone(slot, runtime.branding);
            const teamLabel = formatTeamLabel(
              slot.team?.tag ?? null,
              slot.team?.name ?? null,
              slot.slotNumber,
            );

            return (
              <div
                key={slot.id}
                className="grid grid-cols-[88px_minmax(0,1fr)_112px_104px] items-center gap-3 rounded-[22px] border px-4 py-3"
                style={{
                  borderColor: alphaColor(toneColor, 0.18),
                  background: `linear-gradient(90deg, ${alphaColor(
                    toneColor,
                    0.14,
                  )}, rgba(255,255,255,0.03))`,
                }}
              >
                <div className="text-xl font-black uppercase tracking-[0.12em] text-white">
                  {formatSlot(slot.slotNumber)}
                </div>
                <div className="flex min-w-0 items-center gap-3">
                  <TeamLogo
                    logoUrl={slot.team?.logoUrl}
                    label={teamLabel}
                    color={toneColor}
                    size={38}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold uppercase tracking-[0.14em] text-white">
                      {teamLabel}
                    </div>
                    <div className="truncate text-xs uppercase tracking-[0.22em] text-white/45">
                      {slot.team?.name ?? "Unassigned team"}
                    </div>
                  </div>
                </div>
                <div className="text-center text-lg font-black text-white">
                  {slot.playersInLobby ?? 0}/4
                </div>
                <div className="flex justify-end">
                  <StatusPill color={toneColor}>{formatSlotLobbyStatus(slot)}</StatusPill>
                </div>
              </div>
            );
          })}
        </div>
      </Frame>
    </WidgetStage>
  );
}

export function SponsorBannerOrgWidget({ orgSlug }: { orgSlug: string }) {
  const runtime = useOrganizerWidgetRuntime(orgSlug, "sponsor-banner");
  const match = runtime.match;

  if (runtime.widgetAccessDenied) {
    return (
      <WaitingState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Sponsor Banner is not approved for this organization."
      />
    );
  }

  if (!match && !runtime.preview && runtime.status !== "ready") {
    return (
      <WaitingState
        runtime={runtime}
        title="WAITING"
        subtitle="Sponsor Banner needs an active or upcoming match to render."
      />
    );
  }

  const sponsors = sortSponsors(match?.sponsors).filter(
    (sponsor) => sponsor.name || sponsor.logoUrl,
  );
  if (sponsors.length === 0 && !runtime.preview) {
    return (
      <WaitingState
        runtime={runtime}
        title="WAITING"
        subtitle="Sponsor Banner needs tournament sponsors before it can render."
      />
    );
  }

  return (
    <WidgetStage runtime={runtime} align="center">
      <Frame
        runtime={runtime}
        tone={runtime.branding.accent}
        className="w-full max-w-6xl rounded-[34px] px-6 py-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.34em] text-white/42">
              Sponsor Banner
            </div>
            <div className="mt-2 text-3xl font-black uppercase tracking-[0.16em] text-white">
              {match?.tournamentName ?? "Tournament Partners"}
            </div>
            <div className="mt-2 text-sm uppercase tracking-[0.24em] text-white/55">
              {match?.stageName ?? "Stage"} / {formatMatchNumber(match?.matchNumber ?? null)}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {sponsors.slice(0, 4).map((sponsor, index) => {
              const tone =
                index % 2 === 0
                  ? runtime.branding.primaryColor
                  : runtime.branding.accent;
              const logoSrc = sponsor.logoUrl ? ensureApiUrl(sponsor.logoUrl) : null;
              const initials =
                sponsor.name
                  ?.split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((part) => part[0]?.toUpperCase())
                  .join("") ?? "SP";

              return (
                <div
                  key={sponsor.id ?? sponsor.name ?? `sponsor-${index + 1}`}
                  className="flex min-w-[220px] items-center gap-3 rounded-[24px] border px-4 py-3"
                  style={{
                    borderColor: alphaColor(tone, 0.2),
                    background: `linear-gradient(90deg, ${alphaColor(
                      tone,
                      0.16,
                    )}, rgba(255,255,255,0.03))`,
                  }}
                >
                  <div
                    className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-[18px] border"
                    style={{
                      borderColor: alphaColor(tone, 0.24),
                      background: alphaColor(tone, 0.16),
                    }}
                  >
                    {logoSrc ? (
                      <div
                        aria-label={sponsor.name ?? "Sponsor"}
                        className="h-full w-full bg-center bg-cover bg-no-repeat"
                        style={{ backgroundImage: `url(${logoSrc})` }}
                      />
                    ) : (
                      <span className="text-sm font-black uppercase tracking-[0.24em] text-white">
                        {initials}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold uppercase tracking-[0.16em] text-white">
                      {sponsor.name ?? "Sponsor"}
                    </div>
                    <div className="mt-1 text-[11px] uppercase tracking-[0.22em] text-white/45">
                      {sponsor.tier ?? "Partner"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Frame>
    </WidgetStage>
  );
}

export function NextMatchOrgWidget({ orgSlug }: { orgSlug: string }) {
  const runtime = useOrganizerWidgetRuntime(orgSlug, "next-match");
  const nextMatchState = useOrganizerNextMatch(orgSlug, runtime.preview);
  const now = useWidgetClock(runtime.preview);
  const nextMatchControl = useOrganizerMatchControl(
    nextMatchState.match?.matchId ?? nextMatchState.match?.id ?? null,
    {
      preview: runtime.preview,
      pollMs: POLL_MS,
    },
  );

  if (runtime.widgetAccessDenied) {
    return (
      <WaitingState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Next Match is not approved for this organization."
      />
    );
  }

  const fallbackMatch =
    runtime.match && getControlRuntimeBadge(runtime.control) === "UPCOMING"
      ? runtime.match
      : null;
  const match = nextMatchState.match ?? fallbackMatch;

  if (!match && !runtime.preview) {
    return (
      <WaitingState
        runtime={runtime}
        title="WAITING"
        subtitle={
          nextMatchState.error ??
          "Next Match needs a scheduled upcoming match to render."
        }
      />
    );
  }

  const tone = runtime.branding.accent;

  return (
    <WidgetStage runtime={runtime} align="center">
      <Frame
        runtime={runtime}
        tone={tone}
        className="w-full max-w-5xl rounded-[36px] px-8 py-8"
      >
        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div>
            <div className="flex flex-wrap gap-2">
              <StatusPill color={runtime.branding.primaryColor}>
                {match?.tournamentName ?? "Tournament"}
              </StatusPill>
              <StatusPill color={runtime.branding.accent}>
                {match?.stageName ?? "Stage"}
              </StatusPill>
            </div>
            <div className="mt-6 text-[10px] font-semibold uppercase tracking-[0.34em] text-white/42">
              Next Match
            </div>
            <div className="mt-3 text-5xl font-black uppercase tracking-[0.16em] text-white">
              {formatMatchNumber(match?.matchNumber ?? null)}
            </div>
            <div className="mt-3 text-2xl font-semibold uppercase tracking-[0.12em] text-white/76">
              {match?.matchName ?? match?.map ?? "Match Ready"}
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                ["Map", match?.map ?? "TBD"],
                ["Starts", formatTimestamp(match?.startsAt)],
                [
                  "Status",
                  getOrganizerRuntimeStatusLabel(
                    nextMatchControl,
                    runtime.preview ? match : null,
                  ),
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-[22px] border border-white/10 bg-white/[0.03] px-5 py-4"
                >
                  <div className="text-[10px] uppercase tracking-[0.3em] text-white/40">
                    {label}
                  </div>
                  <div className="mt-2 text-xl font-bold text-white">{value}</div>
                </div>
              ))}
            </div>
          </div>

          <div
            className="rounded-[30px] border px-6 py-7 text-center"
            style={{
              borderColor: alphaColor(tone, 0.24),
              background: `radial-gradient(circle at top, ${alphaColor(
                tone,
                0.22,
              )}, rgba(255,255,255,0.02) 68%)`,
            }}
          >
            <div className="text-[10px] font-semibold uppercase tracking-[0.34em] text-white/42">
              Starts In
            </div>
            <div className="mt-4 text-5xl font-black uppercase tracking-[0.14em] text-white">
              {formatRelativeCountdown(match?.startsAt, now)}
            </div>
            <div className="mt-4 text-[11px] uppercase tracking-[0.26em] text-white/52">
              {formatTimestamp(match?.startsAt)}
            </div>
          </div>
        </div>
      </Frame>
    </WidgetStage>
  );
}

export function NextMatchBreakOrgWidget({ orgSlug }: { orgSlug: string }) {
  const runtime = useOrganizerWidgetRuntime(orgSlug, "next-match-break");
  const nextMatchState = useOrganizerNextMatch(orgSlug, runtime.preview);
  const now = useWidgetClock(runtime.preview);
  const nextMatchControl = useOrganizerMatchControl(
    nextMatchState.match?.matchId ?? nextMatchState.match?.id ?? null,
    {
      preview: runtime.preview,
      pollMs: POLL_MS,
    },
  );

  if (runtime.widgetAccessDenied) {
    return (
      <WaitingState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Next Match / Break is not approved for this organization."
      />
    );
  }

  const fallbackMatch =
    runtime.match && getControlRuntimeBadge(runtime.control) === "UPCOMING"
      ? runtime.match
      : null;
  const nextMatch = nextMatchState.match ?? fallbackMatch;
  const previousMatch =
    runtime.match && runtime.match.matchId !== nextMatch?.matchId
      ? runtime.match
      : null;
  const sponsors = sortSponsors(nextMatch?.sponsors)
    .filter((sponsor) => sponsor.name || sponsor.logoUrl)
    .slice(0, 3);

  if (!nextMatch && !runtime.preview) {
    return (
      <WaitingState
        runtime={runtime}
        title="WAITING"
        subtitle={
          nextMatchState.error ??
          "Next Match / Break needs a scheduled upcoming match to render."
        }
      />
    );
  }

  const tone = runtime.branding.primaryColor;

  return (
    <WidgetStage runtime={runtime} align="center">
      <Frame
        runtime={runtime}
        tone={tone}
        backgroundMode="transparent"
        className="w-full max-w-6xl rounded-[38px] px-8 py-8"
      >
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_320px]">
          <div
            className="rounded-[32px] border px-7 py-7"
            style={{
              borderColor: alphaColor(tone, 0.22),
              background: `linear-gradient(135deg, ${alphaColor(
                tone,
                0.2,
              )}, rgba(255,255,255,0.03) 58%, rgba(0,0,0,0.24))`,
              boxShadow: `0 0 36px ${alphaColor(tone, 0.12)}`,
            }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill color={runtime.branding.primaryColor}>
                {nextMatch?.tournamentName ?? runtime.match?.tournamentName ?? "Tournament"}
              </StatusPill>
              <StatusPill color={runtime.branding.accent}>
                {nextMatch?.stageName ?? runtime.match?.stageName ?? "Stage"}
              </StatusPill>
              {previousMatch ? (
                <StatusPill color={tone}>
                  {`After ${formatMatchNumber(previousMatch.matchNumber ?? null)}`}
                </StatusPill>
              ) : null}
            </div>

            <div className="mt-7 text-[10px] font-semibold uppercase tracking-[0.34em] text-white/42">
              Next Match / Break
            </div>
            <div className="mt-3 text-5xl font-black uppercase tracking-[0.16em] text-white">
              Stay Tuned
            </div>
            <div className="mt-4 text-3xl font-black uppercase tracking-[0.14em] text-white">
              {formatMatchNumber(nextMatch?.matchNumber ?? null)}
            </div>
            <div className="mt-3 text-xl font-semibold uppercase tracking-[0.12em] text-white/78">
              {nextMatch?.matchName ?? nextMatch?.map ?? "Upcoming Match"}
            </div>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-white/62">
              Broadcast reset is in progress. The next lobby is queued and the stream
              will roll straight into the next featured match.
            </p>

            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              {[
                {
                  label: "Map",
                  value: nextMatch?.map ?? "TBD",
                },
                {
                  label: "Starts",
                  value: formatTimestamp(nextMatch?.startsAt),
                },
                {
                  label: "Status",
                  value: getOrganizerRuntimeStatusLabel(
                    nextMatchControl,
                    runtime.preview ? nextMatch : null,
                  ),
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-[22px] border border-white/10 bg-black/20 px-5 py-4"
                >
                  <div className="text-[10px] uppercase tracking-[0.3em] text-white/40">
                    {item.label}
                  </div>
                  <div className="mt-2 text-xl font-bold uppercase text-white">
                    {item.value}
                  </div>
                </div>
              ))}
            </div>

            {sponsors.length > 0 ? (
              <div className="mt-7 border-t border-white/10 pt-5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/40">
                  Presented By
                </div>
                <div className="mt-3 flex flex-wrap gap-3">
                  {sponsors.map((sponsor, index) => {
                    const sponsorTone =
                      index % 2 === 0 ? runtime.branding.accent : tone;

                    return (
                      <div
                        key={sponsor.id ?? sponsor.name ?? `break-sponsor-${index + 1}`}
                        className="rounded-[20px] border px-4 py-3"
                        style={{
                          borderColor: alphaColor(sponsorTone, 0.18),
                          background: alphaColor(sponsorTone, 0.12),
                        }}
                      >
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white">
                          {sponsor.name ?? "Sponsor"}
                        </div>
                        <div className="mt-1 text-[10px] uppercase tracking-[0.26em] text-white/46">
                          {sponsor.tier ?? "Partner"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          <div className="grid gap-6">
            <div
              className="rounded-[30px] border px-6 py-7 text-center"
              style={{
                borderColor: alphaColor(runtime.branding.accent, 0.24),
                background: `radial-gradient(circle at top, ${alphaColor(
                  runtime.branding.accent,
                  0.22,
                )}, rgba(255,255,255,0.02) 68%)`,
              }}
            >
              <div className="text-[10px] font-semibold uppercase tracking-[0.34em] text-white/42">
                Stream Returns
              </div>
              <div className="mt-4 text-5xl font-black uppercase tracking-[0.14em] text-white">
                {formatRelativeCountdown(nextMatch?.startsAt, now)}
              </div>
              <div className="mt-4 text-[11px] uppercase tracking-[0.26em] text-white/52">
                {formatTimestamp(nextMatch?.startsAt)}
              </div>
            </div>

            <div className="rounded-[30px] border border-white/10 bg-white/[0.03] px-6 py-6">
              <div className="text-[10px] font-semibold uppercase tracking-[0.34em] text-white/42">
                Broadcast Cue
              </div>
              <div className="mt-5 space-y-4">
                <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-4">
                  <div className="text-[10px] uppercase tracking-[0.26em] text-white/42">
                    On Deck
                  </div>
                  <div className="mt-2 text-2xl font-black uppercase tracking-[0.12em] text-white">
                    {formatMatchNumber(nextMatch?.matchNumber ?? null)}
                  </div>
                  <div className="mt-2 text-sm uppercase tracking-[0.2em] text-white/56">
                    {nextMatch?.matchName ?? nextMatch?.map ?? "Upcoming Match"}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <div className="rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-4">
                    <div className="text-[10px] uppercase tracking-[0.26em] text-white/42">
                      Break Window
                    </div>
                    <div className="mt-2 text-2xl font-black uppercase tracking-[0.12em] text-white">
                      {formatRelativeCountdown(nextMatch?.startsAt, now)}
                    </div>
                  </div>
                  <div className="rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-4">
                    <div className="text-[10px] uppercase tracking-[0.26em] text-white/42">
                      Previous Match
                    </div>
                    <div className="mt-2 text-lg font-bold uppercase tracking-[0.12em] text-white">
                      {previousMatch
                        ? formatMatchNumber(previousMatch.matchNumber ?? null)
                        : "Live desk reset"}
                    </div>
                    <div className="mt-2 text-[11px] uppercase tracking-[0.22em] text-white/48">
                      {previousMatch?.map ?? "Stand by for the next lobby"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Frame>
    </WidgetStage>
  );
}

export function TeamStatusOrgWidget({ orgSlug }: { orgSlug: string }) {
  const runtime = useOrganizerWidgetRuntime(orgSlug, "team-status");
  const match = runtime.match;
  const state = runtime.state;

  if (runtime.widgetAccessDenied) {
    return (
      <WaitingState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Team Status is not approved for this organization."
      />
    );
  }

  if (!state && !runtime.preview) {
    return (
      <WaitingState
        runtime={runtime}
        title="WAITING"
        subtitle="Team Status needs live match-state packets before it can render."
      />
    );
  }

  const rows = (state?.leaderboard ?? PREVIEW_STATE.leaderboard)
    .slice()
    .sort((left, right) => left.rank - right.rank)
    .slice(0, 10);

  return (
    <WidgetStage runtime={runtime} align="end">
      <Frame
        runtime={runtime}
        tone={runtime.branding.primaryColor}
        className="w-[760px] rounded-[34px] px-5 py-5"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/8 pb-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.34em] text-white/42">
              Team Status
            </div>
            <div className="mt-2 text-3xl font-black uppercase tracking-[0.16em] text-white">
              {formatMatchNumber(match?.matchNumber ?? null)}
            </div>
          </div>
          <div className="flex gap-2">
            <StatusPill color={runtime.branding.primaryColor}>
              {(state?.teamsAlive ?? PREVIEW_STATE.teamsAlive)} teams alive
            </StatusPill>
            <StatusPill color={runtime.branding.accent}>
              {formatTimestamp(runtime.lastEventAt)}
            </StatusPill>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-[70px_minmax(0,1fr)_86px_86px_104px] gap-3 px-4 text-[10px] font-semibold uppercase tracking-[0.26em] text-white/38">
          <div>Rank</div>
          <div>Team</div>
          <div className="text-center">Kills</div>
          <div className="text-center">Alive</div>
          <div className="text-right">Status</div>
        </div>

        <div className="mt-3 space-y-2">
          {rows.map((row) => {
            const color = row.color ?? runtime.branding.primaryColor;
            const statusLabel = row.isEliminated ? "Eliminated" : "In Play";

            return (
              <div
                key={`${row.teamId ?? row.teamName}-${row.rank}`}
                className="grid grid-cols-[70px_minmax(0,1fr)_86px_86px_104px] items-center gap-3 rounded-[22px] border px-4 py-3"
                style={{
                  borderColor: alphaColor(color, 0.18),
                  background: `linear-gradient(90deg, ${alphaColor(
                    color,
                    row.isEliminated ? 0.08 : 0.18,
                  )}, rgba(255,255,255,0.03))`,
                }}
              >
                <div className="text-2xl font-black text-white">{row.rank}</div>
                <div className="flex min-w-0 items-center gap-3">
                  <TeamLogo
                    logoUrl={row.logoUrl}
                    label={formatTeamLabel(row.teamTag, row.teamName, row.slot)}
                    color={color}
                    size={42}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold uppercase tracking-[0.14em] text-white">
                      {formatTeamLabel(row.teamTag, row.teamName, row.slot)}
                    </div>
                    <div className="truncate text-xs uppercase tracking-[0.22em] text-white/45">
                      {formatSlot(row.slot)} / {row.teamName}
                    </div>
                  </div>
                </div>
                <div className="text-center text-xl font-black text-white">{row.kills}</div>
                <div className="text-center text-xl font-black text-white">{row.alivePlayers}</div>
                <div className="flex justify-end">
                  <StatusPill color={row.isEliminated ? "#ef4444" : color}>
                    {statusLabel}
                  </StatusPill>
                </div>
              </div>
            );
          })}
        </div>
      </Frame>
    </WidgetStage>
  );
}

export function MatchResultsOrgWidget({ orgSlug }: { orgSlug: string }) {
  const runtime = useOrganizerWidgetRuntime(orgSlug, "match-results", {
    skipActiveMatch: true,
  });
  const breakdown = useOrganizerPostMatchPointsBreakdown(orgSlug, runtime);
  const match = breakdown.match ?? runtime.match;
  const payload = breakdown.payload;
  const rows = payload?.rows ?? [];
  const reasons = payload?.state.reasons ?? [];

  if (runtime.widgetAccessDenied) {
    return (
      <WaitingState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Match Results is not approved for this organization."
      />
    );
  }

  if (!payload || rows.length === 0) {
    const subtitle =
      breakdown.error ??
      (reasons.includes("TRIGGER_NOT_MET")
        ? "Match Results appears once telemetry confirms the last team alive."
        : "Match Results is waiting for finalized placement and total points.");

    return (
      <WaitingState
        runtime={runtime}
        title="WAITING"
        subtitle={subtitle}
      />
    );
  }

  const winner = rows[0] ?? null;
  const winnerTone =
    winner?.brandLight?.primaryColor ??
    winner?.brandDark?.primaryColor ??
    runtime.branding.primaryColor;
  const tone = runtime.branding.primaryColor;
  const splitIndex = Math.ceil(rows.length / 2);
  const columns = [rows.slice(0, splitIndex), rows.slice(splitIndex)].filter(
    (column) => column.length > 0,
  );
  const updatedAtLabel = formatTimestamp(payload.state.lastUpdateIso ?? runtime.lastEventAt);

  return (
    <WidgetStage runtime={runtime} align="center">
      <Frame
        runtime={runtime}
        tone={tone}
        backgroundMode="transparent"
        className="self-center w-full max-w-[1480px] rounded-[36px] px-7 py-7 sm:px-8 sm:py-8"
      >
        <div className="flex h-full flex-col">
          <div className="flex flex-wrap items-start justify-between gap-5 border-b border-white/8 pb-5">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.34em] text-[var(--vx-muted)]">
                Match Results
              </div>
              <div className="mt-2 text-3xl font-black uppercase tracking-[0.16em] text-[var(--vx-text)] sm:text-4xl">
                {formatMatchNumber(match?.matchNumber ?? null)}
              </div>
              <div className="mt-2 text-sm uppercase tracking-[0.24em] text-[var(--vx-muted)]">
                {(match?.tournamentName ?? "Tournament")} / {(match?.map ?? "Map")} / {updatedAtLabel}
              </div>
            </div>

            <div
              className="flex min-w-[340px] max-w-full items-center gap-4 rounded-[24px] border px-4 py-3"
              style={{
                borderColor: "var(--vx-border)",
                background:
                  "linear-gradient(90deg, color-mix(in srgb, var(--vx-accent) 24%, transparent), color-mix(in srgb, var(--vx-bg-base) 24%, transparent) 54%, transparent)",
              }}
            >
              <TeamLogo
                logoUrl={winner?.teamLogoUrl}
                label={formatTeamLabel(winner?.teamTag, winner?.teamName, winner?.slot)}
                color={winnerTone}
                size={60}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-semibold uppercase tracking-[0.34em] text-[var(--vx-muted)]">
                  Winner
                </div>
                <div className="mt-1 truncate text-xl font-black uppercase tracking-[0.12em] text-[var(--vx-text)]">
                  {winner?.teamName ?? winner?.teamTag ?? "Awaiting Result"}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <StatusPill color={winnerTone}>
                    {winner?.teamTag ?? formatSlot(winner?.slot)}
                  </StatusPill>
                  <StatusPill color={runtime.branding.accent}>
                    {winner?.kills ?? 0} kills
                  </StatusPill>
                  <StatusPill color={runtime.branding.accent}>
                    {formatWholeNumber(winner?.totalPoints)} total
                  </StatusPill>
                </div>
              </div>
            </div>
          </div>

          <div
            className={`mt-6 grid gap-5 ${columns.length > 1 ? "xl:grid-cols-2" : "grid-cols-1"}`}
          >
            {columns.map((columnRows, columnIndex) => (
              <div
                key={`results-column-${columnIndex}`}
                className="rounded-[28px] border px-4 py-4 sm:px-5"
                style={{
                  borderColor: "var(--vx-border)",
                  background: "transparent",
                }}
              >
                <div className="grid grid-cols-[56px_minmax(0,1fr)_78px_92px_86px] gap-3 px-3 text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--vx-muted)]">
                  <div>Rank</div>
                  <div>Team</div>
                  <div className="text-center">Kills</div>
                  <div className="text-center">Placement</div>
                  <div className="text-right">Total</div>
                </div>

                <div className="mt-3 space-y-2">
                  {columnRows.map((row) => {
                    const color =
                      row.brandLight?.primaryColor ??
                      row.brandDark?.primaryColor ??
                      runtime.branding.primaryColor;
                    return (
                      <div
                        key={row.teamId}
                        className="grid grid-cols-[56px_minmax(0,1fr)_78px_92px_86px] items-center gap-3 rounded-[20px] border px-3 py-2.5"
                        style={{
                          borderColor: "var(--vx-border)",
                          background:
                            row.rank === 1
                              ? "linear-gradient(90deg, color-mix(in srgb, var(--vx-accent) 18%, transparent), color-mix(in srgb, var(--vx-bg-base) 30%, transparent) 56%, transparent)"
                              : "linear-gradient(90deg, color-mix(in srgb, var(--vx-primary) 10%, transparent), color-mix(in srgb, var(--vx-bg-base) 26%, transparent) 56%, transparent)",
                        }}
                      >
                        <div className="text-[28px] font-black leading-none text-[var(--vx-text)]">
                          {row.rank}
                        </div>
                        <div className="flex min-w-0 items-center gap-3">
                          <TeamLogo
                            logoUrl={row.teamLogoUrl}
                            label={formatTeamLabel(row.teamTag, row.teamName, row.slot)}
                            color={color}
                            size={36}
                          />
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-semibold uppercase tracking-[0.14em] text-[var(--vx-text)]">
                              {row.teamName ?? formatTeamLabel(row.teamTag, row.teamName, row.slot)}
                            </div>
                            <div className="truncate text-[10px] uppercase tracking-[0.22em] text-[var(--vx-muted)]">
                              {row.teamTag ?? formatSlot(row.slot)} / finish #
                              {formatWholeNumber(row.placement ?? row.rank)}
                            </div>
                          </div>
                        </div>
                        <div className="text-center text-[20px] font-black text-[var(--vx-text)]">
                          {formatWholeNumber(row.kills)}
                        </div>
                        <div className="text-center text-[20px] font-black text-[var(--vx-text)]">
                          {formatWholeNumber(row.placementPoints)}
                        </div>
                        <div className="text-right">
                          <div className="text-[28px] font-black leading-none text-[var(--vx-text)]">
                            {formatWholeNumber(row.totalPoints)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Frame>
    </WidgetStage>
  );
}

export function MatchSummaryOrgWidget({ orgSlug }: { orgSlug: string }) {
  const runtime = useOrganizerWidgetRuntime(orgSlug, "match-summary", {
    skipActiveMatch: true,
  });
  const summary = useOrganizerMatchResultSummary(orgSlug, runtime);
  const summaryMatch = summary.match ?? runtime.match;
  const payload = summary.payload;
  const stats = payload?.stats ?? null;
  const reasons = payload?.state.reasons ?? [];
  const tone = runtime.branding.primaryColor;
  const accent = runtime.branding.accent;

  if (runtime.widgetAccessDenied) {
    return (
      <WaitingState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Match Summary is not approved for this organization."
      />
    );
  }

  if (!payload || !stats) {
    const subtitle =
      summary.error ??
      (reasons.includes("TRIGGER_NOT_MET")
        ? "Match Summary becomes available as soon as the final team is locked."
        : "Match Summary is waiting for post-match totals and end-state telemetry.");

    return (
      <WaitingState
        runtime={runtime}
        title="WAITING"
        subtitle={subtitle}
      />
    );
  }

  const statCards = [
    {
      label: "Total Knocks",
      value: formatWholeNumber(stats.totalKnocks),
      note: "all player knock events",
      color: accent,
    },
    {
      label: "Total Assists",
      value: formatWholeNumber(stats.totalAssists),
      note: "support conversions",
      color: tone,
    },
    {
      label: "Grenade Kills",
      value: formatWholeNumber(stats.grenadeKills),
      note: "explosive finishes",
      color: accent,
    },
    {
      label: "Vehicle Kills",
      value: formatWholeNumber(stats.vehicleKills),
      note: "drive-by or crush kills",
      color: tone,
    },
  ];

  const summaryChips = [
    {
      label: "Duration",
      value: formatDurationClock(stats.matchDurationSeconds),
    },
    {
      label: "Teams",
      value: formatWholeNumber(stats.totalTeams),
    },
    {
      label: "Damage",
      value: formatWholeNumber(stats.totalDamage),
    },
  ];
  const detailsStatusLabel =
    payload.state.status
      ? formatStatus(payload.state.status)
      : summaryMatch?.status
        ? formatStatus(summaryMatch.status)
        : getOrganizerRuntimeStatusLabel(runtime.control);

  return (
    <WidgetStage runtime={runtime} align="center">
      <Frame
        runtime={runtime}
        tone={tone}
        backgroundMode="transparent"
        className="self-center flex min-h-[760px] w-full max-w-[1500px] flex-col justify-center rounded-[40px] px-8 py-8 sm:px-10 sm:py-10"
      >
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-5 border-b border-white/8 pb-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.36em] text-white/42">
                Match Summary
              </div>
              <div className="mt-3 text-5xl font-black uppercase tracking-[0.16em] text-white">
                {payload.header.match ?? formatMatchNumber(summaryMatch?.matchNumber ?? null)}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusPill color={tone}>
                  {payload.header.tournament ?? summaryMatch?.tournamentName ?? "Tournament"}
                </StatusPill>
                {summaryMatch?.stageName ? (
                  <StatusPill color={accent}>{summaryMatch.stageName}</StatusPill>
                ) : null}
                {payload.header.map ? (
                  <StatusPill color={tone}>{payload.header.map}</StatusPill>
                ) : null}
              </div>
            </div>

            <div
              className="rounded-[28px] border px-5 py-4 text-right sm:min-w-[260px]"
              style={{
                borderColor: alphaColor(accent, 0.2),
                background: `linear-gradient(135deg, ${alphaColor(
                  accent,
                  0.12,
                )}, rgba(255,255,255,0.03))`,
              }}
            >
              <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/42">
                Final Totals
              </div>
              <div className="mt-3 text-2xl font-black uppercase tracking-[0.16em] text-white">
                Match Details
              </div>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <StatusPill color={accent}>{detailsStatusLabel}</StatusPill>
                <StatusPill color={tone}>
                  {formatTimestamp(payload.state.lastUpdateIso ?? runtime.lastEventAt)}
                </StatusPill>
              </div>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
            <div
              className="relative overflow-hidden rounded-[34px] border px-8 py-8"
              style={{
                borderColor: alphaColor(tone, 0.24),
                background: [
                  `radial-gradient(circle at 22% 18%, ${alphaColor(
                    tone,
                    0.34,
                  )}, transparent 34%)`,
                  `radial-gradient(circle at 82% 20%, ${alphaColor(
                    accent,
                    0.22,
                  )}, transparent 28%)`,
                  `linear-gradient(135deg, ${alphaColor(
                    tone,
                    0.2,
                  )}, rgba(255,255,255,0.03))`,
                ].join(", "),
                boxShadow: `0 32px 110px ${alphaColor(tone, 0.16)}`,
              }}
            >
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
              <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/42">
                Match Totals
              </div>
              <div className="mt-6 text-[92px] font-black uppercase leading-[0.88] tracking-[0.12em] text-white sm:text-[116px]">
                {formatWholeNumber(stats.totalKills)}
              </div>
              <div className="mt-4 text-lg uppercase tracking-[0.34em] text-white/60">
                Total Kills Recorded
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {summaryChips.map((chip, index) => {
                  const chipTone = index % 2 === 0 ? tone : accent;

                  return (
                    <div
                      key={chip.label}
                      className="rounded-[24px] border px-4 py-4"
                      style={{
                        borderColor: alphaColor(chipTone, 0.2),
                        background: `linear-gradient(180deg, ${alphaColor(
                          chipTone,
                          0.16,
                        )}, rgba(255,255,255,0.03))`,
                      }}
                    >
                      <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/42">
                        {chip.label}
                      </div>
                      <div className="mt-3 text-3xl font-black uppercase tracking-[0.12em] text-white">
                        {chip.value}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {statCards.map((card) => (
                <div
                  key={card.label}
                  className="rounded-[28px] border px-5 py-5"
                  style={{
                    borderColor: alphaColor(card.color, 0.2),
                    background: `linear-gradient(135deg, ${alphaColor(
                      card.color,
                      0.16,
                    )}, rgba(255,255,255,0.03))`,
                  }}
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/42">
                    {card.label}
                  </div>
                  <div className="mt-4 text-5xl font-black uppercase tracking-[0.12em] text-white">
                    {card.value}
                  </div>
                  <div className="mt-3 text-[11px] uppercase tracking-[0.22em] text-white/48">
                    {card.note}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {payload.highlights.length > 0 ? (
            <div className="grid gap-4 xl:grid-cols-3">
              {payload.highlights.slice(0, 3).map((highlight, index) => {
                const cardTone = index % 2 === 0 ? accent : tone;

                return (
                  <div
                    key={`${highlight.title}-${highlight.name}`}
                    className="rounded-[28px] border px-5 py-5"
                    style={{
                      borderColor: alphaColor(cardTone, 0.2),
                      background: `linear-gradient(135deg, ${alphaColor(
                        cardTone,
                        0.14,
                      )}, rgba(255,255,255,0.03))`,
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/42">
                        {highlight.title}
                      </div>
                      <StatusPill color={cardTone}>
                        {highlight.detail ?? highlight.kind}
                      </StatusPill>
                    </div>
                    <div className="mt-4 text-2xl font-black uppercase tracking-[0.12em] text-white">
                      {highlight.name}
                    </div>
                    <div className="mt-4 text-5xl font-black uppercase tracking-[0.14em] text-white">
                      {formatWholeNumber(highlight.value)}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </Frame>
    </WidgetStage>
  );
}

export function HeadToHeadComparisonOrgWidget({ orgSlug }: { orgSlug: string }) {
  const runtime = useOrganizerWidgetRuntime(orgSlug, "head-to-head-comparison", {
    skipActiveMatch: true,
  });
  const breakdown = useOrganizerPostMatchPointsBreakdown(orgSlug, runtime);
  const payload = breakdown.payload;
  const match = breakdown.match;
  const rows = (runtime.preview
    ? PREVIEW_POST_MATCH_POINTS_BREAKDOWN.rows
    : payload?.rows ?? []
  )
    .slice()
    .sort((left, right) => left.rank - right.rank);
  const winnerConfirmed =
    runtime.preview || payload?.state.resultFinalized === true;
  const winnerRow = rows[0] ?? null;
  const challengerRow = rows[1] ?? null;

  if (runtime.widgetAccessDenied) {
    return (
      <WaitingState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Head to Head Comparison is not approved for this organization."
      />
    );
  }

  if (!winnerConfirmed || !winnerRow || !challengerRow) {
    return (
      <WaitingState
        runtime={runtime}
        title="WAITING"
        subtitle="Head to Head Comparison appears once finalized post-match results lock the winner and runner-up."
      />
    );
  }

  const tone =
    winnerRow.brandLight?.primaryColor ??
    winnerRow.brandDark?.primaryColor ??
    runtime.branding.primaryColor;
  const accent =
    challengerRow.brandLight?.primaryColor ??
    challengerRow.brandDark?.primaryColor ??
    runtime.branding.accent;
  const leftName = winnerRow.teamName ?? winnerRow.teamTag ?? "Winner";
  const leftTag = winnerRow.teamTag;
  const leftLogo = winnerRow.teamLogoUrl;
  const leftKills = winnerRow.kills;
  const leftPlacement = winnerRow.placement ?? winnerRow.rank;
  const leftPlacementPoints = winnerRow.placementPoints;
  const leftTotalPoints = winnerRow.totalPoints;

  const rightName = challengerRow.teamName ?? challengerRow.teamTag ?? "Runner-Up";
  const rightTag = challengerRow.teamTag;
  const rightLogo = challengerRow.teamLogoUrl;
  const rightKills = challengerRow.kills;
  const rightPlacement = challengerRow.placement ?? challengerRow.rank;
  const rightPlacementPoints = challengerRow.placementPoints;
  const rightTotalPoints = challengerRow.totalPoints;

  const metrics = [
    {
      label: "Kills",
      left: leftKills,
      right: rightKills,
      mode: "higher" as const,
    },
    {
      label: "Placement",
      left: leftPlacement,
      right: rightPlacement,
      mode: "lower" as const,
    },
    {
      label: "Place Pts",
      left: leftPlacementPoints,
      right: rightPlacementPoints,
      mode: "higher" as const,
    },
    {
      label: "Total Pts",
      left: leftTotalPoints,
      right: rightTotalPoints,
      mode: "higher" as const,
    },
  ];

  return (
    <WidgetStage runtime={runtime} align="center">
      <Frame
        runtime={runtime}
        tone={tone}
        backgroundMode="transparent"
        className="self-center flex min-h-[760px] w-full max-w-[1520px] flex-col justify-center rounded-[40px] px-8 py-8 sm:px-10 sm:py-10"
      >
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-5 border-b border-white/8 pb-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.36em] text-white/42">
                Head To Head Comparison
              </div>
              <div className="mt-3 text-5xl font-black uppercase tracking-[0.16em] text-white">
                {formatMatchNumber(
                  match?.matchNumber ?? payload?.header.matchLabel ?? null,
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusPill color={tone}>
                  {match?.tournamentName ?? payload?.header.tournament ?? "Tournament"}
                </StatusPill>
                {(match?.stageName ?? payload?.header.stage) ? (
                  <StatusPill color={accent}>
                    {match?.stageName ?? payload?.header.stage}
                  </StatusPill>
                ) : null}
                {(match?.map ?? payload?.header.map) ? (
                  <StatusPill color={tone}>{match?.map ?? payload?.header.map}</StatusPill>
                ) : null}
                <StatusPill color={accent}>Results Finalized</StatusPill>
              </div>
            </div>

            <div
              className="rounded-[28px] border px-5 py-4 text-right sm:min-w-[280px]"
              style={{
                borderColor: alphaColor(accent, 0.2),
                background: `linear-gradient(135deg, ${alphaColor(
                  accent,
                  0.12,
                )}, rgba(255,255,255,0.03))`,
              }}
            >
              <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/42">
                Source
              </div>
              <div className="mt-3 text-2xl font-black uppercase tracking-[0.16em] text-white">
                Final Results
              </div>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <StatusPill color={accent}>Saved Standings</StatusPill>
                <StatusPill color={tone}>
                  {formatTimestamp(
                    payload?.state.finalizedAt ??
                      payload?.state.lastUpdateIso ??
                      runtime.lastEventAt,
                  )}
                </StatusPill>
              </div>
            </div>
          </div>

          <div className="grid items-stretch gap-6 xl:grid-cols-[minmax(0,1fr)_176px_minmax(0,1fr)]">
            <div
              className="rounded-[34px] border px-7 py-7"
              style={{
                borderColor: alphaColor(tone, 0.22),
                background: `radial-gradient(circle at 22% 18%, ${alphaColor(
                  tone,
                  0.24,
                )}, rgba(255,255,255,0.03) 64%)`,
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/42">
                  Winner
                </div>
                <StatusPill color={tone}>Rank #{leftPlacement}</StatusPill>
              </div>
              <div className="mt-8 flex items-center gap-5">
                <TeamLogo
                  logoUrl={leftLogo}
                  label={formatTeamLabel(leftTag, leftName, winnerRow.slot)}
                  color={tone}
                  size={92}
                />
                <div className="min-w-0">
                  <div className="truncate text-4xl font-black uppercase tracking-[0.14em] text-white">
                    {leftName}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <StatusPill color={tone}>
                      {formatTeamLabel(leftTag, leftName, winnerRow.slot)}
                    </StatusPill>
                    <StatusPill color={accent}>{leftKills} kills</StatusPill>
                    <StatusPill color={tone}>{leftTotalPoints} pts</StatusPill>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center justify-center gap-5">
              <div
                className="flex h-[132px] w-[132px] items-center justify-center rounded-full border text-5xl font-black uppercase tracking-[0.18em] text-white"
                style={{
                  borderColor: alphaColor(accent, 0.24),
                  background: `radial-gradient(circle at 50% 50%, ${alphaColor(
                    accent,
                    0.24,
                  )}, rgba(255,255,255,0.03) 68%)`,
                  boxShadow: `0 0 44px ${alphaColor(accent, 0.16)}`,
                }}
              >
                VS
              </div>
              <div className="text-center text-[11px] uppercase tracking-[0.34em] text-white/48">
                Final Placement Faceoff
              </div>
            </div>

            <div
              className="rounded-[34px] border px-7 py-7"
              style={{
                borderColor: alphaColor(accent, 0.22),
                background: `radial-gradient(circle at 78% 18%, ${alphaColor(
                  accent,
                  0.24,
                )}, rgba(255,255,255,0.03) 64%)`,
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/42">
                  Runner-Up
                </div>
                <StatusPill color={accent}>Rank #{rightPlacement}</StatusPill>
              </div>
              <div className="mt-8 flex items-center gap-5">
                <TeamLogo
                  logoUrl={rightLogo}
                  label={formatTeamLabel(rightTag, rightName, challengerRow.slot)}
                  color={accent}
                  size={92}
                />
                <div className="min-w-0">
                  <div className="truncate text-4xl font-black uppercase tracking-[0.14em] text-white">
                    {rightName}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <StatusPill color={accent}>
                      {formatTeamLabel(rightTag, rightName, challengerRow.slot)}
                    </StatusPill>
                    <StatusPill color={tone}>{rightKills} kills</StatusPill>
                    <StatusPill color={accent}>{rightTotalPoints} pts</StatusPill>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            className="rounded-[32px] border px-6 py-6"
            style={{
              borderColor: alphaColor(tone, 0.18),
              background: [
                `linear-gradient(135deg, ${alphaColor(tone, 0.06)}, transparent 56%)`,
                `linear-gradient(180deg, ${alphaColor(
                  runtime.branding.effectiveBackground,
                  0.18,
                )}, rgba(255,255,255,0.02))`,
              ].join(", "),
            }}
          >
            <div className="grid grid-cols-[minmax(0,1fr)_200px_minmax(0,1fr)] gap-4 px-4 text-[10px] font-semibold uppercase tracking-[0.3em] text-white/38">
              <div className="text-left">Winner</div>
              <div className="text-center">Metric</div>
              <div className="text-right">Runner-Up</div>
            </div>

            <div className="mt-4 space-y-3">
              {metrics.map((metric) => {
                const leftLead =
                  Number.isFinite(metric.left ?? Number.NaN) &&
                  Number.isFinite(metric.right ?? Number.NaN) &&
                  (metric.mode === "lower"
                    ? (metric.left ?? 0) < (metric.right ?? 0)
                    : (metric.left ?? 0) > (metric.right ?? 0));
                const rightLead =
                  Number.isFinite(metric.left ?? Number.NaN) &&
                  Number.isFinite(metric.right ?? Number.NaN) &&
                  (metric.mode === "lower"
                    ? (metric.right ?? 0) < (metric.left ?? 0)
                    : (metric.right ?? 0) > (metric.left ?? 0));

                return (
                  <div
                    key={metric.label}
                    className="grid grid-cols-[minmax(0,1fr)_200px_minmax(0,1fr)] items-center gap-4 rounded-[22px] border px-4 py-4"
                    style={{
                      borderColor: alphaColor(
                        leftLead ? tone : rightLead ? accent : runtime.branding.primaryColor,
                        0.16,
                      ),
                      background: `linear-gradient(90deg, ${alphaColor(
                        tone,
                        0.08,
                      )}, rgba(255,255,255,0.02), ${alphaColor(accent, 0.08)})`,
                    }}
                  >
                    <div
                      className="text-left text-4xl font-black uppercase tracking-[0.14em]"
                      style={{ color: leftLead ? "#ffffff" : "rgba(255,255,255,0.7)" }}
                    >
                      {formatWholeNumber(metric.left)}
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/42">
                        {metric.label}
                      </div>
                    </div>
                    <div
                      className="text-right text-4xl font-black uppercase tracking-[0.14em]"
                      style={{ color: rightLead ? "#ffffff" : "rgba(255,255,255,0.7)" }}
                    >
                      {formatWholeNumber(metric.right)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Frame>
    </WidgetStage>
  );
}

export function WinnerCelebrationOrgWidget({ orgSlug }: { orgSlug: string }) {
  const runtime = useOrganizerWidgetRuntime(orgSlug, "winner-celebration");
  const match = runtime.match;
  const state = runtime.state;
  const postMatchConfirmed = isOrganizerPostMatchConfirmed(runtime);
  const podium = (
    runtime.preview ? PREVIEW_STATE.leaderboard : state?.leaderboard ?? []
  )
    .slice()
    .sort((left, right) => left.rank - right.rank)
    .slice(0, 3);
  const winner =
    (runtime.preview ? PREVIEW_STATE.winner : state?.winner) ??
    toWinnerFromLeaderboardRow(podium[0]) ??
    null;

  if (runtime.widgetAccessDenied) {
    return (
      <WaitingState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Winner Celebration is not approved for this organization."
      />
    );
  }

  if (!postMatchConfirmed) {
    return (
      <WaitingState
        runtime={runtime}
        title="WAITING"
        subtitle="Winner Celebration becomes active once telemetry confirms the last team alive."
      />
    );
  }

  if (!winner && !runtime.preview) {
    return (
      <WaitingState
        runtime={runtime}
        title="WAITING"
        subtitle="Winner Celebration becomes active once a match winner is available."
      />
    );
  }

  const tone = winner?.color ?? runtime.branding.accent;

  return (
    <WidgetStage runtime={runtime} align="center">
      <Frame
        runtime={runtime}
        tone={tone}
        backgroundMode="transparent"
        className="w-full max-w-6xl rounded-[38px] px-8 py-8"
      >
        <div className="grid items-stretch gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div
            className="rounded-[30px] border px-7 py-7"
            style={{
              borderColor: alphaColor(tone, 0.26),
              background: `radial-gradient(circle at top, ${alphaColor(
                tone,
                0.24,
              )}, rgba(255,255,255,0.03) 66%)`,
              boxShadow: `0 0 32px ${alphaColor(tone, 0.16)}`,
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.34em] text-white/42">
                Winner Celebration
              </div>
              <StatusPill color={runtime.branding.accent}>
                {getOrganizerRuntimeStatusLabel(
                  runtime.control,
                  runtime.preview ? match : null,
                )}
              </StatusPill>
            </div>

            <div className="mt-8 flex justify-center">
              <TeamLogo
                logoUrl={winner?.logoUrl}
                label={formatTeamLabel(winner?.teamTag, winner?.teamName, winner?.slot)}
                color={tone}
                size={112}
              />
            </div>

            <div className="mt-6 text-center text-4xl font-black uppercase tracking-[0.16em] text-white">
              {winner?.teamName ?? "Awaiting winner"}
            </div>
            <div className="mt-3 text-center text-sm uppercase tracking-[0.26em] text-white/56">
              {(match?.tournamentName ?? "Tournament")} / {formatMatchNumber(match?.matchNumber ?? null)}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <StatusPill color={tone}>
                {winner?.teamTag ?? formatSlot(winner?.slot)}
              </StatusPill>
              <StatusPill color={runtime.branding.accent}>
                {winner?.kills ?? 0} kills
              </StatusPill>
              <StatusPill color={runtime.branding.primaryColor}>
                Place #{winner?.placement ?? 1}
              </StatusPill>
            </div>
          </div>

          <div className="rounded-[30px] border border-white/10 bg-white/[0.03] px-6 py-6">
            <div className="flex items-start justify-between gap-4 border-b border-white/8 pb-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.34em] text-white/42">
                  Final Podium
                </div>
                <div className="mt-2 text-3xl font-black uppercase tracking-[0.14em] text-white">
                  {match?.map ?? "Match Complete"}
                </div>
              </div>
              <div className="text-right text-[11px] uppercase tracking-[0.24em] text-white/48">
                {formatTimestamp(runtime.lastEventAt ?? state?.updatedAt ?? PREVIEW_STATE.updatedAt)}
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {podium.map((row) => {
                const color = row.color ?? runtime.branding.primaryColor;
                const isChampion = row.rank === 1;

                return (
                  <div
                    key={`${row.teamId ?? row.teamName}-${row.rank}`}
                    className="grid grid-cols-[74px_minmax(0,1fr)_90px_90px] items-center gap-3 rounded-[24px] border px-4 py-4"
                    style={{
                      borderColor: alphaColor(color, 0.2),
                      background: isChampion
                        ? `linear-gradient(90deg, ${alphaColor(
                            color,
                            0.22,
                          )}, rgba(255,255,255,0.04))`
                        : `linear-gradient(90deg, ${alphaColor(
                            color,
                            0.1,
                          )}, rgba(255,255,255,0.02))`,
                    }}
                  >
                    <div className="text-3xl font-black text-white">#{row.rank}</div>
                    <div className="flex min-w-0 items-center gap-3">
                      <TeamLogo
                        logoUrl={row.logoUrl}
                        label={formatTeamLabel(row.teamTag, row.teamName, row.slot)}
                        color={color}
                        size={46}
                      />
                      <div className="min-w-0">
                        <div className="truncate text-base font-semibold uppercase tracking-[0.14em] text-white">
                          {formatTeamLabel(row.teamTag, row.teamName, row.slot)}
                        </div>
                        <div className="truncate text-xs uppercase tracking-[0.24em] text-white/48">
                          {row.teamName}
                        </div>
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] uppercase tracking-[0.26em] text-white/42">
                        Kills
                      </div>
                      <div className="mt-1 text-2xl font-black text-white">{row.kills}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-[0.26em] text-white/42">
                        Alive
                      </div>
                      <div className="mt-1 text-2xl font-black text-white">
                        {row.alivePlayers}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Frame>
    </WidgetStage>
  );
}

export function OverallStandingsOrgWidget({ orgSlug }: { orgSlug: string }) {
  const runtime = useOrganizerWidgetRuntime(orgSlug, "overall-standings", {
    skipActiveMatch: true,
  });
  const overall = useOrganizerPostMatchOverall(orgSlug, runtime);
  const overallMatch = overall.match ?? runtime.match;
  const payload = overall.payload;
  const rows = payload?.rows ?? [];
  const reasons = payload?.state.reasons ?? [];

  if (runtime.widgetAccessDenied) {
    return (
      <WaitingState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Overall Standings is not approved for this organization."
      />
    );
  }

  if (!payload || rows.length === 0) {
    const subtitle =
      overall.error ??
      (reasons.includes("TRIGGER_NOT_MET")
        ? "Overall Standings becomes active once the match reaches post-match state."
        : "Overall Standings needs finalized standings data to render.");

    return (
      <WaitingState
        runtime={runtime}
        title="WAITING"
        subtitle={subtitle}
      />
    );
  }

  const tone = runtime.branding.primaryColor;
  const accent = runtime.branding.accent;
  const leader = rows[0] ?? null;
  const splitIndex = Math.ceil(rows.length / 2);
  const columns = [rows.slice(0, splitIndex), rows.slice(splitIndex)].filter(
    (column) => column.length > 0,
  );
  const scopeLabel =
    payload.header.group
      ? "Group Result"
      : payload.header.stage
        ? "Stage Result"
        : "Tournament Result";
  const leaderLabel = leader
    ? formatTeamLabel(leader.teamTag, leader.teamName, leader.slot)
    : "Leader";
  const leaderName = leader?.teamName ?? leaderLabel;
  const leaderSecondary = leader?.teamTag ?? formatSlot(leader?.slot ?? null);
  const maxMatchesPlayed = rows.reduce(
    (max, row) => Math.max(max, row.matchesPlayed ?? 0),
    0,
  );

  return (
    <WidgetStage runtime={runtime} align="center">
      <Frame
        runtime={runtime}
        tone={tone}
        backgroundMode="transparent"
        className="self-center w-full max-w-[1720px] rounded-[36px] px-6 py-5 sm:px-7 sm:py-6"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 border-b border-white/8 pb-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-[0.32em] text-white/42">
                Overall Standings
              </div>
              <div className="mt-2 text-3xl font-black uppercase tracking-[0.12em] text-white sm:text-4xl">
                {payload.header.tournament ?? overallMatch?.tournamentName ?? "Tournament"}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <StatusPill color={tone}>{scopeLabel}</StatusPill>
                {payload.header.stage ? (
                  <StatusPill color={runtime.branding.primaryColor}>
                    {payload.header.stage}
                  </StatusPill>
                ) : null}
                {payload.header.group ? (
                  <StatusPill color={accent}>{payload.header.group}</StatusPill>
                ) : null}
                <StatusPill color={tone}>
                  {payload.header.matchLabel ??
                    formatMatchNumber(overallMatch?.matchNumber ?? null)}
                </StatusPill>
              </div>
            </div>

            <div
              className="flex min-w-[320px] max-w-full items-center gap-3 rounded-[22px] border px-4 py-2.5"
              style={{
                borderColor: "var(--vx-border)",
                background:
                  "linear-gradient(90deg, color-mix(in srgb, var(--vx-accent) 24%, transparent), color-mix(in srgb, var(--vx-bg-base) 24%, transparent) 54%, transparent)",
              }}
            >
              <TeamLogo
                logoUrl={leader?.teamLogoUrl}
                label={leaderLabel}
                color={tone}
                size={52}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[9px] font-semibold uppercase tracking-[0.32em] text-[var(--vx-muted)]">
                  Current Leader
                </div>
                <div className="mt-1 truncate text-lg font-black uppercase tracking-[0.1em] text-[var(--vx-text)]">
                  {leader?.teamName ?? leaderLabel}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <StatusPill color={tone}>{leaderLabel}</StatusPill>
                  <StatusPill color={accent}>
                    {leader ? `${formatWholeNumber(leader.totalPoints)} pts` : "--"}
                  </StatusPill>
                  <StatusPill color={accent}>
                    {payload.state.resultFinalized ? "Finalized" : formatStatus(payload.state.status)}
                  </StatusPill>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <div
              className="rounded-[24px] border px-4 py-3.5"
              style={{
                borderColor: "var(--vx-border)",
                background:
                  "linear-gradient(90deg, color-mix(in srgb, var(--vx-primary) 14%, transparent), color-mix(in srgb, var(--vx-bg-base) 24%, transparent) 56%, transparent)",
              }}
            >
              <div className="text-[9px] font-semibold uppercase tracking-[0.24em] text-[var(--vx-muted)]">
                Leader
              </div>
              <div className="mt-2 truncate text-[28px] font-black uppercase tracking-[0.08em] text-[var(--vx-text)]">
                {leaderName}
              </div>
              <div className="mt-1.5 truncate text-[10px] uppercase tracking-[0.18em] text-[var(--vx-muted)]">
                {leader
                  ? `${leaderSecondary} / ${formatWholeNumber(leader.totalPoints)} total points`
                  : "--"}
              </div>
            </div>

            <div
              className="rounded-[24px] border px-4 py-3.5"
              style={{
                borderColor: "var(--vx-border)",
                background:
                  "linear-gradient(90deg, color-mix(in srgb, var(--vx-accent) 18%, transparent), color-mix(in srgb, var(--vx-bg-base) 24%, transparent) 56%, transparent)",
              }}
            >
              <div className="text-[9px] font-semibold uppercase tracking-[0.24em] text-[var(--vx-muted)]">
                Teams Ranked
              </div>
              <div className="mt-2 text-[28px] font-black uppercase tracking-[0.1em] text-[var(--vx-text)]">
                {formatWholeNumber(rows.length)}
              </div>
              <div className="mt-1.5 text-[10px] uppercase tracking-[0.18em] text-[var(--vx-muted)]">
                {scopeLabel.toLowerCase()} board
              </div>
            </div>

            <div
              className="rounded-[24px] border px-4 py-3.5"
              style={{
                borderColor: "var(--vx-border)",
                background:
                  "linear-gradient(90deg, color-mix(in srgb, var(--vx-primary) 10%, transparent), color-mix(in srgb, var(--vx-bg-base) 24%, transparent) 56%, transparent)",
              }}
            >
              <div className="text-[9px] font-semibold uppercase tracking-[0.24em] text-[var(--vx-muted)]">
                Max Matches
              </div>
              <div className="mt-2 text-[28px] font-black uppercase tracking-[0.1em] text-[var(--vx-text)]">
                {formatWholeNumber(maxMatchesPlayed)}
              </div>
              <div className="mt-1.5 text-[10px] uppercase tracking-[0.18em] text-[var(--vx-muted)]">
                matches counted
              </div>
            </div>
          </div>

          <div
            className={`grid gap-4 ${columns.length > 1 ? "xl:grid-cols-2" : "grid-cols-1"}`}
          >
            {columns.map((columnRows, columnIndex) => (
              <div
                key={`overall-column-${columnIndex}`}
                className="rounded-[24px] border px-3.5 py-3.5 sm:px-4"
                style={{
                  borderColor: "var(--vx-border)",
                  background: "transparent",
                }}
              >
                <div className="grid grid-cols-[48px_minmax(0,1.5fr)_72px_58px_74px_62px_74px] gap-2 px-2.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-[var(--vx-muted)]">
                  <div>Rank</div>
                  <div>Team</div>
                  <div className="text-center">Trend</div>
                  <div className="text-center">Matches</div>
                  <div className="text-center">Place Pts</div>
                  <div className="text-center">Kills</div>
                  <div className="text-right">Pts</div>
                </div>

                <div className="mt-2.5 space-y-1.5">
                  {columnRows.map((row) => {
                    const color =
                      row.brandLight?.primaryColor ??
                      row.brandDark?.primaryColor ??
                      runtime.branding.primaryColor;
                    const trendDelta =
                      row.trend === "UP"
                        ? Math.max((row.previousRank ?? row.rank) - row.rank, 1)
                        : row.trend === "DOWN"
                          ? Math.max(row.rank - (row.previousRank ?? row.rank), 1)
                          : 0;
                    const trendLabel =
                      row.trend === "UP"
                        ? `â†‘ ${trendDelta}`
                        : row.trend === "DOWN"
                          ? `â†“ ${trendDelta}`
                          : "â€¢ 0";
                    const trendColor =
                      row.trend === "UP"
                        ? "#22c55e"
                        : row.trend === "DOWN"
                          ? "#ef4444"
                          : "#94a3b8";

                    return (
                      <div
                        key={row.teamId}
                        className="grid grid-cols-[48px_minmax(0,1.5fr)_72px_58px_74px_62px_74px] items-center gap-2 rounded-[18px] border px-2.5 py-2"
                        style={{
                          borderColor: "var(--vx-border)",
                          background:
                            row.rank === 1
                              ? "linear-gradient(90deg, color-mix(in srgb, var(--vx-accent) 18%, transparent), color-mix(in srgb, var(--vx-bg-base) 30%, transparent) 56%, transparent)"
                              : "linear-gradient(90deg, color-mix(in srgb, var(--vx-primary) 10%, transparent), color-mix(in srgb, var(--vx-bg-base) 26%, transparent) 56%, transparent)",
                        }}
                      >
                        <div className="text-[24px] font-black leading-none text-[var(--vx-text)]">
                          {row.rank}
                        </div>

                        <div className="flex min-w-0 items-center gap-2.5">
                          <TeamLogo
                            logoUrl={row.teamLogoUrl}
                            label={formatTeamLabel(row.teamTag, row.teamName, row.slot)}
                            color={color}
                            size={30}
                          />
                          <div className="min-w-0">
                            <div className="truncate text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--vx-text)]">
                              {row.teamName ?? formatTeamLabel(row.teamTag, row.teamName, row.slot)}
                            </div>
                            <div className="truncate text-[8px] uppercase tracking-[0.08em] text-[var(--vx-muted)]">
                              {row.teamTag ?? formatSlot(row.slot)}
                            </div>
                          </div>
                        </div>

                        <div className="flex justify-center whitespace-nowrap">
                          <span
                            className="inline-flex min-w-[58px] items-center justify-center rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.14em]"
                            style={{
                              color: trendColor,
                              borderColor: alphaColor(trendColor, 0.28),
                              background: alphaColor(trendColor, 0.14),
                            }}
                          >
                            {trendLabel}
                          </span>
                        </div>

                        <div className="text-center text-[20px] font-black text-[var(--vx-text)]">
                          {formatWholeNumber(row.matchesPlayed)}
                        </div>
                        <div className="text-center text-[18px] font-black text-[var(--vx-text)]">
                          {formatWholeNumber(row.placementPoints)}
                        </div>
                        <div className="text-center text-[18px] font-black text-[var(--vx-text)]">
                          {formatWholeNumber(row.totalKills)}
                        </div>
                        <div className="text-right">
                          <div className="text-[8px] uppercase tracking-[0.18em] text-[var(--vx-muted)]">
                            total
                          </div>
                          <div className="mt-0.5 text-[24px] font-black leading-none text-[var(--vx-text)]">
                            {formatWholeNumber(row.totalPoints)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Frame>
    </WidgetStage>
  );
}

export function PointsBreakdownOrgWidget({ orgSlug }: { orgSlug: string }) {
  const runtime = useOrganizerWidgetRuntime(orgSlug, "points-breakdown", {
    skipActiveMatch: true,
  });
  const breakdown = useOrganizerPostMatchPointsBreakdown(orgSlug, runtime);
  const match = breakdown.match ?? runtime.match;
  const payload = breakdown.payload;
  const rows = payload?.rows ?? [];
  const reasons = payload?.state.reasons ?? [];

  if (runtime.widgetAccessDenied) {
    return (
      <WaitingState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="Points Breakdown is not approved for this organization."
      />
    );
  }

  if (!payload || rows.length === 0) {
    const subtitle =
      breakdown.error ??
      (reasons.includes("TRIGGER_NOT_MET")
        ? "Points Breakdown becomes active once post-match results are finalized."
        : "Points Breakdown needs finalized slot results to render.");

    return (
      <WaitingState
        runtime={runtime}
        title="WAITING"
        subtitle={subtitle}
      />
    );
  }

  const tone = runtime.branding.primaryColor;
  const summaryCards = [
    {
      label: "Placement",
      value: payload.summary.placementPointsTotal.toString(),
      note: "placement points distributed",
    },
    {
      label: "Kill Score",
      value: payload.summary.killPointsTotal.toString(),
      note: "elimination points awarded",
    },
    {
      label: "Bonus / Pen",
      value: formatSignedPoints(payload.summary.adjustmentPointsTotal),
      note: "manual adjustments applied",
    },
    {
      label: "Match Total",
      value: payload.summary.totalPointsTotal.toString(),
      note: `${payload.summary.teams} scoring teams`,
    },
  ];

  return (
    <WidgetStage runtime={runtime} align="center">
      <Frame
        runtime={runtime}
        tone={tone}
        backgroundMode="transparent"
        className="w-full max-w-7xl rounded-[38px] px-8 py-8"
      >
        <div className="flex items-start justify-between gap-6 border-b border-white/8 pb-5">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.34em] text-[var(--vx-muted)]">
              Points Breakdown
            </div>
            <div className="mt-2 text-4xl font-black uppercase tracking-[0.14em] text-[var(--vx-text)]">
              {payload.header.tournament ?? runtime.match?.tournamentName ?? "Tournament"}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {payload.header.stage ? (
                <StatusPill color={runtime.branding.primaryColor}>
                  {payload.header.stage}
                </StatusPill>
              ) : null}
              {payload.header.group ? (
                <StatusPill color={runtime.branding.accent}>
                  {payload.header.group}
                </StatusPill>
              ) : null}
              {payload.header.map ? (
                <StatusPill color={tone}>{payload.header.map}</StatusPill>
              ) : null}
              <StatusPill color={runtime.branding.accent}>
                {payload.header.matchLabel ?? formatMatchNumber(match?.matchNumber ?? null)}
              </StatusPill>
            </div>
          </div>

          <div className="text-right">
            <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--vx-muted)]">
              Updated
            </div>
            <div className="mt-2 text-lg font-bold text-[var(--vx-text)]">
              {formatTimestamp(payload.state.lastUpdateIso ?? runtime.lastEventAt)}
            </div>
            <div className="mt-3">
              <StatusPill color={runtime.branding.accent}>
                {payload.state.resultFinalized ? "Finalized" : formatStatus(payload.state.status)}
              </StatusPill>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          {summaryCards.map((card, index) => {
            return (
              <div
                key={card.label}
                className="rounded-[24px] border px-5 py-5"
                style={{
                  borderColor: "var(--vx-border)",
                  background:
                    index % 2 === 0
                      ? "linear-gradient(90deg, color-mix(in srgb, var(--vx-primary) 14%, transparent), color-mix(in srgb, var(--vx-bg-base) 24%, transparent) 56%, transparent)"
                      : "linear-gradient(90deg, color-mix(in srgb, var(--vx-accent) 18%, transparent), color-mix(in srgb, var(--vx-bg-base) 24%, transparent) 56%, transparent)",
                }}
              >
                <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--vx-muted)]">
                  {card.label}
                </div>
                <div className="mt-3 text-4xl font-black uppercase tracking-[0.12em] text-[var(--vx-text)]">
                  {card.value}
                </div>
                <div className="mt-2 text-[11px] uppercase tracking-[0.2em] text-[var(--vx-muted)]">
                  {card.note}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 grid grid-cols-[72px_minmax(0,1fr)_92px_110px_110px_118px_110px] gap-3 px-4 text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--vx-muted)]">
          <div>Rank</div>
          <div>Team</div>
          <div className="text-center">Place</div>
          <div className="text-center">Place Pts</div>
          <div className="text-center">Kill Pts</div>
          <div className="text-center">Adj</div>
          <div className="text-right">Total</div>
        </div>

        <div className="mt-3 space-y-2">
          {rows.slice(0, 8).map((row) => {
            const color =
              row.brandLight?.primaryColor ??
              row.brandDark?.primaryColor ??
              runtime.branding.primaryColor;
            const adjustmentTone =
              row.adjustmentPoints > 0
                ? "#22c55e"
                : row.adjustmentPoints < 0
                  ? "#ef4444"
                  : color;

            return (
              <div
                key={row.teamId}
                className="grid grid-cols-[72px_minmax(0,1fr)_92px_110px_110px_118px_110px] items-center gap-3 rounded-[24px] border px-4 py-4"
                style={{
                  borderColor: "var(--vx-border)",
                  background:
                    row.rank === 1
                      ? "linear-gradient(90deg, color-mix(in srgb, var(--vx-accent) 18%, transparent), color-mix(in srgb, var(--vx-bg-base) 30%, transparent) 56%, transparent)"
                      : "linear-gradient(90deg, color-mix(in srgb, var(--vx-primary) 10%, transparent), color-mix(in srgb, var(--vx-bg-base) 26%, transparent) 56%, transparent)",
                }}
              >
                <div className="text-3xl font-black text-[var(--vx-text)]">#{row.rank}</div>

                <div className="flex min-w-0 items-center gap-3">
                  <TeamLogo
                    logoUrl={row.teamLogoUrl}
                    label={formatTeamLabel(row.teamTag, row.teamName, row.slot)}
                    color={color}
                    size={44}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold uppercase tracking-[0.14em] text-[var(--vx-text)]">
                      {formatTeamLabel(row.teamTag, row.teamName, row.slot)}
                    </div>
                    <div className="truncate text-xs uppercase tracking-[0.24em] text-[var(--vx-muted)]">
                      {row.teamName ?? DEFAULT_WIDGET_TEAM_NAME} / {row.kills} kills
                    </div>
                  </div>
                </div>

                <div className="text-center text-2xl font-black text-[var(--vx-text)]">
                  {row.placement ? `#${row.placement}` : "--"}
                </div>
                <div className="text-center text-2xl font-black text-[var(--vx-text)]">
                  {row.placementPoints}
                </div>
                <div className="text-center text-2xl font-black text-[var(--vx-text)]">
                  {row.killPoints}
                </div>
                <div className="flex justify-center">
                  <StatusPill color={adjustmentTone}>
                    {formatSignedPoints(row.adjustmentPoints)}
                  </StatusPill>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-[0.26em] text-[var(--vx-muted)]">
                    {formatSlot(row.slot)}
                  </div>
                  <div className="mt-1 text-3xl font-black text-[var(--vx-text)]">
                    {row.totalPoints}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Frame>
    </WidgetStage>
  );
}

export function MvpTopFraggerOrgWidget({ orgSlug }: { orgSlug: string }) {
  const runtime = useOrganizerWidgetRuntime(orgSlug, "mvp-top-fragger", {
    skipActiveMatch: true,
  });
  const latestFinished = useOrganizerLatestFinishedMatch(orgSlug, runtime);
  const match = latestFinished.match ?? runtime.match;
  const resolvedMatchId = match?.matchId ?? null;
  const mvp = useOrganizerMvpState(runtime, resolvedMatchId);
  const topFragger = useOrganizerTopFraggerState(runtime, resolvedMatchId);
  const mvpPlayer = mvp.payload?.player ?? null;
  const topPlayer = topFragger.payload?.active ?? null;
  const postMatchConfirmed =
    runtime.preview ||
    isOrganizerPostMatchState(mvp.payload?.matchStatus ?? match?.status);
  const samePlayer =
    Boolean(mvpPlayer?.playerId) &&
    Boolean(topPlayer?.playerId) &&
    mvpPlayer?.playerId === topPlayer?.playerId;

  if (runtime.widgetAccessDenied) {
    return (
      <WaitingState
        runtime={runtime}
        title="APPROVAL REQUIRED"
        subtitle="MVP / Top Fragger is not approved for this organization."
      />
    );
  }

  if (!postMatchConfirmed && !runtime.preview) {
    return (
      <WaitingState
        runtime={runtime}
        title="WAITING"
        subtitle={
          latestFinished.error ??
          "MVP / Top Fragger appears once the latest finished match has saved post-match player results."
        }
      />
    );
  }

  if (!mvpPlayer && !topPlayer && !runtime.preview) {
    return (
      <WaitingState
        runtime={runtime}
        title="WAITING"
        subtitle={
          latestFinished.error ??
          mvp.error ??
          topFragger.error ??
          "MVP / Top Fragger needs finalized player result data to render."
        }
      />
    );
  }

  const heroName = mvpPlayer?.ign ?? topPlayer?.playerName ?? "Feature Player";
  const heroTone =
    runtime.state?.winner?.color ??
    PREVIEW_STATE.winner?.color ??
    runtime.branding.primaryColor;

  return (
    <WidgetStage runtime={runtime} align="center">
      <Frame
        runtime={runtime}
        tone={heroTone}
        backgroundMode="transparent"
        className="w-full max-w-7xl rounded-[38px] px-8 py-8"
      >
        <div className="flex items-start justify-between gap-6 border-b border-white/8 pb-5">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.34em] text-white/42">
              MVP / Top Fragger
            </div>
            <div className="mt-2 text-4xl font-black uppercase tracking-[0.14em] text-white">
              {heroName}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusPill color={heroTone}>
                {match?.tournamentName ?? "Tournament"}
              </StatusPill>
              <StatusPill color={runtime.branding.accent}>
                {formatMatchNumber(match?.matchNumber ?? null)}
              </StatusPill>
              {samePlayer ? (
                <StatusPill color={runtime.branding.primaryColor}>
                  Double Crown
                </StatusPill>
              ) : null}
            </div>
          </div>

          <div className="text-right">
            <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/42">
              Updated
            </div>
            <div className="mt-2 text-lg font-bold text-white">
              {formatTimestamp(
                topFragger.payload?.updatedAt ??
                  match?.endedAt ??
                  runtime.lastEventAt ??
                  PREVIEW_STATE_UPDATED_AT,
              )}
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <StatusPill color={runtime.branding.primaryColor}>
                {mvp.payload?.finalized ? "MVP Finalized" : "MVP Pending"}
              </StatusPill>
              <StatusPill color={runtime.branding.accent}>
                {topFragger.payload?.finalizedAt ? "Fragger Final" : "Fragger Saved"}
              </StatusPill>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div
            className="rounded-[30px] border px-6 py-6"
            style={{
              borderColor: alphaColor(heroTone, 0.24),
              background: `radial-gradient(circle at top, ${alphaColor(
                heroTone,
                0.2,
              )}, rgba(255,255,255,0.03) 68%)`,
            }}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/42">
                  MVP
                </div>
                <div className="mt-2 text-3xl font-black uppercase tracking-[0.14em] text-white">
                  {mvpPlayer?.ign ?? "Awaiting selection"}
                </div>
              </div>
              <StatusPill color={heroTone}>
                {mvpPlayer?.placement ? `Place #${mvpPlayer.placement}` : "Placement TBD"}
              </StatusPill>
            </div>

            {mvpPlayer ? (
              <div className="mt-6 grid items-center gap-5 md:grid-cols-[170px_minmax(0,1fr)]">
                <div className="flex justify-center md:justify-start">
                  <PlayerPortrait
                    photoUrl={mvpPlayer.photoUrl}
                    label={mvpPlayer.ign}
                    color={heroTone}
                    size={150}
                  />
                </div>

                <div>
                  <div className="flex items-center gap-3">
                    <TeamLogo
                      logoUrl={mvpPlayer.teamLogo}
                      label={mvpPlayer.teamName ?? mvpPlayer.ign}
                      color={heroTone}
                      size={46}
                    />
                    <div>
                      <div className="text-sm font-semibold uppercase tracking-[0.18em] text-white">
                        {mvpPlayer.teamName ?? "No team"}
                      </div>
                      <div className="text-[11px] uppercase tracking-[0.24em] text-white/48">
                        Match MVP
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-3 gap-3">
                    <div className="rounded-[20px] border border-white/10 bg-white/[0.03] px-4 py-4 text-center">
                      <div className="text-[10px] uppercase tracking-[0.26em] text-white/40">
                        Kills
                      </div>
                      <div className="mt-1 text-3xl font-black text-white">{mvpPlayer.kills}</div>
                    </div>
                    <div className="rounded-[20px] border border-white/10 bg-white/[0.03] px-4 py-4 text-center">
                      <div className="text-[10px] uppercase tracking-[0.26em] text-white/40">
                        Assists
                      </div>
                      <div className="mt-1 text-3xl font-black text-white">{mvpPlayer.assists}</div>
                    </div>
                    <div className="rounded-[20px] border border-white/10 bg-white/[0.03] px-4 py-4 text-center">
                      <div className="text-[10px] uppercase tracking-[0.26em] text-white/40">
                        Score
                      </div>
                      <div className="mt-1 text-3xl font-black text-white">
                        {mvpPlayer.mvpScore}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-6 rounded-[24px] border border-white/10 bg-white/[0.03] px-5 py-10 text-center text-sm uppercase tracking-[0.24em] text-white/48">
                Awaiting final MVP selection
              </div>
            )}
          </div>

          <div className="rounded-[30px] border border-white/10 bg-white/[0.03] px-6 py-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/42">
                  Top Fragger
                </div>
                <div className="mt-2 text-3xl font-black uppercase tracking-[0.14em] text-white">
                  {topPlayer?.playerName ?? "Awaiting final fragger"}
                </div>
              </div>
              <StatusPill color={runtime.branding.accent}>
                {topPlayer ? `${topPlayer.kills} kills` : "No final leader"}
              </StatusPill>
            </div>

            {topPlayer ? (
              <div className="mt-6 grid items-center gap-5 md:grid-cols-[170px_minmax(0,1fr)]">
                <div className="flex justify-center md:justify-start">
                  <PlayerPortrait
                    photoUrl={topPlayer.playerPhoto}
                    label={topPlayer.playerName}
                    color={runtime.branding.accent}
                    size={150}
                  />
                </div>

                <div>
                  <div className="flex items-center gap-3">
                    <TeamLogo
                      logoUrl={topPlayer.teamLogo}
                      label={topPlayer.teamTag ?? topPlayer.playerName}
                      color={runtime.branding.accent}
                      size={46}
                    />
                    <div>
                      <div className="text-sm font-semibold uppercase tracking-[0.18em] text-white">
                        {topPlayer.teamTag ?? "No tag"}
                      </div>
                      <div className="text-[11px] uppercase tracking-[0.24em] text-white/48">
                        Final Top Fragger
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-3 gap-3">
                    <div className="rounded-[20px] border border-white/10 bg-white/[0.03] px-4 py-4 text-center">
                      <div className="text-[10px] uppercase tracking-[0.26em] text-white/40">
                        Kills
                      </div>
                      <div className="mt-1 text-3xl font-black text-white">{topPlayer.kills}</div>
                    </div>
                    <div className="rounded-[20px] border border-white/10 bg-white/[0.03] px-4 py-4 text-center">
                      <div className="text-[10px] uppercase tracking-[0.26em] text-white/40">
                        Status
                      </div>
                      <div className="mt-2 text-sm font-black uppercase tracking-[0.18em] text-white">
                        {topFragger.payload?.finalizedAt ? "Final" : "Live"}
                      </div>
                    </div>
                    <div className="rounded-[20px] border border-white/10 bg-white/[0.03] px-4 py-4 text-center">
                      <div className="text-[10px] uppercase tracking-[0.26em] text-white/40">
                        Updated
                      </div>
                      <div className="mt-2 text-sm font-black uppercase tracking-[0.12em] text-white">
                        {formatTimestamp(
                          topFragger.payload?.updatedAt ?? PREVIEW_STATE_UPDATED_AT,
                        )}
                      </div>
                    </div>
                  </div>

                  {samePlayer ? (
                    <div className="mt-4 rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3 text-sm uppercase tracking-[0.22em] text-white/68">
                      Same player holds both MVP and top-fragger honors.
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="mt-6 rounded-[24px] border border-white/10 bg-white/[0.03] px-5 py-10 text-center text-sm uppercase tracking-[0.24em] text-white/48">
                Awaiting final top-fragger snapshot
              </div>
            )}
          </div>
        </div>
      </Frame>
    </WidgetStage>
  );
}
