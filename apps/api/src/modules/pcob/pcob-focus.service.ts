import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  forwardRef,
} from '@nestjs/common';
import { MatchStatus, Role } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { MatchStateCache } from './match-state-cache.service';
import { PcobEventsService } from './pcob-events.service';
import { CanonicalControlReadService } from '../realtime/canonical-control-read.service';

@Injectable()
export class PcobFocusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: MatchStateCache,
    private readonly events: PcobEventsService,
    @Inject(forwardRef(() => CanonicalControlReadService))
    private readonly canonicalRead: CanonicalControlReadService,
  ) {}

  private isPcobMode(match: {
    pcobMode?: boolean | null;
    dataMode?: string | null;
    dataSource?: string | null;
  }) {
    return (
      match?.pcobMode === true ||
      match?.dataMode === 'PCOB' ||
      match?.dataSource === 'PCOB'
    );
  }

  private ensureRole(role: Role) {
    if (
      role !== Role.ADMIN &&
      role !== Role.SUPER_ADMIN &&
      role !== Role.ORGANIZER
    ) {
      throw new ForbiddenException('Insufficient role');
    }
  }

  async setFocus(orgId: string, role: Role, matchId: string, playerId: string) {
    this.ensureRole(role);
    const match = await this.prisma.match.findFirst({
      where: {
        id: matchId,
        deletedAt: null,
        tournament: { organizationId: orgId },
      },
      include: { tournament: true },
    });
    if (!match) throw new BadRequestException('Match not found');
    if (match.status !== MatchStatus.LIVE)
      throw new BadRequestException('Match must be LIVE');
    if (!this.isPcobMode(match))
      throw new BadRequestException('Match is not in PCOB mode');

    const player = await this.prisma.player.findFirst({
      where: { id: playerId, organizationId: orgId, deletedAt: null },
      include: { team: true },
    });
    if (!player) throw new BadRequestException('Player not found');

    const team = player.team;
    const playerKills = await this.prisma.matchEvent.count({
      where: { matchId, playerId, type: 'KILL' },
    });
    const controlState = await this.canonicalRead.getStateSnapshot(matchId);
    const alive = this.canonicalRead.resolvePlayerAlive(controlState, {
      playerId: player.id,
      externalPlayerId: player.externalPlayerId ?? null,
      pubgPlayerId: player.inGameId ?? player.pubgPlayerId ?? null,
      playerOpenId: player.playerOpenId ?? null,
    });

    const focus = {
      playerId: player.id,
      name: player.ign ?? player.realName ?? 'Player',
      photoUrl: player?.photoUrl ?? null,
      teamId: team?.id ?? null,
      teamName: team?.name ?? null,
      teamLogoUrl: team?.logoUrl ?? null,
      kills: playerKills,
      health: null,
      isAlive: alive === null ? null : !!alive,
    };

    const state = this.cache.setFocus(matchId, focus);
    this.events.emitTelemetry({
      matchId,
      payload: {
        type: 'FOCUS_UPDATE',
        matchId,
        ts: Date.now(),
        payload: { focus },
      },
    });
    return { ok: true, focus, state };
  }

  async clearFocus(orgId: string, role: Role, matchId: string) {
    this.ensureRole(role);
    const match = await this.prisma.match.findFirst({
      where: {
        id: matchId,
        deletedAt: null,
        tournament: { organizationId: orgId },
      },
    });
    if (!match) throw new BadRequestException('Match not found');
    const state = this.cache.setFocus(matchId, null);
    this.events.emitTelemetry({
      matchId,
      payload: {
        type: 'FOCUS_UPDATE',
        matchId,
        ts: Date.now(),
        payload: { focus: null },
      },
    });
    return { ok: true, state };
  }
}
