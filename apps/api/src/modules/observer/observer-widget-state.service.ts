import { Inject, Injectable, Optional, forwardRef } from '@nestjs/common';
import type { LiveMatchState } from '../match-control/state.store';
import {
  MatchStateService,
  type MatchState,
  type MatchStateBackpackItem,
  type MatchStateCircle,
  type MatchStateKillFeedEntry,
  type MatchStateLeaderboardPlayer,
  type MatchStateLeaderboardRow,
  type MatchStatePlayerCard,
  type MatchStateTeamBackpack,
  type MatchStateWinner,
} from './match-state.service';
import { CanonicalControlReadService } from '../realtime/canonical-control-read.service';
import { TelemetryBroadcastService } from '../telemetry/telemetry-broadcast.service';
import { TelemetryEngineService } from '../telemetry/telemetry-engine.service';
import { normalizePublicAssetUrl } from '../../common/public-asset-url.util';
import { PrismaService } from '../../db/prisma.service';
import type { Prisma } from '@prisma/client';
import {
  DEFAULT_OBSERVER_WIDGET_TEAM_NAME,
  DEFAULT_OBSERVER_WIDGET_TEAM_TAG,
  chooseLiveState,
  chooseTeamName,
  countAliveRows,
  deriveAlivePlayersFromRows,
  isPlayingLiveTeam,
  mergeLeaderboardRows,
  needsTelemetryFallback,
  normalizeLogoUrl,
} from './observer-live-widget-rules.util';

export type ObserverWidgetLeaderboardRow = MatchStateLeaderboardRow;
export type ObserverWidgetKillFeedEntry = MatchStateKillFeedEntry;
export type ObserverWidgetPlayerCard = MatchStatePlayerCard;
export type ObserverWidgetWinner = MatchStateWinner;
export type ObserverWidgetMatchUpdatePayload = MatchState;

type ObserverFocusCandidate = {
  playerId: string | null;
  externalPlayerId: string | null;
  pubgPlayerId: string | null;
  playerOpenId: string | null;
  playerName: string | null;
  teamId: string | null;
  teamName: string | null;
  teamTag: string | null;
  slot: number | null;
};

const DEFAULT_WIDGET_TEAM_NAME = DEFAULT_OBSERVER_WIDGET_TEAM_NAME;
const DEFAULT_WIDGET_TEAM_TAG = DEFAULT_OBSERVER_WIDGET_TEAM_TAG;
const LOCAL_API_BASE_URL = `http://127.0.0.1:${process.env.PORT || 3000}`;
const DEFAULT_PLAYER_PHOTO_MARKERS = [
  '/assets/default-player',
  '/assets/defaults/default-player',
  '/assets/players/default-player',
];
const TELEMETRY_UTILITY_ITEM_ID_TO_NAME: Record<string, string> = {
  '602001': 'stun',
  '602002': 'smoke',
  '602003': 'molotov',
  '602004': 'frag',
};
const TELEMETRY_BACKPACK_META_KEYS = new Set([
  'teamid',
  'team',
  'playerid',
  'playerkey',
  'uid',
  'slot',
  'teamno',
  'mainweapon1id',
  'mainweapon2id',
  'mainweapon1ammorange',
  'mainweapon2ammorange',
  'mainweapon1ammonuminclip',
  'mainweapon2ammonuminclip',
]);
const TELEMETRY_PLAYER_HEALTH_KEYS = [
  'health',
  'Health',
  'hp',
  'HP',
  'currentHealth',
  'CurrentHealth',
];

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const numberValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const stringValue = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return null;
};

const parsePackedItemCount = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const packed = value.match(/(?:^|[,;])\s*Num\s*:\s*(\d+)/i);
  if (packed?.[1]) {
    return Math.max(0, Math.trunc(Number(packed[1])));
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
};

const normalizeHealthValue = (value: unknown): number | null => {
  const parsed = numberValue(value);
  if (parsed === null) {
    return null;
  }
  return Math.max(0, Math.min(100, parsed));
};

const telemetryPlayerHealth = (
  record: Record<string, unknown>,
): number | null => {
  for (const key of TELEMETRY_PLAYER_HEALTH_KEYS) {
    const health = normalizeHealthValue(record[key]);
    if (health !== null) {
      return health;
    }
  }
  return null;
};

const telemetryPlayerSlot = (
  record: Record<string, unknown>,
): number | null => {
  const slot =
    numberValue(record.teamId) ??
    numberValue(record.TeamId) ??
    numberValue(record.teamID) ??
    numberValue(record.TeamID) ??
    numberValue(record.team) ??
    numberValue(record.Team) ??
    numberValue(record.slot) ??
    numberValue(record.Slot) ??
    numberValue(record.teamNo) ??
    numberValue(record.TeamNo);
  return slot === null ? null : Math.trunc(slot);
};

const telemetryPlayerName = (record: Record<string, unknown>): string | null =>
  stringValue(
    record.playerName ??
      record.PlayerName ??
      record.ign ??
      record.IGN ??
      record.name ??
      record.Name,
  );

const normalizePlayerLookupName = (value: string | null | undefined): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const addUniqueHealthLookup = (
  lookup: Map<string, number | null>,
  key: string | null | undefined,
  health: number,
) => {
  if (!key) {
    return;
  }
  const existing = lookup.get(key);
  if (existing === undefined) {
    lookup.set(key, health);
    return;
  }
  if (existing !== health) {
    lookup.set(key, null);
  }
};

const telemetryPlayerIdentityKeys = (
  record: Record<string, unknown>,
): string[] => {
  const values = [
    record.uId,
    record.UId,
    record.uid,
    record.UID,
    record.playerOpenId,
    record.playerOpenID,
    record.PlayerOpenId,
    record.PlayerOpenID,
    record.openId,
    record.OpenId,
    record.playerKey,
    record.PlayerKey,
    record.playerId,
    record.PlayerId,
    record.PlayerID,
    record.id,
    record.ID,
  ]
    .map((value) => stringValue(value))
    .filter((value): value is string => !!value);

  return Array.from(new Set(values)).map((value) => `id:${value}`);
};

