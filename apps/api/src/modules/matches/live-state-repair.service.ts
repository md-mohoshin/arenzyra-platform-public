import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { LiveState, Prisma } from '@prisma/client';
import {
  type ControlLike,
  deriveGroupStateFromMatches,
  deriveStageStateFromGroups,
  deriveTournamentStateFromMatches,
} from '../../common/live-state.util';
import { PrismaService } from '../../db/prisma.service';

type RepairCounts = {
  groups: number;
  stages: number;
  tournaments: number;
};

const envFlagEnabled = (value: string | null | undefined): boolean => {
  const normalized = (value ?? '').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(normalized);
};

@Injectable()
export class LiveStateRepairService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveStateRepairService.name);
  private readonly enabled = envFlagEnabled(
    process.env.LIVE_STATE_REPAIR_ENABLED,
  );
  private readonly intervalMs = Math.max(
    30_000,
    Number(process.env.LIVE_STATE_REPAIR_INTERVAL_MS ?? 60_000),
  );
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (!this.enabled) {
      this.logger.log('Live-state repair disabled');
      return;
    }

    this.timer = setInterval(
      () => void this.reconcile('interval'),
      this.intervalMs,
    );
    void this.reconcile('startup');
    this.logger.log(`Live-state repair started @ ${this.intervalMs}ms`);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = null;
  }

  async reconcile(reason: 'startup' | 'interval' | 'manual' = 'manual') {
    if (!this.enabled) {
      return { groups: 0, stages: 0, tournaments: 0, skipped: true };
    }

    if (this.inFlight) {
      return { groups: 0, stages: 0, tournaments: 0, skipped: true };
    }

    this.inFlight = true;
    const startedAt = Date.now();

    try {
      const counts = await this.runRepairPass();
      const durationMs = Date.now() - startedAt;

      if (
        reason !== 'interval' ||
        counts.groups > 0 ||
        counts.stages > 0 ||
        counts.tournaments > 0
      ) {
        this.logger.log(
          `Live-state repair ${reason} completed in ${durationMs}ms ` +
            `(groups=${counts.groups}, stages=${counts.stages}, tournaments=${counts.tournaments})`,
        );
      }

      return { ...counts, skipped: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Live-state repair ${reason} failed: ${message}`);
      return { groups: 0, stages: 0, tournaments: 0, skipped: false };
    } finally {
      this.inFlight = false;
    }
  }

  private async runRepairPass(): Promise<RepairCounts> {
    const counts: RepairCounts = {
      groups: 0,
      stages: 0,
      tournaments: 0,
    };

    const groupSnapshots = await this.prisma.group.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        stageId: true,
        liveState: true,
        liveAt: true,
        endedAt: true,
        matches: {
          where: { deletedAt: null },
          select: { controlState: { select: { state: true } } },
        },
      },
    });

    const derivedGroupStates = new Map<string, LiveState>();
    for (const group of groupSnapshots) {
      const next = deriveGroupStateFromMatches(
        (group.matches ?? []) as ControlLike[],
      ) as LiveState;
      derivedGroupStates.set(group.id, next);

      if (await this.updateEntityLiveState('group', group, next)) {
        counts.groups += 1;
      }
    }

    const groupedByStage = new Map<string, LiveState[]>();
    for (const group of groupSnapshots) {
      const derivedState =
        derivedGroupStates.get(group.id) ?? LiveState.UPCOMING;
      const states = groupedByStage.get(group.stageId) ?? [];
      states.push(derivedState);
      groupedByStage.set(group.stageId, states);
    }

    const stageSnapshots = await this.prisma.stage.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        tournamentId: true,
        liveState: true,
        liveAt: true,
        endedAt: true,
        matches: {
          where: { deletedAt: null },
          select: { controlState: { select: { state: true } } },
        },
      },
    });

    for (const stage of stageSnapshots) {
      const groupStates = groupedByStage.get(stage.id) ?? [];
      const next =
        groupStates.length > 0
          ? (deriveStageStateFromGroups(
              groupStates.map((state) => ({ state })),
            ) as LiveState)
          : (deriveGroupStateFromMatches(
              (stage.matches ?? []) as ControlLike[],
            ) as LiveState);
      if (await this.updateEntityLiveState('stage', stage, next)) {
        counts.stages += 1;
      }
    }

    const tournamentSnapshots = await this.prisma.tournament.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        liveState: true,
        liveAt: true,
        endedAt: true,
        matches: {
          where: { deletedAt: null },
          select: { controlState: { select: { state: true } } },
        },
      },
    });

    for (const tournament of tournamentSnapshots) {
      const next = deriveTournamentStateFromMatches(
        (tournament.matches ?? []) as ControlLike[],
      ) as LiveState;
      if (await this.updateEntityLiveState('tournament', tournament, next)) {
        counts.tournaments += 1;
      }
    }

    return counts;
  }

  private async updateEntityLiveState(
    entity: 'group' | 'stage' | 'tournament',
    current: {
      id: string;
      liveState: LiveState | null;
      liveAt: Date | null;
      endedAt: Date | null;
    },
    next: LiveState,
  ): Promise<boolean> {
    const now = new Date();
    const shouldUpdate =
      current.liveState !== next ||
      (next === LiveState.LIVE && !current.liveAt) ||
      (next === LiveState.ENDED && !current.endedAt);

    if (!shouldUpdate) {
      return false;
    }

    const data: Record<string, unknown> = {
      liveState: next,
    };

    if (next === LiveState.LIVE) {
      data.liveAt = current.liveAt ?? now;
    } else if (next === LiveState.ENDED) {
      data.endedAt = current.endedAt ?? now;
    }

    switch (entity) {
      case 'group':
        await this.prisma.group.update({
          where: { id: current.id },
          data: data as Prisma.GroupUpdateInput,
        });
        return true;
      case 'stage':
        await this.prisma.stage.update({
          where: { id: current.id },
          data: data as Prisma.StageUpdateInput,
        });
        return true;
      case 'tournament':
        await this.prisma.tournament.update({
          where: { id: current.id },
          data: data as Prisma.TournamentUpdateInput,
        });
        return true;
    }

    return false;
  }
}
