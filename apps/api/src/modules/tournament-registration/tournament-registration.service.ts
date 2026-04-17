import { randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PlayerSource,
  Prisma,
  TournamentInviteStatus,
  TournamentRegistrationStatus,
  TournamentRosterLineupType,
  TournamentStatus,
  TournamentTeamStatus,
} from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  resolvePlayerPhoto,
  resolveTeamLogo,
  type OrgBrandingDefaults,
} from '../../common/media-resolver';
import { requireTournamentOrganization } from '../../common/org/org.util';
import { PrismaService } from '../../db/prisma.service';
import { RejectTournamentRegistrationDto } from './dto/reject-tournament-registration.dto';
import { SubmitTournamentRegistrationDto } from './dto/submit-tournament-registration.dto';
import {
  normalizeTournamentRegistrationRoster,
  parseTournamentRegistrationRoster,
  type TournamentRegistrationRoster,
} from './tournament-registration.roster';

type ScopedClient = PrismaService | Prisma.TransactionClient;

type TournamentSelection = {
  id: string;
  name: string;
  organizationId: string;
  registrationPaused: boolean;
  status: TournamentStatus;
  liveState: string;
  endedAt: Date | null;
  deletedAt: Date | null;
  defaultRegistrationStageId: string | null;
};

type PlacementRecord = {
  stage: {
    id: string;
    name: string;
    maxTeams: number | null;
  };
  group: {
    id: string;
    name: string;
    maxTeams: number | null;
  } | null;
};

type TournamentRegistrationRecord = Prisma.TournamentRegistrationGetPayload<{
  include: {
    reviewedBy: {
      select: {
        id: true;
        email: true;
        name: true;
      };
    };
    team: {
      select: {
        id: true;
        name: true;
        tag: true;
        logoUrl: true;
      };
    };
    stage: {
      select: {
        id: true;
        name: true;
      };
    };
    group: {
      select: {
        id: true;
        name: true;
      };
    };
    tournament: {
      select: {
        id: true;
        name: true;
        organizationId: true;
        registrationPaused: true;
        status: true;
        liveState: true;
        endedAt: true;
        deletedAt: true;
      };
    };
  };
}>;

type TournamentInviteRecord = Prisma.TournamentInviteGetPayload<{
  include: {
    createdBy: {
      select: {
        id: true;
        email: true;
        name: true;
      };
    };
    team: {
      select: {
        id: true;
        name: true;
        tag: true;
        logoUrl: true;
      };
    };
    stage: {
      select: {
        id: true;
        name: true;
      };
    };
    group: {
      select: {
        id: true;
        name: true;
      };
    };
    tournament: {
      select: {
        id: true;
        name: true;
        organizationId: true;
        registrationPaused: true;
        status: true;
        liveState: true;
        endedAt: true;
        deletedAt: true;
      };
    };
  };
}>;

@Injectable()
export class TournamentRegistrationService {
  constructor(private readonly prisma: PrismaService) {}

  private actorId(actor: AuthUser | null | undefined): string | null {
    return actor?.actorId ?? actor?.actingAsUserId ?? actor?.id ?? null;
  }

  private async getBrandingDefaults(
    client: ScopedClient,
    organizationId: string,
  ): Promise<OrgBrandingDefaults | null> {
    return client.organizationBranding.findUnique({
      where: { organizationId },
      select: {
        defaultTeamLogoUrl: true,
        defaultPlayerPhotoUrl: true,
      },
    }) as Promise<OrgBrandingDefaults | null>;
  }

  private ensureRegistrationOpen(tournament: {
    registrationPaused: boolean;
    status: TournamentStatus;
  }) {
    if (tournament.registrationPaused) {
      throw new ConflictException(
        'Tournament registration is currently paused',
      );
    }

    if (
      tournament.status === TournamentStatus.COMPLETED ||
      tournament.status === TournamentStatus.ARCHIVED
    ) {
      throw new ConflictException(
        'Tournament registration is closed for finished tournaments',
      );
    }
  }

