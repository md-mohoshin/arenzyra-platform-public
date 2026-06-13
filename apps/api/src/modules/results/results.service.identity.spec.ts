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

  it('adds unlinked telemetry result players to the team player list during sync', async () => {
    const matchPlayerUpsert = jest.fn().mockResolvedValue(undefined);
    const slotPlayerUpdate = jest.fn().mockResolvedValue(undefined);
    const playerUpsert = jest.fn().mockResolvedValue({
      id: 'player-1',
      ign: 'Alpha',
      photoUrl: null,
      externalPlayerId: 'ext-1',
      playerOpenId: 'open-1',
    });
    const prisma = {
      matchSlotResult: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              id: 'slot-result-1',
              organizationId: 'org-1',
              teamId: 'team-1',
              players: [
                {
                  id: 'slot-player-1',
                  playerId: null,
                  playerName: 'Alpha',
                  pubgAccountId: 'open-1',
                  externalPlayerId: 'ext-1',
                },
              ],
            },
          ])
          .mockResolvedValueOnce([
            {
              teamId: 'team-1',
              players: [
                {
                  playerId: 'player-1',
                  pubgAccountId: 'open-1',
                  externalPlayerId: 'ext-1',
                  kills: 2,
                  isAlive: true,
                  alive: true,
                  isKnocked: false,
                },
              ],
            },
          ]),
      },
      matchSlotPlayerResult: {
        update: slotPlayerUpdate,
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      player: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        upsert: playerUpsert,
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

    expect(playerUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          organizationId: 'org-1',
          teamId: 'team-1',
          ign: 'Alpha',
          externalSource: 'PUBG_TELEMETRY',
          externalId: 'ext-1',
          externalPlayerId: 'ext-1',
          playerOpenId: 'open-1',
        }),
        update: expect.objectContaining({
          teamId: 'team-1',
          ign: 'Alpha',
          externalId: 'ext-1',
          externalPlayerId: 'ext-1',
          playerOpenId: 'open-1',
        }),
      }),
    );
    expect(slotPlayerUpdate).toHaveBeenCalledWith({
      where: { id: 'slot-player-1' },
      data: {
        playerId: 'player-1',
        playerName: 'Alpha',
        pubgAccountId: 'open-1',
        externalPlayerId: 'ext-1',
        isAutoFilled: true,
      },
    });
    expect(matchPlayerUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          matchId_playerId: { matchId: 'match-1', playerId: 'player-1' },
        },
      }),
    );
  });

  it('updates an existing team player name when the same telemetry id returns with a new name', async () => {
    const playerUpdate = jest.fn().mockResolvedValue({
      id: 'player-1',
      ign: 'New Alpha',
      photoUrl: null,
      externalPlayerId: 'ext-1',
      playerOpenId: null,
    });
    const prisma = {
      matchSlotResult: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              id: 'slot-result-1',
              organizationId: 'org-1',
              teamId: 'team-1',
              players: [
                {
                  id: 'slot-player-1',
                  playerId: null,
                  playerName: 'New Alpha',
                  pubgAccountId: null,
                  externalPlayerId: 'ext-1',
                },
              ],
            },
          ])
          .mockResolvedValueOnce([
            {
              teamId: 'team-1',
              players: [
                {
                  playerId: 'player-1',
                  pubgAccountId: null,
                  externalPlayerId: 'ext-1',
                  kills: 0,
                  isAlive: true,
                  alive: true,
                  isKnocked: false,
                },
              ],
            },
          ]),
      },
      matchSlotPlayerResult: {
        update: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      player: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'player-1',
          ign: 'Old Alpha',
          photoUrl: null,
          externalId: 'ext-1',
          externalPlayerId: 'ext-1',
          playerOpenId: null,
        }),
        findMany: jest.fn(),
        update: playerUpdate,
        upsert: jest.fn(),
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

    await service.syncMatchPlayers('match-1');

    expect(playerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'player-1' },
        data: expect.objectContaining({
          teamId: 'team-1',
          ign: 'New Alpha',
          externalSource: 'PUBG_TELEMETRY',
          externalId: 'ext-1',
          externalPlayerId: 'ext-1',
        }),
      }),
    );
    expect((prisma as any).player.upsert).not.toHaveBeenCalled();
    expect((prisma as any).matchSlotPlayerResult.update).toHaveBeenCalledWith({
      where: { id: 'slot-player-1' },
      data: {
        playerId: 'player-1',
        playerName: 'New Alpha',
        pubgAccountId: null,
        externalPlayerId: 'ext-1',
        isAutoFilled: true,
      },
    });
  });

  it('stores Shadow uId as PUBG UID while keeping playerOpenId separate', async () => {
    const playerUpdate = jest.fn().mockResolvedValue({
      id: 'existing-player',
      ign: 'RE・WUTANG',
      photoUrl: 'https://api.arenzyra.com/media/players/existing-player/photo',
      externalPlayerId: '5588803071',
      inGameId: '5588803071',
      pubgPlayerId: '5588803071',
      playerOpenId: '36057191048152360',
    });
    const prisma = {
      player: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'existing-player',
            ign: 'RE・WUTANG',
            photoUrl:
              'https://api.arenzyra.com/media/players/existing-player/photo',
            externalId: '36057191048152360',
            externalPlayerId: '36057191048152360',
            inGameId: null,
            pubgPlayerId: null,
            playerOpenId: '36057191048152360',
          },
        ]),
        update: playerUpdate,
        upsert: jest.fn(),
      },
    } as unknown as PrismaService;

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );

    const result = await (
      service as unknown as {
        materializeTelemetryPlayer: (
          client: typeof prisma,
          params: {
            organizationId: string;
            teamId: string | null;
            player: {
              name: string;
              externalPlayerId: string;
              pubgAccountId: string;
              avatarUrl: null;
            };
          },
        ) => Promise<{
          id: string;
          ign: string;
          photoUrl: string | null;
          externalPlayerId: string | null;
          inGameId: string | null;
          pubgPlayerId: string | null;
          playerOpenId: string | null;
        } | null>;
      }
    ).materializeTelemetryPlayer(prisma, {
      organizationId: 'org-1',
      teamId: 'team-1',
      player: {
        name: 'RE・WUTANG',
        externalPlayerId: '5588803071',
        pubgAccountId: '36057191048152360',
        avatarUrl: null,
      },
    });

    expect(playerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'existing-player' },
        data: expect.objectContaining({
          teamId: 'team-1',
          ign: 'RE・WUTANG',
          externalSource: 'PUBG_TELEMETRY',
          externalId: '5588803071',
          externalPlayerId: '5588803071',
          inGameId: '5588803071',
          pubgPlayerId: '5588803071',
          pubgIdSource: 'PCOB',
          playerOpenId: '36057191048152360',
        }),
      }),
    );
    expect((prisma as any).player.upsert).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: 'existing-player',
      externalPlayerId: '5588803071',
      inGameId: '5588803071',
      pubgPlayerId: '5588803071',
      playerOpenId: '36057191048152360',
    });
  });

  it('clears conflicting telemetry identity before updating the canonical player', async () => {
    const playerUpdate = jest
      .fn()
      .mockResolvedValueOnce({ id: 'conflicting-player' })
      .mockResolvedValueOnce({
        id: 'canonical-player',
        ign: 'Alpha',
        photoUrl: null,
        externalPlayerId: 'open-1',
        playerOpenId: 'open-1',
      });
    const prisma = {
      player: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'canonical-player',
            ign: 'Alpha Old',
            photoUrl: null,
            externalId: null,
            externalPlayerId: null,
            playerOpenId: 'open-1',
          })
          .mockResolvedValueOnce({
            id: 'canonical-player',
            externalId: null,
            externalPlayerId: null,
            playerOpenId: 'open-1',
          })
          .mockResolvedValueOnce({
            id: 'conflicting-player',
            externalId: 'open-1',
            externalPlayerId: 'open-1',
            playerOpenId: null,
          })
          .mockResolvedValueOnce(null),
        findMany: jest.fn(),
        update: playerUpdate,
        upsert: jest.fn(),
      },
    } as unknown as PrismaService;

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );

    const result = await (
      service as unknown as {
        materializeTelemetryPlayer: (
          client: typeof prisma,
          params: {
            organizationId: string;
            teamId: string | null;
            player: {
              name: string;
              externalPlayerId: string;
              pubgAccountId: string;
              avatarUrl: null;
            };
          },
        ) => Promise<{
          id: string;
          ign: string;
          photoUrl: string | null;
          externalPlayerId: string | null;
          playerOpenId: string | null;
        } | null>;
      }
    ).materializeTelemetryPlayer(prisma, {
      organizationId: 'org-1',
      teamId: 'team-1',
      player: {
        name: 'Alpha',
        externalPlayerId: 'open-1',
        pubgAccountId: 'open-1',
        avatarUrl: null,
      },
    });

    expect(playerUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: 'conflicting-player' },
      data: {
        externalPlayerId: null,
        externalId: null,
      },
      select: { id: true },
    });
    expect(playerUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'canonical-player' },
        data: expect.objectContaining({
          teamId: 'team-1',
          ign: 'Alpha',
          externalSource: 'PUBG_TELEMETRY',
          externalId: 'open-1',
          externalPlayerId: 'open-1',
          playerOpenId: 'open-1',
        }),
      }),
    );
    expect(result).toMatchObject({
      id: 'canonical-player',
      externalPlayerId: 'open-1',
      playerOpenId: 'open-1',
    });
  });
});
