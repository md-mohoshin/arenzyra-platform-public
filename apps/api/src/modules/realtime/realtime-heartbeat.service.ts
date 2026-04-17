import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { RealtimeRelayService } from './realtime-relay.service';
import { REALTIME_HEARTBEAT_SWEEP_MS } from './realtime-types';

@Injectable()
export class RealtimeHeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeHeartbeatService.name);

  private intervalRef: NodeJS.Timeout | null = null;

  constructor(private readonly relay: RealtimeRelayService) {}

  onModuleInit() {
    this.intervalRef = setInterval(() => {
      const result = this.relay.markStaleClients();
      const staleCount =
        result.staleTelemetryClientIds.length +
        result.staleWidgetClientIds.length;
      const recoveredCount =
        result.recoveredTelemetryClientIds.length +
        result.recoveredWidgetClientIds.length;

      if (staleCount === 0 && recoveredCount === 0) {
        return;
      }

      this.logger.warn(
        `heartbeat sweep stale telemetry=${result.staleTelemetryClientIds.length} widget=${result.staleWidgetClientIds.length} recovered telemetry=${result.recoveredTelemetryClientIds.length} widget=${result.recoveredWidgetClientIds.length}`,
      );
    }, REALTIME_HEARTBEAT_SWEEP_MS);

    this.intervalRef.unref?.();
  }

  onModuleDestroy() {
    if (!this.intervalRef) {
      return;
    }

    clearInterval(this.intervalRef);
    this.intervalRef = null;
  }
}
