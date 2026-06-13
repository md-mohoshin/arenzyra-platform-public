import { RealtimeGateway } from './realtime.gateway';
import { Role } from '@prisma/client';

const createLockedMatch = () => ({
  id: 'match-1',
  deletedAt: null,
  organizationId: 'org-1',
  status: 'LIVE',
  liveState: 'LIVE',
  telemetrySource: 'LAUNCHER',
  telemetrySourceLockedAt: new Date('2026-04-04T18:00:00.000Z'),
  controlState: {
    state: 'LIVE',
    organizationId: 'org-1',
    metaJson: {
      telemetrySource: 'LAUNCHER',
    },
  },
  tournament: {
    organizationId: 'org-1',
  },
});

describe('RealtimeGateway telemetry source enforcement', () => {
  it('joins unauthenticated clients to public rooms only on connection', () => {
    const gateway = new RealtimeGateway({} as any, {} as any, {} as any);
    const server = {
      use: jest.fn(),
      to: jest.fn(),
    } as any;

    gateway.afterInit(server);

    const middleware = server.use.mock.calls[0][0] as (
      socket: any,
      next: (err?: Error) => void,
    ) => void;
    const socket = {
      data: {},
      handshake: {
        query: {
          matchId: 'match-1',
          organizationId: 'org-1',
        },
        headers: {},
      },
      join: jest.fn(),
    } as any;
    const next = jest.fn();

    middleware(socket, next);

    expect(socket.join).toHaveBeenCalledWith('public:org:org-1');
    expect(socket.join).toHaveBeenCalledWith('public:match:match-1');
    expect(socket.join).not.toHaveBeenCalledWith('org:org-1');
    expect(socket.join).not.toHaveBeenCalledWith('match:match-1');
    expect(next).toHaveBeenCalledWith();
  });

  it('joins authenticated clients to private rooms on connection', () => {
    const jwt = {
      verify: jest.fn().mockReturnValue({
        sub: 'user-1',
        role: Role.ORGANIZER,
        actorRole: Role.ORGANIZER,
        organizationId: 'org-1',
      }),
    } as any;
    const gateway = new RealtimeGateway(jwt, {} as any, {} as any);
    const server = {
      use: jest.fn(),
      to: jest.fn(),
    } as any;

    gateway.afterInit(server);

    const middleware = server.use.mock.calls[0][0] as (
      socket: any,
      next: (err?: Error) => void,
    ) => void;
    const socket = {
      data: {},
      handshake: {
        query: {
          matchId: 'match-1',
          organizationId: 'org-2',
        },
        auth: {
          token: 'Bearer test-token',
        },
        headers: {},
      },
      join: jest.fn(),
    } as any;
    const next = jest.fn();

    middleware(socket, next);

    expect(jwt.verify).toHaveBeenCalledWith('test-token');
    expect(socket.join).toHaveBeenCalledWith('org:org-1');
    expect(socket.join).toHaveBeenCalledWith('match:match-1');
    expect(socket.join).not.toHaveBeenCalledWith('org:org-2');
    expect(socket.join).not.toHaveBeenCalledWith('public:org:org-1');
    expect(socket.join).not.toHaveBeenCalledWith('public:match:match-1');
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects unauthenticated bind_match attempts before joining private rooms', async () => {
    const gateway = new RealtimeGateway({} as any, {} as any, {} as any);
    const socket = {
      data: {},
      emit: jest.fn(),
      join: jest.fn(),
    } as any;

    await gateway.handleBindMatch(socket, { matchId: 'match-1' });

    expect(socket.emit).toHaveBeenCalledWith('match:error', {
      reason: 'unauthenticated',
    });
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('binds authenticated clients into private match and org rooms', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({ id: 'match-1' }),
      },
    } as any;
    const gateway = new RealtimeGateway({} as any, prisma, {} as any);
    const socket = {
      data: {
        user: {
          id: 'user-1',
          role: Role.ORGANIZER,
          organizationId: 'org-1',
          actorId: 'user-1',
          actorRole: Role.ORGANIZER,
          actingOrgId: null,
          actingRole: null,
          actingOrgName: null,
          actingAsUserId: null,
          realRole: Role.ORGANIZER,
        },
        organizationId: 'org-1',
      },
      emit: jest.fn(),
      join: jest.fn(),
    } as any;

    await gateway.handleBindMatch(socket, { matchId: 'match-1' });

    expect(prisma.match.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'match-1',
        deletedAt: null,
        organizationId: 'org-1',
      },
      select: { id: true },
    });
    expect(socket.join).toHaveBeenCalledWith('match:match-1');
    expect(socket.join).toHaveBeenCalledWith('org:org-1');
    expect(socket.emit).toHaveBeenCalledWith('match:bound', {
      matchId: 'match-1',
      status: 'bound',
    });
  });

  it('broadcasts pcob telemetry and live rankings when automatic aliases are locked as API', async () => {
    const emitToRoom = jest.fn();
    const prisma = {
      match: {
        findUnique: jest.fn().mockResolvedValue(createLockedMatch()),
      },
    } as any;
    const rankingEmitter = {
      emitLiveRanking: jest.fn(),
    } as any;
    const gateway = new RealtimeGateway({} as any, prisma, rankingEmitter);

    gateway.io = {
      use: jest.fn(),
      to: jest.fn().mockReturnValue({
        emit: emitToRoom,
      }),
    } as any;

    const socket = {
      data: { matchId: 'match-1' },
      emit: jest.fn(),
    } as any;

    await gateway.handleTelemetry(socket, {
      type: 'TEAM_SNAPSHOT',
      teams: [],
    });

    expect(prisma.match.findUnique).toHaveBeenCalledWith({
      where: { id: 'match-1' },
      select: expect.objectContaining({
        id: true,
        telemetrySource: true,
      }),
    });
    expect(gateway.io.to).toHaveBeenCalledWith('match:match-1');
    expect(emitToRoom).toHaveBeenCalledWith('pcob:telemetry', {
      type: 'TEAM_SNAPSHOT',
      teams: [],
    });
    expect(rankingEmitter.emitLiveRanking).toHaveBeenCalledWith('match-1', {
      requester: socket,
    });
    expect(socket.emit).not.toHaveBeenCalledWith('match:error', {
      reason: 'telemetry_source_mismatch',
    });
  });

  it('emits canonical match control updates with monotonic sequence metadata', async () => {
    const emissions: Array<{
      room: string;
      event: string;
      payload: unknown;
    }> = [];
    const prisma = {
      match: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          tournament: { organizationId: 'org-1' },
          controlState: {
            organizationId: 'org-1',
            version: 12,
            metaJson: {
              liveSync: {
                version: 34,
                updatedAt: 1710000000000,
                overrides: { players: {}, teams: {} },
                auditTrail: [],
              },
            },
          },
        }),
      },
    } as any;
    const gateway = new RealtimeGateway({} as any, prisma, {} as any);

    gateway.io = {
      use: jest.fn(),
      to: jest.fn().mockImplementation((room: string) => ({
        emit: (event: string, payload: unknown) =>
          emissions.push({ room, event, payload }),
      })),
    } as any;

    const first = await gateway.emitMatchControlUpdate(
      'match-1',
      'RESULTS_CHANGED',
    );
    const second = await gateway.emitMatchControlUpdate(
      'match-1',
      'SLOTS_CHANGED',
    );

    expect(first).toEqual(
      expect.objectContaining({
        matchId: 'match-1',
        orgId: 'org-1',
        controlVersion: 12,
        resultsVersion: 34,
        eventType: 'RESULTS_CHANGED',
      }),
    );
    expect(second).toEqual(
      expect.objectContaining({
        matchId: 'match-1',
        orgId: 'org-1',
        controlVersion: 12,
        resultsVersion: 34,
        eventType: 'SLOTS_CHANGED',
      }),
    );
    expect((first?.sequence ?? 0) < (second?.sequence ?? 0)).toBe(true);
    expect(emissions).toEqual([
      {
        room: 'match:match-1',
        event: 'match:control:update',
        payload: first,
      },
      {
        room: 'org:org-1',
        event: 'match:control:update',
        payload: first,
      },
      {
        room: 'match:match-1',
        event: 'match:control:update',
        payload: second,
      },
      {
        room: 'org:org-1',
        event: 'match:control:update',
        payload: second,
      },
    ]);
  });

  it('sanitizes payloads for public realtime rooms while keeping private rooms full-fidelity', () => {
    const emissions: Array<{
      room: string;
      event: string;
      payload: Record<string, unknown>;
    }> = [];
    const gateway = new RealtimeGateway({} as any, {} as any, {} as any);

    gateway.io = {
      use: jest.fn(),
      to: jest.fn().mockImplementation((room: string) => ({
        emit: (event: string, payload: Record<string, unknown>) =>
          emissions.push({ room, event, payload }),
      })),
    } as any;

    gateway.emitMatchScopedEvent(
      'match-1',
      'match:update',
      {
        matchId: 'match-1',
        accessToken: 'secret',
        internalFlags: { visible: false },
        canWrite: true,
        nested: {
          authToken: 'nested-secret',
          safeValue: 3,
        },
      },
      'org-1',
    );

    expect(emissions).toHaveLength(4);
    const privateMatchEmission = emissions.find(
      (entry) => entry.room === 'match:match-1',
    );
    const publicMatchEmission = emissions.find(
      (entry) => entry.room === 'public:match:match-1',
    );

    expect(privateMatchEmission?.payload).toMatchObject({
      matchId: 'match-1',
      accessToken: 'secret',
      canWrite: true,
      nested: {
        authToken: 'nested-secret',
        safeValue: 3,
      },
    });
    expect(publicMatchEmission?.payload).toMatchObject({
      matchId: 'match-1',
      nested: { safeValue: 3 },
    });
    expect(publicMatchEmission?.payload).not.toHaveProperty('accessToken');
    expect(publicMatchEmission?.payload).not.toHaveProperty('internalFlags');
    expect(publicMatchEmission?.payload).not.toHaveProperty('canWrite');
    expect(publicMatchEmission?.payload.nested).not.toHaveProperty('authToken');
  });
});
