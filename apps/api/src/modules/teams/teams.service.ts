import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { OrganizationStatus, Role, PlayerSource } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import type { AuthUser } from '../../common/auth/auth.types';
import type { Prisma, Team, Player } from '@prisma/client';
import {
  effectiveOrganizationId,
  requireOrgMatch,
} from '../../common/org/org.util';
import { BroadcastGateway } from '../overlay/broadcast.gateway';
import {
  resolveTeamLogo,
  type OrgBrandingDefaults,
} from '../../common/media-resolver';
import { applyTeamListScopeToWhere } from './team-list-scope.util';
import {
  assertTeamRosterWriteAllowed,
  getTeamTournamentRosterPolicy,
} from '../../common/tournament-roster-policy';
import { normalizeAndValidateTeamTag } from '../../common/team-tag.util';

type Actor = AuthUser;
type TeamWithTags = Prisma.TeamGetPayload<{
  include: { tags: { include: { tag: true } } };
}>;
type RosterEntryWithPlayer = Prisma.RosterEntryGetPayload<{
  include: { player: true };
}>;
type TeamMinimal = Prisma.TeamGetPayload<{
  select: { id: true; organizationId: true; ownerUserId: true };
}>;
type TeamBrandingFields = {
  logoLightUrl?: string | null;
  accentLight?: string | null;
  textOnLight?: string | null;
  logoDarkUrl?: string | null;
  accentDark?: string | null;
  textOnDark?: string | null;
};
type TeamWithBranding = Team & TeamBrandingFields;

export interface TeamCreateBody {
  name?: string;
  tag?: string | null;
  logoUrl?: string | null;
  logoLightUrl?: string | null;
  accentLight?: string | null;
  textOnLight?: string | null;
  logoDarkUrl?: string | null;
  accentDark?: string | null;
  textOnDark?: string | null;
  country?: string | null;
  organizationId?: string | null;
}

export type TeamUpdateBody = Partial<TeamCreateBody>;

export interface TeamPlayerBody {
  ign?: string;
  name?: string | null;
  realName?: string | null;
  role?: string | null;
  photoUrl?: string | null;
  country?: string | null;
  pubgPlayerId?: string | null;
  inGameId?: string | null;
  teamId?: string;
  isActive?: boolean;
  source?: PlayerSource | null;
  externalSource?: string | null;
  externalId?: string | null;
}

@Injectable()
export class TeamsService {
  private schemaChecked = false;
  private schemaValid = true;

  constructor(
    private prisma: PrismaService,
    private readonly broadcast: BroadcastGateway,
  ) {}

  private async ensureSchema(): Promise<boolean> {
    if (this.schemaChecked) return this.schemaValid;
    this.schemaChecked = true;
    try {
      const rows = await this.prisma.$queryRaw<Array<{ column_name: string }>>`
          select column_name
          from information_schema.columns
          where table_name = 'team'
            and column_name in ('owneruserid', 'deletedat')
        `;
      const cols = new Set(rows.map((r) => r.column_name.toLowerCase()));
      const valid = cols.has('owneruserid') && cols.has('deletedat');
      if (!valid) {
        console.warn(
          '[TeamsService] Database schema missing expected columns (ownerUserId/deletedAt). Run migrations to fix. Continuing without schema guard.',
        );
      }
      this.schemaValid = true; // never block flows
    } catch (err) {
      console.warn('[TeamsService] Schema check failed', err);
      this.schemaValid = true; // don't block flows if check fails
    }
    return this.schemaValid;
  }

  private canEdit(actor: Actor | null | undefined, ownerUserId: string) {
    if (!actor) return false;
    if (actor.role === Role.SUPER_ADMIN || actor.actorRole === Role.SUPER_ADMIN)
      return true;
    const actorId = actor.actorId ?? actor.id;
    return actorId === ownerUserId;
  }

