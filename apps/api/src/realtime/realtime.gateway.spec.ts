import { RealtimeGateway } from './realtime.gateway';

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
  it('does not broadcast pcob telemetry or live rankings when the source is locked elsewhere', async () => {
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
    expect(gateway.io.to).not.toHaveBeenCalled();
    expect(emitToRoom).not.toHaveBeenCalled();
    expect(rankingEmitter.emitLiveRanking).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('match:error', {
      reason: 'telemetry_source_mismatch',
    });
  });
});
