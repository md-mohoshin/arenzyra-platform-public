import { PcobGateway } from './pcob.gateway';

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

const flushAsync = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
};

describe('PcobGateway telemetry source enforcement', () => {
  it('does not relay redis-backed telemetry when the match is locked to another source', async () => {
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

    expect((gateway as any).io.to).not.toHaveBeenCalled();
    expect(emitToRoom).not.toHaveBeenCalled();
  });

  it('rejects socket telemetry before scale filtering or live relay when the source mismatches', async () => {
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

    connectionHandler?.(socket);
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
    expect(scale.filter).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
    expect(emitToRoom).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('match:error', {
      matchId: 'match-1',
      reason: 'telemetry_source_mismatch',
    });
  });
});
