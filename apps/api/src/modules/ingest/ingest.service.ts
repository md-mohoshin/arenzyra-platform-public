import {
  Injectable,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { MatchEventDto } from './dto/match-event.dto';
import { ScoringService } from '../scoring/scoring.service';
import { ResultsService } from '../results/results.service';
import { canAcceptTelemetryForMatch } from '../../common/match-status.util';

type RejectedItem = {
  event_id: string;
  reason: string;
};

@Injectable()
export class IngestService {
  constructor(
    private prisma: PrismaService,
    private scoring: ScoringService,
    @Inject(forwardRef(() => ResultsService))
    private results: ResultsService,
  ) {}

  async ingestBatch(events: MatchEventDto[]) {
    if (!events.length) {
      return { ok: true, received: 0, inserted: 0, ignored: 0, rejected: 0 };
    }

    // 1️⃣ Enforce single match per batch (professional rule)
    const matchId = events[0].match_id;
    const mixed = events.some((e) => e.match_id !== matchId);
    if (mixed) {
      throw new BadRequestException('Batch contains multiple match_ids');
    }

    // 2️⃣ Load match ONCE
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        status: true,
        deletedAt: true,
        tournamentId: true,
        organizationId: true,
      },
    });

    if (!match || match.deletedAt) {
      throw new BadRequestException('Invalid match');
    }
    if (!match.tournamentId) {
      throw new BadRequestException(
        'Session matches are not supported by telemetry ingest yet',
      );
    }

    if (!canAcceptTelemetryForMatch(match.status)) {
      throw new BadRequestException('Match not live');
    }

    // 3️⃣ Preload registered teams ONCE
    const registeredTeams = await this.prisma.tournamentTeam.findMany({
      where: {
        tournamentId: match.tournamentId,
        deletedAt: null,
      },
      select: { teamId: true },
    });

    const teamSet = new Set(registeredTeams.map((t) => t.teamId));

    // 4️⃣ Validate events & split valid / rejected
    const validEvents: MatchEventDto[] = [];
    const rejected: RejectedItem[] = [];

    for (const e of events) {
      if (e.team_id && !teamSet.has(e.team_id)) {
        rejected.push({
          event_id: e.event_id,
          reason: 'TEAM_NOT_REGISTERED',
        });
        continue;
      }
      validEvents.push(e);
    }

    // 5️⃣ Bulk insert (idempotent & fast)
    let inserted = 0;
    let ignored = 0;

    if (validEvents.length > 0) {
      const result = await this.prisma.matchEvent.createMany({
        data: validEvents.map((e) => ({
          eventId: e.event_id,
          matchId: e.match_id,
          seq: e.seq,
          type: e.type,
          teamId: e.team_id ?? null,
          playerId: e.player_id ?? null,
          timestamp: new Date(e.timestamp),
          payload: e.payload ?? {},
          rawPayload: e.raw_payload,
          organizationId: match.organizationId,
        })),
        skipDuplicates: true,
      });

      inserted = result.count;

      // ignored = duplicates
      ignored = validEvents.length - result.count;
    }

    const result = {
      ok: true,
      received: events.length,
      inserted,
      ignored,
      rejected: rejected.length,
      rejectedItems: rejected,
    };

    if (inserted > 0) {
      await this.scoring.recomputeMatchAndTournament(matchId);
      // Fire-and-forget slot recompute to refresh standings/widgets
      void this.results.recalculateMatchResults(matchId).catch(() => {});
    }

    return result;
  }
}
