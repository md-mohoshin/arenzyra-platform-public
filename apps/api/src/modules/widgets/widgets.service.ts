import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { CreateWidgetInstanceDto } from './dto/create-widget-instance.dto';
import { OrganizationBrandingService } from '../organization-branding/organization-branding.service';
import { OverlayGateway } from '../realtime/overlay.gateway';
import { DEFAULT_ORGANIZATION_BRANDING } from '../organization-branding/organization-branding.constants';

const widgetInstanceRelations = {
  organization: {
    select: {
      id: true,
      name: true,
      slug: true,
      widgetApprovalEnforced: true,
    },
  },
  tournament: {
    select: {
      id: true,
      name: true,
      organizationId: true,
    },
  },
  match: {
    select: {
      id: true,
      name: true,
      tournamentId: true,
      organizationId: true,
      status: true,
      startedAt: true,
      matchNumber: true,
      map: true,
    },
  },
} as const;

type WidgetInstanceWithRelations = Prisma.WidgetInstanceGetPayload<{
  include: typeof widgetInstanceRelations;
}>;

type WidgetAccessOrganization = {
  id: string;
  name: string;
  slug: string;
  widgetApprovalEnforced: boolean;
};

type WidgetApprovalRecord = {
  widgetKey: string;
  isApproved: boolean;
  approvedAt: string | null;
  approvedBy: string | null;
};

type WidgetAccessResult = {
  organizationId: string;
  organizationSlug: string;
  widgetKey: string;
  enforced: boolean;
  allowed: boolean;
  approval: WidgetApprovalRecord | null;
};

const TRIGGERABLE_WIDGET_KEYS = new Set([
  'lower-third',
  'match-lower-third',
  'match-start-lower-third',
]);

