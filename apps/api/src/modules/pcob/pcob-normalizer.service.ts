import { Injectable } from '@nestjs/common';
import {
  NormalizedCircle,
  NormalizedMatchState,
  NormalizedPlayerState,
  NormalizedTeamState,
} from '../../types/normalized-match-state';

@Injectable()
export class PcobNormalizerService {
  normalize(payload: Record<string, unknown>): NormalizedMatchState {
    const payloadRec = isRecord(payload) ? payload : {};
    const serverTime =
      this.toNumber(
        payloadRec.serverTime ?? payloadRec.timestamp ?? Date.now(),
        Date.now(),
      ) ?? Date.now();
    const matchId = this.toString(payloadRec.matchId) ?? 'unknown-match';
    const focusValue =
      payloadRec.focus === null
        ? null
        : isRecord(payloadRec.focus)
          ? payloadRec.focus
          : undefined;
    const focusPlayerValue =
      payloadRec.focusPlayer === null
        ? null
        : isRecord(payloadRec.focusPlayer)
          ? payloadRec.focusPlayer
          : undefined;
    const focus = focusValue ?? focusPlayerValue ?? undefined;

    const mapPayload = isRecord(payloadRec.map) ? payloadRec.map : {};
    const zonesPayload = isRecord(payloadRec.zones) ? payloadRec.zones : {};

    const mapName =
      this.toString(mapPayload.name ?? payloadRec.mapName ?? payloadRec.map) ??
      'UNKNOWN';
    const phase = this.toNumber(mapPayload.phase ?? payloadRec.phase);
    const nextShrinkAt = this.toFutureTimestamp(
      mapPayload.nextShrinkAt ??
        mapPayload.nextPhaseAt ??
        mapPayload.remainingTime ??
        mapPayload.countdown ??
        payloadRec.nextShrinkAt,
      serverTime,
    );

    const zones = {
      safe: this.parseCircle(
        zonesPayload.safe ??
          mapPayload.safeZone ??
          mapPayload.safe ??
          payloadRec.safeZone,
      ),
      next: this.parseCircle(
        zonesPayload.next ??
          mapPayload.nextZone ??
          mapPayload.nextSafeZone ??
          payloadRec.nextZone,
      ),
    };

    const teamsInput = Array.isArray(payloadRec.teams) ? payloadRec.teams : [];
    const teams: NormalizedTeamState[] = teamsInput.map(
      (team: unknown, idx: number) => {
        const teamRec = isRecord(team) ? team : {};
        const playersInput = Array.isArray(teamRec.players)
          ? teamRec.players
          : [];
        const players: NormalizedPlayerState[] = playersInput.map(
          (player: unknown) => {
            const playerRec = isRecord(player) ? player : {};
            const pos = this.parsePosition(
              playerRec.location ?? playerRec.pos ?? playerRec,
            );
            const knocked = this.toBoolean(playerRec.knocked, false);
            const eliminated = this.toBoolean(playerRec.eliminated, false);
            const alive =
              eliminated === true
                ? false
                : this.toBoolean(playerRec.alive, knocked && !eliminated);
            return {
              pubgAccountId: this.toString(
                playerRec.pubgAccountId ?? playerRec.pubgId ?? playerRec.id,
              ),
              ign: this.toString(playerRec.ign ?? playerRec.name),
              alive,
              knocked: knocked && !eliminated,
              eliminated,
              pos,
            };
          },
        );
        this.normalizeTeamPlayerStates(players);

        const aliveCount =
          this.toNumber(
            teamRec.aliveCount,
            players.filter((p) => p.eliminated !== true).length,
          ) ?? 0;
        const eliminated = this.toBoolean(
          teamRec.eliminated,
          aliveCount === 0 && players.length > 0,
        );

        return {
          slot: this.toNumber(teamRec.slot, idx + 1) ?? idx + 1,
          teamId: this.toString(teamRec.teamId ?? teamRec.id),
          name: this.toString(teamRec.name),
          tag: this.toString(teamRec.tag),
          logoUrl: this.toString(teamRec.logoUrl),
          aliveCount,
          eliminated,
          kills: this.toNumber(teamRec.kills),
          players,
        };
      },
    );
    const summary = this.buildSummary(teams);

    return {
      matchId,
      serverTime,
      map: {
        name: mapName,
        phase,
        nextShrinkAt,
      },
      zones,
      teams,
      summary,
      focus,
    };
  }

  private buildSummary(teams: NormalizedTeamState[]) {
    const totalTeams = teams.length;
    const aliveTeams = teams.filter(
      (t) => !t.eliminated && (t.aliveCount ?? 0) > 0,
    ).length;
    const totalPlayers = teams.reduce(
      (sum, team) => sum + (team.players?.length ?? 0),
      0,
    );
    const alivePlayers = teams.reduce(
      (sum, team) =>
        sum + (team.players?.filter((p) => p.eliminated !== true).length ?? 0),
      0,
    );
    return {
      totalTeams,
      aliveTeams,
      totalPlayers,
      alivePlayers,
      updatedAt: Date.now(),
    };
  }

  private parseCircle(data: unknown): NormalizedCircle | undefined {
    if (!data || !isRecord(data)) return undefined;
    const x = this.toNumber(
      data.x ?? (isRecord(data.center) ? data.center.x : undefined),
    );
    const y = this.toNumber(
      data.y ?? (isRecord(data.center) ? data.center.y : undefined),
    );
    const r = this.toNumber(data.r ?? data.radius);
    if (x === undefined || y === undefined || r === undefined) return undefined;
    return { x, y, r };
  }

  private parsePosition(pos: unknown): { x: number; y: number } | undefined {
    if (!pos || !isRecord(pos)) return undefined;
    const x = this.toNumber(pos.x);
    const y = this.toNumber(pos.y);
    if (x === undefined || y === undefined) return undefined;
    return { x, y };
  }

  private toNumber(value: unknown, fallback?: number): number | undefined {
    if (value === null || value === undefined || value === '') return fallback;
    const num = Number(value);
    if (Number.isNaN(num)) return fallback;
    return num;
  }

  private toFutureTimestamp(
    value: unknown,
    referenceMs: number,
  ): number | undefined {
    const parsed = this.toNumber(value);
    if (parsed === undefined) {
      return undefined;
    }
    if (parsed >= 0 && parsed <= 86_400) {
      return referenceMs + parsed * 1000;
    }
    return parsed < 10_000_000_000 ? parsed * 1000 : parsed;
  }

  private toString(value: unknown): string | undefined {
    if (typeof value === 'string') {
      const str = value.trim();
      return str.length ? str : undefined;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return undefined;
  }

  private toBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') return value;
    return fallback;
  }

  private normalizeTeamPlayerStates(players: NormalizedPlayerState[]): void {
    const remainingPlayers = players.filter(
      (player) => player.eliminated !== true,
    );
    if (
      remainingPlayers.length === 1 &&
      remainingPlayers[0]?.knocked === true
    ) {
      remainingPlayers[0].alive = false;
      remainingPlayers[0].knocked = false;
      remainingPlayers[0].eliminated = true;
    }
  }
}

const isRecord = (val: unknown): val is Record<string, unknown> =>
  !!val && typeof val === 'object';
