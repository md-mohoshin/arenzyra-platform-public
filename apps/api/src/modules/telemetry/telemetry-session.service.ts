import { Injectable } from '@nestjs/common';

type TelemetrySessionBinding = {
  clientId: string;
  matchId: string;
  source: string;
  boundAt: number;
};

@Injectable()
export class TelemetrySessionService {
  private readonly bindings = new Map<string, TelemetrySessionBinding>();

  bind(clientId: string, matchId: string, source?: string | null) {
    const binding: TelemetrySessionBinding = {
      clientId,
      matchId,
      source: source?.trim() || `telemetry:${clientId}`,
      boundAt: Date.now(),
    };
    this.bindings.set(clientId, binding);
    return binding;
  }

  get(clientId: string): TelemetrySessionBinding | null {
    return this.bindings.get(clientId) ?? null;
  }

  unbind(clientId: string) {
    this.bindings.delete(clientId);
  }
}
