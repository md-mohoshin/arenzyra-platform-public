import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { TeamMemberRole } from '@prisma/client';
import type { Prisma, Team } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth.types';
import type {
  DiscordTeamRegistrationResponse,
  TeamCreateDto,
  TeamListFilters,
  TeamMemberResponse,
  TeamResponse,
  TeamUpdateDto,
} from './dto/team.api.dto';
import { BroadcastGateway } from '../overlay/broadcast.gateway';
import {
  applyTeamListScopeToWhere,
  isLiveMappingTeamName,
  resolveLiveMappingTeamTag,
} from './team-list-scope.util';
import { normalizeAndValidateTeamTag } from '../../common/team-tag.util';
import { RegisterDiscordTeamDto } from './dto/register-discord-team.dto';

type Actor = AuthUser;
type TeamBrandingFields = {
  logoLightUrl?: string | null;
  accentLight?: string | null;
  textOnLight?: string | null;
  logoDarkUrl?: string | null;
  accentDark?: string | null;
  textOnDark?: string | null;
};
type TeamWithBranding = Pick<
  Team,
  'id' | 'organizationId' | 'ownerUserId' | 'updatedAt'
> &
  TeamBrandingFields;

const teamSelect = {
  id: true,
  name: true,
  tag: true,
  gameId: true,
  region: true,
  countryCode: true,
  logoUrl: true,
  organizationId: true,
  ownerUserId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  logoLightUrl: true,
  accentLight: true,
  textOnLight: true,
  logoDarkUrl: true,
  accentDark: true,
  textOnDark: true,
} satisfies Prisma.TeamSelect;

const teamMemberSelect = {
  id: true,
  teamId: true,
  organizationId: true,
  discordUserId: true,
  discordUsername: true,
  displayName: true,
  role: true,
  createdAt: true,
  updatedAt: true,
  leftAt: true,
  deletedAt: true,
} satisfies Prisma.TeamMemberSelect;

@Injectable()
export class TeamsApiService {
  constructor(
    private prisma: PrismaService,
    private readonly broadcast: BroadcastGateway,
  ) {}

  private isUuid(id: string | null | undefined) {
    return typeof id === 'string' && /^[0-9a-fA-F-]{36}$/.test(id);
  }

  private assertUuid(id: string, label = 'id') {
    if (!this.isUuid(id)) throw new BadRequestException(`Invalid ${label}`);
  }

  private canEdit(actor: Actor | null | undefined, ownerUserId: string) {
    if (!actor) return false;
    if (actor.role === 'SUPER_ADMIN' || actor.actorRole === 'SUPER_ADMIN')
      return true;
    const actorId = actor.actorId ?? actor.id;
    return actorId === ownerUserId;
  }

  private actorOrg(actor: Actor | null | undefined): string | null {
    return actor?.actingOrgId ?? actor?.organizationId ?? actor?.orgId ?? null;
  }

  private isSuper(actor: Actor | null | undefined): boolean {
    return actor?.role === 'SUPER_ADMIN' || actor?.actorRole === 'SUPER_ADMIN';
  }

  private canEditTeam(
    actor: Actor | null | undefined,
    team: TeamWithBranding,
  ): boolean {
    if (!actor) return false;
    if (this.isSuper(actor)) return true;
    const actorOrg = this.actorOrg(actor);
    if (actorOrg && team.organizationId === actorOrg) return true;
    const actorId = actor.actorId ?? actor.id;
    return actorId === team.ownerUserId;
  }

  private emitBrand(team: TeamWithBranding | null) {
    if (!team) return;
    const version =
      (team.updatedAt instanceof Date
        ? team.updatedAt.getTime?.()
        : Date.parse(team.updatedAt as unknown as string)) || Date.now();
    this.broadcast.emitTeamBrandUpdated({
      teamId: team.id,
      version,
      light: {
        logoUrl: team.logoLightUrl ?? null,
        accent: team.accentLight ?? null,
        text: team.textOnLight ?? null,
      },
      dark: {
        logoUrl: team.logoDarkUrl ?? null,
        accent: team.accentDark ?? null,
        text: team.textOnDark ?? null,
      },
    });
  }