@Injectable()
export class WidgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branding: OrganizationBrandingService,
    private readonly overlayGateway: OverlayGateway,
  ) {}

  private buildObsUrl(organizationSlug: string, widgetKey: string): string {
    return `/widgets/${organizationSlug}/${widgetKey}`;
  }

  private mapWidgetApproval(
    approval: {
      widgetKey: string;
      isApproved: boolean;
      approvedAt: Date | null;
      approvedBy: string | null;
    } | null,
  ): WidgetApprovalRecord | null {
    if (!approval) return null;
    return {
      widgetKey: approval.widgetKey,
      isApproved: approval.isApproved,
      approvedAt: approval.approvedAt?.toISOString() ?? null,
      approvedBy: approval.approvedBy ?? null,
    };
  }

  private async findOrganizationForAccess(input: {
    organizationId?: string | null;
    organizationSlug?: string | null;
  }): Promise<WidgetAccessOrganization | null> {
    if (input.organizationId) {
      return this.prisma.organization.findFirst({
        where: { id: input.organizationId, deletedAt: null },
        select: {
          id: true,
          name: true,
          slug: true,
          widgetApprovalEnforced: true,
        },
      });
    }

    if (input.organizationSlug) {
      return this.prisma.organization.findFirst({
        where: { slug: input.organizationSlug, deletedAt: null },
        select: {
          id: true,
          name: true,
          slug: true,
          widgetApprovalEnforced: true,
        },
      });
    }

    return null;
  }

  private async computeWidgetAccess(
    organization: WidgetAccessOrganization,
    widgetKey: string,
  ): Promise<WidgetAccessResult> {
    const approval = await this.prisma.organizationWidgetApproval.findUnique({
      where: {
        organizationId_widgetKey: {
          organizationId: organization.id,
          widgetKey,
        },
      },
      select: {
        widgetKey: true,
        isApproved: true,
        approvedAt: true,
        approvedBy: true,
      },
    });

    const mappedApproval = this.mapWidgetApproval(approval);
    return {
      organizationId: organization.id,
      organizationSlug: organization.slug,
      widgetKey,
      enforced: organization.widgetApprovalEnforced,
      allowed: approval
        ? approval.isApproved
        : !organization.widgetApprovalEnforced,
      approval: mappedApproval,
    };
  }

  async assertWidgetApproved(
    organizationId: string,
    widgetKey: string,
  ): Promise<void> {
    const organization = await this.findOrganizationForAccess({
      organizationId,
    });
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const access = await this.computeWidgetAccess(organization, widgetKey);
    if (!access.allowed) {
      throw new NotFoundException(
        'Widget is not approved for this organization',
      );
    }
  }

  async createInstance(dto: CreateWidgetInstanceDto) {
    await this.assertWidgetApproved(dto.organizationId, dto.widgetKey);

    // Keep a single permanent widget entry per organization/widget key.
    const instance = await this.prisma.widgetInstance.upsert({
      where: {
        organizationId_widgetKey: {
          organizationId: dto.organizationId,
          widgetKey: dto.widgetKey,
        },
      },
      update: {
        tournamentId: dto.tournamentId ?? null,
        matchId: dto.matchId ?? null,
        isActive: true,
      },
      create: {
        widgetKey: dto.widgetKey,
        organizationId: dto.organizationId,
        tournamentId: dto.tournamentId ?? null,
        matchId: dto.matchId ?? null,
        isActive: true,
      },
      select: {
        id: true,
        key: true,
        widgetKey: true,
        organization: {
          select: {
            slug: true,
          },
        },
      },
    });

    return {
      id: instance.id,
      key: instance.key,
      widgetKey: instance.widgetKey,
      obsUrl: this.buildObsUrl(instance.organization.slug, instance.widgetKey),
    };
  }

  private async ensurePermanentInstance(params: {
    organizationId: string;
    widgetKey: string;
  }) {
    return this.prisma.widgetInstance.upsert({
      where: {
        organizationId_widgetKey: {
          organizationId: params.organizationId,
          widgetKey: params.widgetKey,
        },
      },
      update: {
        isActive: true,
      },
      create: {
        widgetKey: params.widgetKey,
        organizationId: params.organizationId,
        isActive: true,
      },
      include: widgetInstanceRelations,
    });
  }

  private async resolveLoadedInstance(instance: WidgetInstanceWithRelations) {
    const orgId =
      instance.match?.organizationId ??
      instance.tournament?.organizationId ??
      instance.organization.id;

    // Fallback: pick a live match (or latest) for this org if none stored on the instance
    let match = instance.match;
    if (!match) {
      // prefer a LIVE match
      match = await this.prisma.match.findFirst({
        where: {
          organizationId: orgId,
          status: 'LIVE',
          deletedAt: null,
        },
        orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          name: true,
          tournamentId: true,
          organizationId: true,
          status: true,
          startedAt: true,
          matchNumber: true,
          map: true,
        },
      });
    }
    if (!match) {
      // fallback to latest match for org
      match = await this.prisma.match.findFirst({
        where: { organizationId: orgId, deletedAt: null },
        orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          name: true,
          tournamentId: true,
          organizationId: true,
          status: true,
          startedAt: true,
          matchNumber: true,
          map: true,
        },
      });
    }

    // Fallback: pick tournament either from instance, from match, or latest active for org
    let tournament = instance.tournament;
    const tournamentIdFromMatch = match?.tournamentId;
    if (!tournament && tournamentIdFromMatch) {
      tournament = await this.prisma.tournament.findUnique({
        where: { id: tournamentIdFromMatch },
        select: { id: true, name: true, organizationId: true },
      });
    }
    if (!tournament) {
      tournament = await this.prisma.tournament.findFirst({
        where: { organizationId: orgId, deletedAt: null },
        orderBy: [{ status: 'desc' }, { updatedAt: 'desc' }],
        select: { id: true, name: true, organizationId: true },
      });
    }

    const branding = await this.branding.getForOrganization(orgId);

    return {
      id: instance.id,
      key: instance.key,
      widgetKey: instance.widgetKey,
      organization: {
        id: instance.organization.id,
        name: instance.organization.name,
        slug: instance.organization.slug,
        branding,
      },
      tournament: tournament ?? null,
      match: match ?? null,
    };
  }

  async resolveInstance(key: string) {
    const instance = await this.prisma.widgetInstance.findUnique({
      where: { key },
      include: widgetInstanceRelations,
    });

    if (!instance || !instance.isActive) {
      const branding = instance?.organizationId
        ? await this.branding.getForOrganization(instance.organizationId)
        : DEFAULT_ORGANIZATION_BRANDING;
      return {
        id: null,
        key,
        widgetKey: instance?.widgetKey ?? null,
        organization: instance?.organization
          ? {
              id: instance.organization.id,
              name: instance.organization.name,
              slug: instance.organization.slug,
              branding,
            }
          : {
              id: null,
              name: 'Unknown Organization',
              branding: DEFAULT_ORGANIZATION_BRANDING,
            },
        tournament: null,
        match: null,
      };
    }

    const access = await this.computeWidgetAccess(
      {
        id: instance.organization.id,
        name: instance.organization.name,
        slug: instance.organization.slug,
        widgetApprovalEnforced: instance.organization.widgetApprovalEnforced,
      },
      instance.widgetKey,
    );

    if (!access.allowed) {
      return {
        id: null,
        key,
        widgetKey: instance.widgetKey,
        organization: {
          id: instance.organization.id,
          name: instance.organization.name,
          slug: instance.organization.slug,
          branding: await this.branding.getForOrganization(
            instance.organization.id,
          ),
        },
        tournament: null,
        match: null,
      };
    }

    return this.resolveLoadedInstance(instance);
  }

  async resolveInstanceByOrganizationSlug(
    organizationSlug: string,
    widgetKey: string,
  ) {
    const organization = await this.prisma.organization.findFirst({
      where: {
        slug: organizationSlug,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        widgetApprovalEnforced: true,
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const access = await this.computeWidgetAccess(organization, widgetKey);

    if (!access.allowed) {
      return {
        id: null,
        key: null,
        widgetKey,
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          branding: await this.branding.getForOrganization(organization.id),
        },
        tournament: null,
        match: null,
      };
    }

    const instance = await this.prisma.widgetInstance.findUnique({
      where: {
        organizationId_widgetKey: {
          organizationId: organization.id,
          widgetKey,
        },
      },
      include: widgetInstanceRelations,
    });

    const activeInstance =
      instance && instance.isActive
        ? instance
        : await this.ensurePermanentInstance({
            organizationId: organization.id,
            widgetKey,
          });

    return this.resolveLoadedInstance(activeInstance);
  }

  async getWidgetAccess(input: {
    organizationId?: string | null;
    organizationSlug?: string | null;
    widgetKey: string;
  }) {
    const organization = await this.findOrganizationForAccess({
      organizationId: input.organizationId ?? null,
      organizationSlug: input.organizationSlug ?? null,
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return this.computeWidgetAccess(organization, input.widgetKey);
  }

  async listWidgetAccess(input: {
    organizationId?: string | null;
    organizationSlug?: string | null;
  }) {
    const organization = await this.findOrganizationForAccess({
      organizationId: input.organizationId ?? null,
      organizationSlug: input.organizationSlug ?? null,
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const approvals = await this.prisma.organizationWidgetApproval.findMany({
      where: { organizationId: organization.id },
      orderBy: { widgetKey: 'asc' },
      select: {
        widgetKey: true,
        isApproved: true,
        approvedAt: true,
        approvedBy: true,
      },
    });

    return {
      organizationId: organization.id,
      organizationSlug: organization.slug,
      enforced: organization.widgetApprovalEnforced,
      approvals: approvals
        .map((approval) => this.mapWidgetApproval(approval))
        .filter(
          (approval): approval is WidgetApprovalRecord => approval !== null,
        ),
    };
  }

  async triggerInstance(id: string, action: string) {
    if (action !== 'PLAY') {
      throw new NotFoundException('Unsupported action');
    }

    const instance = await this.prisma.widgetInstance.findUnique({
      where: { id },
      select: {
        id: true,
        widgetKey: true,
        isActive: true,
      },
    });

    if (!instance || !instance.isActive) {
      throw new NotFoundException('Widget instance not found or inactive');
    }

    if (!TRIGGERABLE_WIDGET_KEYS.has(instance.widgetKey)) {
      throw new NotFoundException('Invalid widget type for trigger');
    }

    // broadcast over overlay namespace (OBS)
    const payload = { widgetInstanceId: instance.id, action: 'PLAY' as const };
    this.overlayGateway.emitWidgetTrigger(payload);
    // temporary debug log

    console.log('[WidgetsService] widget:trigger emitted', payload);

    return { ok: true, ...payload };
  }
}
