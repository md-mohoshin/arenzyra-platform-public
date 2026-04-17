import type { Prisma } from '@prisma/client';

export const LIVE_MAPPING_TEAM_NAME_PREFIX = '[LIVE] ';
const DEFAULT_LIVE_MAPPING_TEAM_TAG = 'AZ';
const LIVE_MAPPING_SLOT_PATTERN = /\bSlot\s+(\d+)\b/i;

export type TeamListScope = 'manual' | 'live-mapping' | 'all';

export const normalizeTeamListScope = (
  scope?: string | null,
): TeamListScope => {
  const normalized = String(scope ?? '')
    .trim()
    .toLowerCase();

  if (normalized === 'live-mapping') {
    return 'live-mapping';
  }

  if (normalized === 'all') {
    return 'all';
  }

  return 'manual';
};

export const isLiveMappingTeamName = (name?: string | null): boolean =>
  typeof name === 'string' && name.startsWith(LIVE_MAPPING_TEAM_NAME_PREFIX);

export const extractLiveMappingSlotNumber = (
  name?: string | null,
): number | null => {
  if (!isLiveMappingTeamName(name)) {
    return null;
  }

  const match = LIVE_MAPPING_SLOT_PATTERN.exec(name ?? '');
  if (!match) {
    return null;
  }

  const slotNumber = Number(match[1]);
  return Number.isFinite(slotNumber) && slotNumber > 0
    ? Math.trunc(slotNumber)
    : null;
};

export const buildLiveMappingSlotTag = (
  slotNumber?: number | null,
): string | null => {
  if (!Number.isFinite(slotNumber ?? NaN)) {
    return null;
  }

  const normalized = Math.trunc(slotNumber as number);
  return normalized > 0 ? `S${String(normalized).padStart(2, '0')}` : null;
};

export const resolveLiveMappingTeamTag = (
  _name?: string | null,
  tag?: string | null,
): string | null => {
  void _name;
  const trimmedTag = typeof tag === 'string' ? tag.trim() : '';
  if (trimmedTag.length > 0) {
    return trimmedTag;
  }

  return DEFAULT_LIVE_MAPPING_TEAM_TAG;
};

export const applyTeamListScopeToWhere = (
  where: Prisma.TeamWhereInput,
  scope?: string | null,
): Prisma.TeamWhereInput => {
  const normalized = normalizeTeamListScope(scope);
  if (normalized === 'all') {
    return where;
  }

  const scopeWhere: Prisma.TeamWhereInput =
    normalized === 'live-mapping'
      ? {
          name: {
            startsWith: LIVE_MAPPING_TEAM_NAME_PREFIX,
          },
        }
      : {
          NOT: {
            name: {
              startsWith: LIVE_MAPPING_TEAM_NAME_PREFIX,
            },
          },
        };

  return {
    AND: [where, scopeWhere],
  };
};
