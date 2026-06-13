import { WidgetsService } from './widgets.service';

describe('WidgetsService', () => {
  const prisma = {
    organization: {
      findFirst: jest.fn(),
    },
    organizationWidgetApproval: {
      findUnique: jest.fn(),
    },
    widgetInstance: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    match: {
      findFirst: jest.fn(),
    },
    tournament: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
  } as any;

  const branding = {
    getForOrganization: jest.fn(),
    getEffectiveBranding: jest.fn(),
  } as any;

  const overlayGateway = {
    emitWidgetTrigger: jest.fn(),
  } as any;

  let service: WidgetsService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new WidgetsService(prisma, branding, overlayGateway);
  });

  it('auto-creates an allowed permanent widget instance when none exists for the organization slug', async () => {
    prisma.organization.findFirst.mockResolvedValue({
      id: 'org-1',
      name: 'Global Control',
      slug: 'global-control',
      widgetApprovalEnforced: false,
    });
    prisma.organizationWidgetApproval.findUnique.mockResolvedValue(null);
    prisma.widgetInstance.findUnique.mockResolvedValue(null);
    prisma.widgetInstance.upsert.mockResolvedValue({
      id: 'instance-1',
      key: 'widget-key-1',
      widgetKey: 'player-photo',
      isActive: true,
      organization: {
        id: 'org-1',
        name: 'Global Control',
        slug: 'global-control',
        widgetApprovalEnforced: false,
      },
      tournament: null,
      match: null,
    });
    prisma.match.findFirst.mockResolvedValue({
      id: 'match-1',
      name: 'Match 1',
      tournamentId: 'tour-1',
      organizationId: 'org-1',
      status: 'LIVE',
      startedAt: null,
      matchNumber: 1,
      map: 'ERANGEL',
    });
    prisma.tournament.findUnique.mockResolvedValue({
      id: 'tour-1',
      name: 'Spring Invitational',
      organizationId: 'org-1',
    });
    branding.getForOrganization.mockResolvedValue({ mode: 'minimal' });
    branding.getEffectiveBranding.mockResolvedValue({ mode: 'minimal' });

    const resolved = await service.resolveInstanceByOrganizationSlug(
      'global-control',
      'player-photo',
    );

    expect(prisma.widgetInstance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_widgetKey: {
            organizationId: 'org-1',
            widgetKey: 'player-photo',
          },
        },
      }),
    );
    expect(resolved).toMatchObject({
      id: 'instance-1',
      key: 'widget-key-1',
      widgetKey: 'player-photo',
      organization: {
        id: 'org-1',
        slug: 'global-control',
      },
      tournament: {
        id: 'tour-1',
      },
      match: {
        id: 'match-1',
      },
    });
  });
});
