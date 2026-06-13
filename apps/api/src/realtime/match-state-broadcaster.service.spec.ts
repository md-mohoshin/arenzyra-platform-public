import { MatchStateBroadcaster } from './match-state-broadcaster.service';
import type { RealtimeGateway } from './realtime.gateway';
import type { MatchControlStateStore } from '../modules/match-control/state.store';
import type { OverlayBroadcaster } from '../modules/realtime/overlay-broadcaster.service';
import type { PrismaService } from '../db/prisma.service';

describe('MatchStateBroadcaster', () => {
  it('emits match_state_updated with the resolved organizationId', async () => {
    const realtime = {
      emitMatchScopedEvent: jest.fn(),
    } as unknown as RealtimeGateway;
    const store = {} as MatchControlStateStore;
    const overlay = {
      broadcastUpdate: jest.fn(),
    } as unknown as OverlayBroadcaster;
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          controlState: { organizationId: null },
          tournament: { organizationId: null },
        }),
      },
    } as unknown as PrismaService;

    const service = new MatchStateBroadcaster(realtime, store, overlay, prisma);

    await service.broadcastUpdate({
      matchId: 'match-1',
      status: 'LIVE',
      startedAt: '2026-03-19T14:00:00.000Z',
      endedAt: null,
      version: 7,
      updatedAt: '2026-03-19T14:00:05.000Z',
      summary: {
        totalTeams: 2,
        aliveTeams: 2,
        totalPlayers: 8,
        alivePlayers: 8,
        winnerTeamId: null,
        winnerSlot: null,
      },
      teams: [
        {
          teamId: 'team-1',
          name: 'Team 1',
          tag: 'T1',
          slot: 1,
          kills: 1,
          placement: null,
          points: null,
          logoUrl: null,
          alivePlayers: 4,
          totalPlayers: 4,
          eliminated: false,
          players: [],
        },
      ],
    });

    expect(realtime.emitMatchScopedEvent).toHaveBeenCalledWith(
      'match-1',
      'match_state_updated',
      expect.objectContaining({
        matchId: 'match-1',
        version: 7,
        status: 'LIVE',
      }),
      'org-1',
    );
    expect(overlay.broadcastUpdate).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({
        matchId: 'match-1',
        version: 7,
      }),
      'org-1',
    );
  });

  it('does not emit eliminated overlays during plane transition state', async () => {
    const realtime = {
      emitMatchScopedEvent: jest.fn(),
    } as unknown as RealtimeGateway;
    const store = {} as MatchControlStateStore;
    const overlay = {
      broadcastUpdate: jest.fn(),
      broadcastTeamEliminated: jest.fn(),
    } as unknown as OverlayBroadcaster;
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          controlState: { organizationId: null },
          tournament: { organizationId: null },
        }),
      },
    } as unknown as PrismaService;

    const service = new MatchStateBroadcaster(realtime, store, overlay, prisma);

    await service.broadcastUpdate({
      matchId: 'match-1',
      status: 'LIVE',
      startedAt: '2026-03-19T14:00:00.000Z',
      endedAt: null,
      version: 8,
      updatedAt: '2026-03-19T14:00:06.000Z',
      initialized: true,
      summary: {
        totalTeams: 2,
        aliveTeams: 0,
        totalPlayers: 8,
        alivePlayers: 0,
        winnerTeamId: null,
        winnerSlot: null,
      },
      circle: { phase: 1 },
      teams: [
        {
          teamId: 'team-1',
          name: 'Team 1',
          tag: 'T1',
          slot: 1,
          kills: 1,
          placement: null,
          points: null,
          logoUrl: null,
          alivePlayers: 0,
          totalPlayers: 4,
          eliminated: true,
          players: [],
        },
      ],
    });

    expect(overlay.broadcastUpdate).toHaveBeenCalled();
    expect(overlay.broadcastTeamEliminated).not.toHaveBeenCalled();
  });
});
