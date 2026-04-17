import { MatchesService } from './matches.service';
import type { PrismaService } from '../../db/prisma.service';
import type { Prisma } from '@prisma/client';
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

type TeamRow = { teamId: string; slotNumber?: number | null };

const buildService = (
  teams: TeamRow[],
  options?: { controlStateMeta?: Record<string, unknown> | null },
) => {
  const slotRows: Array<{ slotNumber: number | null; teamId: string | null }> =
    teams
      .filter((t) => t.slotNumber)
      .map((t) => ({
        slotNumber: t.slotNumber ?? null,
        teamId: t.teamId,
      }));

  const prisma = {
    _dmmf: { modelMap: { Match: { fields: [] } } },
    match: {
      findUnique: jest.fn().mockResolvedValue({
        tournament: { organizationId: 'org-1' },
        controlState: { metaJson: options?.controlStateMeta ?? null },
      }),
    },
    matchControlState: {
      findUnique: jest.fn().mockResolvedValue({
        metaJson: options?.controlStateMeta ?? null,
      }),
      upsert: jest.fn(),
    },
    matchTeam: {
      findMany: jest.fn().mockImplementation(() =>
        Promise.resolve(
          teams.map((t) => ({
            teamId: t.teamId,
          })),
        ),
      ),
      updateMany: jest
        .fn()
        .mockImplementation(
          ({
            data,
            where,
          }: {
            data: { slot?: number | null };
            where: { matchId: string; teamId: string };
          }) => {
            const target = teams.find((t) => t.teamId === where.teamId);
            if (target) {
              target.slotNumber = data.slot ?? target.slotNumber ?? null;
            }
            return Promise.resolve({ count: 1 });
          },
        ),
    },
    matchSlot: {
      findMany: jest.fn().mockResolvedValue(slotRows),
      upsert: jest.fn().mockImplementation(
        ({
          where,
          update,
          create,
        }: {
          where: {
            matchId_slotNumber: { matchId: string; slotNumber: number };
          };
          update: { teamId?: string | null };
          create: {
            matchId: string;
            slotNumber: number;
            teamId?: string | null;
          };
        }) => {
          const slotNumber = where.matchId_slotNumber.slotNumber;
          const teamId = update.teamId ?? create.teamId ?? null;
          const existing = slotRows.find((s) => s.slotNumber === slotNumber);
          if (existing) {
            existing.teamId = teamId ?? existing.teamId;
          } else {
            slotRows.push({ slotNumber, teamId: teamId ?? null });
          }
          return Promise.resolve({ slotNumber, teamId });
        },
      ),
    },
    $transaction: jest.fn(
      (cb: (tx: Prisma.TransactionClient) => Promise<any>) =>
        cb(prisma as unknown as Prisma.TransactionClient),
    ),
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
  return { service, prisma, teams, slotRows };
};

describe('MatchesService.assignSlotsIfMissing', () => {
  it('assigns slots for two teams with none set', async () => {
    const { service, slotRows, teams } = buildService([
      { teamId: 't1' },
      { teamId: 't2' },
    ]);
    const assignments = await service.assignSlotsIfMissing('m1');
    expect(assignments).toEqual([
      { teamId: 't1', slotNumber: 1 },
      { teamId: 't2', slotNumber: 2 },
    ]);
    expect(slotRows.map((s) => s.slotNumber).sort()).toEqual([1, 2]);
    expect(teams.map((t) => t.slotNumber)).toEqual([1, 2]);
  });

  it('fills only missing slots and keeps existing unique slots', async () => {
    const { service, slotRows, teams } = buildService([
      { teamId: 't1', slotNumber: 1 },
      { teamId: 't2' },
      { teamId: 't3', slotNumber: 3 },
      { teamId: 't4' },
      { teamId: 't5' },
    ]);
    const assignments = await service.assignSlotsIfMissing('m1');
    expect(assignments).toEqual([
      { teamId: 't2', slotNumber: 2 },
      { teamId: 't4', slotNumber: 4 },
      { teamId: 't5', slotNumber: 5 },
    ]);
    expect(slotRows.map((s) => s.slotNumber).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(teams.map((t) => t.slotNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  it('handles 25 teams successfully', async () => {
    const { service, slotRows } = buildService(
      Array.from({ length: 25 }).map((_, idx) => ({ teamId: `t${idx + 1}` })),
    );
    const assignments = await service.assignSlotsIfMissing('m1');
    expect(assignments).toHaveLength(25);
    expect(new Set(assignments.map((a) => a.slotNumber)).size).toBe(25);
    expect(slotRows).toHaveLength(25);
  });

  it('does not reassign when all slots present', async () => {
    const { service, prisma } = buildService([
      { teamId: 't1', slotNumber: 1 },
      { teamId: 't2', slotNumber: 2 },
    ]);
    (prisma.matchSlot.findMany as jest.Mock).mockResolvedValue([
      { slotNumber: 1, teamId: 't1' },
      { slotNumber: 2, teamId: 't2' },
    ]);
    const assignments = await service.assignSlotsIfMissing('m1');
    expect(assignments).toHaveLength(0);
  });

  it('skips teams that were manually cleared from slots', async () => {
    const { service, slotRows, teams } = buildService(
      [
        { teamId: 't1', slotNumber: 1 },
        { teamId: 't2' },
        { teamId: 't3', slotNumber: 3 },
      ],
      { controlStateMeta: { manualClearedTeamIds: ['t2'] } },
    );

    const assignments = await service.assignSlotsIfMissing('m1');

    expect(assignments).toEqual([]);
    expect(slotRows.map((s) => s.slotNumber).sort()).toEqual([1, 3]);
    expect(teams.map((t) => t.slotNumber ?? null)).toEqual([1, null, 3]);
  });
});
