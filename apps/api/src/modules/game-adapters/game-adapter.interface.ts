import {
  AdapterContext,
  AdapterDescriptor,
  AdapterSnapshot,
  AdapterTelemetryEnvelope,
} from './game-adapter.types';

export interface GameAdapter extends AdapterDescriptor {
  /**
   * Return a lightweight snapshot of a match suitable for UI summary rendering.
   * Implementations must be side-effect free and safe to call repeatedly.
   */
  getSnapshot(matchId: string, ctx: AdapterContext): Promise<AdapterSnapshot>;

  /**
   * Optional polling hook for adapters backed by live telemetry feeds.
   * Implementations should only normalize source data and must not write results.
   */
  pullTelemetry?(
    matchId: string,
    ctx: AdapterContext,
  ): Promise<AdapterTelemetryEnvelope | null>;

  /**
   * Optional event-driven hook for adapters that receive pushed telemetry.
   * Implementations should normalize the envelope into the internal DTO only.
   */
  normalizeTelemetryEnvelope?(
    matchId: string,
    envelope: unknown,
    ctx: AdapterContext,
  ): Promise<AdapterTelemetryEnvelope | null>;
}
