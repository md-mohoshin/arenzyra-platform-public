import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { OrganizerPlayersController } from './organizer-players.controller';
import { storePlayerPhotoProcessed } from '../teams/asset.util';

jest.mock('../teams/asset.util', () => ({
  storePlayerPhotoProcessed: jest.fn(),
}));

describe('OrganizerPlayersController', () => {
  it('emits player asset updates after organizer photo uploads', async () => {
    const players = {
      update: jest.fn().mockResolvedValue({ id: 'player-1' }),
    };
    const broadcast = {
      emitPlayerAssetUpdated: jest.fn(),
    };
    const controller = new OrganizerPlayersController(
      players as never,
      broadcast as never,
    );
    jest.mocked(storePlayerPhotoProcessed).mockResolvedValue({
      url: '/media/players/player-1/photo?v=123',
      version: 123,
    });

    await expect(
      controller.uploadPhoto(
        'player-1',
        { mimetype: 'image/png', buffer: Buffer.from('image') },
        {
          orgId: 'org-1',
          user: {
            id: 'user-1',
            actorId: 'user-1',
            organizationId: 'org-1',
            role: Role.ORGANIZER,
          },
        } as never,
      ),
    ).resolves.toEqual({
      ok: true,
      photoUrl: '/media/players/player-1/photo?v=123',
      version: 123,
    });

    expect(players.update).toHaveBeenCalledWith(
      'org-1',
      'player-1',
      { photoUrl: '/media/players/player-1/photo?v=123' },
      expect.objectContaining({ id: 'user-1' }),
    );
    expect(broadcast.emitPlayerAssetUpdated).toHaveBeenCalledWith({
      playerId: 'player-1',
      version: 123,
      photoUrl: '/media/players/player-1/photo?v=123',
    });
  });

  it('upserts and broadcasts Discord player photo uploads by uid', async () => {
    const players = {
      prepareDiscordPlayerPhotoTarget: jest.fn().mockResolvedValue({
        player: { id: 'player-uid-1' },
        uid: '111111',
        playerName: 'Volt',
        team: { id: 'team-1', name: 'Team DXB', tag: 'DXB' },
        created: true,
        matchedRoster: false,
      }),
      update: jest.fn().mockResolvedValue({ id: 'player-uid-1' }),
    };
    const broadcast = {
      emitPlayerAssetUpdated: jest.fn(),
    };
    const controller = new OrganizerPlayersController(
      players as never,
      broadcast as never,
    );
    jest.mocked(storePlayerPhotoProcessed).mockResolvedValue({
      url: '/media/players/player-uid-1/photo?v=456',
      version: 456,
    });

    await expect(
      controller.uploadDiscordPhoto(
        { uid: '111111', playerName: 'Volt', teamName: 'Team DXB' },
        { mimetype: 'image/png', buffer: Buffer.from('image') },
        {
          orgId: 'org-1',
          user: {
            id: 'user-1',
            actorId: 'user-1',
            organizationId: 'org-1',
            role: Role.ORGANIZER,
          },
        } as never,
      ),
    ).resolves.toEqual({
      ok: true,
      playerId: 'player-uid-1',
      uid: '111111',
      playerName: 'Volt',
      team: { id: 'team-1', name: 'Team DXB', tag: 'DXB' },
      created: true,
      matchedRoster: false,
      photoUrl: '/media/players/player-uid-1/photo?v=456',
      version: 456,
    });

    expect(players.prepareDiscordPlayerPhotoTarget).toHaveBeenCalledWith(
      'org-1',
      { uid: '111111', playerName: 'Volt', teamName: 'Team DXB' },
      expect.objectContaining({ id: 'user-1' }),
    );
    expect(players.update).toHaveBeenCalledWith(
      'org-1',
      'player-uid-1',
      { photoUrl: '/media/players/player-uid-1/photo?v=456' },
      expect.objectContaining({ id: 'user-1' }),
    );
    expect(broadcast.emitPlayerAssetUpdated).toHaveBeenCalledWith({
      playerId: 'player-uid-1',
      version: 456,
      photoUrl: '/media/players/player-uid-1/photo?v=456',
    });
  });

  it('uses the service-token photo update path for Discord bot uploads', async () => {
    const players = {
      prepareDiscordPlayerPhotoTarget: jest.fn().mockResolvedValue({
        player: { id: 'player-uid-1' },
        uid: '111111',
        playerName: 'Volt',
        team: { id: 'team-1', name: 'Team DXB', tag: 'DXB' },
        created: false,
        matchedRoster: false,
      }),
      update: jest.fn(),
      updateDiscordServicePhoto: jest
        .fn()
        .mockResolvedValue({ id: 'player-uid-1' }),
    };
    const broadcast = {
      emitPlayerAssetUpdated: jest.fn(),
    };
    const controller = new OrganizerPlayersController(
      players as never,
      broadcast as never,
    );
    jest.mocked(storePlayerPhotoProcessed).mockResolvedValue({
      url: '/media/players/player-uid-1/photo?v=789',
      version: 789,
    });

    await expect(
      controller.uploadDiscordPhoto(
        { uid: '111111', playerName: 'Volt', teamName: 'Team DXB' },
        { mimetype: 'image/png', buffer: Buffer.from('image') },
        {
          orgId: 'org-1',
          isServiceToken: true,
          user: {
            id: 'bot-user',
            actorId: 'bot-user',
            organizationId: 'org-1',
            role: Role.ORGANIZER,
          },
        } as never,
      ),
    ).resolves.toMatchObject({
      ok: true,
      playerId: 'player-uid-1',
      photoUrl: '/media/players/player-uid-1/photo?v=789',
      version: 789,
    });

    expect(players.prepareDiscordPlayerPhotoTarget).toHaveBeenCalledWith(
      'org-1',
      { uid: '111111', playerName: 'Volt', teamName: 'Team DXB' },
      expect.objectContaining({ id: 'bot-user', serviceToken: true }),
    );
    expect(players.updateDiscordServicePhoto).toHaveBeenCalledWith(
      'org-1',
      'player-uid-1',
      '/media/players/player-uid-1/photo?v=789',
      expect.objectContaining({ id: 'bot-user', serviceToken: true }),
    );
    expect(players.update).not.toHaveBeenCalled();
    expect(broadcast.emitPlayerAssetUpdated).toHaveBeenCalledWith({
      playerId: 'player-uid-1',
      version: 789,
      photoUrl: '/media/players/player-uid-1/photo?v=789',
    });
  });

  it('rejects invalid photo file types before broadcasting', async () => {
    const players = {
      update: jest.fn(),
    };
    const broadcast = {
      emitPlayerAssetUpdated: jest.fn(),
    };
    const controller = new OrganizerPlayersController(
      players as never,
      broadcast as never,
    );

    await expect(
      controller.uploadPhoto(
        'player-1',
        { mimetype: 'text/plain', buffer: Buffer.from('bad') },
        { orgId: 'org-1' } as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(players.update).not.toHaveBeenCalled();
    expect(broadcast.emitPlayerAssetUpdated).not.toHaveBeenCalled();
  });
});
