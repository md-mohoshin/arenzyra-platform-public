import { PcobAdapter } from './pcob.adapter';

const createPrisma = (matchData: Record<string, unknown>) =>
  ({
    matchTelemetry: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    match: {
      findUnique: jest.fn().mockResolvedValue(matchData),
    },
  }) as any;

describe('PcobAdapter canonical binding', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps numeric PCOB team ids to canonical match teams before returning telemetry', async () => {
    const prisma = createPrisma({
      matchSlots: [
        {
          slotNumber: 10,
          team: {
            id: 'team-uuid-9',
            name: 'Team 9',
            tag: 'T9',
            logoUrl: null,
          },
        },
      ],
    });

    const adapter = new PcobAdapter(prisma);
    const telemetry = await adapter.normalizeTelemetryEnvelope(
      'match-1',
      {
        payload: {
          teams: [
            {
              teamId: 10,
              teamName: 'Team9',
              killNum: 1,
              liveMemberNum: 1,
            },
          ],
          players: [
            {
              playerOpenId: 'player-open-1',
              playerName: 'Player 1',
              teamId: 10,
              teamName: 'Team9',
              killNum: 1,
              liveState: 0,
            },
          ],
        },
      },
      {},
    );

    expect(telemetry).toMatchObject({
      matchId: 'match-1',
      teams: [
        {
          teamId: 'team-uuid-9',
          slot: 10,
          name: 'Team 9',
          tag: 'T9',
        },
      ],
      players: [
        {
          playerId: 'player-open-1',
          teamId: 'team-uuid-9',
        },
      ],
    });
    expect(telemetry?.teams[0]?.players?.[0]?.teamId).toBe('team-uuid-9');
  });

  it('honors explicit isAlive=false in pushed observer snapshots', async () => {
    const prisma = createPrisma({
      matchSlots: [
        {
          slotNumber: 1,
          team: {
            id: 'team-1',
            name: 'Team 1',
            tag: 'T1',
            logoUrl: null,
          },
        },
      ],
    });

    const adapter = new PcobAdapter(prisma);
    const telemetry = await adapter.normalizeTelemetryEnvelope(
      'match-1',
      {
        payload: {
          teams: [
            {
              teamId: 'team-1',
              slot: 1,
              teamName: 'Team 1',
              kills: 0,
            },
          ],
          players: [
            {
              playerId: 'player-1',
              playerName: 'Player 1',
              teamId: 'team-1',
              kills: 0,
              isAlive: false,
              alive: false,
              isKnocked: true,
              knocked: true,
            },
          ],
        },
      },
      {},
    );

    expect(telemetry?.players[0]).toMatchObject({
      playerId: 'player-1',
      teamId: 'team-1',
      alive: false,
      knocked: false,
      eliminated: true,
    });
  });

  it('preserves alive=true alongside knocked=true when the payload says both', async () => {
    const prisma = createPrisma({
      matchSlots: [
        {
          slotNumber: 1,
          team: {
            id: 'team-1',
            name: 'Team 1',
            tag: 'T1',
            logoUrl: null,
          },
        },
      ],
    });

    const adapter = new PcobAdapter(prisma);
    const telemetry = await adapter.normalizeTelemetryEnvelope(
      'match-1',
      {
        sessionId: 'session-1',
        sequence: 7,
        payload: {
          players: [
            {
              playerId: 'player-1',
              playerName: 'Player 1',
              teamId: 'team-1',
              isAlive: true,
              alive: true,
              isKnocked: true,
              knocked: true,
            },
          ],
        },
      },
      {},
    );

    expect(telemetry).toMatchObject({
      matchId: 'match-1',
      sessionId: 'session-1',
      sequence: 7,
      players: [
        {
          playerId: 'player-1',
          teamId: 'team-1',
          alive: true,
          knocked: true,
          eliminated: false,
        },
      ],
    });
  });

  it('treats liveState=5 as dead even when bHasDied is still false', async () => {
    const prisma = createPrisma({
      matchSlots: [
        {
          slotNumber: 1,
          team: {
            id: 'team-1',
            name: 'Team 1',
            tag: 'T1',
            logoUrl: null,
          },
        },
      ],
    });

    const adapter = new PcobAdapter(prisma);
    const telemetry = await adapter.normalizeTelemetryEnvelope(
      'match-1',
      {
        payload: {
          teams: [
            {
              teamId: 1,
              teamName: 'Team 1',
              liveMemberNum: 1,
            },
          ],
          players: [
            {
              uid: 'player-1',
              playerName: 'Player 1',
              teamId: 1,
              liveState: 5,
              bHasDied: false,
              health: 0,
            },
          ],
        },
      },
      {},
    );

    expect(telemetry?.players[0]).toMatchObject({
      playerId: 'player-1',
      teamId: 'team-1',
      alive: false,
      knocked: false,
      eliminated: true,
    });
    expect(telemetry?.teams[0]).toMatchObject({
      teamId: 'team-1',
      aliveCount: 0,
      alivePlayers: 0,
      eliminated: true,
    });
  });

  it('maps playerOpenId into pubgAccountId for player and kill-event binding', async () => {
    const prisma = createPrisma({
      matchSlots: [
        {
          slotNumber: 10,
          team: {
            id: 'team-uuid-9',
            name: 'Team 9',
            tag: 'T9',
            logoUrl: null,
          },
        },
      ],
      slotResults: [
        {
          slotNumber: 10,
          teamId: 'team-uuid-9',
          team: {
            id: 'team-uuid-9',
            name: 'Team 9',
            tag: 'T9',
            logoUrl: null,
          },
          players: [
            {
              id: 'player-result-1',
              playerId: 'player-uuid-1',
              playerName: 'Alpha',
              player: {
                externalPlayerId: 'canonical-external-1',
                playerOpenId: 'canonical-open-1',
                inGameId: 'pubg-1',
                pubgPlayerId: 'pubg-1',
                ign: 'Alpha',
              },
            },
            {
              id: 'player-result-2',
              playerId: 'player-uuid-2',
              playerName: 'Bravo',
              player: {
                externalPlayerId: 'canonical-external-2',
                playerOpenId: 'canonical-open-2',
                inGameId: 'pubg-2',
                pubgPlayerId: 'pubg-2',
                ign: 'Bravo',
              },
            },
          ],
        },
      ],
    });

    const adapter = new PcobAdapter(prisma);
    const debugSpy = jest
      .spyOn((adapter as any).logger, 'debug')
      .mockImplementation(() => undefined);
    const telemetry = await adapter.normalizeTelemetryEnvelope(
      'match-1',
      {
        payload: {
          teams: [
            {
              teamId: 10,
              teamName: 'Team9',
              killNum: 1,
              liveMemberNum: 2,
            },
          ],
          players: [
            {
              teamId: 10,
              playerId: 'shadow-uid-1',
              playerOpenId: 'canonical-open-1',
              playerName: 'Wrong Alias Alpha',
              liveState: 0,
            },
            {
              teamId: 10,
              playerId: 'shadow-uid-2',
              playerOpenId: 'canonical-open-2',
              playerName: 'Wrong Alias Bravo',
              liveState: 0,
            },
          ],
          events: [
            {
              type: 'KILL',
              timestamp: 1000,
              killer: {
                teamId: 10,
                playerId: 'shadow-uid-1',
                playerOpenId: 'canonical-open-1',
                playerName: 'Wrong Alias Alpha',
              },
              victim: {
                teamId: 10,
                playerId: 'shadow-uid-2',
                playerOpenId: 'canonical-open-2',
                playerName: 'Wrong Alias Bravo',
              },
              weapon: 'M416',
            },
          ],
        },
      },
      {},
    );

    expect(telemetry).toMatchObject({
      players: [
        {
          playerId: 'player-uuid-1',
          pubgAccountId: 'canonical-open-1',
          teamId: 'team-uuid-9',
        },
        {
          playerId: 'player-uuid-2',
          pubgAccountId: 'canonical-open-2',
          teamId: 'team-uuid-9',
        },
      ],
      events: [
        {
          type: 'KILL',
          killerId: 'player-uuid-1',
          killerTeamId: 'team-uuid-9',
          victimId: 'player-uuid-2',
          victimTeamId: 'team-uuid-9',
        },
      ],
    });
    expect(telemetry?.teams[0]?.players?.[0]?.playerId).toBe('player-uuid-1');
    expect(
      debugSpy.mock.calls.some(
        ([message]) =>
          String(message).includes('"action":"canonical-player-bound"') &&
          String(message).includes('"strategy":"PUBG_ACCOUNT_ID"'),
      ),
    ).toBe(true);
  });

  it('binds telemetry players against match slot roster players before slot results exist', async () => {
    const prisma = createPrisma({
      matchSlots: [
        {
          slotNumber: 1,
          team: {
            id: 'team-1',
            name: 'Team 1',
            tag: 'T1',
            logoUrl: null,
            players: [
              {
                id: 'player-uuid-1',
                ign: 'Alpha',
                realName: 'Alpha Real',
                externalPlayerId: 'provider-player-1',
                playerOpenId: 'provider-open-1',
              },
            ],
          },
        },
      ],
      slotResults: [],
    });

    const adapter = new PcobAdapter(prisma);
    const telemetry = await adapter.normalizeTelemetryEnvelope(
      'match-1',
      {
        payload: {
          teams: [
            {
              teamId: 1,
              teamName: 'Team 1',
              liveMemberNum: 1,
            },
          ],
          players: [
            {
              teamId: 1,
              externalPlayerId: 'provider-player-1',
              playerName: 'Alias Alpha',
              liveState: 0,
            },
          ],
        },
      },
      {},
    );

    expect(telemetry?.players[0]).toMatchObject({
      playerId: 'player-uuid-1',
      teamId: 'team-1',
    });
  });

  it('uses uid as a stable external player identifier when Shadow omits externalPlayerId', async () => {
    const prisma = createPrisma({
      matchSlots: [
        {
          slotNumber: 1,
          team: {
            id: 'team-1',
            name: 'Team 1',
            tag: 'T1',
            logoUrl: null,
          },
        },
      ],
      slotResults: [
        {
          slotNumber: 1,
          teamId: 'team-1',
          team: {
            id: 'team-1',
            name: 'Team 1',
            tag: 'T1',
            logoUrl: null,
          },
          players: [
            {
              id: 'player-result-1',
              playerId: 'player-uuid-1',
              playerName: 'Alpha',
              externalPlayerId: 'shadow-uid-1',
              pubgAccountId: null,
              player: {
                externalPlayerId: 'shadow-uid-1',
                playerOpenId: null,
                inGameId: null,
                pubgPlayerId: null,
                ign: 'Alpha',
              },
            },
          ],
        },
      ],
    });

    const adapter = new PcobAdapter(prisma);
    const telemetry = await adapter.normalizeTelemetryEnvelope(
      'match-1',
      {
        payload: {
          teams: [
            {
              teamId: 1,
              teamName: 'Team 1',
              liveMemberNum: 1,
            },
          ],
          players: [
            {
              teamId: 1,
              uid: 'shadow-uid-1',
              playerName: 'Alias Alpha',
              liveState: 0,
            },
          ],
        },
      },
      {},
    );

    expect(telemetry?.players[0]).toMatchObject({
      playerId: 'player-uuid-1',
      externalPlayerId: 'shadow-uid-1',
      teamId: 'team-1',
    });
  });

  it('falls back to externalPlayerId when pubgAccountId does not match a slot player', async () => {
    const prisma = createPrisma({
      matchSlots: [
        {
          slotNumber: 1,
          team: {
            id: 'team-1',
            name: 'Team 1',
            tag: 'T1',
            logoUrl: null,
          },
        },
      ],
      slotResults: [
        {
          slotNumber: 1,
          teamId: 'team-1',
          team: {
            id: 'team-1',
            name: 'Team 1',
            tag: 'T1',
            logoUrl: null,
          },
          players: [
            {
              id: 'player-result-1',
              playerId: 'player-uuid-1',
              playerName: 'Alpha',
              player: {
                externalPlayerId: 'provider-player-1',
                playerOpenId: null,
                inGameId: null,
                pubgPlayerId: null,
                ign: 'Alpha',
              },
            },
          ],
        },
      ],
    });

    const adapter = new PcobAdapter(prisma);
    const debugSpy = jest
      .spyOn((adapter as any).logger, 'debug')
      .mockImplementation(() => undefined);
    const telemetry = await adapter.normalizeTelemetryEnvelope(
      'match-1',
      {
        payload: {
          teams: [
            {
              teamId: 1,
              teamName: 'Team 1',
              liveMemberNum: 1,
            },
          ],
          players: [
            {
              teamId: 1,
              externalPlayerId: 'provider-player-1',
              pubgAccountId: 'missing-pubg',
              playerName: 'Alias Alpha',
              liveState: 0,
            },
          ],
        },
      },
      {},
    );

    expect(telemetry?.players[0]).toMatchObject({
      playerId: 'player-uuid-1',
      externalPlayerId: 'provider-player-1',
      teamId: 'team-1',
    });
    expect(
      debugSpy.mock.calls.some(
        ([message]) =>
          String(message).includes('"action":"canonical-player-bound"') &&
          String(message).includes('"strategy":"EXTERNAL_PLAYER_ID"'),
      ),
    ).toBe(true);
  });

  it('matches telemetry externalPlayerId against canonical PUBG player identifiers', async () => {
    const prisma = createPrisma({
      matchSlots: [
        {
          slotNumber: 1,
          team: {
            id: 'team-1',
            name: 'Team 1',
            tag: 'T1',
            logoUrl: null,
          },
        },
      ],
      slotResults: [
        {
          slotNumber: 1,
          teamId: 'team-1',
          team: {
            id: 'team-1',
            name: 'Team 1',
            tag: 'T1',
            logoUrl: null,
          },
          players: [
            {
              id: 'player-result-1',
              playerId: 'player-uuid-1',
              playerName: 'Alpha',
              player: {
                externalPlayerId: null,
                playerOpenId: null,
                inGameId: 'pubg-legacy-1',
                pubgPlayerId: 'pubg-legacy-1',
                ign: 'Alpha',
              },
            },
          ],
        },
      ],
    });

    const adapter = new PcobAdapter(prisma);
    const debugSpy = jest
      .spyOn((adapter as any).logger, 'debug')
      .mockImplementation(() => undefined);
    const telemetry = await adapter.normalizeTelemetryEnvelope(
      'match-1',
      {
        payload: {
          teams: [
            {
              teamId: 1,
              teamName: 'Team 1',
              liveMemberNum: 1,
            },
          ],
          players: [
            {
              teamId: 1,
              externalPlayerId: 'pubg-legacy-1',
              playerName: 'Alias Alpha',
              liveState: 0,
            },
          ],
        },
      },
      {},
    );

    expect(telemetry?.players[0]).toMatchObject({
      playerId: 'player-uuid-1',
      externalPlayerId: 'pubg-legacy-1',
      teamId: 'team-1',
    });
    expect(
      debugSpy.mock.calls.some(
        ([message]) =>
          String(message).includes('"action":"canonical-player-bound"') &&
          String(message).includes('"strategy":"EXTERNAL_PLAYER_ID"'),
      ),
    ).toBe(true);
  });

  it('falls back to normalizedName when stable external identifiers do not match', async () => {
    const prisma = createPrisma({
      matchSlots: [
        {
          slotNumber: 1,
          team: {
            id: 'team-1',
            name: 'Team 1',
            tag: 'T1',
            logoUrl: null,
          },
        },
      ],
      slotResults: [
        {
          slotNumber: 1,
          teamId: 'team-1',
          team: {
            id: 'team-1',
            name: 'Team 1',
            tag: 'T1',
            logoUrl: null,
          },
          players: [
            {
              id: 'player-result-1',
              playerId: 'player-uuid-1',
              playerName: 'Alpha',
              player: {
                externalPlayerId: null,
                playerOpenId: null,
                inGameId: 'legacy-player-id',
                pubgPlayerId: 'legacy-player-id',
                ign: 'Alpha',
              },
            },
          ],
        },
      ],
    });

    const adapter = new PcobAdapter(prisma);
    const debugSpy = jest
      .spyOn((adapter as any).logger, 'debug')
      .mockImplementation(() => undefined);
    const telemetry = await adapter.normalizeTelemetryEnvelope(
      'match-1',
      {
        payload: {
          teams: [
            {
              teamId: 1,
              teamName: 'Team 1',
              liveMemberNum: 1,
            },
          ],
          players: [
            {
              teamId: 1,
              playerId: 'shadow-1',
              pubgAccountId: 'legacy-player-id',
              playerName: 'Alpha',
              liveState: 0,
            },
          ],
        },
      },
      {},
    );

    expect(telemetry?.players[0]).toMatchObject({
      playerId: 'player-uuid-1',
      pubgAccountId: null,
      teamId: 'team-1',
    });
    expect(
      debugSpy.mock.calls.some(
        (message) =>
          String(message).includes(
            '"message":"[TelemetryBind] fallback used"',
          ) && String(message).includes('"strategy":"NORMALIZED_NAME"'),
      ),
    ).toBe(true);
  });

  it('falls back to compact normalizedName when stylized telemetry names differ from roster punctuation', async () => {
    const prisma = createPrisma({
      matchSlots: [
        {
          slotNumber: 1,
          team: {
            id: 'team-1',
            name: 'Team 1',
            tag: 'T1',
            logoUrl: null,
          },
        },
      ],
      slotResults: [
        {
          slotNumber: 1,
          teamId: 'team-1',
          team: {
            id: 'team-1',
            name: 'Team 1',
            tag: 'T1',
            logoUrl: null,
          },
          players: [
            {
              id: 'player-result-1',
              playerId: 'player-uuid-1',
              playerName: 'BTDTRXE',
              player: {
                externalPlayerId: null,
                playerOpenId: null,
                inGameId: null,
                pubgPlayerId: null,
                ign: 'BTDTRXE',
              },
            },
          ],
        },
      ],
    });

    const adapter = new PcobAdapter(prisma);
    const debugSpy = jest
      .spyOn((adapter as any).logger, 'debug')
      .mockImplementation(() => undefined);
    const telemetry = await adapter.normalizeTelemetryEnvelope(
      'match-1',
      {
        payload: {
          teams: [
            {
              teamId: 1,
              teamName: 'Team 1',
              liveMemberNum: 1,
            },
          ],
          players: [
            {
              teamId: 1,
              playerName: 'BTD • T rxe',
              liveState: 0,
            },
          ],
        },
      },
      {},
    );

    expect(telemetry?.players[0]).toMatchObject({
      playerId: 'player-uuid-1',
      teamId: 'team-1',
    });
    expect(
      debugSpy.mock.calls.some(
        ([message]) =>
          String(message).includes(
            '"message":"[TelemetryBind] fallback used"',
          ) &&
          String(message).includes('"strategy":"NORMALIZED_NAME"') &&
          String(message).includes('"fallback":"COMPACT_NORMALIZED_NAME"'),
      ),
    ).toBe(true);
  });

  it('falls back to playerId when snapshot telemetry omits externalPlayerId', async () => {
    const prisma = createPrisma({
      matchSlots: [
        {
          slotNumber: 1,
          team: {
            id: 'team-1',
            name: 'Team 1',
            tag: 'T1',
            logoUrl: null,
          },
        },
      ],
      slotResults: [
        {
          slotNumber: 1,
          teamId: 'team-1',
          team: {
            id: 'team-1',
            name: 'Team 1',
            tag: 'T1',
            logoUrl: null,
          },
          players: [
            {
              id: 'player-result-1',
              playerId: 'player-uuid-1',
              externalPlayerId: 'provider-player-1',
              playerName: 'Alpha',
              player: {
                externalPlayerId: 'provider-player-1',
                playerOpenId: null,
                inGameId: null,
                pubgPlayerId: null,
                ign: 'Alpha',
              },
            },
          ],
        },
      ],
    });

    const adapter = new PcobAdapter(prisma);
    const telemetry = await adapter.normalizeTelemetryEnvelope(
      'match-1',
      {
        payload: {
          teams: [
            {
              teamId: 1,
              teamName: 'Team 1',
              liveMemberNum: 1,
            },
          ],
          players: [
            {
              teamId: 1,
              playerId: 'provider-player-1',
              playerName: 'Alpha',
              liveState: 0,
            },
          ],
        },
      },
      {},
    );

    expect(telemetry?.players[0]).toMatchObject({
      playerId: 'player-uuid-1',
      teamId: 'team-1',
    });
  });

  it('falls back to team-scoped name matching when normalized names are duplicated globally', async () => {
    const prisma = createPrisma({
      matchSlots: [
        {
          slotNumber: 1,
          team: {
            id: 'team-1',
            name: 'Team 1',
            tag: 'T1',
            logoUrl: null,
          },
        },
      ],
      slotResults: [
        {
          slotNumber: 1,
          teamId: 'team-1',
          team: {
            id: 'team-1',
            name: 'Team 1',
            tag: 'T1',
            logoUrl: null,
          },
          players: [
            {
              id: 'slot-player-result-1',
              playerId: null,
              playerName: 'Alpha',
              player: {
                externalPlayerId: null,
                playerOpenId: null,
                inGameId: null,
                pubgPlayerId: null,
                ign: null,
              },
            },
          ],
        },
        {
          slotNumber: 2,
          teamId: 'team-2',
          team: {
            id: 'team-2',
            name: 'Team 2',
            tag: 'T2',
            logoUrl: null,
          },
          players: [
            {
              id: 'slot-player-result-2',
              playerId: 'player-uuid-2',
              playerName: 'Alpha',
              player: {
                externalPlayerId: null,
                playerOpenId: null,
                inGameId: null,
                pubgPlayerId: null,
                ign: null,
              },
            },
          ],
        },
      ],
    });

    const adapter = new PcobAdapter(prisma);
    const debugSpy = jest
      .spyOn((adapter as any).logger, 'debug')
      .mockImplementation(() => undefined);
    const telemetry = await adapter.normalizeTelemetryEnvelope(
      'match-1',
      {
        payload: {
          teams: [
            {
              teamId: 1,
              teamName: 'Team 1',
              liveMemberNum: 1,
            },
            {
              teamId: 2,
              teamName: 'Team 2',
              liveMemberNum: 1,
            },
          ],
          players: [
            {
              teamId: 2,
              playerName: '  alpha  ',
              liveState: 0,
            },
          ],
        },
      },
      {},
    );

    expect(telemetry?.players[0]).toMatchObject({
      playerId: 'player-uuid-2',
      teamId: 'team-2',
    });
    expect(
      debugSpy.mock.calls.some(
        ([message]) =>
          String(message).includes(
            '"message":"[TelemetryBind] fallback used"',
          ) && String(message).includes('"strategy":"TEAM_NAME"'),
      ),
    ).toBe(true);
  });

  it('logs snapshot bind misses at debug and event bind misses at warn without breaking telemetry normalization', async () => {
    const prisma = createPrisma({
      matchSlots: [
        {
          slotNumber: 1,
          team: {
            id: 'team-1',
            name: 'Team 1',
            tag: 'T1',
            logoUrl: null,
          },
        },
      ],
      slotResults: [
        {
          slotNumber: 1,
          teamId: 'team-1',
          team: {
            id: 'team-1',
            name: 'Team 1',
            tag: 'T1',
            logoUrl: null,
          },
          players: [
            {
              id: 'player-result-1',
              playerId: 'player-uuid-1',
              playerName: 'Alpha',
              player: {
                externalPlayerId: 'provider-player-1',
                playerOpenId: null,
                inGameId: null,
                pubgPlayerId: null,
                ign: 'Alpha',
              },
            },
          ],
        },
      ],
    });

    const adapter = new PcobAdapter(prisma);
    const debugSpy = jest
      .spyOn((adapter as any).logger, 'debug')
      .mockImplementation(() => undefined);
    const warnSpy = jest
      .spyOn((adapter as any).logger, 'warn')
      .mockImplementation(() => undefined);
    const telemetry = await adapter.normalizeTelemetryEnvelope(
      'match-1',
      {
        payload: {
          teams: [
            {
              teamId: 1,
              teamName: 'Team 1',
              liveMemberNum: 1,
            },
          ],
          players: [
            {
              teamId: 1,
              playerId: 'unknown-1',
              playerName: 'Ghost',
              liveState: 0,
            },
          ],
          events: [
            {
              type: 'KILL',
              timestamp: 2000,
              killer: {
                teamId: 1,
                playerId: 'unknown-1',
                playerName: 'Ghost',
              },
              victim: {
                teamId: 1,
                playerId: 'unknown-2',
                playerName: 'Phantom',
              },
            },
          ],
        },
      },
      {},
    );

    expect(telemetry).toMatchObject({
      players: [
        {
          playerId: 'unknown-1',
          teamId: 'team-1',
        },
      ],
      events: [
        {
          type: 'KILL',
          killerId: 'unknown-1',
          killerTeamId: 'team-1',
          victimId: 'unknown-2',
          victimTeamId: 'team-1',
        },
      ],
    });

    const debugMessages = debugSpy.mock.calls.map(([message]) =>
      String(message),
    );
    const warnMessages = warnSpy.mock.calls.map(([message]) => String(message));
    expect(
      debugMessages.some(
        (message) =>
          message.includes('"action":"canonical-player-bind-miss"') &&
          message.includes('"source":"snapshot-player"') &&
          message.includes('"playerId":"unknown-1"') &&
          message.includes('"externalPlayerId":"unknown-1"') &&
          message.includes('"name":"Ghost"') &&
          message.includes('"reason":"NO_MATCHING_SLOT_PLAYER"'),
      ),
    ).toBe(true);
    expect(
      warnMessages.some(
        (message) =>
          message.includes('"action":"canonical-player-bind-miss"') &&
          message.includes('"source":"event-killer"') &&
          message.includes('"reason":"NO_MATCHING_SLOT_PLAYER"'),
      ),
    ).toBe(true);
    expect(
      warnMessages.some(
        (message) =>
          message.includes('"action":"canonical-player-bind-miss"') &&
          message.includes('"source":"event-victim"') &&
          message.includes('"reason":"NO_MATCHING_SLOT_PLAYER"'),
      ),
    ).toBe(true);
  });

  it('synthesizes a monotonic poll sequence when PCOB snapshot endpoints do not expose one', async () => {
    const prisma = createPrisma({
      id: 'match-1',
      status: 'LIVE',
      controlState: {
        state: 'LIVE',
      },
      adapterKey: 'pubgm-pcob',
      pcobSessionId: 'session-1',
      matchSlots: [
        {
          slotNumber: 1,
          team: {
            id: 'team-1',
            name: 'Team 1',
            tag: 'T1',
            logoUrl: null,
            players: [],
          },
        },
      ],
      slotResults: [],
    });

    const adapter = new PcobAdapter(prisma);
    jest
      .spyOn(adapter as any, 'consumeBufferedWsTelemetry')
      .mockReturnValue(null);
    jest
      .spyOn(adapter as any, 'ensureWebSocketConnected')
      .mockReturnValue(undefined);
    jest
      .spyOn(adapter as any, 'get')
      .mockResolvedValueOnce({
        TotalPlayerList: [
          {
            teamId: 1,
            uid: 'shadow-uid-1',
            playerName: 'Alpha',
            liveState: 0,
          },
        ],
      })
      .mockResolvedValueOnce({
        TeamInfoList: [
          {
            teamId: 1,
            teamName: 'Team 1',
            liveMemberNum: 1,
          },
        ],
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        TotalPlayerList: [
          {
            teamId: 1,
            uid: 'shadow-uid-1',
            playerName: 'Alpha',
            liveState: 0,
          },
        ],
      })
      .mockResolvedValueOnce({
        TeamInfoList: [
          {
            teamId: 1,
            teamName: 'Team 1',
            liveMemberNum: 1,
          },
        ],
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const first = await adapter.pullTelemetry('match-1', {});
    const second = await adapter.pullTelemetry('match-1', {});

    expect(first).toMatchObject({
      matchId: 'match-1',
      sessionId: 'session-1',
      sequence: 1,
      source: 'PCOB_API',
    });
    expect(second?.sequence).toBe(2);
  });

  it('synthesizes a monotonic push sequence when launcher envelopes do not expose one', async () => {
    const prisma = createPrisma({
      matchSlots: [
        {
          slotNumber: 1,
          team: {
            id: 'team-1',
            name: 'Team 1',
            tag: 'T1',
            logoUrl: null,
          },
        },
      ],
    });

    const adapter = new PcobAdapter(prisma);
    const first = await adapter.normalizeTelemetryEnvelope(
      'match-1',
      {
        sessionId: 'session-1',
        payload: {
          teams: [
            {
              teamId: 1,
              teamName: 'Team 1',
              liveMemberNum: 1,
            },
          ],
          players: [
            {
              uid: 'shadow-uid-1',
              playerName: 'Alpha',
              teamId: 1,
              liveState: 0,
            },
          ],
        },
      },
      {},
    );
    const second = await adapter.normalizeTelemetryEnvelope(
      'match-1',
      {
        sessionId: 'session-1',
        payload: {
          teams: [
            {
              teamId: 1,
              teamName: 'Team 1',
              liveMemberNum: 1,
            },
          ],
          players: [
            {
              uid: 'shadow-uid-1',
              playerName: 'Alpha',
              teamId: 1,
              liveState: 0,
            },
          ],
        },
      },
      {},
    );

    expect(first).toMatchObject({
      matchId: 'match-1',
      sessionId: 'session-1',
      sequence: 1,
      source: 'PCOB_PUSH',
    });
    expect(second?.sequence).toBe(2);
  });
});
