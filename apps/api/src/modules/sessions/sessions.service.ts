import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  Prisma,
  Role,
  SessionRegistrationStatus,
  SessionStatus,
  SessionType,
} from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth.types';
import { effectiveOrganizationId } from '../../common/org/org.util';
import { PrismaService } from '../../db/prisma.service';
import {
  MatchesService,
  type SessionMatchCreatePayload,
} from '../matches/matches.service';
import { AdaptersService } from '../adapters/adapters.service';
import { AuditService } from '../audit/audit.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { RegisterSessionTeamDto } from './dto/register-session-team.dto';
import { RemoveSessionRegistrationDto } from './dto/remove-session-registration.dto';
import { ListSessionRegistrationsDto } from './dto/list-session-registrations.dto';

type Actor = AuthUser;

const sessionSelect = {
  id: true,
  organizationId: true,
  name: true,
  slug: true,
  type: true,
  status: true,
  description: true,
  rulesetId: true,
  gameId: true,
  adapterKey: true,
  maxTeams: true,
  slotCount: true,
  waitlistEnabled: true,
  checkInEnabled: true,
  registrationOpenAt: true,
  registrationCloseAt: true,
  checkInOpenAt: true,
  checkInCloseAt: true,
  startsAt: true,
  endedAt: true,
  createdById: true,
  updatedById: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} satisfies Prisma.SessionSelect;

const sessionRegistrationSelect = {
  id: true,
  organizationId: true,
  sessionId: true,
  teamId: true,
  status: true,
  slotNumber: true,
  waitlistPosition: true,
  checkedInAt: true,
  confirmedAt: true,
  removedAt: true,
  removalReason: true,
  note: true,
  registeredById: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  team: {
    select: {
      id: true,
      name: true,
      tag: true,
      logoUrl: true,
      countryCode: true,
      region: true,
    },
  },
} satisfies Prisma.SessionRegistrationSelect;

type SessionRecord = Prisma.SessionGetPayload<{ select: typeof sessionSelect }>;
type SessionRegistrationRecord = Prisma.SessionRegistrationGetPayload<{
  select: typeof sessionRegistrationSelect;
}>;

const activeSessionRegistrationSelect = {
  id: true,
  teamId: true,
  status: true,
  slotNumber: true,
  waitlistPosition: true,
  deletedAt: true,
  createdAt: true,
} satisfies Prisma.SessionRegistrationSelect;

