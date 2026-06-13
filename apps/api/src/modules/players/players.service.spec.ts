import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  LiveState,
  PlayerSource,
  Role,
  TournamentStatus,
} from '@prisma/client';
import { PlayersService } from './players.service';

const actor = {
  id: 'user-1',
  actorId: 'user-1',
  organizationId: 'org-1',
  role: Role.ORGANIZER,
};

const existingPlayer = {
  id: 'player-1',
  organizationId: 'org-1',
  teamId: 'team-1',
  ign: 'Original',
  realName: null,
  role: null,
  photoUrl: null,
  country: null,
  isActive: true,
  inGameId: '12345',
  pubgPlayerId: '12345',
  source: PlayerSource.MANUAL,
  externalSource: null,
  externalId: null,
  deletedAt: null,
  team: { id: 'team-1', ownerUserId: 'user-1' },
};

describe('PlayersService roster locks', () => {
  it('allows photo-only updates without checking active tournament roster locks', async () => {
    const prisma = {
      organizationBranding: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      player: {
        findFirst: jest.fn().mockResolvedValue(existingPlayer),
        update: jest.fn().mockResolvedValue({
          ...existingPlayer,
          photoUrl: '/media/players/player-1/photo?v=123',
        }),
      },
      tournamentTeam: {
        findMany: jest.fn().mockRejectedValue(new Error('roster lock checked')),
      },
    };

    const service = new PlayersService(prisma as never);

    await expect(
      service.update(
        'org-1',
        'player-1',
        { photoUrl: '/media/players/player-1/photo?v=123' },
        actor,
      ),
    ).resolves.toMatchObject({
      id: 'player-1',
      photoUrl: '/media/players/player-1/photo?v=123',
    });

    expect(prisma.tournamentTeam.findMany).not.toHaveBeenCalled();
    expect(prisma.player.update).toHaveBeenCalledWith({
      where: { id: 'player-1' },
      data: { photoUrl: '/media/players/player-1/photo?v=123' },
    });
  });

  it('keeps player identity updates locked for active tournament rosters', async () => {
    const prisma = {
      organizationBranding: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      player: {
        findFirst: jest.fn().mockResolvedValue(existingPlayer),
        update: jest.fn(),
      },
      tournamentTeam: {
        findMany: jest.fn().mockResolvedValue([
          {
            tournament: {
              id: 'tournament-1',
              name: 'Live Cup',
              status: TournamentStatus.ACTIVE,
              liveState: LiveState.LIVE,
              endedAt: null,
            },
          },
        ]),
      },
    };

    const service = new PlayersService(prisma as never);

    await expect(
      service.update('org-1', 'player-1', { ign: 'Changed' }, actor),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.player.update).not.toHaveBeenCalled();
  });

  it('creates a persistent Discord photo player keyed by uid', async () => {
    const createdPlayer = {
      ...existingPlayer,
      id: 'player-uid-1',
      teamId: 'team-1',
      ign: 'Volt',
      inGameId: '111111',
      pubgPlayerId: '111111',
      externalPlayerId: '111111',
    };
    const prisma = {
      sessionRegistration: {
        findMany: jest.fn(),
      },
      team: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'team-1',
          name: 'Team DXB',
          tag: 'DXB',
        }),
      },
      player: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        create: jest.fn().mockResolvedValue(createdPlayer),
      },
    };
    const service = new PlayersService(prisma as never);

    await expect(
      service.prepareDiscordPlayerPhotoTarget(
        'org-1',
        { uid: '111 111', playerName: 'Volt', teamName: 'Team DXB' },
        actor,
      ),
    ).resolves.toMatchObject({
      player: { id: 'player-uid-1', externalPlayerId: '111111' },
      uid: '111111',
      playerName: 'Volt',
      team: { id: 'team-1', name: 'Team DXB', tag: 'DXB' },
      created: true,
      matchedRoster: false,
    });

    expect(prisma.player.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        teamId: 'team-1',
        ign: 'Volt',
        inGameId: '111111',
        pubgPlayerId: '111111',
        externalPlayerId: '111111',
        source: PlayerSource.MANUAL,
      }),
    });
  });

  it('lets service-token Discord photo uploads update only the photo URL', async () => {
    const serviceActor = {
      ...actor,
      id: 'bot-user',
      actorId: 'bot-user',
      serviceToken: true,
    };
    const prisma = {
      organizationBranding: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      player: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'player-1',
        }),
        update: jest.fn().mockResolvedValue({
          ...existingPlayer,
          team: undefined,
          photoUrl: '/media/players/player-1/photo?v=456',
        }),
      },
      tournamentTeam: {
        findMany: jest.fn().mockRejectedValue(new Error('roster lock checked')),
      },
    };

    const service = new PlayersService(prisma as never);

    await expect(
      service.updateDiscordServicePhoto(
        'org-1',
        'player-1',
        '/media/players/player-1/photo?v=456',
        serviceActor,
      ),
    ).resolves.toMatchObject({
      id: 'player-1',
      photoUrl: '/media/players/player-1/photo?v=456',
    });

    expect(prisma.player.findFirst).toHaveBeenCalledWith({
      where: { id: 'player-1', organizationId: 'org-1', deletedAt: null },
      select: { id: true },
    });
    expect(prisma.tournamentTeam.findMany).not.toHaveBeenCalled();
    expect(prisma.player.update).toHaveBeenCalledWith({
      where: { id: 'player-1' },
      data: { photoUrl: '/media/players/player-1/photo?v=456' },
    });
  });

  it('rejects Discord service photo updates without a service token actor', async () => {
    const prisma = {
      player: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };

    const service = new PlayersService(prisma as never);

    await expect(
      service.updateDiscordServicePhoto(
        'org-1',
        'player-1',
        '/media/players/player-1/photo?v=456',
        actor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.player.findFirst).not.toHaveBeenCalled();
    expect(prisma.player.update).not.toHaveBeenCalled();
  });
});
