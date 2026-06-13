import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SessionType } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import type { AuthUser } from '../../common/auth/auth.types';
import { requireOrgMatch } from '../../common/org/org.util';
import { BroadcastService } from '../broadcast/broadcast.service';
import { CreateSessionSponsorDto } from './dto/create-session-sponsor.dto';
import { UpdateSessionSponsorDto } from './dto/update-session-sponsor.dto';

@Injectable()
export class SessionSponsorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly broadcast: BroadcastService,
  ) {}

  private coerceNumber(value?: number | string | null) {
    if (value === null || value === undefined) return undefined;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : undefined;
  }

  private coerceBoolean(value?: boolean | string) {
    if (value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    const v = value.toLowerCase();
    return v === 'true' || v === '1' || v === 'on' || v === 'yes';
  }

  private normalizeDisplayOrder(value?: number | string | null) {
    return this.coerceNumber(value) ?? 0;
  }

  private normalizeRotation(value?: number | string | null) {
    if (value === null || value === undefined) return null;
    return this.coerceNumber(value) ?? null;
  }

  private async assertEventScope(sessionId: string, actor: AuthUser) {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, deletedAt: null },
      select: { organizationId: true, type: true },
    });
    if (!session || session.type !== SessionType.EVENT) {
      throw new NotFoundException('Event not found');
    }
    requireOrgMatch(actor, session.organizationId);
    return session.organizationId;
  }

  async listSponsors(sessionId: string, actor: AuthUser) {
    await this.assertEventScope(sessionId, actor);
    return this.prisma.sessionSponsor.findMany({
      where: { sessionId, deletedAt: null },
      orderBy: [{ tier: 'asc' }, { displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createSponsor(
    sessionId: string,
    input: CreateSessionSponsorDto,
    actor: AuthUser,
  ) {
    const orgId = await this.assertEventScope(sessionId, actor);
    if (!input?.name?.trim() || !input.logoUrl?.trim() || !input.tier) {
      throw new BadRequestException({ error: 'NAME_LOGO_TIER_REQUIRED' });
    }

    const isActive = this.coerceBoolean(input.isActive);
    const created = await this.prisma.sessionSponsor.create({
      data: {
        sessionId,
        organizationId: orgId,
        name: input.name.trim(),
        logoUrl: input.logoUrl.trim(),
        tier: input.tier,
        displayOrder: this.normalizeDisplayOrder(input.displayOrder),
        isActive: isActive ?? true,
        rotationIntervalSeconds: this.normalizeRotation(
          input.rotationIntervalSeconds,
        ),
        websiteUrl: input.websiteUrl ?? null,
      },
    });

    void this.broadcast.emitForOrganization(orgId, 'sponsors', { sessionId });
    return created;
  }

  async updateSponsor(
    sessionId: string,
    sponsorId: string,
    input: UpdateSessionSponsorDto,
    actor: AuthUser,
  ) {
    const orgId = await this.assertEventScope(sessionId, actor);
    const existing = await this.prisma.sessionSponsor.findFirst({
      where: { id: sponsorId, sessionId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException({ error: 'SPONSOR_NOT_FOUND' });
    }

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name?.trim() ?? '';
    if (input.logoUrl !== undefined) data.logoUrl = input.logoUrl ?? '';
    if (input.tier !== undefined) data.tier = input.tier;
    if (input.displayOrder !== undefined) {
      data.displayOrder = this.normalizeDisplayOrder(input.displayOrder);
    }
    if (input.isActive !== undefined) {
      const boolVal = this.coerceBoolean(input.isActive);
      data.isActive =
        boolVal !== undefined ? boolVal : (input.isActive as boolean);
    }
    if (input.rotationIntervalSeconds !== undefined) {
      data.rotationIntervalSeconds = this.normalizeRotation(
        input.rotationIntervalSeconds,
      );
    }
    if (input.websiteUrl !== undefined) {
      data.websiteUrl = input.websiteUrl ?? null;
    }

    const updated = await this.prisma.sessionSponsor.update({
      where: { id: sponsorId },
      data,
    });

    void this.broadcast.emitForOrganization(orgId, 'sponsors', { sessionId });
    return updated;
  }

  async deleteSponsor(sessionId: string, sponsorId: string, actor: AuthUser) {
    const orgId = await this.assertEventScope(sessionId, actor);
    const existing = await this.prisma.sessionSponsor.findFirst({
      where: { id: sponsorId, sessionId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException({ error: 'SPONSOR_NOT_FOUND' });
    }

    await this.prisma.sessionSponsor.update({
      where: { id: sponsorId },
      data: { deletedAt: new Date() },
    });

    void this.broadcast.emitForOrganization(orgId, 'sponsors', { sessionId });
    return { ok: true };
  }
}