  private emitBrandUpdate(team?: TeamWithBranding | null) {
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

  private async getBrandingDefaults(
    organizationId: string,
  ): Promise<OrgBrandingDefaults | null> {
    return this.prisma.organizationBranding.findUnique({
      where: { organizationId },
      select: {
        defaultTeamLogoUrl: true,
        defaultPlayerPhotoUrl: false,
      },
    }) as Promise<OrgBrandingDefaults | null>;
  }

  private async getDefaultOrgId(): Promise<string | null> {
    const existing = await this.prisma.organization.findFirst({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (existing?.id) return existing.id;

    const created = await this.prisma.organization.upsert({
      where: { slug: 'global-control' },
      update: { deletedAt: null },
      create: {
        name: 'Global Control',
        slug: 'global-control',
        status: OrganizationStatus.APPROVED,
      },
      select: { id: true },
    });
    return created.id;
  }

  async list(
    actor: Actor,
    orgIdOverride?: string | null,
    search?: string,
    scope?: 'manual' | 'live-mapping' | 'all',
  ): Promise<TeamWithTags[]> {
    void this.ensureSchema(); // log-only; avoid blocking on schema drift
    const isSuper =
      actor?.role === Role.SUPER_ADMIN || actor?.actorRole === Role.SUPER_ADMIN;
    const orgId = orgIdOverride ?? effectiveOrganizationId(actor);
    if (!orgId) {
      throw new ForbiddenException('Organization context required');
    }
    if (!isSuper) {
      requireOrgMatch(actor, orgId);
    }
    const where: Prisma.TeamWhereInput = {
      deletedAt: null,
      organizationId: orgId,
    };
    const actorId = actor?.actorId ?? actor?.id;
    if (!isSuper) where.ownerUserId = actorId;
    if (search?.trim()) {
      const term = search.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { tag: { contains: term, mode: 'insensitive' } },
      ];
    }
    const branding = await this.getBrandingDefaults(orgId);
    const mapLogo = (teams: TeamWithTags[]) =>
      teams.map((t) => ({
        ...t,
        logoUrl: resolveTeamLogo(t.logoUrl, branding),
      }));
    const scopedWhere = applyTeamListScopeToWhere(where, scope);

    try {
      const teams = await this.prisma.team.findMany({
        where: scopedWhere,
        orderBy: { createdAt: 'desc' },
        include: { tags: { include: { tag: true } } },
      });
      return mapLogo(teams);
    } catch (err) {
      console.warn('[TeamsService] list fallback due to schema mismatch', err);
      const teams = await this.prisma.team.findMany({
        where: applyTeamListScopeToWhere({}, scope),
        orderBy: { createdAt: 'desc' },
        include: { tags: { include: { tag: true } } },
      });
      return mapLogo(teams);
    }
  }

  async checkName(
    actor: Actor,
    name: string,
    orgIdOverride?: string | null,
  ): Promise<{ available: boolean; reason?: string }> {
    const orgId = orgIdOverride ?? effectiveOrganizationId(actor);
    if (!orgId) {
      throw new ForbiddenException('Organization context required');
    }
    const isSuper =
      actor?.role === Role.SUPER_ADMIN || actor?.actorRole === Role.SUPER_ADMIN;
    if (!isSuper) {
      requireOrgMatch(actor, orgId);
    }
    const actorId = actor?.actorId ?? actor?.id;
    const trimmed = name?.trim();
    if (!trimmed) {
      return { available: false, reason: 'empty' };
    }
    const existing = await this.prisma.team.findFirst({
      where: {
        name: { equals: trimmed, mode: 'insensitive' },
        deletedAt: null,
        organizationId: orgId,
        ...(isSuper ? {} : { ownerUserId: actorId }),
      },
    });
    return { available: !existing };
  }

  async get(
    actor: Actor,
    teamId: string,
  ): Promise<Team & { liveLocked: boolean }> {
    const isSuper =
      actor?.role === Role.SUPER_ADMIN || actor?.actorRole === Role.SUPER_ADMIN;
    const team = await this.prisma.team.findFirst({
      where: {
        id: teamId,
        deletedAt: null,
        ...(isSuper
          ? {}
          : { organizationId: effectiveOrganizationId(actor) ?? undefined }),
      },
    });
    if (!team) throw new NotFoundException('Team not found');
    if (!isSuper) {
      requireOrgMatch(actor, team.organizationId);
    }
    if (!this.canEdit(actor, team.ownerUserId)) {
      throw new NotFoundException('Team not found');
    }
    const rosterPolicy = await getTeamTournamentRosterPolicy(
      this.prisma,
      team.id,
    );
    return { ...team, liveLocked: rosterPolicy.restricted };
  }

  async create(
    actor: Actor,
    body: TeamCreateBody,
    orgIdOverride?: string | null,
  ): Promise<TeamWithTags> {
    if (!body?.name) throw new BadRequestException('name is required');

    const ownerUserId = actor?.actorId ?? actor?.actingAsUserId ?? actor?.id;
    if (!ownerUserId) {
      throw new BadRequestException('Missing actor for ownership');
    }
    const tagResult = normalizeAndValidateTeamTag(body?.tag);
    if (tagResult.error) {
      throw new BadRequestException(tagResult.error);
    }
    let orgId =
      body.organizationId ?? orgIdOverride ?? effectiveOrganizationId(actor);
    if (!orgId) {
      orgId = await this.getDefaultOrgId();
    }
    if (!orgId) {
      throw new BadRequestException('organizationId is required');
    }
    requireOrgMatch(actor, orgId);

    const branding = await this.getBrandingDefaults(orgId);
    const resolvedLogo = resolveTeamLogo(body?.logoUrl ?? null, branding);

    const created = await this.prisma.team.create({
      data: {
        name: body.name.trim(),
        tag: tagResult.normalized,
        logoUrl: resolvedLogo,
        logoLightUrl: body?.logoLightUrl ?? null,
        accentLight: body?.accentLight ?? null,
        textOnLight: body?.textOnLight ?? null,
        logoDarkUrl: body?.logoDarkUrl ?? null,
        accentDark: body?.accentDark ?? null,
        textOnDark: body?.textOnDark ?? null,
        country: body?.country ?? null,
        organizationId: orgId,
        ownerUserId,
      },
      include: { tags: { include: { tag: true } } },
    });
    if (
      body.logoLightUrl ||
      body.logoDarkUrl ||
      body.accentLight ||
      body.accentDark ||
      body.textOnLight ||
      body.textOnDark
    ) {
      this.emitBrandUpdate(created as TeamWithBranding);
    }
    return created;
  }

  async update(
    actor: Actor,
    teamId: string,
    body: TeamUpdateBody,
  ): Promise<TeamWithTags> {
    const existing = await this.prisma.team.findFirst({
      where: { id: teamId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Team not found');
    if (!this.canEdit(actor, existing.ownerUserId)) {
      throw new NotFoundException('Team not found');
    }
    const branding = await this.getBrandingDefaults(existing.organizationId);

    const data: Prisma.TeamUpdateInput = {};
    if (body?.name) data.name = body.name.trim();
    if (body?.tag !== undefined) {
      const tagResult = normalizeAndValidateTeamTag(body.tag);
      if (tagResult.error) {
        throw new BadRequestException(tagResult.error);
      }
      data.tag = tagResult.normalized;
    }
    if (body?.logoUrl !== undefined) {
      data.logoUrl = resolveTeamLogo(body.logoUrl, branding);
    }
    if (body?.country !== undefined) data.country = body.country;
    if (body?.logoLightUrl !== undefined) data.logoLightUrl = body.logoLightUrl;
    if (body?.accentLight !== undefined) data.accentLight = body.accentLight;
    if (body?.textOnLight !== undefined) data.textOnLight = body.textOnLight;
    if (body?.logoDarkUrl !== undefined) data.logoDarkUrl = body.logoDarkUrl;
    if (body?.accentDark !== undefined) data.accentDark = body.accentDark;
    if (body?.textOnDark !== undefined) data.textOnDark = body.textOnDark;

    if (!Object.keys(data).length) {
      const current = await this.prisma.team.findFirst({
        where: { id: teamId },
        include: { tags: { include: { tag: true } } },
      });
      const team = current ?? (existing as TeamWithTags);
      return {
        ...team,
        logoUrl: resolveTeamLogo(team.logoUrl, branding),
      };
    }

    const brandTouched =
      body?.logoLightUrl !== undefined ||
      body?.logoDarkUrl !== undefined ||
      body?.accentLight !== undefined ||
      body?.accentDark !== undefined ||
      body?.textOnLight !== undefined ||
      body?.textOnDark !== undefined;

    const updated = await this.prisma.team.update({
      where: { id: teamId },
      data,
      include: { tags: { include: { tag: true } } },
    });

    if (brandTouched) {
      this.emitBrandUpdate(updated as TeamWithBranding);
    }
    return {
      ...updated,
      logoUrl: resolveTeamLogo(updated.logoUrl, branding),
    };
  }

  async softDelete(actor: Actor, teamId: string) {
    const existing = await this.prisma.team.findFirst({
      where: { id: teamId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Team not found');
    if (!this.canEdit(actor, existing.ownerUserId)) {
      throw new NotFoundException('Team not found');
    }

    return this.prisma.team.update({
      where: { id: teamId },
      data: { deletedAt: new Date() },
    });
  }

  async restore(actor: Actor, teamId: string) {
    const existing = await this.prisma.team.findFirst({
      where: { id: teamId },
    });
    if (!existing) throw new NotFoundException('Team not found');
    if (!this.canEdit(actor, existing.ownerUserId)) {
      throw new NotFoundException('Team not found');
    }

    return this.prisma.team.update({
      where: { id: teamId },
      data: { deletedAt: null },
    });
  }

  async listTags(orgId?: string) {
    if (!orgId) return [];
    const where = { organizationId: orgId };
    return this.prisma.tag.findMany({
      where,
      orderBy: { name: 'asc' },
    });
  }

  async createTag(orgId: string, name: string, userId?: string) {
    if (!name?.trim()) throw new BadRequestException('Tag name required');
    const trimmed = name.trim();
    const existing = await this.prisma.tag.findFirst({
      where: { organizationId: orgId, name: trimmed },
    });
    if (existing) throw new BadRequestException('Tag already exists');
    return this.prisma.tag.create({
      data: { organizationId: orgId, name: trimmed, createdBy: userId },
    });
  }

  async deleteTag(orgId: string, tagId: string) {
    const tag = await this.prisma.tag.findFirst({
      where: { id: tagId, organizationId: orgId },
    });
    if (!tag) throw new NotFoundException('Tag not found');
    await this.prisma.teamTag.deleteMany({ where: { tagId } });
    await this.prisma.tag.delete({ where: { id: tagId } });
    return { ok: true };
  }

  async setTeamTags(orgId: string, teamId: string, tagIds: string[]) {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId: orgId, deletedAt: null },
    });
    if (!team) throw new NotFoundException('Team not found');

    if (tagIds?.length) {
      const count = await this.prisma.tag.count({
        where: { id: { in: tagIds }, organizationId: orgId },
      });
      if (count !== tagIds.length)
        throw new BadRequestException('Invalid tags for this organization');
    }

    await this.prisma.teamTag.deleteMany({ where: { teamId } });
    if (tagIds?.length) {
      await this.prisma.teamTag.createMany({
        data: tagIds.map((tagId) => ({ teamId, tagId })),
        skipDuplicates: true,
      });
    }

    return this.prisma.team.findUnique({
      where: { id: teamId },
      include: { tags: { include: { tag: true } } },
    });
  }

  async addPlayer(orgId: string, teamId: string, playerId: string) {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId: orgId, deletedAt: null },
    });
    if (!team) throw new NotFoundException('Team not found');
    await assertTeamRosterWriteAllowed(this.prisma, team.id);

    const player = await this.prisma.player.findFirst({
      where: { id: playerId, organizationId: orgId, deletedAt: null },
    });
    if (!player) throw new NotFoundException('Player not found');

    return this.prisma.rosterEntry.create({
      data: {
        teamId,
        playerId,
        startAt: new Date(),
        isActive: true,
      },
    });
  }

  async roster(
    orgId: string,
    teamId: string,
  ): Promise<RosterEntryWithPlayer[]> {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId: orgId, deletedAt: null },
    });
    if (!team) throw new NotFoundException('Team not found');