type ActiveSessionRegistrationRecord = Prisma.SessionRegistrationGetPayload<{
  select: typeof activeSessionRegistrationSelect;
}>;

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matches: MatchesService,
    private readonly adapters: AdaptersService,
    private readonly audit: AuditService,
  ) {}

  requireOrganizerRole(actor: Actor | null | undefined) {
    const role = actor?.actorRole ?? actor?.role ?? null;
    const actingOrg = actor?.actingOrgId ?? null;
    if (role === Role.SUPER_ADMIN) {
      if (!actingOrg) {
        throw new ForbiddenException(
          'Organization context missing for SUPER_ADMIN; impersonation required',
        );
      }
      return;
    }
    if (role !== Role.ORGANIZER) {
      throw new ForbiddenException('Organizer role required');
    }
  }

  private requireOrg(actor: Actor | null | undefined) {
    this.requireOrganizerRole(actor);
    const orgId = effectiveOrganizationId(actor);
    if (!orgId) {
      throw new ForbiddenException('organizationId is required');
    }
    return orgId;
  }

  private actorId(actor: Actor | null | undefined) {
    return actor?.actorId ?? actor?.id ?? null;
  }

  private cleanString(value: string | null | undefined) {
    if (value === null || value === undefined) return null;
    const trimmed = `${value}`.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private cleanSlug(value: string | null | undefined) {
    const trimmed = this.cleanString(value);
    return trimmed ? trimmed.toLowerCase() : null;
  }

  private async resolveGameKey(gameId: string | null | undefined) {
    const normalizedGameId = this.cleanString(gameId);
    if (!normalizedGameId) return null;
    const game = await this.prisma.game.findUnique({
      where: { id: normalizedGameId },
      select: { key: true },
    });
    if (!game) {
      throw new BadRequestException(`Invalid gameId: ${normalizedGameId}`);
    }
    return game.key;
  }

  private async validateAdapterKey(
    adapterKey: string | null | undefined,
    gameId: string | null | undefined,
  ) {
    const normalizedAdapterKey = this.cleanString(adapterKey);
    const gameKey = await this.resolveGameKey(gameId);
    if (!normalizedAdapterKey) return null;
    const adapter = this.adapters.getAdapterByKey(normalizedAdapterKey);
    if (!adapter) {
      throw new BadRequestException(
        `Unknown adapterKey: ${normalizedAdapterKey}`,
      );
    }
    if (!gameKey) {
      throw new BadRequestException(
        'gameId is required when adapterKey is provided',
      );
    }
    if (adapter.gameKey !== gameKey) {
      throw new BadRequestException(
        `adapterKey ${adapter.key} is not valid for gameKey ${gameKey}`,
      );
    }
    return adapter.key;
  }

  private parseDate(
    field: string,
    value: string | null | undefined,
  ): Date | null | undefined {
    if (value === undefined) return undefined;
    const trimmed = this.cleanString(value);
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} must be a valid date`);
    }
    return parsed;
  }

  private validateCapacity(maxTeams: number, slotCount: number) {
    if (!Number.isInteger(maxTeams) || maxTeams < 1) {
      throw new BadRequestException('maxTeams must be a positive integer');
    }
    if (!Number.isInteger(slotCount) || slotCount < 1) {
      throw new BadRequestException('slotCount must be a positive integer');
    }
    if (slotCount > maxTeams) {
      throw new BadRequestException('slotCount cannot exceed maxTeams');
    }
  }

  private validateDateRange(
    start: Date | null | undefined,
    end: Date | null | undefined,
    startLabel: string,
    endLabel: string,
  ) {
    if (start && end && start > end) {
      throw new BadRequestException(`${endLabel} must be after ${startLabel}`);
    }
  }

  private buildSessionResponse(
    session: SessionRecord,
    counts: {
      confirmedCount: number;
      waitlistCount: number;
      totalRegisteredCount: number;
    },
  ) {
    return {
      id: session.id,
      name: session.name,
      slug: session.slug,
      type: session.type,
      status: session.status,
      description: session.description,
      rulesetId: session.rulesetId,
      gameId: session.gameId,
      adapterKey: session.adapterKey,
      maxTeams: session.maxTeams,
      slotCount: session.slotCount,
      waitlistEnabled: session.waitlistEnabled,
      checkInEnabled: session.checkInEnabled,
      registrationOpenAt: session.registrationOpenAt,
      registrationCloseAt: session.registrationCloseAt,
      checkInOpenAt: session.checkInOpenAt,
      checkInCloseAt: session.checkInCloseAt,
      startsAt: session.startsAt,
      endedAt: session.endedAt,
      createdById: session.createdById,
      updatedById: session.updatedById,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      counts,
    };
  }

  private buildRegistrationResponse(registration: SessionRegistrationRecord) {
    return {
      id: registration.id,
      teamId: registration.teamId,
      status: registration.status,
      slotNumber: registration.slotNumber,
      waitlistPosition: registration.waitlistPosition,
      checkedInAt: registration.checkedInAt,
      confirmedAt: registration.confirmedAt,
      removedAt: registration.removedAt,
      removalReason: registration.removalReason,
      note: registration.note,
      createdAt: registration.createdAt,
      updatedAt: registration.updatedAt,
      team: registration.team
        ? {
            id: registration.team.id,
            name: registration.team.name,
            tag: registration.team.tag,
            logoUrl: registration.team.logoUrl,
            countryCode: registration.team.countryCode,
            region: registration.team.region,
          }
        : null,
    };
  }

  private async getSessionCounts(
    sessionIds: string[],
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const counts = new Map<
      string,
      {
        confirmedCount: number;
        waitlistCount: number;
        totalRegisteredCount: number;
      }
    >();
    if (sessionIds.length === 0) return counts;

    for (const sessionId of sessionIds) {
      counts.set(sessionId, {
        confirmedCount: 0,
        waitlistCount: 0,
        totalRegisteredCount: 0,
      });
    }

    const rows = await client.sessionRegistration.findMany({
      where: {
        sessionId: { in: sessionIds },
        deletedAt: null,
      },
      select: {
        sessionId: true,
        slotNumber: true,
        waitlistPosition: true,
      },
    });

    for (const row of rows) {
      const entry = counts.get(row.sessionId);
      if (!entry) continue;
      entry.totalRegisteredCount += 1;
      if (row.slotNumber !== null) {
        entry.confirmedCount += 1;
      } else if (row.waitlistPosition !== null) {
        entry.waitlistCount += 1;
      }
    }

    return counts;
  }

  private async getSessionOrThrow(
    sessionId: string,
    actor: Actor,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const organizationId = this.requireOrg(actor);
    const session = await client.session.findFirst({
      where: {
        id: sessionId,
        organizationId,
        deletedAt: null,
      },
      select: sessionSelect,
    });
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    return session;
  }

  private async getMutableSessionOrThrow(
    tx: Prisma.TransactionClient,
    sessionId: string,
    organizationId: string,
  ) {
    const session = await tx.session.findFirst({
      where: {
        id: sessionId,
        organizationId,
        deletedAt: null,
      },
      select: sessionSelect,
    });
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    return session;
  }

  private async lockSessionRow(
    tx: Prisma.TransactionClient,
    sessionId: string,
  ) {
    await tx.$queryRaw`SELECT "id" FROM "Session" WHERE "id" = ${sessionId} FOR UPDATE`;
  }

  private async listActiveRegistrations(
    tx: Prisma.TransactionClient,
    sessionId: string,
  ): Promise<ActiveSessionRegistrationRecord[]> {
    return tx.sessionRegistration.findMany({
      where: {
        sessionId,
        deletedAt: null,
      },
      select: activeSessionRegistrationSelect,
      orderBy: [
        { slotNumber: 'asc' },
        { waitlistPosition: 'asc' },
        { createdAt: 'asc' },
      ],
    });
  }

  private assertActiveRegistrationConsistency(
    session: Pick<SessionRecord, 'id' | 'slotCount'>,
    registrations: ActiveSessionRegistrationRecord[],
    opts: { requireCompactWaitlist?: boolean } = {},
  ) {
    const requireCompactWaitlist = opts.requireCompactWaitlist ?? true;
    const slotAssignments = new Map<number, string>();
    const waitlistAssignments = new Map<number, string>();
    const confirmedStatuses = new Set<SessionRegistrationStatus>([
      SessionRegistrationStatus.CONFIRMED,
      SessionRegistrationStatus.CHECKED_IN,
    ]);
    const terminalStatuses = new Set<SessionRegistrationStatus>([
      SessionRegistrationStatus.REMOVED,
      SessionRegistrationStatus.DECLINED,
    ]);

    for (const registration of registrations) {
      if (registration.deletedAt !== null) {
        throw new ConflictException(
          'Session registration set is inconsistent; retry the request',
        );
      }
      if (terminalStatuses.has(registration.status)) {
        throw new ConflictException(
          'Session registration set contains a terminal active record',
        );
      }
      if (
        registration.slotNumber !== null &&
        registration.waitlistPosition !== null
      ) {
        throw new ConflictException(
          'Session registration cannot have both slot and waitlist placement',
        );
      }
      if (
        registration.slotNumber !== null &&
        !confirmedStatuses.has(registration.status)
      ) {
        throw new ConflictException(
          'Only confirmed or checked-in registrations may hold lobby slots',
        );
      }
      if (
        registration.status === SessionRegistrationStatus.WAITLIST &&
        registration.waitlistPosition === null
      ) {
        throw new ConflictException(
          'Waitlisted registrations must have a waitlist position',
        );
      }
      if (
        confirmedStatuses.has(registration.status) &&
        registration.slotNumber === null
      ) {
        throw new ConflictException(
          'Confirmed registrations must have a slot assignment',
        );
      }

      if (registration.slotNumber !== null) {
        if (
          !Number.isInteger(registration.slotNumber) ||
          registration.slotNumber < 1 ||
          registration.slotNumber > session.slotCount
        ) {
          throw new ConflictException(
            'Session registration slot assignment is out of range',
          );
        }
        const existing = slotAssignments.get(registration.slotNumber);
        if (existing) {
          throw new ConflictException(
            'Duplicate active session slot assignment detected',
          );
        }
        slotAssignments.set(registration.slotNumber, registration.id);
      }

      if (registration.waitlistPosition !== null) {
        if (
          !Number.isInteger(registration.waitlistPosition) ||
          registration.waitlistPosition < 1
        ) {
          throw new ConflictException(
            'Session waitlist position must be a positive integer',
          );
        }
        const existing = waitlistAssignments.get(registration.waitlistPosition);
        if (existing) {
          throw new ConflictException(
            'Duplicate active session waitlist position detected',
          );
        }
        waitlistAssignments.set(registration.waitlistPosition, registration.id);
      }
    }

    const waitlist = registrations
      .filter(
        (registration) => typeof registration.waitlistPosition === 'number',
      )
      .sort((left, right) => {
        const positionDelta =
          (left.waitlistPosition ?? Number.MAX_SAFE_INTEGER) -
          (right.waitlistPosition ?? Number.MAX_SAFE_INTEGER);
        if (positionDelta !== 0) {
          return positionDelta;
        }
        return left.createdAt.getTime() - right.createdAt.getTime();
      });

    if (requireCompactWaitlist) {
      for (const [index, registration] of waitlist.entries()) {
        if (registration.waitlistPosition !== index + 1) {
          throw new ConflictException(
            'Session waitlist ordering is inconsistent; retry the request',
          );
        }
      }
    }
  }

  private async loadConsistentActiveRegistrations(
    tx: Prisma.TransactionClient,
    session: Pick<SessionRecord, 'id' | 'slotCount'>,
  ) {
    const current = await this.listActiveRegistrations(tx, session.id);
    this.assertActiveRegistrationConsistency(session, current, {
      requireCompactWaitlist: false,
    });
    await this.repackWaitlist(tx, session.id);
    const registrations = await this.listActiveRegistrations(tx, session.id);
    this.assertActiveRegistrationConsistency(session, registrations);
    return registrations;
  }

  private async withSessionMutation<T>(
    run: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(run, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }

  private lowestAvailableSlot(
    registrations: Array<{ slotNumber: number | null }>,
    slotCount: number,
  ) {
    const used = new Set(
      registrations
        .map((registration) => registration.slotNumber)
        .filter(
          (slotNumber): slotNumber is number => typeof slotNumber === 'number',
        ),
    );
    for (let slot = 1; slot <= slotCount; slot += 1) {
      if (!used.has(slot)) {
        return slot;
      }
    }
    return null;
  }

  private nextWaitlistPosition(
    registrations: Array<{ waitlistPosition: number | null }>,
  ) {
    return (
      registrations.reduce(
        (max, registration) =>
          registration.waitlistPosition && registration.waitlistPosition > max
            ? registration.waitlistPosition
            : max,
        0,
      ) + 1
    );
  }

  private async repackWaitlist(
    tx: Prisma.TransactionClient,
    sessionId: string,
  ) {
    const waitlist = await tx.sessionRegistration.findMany({
      where: {
        sessionId,
        deletedAt: null,
        status: SessionRegistrationStatus.WAITLIST,
      },
      select: {
        id: true,
        waitlistPosition: true,
      },
      orderBy: [{ waitlistPosition: 'asc' }, { createdAt: 'asc' }],
    });

    for (const [index, registration] of waitlist.entries()) {
      const position = index + 1;
      if (registration.waitlistPosition !== position) {
        await tx.sessionRegistration.update({
          where: { id: registration.id },
          data: { waitlistPosition: position },
        });
      }
    }
  }

  private async promoteNextWaitlist(
    tx: Prisma.TransactionClient,
    sessionId: string,
    slotNumber: number,
  ): Promise<SessionRegistrationRecord | null> {
    const next = await tx.sessionRegistration.findFirst({
      where: {
        sessionId,
        deletedAt: null,
        status: SessionRegistrationStatus.WAITLIST,
      },
      select: sessionRegistrationSelect,
      orderBy: [{ waitlistPosition: 'asc' }, { createdAt: 'asc' }],
    });

    if (!next) {
      return null;
    }

    return tx.sessionRegistration.update({
      where: { id: next.id },
      data: {
        status: SessionRegistrationStatus.CONFIRMED,
        slotNumber,
        waitlistPosition: null,
        confirmedAt: new Date(),
        removedAt: null,
        removalReason: null,
        deletedAt: null,
      },
      select: sessionRegistrationSelect,
    });
  }

  private async logAudit(params: {
    action: AuditAction;
    organizationId: string;
    actor: Actor;
    entityType: string;
    entityId: string;
    after?: unknown;
    before?: unknown;
  }) {
    const userId = this.actorId(params.actor);
    if (!userId) return;
    await this.audit.log({
      action: params.action,
      organizationId: params.organizationId,
      userId,
      entityType: params.entityType,
      entityId: params.entityId,
      before: params.before,
      after: params.after,
      source: 'MANUAL',
    });
  }

  async create(dto: CreateSessionDto, actor: Actor) {
    const organizationId = this.requireOrg(actor);
    const actorId = this.actorId(actor);
    const name = this.cleanString(dto.name);
    if (!name) {
      throw new BadRequestException('name is required');
    }

    const maxTeams = dto.maxTeams ?? 25;
    const slotCount = dto.slotCount ?? 25;
    this.validateCapacity(maxTeams, slotCount);

    const registrationOpenAt = this.parseDate(
      'registrationOpenAt',
      dto.registrationOpenAt,
    );
    const registrationCloseAt = this.parseDate(
      'registrationCloseAt',
      dto.registrationCloseAt,
    );
    const checkInOpenAt = this.parseDate('checkInOpenAt', dto.checkInOpenAt);
    const checkInCloseAt = this.parseDate('checkInCloseAt', dto.checkInCloseAt);
    const startsAt = this.parseDate('startsAt', dto.startsAt);
    const endedAt = this.parseDate('endedAt', dto.endedAt);

    this.validateDateRange(
      registrationOpenAt,
      registrationCloseAt,
      'registrationOpenAt',
      'registrationCloseAt',
    );
    this.validateDateRange(
      checkInOpenAt,
      checkInCloseAt,
      'checkInOpenAt',
      'checkInCloseAt',
    );
    this.validateDateRange(startsAt, endedAt, 'startsAt', 'endedAt');

    const gameId = this.cleanString(dto.gameId);
    const adapterKey = await this.validateAdapterKey(dto.adapterKey, gameId);

    const created = await this.prisma.session.create({
      data: {
        organizationId,
        name,
        slug: this.cleanSlug(dto.slug),
        type: dto.type ?? SessionType.SCRIM,
        status: dto.status ?? SessionStatus.DRAFT,
        description: this.cleanString(dto.description),
        rulesetId: this.cleanString(dto.rulesetId),
        gameId,
        adapterKey,
        maxTeams,
        slotCount,
        waitlistEnabled: dto.waitlistEnabled ?? true,
        checkInEnabled: dto.checkInEnabled ?? false,
        registrationOpenAt: registrationOpenAt ?? null,
        registrationCloseAt: registrationCloseAt ?? null,
        checkInOpenAt: checkInOpenAt ?? null,
        checkInCloseAt: checkInCloseAt ?? null,
        startsAt: startsAt ?? null,
        endedAt: endedAt ?? null,
        createdById: actorId,
        updatedById: actorId,
      },
      select: sessionSelect,
    });

    await this.logAudit({
      action: AuditAction.SESSION_CREATE,
      organizationId,
      actor,
      entityType: 'SESSION',
      entityId: created.id,
      after: {
        name: created.name,
        type: created.type,
        status: created.status,
      },
    });

    return this.buildSessionResponse(created, {
      confirmedCount: 0,
      waitlistCount: 0,
      totalRegisteredCount: 0,
    });
  }

  async list(
    actor: Actor,
    query?: { status?: SessionStatus; type?: SessionType },
  ) {
    const organizationId = this.requireOrg(actor);
    const sessions = await this.prisma.session.findMany({
      where: {
        organizationId,
        deletedAt: null,
        status: query?.status,
        type: query?.type,
      },
      select: sessionSelect,
      orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
    });

    const counts = await this.getSessionCounts(
      sessions.map((session) => session.id),
    );
    return sessions.map((session) =>
      this.buildSessionResponse(
        session,
        counts.get(session.id) ?? {
          confirmedCount: 0,
          waitlistCount: 0,
          totalRegisteredCount: 0,
        },
      ),
    );
  }

  async get(sessionId: string, actor: Actor) {
    const session = await this.getSessionOrThrow(sessionId, actor);
    const counts = await this.getSessionCounts([session.id]);
    return this.buildSessionResponse(
      session,
      counts.get(session.id) ?? {
        confirmedCount: 0,
        waitlistCount: 0,
        totalRegisteredCount: 0,
      },
    );
  }

  async update(sessionId: string, dto: UpdateSessionDto, actor: Actor) {
    const session = await this.getSessionOrThrow(sessionId, actor);
    const actorId = this.actorId(actor);

    const nextMaxTeams = dto.maxTeams ?? session.maxTeams;
    const nextSlotCount = dto.slotCount ?? session.slotCount;
    this.validateCapacity(nextMaxTeams, nextSlotCount);

    const registrationOpenAt = this.parseDate(
      'registrationOpenAt',
      dto.registrationOpenAt,
    );
    const registrationCloseAt = this.parseDate(
      'registrationCloseAt',
      dto.registrationCloseAt,
    );
    const checkInOpenAt = this.parseDate('checkInOpenAt', dto.checkInOpenAt);
    const checkInCloseAt = this.parseDate('checkInCloseAt', dto.checkInCloseAt);
    const startsAt = this.parseDate('startsAt', dto.startsAt);
    const endedAt = this.parseDate('endedAt', dto.endedAt);

    this.validateDateRange(
      registrationOpenAt ?? session.registrationOpenAt,
      registrationCloseAt ?? session.registrationCloseAt,
      'registrationOpenAt',
      'registrationCloseAt',
    );
    this.validateDateRange(
      checkInOpenAt ?? session.checkInOpenAt,
      checkInCloseAt ?? session.checkInCloseAt,
      'checkInOpenAt',
      'checkInCloseAt',
    );
    this.validateDateRange(
      startsAt ?? session.startsAt,
      endedAt ?? session.endedAt,
      'startsAt',
      'endedAt',
    );

    const nextGameId =
      dto.gameId !== undefined ? this.cleanString(dto.gameId) : session.gameId;
    const nextAdapterKey =
      dto.adapterKey !== undefined
        ? this.cleanString(dto.adapterKey)
        : session.adapterKey;
    const validatedAdapterKey = await this.validateAdapterKey(
      nextAdapterKey,
      nextGameId,
    );

    const data: Prisma.SessionUncheckedUpdateInput = {
      updatedById: actorId,
    };

    if (dto.name !== undefined) {
      const name = this.cleanString(dto.name);
      if (!name) {
        throw new BadRequestException('name is required');
      }
      data.name = name;
    }
    if (dto.slug !== undefined) data.slug = this.cleanSlug(dto.slug);
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.description !== undefined)
      data.description = this.cleanString(dto.description);
    if (dto.rulesetId !== undefined)
      data.rulesetId = this.cleanString(dto.rulesetId);
    if (dto.gameId !== undefined) data.gameId = nextGameId;
    if (dto.adapterKey !== undefined) data.adapterKey = validatedAdapterKey;
    if (dto.maxTeams !== undefined) data.maxTeams = dto.maxTeams;
    if (dto.slotCount !== undefined) data.slotCount = dto.slotCount;
    if (dto.waitlistEnabled !== undefined)
      data.waitlistEnabled = dto.waitlistEnabled;
    if (dto.checkInEnabled !== undefined)
      data.checkInEnabled = dto.checkInEnabled;
    if (dto.registrationOpenAt !== undefined)
      data.registrationOpenAt = registrationOpenAt ?? null;
    if (dto.registrationCloseAt !== undefined)
      data.registrationCloseAt = registrationCloseAt ?? null;
    if (dto.checkInOpenAt !== undefined)
      data.checkInOpenAt = checkInOpenAt ?? null;
    if (dto.checkInCloseAt !== undefined)
      data.checkInCloseAt = checkInCloseAt ?? null;
    if (dto.startsAt !== undefined) data.startsAt = startsAt ?? null;
    if (dto.endedAt !== undefined) data.endedAt = endedAt ?? null;

    const updated = await this.prisma.session.update({
      where: { id: session.id },
      data,
      select: sessionSelect,
    });

    const counts = await this.getSessionCounts([updated.id]);
    return this.buildSessionResponse(
      updated,
      counts.get(updated.id) ?? {
        confirmedCount: 0,
        waitlistCount: 0,
        totalRegisteredCount: 0,
      },
    );
  }

  async softDelete(sessionId: string, actor: Actor) {
    const session = await this.getSessionOrThrow(sessionId, actor);
    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        deletedAt: new Date(),
        updatedById: this.actorId(actor),
      },
      select: { id: true },
    });
    return { ok: true };
  }

  async registerTeam(
    sessionId: string,
    dto: RegisterSessionTeamDto,
    actor: Actor,
  ) {
    const session = await this.getSessionOrThrow(sessionId, actor);
    if (
      session.status !== SessionStatus.DRAFT &&
      session.status !== SessionStatus.OPEN &&
      session.status !== SessionStatus.CHECKIN
    ) {
      throw new BadRequestException('Session is not accepting registrations');
    }

    const teamId = this.cleanString(dto.teamId);
    if (!teamId) {
      throw new BadRequestException('teamId is required');
    }

    const actorId = this.actorId(actor);

    return this.withSessionMutation(async (tx) => {
      await this.lockSessionRow(tx, session.id);
      const lockedSession = await this.getMutableSessionOrThrow(
        tx,
        session.id,
        session.organizationId,
      );
      if (
        lockedSession.status !== SessionStatus.DRAFT &&
        lockedSession.status !== SessionStatus.OPEN &&
        lockedSession.status !== SessionStatus.CHECKIN
      ) {
        throw new BadRequestException('Session is not accepting registrations');
      }

      const team = await tx.team.findFirst({
        where: {
          id: teamId,
          organizationId: lockedSession.organizationId,
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          tag: true,
          logoUrl: true,
          countryCode: true,
          region: true,
        },
      });
      if (!team) {
        throw new NotFoundException('Team not found');
      }

      const existing = await tx.sessionRegistration.findUnique({
        where: {
          sessionId_teamId: {
            sessionId: session.id,
            teamId,
          },
        },
        select: {
          id: true,
          deletedAt: true,
        },
      });

      if (existing?.deletedAt === null) {
        throw new BadRequestException(
          'Team is already registered for this session',
        );
      }

      const activeRegistrations = await this.loadConsistentActiveRegistrations(
        tx,
        lockedSession,
      );

      const confirmedCount = activeRegistrations.filter(
        (registration) => registration.slotNumber !== null,
      ).length;
      const now = new Date();

      const payload: Prisma.SessionRegistrationUncheckedCreateInput = {
        organizationId: lockedSession.organizationId,
        sessionId: lockedSession.id,
        teamId,
        note: this.cleanString(dto.note),
        registeredById: actorId,
        status: SessionRegistrationStatus.REGISTERED,
        checkedInAt: null,
      };

      if (confirmedCount < lockedSession.slotCount) {
        const slotNumber = this.lowestAvailableSlot(
          activeRegistrations,
          lockedSession.slotCount,
        );
        if (!slotNumber) {
          throw new BadRequestException('session full');
        }
        payload.status = SessionRegistrationStatus.CONFIRMED;
        payload.slotNumber = slotNumber;
        payload.confirmedAt = now;
        payload.waitlistPosition = null;
        payload.deletedAt = null;
        payload.removedAt = null;
        payload.removalReason = null;
      } else if (lockedSession.waitlistEnabled) {
        payload.status = SessionRegistrationStatus.WAITLIST;
        payload.slotNumber = null;
        payload.waitlistPosition =
          this.nextWaitlistPosition(activeRegistrations);
        payload.confirmedAt = null;
        payload.deletedAt = null;
        payload.removedAt = null;
        payload.removalReason = null;
      } else {
        throw new BadRequestException('session full');
      }

      // Re-registration intentionally reuses a prior soft-deleted row so the
      // team keeps a stable registration identity across remove/re-add cycles.
      const registration = existing
        ? await tx.sessionRegistration.update({
            where: { id: existing.id },
            data: payload,
            select: sessionRegistrationSelect,
          })
        : await tx.sessionRegistration.create({
            data: payload,
            select: sessionRegistrationSelect,
          });

      await this.loadConsistentActiveRegistrations(tx, lockedSession);

      await this.logAudit({
        action: AuditAction.SESSION_TEAM_REGISTER,
        organizationId: lockedSession.organizationId,
        actor,
        entityType: 'SESSION_REGISTRATION',
        entityId: registration.id,
        after: {
          sessionId: lockedSession.id,
          teamId,
          status: registration.status,
          slotNumber: registration.slotNumber,
          waitlistPosition: registration.waitlistPosition,
        },
      });

      return this.buildRegistrationResponse({
        ...registration,
        team: registration.team ?? team,
      } as SessionRegistrationRecord);
    });
  }

  async listRegistrations(
    sessionId: string,
    query: ListSessionRegistrationsDto,
    actor: Actor,
  ) {
    const session = await this.getSessionOrThrow(sessionId, actor);
    const registrations = await this.prisma.sessionRegistration.findMany({
      where: {
        sessionId: session.id,
        organizationId: session.organizationId,
        deletedAt: null,
        status: query?.status,
      },
      select: sessionRegistrationSelect,
      orderBy: [{ slotNumber: 'asc' }, { waitlistPosition: 'asc' }],
    });

    return registrations
      .slice()
      .sort((left, right) => {
        const leftSlot = left.slotNumber ?? Number.MAX_SAFE_INTEGER;
        const rightSlot = right.slotNumber ?? Number.MAX_SAFE_INTEGER;
        if (leftSlot !== rightSlot) return leftSlot - rightSlot;
        const leftWait = left.waitlistPosition ?? Number.MAX_SAFE_INTEGER;
        const rightWait = right.waitlistPosition ?? Number.MAX_SAFE_INTEGER;
        if (leftWait !== rightWait) return leftWait - rightWait;
        return left.createdAt.getTime() - right.createdAt.getTime();
      })
      .map((registration) => this.buildRegistrationResponse(registration));
  }

  async removeRegistration(
    sessionId: string,
    registrationId: string,
    dto: RemoveSessionRegistrationDto,
    actor: Actor,
  ) {
    const session = await this.getSessionOrThrow(sessionId, actor);
    const note = this.cleanString(dto.note);
    const removalReason = this.cleanString(dto.removalReason);

    return this.withSessionMutation(async (tx) => {
      await this.lockSessionRow(tx, session.id);
      const lockedSession = await this.getMutableSessionOrThrow(
        tx,
        session.id,
        session.organizationId,
      );
      await this.loadConsistentActiveRegistrations(tx, lockedSession);

      const registration = await tx.sessionRegistration.findFirst({
        where: {
          id: registrationId,
          sessionId: lockedSession.id,
          organizationId: lockedSession.organizationId,
          deletedAt: null,
        },
        select: sessionRegistrationSelect,
      });
      if (!registration) {
        throw new NotFoundException('Session registration not found');
      }

      const removedAt = new Date();
      await tx.sessionRegistration.update({
        where: { id: registration.id },
        data: {
          status: SessionRegistrationStatus.REMOVED,
          slotNumber: null,
          waitlistPosition: null,
          removedAt,
          removalReason,
          note,
          deletedAt: removedAt,
        },
        select: { id: true },
      });

      let promoted: SessionRegistrationRecord | null = null;
      if (registration.slotNumber !== null) {
        promoted = await this.promoteNextWaitlist(
          tx,
          lockedSession.id,
          registration.slotNumber,
        );
      }

      await this.loadConsistentActiveRegistrations(tx, lockedSession);

      await this.logAudit({
        action: AuditAction.SESSION_REGISTRATION_REMOVE,
        organizationId: lockedSession.organizationId,
        actor,
        entityType: 'SESSION_REGISTRATION',
        entityId: registration.id,
        before: {
          status: registration.status,
          slotNumber: registration.slotNumber,
          waitlistPosition: registration.waitlistPosition,
        },
        after: {
          status: SessionRegistrationStatus.REMOVED,
          removedAt,
          removalReason,
        },
      });

      if (promoted) {
        await this.logAudit({
          action: AuditAction.SESSION_WAITLIST_PROMOTE,
          organizationId: lockedSession.organizationId,
          actor,
          entityType: 'SESSION_REGISTRATION',
          entityId: promoted.id,
          after: {
            sessionId: lockedSession.id,
            teamId: promoted.teamId,
            slotNumber: promoted.slotNumber,
            status: promoted.status,
          },
        });
      }

      return {
        removedRegistration: this.buildRegistrationResponse({
          ...registration,
          status: SessionRegistrationStatus.REMOVED,
          slotNumber: null,
          waitlistPosition: null,
          removedAt,
          removalReason,
          note,
          deletedAt: removedAt,
        }),
        promotedRegistration: promoted
          ? this.buildRegistrationResponse(promoted)
          : null,
      };
    });
  }

  async createMatch(
    sessionId: string,
    dto: SessionMatchCreatePayload,
    actor: Actor,
  ) {
    const session = await this.getSessionOrThrow(sessionId, actor);
    const created = await this.matches.createForSession(actor, session.id, dto);
    await this.logAudit({
      action: AuditAction.SESSION_MATCH_CREATE,
      organizationId: session.organizationId,
      actor,
      entityType: 'MATCH',
      entityId: `${(created as { id?: string }).id ?? ''}`,
      after: {
        sessionId: session.id,
        name: (created as { name?: string | null }).name ?? null,
      },
    });
    return created;
  }

  async listMatches(sessionId: string, actor: Actor) {
    const session = await this.getSessionOrThrow(sessionId, actor);
    const matches = await this.matches.listBySession(actor, session.id);
    return matches.map((match) => ({
      id: match.id,
      sessionId: match.sessionId,
      name: match.name,
      status: match.status,
      liveState: match.liveState,
      matchNumber: match.matchNumber,
      slotCount: match.slotCount,
      map: match.map,
      dataMode: match.dataMode,
      dataSource: match.dataSource,
      scheduledAt: match.scheduledAt,
      startedAt: match.startedAt,
      endedAt: match.endedAt,
      createdAt: match.createdAt,
      updatedAt: match.updatedAt,
      teamCount: match._count.matchTeams,
    }));
  }
}
