import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Role } from '@prisma/client';
import type { Actor } from '../../common/auth/jwt.strategy';
import { effectiveOrganizationId } from '../../common/org/org.util';
import { PrismaService } from '../../db/prisma.service';
import { UpdateOrganizationDiscordConfigDto } from './dto/update-organization-discord-config.dto';

const organizationSelect = {
  id: true,
  name: true,
  slug: true,
  status: true,
  deletedAt: true,
  discordConfig: {
    select: {
      id: true,
      organizationId: true,
      enabled: true,
      guildId: true,
      guildName: true,
      hubCategoryId: true,
      hubCategoryName: true,
      registrationsChannelId: true,
      registrationsChannelName: true,
      slotsChannelId: true,
      slotsChannelName: true,
      resultsChannelId: true,
      resultsChannelName: true,
      standingsChannelId: true,
      standingsChannelName: true,
      supportChannelId: true,
      supportChannelName: true,
      organizerRoleId: true,
      organizerRoleName: true,
      captainRoleId: true,
      captainRoleName: true,
      participantRoleId: true,
      participantRoleName: true,
      autoCreateSessionCategories: true,
      autoCreateSessionChannels: true,
      autoSyncRoles: true,
      sessionCategoryPrefix: true,
      sessionChannelPrefix: true,
      notes: true,
      lastValidatedAt: true,
      createdAt: true,
      updatedAt: true,
      updatedBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  },
} satisfies Prisma.OrganizationSelect;

type OrganizationWithDiscordConfig = Prisma.OrganizationGetPayload<{
  select: typeof organizationSelect;
}>;

@Injectable()
export class OrganizationDiscordService {
  constructor(private readonly prisma: PrismaService) {}

  private getActorRole(actor: Actor | null | undefined): Role | null {
    return actor?.actorRole ?? actor?.role ?? null;
  }

  private assertSuperAdmin(actor: Actor | null | undefined) {
    if (this.getActorRole(actor) !== Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Only super admins can access Discord config',
      );
    }
  }

  private assertOrgScopedManager(
    actor: Actor | null | undefined,
    organizationId: string,
  ) {
    const role = this.getActorRole(actor);
    if (role === Role.SUPER_ADMIN) {
      return;
    }

    if (role !== Role.ADMIN && role !== Role.ORGANIZER) {
      throw new ForbiddenException('Not allowed to manage Discord config');
    }

    const actorOrgId = effectiveOrganizationId(actor ?? null);
    if (!actorOrgId || actorOrgId !== organizationId) {
      throw new ForbiddenException('Not allowed to manage this organization');
    }
  }

  private resolveActorOrganizationId(actor: Actor | null | undefined): string {
    const organizationId = effectiveOrganizationId(actor ?? null);
    if (!organizationId) {
      throw new ForbiddenException('Organization context missing');
    }
    return organizationId;
  }

  private async requireOrganization(
    organizationId: string,
  ): Promise<OrganizationWithDiscordConfig> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: organizationSelect,
    });

    if (!organization || organization.deletedAt) {
      throw new NotFoundException('Organization not found');
    }

    return organization;
  }

  private normalizeOptionalString(
    value: string | null | undefined,
  ): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeDiscordSnowflake(
    value: string | null | undefined,
  ): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const normalized = value.replace(/\s+/g, '');
    return normalized.length > 0 ? normalized : null;
  }

  private buildPatchData(
    actor: Actor | null | undefined,
    dto: UpdateOrganizationDiscordConfigDto,
  ): Prisma.OrganizationDiscordConfigUncheckedUpdateInput {
    const data: Prisma.OrganizationDiscordConfigUncheckedUpdateInput = {};

    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    const assignString = (
      key: keyof Prisma.OrganizationDiscordConfigUncheckedUpdateInput,
      value: string | undefined,
    ) => {
      const normalized = this.normalizeOptionalString(value);
      if (normalized !== undefined) {
        (data as Record<string, string | null | boolean | undefined>)[
          key as string
        ] = normalized;
      }
    };
    const assignSnowflake = (
      key: keyof Prisma.OrganizationDiscordConfigUncheckedUpdateInput,
      value: string | undefined,
    ) => {
      const normalized = this.normalizeDiscordSnowflake(value);
      if (normalized !== undefined) {
        (data as Record<string, string | null | boolean | undefined>)[
          key as string
        ] = normalized;
      }
    };

    assignString('guildName', dto.guildName);
    assignString('hubCategoryName', dto.hubCategoryName);
    assignString('registrationsChannelName', dto.registrationsChannelName);
    assignString('slotsChannelName', dto.slotsChannelName);
    assignString('resultsChannelName', dto.resultsChannelName);
    assignString('standingsChannelName', dto.standingsChannelName);
    assignString('supportChannelName', dto.supportChannelName);
    assignString('organizerRoleName', dto.organizerRoleName);
    assignString('captainRoleName', dto.captainRoleName);
    assignString('participantRoleName', dto.participantRoleName);
    assignString('sessionCategoryPrefix', dto.sessionCategoryPrefix);
    assignString('sessionChannelPrefix', dto.sessionChannelPrefix);
    assignString('notes', dto.notes);

    assignSnowflake('guildId', dto.guildId);
    assignSnowflake('hubCategoryId', dto.hubCategoryId);
    assignSnowflake('registrationsChannelId', dto.registrationsChannelId);
    assignSnowflake('slotsChannelId', dto.slotsChannelId);
    assignSnowflake('resultsChannelId', dto.resultsChannelId);
    assignSnowflake('standingsChannelId', dto.standingsChannelId);
    assignSnowflake('supportChannelId', dto.supportChannelId);
    assignSnowflake('organizerRoleId', dto.organizerRoleId);
    assignSnowflake('captainRoleId', dto.captainRoleId);
    assignSnowflake('participantRoleId', dto.participantRoleId);

    if (dto.autoCreateSessionCategories !== undefined) {
      data.autoCreateSessionCategories = dto.autoCreateSessionCategories;
    }
    if (dto.autoCreateSessionChannels !== undefined) {
      data.autoCreateSessionChannels = dto.autoCreateSessionChannels;
    }
    if (dto.autoSyncRoles !== undefined) {
      data.autoSyncRoles = dto.autoSyncRoles;
    }

    if (actor?.id) {
      data.updatedById = actor.id;
    }

    return data;
  }

  private toView(organization: OrganizationWithDiscordConfig) {
    const config = organization.discordConfig ?? null;
    const configuredChannelCount = [
      config?.registrationsChannelId,
      config?.slotsChannelId,
      config?.resultsChannelId,
      config?.standingsChannelId,
      config?.supportChannelId,
    ].filter(Boolean).length;
    const configuredRoleCount = [
      config?.organizerRoleId,
      config?.captainRoleId,
      config?.participantRoleId,
    ].filter(Boolean).length;
    const summary = {
      hasGuildConnection: Boolean(config?.guildId),
      hasHubCategory: Boolean(config?.hubCategoryId),
      configuredChannelCount,
      configuredRoleCount,
      automationEnabled: Boolean(
        config?.autoCreateSessionCategories ||
        config?.autoCreateSessionChannels ||
        config?.autoSyncRoles,
      ),
    };

    return {
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        status: organization.status,
      },
      exists: Boolean(config),
      enabled: config?.enabled ?? false,
      guildId: config?.guildId ?? null,
      guildName: config?.guildName ?? null,
      hubCategoryId: config?.hubCategoryId ?? null,
      hubCategoryName: config?.hubCategoryName ?? null,
      registrationsChannelId: config?.registrationsChannelId ?? null,
      registrationsChannelName: config?.registrationsChannelName ?? null,
      slotsChannelId: config?.slotsChannelId ?? null,
      slotsChannelName: config?.slotsChannelName ?? null,
      resultsChannelId: config?.resultsChannelId ?? null,
      resultsChannelName: config?.resultsChannelName ?? null,
      standingsChannelId: config?.standingsChannelId ?? null,
      standingsChannelName: config?.standingsChannelName ?? null,
      supportChannelId: config?.supportChannelId ?? null,
      supportChannelName: config?.supportChannelName ?? null,
      organizerRoleId: config?.organizerRoleId ?? null,
      organizerRoleName: config?.organizerRoleName ?? null,
      captainRoleId: config?.captainRoleId ?? null,
      captainRoleName: config?.captainRoleName ?? null,
      participantRoleId: config?.participantRoleId ?? null,
      participantRoleName: config?.participantRoleName ?? null,
      autoCreateSessionCategories: config?.autoCreateSessionCategories ?? false,
      autoCreateSessionChannels: config?.autoCreateSessionChannels ?? false,
      autoSyncRoles: config?.autoSyncRoles ?? false,
      sessionCategoryPrefix: config?.sessionCategoryPrefix ?? null,
      sessionChannelPrefix: config?.sessionChannelPrefix ?? null,
      notes: config?.notes ?? null,
      createdAt: config?.createdAt ?? null,
      updatedAt: config?.updatedAt ?? null,
      lastValidatedAt: config?.lastValidatedAt ?? null,
      updatedBy: config?.updatedBy ?? null,
      summary,
    };
  }

  async getForActor(actor: Actor | null | undefined) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const organization = await this.requireOrganization(organizationId);
    return this.toView(organization);
  }

  async updateForActor(
    actor: Actor | null | undefined,
    dto: UpdateOrganizationDiscordConfigDto,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    return this.updateForOrganization(actor, organizationId, dto);
  }

  async getForSuperAdmin(
    actor: Actor | null | undefined,
    organizationId: string,
  ) {
    this.assertSuperAdmin(actor);
    const organization = await this.requireOrganization(organizationId);
    return this.toView(organization);
  }

  async listForSuperAdmin(actor: Actor | null | undefined) {
    this.assertSuperAdmin(actor);
    const organizations = await this.prisma.organization.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: organizationSelect,
    });

    return organizations.map((organization) => this.toView(organization));
  }

  async updateForOrganization(
    actor: Actor | null | undefined,
    organizationId: string,
    dto: UpdateOrganizationDiscordConfigDto,
  ) {
    this.assertOrgScopedManager(actor, organizationId);
    await this.requireOrganization(organizationId);

    const data = this.buildPatchData(actor, dto);

    await this.prisma.organizationDiscordConfig.upsert({
      where: { organizationId },
      update: data,
      create: Object.assign({}, data, {
        organizationId,
      }) as Prisma.OrganizationDiscordConfigUncheckedCreateInput,
    });

    const organization = await this.requireOrganization(organizationId);
    return this.toView(organization);
  }
}
