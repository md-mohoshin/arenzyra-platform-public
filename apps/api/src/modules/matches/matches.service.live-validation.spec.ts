import { BadRequestException } from '@nestjs/common';
import { GameKey } from '@prisma/client';
import type { PrismaService } from '../../db/prisma.service';
import { MatchesService } from './matches.service';
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

const buildService = (opts: {
  teamCount: number;
  slots?: Array<{ slotNumber: number | null; teamId?: string | null }>;
}) => {
  const teams = Array.from({ length: opts.teamCount }).map((_, i) => ({
    teamId: `t${i + 1}`,
  }));
  const match = {
    id: 'm1',
    game: { key: GameKey.PUBG_MOBILE },
    matchTeams: teams,
    matchSlots: opts.slots ?? [],
  };

  const prisma = {
    _dmmf: { modelMap: { Match: { fields: [] } } },
    match: {
      findFirst: jest.fn().mockResolvedValue(match),
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

  return { service, match };
};

describe('MatchesService.validatePubgSlots', () => {
  it('blocks when fewer than 2 teams', async () => {
    const { service } = buildService({ teamCount: 1 });
    await expect(service.validatePubgSlots('m1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('blocks when teams exist but are not assigned to slots', async () => {
    const { service } = buildService({ teamCount: 2 });
    await expect(service.validatePubgSlots('m1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('allows 2 teams with assigned slots', async () => {
    const { service } = buildService({
      teamCount: 2,
      slots: [
        { slotNumber: 1, teamId: 't1' },
        { slotNumber: 2, teamId: 't2' },
      ],
    });
    await expect(service.validatePubgSlots('m1')).resolves.toBeUndefined();
  });

  it('allows 10 teams with assigned slots', async () => {
    const { service } = buildService({
      teamCount: 10,
      slots: Array.from({ length: 10 }).map((_, idx) => ({
        slotNumber: idx + 1,
        teamId: `t${idx + 1}`,
      })),
    });
    await expect(service.validatePubgSlots('m1')).resolves.toBeUndefined();
  });

  it('blocks when more than 25 teams', async () => {
    const { service } = buildService({
      teamCount: 26,
      slots: Array.from({ length: 26 }).map((_, idx) => ({
        slotNumber: idx + 1,
        teamId: `t${idx + 1}`,
      })),
    });
    await expect(service.validatePubgSlots('m1')).rejects.toThrow(
      BadRequestException,
    );
  });
});