  async list(actor: Actor, filters: TeamListFilters): Promise<TeamResponse[]> {
    const actorOrg = this.actorOrg(actor);
    const isSuper = this.isSuper(actor);
    const where: Prisma.TeamWhereInput = { deletedAt: null };
    if (!isSuper) {
      if (!actorOrg) {
        throw new ForbiddenException('organizationId is required');
      }
      where.organizationId = actorOrg;
    } else if (filters?.orgId) {
      where.organizationId = filters.orgId;
    }
    if (filters?.search?.trim()) {
      const term = filters.search.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { tag: { contains: term, mode: 'insensitive' } },
        { region: { contains: term, mode: 'insensitive' } },
      ];
    }
    if (filters?.gameId) where.gameId = filters.gameId;
    if (filters?.orgId && !isSuper && actorOrg && filters.orgId !== actorOrg) {
      throw new ForbiddenException('Not allowed to view other organizations');
    }
    if (filters?.region) where.region = filters.region;
    if (
      filters?.excludeTournamentId &&
      this.isUuid(filters.excludeTournamentId)
    ) {
      const assigned = await this.prisma.tournamentTeam.findMany({
        where: {
          tournamentId: filters.excludeTournamentId,
          deletedAt: null,
        },
        select: { teamId: true },
      });
      const assignedIds = assigned.map((a) => a.teamId).filter(Boolean);
      if (assignedIds.length) {
        where.id = { notIn: assignedIds };
      }
    }

    const scopedWhere = applyTeamListScopeToWhere(where, filters?.scope);

    const teams = await this.prisma.team.findMany({
      where: scopedWhere,
      orderBy: { createdAt: 'desc' },
      select: teamSelect,
    });

    if (!teams.length) {
      return teams;
    }

    const playerCounts = await this.prisma.player.groupBy({
      by: ['teamId'],
      where: {
        teamId: { in: teams.map((team) => team.id) },
        deletedAt: null,
      },
      _count: {
        _all: true,
      },
    });

    const activePlayersByTeamId = new Map(
      playerCounts
        .filter(
          (entry): entry is typeof entry & { teamId: string } =>
            typeof entry.teamId === 'string',
        )
        .map((entry) => [entry.teamId, entry._count._all]),
    );

