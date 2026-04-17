import { deriveTelemetryRuntimeContract } from './telemetry-runtime-contract.util';

describe('telemetry runtime contract', () => {
  const now = Date.parse('2026-04-01T10:00:00.000Z');

  it('derives active telemetry only from fresh ingest heartbeats while live', () => {
    expect(
      deriveTelemetryRuntimeContract({
        lifecycleStatus: 'LIVE',
        nowMs: now,
        metaJson: {
          telemetryRuntime: {
            lastTransportAt: '2026-04-01T09:59:55.000Z',
            lastPacketAt: '2026-04-01T09:59:58.000Z',
            lastAcceptedAt: '2026-04-01T09:59:57.000Z',
            lastAcceptedSource: 'PCOB',
            lastAcceptedSequence: 42,
          },
        },
      }),
    ).toEqual(
      expect.objectContaining({
        transportConnected: true,
        packetsReceiving: true,
        telemetryAccepted: true,
        telemetryActive: true,
        lastAcceptedSource: 'PCOB',
        lastAcceptedSequence: 42,
      }),
    );
  });

  it('keeps telemetry accepted separate from telemetry active after public lifecycle ends', () => {
    expect(
      deriveTelemetryRuntimeContract({
        lifecycleStatus: 'ENDED',
        nowMs: now,
        metaJson: {
          telemetryRuntime: {
            lastTransportAt: '2026-04-01T09:59:55.000Z',
            lastPacketAt: '2026-04-01T09:59:58.000Z',
            lastAcceptedAt: '2026-04-01T09:59:57.000Z',
          },
        },
      }),
    ).toEqual(
      expect.objectContaining({
        transportConnected: true,
        packetsReceiving: true,
        telemetryAccepted: true,
        telemetryActive: false,
      }),
    );
  });
});
