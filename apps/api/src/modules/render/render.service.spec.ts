import { MatchStatus, Role } from '@prisma/client';
import puppeteer from 'puppeteer';
import { RenderService } from './render.service';

jest.mock('puppeteer', () => ({
  __esModule: true,
  default: {
    launch: jest.fn(),
  },
}));

describe('RenderService', () => {
  const actor = {
    id: 'user-1',
    actorId: 'user-1',
    role: Role.ORGANIZER,
    actorRole: Role.ORGANIZER,
    organizationId: 'org-1',
    actingOrgId: 'org-1',
  };

  const brandingService = {
    getEffectiveBranding: jest.fn().mockResolvedValue({
      primaryColor: '#00e5ff',
      backgroundCss: '#0b0f14',
      backgroundSolid: '#0b0f14',
      textPrimary: '#ffffff',
      textMuted: '#94a3b8',
      panel: 'rgba(11,15,20,0.7)',
      border: 'rgba(255,255,255,0.12)',
      shadow: '0 24px 64px rgba(0,0,0,0.45)',
    }),
  };

  const buildService = () => {
    const prisma = {
      match: {
        findFirst: jest.fn(),
      },
      session: {
        findFirst: jest.fn(),
      },
    };
    const results = {
      ensureMatch: jest.fn(),
    };
    const sessionsStandings = {
      getStandings: jest.fn(),
    };

    const service = new RenderService(
      prisma as any,
      results as any,
      sessionsStandings as any,
      brandingService as any,
    );

    return {
      service,
      prisma,
      results,
      sessionsStandings,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renderHtmlToImage returns a buffer and closes the browser', async () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const close = jest.fn().mockResolvedValue(undefined);
    const screenshot = jest.fn().mockResolvedValue(pngBuffer);
    const setContent = jest.fn().mockResolvedValue(undefined);
    const setViewport = jest.fn().mockResolvedValue(undefined);
    const newPage = jest.fn().mockResolvedValue({
      setViewport,
      setContent,
      screenshot,
    });
    const launch = (puppeteer as unknown as { launch: jest.Mock }).launch;
    launch.mockResolvedValue({
      newPage,
      close,
    });

    const { service } = buildService();
    const result = await service.renderHtmlToImage('<html></html>');

    expect(result).toEqual(pngBuffer);
    expect(newPage).toHaveBeenCalled();
    expect(setViewport).toHaveBeenCalled();
    expect(setContent).toHaveBeenCalledWith('<html></html>', {
      waitUntil: 'domcontentloaded',
    });
    expect(screenshot).toHaveBeenCalledWith({ type: 'png' });
    expect(close).toHaveBeenCalled();
  });

  it('builds match result html with result rows', async () => {
    const { service } = buildService();

    const html = await service.buildMatchResultHtml({
      matchName: 'Daily Scrim Alpha',
      teams: [
        { position: 1, tag: 'DXB', points: 28, kills: 12 },
        { position: 2, tag: 'NXT', points: 22, kills: 9 },
      ],
      branding: {
        primaryColor: '#00e5ff',
        background: '#0b0f14',
        textPrimary: '#ffffff',
        textMuted: '#94a3b8',
        panel: 'rgba(11,15,20,0.7)',
        border: 'rgba(255,255,255,0.12)',
        shadow: '0 24px 64px rgba(0,0,0,0.45)',
        logoUrl: null,
      },
    });

    expect(html).toContain('Daily Scrim Alpha');
    expect(html).toContain('DXB');
    expect(html).toContain('28 pts');
    expect(html).toContain('12 kills');
    expect(html).toContain('NXT');
  });

  it('renders match results from backend data', async () => {
    const { service, prisma, results } = buildService();
    results.ensureMatch.mockResolvedValue({
      id: 'match-1',
      organizationId: 'org-1',
    });
    prisma.match.findFirst.mockResolvedValue({
      id: 'match-1',
      name: 'Result Lobby',
      organizationId: 'org-1',
      status: MatchStatus.FINISHED,
      slotResults: [
        {
          wasPresentInMatch: true,
          placement: 2,
          totalKills: 9,
          totalPoints: 22,
          points: 22,
          slotNumber: 2,
          team: { tag: 'NXT', name: 'Next' },
        },
        {
          wasPresentInMatch: true,
          placement: 1,
          totalKills: 12,
          totalPoints: 28,
          points: 28,
          slotNumber: 1,
          team: { tag: 'DXB', name: 'Dubai' },
        },
      ],
    });
    const renderSpy = jest
      .spyOn(service, 'renderHtmlToImage')
      .mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const buffer = await service.renderMatchResultImage(
      actor as any,
      'match-1',
    );

    expect(buffer).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(renderSpy).toHaveBeenCalledWith(
      expect.stringContaining('Result Lobby'),
    );
    expect(renderSpy).toHaveBeenCalledWith(expect.stringContaining('DXB'));
    expect(renderSpy).toHaveBeenCalledWith(expect.stringContaining('28 pts'));
  });

  it('renders session standings from backend data', async () => {
    const { service, prisma, sessionsStandings } = buildService();
    sessionsStandings.getStandings.mockResolvedValue({
      sessionId: 'session-1',
      teams: [
        { rank: 1, tag: 'DXB', totalPoints: 42 },
        { rank: 2, tag: 'NXT', totalPoints: 35 },
      ],
    });
    prisma.session.findFirst.mockResolvedValue({
      id: 'session-1',
      name: 'Daily Session',
      organizationId: 'org-1',
    });
    const renderSpy = jest
      .spyOn(service, 'renderHtmlToImage')
      .mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const buffer = await service.renderSessionStandingsImage(
      actor as any,
      'session-1',
    );

    expect(buffer).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(renderSpy).toHaveBeenCalledWith(
      expect.stringContaining('Daily Session'),
    );
    expect(renderSpy).toHaveBeenCalledWith(expect.stringContaining('DXB'));
    expect(renderSpy).toHaveBeenCalledWith(expect.stringContaining('42 pts'));
  });
});
