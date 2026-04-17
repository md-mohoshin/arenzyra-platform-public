import { Module } from '@nestjs/common';
import { RealtimeHeartbeatService } from './realtime-heartbeat.service';
import { RealtimeRelayService } from './realtime-relay.service';
import { TelemetryGateway } from './telemetry.gateway';
import { WidgetGateway } from './widget.gateway';

@Module({
  providers: [
    RealtimeRelayService,
    RealtimeHeartbeatService,
    TelemetryGateway,
    WidgetGateway,
  ],
  exports: [RealtimeRelayService, TelemetryGateway, WidgetGateway],
})
export class RealtimeTransportModule {}
