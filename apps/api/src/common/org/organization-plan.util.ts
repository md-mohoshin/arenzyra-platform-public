import { ForbiddenException } from '@nestjs/common';
import { GameKey, OrganizerAccessMode, Prisma } from '@prisma/client';
import type { PrismaService } from '../../db/prisma.service';

export const ORGANIZATION_PLAN_IDS = [
  'discord-basic',
  'discord-ops',
  'production',
  'sports-production',
  'multi-game-production',
  'pubg-auto-launcher',
] as const;

export type OrganizationPlanId = (typeof ORGANIZATION_PLAN_IDS)[number];
const ORGANIZATION_PLAN_ID_SET = new Set<string>(ORGANIZATION_PLAN_IDS);

type PlanCatalogItem = {
  id: OrganizationPlanId;
  name: string;
  priceUsd: string;
  accessMode: OrganizerAccessMode;
  description: string;
  defaultGameKeys: GameKey[];
  allowedGameKeys: GameKey[];
  features: string[];
};

const ESPORTS_SINGLE_GAME_KEYS = [
  GameKey.PUBG_MOBILE,
  GameKey.FREE_FIRE,
  GameKey.VALORANT,
  GameKey.CALL_OF_DUTY,
] as const;

export const PLAN_ENABLED_GAME_KEYS = [
  GameKey.PUBG_MOBILE,
  GameKey.FREE_FIRE,
  GameKey.VALORANT,
  GameKey.CALL_OF_DUTY,
  GameKey.CRICKET,
] as const;

export const ORGANIZATION_PLAN_CATALOG: PlanCatalogItem[] = [
  {
    id: 'discord-basic',
    name: 'Discord Bot Only - No AI',
    priceUsd: '10.99',
    accessMode: OrganizerAccessMode.DISCORD_ONLY,
    description:
      'Discord registration, slot, basic OCR, manual result editing, and result post workflow without AI screenshot parsing.',
    defaultGameKeys: [GameKey.PUBG_MOBILE],
    allowedGameKeys: [...ESPORTS_SINGLE_GAME_KEYS],
    features: [
      'Choose PUBG Mobile, Free Fire, VALORANT, or Call of Duty Mobile',
      'Discord organizer workflow',
      'Best-effort local OCR',
      'Manual result review and correction',
      'Discord result posts',
      'Basic branding',
    ],
  },
  {
    id: 'discord-ops',
    name: 'Discord Only - Single Game',
    priceUsd: '18.99',
    accessMode: OrganizerAccessMode.DISCORD_ONLY,
    description:
      'Discord registration, slot, OCR result, and result post workflow for one selected game.',
    defaultGameKeys: [GameKey.PUBG_MOBILE],
    allowedGameKeys: [...ESPORTS_SINGLE_GAME_KEYS],
    features: [
      'Choose PUBG Mobile, Free Fire, VALORANT, or Call of Duty Mobile',
      'Discord organizer workflow',
      'OCR result review',
      'Discord result posts',
      'Basic branding',
    ],
  },
  {
    id: 'production',
    name: 'Production - Single Game',
    priceUsd: '29.99',
    accessMode: OrganizerAccessMode.FULL_PRODUCTION,
    description:
      'Full tournament, event, match control, widgets, and Discord workflow for one selected game.',
    defaultGameKeys: [GameKey.PUBG_MOBILE],
    allowedGameKeys: [...ESPORTS_SINGLE_GAME_KEYS],
    features: [
      'Choose PUBG Mobile, Free Fire, VALORANT, or Call of Duty Mobile',
      'Tournament and event management',
      'Match control',
      'Broadcast widgets',
      'Discord workflow',
    ],
  },
  {
    id: 'sports-production',
    name: 'Sports Production - Cricket',
    priceUsd: '39.99',
    accessMode: OrganizerAccessMode.FULL_PRODUCTION,
    description:
      'Cricket fixtures, manual score control, points table, Discord, and broadcast output.',
    defaultGameKeys: [GameKey.CRICKET],
    allowedGameKeys: [GameKey.CRICKET],
    features: [
      'Cricket only',
      'T10, T20, ODI, Test, and custom formats',
      'Manual score entry and points table',
      'OBS-ready sports widgets',
      'Discord event support',
    ],
  },
  {
    id: 'multi-game-production',
    name: 'Multi-Game Production',
    priceUsd: '49.99',
    accessMode: OrganizerAccessMode.FULL_PRODUCTION,
    description:
      'Production access for PUBG Mobile, Free Fire, VALORANT, and Call of Duty Mobile in one organization workspace.',
    defaultGameKeys: [
      GameKey.PUBG_MOBILE,
      GameKey.FREE_FIRE,
      GameKey.VALORANT,
      GameKey.CALL_OF_DUTY,
    ],
    allowedGameKeys: [
      GameKey.PUBG_MOBILE,
      GameKey.FREE_FIRE,
      GameKey.VALORANT,
      GameKey.CALL_OF_DUTY,
    ],
    features: [
      'PUBG Mobile, Free Fire, VALORANT, and Call of Duty Mobile access',
      'Everything in Production - Single Game',
      'Game switcher for operators',
      'Shared organization and billing',
      'Multi-game tournament operations',
    ],
  },
  {
    id: 'pubg-auto-launcher',
    name: 'PUBG Production + Auto Result Launcher',
    priceUsd: '59.99',
    accessMode: OrganizerAccessMode.FULL_PRODUCTION,
    description:
      'Full PUBG Mobile production workspace with launcher-based auto results for organizers who already have approved API or telemetry access.',
    defaultGameKeys: [GameKey.PUBG_MOBILE],
    allowedGameKeys: [GameKey.PUBG_MOBILE],
    features: [
      'PUBG Mobile only',
      'Everything in Production - Single Game',
      'Launcher auto-result workflow',
      'API/telemetry result pipeline',
      'Match control and broadcast widgets',
      'Server-side key handling guidance',
    ],
  },
];

