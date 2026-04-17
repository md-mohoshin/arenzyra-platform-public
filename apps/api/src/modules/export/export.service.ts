import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { PcobEventsService } from '../pcob/pcob-events.service';
import { WebhookService } from '../webhook/webhook.service';
import { PrismaService } from '../../db/prisma.service';

type TelemetryPayload = {
  type?: string;
  ts?: number;
  eventType?: string;
  payload?: Record<string, unknown> | null;
  [k: string]: unknown;
};
type TeamState = {
  aliveAt?: number;
  eliminatedAt?: number;
  placement?: number;
};
type MatchState = {
  matchId: string;
  startedAt?: number;
  ended?: boolean;
  teams: Map<string, TeamState>;
};

@Injectable()
export class ExportService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ExportService');
  private unsubscribe: (() => void) | null = null;
  private matches = new Map<string, MatchState>();

  private exportEnabled = process.env.EXPORT_ENABLED !== 'false';
  private csvEnabled = process.env.EXPORT_CSV !== 'false';
  private restEnabled = process.env.EXPORT_REST !== 'false';

  onModuleInit(): void {
    if (!this.exportEnabled) {
      this.logger.log('[EXPORT] export disabled');
      return;
    }
    this.unsubscribe = this.pcobEvents.onTelemetry((evt) => {
      void (async () => {
        try {
          const orgId = await this.lookupOrg(evt.matchId);
          if (!orgId) return;
          this.handleTelemetry(evt.matchId, evt.payload, orgId);
        } catch (err) {
          this.logger.error(
            `[EXPORT] telemetry handler error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      })();
    });
    this.logger.log('[EXPORT] export layer initialized');
  }

  onModuleDestroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  constructor(
    @Inject(forwardRef(() => PcobEventsService))
    private readonly pcobEvents: PcobEventsService,
    private readonly webhooks: WebhookService,
    private readonly prisma: PrismaService,
  ) {}

  getMatches(): Array<{
    matchId: string;
    startedAt: number | null;
    ended: boolean;
    teamCount: number;
  }> {
    return Array.from(this.matches.values()).map((m) => ({
      matchId: m.matchId,
      startedAt: m.startedAt ?? null,
      ended: m.ended ?? false,
      teamCount: m.teams.size,
    }));
  }

  getMatch(matchId: string): {
    matchId: string;
    startedAt: number | null;
    ended: boolean;
    teams: Array<{
      team: string;
      aliveAt: number | null;
      eliminatedAt: number | null;
      placement: number | null;
    }>;
  } | null {
    const m = this.matches.get(matchId);
    if (!m) return null;
    return {
      matchId: m.matchId,
      startedAt: m.startedAt ?? null,
      ended: m.ended ?? false,
      teams: Array.from(m.teams.entries()).map(([team, s]) => ({
        team,
        aliveAt: s.aliveAt ?? null,
        eliminatedAt: s.eliminatedAt ?? null,
        placement: s.placement ?? null,
      })),
    };
  }

  getTeams(matchId: string): string[] {
    const m = this.matches.get(matchId);
    if (!m) return [];
    return Array.from(m.teams.keys());
  }

  getPlacements(matchId: string): Array<{
    team: string;
    placement: number;
    eliminatedAt: number | null;
    aliveDurationSec: number | null;
  }> {
    const m = this.matches.get(matchId);
    if (!m) return [];
    return Array.from(m.teams.entries())
      .filter(([, s]) => s.placement !== undefined)
      .map(([team, s]) => ({
        team,
        placement: s.placement!,
        eliminatedAt: s.eliminatedAt ?? null,
        aliveDurationSec: this.computeAliveDuration(s),
      }))
      .sort((a, b) => (a.placement || 999) - (b.placement || 999));
  }

  private state(matchId: string): MatchState {
    if (!this.matches.has(matchId)) {
      this.matches.set(matchId, { matchId, teams: new Map() });
    }
    return this.matches.get(matchId)!;
  }

  private computeAliveDuration(team: TeamState): number | null {
    if (!team.aliveAt) return null;
    const end = team.eliminatedAt ?? Date.now();
    return Math.max(0, Math.floor((end - team.aliveAt) / 1000));
  }

  private async lookupOrg(matchId: string): Promise<string | null> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        organizationId: true,
        tournament: { select: { organizationId: true } },
      },
    });
    return match?.organizationId ?? match?.tournament?.organizationId ?? null;
  }

  private handleTelemetry(
    matchId: string,
    payload: TelemetryPayload,
    organizationId: string,
  ): void {
    if (!matchId || !payload) return;
    if (!organizationId) return;
    const type = String(payload.type || payload.eventType || '').toUpperCase();
    if (!type) return;
    const ts = Number(payload.ts ?? Date.now());

    const match = this.state(matchId);
    if (type === 'MATCH_LIVE') {
      match.startedAt = ts;
      this.webhooks.enqueue('match.live', matchId, { ts });
      return;
    }

    if (type === 'TEAM_ALIVE') {
      const teamRaw = payload?.payload?.team ?? payload.team;
      if (typeof teamRaw !== 'string') return;
      const team = teamRaw;
      const t: TeamState = match.teams.get(team) ?? ({} as TeamState);
      if (!t.aliveAt) t.aliveAt = ts;
      match.teams.set(team, t);
      return;
    }

    if (type === 'TEAM_ELIMINATED') {
      const teamRaw = payload?.payload?.team ?? payload.team;
      if (typeof teamRaw !== 'string') return;
      const team = teamRaw;
      const t: TeamState = match.teams.get(team) ?? ({} as TeamState);
      if (!t.eliminatedAt) t.eliminatedAt = ts;
      match.teams.set(team, t);
      this.webhooks.enqueue('team.eliminated', matchId, { team, ts });
      return;
    }

    if (type === 'TEAM_PLACEMENT') {
      const teamRaw = payload?.payload?.team ?? payload.team;
      const placement = payload?.payload?.placement ?? payload.placement;
      const eliminatedAt =
        payload?.payload?.eliminatedAt ?? payload.eliminatedAt ?? ts;
      if (typeof teamRaw !== 'string' || placement === undefined) return;
      const team = teamRaw;
      const t: TeamState = match.teams.get(team) ?? ({} as TeamState);
      t.placement = Number(placement);
      if (!t.eliminatedAt) t.eliminatedAt = Number(eliminatedAt);
      match.teams.set(team, t);
      this.webhooks.enqueue('team.placement', matchId, {
        team,
        placement: Number(placement),
        eliminatedAt: Number(eliminatedAt),
      });
      return;
    }

    if (type === 'MATCH_END' || type === 'MATCH_ENDED') {
      match.ended = true;
      void this.finalizeCsv(matchId);
      this.webhooks.enqueue('match.end', matchId, { ts });
    }
  }

  private async finalizeCsv(matchId: string): Promise<void> {
    if (!this.exportEnabled || !this.csvEnabled) return;
    const match = this.matches.get(matchId);
    if (!match) return;
    try {
      const rows = [
        'match_id,team_id,placement,eliminated_at_ts,alive_duration_sec',
      ];
      for (const [team, st] of match.teams.entries()) {
        const placement = st.placement ?? '';
        const eliminated = st.eliminatedAt ?? '';
        const dur = this.computeAliveDuration(st) ?? '';
        rows.push(`${matchId},${team},${placement},${eliminated},${dur}`);
      }
      const dir = path.join(process.cwd(), 'exports', 'matches');
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, `${matchId}.csv`);
      await fs.writeFile(file, rows.join('\n'), 'utf-8');
      this.logger.log(`[EXPORT] CSV written ${file}`);
    } catch (err) {
      this.logger.error(
        `[EXPORT] CSV write failed for match ${matchId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
