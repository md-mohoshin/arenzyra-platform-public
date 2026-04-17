'use strict';

import type { Prisma, PrismaClient, MatchStatus } from '@prisma/client';
import {
  makeWidgetState,
  sortScoreboardRows,
  type WidgetScoreboardPayload,
  type WidgetTeamSlotRow,
} from './widgets.contract';
import {
  derivePresenceStatus,
  isPresentInMatch,
} from '../../common/results-presence.util';
import { normalizePublicAssetUrl } from '../../common/public-asset-url.util';

export const TEAM_LOGO_PLACEHOLDER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6XcUu0AAAAASUVORK5CYII=';

const upper = (value?: string | null) => (value ?? '').toString().toUpperCase();

const normalizeWidgetAssetUrl = (value?: string | null): string | null => {
  if (!value) return null;
  return value.startsWith('data:') ? value : normalizePublicAssetUrl(value);
};

const asJsonRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const toTimestampMs = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : null;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isEndedState = (value?: string | null) => {
  const v = upper(value);
  return ['ENDED', 'COMPLETED', 'CONFIRMED'].includes(v);
};

export type LogoSource = {
  logoUrl?: string | null;
  logo?: string | null;
  imageUrl?: string | null;
  logoUpdatedAt?: Date | string | number | null;
  updatedAt?: Date | string | number | null;
} | null;

export function resolveTeamLogoUrl(team: LogoSource): string {
  const raw =
    team?.logoUrl ??
    (team as { logo?: string | null } | null)?.logo ??
    (team as { imageUrl?: string | null } | null)?.imageUrl ??
    null;

  if (!raw) return TEAM_LOGO_PLACEHOLDER;
  const normalized = normalizeWidgetAssetUrl(raw);
  if (!normalized) return TEAM_LOGO_PLACEHOLDER;
  const versioned = withVersion(
    normalized,
    team?.logoUpdatedAt ?? team?.updatedAt,
  );
  return versioned ?? normalized ?? TEAM_LOGO_PLACEHOLDER;
}

export type PlayerPhotoSource = {
  photoUrl?: string | null;
  imageUrl?: string | null;
  photoUpdatedAt?: Date | string | number | null;
  updatedAt?: Date | string | number | null;
} | null;

export function resolvePlayerPhotoUrl(
  player: PlayerPhotoSource,
): string | null {
  const raw =
    player?.photoUrl ??
    (player as { imageUrl?: string | null } | null)?.imageUrl ??
    null;
  if (!raw) return null;
  const normalized = normalizeWidgetAssetUrl(raw);
  if (!normalized) return null;
  return (
    withVersion(normalized, player?.photoUpdatedAt ?? player?.updatedAt) ??
    normalized
  );
}

type BrandPreset = {
  logoUrl?: string | null;
  primaryColor?: string | null;
  accent?: string | null;
  text?: string | null;
};

type BrandSelection = {
  brand: BrandPreset;
  fallback: BrandPreset;
  logoUrl: string;
  primaryColor: string | null;
};

type TeamBranding = {
  id: string;
  name: string | null;
  tag: string | null;
  logoUrl?: string | null;
  logoLightUrl?: string | null;
  logoDarkUrl?: string | null;
  accentLight?: string | null;
  textOnLight?: string | null;
  accentDark?: string | null;
  textOnDark?: string | null;
  updatedAt?: Date | string | number | null;
} | null;

type MatchSlot = {
  slotNumber: number;
  team: TeamBranding;
};

type ScoreboardMatch = {
  id: string;
  tournamentId: string | null;
  game: { key: string } | null;
  dataSource: string | null;
  dataMode: string | null;
  status: MatchStatus;
  updatedAt: Date;
  controlState: {
    state: string | null;
    metaJson?: Prisma.JsonValue | null;
  } | null;
  matchSlots: MatchSlot[];
  slotResults: Array<{
    slotNumber: number;
    wasPresentInMatch: boolean | null;
    placement: number | null;
    placementPoints: number | null;
    totalKills: number | null;
    totalPoints: number | null;
    isLocked: boolean;
    team: TeamBranding;
  }>;
};