const extractTelemetryPlayerRecords = (
  payload: unknown,
): Record<string, unknown>[] => {
  const payloadRecord = asRecord(payload);
  const raw = asRecord(payloadRecord?.raw) ?? payloadRecord;
  const rawAllInfo = asRecord(raw?.allinfo) ?? asRecord(raw?.allInfo);
  const candidates = [
    payloadRecord?.players,
    payloadRecord?.playerInfoList,
    payloadRecord?.TotalPlayerList,
    raw?.players,
    raw?.playerInfoList,
    raw?.PlayerInfoList,
    raw?.TotalPlayerList,
    raw?.PlayerList,
    rawAllInfo?.TotalPlayerList,
    rawAllInfo?.PlayerList,
  ];
  return candidates
    .flatMap((candidate): unknown[] =>
      Array.isArray(candidate) ? candidate : [],
    )
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
};

const buildTelemetryPlayerHealthLookup = (
  payload: unknown,
): Map<string, number | null> => {
  const lookup = new Map<string, number | null>();
  for (const record of extractTelemetryPlayerRecords(payload)) {
    const health = telemetryPlayerHealth(record);
    if (health === null) {
      continue;
    }
    const slot = telemetryPlayerSlot(record);
    const name = normalizePlayerLookupName(telemetryPlayerName(record));

    for (const key of telemetryPlayerIdentityKeys(record)) {
      addUniqueHealthLookup(lookup, key, health);
    }
    if (name) {
      addUniqueHealthLookup(
        lookup,
        slot === null ? null : `slot-name:${slot}:${name}`,
        health,
      );
      addUniqueHealthLookup(lookup, `name:${name}`, health);
    }
  }
  return lookup;
};

const telemetryBackpackTeamSlot = (
  record: Record<string, unknown>,
): number | null => {
  const slot =
    numberValue(record.TeamID) ??
    numberValue(record.TeamId) ??
    numberValue(record.teamID) ??
    numberValue(record.teamId) ??
    numberValue(record.team) ??
    numberValue(record.Team) ??
    numberValue(record.slot) ??
    numberValue(record.Slot) ??
    numberValue(record.teamNo) ??
    numberValue(record.TeamNo);
  return slot === null ? null : Math.trunc(slot);
};

const telemetryBackpackPlayerId = (
  record: Record<string, unknown>,
): string | null =>
  stringValue(
    record.PlayerKey ??
      record.playerKey ??
      record.PlayerId ??
      record.playerId ??
      record.uId ??
      record.uid ??
      record.UID,
  );

const normalizeTelemetryUtilityItems = (
  record: Record<string, unknown>,
): MatchStateBackpackItem[] => {
  const items: MatchStateBackpackItem[] = [];
  for (const [key, value] of Object.entries(record)) {
    const itemId = key.trim();
    if (!itemId || TELEMETRY_BACKPACK_META_KEYS.has(itemId.toLowerCase())) {
      continue;
    }
    const utilityName = TELEMETRY_UTILITY_ITEM_ID_TO_NAME[itemId];
    if (!utilityName) {
      continue;
    }
    const count = parsePackedItemCount(value);
    if (count !== null && count <= 0) {
      continue;
    }
    items.push({
      name: utilityName,
      itemId,
      count: count ?? 1,
      raw: value,
    });
  }

  const itemContainer: unknown[] = Array.isArray(record.items)
    ? (record.items as unknown[])
    : Array.isArray(record.Items)
      ? (record.Items as unknown[])
      : [];
  const equipmentContainer =
    itemContainer.length > 0
      ? []
      : Array.isArray(record.equipment)
        ? (record.equipment as unknown[])
        : Array.isArray(record.Equipment)
          ? (record.Equipment as unknown[])
          : [];
  for (const value of [...itemContainer, ...equipmentContainer]) {
    const itemRecord = asRecord(value);
    if (!itemRecord) {
      continue;
    }
    const itemId =
      stringValue(itemRecord.itemId) ??
      stringValue(itemRecord.ItemId) ??
      stringValue(itemRecord.ItemID) ??
      stringValue(itemRecord.id) ??
      stringValue(itemRecord.ID) ??
      stringValue(itemRecord.name) ??
      stringValue(itemRecord.Name);
    if (!itemId) {
      continue;
    }
    const utilityName = TELEMETRY_UTILITY_ITEM_ID_TO_NAME[itemId];
    if (!utilityName) {
      continue;
    }
    const count =
      numberValue(itemRecord.count) ??
      numberValue(itemRecord.Count) ??
      parsePackedItemCount(itemRecord.raw) ??
      parsePackedItemCount(itemRecord.value) ??
      parsePackedItemCount(itemRecord.Value) ??
      1;
    if (count <= 0) {
      continue;
    }
    items.push({
      name: utilityName,
      itemId,
      count,
      raw: value,
    });
  }
  return items;
};

const extractTelemetryBackpackRecords = (
  payload: unknown,
): Record<string, unknown>[] => {
  const payloadRecord = asRecord(payload);
  const raw = asRecord(payloadRecord?.raw) ?? payloadRecord;
  const candidates = [
    raw?.backpacks,
    payloadRecord?.backpacks,
    raw?.teamBackpackInfo,
    raw?.TeamBackpackInfo,
    payloadRecord?.teamBackpackInfo,
    payloadRecord?.TeamBackpackInfo,
  ];

  const records = candidates.find(
    (candidate) => Array.isArray(candidate) && candidate.length > 0,
  );

  return (Array.isArray(records) ? records : [])
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
};

