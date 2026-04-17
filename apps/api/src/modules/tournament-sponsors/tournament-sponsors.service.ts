import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import type { AuthUser } from '../../common/auth/auth.types';
import { requireTournamentOrganization } from '../../common/org/org.util';
import { BroadcastService } from '../broadcast/broadcast.service';
import { CreateSponsorDto } from './dto/create-sponsor.dto';
import { UpdateSponsorDto } from './dto/update-sponsor.dto';

@Injectable()
export class TournamentSponsorsService {
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
    const n = this.coerceNumber(value);
    return n ?? 0;
  }

  private normalizeRotation(value?: number | string | null) {
    if (value === null || value === undefined) return null;
    const n = this.coerceNumber(value);
    return n ?? null;
  }

  private async assertTournamentScope(tournamentId: string, actor: AuthUser) {
    return requireTournamentOrganization(this.prisma, tournamentId, { actor });
  }

  async listSponsors(tournamentId: string, actor: AuthUser) {
    await this.assertTournamentScope(tournamentId, actor);
    try {
      return await this.prisma.tournamentSponsor.findMany({
        where: { tournamentId, deletedAt: null },
        orderBy: [
          { tier: 'asc' },
          { displayOrder: 'asc' },
          { createdAt: 'asc' },
        ],
      });
    } catch (err: unknown) {
      // Surface details during debugging; remove or reduce in production if noisy.

      console.error(
        '[TournamentSponsorsService] listSponsors failed',
        tournamentId,
        err,
      );
      throw new InternalServerErrorException({
        error: 'LIST_SPONSORS_FAILED',
        message: (err as Error)?.message ?? 'unknown error',
      });
    }
  }

  async createSponsor(
    tournamentId: string,
    input: CreateSponsorDto,
    actor: AuthUser,
  ) {
    const orgId = await this.assertTournamentScope(tournamentId, actor);
    if (!input?.name?.trim() || !input.logoUrl?.trim() || !input.tier) {
      throw new BadRequestException({ error: 'NAME_LOGO_TIER_REQUIRED' });
    }
    const isActive = this.coerceBoolean(input.isActive);
    const created = await this.prisma.tournamentSponsor.create({
      data: {
        tournamentId,
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
    void this.broadcast.emitForOrganization(orgId, 'sponsors', {
      tournamentId,
    });
    return created;
  }

  async updateSponsor(
    tournamentId: string,
    sponsorId: string,
    input: UpdateSponsorDto,
    actor: AuthUser,
  ) {
    const orgId = await this.assertTournamentScope(tournamentId, actor);
    const existing = await this.prisma.tournamentSponsor.findFirst({
      where: { id: sponsorId, tournamentId },
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

    const updated = await this.prisma.tournamentSponsor.update({
      where: { id: sponsorId },
      data,
    });

    void this.broadcast.emitForOrganization(orgId, 'sponsors', {
      tournamentId,
    });
    return updated;
  }

  async deleteSponsor(
    tournamentId: string,
    sponsorId: string,
    actor: AuthUser,
  ) {
    const orgId = await this.assertTournamentScope(tournamentId, actor);
    const existing = await this.prisma.tournamentSponsor.findFirst({
      where: { id: sponsorId, tournamentId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException({ error: 'SPONSOR_NOT_FOUND' });
    }
    await this.prisma.tournamentSponsor.update({
      where: { id: sponsorId },
      data: { deletedAt: new Date() },
    });
    void this.broadcast.emitForOrganization(orgId, 'sponsors', {
      tournamentId,
    });
    return { ok: true };
  }
}
