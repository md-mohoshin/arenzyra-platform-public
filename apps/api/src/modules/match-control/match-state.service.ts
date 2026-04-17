import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  Inject,
  forwardRef,
  Logger,
} from '@nestjs/common';
import { AuditAction, MatchStatus, Role, Prisma } from '@prisma/client';
import type { ControlState } from './dto/control.dto';
import type { Actor } from '../matches/matches.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../db/prisma.service';
import { MatchControlGateway } from './match-control.gateway';
import { GameAdaptersResolver } from '../game-adapters/game-adapters.resolver';
import { OverlayBroadcaster } from '../../modules/realtime/overlay-broadcaster.service';
import { ResultsService } from '../results/results.service';
import { MatchControlService } from './match-control.service';
import { ResultsEventsService } from '../results/results-events.service';
import {
  deriveGroupStateFromMatches,
  deriveStageStateFromGroups,
} from '../../common/live-state.util';

export type ControlStateSnapshot = {
  matchId: string;
  state: ControlState;
  version: number;
  reason: string | null;
  updatedAt: Date;
  updatedByUserId: string | null;
  meta: unknown;
};

export type ControlSnapshot = {
  match: {
    id: string;
    name: string | null;
    status: string;
    dataSource: string | null;
    pcobStatus: string | null;
    startedAt: Date | null;
    endedAt: Date | null;
    updatedAt: Date;
  };
  controlState: ControlStateSnapshot;
  audits: Array<{
    id: string;
    action: string;
    userId: string;
    reason: string | null;
    createdAt: Date;
    entityType: string;
    before: unknown;
    after: unknown;
    source: string;
  }>;
  system: {
    dataSource: string | null;
    connection: string;
  };
};

type MatchControlRow = {
  id: string;
  controlState: { state: ControlState | null };
};

const ALLOWED_TRANSITIONS: Record<ControlState, ControlState[]> = {
  READY: ['COUNTDOWN', 'LIVE'],
  COUNTDOWN: ['LIVE', 'PAUSED', 'READY'],
  LIVE: ['PAUSED', 'ENDED'],
  PAUSED: ['LIVE', 'ENDED', 'READY'],
  ENDED: ['CONFIRMED', 'READY'],
  CONFIRMED: ['READY'],
};

@Injectable()
export class MatchStateService {
  private readonly logger = new Logger(MatchStateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(forwardRef(() => ResultsService))
    private readonly results: ResultsService,
    @Inject(forwardRef(() => MatchControlService))
    private readonly matchControl: MatchControlService,
    @Optional()
    @Inject(forwardRef(() => MatchControlGateway))
    private readonly gateway?: MatchControlGateway,
    @Optional()
    private readonly overlayBroadcaster?: OverlayBroadcaster,
    private readonly adaptersResolver?: GameAdaptersResolver,
    private readonly resultsEvents?: ResultsEventsService,
  ) {}

  // Small helper to safely probe Prisma DMMF for optional columns (handles drifted schema)
  private hasModelField(model: string, field: string): boolean {
    const maybeDmmf = (this.prisma as unknown as { _dmmf?: unknown })?._dmmf;
    const modelMap = (maybeDmmf as { modelMap?: Record<string, any> })
      ?.modelMap;
    const modelEntry = modelMap?.[model] as
      | { fields?: Array<{ name: string }> }
      | undefined;
    const fields: Array<{ name: string }> = modelEntry?.fields ?? [];
    return fields.some((f) => f.name === field);
  }

  mapControlToBusinessStatus(
    control: ControlState,
    current: MatchStatus,
  ): MatchStatus {
    if (control === 'LIVE' || control === 'PAUSED') return MatchStatus.LIVE;
    if (control === 'COUNTDOWN' || control === 'READY')
      return MatchStatus.DRAFT;
    if (control === 'CONFIRMED') return MatchStatus.FINISHED;
    if (control === 'ENDED') {
      return MatchStatus.ENDED;
    }
    return current;
  }

