import { GameKey } from '@prisma/client';
import { MatchesService } from './matches.service';
import type { PrismaService } from '../../db/prisma.service';
import type { ScoringService } from '../scoring/scoring.service';
import type { PcobGateway } from '../pcob/pcob.gateway';
import type { AdaptersService } from '../adapters/adapters.service';
import type { ScoreboardService } from '../scoreboard/scoreboard.service';
import type { ResultsService } from '../results/results.service';
import type { ResultsEventsService } from '../results/results-events.service';
import type { StandingsService } from '../standings/standings.service';
import type { AuditService } from '../audit/audit.service';
import type { BroadcastService } from '../broadcast/broadcast.service';
import type { MatchControlService } from '../match-control/match-control.service';

describe('MatchesService.validatePubgSlots (team count gating)', () => {
  const createService = (
    teams: Array<{ slot?: number | null; teamId?: string | null }>,
    gameKey: GameKey = GameKey.PUBG_MOBILE,
  ) => {
    const slottedTeams = teams
      .filter(
        (team): team is { slot: number; teamId: string } =>
          typeof team.slot === 'number' && Boolean(team.teamId),
      )
      .map((team) => ({
        slotNumber: team.slot,
        teamId: team.teamId,
      }));
    const prisma = {
      _dmmf: { modelMap: { Match: { fields: [] } } },
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          game: { key: gameKey },
          matchTeams: teams,
          matchSlots: slottedTeams,
        }),
      },
      matchTeam: {
        updateMany: jest.fn(),
      },
    } as unknown as PrismaService;

    const service = new MatchesService(
      prisma,
      {} as unknown as ScoringService,
      {} as unknown as PcobGateway,
      {} as unknown as AdaptersService,
      {} as unknown as ScoreboardService,
      {} as unknown as ResultsService,
      {} as unknown as ResultsEventsService,
      {} as unknown as StandingsService,
      {} as unknown as BroadcastService,
      {} as unknown as AuditService,
      {} as unknown as MatchControlService,
    );
    return { service, prisma };
  };

  it('blocks when fewer than 2 teams', async () => {
    const { service } = createService([{ slot: null, teamId: 't1' }]);
    await expect(service.validatePubgSlots('match-1')).rejects.toThrow(
      /require 2.?25 teams assigned to slots to go LIVE/i,
    );
  });

  it('blocks when teams are attached but not assigned to slots', async () => {
    const { service } = createService([
      { slot: null, teamId: 't1' },
      { slot: null, teamId: 't2' },
    ]);
    await expect(service.validatePubgSlots('match-1')).rejects.toThrow(
      /assigned to slots/i,
    );
  });

  it('allows 2 teams when both are assigned to slots', async () => {
    const { service } = createService([
      { slot: 1, teamId: 't1' },
      { slot: 2, teamId: 't2' },
    ]);
    await expect(service.validatePubgSlots('match-1')).resolves.toBeUndefined();
  });

  it('allows 10 teams when all are assigned to slots', async () => {
    const teams = Array.from({ length: 10 }).map((_, idx) => ({
      teamId: `t${idx + 1}`,
      slot: idx + 1,
    }));
    const { service } = createService(teams);
    await expect(service.validatePubgSlots('match-1')).resolves.toBeUndefined();
  });

  it('blocks when more than 25 teams', async () => {
    const teams = Array.from({ length: 26 }).map((_, idx) => ({
      teamId: `t${idx + 1}`,
      slot: idx + 1,
    }));
    const { service } = createService(teams);
    await expect(service.validatePubgSlots('match-1')).rejects.toThrow(
      /require 2.?25 teams assigned to slots to go LIVE/i,
    );
  });
});