  private mapRegistration(record: TournamentRegistrationRecord) {
    return {
      id: record.id,
      tournamentId: record.tournamentId,
      stageId: record.stageId,
      groupId: record.groupId,
      teamId: record.teamId,
      teamName: record.teamName,
      contactEmail: record.contactEmail,
      players: parseTournamentRegistrationRoster(record.playersJson),
      status: record.status,
      rejectionReason: record.rejectionReason,
      createdAt: record.createdAt,
      reviewedAt: record.reviewedAt,
      reviewedBy: record.reviewedBy,
      stage: record.stage
        ? { id: record.stage.id, name: record.stage.name }
        : null,
      group: record.group
        ? { id: record.group.id, name: record.group.name }
        : null,
      team: record.team,
      tournament: {
        id: record.tournament.id,
        name: record.tournament.name,
        status: record.tournament.status,
        liveState: record.tournament.liveState,
      },
    };
  }

  private mapInvite(record: TournamentInviteRecord) {
    return {
      id: record.id,
      tournamentId: record.tournamentId,
      stageId: record.stageId,
      groupId: record.groupId,
      contactEmail: record.contactEmail,
      inviteToken: record.inviteToken,
      status: record.status,
      teamId: record.teamId,
      createdAt: record.createdAt,
      acceptedAt: record.acceptedAt,
      createdBy: record.createdBy,
      stage: record.stage
        ? { id: record.stage.id, name: record.stage.name }
        : null,
      group: record.group
        ? { id: record.group.id, name: record.group.name }
        : null,
      team: record.team,
      tournament: {
        id: record.tournament.id,
        name: record.tournament.name,
        status: record.tournament.status,
        liveState: record.tournament.liveState,
      },
    };
  }

  private mapPublicInvite(record: TournamentInviteRecord) {
    return {
      id: record.id,
      tournamentId: record.tournamentId,
      stageId: record.stageId,
      groupId: record.groupId,
      contactEmail: record.contactEmail,
      status: record.status,
      createdAt: record.createdAt,
      acceptedAt: record.acceptedAt,
      teamId: record.teamId,
      stage: record.stage
        ? { id: record.stage.id, name: record.stage.name }
        : null,
      group: record.group
        ? { id: record.group.id, name: record.group.name }
        : null,
      team: record.team,
      tournament: {
        id: record.tournament.id,
        name: record.tournament.name,
        status: record.tournament.status,
        liveState: record.tournament.liveState,
      },
    };
  }

