import { Injectable } from '@nestjs/common';
import { RealtimeGateway } from '../../realtime/realtime.gateway';

export type ObserverTeamEliminationPayload = {
  matchId: string;
  eventId: string;
  teamId: string;
  teamName: string;
  placement: number | null;
  kills: number;
  eliminatedAt: string;
};

@Injectable()
export class ObserverTeamEliminationService {
  private readonly teamEliminationBuffer = new Map<
    string,
    ObserverTeamEliminationPayload[]
  >();
  private readonly maxEventsPerMatch = 50;

  constructor(private readonly realtime: RealtimeGateway) {}

  list(matchId: string): ObserverTeamEliminationPayload[] {
    const normalizedMatchId = String(matchId || '').trim();
    if (!normalizedMatchId) {
      return [];
    }

    return [...(this.teamEliminationBuffer.get(normalizedMatchId) ?? [])].sort(
      (left, right) => {
        const leftTimestamp = Date.parse(left.eliminatedAt);
        const rightTimestamp = Date.parse(right.eliminatedAt);
        if (leftTimestamp !== rightTimestamp) {
          return leftTimestamp - rightTimestamp;
        }
        return left.eventId.localeCompare(right.eventId);
      },
    );
  }

  publish(payload: ObserverTeamEliminationPayload): boolean {
    const normalizedMatchId = String(payload?.matchId || '').trim();
    const normalizedEventId = String(payload?.eventId || '').trim();
    const normalizedTeamId = String(payload?.teamId || '').trim();
    const normalizedTeamName = String(payload?.teamName || '').trim();

    if (
      !normalizedMatchId ||
      !normalizedEventId ||
      !normalizedTeamId ||
      !normalizedTeamName
    ) {
      return false;
    }

    const nextPayload: ObserverTeamEliminationPayload = {
      matchId: normalizedMatchId,
      eventId: normalizedEventId,
      teamId: normalizedTeamId,
      teamName: normalizedTeamName,
      placement:
        typeof payload?.placement === 'number' &&
        Number.isFinite(payload.placement) &&
        payload.placement > 0
          ? Math.trunc(payload.placement)
          : null,
      kills:
        typeof payload?.kills === 'number' && Number.isFinite(payload.kills)
          ? Math.max(0, Math.trunc(payload.kills))
          : 0,
      eliminatedAt:
        typeof payload?.eliminatedAt === 'string' &&
        payload.eliminatedAt.trim().length > 0
          ? payload.eliminatedAt
          : new Date().toISOString(),
    };

    if (!this.store(nextPayload)) {
      return false;
    }

    this.realtime.emitObserverTeamEliminated(nextPayload);
    return true;
  }

  private store(payload: ObserverTeamEliminationPayload): boolean {
    const buffer = this.teamEliminationBuffer.get(payload.matchId) ?? [];
    if (buffer.some((event) => event.eventId === payload.eventId)) {
      return false;
    }

    buffer.push(payload);
    while (buffer.length > this.maxEventsPerMatch) {
      buffer.shift();
    }

    this.teamEliminationBuffer.set(payload.matchId, buffer);
    return true;
  }
}