const canUseSnapshotAliveState = (
  match: ScoreboardMatch,
  state: Record<string, unknown> | null,
): boolean => {
  if (!state) {
    return false;
  }

  const matchEnded =
    isEndedState(match.status) ||
    isEndedState(match.controlState?.state ?? null);
  const snapshotStatus = upper(
    (state.status as string | null | undefined) ?? null,
  );
  if (!matchEnded && ['ENDED', 'LOCKED'].includes(snapshotStatus)) {
    return false;
  }

  if (matchEnded) {
    return true;
  }

  const meta = asJsonRecord(match.controlState?.metaJson);
  const runtime = asJsonRecord(meta?.telemetryRuntime);
  const freshnessMs =
    toTimestampMs(meta?.telemetryUpdatedAt) ??
    toTimestampMs(runtime?.lastAcceptedAt);
  if (freshnessMs === null) {
    return false;
  }

  const snapshotAcceptedAtMs = toTimestampMs(state.telemetryAcceptedAt);
  const snapshotUpdatedAtMs = toTimestampMs(state.updatedAt);
  return (snapshotAcceptedAtMs ?? snapshotUpdatedAtMs ?? -1) >= freshnessMs;
};

export type BrandMode = 'light' | 'dark';
const DEFAULT_BRAND_MODE: BrandMode = 'dark';

const selectBrandPreset = (params: {
  backgroundMode?: BrandMode | null;
  light?: BrandPreset | null;
  dark?: BrandPreset | null;
  updatedAt?: Date | string | number | null;
}): BrandSelection => {
  const mode = params.backgroundMode ?? DEFAULT_BRAND_MODE;
  const light: BrandPreset = {
    logoUrl: params.light?.logoUrl ?? params.dark?.logoUrl ?? null,
    primaryColor:
      params.light?.primaryColor ?? params.dark?.primaryColor ?? null,
    accent: params.light?.accent ?? null,
    text: params.light?.text ?? null,
  };
  const dark: BrandPreset = {
    logoUrl: params.dark?.logoUrl ?? params.light?.logoUrl ?? null,
    primaryColor:
      params.dark?.primaryColor ?? params.light?.primaryColor ?? null,
    accent: params.dark?.accent ?? null,
    text: params.dark?.text ?? null,
  };
  // Dark background => prefer light brand; Light background => prefer dark brand.
  const chosen = mode === 'dark' ? light : dark;
  const fallback = mode === 'dark' ? dark : light;
  const rawLogo =
    normalizeWidgetAssetUrl(chosen.logoUrl) ??
    normalizeWidgetAssetUrl(fallback.logoUrl) ??
    TEAM_LOGO_PLACEHOLDER;
  const logoUrl = withVersion(rawLogo, params.updatedAt) ?? rawLogo;

  return {
    brand: chosen,
    fallback,
    logoUrl,
    primaryColor: chosen.primaryColor ?? fallback.primaryColor ?? null,
  };
};

const deriveAliveTeams = async (
  prisma: PrismaClient,
  match: ScoreboardMatch,
): Promise<number | null> => {
  const snapshot = await prisma.matchStateSnapshot.findUnique({
    where: { matchId: match.id },
    select: { stateJson: true },
  });
  const state =
    snapshot?.stateJson &&
    typeof snapshot.stateJson === 'object' &&
    !Array.isArray(snapshot.stateJson)
      ? (snapshot.stateJson as Record<string, unknown>)
      : null;
  if (canUseSnapshotAliveState(match, state)) {
    const teamsAlive =
      typeof state?.teamsAlive === 'number' && Number.isFinite(state.teamsAlive)
        ? state.teamsAlive
        : null;
    if (teamsAlive !== null) {
      return teamsAlive;
    }
    const teamsRecord =
      state?.teams &&
      typeof state.teams === 'object' &&
      !Array.isArray(state.teams)
        ? (state.teams as Record<string, unknown>)
        : null;
    if (teamsRecord) {
      const count = Object.values(teamsRecord).filter((team) => {
        if (!team || typeof team !== 'object' || Array.isArray(team)) {
          return false;
        }
        const alivePlayers = (team as { alivePlayers?: unknown }).alivePlayers;
        return typeof alivePlayers === 'number' && alivePlayers > 0;
      }).length;
      if (count > 0) {
        return count;
      }
    }
  }

  const players = await prisma.matchSlotPlayerResult.findMany({
    where: { slotResult: { matchId: match.id, wasPresentInMatch: true } },
    select: {
      isAlive: true,
      slotResult: { select: { teamId: true } },
    },
  });
  if (!players.length) return null;
  const teams = new Set<string>();
  for (const p of players) {
    const alive = p.isAlive === true;
    if (!alive) continue;
    const teamId = p.slotResult?.teamId ?? null;
    if (teamId) teams.add(teamId);
  }
  return teams.size || null;
};

