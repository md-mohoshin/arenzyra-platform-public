import { GameKey } from '@prisma/client';

export const PUBG_MOBILE_PLACEMENT_POINTS: Record<number, number> = {
  1: 10,
  2: 6,
  3: 5,
  4: 4,
  5: 3,
  6: 2,
  7: 1,
  8: 1,
  9: 0,
  10: 0,
  11: 0,
  12: 0,
  13: 0,
  14: 0,
  15: 0,
  16: 0,
  17: 0,
  18: 0,
  19: 0,
  20: 0,
  21: 0,
  22: 0,
  23: 0,
  24: 0,
  25: 0,
};

export const FREE_FIRE_PLACEMENT_POINTS: Record<number, number> = {
  1: 12,
  2: 9,
  3: 8,
  4: 7,
  5: 6,
  6: 5,
  7: 4,
  8: 3,
  9: 2,
  10: 1,
  11: 0,
  12: 0,
};

export const CALL_OF_DUTY_PLACEMENT_POINTS: Record<number, number> = {
  ...PUBG_MOBILE_PLACEMENT_POINTS,
};

export const CRICKET_PLACEMENT_POINTS: Record<number, number> = {
  1: 2,
  2: 0,
};

export const VALORANT_MAPS = [
  'CORRODE',
  'ABYSS',
  'SUNSET',
  'LOTUS',
  'PEARL',
  'FRACTURE',
  'BREEZE',
  'ICEBOX',
  'ASCENT',
  'SPLIT',
  'HAVEN',
  'BIND',
];

export const CRICKET_FORMATS = [
  'CRICKET_T10',
  'CRICKET_T20',
  'CRICKET_ODI',
  'CRICKET_TEST',
  'CRICKET_CUSTOM',
];

export const CALL_OF_DUTY_MAPS = [
  'CODM_ISOLATED',
  'CODM_BLACKOUT',
  'CODM_CUSTOM',
];

export function defaultPlacementPointsForGame(
  gameKey?: GameKey | null,
): Record<number, number> {
  if (gameKey === GameKey.VALORANT) return {};
  if (gameKey === GameKey.CRICKET) return CRICKET_PLACEMENT_POINTS;
  if (gameKey === GameKey.FREE_FIRE) return FREE_FIRE_PLACEMENT_POINTS;
  if (gameKey === GameKey.CALL_OF_DUTY) {
    return CALL_OF_DUTY_PLACEMENT_POINTS;
  }
  return PUBG_MOBILE_PLACEMENT_POINTS;
}

export function defaultKillPointsForGame(gameKey?: GameKey | null): number {
  if (gameKey === GameKey.VALORANT) return 0;
  if (gameKey === GameKey.CRICKET) return 0;
  return 1;
}

export function defaultSlotCountForGame(gameKey?: GameKey | null): number {
  if (gameKey === GameKey.CRICKET) return 2;
  if (gameKey === GameKey.FREE_FIRE) return 12;
  if (gameKey === GameKey.CALL_OF_DUTY) return 25;
  if (!gameKey || gameKey === GameKey.PUBG_MOBILE) return 25;
  return 2;
}

export function defaultTeamSizeForGame(gameKey?: GameKey | null): number {
  if (gameKey === GameKey.CRICKET) return 11;
  if (
    gameKey === GameKey.FREE_FIRE ||
    gameKey === GameKey.PUBG_MOBILE ||
    gameKey === GameKey.CALL_OF_DUTY
  ) {
    return 4;
  }
  return 5;
}

export function defaultMapsForGame(gameKey?: GameKey | null): string[] {
  if (gameKey === GameKey.VALORANT) {
    return VALORANT_MAPS;
  }
  if (gameKey === GameKey.FREE_FIRE) {
    return ['BERMUDA', 'PURGATORY', 'KALAHARI', 'ALPINE', 'NEXTERRA', 'SOLARA'];
  }
  if (gameKey === GameKey.CRICKET) {
    return CRICKET_FORMATS;
  }
  if (gameKey === GameKey.CALL_OF_DUTY) {
    return CALL_OF_DUTY_MAPS;
  }
  return [
    'ERANGEL',
    'MIRAMAR',
    'SANHOK',
    'VIKENDI',
    'LIVIK',
    'KARAKIN',
    'DESTON',
    'RONDO',
    'NUSA',
  ];
}

