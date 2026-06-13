/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import {
  AuditAction,
  ControlState,
  GameKey,
  LobbyStatus,
  MatchStatus,
  PlayerSource,
  Prisma,
  Role,
  SessionRegistrationStatus,
  TeamMemberRole,
  TeamBanScope,
  TournamentStatus,
} from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth.types';
import { resolvePlayerPhoto } from '../../common/media-resolver';
import { uniqueSlotPlayerNames } from '../../common/slot-player-name.util';
import { PrismaService } from '../../db/prisma.service';
import { buildWidgetScoreboardSnapshot } from '../widgets/widgets.snapshot';
import { ResultsEventsService } from './results-events.service';
import type { MatchSummary } from './results.types';
import {
  requireMatchOrganization,
  requireOrgMatch,
} from '../../common/org/org.util';
import { type ResultLockContext } from './results.lock';
import { StandingsService } from '../standings/standings.service';
import { AuditService } from '../audit/audit.service';
import { computeSlotTotals } from '../scoring/points-core';
import { assertMatchWritable } from '../../common/policy/match-write.policy';
import { UpdateTeamResultsDto } from './dto/update-team-results.dto';
import { resolveTeamBranding } from '../../common/team-branding.util';
import { MatchControlService } from '../match-control/match-control.service';
import { LiveStateMirrorService } from '../match-control/live-state-mirror.service';
import {
  MatchControlStateStore,
  type LiveMatchState,
  toCanonicalMatchStateSourceMode,
} from '../match-control/state.store';
import {
  deriveCanonicalMatchLifecycleStatus,
  deriveMatchLockContract,
} from '../../common/match-status.util';
import {
  derivePcobBindingFlags,
  exposeSourceMode,
} from '../../common/match-telemetry-provider.util';
import {
  buildMatchPlayerKey,
  isAnonymousSlotPlayerKey,
} from '../../common/match-player-key.util';
import {
  comparePresenceStatus,
  derivePresenceStatus,
  isCompetitiveResultsTeam,
  isPresentInMatch,
} from '../../common/results-presence.util';
import {
  getMatchContext,
  isSessionMatch,
} from '../../common/match-context.util';
import { applyMatchScoreAdjustments } from '../../common/admin-adjustments.util';
import {
  readLiveSyncContract,
  appendLiveSyncAuditEntry,
  clearAllLiveSyncOverrides,
  clearLiveSyncPlayerOverrides,
  clearLiveSyncTeamOverrides,
  setLiveSyncPlayerOverride,
  setLiveSyncTeamOverride,
  writeLiveSyncContract,
  type LiveSyncAuditAction,
  type LiveSyncAuditEntry,
  type LiveSyncAuditScope,
  type LiveSyncContract,
  type LiveSyncFieldOwnership,
  type LiveSyncPlayerOwnership,
  type LiveSyncTeamOwnership,
} from '../../common/live-sync-contract.util';
import {
  derivePubgMatchState,
  derivePubgTeamState,
} from '../../common/pubg-match-rules.util';
import {
  defaultKillPointsForGame,
  defaultPlacementPointsForGame,
} from '../../common/game-rules.util';
import { TelemetryEngineService } from '../telemetry/telemetry-engine.service';
import type { TelemetryMatchState } from '../telemetry/telemetry.types';

type Tx = Prisma.TransactionClient;

type LockableMatch = {
  status?: string | null;
  liveState?: string | null;
  dataSource?: string | null;
  dataMode?: string | null;
  controlState?: {
    state?: string | null;
    metaJson?: Prisma.JsonValue | null;
    resultsManualLock?: boolean | null;
    resultsForceUnlock?: boolean | null;
  } | null;
  resultsManualLock?: boolean | null;
  resultsForceUnlock?: boolean | null;
};

type NormalizedPlayerState = {
  id: string;
  playerId: string | null;
  kills: number;
  assists: number;
  isAlive: boolean;
  isKnocked: boolean;
};

export type TelemetryFinalPlacementProjection = {
  totalTeams: number;
  aliveTeamsAtEnd: number;
  placementsAssigned: number;
  winnerTeamId: string | null;
  needsConfirmation?: boolean;
  ambiguities?: Array<{
    code: string;
    teamIds: string[];
    placementFrom: number;
    placementTo: number;
    detectedAt: string | null;
    message: string;
  }>;
  teams: Record<
    string,
    {
      placement: number;
      eliminatedOrder: number | null;
      eliminatedAt: number | null;
      totalKills: number;
      aliveAtEnd: boolean;
    }
  >;
};

type MaterializedSlotPlayer = {
  pubgAccountId: string | null;
  externalPlayerId: string | null;
  name: string;
  avatarUrl: string | null;
};

type ResultsDbClient = Prisma.TransactionClient | PrismaService;
type NoShowAutoBanScope = 'TEAM' | 'SESSION';
type NoShowAutoBanRuleType = 'TOTAL_MISSES' | 'MATCH_MISSED';
type NoShowAutoBanRule = {
  type: NoShowAutoBanRuleType;
  misses: number | null;
  matchNumber: number | null;
  durationDays: number | null;
  scope: NoShowAutoBanScope;
  reason: string;
  enabled: boolean;
};
type NoShowAutoBanCreatedBan = {
  teamId: string;
  teamName: string | null;
  teamTag: string | null;
  scope: NoShowAutoBanScope;
  reason: string;
  expiresAt: string | null;
  durationDays: number | null;
  missedMatches: string[];
  managerDiscordUserIds: string[];
};
type NoShowAutoBanApplyResult = {
  candidateTeamCount: number;
  rulesConfigured: number;
  createdTeamBans: number;
  createdManagerBans: number;
  createdTeamIds: string[];
  createdManagerDiscordUserIds: string[];
  createdBans: NoShowAutoBanCreatedBan[];
  skippedAlreadyBanned: number;
  skippedProtected: number;
  skippedNoRule: number;
};
type NoShowMissSummary = {
  keys: Set<string>;
  labels: string[];
  matchNumbers: Set<number>;
  matchNumberByKey: Map<string, number>;
};
type DiscordRole = {
  id: string;
  name: string;
  permissions: string;
};
type DiscordGuildMember = {
  roles?: string[];
};
type LiveTelemetryResultsReadContext = {
  lifecycleStatus: string;
  isManualSource: boolean;
  resultsManualLock: boolean;
  resultsForceUnlock: boolean;
  telemetryState: TelemetryMatchState | null;
  hasAcceptedTelemetry: boolean;
  isEarlyAirPhase: boolean;
};

const OPEN_ID_LIKE_MIN_LENGTH = 14;
const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DEFAULT_DISCORD_STAFF_ROLE_NAME = 'Arenzyra Staff';
const DISCORD_STAFF_ROLE_NAMES = new Set([
  '[OWNER]',
  'Arenzyra Admin',
  DEFAULT_DISCORD_STAFF_ROLE_NAME,
  'Production Lead',
  'Tournament Organizer',
]);
const DISCORD_PERMISSION = {
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
};

const isNumericText = (value: string | null | undefined): value is string =>
  typeof value === 'string' && /^\d+$/.test(value.trim());

const isRealPubgUidCandidate = (
  value: string | null | undefined,
  playerOpenId: string | null | undefined,
): value is string => {
  if (!isNumericText(value)) {
    return false;
  }
  const trimmed = value.trim();
  const openId = playerOpenId?.trim() ?? '';
  if (openId && trimmed === openId) {
    return false;
  }
  return trimmed.length < OPEN_ID_LIKE_MIN_LENGTH;
};

const discordRoleHasPermission = (
  role: DiscordRole,
  permission: bigint,
): boolean => {
  try {
    return (BigInt(role.permissions) & permission) === permission;
  } catch {
    return false;
  }
};

const normalizeControlState = (value?: string | null): ControlState => {
  const normalized = (value ?? '').toString().trim().toUpperCase();
  if (
    normalized === 'READY' ||
    normalized === 'COUNTDOWN' ||
    normalized === 'LIVE' ||
    normalized === 'PAUSED' ||
    normalized === 'ENDED' ||
    normalized === 'CONFIRMED'
  ) {
    return normalized as ControlState;
  }
  return 'READY';
};

