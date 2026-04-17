import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  ControlCommand,
  EngineEvent,
  TelemetryMatchState,
  TelemetryPlayerState,
} from './telemetry.types';

@Injectable()
export class TelemetryValidatorService {
  private coerceIdentifier(value: unknown): string {
    if (typeof value === 'string') {
      return value.trim();
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value).trim();
    }
    return '';
  }

  validateTelemetryEvent(state: TelemetryMatchState, event: EngineEvent): void {
    if (state.mode === 'MANUAL') {
      throw new BadRequestException(
        'Telemetry events are disabled while the match is in MANUAL mode',
      );
    }

    switch (event.type) {
      case 'PLAYER_ALIVE_CHANGED':
        this.assertPlayerExists(
          state,
          this.coerceIdentifier(event.payload.playerId),
          event.type,
        );
        return;
      case 'PLAYER_KNOCKED_CHANGED': {
        this.assertPlayerExists(
          state,
          this.coerceIdentifier(event.payload.playerId),
          event.type,
        );
        return;
      }
      case 'PLAYER_KILL': {
        this.assertPlayerExists(
          state,
          this.coerceIdentifier(event.payload.killerPlayerId),
          event.type,
        );
        const victimPlayerId = this.coerceIdentifier(
          event.payload.victimPlayerId,
        );
        if (victimPlayerId) {
          this.assertPlayerExists(state, victimPlayerId, event.type);
        }
        return;
      }
      case 'TEAM_ELIMINATED':
        this.assertTeamExists(
          state,
          this.coerceIdentifier(event.payload.teamId),
          event.type,
        );
        return;
      case 'MATCH_STARTED':
      case 'MATCH_ENDED':
        return;
      default:
        throw new BadRequestException('Unsupported telemetry event');
    }
  }

  validateControlCommand(state: TelemetryMatchState, command: ControlCommand) {
    switch (command.type) {
      case 'START_MATCH':
        if (state.status === 'LOCKED') {
          throw new BadRequestException('Locked results cannot be restarted');
        }
        return;
      case 'END_MATCH':
        if (state.status === 'LOCKED') {
          throw new BadRequestException('Match results are already locked');
        }
        return;
      case 'LOCK_RESULTS':
        if (state.status !== 'ENDED' && state.teamsAlive > 1) {
          throw new BadRequestException(
            'Results can only be locked after the match has ended',
          );
        }
        return;
      case 'SET_PLAYER_ALIVE':
        this.assertPlayerExists(state, command.playerId, command.type);
        return;
      case 'SET_PLAYER_KNOCKED': {
        this.assertPlayerExists(state, command.playerId, command.type);
        return;
      }
      case 'SET_PLAYER_KILLS':
        this.assertPlayerExists(state, command.playerId, command.type);
        if (!Number.isInteger(command.kills) || command.kills < 0) {
          throw new BadRequestException('kills must be a non-negative integer');
        }
        return;
      default:
        throw new BadRequestException('Unsupported control command');
    }
  }

  private assertPlayerExists(
    state: TelemetryMatchState,
    playerId: string,
    action: string,
  ): TelemetryPlayerState {
    if (!playerId) {
      throw new BadRequestException(`playerId is required for ${action}`);
    }
    const player = state.players[playerId];
    if (!player) {
      throw new BadRequestException(`Unknown playerId: ${playerId}`);
    }
    return player;
  }

  private assertTeamExists(
    state: TelemetryMatchState,
    teamId: string,
    action: string,
  ) {
    if (!teamId) {
      throw new BadRequestException(`teamId is required for ${action}`);
    }
    if (!state.teams[teamId]) {
      throw new BadRequestException(`Unknown teamId: ${teamId}`);
    }
  }
}
