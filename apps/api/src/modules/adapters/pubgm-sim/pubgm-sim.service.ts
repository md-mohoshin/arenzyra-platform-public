import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../../db/prisma.service';
import { OverlayBroadcaster } from '../../realtime/overlay-broadcaster.service';
import {
  MatchControlStateStore,
  type LiveMatchState,
} from '../../match-control/state.store';
import { LiveStateMirrorService } from '../../match-control/live-state-mirror.service';
import { PubgmSimEngine } from './pubgm-sim.engine';
import {
  PUBGM_SIM_ADAPTER_KEY,
  PubgmSimJumpParams,
  PubgmSimStartParams,
  SimSnapshot,
  SimTeam,
} from './pubgm-sim.types';

const DEFAULT_SIM_TEAM_NAME = 'Arenzyra';

type EngineEntry = {
  engine: PubgmSimEngine;
  snapshot: SimSnapshot;
};

@Injectable()
export class PubgmSimService implements OnModuleDestroy {
  private readonly logger = new Logger(PUBGM_SIM_ADAPTER_KEY);
  private readonly engines = new Map<string, EngineEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly overlay: OverlayBroadcaster,
    private readonly store: MatchControlStateStore,
    private readonly liveStateMirror: LiveStateMirrorService,
  ) {}

  onModuleDestroy() {
    this.engines.forEach((entry) => entry.engine.stop());
    this.engines.clear();
  }

  async start(params: PubgmSimStartParams) {
    const { matchId, tickMs, seed } = params;
    const teams = await this.loadTeams(matchId);
    const engine = new PubgmSimEngine(matchId, teams, {
      tickMs: tickMs ?? 1000,
      seed,
      onUpdate: (snap) => {
        void this.handleUpdate(matchId, snap);
      },
    });
    const initialSnap = engine.snapshot();
    this.engines.set(matchId, { engine, snapshot: initialSnap });
    this.logger.log(
      `PUBGM sim started match=${matchId} tickMs=${tickMs ?? 1000} seed=${seed ?? 'auto'} teams=${
        teams.length
      }`,
    );
    engine.start();
    return { ok: true, snapshot: initialSnap };
  }

  stop(matchId: string) {
    const entry = this.engines.get(matchId);
    if (entry) {
      entry.engine.stop();
      this.engines.delete(matchId);
      this.logger.log(`PUBGM sim stopped match=${matchId}`);
      return { ok: true, stopped: true };
    }
    return { ok: true, stopped: false };
  }

  state(matchId: string) {
    const entry = this.engines.get(matchId);
    if (!entry) return { matchId, running: false };
    return { matchId, running: true, snapshot: entry.snapshot };
  }

  jump(params: PubgmSimJumpParams) {
    const entry = this.engines.get(params.matchId);
    if (!entry) return { ok: false, error: 'Simulator not running' };
    entry.engine.forcePhase(params.phase);
    return { ok: true, phase: params.phase };
  }

  private async loadTeams(matchId: string): Promise<SimTeam[]> {
    try {
      const slots = await this.prisma.matchSlot.findMany({
        where: { matchId },
        orderBy: { slotNumber: 'asc' },
        include: {
          team: {
            select: { id: true, name: true, tag: true },
          },
        },
      });
      const teams: SimTeam[] = [];
      slots.forEach((slot, idx) => {
        const id = slot.team?.id ?? `team-${idx + 1}`;
        const name =
          slot.team?.name ??
          slot.team?.tag ??
          DEFAULT_SIM_TEAM_NAME;
        teams.push({
          teamId: id,
          teamName: name,
          slot: slot.slotNumber ?? idx + 1,
          alive: true,
          kills: 0,
        });
      });
      if (teams.length > 0) return teams;

      const matchTeams = await this.prisma.matchTeam.findMany({
        where: { matchId },
        include: { team: { select: { id: true, name: true, tag: true } } },
      });
      matchTeams.forEach((mt, idx) => {
        const id = mt.team?.id ?? `team-${idx + 1}`;
        const name = mt.team?.name ?? mt.team?.tag ?? DEFAULT_SIM_TEAM_NAME;
        teams.push({ teamId: id, teamName: name, alive: true, kills: 0 });
      });
      if (teams.length > 0) return teams;
    } catch (err) {
      this.logger.warn(
        `Failed to load teams for match=${matchId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // fallback placeholder teams
    return Array.from({ length: 16 }).map((_, idx) => ({
      teamId: `team-${idx + 1}`,
      teamName: DEFAULT_SIM_TEAM_NAME,
      slot: idx + 1,
      alive: true,
      kills: 0,
    }));
  }

  private async handleUpdate(matchId: string, snapshot: SimSnapshot) {
    this.engines.set(matchId, {
      engine: this.engines.get(matchId)!.engine,
      snapshot,
    });
    await this.persistLiveState(snapshot).catch(() => undefined);
    void this.emitOverlay(matchId, snapshot);
  }

  private async persistLiveState(snapshot: SimSnapshot) {
    const current = await this.store.get(snapshot.matchId);
    const teams: LiveMatchState['teams'] = snapshot.teams.map((t) => ({
      teamId: t.teamId,
      name: t.teamName,
      tag: null,
      slot: t.slot ?? null,
      kills: t.kills,
      placement: t.placement ?? null,
      points: null,
      logoUrl: null,
      alive: t.alive,
    }));
    const state: LiveMatchState = {
      matchId: snapshot.matchId,
      status: snapshot.phase === 'FINISHED' ? 'ENDED' : 'LIVE',
      startedAt: null,
      endedAt: snapshot.phase === 'FINISHED' ? new Date().toISOString() : null,
      version: (current?.version ?? 0) + 1,
      updatedAt: snapshot.updatedAt,
      teams,
    };
    await this.liveStateMirror.publish(state);
  }

  private async resolveOrg(matchId: string): Promise<string | null> {
    try {
      const match = (await this.prisma.match.findFirst({
        where: { id: matchId, deletedAt: null },
        select: {
          tournament: { select: { organizationId: true } },
        },
      })) as {
        tournament: { organizationId: string | null } | null;
      } | null;
      return match?.tournament?.organizationId ?? null;
    } catch {
      return null;
    }
  }

  private async emitOverlay(matchId: string, snapshot: SimSnapshot) {
    try {
      const teams = snapshot.teams.map((t) => ({
        teamId: t.teamId,
        name: t.teamName,
        tag: null,
        slot: t.slot ?? null,
        kills: t.kills,
        placement: t.placement ?? null,
        points: null,
        logoUrl: null,
        alivePlayers: t.alive ? 4 : 0,
        totalPlayers: 4,
        alive: t.alive,
      }));
      const state: LiveMatchState = {
        matchId,
        status: snapshot.phase === 'FINISHED' ? 'ENDED' : 'LIVE',
        startedAt: null,
        endedAt:
          snapshot.phase === 'FINISHED' ? new Date().toISOString() : null,
        version: snapshot.events.length,
        updatedAt: snapshot.updatedAt,
        teams,
      };
      const orgId = await this.resolveOrg(matchId);
      this.overlay.broadcastUpdate(
        matchId,
        {
          matchId: state.matchId,
          status: state.status,
          startedAt: state.startedAt,
          endedAt: state.endedAt,
          version: state.version,
          updatedAt: state.updatedAt,
          teams: teams,
        },
        orgId ?? null,
      );
    } catch (err) {
      this.logger.warn(
        `Overlay emit failed for match=${matchId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
