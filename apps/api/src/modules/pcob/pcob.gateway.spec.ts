import { PcobGateway } from './pcob.gateway';

const createLockedMatch = () => ({
  id: 'match-1',
  deletedAt: null,
  organizationId: 'org-1',
  status: 'LIVE',
  liveState: 'LIVE',
  dataSource: 'PCOB',
  dataMode: 'PCOB',
  pcobMode: true,
  pcobSessionId: 'session-1',
  adapterKey: 'pubgm-pcob',
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

const flushAsync = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
};

describe('PcobGateway telemetry source enforcement', () => {
  it('rejects producer binding for API-bound compatibility matches', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          controlState: { organizationId: 'org-1' },
          tournament: { ownerUserId: 'user-1', organizationId: 'org-1' },
        }),
        findUnique: jest.fn().mockResolvedValue({
          dataSource: 'API',
          dataMode: 'MANUAL',
          pcobMode: false,
          pcobSessionId: 'session-1',
          adapterKey: 'pubgm-pcob',
        }),
      },
    } as any;
    const gateway = new PcobGateway(
      {} as any,
      {} as any,
      { filter: jest.fn().mockReturnValue(true) } as any,
      prisma,
    );

    let connectionHandler: ((socket: any) => void) | null = null;
    (gateway as any).io = {
      use: jest.fn(),
      on: jest.fn((event: string, handler: (socket: any) => void) => {
        if (event === 'connection') {
          connectionHandler = handler;
        }
      }),
      emit: jest.fn(),
      to: jest.fn(),
    };

    gateway.afterInit();

    const handlers: Record<string, (...args: any[]) => any> = {};
    const socket = {
      id: 'socket-1',
      data: {
        user: {
          id: 'user-1',
          role: 'ORGANIZER',
          organizationId: 'org-1',
          actorId: 'user-1',
        },
        organizationId: 'org-1',
      },
      handshake: {
        query: {},
        auth: {},
        headers: {},
      },
      join: jest.fn(),
      leave: jest.fn(),
      disconnect: jest.fn(),
      emit: jest.fn(),
      on: jest.fn((event: string, handler: (...args: any[]) => any) => {
        handlers[event] = handler;
      }),
    } as any;

    const handleConnection = connectionHandler as (socket: any) => void;
    handleConnection(socket);

    const ack = jest.fn();
    handlers['pcob:bind']({ matchId: 'match-1', nodeId: 'node-1' }, ack);
    await flushAsync();

    expect(prisma.match.findUnique).toHaveBeenCalledWith({
      where: { id: 'match-1' },
      select: {
        dataSource: true,
        dataMode: true,
        pcobMode: true,
        pcobSessionId: true,
        adapterKey: true,
      },
    });
    expect(socket.join).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith({
      ok: false,
      reason: 'legacy_pcob_disabled',
    });
  });

  it('relays redis-backed telemetry when legacy automatic aliases are locked as API', async () => {
    const emitToRoom = jest.fn();
    const gateway = new PcobGateway(
      {} as any,
      {} as any,
      { filter: jest.fn().mockReturnValue(true) } as any,
      {
        match: {
          findUnique: jest.fn().mockResolvedValue(createLockedMatch()),
          findFirst: jest.fn(),
        },
      } as any,
    );

    (gateway as any).io = {
      use: jest.fn(),
      on: jest.fn(),
      emit: jest.fn(),
      to: jest.fn().mockReturnValue({
        emit: emitToRoom,
      }),
    };

    gateway.broadcastTelemetry(
      'match-1',
      {
        type: 'TEAM_SNAPSHOT',
        matchId: 'match-1',
        ts: Date.now(),
        payload: { teams: [] },
        meta: { nodeId: 'node-1' },
      } as any,
      'org-1',
    );

    await flushAsync();

    expect((gateway as any).io.to).toHaveBeenCalledWith('match:org-1:match-1');
    expect(emitToRoom).toHaveBeenCalledWith(
      'pcob:telemetry:live',
      expect.objectContaining({
        type: 'TEAM_SNAPSHOT',
        matchId: 'match-1',
      }),
    );
  });

  it('accepts socket telemetry aliases before scale filtering and live relay when locked as API', async () => {
    const emitToRoom = jest.fn();
    const scale = {
      filter: jest.fn().mockReturnValue(true),
    } as any;
    const prisma = {
      match: {
        findUnique: jest.fn().mockResolvedValue(createLockedMatch()),
        findFirst: jest.fn(),
      },
    } as any;
    const gateway = new PcobGateway({} as any, {} as any, scale, prisma);

    let connectionHandler: ((socket: any) => void) | null = null;
    const io = {
      use: jest.fn(),
      on: jest.fn((event: string, handler: (socket: any) => void) => {
        if (event === 'connection') {
          connectionHandler = handler;
        }
      }),
      emit: jest.fn(),
      to: jest.fn().mockReturnValue({
        emit: emitToRoom,
      }),
    };

    (gateway as any).io = io;
    gateway.afterInit();

    const handlers: Record<string, (...args: any[]) => any> = {};
    const socket = {
      id: 'socket-1',
      data: {
        user: {
          id: 'user-1',
          role: 'SUPER_ADMIN',
          organizationId: 'org-1',
          actorId: 'user-1',
          clientId: 'client-1',
        },
        organizationId: 'org-1',
      },
      handshake: {
        query: {},
        auth: {},
        headers: {},
      },
      join: jest.fn(),
      leave: jest.fn(),
      disconnect: jest.fn(),
      emit: jest.fn(),
      on: jest.fn((event: string, handler: (...args: any[]) => any) => {
        handlers[event] = handler;
      }),
    } as any;

    expect(connectionHandler).toBeTruthy();
    const handleConnection = connectionHandler as unknown as (
      socket: any,
    ) => void;
    handleConnection(socket);
    (gateway as any).bindings.set(socket.id, {
      matchId: 'match-1',
      nodeId: 'node-1',
    });

    handlers['pcob:telemetry']({
      type: 'TEAM_SNAPSHOT',
      matchId: 'match-1',
      ts: Date.now(),
      payload: { teams: [] },
      meta: { nodeId: 'node-1' },
    });
    await flushAsync();

    expect(prisma.match.findUnique).toHaveBeenCalledWith({
      where: { id: 'match-1' },
      select: expect.objectContaining({
        id: true,
        telemetrySource: true,
      }),
    });
    expect(scale.filter).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({
        type: 'TEAM_SNAPSHOT',
        matchId: 'match-1',
      }),
    );
    expect(io.to).toHaveBeenCalledWith('match:org-1:match-1');
    expect(emitToRoom).toHaveBeenCalledWith(
      'pcob:telemetry:live',
      expect.objectContaining({
        type: 'TEAM_SNAPSHOT',
        matchId: 'match-1',
      }),
    );
    expect(socket.emit).not.toHaveBeenCalledWith('match:error', {
      matchId: 'match-1',
      reason: 'telemetry_source_mismatch',
    });
  });
});
