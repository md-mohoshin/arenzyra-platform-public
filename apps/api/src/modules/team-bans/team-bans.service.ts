import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LobbyStatus,
  MatchStatus,
  Prisma,
  SessionRegistrationStatus,
  TeamBanScope,
} from '@prisma/client';
import type { Actor } from '../../common/auth/jwt.strategy';
import { effectiveOrganizationId } from '../../common/org/org.util';
import { PrismaService } from '../../db/prisma.service';
import { CreateManagerBanDto } from './dto/create-manager-ban.dto';
import { CreateTeamBanDto } from './dto/create-team-ban.dto';
import { ListManagerBansDto } from './dto/list-manager-bans.dto';
import { ListTeamBansDto } from './dto/list-team-bans.dto';
import { NoShowTeamBansDto } from './dto/no-show-team-bans.dto';
import { RevokeTeamBanDto } from './dto/revoke-team-ban.dto';

const teamBanSelect = {
  id: true,
  organizationId: true,
  teamId: true,
  scope: true,
  sessionId: true,
  matchId: true,
  reason: true,
  note: true,
  expiresAt: true,
  revokedAt: true,
  revokeReason: true,
  createdAt: true,
  updatedAt: true,
  team: { select: { id: true, name: true, tag: true, logoUrl: true } },
  session: { select: { id: true, name: true, status: true } },
  match: { select: { id: true, name: true, matchNumber: true, status: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  revokedBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.TeamBanSelect;

type TeamBanRecord = Prisma.TeamBanGetPayload<{ select: typeof teamBanSelect }>;

const managerBanSelect = {
  id: true,
  organizationId: true,
  discordUserId: true,
  discordUsername: true,
  displayName: true,
  scope: true,
  sessionId: true,
  matchId: true,
  reason: true,
  note: true,
  expiresAt: true,
  revokedAt: true,
  revokeReason: true,
  createdAt: true,
  updatedAt: true,
  session: { select: { id: true, name: true, status: true } },
  match: { select: { id: true, name: true, matchNumber: true, status: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  revokedBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.ManagerBanSelect;

type ManagerBanRecord = Prisma.ManagerBanGetPayload<{
  select: typeof managerBanSelect;
}>;

type ManagerBanTarget = {
  discordUserId: string;
  discordUsername: string | null;
  displayName: string | null;
};

type NoShowBanMatch = {
  id: string;
  name: string | null;
  matchNumber: number | null;
  status: MatchStatus;
  updatedAt: Date;
  endedAt: Date | null;
  startedAt: Date | null;
  scheduledAt: Date | null;
};

type NoShowBanTeam = {
  teamId: string;
  slotNumber: number;
  team: {
    id: string;
    name: string;
    tag: string | null;
    logoUrl: string | null;
  };
  missedMatches: Array<{
    matchId: string;
    matchNumber: number | null;
    matchName: string | null;
    slotNumber: number;
  }>;
  managers: ManagerBanTarget[];
  alreadyBanned: boolean;
};

type NoShowCandidateRow = {
  teamId: string | null;
  slotNumber: number;
  matchId: string;
  matchNumber: number | null;
  matchName: string | null;
  team: {
    id: string;
    name: string;
    tag: string | null;
    logoUrl: string | null;
  } | null;
};

type NoShowSnapshotContext = {
  match: NoShowBanMatch;
  rows: NoShowCandidateRow[];
  fromSnapshot: boolean;
};

@Injectable()
export class TeamBansService {
  constructor(private readonly prisma: PrismaService) {}

  private requireOrg(actor: Actor) {
    const organizationId = effectiveOrganizationId(actor);
    if (!organizationId) {
      throw new ForbiddenException('Organization context missing');
    }
    return organizationId;
  }

  private actorId(actor: Actor) {
    return actor.actorId ?? actor.id ?? null;
  }

  private clean(value: string | null | undefined) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed.length > 0 ? trimmed : null;
  }

  private parseExpiresAt(value: string | null | undefined) {
    const cleaned = this.clean(value);
    if (!cleaned) return null;
    const date = new Date(cleaned);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('expiresAt must be a valid date');
    }
    if (date.getTime() <= Date.now()) {
      throw new BadRequestException('expiresAt must be in the future');
    }
    return date;
  }

  private normalizeNoShowScope(scope: TeamBanScope | null | undefined) {
    return scope === TeamBanScope.TEAM || scope === TeamBanScope.MATCH
      ? scope
      : TeamBanScope.SESSION;
  }

  private matchLabel(match: Pick<NoShowBanMatch, 'name' | 'matchNumber'>) {
    return (
      match.name?.trim() ||
      (match.matchNumber ? `Match ${match.matchNumber}` : 'Match')
    );
  }

  private noShowMatchSortTime(match: NoShowBanMatch) {
    return (
      match.endedAt?.getTime() ??
      match.startedAt?.getTime() ??
      match.updatedAt.getTime() ??
      match.scheduledAt?.getTime() ??
      0
    );
  }

  private activeWhere(now = new Date()) {
    return {
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    };
  }

  private assertScopeTarget(
    scope: TeamBanScope,
    target: { sessionId?: string | null; matchId?: string | null },
  ) {
    if (scope === TeamBanScope.TEAM) {
      if (target.sessionId || target.matchId) {
        throw new BadRequestException(
          'Team-wide bans cannot include a session or match',
        );
      }
      return;
    }

    if (scope === TeamBanScope.SESSION && !target.sessionId) {
      throw new BadRequestException('sessionId is required for scrim bans');
    }

    if (scope === TeamBanScope.MATCH && !target.matchId) {
      throw new BadRequestException('matchId is required for match bans');
    }
  }

  private async getTeam(organizationId: string, teamId: string) {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!team) {
      throw new NotFoundException('Team not found');
    }
    return team;
  }

  private async getSession(organizationId: string, sessionId: string) {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, organizationId, deletedAt: null },
      select: { id: true, discordConfig: { select: { id: true } } },
    });
    if (!session) {
      throw new NotFoundException('Scrim session not found');
    }
    if (!session.discordConfig) {
      throw new BadRequestException(
        'Discord bans only support Discord scrim sessions',
      );
    }
    return session;
  }

  private async getMatch(organizationId: string, matchId: string) {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, organizationId, deletedAt: null },
      select: {
        id: true,
        sessionId: true,
        session: { select: { discordConfig: { select: { id: true } } } },
      },
    });
    if (!match) {
      throw new NotFoundException('Match not found');
    }
    if (!match.sessionId || !match.session?.discordConfig) {
      throw new BadRequestException(
        'Discord match bans only support Discord scrim matches. Use manual production controls for production matches.',
      );
    }
    return match;
  }

  private map(record: TeamBanRecord) {
    const active =
      !record.revokedAt &&
      (!record.expiresAt || record.expiresAt.getTime() > Date.now());
    return { ...record, active };
  }

  private mapManagerBan(record: ManagerBanRecord) {
    const active =
      !record.revokedAt &&
      (!record.expiresAt || record.expiresAt.getTime() > Date.now());
    return { ...record, active };
  }

  private cleanDiscordUserId(value: string | null | undefined) {
    const cleaned = this.clean(value)?.replace(/[<@!>]/g, '') ?? null;
    return cleaned && /^\d{15,25}$/.test(cleaned) ? cleaned : null;
  }

  private async managerBanTargetsFromTeam(
    organizationId: string,
    teamId: string,
    sessionId?: string | null,
  ): Promise<ManagerBanTarget[]> {
    await this.getTeam(organizationId, teamId);
    const members = await this.prisma.teamMember.findMany({
      where: {
        organizationId,
        teamId,
        deletedAt: null,
        leftAt: null,
      },
      select: {
        discordUserId: true,
        discordUsername: true,
        displayName: true,
        role: true,
        createdAt: true,
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    const leaders = members.filter((member) => member.role === 'LEADER');
    const selected = leaders.length ? leaders : members;
    const unique = new Map<string, ManagerBanTarget>();
    const add = (
      discordUserId: string | null | undefined,
      discordUsername?: string | null,
      displayName?: string | null,
    ) => {
      const cleaned = this.cleanDiscordUserId(discordUserId);
      if (!cleaned || unique.has(cleaned)) return;
      unique.set(cleaned, {
        discordUserId: cleaned,
        discordUsername: this.clean(discordUsername) ?? null,
        displayName: this.clean(displayName) ?? null,
      });
    };
    for (const member of selected) {
      add(member.discordUserId, member.discordUsername, member.displayName);
    }
    if (sessionId) {
      const registration = await this.prisma.sessionRegistration.findFirst({
        where: {
          organizationId,
          sessionId,
          teamId,
          deletedAt: null,
          status: { not: SessionRegistrationStatus.REMOVED },
        },
        select: {
          leaderDiscordUserId: true,
          managerDiscordUserIds: true,
        },
      });
      add(registration?.leaderDiscordUserId, null, null);
      for (const managerId of registration?.managerDiscordUserIds ?? []) {
        add(managerId, null, null);
      }
    }
    return [...unique.values()];
  }

  private cleanDiscordUserIdSet(values: string[] | null | undefined) {
    if (!Array.isArray(values)) {
      return null;
    }
    const ids = values
      .map((value) => this.cleanDiscordUserId(value))
      .filter((value): value is string => Boolean(value));
    return new Set(ids);
  }

  private cleanTeamIdSet(values: string[] | null | undefined) {
    if (!Array.isArray(values)) {
      return null;
    }
    const ids = values
      .map((value) => this.clean(value))
      .filter((value): value is string => Boolean(value));
    return new Set(ids);
  }

  private filterManagerTargets(
    managers: ManagerBanTarget[],
    selectedManagerIds: Set<string> | null,
  ) {
    if (!selectedManagerIds) {
      return managers;
    }
    return managers.filter((manager) =>
      selectedManagerIds.has(manager.discordUserId),
    );
  }

  private async noShowManagersForTeam(
    organizationId: string,
    teamId: string,
    sessionId: string,
    selectedManagerIds: Set<string> | null,
  ) {
    return this.filterManagerTargets(
      await this.managerBanTargetsFromTeam(organizationId, teamId, sessionId),
      selectedManagerIds,
    );
  }

  private async managerBanTargets(
    organizationId: string,
    dto: CreateManagerBanDto,
  ): Promise<ManagerBanTarget[]> {
    const targets = new Map<string, ManagerBanTarget>();
    const add = (
      discordUserId: string | null,
      discordUsername?: string | null,
      displayName?: string | null,
    ) => {
      if (!discordUserId || targets.has(discordUserId)) return;
      targets.set(discordUserId, {
        discordUserId,
        discordUsername: this.clean(discordUsername) ?? null,
        displayName: this.clean(displayName) ?? null,
      });
    };

    add(
      this.cleanDiscordUserId(dto.discordUserId),
      dto.discordUsername,
      dto.displayName,
    );
    for (const discordUserId of dto.discordUserIds ?? []) {
      add(this.cleanDiscordUserId(discordUserId), null, null);
    }
    const teamId = this.clean(dto.teamId);
    if (teamId) {
      for (const target of await this.managerBanTargetsFromTeam(
        organizationId,
        teamId,
      )) {
        add(target.discordUserId, target.discordUsername, target.displayName);
      }
    }
    return [...targets.values()];
  }

  private async createManagerBansForTeam(
    organizationId: string,
    teamId: string,
    scope: TeamBanScope,
    target: { sessionId: string | null; matchId: string | null },
    reason: string,
    note: string | null,
    expiresAt: Date | null,
    actorId: string | null,
    selectedManagerIds: Set<string> | null = null,
  ) {
    const managers = this.filterManagerTargets(
      await this.managerBanTargetsFromTeam(
        organizationId,
        teamId,
        target.sessionId,
      ),
      selectedManagerIds,
    );
    let created = 0;
    for (const manager of managers) {
      const duplicate = await this.prisma.managerBan.findFirst({
        where: {
          organizationId,
          discordUserId: manager.discordUserId,
          scope,
          sessionId: target.sessionId,
          matchId: target.matchId,
          ...this.activeWhere(),
        },
        select: { id: true },
      });
      if (duplicate) {
        continue;
      }
      await this.prisma.managerBan.create({
        data: {
          organizationId,
          discordUserId: manager.discordUserId,
          discordUsername: manager.discordUsername,
          displayName: manager.displayName,
          scope,
          sessionId: target.sessionId,
          matchId: target.matchId,
          reason,
          note,
          expiresAt,
          createdById: actorId,
        },
      });
      created += 1;
    }
    return created;
  }

  private async getDiscordSessionForNoShowBans(
    organizationId: string,
    sessionId: string,
  ) {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, organizationId, deletedAt: null },
      select: {
        id: true,
        name: true,
        status: true,
        discordConfig: { select: { id: true } },
      },
    });
    if (!session) {
      throw new NotFoundException('Scrim session not found');
    }
    if (!session.discordConfig) {
      throw new BadRequestException(
        'No-show bans only support Discord scrim sessions',
      );
    }
    return session;
  }

  private async resolveNoShowMatch(
    organizationId: string,
    dto: NoShowTeamBansDto,
  ): Promise<NoShowBanMatch> {
    const matchSelect = {
      id: true,
      name: true,
      matchNumber: true,
      status: true,
      updatedAt: true,
      endedAt: true,
      startedAt: true,
      scheduledAt: true,
    } satisfies Prisma.MatchSelect;

    if (this.clean(dto.matchId)) {
      const match = await this.prisma.match.findFirst({
        where: {
          id: this.clean(dto.matchId) ?? undefined,
          organizationId,
          sessionId: dto.sessionId,
          deletedAt: null,
        },
        select: matchSelect,
      });
      if (!match) {
        throw new NotFoundException('Match not found');
      }
      return match;
    }

    if (Number.isInteger(dto.matchNumber) && Number(dto.matchNumber) > 0) {
      const match = await this.prisma.match.findFirst({
        where: {
          organizationId,
          sessionId: dto.sessionId,
          matchNumber: Number(dto.matchNumber),
          deletedAt: null,
        },
        select: matchSelect,
      });
      if (!match) {
        throw new NotFoundException('Match not found');
      }
      return match;
    }

    const rows = await this.prisma.matchSlotResult.findMany({
      where: {
        organizationId,
        teamId: { not: null },
        wasPresentInMatch: false,
        match: { sessionId: dto.sessionId, deletedAt: null },
      },
      select: {
        match: { select: matchSelect },
      },
      take: 250,
    });
    const matches = new Map<string, NoShowBanMatch>();
    for (const row of rows) {
      matches.set(row.match.id, row.match);
    }
    const latest = Array.from(matches.values()).sort((left, right) => {
      const numberSort = (right.matchNumber ?? 0) - (left.matchNumber ?? 0);
      if (numberSort !== 0) {
        return numberSort;
      }
      return this.noShowMatchSortTime(right) - this.noShowMatchSortTime(left);
    })[0];
    if (!latest) {
      throw new BadRequestException(
        'No no-show teams found for this scrim. Apply results with no-shows first.',
      );
    }
    return latest;
  }

  private async currentNoShowRows(organizationId: string, matchId: string) {
    const rows = await this.prisma.matchSlotResult.findMany({
      where: {
        organizationId,
        matchId,
        teamId: { not: null },
        wasPresentInMatch: false,
      },
      select: {
        teamId: true,
        slotNumber: true,
        team: { select: { id: true, name: true, tag: true, logoUrl: true } },
        match: { select: { id: true, matchNumber: true, name: true } },
      },
      orderBy: [{ slotNumber: 'asc' }],
    });
    return this.mapCurrentNoShowRows(rows);
  }

  private async currentSessionNoShowRows(
    organizationId: string,
    sessionId: string,
  ) {
    const rows = await this.prisma.matchSlotResult.findMany({
      where: {
        organizationId,
        teamId: { not: null },
        wasPresentInMatch: false,
        match: { sessionId, deletedAt: null },
      },
      select: {
        teamId: true,
        slotNumber: true,
        team: { select: { id: true, name: true, tag: true, logoUrl: true } },
        match: { select: { id: true, matchNumber: true, name: true } },
      },
      orderBy: [{ match: { matchNumber: 'asc' } }, { slotNumber: 'asc' }],
    });
    return this.mapCurrentNoShowRows(rows);
  }

  private mapCurrentNoShowRows(
    rows: Array<{
      teamId: string | null;
      slotNumber: number;
      team: {
        id: string;
        name: string;
        tag: string | null;
        logoUrl: string | null;
      } | null;
      match: {
        id: string;
        matchNumber: number | null;
        name: string | null;
      };
    }>,
  ): NoShowCandidateRow[] {
    return rows.map((row) => ({
      teamId: row.teamId,
      slotNumber: row.slotNumber,
      matchId: row.match.id,
      matchNumber: row.match.matchNumber,
      matchName: row.match.name,
      team: row.team,
    }));
  }

  private sessionNoShowMatch(session: {
    id: string;
    name: string | null;
  }): NoShowBanMatch {
    const now = new Date();
    return {
      id: `session:${session.id}:no-shows`,
      name: session.name ? `${session.name} no-shows` : 'All no-show matches',
      matchNumber: null,
      status: MatchStatus.FINISHED,
      updatedAt: now,
      endedAt: now,
      startedAt: null,
      scheduledAt: null,
    };
  }

  private async noShowSnapshotContext(
    organizationId: string,
    session: { id: string; name: string | null },
    dto: NoShowTeamBansDto,
  ): Promise<NoShowSnapshotContext | null> {
    const sourceMatchId = this.clean(dto.matchId);
    const matchNumber =
      Number.isInteger(dto.matchNumber) && Number(dto.matchNumber) > 0
        ? Number(dto.matchNumber)
        : null;
    const latest = await this.prisma.noShowBanSnapshot.findFirst({
      where: {
        organizationId,
        sessionId: dto.sessionId,
        ...(sourceMatchId ? { sourceMatchId } : {}),
        ...(matchNumber ? { matchNumber } : {}),
      },
      select: {
        sourceMatchId: true,
        matchNumber: true,
        matchName: true,
        capturedAt: true,
      },
      orderBy: [
        { capturedAt: 'desc' },
        { matchNumber: 'desc' },
        { slotNumber: 'asc' },
      ],
    });
    if (!latest) {
      return null;
    }

    const snapshotRows = await this.prisma.noShowBanSnapshot.findMany({
      where: {
        organizationId,
        sessionId: dto.sessionId,
        ...(sourceMatchId ? { sourceMatchId } : {}),
        ...(matchNumber ? { matchNumber } : {}),
      },
      select: {
        sourceMatchId: true,
        matchNumber: true,
        matchName: true,
        teamId: true,
        teamName: true,
        teamTag: true,
        slotNumber: true,
      },
      orderBy: [{ matchNumber: 'asc' }, { slotNumber: 'asc' }],
    });
    if (!snapshotRows.length) {
      return null;
    }

    const teamIds = [...new Set(snapshotRows.map((row) => row.teamId))];
    const currentTeams = await this.prisma.team.findMany({
      where: {
        organizationId,
        id: { in: teamIds },
        deletedAt: null,
      },
      select: { id: true, name: true, tag: true, logoUrl: true },
    });
    const teamById = new Map(currentTeams.map((team) => [team.id, team]));
    const rows = snapshotRows
      .map((row) => {
        const team = teamById.get(row.teamId);
        if (!team) {
          return null;
        }
        return {
          teamId: row.teamId,
          slotNumber: row.slotNumber,
          matchId:
            row.sourceMatchId ??
            `snapshot:${dto.sessionId}:${row.matchNumber ?? 'latest'}`,
          matchNumber: row.matchNumber,
          matchName: row.matchName,
          team,
        };
      })
      .filter(
        (
          row,
        ): row is {
          teamId: string;
          slotNumber: number;
          matchId: string;
          matchNumber: number | null;
          matchName: string | null;
          team: {
            id: string;
            name: string;
            tag: string | null;
            logoUrl: string | null;
          };
        } => Boolean(row),
      );
    if (!rows.length) {
      return null;
    }

    return {
      match:
        sourceMatchId || matchNumber
          ? {
              id:
                latest.sourceMatchId ??
                `snapshot:${dto.sessionId}:${latest.matchNumber ?? 'latest'}`,
              name: latest.matchName,
              matchNumber: latest.matchNumber,
              status: MatchStatus.FINISHED,
              updatedAt: latest.capturedAt,
              endedAt: latest.capturedAt,
              startedAt: null,
              scheduledAt: null,
            }
          : this.sessionNoShowMatch(session),
      rows,
      fromSnapshot: true,
    };
  }

  private async noShowBanCandidates(
    organizationId: string,
    dto: NoShowTeamBansDto,
  ) {
    const session = await this.getDiscordSessionForNoShowBans(
      organizationId,
      dto.sessionId,
    );
    const scope = this.normalizeNoShowScope(dto.scope);
    let match: NoShowBanMatch | null = null;
    let rows: NoShowSnapshotContext['rows'] = [];
    let fromSnapshot = false;
    const specificMatchRequested =
      Boolean(this.clean(dto.matchId)) ||
      (Number.isInteger(dto.matchNumber) && Number(dto.matchNumber) > 0);

    if (specificMatchRequested) {
      try {
        match = await this.resolveNoShowMatch(organizationId, dto);
        rows = await this.currentNoShowRows(organizationId, match.id);
      } catch (error) {
        if (
          !(error instanceof NotFoundException) &&
          !(error instanceof BadRequestException)
        ) {
          throw error;
        }
      }
    } else {
      rows = await this.currentSessionNoShowRows(organizationId, session.id);
      if (rows.length) {
        match = this.sessionNoShowMatch(session);
      }
    }

    if (!rows.length) {
      const snapshot = await this.noShowSnapshotContext(
        organizationId,
        session,
        dto,
      );
      if (snapshot) {
        match = snapshot.match;
        rows = snapshot.rows;
        fromSnapshot = snapshot.fromSnapshot;
      }
    }

    if (!match || !rows.length) {
      throw new BadRequestException(
        'No no-show teams found for this scrim. Apply results with no-shows first, or use a stored final-result snapshot.',
      );
    }
    if (fromSnapshot && scope === TeamBanScope.MATCH) {
      throw new BadRequestException(
        'That match was already cleaned up after final posting. Use scope=session or scope=team with the stored no-show snapshot.',
      );
    }

    const targetSessionId = scope === TeamBanScope.SESSION ? session.id : null;
    const targetMatchId = scope === TeamBanScope.MATCH ? match.id : null;

    const selectedTeamIds = this.cleanTeamIdSet(dto.teamIds);
    const selectedManagerIds = this.cleanDiscordUserIdSet(
      dto.managerDiscordUserIds,
    );
    const byTeamId = new Map<
      string,
      Omit<NoShowBanTeam, 'alreadyBanned' | 'managers'>
    >();
    for (const row of rows) {
      if (!row.teamId || !row.team) {
        continue;
      }
      if (selectedTeamIds && !selectedTeamIds.has(row.teamId)) {
        continue;
      }
      if (!byTeamId.has(row.teamId)) {
        byTeamId.set(row.teamId, {
          teamId: row.teamId,
          slotNumber: row.slotNumber,
          team: row.team,
          missedMatches: [],
        });
      }
      const existing = byTeamId.get(row.teamId);
      if (!existing) {
        continue;
      }
      if (
        !existing.missedMatches.some(
          (missed) =>
            missed.matchId === row.matchId &&
            missed.slotNumber === row.slotNumber,
        )
      ) {
        existing.missedMatches.push({
          matchId: row.matchId,
          matchNumber: row.matchNumber,
          matchName: row.matchName,
          slotNumber: row.slotNumber,
        });
      }
    }

    const teamIds = Array.from(byTeamId.keys());
    const activeBans = teamIds.length
      ? await this.prisma.teamBan.findMany({
          where: {
            organizationId,
            teamId: { in: teamIds },
            scope,
            sessionId: targetSessionId,
            matchId: targetMatchId,
            ...this.activeWhere(),
          },
          select: { teamId: true },
        })
      : [];
    const bannedTeamIds = new Set(activeBans.map((ban) => ban.teamId));
    const teams = await Promise.all(
      Array.from(byTeamId.values()).map(async (team) => ({
        ...team,
        managers: await this.noShowManagersForTeam(
          organizationId,
          team.teamId,
          session.id,
          selectedManagerIds,
        ),
        alreadyBanned: bannedTeamIds.has(team.teamId),
      })),
    );
    const reason =
      this.clean(dto.reason) ??
      `No-show in ${this.matchLabel(match)} (${session.name})`;
    return {
      session,
      match,
      scope,
      targetSessionId,
      targetMatchId,
      reason,
      note: this.clean(dto.note) ?? 'Created from Discord no-show command',
      expiresAt: this.parseExpiresAt(dto.expiresAt),
      teams,
    };
  }

  private noShowBanPreviewResponse(params: {
    session: { id: string; name: string | null; status: unknown };
    match: NoShowBanMatch;
    scope: TeamBanScope;
    reason: string;
    expiresAt: Date | null;
    teams: NoShowBanTeam[];
    created?: TeamBanRecord[];
    createdManagerBans?: number;
  }) {
    const creatableTeams = params.teams.filter((team) => !team.alreadyBanned);
    return {
      session: params.session,
      match: {
        id: params.match.id,
        name: params.match.name,
        matchNumber: params.match.matchNumber,
        status: params.match.status,
      },
      scope: params.scope,
      reason: params.reason,
      expiresAt: params.expiresAt?.toISOString() ?? null,
      teams: params.teams,
      noShowCount: params.teams.length,
      alreadyBannedCount: params.teams.length - creatableTeams.length,
      creatableCount: creatableTeams.length,
      createdCount: params.created?.length ?? 0,
      createdManagerBans: params.createdManagerBans ?? 0,
      createdBans: params.created?.map((record) => this.map(record)) ?? [],
    };
  }

  async previewNoShowBans(dto: NoShowTeamBansDto, actor: Actor) {
    const organizationId = this.requireOrg(actor);
    const context = await this.noShowBanCandidates(organizationId, dto);
    return this.noShowBanPreviewResponse(context);
  }

  async createNoShowBans(dto: NoShowTeamBansDto, actor: Actor) {
    const organizationId = this.requireOrg(actor);
    const actorId = this.actorId(actor);
    const context = await this.noShowBanCandidates(organizationId, dto);
    const created: TeamBanRecord[] = [];
    const selectedManagerIds = this.cleanDiscordUserIdSet(
      dto.managerDiscordUserIds,
    );
    let createdManagerBans = 0;

    for (const candidate of context.teams) {
      if (candidate.alreadyBanned) {
        continue;
      }
      this.assertScopeTarget(context.scope, {
        sessionId: context.targetSessionId,
        matchId: context.targetMatchId,
      });
      const duplicate = await this.prisma.teamBan.findFirst({
        where: {
          organizationId,
          teamId: candidate.teamId,
          scope: context.scope,
          sessionId: context.targetSessionId,
          matchId: context.targetMatchId,
          ...this.activeWhere(),
        },
        select: { id: true },
      });
      if (duplicate) {
        continue;
      }
      const record = await this.prisma.teamBan.create({
        data: {
          organizationId,
          teamId: candidate.teamId,
          scope: context.scope,
          sessionId: context.targetSessionId,
          matchId: context.targetMatchId,
          reason: context.reason,
          note: context.note,
          expiresAt: context.expiresAt,
          createdById: actorId,
        },
        select: teamBanSelect,
      });
      created.push(record);
      createdManagerBans += await this.createManagerBansForTeam(
        organizationId,
        candidate.teamId,
        context.scope,
        {
          sessionId: context.targetSessionId,
          matchId: context.targetMatchId,
        },
        context.reason,
        context.note,
        context.expiresAt,
        actorId,
        selectedManagerIds,
      );

      if (context.scope === TeamBanScope.TEAM) {
        await this.removeTeamFromDiscordSessions(
          organizationId,
          candidate.teamId,
          context.reason,
        );
      } else if (context.scope === TeamBanScope.SESSION) {
        await this.removeTeamFromSession(
          context.session.id,
          candidate.teamId,
          context.reason,
        );
      } else if (context.targetMatchId) {
        await this.removeTeamFromMatch(context.targetMatchId, candidate.teamId);
      }
    }

    return this.noShowBanPreviewResponse({
      ...context,
      created,
      createdManagerBans,
    });
  }

  async list(query: ListTeamBansDto, actor: Actor) {
    const organizationId = this.requireOrg(actor);
    const now = new Date();
    const where: Prisma.TeamBanWhereInput = {
      organizationId,
      teamId: this.clean(query.teamId) ?? undefined,
      sessionId: this.clean(query.sessionId) ?? undefined,
      matchId: this.clean(query.matchId) ?? undefined,
      scope: query.scope,
    };
    if (query.active === 'true') {
      Object.assign(where, this.activeWhere(now));
    } else if (query.active === 'false') {
      where.OR = [{ revokedAt: { not: null } }, { expiresAt: { lte: now } }];
    }

    const records = await this.prisma.teamBan.findMany({
      where,
      select: teamBanSelect,
      orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
      take: 250,
    });
    return records.map((record) => this.map(record));
  }

  async create(dto: CreateTeamBanDto, actor: Actor) {
    const organizationId = this.requireOrg(actor);
    const actorId = this.actorId(actor);
    const teamId = this.clean(dto.teamId);
    const reason = this.clean(dto.reason);
    if (!teamId) throw new BadRequestException('teamId is required');
    if (!reason) throw new BadRequestException('reason is required');
    await this.getTeam(organizationId, teamId);

    const matchIds =
      dto.scope === TeamBanScope.MATCH
        ? [
            ...new Set(
              [dto.matchId, ...(dto.matchIds ?? [])]
                .map((id) => this.clean(id))
                .filter((id): id is string => Boolean(id)),
            ),
          ]
        : [];
    const targets =
      dto.scope === TeamBanScope.MATCH
        ? matchIds.map((matchId) => ({ sessionId: null, matchId }))
        : [
            {
              sessionId: this.clean(dto.sessionId),
              matchId: this.clean(dto.matchId),
            },
          ];

    if (targets.length === 0) {
      throw new BadRequestException(
        'At least one match is required for match bans',
      );
    }

    const expiresAt = this.parseExpiresAt(dto.expiresAt);
    const created: TeamBanRecord[] = [];

    for (const target of targets) {
      this.assertScopeTarget(dto.scope, target);
      if (target.sessionId) {
        await this.getSession(organizationId, target.sessionId);
      }
      if (target.matchId) {
        await this.getMatch(organizationId, target.matchId);
      }

      const duplicate = await this.prisma.teamBan.findFirst({
        where: {
          organizationId,
          teamId,
          scope: dto.scope,
          sessionId: target.sessionId,
          matchId: target.matchId,
          ...this.activeWhere(),
        },
        select: { id: true },
      });
      if (duplicate) {
        if (targets.length === 1) {
          throw new ConflictException(
            'An active ban already exists for this scope',
          );
        }
        continue;
      }

      const record = await this.prisma.teamBan.create({
        data: {
          organizationId,
          teamId,
          scope: dto.scope,
          sessionId: target.sessionId,
          matchId: target.matchId,
          reason,
          note: this.clean(dto.note),
          expiresAt,
          createdById: actorId,
        },
        select: teamBanSelect,
      });
      created.push(record);
      await this.createManagerBansForTeam(
        organizationId,
        teamId,
        dto.scope,
        {
          sessionId: target.sessionId,
          matchId: target.matchId,
        },
        reason,
        this.clean(dto.note),
        expiresAt,
        actorId,
      );

      if (dto.scope === TeamBanScope.TEAM) {
        await this.removeTeamFromDiscordSessions(
          organizationId,
          teamId,
          reason,
        );
      }
      if (dto.scope === TeamBanScope.SESSION && target.sessionId) {
        await this.removeTeamFromSession(target.sessionId, teamId, reason);
      }
      if (dto.scope === TeamBanScope.MATCH && target.matchId) {
        await this.removeTeamFromMatch(target.matchId, teamId);
      }
    }

    return created.map((record) => this.map(record));
  }

  async listManagerBans(query: ListManagerBansDto, actor: Actor) {
    const organizationId = this.requireOrg(actor);
    const now = new Date();
    const where: Prisma.ManagerBanWhereInput = {
      organizationId,
      discordUserId: this.cleanDiscordUserId(query.discordUserId) ?? undefined,
      sessionId: this.clean(query.sessionId) ?? undefined,
      matchId: this.clean(query.matchId) ?? undefined,
      scope: query.scope,
    };
    if (query.active === 'true') {
      Object.assign(where, this.activeWhere(now));
    } else if (query.active === 'false') {
      where.OR = [{ revokedAt: { not: null } }, { expiresAt: { lte: now } }];
    }

    const records = await this.prisma.managerBan.findMany({
      where,
      select: managerBanSelect,
      orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
      take: 250,
    });
    return records.map((record) => this.mapManagerBan(record));
  }

  async createManagerBan(dto: CreateManagerBanDto, actor: Actor) {
    const organizationId = this.requireOrg(actor);
    const actorId = this.actorId(actor);
    const reason = this.clean(dto.reason);
    if (!reason) throw new BadRequestException('reason is required');

    const managerTargets = await this.managerBanTargets(organizationId, dto);
    if (!managerTargets.length) {
      throw new BadRequestException(
        'At least one manager Discord user or team manager is required',
      );
    }

    const matchIds =
      dto.scope === TeamBanScope.MATCH
        ? [
            ...new Set(
              [dto.matchId, ...(dto.matchIds ?? [])]
                .map((id) => this.clean(id))
                .filter((id): id is string => Boolean(id)),
            ),
          ]
        : [];
    const targets =
      dto.scope === TeamBanScope.MATCH
        ? matchIds.map((matchId) => ({ sessionId: null, matchId }))
        : [
            {
              sessionId: this.clean(dto.sessionId),
              matchId: this.clean(dto.matchId),
            },
          ];

    if (targets.length === 0) {
      throw new BadRequestException(
        'At least one match is required for match bans',
      );
    }

    const expiresAt = this.parseExpiresAt(dto.expiresAt);
    const created: ManagerBanRecord[] = [];

    for (const target of targets) {
      this.assertScopeTarget(dto.scope, target);
      if (target.sessionId) {
        await this.getSession(organizationId, target.sessionId);
      }
      if (target.matchId) {
        await this.getMatch(organizationId, target.matchId);
      }

      for (const manager of managerTargets) {
        const duplicate = await this.prisma.managerBan.findFirst({
          where: {
            organizationId,
            discordUserId: manager.discordUserId,
            scope: dto.scope,
            sessionId: target.sessionId,
            matchId: target.matchId,
            ...this.activeWhere(),
          },
          select: { id: true },
        });
        if (duplicate) {
          if (targets.length === 1 && managerTargets.length === 1) {
            throw new ConflictException(
              'An active manager ban already exists for this scope',
            );
          }
          continue;
        }

        const record = await this.prisma.managerBan.create({
          data: {
            organizationId,
            discordUserId: manager.discordUserId,
            discordUsername: manager.discordUsername,
            displayName: manager.displayName,
            scope: dto.scope,
            sessionId: target.sessionId,
            matchId: target.matchId,
            reason,
            note: this.clean(dto.note),
            expiresAt,
            createdById: actorId,
          },
          select: managerBanSelect,
        });
        created.push(record);
      }
    }

    return created.map((record) => this.mapManagerBan(record));
  }

  async revokeManagerBan(id: string, dto: RevokeTeamBanDto, actor: Actor) {
    const organizationId = this.requireOrg(actor);
    const existing = await this.prisma.managerBan.findFirst({
      where: { id, organizationId },
      select: { id: true, revokedAt: true },
    });
    if (!existing) {
      throw new NotFoundException('Manager ban not found');
    }
    if (existing.revokedAt) {
      throw new ConflictException('Manager ban is already revoked');
    }
    const updated = await this.prisma.managerBan.update({
      where: { id },
      data: {
        revokedAt: new Date(),
        revokedById: this.actorId(actor),
        revokeReason: this.clean(dto.reason),
      },
      select: managerBanSelect,
    });
    return this.mapManagerBan(updated);
  }

  async revoke(id: string, dto: RevokeTeamBanDto, actor: Actor) {
    const organizationId = this.requireOrg(actor);
    const existing = await this.prisma.teamBan.findFirst({
      where: { id, organizationId },
      select: { id: true, revokedAt: true },
    });
    if (!existing) {
      throw new NotFoundException('Team ban not found');
    }
    if (existing.revokedAt) {
      throw new ConflictException('Team ban is already revoked');
    }
    const updated = await this.prisma.teamBan.update({
      where: { id },
      data: {
        revokedAt: new Date(),
        revokedById: this.actorId(actor),
        revokeReason: this.clean(dto.reason),
      },
      select: teamBanSelect,
    });
    return this.map(updated);
  }

  private async removeTeamFromDiscordSessions(
    organizationId: string,
    teamId: string,
    reason: string,
  ) {
    const discordSessions = await this.prisma.session.findMany({
      where: {
        organizationId,
        deletedAt: null,
        discordConfig: { isNot: null },
      },
      select: { id: true },
    });
    const sessionIds = discordSessions.map((session) => session.id);
    if (sessionIds.length === 0) {
      return;
    }

    const registrations = await this.prisma.sessionRegistration.findMany({
      where: {
        organizationId,
        teamId,
        deletedAt: null,
        sessionId: { in: sessionIds },
      },
      select: { sessionId: true },
      distinct: ['sessionId'],
    });
    const registeredSessionIds = registrations.map(
      (registration) => registration.sessionId,
    );

    const removedAt = new Date();
    if (registeredSessionIds.length > 0) {
      await this.prisma.sessionRegistration.updateMany({
        where: {
          organizationId,
          teamId,
          deletedAt: null,
          sessionId: { in: registeredSessionIds },
        },
        data: {
          status: SessionRegistrationStatus.REMOVED,
          slotNumber: null,
          waitlistPosition: null,
          removedAt,
          removalReason: `Discord team ban: ${reason}`,
          deletedAt: removedAt,
        },
      });
    }

    for (const registration of registrations) {
      await this.repackSessionWaitlist(registration.sessionId);
    }

    const discordMatches = await this.prisma.match.findMany({
      where: {
        organizationId,
        deletedAt: null,
        sessionId: { in: sessionIds },
        status: {
          in: [MatchStatus.DRAFT, MatchStatus.LIVE, MatchStatus.FINISH_PENDING],
        },
      },
      select: { id: true },
    });
    const matchIds = discordMatches.map((match) => match.id);
    if (matchIds.length === 0) {
      return;
    }

    const activeMatchWhere = {
      matchId: { in: matchIds },
      teamId,
      deletedAt: null,
    };

    await this.prisma.matchTeam.updateMany({
      where: activeMatchWhere,
      data: { deletedAt: removedAt },
    });
    await this.prisma.matchSlot.updateMany({
      where: activeMatchWhere,
      data: {
        teamId: null,
        lobbyStatus: LobbyStatus.EMPTY,
        playersInLobby: 0,
      },
    });
  }

  private async removeTeamFromSession(
    sessionId: string,
    teamId: string,
    reason: string,
  ) {
    const removedAt = new Date();
    await this.prisma.sessionRegistration.updateMany({
      where: {
        sessionId,
        teamId,
        deletedAt: null,
      },
      data: {
        status: SessionRegistrationStatus.REMOVED,
        slotNumber: null,
        waitlistPosition: null,
        removedAt,
        removalReason: `Banned: ${reason}`,
        deletedAt: removedAt,
      },
    });
    await this.repackSessionWaitlist(sessionId);
  }

  private async repackSessionWaitlist(sessionId: string) {
    const waitlist = await this.prisma.sessionRegistration.findMany({
      where: {
        sessionId,
        deletedAt: null,
        status: SessionRegistrationStatus.WAITLIST,
      },
      select: { id: true, waitlistPosition: true },
      orderBy: [{ waitlistPosition: 'asc' }, { createdAt: 'asc' }],
    });
    for (const [index, registration] of waitlist.entries()) {
      const position = index + 1;
      if (registration.waitlistPosition !== position) {
        await this.prisma.sessionRegistration.update({
          where: { id: registration.id },
          data: { waitlistPosition: position },
        });
      }
    }
  }

  private async removeTeamFromMatch(matchId: string, teamId: string) {
    const removedAt = new Date();
    await this.prisma.matchTeam.updateMany({
      where: { matchId, teamId, deletedAt: null },
      data: { deletedAt: removedAt },
    });
    await this.prisma.matchSlot.updateMany({
      where: { matchId, teamId, deletedAt: null },
      data: {
        teamId: null,
        lobbyStatus: LobbyStatus.EMPTY,
        playersInLobby: 0,
      },
    });
  }
}
