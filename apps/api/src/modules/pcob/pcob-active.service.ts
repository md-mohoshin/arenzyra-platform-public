import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataMode, MatchDataSource, MatchStatus } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import type { AuthUser } from '../../common/auth/auth.types';
import type { Actor } from '../../common/auth/jwt.strategy';
import { effectiveOrganizationId } from '../../common/org/org.util';
import {
  isPcobCompatibilityMatch,
  resolvePcobCompatibilityMode,
} from '../../common/match-telemetry-provider.util';
import { PCOB_ADAPTER_KEY } from '../../common/pcob-binding.util';

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
        mode: 'PCOB' | 'API' | 'MANUAL';
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
          {
            dataSource: MatchDataSource.API,
            adapterKey: PCOB_ADAPTER_KEY,
            pcobSessionId: { not: null },
          },
        ],
        ...(orgId ? { tournament: { organizationId: orgId } } : {}),
      },
      select: {
        id: true,
        pcobSessionId: true,
        dataMode: true,
        dataSource: true,
        pcobMode: true,
        adapterKey: true,
      },
    });
    const compatible = live.filter((match) => isPcobCompatibilityMatch(match));
    this.logger.log(
      `[active-match] user=${userId} role=${role} org=${orgId ?? 'none'} liveMatches=${compatible.length} ids=${compatible.map((m) => m.id).join(',') || 'none'}`,
    );
    if (!compatible.length) return { active: false };
    if (compatible.length > 1) {
      throw new BadRequestException('Multiple active matches found');
    }
    const match = compatible[0];
    const mode = resolvePcobCompatibilityMode(match);
    return {
      active: true,
      matchId: match.id,
      pcobSessionId: match.pcobSessionId ?? null,
      mode,
    };
  }
}
