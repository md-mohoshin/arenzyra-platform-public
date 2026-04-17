import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PcobEventsService } from '../pcob/pcob-events.service';
import { WebhookService } from '../webhook/webhook.service';
import { PrismaService } from '../../db/prisma.service';
import { normalizePublicAssetUrl } from '../../common/public-asset-url.util';
import { resolveTeamLogoUrl } from '../../common/team-branding.util';

type TelemetryPayload = {
  type?: string;
  eventType?: string;
  payload?: Record<string, unknown> | null;
  ts?: number;
};
type PositionState = { x: number; y: number; ts: number; lastMoveTs: number };
type SuggestionType = 'CLUSTER' | 'STATIONARY';
type Suggestion = {
  type: SuggestionType;
  teamIds: string[];
  confidence: number;
  reason: string;
  ts: number;
  expiresAt: number;
};

@Injectable()
export class ObserverService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ObserverService');
  private unsubscribe: (() => void) | null = null;

  private positions = new Map<string, Map<string, PositionState>>(); // match -> team -> pos
  private suggestions = new Map<string, Suggestion[]>(); // match -> suggestions
  private lastTypeTs = new Map<string, Map<SuggestionType, number>>(); // match -> type -> ts

  private readonly windowMs = 15_000;
  private readonly stationaryMs = 8_000;
  private readonly rateLimitMs = 10_000;
  private readonly expireMs = 20_000;
  private readonly clusterDist = 0.05;
  private readonly moveThreshold = 0.01;

  constructor(
    private readonly pcobEvents: PcobEventsService,
    private readonly webhooks: WebhookService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.pcobEvents.onTelemetry((evt) => {
      void (async () => {
        const orgId = await this.lookupOrg(evt.matchId);
        if (!orgId) return;
        this.handleTelemetry(evt.matchId, evt.payload);
      })();
    });
    this.logger.log('[OBSERVER] initialized');
  }

  onModuleDestroy(): void {
    if (this.unsubscribe) this.unsubscribe();
  }

  getSuggestions(matchId: string): Suggestion[] {
    const now = Date.now();
    this.pruneSuggestions(matchId, now);
    return this.suggestions.get(matchId) ?? [];
  }

  async getMatchSlots(matchId: string) {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        controlState: {
          select: {
            metaJson: true,
          },
        },
      },
    });
    if (!match) {
      throw new NotFoundException('Match not found');
    }

    const missedSlotNumbers = new Set<number>(
      Array.isArray(
        (match.controlState?.metaJson as Record<string, unknown> | null)
          ?.missedSlotNumbers,
      )
        ? (
            (match.controlState?.metaJson as Record<string, unknown> | null)
              ?.missedSlotNumbers as unknown[]
          )
            .map((entry) =>
              typeof entry === 'number' && Number.isFinite(entry)
                ? Math.trunc(entry)
                : typeof entry === 'string' && entry.trim().length > 0
                  ? Math.trunc(Number(entry))
                  : null,
            )
            .filter(
              (entry): entry is number =>
                entry !== null && Number.isFinite(entry) && entry > 0,
            )
        : [],
    );

    const slots = await this.prisma.matchSlot.findMany({
      where: { matchId: match.id, deletedAt: null },
      orderBy: { slotNumber: 'asc' },
      select: {
        id: true,
        matchId: true,
        slotNumber: true,
        teamId: true,
        lobbyStatus: true,
        playersInLobby: true,
        team: {
          select: {
            id: true,
            name: true,
            tag: true,
            logoUrl: true,
            accentLight: true,
            accentDark: true,
          },
        },
      } as const,
    });

    return slots.map((slot) => ({
      ...slot,
      team: slot.team
        ? {
            ...slot.team,
            logoUrl:
              resolveTeamLogoUrl(slot.team.id, slot.team.logoUrl) ??
              normalizePublicAssetUrl(slot.team.logoUrl),
          }
        : null,
      attendanceStatus: missedSlotNumbers.has(slot.slotNumber)
        ? 'MISSED'
        : null,
    }));
  }

  private isRecord(val: unknown): val is Record<string, unknown> {
    return !!val && typeof val === 'object';
  }

  private handleTelemetry(matchId: string, payload: TelemetryPayload) {
    const type = String(
      payload?.type || payload?.eventType || '',
    ).toUpperCase();
    if (!type) return;
    this.logger.log(`[OBSERVER] telemetry received: ${type}`);

    if (!matchId) return;
    if (type !== 'TEAM_MINIMAP_PRESENCE') return; // only minimap used for now

    const data = this.isRecord(payload?.payload) ? payload?.payload : {};
    const team = data.team as string | undefined;
    const x = typeof data.x === 'number' ? data.x : null;
    const y = typeof data.y === 'number' ? data.y : null;
    if (!team || x === null || y === null) return;
    const now = Number(payload?.ts ?? Date.now());

    this.upsertPosition(matchId, team, x, y, now);
    this.prunePositions(matchId, now);
    this.pruneSuggestions(matchId, now);

    this.detectStationary(matchId, team, now);
    this.detectCluster(matchId, now);
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

  private upsertPosition(
    matchId: string,
    team: string,
    x: number,
    y: number,
    ts: number,
  ) {
    if (!this.positions.has(matchId)) this.positions.set(matchId, new Map());
    const map = this.positions.get(matchId)!;
    const prev = map.get(team);
    let lastMoveTs = prev?.lastMoveTs ?? ts;
    if (prev) {
      const dx = x - prev.x;
      const dy = y - prev.y;
      const dist = Math.hypot(dx, dy);
      if (dist > this.moveThreshold) lastMoveTs = ts;
    }
    map.set(team, { x, y, ts, lastMoveTs });
  }

  private prunePositions(matchId: string, now: number) {
    const map = this.positions.get(matchId);
    if (!map) return;
    for (const [team, pos] of map.entries()) {
      if (now - pos.ts > this.windowMs) {
        map.delete(team);
      }
    }
  }

  private pruneSuggestions(matchId: string, now: number) {
    if (!this.suggestions.has(matchId)) return;
    const pruned = (this.suggestions.get(matchId) || []).filter(
      (s) => s.expiresAt > now,
    );
    this.suggestions.set(matchId, pruned);
  }

  private canEmit(matchId: string, type: SuggestionType, now: number) {
    if (!this.lastTypeTs.has(matchId)) this.lastTypeTs.set(matchId, new Map());
    const last = this.lastTypeTs.get(matchId)!.get(type) ?? 0;
    return now - last >= this.rateLimitMs;
  }

  private markEmit(matchId: string, type: SuggestionType, now: number) {
    if (!this.lastTypeTs.has(matchId)) this.lastTypeTs.set(matchId, new Map());
    this.lastTypeTs.get(matchId)!.set(type, now);
  }

  private existingSuggestion(
    matchId: string,
    type: SuggestionType,
    teamIds: string[],
  ) {
    const current = this.suggestions.get(matchId) || [];
    const key = teamIds.slice().sort().join(',');
    return current.find(
      (s) => s.type === type && s.teamIds.slice().sort().join(',') === key,
    );
  }

  private detectStationary(matchId: string, team: string, now: number) {
    const map = this.positions.get(matchId);
    if (!map) return;
    const pos = map.get(team);
    if (!pos) return;
    if (now - pos.lastMoveTs < this.stationaryMs) return;
    if (!this.canEmit(matchId, 'STATIONARY', now)) return;
    if (this.existingSuggestion(matchId, 'STATIONARY', [team])) return;

    const confidence = Math.min(1, (now - pos.lastMoveTs) / this.stationaryMs);
    const suggestion: Suggestion = {
      type: 'STATIONARY',
      teamIds: [team],
      confidence,
      reason: `stationary >= ${this.stationaryMs / 1000}s`,
      ts: now,
      expiresAt: now + this.expireMs,
    };
    this.addSuggestion(matchId, suggestion);
  }

  private detectCluster(matchId: string, now: number) {
    const map = this.positions.get(matchId);
    if (!map) return;
    const entries = Array.from(map.entries()).filter(
      ([, pos]) => now - pos.ts <= this.windowMs,
    );
    if (entries.length < 3) return;

    // naive clustering: find any set of >=3 within clusterDist of each other
    for (let i = 0; i < entries.length; i++) {
      const cluster = [entries[i][0]];
      for (let j = 0; j < entries.length; j++) {
        if (i === j) continue;
        const [teamB, posB] = entries[j];
        const posA = entries[i][1];
        const dist = Math.hypot(posA.x - posB.x, posA.y - posB.y);
        if (dist <= this.clusterDist) cluster.push(teamB);
      }
      const unique = Array.from(new Set(cluster));
      if (unique.length >= 3) {
        const teamIds = unique.sort();
        if (!this.canEmit(matchId, 'CLUSTER', now)) return;
        if (this.existingSuggestion(matchId, 'CLUSTER', teamIds)) return;
        const suggestion: Suggestion = {
          type: 'CLUSTER',
          teamIds,
          confidence: 0.8,
          reason: `>=3 teams within ${this.clusterDist}`,
          ts: now,
          expiresAt: now + this.expireMs,
        };
        this.addSuggestion(matchId, suggestion);
        return; // one cluster per tick
      }
    }
  }

  private addSuggestion(matchId: string, suggestion: Suggestion) {
    if (!this.suggestions.has(matchId)) this.suggestions.set(matchId, []);
    this.suggestions.get(matchId)!.push(suggestion);
    this.markEmit(matchId, suggestion.type, suggestion.ts);
    this.logger.log(
      `[OBSERVER] suggestion generated: ${suggestion.type} teams=${suggestion.teamIds.join(',')}`,
    );
    this.webhooks.enqueue('observer.suggestion', matchId, {
      type: suggestion.type,
      teamIds: suggestion.teamIds,
      confidence: suggestion.confidence,
      reason: suggestion.reason,
      ts: suggestion.ts,
    });
  }
}
