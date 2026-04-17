import { normalizePublicAssetUrl } from './public-asset-url.util';

const FALLBACK_TEAM_LOGO = '/assets/defaults/default-team.png';
const FALLBACK_PLAYER_PHOTO = '/assets/defaults/default-player.png';

export type OrgBrandingDefaults = {
  defaultTeamLogoUrl?: string | null;
  defaultPlayerPhotoUrl?: string | null;
};

export function resolveTeamLogo(
  teamLogoUrl: string | null | undefined,
  orgBranding?: OrgBrandingDefaults | null,
): string {
  return (
    normalizePublicAssetUrl(teamLogoUrl) ??
    normalizePublicAssetUrl(orgBranding?.defaultTeamLogoUrl) ??
    FALLBACK_TEAM_LOGO
  );
}

export function resolvePlayerPhoto(
  playerPhotoUrl: string | null | undefined,
  orgBranding?: OrgBrandingDefaults | null,
): string {
  return (
    normalizePublicAssetUrl(playerPhotoUrl) ??
    normalizePublicAssetUrl(orgBranding?.defaultPlayerPhotoUrl) ??
    FALLBACK_PLAYER_PHOTO
  );
}
