import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataMode, MatchDataSource, MatchStatus } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import type { AuthUser } from '../../common/auth/auth.types';
import type { Actor } from '../../common/auth/jwt.strategy';
import { effectiveOrganizationId } from '../../common/org/org.util';
import { resolveMatchDataSource } from '../matches/match-datasource.util';

@Injectable()
export class PcobActiveService {
  private readonly logger = new Logger('PcobActiveService');

  constructor(private readonly prisma: PrismaService) {}

  async getActiveMatch(
    user?: Pick<
      AuthUser,
      'id' | 'role' | 'organizationId' | 'actingOrgId' | 'actorRole'
    >,
  ): Promise<
    | { active: false }
    | {
        active: true;
        matchId: string;
        pcobSessionId: string | null;
        mode: 'PCOB' | 'MANUAL';
      }
  > {
    const userId = user?.id ?? 'unknown';
    const role = user?.role ?? 'unknown';
    const actor: Actor | null = user
      ? {
          id: user.id,
          role: user.role ?? null,
          organizationId: user.organizationId ?? null,
          orgId: user.organizationId ?? null,
          actorId: null,
          actorRole: user.actorRole ?? user.role ?? null,
          actingOrgId: user.actingOrgId ?? null,
          actingRole: null,
          actingOrgName: null,
          actingAsUserId: null,
          isImpersonating: false,
          impersonated: false,
          impersonatedBy: null,
          impersonationExpiresAt: null,
          realRole: user.actorRole ?? user.role ?? null,
        }
      : null;
    const orgId = actor ? effectiveOrganizationId(actor) : null;
    const live = await this.prisma.match.findMany({
      where: {
        status: MatchStatus.LIVE,
        deletedAt: null,
        OR: [
          { dataSource: MatchDataSource.PCOB },
          { dataMode: DataMode.PCOB },
          { pcobMode: true },
        ],
        ...(orgId ? { tournament: { organizationId: orgId } } : {}),
      },
      select: {
        id: true,
        pcobSessionId: true,
        dataMode: true,
        dataSource: true,
        pcobMode: true,
      },
    });
    this.logger.log(
      `[active-match] user=${userId} role=${role} org=${orgId ?? 'none'} liveMatches=${live.length} ids=${live.map((m) => m.id).join(',') || 'none'}`,
    );
    if (!live.length) return { active: false };
    if (live.length > 1) {
      throw new BadRequestException('Multiple active matches found');
    }
    const match = live[0];
    const mode =
      resolveMatchDataSource(match) === MatchDataSource.PCOB || match.pcobMode
        ? 'PCOB'
        : 'MANUAL';
    return {
      active: true,
      matchId: match.id,
      pcobSessionId: match.pcobSessionId ?? null,
      mode,
    };
  }
}
