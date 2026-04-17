export const ANONYMOUS_SLOT_PLAYER_PREFIX = 'slot-player:';

function normalize(value?: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildAnonymousSlotPlayerKey(
  playerResultId?: string | null,
): string | null {
  const normalized = normalize(playerResultId);
  return normalized ? `${ANONYMOUS_SLOT_PLAYER_PREFIX}${normalized}` : null;
}

export function buildMatchPlayerKey(params: {
  playerId?: string | null;
  playerResultId?: string | null;
}): string | null {
  const playerId = normalize(params.playerId);
  if (playerId) {
    return playerId;
  }
  return buildAnonymousSlotPlayerKey(params.playerResultId);
}

export function isAnonymousSlotPlayerKey(value?: string | null): boolean {
  const normalized = normalize(value);
  return normalized?.startsWith(ANONYMOUS_SLOT_PLAYER_PREFIX) === true;
}

export function extractAnonymousSlotPlayerId(
  value?: string | null,
): string | null {
  if (!isAnonymousSlotPlayerKey(value)) {
    return null;
  }
  return normalize(value?.slice(ANONYMOUS_SLOT_PLAYER_PREFIX.length) ?? null);
}
