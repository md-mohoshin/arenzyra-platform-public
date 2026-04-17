import type { ControlStatus } from '../match-control/dto/control.dto';
import type {
  MatchStateCircle,
  MatchStateObservedPlayer,
  TeamScoreState,
} from '../match-control/state.store';
import type { BroadcastEvent } from '../broadcast/broadcast-event.engine';
import type { MatchStateSyncResult } from '../match-state/match-state.engine';
import type { ObserverCameraSuggestion } from '../observer/observer-ai.service';
import type { FightEvent } from '../telemetry/fight-detection.engine';
import type { TelemetryPlayerKillEvent } from '../telemetry/telemetry.types';

export const EVENT_BUS_TOPICS = {
  MATCH: 'match.events',
  FIGHT: 'fight.events',
  BROADCAST: 'broadcast.events',
  OBSERVER: 'observer.events',
} as const;

export type EventBusTopic =
  (typeof EVENT_BUS_TOPICS)[keyof typeof EVENT_BUS_TOPICS];

export type EventBusEnvelope<T = unknown> = {
  id?: string;
  topic: EventBusTopic;
  type: string;
  timestamp: number;
  retryCount: number;
  publisherId: string;
  payload: T;
};

export type MatchTelemetrySnapshotEventPayload = {
  matchId: string;
  organizationId?: string | null;
  startedAt?: string | null;
  status?: ControlStatus | null;
  updatedAt?: string | number | null;
  teams: TeamScoreState[];
  totalPlayerList?: unknown;
  circle?: MatchStateCircle | null;
  observedPlayer?: MatchStateObservedPlayer | null;
  killEvents: TelemetryPlayerKillEvent[];
};

export type MatchStateUpdatedEventPayload = {
  matchId: string;
  organizationId?: string | null;
  projection: MatchStateSyncResult;
};

export type FightDetectedEventPayload = {
  matchId: string;
  organizationId?: string | null;
  fightEvent: FightEvent;
};

export type BroadcastMomentEventPayload = {
  matchId: string;
  organizationId?: string | null;
  broadcastEvent: BroadcastEvent;
};

export type ObserverSuggestionEventPayload = {
  matchId: string;
  organizationId?: string | null;
  suggestion: ObserverCameraSuggestion;
};
