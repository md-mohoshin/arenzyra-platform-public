import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';
import type { PcobTelemetryPayload } from './pcob.types';

type TelemetryEvent = { matchId: string; payload: PcobTelemetryPayload };

@Injectable()
export class PcobEventsService {
  private emitter = new EventEmitter();

  emitTelemetry(evt: TelemetryEvent) {
    if (!evt?.matchId) return;
    this.emitter.emit('telemetry', evt);
  }

  onTelemetry(listener: (evt: TelemetryEvent) => void): () => void {
    this.emitter.on('telemetry', listener);
    return () => this.emitter.off('telemetry', listener);
  }
}
