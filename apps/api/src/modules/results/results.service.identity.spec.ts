import type { PrismaService } from '../../db/prisma.service';
import type { ResultsEventsService } from './results-events.service';
import type { StandingsService } from '../standings/standings.service';
import type { AuditService } from '../audit/audit.service';
import { ResultsService } from './results.service';

const dummyEvents = {
  emitResultsUpdated: jest.fn(),
  emitLeaderboardUpdated: jest.fn(),
} as Pick<
  ResultsEventsService,
  'emitResultsUpdated' | 'emitLeaderboardUpdated'
>;
const dummyStandings = {
  canEditResults: jest.fn().mockResolvedValue({ canEdit: true }),
} as Pick<StandingsService, 'canEditResults'>;
const dummyAudit = { log: jest.fn() } as Pick<AuditService, 'log'>;
const dummyMatchControl = {
  detectMatchFinish: jest.fn().mockResolvedValue(undefined),
} as any;

describe('ResultsService player identity persistence', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('stores Shadow playerOpenId as slot player pubgAccountId during telemetry team sync', async () => {
    const matchSlotPlayerCreate = jest
      .fn()
      .mockResolvedValue({ id: 'slot-player-1' });
    const prisma = {
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-1',
            slotNumber: 1,
            teamId: 'team-1',
            team: { id: 'team-1', players: [] },
          },
        ]),
      },
      match: {
        findFirst: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          dataSource: 'SHADOW',
          dataMode: 'AUTO',
          tournament: { organizationId: 'org-1' },
          telemetry: {
            payload: {
              players: [
                {
                  slot: 1,
                  teamId: 'team-1',
                  playerOpenId: 'shadow-open-1',
                  playerName: 'Alpha',
                },
              ],
            },
          },
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({
          id: 'slot-result-1',
          teamId: 'team-1',
          organizationId: 'org-1',
          players: [],
          team: { id: 'team-1' },
        }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'slot-result-1',
          teamId: 'team-1',
          organizationId: 'org-1',
          players: [],
          team: { id: 'team-1' },
        }),
      },
      matchSlotPlayerResult: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn(),
        create: matchSlotPlayerCreate,
      },
      player: {
        upsert: jest.fn().mockResolvedValue({
          id: 'player-1',
          ign: 'Alpha',
          photoUrl: null,
          externalPlayerId: 'shadow-open-1',
          playerOpenId: 'shadow-open-1',
        }),
      },
      matchPlayer: {
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaService;

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );
    jest.spyOn(service, 'syncMatchPlayers').mockResolvedValue(undefined);

    await service.ensureResultsFromSlots('match-1');

    expect(matchSlotPlayerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slotResultId: 'slot-result-1',
          playerId: 'player-1',
          pubgAccountId: 'shadow-open-1',
          externalPlayerId: 'shadow-open-1',
          playerName: 'Alpha',
        }),
      }),
    );
  });

  it('stores externalPlayerId on slot players when telemetry has no playerOpenId', async () => {
    const matchSlotPlayerCreate = jest
      .fn()
      .mockResolvedValue({ id: 'slot-player-1' });
    const prisma = {
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-1',
            slotNumber: 1,
            teamId: 'team-1',
            team: { id: 'team-1', players: [] },
          },
        ]),
      },
      match: {
        findFirst: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          dataSource: 'SHADOW',
          dataMode: 'AUTO',
          tournament: { organizationId: 'org-1' },
          telemetry: {
            payload: {
              players: [
                {
                  slot: 1,
                  teamId: 'team-1',
                  externalPlayerId: 'provider-player-1',
                  playerName: 'Alpha',
                },
              ],
            },
          },
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({
          id: 'slot-result-1',
          teamId: 'team-1',
          organizationId: 'org-1',
          players: [],
          team: { id: 'team-1' },
        }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'slot-result-1',
          teamId: 'team-1',
          organizationId: 'org-1',
          players: [],
          team: { id: 'team-1' },
        }),
      },
      matchSlotPlayerResult: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn(),
        create: matchSlotPlayerCreate,
      },
      player: {
        upsert: jest.fn().mockResolvedValue({
          id: 'player-1',
          ign: 'Alpha',
          photoUrl: null,
          externalPlayerId: 'provider-player-1',
          playerOpenId: null,
        }),
      },
      matchPlayer: {
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaService;

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );
    jest.spyOn(service, 'syncMatchPlayers').mockResolvedValue(undefined);

    await service.ensureResultsFromSlots('match-1');

    expect((prisma as any).player.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_externalPlayerId: {
            organizationId: 'org-1',
            externalPlayerId: 'provider-player-1',
          },
        },
      }),
    );
    expect(matchSlotPlayerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slotResultId: 'slot-result-1',
          playerId: 'player-1',
          pubgAccountId: null,
          externalPlayerId: 'provider-player-1',
          playerName: 'Alpha',
        }),
      }),
    );
  });

  it('suffixes duplicate roster names instead of failing slot result materialization', async () => {
    const matchSlotPlayerCreate = jest
      .fn()
      .mockResolvedValueOnce({ id: 'slot-player-1' })
      .mockResolvedValueOnce({ id: 'slot-player-2' });
    const prisma = {
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-1',
            slotNumber: 1,
            teamId: 'team-1',
            team: {
              id: 'team-1',
              players: [
                {
                  id: 'player-2',
                  ign: 'Alpha',
                  realName: null,
                  externalPlayerId: 'ext-2',
                  playerOpenId: 'open-2',
                },
                {
                  id: 'player-1',
                  ign: 'Alpha',
                  realName: null,
                  externalPlayerId: 'ext-1',
                  playerOpenId: 'open-1',
                },
              ],
            },
          },
        ]),
      },
      match: {
        findFirst: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          dataSource: 'MANUAL',
          dataMode: 'MANUAL',
          tournament: { organizationId: 'org-1' },
          telemetry: null,
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({
          id: 'slot-result-1',
          teamId: 'team-1',
          organizationId: 'org-1',
          players: [],
          team: { id: 'team-1' },
        }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'slot-result-1',
          teamId: 'team-1',
          organizationId: 'org-1',
          players: [],
          team: { id: 'team-1' },
        }),
      },
      matchSlotPlayerResult: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn(),
        create: matchSlotPlayerCreate,
      },
      matchPlayer: {
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaService;

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );
    jest.spyOn(service, 'syncMatchPlayers').mockResolvedValue(undefined);

    await service.ensureResultsFromSlots('match-1');

    expect(matchSlotPlayerCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          playerId: 'player-2',
          playerName: 'Alpha (2)',
        }),
      }),
    );
    expect(matchSlotPlayerCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          playerId: 'player-1',
          playerName: 'Alpha',
        }),
      }),
    );
  });

  it('projects slot player pubgAccountId into match players during sync', async () => {
    const matchPlayerUpsert = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            teamId: 'team-1',
            players: [
              {
                playerId: 'player-1',
                pubgAccountId: 'shadow-open-1',
                kills: 2,
                isAlive: true,
                alive: true,
                isKnocked: false,
              },
            ],
          },
        ]),
      },
      matchPlayer: {
        upsert: matchPlayerUpsert,
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaService;

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );

    await service.syncMatchPlayers('match-1');

    expect(matchPlayerUpsert).toHaveBeenCalledWith({
      where: { matchId_playerId: { matchId: 'match-1', playerId: 'player-1' } },
      create: {
        matchId: 'match-1',
        teamId: 'team-1',
        playerId: 'player-1',
        pubgAccountId: 'shadow-open-1',
        externalPlayerId: 'shadow-open-1',
        kills: 2,
        alive: true,
        knocked: false,
      },
      update: {
        teamId: 'team-1',
        pubgAccountId: 'shadow-open-1',
        externalPlayerId: 'shadow-open-1',
        kills: 2,
        alive: true,
        knocked: false,
      },
    });
  });
});
