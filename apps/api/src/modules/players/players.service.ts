import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma, type Player, PlayerSource } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import type { AuthUser } from '../../common/auth/auth.types';
import { requireOrgMatch } from '../../common/org/org.util';
import {
  resolvePlayerPhoto,
  type OrgBrandingDefaults,
} from '../../common/media-resolver';
import { assertTeamRosterWriteAllowed } from '../../common/tournament-roster-policy';

export type PlayerBody = {
  ign?: string;
  name?: string;
  realName?: string | null;
  role?: string | null;
  photoUrl?: string | null;
  country?: string | null;
  isActive?: boolean;
  inGameId?: string | null;
  teamId?: string | null;
  source?: PlayerSource | null;
  externalSource?: string | null;
  externalId?: string | null;
};

@Injectable()
export class PlayersService {
  constructor(private prisma: PrismaService) {}

  private isSuper(actor?: AuthUser | null) {
    return actor?.role === 'SUPER_ADMIN' || actor?.actorRole === 'SUPER_ADMIN';
  }

  private async getBrandingDefaults(
    organizationId: string,
  ): Promise<OrgBrandingDefaults | null> {
    return this.prisma.organizationBranding.findUnique({
      where: { organizationId },
      select: {
        defaultPlayerPhotoUrl: true,
        defaultTeamLogoUrl: false,
      },
    }) as Promise<OrgBrandingDefaults | null>;
  }

  async list(orgId: string, actor?: AuthUser | null): Promise<Player[]> {
    const where: Prisma.PlayerWhereInput = {
      organizationId: orgId,
      deletedAt: null,
    };
    const actorId = actor?.actorId ?? actor?.id ?? null;
    const isOrganizer =
      actor?.role === 'ORGANIZER' || actor?.actorRole === 'ORGANIZER';
    if (actorId && isOrganizer) {
      where.team = { ownerUserId: actorId };
    }
    const branding = await this.getBrandingDefaults(orgId);
    const players = await this.prisma.player.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return players.map((p) => ({
      ...p,
      photoUrl: resolvePlayerPhoto(p.photoUrl, branding),
    }));
  }