    return this.prisma.rosterEntry.findMany({
      where: { teamId, isActive: true },
      include: { player: true },
      orderBy: { startAt: 'desc' },
    });
  }

  async removePlayer(orgId: string, teamId: string, playerId: string) {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId: orgId, deletedAt: null },
    });
    if (!team) throw new NotFoundException('Team not found');
    await assertTeamRosterWriteAllowed(this.prisma, team.id);

    const entry = await this.prisma.rosterEntry.findFirst({
      where: { teamId, playerId, isActive: true },
      orderBy: { startAt: 'desc' },
    });
    if (!entry) throw new NotFoundException('Roster entry not found');

    return this.prisma.rosterEntry.update({
      where: { id: entry.id },
      data: { isActive: false },
    });
  }

  // ---- Team-scoped players ----
  async listTeamPlayers(orgId: string | null, teamId: string, actor?: Actor) {
    const team = await this.ensureTeam(orgId, teamId, actor);
    const effectiveOrgId = orgId ?? team.organizationId ?? undefined;
    return this.prisma.player.findMany({
      where: {
        teamId,
        deletedAt: null,
        ...(effectiveOrgId ? { organizationId: effectiveOrgId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createTeamPlayer(
    orgId: string | null,
    teamId: string,
    body: TeamPlayerBody,
    actor?: Actor,
  ) {
    const team = await this.ensureTeam(orgId, teamId, actor);
    await assertTeamRosterWriteAllowed(this.prisma, team.id);
    const effectiveOrgId = orgId ?? team.organizationId;
    if (!effectiveOrgId) {
      throw new BadRequestException('Organization context is required');
    }
    if (!body?.ign) throw new BadRequestException('ign is required');
    const displayName = body?.realName ?? body?.name ?? null;

    const pubgIdRaw = body?.inGameId ?? body?.pubgPlayerId;
    const pubgIdProvided = pubgIdRaw !== undefined;
    const pubgIdValue =
      pubgIdRaw === null ||
      pubgIdRaw === undefined ||
      `${pubgIdRaw}`.trim() === ''
        ? null
        : `${pubgIdRaw}`.trim();

    if (pubgIdProvided && pubgIdValue !== null) {
      if (!/^\d+$/.test(pubgIdValue)) {
        throw new BadRequestException('PUBG In-Game ID must be numeric');
      }
      const dup = await this.prisma.player.findFirst({
        where: {
          organizationId: orgId ?? undefined,
          teamId,
          pubgPlayerId: pubgIdValue,
          inGameId: pubgIdValue ?? undefined,
          deletedAt: null,
        },
      });
      if (dup)
        throw new BadRequestException(
          'PUBG In-Game ID must be unique within the team',
        );
    }

    const source: PlayerSource =
      body?.source === PlayerSource.API
        ? PlayerSource.API
        : PlayerSource.MANUAL;
    const externalSource =
      body?.externalSource && `${body.externalSource}`.trim() !== ''
        ? `${body.externalSource}`.trim()
        : null;
    const externalId =
      body?.externalId && `${body.externalId}`.trim() !== ''
        ? `${body.externalId}`.trim()
        : null;

    if (source === PlayerSource.API && !externalId) {
      throw new BadRequestException('externalId is required for API players');
    }

    if (externalId) {
      const existingExternal = await this.prisma.player.findFirst({
        where: {
          organizationId: effectiveOrgId,
          externalId,
          externalSource: externalSource ?? undefined,
          deletedAt: null,
        },
      });
      if (existingExternal) {
        if (existingExternal.source === PlayerSource.MANUAL) {
          throw new BadRequestException(
            'A manual player already exists for this externalId',
          );
        }
        return this.prisma.player.update({
          where: { id: existingExternal.id },
          data: {
            teamId,
            ign: body.ign ?? existingExternal.ign,
            realName: displayName ?? existingExternal.realName,
            role: body?.role ?? existingExternal.role,
            photoUrl: body?.photoUrl ?? existingExternal.photoUrl,
            country: body?.country ?? existingExternal.country,
            pubgPlayerId: pubgIdValue ?? existingExternal.pubgPlayerId,
            inGameId: pubgIdValue ?? existingExternal.inGameId ?? undefined,
            source: PlayerSource.API,
            externalSource: externalSource ?? existingExternal.externalSource,
            externalId,
            externalPlayerId:
              externalId ?? existingExternal.externalPlayerId ?? undefined,
            playerOpenId:
              externalId ?? existingExternal.playerOpenId ?? undefined,
          },
        });
      }
    }

    return this.prisma.player.create({
      data: {
        organizationId: effectiveOrgId,
        teamId,
        ign: body.ign,
        inGameId: pubgIdValue ?? undefined,
        ignSource: 'MANUAL',
        pubgIdSource: 'MANUAL',
        pubgPlayerId: pubgIdValue,
        realName: displayName,
        role: body?.role,
        photoUrl: body?.photoUrl,
        country: body?.country,
        source,
        externalSource: externalSource ?? undefined,
        externalId: externalId ?? undefined,
        externalPlayerId: externalId ?? undefined,
        playerOpenId: externalId ?? undefined,
      },
    });
  }

  async updateTeamPlayer(
    orgId: string | null,
    teamId: string,
    playerId: string,
    body: TeamPlayerBody,
    actor?: Actor,
  ) {
    const team = await this.ensureTeam(orgId, teamId, actor);
    const effectiveOrgId = orgId ?? team.organizationId ?? undefined;
    const player = await this.prisma.player.findFirst({
      where: {
        id: playerId,
        teamId,
        deletedAt: null,
        ...(effectiveOrgId ? { organizationId: effectiveOrgId } : {}),
      },
    });
    if (!player) throw new NotFoundException('Player not found');

    const touchingLockedField =
      body?.ign !== undefined ||
      body?.pubgPlayerId !== undefined ||
      body?.inGameId !== undefined ||
      body?.teamId !== undefined ||
      body?.isActive !== undefined;
    if (touchingLockedField) {
      await assertTeamRosterWriteAllowed(this.prisma, teamId);
    }

    const displayName =
      body?.realName !== undefined ? body.realName : body?.name;

    const pubgIdRaw =
      body?.inGameId !== undefined ? body.inGameId : body?.pubgPlayerId;
    const pubgIdProvided = pubgIdRaw !== undefined;
    const pubgIdValue =
      pubgIdRaw === null ||
      pubgIdRaw === undefined ||
      `${pubgIdRaw}`.trim() === ''
        ? null
        : `${pubgIdRaw}`.trim();

    if (pubgIdProvided && pubgIdValue !== null) {
      if (!/^\d+$/.test(pubgIdValue)) {
        throw new BadRequestException('PUBG In-Game ID must be numeric');
      }
      const dup = await this.prisma.player.findFirst({
        where: {
          organizationId: effectiveOrgId,
          teamId,
          pubgPlayerId: pubgIdValue,
          inGameId: pubgIdValue ?? undefined,
          deletedAt: null,
          NOT: { id: playerId },
        },
      });
      if (dup)
        throw new BadRequestException(
          'PUBG In-Game ID must be unique within the team',
        );
    }

    const sourceUpdate =
      body?.source === PlayerSource.API || body?.source === PlayerSource.MANUAL
        ? body.source
        : undefined;
    if (
      player.source === PlayerSource.MANUAL &&
      sourceUpdate === PlayerSource.API
    ) {
      throw new BadRequestException(
        'Manual players cannot be converted to API-managed',
      );
    }

    const externalSource =
      body?.externalSource !== undefined
        ? body.externalSource && `${body.externalSource}`.trim() !== ''
          ? `${body.externalSource}`.trim()
          : null
        : (player.externalSource ?? null);
    const externalId =
      body?.externalId !== undefined
        ? body.externalId && `${body.externalId}`.trim() !== ''
          ? `${body.externalId}`.trim()
          : null
        : (player.externalId ?? null);

    if (sourceUpdate === PlayerSource.API && !externalId) {
      throw new BadRequestException('externalId is required for API players');
    }

    if (externalId) {
      const dupExternal = await this.prisma.player.findFirst({
        where: {
          organizationId: effectiveOrgId,
          externalId,
          externalSource: externalSource ?? undefined,
          deletedAt: null,
          NOT: { id: playerId },
        },
      });
      if (dupExternal) {
        if (dupExternal.source === PlayerSource.MANUAL) {
          throw new BadRequestException(
            'A manual player already exists for this externalId',
          );
        }
        throw new BadRequestException(
          'External player already exists for this source/id',
        );
      }
    }

    return this.prisma.player.update({
      where: { id: playerId },
      data: {
        ign: body?.ign ?? player.ign,
        realName: displayName ?? player.realName,
        role: body?.role ?? player.role,
        photoUrl: body?.photoUrl ?? player.photoUrl,
        country: body?.country ?? player.country,
        pubgPlayerId: pubgIdProvided
          ? pubgIdValue
          : (player as Player & { pubgPlayerId?: string | null }).pubgPlayerId,
        inGameId: pubgIdProvided
          ? (pubgIdValue ?? undefined)
          : (player as Player & { inGameId?: string | null }).inGameId,
        ignSource:
          body?.ign !== undefined
            ? 'MANUAL'
            : (player as Player & { ignSource?: string }).ignSource,
        pubgIdSource: pubgIdProvided
          ? 'MANUAL'
          : (player as Player & { pubgIdSource?: string }).pubgIdSource,
        source:
          sourceUpdate !== undefined
            ? sourceUpdate
            : (player.source ?? PlayerSource.MANUAL),
        externalSource:
          body?.externalSource !== undefined
            ? (externalSource ?? undefined)
            : (player.externalSource ?? undefined),
        externalId:
          body?.externalId !== undefined
            ? (externalId ?? undefined)
            : (player.externalId ?? undefined),
      },
    });
  }

  async deleteTeamPlayer(
    orgId: string | null,
    teamId: string,
    playerId: string,
    actor?: Actor,
  ) {
    const team = await this.ensureTeam(orgId, teamId, actor);
    await assertTeamRosterWriteAllowed(this.prisma, team.id);
    const effectiveOrgId = orgId ?? team.organizationId ?? undefined;
    const player = await this.prisma.player.findFirst({
      where: {
        id: playerId,
        teamId,
        deletedAt: null,
        ...(effectiveOrgId ? { organizationId: effectiveOrgId } : {}),
      },
    });
    if (!player) throw new NotFoundException('Player not found');
    await this.prisma.rosterEntry.deleteMany({ where: { playerId, teamId } });
    await this.prisma.mediaAsset.deleteMany({ where: { playerId } });
    await this.prisma.player.delete({
      where: { id: playerId },
    });
    return { ok: true };
  }

  async updatePlayerPhoto(orgId: string, playerId: string, photoUrl: string) {
    const player = await this.prisma.player.findFirst({
      where: { id: playerId, organizationId: orgId, deletedAt: null },
    });
    if (!player) throw new NotFoundException('Player not found');
    return this.prisma.player.update({
      where: { id: playerId },
      data: { photoUrl },
    });
  }

  private async ensureTeam(
    orgId: string | null,
    teamId: string,
    actor?: Actor,
  ): Promise<TeamMinimal> {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, deletedAt: null },
      select: { id: true, organizationId: true, ownerUserId: true },
    });
    if (!team) throw new NotFoundException('Team not found');
    if (team.organizationId && team.organizationId !== orgId) {
      throw new NotFoundException('Team not found');
    }
    if (!team.organizationId && orgId) {
      await this.prisma.team.update({
        where: { id: teamId },
        data: { organizationId: orgId },
      });
      return { ...team, organizationId: orgId };
    }
    const isOrganizer =
      actor?.role === Role.ORGANIZER || actor?.actorRole === Role.ORGANIZER;
    const actorId = actor?.actorId ?? actor?.id ?? null;
    if (actor && isOrganizer && actorId && team.ownerUserId !== actorId) {
      throw new ForbiddenException('Not allowed to manage this team');
    }
    return team;
  }
}
