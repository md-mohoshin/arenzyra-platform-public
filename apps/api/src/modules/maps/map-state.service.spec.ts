import { MapStateService } from './map-state.service';
import { PrismaService } from '../../db/prisma.service';
import { PcobGateway } from '../pcob/pcob.gateway';
import { MatchControlStateStore } from '../match-control/state.store';

describe('MapStateService', () => {
  it('falls back to observer telemetry payload when live markers and pcob raw events are missing', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          map: 'MIRAMAR',
          matchSlots: [{ slotNumber: 3, teamId: 'team-uuid-1' }],
          tournament: {
            organizationId: 'org-1',
            ownerUserId: 'user-1',
          },
        }),
      },
      matchTelemetry: {
        findUnique: jest.fn().mockResolvedValue({
          updatedAt: new Date('2026-04-09T10:00:00.000Z'),
          payload: {
            observerTelemetry: {
              players: [
                {
                  playerName: 'Alpha',
                  playerOpenId: 'player-1',
                  teamId: 3,
                  health: 100,
                  liveState: 0,
                  location: { x: 150000, y: 250000, z: 0 },
                },
                {
                  playerName: 'Bravo',
                  playerOpenId: 'player-2',
                  teamId: 3,
                  health: 0,
                  liveState: 5,
                  location: { x: 152000, y: 248000, z: 0 },
                },
              ],
              circle: {
                circleInfo: {
                  CircleIndex: '3',
                  Counter: '105',
                  MaxTime: '125',
                },
              },
            },
          },
          zoneCenter: null,
          zoneRadius: null,
          zonePhaseIndex: null,
          zoneNextShrinkAt: null,
        }),
      },
      pcobRawEvent: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService;
    const gateway = {
      emitMapState: jest.fn(),
      emitMapUpdate: jest.fn(),
    } as unknown as PcobGateway;
    const stateStore = {
      get: jest.fn().mockResolvedValue(null),
    } as unknown as MatchControlStateStore;

    const service = new MapStateService(prisma, gateway, stateStore);
    const result = await service.getMapState('match-1');

    expect(result.map).toMatchObject({
      mapName: 'MIRAMAR',
      worldSize: 800000,
    });
    expect(result.updatedAt).toBe('2026-04-09T10:00:00.000Z');
    expect(result.playerMarkers).toEqual([
      {
        playerId: 'player-1',
        teamId: 'team-uuid-1',
        x: 150000,
        y: 250000,
        alive: true,
        knocked: false,
      },
    ]);
    expect(result.teamMarkers).toEqual([
      {
        teamId: 'team-uuid-1',
        x: 150000,
        y: 250000,
        alive: true,
        playerCount: 1,
        alivePlayers: 1,
      },
    ]);
    expect(result.circle.phaseIndex).toBe(3);
    expect(result.circle.nextShrinkAt).not.toBeNull();
  });

  it('infers a safe zone from observer player positions when only blue-zone flags are available', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-2',
          map: 'RONDO',
          matchSlots: [{ slotNumber: 5, teamId: 'team-uuid-5' }],
          tournament: {
            organizationId: 'org-1',
            ownerUserId: 'user-1',
          },
        }),
      },
      matchTelemetry: {
        findUnique: jest.fn().mockResolvedValue({
          updatedAt: new Date('2026-04-09T11:00:00.000Z'),
          payload: {
            observerTelemetry: {
              players: [
                {
                  playerName: 'Inside A',
                  playerOpenId: 'player-a',
                  teamId: 5,
                  health: 100,
                  liveState: 0,
                  isOutsideBlueCircle: false,
                  location: { x: 390000, y: 305000, z: 0 },
                },
                {
                  playerName: 'Inside B',
                  playerOpenId: 'player-b',
                  teamId: 5,
                  health: 100,
                  liveState: 0,
                  isOutsideBlueCircle: false,
                  location: { x: 420000, y: 298000, z: 0 },
                },
                {
                  playerName: 'Inside C',
                  playerOpenId: 'player-c',
                  teamId: 5,
                  health: 100,
                  liveState: 0,
                  isOutsideBlueCircle: false,
                  location: { x: 402000, y: 322000, z: 0 },
                },
                {
                  playerName: 'Outside A',
                  playerOpenId: 'player-d',
                  teamId: 6,
                  health: 100,
                  liveState: 0,
                  isOutsideBlueCircle: true,
                  location: { x: 540000, y: 300000, z: 0 },
                },
                {
                  playerName: 'Outside B',
                  playerOpenId: 'player-e',
                  teamId: 7,
                  health: 100,
                  liveState: 0,
                  isOutsideBlueCircle: true,
                  location: { x: 250000, y: 295000, z: 0 },
                },
              ],
              circle: {
                circleInfo: {
                  CircleIndex: '4',
                  Counter: '20',
                  MaxTime: '60',
                },
              },
            },
          },
          zoneCenter: null,
          zoneRadius: null,
          zonePhaseIndex: null,
          zoneNextShrinkAt: null,
        }),
      },
      pcobRawEvent: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService;
    const gateway = {
      emitMapState: jest.fn(),
      emitMapUpdate: jest.fn(),
    } as unknown as PcobGateway;
    const stateStore = {
      get: jest.fn().mockResolvedValue(null),
    } as unknown as MatchControlStateStore;

    const service = new MapStateService(prisma, gateway, stateStore);
    const result = await service.getMapState('match-2');
    const safeZone = result.circle.safeZone;

    expect(safeZone).not.toBeNull();
    if (!safeZone) {
      throw new Error('Expected inferred safe zone');
    }

    expect(typeof safeZone.x).toBe('number');
    expect(typeof safeZone.y).toBe('number');
    expect(typeof safeZone.r).toBe('number');
    expect(safeZone.x).toBeGreaterThan(330000);
    expect(safeZone.x).toBeLessThan(470000);
    expect(safeZone.y).toBeGreaterThan(250000);
    expect(safeZone.y).toBeLessThan(360000);
    expect(safeZone.r).toBeGreaterThan(10000);
    expect(safeZone.r).toBeLessThan(170000);
    expect(result.updatedAt).toBe('2026-04-09T11:00:00.000Z');
  });

  it('propagates raw-event freshness when pcob fallback markers are used', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-3',
          map: 'ERANGEL',
          matchSlots: [{ slotNumber: 4, teamId: 'team-uuid-4' }],
          tournament: {
            organizationId: 'org-1',
            ownerUserId: 'user-1',
          },
        }),
      },
      matchTelemetry: {
        findUnique: jest.fn().mockResolvedValue({
          updatedAt: new Date('2026-04-09T11:59:00.000Z'),
          payload: null,
          zoneCenter: null,
          zoneRadius: null,
          zonePhaseIndex: null,
          zoneNextShrinkAt: null,
        }),
      },
      pcobRawEvent: {
        findMany: jest.fn().mockResolvedValue([
          {
            timestamp: '2026-04-09T12:00:05.000Z',
            receivedAt: '2026-04-09T12:00:06.000Z',
            payload: {
              playerId: 'player-4',
              teamId: 'team-uuid-4',
              position: { x: 412345, y: 287654 },
            },
          },
        ]),
      },
    } as unknown as PrismaService;
    const gateway = {
      emitMapState: jest.fn(),
      emitMapUpdate: jest.fn(),
    } as unknown as PcobGateway;
    const stateStore = {
      get: jest.fn().mockResolvedValue(null),
    } as unknown as MatchControlStateStore;

    const service = new MapStateService(prisma, gateway, stateStore);
    const result = await service.getMapState('match-3');

    expect(result.updatedAt).toBe('2026-04-09T12:00:05.000Z');
    expect(result.playerMarkers).toEqual([
      {
        playerId: 'player-4',
        teamId: 'team-uuid-4',
        x: 412345,
        y: 287654,
        alive: undefined,
        knocked: undefined,
      },
    ]);
  });
});