const LEGACY_PLAN_IDS: Record<string, OrganizationPlanId> = {
  discord_basic: 'discord-basic',
  discord_no_ai: 'discord-basic',
  'discord-no-ai': 'discord-basic',
  discord_ops: 'discord-ops',
  multi_game_production: 'multi-game-production',
  pubg_auto_launcher: 'pubg-auto-launcher',
  production_telemetry: 'multi-game-production',
  'production-telemetry': 'multi-game-production',
};

const AI_SCREENSHOT_ADD_ON_IDS = new Set([
  'ai-screenshot-ocr',
  'ai-ocr',
  'ai-results',
  'ai-production',
]);

function isOrganizationPlanId(value: string): value is OrganizationPlanId {
  return ORGANIZATION_PLAN_ID_SET.has(value);
}

export function normalizeOrganizationPlanId(
  value?: string | null,
): OrganizationPlanId | null {
  const clean = value?.trim();
  if (!clean) return null;
  const normalized = LEGACY_PLAN_IDS[clean] ?? clean;
  return isOrganizationPlanId(normalized) ? normalized : null;
}

export function defaultPlanIdForAccessMode(
  accessMode?: OrganizerAccessMode | null,
): OrganizationPlanId {
  return accessMode === OrganizerAccessMode.DISCORD_ONLY
    ? 'discord-ops'
    : 'production';
}

export function inferPlanIdFromRequestedPlan(
  requestedPlan?: string | null,
): OrganizationPlanId {
  const text = requestedPlan?.toLowerCase() ?? '';
  if (
    text.includes('discord') &&
    (text.includes('basic') ||
      text.includes('bot only') ||
      text.includes('no ai') ||
      text.includes('without ai'))
  ) {
    return 'discord-basic';
  }
  if (text.includes('discord')) return 'discord-ops';
  if (text.includes('sports') || text.includes('cricket')) {
    return 'sports-production';
  }
  if (text.includes('multi')) return 'multi-game-production';
  if (text.includes('launcher') || text.includes('auto result')) {
    return 'pubg-auto-launcher';
  }
  return 'production';
}

export function getOrganizationPlan(
  planId?: string | null,
  fallbackAccessMode?: OrganizerAccessMode | null,
) {
  const normalized =
    normalizeOrganizationPlanId(planId) ??
    defaultPlanIdForAccessMode(fallbackAccessMode);
  return (
    ORGANIZATION_PLAN_CATALOG.find((plan) => plan.id === normalized) ??
    ORGANIZATION_PLAN_CATALOG[1]
  );
}