/**
 * Build a deterministic snapshot for scoreboard widgets.
 * Does not depend on any frontend concerns.
 */
export async function buildWidgetScoreboardSnapshot(
  prisma: PrismaClient,
  matchId: string,
  opts: { includeLogos?: boolean; brandMode?: BrandMode | null } = {},
): Promise<WidgetScoreboardPayload> {
  // Default to false to avoid selecting branding columns on legacy databases
  const wantLogos = opts.includeLogos ?? false;
  const brandMode = opts.brandMode ?? DEFAULT_BRAND_MODE;

  const logosUsed = wantLogos;
  const match = (await prisma.match.findFirst({
    where: { id: matchId, deletedAt: null },
    select: {
      id: true,
      tournamentId: true,
      game: { select: { key: true } },
      dataSource: true,
      dataMode: true,
      status: true,
      liveState: true,
      updatedAt: true,
      controlState: {
        select: {
          state: true,
          metaJson: true,
        },
      },
      matchSlots: {
        where: { deletedAt: null },
        select: { slotNumber: true, team: { select: { id: true } } },
        orderBy: { slotNumber: 'asc' },
      },
      slotResults: {
        where: { teamId: { not: null } },
        orderBy: [{ placement: 'asc' }, { totalPoints: 'desc' }],
        select: {
          slotNumber: true,
          wasPresentInMatch: true,
          placement: true,
          placementPoints: true,
          totalKills: true,
          totalPoints: true,
          isLocked: true,
          team: {
            select: {
              id: true,
              name: true,
              tag: true,
              logoUrl: logosUsed,
              ...(logosUsed
                ? {
                    logoLightUrl: true,
                    logoDarkUrl: true,
                    accentLight: true,
                    textOnLight: true,
                    accentDark: true,
                    textOnDark: true,
                    updatedAt: true,
                  }
                : {}),
            },
          },
        },
      },
    },
  })) as ScoreboardMatch | null;

  if (!match) {
    return {
      version: 'v1',
      state: makeWidgetState({
        matchId,
        tournamentId: null,
        game: null,
        dataSource: null,
        controlState: null,
        resultsLocked: false,
        hasSlots: false,
        hasSlotResults: false,
        hasPlayerResults: false,
        lastUpdateIso: null,
        reasons: ['MATCH_NOT_FOUND'],
      }),
      rows: [],
    };
  }

  const hasSlots = (match.matchSlots?.length ?? 0) > 0;
  const hasStandings = (match.slotResults?.length ?? 0) > 0;

  const reasons: string[] = [];
  if (hasSlots && !hasStandings) {
    reasons.push('SLOT_RESULTS_MISSING');
  }

  const rows: WidgetTeamSlotRow[] = (match.slotResults ?? []).map((sr, idx) => {
    const brandLight: BrandPreset | null = logosUsed
      ? {
          logoUrl:
            sr.team?.logoLightUrl ??
            sr.team?.logoUrl ??
            sr.team?.logoDarkUrl ??
            null,
          primaryColor: sr.team?.accentLight ?? sr.team?.accentDark ?? null,
          accent: sr.team?.accentLight ?? null,
          text: sr.team?.textOnLight ?? null,
        }
      : null;

    const brandDark: BrandPreset | null = logosUsed
      ? {
          logoUrl:
            sr.team?.logoDarkUrl ??
            sr.team?.logoUrl ??
            sr.team?.logoLightUrl ??
            null,
          primaryColor: sr.team?.accentDark ?? sr.team?.accentLight ?? null,
          accent: sr.team?.accentDark ?? null,
          text: sr.team?.textOnDark ?? null,
        }
      : null;

    const selection: BrandSelection = logosUsed
      ? selectBrandPreset({
          backgroundMode: brandMode,
          light: brandLight,
          dark: brandDark,
          updatedAt: sr.team?.updatedAt ?? match.updatedAt,
        })
      : {
          brand: {},
          fallback: {},
          logoUrl: TEAM_LOGO_PLACEHOLDER,
          primaryColor: null,
        };

    const resolvedBrand: BrandPreset | null = logosUsed
      ? {
          logoUrl: selection.logoUrl,
          primaryColor: selection.primaryColor ?? null,
          accent:
            selection.brand.accent ??
            selection.fallback.accent ??
            selection.primaryColor ??
            null,
          text: selection.brand.text ?? selection.fallback.text ?? null,
        }
      : null;

    const wasPresentInMatch = sr.wasPresentInMatch ?? null;
    const isActiveTeam = isPresentInMatch(wasPresentInMatch);
    const placementPoints = isActiveTeam ? (sr.placementPoints ?? 0) : 0;
    const totalKills = isActiveTeam ? (sr.totalKills ?? 0) : 0;
    const totalPoints = isActiveTeam
      ? (sr.totalPoints ?? placementPoints + totalKills)
      : 0;

    return {
      slot: sr.slotNumber ?? idx + 1,
      teamId: sr.team?.id ?? null,
      teamName: sr.team?.name ?? null,
      teamTag: sr.team?.tag ?? null,
      teamLogoUrl: selection.logoUrl ?? TEAM_LOGO_PLACEHOLDER,
      teamPrimaryColor: selection.primaryColor ?? null,
      // Provide a single resolved brand for both presets to prevent widget-side switching.
      brandLight: resolvedBrand,
      brandDark: resolvedBrand,
      wasPresentInMatch,
      presenceStatus: derivePresenceStatus(wasPresentInMatch),
      placement: isActiveTeam ? (sr.placement ?? null) : null,
      placementPoints,
      totalKills,
      totalPoints,
    };
  });

  const sortedRows = sortScoreboardRows(
    rows.filter((row) => row.wasPresentInMatch !== false),
  );

  const lastUpdateIso = match.updatedAt?.toISOString?.() ?? null;

  const controlMeta =
    (match.controlState?.metaJson as {
      resultFinalized?: boolean;
      finalizedAt?: string;
      winnerTeamId?: string | null;
    } | null) ?? null;
  const resultFinalized = controlMeta?.resultFinalized ?? null;
  const finalizedAt = controlMeta?.finalizedAt ?? null;
  const winnerTeamId = controlMeta?.winnerTeamId ?? null;

  const aliveTeams = await deriveAliveTeams(prisma, match);
  const anyLocked = match.slotResults?.some((s) => s.isLocked) ?? false;
  const ended =
    isEndedState(match.status as string) ||
    isEndedState(
      (match as { liveState?: string | null }).liveState ??
        match.controlState?.state ??
        null,
    );
  let resultsLocked = anyLocked;
  if (ended) {
    resultsLocked = true;
  } else if (aliveTeams !== null && aliveTeams !== undefined) {
    resultsLocked = aliveTeams <= 1;
  } else {
    resultsLocked = false;
  }

  const state = makeWidgetState({
    matchId: match.id,
    tournamentId: match.tournamentId,
    game: match.game?.key ?? null,
    dataSource: match.dataSource ?? match.dataMode ?? null,
    controlState: match.controlState?.state ?? match.status ?? null,
    resultsLocked,
    phase: match.status,
    hasSlots,
    hasSlotResults: hasStandings,
    hasPlayerResults: false,
    aliveTeams,
    lastUpdateIso,
    reasons,
    resultFinalized,
    finalizedAt,
    winnerTeamId,
  });

  return {
    version: 'v1',
    state,
    rows: sortedRows,
  };
}

function withVersion(
  url?: string | null,
  updatedAt?: Date | string | number | null,
) {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  if (url.includes('?v=')) return url;
  const version =
    updatedAt instanceof Date
      ? updatedAt.getTime()
      : typeof updatedAt === 'number'
        ? updatedAt
        : updatedAt
          ? Date.parse(updatedAt)
          : null;
  if (!version || Number.isNaN(version)) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${version}`;
}