  private async getTournament(
    tournamentId: string,
    client: ScopedClient = this.prisma,
  ): Promise<TournamentSelection> {
    const tournament = await client.tournament.findFirst({
      where: { id: tournamentId, deletedAt: null },
      select: {
        id: true,
        name: true,
        organizationId: true,
        registrationPaused: true,
        status: true,
        liveState: true,
        endedAt: true,
        deletedAt: true,
        defaultRegistrationStageId: true,
      },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    return tournament;
  }

  private async resolvePlacement(
    client: ScopedClient,
    params: {
      tournamentId: string;
      organizationId: string;
      stageId: string;
      groupId?: string | null;
    },
  ): Promise<PlacementRecord> {
    const stage = await client.stage.findFirst({
      where: {
        id: params.stageId,
        tournamentId: params.tournamentId,
        organizationId: params.organizationId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        maxTeams: true,
      },
    });

    if (!stage) {
      throw new BadRequestException('Stage not found for this tournament');
    }

    let group: PlacementRecord['group'] = null;
    if (params.groupId) {
      group = await client.group.findFirst({
        where: {
          id: params.groupId,
          stageId: stage.id,
          organizationId: params.organizationId,
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          maxTeams: true,
        },
      });

      if (!group) {
        throw new BadRequestException('Group not found for this stage');
      }
    }

    return { stage, group };
  }

  private async assertPlacementCapacity(
    client: ScopedClient,
    params: {
      placement: PlacementRecord;
      tournamentTeamId: string;
    },
  ): Promise<void> {
    const { placement, tournamentTeamId } = params;

    if (placement.stage.maxTeams && placement.stage.maxTeams > 0) {
      const [currentCount, existingMembership] = await Promise.all([
        client.stageTeam.count({
          where: { stageId: placement.stage.id },
        }),
        client.stageTeam.findFirst({
          where: {
            stageId: placement.stage.id,
            tournamentTeamId,
          },
          select: { id: true },
        }),
      ]);

      if (!existingMembership && currentCount + 1 > placement.stage.maxTeams) {
        throw new ConflictException(
          `Stage is full (max ${placement.stage.maxTeams} teams)`,
        );
      }
    }

    if (placement.group?.maxTeams && placement.group.maxTeams > 0) {
      const [currentCount, existingMembership] = await Promise.all([
        client.groupTeam.count({
          where: {
            groupId: placement.group.id,
            deletedAt: null,
          },
        }),
        client.groupTeam.findFirst({
          where: {
            groupId: placement.group.id,
            tournamentTeamId,
          },
          select: { id: true, deletedAt: true },
        }),
      ]);

      if (
        (!existingMembership || existingMembership.deletedAt) &&
        currentCount + 1 > placement.group.maxTeams
      ) {
        throw new ConflictException(
          `Group is full (max ${placement.group.maxTeams} teams)`,
        );
      }
    }
  }

  private async attachTournamentTeamPlacement(
    client: ScopedClient,
    params: {
      tournamentId: string;
      organizationId: string;
      tournamentTeamId: string;
      stageId: string;
      groupId?: string | null;
    },
  ): Promise<void> {
    const placement = await this.resolvePlacement(client, params);
    await this.assertPlacementCapacity(client, {
      placement,
      tournamentTeamId: params.tournamentTeamId,
    });

    const existingStageTeam = await client.stageTeam.findFirst({
      where: {
        stageId: placement.stage.id,
        tournamentTeamId: params.tournamentTeamId,
      },
      select: { id: true },
    });

    if (!existingStageTeam) {
      await client.stageTeam.create({
        data: {
          stageId: placement.stage.id,
          tournamentTeamId: params.tournamentTeamId,
        },
      });
    }

    if (!placement.group) {
      return;
    }

    const groupConflict = await client.groupTeam.findFirst({
      where: {
        tournamentTeamId: params.tournamentTeamId,
        deletedAt: null,
        group: {
          stageId: placement.stage.id,
          deletedAt: null,
          id: { not: placement.group.id },
        },
      },
      select: { id: true },
    });

    if (groupConflict) {
      throw new ConflictException(
        'Team is already assigned to another group in this stage',
      );
    }

    const revived = await client.groupTeam.updateMany({
      where: {
        groupId: placement.group.id,
        tournamentTeamId: params.tournamentTeamId,
      },
      data: {
        deletedAt: null,
      },
    });

    if (revived.count === 0) {
      await client.groupTeam.create({
        data: {
          groupId: placement.group.id,
          tournamentTeamId: params.tournamentTeamId,
        },
      });
    }
  }

  private async getScopedRegistration(
    registrationId: string,
    organizationId: string,
    client: ScopedClient = this.prisma,
  ): Promise<TournamentRegistrationRecord> {
    const registration = await client.tournamentRegistration.findFirst({
      where: {
        id: registrationId,
        organizationId,
        tournament: { deletedAt: null },
      },
      include: {
        reviewedBy: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        team: {
          select: {
            id: true,
            name: true,
            tag: true,
            logoUrl: true,
          },
        },
        stage: {
          select: {
            id: true,
            name: true,
          },
        },
        group: {
          select: {
            id: true,
            name: true,
          },
        },
        tournament: {
          select: {
            id: true,
            name: true,
            organizationId: true,
            registrationPaused: true,
            status: true,
            liveState: true,
            endedAt: true,
            deletedAt: true,
          },
        },
      },
    });

    if (!registration || registration.tournament.deletedAt) {
      throw new NotFoundException('Registration not found');
    }

    return registration;
  }

  private async getScopedInvite(
    inviteId: string,
    organizationId: string,
    client: ScopedClient = this.prisma,
  ): Promise<TournamentInviteRecord> {
    const invite = await client.tournamentInvite.findFirst({
      where: {
        id: inviteId,
        organizationId,
        tournament: { deletedAt: null },
      },
      include: {
        createdBy: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        team: {
          select: {
            id: true,
            name: true,
            tag: true,
            logoUrl: true,
          },
        },
        stage: {
          select: {
            id: true,
            name: true,
          },
        },
        group: {
          select: {
            id: true,
            name: true,
          },
        },
        tournament: {
          select: {
            id: true,
            name: true,
            organizationId: true,
            registrationPaused: true,
            status: true,
            liveState: true,
            endedAt: true,
            deletedAt: true,
          },
        },
      },
    });

    if (!invite || invite.tournament.deletedAt) {
      throw new NotFoundException('Invite not found');
    }

    return invite;
  }

  private normalizeInviteToken(inviteToken: string): string {
    const token = inviteToken.trim();
    if (!token) {
      throw new BadRequestException('invite token is required');
    }
    return token;
  }

  private async getInviteByToken(
    inviteToken: string,
    client: ScopedClient = this.prisma,
  ): Promise<TournamentInviteRecord> {
    const token = this.normalizeInviteToken(inviteToken);

    const invite = await client.tournamentInvite.findFirst({
      where: {
        inviteToken: token,
        tournament: { deletedAt: null },
      },
      include: {
        createdBy: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        team: {
          select: {
            id: true,
            name: true,
            tag: true,
            logoUrl: true,
          },
        },
        stage: {
          select: {
            id: true,
            name: true,
          },
        },
        group: {
          select: {
            id: true,
            name: true,
          },
        },
        tournament: {
          select: {
            id: true,
            name: true,
            organizationId: true,
            registrationPaused: true,
            status: true,
            liveState: true,
            endedAt: true,
            deletedAt: true,
          },
        },
      },
    });

    if (!invite || invite.tournament.deletedAt) {
      throw new NotFoundException('Invite not found');
    }

    return invite;
  }

  private async createTournamentEntryFromRoster(
    client: ScopedClient,
    params: {
      tournamentId: string;
      organizationId: string;
      teamName: string;
      ownerUserId: string;
      players: TournamentRegistrationRoster;
      stageId: string;
      groupId?: string | null;
      createdAt: Date;
    },
  ): Promise<{
    teamId: string;
    tournamentTeamId: string;
  }> {
    const branding = await this.getBrandingDefaults(
      client,
      params.organizationId,
    );
    const teamLogoUrl = resolveTeamLogo(null, branding);
    const playerPhotoUrl = resolvePlayerPhoto(null, branding);

    const team = await client.team.create({
      data: {
        name: params.teamName,
        organizationId: params.organizationId,
        ownerUserId: params.ownerUserId,
        logoUrl: teamLogoUrl,
      },
      select: {
        id: true,
      },
    });

    const teamPlayers = this.buildApprovedPlayers(
      params.players,
      team.id,
      params.organizationId,
      playerPhotoUrl,
      params.createdAt,
    );

    await client.player.createMany({
      data: teamPlayers.orgPlayers,
    });

    await client.rosterEntry.createMany({
      data: teamPlayers.rosterEntries,
    });

    await client.globalPlayer.createMany({
      data: teamPlayers.globalPlayers,
    });

    const tournamentTeam = await client.tournamentTeam.create({
      data: {
        tournamentId: params.tournamentId,
        teamId: team.id,
        status: TournamentTeamStatus.ACTIVE,
      },
      select: { id: true },
    });

    await this.attachTournamentTeamPlacement(client, {
      tournamentId: params.tournamentId,
      organizationId: params.organizationId,
      tournamentTeamId: tournamentTeam.id,
      stageId: params.stageId,
      groupId: params.groupId ?? null,
    });

    await client.tournamentPlayer.createMany({
      data: teamPlayers.tournamentPlayers.map((player) => ({
        ...player,
        tournamentTeamId: tournamentTeam.id,
      })),
    });

    return {
      teamId: team.id,
      tournamentTeamId: tournamentTeam.id,
    };
  }

  private async generateInviteToken(client: ScopedClient): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const token = randomBytes(24).toString('hex');
      const existing = await client.tournamentInvite.findFirst({
        where: { inviteToken: token },
        select: { id: true },
      });

      if (!existing) {
        return token;
      }
    }

    throw new ConflictException('Unable to generate a unique invite token');
  }