  private async ensureStatusConsistency(
    matchId: string,
    control: ControlState,
  ): Promise<void> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { status: true, endedAt: true },
    });
    if (!match) return;
    const mapped = this.mapControlToBusinessStatus(control, match.status);
    if (mapped === match.status) return;
    const update: { status: MatchStatus; endedAt?: Date | null } = {
      status: mapped,
    };
    if (mapped === MatchStatus.ENDED || mapped === MatchStatus.FINISHED) {
      update.endedAt = match.endedAt ?? new Date();
    }
    await this.prisma.match.update({ where: { id: matchId }, data: update });
    this.logger.warn(
      `Auto-synced match.status with controlState for match=${matchId}`,
    );
  }

  private emitResultsLockState(matchId: string) {
    if (!this.resultsEvents) return;
    void this.resultsEvents.emitResultsLockState(matchId);
  }

  async getState(matchId: string): Promise<ControlStateSnapshot> {
    try {
      const existing = await this.fetchControlState(matchId);
      if (existing) {
        return {
          matchId: existing.matchId,
          state: existing.state,
          version: existing.version,
          reason: existing.reason ?? null,
          updatedAt: existing.updatedAt,
          updatedByUserId: existing.updatedByUserId ?? null,
          meta: existing.metaJson ?? null,
        };
      }
      const matchOrg = await this.prisma.match.findUnique({
        where: { id: matchId },
        select: {
          status: true,
          dataSource: true,
          tournament: { select: { organizationId: true } },
        },
      });
      const orgId = matchOrg?.tournament?.organizationId ?? null;
      const lockPatch =
        this.hasModelField('MatchControlState', 'resultsManualLock') ||
        this.hasModelField('MatchControlState', 'resultsForceUnlock')
          ? {
              // Keep explicit lock fields false; locking is derived from match status/data source instead.
              resultsManualLock: false,
              resultsForceUnlock: false,
            }
          : {};
      const createData = {
        matchId,
        state: 'READY',
        ...(orgId ? { organizationId: orgId } : {}),
        ...(lockPatch as Record<string, unknown>),
      } as unknown as Prisma.MatchControlStateCreateInput;
      const created = await this.prisma.matchControlState.create({
        data: createData,
      });
      return {
        matchId: created.matchId,
        state: created.state,
        version: created.version,
        reason: created.reason ?? null,
        updatedAt: created.updatedAt,
        updatedByUserId: created.updatedByUserId ?? null,
        meta: null,
      };
    } catch (err) {
      if (this.isSchemaMismatchError(err)) {
        this.handleSchemaMismatch(err);
        const legacy = await this.fetchLegacyControlState(matchId);
        if (legacy) {
          return {
            matchId: legacy.matchId,
            state: legacy.state,
            version: legacy.version,
            reason: legacy.reason ?? null,
            updatedAt: legacy.updatedAt,
            updatedByUserId: legacy.updatedByUserId ?? null,
            meta: legacy.metaJson ?? null,
          };
        }
        // Attempt to bootstrap a READY row in legacy shape.
        const lockCols =
          this.hasModelField('MatchControlState', 'resultsManualLock') &&
          this.hasModelField('MatchControlState', 'resultsForceUnlock');
        const inserted = lockCols
          ? (
              await this.prisma.$queryRaw<
                Array<{
                  matchId: string;
                  state: ControlState;
                  version: number;
                  reason: string | null;
                  updatedAt: Date;
                }>
              >`INSERT INTO "MatchControlState" ("matchId", "state", "version", "reason", "updatedAt", "resultsManualLock", "resultsForceUnlock") VALUES (${matchId}, 'READY', 0, NULL, NOW(), FALSE, FALSE) RETURNING "matchId", "state", "version", "reason", "updatedAt"`
            )[0]
          : (
              await this.prisma.$queryRaw<
                Array<{
                  matchId: string;
                  state: ControlState;
                  version: number;
                  reason: string | null;
                  updatedAt: Date;
                }>
              >`INSERT INTO "MatchControlState" ("matchId", "state", "version", "reason", "updatedAt") VALUES (${matchId}, 'READY', 0, NULL, NOW()) RETURNING "matchId", "state", "version", "reason", "updatedAt"`
            )[0];
        if (inserted) {
          return {
            matchId: inserted.matchId,
            state: inserted.state,
            version: inserted.version ?? 0,
            reason: inserted.reason ?? null,
            updatedAt: inserted.updatedAt ?? new Date(),
            updatedByUserId: null,
            meta: null,
          };
        }
        throw new BadRequestException(
          'Match control state schema is out of date. Run `npx prisma migrate deploy` to apply the f17_control_state migration.',
        );
      }
      throw err;
    }
  }

  async snapshot(matchId: string): Promise<ControlSnapshot> {
    const [match, audits, existingControlState] = await Promise.all([
      this.prisma.match.findUnique({
        where: { id: matchId, deletedAt: null },
        select: {
          id: true,
          name: true,
          status: true,
          dataSource: true,
          pcobStatus: true,
          startedAt: true,
          endedAt: true,
          updatedAt: true,
          tournament: { select: { organizationId: true } },
        },
      }),
      this.prisma.auditLog.findMany({
        where: { entityId: matchId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          action: true,
          userId: true,
          reason: true,
          createdAt: true,
          entityType: true,
          before: true,
          after: true,
          source: true,
        },
      }),
      this.fetchControlState(matchId),
    ]);

    if (!match) throw new NotFoundException('Match not found');

    const controlState: ControlStateSnapshot = existingControlState
      ? {
          matchId: existingControlState.matchId,
          state: existingControlState.state,
          version: existingControlState.version,
          reason: existingControlState.reason ?? null,
          updatedAt: existingControlState.updatedAt,
          updatedByUserId: existingControlState.updatedByUserId ?? null,
          meta: existingControlState.metaJson ?? null,
        }
      : {
          matchId: match.id,
          state: 'READY',
          version: 0,
          reason: null,
          updatedAt: match.updatedAt,
          updatedByUserId: null,
          meta: null,
        };

    // Try to enrich the base snapshot using the game adapter; never throw.
    let enrichedMatch = {
      name: match.name ?? null,
      status: match.status,
      startedAt: match.startedAt,
      endedAt: match.endedAt,
    };
    if (this.adaptersResolver) {
      try {
        const adapter = await this.adaptersResolver.resolve(matchId);
        const adapterSnap = await adapter.getSnapshot(matchId, {
          orgId: match.tournament?.organizationId ?? null,
        });
        const m = adapterSnap?.match;
        if (m) {
          enrichedMatch = {
            name: m.name ?? enrichedMatch.name ?? null,
            status:
              (m.status as MatchStatus | undefined) ?? enrichedMatch.status,
            startedAt:
              (m.startedAt as Date | null | undefined) ??
              enrichedMatch.startedAt,
            endedAt:
              (m.endedAt as Date | null | undefined) ?? enrichedMatch.endedAt,
          };
        }
      } catch (err) {
        this.logger.warn(
          `Adapter snapshot failed for match=${matchId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return {
      match: {
        id: match.id,
        name: enrichedMatch.name ?? null,
        status: enrichedMatch.status,
        dataSource: match.dataSource,
        pcobStatus: match.pcobStatus,
        startedAt: enrichedMatch.startedAt,
        endedAt: enrichedMatch.endedAt,
        updatedAt: match.updatedAt,
      },
      controlState,
      audits,
      system: {
        dataSource: match.dataSource ?? 'MANUAL',
        connection: this.resolveConnection(match.pcobStatus),
      },
    };
  }

  private ensureTransition(current: ControlState, next: ControlState) {
    const allowed = ALLOWED_TRANSITIONS[current] ?? [];
    if (!allowed.includes(next)) {
      throw new BadRequestException(
        `Invalid transition from ${current} to ${next}`,
      );
    }
  }

  private deriveGroupStateFromMatchList(
    matches: Array<{
      id: string;
      controlState: { state: ControlState | null };
    }>,
    override?: { matchId: string; state: ControlState },
  ) {
    const patched = matches.map((m) =>
      override && m.id === override.matchId
        ? { ...m, controlState: { state: override.state } }
        : m,
    );
    return deriveGroupStateFromMatches(
      patched.map((m) => ({
        controlState: { state: m.controlState?.state ?? null },
      })),
    );
  }

  private deriveStageStateFromGroupList(
    groups: Array<{
      id: string;
      matches: Array<{
        id: string;
        controlState: { state: ControlState | null };
      }>;
    }>,
    override?: { matchId: string; state: ControlState },
  ) {
    const patchedGroups = groups.map((g) => ({
      ...g,
      matches: g.matches.map((m) =>
        override && m.id === override.matchId
          ? { ...m, controlState: { state: override.state } }
          : m,
      ),
    }));

    return deriveStageStateFromGroups(
      patchedGroups.map((g) => ({
        matches: g.matches.map((m) => ({
          controlState: { state: m.controlState?.state ?? null },
        })),
        state: deriveGroupStateFromMatches(
          g.matches.map((m) => ({
            controlState: { state: m.controlState?.state ?? null },
          })),
        ),
      })),
    );
  }

  async setState(
    matchId: string,
    nextState: ControlState,
    userId?: string | null,
    reason?: string | null,
    meta?: Record<string, unknown> | null,
  ) {
    const actorId = userId ?? 'system';
    return this.transition(
      matchId,
      nextState,
      {
        id: actorId,
        actorId,
        role: Role.SUPER_ADMIN,
        actorRole: Role.SUPER_ADMIN,
        organizationId: null,
        actingOrgId: null,
      },
      reason,
      meta,
    );
  }

  async transition(
    matchId: string,
    nextState: ControlState,
    actor?: Actor | null,
    reason?: string | null,
    meta?: Record<string, unknown> | null,
  ): Promise<ControlStateSnapshot> {
    const actorId = actor?.actorId ?? actor?.id ?? null;
    const auditUserId = actorId ?? 'system';
    const matchOrg = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        dataSource: true,
        tournament: { select: { organizationId: true } },
      },
    });
    // Handle LIVE/PAUSED via match-control service first to enforce exclusivity/index
    const targetBusinessStatus = this.mapControlToBusinessStatus(
      nextState,
      MatchStatus.DRAFT,
    );
    if (targetBusinessStatus === MatchStatus.LIVE) {
      // Ensure match is set to LIVE with auto-ending of others
      try {
        await this.matchControl.startMatch(actor ?? null, matchId);
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw new ConflictException(
            'Another match is already LIVE in this group',
          );
        }
        throw err;
      }
      await this.ensureStatusConsistency(matchId, nextState);
      // If state is PAUSED, update control-state to reflect it while keeping business status LIVE
      if (nextState === 'PAUSED') {
        const manageLocks =
          this.hasModelField('MatchControlState', 'resultsManualLock') &&
          this.hasModelField('MatchControlState', 'resultsForceUnlock') &&
          matchOrg?.dataSource === 'MANUAL';
        const current =
          (await this.prisma.matchControlState.findUnique({
            where: { matchId },
          })) ??
          (await this.prisma.matchControlState.create({
            data: {
              matchId,
              state: 'READY',
              ...(matchOrg?.tournament?.organizationId
                ? { organizationId: matchOrg.tournament.organizationId }
                : {}),
            } as unknown as Prisma.MatchControlStateCreateInput,
          }));
        const pausedLockPatch = manageLocks
          ? { resultsManualLock: false, resultsForceUnlock: false }
          : {};
        const updated = await this.prisma.matchControlState.update({
          where: { matchId },
          data: {
            state: nextState,
            version: current.version + 1,
            reason: reason ?? null,
            metaJson: (meta ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            updatedByUserId: actorId ?? null,
            ...(pausedLockPatch as Record<string, unknown>),
          },
        });
        this.emitResultsLockState(matchId);
        if (this.gateway) {
          const updatedAtIso = updated.updatedAt.toISOString();
          const changePayload = {
            matchId,
            previousState: current.state,
            state: nextState,
            updatedAt: updatedAtIso,
            reason: updated.reason ?? null,
            meta: meta ?? null,
          };
          this.gateway.emitControlState(matchId, {
            controlState: nextState,
            updatedAt: updatedAtIso,
            byUser: auditUserId,
          });
          this.gateway.emitControlStateChanged(matchId, changePayload);
          this.gateway.emitMatchStateChanged(
            matchId,
            current.state,
            nextState,
            reason ?? null,
            matchOrg?.tournament?.organizationId ?? null,
          );
        }
        return {
          matchId: updated.matchId,
          state: updated.state,
          version: updated.version,
          reason: updated.reason ?? null,
          updatedAt: updated.updatedAt,
          updatedByUserId: updated.updatedByUserId ?? null,
          meta: updated.metaJson ?? null,
        };
      }
      // For LIVE, return current control snapshot
      if (this.overlayBroadcaster) {
        const orgId = matchOrg?.tournament?.organizationId ?? null;
        void this.overlayBroadcaster.forceSync(matchId, orgId);
      }
      return this.getState(matchId);
    }
    try {
      const snapshot = await this.prisma.$transaction(async (tx) => {
        const match = await tx.match.findUnique({
          where: { id: matchId },
          select: {
            id: true,
            status: true,
            endedAt: true,
            groupId: true,
            stageId: true,
            tournament: { select: { organizationId: true } },
            dataSource: true,
            pcobStatus: true,
          },
        });
        if (!match) throw new NotFoundException('Match not found');

        const lockFieldsExist =
          this.hasModelField('MatchControlState', 'resultsManualLock') &&
          this.hasModelField('MatchControlState', 'resultsForceUnlock');
        const manageLocks = lockFieldsExist && match.dataSource === 'MANUAL';
        const lockPatch = manageLocks
          ? { resultsManualLock: false, resultsForceUnlock: false }
          : {};

        const current =
          (await tx.matchControlState.findUnique({
            where: { matchId },
          })) ??
          (await tx.matchControlState.create({
            data: {
              matchId,
              state: 'READY',
              ...(match.tournament?.organizationId
                ? { organizationId: match.tournament.organizationId }
                : {}),
              ...(lockPatch as Record<string, unknown>),
            } as unknown as Prisma.MatchControlStateCreateInput,
          }));

        const rawGroupMatches =
          match.groupId === null
            ? []
            : await tx.match.findMany({
                where: { groupId: match.groupId, deletedAt: null },
                select: {
                  id: true,
                  controlState: { select: { state: true } },
                },
              });
        const groupMatches: MatchControlRow[] = rawGroupMatches.map((m) => ({
          id: m.id,
          controlState: { state: m.controlState?.state ?? null },
        }));

        const rawStageGroups =
          match.stageId === null
            ? []
            : await tx.group.findMany({
                where: { stageId: match.stageId, deletedAt: null },
                select: {
                  id: true,
                  matches: {
                    where: { deletedAt: null },
                    select: {
                      id: true,
                      controlState: { select: { state: true } },
                    },
                  },
                },
              });
        const stageGroups: Array<{
          id: string;
          matches: MatchControlRow[];
        }> = rawStageGroups.map((g) => ({
          id: g.id,
          matches: (g.matches ?? []).map((m) => ({
            id: m.id,
            controlState: { state: m.controlState?.state ?? null },
          })),
        }));

        const needsLockRepair =
          manageLocks &&
          ((current as unknown as { resultsManualLock?: boolean })
            .resultsManualLock !==
            (lockPatch as { resultsManualLock?: boolean }).resultsManualLock ||
            (current as unknown as { resultsForceUnlock?: boolean })
              .resultsForceUnlock !==
              (lockPatch as { resultsForceUnlock?: boolean })
                .resultsForceUnlock);

        if (current.state === nextState && !needsLockRepair) {
          return {
            matchId: current.matchId,
            state: current.state,
            version: current.version,
            reason: current.reason ?? null,
            updatedAt: current.updatedAt,
            updatedByUserId: current.updatedByUserId ?? null,
            meta: current.metaJson ?? null,
          };
        }

        if (current.state !== nextState) {
          this.ensureTransition(current.state, nextState);
        }

        const nextVersion = current.version + 1;

        const reasonPatch =
          reason === undefined ? {} : { reason: reason ?? null };
        const metaPatch =
          meta === undefined
            ? {}
            : {
                metaJson: (meta ?? Prisma.JsonNull) as Prisma.InputJsonValue,
              };

        const updated = await tx.matchControlState.update({
          where: { matchId },
          data: {
            state: nextState,
            version: nextVersion,
            updatedByUserId: actorId ?? null,
            ...(match.tournament?.organizationId
              ? { organizationId: match.tournament.organizationId }
              : {}),
            ...(lockPatch as Record<string, unknown>),
            ...(reasonPatch as Record<string, unknown>),
            ...(metaPatch as Record<string, unknown>),
          },
        });
        this.emitResultsLockState(matchId);

        // Sync business status with control-state change.
        const nextBusinessStatus = this.mapControlToBusinessStatus(
          nextState,
          match.status,
        );
        if (nextBusinessStatus !== match.status) {
          const matchUpdate: { status: MatchStatus; endedAt?: Date | null } = {
            status: nextBusinessStatus,
          };
          if (nextBusinessStatus === MatchStatus.ENDED) {
            matchUpdate.endedAt = new Date();
          }
          await tx.match.update({
            where: { id: matchId },
            data: matchUpdate,
          });
        }

        // Fire-and-forget audit; service already tolerates missing org FK.
        await this.audit.log({
          organizationId: match.tournament?.organizationId ?? null,
          userId: auditUserId,
          action: AuditAction.MATCH_CONTROL_STATE_CHANGED,
          entityType: 'Match',
          entityId: matchId,
          before: {
            state: current.state,
            version: current.version,
            reason: current.reason ?? null,
          },
          after: {
            state: nextState,
            version: updated.version,
            reason: updated.reason ?? null,
            meta: meta ?? null,
          },
          source: 'SYSTEM',
          reason: reason ?? null,
        });

        const updatedAtIso = updated.updatedAt.toISOString();
        const changePayload = {
          matchId,
          previousState: current.state,
          state: nextState,
          updatedAt: updatedAtIso,
          reason: updated.reason ?? null,
          meta: meta ?? null,
        };
        const previousGroupState =
          match.groupId === null
            ? null
            : this.deriveGroupStateFromMatchList(groupMatches);
        const previousStageState =
          match.stageId === null
            ? null
            : this.deriveStageStateFromGroupList(stageGroups);
        const nextGroupState =
          match.groupId === null
            ? null
            : this.deriveGroupStateFromMatchList(groupMatches, {
                matchId,
                state: nextState,
              });
        const nextStageState =
          match.stageId === null
            ? null
            : this.deriveStageStateFromGroupList(stageGroups, {
                matchId,
                state: nextState,
              });
        if (this.gateway) {
          this.gateway.emitControlState(matchId, {
            controlState: nextState,
            updatedAt: updatedAtIso,
            byUser: auditUserId,
          });
          this.gateway.emitControlStateChanged(matchId, changePayload);
          this.gateway.emitMatchStateChanged(
            matchId,
            current.state,
            nextState,
            reason ?? null,
            match.tournament?.organizationId ?? null,
          );
          this.gateway.emitSystemStatus(matchId, {
            dataSource: match.dataSource ?? 'MANUAL',
            connection: this.resolveConnection(match.pcobStatus),
          });
          this.gateway.emitAuditAppend(matchId, {
            action: 'MATCH_CONTROL_STATE_CHANGE',
            byUser: auditUserId,
            matchId,
            from: current.state,
            to: nextState,
            reason: reason ?? null,
            at: updatedAtIso,
          });
          if (
            match.groupId &&
            previousGroupState &&
            nextGroupState &&
            previousGroupState !== nextGroupState
          ) {
            this.gateway.emitGroupStateChanged(
              match.groupId,
              previousGroupState,
              nextGroupState,
              match.tournament?.organizationId ?? null,
            );
          }
          if (
            match.stageId &&
            previousStageState &&
            nextStageState &&
            previousStageState !== nextStageState
          ) {
            this.gateway.emitStageStateChanged(
              match.stageId,
              previousStageState,
              nextStageState,
              match.tournament?.organizationId ?? null,
            );
          }
        }
        if (this.overlayBroadcaster) {
          this.overlayBroadcaster.broadcastControlStateChanged(changePayload);
        }

        return {
          matchId: updated.matchId,
          state: updated.state,
          version: updated.version,
          reason: updated.reason ?? null,
          updatedAt: updated.updatedAt,
          updatedByUserId: updated.updatedByUserId ?? null,
          meta: updated.metaJson ?? null,
        };
      });
      try {
        await this.results.ensureResultsFromSlots(matchId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `[RESULTS][AUTO-GENERATE] Failed to ensure slot results for match ${matchId}: ${msg}`,
        );
      }
      await this.ensureStatusConsistency(matchId, snapshot.state);
      return snapshot;
    } catch (err) {
      if (this.isSchemaMismatchError(err)) {
        this.logger.warn(
          'MatchControlState schema mismatch detected, using legacy transition path',
        );
        return this.legacyTransition(
          matchId,
          nextState,
          actorId,
          auditUserId,
          actor,
          reason,
          meta,
        );
      }
      throw err;
    }
  }

  private resolveConnection(pcobStatus: string | null | undefined): string {
    if (pcobStatus === 'READY') return 'connected';
    if (pcobStatus === 'ERROR') return 'error';
    return 'pending';
  }

  private isSchemaMismatchError(err: unknown): boolean {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2022'
    );
  }

  private handleSchemaMismatch(err: unknown): void {
    this.logger.error(
      'MatchControlState schema is out of date; run `npx prisma migrate deploy` to apply the f17_control_state migration.',
      err instanceof Error ? err.stack : String(err),
    );
  }

  private async fetchLegacyControlState(matchId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        matchId: string;
        state: ControlState;
        version: number;
        reason: string | null;
        updatedAt: Date;
      }>
    >`SELECT "matchId", "state", "version", "reason", "updatedAt" FROM "MatchControlState" WHERE "matchId" = ${matchId} LIMIT 1`;
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.matchId,
      matchId: row.matchId,
      state: row.state,
      version: row.version ?? 0,
      reason: row.reason ?? null,
      metaJson: null,
      updatedAt: row.updatedAt ?? new Date(),
      updatedByUserId: null,
    };
  }

  private async fetchControlState(matchId: string) {
    try {
      return await this.prisma.matchControlState.findUnique({
        where: { matchId },
      });
    } catch (err) {
      if (this.isSchemaMismatchError(err)) {
        this.handleSchemaMismatch(err);
        return this.fetchLegacyControlState(matchId);
      }
      throw err;
    }
  }

  private async legacyTransition(
    matchId: string,
    nextState: ControlState,
    actorId: string | null,
    auditUserId: string,
    actor: Actor | null | undefined,
    reason?: string | null,
    meta?: Record<string, unknown> | null,
  ): Promise<ControlStateSnapshot> {
    return this.prisma.$transaction(async (tx) => {
      const match = await tx.match.findUnique({
        where: { id: matchId },
        select: {
          id: true,
          status: true,
          endedAt: true,
          groupId: true,
          stageId: true,
          tournament: { select: { organizationId: true } },
          dataSource: true,
          pcobStatus: true,
        },
      });
      if (!match) throw new NotFoundException('Match not found');

      const lockCols =
        this.hasModelField('MatchControlState', 'resultsManualLock') &&
        this.hasModelField('MatchControlState', 'resultsForceUnlock');
      const manageLocks = lockCols && match.dataSource === 'MANUAL';
      const lockValues = manageLocks
        ? { resultsManualLock: false, resultsForceUnlock: false }
        : null;
      const organizationId: string | null =
        match.tournament?.organizationId ?? null;

      const legacyGroupMatchesRaw =
        match.groupId === null
          ? []
          : await tx.match.findMany({
              where: { groupId: match.groupId, deletedAt: null },
              select: {
                id: true,
                controlState: { select: { state: true } },
              },
            });
      const groupMatches: MatchControlRow[] = legacyGroupMatchesRaw.map(
        (m) => ({
          id: m.id,
          controlState: { state: m.controlState?.state ?? null },
        }),
      );

      const legacyStageGroupsRaw =
        match.stageId === null
          ? []
          : await tx.group.findMany({
              where: { stageId: match.stageId, deletedAt: null },
              select: {
                id: true,
                matches: {
                  where: { deletedAt: null },
                  select: {
                    id: true,
                    controlState: { select: { state: true } },
                  },
                },
              },
            });
      const stageGroups: Array<{
        id: string;
        matches: MatchControlRow[];
      }> = legacyStageGroupsRaw.map((g) => ({
        id: g.id,
        matches: (g.matches ?? []).map((m) => ({
          id: m.id,
          controlState: { state: m.controlState?.state ?? null },
        })),
      }));

      const existing = await this.fetchLegacyControlState(matchId);
      const current =
        existing ??
        (manageLocks
          ? (
              await this.prisma.$queryRaw<
                Array<{
                  matchId: string;
                  state: ControlState;
                  version: number;
                  reason: string | null;
                  updatedAt: Date;
                }>
              >`INSERT INTO "MatchControlState" ("matchId", "state", "version", "reason", "updatedAt", "resultsManualLock", "resultsForceUnlock") VALUES (${matchId}, 'READY', 0, NULL, NOW(), FALSE, FALSE) RETURNING "matchId", "state", "version", "reason", "updatedAt"`
            )[0]
          : (
              await this.prisma.$queryRaw<
                Array<{
                  matchId: string;
                  state: ControlState;
                  version: number;
                  reason: string | null;
                  updatedAt: Date;
                }>
              >`INSERT INTO "MatchControlState" ("matchId", "state", "version", "reason", "updatedAt") VALUES (${matchId}, 'READY', 0, NULL, NOW()) RETURNING "matchId", "state", "version", "reason", "updatedAt"`
            )[0]);

      if (!current) {
        throw new BadRequestException('Unable to initialize control state');
      }

      if (current.state === nextState) {
        return {
          matchId: current.matchId,
          state: current.state,
          version: current.version,
          reason: current.reason ?? null,
          updatedAt: current.updatedAt,
          updatedByUserId: actorId ?? null,
          meta: null,
        };
      }

      this.ensureTransition(current.state, nextState);

      const updated = (
        await tx.$queryRaw<
          Array<{
            matchId: string;
            state: ControlState;
            version: number;
            reason: string | null;
            updatedAt: Date;
          }>
        >`UPDATE "MatchControlState" SET "state" = ${nextState}, "version" = ${
          (current.version ?? 0) + 1
        }, "reason" = ${reason ?? null}, "updatedAt" = NOW()${
          manageLocks && lockValues
            ? `, "resultsManualLock" = ${lockValues.resultsManualLock}, "resultsForceUnlock" = ${lockValues.resultsForceUnlock}`
            : ''
        } WHERE "matchId" = ${matchId} RETURNING "matchId", "state", "version", "reason", "updatedAt"`
      )[0];
      this.emitResultsLockState(matchId);

      // Sync business status with control-state change.
      const nextBusinessStatus = this.mapControlToBusinessStatus(
        nextState,
        match.status,
      );
      if (nextBusinessStatus !== match.status) {
        const matchUpdate: { status: MatchStatus; endedAt?: Date | null } = {
          status: nextBusinessStatus,
        };
        if (nextBusinessStatus === MatchStatus.ENDED) {
          matchUpdate.endedAt = new Date();
        }
        await tx.match.update({
          where: { id: matchId },
          data: matchUpdate,
        });
      }

      await this.audit.log({
        organizationId,
        userId: auditUserId,
        action: AuditAction.MATCH_CONTROL_STATE_CHANGED,
        entityType: 'Match',
        entityId: matchId,
        before: {
          state: current.state,
          version: current.version,
          reason: current.reason ?? null,
        },
        after: {
          state: nextState,
          version: (current.version ?? 0) + 1,
          reason: reason ?? null,
          meta: meta ?? null,
        },
        source: 'SYSTEM',
        reason: reason ?? null,
      });

      const updatedAtIso = (updated?.updatedAt ?? new Date()).toISOString();
      const changePayload = {
        matchId,
        previousState: current.state,
        state: nextState,
        updatedAt: updatedAtIso,
        reason: updated?.reason ?? null,
        meta: meta ?? null,
      };
      const previousGroupState =
        match.groupId === null
          ? null
          : this.deriveGroupStateFromMatchList(groupMatches);
      const previousStageState =
        match.stageId === null
          ? null
          : this.deriveStageStateFromGroupList(stageGroups);
      const nextGroupState =
        match.groupId === null
          ? null
          : this.deriveGroupStateFromMatchList(groupMatches, {
              matchId,
              state: nextState,
            });
      const nextStageState =
        match.stageId === null
          ? null
          : this.deriveStageStateFromGroupList(stageGroups, {
              matchId,
              state: nextState,
            });
      if (this.gateway) {
        this.gateway.emitControlState(matchId, {
          controlState: nextState,
          updatedAt: updatedAtIso,
          byUser: auditUserId,
        });
        this.gateway.emitControlStateChanged(matchId, changePayload);
        this.gateway.emitSystemStatus(matchId, {
          dataSource: match.dataSource ?? 'MANUAL',
          connection: this.resolveConnection(match.pcobStatus),
        });
        this.gateway.emitAuditAppend(matchId, {
          action: 'MATCH_CONTROL_STATE_CHANGE',
          byUser: auditUserId,
          matchId,
          from: current.state,
          to: nextState,
          reason: reason ?? null,
          at: updatedAtIso,
        });
      }
      if (this.overlayBroadcaster) {
        this.overlayBroadcaster.broadcastControlStateChanged(changePayload);
      }
      if (
        this.gateway &&
        match.groupId &&
        previousGroupState &&
        nextGroupState &&
        previousGroupState !== nextGroupState
      ) {
        this.gateway.emitGroupStateChanged(
          match.groupId,
          previousGroupState,
          nextGroupState,
          organizationId,
        );
      }
      if (
        this.gateway &&
        match.stageId &&
        previousStageState &&
        nextStageState &&
        previousStageState !== nextStageState
      ) {
        this.gateway.emitStageStateChanged(
          match.stageId,
          previousStageState,
          nextStageState,
          organizationId,
        );
      }

      await this.ensureStatusConsistency(matchId, nextState);
      return {
        matchId: updated?.matchId ?? matchId,
        state: nextState,
        version: (current.version ?? 0) + 1,
        reason: updated?.reason ?? null,
        updatedAt: updated?.updatedAt ?? new Date(),
        updatedByUserId: actorId ?? null,
        meta: null,
      };
    });
  }
}

export { ALLOWED_TRANSITIONS };