@Injectable()
export class ResultsService {
  private readonly logger = new Logger('ResultsService');
  private readonly liveTelemetryProjectionSync = new Map<
    string,
    { version: number; updatedAt: number; syncedAt: number }
  >();
  private readonly liveTelemetryProjectionSyncInFlight = new Map<
    string,
    Promise<boolean>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: ResultsEventsService,
    private readonly standings: StandingsService,
    private readonly audit: AuditService,
    @Inject(forwardRef(() => MatchControlService))
    private readonly matchControl: MatchControlService,
    private readonly liveStateMirror: LiveStateMirrorService = null as never,
    private readonly matchControlStateStore: MatchControlStateStore = null as never,
    @Inject(forwardRef(() => TelemetryEngineService))
    private readonly telemetryEngine: TelemetryEngineService = null as never,
  ) {}

  private resolveAliveFlag(value: {
    isAlive?: boolean | null;
    alive?: boolean | null;
  }): boolean {
    if (typeof value?.isAlive === 'boolean') return value.isAlive;
    return true;
  }

  private asJsonRecord(
    value?: Prisma.JsonValue | Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    if (!value || Array.isArray(value) || typeof value !== 'object')
      return null;
    return value as Record<string, unknown>;
  }

  private toStringValue(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  private toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0);
  }

  private async discordRequest<T>(path: string): Promise<T | null> {
    const token = process.env.DISCORD_BOT_TOKEN?.trim();
    if (!token) {
      return null;
    }

    try {
      const response = await fetch(`${DISCORD_API_BASE_URL}${path}`, {
        headers: { Authorization: `Bot ${token}` },
      });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        this.logger.warn(
          `[NoShowAutoBan] Discord lookup failed path=${path} status=${response.status}`,
        );
        return null;
      }
      return (await response.json()) as T;
    } catch (error) {
      this.logger.warn(
        `[NoShowAutoBan] Discord lookup failed path=${path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async fetchDiscordGuildRoles(guildId: string) {
    return (
      (await this.discordRequest<DiscordRole[]>(
        `/guilds/${encodeURIComponent(guildId)}/roles`,
      )) ?? []
    );
  }

  private async fetchDiscordGuildMember(
    guildId: string,
    discordUserId: string,
  ) {
    return this.discordRequest<DiscordGuildMember>(
      `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(
        discordUserId,
      )}`,
    );
  }

  private autoBanProtectedRoleIds(
    config: {
      manageRoleIds?: Prisma.JsonValue | null;
      emojis?: Prisma.JsonValue | null;
    } | null,
    roles: DiscordRole[],
  ) {
    const emojis = this.asJsonRecord(config?.emojis ?? null);
    const manageRoleIds = this.toStringArray(config?.manageRoleIds ?? null);
    const configuredIds = new Set<string>(
      (manageRoleIds.length > 0
        ? manageRoleIds
        : [this.toStringValue(emojis?.staffRoleId)]
      ).filter((value): value is string => Boolean(value?.trim())),
    );

    const configuredNames = new Set<string>(
      (manageRoleIds.length > 0
        ? []
        : [
            DEFAULT_DISCORD_STAFF_ROLE_NAME,
            this.toStringValue(emojis?.staffRoleName),
          ]
      ).filter((value): value is string => Boolean(value?.trim())),
    );

    for (const role of roles) {
      if (
        configuredIds.has(role.id) ||
        configuredNames.has(role.name) ||
        (manageRoleIds.length === 0 &&
          DISCORD_STAFF_ROLE_NAMES.has(role.name)) ||
        discordRoleHasPermission(role, DISCORD_PERMISSION.ADMINISTRATOR) ||
        discordRoleHasPermission(role, DISCORD_PERMISSION.MANAGE_GUILD) ||
        discordRoleHasPermission(role, DISCORD_PERMISSION.MANAGE_CHANNELS)
      ) {
        configuredIds.add(role.id);
      }
    }

    return new Set([...configuredIds].filter((roleId) => roleId?.trim()));
  }

  private noShowAutoBanDelegatesAvailable(client: ResultsDbClient): boolean {
    const candidate = client as unknown as {
      match?: { findFirst?: unknown; findMany?: unknown };
      matchSlotResult?: { findMany?: unknown };
      session?: { findMany?: unknown };
      teamBan?: { findFirst?: unknown; create?: unknown };
      sessionRegistration?: {
        findMany?: unknown;
        update?: unknown;
        updateMany?: unknown;
      };
      matchTeam?: { updateMany?: unknown };
      matchSlot?: { updateMany?: unknown };
    };
    return (
      typeof candidate.match?.findFirst === 'function' &&
      typeof candidate.match?.findMany === 'function' &&
      typeof candidate.matchSlotResult?.findMany === 'function' &&
      typeof candidate.session?.findMany === 'function' &&
      typeof candidate.teamBan?.findFirst === 'function' &&
      typeof candidate.teamBan?.create === 'function' &&
      typeof candidate.sessionRegistration?.findMany === 'function' &&
      typeof candidate.sessionRegistration?.update === 'function' &&
      typeof candidate.sessionRegistration?.updateMany === 'function' &&
      typeof candidate.matchTeam?.updateMany === 'function' &&
      typeof candidate.matchSlot?.updateMany === 'function'
    );
  }

  private async teamHasAutoBanProtectedManager(
    client: ResultsDbClient,
    params: {
      organizationId: string;
      teamId: string;
      guildId: string | null;
      protectedRoleIds: Set<string>;
    },
  ): Promise<boolean> {
    if (!params.guildId || params.protectedRoleIds.size === 0) {
      return false;
    }

    const teamMemberDelegate = (
      client as unknown as {
        teamMember?: {
          findMany?: (args: unknown) => Promise<
            Array<{
              discordUserId: string;
              discordUsername?: string | null;
              role: TeamMemberRole;
            }>
          >;
        };
      }
    ).teamMember;
    if (typeof teamMemberDelegate?.findMany !== 'function') {
      return false;
    }

    const managers = await teamMemberDelegate.findMany({
      where: {
        organizationId: params.organizationId,
        teamId: params.teamId,
        role: TeamMemberRole.LEADER,
        deletedAt: null,
        leftAt: null,
      },
      select: {
        discordUserId: true,
        discordUsername: true,
        role: true,
      },
    });

    for (const manager of managers) {
      const member = await this.fetchDiscordGuildMember(
        params.guildId,
        manager.discordUserId,
      );
      if (
        member?.roles?.some((roleId) => params.protectedRoleIds.has(roleId))
      ) {
        return true;
      }
    }

    return false;
  }

  private parseNoShowAutoBanRules(value: unknown): NoShowAutoBanRule[] {
    const raw =
      typeof value === 'string'
        ? (() => {
            try {
              return JSON.parse(value) as unknown;
            } catch {
              return null;
            }
          })()
        : value;
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const record = entry as Record<string, unknown>;
        const type = this.noShowAutoBanRuleType(record);
        const misses =
          type === 'TOTAL_MISSES'
            ? this.noShowAutoBanRulePositiveInt(record.misses, 1, 20, 1)
            : null;
        const matchNumber =
          type === 'MATCH_MISSED'
            ? this.noShowAutoBanRulePositiveInt(
                record.matchNumber ?? record.match ?? record.game,
                1,
                99,
                1,
              )
            : null;
        const durationDays = this.noShowAutoBanRuleDurationDays(record);
        const scope =
          record.scope === TeamBanScope.TEAM
            ? TeamBanScope.TEAM
            : TeamBanScope.SESSION;
        const reason =
          this.toStringValue(record.reason) ??
          'Auto ban: missed {misses} match(es) in {session}';
        return {
          type,
          misses,
          matchNumber,
          durationDays,
          scope,
          reason,
          enabled: record.enabled === true,
        };
      })
      .filter((rule): rule is NoShowAutoBanRule => Boolean(rule))
      .filter((rule) => rule.enabled)
      .sort(
        (left, right) =>
          this.noShowRuleSortValue(left) - this.noShowRuleSortValue(right),
      );
  }

  private noShowAutoBanRuleType(
    record: Record<string, unknown>,
  ): NoShowAutoBanRuleType {
    const raw =
      this.toStringValue(record.type) ??
      this.toStringValue(record.ruleType) ??
      this.toStringValue(record.kind) ??
      '';
    const normalized = raw
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');
    if (
      normalized === 'MATCH_MISSED' ||
      normalized === 'SPECIFIC_MATCH' ||
      normalized === 'MATCH'
    ) {
      return 'MATCH_MISSED';
    }
    if (
      normalized === 'TOTAL_MISSES' ||
      normalized === 'TOTAL' ||
      normalized === 'MISSES'
    ) {
      return 'TOTAL_MISSES';
    }
    if (
      this.hasNoShowMatchRuleValue(record.matchNumber) ||
      this.hasNoShowMatchRuleValue(record.match) ||
      this.hasNoShowMatchRuleValue(record.game)
    ) {
      return 'MATCH_MISSED';
    }
    return 'TOTAL_MISSES';
  }

  private hasNoShowMatchRuleValue(value: unknown) {
    if (typeof value === 'string') {
      return value.trim() !== '';
    }
    if (typeof value === 'number') {
      return Number.isFinite(value);
    }
    if (typeof value === 'boolean') {
      return true;
    }
    return false;
  }

  private noShowAutoBanRulePositiveInt(
    value: unknown,
    min: number,
    max: number,
    fallback: number,
  ) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.trunc(parsed)));
  }

  private noShowAutoBanRuleDurationDays(
    record: Record<string, unknown>,
  ): number | null {
    const duration =
      this.toStringValue(record.duration) ??
      this.toStringValue(record.durationType) ??
      '';
    const rawDays = Object.prototype.hasOwnProperty.call(record, 'durationDays')
      ? record.durationDays
      : record.days;
    if (
      record.permanent === true ||
      /^(permanent|perm|none|0)$/i.test(duration.trim()) ||
      rawDays === null
    ) {
      return null;
    }
    return this.noShowAutoBanRulePositiveInt(rawDays, 1, 3650, 1);
  }

  private noShowRuleSortValue(rule: NoShowAutoBanRule) {
    return rule.type === 'MATCH_MISSED'
      ? (rule.matchNumber ?? 0)
      : (rule.misses ?? 0);
  }

  private noShowRuleStrength(rule: NoShowAutoBanRule) {
    return rule.durationDays === null ? 1_000_000 : rule.durationDays;
  }

  private noShowRuleTotalMissPriority(rule: NoShowAutoBanRule) {
    return rule.type === 'TOTAL_MISSES' ? (rule.misses ?? 1) : 0;
  }

  private noShowRuleSpecificity(rule: NoShowAutoBanRule) {
    return rule.type === 'MATCH_MISSED' ? 1 : 0;
  }

  private isNoShowRuleStronger(
    candidate: NoShowAutoBanRule,
    current: NoShowAutoBanRule,
  ) {
    const totalMissPriorityDiff =
      this.noShowRuleTotalMissPriority(candidate) -
      this.noShowRuleTotalMissPriority(current);
    if (
      totalMissPriorityDiff !== 0 &&
      Math.max(
        this.noShowRuleTotalMissPriority(candidate),
        this.noShowRuleTotalMissPriority(current),
      ) > 1
    ) {
      return totalMissPriorityDiff > 0;
    }
    const specificityDiff =
      this.noShowRuleSpecificity(candidate) -
      this.noShowRuleSpecificity(current);
    if (specificityDiff !== 0) {
      return specificityDiff > 0;
    }
    const strengthDiff =
      this.noShowRuleStrength(candidate) - this.noShowRuleStrength(current);
    if (strengthDiff !== 0) {
      return strengthDiff > 0;
    }
    return (
      this.noShowRuleSortValue(candidate) > this.noShowRuleSortValue(current)
    );
  }

  private selectNoShowAutoBanRule(params: {
    rules: NoShowAutoBanRule[];
    missCount: number;
    missedMatchNumbers: Set<number>;
  }): NoShowAutoBanRule | null {
    let selected: NoShowAutoBanRule | null = null;
    for (const rule of params.rules) {
      const matches =
        rule.type === 'MATCH_MISSED'
          ? Boolean(
              rule.matchNumber &&
              params.missedMatchNumbers.has(rule.matchNumber),
            )
          : params.missCount >= (rule.misses ?? 1);
      if (!matches) {
        continue;
      }
      if (!selected || this.isNoShowRuleStronger(rule, selected)) {
        selected = rule;
      }
    }
    return selected;
  }

  private formatNoShowAutoBanReason(
    template: string,
    context: {
      misses: number;
      sessionName: string;
      matchName: string;
      missedMatches?: string;
    },
  ) {
    const hasMissedMatchToken = /\{(?:match|missedMatches)\}/.test(template);
    const reason = template
      .replace(/\{misses\}/g, String(context.misses))
      .replace(/\{session\}/g, context.sessionName)
      .replace(/\{missedMatches\}/g, context.missedMatches ?? context.matchName)
      .replace(/\{match\}/g, context.missedMatches ?? context.matchName);
    const suffix =
      context.missedMatches && !hasMissedMatchToken
        ? ` - Missed ${context.missedMatches}`
        : '';
    return `${reason}${suffix}`.slice(0, 500);
  }

  private noShowMatchLabel(match: {
    matchNumber?: number | null;
    matchName?: string | null;
    name?: string | null;
  }) {
    if (Number.isInteger(match.matchNumber) && (match.matchNumber ?? 0) > 0) {
      return `G${match.matchNumber}`;
    }
    return match.matchName?.trim() || match.name?.trim() || 'Match';
  }

  private addNoShowMissSummary(
    summaries: Map<string, NoShowMissSummary>,
    teamId: string | null | undefined,
    key: string | null | undefined,
    label: string | null | undefined,
    matchNumber?: number | null,
  ) {
    const cleanTeamId = teamId?.trim();
    const cleanKey = key?.trim();
    if (!cleanTeamId || !cleanKey) {
      return;
    }
    let summary = summaries.get(cleanTeamId);
    if (!summary) {
      summary = {
        keys: new Set<string>(),
        labels: [],
        matchNumbers: new Set(),
        matchNumberByKey: new Map(),
      };
      summaries.set(cleanTeamId, summary);
    }
    if (summary.keys.has(cleanKey)) {
      return;
    }
    summary.keys.add(cleanKey);
    const cleanLabel = label?.trim();
    if (cleanLabel && !summary.labels.includes(cleanLabel)) {
      summary.labels.push(cleanLabel);
    }
    if (Number.isInteger(matchNumber) && (matchNumber ?? 0) > 0) {
      const normalizedMatchNumber = Math.trunc(matchNumber ?? 0);
      summary.matchNumbers.add(normalizedMatchNumber);
      summary.matchNumberByKey.set(cleanKey, normalizedMatchNumber);
    }
  }

  private activeTeamBanWhere(now = new Date()) {
    return {
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    } satisfies Prisma.TeamBanWhereInput;
  }

  private async createNoShowManagerBansForTeam(
    client: ResultsDbClient,
    params: {
      organizationId: string;
      teamId: string;
      scope: TeamBanScope;
      sessionId: string | null;
      reason: string;
      note: string;
      expiresAt: Date | null;
      createdManagerDiscordUserIds?: string[];
    },
  ): Promise<number> {
    const delegates = client as unknown as {
      teamMember?: {
        findMany?: (args: unknown) => Promise<
          Array<{
            discordUserId: string;
            discordUsername?: string | null;
            displayName?: string | null;
            role: TeamMemberRole;
            createdAt: Date;
          }>
        >;
      };
      managerBan?: {
        findFirst?: (args: unknown) => Promise<{ id: string } | null>;
        create?: (args: unknown) => Promise<unknown>;
      };
    };
    if (
      typeof delegates.teamMember?.findMany !== 'function' ||
      typeof delegates.managerBan?.findFirst !== 'function' ||
      typeof delegates.managerBan?.create !== 'function'
    ) {
      return 0;
    }

    const members = await delegates.teamMember.findMany({
      where: {
        organizationId: params.organizationId,
        teamId: params.teamId,
        deletedAt: null,
        leftAt: null,
      },
      select: {
        discordUserId: true,
        discordUsername: true,
        displayName: true,
        role: true,
        createdAt: true,
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    const leaders = members.filter(
      (member) => member.role === TeamMemberRole.LEADER,
    );
    const selected = leaders.length ? leaders : members;
    const seen = new Set<string>();
    let created = 0;
    for (const member of selected) {
      const discordUserId = member.discordUserId.trim();
      if (!/^\d{15,25}$/.test(discordUserId) || seen.has(discordUserId)) {
        continue;
      }
      seen.add(discordUserId);
      const duplicate = await delegates.managerBan.findFirst({
        where: {
          organizationId: params.organizationId,
          discordUserId,
          scope: params.scope,
          sessionId: params.sessionId,
          matchId: null,
          ...this.activeTeamBanWhere(),
        },
        select: { id: true },
      });
      if (duplicate) {
        continue;
      }
      await delegates.managerBan.create({
        data: {
          organizationId: params.organizationId,
          discordUserId,
          discordUsername: member.discordUsername ?? null,
          displayName: member.displayName ?? null,
          scope: params.scope,
          sessionId: params.sessionId,
          matchId: null,
          reason: params.reason,
          note: params.note,
          expiresAt: params.expiresAt,
        },
      });
      if (
        params.createdManagerDiscordUserIds &&
        !params.createdManagerDiscordUserIds.includes(discordUserId)
      ) {
        params.createdManagerDiscordUserIds.push(discordUserId);
      }
      created += 1;
    }
    return created;
  }

  private async loadNoShowSnapshotSummaries(
    client: ResultsDbClient,
    params: {
      organizationId: string;
      sessionId: string;
      teamIds: Set<string>;
    },
  ) {
    const delegate = (
      client as unknown as {
        noShowBanSnapshot?: {
          findMany?: (args: unknown) => Promise<
            Array<{
              teamId: string;
              sourceMatchId: string | null;
              matchNumber: number | null;
              matchName: string | null;
            }>
          >;
        };
      }
    ).noShowBanSnapshot;
    if (!params.teamIds.size || typeof delegate?.findMany !== 'function') {
      return new Map<string, NoShowMissSummary>();
    }

    const rows = await delegate.findMany({
      where: {
        organizationId: params.organizationId,
        sessionId: params.sessionId,
        teamId: { in: Array.from(params.teamIds) },
      },
      select: {
        teamId: true,
        sourceMatchId: true,
        matchNumber: true,
        matchName: true,
      },
    });
    const summaries = new Map<string, NoShowMissSummary>();
    for (const row of rows) {
      const teamId = row.teamId?.trim();
      if (!teamId) {
        continue;
      }
      const matchKey =
        row.sourceMatchId?.trim() ||
        (Number.isInteger(row.matchNumber)
          ? `match-number:${row.matchNumber}`
          : null);
      if (!matchKey) {
        continue;
      }
      this.addNoShowMissSummary(
        summaries,
        teamId,
        matchKey,
        this.noShowMatchLabel(row),
        row.matchNumber,
      );
    }
    return summaries;
  }

  private async collectSessionNoShowTeamIds(
    client: ResultsDbClient,
    params: {
      organizationId: string;
      sessionId: string;
    },
  ) {
    const teamIds = new Set<string>();
    const rows = await client.matchSlotResult.findMany({
      where: {
        wasPresentInMatch: false,
        teamId: { not: null },
        match: {
          sessionId: params.sessionId,
          deletedAt: null,
        },
      },
      select: { teamId: true },
    });
    for (const row of rows) {
      if (row.teamId) {
        teamIds.add(row.teamId);
      }
    }

    const snapshotDelegate = (
      client as unknown as {
        noShowBanSnapshot?: {
          findMany?: (args: unknown) => Promise<Array<{ teamId: string }>>;
        };
      }
    ).noShowBanSnapshot;
    if (typeof snapshotDelegate?.findMany === 'function') {
      const snapshots = await snapshotDelegate.findMany({
        where: {
          organizationId: params.organizationId,
          sessionId: params.sessionId,
        },
        select: { teamId: true },
      });
      for (const snapshot of snapshots) {
        const teamId = snapshot.teamId?.trim();
        if (teamId) {
          teamIds.add(teamId);
        }
      }
    }
    return teamIds;
  }

  private async loadNoShowTeamSummaries(
    client: ResultsDbClient,
    params: {
      organizationId: string;
      teamIds: Set<string>;
    },
  ) {
    const delegate = (
      client as unknown as {
        team?: {
          findMany?: (
            args: unknown,
          ) => Promise<
            Array<{ id: string; name: string | null; tag: string | null }>
          >;
        };
      }
    ).team;
    if (!params.teamIds.size || typeof delegate?.findMany !== 'function') {
      return new Map<string, { name: string | null; tag: string | null }>();
    }
    const teams = await delegate.findMany({
      where: {
        id: { in: Array.from(params.teamIds) },
        organizationId: params.organizationId,
      },
      select: { id: true, name: true, tag: true },
    });
    return new Map(
      teams.map((team) => [
        team.id,
        { name: team.name ?? null, tag: team.tag ?? null },
      ]),
    );
  }

  async storeNoShowBanSnapshotForMatch(
    matchId: string,
    source = 'screenshot-apply',
    opts: { tx?: Tx } = {},
  ) {
    const client = opts.tx ?? this.prisma;
    const snapshotDelegate = (
      client as unknown as {
        noShowBanSnapshot?: {
          deleteMany?: (args: unknown) => Promise<unknown>;
          createMany?: (args: unknown) => Promise<{ count: number }>;
        };
      }
    ).noShowBanSnapshot;
    if (
      typeof snapshotDelegate?.deleteMany !== 'function' ||
      typeof snapshotDelegate?.createMany !== 'function'
    ) {
      return 0;
    }

    const match = await client.match.findFirst({
      where: { id: matchId, deletedAt: null, sessionId: { not: null } },
      select: {
        id: true,
        name: true,
        matchNumber: true,
        organizationId: true,
        sessionId: true,
      },
    });
    if (!match?.sessionId) {
      return 0;
    }

    const rows = await client.matchSlotResult.findMany({
      where: {
        matchId: match.id,
        teamId: { not: null },
        wasPresentInMatch: false,
      },
      select: {
        slotNumber: true,
        teamId: true,
        team: { select: { name: true, tag: true } },
      },
      orderBy: { slotNumber: 'asc' },
    });

    await snapshotDelegate.deleteMany({
      where: {
        organizationId: match.organizationId,
        sessionId: match.sessionId,
        OR: [
          { sourceMatchId: match.id },
          ...(Number.isInteger(match.matchNumber)
            ? [{ matchNumber: match.matchNumber }]
            : []),
        ],
      },
    });

    const data = rows.flatMap((row) => {
      const teamId = row.teamId?.trim();
      if (!teamId) {
        return [];
      }
      return [
        {
          organizationId: match.organizationId,
          sessionId: match.sessionId as string,
          sourceMatchId: match.id,
          matchNumber: match.matchNumber,
          matchName: match.name,
          slotNumber: row.slotNumber,
          teamId,
          teamName: row.team?.name?.trim() || teamId,
          teamTag: row.team?.tag ?? null,
          source,
        },
      ];
    });

    if (!data.length) {
      return 0;
    }
    const created = await snapshotDelegate.createMany({
      data,
      skipDuplicates: true,
    });
    return created.count ?? data.length;
  }

  private emptyNoShowAutoBanResult(
    candidateTeamCount = 0,
  ): NoShowAutoBanApplyResult {
    return {
      candidateTeamCount,
      rulesConfigured: 0,
      createdTeamBans: 0,
      createdManagerBans: 0,
      createdTeamIds: [],
      createdManagerDiscordUserIds: [],
      createdBans: [],
      skippedAlreadyBanned: 0,
      skippedProtected: 0,
      skippedNoRule: 0,
    };
  }

  private async applyNoShowAutoBans(
    client: ResultsDbClient,
    matchId: string,
    teamIds: Set<string>,
  ): Promise<NoShowAutoBanApplyResult> {
    const result = this.emptyNoShowAutoBanResult(teamIds.size);
    if (!teamIds.size || !this.noShowAutoBanDelegatesAvailable(client)) {
      return result;
    }

    const match = await client.match.findFirst({
      where: { id: matchId, deletedAt: null, sessionId: { not: null } },
      select: {
        id: true,
        name: true,
        matchNumber: true,
        organizationId: true,
        sessionId: true,
        session: {
          select: {
            id: true,
            name: true,
            discordConfig: {
              select: { guildId: true, manageRoleIds: true, emojis: true },
            },
          },
        },
      },
    });
    if (!match?.sessionId || !match.session) {
      return result;
    }

    const emojis = this.asJsonRecord(
      match.session.discordConfig?.emojis as Prisma.JsonValue | null,
    );
    const rules = this.parseNoShowAutoBanRules(emojis?.noShowBanRules);
    result.rulesConfigured = rules.length;
    if (!rules.length) {
      return result;
    }

    const guildId = match.session.discordConfig?.guildId?.trim() || null;
    const protectedRoleIds = this.autoBanProtectedRoleIds(
      match.session.discordConfig ?? null,
      guildId ? await this.fetchDiscordGuildRoles(guildId) : [],
    );

    const noShowRows = await client.matchSlotResult.findMany({
      where: {
        teamId: { in: Array.from(teamIds) },
        wasPresentInMatch: false,
        match: {
          sessionId: match.sessionId,
          deletedAt: null,
        },
      },
      select: {
        teamId: true,
        matchId: true,
        match: { select: { matchNumber: true, name: true } },
      },
    });
    const noShowSummariesByTeamId = new Map<string, NoShowMissSummary>();
    for (const row of noShowRows) {
      if (!row.teamId || !row.matchId) continue;
      this.addNoShowMissSummary(
        noShowSummariesByTeamId,
        row.teamId,
        row.matchId,
        this.noShowMatchLabel({
          matchNumber: row.match?.matchNumber ?? null,
          name: row.match?.name ?? null,
        }),
        row.match?.matchNumber ?? null,
      );
    }
    const snapshotSummariesByTeamId = await this.loadNoShowSnapshotSummaries(
      client,
      {
        organizationId: match.organizationId,
        sessionId: match.sessionId,
        teamIds,
      },
    );
    for (const [teamId, snapshotSummary] of snapshotSummariesByTeamId) {
      const snapshotKeys = Array.from(snapshotSummary.keys);
      for (const [index, key] of snapshotKeys.entries()) {
        this.addNoShowMissSummary(
          noShowSummariesByTeamId,
          teamId,
          key,
          snapshotSummary.labels[index] ?? null,
          snapshotSummary.matchNumberByKey.get(key) ?? null,
        );
      }
    }
    const teamSummaries = await this.loadNoShowTeamSummaries(client, {
      organizationId: match.organizationId,
      teamIds,
    });

    for (const teamId of teamIds) {
      const missSummary = noShowSummariesByTeamId.get(teamId);
      const missedMatches = missSummary?.labels.length
        ? missSummary.labels
        : [
            this.noShowMatchLabel({
              matchNumber: match.matchNumber,
              name: match.name,
            }),
          ];
      const missedMatchesLabel = missedMatches.join(', ');
      const missCount = Math.max(missSummary?.keys.size ?? 0, 1);
      const missedMatchNumbers = missSummary?.matchNumbers ?? new Set<number>();
      if (
        Number.isInteger(match.matchNumber) &&
        (match.matchNumber ?? 0) > 0 &&
        !missSummary
      ) {
        missedMatchNumbers.add(match.matchNumber ?? 0);
      }
      const rule = this.selectNoShowAutoBanRule({
        rules,
        missCount,
        missedMatchNumbers,
      });
      if (!rule) {
        result.skippedNoRule += 1;
        continue;
      }

      if (
        await this.teamHasAutoBanProtectedManager(client, {
          organizationId: match.organizationId,
          teamId,
          guildId,
          protectedRoleIds,
        })
      ) {
        result.skippedProtected += 1;
        this.logger.log(
          `[NoShowAutoBan] skipped team=${teamId} match=${matchId} because a team manager has staff/admin access`,
        );
        continue;
      }

      const sessionId =
        rule.scope === TeamBanScope.SESSION ? match.sessionId : null;
      const duplicate = await client.teamBan.findFirst({
        where: {
          organizationId: match.organizationId,
          teamId,
          scope: rule.scope,
          sessionId,
          matchId: null,
          ...this.activeTeamBanWhere(),
        },
        select: { id: true },
      });
      if (duplicate) {
        result.skippedAlreadyBanned += 1;
        continue;
      }

      const matchName =
        match.name ??
        (match.matchNumber ? `Match ${match.matchNumber}` : 'Match');
      const reason = this.formatNoShowAutoBanReason(rule.reason, {
        misses: missCount,
        sessionName: match.session.name,
        matchName: missedMatchesLabel || matchName,
        missedMatches: missedMatchesLabel || matchName,
      });
      const expiresAt =
        rule.durationDays === null
          ? null
          : new Date(Date.now() + rule.durationDays * 24 * 60 * 60 * 1000);
      await client.teamBan.create({
        data: {
          organizationId: match.organizationId,
          teamId,
          scope: rule.scope,
          sessionId,
          matchId: null,
          reason,
          note: `Auto no-show ban from ${missedMatchesLabel || matchName}`,
          expiresAt,
        },
        select: { id: true },
      });
      result.createdTeamBans += 1;
      result.createdTeamIds.push(teamId);
      const createdManagerDiscordUserIds: string[] = [];
      result.createdManagerBans += await this.createNoShowManagerBansForTeam(
        client,
        {
          organizationId: match.organizationId,
          teamId,
          scope: rule.scope,
          sessionId,
          reason,
          note: `Auto no-show manager ban from ${missedMatchesLabel || matchName}`,
          expiresAt,
          createdManagerDiscordUserIds,
        },
      );
      for (const discordUserId of createdManagerDiscordUserIds) {
        if (!result.createdManagerDiscordUserIds.includes(discordUserId)) {
          result.createdManagerDiscordUserIds.push(discordUserId);
        }
      }
      const team = teamSummaries.get(teamId) ?? null;
      result.createdBans.push({
        teamId,
        teamName: team?.name ?? null,
        teamTag: team?.tag ?? null,
        scope: rule.scope,
        reason,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        durationDays: rule.durationDays,
        missedMatches,
        managerDiscordUserIds: createdManagerDiscordUserIds,
      });

      if (rule.scope === TeamBanScope.TEAM) {
        await this.removeNoShowBannedTeamFromOrganization(
          client,
          match.organizationId,
          teamId,
          reason,
        );
      } else {
        await this.removeNoShowBannedTeamFromSession(
          client,
          match.sessionId,
          teamId,
          reason,
        );
      }
    }
    return result;
  }

  async applyReviewedNoShowAutoBans(
    matchId: string,
    teamIds: Iterable<string>,
    opts: { tx?: Tx } = {},
  ): Promise<NoShowAutoBanApplyResult> {
    const uniqueTeamIds = new Set(
      Array.from(teamIds)
        .map((teamId) => teamId.trim())
        .filter(Boolean),
    );
    return this.applyNoShowAutoBans(
      opts.tx ?? this.prisma,
      matchId,
      uniqueTeamIds,
    );
  }

  async applyCurrentNoShowAutoBans(actor: AuthUser, matchId: string) {
    const match = await this.ensureMatch(actor, matchId);
    const organizationId =
      match.organizationId ?? match.tournament?.organizationId ?? null;
    const teamIds =
      match.sessionId && organizationId
        ? await this.collectSessionNoShowTeamIds(this.prisma, {
            organizationId,
            sessionId: match.sessionId,
          })
        : new Set<string>();
    const result = await this.applyNoShowAutoBans(
      this.prisma,
      match.id,
      teamIds,
    );
    return { ok: true, matchId: match.id, ...result };
  }

  private async removeNoShowBannedTeamFromOrganization(
    client: ResultsDbClient,
    organizationId: string,
    teamId: string,
    reason: string,
  ) {
    const discordSessions = await client.session.findMany({
      where: {
        organizationId,
        deletedAt: null,
        discordConfig: { isNot: null },
      },
      select: { id: true },
    });
    const sessionIds = discordSessions.map((session) => session.id);
    if (sessionIds.length === 0) {
      return;
    }

    const registrations = await client.sessionRegistration.findMany({
      where: {
        organizationId,
        teamId,
        deletedAt: null,
        sessionId: { in: sessionIds },
      },
      select: { sessionId: true },
      distinct: ['sessionId'],
    });
    const registeredSessionIds = registrations.map(
      (registration) => registration.sessionId,
    );
    const removedAt = new Date();
    if (registeredSessionIds.length > 0) {
      await client.sessionRegistration.updateMany({
        where: {
          organizationId,
          teamId,
          deletedAt: null,
          sessionId: { in: registeredSessionIds },
        },
        data: {
          status: SessionRegistrationStatus.REMOVED,
          slotNumber: null,
          waitlistPosition: null,
          removedAt,
          removalReason: `Discord auto no-show ban: ${reason}`,
          deletedAt: removedAt,
        },
      });
    }
    for (const registration of registrations) {
      await this.repackNoShowSessionWaitlist(client, registration.sessionId);
    }
    const discordMatches = await client.match.findMany({
      where: {
        organizationId,
        deletedAt: null,
        sessionId: { in: sessionIds },
        status: {
          in: [MatchStatus.DRAFT, MatchStatus.LIVE, MatchStatus.FINISH_PENDING],
        },
      },
      select: { id: true },
    });
    const matchIds = discordMatches.map((match) => match.id);
    if (matchIds.length === 0) {
      return;
    }
    await client.matchTeam.updateMany({
      where: {
        matchId: { in: matchIds },
        teamId,
        deletedAt: null,
      },
      data: { deletedAt: removedAt },
    });
    await client.matchSlot.updateMany({
      where: {
        matchId: { in: matchIds },
        teamId,
        deletedAt: null,
      },
      data: {
        teamId: null,
        lobbyStatus: LobbyStatus.EMPTY,
        playersInLobby: 0,
      },
    });
  }

  private async removeNoShowBannedTeamFromSession(
    client: ResultsDbClient,
    sessionId: string,
    teamId: string,
    reason: string,
  ) {
    const removedAt = new Date();
    await client.sessionRegistration.updateMany({
      where: {
        sessionId,
        teamId,
        deletedAt: null,
      },
      data: {
        status: SessionRegistrationStatus.REMOVED,
        slotNumber: null,
        waitlistPosition: null,
        removedAt,
        removalReason: `Auto no-show ban: ${reason}`,
        deletedAt: removedAt,
      },
    });
    await this.repackNoShowSessionWaitlist(client, sessionId);
  }

  private async repackNoShowSessionWaitlist(
    client: ResultsDbClient,
    sessionId: string,
  ) {
    const waitlist = await client.sessionRegistration.findMany({
      where: {
        sessionId,
        deletedAt: null,
        status: SessionRegistrationStatus.WAITLIST,
      },
      select: { id: true, waitlistPosition: true },
      orderBy: [{ waitlistPosition: 'asc' }, { createdAt: 'asc' }],
    });
    for (const [index, registration] of waitlist.entries()) {
      const position = index + 1;
      if (registration.waitlistPosition !== position) {
        await client.sessionRegistration.update({
          where: { id: registration.id },
          data: { waitlistPosition: position },
        });
      }
    }
  }

  private resolveExpectedResultsVersion(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.trunc(value));
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
    }
    return null;
  }

  private assertResultsVersion(
    match: Pick<MatchSummary, 'controlState'>,
    expectedVersion: number | null | undefined,
  ) {
    if (expectedVersion === null || expectedVersion === undefined) {
      return;
    }
    const currentVersion = readLiveSyncContract(
      match.controlState?.metaJson ?? null,
    ).version;
    if (currentVersion !== expectedVersion) {
      throw new ConflictException({
        code: 'RESULT_VERSION_MISMATCH',
        message: 'Saved results changed. Reload saved results before saving.',
        expectedVersion,
        currentVersion,
      });
    }
  }

  private buildManualFieldOwnership(
    actor: AuthUser,
    updatedAt: number,
    source = 'MANUAL_RESULTS',
  ): LiveSyncFieldOwnership {
    return {
      owner: 'MANUAL',
      override: true,
      updatedAt,
      actorId: actor.actorId ?? actor.id ?? null,
      source,
    };
  }

  private buildLiveSyncAuditEntry(params: {
    actor: AuthUser;
    action: LiveSyncAuditAction;
    timestamp: number;
    source: string;
    scope: LiveSyncAuditScope;
  }): LiveSyncAuditEntry {
    return {
      action: params.action,
      timestamp: params.timestamp,
      actorId: params.actor.actorId ?? params.actor.id ?? null,
      source: params.source,
      scope: params.scope,
    };
  }

  private playerOwnershipFields(
    ownership?: LiveSyncPlayerOwnership | null,
  ): Array<'alive' | 'knocked' | 'kills'> {
    const fields: Array<'alive' | 'knocked' | 'kills'> = [];
    if (ownership?.alive) fields.push('alive');
    if (ownership?.knocked) fields.push('knocked');
    if (ownership?.kills) fields.push('kills');
    return fields;
  }

  private teamOwnershipFields(
    ownership?: LiveSyncTeamOwnership | null,
  ): Array<'eliminated' | 'placement' | 'totalKills'> {
    const fields: Array<'eliminated' | 'placement' | 'totalKills'> = [];
    if (ownership?.eliminated) fields.push('eliminated');
    if (ownership?.placement) fields.push('placement');
    if (ownership?.totalKills) fields.push('totalKills');
    return fields;
  }

  private async mutateLiveSyncContract(
    tx: Tx,
    params: {
      matchId: string;
      organizationId: string;
      fallbackState: string | null | undefined;
      mutate: (
        contract: LiveSyncContract,
        timestamp: number,
      ) => LiveSyncContract;
    },
  ): Promise<LiveSyncContract> {
    if (!tx.matchControlState?.findUnique || !tx.matchControlState?.upsert) {
      return {
        version: 1,
        updatedAt: Date.now(),
        overrides: {
          players: {},
          teams: {},
        },
        auditTrail: [],
      };
    }

    const currentControl = await tx.matchControlState.findUnique({
      where: { matchId: params.matchId },
      select: {
        organizationId: true,
        state: true,
        metaJson: true,
      },
    });

    const currentMeta = this.asJsonRecord(currentControl?.metaJson) ?? {};
    const timestamp = Date.now();
    const currentContract = readLiveSyncContract(currentMeta);
    const nextBase: LiveSyncContract = {
      ...currentContract,
      version: currentContract.version + 1,
      updatedAt: timestamp,
      overrides: {
        players: { ...currentContract.overrides.players },
        teams: { ...currentContract.overrides.teams },
      },
      auditTrail: [...currentContract.auditTrail],
    };
    const nextContract = params.mutate(nextBase, timestamp);

    const nextMeta = {
      ...currentMeta,
      ...writeLiveSyncContract(currentMeta, nextContract),
    };

    await tx.matchControlState.upsert({
      where: { matchId: params.matchId },
      update: {
        metaJson: nextMeta as Prisma.InputJsonObject,
      },
      create: {
        matchId: params.matchId,
        organizationId: currentControl?.organizationId ?? params.organizationId,
        state: normalizeControlState(
          currentControl?.state ?? params.fallbackState ?? 'READY',
        ),
        metaJson: nextMeta as Prisma.InputJsonObject,
      },
    });

    return nextContract;
  }

  private async persistManualSyncOverrides(
    tx: Tx,
    params: {
      actor: AuthUser;
      matchId: string;
      organizationId: string;
      fallbackState: string | null | undefined;
      players?: Array<{
        playerId: string;
        fields: Array<'alive' | 'knocked' | 'kills'>;
      }>;
      teams?: Array<{
        teamId: string;
        fields: Array<'eliminated' | 'placement' | 'totalKills'>;
      }>;
      source?: string;
    },
  ): Promise<LiveSyncContract> {
    return this.mutateLiveSyncContract(tx, {
      matchId: params.matchId,
      organizationId: params.organizationId,
      fallbackState: params.fallbackState,
      mutate: (contract, timestamp) => {
        const source = params.source ?? 'MANUAL_RESULTS';
        const ownership = this.buildManualFieldOwnership(
          params.actor,
          timestamp,
          source,
        );
        let nextContract = contract;

        for (const player of params.players ?? []) {
          for (const field of player.fields) {
            nextContract = setLiveSyncPlayerOverride(
              nextContract,
              player.playerId,
              field,
              ownership,
            );
          }
          nextContract = appendLiveSyncAuditEntry(
            nextContract,
            this.buildLiveSyncAuditEntry({
              actor: params.actor,
              action: 'OVERRIDE',
              timestamp,
              source,
              scope: {
                level: 'PLAYER',
                playerId: player.playerId,
                fields: [...player.fields],
              },
            }),
          );
        }

        for (const team of params.teams ?? []) {
          for (const field of team.fields) {
            nextContract = setLiveSyncTeamOverride(
              nextContract,
              team.teamId,
              field,
              ownership,
            );
          }
          nextContract = appendLiveSyncAuditEntry(
            nextContract,
            this.buildLiveSyncAuditEntry({
              actor: params.actor,
              action: 'OVERRIDE',
              timestamp,
              source,
              scope: {
                level: 'TEAM',
                teamId: team.teamId,
                fields: [...team.fields],
              },
            }),
          );
        }

        return nextContract;
      },
    });
  }

  private async persistReleasedSyncOverrides(
    tx: Tx,
    params: {
      actor: AuthUser;
      matchId: string;
      organizationId: string;
      fallbackState: string | null | undefined;
      releaseAll?: boolean;
      players?: Array<{
        playerId: string;
        fields?: Array<'alive' | 'knocked' | 'kills'>;
      }>;
      teams?: Array<{
        teamId: string;
        fields?: Array<'eliminated' | 'placement' | 'totalKills'>;
      }>;
      source?: string;
    },
  ): Promise<LiveSyncContract> {
    return this.mutateLiveSyncContract(tx, {
      matchId: params.matchId,
      organizationId: params.organizationId,
      fallbackState: params.fallbackState,
      mutate: (contract, timestamp) => {
        const source = params.source ?? 'MANUAL_OVERRIDE_RELEASE';
        let nextContract = params.releaseAll
          ? clearAllLiveSyncOverrides(contract)
          : contract;

        if (params.releaseAll) {
          nextContract = appendLiveSyncAuditEntry(
            nextContract,
            this.buildLiveSyncAuditEntry({
              actor: params.actor,
              action: 'RELEASE',
              timestamp,
              source,
              scope: {
                level: 'MATCH',
                fields: [
                  'alive',
                  'knocked',
                  'kills',
                  'eliminated',
                  'placement',
                  'totalKills',
                ],
              },
            }),
          );
        }

        for (const player of params.players ?? []) {
          nextContract = clearLiveSyncPlayerOverrides(
            nextContract,
            player.playerId,
            player.fields,
          );
          nextContract = appendLiveSyncAuditEntry(
            nextContract,
            this.buildLiveSyncAuditEntry({
              actor: params.actor,
              action: 'RELEASE',
              timestamp,
              source,
              scope: {
                level: 'PLAYER',
                playerId: player.playerId,
                fields:
                  player.fields && player.fields.length > 0
                    ? [...player.fields]
                    : ['alive', 'knocked', 'kills'],
              },
            }),
          );
        }

        for (const team of params.teams ?? []) {
          nextContract = clearLiveSyncTeamOverrides(
            nextContract,
            team.teamId,
            team.fields,
          );
          nextContract = appendLiveSyncAuditEntry(
            nextContract,
            this.buildLiveSyncAuditEntry({
              actor: params.actor,
              action: 'RELEASE',
              timestamp,
              source,
              scope: {
                level: 'TEAM',
                teamId: team.teamId,
                fields:
                  team.fields && team.fields.length > 0
                    ? [...team.fields]
                    : ['eliminated', 'placement', 'totalKills'],
              },
            }),
          );
        }

        return nextContract;
      },
    });
  }

  private async publishManualMirrorFromResults(
    matchId: string,
    version: number,
  ) {
    if (!this.liveStateMirror || !this.matchControlStateStore) {
      return;
    }

    const [current, match, slotResults] = await Promise.all([
      this.matchControlStateStore.get(matchId),
      this.prisma.match.findUnique({
        where: { id: matchId },
        select: {
          status: true,
          startedAt: true,
          endedAt: true,
          dataSource: true,
          dataMode: true,
          controlState: {
            select: {
              state: true,
              authorityMode: true,
              metaJson: true,
            },
          },
        },
      }),
      this.prisma.matchSlotResult.findMany({
        where: { matchId, teamId: { not: null } },
        orderBy: { slotNumber: 'asc' },
        include: {
          team: {
            select: {
              id: true,
              name: true,
              tag: true,
              logoUrl: true,
            },
          },
          players: {
            include: {
              player: {
                select: {
                  externalPlayerId: true,
                  photoUrl: true,
                  inGameId: true,
                  ign: true,
                },
              },
            },
            orderBy: { playerName: 'asc' },
          },
        },
      }),
    ]);

    if (!match) {
      return;
    }

    if (!this.hasManualMirrorAuthority(match)) {
      this.logger.error(
        JSON.stringify({
          tag: '[CRITICAL DUPLICATE SOURCE]',
          stage: 'results-service',
          action: 'non-canonical-player-write-blocked',
          matchId,
          authorityMode:
            (match.controlState?.authorityMode ?? '')
              .toString()
              .toUpperCase() || null,
          sourceMode:
            (match.dataSource ?? match.dataMode ?? '')
              .toString()
              .toUpperCase() || null,
        }),
      );
      if (!this.telemetryEngine) {
        throw new ConflictException(
          '[CRITICAL DUPLICATE SOURCE] Results service cannot publish telemetry-owned live player state without the telemetry engine',
        );
      }
      await this.telemetryEngine.republishMirror(matchId);
      return;
    }

    const updatedAt = new Date().toISOString();
    const syncContract = readLiveSyncContract(
      match.controlState?.metaJson ?? null,
    );
    const canonical = this.buildCanonicalSlotResolution(
      slotResults as Array<{
        id: string;
        slotNumber: number;
        teamId: string | null;
        totalKills?: number | null;
        manualTotalKills?: boolean | null;
        eliminatedOrder?: number | null;
        eliminatedAt?: Date | null;
        players: Array<{
          id: string;
          kills?: number | null;
          isAlive?: boolean | null;
          alive?: boolean | null;
          isKnocked?: boolean | null;
          knocked?: boolean | null;
        }>;
      }>,
      new Map(),
      new Date(updatedAt),
    );
    const canonicalByTeamId = new Map(
      canonical.teams.map((team) => [team.teamId, team] as const),
    );
    const canonicalPlayersById = new Map(
      canonical.teams.flatMap((team) =>
        team.players.map((player) => [player.id, player] as const),
      ),
    );
    const runtimeSourceMode =
      toCanonicalMatchStateSourceMode(current?.sourceMode) ??
      toCanonicalMatchStateSourceMode(match.controlState?.authorityMode) ??
      ((match.dataSource ?? match.dataMode ?? '').toString().toUpperCase() ===
      'MANUAL'
        ? 'MANUAL'
        : 'API');

    const teams = slotResults
      .filter((slot) => isPresentInMatch(slot.wasPresentInMatch))
      .map((slot) => {
        const teamState = canonicalByTeamId.get(slot.teamId as string);
        const alivePlayers = teamState?.aliveCount ?? 0;
        const totalPlayers = teamState?.totalPlayers ?? slot.players.length;
        return {
          teamId: slot.teamId as string,
          name: slot.team?.name ?? null,
          tag: slot.team?.tag ?? null,
          slot: slot.slotNumber,
          kills: teamState?.teamKills ?? Math.max(0, slot.totalKills ?? 0),
          placement: teamState?.placement ?? null,
          points: slot.totalPoints ?? slot.points ?? null,
          logoUrl: slot.team?.logoUrl ?? null,
          alivePlayers,
          totalPlayers,
          alive: alivePlayers > 0,
          eliminated: teamState?.eliminated ?? false,
          updatedAt,
          sourceMode: runtimeSourceMode,
          ownership: syncContract.overrides.teams[slot.teamId as string],
          players: slot.players.map((player) => {
            const canonicalPlayer = canonicalPlayersById.get(player.id);
            const playerKey =
              buildMatchPlayerKey({
                playerId: player.playerId ?? null,
                playerResultId: player.id,
              }) ?? player.id;
            return {
              id: playerKey,
              playerId: playerKey,
              externalPlayerId: player.player?.externalPlayerId ?? null,
              pubgPlayerId: player.player?.inGameId ?? null,
              name: player.playerName ?? player.player?.ign ?? playerKey,
              ign: player.playerName ?? player.player?.ign ?? playerKey,
              avatarUrl: player.player?.photoUrl ?? null,
              teamId: slot.teamId as string,
              slot: slot.slotNumber,
              alive: canonicalPlayer?.alive ?? false,
              knocked: canonicalPlayer?.knocked ?? false,
              eliminated: canonicalPlayer ? !canonicalPlayer.alive : false,
              kills: canonicalPlayer?.kills ?? Math.max(0, player.kills ?? 0),
              assists: Math.max(0, player.assists ?? 0),
              updatedAt,
              ownership: syncContract.overrides.players[playerKey],
            };
          }),
        };
      });

    const totalPlayers = teams.reduce(
      (sum, team) => sum + (team.totalPlayers ?? team.players?.length ?? 0),
      0,
    );
    const alivePlayers = teams.reduce(
      (sum, team) => sum + (team.alivePlayers ?? 0),
      0,
    );
    const winner =
      teams.find((team) => team.placement === 1) ??
      teams.find((team) => (team.alivePlayers ?? 0) > 0) ??
      null;

    const nextState: LiveMatchState = {
      matchId,
      status:
        current?.status ??
        deriveCanonicalMatchLifecycleStatus({
          status: match.status ?? null,
          controlState: match.controlState?.state ?? null,
          metaJson: match.controlState?.metaJson ?? null,
        }),
      startedAt: current?.startedAt ?? match.startedAt?.toISOString() ?? null,
      endedAt: current?.endedAt ?? match.endedAt?.toISOString() ?? null,
      version,
      updatedAt,
      sourceMode: runtimeSourceMode,
      summary: {
        totalTeams: teams.length,
        aliveTeams: teams.filter((team) => (team.alivePlayers ?? 0) > 0).length,
        totalPlayers,
        alivePlayers,
        winnerTeamId: winner?.teamId ?? null,
        winnerSlot: winner?.slot ?? null,
      },
      circle: current?.circle ?? null,
      observedPlayer: current?.observedPlayer ?? null,
      killFeed: current?.killFeed ?? [],
      events: current?.events ?? [],
      teams,
    };

    await this.liveStateMirror.publish(nextState, {
      writer: 'results-service',
    });
  }

  private getOverrideReleaseCapability(match: MatchSummary): {
    allowed: boolean;
    reason: string | null;
  } {
    if (this.isManualSource(match)) {
      if (match.controlState?.resultsManualLock) {
        return {
          allowed: false,
          reason:
            'Overrides cannot be released while match control lock is active.',
        };
      }
      return { allowed: true, reason: null };
    }

    const lifecycleStatus = deriveCanonicalMatchLifecycleStatus({
      status: match.status ?? null,
      liveState: match.liveState ?? match.controlState?.state ?? null,
      controlState: match.controlState?.state ?? null,
      metaJson: match.controlState?.metaJson ?? null,
    });
    const meta =
      match.controlState?.metaJson &&
      typeof match.controlState.metaJson === 'object'
        ? (match.controlState.metaJson as { resultFinalized?: boolean })
        : null;

    if (meta?.resultFinalized || lifecycleStatus === 'FINISHED') {
      return {
        allowed: false,
        reason: 'Overrides cannot be released after results are finalized.',
      };
    }
    if (match.controlState?.resultsManualLock) {
      return {
        allowed: false,
        reason:
          'Overrides cannot be released while match control lock is active.',
      };
    }
    return { allowed: true, reason: null };
  }

  private ensureOverrideReleaseAllowed(match: MatchSummary) {
    const capability = this.getOverrideReleaseCapability(match);
    if (!capability.allowed) {
      throw new ConflictException(
        capability.reason ?? 'Override release is not allowed.',
      );
    }
  }

  private async republishReleasedOverrideMirror(
    match: MatchSummary,
    matchId: string,
    version: number,
  ) {
    if (!this.hasManualMirrorAuthority(match) && this.telemetryEngine) {
      try {
        await this.telemetryEngine.republishMirror(matchId);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[MANUAL_OVERRIDE_RELEASE] Failed to republish telemetry mirror match=${matchId}: ${message}`,
        );
      }
    }

    await this.publishManualMirrorFromResults(matchId, version);
  }

  private slotRuleSortKey(slotNumber: number, slotId: string): string {
    return `${String(slotNumber).padStart(4, '0')}:${slotId}`;
  }

  private hasExplicitTelemetryPresence(state: TelemetryMatchState): boolean {
    return (
      Object.values(state.teams ?? {}).some(
        (team) => team.metadata?.wasPresentInMatch === true,
      ) ||
      Object.values(state.players ?? {}).some(
        (player) => player.metadata?.observedInTelemetry === true,
      )
    );
  }

  private collectActiveTelemetryTeamIds(
    state: TelemetryMatchState,
  ): Set<string> {
    const activeTeamIds = new Set<string>();

    for (const [teamId, team] of Object.entries(state.teams ?? {})) {
      if (team.metadata?.wasPresentInMatch === true) {
        activeTeamIds.add(teamId);
      }
    }

    for (const player of Object.values(state.players ?? {})) {
      if (player.metadata?.observedInTelemetry === true) {
        activeTeamIds.add(player.teamId);
      }
    }

    return activeTeamIds;
  }

  private collectTelemetryPlayersByTeam(
    state: TelemetryMatchState,
    opts: { observedOnly: boolean },
  ): Map<string, Array<TelemetryMatchState['players'][string]>> {
    const playersByTeamId = new Map<
      string,
      Array<TelemetryMatchState['players'][string]>
    >();

    for (const player of Object.values(state.players ?? {})) {
      if (opts.observedOnly && player.metadata?.observedInTelemetry !== true) {
        continue;
      }

      const bucket = playersByTeamId.get(player.teamId) ?? [];
      bucket.push(player);
      playersByTeamId.set(player.teamId, bucket);
    }

    return playersByTeamId;
  }

  private buildCanonicalSlotResolution(
    slots: Array<{
      id: string;
      slotNumber: number;
      teamId: string | null;
      wasPresentInMatch?: boolean | null;
      placement?: number | null;
      totalKills?: number | null;
      manualTotalKills?: boolean | null;
      eliminatedOrder?: number | null;
      eliminatedAt?: Date | null;
      players: Array<{
        id: string;
        kills?: number | null;
        isAlive?: boolean | null;
        alive?: boolean | null;
        isKnocked?: boolean | null;
        knocked?: boolean | null;
      }>;
    }>,
    overridesBySlotId: Map<string, NormalizedPlayerState[]> = new Map(),
    eliminationMarker = new Date(),
  ) {
    const assignedSlots = slots.filter(
      (slot): slot is (typeof slots)[number] & { teamId: string } =>
        Boolean(slot.teamId),
    );
    const activeSlots = assignedSlots.filter((slot) =>
      isPresentInMatch(slot.wasPresentInMatch),
    );

    return derivePubgMatchState<Date>({
      eliminationMarker,
      teams: activeSlots.map((slot) => {
        const players =
          overridesBySlotId.get(slot.id) ??
          (slot.players ?? []).map((player) => ({
            id: player.id,
            playerId: null,
            kills:
              typeof player.kills === 'number' && Number.isFinite(player.kills)
                ? Math.max(0, Math.trunc(player.kills))
                : 0,
            isAlive:
              ((player as { isAlive?: boolean | null }).isAlive ??
                (player as { alive?: boolean | null }).alive ??
                true) === true,
            isKnocked:
              ((player as { isKnocked?: boolean | null }).isKnocked ??
                (player as { knocked?: boolean | null }).knocked ??
                false) === true,
          }));
        const existingPlacement =
          typeof slot.placement === 'number' && Number.isFinite(slot.placement)
            ? Math.trunc(slot.placement)
            : null;
        const eliminatedOrderFromPlacement =
          existingPlacement !== null && existingPlacement > 1
            ? Math.max(activeSlots.length - existingPlacement + 1, 1)
            : null;
        const seededEliminatedOrder =
          existingPlacement !== null
            ? eliminatedOrderFromPlacement
            : ((slot as { eliminatedOrder?: number | null }).eliminatedOrder ??
              null);

        return {
          teamId: slot.teamId,
          sortKey: this.slotRuleSortKey(slot.slotNumber, slot.id),
          players: players.map((player) => ({
            id: player.id,
            teamId: slot.teamId,
            kills: player.kills,
            alive: player.isAlive,
            knocked: player.isKnocked,
          })),
          totalPlayers: Math.max(slot.players?.length ?? 0, players.length),
          eliminatedOrder: seededEliminatedOrder,
          eliminatedAt:
            (slot as { eliminatedAt?: Date | null }).eliminatedAt ?? null,
          manualTotalKills:
            (slot as { manualTotalKills?: boolean | null }).manualTotalKills ??
            false,
          totalKillsOverride: slot.totalKills ?? null,
        };
      }),
    });
  }

  private toIntValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }
    return null;
  }

  private normalizePlayerKey(value?: string | null): string {
    return (value ?? '').trim().toLowerCase();
  }

  private buildScopedPlayerLookupKey(
    slotResultId: string,
    value?: string | null,
  ): string | null {
    const normalized = this.normalizePlayerKey(value);
    return normalized.length > 0 ? `${slotResultId}:${normalized}` : null;
  }

  private stableTelemetryPlayerId(
    player: TelemetryMatchState['players'][string],
  ): string | null {
    const playerId = this.toStringValue(player.playerId);
    if (!playerId) {
      return null;
    }
    if (player.metadata?.provisional === true) {
      return null;
    }
    if (playerId.startsWith('provisional:')) {
      return null;
    }
    if (isAnonymousSlotPlayerKey(playerId)) {
      return null;
    }
    return playerId;
  }

  private telemetryPlayerExternalId(
    player: TelemetryMatchState['players'][string],
  ): string | null {
    return this.toStringValue(
      player.metadata?.externalPlayerId ?? player.metadata?.inGameId ?? null,
    );
  }

  private telemetryPlayerPubgAccountId(
    player: TelemetryMatchState['players'][string],
  ): string | null {
    return this.toStringValue(player.metadata?.playerOpenId ?? null);
  }

  private telemetryPlayerId(entry: Record<string, unknown>): string | null {
    return (
      this.toStringValue(entry.pubgPlayerId) ??
      this.toStringValue(entry.inGameId) ??
      this.toStringValue(entry.uId) ??
      this.toStringValue(entry.UId) ??
      this.toStringValue(entry.uid) ??
      this.toStringValue(entry.Uid) ??
      this.toStringValue(entry.UID) ??
      this.toStringValue(entry.externalPlayerId) ??
      this.toStringValue(entry.externalId) ??
      this.toStringValue(entry.playerId) ??
      this.toStringValue(entry.accountId) ??
      this.toStringValue(entry.userId) ??
      this.toStringValue(entry.subject) ??
      this.toStringValue(entry.characterId) ??
      this.toStringValue(entry.steamId) ??
      this.toStringValue(entry.id) ??
      this.toStringValue(entry.uuid) ??
      null
    );
  }

  private telemetryPlayerOpenId(entry: Record<string, unknown>): string | null {
    return (
      this.toStringValue(entry.playerOpenId) ??
      this.toStringValue(entry.playerOpenID) ??
      this.toStringValue(entry.PlayerOpenId) ??
      this.toStringValue(entry.PlayerOpenID) ??
      this.toStringValue(entry.openId) ??
      this.toStringValue(entry.OpenId) ??
      this.toStringValue(entry.openid) ??
      null
    );
  }

  private telemetryPlayerName(entry: Record<string, unknown>): string | null {
    return (
      this.toStringValue(entry.playerName) ??
      this.toStringValue(entry.ign) ??
      this.toStringValue(entry.name) ??
      this.toStringValue(entry.nickname) ??
      this.toStringValue(entry.player) ??
      this.toStringValue(entry.observer) ??
      this.telemetryPlayerId(entry)
    );
  }

  private telemetryTeamId(entry: Record<string, unknown>): string | null {
    const team = this.asJsonRecord(entry.team as Prisma.JsonValue | null);
    return (
      this.toStringValue(entry.teamId) ??
      this.toStringValue(entry.teamID) ??
      this.toStringValue(entry.TeamId) ??
      this.toStringValue(entry.TeamID) ??
      this.toStringValue(entry.team_id) ??
      this.toStringValue(team?.id) ??
      null
    );
  }

  private telemetryPlayerAvatar(entry: Record<string, unknown>): string | null {
    return (
      this.toStringValue(entry.photoUrl) ??
      this.toStringValue(entry.avatarUrl) ??
      this.toStringValue(entry.avatar) ??
      this.toStringValue(entry.imageUrl) ??
      this.toStringValue(entry.image) ??
      this.toStringValue(entry.photo) ??
      null
    );
  }

  private telemetrySlotNumber(entry: Record<string, unknown>): number | null {
    const team = this.asJsonRecord(entry.team as Prisma.JsonValue | null);
    const parsed = this.toIntValue(
      entry.slot ??
        entry.slotNumber ??
        entry.Slot ??
        entry.SlotNumber ??
        entry.teamSlot ??
        team?.slot ??
        team?.slotNumber ??
        null,
    );
    return parsed && parsed > 0 ? parsed : null;
  }

  private extractTelemetryArray(
    value: unknown,
  ): Array<Record<string, unknown>> {
    const direct = this.asJsonRecordArray(value);
    if (direct.length > 0) {
      return direct;
    }
    for (const source of this.collectTelemetryPayloadRecords(value)) {
      for (const key of [
        'TotalPlayerList',
        'totalPlayerList',
        'PlayerList',
        'playerList',
        'PlayerInfoList',
        'playerInfoList',
        'players',
      ]) {
        const entries = this.asJsonRecordArray(source[key]);
        if (entries.length > 0) {
          return entries;
        }
      }
    }
    return [];
  }

  private addTelemetryPlayer(
    playersBySlot: Map<number, MaterializedSlotPlayer[]>,
    seenBySlot: Map<number, Set<string>>,
    slotNumber: number | null,
    player: MaterializedSlotPlayer | null,
  ) {
    if (!slotNumber || !player?.name) return;
    if (!playersBySlot.has(slotNumber)) {
      playersBySlot.set(slotNumber, []);
    }
    const key = player.pubgAccountId
      ? `pubg:${player.pubgAccountId}`
      : player.externalPlayerId
        ? `id:${player.externalPlayerId}`
        : `name:${this.normalizePlayerKey(player.name)}`;
    const seen = seenBySlot.get(slotNumber) ?? new Set<string>();
    if (seen.has(key)) return;
    seen.add(key);
    seenBySlot.set(slotNumber, seen);
    playersBySlot.get(slotNumber)?.push(player);
  }

  private extractTelemetryPlayersBySlot(
    payload: Prisma.JsonValue | null,
    slots: Array<{ slotNumber: number; teamId: string | null }>,
  ): Map<number, MaterializedSlotPlayer[]> {
    const playersBySlot = new Map<number, MaterializedSlotPlayer[]>();
    const seenBySlot = new Map<number, Set<string>>();
    const payloadRecords = this.collectTelemetryPayloadRecords(payload);
    if (payloadRecords.length === 0) return playersBySlot;

    const slotByTeamId = new Map<string, number>();
    slots.forEach((slot) => {
      if (slot.teamId) {
        slotByTeamId.set(slot.teamId, slot.slotNumber);
      }
    });

    const teamEntries = payloadRecords.flatMap(
      (source) =>
        ['teams', 'teamInfoList', 'TeamInfoList']
          .map((key) => this.asJsonRecordArray(source[key]))
          .find((entries) => entries.length > 0) ?? [],
    );

    for (const entry of teamEntries) {
      const teamId =
        this.telemetryTeamId(entry) ?? this.toStringValue(entry.id) ?? null;
      const slotNumber =
        this.telemetrySlotNumber(entry) ??
        (teamId ? (slotByTeamId.get(teamId) ?? null) : null);
      if (slotNumber) {
        playersBySlot.set(slotNumber, playersBySlot.get(slotNumber) ?? []);
      }
      const entryPlayers = this.extractTelemetryArray(entry.players);
      for (const playerEntry of entryPlayers) {
        const resolvedSlot =
          this.telemetrySlotNumber(playerEntry) ?? slotNumber ?? null;
        this.addTelemetryPlayer(playersBySlot, seenBySlot, resolvedSlot, {
          pubgAccountId: this.telemetryPlayerOpenId(playerEntry),
          externalPlayerId: this.telemetryPlayerId(playerEntry),
          name:
            this.telemetryPlayerName(playerEntry) ??
            `Player ${playersBySlot.get(resolvedSlot ?? 0)?.length ?? 0}`,
          avatarUrl: this.telemetryPlayerAvatar(playerEntry),
        });
      }
    }

    for (const source of payloadRecords) {
      for (const key of [
        'TotalPlayerList',
        'totalPlayerList',
        'PlayerList',
        'playerList',
        'PlayerInfoList',
        'playerInfoList',
        'players',
      ]) {
        const entries = this.extractTelemetryArray(source[key]);
        if (entries.length === 0) {
          continue;
        }
        for (const entry of entries) {
          const teamId = this.telemetryTeamId(entry);
          const slotNumber =
            this.telemetrySlotNumber(entry) ??
            (teamId ? (slotByTeamId.get(teamId) ?? null) : null);
          if (slotNumber) {
            playersBySlot.set(slotNumber, playersBySlot.get(slotNumber) ?? []);
          }
          this.addTelemetryPlayer(playersBySlot, seenBySlot, slotNumber, {
            pubgAccountId: this.telemetryPlayerOpenId(entry),
            externalPlayerId: this.telemetryPlayerId(entry),
            name:
              this.telemetryPlayerName(entry) ??
              `Player ${playersBySlot.get(slotNumber ?? 0)?.length ?? 0}`,
            avatarUrl: this.telemetryPlayerAvatar(entry),
          });
        }
      }
    }

    return playersBySlot;
  }

  private collectTelemetryPayloadRecords(
    payload: unknown,
  ): Array<Record<string, unknown>> {
    const root = this.asJsonRecord(payload as Prisma.JsonValue | null);
    if (!root) {
      return [];
    }

    const queue: Array<Record<string, unknown>> = [root];
    const records: Array<Record<string, unknown>> = [];
    const seen = new Set<Record<string, unknown>>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || seen.has(current)) {
        continue;
      }
      seen.add(current);
      records.push(current);

      for (const key of [
        'raw',
        'observerTelemetry',
        'totalmessage',
        'setcircleinfo',
        'setobservingplayer',
        'setteambackpackinfo',
        'setteaminfo',
        'setteaminfolist',
      ]) {
        const nested = this.asJsonRecord(
          current[key] as Prisma.JsonValue | null,
        );
        if (nested && !seen.has(nested)) {
          queue.push(nested);
        }
      }
    }

    return records;
  }

  private asJsonRecordArray(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => this.asJsonRecord(item as Prisma.JsonValue | null))
      .filter((item): item is Record<string, unknown> => Boolean(item));
  }

  private async clearTelemetryIdentityConflicts(
    client: ResultsDbClient,
    params: {
      organizationId: string;
      targetPlayerId: string;
      playerOpenId: string | null;
      externalPlayerId: string | null;
    },
  ) {
    if (!client.player?.findUnique || !client.player?.update) {
      return;
    }

    type ConflictPlayer = {
      id: string;
      externalId: string | null;
      externalPlayerId: string | null;
      playerOpenId: string | null;
    };

    const conflictSelect = {
      id: true,
      externalId: true,
      externalPlayerId: true,
      playerOpenId: true,
    } satisfies Prisma.PlayerSelect;

    const clearConflict = async (conflict: ConflictPlayer | null) => {
      if (!conflict || conflict.id === params.targetPlayerId) {
        return;
      }
      const data: Prisma.PlayerUncheckedUpdateInput = {};
      if (
        params.playerOpenId &&
        conflict.playerOpenId === params.playerOpenId
      ) {
        data.playerOpenId = null;
      }
      if (
        params.externalPlayerId &&
        conflict.externalPlayerId === params.externalPlayerId
      ) {
        data.externalPlayerId = null;
      }
      if (
        params.externalPlayerId &&
        conflict.externalId === params.externalPlayerId
      ) {
        data.externalId = null;
      }
      if (!Object.keys(data).length) {
        return;
      }
      await client.player.update({
        where: { id: conflict.id },
        data,
        select: { id: true },
      });
    };

    if (params.playerOpenId) {
      await clearConflict(
        await client.player.findUnique({
          where: { playerOpenId: params.playerOpenId },
          select: conflictSelect,
        }),
      );
    }

    if (params.externalPlayerId) {
      await clearConflict(
        await client.player.findUnique({
          where: {
            organizationId_externalPlayerId: {
              organizationId: params.organizationId,
              externalPlayerId: params.externalPlayerId,
            },
          },
          select: conflictSelect,
        }),
      );
      await clearConflict(
        await client.player.findUnique({
          where: {
            organizationId_externalSource_externalId: {
              organizationId: params.organizationId,
              externalSource: 'PUBG_TELEMETRY',
              externalId: params.externalPlayerId,
            },
          },
          select: conflictSelect,
        }),
      );
    }
  }

  private async materializeTelemetryPlayer(
    client: ResultsDbClient,
    params: {
      organizationId: string;
      teamId: string | null;
      player: MaterializedSlotPlayer;
    },
  ) {
    const playerOpenId = this.toStringValue(params.player.pubgAccountId);
    const externalPlayerId =
      this.toStringValue(params.player.externalPlayerId) ?? playerOpenId;
    const realPubgUid = isRealPubgUidCandidate(externalPlayerId, playerOpenId)
      ? externalPlayerId.trim()
      : null;
    if (!playerOpenId && !externalPlayerId) {
      return null;
    }

    const ign = this.toStringValue(params.player.name) ?? 'Player';
    const telemetryIdentitySelect = {
      id: true,
      ign: true,
      photoUrl: true,
      externalId: true,
      externalPlayerId: true,
      inGameId: true,
      pubgPlayerId: true,
      playerOpenId: true,
    } satisfies Prisma.PlayerSelect;
    const nextExternalIdentity = externalPlayerId ?? playerOpenId;
    const buildTelemetryIdentityUpdate = () => {
      const data: Prisma.PlayerUncheckedUpdateInput = {
        teamId: params.teamId ?? undefined,
        ign,
        externalSource: 'PUBG_TELEMETRY',
      };
      if (nextExternalIdentity) {
        data.externalId = nextExternalIdentity;
        data.externalPlayerId = nextExternalIdentity;
      }
      if (playerOpenId) {
        data.playerOpenId = playerOpenId;
      }
      if (realPubgUid) {
        data.inGameId = realPubgUid;
        data.pubgPlayerId = realPubgUid;
        data.pubgIdSource = 'PCOB';
      }
      return data;
    };

    if (playerOpenId && typeof client.player.findUnique === 'function') {
      const existingByOpenId = await client.player.findUnique({
        where: { playerOpenId },
        select: telemetryIdentitySelect,
      });
      if (existingByOpenId) {
        await this.clearTelemetryIdentityConflicts(client, {
          organizationId: params.organizationId,
          targetPlayerId: existingByOpenId.id,
          playerOpenId,
          externalPlayerId: nextExternalIdentity,
        });
        return client.player.update({
          where: { id: existingByOpenId.id },
          data: buildTelemetryIdentityUpdate(),
          select: telemetryIdentitySelect,
        });
      }
    }

    if (externalPlayerId && typeof client.player.findUnique === 'function') {
      const existingByExternalId = await client.player.findUnique({
        where: {
          organizationId_externalPlayerId: {
            organizationId: params.organizationId,
            externalPlayerId,
          },
        },
        select: telemetryIdentitySelect,
      });
      if (existingByExternalId) {
        await this.clearTelemetryIdentityConflicts(client, {
          organizationId: params.organizationId,
          targetPlayerId: existingByExternalId.id,
          playerOpenId,
          externalPlayerId: nextExternalIdentity,
        });
        return client.player.update({
          where: { id: existingByExternalId.id },
          data: buildTelemetryIdentityUpdate(),
          select: telemetryIdentitySelect,
        });
      }
    }

    if (params.teamId && typeof client.player.findMany === 'function') {
      const nameMatchedRosterPlayers = await client.player.findMany({
        where: {
          organizationId: params.organizationId,
          teamId: params.teamId,
          deletedAt: null,
          OR: [
            { ign: { equals: ign, mode: 'insensitive' } },
            { realName: { equals: ign, mode: 'insensitive' } },
          ],
        },
        select: telemetryIdentitySelect,
        take: 2,
      });
      if (
        nameMatchedRosterPlayers.length === 1 &&
        (realPubgUid ||
          (!nameMatchedRosterPlayers[0].playerOpenId &&
            !nameMatchedRosterPlayers[0].externalPlayerId &&
            !nameMatchedRosterPlayers[0].externalId))
      ) {
        await this.clearTelemetryIdentityConflicts(client, {
          organizationId: params.organizationId,
          targetPlayerId: nameMatchedRosterPlayers[0].id,
          playerOpenId,
          externalPlayerId: nextExternalIdentity,
        });
        return client.player.update({
          where: { id: nameMatchedRosterPlayers[0].id },
          data: buildTelemetryIdentityUpdate(),
          select: telemetryIdentitySelect,
        });
      }
    }

    if (playerOpenId) {
      return client.player.upsert({
        where: { playerOpenId },
        create: {
          organizationId: params.organizationId,
          teamId: params.teamId ?? undefined,
          ign,
          photoUrl: resolvePlayerPhoto(null),
          source: PlayerSource.API,
          externalSource: 'PUBG_TELEMETRY',
          externalId: externalPlayerId ?? playerOpenId,
          externalPlayerId: externalPlayerId ?? playerOpenId,
          inGameId: realPubgUid ?? undefined,
          pubgPlayerId: realPubgUid ?? undefined,
          pubgIdSource: realPubgUid ? 'PCOB' : undefined,
          playerOpenId,
        },
        update: {
          teamId: params.teamId ?? undefined,
          ign,
          externalSource: 'PUBG_TELEMETRY',
          externalId: externalPlayerId ?? playerOpenId,
          externalPlayerId: externalPlayerId ?? playerOpenId,
          inGameId: realPubgUid ?? undefined,
          pubgPlayerId: realPubgUid ?? undefined,
          pubgIdSource: realPubgUid ? 'PCOB' : undefined,
          playerOpenId,
        },
        select: {
          id: true,
          ign: true,
          photoUrl: true,
          externalPlayerId: true,
          inGameId: true,
          pubgPlayerId: true,
          playerOpenId: true,
        },
      });
    }

    return client.player.upsert({
      where: {
        organizationId_externalPlayerId: {
          organizationId: params.organizationId,
          externalPlayerId: externalPlayerId as string,
        },
      },
      create: {
        organizationId: params.organizationId,
        teamId: params.teamId ?? undefined,
        ign,
        photoUrl: resolvePlayerPhoto(null),
        source: PlayerSource.API,
        externalSource: 'PUBG_TELEMETRY',
        externalId: externalPlayerId,
        externalPlayerId: externalPlayerId as string,
        inGameId: realPubgUid ?? undefined,
        pubgPlayerId: realPubgUid ?? undefined,
        pubgIdSource: realPubgUid ? 'PCOB' : undefined,
      },
      update: {
        teamId: params.teamId ?? undefined,
        ign,
        externalSource: 'PUBG_TELEMETRY',
        externalId: externalPlayerId,
        externalPlayerId: externalPlayerId as string,
        inGameId: realPubgUid ?? undefined,
        pubgPlayerId: realPubgUid ?? undefined,
        pubgIdSource: realPubgUid ? 'PCOB' : undefined,
      },
      select: {
        id: true,
        ign: true,
        photoUrl: true,
        externalPlayerId: true,
        inGameId: true,
        pubgPlayerId: true,
        playerOpenId: true,
      },
    });
  }

  private async materializeSlotResultPlayersForTeams(
    client: ResultsDbClient,
    matchId: string,
  ) {
    if (!client.player || !client.matchSlotPlayerResult) {
      return;
    }

    const slotResults = await client.matchSlotResult.findMany({
      where: { matchId, teamId: { not: null } },
      select: {
        id: true,
        organizationId: true,
        teamId: true,
        players: {
          select: {
            id: true,
            playerId: true,
            playerName: true,
            pubgAccountId: true,
            externalPlayerId: true,
          },
        },
      },
    });

    for (const slotResult of slotResults) {
      if (!slotResult.teamId) continue;

      const linkedRowsByPlayerId = new Map<string, string>();
      for (const player of slotResult.players ?? []) {
        if (player.playerId) {
          linkedRowsByPlayerId.set(player.playerId, player.id);
        }
      }

      for (const player of slotResult.players ?? []) {
        const pubgAccountId = this.toStringValue(player.pubgAccountId);
        const externalPlayerId = this.toStringValue(player.externalPlayerId);
        if (!pubgAccountId && !externalPlayerId) continue;

        const materialized = await this.materializeTelemetryPlayer(client, {
          organizationId: slotResult.organizationId,
          teamId: slotResult.teamId,
          player: {
            pubgAccountId,
            externalPlayerId,
            name: player.playerName,
            avatarUrl: null,
          },
        });
        if (!materialized) continue;

        const playerName = materialized.ign ?? player.playerName;
        const nextPubgAccountId = materialized.playerOpenId ?? pubgAccountId;
        const nextExternalPlayerId =
          materialized.externalPlayerId ??
          externalPlayerId ??
          nextPubgAccountId;
        const alreadyLinkedRowId = linkedRowsByPlayerId.get(materialized.id);
        if (alreadyLinkedRowId && alreadyLinkedRowId !== player.id) {
          await client.matchSlotPlayerResult.update({
            where: { id: alreadyLinkedRowId },
            data: {
              playerName,
              pubgAccountId: nextPubgAccountId,
              externalPlayerId: nextExternalPlayerId,
              isAutoFilled: true,
            },
          });
          await client.matchSlotPlayerResult.deleteMany({
            where: { id: player.id },
          });
          continue;
        }

        await client.matchSlotPlayerResult.update({
          where: { id: player.id },
          data: {
            playerId: materialized.id,
            playerName,
            pubgAccountId: nextPubgAccountId,
            externalPlayerId: nextExternalPlayerId,
            isAutoFilled: true,
          },
        });
        linkedRowsByPlayerId.set(materialized.id, player.id);
      }
    }
  }

  async syncMatchPlayers(matchId: string, opts: { tx?: Tx } = {}) {
    const client = opts.tx ?? this.prisma;
    await this.materializeSlotResultPlayersForTeams(client, matchId);

    const slotResults = await client.matchSlotResult.findMany({
      where: { matchId },
      select: {
        teamId: true,
        players: {
          select: {
            playerId: true,
            pubgAccountId: true,
            externalPlayerId: true,
            kills: true,
            assists: true,
            isAlive: true,
            alive: true,
            isKnocked: true,
          },
        },
      },
    });

    const desired = new Map<
      string,
      {
        teamId: string | null;
        pubgAccountId: string | null;
        externalPlayerId: string | null;
        kills: number;
        alive: boolean;
        knocked: boolean;
      }
    >();

    for (const slot of slotResults) {
      for (const player of slot.players ?? []) {
        if (!player.playerId) continue;
        desired.set(player.playerId, {
          teamId: slot.teamId ?? null,
          pubgAccountId: player.pubgAccountId ?? null,
          externalPlayerId:
            player.externalPlayerId ?? player.pubgAccountId ?? null,
          kills: player.kills ?? 0,
          alive:
            ((player as { isAlive?: boolean | null }).isAlive ??
              (player as { alive?: boolean | null }).alive ??
              true) === true,
          knocked:
            ((player as { isKnocked?: boolean | null }).isKnocked ?? false) ===
            true,
        });
      }
    }

    const keepPlayerIds = Array.from(desired.keys());
    if (!keepPlayerIds.length) {
      await client.matchPlayer.deleteMany({ where: { matchId } });
      return;
    }

    for (const [playerId, state] of desired) {
      await client.matchPlayer.upsert({
        where: { matchId_playerId: { matchId, playerId } },
        create: {
          matchId,
          teamId: state.teamId ?? undefined,
          playerId,
          pubgAccountId: state.pubgAccountId ?? undefined,
          externalPlayerId: state.externalPlayerId ?? undefined,
          kills: state.kills,
          alive: state.alive,
          knocked: state.knocked,
        },
        update: {
          teamId: state.teamId,
          pubgAccountId: state.pubgAccountId,
          externalPlayerId: state.externalPlayerId,
          kills: state.kills,
          alive: state.alive,
          knocked: state.knocked,
        },
      });
    }

    await client.matchPlayer.deleteMany({
      where: {
        matchId,
        playerId: { notIn: keepPlayerIds },
      },
    });
  }

  private countAlivePlayers(
    players: Array<{ isAlive?: boolean | null; alive?: boolean | null }>,
  ): number {
    return (players ?? []).reduce((count, p) => {
      const alive =
        typeof p?.isAlive === 'boolean'
          ? p.isAlive
          : typeof p?.alive === 'boolean'
            ? p.alive
            : false;
      return alive ? count + 1 : count;
    }, 0);
  }

  private countAliveTeams(
    teams: Array<
      | { aliveCount: number }
      | { players: Array<{ isAlive?: boolean | null; alive?: boolean | null }> }
    >,
  ): number {
    return (teams ?? []).reduce((count, team: any) => {
      const aliveCount =
        typeof team.aliveCount === 'number'
          ? team.aliveCount
          : this.countAlivePlayers(team.players ?? []);
      return aliveCount > 0 ? count + 1 : count;
    }, 0);
  }

  private normalizeEliminatedOrders(
    teams: Array<{
      slotId: string;
      eliminatedOrder: number | null;
      aliveCount: number;
    }>,
  ): Map<string, number> {
    const eliminated = teams
      .filter((t) => t.aliveCount === 0)
      .sort((a, b) => {
        const ao = a.eliminatedOrder ?? Number.POSITIVE_INFINITY;
        const bo = b.eliminatedOrder ?? Number.POSITIVE_INFINITY;
        if (ao === bo) return a.slotId.localeCompare(b.slotId);
        return ao - bo;
      });

    const map = new Map<string, number>();
    let idx = 1;
    for (const team of eliminated) {
      map.set(team.slotId, idx);
      idx += 1;
    }
    return map;
  }

  private derivePlacement(
    totalTeams: number,
    eliminatedOrder: number | null,
    isAlive: boolean,
    aliveTeamsCount: number,
  ): number | null {
    if (eliminatedOrder !== null) {
      const placement = totalTeams - eliminatedOrder + 1;
      return placement < 1 ? 1 : placement;
    }
    if (isAlive && aliveTeamsCount === 1) {
      return 1;
    }
    return null;
  }

  private normalizePlayersForRules(
    existing: Array<{
      id: string;
      playerId?: string | null;
      kills?: number | null;
      assists?: number | null;
      isAlive?: boolean | null;
      alive?: boolean | null;
      isKnocked?: boolean | null;
      knocked?: boolean | null;
    }>,
    incoming: Array<{
      playerResultId?: string | null;
      playerId?: string | null;
      kills?: number | null;
      assists?: number | null;
      isAlive?: boolean | null;
      alive?: boolean | null;
      isKnocked?: boolean | null;
      knocked?: boolean | null;
    }>,
  ): NormalizedPlayerState[] {
    const byResultId = new Map(existing.map((p) => [p.id, p]));
    const byPlayerId = new Map(
      existing
        .map(
          (p) =>
            [
              buildMatchPlayerKey({
                playerId: p.playerId ?? null,
                playerResultId: p.id,
              }),
              p,
            ] as const,
        )
        .filter(
          (entry): entry is [string, (typeof existing)[number]] =>
            entry[0] !== null,
        ),
    );

    for (const inc of incoming) {
      const incomingPlayerKey = buildMatchPlayerKey({
        playerId: inc.playerId ?? null,
        playerResultId: inc.playerResultId ?? null,
      });
      const target =
        (inc.playerResultId && byResultId.get(inc.playerResultId)) ||
        (incomingPlayerKey && byPlayerId.get(incomingPlayerKey));
      if (!target) {
        throw new BadRequestException('Player does not belong to this team');
      }
    }

    return existing.map((player) => {
      const existingPlayerKey = buildMatchPlayerKey({
        playerId: player.playerId ?? null,
        playerResultId: player.id,
      });
      const inc =
        incoming.find(
          (p) =>
            p.playerResultId === player.id ||
            buildMatchPlayerKey({
              playerId: p.playerId ?? null,
              playerResultId: p.playerResultId ?? null,
            }) === existingPlayerKey,
        ) ?? null;

      const killsRaw = inc?.kills ?? (player as any).kills ?? 0;
      const kills =
        typeof killsRaw === 'number' && Number.isFinite(killsRaw)
          ? Math.max(0, killsRaw)
          : 0;
      const assistsRaw = inc?.assists ?? (player as any).assists ?? 0;
      const assists =
        typeof assistsRaw === 'number' && Number.isFinite(assistsRaw)
          ? Math.max(0, assistsRaw)
          : 0;

      const isAlive =
        typeof inc?.isAlive === 'boolean'
          ? inc.isAlive
          : typeof inc?.alive === 'boolean'
            ? inc.alive
            : ((player as any).isAlive ?? (player as any).alive ?? true);

      let isKnocked =
        typeof inc?.isKnocked === 'boolean'
          ? inc.isKnocked
          : typeof inc?.knocked === 'boolean'
            ? inc.knocked
            : ((player as any).isKnocked ?? (player as any).knocked ?? false);

      if (!isAlive) {
        isKnocked = false;
      }

      return {
        id: player.id,
        playerId: player.playerId ?? null,
        kills,
        assists,
        isAlive: Boolean(isAlive),
        isKnocked: Boolean(isAlive) && Boolean(isKnocked),
      };
    });
  }

  private computeAlivePlayers(
    players: Array<{ isAlive?: boolean | null; alive?: boolean | null }>,
  ): number {
    return (players ?? []).reduce((count, p) => {
      const alive =
        typeof (p as any)?.isAlive === 'boolean'
          ? (p as any).isAlive
          : typeof (p as any)?.alive === 'boolean'
            ? (p as any).alive
            : false;
      return alive ? count + 1 : count;
    }, 0);
  }

  private computeTeamKills(players: Array<{ kills?: number | null }>): number {
    return (players ?? []).reduce((sum, p) => {
      const value =
        typeof p.kills === 'number' && Number.isFinite(p.kills) ? p.kills : 0;
      return sum + Math.max(0, value);
    }, 0);
  }

  private computeAliveTeams(
    slots: Array<{
      eliminatedAt?: Date | null;
      eliminatedOrder?: number | null;
      players?: Array<{ isAlive?: boolean | null; alive?: boolean | null }>;
    }>,
  ): number {
    return (slots ?? []).reduce((count, slot) => {
      const alivePlayers = this.computeAlivePlayers(slot.players ?? []);
      const eliminated =
        (slot.eliminatedAt !== null && slot.eliminatedAt !== undefined) ||
        (slot as { eliminatedOrder?: number | null }).eliminatedOrder !== null;
      const alive = alivePlayers > 0 && !eliminated;
      return alive ? count + 1 : count;
    }, 0);
  }

  private enforcePlayerRuleSet(
    states: NormalizedPlayerState[],
  ): NormalizedPlayerState[] {
    const derived = derivePubgTeamState({
      eliminationMarker: new Date(),
      team: {
        teamId: 'team',
        sortKey: 'team',
        players: states.map((player) => ({
          id: player.id,
          teamId: 'team',
          kills: player.kills,
          alive: player.isAlive,
          knocked: player.isKnocked,
        })),
        totalPlayers: states.length,
      },
    });

    return derived.players.map((player) => {
      const current = states.find((entry) => entry.id === player.id);
      return {
        id: player.id,
        playerId: buildMatchPlayerKey({
          playerId: current?.playerId ?? null,
          playerResultId: player.id,
        }),
        kills: player.kills,
        assists: current?.assists ?? 0,
        isAlive: player.alive,
        isKnocked: player.knocked,
      };
    });
  }

  private assignNextEliminatedOrder(
    teams: Array<{ eliminatedOrder?: number | null }>,
  ): number {
    const maxOrder = teams.reduce((max, team) => {
      const value =
        typeof team.eliminatedOrder === 'number' ? team.eliminatedOrder : null;
      return value !== null ? Math.max(max, value) : max;
    }, 0);
    return maxOrder + 1;
  }

  private shouldFullMatchLock(match: {
    status?: string | null;
    liveState?: string | null;
    dataSource?: string | null;
    dataMode?: string | null;
    controlState?: {
      state?: string | null;
      metaJson?: Prisma.JsonValue | null;
      resultsManualLock?: boolean | null;
      resultsForceUnlock?: boolean | null;
    } | null;
  }): boolean {
    return deriveMatchLockContract({
      status: match.status ?? null,
      liveState: match.liveState ?? match.controlState?.state ?? null,
      controlState: match.controlState?.state ?? null,
      metaJson: match.controlState?.metaJson ?? null,
      dataSource: match.dataSource ?? null,
      dataMode: match.dataMode ?? null,
      manualLock: match.controlState?.resultsManualLock ?? null,
      forceUnlock: match.controlState?.resultsForceUnlock ?? null,
    }).resultsLocked;
  }

  public validatePlayerStateTransition(params: {
    playerId: string;
    incomingAlive?: boolean | null;
    incomingKnocked?: boolean | null;
    current: {
      isAlive?: boolean | null;
      alive?: boolean | null;
      isKnocked?: boolean | null;
    };
    teammates: Array<{
      id: string;
      isAlive?: boolean | null;
      alive?: boolean | null;
      isKnocked?: boolean | null;
    }>;
  }) {
    const { playerId, incomingAlive, incomingKnocked, current, teammates } =
      params;

    const mergedPlayers = new Map(
      (teammates ?? []).map((teammate) => [
        teammate.id,
        {
          id: teammate.id,
          teamId: 'team',
          alive:
            teammate.id === playerId
              ? typeof incomingAlive === 'boolean'
                ? incomingAlive
                : (current.isAlive ?? current.alive ?? true)
              : (teammate.isAlive ?? teammate.alive ?? true),
          knocked:
            teammate.id === playerId
              ? typeof incomingKnocked === 'boolean'
                ? incomingKnocked
                : ((current as { isKnocked?: boolean | null }).isKnocked ??
                  false)
              : ((teammate as { isKnocked?: boolean | null }).isKnocked ??
                false),
          kills: 0,
        },
      ]),
    );

    if (!mergedPlayers.has(playerId)) {
      mergedPlayers.set(playerId, {
        id: playerId,
        teamId: 'team',
        alive:
          typeof incomingAlive === 'boolean'
            ? incomingAlive
            : (current.isAlive ?? current.alive ?? true),
        knocked:
          typeof incomingKnocked === 'boolean'
            ? incomingKnocked
            : ((current as { isKnocked?: boolean | null }).isKnocked ?? false),
        kills: 0,
      });
    }

    const derived = derivePubgTeamState({
      eliminationMarker: new Date(),
      team: {
        teamId: 'team',
        sortKey: 'team',
        players: Array.from(mergedPlayers.values()),
        totalPlayers: mergedPlayers.size,
      },
    });
    const nextPlayer = derived.players.find((player) => player.id === playerId);
    if (!nextPlayer) {
      throw new BadRequestException('Player does not belong to this team');
    }

    return {
      nextIsAlive: nextPlayer.alive,
      nextIsKnocked: nextPlayer.knocked,
      aliveAfterUpdate: derived.aliveCount,
    };
  }

  private validateSlotState(params: {
    placement?: number | null;
    manualTotalKills?: boolean | null;
    totalKills?: number | null;
    players: Array<{ isAlive?: boolean | null; alive?: boolean | null }>;
  }) {
    const { placement, manualTotalKills, totalKills, players } = params;
    const aliveCount = (players ?? []).reduce((count, p) => {
      return this.resolveAliveFlag({ isAlive: p.isAlive }) ? count + 1 : count;
    }, 0);

    if (
      placement !== null &&
      placement !== undefined &&
      aliveCount > 0 &&
      players.length > 0
    ) {
      throw new BadRequestException(
        'Cannot set placement while team still has alive players',
      );
    }

    if (
      manualTotalKills === true &&
      (totalKills === null || totalKills === undefined)
    ) {
      throw new BadRequestException(
        'manualTotalKills=true requires totalKills to be provided',
      );
    }
  }

  private noShowMutationMessage(): string {
    return 'Cannot mutate results for a NO_SHOW team.';
  }

  async assertSlotPresentForMutation(
    slotRef:
      | string
      | {
          id?: string | null;
          matchId?: string | null;
          slotNumber?: number | null;
          teamId?: string | null;
          wasPresentInMatch?: boolean | null;
        },
    opts?: {
      allowManualPromote?: boolean;
    },
  ) {
    let resolved =
      typeof slotRef === 'string'
        ? await this.prisma.matchSlotResult.findUnique({
            where: { id: slotRef },
            select: {
              id: true,
              matchId: true,
              slotNumber: true,
              teamId: true,
              wasPresentInMatch: true,
            },
          })
        : slotRef.wasPresentInMatch !== undefined
          ? {
              id: slotRef.id ?? null,
              matchId: slotRef.matchId ?? null,
              slotNumber: slotRef.slotNumber ?? null,
              teamId: slotRef.teamId ?? null,
              wasPresentInMatch: slotRef.wasPresentInMatch ?? null,
            }
          : slotRef.id
            ? await this.prisma.matchSlotResult.findUnique({
                where: { id: slotRef.id },
                select: {
                  id: true,
                  matchId: true,
                  slotNumber: true,
                  teamId: true,
                  wasPresentInMatch: true,
                },
              })
            : slotRef.matchId && slotRef.slotNumber
              ? await this.prisma.matchSlotResult.findUnique({
                  where: {
                    matchId_slotNumber: {
                      matchId: slotRef.matchId,
                      slotNumber: slotRef.slotNumber,
                    },
                  },
                  select: {
                    id: true,
                    matchId: true,
                    slotNumber: true,
                    teamId: true,
                    wasPresentInMatch: true,
                  },
                })
              : slotRef.matchId && slotRef.teamId
                ? await this.prisma.matchSlotResult.findFirst({
                    where: {
                      matchId: slotRef.matchId,
                      teamId: slotRef.teamId,
                    },
                    select: {
                      id: true,
                      matchId: true,
                      slotNumber: true,
                      teamId: true,
                      wasPresentInMatch: true,
                    },
                  })
                : null;

    if (!resolved?.id || !resolved.matchId || resolved.slotNumber === null) {
      throw new NotFoundException('Slot result not found');
    }

    if (!isPresentInMatch(resolved.wasPresentInMatch)) {
      if (opts?.allowManualPromote && resolved.teamId) {
        resolved = await this.prisma.matchSlotResult.update({
          where: { id: resolved.id },
          data: { wasPresentInMatch: true },
          select: {
            id: true,
            matchId: true,
            slotNumber: true,
            teamId: true,
            wasPresentInMatch: true,
          },
        });
      }
    }

    if (!isPresentInMatch(resolved.wasPresentInMatch)) {
      throw new BadRequestException(this.noShowMutationMessage());
    }

    return {
      id: resolved.id,
      matchId: resolved.matchId,
      slotNumber: resolved.slotNumber,
      teamId: resolved.teamId ?? null,
      wasPresentInMatch: resolved.wasPresentInMatch ?? null,
    };
  }

  isManualSource(match: {
    dataSource?: string | null;
    dataMode?: string | null;
  }) {
    const source = (match.dataSource ?? match.dataMode ?? '')
      .toString()
      .toUpperCase();
    return source === 'MANUAL';
  }

  private hasManualMirrorAuthority(match: {
    dataSource?: string | null;
    dataMode?: string | null;
    controlState?: {
      authorityMode?: string | null;
    } | null;
  }) {
    const authorityMode = (match.controlState?.authorityMode ?? '')
      .toString()
      .toUpperCase();
    const sourceMode = (match.dataSource ?? match.dataMode ?? '')
      .toString()
      .toUpperCase();
    return (
      authorityMode === 'MANUAL' ||
      sourceMode === 'MANUAL' ||
      (!authorityMode && !sourceMode)
    );
  }

  private lockStateFromMatch(match: {
    status?: string | null;
    liveState?: string | null;
    dataSource?: string | null;
    dataMode?: string | null;
    controlState?: {
      state?: string | null;
      metaJson?: Prisma.JsonValue | null;
      resultsManualLock?: boolean | null;
      resultsForceUnlock?: boolean | null;
    } | null;
  }) {
    return deriveMatchLockContract({
      status: match.status ?? null,
      liveState: match.liveState ?? match.controlState?.state ?? null,
      controlState: match.controlState?.state ?? null,
      metaJson: match.controlState?.metaJson ?? null,
      dataSource: match.dataSource ?? null,
      dataMode: match.dataMode ?? null,
      manualLock: match.controlState?.resultsManualLock ?? null,
      forceUnlock: match.controlState?.resultsForceUnlock ?? null,
    }).resultLockState;
  }

  ensureManualSource(match: {
    dataSource?: string | null;
    dataMode?: string | null;
  }) {
    if (!this.isManualSource(match)) {
      throw new ForbiddenException('Results locked for API matches');
    }
  }

  private placementPoints(placement?: number | null): number {
    if (!placement || placement <= 0) return 0;
    if (placement === 1) return 10;
    if (placement === 2) return 6;
    if (placement === 3) return 5;
    if (placement === 4) return 4;
    if (placement === 5) return 3;
    if (placement === 6) return 2;
    if (placement === 7 || placement === 8) return 1;
    return 0;
  }

  private canEdit(
    actor: AuthUser | null | undefined,
    ownerUserId: string | null | undefined,
    orgId?: string | null,
  ) {
    if (!actor) return false;
    const actorRole = actor.actorRole ?? actor.role;
    const actorId = actor.actorId ?? actor.id;
    if (actorRole === Role.SUPER_ADMIN) return true;
    if (
      orgId &&
      (actor.organizationId === orgId || actor.actingOrgId === orgId)
    ) {
      return true;
    }
    return Boolean(ownerUserId) && actorId === ownerUserId;
  }

  private deriveLockState(match: ResultLockContext) {
    return deriveMatchLockContract({
      liveState:
        (match as { liveState?: string | null })?.liveState ??
        (match as { controlState?: { state?: string | null } | null })
          ?.controlState?.state ??
        null,
      controlState:
        (match as { controlState?: { state?: string | null } | null })
          ?.controlState?.state ?? null,
    }).resultLockState;
  }

  async ensureResultsEditable(
    match: MatchSummary,
    actor?: AuthUser | null,
    opts?: { allowUnlockEliminated?: boolean; allowReviveOnly?: boolean },
  ) {
    const manualSource = this.isManualSource(match);
    const actorRole = actor?.actorRole ?? actor?.role ?? null;

    assertMatchWritable(match, {
      role: actorRole,
      override: actor?.override ?? false,
    });

    const dynamicLock = deriveMatchLockContract({
      status: match.status ?? null,
      liveState:
        (match as { liveState?: string | null }).liveState ??
        match.controlState?.state ??
        null,
      controlState: match.controlState?.state ?? null,
      metaJson: match.controlState?.metaJson ?? null,
      dataSource: (match as { dataSource?: string | null }).dataSource ?? null,
      dataMode: (match as { dataMode?: string | null }).dataMode ?? null,
      manualLock: match.controlState?.resultsManualLock ?? null,
      forceUnlock: match.controlState?.resultsForceUnlock ?? null,
    });
    const lifecycleStatus = deriveCanonicalMatchLifecycleStatus({
      status: match.status ?? null,
      liveState:
        (match as { liveState?: string | null }).liveState ??
        match.controlState?.state ??
        null,
      controlState: match.controlState?.state ?? null,
      metaJson: match.controlState?.metaJson ?? null,
      dataSource: (match as { dataSource?: string | null }).dataSource ?? null,
      dataMode: (match as { dataMode?: string | null }).dataMode ?? null,
      manualLock: match.controlState?.resultsManualLock ?? null,
      forceUnlock: match.controlState?.resultsForceUnlock ?? null,
    });
    if (lifecycleStatus === 'LIVE') {
      throw new ConflictException(
        'Results cannot be edited while the match is LIVE.',
      );
    }
    if (dynamicLock.resultsLocked && !opts?.allowReviveOnly) {
      throw new ConflictException(dynamicLock.reason ?? 'Results are locked.');
    }
    if (match.controlState?.resultsManualLock && !opts?.allowReviveOnly) {
      throw new ConflictException('Results are locked by match control.');
    }
    const lockedSlot = await this.prisma.matchSlotResult.findFirst({
      where: { matchId: match.id, isLocked: true },
      select: { id: true },
    });
    if (
      lockedSlot &&
      dynamicLock.resultsLocked &&
      !opts?.allowUnlockEliminated
    ) {
      throw new ConflictException('Results are locked.');
    }
    const lockable = match as unknown as LockableMatch;
    const meta = lockable.controlState?.metaJson ?? null;
    const finalized =
      meta &&
      typeof meta === 'object' &&
      (meta as { resultFinalized?: boolean }).resultFinalized === true;
    const reopenedAfterFinalize =
      finalized &&
      !manualSource &&
      match.controlState?.resultsForceUnlock === true;
    if (finalized && !manualSource && !reopenedAfterFinalize) {
      throw new BadRequestException('Results are finalized for this match.');
    }

    if (!opts?.allowReviveOnly && !manualSource && !reopenedAfterFinalize) {
      if (!isSessionMatch(match)) {
        const edit = await this.standings.canEditResults(match.id);
        const canBypassLocked =
          opts?.allowUnlockEliminated === true && edit.isFinal !== true;
        if (!edit.canEdit && !canBypassLocked) {
          throw new ConflictException('Results are locked for this match.');
        }
        if (edit.isFinal && opts?.allowUnlockEliminated) {
          throw new BadRequestException(
            'Results are finalized for this match.',
          );
        }
      }
    }
  }

  async setPlacements(
    actor: AuthUser,
    matchId: string,
    placements: Array<{ teamId: string; placement: number }>,
    expectedVersion?: number | null,
  ) {
    if (!placements?.length) {
      throw new BadRequestException('placements array is required');
    }
    const match = await this.ensureMatch(actor, matchId);
    this.assertResultsVersion(
      match,
      this.resolveExpectedResultsVersion(expectedVersion),
    );
    await this.ensureResultsEditable(match, actor);

    const slots = await this.prisma.matchSlotResult.findMany({
      where: { matchId, teamId: { not: null } },
      include: { players: true },
      orderBy: { slotNumber: 'asc' },
    });
    const assignedSlots = slots.filter((slot) => Boolean(slot.teamId));
    const eligibleSlots = assignedSlots.filter((slot) =>
      isCompetitiveResultsTeam(slot.wasPresentInMatch),
    );
    const totalTeams = eligibleSlots.length;
    if (!totalTeams) {
      throw new BadRequestException('No active teams found for this match');
    }

    const uniqueTeamIds = new Set(placements.map((p) => p.teamId));
    if (uniqueTeamIds.size !== placements.length) {
      throw new BadRequestException('Duplicate teams in placements payload');
    }
    if (placements.length !== totalTeams) {
      throw new BadRequestException(
        'Placements must include every team exactly once',
      );
    }

    const placementSet = new Set(placements.map((p) => p.placement));
    for (let i = 1; i <= totalTeams; i += 1) {
      if (!placementSet.has(i)) {
        throw new BadRequestException(`Placement ${i} missing from payload`);
      }
    }

    const slotByTeam = new Map(
      eligibleSlots.map((s) => [s.teamId as string, s]),
    );

    for (const p of placements) {
      if (!slotByTeam.has(p.teamId)) {
        throw new BadRequestException(
          `Team ${p.teamId} not found in this match`,
        );
      }
      if (p.placement < 1 || p.placement > totalTeams) {
        throw new BadRequestException(
          `placement for team ${p.teamId} must be between 1 and ${totalTeams}`,
        );
      }
    }

    const ruleset = await this.rulesetConfig(matchId);
    const placementMap = new Map(
      placements.map((p) => [p.teamId, p.placement]),
    );
    const controlMeta = this.asJsonRecord(match.controlState?.metaJson);
    const finalizedResults = controlMeta?.resultFinalized === true;
    const winnerTeamId =
      placements.find((placement) => placement.placement === 1)?.teamId ?? null;
    const syncContract = await this.prisma.$transaction(async (tx) => {
      for (const slot of eligibleSlots) {
        const placement = placementMap.get(slot.teamId ?? '') ?? null;
        const eliminatedOrder =
          placement === null || placement === 1
            ? null
            : Math.max(1, totalTeams - placement + 1);

        const aggregates = this.computeSlotAggregates({
          slot: {
            ...slot,
            placement,
            totalKills: slot.totalKills,
            manualTotalKills: (slot as any).manualTotalKills ?? false,
          },
          ruleset,
        });

        await tx.matchSlotResult.update({
          where: { id: slot.id },
          data: {
            placement,
            ...(finalizedResults ? { finalPlacement: placement } : {}),
            eliminatedOrder,
            placementPoints: aggregates.placementPoints,
            points: aggregates.points,
            totalPoints: aggregates.totalPoints,
            isLocked: eliminatedOrder !== null || slot.isLocked,
          },
        });
      }

      if (finalizedResults && winnerTeamId) {
        const currentControl = await tx.matchControlState.findUnique({
          where: { matchId },
          select: {
            organizationId: true,
            state: true,
            metaJson: true,
          },
        });
        const currentMeta =
          this.asJsonRecord(currentControl?.metaJson) ?? controlMeta ?? {};
        const nextMeta = {
          ...currentMeta,
          winnerTeamId,
          resultNeedsConfirmation: false,
        };
        await tx.matchControlState.upsert({
          where: { matchId },
          update: {
            metaJson: nextMeta as Prisma.InputJsonObject,
          },
          create: {
            matchId,
            organizationId:
              currentControl?.organizationId ??
              this.resolveMatchOrganizationId(match, actor) ??
              '',
            state: normalizeControlState(
              currentControl?.state ?? match.controlState?.state ?? 'READY',
            ),
            metaJson: nextMeta as Prisma.InputJsonObject,
          },
        });
      }

      return this.persistManualSyncOverrides(tx, {
        actor,
        matchId,
        organizationId: this.resolveMatchOrganizationId(match, actor) ?? '',
        fallbackState: match.controlState?.state ?? 'READY',
        teams: placements.map((placement) => ({
          teamId: placement.teamId,
          fields: ['placement'],
        })),
        source: 'MANUAL_PLACEMENT_OVERRIDE',
      });
    });

    await this.recalculateMatchResults(matchId);
    if (!isSessionMatch(match)) {
      await this.standings.computeMatchStandings(matchId);
    }
    if (syncContract) {
      await this.publishManualMirrorFromResults(
        matchId,
        syncContract.version,
      ).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[MANUAL_PLACEMENT_OVERRIDE] Failed to publish live mirror match=${matchId}: ${message}`,
        );
      });
    }
    return { ok: true, version: syncContract.version };
  }

  async setManualMatchResults(
    actor: AuthUser,
    matchId: string,
    rows: Array<{ teamId: string; placement: number; kills: number }>,
    expectedVersion?: number | null,
  ) {
    if (!rows?.length) {
      throw new BadRequestException('results array is required');
    }

    const match = await this.ensureMatch(actor, matchId);
    this.assertResultsVersion(
      match,
      this.resolveExpectedResultsVersion(expectedVersion),
    );
    await this.ensureResultsEditable(match, actor);

    const ruleset = await this.rulesetConfig(matchId);
    const controlMeta = this.asJsonRecord(match.controlState?.metaJson);
    const finalizedResults = controlMeta?.resultFinalized === true;
    const finalizedAt =
      finalizedResults && typeof controlMeta?.finalizedAt === 'string'
        ? new Date(controlMeta.finalizedAt)
        : new Date();
    const organizationId = this.resolveMatchOrganizationId(match, actor) ?? '';
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }

    const uniqueTeamIds = new Set(rows.map((row) => row.teamId));
    if (uniqueTeamIds.size !== rows.length) {
      throw new BadRequestException('Duplicate teams in manual results');
    }

    const syncContract = await this.prisma.$transaction(async (tx) => {
      await this.ensureResultsFromSlots(matchId, { tx });
      const slots = await tx.matchSlotResult.findMany({
        where: { matchId, teamId: { not: null } },
        include: { players: true },
        orderBy: { slotNumber: 'asc' },
      });
      const eligibleSlots = slots.filter((slot) =>
        isCompetitiveResultsTeam(slot.wasPresentInMatch),
      );
      const totalTeams = eligibleSlots.length;
      if (!totalTeams) {
        throw new BadRequestException('No active teams found for this match');
      }
      if (rows.length !== totalTeams) {
        throw new BadRequestException(
          'Manual results must include every active slot team exactly once',
        );
      }

      const slotByTeamId = new Map(
        eligibleSlots.map((slot) => [slot.teamId as string, slot] as const),
      );
      const placementSet = new Set<number>();
      const normalizedRows = rows.map((row) => {
        const placement = Number(row.placement);
        const kills = Number(row.kills);
        if (!slotByTeamId.has(row.teamId)) {
          throw new BadRequestException(
            `Team ${row.teamId} is not active in this match`,
          );
        }
        if (!Number.isInteger(placement) || placement < 1) {
          throw new BadRequestException(
            `placement for team ${row.teamId} must be a positive integer`,
          );
        }
        if (placement > totalTeams) {
          throw new BadRequestException(
            `placement for team ${row.teamId} must be between 1 and ${totalTeams}`,
          );
        }
        if (!Number.isInteger(kills) || kills < 0) {
          throw new BadRequestException(
            `kills for team ${row.teamId} must be zero or greater`,
          );
        }
        if (placementSet.has(placement)) {
          throw new BadRequestException(`Duplicate placement ${placement}`);
        }
        placementSet.add(placement);
        return { teamId: row.teamId, placement, kills };
      });

      for (let placement = 1; placement <= totalTeams; placement += 1) {
        if (!placementSet.has(placement)) {
          throw new BadRequestException(`Placement ${placement} missing`);
        }
      }

      const playerOverrides: Array<{
        playerId: string;
        fields: Array<'alive' | 'knocked' | 'kills'>;
      }> = [];
      const teamOverrides: Array<{
        teamId: string;
        fields: Array<'eliminated' | 'placement' | 'totalKills'>;
      }> = [];
      let winnerTeamId: string | null = null;

      for (const row of normalizedRows) {
        const slot = slotByTeamId.get(row.teamId);
        if (!slot) continue;

        if (row.placement === 1) {
          winnerTeamId = row.teamId;
        }

        const eliminated = row.placement > 1;
        const eliminatedOrder = eliminated
          ? Math.max(1, totalTeams - row.placement + 1)
          : null;
        const nextPlayers = (slot.players ?? []).map((player) => ({
          ...player,
          isAlive: !eliminated,
          alive: !eliminated,
          isKnocked: false,
        }));
        const aggregates = this.computeSlotAggregates({
          slot: {
            ...slot,
            placement: row.placement,
            totalKills: row.kills,
            manualTotalKills: true,
            players: nextPlayers,
          },
          ruleset,
        });

        await tx.matchSlotResult.update({
          where: { id: slot.id },
          data: {
            placement: row.placement,
            placementAuto: false,
            eliminatedOrder,
            eliminatedAt: eliminated ? (slot.eliminatedAt ?? new Date()) : null,
            isLocked: eliminated,
            totalKills: row.kills,
            manualTotalKills: true,
            placementPoints: aggregates.placementPoints,
            points: aggregates.points,
            totalPoints: aggregates.totalPoints,
            wasPresentInMatch: true,
            ...(finalizedResults
              ? {
                  finalPlacement: row.placement,
                  finalKills: row.kills,
                  finalizedAt,
                }
              : {}),
          } as Prisma.MatchSlotResultUpdateInput,
        });

        for (const player of slot.players ?? []) {
          await tx.matchSlotPlayerResult.update({
            where: { id: player.id },
            data: {
              isAlive: !eliminated,
              alive: !eliminated,
              isKnocked: false,
            },
          });
          const playerKey =
            buildMatchPlayerKey({
              playerId: player.playerId ?? null,
              playerResultId: player.id,
            }) ?? player.id;
          playerOverrides.push({
            playerId: playerKey,
            fields: ['alive', 'knocked'],
          });
        }

        teamOverrides.push({
          teamId: row.teamId,
          fields: ['eliminated', 'placement', 'totalKills'],
        });
      }

      if (finalizedResults && winnerTeamId) {
        const currentControl = await tx.matchControlState.findUnique({
          where: { matchId },
          select: {
            organizationId: true,
            state: true,
            metaJson: true,
          },
        });
        const currentMeta =
          this.asJsonRecord(currentControl?.metaJson) ?? controlMeta ?? {};
        const nextMeta = {
          ...currentMeta,
          winnerTeamId,
          resultNeedsConfirmation: false,
        };
        await tx.matchControlState.upsert({
          where: { matchId },
          update: {
            metaJson: nextMeta as Prisma.InputJsonObject,
          },
          create: {
            matchId,
            organizationId: currentControl?.organizationId ?? organizationId,
            state: normalizeControlState(
              currentControl?.state ?? match.controlState?.state ?? 'READY',
            ),
            metaJson: nextMeta as Prisma.InputJsonObject,
          },
        });
      }

      return this.persistManualSyncOverrides(tx, {
        actor,
        matchId,
        organizationId,
        fallbackState: match.controlState?.state ?? 'READY',
        players: playerOverrides,
        teams: teamOverrides,
        source: 'MANUAL_FULL_RESULT',
      });
    });

    await this.recalculateMatchResults(matchId);
    if (!isSessionMatch(match)) {
      await this.standings.computeMatchStandings(matchId);
    }
    await this.publishManualMirrorFromResults(
      matchId,
      syncContract.version,
    ).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[MANUAL_FULL_RESULT] Failed to publish live mirror match=${matchId}: ${message}`,
      );
    });
    this.events.emitResultsUpdated(matchId, 0, {
      source: 'MANUAL_FULL_RESULT',
    });
    this.events.emitLeaderboardUpdated(matchId);

    return {
      ok: true,
      version: syncContract.version,
      updatedCount: rows.length,
    };
  }

  async ensureResultsEditableByMatchId(
    matchId: string,
    actor?: AuthUser | null,
    tx?: Tx,
    opts?: { allowUnlockEliminated?: boolean; allowReviveOnly?: boolean },
  ) {
    const client = tx ?? this.prisma;
    const match = await client.match.findUnique({
      where: { id: matchId, deletedAt: null },
      select: {
        sessionId: true,
        status: true,
        dataSource: true,
        dataMode: true,
        liveState: true,
        tournament: { select: { status: true, organizationId: true } },
        controlState: {
          select: {
            metaJson: true,
            state: true,
            resultsManualLock: true,
            resultsForceUnlock: true,
          },
        },
      },
    });
    const actorRole = actor?.actorRole ?? actor?.role ?? null;

    assertMatchWritable(match ?? null, {
      role: actorRole,
      override: actor?.override ?? false,
    });

    const lockState = deriveMatchLockContract({
      status: match?.status ?? null,
      liveState: match?.liveState ?? match?.controlState?.state ?? null,
      controlState: match?.controlState?.state ?? null,
      metaJson: match?.controlState?.metaJson ?? null,
      dataSource: match?.dataSource ?? null,
      dataMode: match?.dataMode ?? null,
      manualLock: match?.controlState?.resultsManualLock ?? null,
      forceUnlock: match?.controlState?.resultsForceUnlock ?? null,
    });
    if (lockState.lifecycleStatus === 'LIVE') {
      throw new ConflictException(
        'Results cannot be edited while the match is LIVE.',
      );
    }
    const manualSource = this.isManualSource(match ?? {});
    if (lockState.resultsLocked && !opts?.allowReviveOnly) {
      throw new ConflictException(lockState.reason ?? 'Results are locked.');
    }
    if (match?.controlState?.resultsManualLock && !opts?.allowReviveOnly) {
      throw new ConflictException('Results are locked by match control.');
    }
    const lockedSlot = await client.matchSlotResult.findFirst({
      where: { matchId, isLocked: true },
      select: { id: true },
    });
    if (lockedSlot && lockState.resultsLocked && !opts?.allowUnlockEliminated) {
      throw new ConflictException('Results are locked.');
    }
    const meta =
      match?.controlState?.metaJson &&
      typeof match.controlState.metaJson === 'object'
        ? (match.controlState.metaJson as { resultFinalized?: boolean })
        : null;
    const reopenedAfterFinalize =
      meta?.resultFinalized === true &&
      !manualSource &&
      match?.controlState?.resultsForceUnlock === true;
    if (meta?.resultFinalized && !manualSource && !reopenedAfterFinalize) {
      throw new BadRequestException('Results are finalized for this match.');
    }
    if (!opts?.allowReviveOnly && !manualSource && !reopenedAfterFinalize) {
      if (!isSessionMatch(match)) {
        const edit = await this.standings.canEditResults(matchId);
        const canBypassLocked =
          opts?.allowUnlockEliminated === true && edit.isFinal !== true;
        if (!edit.canEdit && !canBypassLocked) {
          throw new ConflictException('Results are locked for this match.');
        }
        if (edit.isFinal && opts?.allowUnlockEliminated) {
          throw new BadRequestException(
            'Results are finalized for this match.',
          );
        }
      }
    }
    if (match?.tournament?.status === TournamentStatus.ARCHIVED) {
      throw new BadRequestException('Tournament is not active');
    }
  }

  /**
   * Referee edits that rely on centralized ruleset-derived totals.
   */
  async refereeEditSlot(
    matchId: string,
    teamId: string,
    dto: { kills?: number; place?: number },
    actor?: AuthUser | null,
  ) {
    await this.ensureResultsEditableByMatchId(matchId, actor);

    const slot = await this.prisma.matchSlotResult.findFirst({
      where: { matchId, teamId },
      include: { players: true },
    });
    if (!slot) {
      throw new BadRequestException('Team is not assigned to this match');
    }

    const ruleset = await this.rulesetConfig(matchId);

    let placement = slot.placement ?? null;
    let totalKills = slot.totalKills ?? 0;
    let manualTotalKills =
      (slot as { manualTotalKills?: boolean }).manualTotalKills ?? false;

    if (dto.place !== undefined) {
      placement = dto.place ?? null;
    }
    if (dto.kills !== undefined) {
      totalKills = Math.max(0, dto.kills);
      manualTotalKills = true;
    }

    this.validateSlotState({
      placement,
      manualTotalKills,
      totalKills,
      players: slot.players ?? [],
    });

    const computed = this.computeSlotAggregates({
      slot: { ...slot, placement, totalKills, manualTotalKills },
      ruleset,
    });

    const updated = await this.prisma.matchSlotResult.update({
      where: { id: slot.id },
      data: {
        placement,
        placementPoints: computed.placementPoints,
        totalKills,
        manualTotalKills,
        points: computed.points,
        totalPoints: computed.totalPoints,
      },
    });

    return { before: slot, after: updated };
  }

  /**
   * Recompute slot totals (placement + kills + adjustments) without trusting client totals.
   */
  async recomputeSlotAfterAdjustment(
    matchId: string,
    teamId: string,
    actor?: AuthUser | null,
    opts: { enforceEditable?: boolean } = {},
  ) {
    if (opts.enforceEditable !== false) {
      await this.ensureResultsEditableByMatchId(matchId, actor);
    }

    const slot = await this.prisma.matchSlotResult.findFirst({
      where: { matchId, teamId },
      include: { players: true },
    });
    if (!slot) {
      throw new BadRequestException('Team is not assigned to this match');
    }

    const ruleset = await this.rulesetConfig(matchId);
    const manualTotalKills =
      (slot as { manualTotalKills?: boolean }).manualTotalKills ?? false;

    const computed = this.computeSlotAggregates({
      slot: { ...slot, manualTotalKills },
      ruleset,
    });

    const matchContext = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        tournamentId: true,
        stageId: true,
        groupId: true,
        sessionId: true,
      },
    });
    if (!matchContext) {
      throw new BadRequestException('Match not found');
    }

    const scopeFilters: Prisma.AdminAdjustmentWhereInput[] = [
      { matchId },
      ...(matchContext.groupId ? [{ groupId: matchContext.groupId }] : []),
      ...(matchContext.stageId ? [{ stageId: matchContext.stageId }] : []),
      ...(matchContext.tournamentId
        ? [{ tournamentId: matchContext.tournamentId }]
        : []),
      ...(matchContext.sessionId
        ? [{ sessionId: matchContext.sessionId }]
        : []),
    ];
    const adjustments = await this.prisma.adminAdjustment.findMany({
      where: {
        teamId,
        deletedAt: null,
        revokedAt: null,
        OR: scopeFilters,
      },
      select: {
        teamId: true,
        pointsDelta: true,
        scope: true,
        type: true,
        matchId: true,
        groupId: true,
        stageId: true,
        tournamentId: true,
        sessionId: true,
        deletedAt: true,
        revokedAt: true,
      },
    });
    const adjusted = applyMatchScoreAdjustments(
      computed.totalPoints,
      adjustments,
      matchContext,
    );

    const updated = await this.prisma.matchSlotResult.update({
      where: { id: slot.id },
      data: {
        placement: slot.placement,
        placementPoints: computed.placementPoints,
        totalKills: computed.totalKills,
        manualTotalKills,
        points: computed.points,
        totalPoints: adjusted.totalPoints,
      },
    });

    return {
      before: slot,
      after: updated,
      pointsDelta: adjusted.pointsDelta,
      zeroed: adjusted.zeroed,
      disqualified: adjusted.disqualified,
    };
  }

  async ensureMatch(
    actor: AuthUser | null | undefined,
    matchId: string,
  ): Promise<MatchSummary> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        organizationId: true,
        sessionId: true,
        map: true,
        status: true,
        liveState: true,
        dataSource: true,
        dataMode: true,
        endedAt: true,
        game: { select: { key: true } },
        tournamentId: true,
        stageId: true,
        groupId: true,
        tournament: {
          select: {
            ownerUserId: true,
            organizationId: true,
            status: true,
          },
        },
        controlState: {
          select: {
            state: true,
            authorityMode: true,
            metaJson: true,
            resultsManualLock: true,
            resultsForceUnlock: true,
          },
        },
      },
    });
    if (!match) {
      throw new NotFoundException('Match not found');
    }
    const context = getMatchContext(match);
    if (context.type === 'SESSION') {
      requireOrgMatch(actor ?? null, match.organizationId ?? null);
    } else {
      if (!match.tournamentId || !match.tournament) {
        throw new BadRequestException('Match tournament context is missing');
      }
      if (match.tournament.organizationId) {
        requireOrgMatch(actor ?? null, match.tournament.organizationId);
      }
      if (
        !this.canEdit(
          actor,
          match.tournament.ownerUserId,
          match.tournament.organizationId ?? null,
        )
      ) {
        throw new ForbiddenException('Not allowed to access match');
      }
      if (match.tournament.status === TournamentStatus.ARCHIVED) {
        throw new BadRequestException('Tournament is not active');
      }
    }
    return {
      id: match.id,
      organizationId: match.organizationId ?? null,
      sessionId: match.sessionId ?? null,
      map: (match as { map?: string | null }).map ?? null,
      status: match.status,
      liveState:
        (match as { liveState?: string | null }).liveState ??
        match.controlState?.state ??
        null,
      endedAt: (match as { endedAt?: Date | null }).endedAt ?? null,
      gameKey: match.game?.key ?? null,
      dataSource: match.dataSource ?? null,
      dataMode: match.dataMode ?? null,
      controlState: match.controlState ?? null,
      resultLockState: this.lockStateFromMatch(match),
      tournamentId: match.tournamentId ?? null,
      tournament: match.tournament
        ? {
            ownerUserId: match.tournament.ownerUserId,
            organizationId: match.tournament.organizationId,
          }
        : null,
    };
  }

  ensureRound(match: MatchSummary, roundIndex: number) {
    if (!Number.isInteger(roundIndex) || roundIndex < 1) {
      throw new BadRequestException('roundIndex must be at least 1');
    }
    if (roundIndex !== 1) {
      throw new BadRequestException('V1 results only support a single round.');
    }
    return {
      id: match.id,
      matchId: match.id,
      roundIndex: 1,
    };
  }

  listRounds(matchId: string) {
    return [{ id: matchId, matchId, roundIndex: 1 }];
  }

  private normalizeSlotPlayers(
    players: Array<{
      id: string;
      playerId?: string | null;
      playerName?: string | null;
      kills?: number | null;
      assists?: number | null;
      organizationId?: string | null;
      isKnocked?: boolean | null;
      isAlive?: boolean | null;
      player?: {
        externalPlayerId?: string | null;
        ign?: string | null;
        inGameId?: string | null;
        photoUrl?: string | null;
        realName?: string | null;
        updatedAt?: Date | null;
      } | null;
    }>,
  ) {
    return (players ?? []).map((p) => ({
      ...p,
      playerId: buildMatchPlayerKey({
        playerId: p.playerId ?? null,
        playerResultId: p.id,
      }),
      // Preserve backend truth for alive/knocked flags; avoid re‑defaulting them here.
      isKnocked: (p as { isKnocked?: boolean }).isKnocked ?? null,
      isAlive: (p as { isAlive?: boolean }).isAlive ?? null,
      // Mirror only; do not consume .alive elsewhere.
      alive: (p as { isAlive?: boolean }).isAlive ?? null,
      externalPlayerId: p.player?.externalPlayerId ?? null,
      name: p.player?.ign ?? p.player?.realName ?? p.playerName ?? null,
      photoUrl: p.player?.photoUrl ?? null,
      photoUpdatedAt: p.player?.updatedAt ?? null,
      playerUpdatedAt: p.player?.updatedAt ?? null,
      organizationId: p.organizationId,
    }));
  }

  private async fetchSlotResults(matchId: string) {
    const telemetryReadContext = await this.syncLiveTelemetryResults(matchId);
    const suppressPreTelemetryPlayers =
      this.shouldSuppressPreTelemetryPlayers(telemetryReadContext);
    const slotResults = await this.prisma.matchSlotResult.findMany({
      where: { matchId },
      orderBy: { slotNumber: 'asc' },
      include: {
        team: {
          select: {
            id: true,
            name: true,
            tag: true,
            logoUrl: true,
            updatedAt: true,
          },
        },
        players: {
          select: {
            id: true,
            slotResultId: true,
            createdAt: true,
            playerId: true,
            playerName: true,
            kills: true,
            knocks: true,
            assists: true,
            isKnocked: true,
            isAlive: true,
            alive: true,
            isAutoFilled: true,
            updatedAt: true,
            organizationId: true,
            player: {
              select: {
                externalPlayerId: true,
                ign: true,
                inGameId: true,
                photoUrl: true,
                realName: true,
                updatedAt: true,
              },
            },
          },
          orderBy: { playerName: 'asc' },
        } as any,
      },
    });
    return slotResults
      .map((sr) => {
        const wasPresentInMatch = sr.wasPresentInMatch ?? null;
        const isCompetitiveTeam = isCompetitiveResultsTeam(wasPresentInMatch);
        const branding = resolveTeamBranding(sr.teamId, [
          { teamId: sr.teamId, team: sr.team ?? null, slot: sr.slotNumber },
        ]);
        const normalizedPlayers =
          suppressPreTelemetryPlayers && !isPresentInMatch(wasPresentInMatch)
            ? []
            : this.normalizeSlotPlayers(sr.players);
        return {
          ...sr,
          wasPresentInMatch,
          presenceStatus: derivePresenceStatus(wasPresentInMatch),
          placement: isCompetitiveTeam ? (sr.placement ?? null) : null,
          totalKills: isCompetitiveTeam ? (sr.totalKills ?? 0) : 0,
          points: isCompetitiveTeam ? (sr.points ?? 0) : 0,
          totalPoints: isCompetitiveTeam ? (sr.totalPoints ?? 0) : 0,
          finalPlacement: isCompetitiveTeam
            ? ((sr as { finalPlacement?: number | null }).finalPlacement ??
              null)
            : null,
          finalKills: isCompetitiveTeam
            ? ((sr as { finalKills?: number | null }).finalKills ?? null)
            : 0,
          team:
            sr.team ??
            (sr.teamId
              ? {
                  id: sr.teamId,
                  name: branding.name,
                  tag: branding.tag,
                  logoUrl: branding.logoUrl,
                  updatedAt: null,
                }
              : null),
          players: normalizedPlayers.map((player) => ({
            ...player,
            kills: isCompetitiveTeam ? (player.kills ?? 0) : 0,
            isAlive: isCompetitiveTeam ? (player.isAlive ?? null) : null,
            alive: isCompetitiveTeam ? (player.alive ?? null) : null,
            isKnocked: isCompetitiveTeam ? (player.isKnocked ?? null) : null,
          })),
        };
      })
      .sort((left, right) => {
        const presenceOrder = comparePresenceStatus(
          left.wasPresentInMatch,
          right.wasPresentInMatch,
        );
        if (presenceOrder !== 0) {
          return presenceOrder;
        }

        if (
          isCompetitiveResultsTeam(left.wasPresentInMatch) &&
          isCompetitiveResultsTeam(right.wasPresentInMatch)
        ) {
          const leftPlacement = left.placement ?? Number.POSITIVE_INFINITY;
          const rightPlacement = right.placement ?? Number.POSITIVE_INFINITY;
          if (leftPlacement !== rightPlacement) {
            return leftPlacement - rightPlacement;
          }

          const leftPoints = left.totalPoints ?? Number.NEGATIVE_INFINITY;
          const rightPoints = right.totalPoints ?? Number.NEGATIVE_INFINITY;
          if (rightPoints !== leftPoints) {
            return rightPoints - leftPoints;
          }

          const leftKills = left.totalKills ?? Number.NEGATIVE_INFINITY;
          const rightKills = right.totalKills ?? Number.NEGATIVE_INFINITY;
          if (rightKills !== leftKills) {
            return rightKills - leftKills;
          }
        }

        return left.slotNumber - right.slotNumber;
      });
  }

  private hasAcceptedTelemetryState(state: TelemetryMatchState): boolean {
    if (
      typeof state.telemetryAcceptedAt === 'number' &&
      Number.isFinite(state.telemetryAcceptedAt)
    ) {
      return true;
    }
    return Object.values(state.players).some(
      (player) => player.metadata?.observedInTelemetry === true,
    );
  }

  private isEarlyAirPhase(state: TelemetryMatchState): boolean {
    const phase =
      typeof state.circle?.phase === 'number' &&
      Number.isFinite(state.circle.phase)
        ? Math.trunc(state.circle.phase)
        : null;
    return phase !== null && phase < 2;
  }

  private async loadLiveTelemetryResultsReadContext(
    matchId: string,
    providedTelemetryState: TelemetryMatchState | null = null,
  ): Promise<LiveTelemetryResultsReadContext | null> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        status: true,
        liveState: true,
        dataSource: true,
        dataMode: true,
        controlState: {
          select: {
            state: true,
            metaJson: true,
            resultsManualLock: true,
            resultsForceUnlock: true,
          },
        },
      },
    });
    if (!match) {
      return null;
    }

    const lifecycleStatus = deriveCanonicalMatchLifecycleStatus({
      status: match.status ?? null,
      liveState: match.liveState ?? match.controlState?.state ?? null,
      controlState: match.controlState?.state ?? null,
      metaJson: match.controlState?.metaJson ?? null,
    });
    const isManualSource = this.isManualSource({
      dataSource: match.dataSource ?? null,
      dataMode: match.dataMode ?? null,
    });
    const resultsManualLock = match.controlState?.resultsManualLock === true;
    const resultsForceUnlock = match.controlState?.resultsForceUnlock === true;

    if (
      !this.telemetryEngine ||
      lifecycleStatus !== 'LIVE' ||
      isManualSource ||
      resultsManualLock
    ) {
      return {
        lifecycleStatus,
        isManualSource,
        resultsManualLock,
        resultsForceUnlock,
        telemetryState: null,
        hasAcceptedTelemetry: false,
        isEarlyAirPhase: false,
      };
    }

    const telemetryState =
      providedTelemetryState ??
      (await this.telemetryEngine.getState(matchId).catch(() => null));
    const hasAcceptedTelemetry = telemetryState
      ? this.hasAcceptedTelemetryState(telemetryState)
      : false;
    const isEarlyAirPhase = telemetryState
      ? this.isEarlyAirPhase(telemetryState)
      : false;

    return {
      lifecycleStatus,
      isManualSource,
      resultsManualLock,
      resultsForceUnlock,
      telemetryState,
      hasAcceptedTelemetry,
      isEarlyAirPhase,
    };
  }

  private shouldSuppressPreTelemetryPlayers(
    context: LiveTelemetryResultsReadContext | null,
  ): boolean {
    if (!context) {
      return false;
    }
    if (context.lifecycleStatus !== 'LIVE' || context.isManualSource) {
      return false;
    }
    if (context.resultsManualLock || context.resultsForceUnlock) {
      return false;
    }
    return !context.hasAcceptedTelemetry || context.isEarlyAirPhase;
  }

  private async syncLiveTelemetryResults(
    matchId: string,
  ): Promise<LiveTelemetryResultsReadContext | null> {
    try {
      const context = await this.loadLiveTelemetryResultsReadContext(matchId);
      if (!context) {
        return null;
      }
      if (
        context.lifecycleStatus !== 'LIVE' ||
        context.isManualSource ||
        context.resultsManualLock ||
        !context.telemetryState ||
        !context.hasAcceptedTelemetry ||
        context.isEarlyAirPhase
      ) {
        return context;
      }

      await this.syncAcceptedLiveTelemetryProjection(context.telemetryState, {
        force: true,
        context,
        source: 'RESULTS_READ',
      });
      return context;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        JSON.stringify({
          stage: 'results-service',
          action: 'live-telemetry-results-sync-failed',
          matchId,
          message,
        }),
      );
      return null;
    }
  }

  async syncLiveTelemetryResultsForRead(matchId: string): Promise<void> {
    await this.syncLiveTelemetryResults(matchId);
  }

  async syncAcceptedLiveTelemetryProjection(
    state: TelemetryMatchState,
    opts: {
      force?: boolean;
      source?: 'RESULTS_READ' | 'TELEMETRY_PIPELINE';
      context?: LiveTelemetryResultsReadContext | null;
    } = {},
  ): Promise<boolean> {
    if (!state?.matchId) {
      return false;
    }

    const context =
      opts.context ??
      (await this.loadLiveTelemetryResultsReadContext(state.matchId, state));
    if (
      !context ||
      context.lifecycleStatus !== 'LIVE' ||
      context.isManualSource ||
      context.resultsManualLock ||
      !context.telemetryState ||
      !context.hasAcceptedTelemetry ||
      context.isEarlyAirPhase
    ) {
      return false;
    }

    const matchId = context.telemetryState.matchId;
    const currentVersion =
      typeof context.telemetryState.version === 'number' &&
      Number.isFinite(context.telemetryState.version)
        ? Math.trunc(context.telemetryState.version)
        : 0;
    const currentUpdatedAt =
      typeof context.telemetryState.updatedAt === 'number' &&
      Number.isFinite(context.telemetryState.updatedAt)
        ? Math.trunc(context.telemetryState.updatedAt)
        : Date.now();
    const existing = this.liveTelemetryProjectionSync.get(matchId) ?? null;
    const now = Date.now();
    const minSyncIntervalMs = opts.force ? 0 : 3_000;

    if (
      !opts.force &&
      existing &&
      currentVersion <= existing.version &&
      currentUpdatedAt <= existing.updatedAt
    ) {
      return false;
    }
    if (
      !opts.force &&
      existing &&
      now - existing.syncedAt < minSyncIntervalMs
    ) {
      return false;
    }

    const inFlight = this.liveTelemetryProjectionSyncInFlight.get(matchId);
    if (inFlight) {
      return inFlight;
    }

    const syncPromise = (async () => {
      try {
        await this.applyTelemetryStateToResults(matchId, {
          state: context.telemetryState ?? state,
        });
        await this.recalculateMatchResults(matchId);
        this.liveTelemetryProjectionSync.set(matchId, {
          version: currentVersion,
          updatedAt: currentUpdatedAt,
          syncedAt: Date.now(),
        });
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          JSON.stringify({
            stage: 'results-service',
            action: 'live-telemetry-results-sync-failed',
            matchId,
            source: opts.source ?? 'TELEMETRY_PIPELINE',
            message,
          }),
        );
        return false;
      }
    })();

    this.liveTelemetryProjectionSyncInFlight.set(matchId, syncPromise);
    try {
      return await syncPromise;
    } finally {
      if (
        this.liveTelemetryProjectionSyncInFlight.get(matchId) === syncPromise
      ) {
        this.liveTelemetryProjectionSyncInFlight.delete(matchId);
      }
    }
  }

  private defaultBrPlacement(gameKey?: GameKey | null): Record<number, number> {
    return defaultPlacementPointsForGame(gameKey);
  }

  private defaultKillPoints(gameKey?: GameKey | null): number {
    return defaultKillPointsForGame(gameKey);
  }

  private async rulesetConfig(matchId: string): Promise<{
    placementPoints: Record<number, number>;
    killPoints: number;
    rulesetId: string | null;
    gameKey: GameKey | null;
  }> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        rulesetId: true,
        game: { select: { key: true } },
        tournament: { select: { rulesetId: true, game: true } },
      },
    });
    const gameKey =
      match?.game?.key ?? match?.tournament?.game ?? GameKey.PUBG_MOBILE;

    const loadRuleset = async (id?: string | null) =>
      id
        ? await this.prisma.ruleset.findUnique({
            where: { id },
            select: { id: true, config: true },
          })
        : null;

    const rs =
      (await loadRuleset(match?.rulesetId)) ??
      (await loadRuleset(match?.tournament?.rulesetId)) ??
      (await this.prisma.ruleset.findFirst({
        where: { gameKey: gameKey ?? GameKey.PUBG_MOBILE, isDefault: true },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, config: true },
      }));

    const config =
      rs?.config && typeof rs.config === 'object' ? (rs.config as any) : {};
    const placementPoints =
      config.placementPoints && typeof config.placementPoints === 'object'
        ? (config.placementPoints as Record<number, number>)
        : this.defaultBrPlacement(gameKey);
    const killPoints =
      typeof config.killPoints === 'number'
        ? config.killPoints
        : this.defaultKillPoints(gameKey);

    return {
      placementPoints,
      killPoints,
      rulesetId: rs?.id ?? null,
      gameKey,
    };
  }

  private async updateEliminationState(matchId: string) {
    await this.recalcPlacements(matchId);
  }

  private async assertSlotUnlocked(
    matchId: string,
    slotResultId?: string | null,
  ) {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        controlState: {
          select: { resultsManualLock: true, resultsForceUnlock: true },
        },
      },
    });
    if (match?.controlState?.resultsManualLock) {
      throw new ConflictException('Results are locked by match control.');
    }
    if (slotResultId) {
      const sr = await this.prisma.matchSlotResult.findUnique({
        where: { id: slotResultId },
        select: { isLocked: true },
      });
      if (sr?.isLocked) {
        throw new ConflictException('Slot is locked.');
      }
    }
  }

  private async auditEdit(opts: {
    actor: AuthUser;
    organizationId: string | null;
    entityType: string;
    entityId: string;
    before: any;
    after: any;
    source?: 'MANUAL' | 'EXCEL' | 'SYSTEM';
  }) {
    const { actor, organizationId, entityId, entityType, before, after } = opts;
    try {
      await this.audit.log({
        action: AuditAction.MATCH_RESULT_EDIT,
        entityType,
        entityId,
        organizationId: organizationId ?? null,
        userId: actor.actorId ?? actor.id,
        before,
        after,
        source: opts.source ?? 'MANUAL',
      });
    } catch (err) {
      this.logger.warn(
        `Audit log failed for ${entityType}:${entityId}: ${String(err)}`,
      );
    }
  }

  private resolveMatchOrganizationId(
    match: {
      organizationId?: string | null;
      tournament?: { organizationId?: string | null } | null;
    },
    actor?: AuthUser | null,
  ): string | null {
    return (
      match.organizationId ??
      match.tournament?.organizationId ??
      actor?.organizationId ??
      actor?.actingOrgId ??
      null
    );
  }

  private computeSlotAggregates(params: {
    slot: Prisma.MatchSlotResultGetPayload<{
      include: { players: true };
    }>;
    ruleset: { placementPoints: Record<number, number>; killPoints: number };
  }) {
    const { slot, ruleset } = params;
    if (
      !isPresentInMatch(
        (slot as { wasPresentInMatch?: boolean | null }).wasPresentInMatch,
      )
    ) {
      return {
        placementPoints: 0,
        totalKills: 0,
        killPoints: 0,
        points: 0,
        totalPoints: 0,
      };
    }
    const manual = (slot as { manualTotalKills?: boolean }).manualTotalKills;
    return computeSlotTotals({
      placement: slot.placement ?? null,
      players: slot.players ?? [],
      manualTotalKills: manual,
      slotTotalKills: slot.totalKills ?? null,
      placementTable: ruleset.placementPoints,
      killPointsMultiplier: ruleset.killPoints ?? 1,
    });
  }

  private async recalcPlacements(matchId: string) {
    const ruleset = await this.rulesetConfig(matchId);
    const slots = await this.prisma.matchSlotResult.findMany({
      where: { matchId, teamId: { not: null } },
      include: { players: true },
      orderBy: { slotNumber: 'asc' },
    });

    const canonical = this.buildCanonicalSlotResolution(
      slots,
      new Map(),
      new Date(),
    );
    const canonicalByTeamId = new Map(
      canonical.teams.map((team) => [team.teamId, team] as const),
    );

    for (const slot of slots) {
      const state = canonicalByTeamId.get(slot.teamId as string);
      if (!state) {
        await this.prisma.matchSlotResult.update({
          where: { id: slot.id },
          data: {
            placement: null,
            finalPlacement: null,
            eliminatedOrder: null,
            eliminatedAt: null,
            isLocked: false,
            totalKills: 0,
            finalKills: 0,
            manualTotalKills: false,
            placementPoints: 0,
            points: 0,
            totalPoints: 0,
          },
        });
        continue;
      }

      const aggregates = this.computeSlotAggregates({
        slot: {
          ...slot,
          placement: state.placement,
          totalKills: state.teamKills,
          manualTotalKills:
            (slot as { manualTotalKills?: boolean | null }).manualTotalKills ??
            false,
        },
        ruleset,
      });

      await this.prisma.matchSlotResult.update({
        where: { id: slot.id },
        data: {
          placement: state.placement,
          eliminatedOrder: state.eliminated ? state.eliminatedOrder : null,
          eliminatedAt: state.eliminated ? state.eliminatedAt : null,
          isLocked: state.eliminated,
          totalKills: state.teamKills,
          manualTotalKills:
            (slot as { manualTotalKills?: boolean | null }).manualTotalKills ??
            false,
          placementPoints: aggregates.placementPoints,
          points: aggregates.points,
          totalPoints: aggregates.totalPoints,
        },
      });
    }
  }

  async recomputeSlotResult(
    matchId: string,
    slotNumber: number,
    opts: { tx?: Tx } = {},
  ) {
    const client = opts.tx ?? this.prisma;
    await this.ensureResultsFromSlots(matchId, { tx: client });
    const ruleset = await this.rulesetConfig(matchId);
    const slot = await client.matchSlotResult.findUnique({
      where: { matchId_slotNumber: { matchId, slotNumber } },
      include: { players: true },
    });
    if (!slot) throw new NotFoundException('Slot result not found');
    const computed = this.computeSlotAggregates({ slot, ruleset });
    const isPresent = isPresentInMatch(
      (slot as { wasPresentInMatch?: boolean | null }).wasPresentInMatch,
    );
    const updated = await client.matchSlotResult.update({
      where: { id: slot.id },
      data: {
        placement: isPresent ? (slot.placement ?? null) : null,
        finalPlacement: isPresent
          ? ((slot as { finalPlacement?: number | null }).finalPlacement ??
            null)
          : null,
        placementPoints: computed.placementPoints,
        totalKills: computed.totalKills,
        finalKills: isPresent
          ? ((slot as { finalKills?: number | null }).finalKills ?? null)
          : 0,
        points: computed.points,
        totalPoints: computed.totalPoints,
        manualTotalKills: isPresent
          ? ((slot as { manualTotalKills?: boolean | null }).manualTotalKills ??
            false)
          : false,
      } as any,
      include: {
        players: true,
        team: { select: { id: true, name: true, tag: true, logoUrl: true } },
      },
    });
    return updated;
  }

  async recomputeAllSlots(
    matchId: string,
    opts: { tx?: Tx; emitEvents?: boolean } = {},
  ) {
    const client = opts.tx ?? this.prisma;
    const slots = await client.matchSlotResult.findMany({
      where: { matchId },
      select: { slotNumber: true },
    });
    for (const sr of slots) {
      await this.recomputeSlotResult(matchId, sr.slotNumber, { tx: opts.tx });
    }
    if (opts.emitEvents !== false) {
      this.events.emitResultsUpdated(matchId, 0, { source: 'RECALC' });
      this.events.emitLeaderboardUpdated(matchId);
    }
  }

  async applyTelemetryStateToResults(
    matchId: string,
    opts: {
      tx?: Tx;
      finalize?: boolean;
      state?: TelemetryMatchState;
      finalProjection?: TelemetryFinalPlacementProjection | null;
    } = {},
  ) {
    const state = opts.state ?? (await this.telemetryEngine.getState(matchId));
    const client = opts.tx ?? this.prisma;
    const finalizedAt = new Date(state.endedAt ?? state.updatedAt);

    await this.ensureResultsFromSlots(matchId, { tx: client });

    const slotResults = await client.matchSlotResult.findMany({
      where: { matchId },
      select: {
        id: true,
        slotNumber: true,
        teamId: true,
        placement: true,
        manualTotalKills: true,
        wasPresentInMatch: true,
        organizationId: true,
        team: {
          select: {
            players: {
              where: { deletedAt: null },
              select: {
                id: true,
                ign: true,
                realName: true,
                externalPlayerId: true,
                playerOpenId: true,
              },
            },
          },
        },
        players: {
          select: {
            id: true,
            playerId: true,
            playerName: true,
            pubgAccountId: true,
            externalPlayerId: true,
            kills: true,
            assists: true,
            isAlive: true,
            alive: true,
            isKnocked: true,
          },
        },
      },
    });

    const slotResultIds = slotResults.map((slot) => slot.id);
    const slotPlayerById = new Map<
      string,
      (typeof slotResults)[number]['players'][number]
    >();
    const slotPlayerByPlayerId = new Map<
      string,
      (typeof slotResults)[number]['players'][number]
    >();
    const slotPlayerByExternalPlayerId = new Map<
      string,
      (typeof slotResults)[number]['players'][number]
    >();
    const slotPlayerByPubgAccountId = new Map<
      string,
      (typeof slotResults)[number]['players'][number]
    >();
    const slotPlayerByName = new Map<
      string,
      (typeof slotResults)[number]['players'][number] | null
    >();

    const registerSlotPlayerLookups = (
      slotResultId: string,
      player: (typeof slotResults)[number]['players'][number],
    ) => {
      slotPlayerById.set(player.id, player);
      if (player.playerId) {
        slotPlayerByPlayerId.set(player.playerId, player);
      }
      const externalPlayerKey = this.buildScopedPlayerLookupKey(
        slotResultId,
        player.externalPlayerId ?? null,
      );
      if (externalPlayerKey) {
        slotPlayerByExternalPlayerId.set(externalPlayerKey, player);
      }
      const pubgAccountKey = this.buildScopedPlayerLookupKey(
        slotResultId,
        player.pubgAccountId ?? null,
      );
      if (pubgAccountKey) {
        slotPlayerByPubgAccountId.set(pubgAccountKey, player);
      }
      const playerNameKey = this.buildScopedPlayerLookupKey(
        slotResultId,
        player.playerName,
      );
      if (!playerNameKey) {
        return;
      }
      const existingByName = slotPlayerByName.get(playerNameKey);
      if (existingByName && existingByName.id !== player.id) {
        slotPlayerByName.set(playerNameKey, null);
        return;
      }
      if (!slotPlayerByName.has(playerNameKey)) {
        slotPlayerByName.set(playerNameKey, player);
      }
    };

    for (const slot of slotResults) {
      for (const player of slot.players) {
        registerSlotPlayerLookups(slot.id, player);
      }
    }

    const hasExplicitPresence = this.hasExplicitTelemetryPresence(state);
    const activeTeamIds = hasExplicitPresence
      ? this.collectActiveTelemetryTeamIds(state)
      : new Set(Object.values(state.players).map((player) => player.teamId));
    const observedOnly = hasExplicitPresence;
    const playersByTeamId = this.collectTelemetryPlayersByTeam(state, {
      observedOnly,
    });
    const totalTelemetryTeams = hasExplicitPresence
      ? Math.max(activeTeamIds.size, 1)
      : Math.max(Object.keys(state.teams).length, 1);

    const keepSlotPlayerIds = new Set<string>();
    for (const slotResult of slotResults) {
      const teamId = slotResult.teamId ?? null;
      if (!teamId) {
        continue;
      }
      const team = state.teams[teamId] ?? null;
      const isActive = activeTeamIds.has(teamId);
      if (hasExplicitPresence && !isActive) {
        if (opts.finalize === true && slotResult.wasPresentInMatch === true) {
          await client.matchSlotResult.update({
            where: { id: slotResult.id },
            data: {
              teamId,
              wasPresentInMatch: true,
              isLocked: true,
            },
          });
          continue;
        }
        await client.matchSlotPlayerResult.deleteMany({
          where: { slotResultId: slotResult.id },
        });
        await client.matchSlotResult.update({
          where: { id: slotResult.id },
          data: {
            teamId,
            wasPresentInMatch: false,
            placement: null,
            eliminatedOrder: null,
            eliminatedAt: null,
            totalKills: 0,
            manualTotalKills: false,
            isLocked: opts.finalize === true,
            finalPlacement: null,
            finalKills: opts.finalize === true ? 0 : null,
            finalizedAt: opts.finalize === true ? finalizedAt : null,
          },
        });
        continue;
      }
      if (!team) {
        if (opts.finalize === true && slotResult.wasPresentInMatch === true) {
          await client.matchSlotResult.update({
            where: { id: slotResult.id },
            data: {
              teamId,
              wasPresentInMatch: true,
              isLocked: true,
            },
          });
        } else {
          await client.matchSlotPlayerResult.deleteMany({
            where: { slotResultId: slotResult.id },
          });
        }
        continue;
      }

      const projectedTeam = opts.finalProjection?.teams[teamId] ?? null;
      const existingPlacement =
        typeof slotResult.placement === 'number' &&
        Number.isFinite(slotResult.placement)
          ? Math.trunc(slotResult.placement)
          : null;
      const placement =
        (opts.finalize === true
          ? (projectedTeam?.placement ?? existingPlacement ?? team.placement)
          : (projectedTeam?.placement ?? team.placement)) ?? null;
      const eliminatedOrder =
        opts.finalize === true && placement !== null
          ? placement > 1
            ? Math.max(
                (opts.finalProjection?.totalTeams ?? totalTelemetryTeams) -
                  placement +
                  1,
                1,
              )
            : null
          : (projectedTeam?.eliminatedOrder ??
            (team.eliminated &&
            typeof team.placement === 'number' &&
            team.placement > 1
              ? Math.max(totalTelemetryTeams - team.placement + 1, 1)
              : null));
      const eliminatedAt =
        projectedTeam?.eliminatedAt ?? team.eliminatedAt ?? null;
      const totalKills = projectedTeam?.totalKills ?? team.totalKills;
      const teamPlayers = (playersByTeamId.get(teamId) ?? []).sort(
        (left, right) => left.playerId.localeCompare(right.playerId),
      );
      const materializedTeamPlayers = teamPlayers.map((player, index) => {
        const stablePlayerId = this.stableTelemetryPlayerId(player);
        const telemetryExternalPlayerId =
          this.telemetryPlayerExternalId(player);
        const telemetryPubgAccountId =
          this.telemetryPlayerPubgAccountId(player);
        return {
          player,
          stablePlayerId,
          telemetryExternalPlayerId,
          telemetryPubgAccountId,
          playerNameSeed:
            player.metadata?.playerName?.trim() || player.playerId || 'Player',
          nameStableId:
            stablePlayerId ??
            telemetryExternalPlayerId ??
            telemetryPubgAccountId ??
            `telemetry:${index}`,
        };
      });
      const uniqueTeamPlayerNames = uniqueSlotPlayerNames(
        materializedTeamPlayers.map((entry) => ({
          playerName: entry.playerNameSeed,
          stableId: entry.nameStableId,
        })),
      );
      const useFinalizedPlayerFallback =
        opts.finalize === true && materializedTeamPlayers.length === 0;
      const useLivePlayerFallback =
        opts.finalize !== true &&
        materializedTeamPlayers.length === 0 &&
        isPresentInMatch(slotResult.wasPresentInMatch) &&
        (slotResult.players ?? []).length > 0;
      const preserveTeamTotalKills =
        useFinalizedPlayerFallback && totalKills > 0;

      await client.matchSlotResult.update({
        where: { id: slotResult.id },
        data: {
          teamId,
          wasPresentInMatch: hasExplicitPresence ? true : null,
          placement,
          eliminatedOrder,
          eliminatedAt: eliminatedAt ? new Date(eliminatedAt) : null,
          totalKills,
          manualTotalKills: preserveTeamTotalKills
            ? true
            : (slotResult.manualTotalKills ?? false),
          isLocked: opts.finalize === true ? true : team.eliminated,
          finalPlacement: opts.finalize === true ? placement : null,
          finalKills: opts.finalize === true ? totalKills : null,
          finalizedAt: opts.finalize === true ? finalizedAt : null,
        },
      });

      for (const [playerIndex, entry] of materializedTeamPlayers.entries()) {
        const { player, stablePlayerId } = entry;
        const playerName = uniqueTeamPlayerNames[playerIndex];
        const telemetryExternalPlayerId = entry.telemetryExternalPlayerId;
        const telemetryPubgAccountId = entry.telemetryPubgAccountId;
        const telemetryExternalPlayerKey = this.buildScopedPlayerLookupKey(
          slotResult.id,
          telemetryExternalPlayerId,
        );
        const telemetryPubgAccountKey = this.buildScopedPlayerLookupKey(
          slotResult.id,
          telemetryPubgAccountId,
        );
        const playerNameKey = this.buildScopedPlayerLookupKey(
          slotResult.id,
          playerName,
        );
        const existing =
          (player.metadata?.slotPlayerResultId
            ? slotPlayerById.get(player.metadata.slotPlayerResultId)
            : null) ??
          (stablePlayerId ? slotPlayerByPlayerId.get(stablePlayerId) : null) ??
          (telemetryExternalPlayerKey
            ? slotPlayerByExternalPlayerId.get(telemetryExternalPlayerKey)
            : null) ??
          (telemetryPubgAccountKey
            ? slotPlayerByPubgAccountId.get(telemetryPubgAccountKey)
            : null) ??
          (playerNameKey ? slotPlayerByName.get(playerNameKey) : null) ??
          null;
        const nextPubgAccountId =
          existing?.pubgAccountId ?? telemetryPubgAccountId ?? null;
        const nextExternalPlayerId =
          existing?.externalPlayerId ??
          telemetryExternalPlayerId ??
          telemetryPubgAccountId ??
          null;

        if (existing) {
          keepSlotPlayerIds.add(existing.id);
          await client.matchSlotPlayerResult.update({
            where: { id: existing.id },
            data: {
              playerId: existing.playerId ?? null,
              playerName,
              pubgAccountId: nextPubgAccountId,
              externalPlayerId: nextExternalPlayerId,
              kills: player.kills,
              assists: player.assists,
              isAlive: opts.finalize === true ? false : player.alive,
              alive: opts.finalize === true ? false : player.alive,
              isKnocked: opts.finalize === true ? false : player.knocked,
              isAutoFilled: false,
            },
          });
          continue;
        }

        const created = await client.matchSlotPlayerResult.create({
          data: {
            slotResultId: slotResult.id,
            organizationId: slotResult.organizationId,
            playerName,
            pubgAccountId: nextPubgAccountId,
            externalPlayerId: nextExternalPlayerId,
            kills: player.kills,
            assists: player.assists,
            knocks: 0,
            isKnocked: opts.finalize === true ? false : player.knocked,
            isAlive: opts.finalize === true ? false : player.alive,
            alive: opts.finalize === true ? false : player.alive,
            isAutoFilled: false,
          },
          select: { id: true },
        });
        keepSlotPlayerIds.add(created.id);
      }

      if (useLivePlayerFallback) {
        // Keep current-run player rows stable when live telemetry is only
        // providing team aggregates and cannot yet rematerialize players.
        for (const existing of slotResult.players ?? []) {
          keepSlotPlayerIds.add(existing.id);
        }
        continue;
      }

      if (!useFinalizedPlayerFallback) {
        continue;
      }

      // Finalized matches must retain a stable player result set even when the
      // last accepted telemetry state only contains team aggregates.
      if ((slotResult.players ?? []).length > 0) {
        for (const existing of slotResult.players) {
          keepSlotPlayerIds.add(existing.id);
          await client.matchSlotPlayerResult.update({
            where: { id: existing.id },
            data: {
              kills: Math.max(0, existing.kills ?? 0),
              assists: Math.max(0, existing.assists ?? 0),
              isAlive: false,
              alive: false,
              isKnocked: false,
              isAutoFilled: false,
            },
          });
        }
        continue;
      }

      const fallbackRosterPlayers = (slotResult.team?.players ?? []).slice(
        0,
        4,
      );
      const fallbackPlayerNames = uniqueSlotPlayerNames(
        fallbackRosterPlayers.map((rosterPlayer) => ({
          playerName:
            rosterPlayer.ign?.trim() ||
            rosterPlayer.realName?.trim() ||
            'Player',
          stableId: rosterPlayer.id,
        })),
      );
      for (const [
        rosterIndex,
        rosterPlayer,
      ] of fallbackRosterPlayers.entries()) {
        const playerName = fallbackPlayerNames[rosterIndex];
        const created = await client.matchSlotPlayerResult.create({
          data: {
            slotResultId: slotResult.id,
            organizationId: slotResult.organizationId,
            playerId: rosterPlayer.id,
            pubgAccountId: rosterPlayer.playerOpenId ?? null,
            externalPlayerId:
              rosterPlayer.externalPlayerId ??
              rosterPlayer.playerOpenId ??
              null,
            playerName,
            kills: 0,
            assists: 0,
            knocks: 0,
            isKnocked: false,
            isAlive: false,
            alive: false,
            isAutoFilled: false,
          },
          select: { id: true },
        });
        keepSlotPlayerIds.add(created.id);
      }
    }

    if (slotResultIds.length > 0) {
      await client.matchSlotPlayerResult.deleteMany({
        where: {
          slotResultId: { in: slotResultIds },
          id: {
            notIn: keepSlotPlayerIds.size
              ? Array.from(keepSlotPlayerIds)
              : ['__keep_none__'],
          },
        },
      });
    }

    await this.syncMatchPlayers(matchId, { tx: client });
    if (opts.finalize === true) {
      await this.logFinalizedResultsVerification(
        client,
        matchId,
        opts.finalProjection?.totalTeams ?? Object.keys(state.teams).length,
      );
    }
  }

  private async logFinalizedResultsVerification(
    client: ResultsDbClient,
    matchId: string,
    totalTeams: number,
  ): Promise<void> {
    const finalizedSlots = await client.matchSlotResult.findMany({
      where: { matchId, teamId: { not: null } },
      select: {
        players: {
          select: {
            isAlive: true,
            alive: true,
            isKnocked: true,
          },
        },
      },
    });

    const playersMarkedAliveAfterFinalize = finalizedSlots.reduce(
      (count, slot) =>
        count +
        (slot.players ?? []).reduce((playerCount, player) => {
          const alive =
            ((player as { isAlive?: boolean | null }).isAlive ??
              (player as { alive?: boolean | null }).alive ??
              false) === true;
          return alive ? playerCount + 1 : playerCount;
        }, 0),
      0,
    );
    const playersMarkedKnockedAfterFinalize = finalizedSlots.reduce(
      (count, slot) =>
        count +
        (slot.players ?? []).reduce(
          (playerCount, player) =>
            ((player as { isKnocked?: boolean | null }).isKnocked ?? false) ===
            true
              ? playerCount + 1
              : playerCount,
          0,
        ),
      0,
    );
    const teamsMarkedAliveAfterFinalize = finalizedSlots.reduce(
      (count, slot) => {
        const hasAlivePlayer = (slot.players ?? []).some(
          (player) =>
            ((player as { isAlive?: boolean | null }).isAlive ??
              (player as { alive?: boolean | null }).alive ??
              false) === true,
        );
        return hasAlivePlayer ? count + 1 : count;
      },
      0,
    );

    const logPayload = {
      action: 'final-results-written',
      matchId,
      finalized: true,
      totalTeams,
      teamsMarkedAliveAfterFinalize,
      playersMarkedAliveAfterFinalize,
      playersMarkedKnockedAfterFinalize,
    };
    this.logger.log(JSON.stringify(logPayload));

    if (
      teamsMarkedAliveAfterFinalize > 0 ||
      playersMarkedAliveAfterFinalize > 0 ||
      playersMarkedKnockedAfterFinalize > 0
    ) {
      this.logger.warn(
        JSON.stringify({
          ...logPayload,
          action: 'final-results-postcondition-failed',
        }),
      );
    }
  }

  async resetLiveProjection(matchId: string, opts: { tx?: Tx } = {}) {
    const client = opts.tx ?? this.prisma;

    await this.ensureResultsFromSlots(matchId, opts);

    const matchMeta = await client.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        dataSource: true,
        dataMode: true,
      },
    });
    const isManualSource = this.isManualSource({
      dataSource: matchMeta?.dataSource ?? null,
      dataMode: matchMeta?.dataMode ?? null,
    });

    const slotResults = await client.matchSlotResult.findMany({
      where: { matchId },
      select: { id: true },
    });
    const slotResultIds = slotResults.map((slot) => slot.id);

    if (slotResultIds.length > 0) {
      if (isManualSource) {
        // Manual matches keep their assigned roster rows across resets, but all
        // live counters must be returned to a neutral pre-match state.
        await client.matchSlotPlayerResult.deleteMany({
          where: {
            slotResultId: { in: slotResultIds },
            isAutoFilled: true,
          },
        });

        await client.matchSlotPlayerResult.updateMany({
          where: { slotResultId: { in: slotResultIds } },
          data: {
            kills: 0,
            knocks: 0,
            assists: 0,
            isKnocked: false,
            isAlive: true,
            alive: true,
          },
        });
      } else {
        // API matches must not carry player rows between runs. Fresh ob.js
        // telemetry should repopulate them when the next live session starts.
        await client.matchSlotPlayerResult.deleteMany({
          where: {
            slotResultId: { in: slotResultIds },
          },
        });
      }
    }

    await client.matchSlotResult.updateMany({
      where: { matchId },
      data: {
        wasPresentInMatch: null,
        placement: null,
        eliminatedOrder: null,
        placementPoints: 0,
        totalKills: 0,
        manualTotalKills: false,
        finalPlacement: null,
        finalKills: null,
        finalizedAt: null,
        totalPoints: 0,
        points: 0,
        isLocked: false,
        eliminatedAt: null,
      },
    });

    const currentControl = await client.matchControlState.findUnique({
      where: { matchId },
      select: {
        organizationId: true,
        state: true,
        metaJson: true,
      },
    });
    const currentMeta = this.asJsonRecord(currentControl?.metaJson);
    const nextMeta: Record<string, unknown> = { ...(currentMeta ?? {}) };
    delete nextMeta.winnerTeamId;
    delete nextMeta.missedSlotNumbers;
    delete nextMeta.joinedSlotNumbers;
    delete nextMeta.resultFinalized;
    delete nextMeta.resultNeedsConfirmation;
    delete nextMeta.resultAmbiguities;
    delete nextMeta.liveSync;
    delete nextMeta.lastPlayerSnapshot;
    delete nextMeta.lastScoreboardSnapshot;
    delete nextMeta.telemetryPromotionDiagnostics;

    const metaChanged =
      JSON.stringify(currentMeta ?? {}) !== JSON.stringify(nextMeta);
    if (metaChanged) {
      await client.matchControlState.upsert({
        where: { matchId },
        update: {
          metaJson: nextMeta as Prisma.InputJsonObject,
        },
        create: {
          matchId,
          organizationId: currentControl?.organizationId ?? '',
          state: currentControl?.state ?? 'READY',
          metaJson: nextMeta as Prisma.InputJsonObject,
        },
      });
    }

    await this.syncMatchPlayers(matchId, opts);
  }

  async getRoundWithData(matchId: string, roundIndex: number) {
    const slots = await this.fetchSlotResults(matchId);
    const teamResults = slots
      .filter((sr) => sr.teamId)
      .map((sr) => ({
        id: sr.id,
        teamId: sr.teamId,
        slotNumber: sr.slotNumber,
        wasPresentInMatch: sr.wasPresentInMatch ?? null,
        presenceStatus: derivePresenceStatus(sr.wasPresentInMatch ?? null),
        placement: sr.placement ?? null,
        kills: sr.totalKills ?? 0,
        points: sr.totalPoints ?? 0,
        team: sr.team ?? null,
      }));
    return {
      id: matchId,
      matchId,
      roundIndex,
      teamResults,
      approval: null,
      slots,
    };
  }

  async listSlotResults(actor: AuthUser, matchId: string) {
    await this.ensureMatch(actor, matchId);
    return this.fetchSlotResults(matchId);
  }

  async listSlotResultsPublic(
    matchId: string,
    opts: {
      actor?: AuthUser | null;
      organizationId?: string | null;
    } = {},
  ) {
    await requireMatchOrganization(this.prisma, matchId, {
      actor: opts.actor ?? null,
      organizationId: opts.organizationId ?? null,
    });
    return this.fetchSlotResults(matchId);
  }

  async ensureResultsFromSlots(
    matchId: string,
    opts: { tx?: Tx } = {},
  ): Promise<
    Array<
      Prisma.MatchSlotResultGetPayload<{
        include: { players: true; team: { select: { id: true } } };
      }>
    >
  > {
    const client = opts.tx ?? this.prisma;
    const slots = await client.matchSlot.findMany({
      where: { matchId, deletedAt: null },
      include: {
        team: {
          select: {
            id: true,
            players: {
              where: { deletedAt: null },
              select: {
                id: true,
                ign: true,
                realName: true,
                externalPlayerId: true,
                playerOpenId: true,
              },
            },
          },
        },
      },
      orderBy: { slotNumber: 'asc' },
    });

    const results: Array<
      Prisma.MatchSlotResultGetPayload<{
        include: { players: true; team: { select: { id: true } } };
      }>
    > = [];

    const matchMeta = await client.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        organizationId: true,
        dataSource: true,
        dataMode: true,
        tournament: { select: { organizationId: true } },
        telemetry: { select: { payload: true } },
      },
    });
    const organizationId =
      matchMeta?.organizationId ??
      matchMeta?.tournament?.organizationId ??
      null;
    if (!organizationId) {
      throw new BadRequestException(
        'organizationId is required to materialize slot results',
      );
    }
    const isManual =
      (matchMeta?.dataSource ?? matchMeta?.dataMode ?? '').toUpperCase() ===
      'MANUAL';
    const telemetryPlayersBySlot = isManual
      ? new Map<number, MaterializedSlotPlayer[]>()
      : this.extractTelemetryPlayersBySlot(
          matchMeta?.telemetry?.payload ?? null,
          slots.map((slot) => ({
            slotNumber: slot.slotNumber,
            teamId: slot.teamId ?? null,
          })),
        );

    // Clean up any slot results that no longer have a corresponding slot
    const activeSlotNumbers = slots.map((s) => s.slotNumber);
    if (activeSlotNumbers.length > 0) {
      const orphanResults = await client.matchSlotResult.findMany({
        where: {
          matchId,
          slotNumber: { notIn: activeSlotNumbers },
        },
        select: { id: true },
      });
      const orphanIds = orphanResults.map((r) => r.id);
      if (orphanIds.length) {
        await client.matchSlotPlayerResult.deleteMany({
          where: { slotResultId: { in: orphanIds } },
        });
        await client.matchSlotResult.deleteMany({
          where: { id: { in: orphanIds } },
        });
      }
    } else {
      // No slots assigned: clear all slot results for this match
      const allResults = await client.matchSlotResult.findMany({
        where: { matchId },
        select: { id: true },
      });
      const allIds = allResults.map((r) => r.id);
      if (allIds.length) {
        await client.matchSlotPlayerResult.deleteMany({
          where: { slotResultId: { in: allIds } },
        });
        await client.matchSlotResult.deleteMany({
          where: { id: { in: allIds } },
        });
      }
    }

    const existingResultsBySlot = new Map<
      number,
      {
        slotNumber: number;
        teamId: string | null;
        wasPresentInMatch: boolean | null;
      }
    >();
    if (activeSlotNumbers.length) {
      const existingResults = await client.matchSlotResult.findMany({
        where: { matchId, slotNumber: { in: activeSlotNumbers } },
        select: {
          slotNumber: true,
          teamId: true,
          wasPresentInMatch: true,
        },
      });
      for (const result of existingResults) {
        existingResultsBySlot.set(result.slotNumber, result);
      }
    }

    type SlotResultWithRelations = Prisma.MatchSlotResultGetPayload<{
      include: { players: true; team: { select: { id: true } } };
    }>;

    for (const slot of slots) {
      const existingResult = existingResultsBySlot.get(slot.slotNumber);
      const manualWasPresent = !slot.teamId
        ? null
        : existingResult?.teamId === slot.teamId &&
            existingResult.wasPresentInMatch !== null
          ? existingResult.wasPresentInMatch
          : true;
      const saved = (await client.matchSlotResult.upsert({
        where: {
          matchId_slotNumber: { matchId, slotNumber: slot.slotNumber },
        },
        update: {
          teamId: slot.teamId,
          ...(isManual
            ? {
                isAutoFilled: false,
                wasPresentInMatch: manualWasPresent,
              }
            : {}),
        },
        create: {
          matchId,
          slotNumber: slot.slotNumber,
          teamId: slot.teamId,
          organizationId,
          isAutoFilled: !isManual,
          wasPresentInMatch: isManual ? manualWasPresent : null,
          totalKills: 0,
          placementPoints: 0,
          totalPoints: 0,
        },
        include: { players: true, team: { select: { id: true } } },
      })) as SlotResultWithRelations;

      const existingPlayers = saved.players ?? [];
      if (isManual) {
        const activePlayers = (slot.team?.players ?? [])
          .slice(0, 4)
          .map((p) => ({
            id: p.id,
            pubgAccountId: p.playerOpenId ?? null,
            externalPlayerId: p.externalPlayerId ?? p.playerOpenId ?? null,
            nameSeed: p.ign ?? p.realName ?? 'Player',
          }));
        const activePlayerNames = uniqueSlotPlayerNames(
          activePlayers.map((player) => ({
            playerName: player.nameSeed,
            stableId: player.id,
          })),
        );

        if (activePlayers.length > 0) {
          const activePlayerIds = new Set(
            activePlayers.map((player) => player.id),
          );
          const existingByPlayerId = new Map(
            existingPlayers
              .filter((p) => p.playerId)
              .map((p) => [p.playerId as string, p]),
          );
          const removeIds = existingPlayers
            .filter((p) => {
              if (p.playerId && activePlayerIds.has(p.playerId)) {
                return false;
              }

              // Screenshot OCR rows do not always map to roster player IDs. Keep
              // non-zero OCR rows so result recalculation does not erase applied
              // screenshot kills for teams that already have a stored roster.
              if (!p.playerId && p.isAutoFilled && (p.kills ?? 0) > 0) {
                return false;
              }

              return true;
            })
            .map((p) => p.id);
          if (removeIds.length) {
            await client.matchSlotPlayerResult.deleteMany({
              where: { id: { in: removeIds } },
            });
          }

          for (const [playerIndex, p] of activePlayers.entries()) {
            const playerName = activePlayerNames[playerIndex];
            const existing = p.id ? existingByPlayerId.get(p.id) : undefined;
            if (existing) {
              await client.matchSlotPlayerResult.update({
                where: { id: existing.id },
                data: {
                  playerName,
                  pubgAccountId: p.pubgAccountId,
                  externalPlayerId: p.externalPlayerId,
                } as any,
              });
            } else {
              await client.matchSlotPlayerResult.create({
                data: {
                  slotResultId: saved.id,
                  organizationId,
                  playerId: p.id ?? undefined,
                  pubgAccountId: p.pubgAccountId,
                  externalPlayerId: p.externalPlayerId,
                  playerName,
                  kills: 0,
                  assists: 0,
                  knocks: 0,
                  alive: true,
                  isKnocked: false,
                  isAlive: true,
                  isAutoFilled: false,
                } as any,
              });
            }
          }
        }
      } else {
        const telemetryPlayers =
          telemetryPlayersBySlot.get(slot.slotNumber) ?? [];
        if (telemetryPlayers.length > 0) {
          const resolvedPlayers = (
            await Promise.all(
              telemetryPlayers.map(async (player) => {
                const materialized = await this.materializeTelemetryPlayer(
                  client,
                  {
                    organizationId,
                    teamId: slot.teamId ?? null,
                    player,
                  },
                );
                if (!materialized) return null;
                return {
                  id: materialized.id,
                  name: materialized.ign ?? player.name,
                  pubgAccountId:
                    materialized.playerOpenId ?? player.pubgAccountId,
                  externalPlayerId:
                    materialized.externalPlayerId ?? player.externalPlayerId,
                  avatarUrl: materialized.photoUrl ?? player.avatarUrl,
                };
              }),
            )
          ).filter(
            (
              player,
            ): player is {
              id: string;
              name: string;
              pubgAccountId: string | null;
              externalPlayerId: string | null;
              avatarUrl: string | null;
            } => Boolean(player?.id),
          );
          const uniqueResolvedPlayers = Array.from(
            new Map(
              resolvedPlayers.map((player) => [player.id, player] as const),
            ).values(),
          );
          const uniqueResolvedPlayerNames = uniqueSlotPlayerNames(
            uniqueResolvedPlayers.map((player) => ({
              playerName: player.name,
              stableId: player.id,
            })),
          );

          if (uniqueResolvedPlayers.length > 0) {
            const activePlayerIds = new Set(
              uniqueResolvedPlayers.map((player) => player.id),
            );
            const existingByPlayerId = new Map(
              existingPlayers
                .filter((player) => player.playerId)
                .map((player) => [player.playerId as string, player]),
            );
            const removeIds = existingPlayers
              .filter(
                (player) =>
                  !player.playerId || !activePlayerIds.has(player.playerId),
              )
              .map((player) => player.id);
            if (removeIds.length) {
              await client.matchSlotPlayerResult.deleteMany({
                where: { id: { in: removeIds } },
              });
            }

            for (const [
              playerIndex,
              player,
            ] of uniqueResolvedPlayers.entries()) {
              const playerName = uniqueResolvedPlayerNames[playerIndex];
              const existing = existingByPlayerId.get(player.id);
              if (existing) {
                await client.matchSlotPlayerResult.update({
                  where: { id: existing.id },
                  data: {
                    playerId: player.id,
                    pubgAccountId: player.pubgAccountId,
                    externalPlayerId: player.externalPlayerId,
                    playerName,
                    isAutoFilled: true,
                  } as any,
                });
              } else {
                await client.matchSlotPlayerResult.create({
                  data: {
                    slotResultId: saved.id,
                    organizationId,
                    playerId: player.id,
                    pubgAccountId: player.pubgAccountId,
                    externalPlayerId: player.externalPlayerId,
                    playerName,
                    kills: 0,
                    assists: 0,
                    knocks: 0,
                    alive: true,
                    isKnocked: false,
                    isAlive: true,
                    isAutoFilled: true,
                  } as any,
                });
              }
            }
          }
        }
      }

      const refreshed = await client.matchSlotResult.findUnique({
        where: { id: saved.id },
        include: { players: true, team: { select: { id: true } } },
      });
      if (refreshed) {
        results.push(refreshed);
      }
    }

    await this.syncMatchPlayers(matchId, { tx: client });

    return results;
  }

  async recalculateMatchResults(
    matchId: string,
    opts: { tx?: Tx; emitEvents?: boolean } = {},
  ) {
    await this.recomputeAllSlots(matchId, opts);
  }

  async updateSlotResult(
    actor: AuthUser,
    matchId: string,
    slotNumber: number,
    body: {
      placement?: number | null;
      totalKills?: number | null;
      manualTotalKills?: boolean | null;
    },
  ) {
    const match = await this.ensureMatch(actor, matchId);
    await this.ensureResultsEditable(match, actor);
    await this.ensureResultsFromSlots(matchId);
    const existing = await this.prisma.matchSlotResult.findUnique({
      where: { matchId_slotNumber: { matchId, slotNumber } },
      include: {
        players: { select: { id: true, isAlive: true } },
      },
    });
    if (!existing) {
      throw new NotFoundException('Slot result not found');
    }
    await this.assertSlotPresentForMutation(
      {
        id: existing.id,
        matchId,
        slotNumber,
        teamId: existing.teamId ?? null,
        wasPresentInMatch:
          (existing as { wasPresentInMatch?: boolean | null })
            .wasPresentInMatch ?? null,
      },
      {
        allowManualPromote: this.isManualSource(match),
      },
    );
    await this.assertSlotUnlocked(matchId, existing.id);
    const placement =
      body.placement !== undefined
        ? body.placement
        : (existing.placement ?? null);
    const manualTotalKills =
      body.manualTotalKills !== undefined
        ? body.manualTotalKills
        : ((existing as any).manualTotalKills ?? false);
    const nextTotalKills =
      manualTotalKills && body.totalKills !== undefined
        ? Math.max(0, body.totalKills ?? 0)
        : existing.totalKills;

    this.validateSlotState({
      placement,
      manualTotalKills,
      totalKills: nextTotalKills,
      players: existing.players ?? [],
    });

    const before = existing;

    await this.prisma.matchSlotResult.update({
      where: { id: existing.id },
      data: {
        placement,
        manualTotalKills,
        totalKills: nextTotalKills,
      } as any,
    });

    const recomputed = await this.recomputeSlotResult(matchId, slotNumber);
    const teamOverrideFields: Array<'placement' | 'totalKills'> = [];
    if (body.placement !== undefined) {
      teamOverrideFields.push('placement');
    }
    if (body.totalKills !== undefined || manualTotalKills) {
      teamOverrideFields.push('totalKills');
    }
    const syncContract =
      teamOverrideFields.length > 0
        ? await this.prisma.$transaction((tx) =>
            this.persistManualSyncOverrides(tx, {
              actor,
              matchId,
              organizationId:
                before.organizationId ??
                this.resolveMatchOrganizationId(match, actor) ??
                '',
              fallbackState: match.controlState?.state ?? 'READY',
              teams: [
                {
                  teamId: existing.teamId ?? '',
                  fields: teamOverrideFields,
                },
              ],
              source: 'MANUAL_TEAM_RESULT_UPDATE',
            }),
          )
        : null;
    this.events.emitResultsUpdated(matchId, 0, {
      slotNumber,
      source: 'MANUAL',
    });
    this.events.emitLeaderboardUpdated(matchId);
    if (syncContract) {
      await this.publishManualMirrorFromResults(
        matchId,
        syncContract.version,
      ).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[MANUAL_TEAM_RESULT_UPDATE] Failed to publish live mirror match=${matchId}: ${message}`,
        );
      });
    }
    await this.auditEdit({
      actor,
      organizationId: existing.organizationId ?? null,
      entityType: 'MatchSlotResult',
      entityId: existing.id,
      before,
      after: recomputed,
      source: 'MANUAL',
    });
    return this.fetchSlotResults(matchId);
  }

  async updateTeamResultById(
    actor: AuthUser,
    matchId: string,
    teamResultId: string,
    body: { placement?: number | null },
  ) {
    const match = await this.ensureMatch(actor, matchId);
    this.ensureManualSource(match);
    await this.ensureResultsEditable(match, actor);
    const slot = await this.prisma.matchSlotResult.findFirst({
      where: { id: teamResultId, matchId },
      select: {
        id: true,
        teamId: true,
        slotNumber: true,
        wasPresentInMatch: true,
        placement: true,
        totalKills: true,
        manualTotalKills: true,
        players: { select: { id: true, isAlive: true } },
      },
    });
    if (!slot) {
      throw new NotFoundException('Slot result not found for team');
    }
    await this.assertSlotPresentForMutation(
      {
        id: slot.id,
        matchId,
        slotNumber: slot.slotNumber,
        teamId: slot.teamId ?? null,
        wasPresentInMatch:
          (slot as { wasPresentInMatch?: boolean | null }).wasPresentInMatch ??
          null,
      },
      {
        allowManualPromote: this.isManualSource(match),
      },
    );
    const slotTeamId = slot.teamId;
    if (!slotTeamId) {
      throw new NotFoundException('Team result not found for team');
    }

    const placement = body.placement !== undefined ? body.placement : undefined;
    if (placement !== undefined && placement !== null && placement < 1) {
      throw new BadRequestException('placement must be at least 1');
    }

    if (placement !== undefined) {
      this.validateSlotState({
        placement,
        manualTotalKills: (slot as any).manualTotalKills ?? false,
        totalKills: slot.totalKills ?? null,
        players: slot.players ?? [],
      });
      await this.prisma.matchSlotResult.update({
        where: { id: slot.id },
        data: { placement },
      });
      await this.recomputeSlotResult(matchId, slot.slotNumber);
    }

    const syncContract =
      placement !== undefined
        ? await this.prisma.$transaction((tx) =>
            this.persistManualSyncOverrides(tx, {
              actor,
              matchId,
              organizationId:
                this.resolveMatchOrganizationId(match, actor) ?? '',
              fallbackState: match.controlState?.state ?? 'READY',
              teams: [
                {
                  teamId: slotTeamId,
                  fields: ['placement'],
                },
              ],
              source: 'MANUAL_TEAM_PLACEMENT_UPDATE',
            }),
          )
        : null;

    this.events.emitResultsUpdated(matchId, 0, {
      teamResultId: slot.id,
      slotNumber: slot.slotNumber,
    });
    if (syncContract) {
      await this.publishManualMirrorFromResults(
        matchId,
        syncContract.version,
      ).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[MANUAL_TEAM_PLACEMENT_UPDATE] Failed to publish live mirror match=${matchId}: ${message}`,
        );
      });
    }
    return { ok: true };
  }

  async updateTeamPlayers(
    actor: AuthUser,
    matchId: string,
    teamId: string,
    body: UpdateTeamResultsDto,
  ) {
    try {
      const match = await this.ensureMatch(actor, matchId);
      this.assertResultsVersion(
        match,
        this.resolveExpectedResultsVersion(body?.expectedVersion),
      );
      const playersPayload = body?.players ?? [];
      const playerKillsEdited = playersPayload.some(
        (player) => player.kills !== undefined,
      );

      if (!playersPayload.length) {
        throw new BadRequestException(
          'players payload is required for team update',
        );
      }

      playersPayload.forEach((p, idx) => {
        if (!p.playerResultId && !p.playerId) {
          throw new BadRequestException(
            `players[${idx}].playerId is required for team update`,
          );
        }
      });

      const matchLocked = this.shouldFullMatchLock(match);
      if (matchLocked) {
        throw new ConflictException('Results are locked for this match.');
      }

      await this.ensureResultsEditable(match, actor, {
        allowUnlockEliminated: true,
      });

      // Hydrate slot/player result rows from the current match assignment
      // before resolving incoming player identities against persisted results.
      await this.ensureResultsFromSlots(matchId);

      const allSlots = await this.prisma.matchSlotResult.findMany({
        where: { matchId },
        orderBy: { slotNumber: 'asc' },
        include: {
          players: true,
          team: { select: { id: true, name: true, tag: true, logoUrl: true } },
        },
      });

      const assignedSlots = allSlots.filter(
        (entry): entry is (typeof allSlots)[number] & { teamId: string } =>
          Boolean(entry.teamId),
      );

      const slot = assignedSlots.find((s) => s.teamId === teamId);
      if (!slot) {
        throw new BadRequestException('Team is not assigned to this match');
      }
      await this.assertSlotPresentForMutation(
        {
          id: slot.id,
          matchId,
          slotNumber: slot.slotNumber,
          teamId: slot.teamId,
          wasPresentInMatch: slot.wasPresentInMatch ?? null,
        },
        {
          allowManualPromote: this.isManualSource(match),
        },
      );

      const ruleset = await this.rulesetConfig(matchId);
      const mergedPlayersBySlotId = new Map<string, NormalizedPlayerState[]>();
      for (const currentSlot of assignedSlots) {
        const incoming = currentSlot.id === slot.id ? playersPayload : [];
        const normalized = this.normalizePlayersForRules(
          currentSlot.players ?? [],
          incoming as any,
        );
        mergedPlayersBySlotId.set(
          currentSlot.id,
          this.enforcePlayerRuleSet(normalized),
        );
      }

      const canonicalSlots = playerKillsEdited
        ? assignedSlots.map((currentSlot) =>
            currentSlot.id === slot.id
              ? { ...currentSlot, manualTotalKills: false }
              : currentSlot,
          )
        : assignedSlots;
      const canonical = this.buildCanonicalSlotResolution(
        canonicalSlots,
        mergedPlayersBySlotId,
        new Date(),
      );
      const canonicalByTeamId = new Map(
        canonical.teams.map((team) => [team.teamId, team] as const),
      );
      const targetState = canonicalByTeamId.get(teamId);
      if (!targetState) {
        throw new BadRequestException(
          'Canonical team state could not be derived',
        );
      }

      const aliveTeamsAfter = canonical.aliveTeams;
      const lifecycleStatus = deriveCanonicalMatchLifecycleStatus({
        status: match.status ?? null,
        liveState: match.liveState ?? match.controlState?.state ?? null,
        controlState: match.controlState?.state ?? null,
        metaJson: match.controlState?.metaJson ?? null,
      });
      const shouldDetectFinish =
        aliveTeamsAfter <= 1 && lifecycleStatus === 'LIVE';

      const existingPlacement =
        typeof slot.placement === 'number' && Number.isFinite(slot.placement)
          ? Math.max(1, Math.trunc(slot.placement))
          : null;
      const targetPlacement = existingPlacement;
      const targetEliminated =
        targetPlacement !== null && targetPlacement > 1
          ? true
          : targetPlacement === 1
            ? false
            : targetState.eliminated;
      const targetEliminatedOrder =
        targetPlacement !== null && targetPlacement > 1
          ? Math.max(canonical.totalTeams - targetPlacement + 1, 1)
          : targetEliminated
            ? targetState.eliminatedOrder
            : null;
      const targetEliminatedAt = targetEliminated
        ? (targetState.eliminatedAt ??
          (slot as { eliminatedAt?: Date | null }).eliminatedAt ??
          new Date())
        : null;
      const targetAssistsById = new Map(
        (mergedPlayersBySlotId.get(slot.id) ?? []).map(
          (player) => [player.id, player.assists] as const,
        ),
      );
      const beforePlayers = slot.players?.map((p) => ({ ...p })) ?? [];
      const manualPlayerOverrides = (slot.players ?? [])
        .filter((player) =>
          playersPayload.some(
            (incoming) =>
              incoming.playerResultId === player.id ||
              incoming.playerId ===
                (buildMatchPlayerKey({
                  playerId: player.playerId ?? null,
                  playerResultId: player.id,
                }) ?? player.id),
          ),
        )
        .flatMap((player) => {
          const playerKey =
            buildMatchPlayerKey({
              playerId: player.playerId ?? null,
              playerResultId: player.id,
            }) ?? player.id;
          return playerKey
            ? [
                {
                  playerId: playerKey,
                  fields: ['alive', 'knocked', 'kills'] as Array<
                    'alive' | 'knocked' | 'kills'
                  >,
                },
              ]
            : [];
        });

      const transactionResult = await this.prisma.$transaction(async (tx) => {
        for (const player of targetState.players) {
          await tx.matchSlotPlayerResult.update({
            where: { id: player.id },
            data: {
              kills: player.kills,
              assists: targetAssistsById.get(player.id) ?? 0,
              isAlive: player.alive,
              alive: player.alive,
              isKnocked: player.knocked,
            },
          });
        }

        // Team-player edits should not rewrite every slot in the match.
        // Placements remain explicitly editable via the placement workflow.
        const aggregateSlot: any = {
          ...slot,
          placement: targetPlacement,
          totalKills: targetState.teamKills,
          manualTotalKills:
            playerKillsEdited === true
              ? false
              : ((slot as { manualTotalKills?: boolean | null })
                  .manualTotalKills ?? false),
          players: targetState.players,
        };

        const aggregates = this.computeSlotAggregates({
          slot: aggregateSlot,
          ruleset,
        });

        await tx.matchSlotResult.update({
          where: { id: slot.id },
          data: {
            placement: targetPlacement,
            eliminatedOrder: targetEliminatedOrder,
            eliminatedAt: targetEliminatedAt,
            isLocked: targetEliminated,
            totalKills: targetState.teamKills,
            manualTotalKills:
              playerKillsEdited === true
                ? false
                : ((slot as { manualTotalKills?: boolean | null })
                    .manualTotalKills ?? false),
            placementPoints: aggregates.placementPoints,
            points: aggregates.points,
            totalPoints: aggregates.totalPoints,
          },
        });

        await this.syncMatchPlayers(matchId, { tx });
        const syncContract = await this.persistManualSyncOverrides(tx, {
          actor,
          matchId,
          organizationId: this.resolveMatchOrganizationId(match, actor) ?? '',
          fallbackState: match.controlState?.state ?? 'READY',
          players: manualPlayerOverrides,
          teams: [
            {
              teamId,
              fields: ['eliminated', 'totalKills'],
            },
          ],
          source: 'MANUAL_TEAM_PLAYER_UPDATE',
        });

        const updatedSlot = await tx.matchSlotResult.findUnique({
          where: { id: slot.id },
          include: {
            players: {
              include: {
                player: {
                  select: {
                    externalPlayerId: true,
                    photoUrl: true,
                    updatedAt: true,
                    inGameId: true,
                    ign: true,
                    realName: true,
                  },
                },
              },
              orderBy: { playerName: 'asc' },
            },
            team: {
              select: { id: true, name: true, tag: true, logoUrl: true },
            },
          },
        });
        return { syncContract, updatedSlot };
      });
      const syncContract = transactionResult.syncContract;
      const updatedSlot = transactionResult.updatedSlot;

      this.events.emitResultsUpdated(matchId, 0, {
        teamResultId: slot.id,
        slotNumber: slot.slotNumber,
        source: 'BULK_PLAYER_UPDATE',
      });
      this.events.emitLeaderboardUpdated(matchId);

      if (shouldDetectFinish) {
        try {
          await this.matchControl.detectMatchFinish(matchId);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `[RESULTS_PLAYER_UPDATE] Failed to route finish detection match=${matchId}: ${message}`,
          );
        }
      }

      if (syncContract) {
        await this.publishManualMirrorFromResults(
          matchId,
          syncContract.version,
        ).catch((error) => {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `[MANUAL_TEAM_PLAYER_UPDATE] Failed to publish live mirror match=${matchId}: ${message}`,
          );
        });
      }

      await this.auditEdit({
        actor,
        organizationId:
          (slot as { organizationId?: string | null }).organizationId ?? null,
        entityType: 'MatchSlotResult',
        entityId: slot.id,
        before: beforePlayers,
        after: targetState.players,
        source: 'MANUAL',
      });

      const matchLockState = this.shouldFullMatchLock(match);
      const normalizedTeam =
        updatedSlot && updatedSlot.team
          ? {
              id: updatedSlot.id,
              teamId: updatedSlot.teamId ?? teamId,
              slotNumber: updatedSlot.slotNumber,
              eliminatedOrder: targetEliminatedOrder,
              placement: targetPlacement,
              teamKills: targetState.teamKills,
              eliminated: targetEliminated,
              teamLocked: targetEliminated,
              players: this.normalizeSlotPlayers(
                updatedSlot.players as any,
              ).map((p) => ({
                id: p.id,
                playerId: p.playerId,
                externalPlayerId:
                  (p as { externalPlayerId?: string | null })
                    .externalPlayerId ?? null,
                playerName:
                  (p as { name?: string | null }).name ??
                  p.playerName ??
                  (p as { player?: { inGameId?: string | null } | null }).player
                    ?.inGameId ??
                  null,
                avatar: p.photoUrl ?? null,
                kills: p.kills ?? 0,
                assists: p.assists ?? 0,
                alive: p.isAlive ?? p.alive ?? null,
                isAlive: p.isAlive ?? p.alive ?? null,
                knocked: p.isKnocked ?? null,
                isKnocked: p.isKnocked ?? null,
              })),
              team: updatedSlot.team,
            }
          : null;

      return {
        ok: true,
        version:
          syncContract?.version ??
          readLiveSyncContract(match.controlState?.metaJson ?? null).version,
        team: normalizedTeam,
        placement: targetPlacement,
        aliveTeamsCount: canonical.aliveTeams,
        totalTeamsCount: canonical.totalTeams,
        matchLocked: matchLockState,
        sourceMode: exposeSourceMode(
          derivePcobBindingFlags(match, {
            lifecycleStatus: deriveCanonicalMatchLifecycleStatus({
              status: match.status ?? null,
              liveState: match.liveState ?? match.controlState?.state ?? null,
              controlState: match.controlState?.state ?? null,
              metaJson: match.controlState?.metaJson ?? null,
            }),
          }).telemetryProvider,
        ),
      };
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      const stack = (err as Error)?.stack ?? '';
      this.logger.error(
        `updateTeamPlayers failed match=${matchId} team=${teamId}: ${message}`,
        stack,
      );
      if (
        err instanceof BadRequestException ||
        err instanceof ConflictException ||
        err instanceof ForbiddenException ||
        err instanceof NotFoundException
      ) {
        throw err;
      }
      throw new BadRequestException(
        `Results update failed: ${message ?? 'unknown error'}`,
      );
    }
  }

  async releaseMatchOverrides(actor: AuthUser, matchId: string) {
    const match = await this.ensureMatch(actor, matchId);
    this.ensureOverrideReleaseAllowed(match);
    const currentContract = readLiveSyncContract(
      match.controlState?.metaJson ?? null,
    );
    const releasedPlayers = Object.keys(
      currentContract.overrides.players,
    ).length;
    const releasedTeams = Object.keys(currentContract.overrides.teams).length;

    if (releasedPlayers === 0 && releasedTeams === 0) {
      return {
        ok: true,
        released: false,
        releasedPlayers: 0,
        releasedTeams: 0,
        version: currentContract.version,
      };
    }

    const nextContract = await this.prisma.$transaction((tx) =>
      this.persistReleasedSyncOverrides(tx, {
        actor,
        matchId,
        organizationId: this.resolveMatchOrganizationId(match, actor) ?? '',
        fallbackState: match.controlState?.state ?? 'READY',
        releaseAll: true,
        source: 'MANUAL_OVERRIDE_RELEASE_MATCH',
      }),
    );

    await this.republishReleasedOverrideMirror(
      match,
      matchId,
      nextContract.version,
    );

    return {
      ok: true,
      released: true,
      releasedPlayers,
      releasedTeams,
      version: nextContract.version,
    };
  }

  async releaseTeamOverrides(actor: AuthUser, matchId: string, teamId: string) {
    const match = await this.ensureMatch(actor, matchId);
    this.ensureOverrideReleaseAllowed(match);
    const currentContract = readLiveSyncContract(
      match.controlState?.metaJson ?? null,
    );
    const slot = await this.prisma.matchSlotResult.findFirst({
      where: { matchId, teamId },
      select: {
        id: true,
        teamId: true,
        organizationId: true,
        players: {
          select: {
            id: true,
            playerId: true,
          },
        },
      },
    });
    if (!slot || !slot.teamId) {
      throw new NotFoundException('Team result not found for override release');
    }

    const playerReleases = (slot.players ?? [])
      .map((player) => {
        const playerKey =
          buildMatchPlayerKey({
            playerId: player.playerId ?? null,
            playerResultId: player.id,
          }) ?? player.id;
        const ownership = currentContract.overrides.players[playerKey];
        const fields = this.playerOwnershipFields(ownership);
        if (!fields.length) {
          return null;
        }
        return { playerId: playerKey, fields };
      })
      .filter(
        (
          player,
        ): player is {
          playerId: string;
          fields: Array<'alive' | 'knocked' | 'kills'>;
        } => Boolean(player),
      );
    const teamOwnership = currentContract.overrides.teams[teamId];
    const teamFields = this.teamOwnershipFields(teamOwnership);

    if (!playerReleases.length && !teamFields.length) {
      return {
        ok: true,
        released: false,
        releasedPlayers: 0,
        releasedTeams: 0,
        version: currentContract.version,
      };
    }

    const nextContract = await this.prisma.$transaction((tx) =>
      this.persistReleasedSyncOverrides(tx, {
        actor,
        matchId,
        organizationId:
          slot.organizationId ??
          this.resolveMatchOrganizationId(match, actor) ??
          '',
        fallbackState: match.controlState?.state ?? 'READY',
        players: playerReleases,
        teams: teamFields.length ? [{ teamId, fields: teamFields }] : undefined,
        source: 'MANUAL_OVERRIDE_RELEASE_TEAM',
      }),
    );

    await this.republishReleasedOverrideMirror(
      match,
      matchId,
      nextContract.version,
    );

    return {
      ok: true,
      released: true,
      releasedPlayers: playerReleases.length,
      releasedTeams: teamFields.length ? 1 : 0,
      version: nextContract.version,
    };
  }

  async releasePlayerOverrides(
    actor: AuthUser,
    matchId: string,
    playerId: string,
  ) {
    const match = await this.ensureMatch(actor, matchId);
    this.ensureOverrideReleaseAllowed(match);
    const currentContract = readLiveSyncContract(
      match.controlState?.metaJson ?? null,
    );
    const fields = this.playerOwnershipFields(
      currentContract.overrides.players[playerId],
    );

    if (!fields.length) {
      return {
        ok: true,
        released: false,
        releasedPlayers: 0,
        version: currentContract.version,
      };
    }

    const nextContract = await this.prisma.$transaction((tx) =>
      this.persistReleasedSyncOverrides(tx, {
        actor,
        matchId,
        organizationId: this.resolveMatchOrganizationId(match, actor) ?? '',
        fallbackState: match.controlState?.state ?? 'READY',
        players: [{ playerId, fields }],
        source: 'MANUAL_OVERRIDE_RELEASE_PLAYER',
      }),
    );

    await this.republishReleasedOverrideMirror(
      match,
      matchId,
      nextContract.version,
    );

    return {
      ok: true,
      released: true,
      releasedPlayers: 1,
      version: nextContract.version,
    };
  }

  async updatePlayerResult(
    actor: AuthUser,
    matchId: string,
    slotNumber: number,
    playerResultId: string,
    body: {
      kills?: number | null;
      knocks?: number | null;
      assists?: number | null;
      alive?: boolean | null;
      isKnocked?: boolean | null;
      isAlive?: boolean | null;
    },
  ) {
    const match = await this.ensureMatch(actor, matchId);
    const allowUnlock =
      body.isAlive === true || body.alive === true || body.isAlive === null;

    await this.ensureResultsEditable(match, actor, {
      allowUnlockEliminated: allowUnlock,
    });

    const slot = await this.prisma.matchSlotResult.findUnique({
      where: { matchId_slotNumber: { matchId, slotNumber } },
      select: { id: true, teamId: true },
    });
    if (!slot || !slot.teamId) {
      throw new NotFoundException('Slot result not found');
    }

    return this.updateTeamPlayers(actor, matchId, slot.teamId, {
      players: [
        {
          playerResultId,
          kills:
            body.kills !== undefined && body.kills !== null
              ? Math.max(0, body.kills)
              : 0,
          assists:
            body.assists !== undefined && body.assists !== null
              ? Math.max(0, body.assists)
              : undefined,
          alive: (() => {
            const rawAlive = body.isAlive ?? body.alive;
            if (rawAlive === undefined || rawAlive === null) return true;
            return Boolean(rawAlive);
          })(),
          knocked: (() => {
            const rawKnocked =
              body.isKnocked ??
              (body.knocks !== undefined ? Boolean(body.knocks) : undefined);
            if (rawKnocked === undefined || rawKnocked === null) return false;
            return Boolean(rawKnocked);
          })(),
        },
      ],
    });
  }

  async updatePlayerResultById(
    actor: AuthUser,
    matchId: string,
    playerResultId: string,
    body: {
      kills?: number | null;
      knocks?: number | null;
      assists?: number | null;
      alive?: boolean | null;
      isKnocked?: boolean | null;
      isAlive?: boolean | null;
    },
  ) {
    const match = await this.ensureMatch(actor, matchId);
    await this.ensureResultsEditable(match, actor);
    const player = await this.prisma.matchSlotPlayerResult.findFirst({
      where: { id: playerResultId },
      include: { slotResult: { select: { matchId: true, slotNumber: true } } },
    });
    if (!player || player.slotResult.matchId !== match.id) {
      throw new NotFoundException('Player result not found');
    }
    return this.updatePlayerResult(
      actor,
      matchId,
      player.slotResult.slotNumber,
      playerResultId,
      body,
    );
  }

  async assertMatchStateConsistency(matchId: string, opts: { tx?: Tx } = {}) {
    const client = opts.tx ?? this.prisma;
    const slots = await client.matchSlotResult.findMany({
      where: { matchId },
      include: { players: true },
    });
    const activeSlots = slots.filter((slot) =>
      isPresentInMatch(slot.wasPresentInMatch),
    );
    const aliveTeamsOverall = activeSlots.reduce((count, slot) => {
      const alive = (slot.players ?? []).some((p) => p.isAlive === true);
      return alive ? count + 1 : count;
    }, 0);
    const placementEntries = activeSlots.flatMap((slot) =>
      typeof slot.placement === 'number'
        ? [{ slotNumber: slot.slotNumber, placement: slot.placement }]
        : [],
    );
    const seenPlacements = new Map<number, number>();

    for (const entry of placementEntries) {
      if (entry.placement < 1 || entry.placement > activeSlots.length) {
        throw new Error(
          `Slot ${entry.slotNumber} has out-of-range placement ${entry.placement}`,
        );
      }
      const priorSlot = seenPlacements.get(entry.placement);
      if (priorSlot !== undefined) {
        throw new Error(
          `Duplicate placement ${entry.placement} for slots ${priorSlot} and ${entry.slotNumber}`,
        );
      }
      seenPlacements.set(entry.placement, entry.slotNumber);
    }

    if (aliveTeamsOverall <= 1 && activeSlots.length > 0) {
      if (placementEntries.length !== activeSlots.length) {
        throw new Error(
          `Terminal match state is missing placements for ${activeSlots.length - placementEntries.length} active slots`,
        );
      }
      for (let placement = 1; placement <= activeSlots.length; placement += 1) {
        if (!seenPlacements.has(placement)) {
          throw new Error(
            `Terminal match state is missing placement ${placement}`,
          );
        }
      }
    }

    for (const slot of activeSlots) {
      const players = slot.players ?? [];
      if (!players.length) continue;

      const aliveCount = players.reduce(
        (count, p) => count + (p.isAlive === true ? 1 : 0),
        0,
      );
      const placement = slot.placement ?? null;
      const manualTotalKills =
        (slot as { manualTotalKills?: boolean }).manualTotalKills ?? false;

      if (aliveCount === 0 && placement === null) {
        throw new Error(
          `Slot ${slot.slotNumber} is eliminated but placement is missing`,
        );
      }
      if (
        aliveCount > 0 &&
        placement !== null &&
        !(aliveTeamsOverall === 1 && placement === 1)
      ) {
        throw new Error(
          `Slot ${slot.slotNumber} has placement while players are still alive`,
        );
      }

      if (!manualTotalKills) {
        const playerKills = players.reduce((sum, p) => sum + (p.kills ?? 0), 0);
        const slotKills = slot.totalKills ?? 0;
        if (slotKills !== playerKills) {
          throw new Error(
            `Slot ${slot.slotNumber} totalKills (${slotKills}) do not match sum of player kills (${playerKills})`,
          );
        }
      }
    }
  }

  async setResultsLockOverride(
    actor: AuthUser,
    matchId: string,
    _body: { manualLock?: boolean; forceUnlock?: boolean },
  ) {
    await this.ensureMatch(actor, matchId);
    void _body;
    const actorRole = actor.actorRole ?? actor.role;
    if (actorRole !== Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Manual result lock overrides are restricted to SUPER_ADMIN.',
      );
    }
    // Manual override path is intentionally disabled to keep locking state strictly tied to match status/dataSource.
    // SUPER_ADMIN should move the match out of DRAFT or change data source instead of overriding locks.
    throw new BadRequestException(
      'Manual result locking is disabled. Change match control state to unlock/lock results.',
    );
  }

  async getWidgetStatePublic(matchId: string) {
    const snapshot = await buildWidgetScoreboardSnapshot(this.prisma, matchId, {
      includeLogos: true,
    });
    return snapshot.state;
  }
}
