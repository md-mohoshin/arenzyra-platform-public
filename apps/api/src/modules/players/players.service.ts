import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import {
  Prisma,
  type Player,
  PlayerSource,
  SessionRegistrationStatus,
} from '@prisma/client';
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

export type DiscordPlayerPhotoBody = {
  sessionId?: string | null;
  registrationMode?: string | null;
  uid?: string | null;
  playerUid?: string | null;
  inGameId?: string | null;
  playerName?: string | null;
  name?: string | null;
  ign?: string | null;
  teamName?: string | null;
};

type PlayerTeamSummary = {
  id: string;
  name: string;
  tag: string | null;
};

export type DiscordPlayerPhotoTarget = {
  player: Player;
  created: boolean;
  uid: string;
  playerName: string;
  team: PlayerTeamSummary | null;
  matchedRoster: boolean;
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

  private cleanString(value: unknown) {
    if (value === null || value === undefined) return null;
    let trimmed: string;
    if (typeof value === 'string') {
      trimmed = value.trim();
    } else if (typeof value === 'number') {
      trimmed = Number.isFinite(value) ? value.toString().trim() : '';
    } else if (typeof value === 'boolean' || typeof value === 'bigint') {
      trimmed = value.toString().trim();
    } else {
      return null;
    }
    return trimmed.length > 0 ? trimmed : null;
  }

  private cleanPlayerUid(value: unknown) {
    const cleaned = this.cleanString(value)?.replace(/\s+/g, '') ?? null;
    return cleaned && cleaned.length > 0 ? cleaned : null;
  }

  private rosterPlayerContext(
    rosterJson: unknown,
    uid: string,
  ): { playerName: string } | null {
    if (
      !rosterJson ||
      typeof rosterJson !== 'object' ||
      Array.isArray(rosterJson)
    ) {
      return null;
    }

    const roster = rosterJson as Record<string, unknown>;
    if (roster.type !== 'TOURNAMENT_ROSTER' || !Array.isArray(roster.players)) {
      return null;
    }

    const uidKey = uid.toLowerCase();
    for (const rawPlayer of roster.players) {
      if (
        !rawPlayer ||
        typeof rawPlayer !== 'object' ||
        Array.isArray(rawPlayer)
      ) {
        continue;
      }

      const player = rawPlayer as Record<string, unknown>;
      const playerUid = this.cleanPlayerUid(player.uid);
      if (!playerUid || playerUid.toLowerCase() !== uidKey) {
        continue;
      }

      const playerName = this.cleanString(player.name);
      return playerName ? { playerName } : null;
    }

    return null;
  }

  private async sessionRosterPhotoContext(
    orgId: string,
    sessionId: string | null,
    uid: string,
  ): Promise<{
    playerName: string;
    team: PlayerTeamSummary;
  } | null> {
    if (!sessionId) {
      return null;
    }

    const registrations = await this.prisma.sessionRegistration.findMany({
      where: {
        organizationId: orgId,
        sessionId,
        deletedAt: null,
        status: {
          notIn: [
            SessionRegistrationStatus.REMOVED,
            SessionRegistrationStatus.DECLINED,
          ],
        },
      },
      select: {
        tournamentRosterJson: true,
        team: {
          select: {
            id: true,
            name: true,
            tag: true,
          },
        },
      },
      orderBy: [{ slotNumber: 'asc' }, { updatedAt: 'desc' }],
    });

    for (const registration of registrations) {
      const context = this.rosterPlayerContext(
        registration.tournamentRosterJson,
        uid,
      );
      if (context) {
        return {
          playerName: context.playerName,
          team: registration.team,
        };
      }
    }

    return null;
  }

  private async resolveTeamByNameOrTag(
    orgId: string,
    teamName: string | null,
  ): Promise<PlayerTeamSummary | null> {
    const query = this.cleanString(teamName);
    if (!query) {
      return null;
    }

    return this.prisma.team.findFirst({
      where: {
        organizationId: orgId,
        deletedAt: null,
        OR: [
          { name: { equals: query, mode: 'insensitive' } },
          { tag: { equals: query, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        name: true,
        tag: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  private async findPlayerByUid(
    orgId: string,
    uid: string,
  ): Promise<Player | null> {
    const byExternalPlayerId = await this.prisma.player.findFirst({
      where: {
        organizationId: orgId,
        externalPlayerId: uid,
        deletedAt: null,
      },
    });
    if (byExternalPlayerId) {
      return byExternalPlayerId;
    }

    return this.prisma.player.findFirst({
      where: {
        organizationId: orgId,
        deletedAt: null,
        OR: [{ pubgPlayerId: uid }, { inGameId: uid }, { playerOpenId: uid }],
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  private async canAssignExternalPlayerId(
    orgId: string,
    playerId: string,
    uid: string,
  ) {
    const existing = await this.prisma.player.findFirst({
      where: {
        organizationId: orgId,
        externalPlayerId: uid,
        deletedAt: null,
        NOT: { id: playerId },
      },
      select: { id: true },
    });
    return !existing;
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

  async prepareDiscordPlayerPhotoTarget(
    orgId: string,
    body: DiscordPlayerPhotoBody,
    actor?: AuthUser | null,
  ): Promise<DiscordPlayerPhotoTarget> {
    requireOrgMatch(actor ?? null, orgId);
    const uid = this.cleanPlayerUid(
      body?.uid ?? body?.playerUid ?? body?.inGameId,
    );
    if (!uid) {
      throw new BadRequestException('player uid is required');
    }

    const rosterContext = await this.sessionRosterPhotoContext(
      orgId,
      this.cleanString(body?.sessionId),
      uid,
    );
    const requestedTeamName = this.cleanString(body?.teamName);
    const requestedPlayerName = this.cleanString(
      body?.playerName ?? body?.name ?? body?.ign,
    );
    const team =
      requestedTeamName !== null
        ? await this.resolveTeamByNameOrTag(orgId, requestedTeamName)
        : (rosterContext?.team ?? null);
    const playerName = requestedPlayerName ?? rosterContext?.playerName ?? uid;
    const existing = await this.findPlayerByUid(orgId, uid);

    if (existing) {
      const data: Prisma.PlayerUncheckedUpdateInput = {
        ign: playerName,
        inGameId: uid,
        pubgPlayerId: uid,
        isActive: true,
      };
      if (!existing.teamId && team) {
        data.teamId = team.id;
      }
      if (await this.canAssignExternalPlayerId(orgId, existing.id, uid)) {
        data.externalPlayerId = uid;
      }

      const player = await this.prisma.player.update({
        where: { id: existing.id },
        data,
      });
      return {
        player,
        created: false,
        uid,
        playerName,
        team: team ?? null,
        matchedRoster: Boolean(rosterContext),
      };
    }

    try {
      const player = await this.prisma.player.create({
        data: {
          organizationId: orgId,
          teamId: team?.id ?? undefined,
          ign: playerName,
          inGameId: uid,
          pubgPlayerId: uid,
          externalPlayerId: uid,
          photoUrl: null,
          source: PlayerSource.MANUAL,
          isActive: true,
        },
      });
      return {
        player,
        created: true,
        uid,
        playerName,
        team: team ?? null,
        matchedRoster: Boolean(rosterContext),
      };
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') {
        throw error;
      }
      const player = await this.findPlayerByUid(orgId, uid);
      if (!player) {
        throw error;
      }
      return {
        player,
        created: false,
        uid,
        playerName,
        team: team ?? null,
        matchedRoster: Boolean(rosterContext),
      };
    }
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

  async updateDiscordServicePhoto(
    orgId: string,
    playerId: string,
    photoUrl: string,
    actor?: AuthUser | null,
  ): Promise<Player> {
    requireOrgMatch(actor ?? null, orgId);
    if (!actor?.serviceToken) {
      throw new ForbiddenException('Bot service token required');
    }

    const existing = await this.prisma.player.findFirst({
      where: { id: playerId, organizationId: orgId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Player not found');

    const branding = await this.getBrandingDefaults(orgId);
    const updated = await this.prisma.player.update({
      where: { id: playerId },
      data: { photoUrl },
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