export function normalizeGameKeys(values?: readonly unknown[] | null) {
  if (!values?.length) return [] as GameKey[];
  const allowed = new Set(Object.values(GameKey));
  const result: GameKey[] = [];

  values.forEach((value) => {
    if (typeof value !== 'string') return;
    const normalized = value.trim().toUpperCase();
    if (!allowed.has(normalized as GameKey)) return;
    const gameKey = normalized as GameKey;
    if (!result.includes(gameKey)) {
      result.push(gameKey);
    }
  });

  return result;
}

export function inferGameKeysFromRequestedPlan(
  requestedPlan?: string | null,
): GameKey[] {
  const text = requestedPlan?.toLowerCase() ?? '';
  if (text.includes('free fire')) return [GameKey.FREE_FIRE];
  if (text.includes('valorant')) return [GameKey.VALORANT];
  if (text.includes('call of duty') || text.includes('codm')) {
    return [GameKey.CALL_OF_DUTY];
  }
  if (text.includes('cricket') || text.includes('sports')) {
    return [GameKey.CRICKET];
  }
  if (text.includes('multi')) {
    return [
      GameKey.PUBG_MOBILE,
      GameKey.FREE_FIRE,
      GameKey.VALORANT,
      GameKey.CALL_OF_DUTY,
    ];
  }
  return [GameKey.PUBG_MOBILE];
}

export function resolveEnabledGameKeys(params: {
  planId?: string | null;
  accessMode?: OrganizerAccessMode | null;
  enabledGames?: readonly unknown[] | null;
}) {
  const normalized = normalizeGameKeys(params.enabledGames);
  if (normalized.length) {
    return normalized.filter((gameKey) =>
      PLAN_ENABLED_GAME_KEYS.includes(
        gameKey as (typeof PLAN_ENABLED_GAME_KEYS)[number],
      ),
    );
  }

  return getOrganizationPlan(
    params.planId,
    params.accessMode,
  ).defaultGameKeys.slice();
}

export function sanitizeGameKeysForPlan(
  planId: string | null | undefined,
  gameKeys?: readonly unknown[] | null,
) {
  const plan = getOrganizationPlan(planId);
  const requested = normalizeGameKeys(gameKeys);
  const allowed = new Set(plan.allowedGameKeys);
  const selected = requested.filter((gameKey) => allowed.has(gameKey));
  return selected.length ? selected : plan.defaultGameKeys.slice();
}

export function resolvePlanFromApplication(params: {
  requestedPlanId?: string | null;
  requestedPlan?: string | null;
  requestedGameKey?: string | null;
  requestedGameKeys?: readonly unknown[] | null;
}) {
  const planId =
    normalizeOrganizationPlanId(params.requestedPlanId) ??
    inferPlanIdFromRequestedPlan(params.requestedPlan);
  const requestedGameKeys = normalizeGameKeys([
    ...(params.requestedGameKeys ?? []),
    params.requestedGameKey,
    ...inferGameKeysFromRequestedPlan(params.requestedPlan),
  ]);
  const enabledGames = sanitizeGameKeysForPlan(planId, requestedGameKeys);
  const plan = getOrganizationPlan(planId);

  return {
    planId: plan.id,
    accessMode: plan.accessMode,
    enabledGames,
  };
}

export function organizationAllowsGame(
  organization: {
    planId?: string | null;
    accessMode?: OrganizerAccessMode | null;
    enabledGames?: readonly unknown[] | null;
  },
  gameKey: GameKey,
) {
  return resolveEnabledGameKeys(organization).includes(gameKey);
}

export function organizationAllowsAiScreenshotParsing(organization: {
  planId?: string | null;
  enabledAddOns?: readonly unknown[] | null;
}) {
  const planId = normalizeOrganizationPlanId(organization.planId);
  if (planId !== 'discord-basic') {
    return true;
  }

  return (organization.enabledAddOns ?? []).some(
    (addOn) =>
      typeof addOn === 'string' &&
      AI_SCREENSHOT_ADD_ON_IDS.has(addOn.trim().toLowerCase()),
  );
}

export async function assertOrganizationGameAccess(
  prisma: PrismaService | Prisma.TransactionClient,
  organizationId: string,
  gameKey: GameKey,
) {
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: {
      id: true,
      planId: true,
      accessMode: true,
      enabledGames: true,
    },
  });

  if (!organization || !organizationAllowsGame(organization, gameKey)) {
    throw new ForbiddenException(
      `${gameKey.replace(/_/g, ' ')} is not included in this organization's plan`,
    );
  }
}