export function defaultRulesetConfigForGame(gameKey?: GameKey | null) {
  if (gameKey === GameKey.CRICKET) {
    return {
      type: 'CRICKET_POINTS',
      placementPoints: defaultPlacementPointsForGame(gameKey),
      killPoints: 0,
      matchPoints: {
        win: 2,
        tie: 1,
        noResult: 1,
        loss: 0,
      },
      maxTeams: 2,
      slotCount: 2,
      teamSize: 11,
      maps: defaultMapsForGame(gameKey),
      modes: CRICKET_FORMATS,
      scoreFormat: 'CRICKET_SCORE',
      resultEntry: 'MANUAL',
    };
  }
  if (gameKey === GameKey.VALORANT) {
    return {
      type: 'ROUND_WINS',
      roundWinPoints: 1,
      winBonus: 0,
      maxTeams: 2,
      slotCount: 2,
      teamSize: 5,
      maps: defaultMapsForGame(gameKey),
      modes: ['TACTICAL_5V5'],
      scoreFormat: 'ROUND_SCORE',
      roundsToWin: 13,
      overtime: true,
      apiAccess: 'PENDING_RIOT_APPROVAL',
    };
  }
  if (gameKey === GameKey.CS2) {
    return { type: 'ROUND_WINS', roundWinPoints: 1, winBonus: 0 };
  }
  if (gameKey === GameKey.MLBB) {
    return {
      type: 'ROUND_WINS',
      roundWinPoints: 1,
      winBonus: 0,
      lossPoints: 0,
      drawPoints: 0,
      maxTeams: 2,
      slotCount: 2,
      teamSize: 5,
    };
  }
  const effectiveGameKey = gameKey ?? GameKey.PUBG_MOBILE;
  return {
    type: 'BR_POINTS',
    placementPoints: defaultPlacementPointsForGame(effectiveGameKey),
    killPoints: defaultKillPointsForGame(effectiveGameKey),
    maxTeams: defaultSlotCountForGame(effectiveGameKey),
    slotCount: defaultSlotCountForGame(effectiveGameKey),
    teamSize: defaultTeamSizeForGame(effectiveGameKey),
    maps: defaultMapsForGame(effectiveGameKey),
    modes: ['BR_SQUAD'],
  };
}

export function defaultTournamentRulesetForGame(gameKey?: GameKey | null) {
  const effectiveGameKey = gameKey ?? GameKey.PUBG_MOBILE;
  if (effectiveGameKey === GameKey.CRICKET) {
    return {
      version: 'sports-cricket-v1',
      type: 'CRICKET_POINTS',
      placement: { 1: 2, 2: 0 },
      placementPoints: defaultPlacementPointsForGame(effectiveGameKey),
      matchPoints: {
        win: 2,
        tie: 1,
        noResult: 1,
        loss: 0,
      },
      slotCount: 2,
      teamSize: 11,
      formats: defaultMapsForGame(effectiveGameKey),
      resultEntry: 'MANUAL',
    };
  }
  if (effectiveGameKey === GameKey.VALORANT) {
    return {
      version: 'valorant-rounds-v1',
      type: 'ROUND_WINS',
      roundWinPoints: 1,
      winBonus: 0,
      maxTeams: 2,
      slotCount: 2,
      teamSize: 5,
      maps: defaultMapsForGame(effectiveGameKey),
      scoreFormat: 'ROUND_SCORE',
      roundsToWin: 13,
      overtime: true,
      apiAccess: 'PENDING_RIOT_APPROVAL',
    };
  }
  const placement = defaultPlacementPointsForGame(effectiveGameKey);
  const version =
    effectiveGameKey === GameKey.FREE_FIRE
      ? 'free-fire-br-v1'
      : effectiveGameKey === GameKey.CALL_OF_DUTY
        ? 'codm-br-v1'
        : 'pubgm-v2';

  return {
    version,
    kill: defaultKillPointsForGame(effectiveGameKey),
    placement: Object.fromEntries(
      Object.entries(placement).map(([rank, points]) => [rank, points]),
    ),
  };
}

export function resolvePlacementPointsForGame(
  placement: number | null | undefined,
  gameKey?: GameKey | null,
): number {
  if (!placement || placement < 1) return 0;
  return defaultPlacementPointsForGame(gameKey)[placement] ?? 0;
}