  async listByTeam(
    orgId: string,
    teamId: string,
    actor?: AuthUser | null,
  ): Promise<Player[]> {
    requireOrgMatch(actor ?? null, orgId);
    const branding = await this.getBrandingDefaults(orgId);
    const players = await this.prisma.player.findMany({
      where: { organizationId: orgId, teamId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return players.map((p) => ({
      ...p,
      photoUrl: resolvePlayerPhoto(p.photoUrl, branding),
    }));
  }

  async create(
    orgId: string,
    body: PlayerBody,
    actor?: AuthUser | null,
  ): Promise<Player> {
    requireOrgMatch(actor ?? null, orgId);
    const ign = body?.ign ?? body?.name;
    if (!ign) throw new BadRequestException('ign is required');
    const inGameId =
      body?.inGameId && `${body.inGameId}`.trim() !== ''
        ? `${body.inGameId}`.trim()
        : null;
    const teamId = body?.teamId ?? null;
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

    if (teamId) {
      await assertTeamRosterWriteAllowed(this.prisma, teamId);
    }

    const branding = await this.getBrandingDefaults(orgId);

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org || org.deletedAt)
      throw new BadRequestException('Organization not found or deleted');

    const actorId = actor?.actorId ?? actor?.id ?? null;
    const isOrganizer =
      actor?.role === 'ORGANIZER' || actor?.actorRole === 'ORGANIZER';
    if (isOrganizer) {
      if (!teamId)
        throw new BadRequestException('teamId is required for organizers');
      const team = await this.prisma.team.findFirst({
        where: {
          id: teamId,
          organizationId: orgId,
          ownerUserId: actorId ?? undefined,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!team)
        throw new ForbiddenException('Not allowed to manage this team');
    }

    if (externalId) {
      const existingExternal = await this.prisma.player.findFirst({
        where: {
          organizationId: orgId,
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
            teamId: teamId ?? existingExternal.teamId ?? undefined,
            ign,
            realName: body?.realName ?? existingExternal.realName,
            role: body?.role ?? existingExternal.role,
            photoUrl: resolvePlayerPhoto(
              body?.photoUrl ?? existingExternal.photoUrl,
              branding,
            ),
            country: body?.country ?? existingExternal.country,
            inGameId: inGameId ?? existingExternal.inGameId ?? undefined,
            pubgPlayerId:
              inGameId ?? existingExternal.pubgPlayerId ?? undefined,
            isActive: body?.isActive ?? existingExternal.isActive,
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

    const resolvedPhoto = resolvePlayerPhoto(body?.photoUrl ?? null, branding);

    return this.prisma.player.create({
      data: {
        organizationId: orgId,
        teamId: teamId ?? undefined,
        ign,
        realName: body?.realName,
        role: body?.role,
        photoUrl: resolvedPhoto,
        country: body?.country,
        inGameId: inGameId ?? undefined,
        pubgPlayerId: inGameId ?? undefined,
        isActive: body?.isActive ?? undefined,
        source,
        externalSource: externalSource ?? undefined,
        externalId: externalId ?? undefined,
        externalPlayerId: externalId ?? undefined,
        playerOpenId: externalId ?? undefined,
      },
    });
  }

  async update(
    orgId: string,
    playerId: string,
    body: PlayerBody,
    actor?: AuthUser | null,
  ): Promise<Player> {
    requireOrgMatch(actor ?? null, orgId);
    const existing = await this.prisma.player.findFirst({
      where: { id: playerId, organizationId: orgId, deletedAt: null },
      include: { team: { select: { ownerUserId: true, id: true } } },
    });
    if (!existing) throw new NotFoundException('Player not found');
    const actorId = actor?.actorId ?? actor?.id ?? null;
    const isOrganizer =
      actor?.role === 'ORGANIZER' || actor?.actorRole === 'ORGANIZER';
    if (
      isOrganizer &&
      actorId &&
      existing.team &&
      existing.team.ownerUserId !== actorId
    ) {
      throw new ForbiddenException('Not allowed to manage this player');
    }

    const touchingLockedField =
      body?.ign !== undefined ||
      body?.isActive !== undefined ||
      body?.inGameId !== undefined ||
      body?.teamId !== undefined ||
      body?.source !== undefined ||
      body?.externalSource !== undefined ||
      body?.externalId !== undefined;
    const nextTeamId = body?.teamId ?? existing.teamId ?? null;
    if (touchingLockedField) {
      if (existing.teamId) {
        await assertTeamRosterWriteAllowed(this.prisma, existing.teamId);
      }
      if (nextTeamId && nextTeamId !== existing.teamId) {
        await assertTeamRosterWriteAllowed(this.prisma, nextTeamId);
      }
    }

    const data: Prisma.PlayerUpdateInput = {};
    if (body?.ign !== undefined) data.ign = body.ign;
    if (body?.realName !== undefined) data.realName = body.realName;
    if (body?.role !== undefined) data.role = body.role;
    if (body?.photoUrl !== undefined) data.photoUrl = body.photoUrl;
    if (body?.country !== undefined) data.country = body.country;
    if (body?.isActive !== undefined) data.isActive = body.isActive;
    if (body?.inGameId !== undefined) {
      const value =
        body.inGameId === null || `${body.inGameId}`.trim() === ''
          ? null
          : `${body.inGameId}`.trim();
      data.inGameId = value ?? undefined;
      data.pubgPlayerId = value ?? undefined;
    }
    if (body?.source !== undefined) {
      if (
        existing.source === PlayerSource.MANUAL &&
        body.source === PlayerSource.API
      ) {
        throw new BadRequestException(
          'Manual players cannot be converted to API-managed',
        );
      }
      if (
        body.source !== PlayerSource.MANUAL &&
        body.source !== PlayerSource.API
      ) {
        throw new BadRequestException('Invalid player source');
      }
      data.source = body.source;
    }
    if (body?.externalSource !== undefined) {
      const value =
        body.externalSource && `${body.externalSource}`.trim() !== ''
          ? `${body.externalSource}`.trim()
          : null;
      data.externalSource = value ?? undefined;
    }
    if (body?.externalId !== undefined) {
      const value =
        body.externalId && `${body.externalId}`.trim() !== ''
          ? `${body.externalId}`.trim()
          : null;
      if ((body?.source ?? existing.source) === PlayerSource.API && !value) {
        throw new BadRequestException('externalId is required for API players');
      }
      if (value) {
        const dup = await this.prisma.player.findFirst({
          where: {
            organizationId: orgId,
            externalId: value,
            externalSource:
              body?.externalSource ?? existing.externalSource ?? undefined,
            deletedAt: null,
            NOT: { id: playerId },
          },
        });
        if (dup) {
          if (dup.source === PlayerSource.MANUAL) {
            throw new BadRequestException(
              'A manual player already exists for this externalId',
            );
          }
          throw new BadRequestException(
            'External player already exists for this source/id',
          );
        }
      }
      data.externalId = value ?? undefined;
    }

    const branding = await this.getBrandingDefaults(orgId);

    if (!Object.keys(data).length) {
      return {
        ...existing,
        photoUrl: resolvePlayerPhoto(existing.photoUrl, branding),
      };
    }

    const updated = await this.prisma.player.update({
      where: { id: playerId },
      data,
    });
    return {
      ...updated,
      photoUrl: resolvePlayerPhoto(updated.photoUrl, branding),
    };
  }

  async softDelete(
    orgId: string,
    playerId: string,
    actor?: AuthUser | null,
  ): Promise<Player> {
    const existing = await this.prisma.player.findFirst({
      where: { id: playerId, organizationId: orgId, deletedAt: null },
      include: { team: { select: { ownerUserId: true } } },
    });
    if (!existing) throw new NotFoundException('Player not found');
    const actorId = actor?.actorId ?? actor?.id ?? null;
    const isOrganizer =
      actor?.role === 'ORGANIZER' || actor?.actorRole === 'ORGANIZER';
    if (
      isOrganizer &&
      actorId &&
      existing.team &&
      existing.team.ownerUserId !== actorId
    ) {
      throw new ForbiddenException('Not allowed to manage this player');
    }

    if (existing.teamId) {
      await assertTeamRosterWriteAllowed(this.prisma, existing.teamId);
    }

    await this.prisma.rosterEntry.deleteMany({ where: { playerId } });
    await this.prisma.mediaAsset.deleteMany({ where: { playerId } });

    return this.prisma.player.delete({
      where: { id: playerId },
    });
  }

  async restore(
    orgId: string,
    playerId: string,
    actor?: AuthUser | null,
  ): Promise<Player> {
    const existing = await this.prisma.player.findFirst({
      where: { id: playerId, organizationId: orgId },
      include: { team: { select: { ownerUserId: true } } },
    });
    if (!existing) throw new NotFoundException('Player not found');
    const actorId = actor?.actorId ?? actor?.id ?? null;
    const isOrganizer =
      actor?.role === 'ORGANIZER' || actor?.actorRole === 'ORGANIZER';
    if (
      isOrganizer &&
      actorId &&
      existing.team &&
      existing.team.ownerUserId !== actorId
    ) {
      throw new ForbiddenException('Not allowed to manage this player');
    }

    if (existing.teamId) {
      await assertTeamRosterWriteAllowed(this.prisma, existing.teamId);
    }

    return this.prisma.player.update({
      where: { id: playerId },
      data: { deletedAt: null },
    });
  }
}