    return teams.map((team) => ({
      ...team,
      tag: resolveLiveMappingTeamTag(team.name, team.tag),
      isLiveMapping: isLiveMappingTeamName(team.name),
      _count: {
        players: activePlayersByTeamId.get(team.id) ?? 0,
      },
    }));
  }

  async create(actor: Actor, dto: TeamCreateDto): Promise<TeamResponse> {
    if (!dto?.name?.trim()) throw new BadRequestException('name is required');
    const actorOrg = this.actorOrg(actor);
    const isSuper = this.isSuper(actor);
    const orgId = dto?.organizationId ?? actorOrg;
    if (!orgId) {
      throw new BadRequestException('organizationId is required');
    }
    if (!isSuper && actorOrg && orgId !== actorOrg) {
      throw new ForbiddenException('Cannot create teams for another org');
    }
    const ownerUserId = actor?.actorId ?? actor?.actingAsUserId ?? actor?.id;
    if (!ownerUserId)
      throw new BadRequestException('ownerUserId could not be resolved');
    const tagResult = normalizeAndValidateTeamTag(dto.tag);
    if (tagResult.error) {
      throw new BadRequestException(tagResult.error);
    }

    const data: Prisma.TeamCreateInput = {
      name: dto.name.trim(),
      tag: tagResult.normalized,
      region: dto.region ?? null,
      countryCode: dto.countryCode ?? null,
      logoUrl: dto.logoUrl ?? null,
      logoLightUrl: dto.logoLightUrl ?? null,
      accentLight: dto.accentLight ?? null,
      textOnLight: dto.textOnLight ?? null,
      logoDarkUrl: dto.logoDarkUrl ?? null,
      accentDark: dto.accentDark ?? null,
      textOnDark: dto.textOnDark ?? null,
      organization: { connect: { id: orgId } },
      ownerUserId,
    };
    if (dto.gameId) data.game = { connect: { id: dto.gameId } };

    return this.prisma.team.create({
      data,
      select: teamSelect,
    });
  }

  async update(
    actor: Actor,
    teamId: string,
    dto: TeamUpdateDto,
  ): Promise<TeamResponse> {
    this.assertUuid(teamId, 'teamId');
    const existing = await this.prisma.team.findFirst({
      where: { id: teamId, deletedAt: null },
      select: teamSelect,
    });
    if (!existing) throw new NotFoundException('Team not found');
    if (!this.canEditTeam(actor, existing as TeamWithBranding))
      throw new NotFoundException('Team not found');

    const data: Prisma.TeamUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name?.trim();
    if (dto.tag !== undefined) {
      const tagResult = normalizeAndValidateTeamTag(dto.tag);
      if (tagResult.error) {
        throw new BadRequestException(tagResult.error);
      }
      data.tag = tagResult.normalized;
    }
    if (dto.gameId !== undefined) {
      data.game = dto.gameId
        ? { connect: { id: dto.gameId } }
        : { disconnect: true };
    }
    if (dto.region !== undefined) data.region = dto.region;
    if (dto.countryCode !== undefined) data.countryCode = dto.countryCode;
    if (dto.logoUrl !== undefined) data.logoUrl = dto.logoUrl;
    if (dto.logoLightUrl !== undefined) data.logoLightUrl = dto.logoLightUrl;
    if (dto.accentLight !== undefined) data.accentLight = dto.accentLight;
    if (dto.textOnLight !== undefined) data.textOnLight = dto.textOnLight;
    if (dto.logoDarkUrl !== undefined) data.logoDarkUrl = dto.logoDarkUrl;
    if (dto.accentDark !== undefined) data.accentDark = dto.accentDark;
    if (dto.textOnDark !== undefined) data.textOnDark = dto.textOnDark;

    const brandTouched =
      dto.logoLightUrl !== undefined ||
      dto.logoDarkUrl !== undefined ||
      dto.accentLight !== undefined ||
      dto.accentDark !== undefined ||
      dto.textOnLight !== undefined ||
      dto.textOnDark !== undefined;

    const updated = await this.prisma.team.update({
      where: { id: teamId },
      data,
      select: teamSelect,
    });

    if (brandTouched) {
      this.emitBrand(updated as TeamWithBranding);
    }
    return updated;
  }

  async softDelete(actor: Actor, teamId: string): Promise<{ ok: true }> {
    this.assertUuid(teamId, 'teamId');
    const existing = await this.prisma.team.findFirst({
      where: { id: teamId, deletedAt: null },
      select: { id: true, ownerUserId: true, organizationId: true },
    });
    if (!existing) throw new NotFoundException('Team not found');
    if (!this.canEditTeam(actor, existing as TeamWithBranding))
      throw new NotFoundException('Team not found');

    await this.prisma.team.update({
      where: { id: teamId },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  async getByTag(
    actor: Actor,
    rawTag: string,
    orgIdOverride?: string | null,
  ): Promise<TeamResponse> {
    const actorOrg = orgIdOverride ?? this.actorOrg(actor);
    if (!actorOrg) {
      throw new ForbiddenException('organizationId is required');
    }
    const tagResult = normalizeAndValidateTeamTag(rawTag);
    if (tagResult.error) {
      throw new BadRequestException(tagResult.error);
    }
    if (!tagResult.normalized) {
      throw new BadRequestException('tag is required');
    }

    const team = await this.prisma.team.findFirst({
      where: {
        organizationId: actorOrg,
        tag: tagResult.normalized,
        deletedAt: null,
      },
      select: teamSelect,
    });
    if (!team) {
      throw new NotFoundException('Team not found');
    }
    return team;
  }

  async listMembers(
    actor: Actor,
    teamId: string,
    orgIdOverride?: string | null,
  ): Promise<TeamMemberResponse[]> {
    this.assertUuid(teamId, 'teamId');
    const actorOrg = orgIdOverride ?? this.actorOrg(actor);
    const team = await this.prisma.team.findFirst({
      where: {
        id: teamId,
        deletedAt: null,
        ...(this.isSuper(actor)
          ? {}
          : { organizationId: actorOrg ?? undefined }),
      },
      select: {
        id: true,
        organizationId: true,
      },
    });
    if (!team) {
      throw new NotFoundException('Team not found');
    }

    return this.prisma.teamMember.findMany({
      where: {
        teamId: team.id,
        deletedAt: null,
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: teamMemberSelect,
    });
  }

  async registerDiscordTeam(
    actor: Actor,
    dto: RegisterDiscordTeamDto,
    orgIdOverride?: string | null,
  ): Promise<DiscordTeamRegistrationResponse> {
    const actorOrg = orgIdOverride ?? this.actorOrg(actor);
    if (!actorOrg) {
      throw new ForbiddenException('organizationId is required');
    }
    const normalizedName = dto.name.trim();
    if (!normalizedName) {
      throw new BadRequestException('name is required');
    }
    const tagResult = normalizeAndValidateTeamTag(dto.tag);
    if (tagResult.error) {
      throw new BadRequestException(tagResult.error);
    }
    if (!tagResult.normalized) {
      throw new BadRequestException('tag is required');
    }

    const ownerUserId = actor?.actorId ?? actor?.actingAsUserId ?? actor?.id;
    if (!ownerUserId) {
      throw new BadRequestException('ownerUserId could not be resolved');
    }

    const leaderUserId = dto.leaderDiscordUserId.trim();
    const memberInputs = (dto.members ?? [])
      .map((member) => ({
        discordUserId: member.discordUserId.trim(),
        discordUsername: member.discordUsername?.trim() || null,
        displayName: member.displayName?.trim() || null,
      }))
      .filter((member) => member.discordUserId.length > 0);

    const dedupedMembers = Array.from(
      new Map(
        memberInputs
          .filter((member) => member.discordUserId !== leaderUserId)
          .map((member) => [member.discordUserId, member]),
      ).values(),
    );

    const registration = await this.prisma.$transaction(async (tx) => {
      let created = false;
      let team = await tx.team.findFirst({
        where: {
          organizationId: actorOrg,
          tag: tagResult.normalized,
          deletedAt: null,
        },
        select: teamSelect,
      });

      if (!team) {
        created = true;
        team = await tx.team.create({
          data: {
            name: normalizedName,
            tag: tagResult.normalized,
            organizationId: actorOrg,
            ownerUserId,
          },
          select: teamSelect,
        });
      }

      const activeLeader = await tx.teamMember.findFirst({
        where: {
          teamId: team.id,
          role: TeamMemberRole.LEADER,
          deletedAt: null,
          leftAt: null,
        },
        select: teamMemberSelect,
      });

      if (activeLeader && activeLeader.discordUserId !== leaderUserId) {
        throw new BadRequestException(
          `Team ${tagResult.normalized} is already registered to another leader`,
        );
      }

      const allDiscordUserIds = [
        leaderUserId,
        ...dedupedMembers.map((member) => member.discordUserId),
      ];
      const conflictingMembers = await tx.teamMember.findMany({
        where: {
          organizationId: actorOrg,
          discordUserId: { in: allDiscordUserIds },
          deletedAt: null,
          leftAt: null,
          NOT: { teamId: team.id },
        },
        select: {
          discordUserId: true,
          team: {
            select: {
              id: true,
              tag: true,
              name: true,
            },
          },
        },
      });

      if (conflictingMembers.length > 0) {
        const conflict = conflictingMembers[0];
        const teamLabel =
          conflict.team?.tag ||
          conflict.team?.name ||
          conflict.team?.id ||
          'another team';
        throw new BadRequestException(
          `Discord user ${conflict.discordUserId} already belongs to ${teamLabel}`,
        );
      }

      await tx.teamMember.upsert({
        where: {
          teamId_discordUserId: {
            teamId: team.id,
            discordUserId: leaderUserId,
          },
        },
        update: {
          discordUsername: dto.leaderDiscordUsername?.trim() || null,
          displayName: dto.leaderDisplayName?.trim() || null,
          role: TeamMemberRole.LEADER,
          leftAt: null,
          deletedAt: null,
        },
        create: {
          organizationId: actorOrg,
          teamId: team.id,
          discordUserId: leaderUserId,
          discordUsername: dto.leaderDiscordUsername?.trim() || null,
          displayName: dto.leaderDisplayName?.trim() || null,
          role: TeamMemberRole.LEADER,
        },
      });

      for (const member of dedupedMembers) {
        await tx.teamMember.upsert({
          where: {
            teamId_discordUserId: {
              teamId: team.id,
              discordUserId: member.discordUserId,
            },
          },
          update: {
            discordUsername: member.discordUsername,
            displayName: member.displayName,
            role: TeamMemberRole.PLAYER,
            leftAt: null,
            deletedAt: null,
          },
          create: {
            organizationId: actorOrg,
            teamId: team.id,
            discordUserId: member.discordUserId,
            discordUsername: member.discordUsername,
            displayName: member.displayName,
            role: TeamMemberRole.PLAYER,
          },
        });
      }

      const members = await tx.teamMember.findMany({
        where: {
          teamId: team.id,
          deletedAt: null,
        },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
        select: teamMemberSelect,
      });

      return {
        created,
        team,
        members,
      };
    });

    return registration;
  }
}