const buildTelemetryUtilityBackpacksBySlot = (
  payload: unknown,
): Map<number, MatchStateTeamBackpack> => {
  const accumulators = new Map<
    number,
    {
      playerIds: Set<string>;
      items: Map<string, MatchStateBackpackItem>;
      raw: Record<string, unknown>[];
    }
  >();

  for (const record of extractTelemetryBackpackRecords(payload)) {
    const slot = telemetryBackpackTeamSlot(record);
    if (slot === null) {
      continue;
    }
    const utilityItems = normalizeTelemetryUtilityItems(record);
    if (utilityItems.length === 0) {
      continue;
    }
    const accumulator = accumulators.get(slot) ?? {
      playerIds: new Set<string>(),
      items: new Map<string, MatchStateBackpackItem>(),
      raw: [],
    };
    const playerId = telemetryBackpackPlayerId(record);
    if (playerId) {
      accumulator.playerIds.add(playerId);
    }
    accumulator.raw.push(record);
    for (const item of utilityItems) {
      const key = item.itemId ?? item.name ?? 'unknown';
      const existing = accumulator.items.get(key);
      accumulator.items.set(key, {
        ...item,
        count: (existing?.count ?? 0) + (item.count ?? 1),
      });
    }
    accumulators.set(slot, accumulator);
  }

  const backpacks = new Map<number, MatchStateTeamBackpack>();
  for (const [slot, accumulator] of accumulators) {
    const items = Array.from(accumulator.items.values());
    const itemCount = items.reduce(
      (sum, item) => sum + Math.max(0, item.count ?? 0),
      0,
    );
    backpacks.set(slot, {
      teamId: null,
      slot,
      playerId:
        accumulator.playerIds.size === 1
          ? Array.from(accumulator.playerIds)[0]
          : null,
      items,
      equipment: items,
      itemCount,
      raw: accumulator.raw,
    });
  }
  return backpacks;
};

const applyTelemetryUtilityBackpacks = (
  payload: MatchState,
  backpacksBySlot: Map<number, MatchStateTeamBackpack>,
): MatchState => {
  if (backpacksBySlot.size === 0) {
    return payload;
  }

  let changed = false;
  const leaderboard = payload.leaderboard.map((row) => {
    const slot =
      typeof row.slot === 'number' && Number.isFinite(row.slot)
        ? Math.trunc(row.slot)
        : null;
    const backpack = slot === null ? null : (backpacksBySlot.get(slot) ?? null);
    if (!backpack || row.isEliminated || row.alivePlayers <= 0) {
      return row;
    }
    changed = true;
    const teamBackpack = {
      ...backpack,
      teamId: row.teamId,
      slot: row.slot,
    };
    return {
      ...row,
      backpack: teamBackpack,
      equipment: teamBackpack,
    };
  });

  return changed ? { ...payload, leaderboard } : payload;
};

const playerHealthLookupKeys = (
  row: MatchStateLeaderboardRow,
  player: MatchStateLeaderboardPlayer,
): string[] => {
  const keys = [player.playerId, player.externalPlayerId, player.pubgPlayerId]
    .map((value) => stringValue(value))
    .filter((value): value is string => !!value)
    .map((value) => `id:${value}`);
  const name = normalizePlayerLookupName(player.playerName);
  if (name) {
    if (typeof row.slot === 'number' && Number.isFinite(row.slot)) {
      keys.push(`slot-name:${Math.trunc(row.slot)}:${name}`);
    }
    keys.push(`name:${name}`);
  }
  return Array.from(new Set(keys));
};

const resolvePlayerTelemetryHealth = (
  row: MatchStateLeaderboardRow,
  player: MatchStateLeaderboardPlayer,
  healthByKey: Map<string, number | null>,
): number | null => {
  for (const key of playerHealthLookupKeys(row, player)) {
    const health = healthByKey.get(key);
    if (health !== undefined && health !== null) {
      return health;
    }
  }
  return null;
};

const applyTelemetryPlayerHealth = (
  payload: MatchState,
  healthByKey: Map<string, number | null>,
): MatchState => {
  if (healthByKey.size === 0) {
    return payload;
  }

  let changed = false;
  const leaderboard = payload.leaderboard.map((row) => {
    if (!Array.isArray(row.players) || row.players.length === 0) {
      return row;
    }

    let rowChanged = false;
    const players = row.players.map((player) => {
      const health = resolvePlayerTelemetryHealth(row, player, healthByKey);
      if (health === null || player.health === health) {
        return player;
      }
      rowChanged = true;
      return {
        ...player,
        health,
        lifeTelemetryFresh:
          player.lifeTelemetryFresh === true || health !== null,
      };
    });
    if (!rowChanged) {
      return row;
    }
    changed = true;
    return { ...row, players };
  });

  return changed ? { ...payload, leaderboard } : payload;
};

const parseTime = (value: string | null | undefined): number => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toIso = (value: number | string | null | undefined): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return null;
};

const hasMeaningfulKillFeed = (entries: MatchStateKillFeedEntry[]): boolean =>
  entries.some(
    (entry) =>
      !!entry.killerName ||
      !!entry.killerTeam ||
      !!entry.victimName ||
      !!entry.victimTeam ||
      !!entry.weapon,
  );

const hasMeaningfulPlayerCard = (
  playerCard: MatchStatePlayerCard | null,
): boolean =>
  !!(
    playerCard &&
    (playerCard.playerId ||
      playerCard.name ||
      playerCard.teamId ||
      playerCard.teamTag ||
      playerCard.logoUrl)
  );

const normalizeLookupText = (value: string | null | undefined): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const teamPlayerLookupKey = (
  teamId: string | null | undefined,
  playerName: string | null | undefined,
): string | null => {
  const normalizedTeamId = String(teamId ?? '').trim();
  const normalizedPlayerName = normalizeLookupText(playerName);
  if (!normalizedTeamId || !normalizedPlayerName) {
    return null;
  }
  return `${normalizedTeamId}:${normalizedPlayerName}`;
};

const isUsefulPlayerPhotoUrl = (value: string | null | undefined): boolean => {
  const normalized = normalizePublicAssetUrl(value);
  if (!normalized) {
    return false;
  }
  const lower = normalized.toLowerCase();
  return !DEFAULT_PLAYER_PHOTO_MARKERS.some((marker) => lower.includes(marker));
};

const preferSavedPlayerPhoto = (
  current: string | null | undefined,
  saved: string | null | undefined,
): string | null => {
  const normalizedCurrent = normalizePublicAssetUrl(current);
  if (isUsefulPlayerPhotoUrl(normalizedCurrent)) {
    return normalizedCurrent;
  }
  const normalizedSaved = normalizePublicAssetUrl(saved);
  return isUsefulPlayerPhotoUrl(normalizedSaved)
    ? normalizedSaved
    : normalizedCurrent;
};

const asPlainRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const textFromUnknown = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
};

const firstRecordText = (
  record: Record<string, unknown> | null,
  keys: string[],
): string | null => {
  if (!record) return null;
  for (const key of keys) {
    const value = textFromUnknown(record[key]);
    if (value) return value;
  }
  return null;
};

const firstRecordNumber = (
  record: Record<string, unknown> | null,
  keys: string[],
): number | null => {
  if (!record) return null;
  for (const key of keys) {
    const raw = record[key];
    const parsed =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim()
          ? Number(raw)
          : Number.NaN;
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return null;
};

const normalizeFocusPayload = (
  payload: unknown,
): ObserverFocusCandidate | null => {
  const root = asPlainRecord(payload);
  if (!root) return null;

  const nested =
    asPlainRecord(root.observedPlayer) ??
    asPlainRecord(root.observingPlayer) ??
    asPlainRecord(root.observer) ??
    asPlainRecord(root.ObservingPlayer) ??
    asPlainRecord(root.data) ??
    asPlainRecord(root.Data) ??
    root;

  const pubgPlayerId = firstRecordText(nested, [
    'uId',
    'UId',
    'uid',
    'UID',
    '0',
    'pubgPlayerId',
    'inGameId',
    'playerId',
    'playerID',
    'PlayerId',
    'PlayerID',
    'id',
    'ID',
  ]);
  const externalPlayerId =
    firstRecordText(nested, ['externalPlayerId', 'externalId']) ?? pubgPlayerId;
  const playerOpenId = firstRecordText(nested, [
    'playerOpenId',
    'playerOpenID',
    'PlayerOpenId',
    'PlayerOpenID',
    'openId',
    'OpenId',
    'openid',
  ]);
  const playerName = firstRecordText(nested, [
    'playerName',
    'PlayerName',
    'ign',
    'IGN',
    'name',
    'Name',
  ]);

  if (!pubgPlayerId && !externalPlayerId && !playerOpenId && !playerName) {
    return null;
  }

  return {
    playerId: pubgPlayerId ?? externalPlayerId ?? playerOpenId,
    externalPlayerId,
    pubgPlayerId,
    playerOpenId,
    playerName,
    teamId: firstRecordText(nested, [
      'teamId',
      'teamID',
      'TeamId',
      'TeamID',
      'team_id',
    ]),
    teamName: firstRecordText(nested, ['teamName', 'TeamName']),
    teamTag: firstRecordText(nested, ['teamTag', 'TeamTag', 'tag', 'Tag']),
    slot: firstRecordNumber(nested, [
      'slot',
      'Slot',
      'teamNo',
      'TeamNo',
      'teamNumber',
      'TeamNumber',
    ]),
  };
};

const extractTelemetryObserverFocus = (
  payload: unknown,
): ObserverFocusCandidate | null => {
  const root = asPlainRecord(payload);
  if (!root) return null;

  const raw = asPlainRecord(root.raw);
  const observerSnapshot = asPlainRecord(root.observerSnapshot);
  const candidates = [
    root.observedPlayer,
    root.observingPlayer,
    root.observer,
    raw?.observedPlayer,
    raw?.observingPlayer,
    raw?.observer,
    observerSnapshot?.observingPlayer,
    observerSnapshot?.observer,
  ];

  for (const candidate of candidates) {
    const focus = normalizeFocusPayload(candidate);
    if (focus) return focus;
  }
  return null;
};

const focusLookupIds = (focus: ObserverFocusCandidate): string[] =>
  Array.from(
    new Set(
      [
        focus.playerId,
        focus.externalPlayerId,
        focus.pubgPlayerId,
        focus.playerOpenId,
      ]
        .map(normalizeLookupText)
        .filter(Boolean),
    ),
  );

const playerLookupIds = (player: MatchStateLeaderboardPlayer): string[] =>
  Array.from(
    new Set(
      [player.playerId, player.externalPlayerId, player.pubgPlayerId]
        .map(normalizeLookupText)
        .filter(Boolean),
    ),
  );

const teamMatchesFocus = (
  row: MatchStateLeaderboardRow,
  focus: ObserverFocusCandidate,
): boolean => {
  const focusTeamId = normalizeLookupText(focus.teamId);
  const focusTeamName = normalizeLookupText(focus.teamName);
  const focusTeamTag = normalizeLookupText(focus.teamTag);
  if (!focusTeamId && !focusTeamName && !focusTeamTag && focus.slot === null) {
    return true;
  }

  return (
    (!!focusTeamId &&
      (normalizeLookupText(row.teamId) === focusTeamId ||
        String(row.slot ?? '')
          .trim()
          .toLowerCase() === focusTeamId)) ||
    (!!focusTeamName && normalizeLookupText(row.teamName) === focusTeamName) ||
    (!!focusTeamTag && normalizeLookupText(row.teamTag) === focusTeamTag) ||
    (focus.slot !== null && row.slot === focus.slot)
  );
};

const findFocusedLeaderboardPlayer = (
  payload: MatchState,
  focus: ObserverFocusCandidate | null,
): {
  row: MatchStateLeaderboardRow;
  player: MatchStateLeaderboardPlayer;
} | null => {
  if (!focus) return null;

  const ids = focusLookupIds(focus);
  const name = normalizeLookupText(focus.playerName);

  if (ids.length > 0) {
    for (const row of payload.leaderboard ?? []) {
      const players = row.players ?? [];
      for (const player of players) {
        const playerMatches = playerLookupIds(player).some((id) =>
          ids.includes(id),
        );
        if (playerMatches && teamMatchesFocus(row, focus)) {
          return { row, player };
        }
      }
    }
  }

  for (const row of payload.leaderboard ?? []) {
    const players = row.players ?? [];
    for (const player of players) {
      if (
        !!name &&
        normalizeLookupText(player.playerName) === name &&
        teamMatchesFocus(row, focus)
      ) {
        return { row, player };
      }
    }
  }
  return null;
};

const applyObserverFocus = (
  payload: MatchState,
  focus: ObserverFocusCandidate | null,
): MatchState => {
  const matched = findFocusedLeaderboardPlayer(payload, focus);
  if (!matched) {
    return payload;
  }

  const { row, player } = matched;
  return {
    ...payload,
    playerCard: {
      playerId: player.playerId,
      name: player.playerName,
      avatarUrl: player.avatarUrl,
      teamId: row.teamId,
      teamName: row.teamName,
      teamTag: row.teamTag,
      logoUrl: row.logoUrl,
      color: row.color,
      kills: player.kills,
      alive: player.alive,
      damage: null,
    },
  };
};

function buildLiveCircle(live: LiveMatchState): MatchStateCircle | null {
  if (!live.circle) return null;
  return {
    phase:
      typeof live.circle.phase === 'number' || live.circle.phase === null
        ? live.circle.phase
        : null,
    nextShrinkAt: toIso(live.circle.nextShrinkAt),
    safeZone: live.circle.safeZone ?? null,
    nextZone: live.circle.nextZone ?? null,
  };
}

function buildLiveState(live: LiveMatchState): MatchState {
  const teams = Array.isArray(live.teams)
    ? live.teams.filter(isPlayingLiveTeam)
    : [];
  const teamById = new Map(teams.map((team) => [team.teamId, team] as const));
  const allPlayers = teams.flatMap((team) =>
    (team.players ?? []).map((player) => ({
      team,
      player,
    })),
  );

  const leaderboard: MatchStateLeaderboardRow[] = teams.map((team, index) => {
    const teamPlayers = Array.isArray(team.players) ? team.players : [];
    const derivedAlivePlayers = deriveAlivePlayersFromRows(
      teamPlayers.map((player) => ({
        playerId: player.playerId ?? player.id ?? null,
        playerName: player.ign ?? player.name ?? 'Unknown Player',
        avatarUrl: player.avatarUrl ?? null,
        kills: player.kills ?? 0,
        alive: player.alive === true,
        knocked: player.knocked === true,
        health: player.health ?? null,
        hasDied: player.eliminated ?? !player.alive,
        lifeTelemetryFresh: player.lifeTelemetryFresh === true,
      })),
    );
    const alivePlayers =
      derivedAlivePlayers ??
      (typeof team.alivePlayers === 'number'
        ? team.alivePlayers
        : teamPlayers.filter((player) => player.alive === true).length);
    const totalPlayers =
      typeof team.totalPlayers === 'number'
        ? team.totalPlayers
        : teamPlayers.length;

    return {
      rank: index + 1,
      teamId: team.teamId ?? null,
      slot: team.slot ?? null,
      teamName: team.name?.trim() || DEFAULT_WIDGET_TEAM_NAME,
      teamTag: team.tag ?? DEFAULT_WIDGET_TEAM_TAG,
      logoUrl: normalizeLogoUrl(team.teamId, team.logoUrl),
      color: null,
      kills: team.kills ?? 0,
      alivePlayers,
      totalPlayers,
      placement: team.placement ?? null,
      isEliminated:
        derivedAlivePlayers !== null
          ? alivePlayers === 0
          : team.eliminated === true || alivePlayers === 0,
      backpack: team.backpack ?? null,
      equipment: team.equipment ?? team.backpack ?? null,
      players: teamPlayers.map((player) => ({
        playerId: player.playerId ?? player.id ?? null,
        externalPlayerId: player.externalPlayerId ?? null,
        pubgPlayerId: player.pubgPlayerId ?? null,
        playerName:
          player.name?.trim() ||
          player.ign?.trim() ||
          player.externalPlayerId?.trim() ||
          player.pubgPlayerId?.trim() ||
          'Unknown Player',
        avatarUrl: normalizePublicAssetUrl(player.avatarUrl),
        kills: player.kills ?? 0,
        assists: player.assists ?? 0,
        alive: player.alive === true,
        knocked: player.knocked === true,
        health: player.health ?? null,
        hasDied: player.eliminated ?? !player.alive,
        lifeTelemetryFresh: false,
      })),
    };
  });

  const killFeed: MatchStateKillFeedEntry[] = (live.killFeed ?? [])
    .map((item) => {
      const killerTeam = item.killerTeamId
        ? teamById.get(item.killerTeamId)
        : null;
      const victimTeam = item.victimTeamId
        ? teamById.get(item.victimTeamId)
        : null;
      return {
        id: item.id,
        killerName: item.killerName ?? null,
        killerTeam: killerTeam?.tag ?? killerTeam?.name ?? null,
        victimName: item.victimName ?? null,
        victimTeam: victimTeam?.tag ?? victimTeam?.name ?? null,
        weapon: item.weapon ?? null,
        tsIso: toIso(item.ts),
      };
    })
    .slice(-8)
    .reverse();

  const observed = live.observedPlayer ?? null;
  const observedPlayer =
    (observed
      ? allPlayers.find(({ team, player }) => {
          const livePlayerId = player.playerId ?? player.id ?? null;
          const livePlayerName = player.name ?? player.ign ?? null;
          return (
            (observed.playerId && livePlayerId === observed.playerId) ||
            (observed.pubgPlayerId &&
              player.pubgPlayerId === observed.pubgPlayerId) ||
            (observed.playerName &&
              livePlayerName === observed.playerName &&
              (!observed.teamId || observed.teamId === team.teamId))
          );
        })
      : null) ?? null;

  const latestKiller = (live.killFeed ?? []).find(
    (entry) => entry.killerPlayerId || entry.killerName,
  );
  const killFeedPlayer =
    (latestKiller
      ? allPlayers.find(({ player }) => {
          const livePlayerId = player.playerId ?? player.id ?? null;
          const livePlayerName = player.name ?? player.ign ?? null;
          return (
            (latestKiller.killerPlayerId &&
              livePlayerId === latestKiller.killerPlayerId) ||
            (latestKiller.killerName &&
              livePlayerName === latestKiller.killerName)
          );
        })
      : null) ?? null;

  const featuredPlayer =
    observedPlayer ??
    killFeedPlayer ??
    [...allPlayers].sort((left, right) => {
      if ((right.player.kills ?? 0) !== (left.player.kills ?? 0)) {
        return (right.player.kills ?? 0) - (left.player.kills ?? 0);
      }
      if (left.player.alive !== right.player.alive) {
        return Number(right.player.alive) - Number(left.player.alive);
      }
      return (left.player.name ?? left.player.ign ?? '').localeCompare(
        right.player.name ?? right.player.ign ?? '',
      );
    })[0] ??
    null;

  const playerCard: MatchStatePlayerCard | null = featuredPlayer
    ? {
        playerId:
          featuredPlayer.player.playerId ?? featuredPlayer.player.id ?? null,
        name: featuredPlayer.player.name ?? featuredPlayer.player.ign ?? null,
        avatarUrl: normalizePublicAssetUrl(featuredPlayer.player.avatarUrl),
        teamId: featuredPlayer.team.teamId ?? null,
        teamName: featuredPlayer.team.name ?? DEFAULT_WIDGET_TEAM_NAME,
        teamTag: featuredPlayer.team.tag ?? DEFAULT_WIDGET_TEAM_TAG,
        logoUrl: normalizeLogoUrl(
          featuredPlayer.team.teamId,
          featuredPlayer.team.logoUrl,
        ),
        color: null,
        kills: featuredPlayer.player.kills ?? 0,
        alive: featuredPlayer.player.alive === true,
        damage: null,
      }
    : null;

  const liveStatus = String(live.status ?? '').toUpperCase();
  const winnerEligible =
    liveStatus === 'FINISH_PENDING' ||
    liveStatus === 'FINISHED' ||
    liveStatus === 'ENDED' ||
    liveStatus === 'LOCKED' ||
    live.summary?.aliveTeams === 1;
  const winnerTeam = winnerEligible
    ? ((live.summary?.winnerTeamId
        ? (teams.find((team) => team.teamId === live.summary?.winnerTeamId) ??
          null)
        : null) ??
      teams.find((team) => team.placement === 1) ??
      (live.summary?.aliveTeams === 1
        ? (teams.find(
            (team) =>
              (team.alivePlayers ??
                team.players?.filter((p) => p.alive).length ??
                0) > 0,
          ) ?? null)
        : null))
    : null;

  const winner: MatchStateWinner | null = winnerTeam
    ? {
        teamId: winnerTeam.teamId ?? null,
        slot: winnerTeam.slot ?? null,
        teamName: winnerTeam.name?.trim() || DEFAULT_WIDGET_TEAM_NAME,
        teamTag: winnerTeam.tag ?? DEFAULT_WIDGET_TEAM_TAG,
        logoUrl: normalizeLogoUrl(winnerTeam.teamId, winnerTeam.logoUrl),
        color: null,
        kills: winnerTeam.kills ?? 0,
        alivePlayers:
          winnerTeam.alivePlayers ??
          winnerTeam.players?.filter((player) => player.alive === true)
            .length ??
          0,
        placement: winnerTeam.placement ?? null,
      }
    : null;

  return {
    matchId: live.matchId,
    updatedAt: live.updatedAt,
    teamsAlive:
      live.summary?.aliveTeams ??
      leaderboard.filter((row) => !row.isEliminated && row.alivePlayers > 0)
        .length,
    leaderboard,
    killFeed,
    playerCard,
    circle: buildLiveCircle(live),
    winner,
  };
}

function mergeStates(
  observer: MatchState,
  live: MatchState | null,
): MatchState {
  if (!live) {
    return observer;
  }

  const liveLeaderboard = live.leaderboard ?? [];
  const observerLeaderboard = observer.leaderboard ?? [];
  // Keep observer stats authoritative for live widget digits, while using
  // canonical state only to backfill metadata like names, tags, and logos.
  const mergedLeaderboard = mergeLeaderboardRows(
    observerLeaderboard,
    liveLeaderboard,
  );
  const inferredTeamsAlive = countAliveRows(mergedLeaderboard);
  const observerHasPrimaryLeaderboardState =
    observerLeaderboard.length > 0 || observer.winner != null;
  const teamsAlive = observerHasPrimaryLeaderboardState
    ? observer.teamsAlive > 0
      ? observer.teamsAlive
      : inferredTeamsAlive > 0
        ? inferredTeamsAlive
        : live.teamsAlive
    : live.teamsAlive > 0
      ? live.teamsAlive
      : inferredTeamsAlive > 0
        ? inferredTeamsAlive
        : observer.teamsAlive;
  const killFeed = hasMeaningfulKillFeed(observer.killFeed ?? [])
    ? observer.killFeed
    : live.killFeed;
  const playerCard = hasMeaningfulPlayerCard(observer.playerCard)
    ? {
        playerId:
          observer.playerCard?.playerId ?? live.playerCard?.playerId ?? null,
        name: observer.playerCard?.name ?? live.playerCard?.name ?? null,
        avatarUrl: normalizePublicAssetUrl(
          observer.playerCard?.avatarUrl ?? live.playerCard?.avatarUrl ?? null,
        ),
        teamId: observer.playerCard?.teamId ?? live.playerCard?.teamId ?? null,
        teamName: chooseTeamName(
          observer.playerCard?.teamName,
          live.playerCard?.teamName,
          null,
        ),
        teamTag:
          observer.playerCard?.teamTag ??
          live.playerCard?.teamTag ??
          DEFAULT_WIDGET_TEAM_TAG,
        logoUrl: normalizeLogoUrl(
          observer.playerCard?.teamId ?? live.playerCard?.teamId ?? null,
          observer.playerCard?.logoUrl ?? live.playerCard?.logoUrl ?? null,
        ),
        color: observer.playerCard?.color ?? live.playerCard?.color ?? null,
        kills: observer.playerCard?.kills ?? live.playerCard?.kills ?? 0,
        alive: observer.playerCard?.alive ?? live.playerCard?.alive ?? false,
        damage: observer.playerCard?.damage ?? live.playerCard?.damage ?? null,
      }
    : normalizePlayerCard(live.playerCard);

  return {
    matchId: observer.matchId || live.matchId,
    updatedAt:
      parseTime(live.updatedAt) >= parseTime(observer.updatedAt)
        ? live.updatedAt
        : observer.updatedAt,
    teamsAlive,
    leaderboard: mergedLeaderboard.map((row) => ({
      ...row,
      logoUrl: normalizeLogoUrl(row.teamId, row.logoUrl),
    })),
    killFeed,
    playerCard: normalizePlayerCard(playerCard),
    circle: observer.circle ?? live.circle,
    winner: normalizeWinner(observer.winner ?? live.winner),
  };
}

function normalizeWinner(
  winner: MatchStateWinner | null,
): MatchStateWinner | null {
  return winner
    ? {
        ...winner,
        logoUrl: normalizeLogoUrl(winner.teamId, winner.logoUrl),
      }
    : null;
}

function normalizePlayerCard(
  playerCard: MatchStatePlayerCard | null,
): MatchStatePlayerCard | null {
  return playerCard
    ? {
        ...playerCard,
        avatarUrl: normalizePublicAssetUrl(playerCard.avatarUrl),
        logoUrl: normalizeLogoUrl(playerCard.teamId, playerCard.logoUrl),
      }
    : null;
}

@Injectable()
export class ObserverWidgetStateService {
  constructor(
    private readonly matchState: MatchStateService,
    @Inject(forwardRef(() => CanonicalControlReadService))
    private readonly canonicalRead: CanonicalControlReadService,
    @Optional()
    @Inject(forwardRef(() => TelemetryEngineService))
    private readonly telemetryEngine?: TelemetryEngineService,
    @Optional()
    @Inject(forwardRef(() => TelemetryBroadcastService))
    private readonly telemetryBroadcast?: TelemetryBroadcastService,
    @Optional()
    private readonly prisma?: PrismaService,
  ) {}

  private async getTelemetryLiveState(
    matchId: string,
  ): Promise<LiveMatchState | null> {
    if (!this.telemetryEngine || !this.telemetryBroadcast) {
      return null;
    }

    return this.telemetryEngine
      .getState(matchId)
      .then((state) => this.telemetryBroadcast!.toLiveMatchState(state))
      .catch(() => null);
  }

  private async getHttpLiveState(
    matchId: string,
  ): Promise<LiveMatchState | null> {
    return fetch(
      `${LOCAL_API_BASE_URL}/api/matches/${encodeURIComponent(matchId)}/state`,
      {
        cache: 'no-store',
        signal: AbortSignal.timeout(1_500),
      },
    )
      .then(async (response) => {
        if (!response.ok) {
          return null;
        }
        const payload = (await response.json()) as Partial<LiveMatchState>;
        return Array.isArray(payload.teams)
          ? (payload as LiveMatchState)
          : null;
      })
      .catch(() => null);
  }

  private async getTelemetryObserverFocus(
    matchId: string,
  ): Promise<ObserverFocusCandidate | null> {
    if (!this.prisma?.matchTelemetry) {
      return null;
    }

    return this.prisma.matchTelemetry
      .findUnique({
        where: { matchId },
        select: { payload: true },
      })
      .then((row) => extractTelemetryObserverFocus(row?.payload))
      .catch(() => null);
  }

  private async getTelemetryUtilityBackpacks(
    matchId: string,
  ): Promise<Map<number, MatchStateTeamBackpack>> {
    if (!this.prisma?.matchTelemetry) {
      return new Map();
    }

    return this.prisma.matchTelemetry
      .findUnique({
        where: { matchId },
        select: { payload: true },
      })
      .then((row) => buildTelemetryUtilityBackpacksBySlot(row?.payload))
      .catch(() => new Map());
  }

  private async getTelemetryPlayerHealth(
    matchId: string,
  ): Promise<Map<string, number | null>> {
    if (!this.prisma?.matchTelemetry) {
      return new Map();
    }

    return this.prisma.matchTelemetry
      .findUnique({
        where: { matchId },
        select: { payload: true },
      })
      .then((row) => buildTelemetryPlayerHealthLookup(row?.payload))
      .catch(() => new Map());
  }

  private async finalizePayload(
    matchId: string,
    payload: MatchState,
  ): Promise<MatchState> {
    const [focus, utilityBackpacks, playerHealth] = await Promise.all([
      this.getTelemetryObserverFocus(matchId),
      this.getTelemetryUtilityBackpacks(matchId),
      this.getTelemetryPlayerHealth(matchId),
    ]);
    return this.hydratePlayerPhotos(
      applyTelemetryPlayerHealth(
        applyTelemetryUtilityBackpacks(
          applyObserverFocus(payload, focus),
          utilityBackpacks,
        ),
        playerHealth,
      ),
    );
  }

  private async hydratePlayerPhotos(payload: MatchState): Promise<MatchState> {
    if (!this.prisma) {
      return payload;
    }

    const candidates: Array<{
      playerId: string | null;
      externalPlayerId: string | null;
      pubgPlayerId: string | null;
      playerName: string | null;
      teamId: string | null;
    }> = [];

    for (const row of payload.leaderboard ?? []) {
      for (const player of row.players ?? []) {
        candidates.push({
          playerId: player.playerId,
          externalPlayerId: player.externalPlayerId ?? null,
          pubgPlayerId: player.pubgPlayerId ?? null,
          playerName: player.playerName,
          teamId: row.teamId,
        });
      }
    }

    if (payload.playerCard) {
      candidates.push({
        playerId: payload.playerCard.playerId,
        externalPlayerId: null,
        pubgPlayerId: null,
        playerName: payload.playerCard.name,
        teamId: payload.playerCard.teamId,
      });
    }

    const playerIds = Array.from(
      new Set(
        candidates
          .map((candidate) => candidate.playerId?.trim())
          .filter((value): value is string => !!value),
      ),
    );
    const externalPlayerIds = Array.from(
      new Set(
        candidates
          .map((candidate) => candidate.externalPlayerId?.trim())
          .filter((value): value is string => !!value),
      ),
    );
    const pubgPlayerIds = Array.from(
      new Set(
        candidates
          .map((candidate) => candidate.pubgPlayerId?.trim())
          .filter((value): value is string => !!value),
      ),
    );
    const teamNamePairs = Array.from(
      new Map(
        candidates
          .map((candidate) => {
            const teamId = candidate.teamId?.trim() ?? '';
            const playerName = candidate.playerName?.trim() ?? '';
            const key = teamPlayerLookupKey(teamId, playerName);
            return key ? [key, { teamId, playerName }] : null;
          })
          .filter(
            (pair): pair is [string, { teamId: string; playerName: string }] =>
              pair !== null,
          ),
      ).values(),
    );

    const whereClauses: Prisma.PlayerWhereInput[] = [];
    if (playerIds.length > 0) {
      whereClauses.push({ id: { in: playerIds } });
    }
    if (externalPlayerIds.length > 0) {
      whereClauses.push({ externalPlayerId: { in: externalPlayerIds } });
    }
    if (pubgPlayerIds.length > 0) {
      whereClauses.push({ pubgPlayerId: { in: pubgPlayerIds } });
    }
    for (const pair of teamNamePairs) {
      whereClauses.push({
        teamId: pair.teamId,
        ign: { equals: pair.playerName, mode: 'insensitive' },
      });
    }
    if (whereClauses.length === 0) {
      return payload;
    }

    const savedPlayers = await this.prisma.player
      .findMany({
        where: {
          deletedAt: null,
          OR: whereClauses,
        },
        select: {
          id: true,
          ign: true,
          teamId: true,
          externalPlayerId: true,
          pubgPlayerId: true,
          photoUrl: true,
        },
      })
      .catch(() => []);

    if (savedPlayers.length === 0) {
      return payload;
    }

    const photoByPlayerId = new Map<string, string>();
    const photoByExternalPlayerId = new Map<string, string>();
    const photoByPubgPlayerId = new Map<string, string>();
    const photoByTeamPlayerName = new Map<string, string>();
    for (const player of savedPlayers) {
      const photoUrl = normalizePublicAssetUrl(player.photoUrl);
      if (!photoUrl || !isUsefulPlayerPhotoUrl(photoUrl)) {
        continue;
      }
      photoByPlayerId.set(player.id, photoUrl);
      if (player.externalPlayerId) {
        photoByExternalPlayerId.set(player.externalPlayerId, photoUrl);
      }
      if (player.pubgPlayerId) {
        photoByPubgPlayerId.set(player.pubgPlayerId, photoUrl);
      }
      const key = teamPlayerLookupKey(player.teamId, player.ign);
      if (key && !photoByTeamPlayerName.has(key)) {
        photoByTeamPlayerName.set(key, photoUrl);
      }
    }

    if (
      photoByPlayerId.size === 0 &&
      photoByExternalPlayerId.size === 0 &&
      photoByPubgPlayerId.size === 0 &&
      photoByTeamPlayerName.size === 0
    ) {
      return payload;
    }

    const resolvePhoto = (
      current: string | null | undefined,
      playerId: string | null | undefined,
      externalPlayerId: string | null | undefined,
      pubgPlayerId: string | null | undefined,
      playerName: string | null | undefined,
      teamId: string | null | undefined,
    ): string | null => {
      const savedById = playerId
        ? photoByPlayerId.get(playerId.trim())
        : undefined;
      const savedByExternalId = externalPlayerId
        ? photoByExternalPlayerId.get(externalPlayerId.trim())
        : undefined;
      const savedByPubgId = pubgPlayerId
        ? photoByPubgPlayerId.get(pubgPlayerId.trim())
        : undefined;
      const savedByTeamName = teamPlayerLookupKey(teamId, playerName);
      return preferSavedPlayerPhoto(
        current,
        savedById ??
          savedByExternalId ??
          savedByPubgId ??
          (savedByTeamName
            ? photoByTeamPlayerName.get(savedByTeamName)
            : undefined),
      );
    };

    return {
      ...payload,
      leaderboard: payload.leaderboard.map((row) => ({
        ...row,
        players: row.players?.map((player) => ({
          ...player,
          avatarUrl: resolvePhoto(
            player.avatarUrl,
            player.playerId,
            player.externalPlayerId,
            player.pubgPlayerId,
            player.playerName,
            row.teamId,
          ),
        })),
      })),
      playerCard: payload.playerCard
        ? {
            ...payload.playerCard,
            avatarUrl: resolvePhoto(
              payload.playerCard.avatarUrl,
              payload.playerCard.playerId,
              null,
              null,
              payload.playerCard.name,
              payload.playerCard.teamId,
            ),
          }
        : null,
    };
  }

  async getMatchUpdate(
    matchId: string,
  ): Promise<ObserverWidgetMatchUpdatePayload> {
    const observerState = this.matchState.get(matchId);
    let liveState = await this.canonicalRead
      .getStateSnapshot(matchId)
      .catch(() => null);
    if (needsTelemetryFallback(observerState, liveState)) {
      liveState = chooseLiveState(
        liveState,
        await this.getTelemetryLiveState(matchId),
      );
      if (needsTelemetryFallback(observerState, liveState)) {
        liveState = chooseLiveState(
          liveState,
          await this.getHttpLiveState(matchId),
        );
      }
    }
    const payload = mergeStates(
      observerState,
      liveState ? buildLiveState(liveState) : null,
    );
    if (payload.teamsAlive > 0 && countAliveRows(payload.leaderboard) === 0) {
      const httpState = await this.getHttpLiveState(matchId);
      const httpPayload = mergeStates(
        observerState,
        httpState ? buildLiveState(httpState) : null,
      );
      if (countAliveRows(httpPayload.leaderboard) > 0) {
        return this.finalizePayload(matchId, httpPayload);
      }
    }
    return this.finalizePayload(matchId, payload);
  }

  emitMatchUpdate(payload: ObserverWidgetMatchUpdatePayload) {
    this.matchState.emitMatchUpdate(payload);
  }
}
