import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { SessionRegistrationStatus, TeamMemberRole } from '@prisma/client';
import type { Prisma, Team } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth.types';
import type {
  DiscordTeamCleanupResponse,
  DiscordTeamMemberReleaseResponse,
  DiscordTeamRegistrationResponse,
  DiscordManagedTeamResponse,
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

const DEFAULT_MAX_TEAMS_PER_MANAGER = 1;

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

  private normalizedMaxTeamsPerManager(value: number | null | undefined) {
    if (!Number.isFinite(value)) {
      return DEFAULT_MAX_TEAMS_PER_MANAGER;
    }
    return Math.max(1, Math.trunc(value ?? DEFAULT_MAX_TEAMS_PER_MANAGER));
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

  private async assertDiscordManagersNotBanned(
    tx: Prisma.TransactionClient,
    organizationId: string,
    discordUserIds: string[],
    contextSessionId?: string | null,
  ) {
    const uniqueIds = [
      ...new Set(discordUserIds.map((id) => id.trim())),
    ].filter((id) => /^\d{15,25}$/.test(id));
    if (!uniqueIds.length) {
      return;
    }

    const activeBan = await tx.managerBan.findFirst({
      where: {
        organizationId,
        discordUserId: { in: uniqueIds },
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        scope: { in: ['TEAM', 'SESSION'] },
        AND: [
          {
            OR: [
              { scope: 'TEAM' },
              ...(contextSessionId
                ? [{ scope: 'SESSION' as const, sessionId: contextSessionId }]
                : []),
            ],
          },
        ],
      },
      select: {
        discordUserId: true,
        displayName: true,
        discordUsername: true,
        scope: true,
        reason: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!activeBan) {
      return;
    }

    const label =
      activeBan.displayName?.trim() ||
      activeBan.discordUsername?.trim() ||
      activeBan.discordUserId;
    throw new ForbiddenException(
      activeBan.scope === 'SESSION'
        ? `Manager is banned from this scrim: ${label} - ${activeBan.reason}`
        : `Manager is banned from Discord scrims: ${label} - ${activeBan.reason}`,
    );
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

  async listDiscordManagedTeams(
    actor: Actor,
    organizationId: string,
    discordUserIds: string[],
    limit = 500,
  ): Promise<DiscordManagedTeamResponse[]> {
    const actorOrg = this.actorOrg(actor);
    if (!this.isSuper(actor) && actorOrg && actorOrg !== organizationId) {
      throw new ForbiddenException('Not allowed to view other organizations');
    }
    const uniqueDiscordUserIds = [
      ...new Set(
        discordUserIds
          .map((id) => id?.trim())
          .filter((id): id is string => /^\d{15,25}$/.test(id)),
      ),
    ].slice(0, 500);
    const safeLimit = Math.min(1000, Math.max(1, Math.trunc(limit || 500)));

    const teams = await this.prisma.team.findMany({
      where: {
        organizationId,
        deletedAt: null,
        members: {
          some: {
            ...(uniqueDiscordUserIds.length
              ? { discordUserId: { in: uniqueDiscordUserIds } }
              : {}),
            role: TeamMemberRole.LEADER,
            deletedAt: null,
            leftAt: null,
          },
        },
      },
      select: {
        ...teamSelect,
        members: {
          where: {
            ...(uniqueDiscordUserIds.length
              ? { discordUserId: { in: uniqueDiscordUserIds } }
              : {}),
            role: TeamMemberRole.LEADER,
            deletedAt: null,
            leftAt: null,
          },
          orderBy: [{ createdAt: 'asc' }, { discordUserId: 'asc' }],
          select: teamMemberSelect,
        },
      },
      orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
      take: safeLimit,
    });

    return teams
      .filter((team) => team.members.length > 0)
      .map(({ members, ...team }) => ({
        team: {
          ...team,
          tag: resolveLiveMappingTeamTag(team.name, team.tag),
          isLiveMapping: isLiveMappingTeamName(team.name),
        },
        managers: members,
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

    await this.assertNoActiveSessionRegistrationForTeam(
      teamId,
      existing.organizationId,
    );

    await this.prisma.team.update({
      where: { id: teamId },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  async cleanupDiscordTeam(
    actor: Actor,
    teamId: string,
    orgIdOverride?: string | null,
  ): Promise<DiscordTeamCleanupResponse> {
    this.assertUuid(teamId, 'teamId');
    const actorOrg = orgIdOverride ?? this.actorOrg(actor);
    if (!actorOrg && !this.isSuper(actor)) {
      throw new ForbiddenException('organizationId is required');
    }

    const existing = await this.prisma.team.findFirst({
      where: {
        id: teamId,
        deletedAt: null,
        ...(actorOrg ? { organizationId: actorOrg } : {}),
      },
      select: { id: true, ownerUserId: true, organizationId: true },
    });
    if (!existing) throw new NotFoundException('Team not found');
    if (!this.canEditTeam(actor, existing as TeamWithBranding)) {
      throw new NotFoundException('Team not found');
    }

    const now = new Date();
    const releasedMembers = await this.prisma.$transaction(async (tx) => {
      await this.assertNoActiveSessionRegistrationForTeam(
        teamId,
        existing.organizationId,
        tx,
      );

      const updatedMembers = await tx.teamMember.updateMany({
        where: {
          teamId,
          organizationId: existing.organizationId,
          deletedAt: null,
          leftAt: null,
        },
        data: {
          leftAt: now,
          deletedAt: now,
        },
      });

      await tx.team.update({
        where: { id: teamId },
        data: { deletedAt: now },
      });

      return updatedMembers.count;
    });

    return { ok: true, teamId, releasedMembers };
  }

  private async assertNoActiveSessionRegistrationForTeam(
    teamId: string,
    organizationId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const activeRegistration = await client.sessionRegistration.findFirst({
      where: {
        teamId,
        organizationId,
        deletedAt: null,
        status: {
          notIn: [
            SessionRegistrationStatus.REMOVED,
            SessionRegistrationStatus.DECLINED,
          ],
        },
      },
      select: { id: true },
    });

    if (activeRegistration) {
      throw new BadRequestException(
        'Team has an active session registration. Remove it from the session before deleting the team.',
      );
    }
  }

  async releaseDiscordTeamMember(
    actor: Actor,
    teamId: string,
    discordUserId: string,
    orgIdOverride?: string | null,
  ): Promise<DiscordTeamMemberReleaseResponse> {
    this.assertUuid(teamId, 'teamId');
    const cleanDiscordUserId = discordUserId?.trim();
    if (!cleanDiscordUserId) {
      throw new BadRequestException('discordUserId is required');
    }
    const actorOrg = orgIdOverride ?? this.actorOrg(actor);
    if (!actorOrg && !this.isSuper(actor)) {
      throw new ForbiddenException('organizationId is required');
    }

    const existing = await this.prisma.team.findFirst({
      where: {
        id: teamId,
        deletedAt: null,
        ...(actorOrg ? { organizationId: actorOrg } : {}),
      },
      select: { id: true, ownerUserId: true, organizationId: true },
    });
    if (!existing) throw new NotFoundException('Team not found');
    if (!this.canEditTeam(actor, existing as TeamWithBranding)) {
      throw new NotFoundException('Team not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const activeMembers = await tx.teamMember.findMany({
        where: {
          teamId,
          organizationId: existing.organizationId,
          deletedAt: null,
          leftAt: null,
        },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
        select: teamMemberSelect,
      });
      const target = activeMembers.find(
        (member) => member.discordUserId === cleanDiscordUserId,
      );
      if (!target) {
        throw new NotFoundException('Discord team member not found');
      }
      if (activeMembers.length <= 1) {
        throw new BadRequestException('Cannot remove the last team manager');
      }

      const now = new Date();
      const removedMember = await tx.teamMember.update({
        where: { id: target.id },
        data: {
          leftAt: now,
          deletedAt: now,
        },
        select: teamMemberSelect,
      });

      let promotedMember: TeamMemberResponse | null = null;
      if (target.role === TeamMemberRole.LEADER) {
        const remainingMembers = activeMembers.filter(
          (member) => member.id !== target.id,
        );
        const hasLeader = remainingMembers.some(
          (member) => member.role === TeamMemberRole.LEADER,
        );
        const promote = hasLeader ? null : remainingMembers[0];
        if (promote) {
          promotedMember = await tx.teamMember.update({
            where: { id: promote.id },
            data: { role: TeamMemberRole.LEADER },
            select: teamMemberSelect,
          });
        }
      }

      return {
        ok: true,
        teamId,
        removedMember,
        promotedMember,
      };
    });
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

    const teams = await this.prisma.team.findMany({
      where: {
        organizationId: actorOrg,
        tag: { equals: tagResult.normalized, mode: 'insensitive' },
        deletedAt: null,
      },
      select: teamSelect,
    });
    if (teams.length > 1) {
      throw new BadRequestException(
        'Multiple teams share this tag. Use the exact team name.',
      );
    }
    const team = teams[0] ?? null;
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
    const logoUrl = dto.logoUrl?.trim() || null;

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
        role:
          member.role === TeamMemberRole.LEADER
            ? TeamMemberRole.LEADER
            : TeamMemberRole.PLAYER,
      }))
      .filter((member) => member.discordUserId.length > 0);

    const dedupedMembers = Array.from(
      new Map(
        memberInputs
          .filter((member) => member.discordUserId !== leaderUserId)
          .map((member) => [member.discordUserId, member]),
      ).values(),
    );
    const requestedManagerIds = [
      ...new Set(
        memberInputs
          .filter((member) => member.role === TeamMemberRole.LEADER)
          .map((member) => member.discordUserId),
      ),
    ];
    const currentManagerIds = requestedManagerIds.length
      ? requestedManagerIds
      : [leaderUserId];
    const currentManagerIdSet = new Set(currentManagerIds);
    const memberInputByDiscordId = new Map(
      memberInputs.map((member) => [member.discordUserId, member]),
    );
    const participantMemberIds = [
      ...new Set(
        memberInputs
          .filter(
            (member) =>
              member.role !== TeamMemberRole.LEADER &&
              !currentManagerIdSet.has(member.discordUserId),
          )
          .map((member) => member.discordUserId),
      ),
    ];

    const registration = await this.prisma.$transaction(async (tx) => {
      let created = false;
      let team = await tx.team.findFirst({
        where: {
          organizationId: actorOrg,
          name: { equals: normalizedName, mode: 'insensitive' },
          tag: { equals: tagResult.normalized, mode: 'insensitive' },
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
            logoUrl,
          },
          select: teamSelect,
        });
      } else if (logoUrl) {
        team = await tx.team.update({
          where: { id: team.id },
          data: { logoUrl },
          select: teamSelect,
        });
      }

      const existingContextRegistration =
        dto.contextSessionId && team
          ? await tx.sessionRegistration.findFirst({
              where: {
                organizationId: actorOrg,
                sessionId: dto.contextSessionId,
                teamId: team.id,
                deletedAt: null,
                status: {
                  notIn: [
                    SessionRegistrationStatus.REMOVED,
                    SessionRegistrationStatus.DECLINED,
                  ],
                },
              },
              select: { id: true },
            })
          : null;
      const replaceCurrentTeamManagers =
        Boolean(dto.allowDiscordMemberTransfer && dto.contextSessionId) &&
        !existingContextRegistration;
      const allDiscordUserIds = [
        ...new Set([...currentManagerIds, ...participantMemberIds]),
      ];
      await this.assertDiscordManagersNotBanned(
        tx,
        actorOrg,
        allDiscordUserIds,
        dto.contextSessionId,
      );
      const conflictingMembers = await tx.teamMember.findMany({
        where: {
          organizationId: actorOrg,
          discordUserId: { in: allDiscordUserIds },
          deletedAt: null,
          leftAt: null,
          NOT: { teamId: team.id },
          team: { deletedAt: null },
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

      if (
        conflictingMembers.length > 0 &&
        dto.allowDiscordMemberTransfer &&
        dto.contextSessionId
      ) {
        const contextSession = await tx.session.findFirst({
          where: {
            id: dto.contextSessionId,
            organizationId: actorOrg,
            deletedAt: null,
          },
          select: {
            id: true,
            discordConfig: {
              select: {
                maxTeamsPerManager: true,
              },
            },
          },
        });
        if (!contextSession) {
          throw new BadRequestException('context session not found');
        }
        const maxTeamsPerManager = this.normalizedMaxTeamsPerManager(
          contextSession.discordConfig?.maxTeamsPerManager,
        );

        const conflictingTeamIds = conflictingMembers
          .map((member) => member.team?.id)
          .filter((teamId): teamId is string => Boolean(teamId));
        const activeRegistrationConflicts =
          conflictingTeamIds.length > 0
            ? await tx.sessionRegistration.findMany({
                where: {
                  organizationId: actorOrg,
                  teamId: { in: conflictingTeamIds },
                  deletedAt: null,
                  team: { deletedAt: null },
                  status: {
                    notIn: [
                      SessionRegistrationStatus.REMOVED,
                      SessionRegistrationStatus.DECLINED,
                    ],
                  },
                },
                select: { teamId: true, sessionId: true },
              })
            : [];
        const activeSessionConflicts = activeRegistrationConflicts.filter(
          (registration) => registration.sessionId === contextSession.id,
        );
        const activeSessionConflictTeamIds = new Set(
          activeSessionConflicts.map((registration) => registration.teamId),
        );
        const protectedSessionTeamIds = new Set(
          activeRegistrationConflicts.map(
            (registration) => registration.teamId,
          ),
        );
        const tournamentTeamConflicts =
          conflictingTeamIds.length > 0
            ? await tx.tournamentTeam.findMany({
                where: {
                  teamId: { in: conflictingTeamIds },
                  deletedAt: null,
                },
                select: { teamId: true },
              })
            : [];
        const protectedTournamentTeamIds = new Set(
          tournamentTeamConflicts.map((entry) => entry.teamId),
        );

        if (activeSessionConflicts.length > 0) {
          for (const discordUserId of allDiscordUserIds) {
            const activeTeamIdsForUser = new Set(
              conflictingMembers
                .filter(
                  (member) =>
                    member.discordUserId === discordUserId &&
                    member.team?.id &&
                    activeSessionConflictTeamIds.has(member.team.id),
                )
                .map((member) => member.team?.id)
                .filter((teamId): teamId is string => Boolean(teamId)),
            );
            if (activeTeamIdsForUser.size + 1 <= maxTeamsPerManager) {
              continue;
            }

            const conflict = conflictingMembers.find(
              (member) =>
                member.discordUserId === discordUserId &&
                member.team?.id &&
                activeSessionConflictTeamIds.has(member.team.id),
            );
            const teamLabel =
              conflict?.team?.tag ||
              conflict?.team?.name ||
              conflict?.team?.id ||
              'another team';
            throw new BadRequestException(
              `Discord user ${discordUserId} already belongs to ${teamLabel}`,
            );
          }
        }

        const removableConflictTeamIds = conflictingTeamIds.filter(
          (teamId) =>
            !protectedSessionTeamIds.has(teamId) &&
            !protectedTournamentTeamIds.has(teamId),
        );

        if (removableConflictTeamIds.length > 0) {
          await tx.teamMember.updateMany({
            where: {
              organizationId: actorOrg,
              discordUserId: { in: allDiscordUserIds },
              teamId: { in: removableConflictTeamIds },
              deletedAt: null,
              leftAt: null,
              NOT: { teamId: team.id },
            },
            data: {
              leftAt: new Date(),
              deletedAt: new Date(),
            },
          });
        }
      } else if (conflictingMembers.length > 0) {
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

      if (replaceCurrentTeamManagers) {
        await tx.teamMember.updateMany({
          where: {
            organizationId: actorOrg,
            teamId: team.id,
            role: TeamMemberRole.LEADER,
            deletedAt: null,
            leftAt: null,
            discordUserId: { notIn: currentManagerIds },
          },
          data: {
            leftAt: new Date(),
            deletedAt: new Date(),
          },
        });
      }

      for (const discordUserId of currentManagerIds) {
        const member = memberInputByDiscordId.get(discordUserId);
        await tx.teamMember.upsert({
          where: {
            teamId_discordUserId: {
              teamId: team.id,
              discordUserId,
            },
          },
          update: {
            discordUsername:
              member?.discordUsername ??
              (discordUserId === leaderUserId
                ? dto.leaderDiscordUsername?.trim() || null
                : null),
            displayName:
              member?.displayName ??
              (discordUserId === leaderUserId
                ? dto.leaderDisplayName?.trim() || null
                : null),
            role: TeamMemberRole.LEADER,
            leftAt: null,
            deletedAt: null,
          },
          create: {
            organizationId: actorOrg,
            teamId: team.id,
            discordUserId,
            discordUsername:
              member?.discordUsername ??
              (discordUserId === leaderUserId
                ? dto.leaderDiscordUsername?.trim() || null
                : null),
            displayName:
              member?.displayName ??
              (discordUserId === leaderUserId
                ? dto.leaderDisplayName?.trim() || null
                : null),
            role: TeamMemberRole.LEADER,
          },
        });
      }

      for (const member of dedupedMembers) {
        if (currentManagerIdSet.has(member.discordUserId)) {
          continue;
        }
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
            role: member.role,
            leftAt: null,
            deletedAt: null,
          },
          create: {
            organizationId: actorOrg,
            teamId: team.id,
            discordUserId: member.discordUserId,
            discordUsername: member.discordUsername,
            displayName: member.displayName,
            role: member.role,
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
