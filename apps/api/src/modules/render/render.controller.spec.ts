import { StreamableFile } from '@nestjs/common';
import { RenderController } from './render.controller';

describe('RenderController', () => {
  const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const req = {
    user: {
      id: 'user-1',
      actorId: 'user-1',
      organizationId: 'org-1',
      actingOrgId: 'org-1',
      role: 'ORGANIZER',
      actorRole: 'ORGANIZER',
    },
  } as any;

  const renderService = {
    renderMatchResultImage: jest.fn().mockResolvedValue(pngBuffer),
    renderDiscordMatchImage: jest.fn().mockResolvedValue(pngBuffer),
    renderSessionStandingsImage: jest.fn().mockResolvedValue(pngBuffer),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a png streamable file for match renders', async () => {
    const controller = new RenderController(renderService as any);

    const result = await controller.renderMatch('match-1', req);

    expect(result).toBeInstanceOf(StreamableFile);
    expect(result.getHeaders()).toEqual(
      expect.objectContaining({
        type: 'image/png',
      }),
    );
    expect(renderService.renderMatchResultImage).toHaveBeenCalledWith(
      req.user,
      'match-1',
    );
  });

  it('returns a png streamable file for session standings renders', async () => {
    const controller = new RenderController(renderService as any);

    const result = await controller.renderSessionStandings('session-1', req);

    expect(result).toBeInstanceOf(StreamableFile);
    expect(result.getHeaders()).toEqual(
      expect.objectContaining({
        type: 'image/png',
      }),
    );
    expect(renderService.renderSessionStandingsImage).toHaveBeenCalledWith(
      req.user,
      'session-1',
    );
  });

  it('returns a png streamable file for Discord match card renders', async () => {
    const controller = new RenderController(renderService as any);

    const result = await controller.renderDiscordMatch(
      'match-1',
      'top-fraggers',
      req,
    );

    expect(result).toBeInstanceOf(StreamableFile);
    expect(result.getHeaders()).toEqual(
      expect.objectContaining({
        type: 'image/png',
      }),
    );
    expect(renderService.renderDiscordMatchImage).toHaveBeenCalledWith(
      req.user,
      'match-1',
      'top-fraggers',
    );
  });
});
