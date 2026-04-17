import * as fs from 'fs';
import { normalizePublicAssetUrl } from './public-asset-url.util';
import { findMediaFile } from '../modules/teams/asset.util';

export const ARENZYRA_DEFAULT_TEAM_BRANDING = {
  name: 'Arenzyra',
  tag: 'AZ',
  logoUrl: '/assets/defaults/default-team.png',
} as const;

type BrandingTeam = {
  id?: string | null;
  name?: string | null;
  tag?: string | null;
  logoUrl?: string | null;
};

export type TeamBrandingSource = {
  teamId?: string | null;
  slot?: number | null;
  name?: string | null;
  tag?: string | null;
  logoUrl?: string | null;
  team?: BrandingTeam | null;
};

export type ResolvedTeamBranding = {
  name: string;
  tag: string;
  logoUrl: string;
};

const DEFAULT_TEAM_LOGO_MARKERS = [
  '/assets/defaults/default-team.png',
  '/assets/logos/default-logo.svg',
  '/assets/default-team.png',
  'default-team',
  'default-logo',
  'placeholder',
];

function isDefaultTeamLogoUrl(value: string | null | undefined) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  return DEFAULT_TEAM_LOGO_MARKERS.some((marker) =>
    normalized.includes(marker),
  );
}

function buildStoredTeamLogoUrl(teamId: string): string | null {
  const mediaPath = findMediaFile('team', teamId, 'logo');
  if (!mediaPath) {
    return null;
  }

  try {
    const version = Math.trunc(fs.statSync(mediaPath).mtimeMs);
    return `/media/teams/${encodeURIComponent(teamId)}/logo?v=${version}`;
  } catch {
    return `/media/teams/${encodeURIComponent(teamId)}/logo`;
  }
}

export function resolveTeamLogoUrl(
  teamId: string | null | undefined,
  logoUrl: string | null | undefined,
  fallback: string | null = null,
): string | null {
  const normalizedLogoUrl = normalizePublicAssetUrl(logoUrl);
  const normalizedTeamId = String(teamId ?? '').trim();

  if (
    normalizedTeamId &&
    (!normalizedLogoUrl || isDefaultTeamLogoUrl(normalizedLogoUrl))
  ) {
    const storedLogoUrl = buildStoredTeamLogoUrl(normalizedTeamId);
    if (storedLogoUrl) {
      return storedLogoUrl;
    }
  }

  return normalizedLogoUrl ?? fallback;
}

export function resolveTeamBranding(
  teamId: string | null | undefined,
  sources: TeamBrandingSource[],
): ResolvedTeamBranding {
  const slot = resolveTeamBrandingSource(teamId, sources);
  if (!slot) {
    return { ...ARENZYRA_DEFAULT_TEAM_BRANDING };
  }

  const source = slot.team ?? slot;
  const sourceTeamId = slot.team?.id ?? slot.teamId ?? teamId;
  return {
    name: source.name ?? ARENZYRA_DEFAULT_TEAM_BRANDING.name,
    tag: source.tag ?? ARENZYRA_DEFAULT_TEAM_BRANDING.tag,
    logoUrl:
      resolveTeamLogoUrl(
        sourceTeamId,
        source.logoUrl,
        ARENZYRA_DEFAULT_TEAM_BRANDING.logoUrl,
      ) ?? ARENZYRA_DEFAULT_TEAM_BRANDING.logoUrl,
  };
}

export function resolveTeamBrandingSource(
  teamId: string | null | undefined,
  sources: TeamBrandingSource[],
): TeamBrandingSource | null {
  if (!teamId) {
    return null;
  }

  for (const source of sources) {
    const sourceTeamId = source.team?.id ?? source.teamId ?? null;
    if (sourceTeamId !== teamId) {
      continue;
    }

    const branding = source.team ?? source;
    if (branding.name || branding.tag || branding.logoUrl) {
      return source;
    }
  }

  return null;
}