  async submit(
    tournamentId: string,
    dto: SubmitTournamentRegistrationDto,
  ): Promise<{
    id: string;
    status: TournamentRegistrationStatus;
    message: string;
  }> {
    const teamName = dto.teamName?.trim();
    if (!teamName) {
      throw new BadRequestException('teamName is required');
    }

    const contactEmail = dto.contactEmail.trim().toLowerCase();
    const players = normalizeTournamentRegistrationRoster(dto.players);
    const tournament = await this.getTournament(tournamentId);

    this.ensureRegistrationOpen(tournament);

    if (!tournament.defaultRegistrationStageId) {
      throw new ConflictException(
        'Tournament registration stage is not configured',
      );
    }

    await this.resolvePlacement(this.prisma, {
      tournamentId: tournament.id,
      organizationId: tournament.organizationId,
      stageId: tournament.defaultRegistrationStageId,
      groupId: null,
    });

    try {
      const registration = await this.prisma.tournamentRegistration.create({
        data: {
          tournamentId: tournament.id,
          organizationId: tournament.organizationId,
          stageId: tournament.defaultRegistrationStageId,
          groupId: null,
          teamName,
          contactEmail,
          playersJson: players,
          status: TournamentRegistrationStatus.PENDING,
        },
        select: {
          id: true,
          status: true,
        },
      });

      return {
        id: registration.id,
        status: registration.status,
        message: 'Application submitted. Waiting for approval.',
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A pending registration already exists for this email and tournament',
        );
      }
      throw error;
    }
  }

  async listForOrganizer(
    tournamentId: string,
    organizationId: string,
    actor: AuthUser,
  ) {
    await requireTournamentOrganization(this.prisma, tournamentId, {
      organizationId,
      actor,
    });

    const registrations = await this.prisma.tournamentRegistration.findMany({
      where: {
        tournamentId,
        organizationId,
      },
      include: {
        reviewedBy: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        team: {
          select: {
            id: true,
            name: true,
            tag: true,
            logoUrl: true,
          },
        },
        stage: {
          select: {
            id: true,
            name: true,
          },
        },
        group: {
          select: {
            id: true,
            name: true,
          },
        },
        tournament: {
          select: {
            id: true,
            name: true,
            organizationId: true,
            registrationPaused: true,
            status: true,
            liveState: true,
            endedAt: true,
            deletedAt: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    return registrations.map((record) => this.mapRegistration(record));
  }

  async approve(
    registrationId: string,
    organizationId: string,
    actor: AuthUser,
  ) {
    const reviewerId = this.actorId(actor);
    if (!reviewerId) {
      throw new BadRequestException('Reviewer could not be resolved');
    }

    const reviewedAt = new Date();

    const registration = await this.prisma.$transaction(async (tx) => {
      const existing = await this.getScopedRegistration(
        registrationId,
        organizationId,
        tx,
      );

      if (existing.status !== TournamentRegistrationStatus.PENDING) {
        throw new ConflictException('Registration is no longer pending');
      }

      const teamName = existing.teamName.trim();
      if (!teamName) {
        throw new BadRequestException(
          'Stored registration teamName is invalid',
        );
      }

      const players = parseTournamentRegistrationRoster(existing.playersJson);

      const claimed = await tx.tournamentRegistration.updateMany({
        where: {
          id: existing.id,
          organizationId,
          status: TournamentRegistrationStatus.PENDING,
        },
        data: {
          status: TournamentRegistrationStatus.APPROVED,
          reviewedAt,
          reviewedById: reviewerId,
          rejectionReason: null,
        },
      });

      if (claimed.count !== 1) {
        throw new ConflictException('Registration is no longer pending');
      }

      const created = await this.createTournamentEntryFromRoster(tx, {
        tournamentId: existing.tournamentId,
        organizationId,
        teamName,
        ownerUserId: reviewerId,
        players,
        stageId: existing.stageId,
        groupId: existing.groupId,
        createdAt: reviewedAt,
      });

      await tx.tournamentRegistration.update({
        where: { id: existing.id },
        data: {
          teamId: created.teamId,
        },
      });

      return this.getScopedRegistration(existing.id, organizationId, tx);
    });

    return this.mapRegistration(registration);
  }

  async reject(
    registrationId: string,
    organizationId: string,
    dto: RejectTournamentRegistrationDto,
    actor: AuthUser,
  ) {
    const reviewerId = this.actorId(actor);
    if (!reviewerId) {
      throw new BadRequestException('Reviewer could not be resolved');
    }

    const rejectionReason = dto.reason.trim();
    if (!rejectionReason) {
      throw new BadRequestException('reason is required');
    }

    const reviewedAt = new Date();

    const registration = await this.prisma.$transaction(async (tx) => {
      const existing = await this.getScopedRegistration(
        registrationId,
        organizationId,
        tx,
      );

      if (existing.status !== TournamentRegistrationStatus.PENDING) {
        throw new ConflictException('Registration is no longer pending');
      }

      const rejected = await tx.tournamentRegistration.updateMany({
        where: {
          id: existing.id,
          organizationId,
          status: TournamentRegistrationStatus.PENDING,
        },
        data: {
          status: TournamentRegistrationStatus.REJECTED,
          rejectionReason,
          reviewedAt,
          reviewedById: reviewerId,
        },
      });

      if (rejected.count !== 1) {
        throw new ConflictException('Registration is no longer pending');
      }

      return this.getScopedRegistration(existing.id, organizationId, tx);
    });

    return this.mapRegistration(registration);
  }

  async createInvite(
    tournamentId: string,
    organizationId: string,
    dto: {
      contactEmail: string;
      stageId: string;
      groupId?: string | null;
    },
    actor: AuthUser,
  ) {
    await requireTournamentOrganization(this.prisma, tournamentId, {
      organizationId,
      actor,
    });

    const createdById = this.actorId(actor);
    if (!createdById) {
      throw new BadRequestException('Invite creator could not be resolved');
    }

    const contactEmail = dto.contactEmail.trim().toLowerCase();
    const tournament = await this.getTournament(tournamentId);
    if (tournament.organizationId !== organizationId) {
      throw new NotFoundException('Tournament not found');
    }

    this.ensureRegistrationOpen(tournament);

    await this.resolvePlacement(this.prisma, {
      tournamentId: tournament.id,
      organizationId,
      stageId: dto.stageId,
      groupId: dto.groupId ?? null,
    });

    const invite = await this.prisma.$transaction(async (tx) => {
      const inviteToken = await this.generateInviteToken(tx);

      const created = await tx.tournamentInvite.create({
        data: {
          tournamentId: tournament.id,
          organizationId,
          stageId: dto.stageId,
          groupId: dto.groupId ?? null,
          contactEmail,
          inviteToken,
          status: TournamentInviteStatus.PENDING,
          createdById,
        },
        select: { id: true },
      });

      return this.getScopedInvite(created.id, organizationId, tx);
    });

    return this.mapInvite(invite);
  }

  async listInvites(
    tournamentId: string,
    organizationId: string,
    actor: AuthUser,
  ) {
    await requireTournamentOrganization(this.prisma, tournamentId, {
      organizationId,
      actor,
    });

    const invites = await this.prisma.tournamentInvite.findMany({
      where: {
        tournamentId,
        organizationId,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        team: {
          select: {
            id: true,
            name: true,
            tag: true,
            logoUrl: true,
          },
        },
        stage: {
          select: {
            id: true,
            name: true,
          },
        },
        group: {
          select: {
            id: true,
            name: true,
          },
        },
        tournament: {
          select: {
            id: true,
            name: true,
            organizationId: true,
            registrationPaused: true,
            status: true,
            liveState: true,
            endedAt: true,
            deletedAt: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    return invites.map((invite) => this.mapInvite(invite));
  }

  async getInviteInfo(inviteToken: string) {
    const invite = await this.getInviteByToken(inviteToken);
    return this.mapPublicInvite(invite);
  }

  async acceptInvite(
    inviteToken: string,
    dto: {
      teamName: string;
      players: SubmitTournamentRegistrationDto['players'];
    },
  ) {
    const teamName = dto.teamName?.trim();
    if (!teamName) {
      throw new BadRequestException('teamName is required');
    }

    const players = normalizeTournamentRegistrationRoster(dto.players);
    const acceptedAt = new Date();

    const invite = await this.prisma.$transaction(async (tx) => {
      const existing = await this.getInviteByToken(inviteToken, tx);

      if (existing.status !== TournamentInviteStatus.PENDING) {
        throw new ConflictException('Invite is no longer pending');
      }

      this.ensureRegistrationOpen(existing.tournament);

      const claimed = await tx.tournamentInvite.updateMany({
        where: {
          id: existing.id,
          status: TournamentInviteStatus.PENDING,
        },
        data: {
          status: TournamentInviteStatus.ACCEPTED,
          acceptedAt,
        },
      });

      if (claimed.count !== 1) {
        throw new ConflictException('Invite is no longer pending');
      }

      const created = await this.createTournamentEntryFromRoster(tx, {
        tournamentId: existing.tournamentId,
        organizationId: existing.organizationId,
        teamName,
        ownerUserId: existing.createdById,
        players,
        stageId: existing.stageId,
        groupId: existing.groupId,
        createdAt: acceptedAt,
      });

      await tx.tournamentInvite.update({
        where: { id: existing.id },
        data: {
          teamId: created.teamId,
        },
      });

      return this.getInviteByToken(inviteToken, tx);
    });

    return this.mapPublicInvite(invite);
  }

  private buildApprovedPlayers(
    players: TournamentRegistrationRoster,
    teamId: string,
    organizationId: string,
    playerPhotoUrl: string,
    createdAt: Date,
  ) {
    const orgPlayers: Array<Prisma.PlayerCreateManyInput> = [];
    const rosterEntries: Array<Prisma.RosterEntryCreateManyInput> = [];
    const globalPlayers: Array<Prisma.GlobalPlayerCreateManyInput> = [];
    const tournamentPlayers: Array<
      Omit<Prisma.TournamentPlayerCreateManyInput, 'tournamentTeamId'>
    > = [];

    for (const player of players.main) {
      const orgPlayerId = randomUUID();
      const globalPlayerId = randomUUID();

      orgPlayers.push({
        id: orgPlayerId,
        organizationId,
        teamId,
        ign: player.name,
        photoUrl: playerPhotoUrl,
        source: PlayerSource.MANUAL,
        isActive: true,
        createdAt,
        updatedAt: createdAt,
      });
      rosterEntries.push({
        id: randomUUID(),
        teamId,
        playerId: orgPlayerId,
        startAt: createdAt,
        isActive: true,
        createdAt,
      });
      globalPlayers.push({
        id: globalPlayerId,
        ign: player.name,
        teamId,
        createdAt,
        updatedAt: createdAt,
      });
      tournamentPlayers.push({
        id: randomUUID(),
        playerId: globalPlayerId,
        ignOverride: player.name,
        lineupType: TournamentRosterLineupType.MAIN,
        createdAt,
        updatedAt: createdAt,
      });
    }

    for (const player of players.subs) {
      const orgPlayerId = randomUUID();
      const globalPlayerId = randomUUID();

      orgPlayers.push({
        id: orgPlayerId,
        organizationId,
        teamId,
        ign: player.name,
        photoUrl: playerPhotoUrl,
        source: PlayerSource.MANUAL,
        isActive: true,
        createdAt,
        updatedAt: createdAt,
      });
      rosterEntries.push({
        id: randomUUID(),
        teamId,
        playerId: orgPlayerId,
        startAt: createdAt,
        isActive: true,
        createdAt,
      });
      globalPlayers.push({
        id: globalPlayerId,
        ign: player.name,
        teamId,
        createdAt,
        updatedAt: createdAt,
      });
      tournamentPlayers.push({
        id: randomUUID(),
        playerId: globalPlayerId,
        ignOverride: player.name,
        lineupType: TournamentRosterLineupType.SUBSTITUTE,
        createdAt,
        updatedAt: createdAt,
      });
    }

    return {
      orgPlayers,
      rosterEntries,
      globalPlayers,
      tournamentPlayers,
    };
  }
}
