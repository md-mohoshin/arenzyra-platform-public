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
      secondaryColor: '#1d4ed8',
      accent: '#f5a524',
      backgroundCss: 'linear-gradient(135deg, #101827 0%, #1d4ed8 100%)',
      backgroundSolid: '#101827',
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
        findMany: jest.fn(),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      session: {
        findFirst: jest.fn(),
      },
      sessionDiscordConfig: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      resultBackup: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      matchSlotResult: {
        findMany: jest.fn(),
      },
      matchSlotPlayerResult: {
        findMany: jest.fn(),
      },
      player: {
        findMany: jest.fn().mockResolvedValue([]),
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
    expect(screenshot).toHaveBeenCalledWith({
      type: 'png',
      omitBackground: true,
    });
    expect(close).toHaveBeenCalled();
  });

  it('builds match result html with result rows', async () => {
    const { service } = buildService();

    const html = await service.buildMatchResultHtml({
      matchName: 'Daily Scrim Alpha',
      teams: [
        {
          position: 1,
          team: 'Dubai',
          logoUrl: '/uploads/logos/dxb.png',
          kills: 12,
          placementPoints: 16,
          totalPoints: 28,
        },
        {
          position: 2,
          team: 'Next',
          logoUrl: null,
          kills: 9,
          placementPoints: 13,
          totalPoints: 22,
        },
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
        safeArea: { top: 32, right: 32, bottom: 32, left: 32 },
      },
    });

    expect(html).toContain('Daily Scrim Alpha');
    expect(html).toContain('Dubai');
    expect(html).toContain('/uploads/logos/dxb.png');
    expect(html).toContain('28');
    expect(html).toContain('12');
    expect(html).toContain('Next');
  });

  it('uses the Discord server icon as the default team logo for result widgets', async () => {
    const { service, prisma, results } = buildService();
    const guildId = '123456789012345678';
    const iconHash = 'server-icon-hash';
    const serverIconUrl = `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.png?size=128`;
    const originalFetch = global.fetch;
    const originalToken = process.env.DISCORD_BOT_TOKEN;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: guildId, icon: iconHash }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.DISCORD_BOT_TOKEN = 'test-discord-token';

    results.ensureMatch.mockResolvedValue({
      id: 'match-1',
      organizationId: 'org-1',
    });
    prisma.match.findFirst.mockResolvedValue({
      id: 'match-1',
      name: 'Missing Logo Lobby',
      organizationId: 'org-1',
      sessionId: 'session-1',
      session: { id: 'session-1', name: 'Daily Session' },
      status: MatchStatus.FINISHED,
      slotResults: [
        {
          teamId: 'team-1',
          wasPresentInMatch: true,
          placement: 1,
          totalKills: 8,
          totalPoints: 24,
          points: 24,
          slotNumber: 1,
          placementPoints: 16,
          team: { tag: 'DXB', name: 'Dubai', logoUrl: null },
        },
      ],
    });
    prisma.sessionDiscordConfig.findFirst.mockResolvedValue({
      guildId,
      emojis: {
        discordWidgetTemplateEnabled: 'true',
      },
    });
    const renderSpy = jest
      .spyOn(service, 'renderHtmlToImage')
      .mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    try {
      await service.renderDiscordMatchImage(
        actor as any,
        'match-1',
        'match-result',
      );
    } finally {
      global.fetch = originalFetch;
      if (originalToken === undefined) {
        delete process.env.DISCORD_BOT_TOKEN;
      } else {
        process.env.DISCORD_BOT_TOKEN = originalToken;
      }
    }

    const html = renderSpy.mock.calls[0]?.[0] ?? '';
    expect(fetchMock).toHaveBeenCalledWith(
      `https://discord.com/api/v10/guilds/${guildId}`,
      { headers: { Authorization: 'Bot test-discord-token' } },
    );
    expect(html).toContain(serverIconUrl);
    expect(html).not.toContain('/assets/defaults/default-team.png');
  });

  it('fits Discord ranking rows and headers inside the fixed image canvas', async () => {
    const { service } = buildService();
    const rows = Array.from({ length: 25 }, (_, index) => ({
      rank: `#${index + 1}`,
      teamName: `Team ${index + 1}`,
      logoUrl: null,
      wwcd: index === 0 ? 1 : 0,
      placementPoints: Math.max(0, 25 - index),
      kills: index + 3,
      totalPoints: 50 - index,
    }));

    const html = await service.buildDiscordRankingTableHtml({
      kind: 'match-result',
      eyebrow: 'Results',
      title: 'Long Lobby',
      subtitle: '25 teams',
      rows,
      branding: {
        primaryColor: '#00e5ff',
        background: '#0b0f14',
        textPrimary: '#ffffff',
        textMuted: '#94a3b8',
        panel: 'rgba(11,15,20,0.7)',
        border: 'rgba(255,255,255,0.12)',
        shadow: '0 24px 64px rgba(0,0,0,0.45)',
        logoUrl: null,
        defaultTeamLogoUrl: null,
        safeArea: { top: 32, right: 32, bottom: 32, left: 32 },
      },
      layout: {
        tableX: 0,
        tableY: 136,
        tableWidth: 1136,
        tableHeight: 398,
        titleHeight: 118,
        titleSize: 58,
        groupColumns: 2,
        groupGap: 24,
        maxRows: 25,
        rowHeight: 34,
        rowGap: 4,
        rowRadius: 6,
        headerHeight: 34,
        headerFontSize: 11,
        logoSize: 28,
        teamFontSize: 17,
        metricFontSize: 16,
        columns: [
          {
            id: 'rank',
            field: 'rank',
            label: 'Rank',
            width: 46,
            align: 'center',
            enabled: true,
          },
          {
            id: 'team',
            field: 'team',
            label: 'Team Name',
            width: 260,
            align: 'left',
            enabled: true,
          },
          {
            id: 'wwcd',
            field: 'wwcd',
            label: 'WWCD',
            width: 40,
            align: 'center',
            enabled: true,
          },
          {
            id: 'placementPoints',
            field: 'placementPoints',
            label: 'PP',
            width: 42,
            align: 'center',
            enabled: true,
          },
          {
            id: 'kills',
            field: 'kills',
            label: 'KP',
            width: 42,
            align: 'center',
            enabled: true,
          },
          {
            id: 'totalPoints',
            field: 'totalPoints',
            label: 'TP',
            width: 44,
            align: 'center',
            enabled: true,
          },
        ],
      },
    } as any);

    expect(html).toContain('height: 406px;');
    expect(html).toContain('min-height: 27px;');
    expect(html).toContain(
      'class="ranking-cell ranking-header-cell ranking-cell--center"',
    );
    expect(html).toContain('.ranking-table-header .ranking-header-cell');
    expect(html).toContain('<div class="ranking-team-name">Team 25</div>');
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
      sessionId: null,
      slotResults: [
        {
          wasPresentInMatch: true,
          placement: 2,
          totalKills: 9,
          placementPoints: 13,
          totalPoints: 22,
          points: 22,
          slotNumber: 2,
          team: { tag: 'NXT', name: 'Next', logoUrl: null },
        },
        {
          wasPresentInMatch: true,
          placement: 1,
          totalKills: 12,
          placementPoints: 16,
          totalPoints: 28,
          points: 28,
          slotNumber: 1,
          team: {
            tag: 'DXB',
            name: 'Dubai',
            logoUrl: '/uploads/logos/dxb.png',
          },
        },
        {
          wasPresentInMatch: true,
          placement: null,
          totalKills: 0,
          placementPoints: 0,
          totalPoints: 0,
          points: 0,
          slotNumber: 3,
          team: { tag: 'OLD', name: 'Old Stale Team', logoUrl: null },
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
    expect(renderSpy).toHaveBeenCalledWith(expect.stringContaining('Dubai'));
    expect(renderSpy).toHaveBeenCalledWith(
      expect.stringContaining('/uploads/logos/dxb.png'),
    );
    expect(renderSpy).toHaveBeenCalledWith(
      expect.not.stringContaining('Old Stale Team'),
    );
  });

  it('filters Discord match result rows to current assigned teams', async () => {
    const { service, prisma, results } = buildService();
    results.ensureMatch.mockResolvedValue({
      id: 'match-1',
      organizationId: 'org-1',
    });
    prisma.match.findFirst.mockResolvedValue({
      id: 'match-1',
      name: 'Match 1',
      organizationId: 'org-1',
      sessionId: 'session-1',
      session: { id: 'session-1', name: 'Daily Session' },
      status: MatchStatus.FINISHED,
      slotResults: [
        {
          teamId: 'team-current',
          wasPresentInMatch: true,
          placement: 1,
          totalKills: 12,
          placementPoints: 15,
          totalPoints: 27,
          points: 27,
          slotNumber: 3,
          team: { tag: 'CUR', name: 'Current Team', logoUrl: null },
        },
        {
          teamId: 'team-stale',
          wasPresentInMatch: true,
          placement: 2,
          totalKills: 8,
          placementPoints: 12,
          totalPoints: 20,
          points: 20,
          slotNumber: 4,
          team: { tag: 'OLD', name: 'Old Stale Team', logoUrl: null },
        },
      ],
    });
    prisma.matchSlot.findMany.mockResolvedValue([
      {
        teamId: 'team-current',
        slotNumber: 3,
        team: { tag: 'CUR', name: 'Current Team', logoUrl: null },
      },
    ]);
    const renderSpy = jest
      .spyOn(service, 'renderHtmlToImage')
      .mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await service.renderDiscordMatchImage(
      actor as any,
      'match-1',
      'match-result',
    );

    expect(brandingService.getEffectiveBranding).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        sessionId: 'session-1',
        matchId: 'match-1',
      }),
    );
    const html = renderSpy.mock.calls[0]?.[0] ?? '';
    expect(html).toContain('Current Team');
    expect(html).not.toContain('Old Stale Team');
    expect(prisma.matchSlot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          matchId: 'match-1',
          deletedAt: null,
          teamId: { not: null },
        },
      }),
    );
  });

  it('renders a branded Discord match schedule widget from finished matches', async () => {
    const { service, prisma, results } = buildService();
    results.ensureMatch.mockResolvedValue({
      id: 'match-2',
      organizationId: 'org-1',
    });
    prisma.match.findFirst
      .mockResolvedValueOnce({
        id: 'match-2',
        name: 'Scrim Match 2',
        organizationId: 'org-1',
        tournamentId: 'tournament-1',
        stageId: null,
        groupId: 'group-1',
        sessionId: 'session-1',
        matchNumber: 2,
        session: { id: 'session-1', name: 'Daily Session' },
      })
      .mockResolvedValueOnce({
        id: 'match-2',
        status: MatchStatus.FINISHED,
        tournamentId: 'tournament-1',
        sessionId: 'session-1',
        organizationId: 'org-1',
        stageId: null,
        groupId: 'group-1',
        name: 'Scrim Match 2',
        matchNumber: 2,
        updatedAt: new Date('2026-06-05T12:00:00Z'),
        tournament: {
          name: 'Arenzyra Scrim',
          shortName: 'AZ Scrim',
          organizationId: 'org-1',
        },
        session: { name: 'Daily Session', organizationId: 'org-1' },
        stage: null,
        group: { name: 'Group A' },
      });
    prisma.match.findMany.mockResolvedValue([
      {
        id: 'match-1',
        name: 'Scrim Match 1',
        matchNumber: 1,
        map: 'erangel',
        updatedAt: new Date('2026-06-05T11:00:00Z'),
        endedAt: new Date('2026-06-05T11:30:00Z'),
        controlState: { metaJson: { winnerTeamId: 'team-1' } },
        slotResults: [
          {
            slotNumber: 1,
            teamId: 'team-1',
            wasPresentInMatch: true,
            placement: 1,
            finalPlacement: 1,
            totalKills: 12,
            totalPoints: 27,
            points: 27,
            placementPoints: 15,
            team: {
              id: 'team-1',
              name: 'Dubai Team',
              tag: 'DXB',
              logoUrl: '/uploads/team/dxb.png',
              logoLightUrl: null,
              logoDarkUrl: null,
              updatedAt: new Date('2026-06-05T10:00:00Z'),
            },
          },
        ],
      },
      {
        id: 'match-2',
        name: 'Scrim Match 2',
        matchNumber: 2,
        map: 'miramar',
        updatedAt: new Date('2026-06-05T12:00:00Z'),
        endedAt: new Date('2026-06-05T12:30:00Z'),
        controlState: { metaJson: {} },
        slotResults: [
          {
            slotNumber: 2,
            teamId: 'team-2',
            wasPresentInMatch: true,
            placement: 1,
            finalPlacement: 1,
            totalKills: 8,
            totalPoints: 20,
            points: 20,
            placementPoints: 12,
            team: {
              id: 'team-2',
              name: 'Next Team',
              tag: 'NXT',
              logoUrl: null,
              logoLightUrl: null,
              logoDarkUrl: null,
              updatedAt: new Date('2026-06-05T10:00:00Z'),
            },
          },
        ],
      },
    ]);
    const renderSpy = jest
      .spyOn(service, 'renderHtmlToImage')
      .mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await service.renderDiscordMatchImage(
      actor as any,
      'match-2',
      'match-schedule',
    );

    const html = renderSpy.mock.calls[0]?.[0] ?? '';
    expect(html).toContain('Match Schedule');
    expect(html).toContain('Group A');
    expect(html).toContain('DXB');
    expect(html).toContain('NXT');
    expect(html).toContain('Erangel');
    expect(html).toContain('Miramar');
    expect(html).toContain('#00e5ff');
    expect(html).toContain('#f5a524');
    expect(html).toContain('/assets/match-schedule-scenes/erangel-1.png');
    expect(prisma.match.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          groupId: 'group-1',
          organizationId: 'org-1',
          status: {
            in: [
              MatchStatus.DRAFT,
              MatchStatus.LIVE,
              MatchStatus.FINISH_PENDING,
              MatchStatus.FINISHED,
              MatchStatus.ENDED,
            ],
          },
        }),
      }),
    );
  });

  it('renders match schedule rows from saved result backups when active matches are gone', async () => {
    const { service, prisma, results } = buildService();
    results.ensureMatch.mockResolvedValue({
      id: 'match-reset',
      organizationId: 'org-1',
    });
    prisma.sessionDiscordConfig.findFirst.mockResolvedValue({
      guildId: 'guild-1',
      emojis: {
        discordResultMatchSchedule: JSON.stringify({
          matches: [
            {
              matchNumber: 1,
              label: 'Opening Drop',
              map: 'Erangel',
              enabled: true,
            },
            {
              matchNumber: 2,
              label: 'Desert Push',
              map: 'Miramar',
              enabled: true,
            },
            {
              matchNumber: 3,
              label: 'Finale',
              map: 'Sanhok',
              enabled: true,
            },
          ],
        }),
      },
    });
    prisma.match.findFirst
      .mockResolvedValueOnce({
        id: 'match-reset',
        name: 'New Draft',
        organizationId: 'org-1',
        tournamentId: null,
        stageId: null,
        groupId: null,
        sessionId: 'session-1',
        matchNumber: 1,
        session: { id: 'session-1', name: 'Daily Session' },
      })
      .mockResolvedValueOnce({
        id: 'match-reset',
        status: MatchStatus.DRAFT,
        tournamentId: null,
        sessionId: 'session-1',
        organizationId: 'org-1',
        stageId: null,
        groupId: null,
        name: 'New Draft',
        matchNumber: 1,
        updatedAt: new Date('2026-06-05T12:00:00Z'),
        tournament: null,
        session: { name: 'Daily Session', organizationId: 'org-1' },
        stage: null,
        group: null,
      });
    prisma.match.findMany.mockResolvedValue([]);
    prisma.resultBackup.findMany.mockResolvedValue([
      {
        id: 'backup-2',
        sourceMatchId: 'old-match-2',
        matchNumber: 2,
        matchName: 'Game 2',
        title: 'Game 2',
        createdAt: new Date('2026-06-05T12:20:00Z'),
        rows: [
          {
            rank: 1,
            teamId: 'team-2',
            teamName: 'Next Team',
            teamTag: 'NXT',
            logoUrl: null,
            placement: 1,
            kills: 8,
            placementPoints: 12,
            totalPoints: 20,
          },
        ],
      },
      {
        id: 'backup-1',
        sourceMatchId: 'old-match-1',
        matchNumber: 1,
        matchName: 'Game 1',
        title: 'Game 1',
        createdAt: new Date('2026-06-05T12:10:00Z'),
        rows: [
          {
            rank: 1,
            teamId: 'team-1',
            teamName: 'Dubai Team',
            teamTag: 'DXB',
            logoUrl: '/uploads/team/dxb.png',
            placement: 1,
            kills: 12,
            placementPoints: 15,
            totalPoints: 27,
          },
        ],
      },
    ]);
    const renderSpy = jest
      .spyOn(service, 'renderHtmlToImage')
      .mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await service.renderDiscordMatchImage(
      actor as any,
      'match-reset',
      'match-schedule',
    );

    const html = renderSpy.mock.calls[0]?.[0] ?? '';
    expect(html).toContain('Opening Drop');
    expect(html).toContain('Desert Push');
    expect(html).toContain('Finale');
    expect(html).toContain('Erangel');
    expect(html).toContain('Miramar');
    expect(html).toContain('Sanhok');
    expect(html).toContain('DXB');
    expect(html).toContain('NXT');
    expect(html).not.toContain('No completed matches yet');
    expect(prisma.resultBackup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-1',
          sessionId: 'session-1',
          kind: 'MATCH',
        }),
      }),
    );
  });

  it('renders custom Discord match schedule layouts as schedule cards', async () => {
    const { service, prisma, results } = buildService();
    results.ensureMatch.mockResolvedValue({
      id: 'match-2',
      organizationId: 'org-1',
    });
    prisma.sessionDiscordConfig.findFirst.mockResolvedValue({
      guildId: 'guild-1',
      emojis: {
        discordWidgetTemplateEnabled: true,
        discordWidgetCustomLayouts: JSON.stringify({
          layouts: {
            'match-schedule': {
              enabled: true,
              elements: [
                {
                  id: 'rows',
                  type: 'rows',
                  x: 48,
                  y: 188,
                  width: 1104,
                  startRank: 1,
                  rankDisplayMode: 'global',
                  cardDirection: 'vertical',
                  autoFitRows: true,
                  rowHeight: 156,
                  rowGap: 14,
                  groupColumns: 3,
                  groupGap: 14,
                  maxRows: 12,
                  fontSize: 14,
                  headerFontSize: 10,
                  rowRadius: 14,
                  showHeader: false,
                  zIndex: 10,
                  enabled: true,
                  columns: [
                    {
                      id: 'team',
                      field: 'team',
                      label: 'Winner',
                      width: 190,
                      align: 'left',
                      enabled: true,
                    },
                  ],
                },
              ],
            },
          },
        }),
      },
    });
    prisma.match.findFirst
      .mockResolvedValueOnce({
        id: 'match-2',
        name: 'Scrim Match 2',
        organizationId: 'org-1',
        tournamentId: 'tournament-1',
        stageId: null,
        groupId: 'group-1',
        sessionId: 'session-1',
        matchNumber: 2,
        session: { id: 'session-1', name: 'Daily Session' },
      })
      .mockResolvedValueOnce({
        id: 'match-2',
        status: MatchStatus.FINISHED,
        tournamentId: 'tournament-1',
        sessionId: 'session-1',
        organizationId: 'org-1',
        stageId: null,
        groupId: 'group-1',
        name: 'Scrim Match 2',
        matchNumber: 2,
        updatedAt: new Date('2026-06-05T12:00:00Z'),
        tournament: {
          name: 'Arenzyra Scrim',
          shortName: 'AZ Scrim',
          organizationId: 'org-1',
        },
        session: { name: 'Daily Session', organizationId: 'org-1' },
        stage: null,
        group: { name: 'Group A' },
      });
    prisma.match.findMany.mockResolvedValue([
      {
        id: 'match-1',
        name: 'Scrim Match 1',
        matchNumber: 1,
        map: 'erangel',
        updatedAt: new Date('2026-06-05T11:00:00Z'),
        endedAt: new Date('2026-06-05T11:30:00Z'),
        controlState: { metaJson: { winnerTeamId: 'team-1' } },
        slotResults: [
          {
            slotNumber: 1,
            teamId: 'team-1',
            wasPresentInMatch: true,
            placement: 1,
            finalPlacement: 1,
            totalKills: 12,
            totalPoints: 27,
            points: 27,
            placementPoints: 15,
            team: {
              id: 'team-1',
              name: 'Dubai Team',
              tag: 'DXB',
              logoUrl: '/uploads/team/dxb.png',
              logoLightUrl: null,
              logoDarkUrl: null,
              updatedAt: new Date('2026-06-05T10:00:00Z'),
            },
          },
        ],
      },
    ]);
    const renderSpy = jest
      .spyOn(service, 'renderHtmlToImage')
      .mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await service.renderDiscordMatchImage(
      actor as any,
      'match-2',
      'match-schedule',
    );

    const html = renderSpy.mock.calls[0]?.[0] ?? '';
    expect(html).toContain('data-direction="vertical"');
    expect(html).toContain('grid-auto-flow:column');
    expect(html).toContain('--custom-schedule-height:156px');
    expect(html).toContain('custom-schedule-card');
    expect(html).toContain('custom-schedule-scene');
    expect(html).toContain('Scrim Match 1');
    expect(html).toContain('Erangel');
    expect(html).toContain('DXB');
    expect(html).not.toContain('<div class="custom-data-row"');
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

  it('renders Discord overall ranking from the match session', async () => {
    const { service, prisma, results } = buildService();
    results.ensureMatch.mockResolvedValue({
      id: 'match-1',
      organizationId: 'org-1',
    });
    prisma.match.findFirst.mockResolvedValue({
      id: 'match-1',
      name: 'Match 1',
      organizationId: 'org-1',
      sessionId: 'session-1',
      session: { id: 'session-1', name: 'Daily Session' },
    });
    prisma.sessionDiscordConfig.findFirst.mockResolvedValue({
      emojis: {
        discordOverallRankingEyebrow: 'Session Board',
        discordOverallRankingTitle: '{sessionName} Totals',
        discordOverallRankingSubtitle: 'Across {matchName}',
      },
    });
    prisma.match.findMany.mockResolvedValue([
      { id: 'match-1' },
      { id: 'match-2' },
    ]);
    prisma.matchSlotResult.findMany.mockResolvedValue([
      {
        matchId: 'match-1',
        teamId: 'team-stale',
        wasPresentInMatch: true,
        placement: null,
        placementPoints: 0,
        totalKills: 0,
        totalPoints: 0,
        points: 0,
        team: {
          id: 'team-stale',
          name: 'Old Stale Team',
          tag: 'OLD',
          logoUrl: null,
        },
      },
      {
        matchId: 'match-1',
        teamId: 'team-1',
        wasPresentInMatch: true,
        placement: 1,
        placementPoints: 15,
        totalKills: 12,
        totalPoints: 27,
        points: 27,
        team: {
          id: 'team-1',
          name: 'Dubai',
          tag: 'DXB',
          logoUrl: '/uploads/logos/dxb.png',
        },
      },
      {
        matchId: 'match-2',
        teamId: 'team-1',
        wasPresentInMatch: true,
        placement: 2,
        placementPoints: 12,
        totalKills: 8,
        totalPoints: 20,
        points: 20,
        team: {
          id: 'team-1',
          name: 'Dubai',
          tag: 'DXB',
          logoUrl: '/uploads/logos/dxb.png',
        },
      },
      {
        matchId: 'match-1',
        teamId: 'team-2',
        wasPresentInMatch: true,
        placement: 3,
        placementPoints: 10,
        totalKills: 37,
        totalPoints: 47,
        points: 47,
        team: {
          id: 'team-2',
          name: 'Kill Heavy',
          tag: 'KHV',
          logoUrl: null,
        },
      },
    ]);
    const renderSpy = jest
      .spyOn(service, 'renderHtmlToImage')
      .mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const buffer = await service.renderDiscordMatchImage(
      actor as any,
      'match-1',
      'overall-ranking',
    );

    expect(buffer).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(prisma.match.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sessionId: 'session-1',
          organizationId: 'org-1',
          deletedAt: null,
        },
      }),
    );
    expect(renderSpy).toHaveBeenCalledWith(
      expect.stringContaining('Session Board'),
    );
    expect(renderSpy).toHaveBeenCalledWith(
      expect.stringContaining('Daily Session Totals'),
    );
    expect(renderSpy).toHaveBeenCalledWith(
      expect.stringContaining('Across Match 1'),
    );
    expect(renderSpy).toHaveBeenCalledWith(expect.stringContaining('Dubai'));
    expect(renderSpy).toHaveBeenCalledWith(
      expect.stringContaining('Kill Heavy'),
    );
    const html = renderSpy.mock.calls[0]?.[0];
    expect(html.indexOf('Dubai')).toBeLessThan(html.indexOf('Kill Heavy'));
    expect(renderSpy).toHaveBeenCalledWith(
      expect.stringContaining('Arenzyra Ranking Table Widget'),
    );
    expect(renderSpy).toHaveBeenCalledWith(expect.stringContaining('WWCD'));
    expect(renderSpy).toHaveBeenCalledWith(expect.stringContaining('TP'));
    expect(renderSpy).toHaveBeenCalledWith(
      expect.stringContaining('/uploads/logos/dxb.png'),
    );
    expect(renderSpy).toHaveBeenCalledWith(expect.stringContaining('47'));
    expect(renderSpy).toHaveBeenCalledWith(
      expect.not.stringContaining('Old Stale Team'),
    );
  });

  it('limits session overall ranking to the current game and assigned teams', async () => {
    const { service, prisma, results } = buildService();
    results.ensureMatch.mockResolvedValue({
      id: 'match-1',
      organizationId: 'org-1',
    });
    prisma.match.findFirst.mockResolvedValue({
      id: 'match-1',
      name: 'Game 1',
      organizationId: 'org-1',
      tournamentId: null,
      stageId: null,
      groupId: null,
      sessionId: 'session-1',
      matchNumber: 1,
      session: { id: 'session-1', name: 'Daily Session' },
    });
    prisma.sessionDiscordConfig.findFirst.mockResolvedValue({
      emojis: {
        discordOverallRankingTitle: '{sessionName} Totals',
      },
    });
    prisma.match.findMany.mockResolvedValue([{ id: 'match-1' }]);
    prisma.matchSlot.findMany.mockResolvedValue([
      {
        teamId: 'team-a',
        slotNumber: 3,
        team: { tag: 'AAA', name: 'Alpha Active', logoUrl: null },
      },
      {
        teamId: 'team-b',
        slotNumber: 4,
        team: { tag: 'BBB', name: 'Beta Active', logoUrl: null },
      },
    ]);
    prisma.matchSlotResult.findMany.mockResolvedValue([
      {
        matchId: 'match-1',
        teamId: 'team-a',
        wasPresentInMatch: true,
        placement: 1,
        placementPoints: 15,
        totalKills: 10,
        totalPoints: 25,
        points: 25,
        team: {
          id: 'team-a',
          name: 'Alpha Active',
          tag: 'AAA',
          logoUrl: null,
        },
      },
      {
        matchId: 'match-2',
        teamId: 'team-stale',
        wasPresentInMatch: true,
        placement: 2,
        placementPoints: 12,
        totalKills: 8,
        totalPoints: 20,
        points: 20,
        team: {
          id: 'team-stale',
          name: 'Old Stale Team',
          tag: 'OLD',
          logoUrl: null,
        },
      },
    ]);
    const renderSpy = jest
      .spyOn(service, 'renderHtmlToImage')
      .mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await service.renderDiscordMatchImage(
      actor as any,
      'match-1',
      'overall-ranking',
    );

    expect(prisma.match.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sessionId: 'session-1',
          organizationId: 'org-1',
          deletedAt: null,
          OR: [{ id: 'match-1' }, { matchNumber: { lte: 1 } }],
        },
      }),
    );
    expect(prisma.matchSlotResult.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          matchId: { in: ['match-1'] },
          organizationId: 'org-1',
          teamId: { in: ['team-a', 'team-b'] },
        },
      }),
    );
    const html = renderSpy.mock.calls[0]?.[0] ?? '';
    expect(html).toContain('Alpha Active');
    expect(html).toContain('Beta Active');
    expect(html).not.toContain('Old Stale Team');
    expect(html).toContain('Showing 2 teams');
  });

  it('keeps featured teams in custom overall rows when rows start at rank one', async () => {
    const { service, prisma, results } = buildService();
    results.ensureMatch.mockResolvedValue({
      id: 'match-4',
      organizationId: 'org-1',
    });
    prisma.match.findFirst.mockResolvedValue({
      id: 'match-4',
      name: 'Game 4',
      organizationId: 'org-1',
      tournamentId: null,
      stageId: null,
      groupId: null,
      sessionId: 'session-1',
      matchNumber: 4,
      session: { id: 'session-1', name: 'Daily Session' },
    });
    prisma.sessionDiscordConfig.findFirst.mockResolvedValue({
      emojis: {
        discordWidgetTemplateEnabled: 'true',
        discordWidgetCustomLayouts: JSON.stringify({
          version: 1,
          layouts: {
            'overall-ranking': {
              enabled: true,
              elements: [
                {
                  id: 'featured',
                  type: 'featured',
                  x: 48,
                  y: 120,
                  width: 1104,
                  teamCount: 3,
                  groupColumns: 3,
                  cardHeight: 84,
                  cardGap: 10,
                  logoSize: 40,
                  fontSize: 13,
                  rowRadius: 10,
                  showStats: true,
                  zIndex: 12,
                  enabled: true,
                },
                {
                  id: 'rows',
                  type: 'rows',
                  x: 48,
                  y: 230,
                  width: 1104,
                  startRank: 1,
                  rankDisplayMode: 'restart',
                  autoFitRows: false,
                  rowHeight: 28,
                  rowGap: 5,
                  groupColumns: 1,
                  groupGap: 0,
                  maxRows: 4,
                  fontSize: 12,
                  headerFontSize: 9,
                  rowRadius: 9,
                  showHeader: true,
                  zIndex: 10,
                  enabled: true,
                  columns: [
                    {
                      id: 'rank',
                      field: 'rank',
                      label: 'Rank',
                      width: 34,
                      align: 'center',
                      enabled: true,
                    },
                    {
                      id: 'team',
                      field: 'team',
                      label: 'Team',
                      width: 220,
                      align: 'left',
                      enabled: true,
                    },
                    {
                      id: 'totalPoints',
                      field: 'totalPoints',
                      label: 'TP',
                      width: 58,
                      align: 'right',
                      enabled: true,
                    },
                  ],
                },
              ],
            },
          },
        }),
      },
    });
    prisma.match.findMany.mockResolvedValue([{ id: 'match-4' }]);
    prisma.matchSlot.findMany.mockResolvedValue([
      {
        teamId: 'team-a',
        slotNumber: 1,
        team: { tag: 'ALP', name: 'Alpha', logoUrl: null },
      },
      {
        teamId: 'team-b',
        slotNumber: 2,
        team: { tag: 'BRV', name: 'Bravo', logoUrl: null },
      },
      {
        teamId: 'team-c',
        slotNumber: 3,
        team: { tag: 'CHL', name: 'Charlie', logoUrl: null },
      },
      {
        teamId: 'team-d',
        slotNumber: 4,
        team: { tag: 'DLT', name: 'Delta', logoUrl: null },
      },
    ]);
    prisma.matchSlotResult.findMany.mockResolvedValue([
      {
        matchId: 'match-4',
        teamId: 'team-a',
        wasPresentInMatch: true,
        placement: 1,
        placementPoints: 15,
        totalKills: 10,
        totalPoints: 25,
        points: 25,
        team: { id: 'team-a', name: 'Alpha', tag: 'ALP', logoUrl: null },
      },
      {
        matchId: 'match-4',
        teamId: 'team-b',
        wasPresentInMatch: true,
        placement: 2,
        placementPoints: 12,
        totalKills: 8,
        totalPoints: 20,
        points: 20,
        team: { id: 'team-b', name: 'Bravo', tag: 'BRV', logoUrl: null },
      },
      {
        matchId: 'match-4',
        teamId: 'team-c',
        wasPresentInMatch: true,
        placement: 3,
        placementPoints: 10,
        totalKills: 6,
        totalPoints: 16,
        points: 16,
        team: { id: 'team-c', name: 'Charlie', tag: 'CHL', logoUrl: null },
      },
      {
        matchId: 'match-4',
        teamId: 'team-d',
        wasPresentInMatch: true,
        placement: 4,
        placementPoints: 8,
        totalKills: 4,
        totalPoints: 12,
        points: 12,
        team: { id: 'team-d', name: 'Delta', tag: 'DLT', logoUrl: null },
      },
    ]);
    const renderSpy = jest
      .spyOn(service, 'renderHtmlToImage')
      .mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await service.renderDiscordMatchImage(
      actor as any,
      'match-4',
      'overall-ranking',
    );

    const html = renderSpy.mock.calls[0]?.[0] ?? '';
    expect(html).toContain('class="custom-featured"');
    expect(html).toMatch(
      /<div class="custom-data-row"[^>]*>[\s\S]*custom-cell--rank[^>]*>#1<\/div>[\s\S]*Alpha/,
    );
    expect(html).toMatch(
      /<div class="custom-data-row"[^>]*>[\s\S]*custom-cell--rank[^>]*>#2<\/div>[\s\S]*Bravo/,
    );
    expect(html).toMatch(
      /<div class="custom-data-row"[^>]*>[\s\S]*custom-cell--rank[^>]*>#3<\/div>[\s\S]*Charlie/,
    );
    expect(html).toMatch(
      /<div class="custom-data-row"[^>]*>[\s\S]*custom-cell--rank[^>]*>#4<\/div>[\s\S]*Delta/,
    );
  });

  it('uses organization branding while applying non-color Discord widget settings', async () => {
    const { service, prisma, results } = buildService();
    results.ensureMatch.mockResolvedValue({
      id: 'match-1',
      organizationId: 'org-1',
    });
    prisma.match.findFirst.mockResolvedValue({
      id: 'match-1',
      name: 'Custom Result Lobby',
      organizationId: 'org-1',
      sessionId: 'session-1',
      session: { id: 'session-1', name: 'Daily Session' },
      status: MatchStatus.FINISHED,
      slotResults: [
        {
          wasPresentInMatch: true,
          placement: 1,
          totalKills: 12,
          placementPoints: 16,
          totalPoints: 28,
          points: 28,
          slotNumber: 1,
          team: { tag: 'DXB', name: 'Dubai', logoUrl: null },
        },
      ],
    });
    prisma.sessionDiscordConfig.findFirst.mockResolvedValue({
      emojis: {
        discordWidgetTemplateEnabled: 'true',
        discordWidgetTemplateBackgroundUrl:
          '/uploads/widget-templates/custom.webp',
        discordWidgetFontFamily: 'roboto',
        discordWidgetPrimaryColor: '#ffcc00',
        discordWidgetTextColor: '#ffeeaa',
        discordWidgetMutedColor: '#aa8844',
        discordWidgetRowColor: '#101827',
        discordWidgetPanelOpacity: '0.5',
        discordWidgetSafeTop: '120',
        discordWidgetSafeRight: '36',
        discordWidgetSafeBottom: '100',
        discordWidgetSafeLeft: '36',
        discordMatchResultEyebrow: 'Custom Results',
        discordMatchResultTitle: '{matchName} Final',
        discordMatchResultSubtitle: 'Session {sessionName}',
        discordWidgetOverlayLayers: JSON.stringify([
          {
            id: 'event-logo',
            url: '/uploads/widget-templates/event-logo.webp',
            targets: ['match-result'],
            x: 28,
            y: 520,
            width: 180,
            opacity: 0.75,
            zIndex: 22,
          },
        ]),
      },
    });
    const renderSpy = jest
      .spyOn(service, 'renderHtmlToImage')
      .mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await service.renderDiscordMatchImage(
      actor as any,
      'match-1',
      'match-result',
    );

    const html = renderSpy.mock.calls[0]?.[0] ?? '';
    expect(html).toContain('Arenzyra Ranking Table Widget');
    expect(html).toContain('/uploads/widget-templates/custom.webp');
    expect(html).toContain(
      'font-family: Roboto, Arial, "Liberation Sans", sans-serif;',
    );
    expect(html).toContain('#ffcc00');
    expect(html).toContain('#ffeeaa');
    expect(html).toContain('#aa8844');
    expect(html).toContain('rgba(16, 24, 39, 0.50)');
    expect(html).toContain(
      'linear-gradient(135deg, rgba(16, 24, 39, 0.50) 0%, rgba(16, 24, 39, 0.50) 58%, #ffcc00 220%)',
    );
    expect(html).not.toContain('background: transparent;');
    expect(html).toContain('padding: 120px 36px 100px 36px;');
    expect(html).toContain('Custom Results');
    expect(html).toContain('Custom Result Lobby Final');
    expect(html).toContain('Session Daily Session');
    expect(html).toContain('class="overlay-layer"');
    expect(html).toContain(
      'http://localhost:3000/uploads/widget-templates/event-logo.webp',
    );
    expect(html).toContain(
      'left:28px; top:520px; width:180px; opacity:0.75; z-index:22;',
    );
    expect(html).not.toContain('linear-gradient(rgba(5, 8, 14');
  });

  it('renders only playing teams in Discord match results when layout has extra slots', async () => {
    const { service, prisma, results } = buildService();
    results.ensureMatch.mockResolvedValue({
      id: 'match-1',
      organizationId: 'org-1',
    });
    const slotResults = Array.from({ length: 25 }, (_, index) => {
      const slotNumber = index + 1;
      const present = slotNumber <= 21;
      return {
        teamId: `team-${slotNumber}`,
        wasPresentInMatch: present,
        placement: present ? slotNumber : null,
        totalKills: present ? 25 - slotNumber : 0,
        placementPoints: present ? Math.max(0, 22 - slotNumber) : 0,
        totalPoints: present ? 50 - slotNumber : 0,
        points: present ? 50 - slotNumber : 0,
        slotNumber,
        team: {
          tag: `T${slotNumber}`,
          name: `Team ${slotNumber}`,
          logoUrl: null,
        },
      };
    });
    prisma.match.findFirst.mockResolvedValue({
      id: 'match-1',
      name: 'Bastards Scrim',
      organizationId: 'org-1',
      sessionId: 'session-1',
      session: { id: 'session-1', name: 'Bastards' },
      status: MatchStatus.FINISHED,
      slotResults,
    });
    prisma.matchSlot.findMany.mockResolvedValue(
      slotResults.map((slot) => ({
        teamId: slot.teamId,
        slotNumber: slot.slotNumber,
        team: slot.team,
      })),
    );
    const renderSpy = jest
      .spyOn(service, 'renderHtmlToImage')
      .mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await service.renderDiscordMatchImage(
      actor as any,
      'match-1',
      'match-result',
    );

    const html = renderSpy.mock.calls[0]?.[0] ?? '';
    expect(html).toContain('Team 1');
    expect(html).toContain('Team 21');
    expect(html).not.toContain('Team 22');
    expect(html).not.toContain('Team 25');
    expect(html).not.toContain('NO_SHOW');
    expect(html).toContain('Final results');
  });

  it('auto-fits custom result rows while honoring the selected top-team cap', async () => {
    const { service } = buildService();
    const rows = Array.from({ length: 25 }, (_, index) => {
      const rank = index + 1;
      return {
        rank: `#${rank}`,
        title: `Auto Team ${rank}`,
        subtitle: `${rank} kills`,
        metric: String(100 - rank),
        logoUrl: null,
        teamLogoUrl: null,
        kills: rank,
        placementPoints: 25 - rank,
        totalPoints: 100 - rank,
      };
    });
    const layout = {
      enabled: true,
      elements: [
        {
          id: 'rows',
          type: 'rows',
          x: 48,
          y: 188,
          width: 1104,
          startRank: 1,
          rankDisplayMode: 'global',
          cardDirection: 'vertical',
          autoFitRows: false,
          rowHeight: 38,
          rowGap: 8,
          groupColumns: 2,
          groupGap: 16,
          maxRows: 18,
          groupOffsets: [
            { x: 0, y: 70 },
            { x: 0, y: 0 },
          ],
          fontSize: 14,
          headerFontSize: 10,
          rowRadius: 9,
          showHeader: true,
          zIndex: 10,
          enabled: true,
          columns: [
            {
              id: 'rank',
              field: 'rank',
              label: 'Rank',
              width: 42,
              align: 'center',
              enabled: true,
            },
            {
              id: 'team',
              field: 'team',
              label: 'Team',
              width: 240,
              align: 'left',
              enabled: true,
            },
            {
              id: 'total',
              field: 'totalPoints',
              label: 'Total',
              width: 58,
              align: 'right',
              enabled: true,
            },
          ],
        },
      ],
    };
    const branding = {
      primaryColor: '#00e5ff',
      background: '#0b0f14',
      textPrimary: '#ffffff',
      textMuted: '#94a3b8',
      panel: 'rgba(11,15,20,0.7)',
      border: 'rgba(255,255,255,0.12)',
      shadow: '0 24px 64px rgba(0,0,0,0.45)',
      logoUrl: null,
      defaultTeamLogoUrl: null,
      safeArea: { top: 32, right: 32, bottom: 32, left: 32 },
    };

    for (const kind of ['match-result', 'overall-ranking']) {
      const html = await (service as any).buildDiscordCustomWidgetHtml({
        kind,
        eyebrow: 'Results',
        title: 'Auto Fit',
        subtitle: '',
        rows,
        branding,
        footer: 'Footer',
        overlayLayersHtml: '',
        layout,
      });

      const dataRowHeight = html.match(
        /class="custom-data-row" style="[^"]*min-height:(\d+)px/,
      );
      expect(html).toContain('Auto Team 1');
      expect(html).toContain('Auto Team 18');
      expect(html).not.toContain('Auto Team 19');
      expect(html).not.toContain('Auto Team 25');
      expect(html).toContain('transform:translate(0px, 70px)');
      expect(html).toContain('--custom-row-gap:2px');
      expect(Number(dataRowHeight?.[1])).toBeLessThan(38);
    }
  });

  it('locks custom result row and logo sizes after row auto-fit', async () => {
    const { service } = buildService();
    const rows = [
      {
        rank: '#1',
        title: 'Wide Logo Team',
        subtitle: 'wide mark',
        metric: '30',
        logoUrl: 'https://cdn.example.test/wide-logo.png',
        teamLogoUrl: null,
        kills: 10,
        placementPoints: 20,
        totalPoints: 30,
      },
      {
        rank: '#2',
        title: 'Tall Logo Team',
        subtitle: 'tall mark',
        metric: '24',
        logoUrl: 'https://cdn.example.test/tall-logo.png',
        teamLogoUrl: null,
        kills: 8,
        placementPoints: 16,
        totalPoints: 24,
      },
    ];
    const layout = {
      enabled: true,
      elements: [
        {
          id: 'rows',
          type: 'rows',
          x: 48,
          y: 188,
          width: 480,
          startRank: 1,
          rankDisplayMode: 'global',
          cardDirection: 'vertical',
          autoFitRows: false,
          rowHeight: 38,
          rowGap: 6,
          groupColumns: 1,
          groupGap: 16,
          maxRows: 2,
          groupOffsets: [],
          fontSize: 14,
          headerFontSize: 10,
          rowRadius: 9,
          showHeader: true,
          zIndex: 10,
          enabled: true,
          columns: [
            {
              id: 'rank',
              field: 'rank',
              label: 'Rank',
              width: 42,
              align: 'center',
              enabled: true,
            },
            {
              id: 'logo',
              field: 'logo',
              label: 'Logo',
              width: 36,
              align: 'center',
              enabled: true,
            },
            {
              id: 'team',
              field: 'team',
              label: 'Team',
              width: 240,
              align: 'left',
              enabled: true,
            },
            {
              id: 'total',
              field: 'totalPoints',
              label: 'Total',
              width: 58,
              align: 'right',
              enabled: true,
            },
          ],
        },
      ],
    };
    const branding = {
      primaryColor: '#00e5ff',
      background: '#0b0f14',
      textPrimary: '#ffffff',
      textMuted: '#94a3b8',
      panel: 'rgba(11,15,20,0.7)',
      border: 'rgba(255,255,255,0.12)',
      shadow: '0 24px 64px rgba(0,0,0,0.45)',
      logoUrl: null,
      defaultTeamLogoUrl: null,
      safeArea: { top: 32, right: 32, bottom: 32, left: 32 },
    };

    for (const kind of ['match-result', 'overall-ranking']) {
      const html = await (service as any).buildDiscordCustomWidgetHtml({
        kind,
        eyebrow: 'Results',
        title: 'Logo Lock',
        subtitle: '',
        rows,
        branding,
        footer: 'Footer',
        overlayLayersHtml: '',
        layout,
      });
      const rowStyle = html.match(
        /<div class="custom-data-row" style="([^"]*--custom-row-image-size:[^"]*)"/,
      )?.[1];

      expect(rowStyle).toContain('height:38px');
      expect(rowStyle).toContain('min-height:38px');
      expect(rowStyle).toContain('max-height:38px');
      expect(rowStyle).toContain('--custom-row-image-size:28px');
      expect(html).toContain('custom-cell--logo');
      expect(html).toContain('width: var(--custom-row-image-size, 24px);');
      expect(html).toContain('height: var(--custom-row-image-size, 24px);');
      expect(html).not.toContain('width: 100%;\n        height: 100%;');
    }
  });

  it('forces custom Discord result rows to auto-fit inside the image', async () => {
    const { service, prisma, results } = buildService();
    results.ensureMatch.mockResolvedValue({
      id: 'match-1',
      organizationId: 'org-1',
    });
    const slotResults = Array.from({ length: 25 }, (_, index) => {
      const slotNumber = index + 1;
      return {
        teamId: `team-${slotNumber}`,
        wasPresentInMatch: true,
        placement: slotNumber,
        totalKills: 26 - slotNumber,
        placementPoints: Math.max(0, 26 - slotNumber),
        totalPoints: 100 - slotNumber,
        points: 100 - slotNumber,
        slotNumber,
        team: {
          tag: `OT${slotNumber}`,
          name: `Offset Team ${slotNumber}`,
          logoUrl: null,
        },
      };
    });
    prisma.match.findFirst.mockResolvedValue({
      id: 'match-1',
      name: 'Offset Fit Scrim',
      organizationId: 'org-1',
      sessionId: 'session-1',
      matchNumber: 1,
      session: { id: 'session-1', name: 'Daily Session' },
      status: MatchStatus.FINISHED,
      slotResults,
    });
    prisma.sessionDiscordConfig.findFirst.mockResolvedValue({
      emojis: {
        discordWidgetTemplateEnabled: true,
        discordWidgetCustomLayouts: JSON.stringify({
          version: 1,
          layouts: {
            'match-result': {
              enabled: true,
              elements: [
                {
                  id: 'rows',
                  type: 'rows',
                  x: 48,
                  y: 188,
                  width: 1104,
                  startRank: 1,
                  rankDisplayMode: 'global',
                  cardDirection: 'vertical',
                  autoFitRows: false,
                  rowHeight: 38,
                  rowGap: 8,
                  groupColumns: 2,
                  groupGap: 16,
                  maxRows: 18,
                  groupOffsets: [
                    { x: 0, y: 70 },
                    { x: 0, y: 0 },
                  ],
                  fontSize: 14,
                  headerFontSize: 10,
                  rowRadius: 9,
                  showHeader: true,
                  zIndex: 10,
                  enabled: true,
                  columns: [
                    {
                      id: 'rank',
                      field: 'rank',
                      label: 'Rank',
                      width: 42,
                      align: 'center',
                      enabled: true,
                    },
                    {
                      id: 'team',
                      field: 'team',
                      label: 'Team',
                      width: 240,
                      align: 'left',
                      enabled: true,
                    },
                    {
                      id: 'kills',
                      field: 'kills',
                      label: 'Kills',
                      width: 52,
                      align: 'right',
                      enabled: true,
                    },
                    {
                      id: 'total',
                      field: 'totalPoints',
                      label: 'Total',
                      width: 58,
                      align: 'right',
                      enabled: true,
                    },
                  ],
                },
              ],
            },
          },
        }),
      },
    });
    const renderSpy = jest
      .spyOn(service, 'renderHtmlToImage')
      .mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await service.renderDiscordMatchImage(
      actor as any,
      'match-1',
      'match-result',
    );

    const html = renderSpy.mock.calls[0]?.[0] ?? '';
    const dataRowHeight = html.match(
      /class="custom-data-row" style="[^"]*min-height:(\d+)px/,
    );

    expect(html).toContain('Offset Team 1');
    expect(html).toContain('Offset Team 18');
    expect(html).not.toContain('Offset Team 19');
    expect(html).not.toContain('Offset Team 25');
    expect(html).toContain('transform:translate(0px, 70px)');
    expect(html).toContain('--custom-row-gap:2px');
    expect(Number(dataRowHeight?.[1])).toBeLessThan(38);
  });

  it('keeps intentionally blank Discord result image titles blank', async () => {
    const { service, prisma, results } = buildService();
    results.ensureMatch.mockResolvedValue({
      id: 'match-1',
      organizationId: 'org-1',
    });
    prisma.match.findFirst.mockResolvedValue({
      id: 'match-1',
      name: 'Hidden Match Name',
      organizationId: 'org-1',
      sessionId: 'session-1',
      session: { id: 'session-1', name: 'Daily Session' },
      status: MatchStatus.FINISHED,
      slotResults: [
        {
          wasPresentInMatch: true,
          placement: 1,
          totalKills: 12,
          placementPoints: 16,
          totalPoints: 28,
          points: 28,
          slotNumber: 1,
          team: { tag: 'DXB', name: 'Dubai', logoUrl: null },
        },
      ],
    });
    prisma.sessionDiscordConfig.findFirst.mockResolvedValue({
      emojis: {
        discordWidgetTemplateEnabled: 'true',
        discordMatchResultEyebrow: '',
        discordMatchResultTitle: '',
        discordMatchResultSubtitle: '',
      },
    });
    const renderSpy = jest
      .spyOn(service, 'renderHtmlToImage')
      .mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await service.renderDiscordMatchImage(
      actor as any,
      'match-1',
      'match-result',
    );

    const html = renderSpy.mock.calls[0]?.[0] ?? '';
    expect(html).toContain('<div class="ranking-title"></div>');
    expect(html).not.toContain('class="ranking-eyebrow"');
    expect(html).not.toContain('class="ranking-subtitle"');
    expect(html).toContain('linear-gradient(135deg, #101827 0%, #1d4ed8 100%)');
    expect(html).not.toContain('background: transparent;');
    expect(html).not.toContain('Arenzyra Results');
    expect(html).not.toContain('Hidden Match Name');
  });

  it('uses saved Discord custom widget layouts for ranking cards', async () => {
    const { service, prisma, results } = buildService();
    results.ensureMatch.mockResolvedValue({
      id: 'match-1',
      organizationId: 'org-1',
    });
    prisma.match.findFirst.mockResolvedValue({
      id: 'match-1',
      name: 'Custom Result Lobby',
      organizationId: 'org-1',
      sessionId: 'session-1',
      session: { id: 'session-1', name: 'Daily Session' },
      status: MatchStatus.FINISHED,
      slotResults: [
        {
          wasPresentInMatch: true,
          placement: 1,
          totalKills: 12,
          placementPoints: 16,
          totalPoints: 28,
          points: 28,
          slotNumber: 1,
          team: {
            tag: 'DXB',
            name: 'Dubai',
            logoUrl: '/uploads/logos/dxb.png',
          },
        },
        {
          wasPresentInMatch: true,
          placement: 2,
          totalKills: 9,
          placementPoints: 12,
          totalPoints: 21,
          points: 21,
          slotNumber: 2,
          team: {
            tag: 'NXT',
            name: 'Next',
            logoUrl: '/uploads/logos/nxt.png',
          },
        },
        {
          wasPresentInMatch: true,
          placement: 3,
          totalKills: 6,
          placementPoints: 10,
          totalPoints: 16,
          points: 16,
          slotNumber: 3,
          team: {
            tag: 'SHJ',
            name: 'Sharjah',
            logoUrl: '/uploads/logos/shj.png',
          },
        },
        {
          wasPresentInMatch: true,
          placement: 4,
          totalKills: 4,
          placementPoints: 8,
          totalPoints: 12,
          points: 12,
          slotNumber: 4,
          team: {
            tag: 'AJM',
            name: 'Ajman',
            logoUrl: '/uploads/logos/ajm.png',
          },
        },
      ],
    });
    prisma.sessionDiscordConfig.findFirst.mockResolvedValue({
      emojis: {
        discordWidgetTemplateEnabled: 'true',
        discordWidgetTemplateBackgroundUrl:
          '/uploads/widget-templates/custom.webp',
        discordWidgetFontFamily: 'custom',
        discordWidgetCustomFontName: 'Bebas Neue',
        discordWidgetCustomFontCssUrl:
          'https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap',
        discordMatchResultTitle: '{matchName} Final',
        discordWidgetCustomLayouts: JSON.stringify({
          version: 1,
          layouts: {
            'match-result': {
              enabled: true,
              elements: [
                {
                  id: 'title',
                  type: 'text',
                  field: 'title',
                  x: 48,
                  y: 80,
                  width: 760,
                  height: 56,
                  fontSize: 38,
                  fontWeight: 800,
                  align: 'left',
                  zIndex: 10,
                  enabled: true,
                },
                {
                  id: 'featured',
                  type: 'featured',
                  x: 330,
                  y: 134,
                  width: 540,
                  teamCount: 2,
                  groupColumns: 2,
                  cardHeight: 84,
                  cardGap: 10,
                  logoSize: 40,
                  fontSize: 13,
                  rowRadius: 10,
                  showStats: true,
                  zIndex: 12,
                  enabled: true,
                },
                {
                  id: 'custom-note',
                  type: 'text',
                  field: 'custom',
                  text: 'Imported Design',
                  x: 820,
                  y: 88,
                  width: 280,
                  height: 40,
                  fontSize: 22,
                  fontWeight: 800,
                  color: '#ffdd55',
                  align: 'right',
                  textTransform: 'capitalize',
                  background: true,
                  backgroundColor: '#111827',
                  zIndex: 14,
                  enabled: true,
                },
                {
                  id: 'rank-logo',
                  type: 'image',
                  source: 'dynamic-code',
                  dynamicCode: 'M-1-1',
                  x: 1000,
                  y: 42,
                  width: 92,
                  height: 92,
                  radius: 14,
                  opacity: 0.9,
                  zIndex: 15,
                  enabled: true,
                },
                {
                  id: 'rows',
                  type: 'rows',
                  x: 48,
                  y: 188,
                  width: 1104,
                  rankDisplayMode: 'restart',
                  autoFitRows: true,
                  rowHeight: 28,
                  rowGap: 5,
                  groupColumns: 2,
                  groupGap: 16,
                  maxRows: 1,
                  groupOffsets: [
                    { x: 18, y: 24 },
                    { x: 0, y: 0 },
                  ],
                  fontSize: 12,
                  headerFontSize: 9,
                  rowRadius: 9,
                  showHeader: true,
                  zIndex: 10,
                  enabled: true,
                  columns: [
                    {
                      id: 'rank',
                      field: 'rank',
                      label: 'Rank',
                      width: 34,
                      align: 'center',
                      enabled: true,
                    },
                    {
                      id: 'logo',
                      field: 'logo',
                      label: 'Logo',
                      width: 26,
                      align: 'center',
                      enabled: true,
                    },
                    {
                      id: 'team',
                      field: 'team',
                      label: 'Team',
                      width: 220,
                      align: 'left',
                      fontSize: 13,
                      fontWeight: 900,
                      color: '#abcdef',
                      backgroundColor: '#111111',
                      textTransform: 'capitalize',
                      enabled: true,
                    },
                    {
                      id: 'kills',
                      field: 'kills',
                      label: 'Kills',
                      width: 46,
                      align: 'right',
                      enabled: true,
                    },
                    {
                      id: 'placementPoints',
                      field: 'placementPoints',
                      label: 'PLC',
                      width: 58,
                      align: 'right',
                      enabled: true,
                    },
                    {
                      id: 'totalPoints',
                      field: 'totalPoints',
                      label: 'Total',
                      width: 58,
                      align: 'right',
                      enabled: true,
                    },
                  ],
                },
                {
                  id: 'rows-second',
                  type: 'rows',
                  x: 620,
                  y: 188,
                  width: 480,
                  startRank: 2,
                  rowHeight: 28,
                  rowGap: 5,
                  groupColumns: 1,
                  groupGap: 0,
                  maxRows: 1,
                  fontSize: 12,
                  headerFontSize: 9,
                  rowRadius: 9,
                  showHeader: true,
                  zIndex: 13,
                  enabled: true,
                  columns: [
                    {
                      id: 'rank',
                      field: 'rank',
                      label: 'Rank',
                      width: 34,
                      align: 'center',
                      enabled: true,
                    },
                    {
                      id: 'team',
                      field: 'team',
                      label: 'Team',
                      width: 220,
                      align: 'left',
                      enabled: true,
                    },
                  ],
                },
              ],
            },
          },
        }),
        discordRankingTableLayouts: JSON.stringify({
          version: 1,
          layouts: {
            'match-result': {
              tableX: 20,
              tableY: 144,
              tableWidth: 1000,
              tableHeight: 360,
              titleHeight: 104,
              titleSize: 50,
              groupColumns: 1,
              rowHeight: 36,
              columns: [
                {
                  field: 'rank',
                  label: 'POS',
                  width: 56,
                  align: 'center',
                  enabled: true,
                },
                {
                  field: 'team',
                  label: 'Squad',
                  width: 640,
                  align: 'left',
                  enabled: true,
                },
                {
                  field: 'wwcd',
                  label: 'WWCD',
                  width: 64,
                  align: 'center',
                  enabled: false,
                },
                {
                  field: 'totalPoints',
                  label: 'Points',
                  width: 80,
                  align: 'right',
                  enabled: true,
                },
              ],
            },
          },
        }),
      },
    });
    const renderSpy = jest
      .spyOn(service, 'renderHtmlToImage')
      .mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await service.renderDiscordMatchImage(
      actor as any,
      'match-1',
      'match-result',
    );

    const html = renderSpy.mock.calls[0]?.[0] ?? '';
    expect(html).toContain('Arenzyra Discord Custom Widget');
    expect(html).toContain('/uploads/widget-templates/custom.webp');
    expect(html).toContain(
      '@import url("https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap");',
    );
    expect(html).toContain(
      'font-family: "Bebas Neue", "Segoe UI", Arial, sans-serif;',
    );
    expect(html).toContain('Custom Result Lobby Final');
    expect(html).toContain('Imported Design');
    expect(html).toContain('class="custom-image"');
    expect(html).toContain('opacity:0.90');
    expect(html).toContain('color:#abcdef;text-transform:capitalize');
    expect(html).toContain('background:#111111');
    expect(html).toContain('class="custom-rows"');
    expect(html).toContain(
      'background:var(--panel);border:1px solid #ffffff1a',
    );
    expect(html).toContain('transform:translate(18px, 24px)');
    expect(html).toContain('left:620px; top:188px; width:480px;');
    expect(html).toMatch(
      /<div class="custom-data-row"[^>]*>[\s\S]*custom-cell--rank[^>]*>#1<\/div>[\s\S]*Dubai/,
    );
    expect(html).toMatch(
      /<div class="custom-data-row"[^>]*>[\s\S]*custom-cell--rank[^>]*>#2<\/div>[\s\S]*Next/,
    );
    expect(html).toContain('class="custom-featured"');
    expect(html).toContain('Dubai');
    expect(html).toContain('Next');
    expect(html).not.toContain('Sharjah');
    expect(html).not.toContain('Ajman');
    expect(html).toContain('/uploads/logos/dxb.png');
    expect(html).toContain('/uploads/logos/nxt.png');
    expect(html).not.toContain('/uploads/logos/shj.png');
    expect(html).not.toContain('/uploads/logos/ajm.png');
    expect(html).not.toContain('Arenzyra Ranking Table Widget');
    expect(html).not.toContain('left: 20px');
    expect(html).not.toContain('top: 144px');
    expect(html).not.toContain('width: 1000px');
    expect(html).toContain('Rank');
    expect(html).toContain('Team');
    expect(html).toContain('Total');
    expect(html).not.toContain('Squad');
    expect(html).not.toContain('WWCD</div>');
    expect(html).not.toContain('class="board"');
  });

  it('renders Discord top fragger cards from player rows', async () => {
    const { service, prisma, results } = buildService();
    results.ensureMatch.mockResolvedValue({
      id: 'match-1',
      organizationId: 'org-1',
    });
    prisma.match.findFirst.mockResolvedValue({
      id: 'match-1',
      name: 'Match 1',
      organizationId: 'org-1',
      sessionId: 'session-1',
      session: { id: 'session-1', name: 'Daily Session' },
    });
    prisma.sessionDiscordConfig.findFirst.mockResolvedValue({
      emojis: {
        discordTopFraggersEyebrow: 'Kill Race',
        discordTopFraggersTitle: '{matchName} Fraggers',
        discordTopFraggersSubtitle: 'Top eliminations',
      },
    });
    prisma.match.findMany.mockResolvedValue([
      { id: 'match-1' },
      { id: 'match-2' },
    ]);
    const playerRows = [
      {
        matchId: 'match-1',
        id: 'slot-player-1',
        playerId: 'player-1',
        playerName: 'DXB Rafi',
        kills: 9,
        knocks: 3,
        assists: 2,
        isAlive: true,
        alive: true,
        player: {
          id: 'player-1',
          ign: 'DXB Rafi',
          realName: null,
          photoUrl: '/media/players/player-1/photo?v=123',
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        slotResult: {
          wasPresentInMatch: true,
          placement: 1,
          placementPoints: 15,
          totalKills: 9,
          totalPoints: 24,
          points: 24,
          team: {
            id: 'team-1',
            name: 'Dubai',
            tag: 'DXB',
            logoUrl: null,
            logoLightUrl: null,
            logoDarkUrl: null,
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        },
      },
      {
        matchId: 'match-2',
        id: 'slot-player-2',
        playerId: 'player-1',
        playerName: 'DXB Rafi',
        kills: 5,
        knocks: 1,
        assists: 1,
        isAlive: false,
        alive: false,
        player: {
          id: 'player-1',
          ign: 'DXB Rafi',
          realName: null,
          photoUrl: '/media/players/player-1/photo?v=123',
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        slotResult: {
          wasPresentInMatch: true,
          placement: 2,
          placementPoints: 12,
          totalKills: 5,
          totalPoints: 17,
          points: 17,
          team: {
            id: 'team-1',
            name: 'Dubai',
            tag: 'DXB',
            logoUrl: null,
            logoLightUrl: null,
            logoDarkUrl: null,
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        },
      },
      {
        matchId: 'match-1',
        id: 'slot-player-3',
        playerId: null,
        playerName: 'Loose Ace',
        kills: 4,
        knocks: 0,
        assists: 0,
        isAlive: false,
        alive: false,
        player: null,
        slotResult: {
          wasPresentInMatch: true,
          placement: 3,
          placementPoints: 10,
          totalKills: 4,
          totalPoints: 14,
          points: 14,
          team: {
            id: 'team-2',
            name: 'Sharjah',
            tag: 'SHJ',
            logoUrl: null,
            logoLightUrl: null,
            logoDarkUrl: null,
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        },
      },
      {
        matchId: 'match-2',
        id: 'slot-player-4',
        playerId: null,
        playerName: 'Loose Ace',
        kills: 3,
        knocks: 0,
        assists: 0,
        isAlive: false,
        alive: false,
        player: null,
        slotResult: {
          wasPresentInMatch: true,
          placement: 4,
          placementPoints: 8,
          totalKills: 3,
          totalPoints: 11,
          points: 11,
          team: {
            id: 'team-2',
            name: 'Sharjah',
            tag: 'SHJ',
            logoUrl: null,
            logoLightUrl: null,
            logoDarkUrl: null,
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        },
      },
    ];
    prisma.matchSlotPlayerResult.findMany.mockImplementation((args: any) => {
      const matchFilter = args?.where?.slotResult?.matchId;
      if (typeof matchFilter === 'string') {
        return Promise.resolve(
          playerRows.filter((row) => row.matchId === matchFilter),
        );
      }
      if (Array.isArray(matchFilter?.in)) {
        return Promise.resolve(
          playerRows.filter((row) => matchFilter.in.includes(row.matchId)),
        );
      }
      return Promise.resolve(playerRows);
    });
    const renderSpy = jest
      .spyOn(service, 'renderHtmlToImage')
      .mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const buffer = await service.renderDiscordMatchImage(
      actor as any,
      'match-1',
      'top-fraggers',
    );

    expect(buffer).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(renderSpy).toHaveBeenCalledWith(
      expect.stringContaining('Kill Race'),
    );
    expect(renderSpy).toHaveBeenCalledWith(
      expect.stringContaining('Match 1 Fraggers'),
    );
    expect(renderSpy).toHaveBeenCalledWith(
      expect.stringContaining('Top eliminations'),
    );
    expect(renderSpy).toHaveBeenCalledWith(expect.stringContaining('DXB Rafi'));
    expect(renderSpy).toHaveBeenCalledWith(expect.stringContaining('9 kills'));
    expect(renderSpy).toHaveBeenCalledWith(
      expect.stringContaining('Loose Ace'),
    );
    expect(renderSpy).toHaveBeenCalledWith(expect.stringContaining('4 kills'));
    expect(renderSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('14 kills'),
    );
    expect(renderSpy).toHaveBeenCalledWith(
      expect.stringContaining('class="player-photo"'),
    );
    expect(renderSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'http://localhost:3000/media/players/player-1/photo?v=123',
      ),
    );

    renderSpy.mockClear();

    const overallBuffer = await service.renderDiscordMatchImage(
      actor as any,
      'match-1',
      'overall-top-fraggers',
    );

    expect(overallBuffer).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(renderSpy).toHaveBeenCalledWith(expect.stringContaining('DXB Rafi'));
    expect(renderSpy).toHaveBeenCalledWith(expect.stringContaining('14 kills'));
    expect(renderSpy).toHaveBeenCalledWith(
      expect.stringContaining('Loose Ace'),
    );
    expect(renderSpy).toHaveBeenCalledWith(expect.stringContaining('7 kills'));
  });

  it('renders custom Discord player widgets with player photos instead of team logo fallback', async () => {
    const { service, prisma, results } = buildService();
    const updatedAt = new Date('2026-01-01T00:00:00.000Z');
    results.ensureMatch.mockResolvedValue({
      id: 'match-1',
      organizationId: 'org-1',
    });
    prisma.match.findFirst.mockResolvedValue({
      id: 'match-1',
      name: 'Match 1',
      organizationId: 'org-1',
      sessionId: 'session-1',
      session: { id: 'session-1', name: 'Daily Session' },
    });
    prisma.sessionDiscordConfig.findFirst.mockResolvedValue({
      emojis: {
        discordWidgetTemplateEnabled: 'true',
        discordWidgetCustomLayouts: JSON.stringify({
          version: 1,
          layouts: {
            'top-fraggers': {
              enabled: true,
              elements: [
                {
                  id: 'rows',
                  type: 'rows',
                  x: 48,
                  y: 140,
                  width: 900,
                  rowHeight: 36,
                  rowGap: 4,
                  groupColumns: 1,
                  groupGap: 0,
                  maxRows: 2,
                  fontSize: 14,
                  headerFontSize: 10,
                  rowRadius: 8,
                  showHeader: false,
                  zIndex: 10,
                  enabled: true,
                  columns: [
                    {
                      id: 'rank',
                      field: 'rank',
                      label: 'Rank',
                      width: 44,
                      align: 'center',
                      enabled: true,
                    },
                    {
                      id: 'logo',
                      field: 'logo',
                      label: 'Photo',
                      width: 34,
                      align: 'center',
                      enabled: true,
                    },
                    {
                      id: 'teamLogo',
                      field: 'teamLogo',
                      label: 'Team',
                      width: 34,
                      align: 'center',
                      enabled: true,
                    },
                    {
                      id: 'team',
                      field: 'team',
                      label: 'Player',
                      width: 220,
                      align: 'left',
                      enabled: true,
                    },
                    {
                      id: 'kills',
                      field: 'kills',
                      label: 'Kills',
                      width: 60,
                      align: 'right',
                      enabled: true,
                    },
                  ],
                },
                {
                  id: 'rank-player-photo',
                  type: 'image',
                  source: 'row-logo',
                  rowRank: 1,
                  x: 980,
                  y: 120,
                  width: 80,
                  height: 80,
                  radius: 12,
                  opacity: 1,
                  zIndex: 14,
                  enabled: true,
                },
                {
                  id: 'rank-team-logo',
                  type: 'image',
                  source: 'team-logo',
                  rowRank: 1,
                  x: 1070,
                  y: 120,
                  width: 80,
                  height: 80,
                  radius: 12,
                  opacity: 1,
                  zIndex: 14,
                  enabled: true,
                },
              ],
            },
          },
        }),
      },
    });
    prisma.player.findMany.mockResolvedValue([
      {
        id: 'player-ext',
        ign: 'Saved Ace',
        realName: null,
        photoUrl: '/media/players/player-ext/photo?v=9',
        updatedAt,
        externalPlayerId: 'uid-1',
        pubgPlayerId: null,
        inGameId: null,
        playerOpenId: null,
      },
    ]);
    prisma.matchSlotPlayerResult.findMany.mockResolvedValue([
      {
        id: 'slot-player-1',
        playerId: null,
        pubgAccountId: null,
        externalPlayerId: 'uid-1',
        playerName: 'OCR Ace',
        kills: 9,
        knocks: 1,
        assists: 0,
        isAlive: true,
        alive: true,
        player: null,
        slotResult: {
          wasPresentInMatch: true,
          placement: 1,
          placementPoints: 15,
          totalKills: 9,
          totalPoints: 24,
          points: 24,
          team: {
            id: 'team-1',
            name: 'Dubai',
            tag: 'DXB',
            logoUrl: '/uploads/logos/dxb.png',
            logoLightUrl: null,
            logoDarkUrl: null,
            updatedAt,
          },
        },
      },
      {
        id: 'slot-player-2',
        playerId: null,
        pubgAccountId: null,
        externalPlayerId: null,
        playerName: 'Missing Photo',
        kills: 7,
        knocks: 0,
        assists: 0,
        isAlive: false,
        alive: false,
        player: null,
        slotResult: {
          wasPresentInMatch: true,
          placement: 2,
          placementPoints: 12,
          totalKills: 7,
          totalPoints: 19,
          points: 19,
          team: {
            id: 'team-2',
            name: 'Next',
            tag: 'NXT',
            logoUrl: '/uploads/logos/nxt.png',
            logoLightUrl: null,
            logoDarkUrl: null,
            updatedAt,
          },
        },
      },
    ]);
    const renderSpy = jest
      .spyOn(service, 'renderHtmlToImage')
      .mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await service.renderDiscordMatchImage(
      actor as any,
      'match-1',
      'top-fraggers',
    );

    const html = renderSpy.mock.calls[0]?.[0] ?? '';
    expect(html).toContain('Arenzyra Discord Custom Widget');
    expect(html).toContain('Saved Ace');
    expect(html).toContain(
      'http://localhost:3000/media/players/player-ext/photo?v=9',
    );
    expect(html).toContain(
      'http://localhost:3000/assets/defaults/default-player.png',
    );
    expect(html).toContain('http://localhost:3000/uploads/logos/dxb.png');
    expect(html).toContain('http://localhost:3000/uploads/logos/nxt.png');
  });
});
