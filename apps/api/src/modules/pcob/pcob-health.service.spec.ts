import { MatchDataSource, MatchStatus } from '@prisma/client';
import { PcobHealthService } from './pcob-health.service';
import { TelemetryPhase } from '../../types/telemetry-phase';

describe('PcobHealthService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('treats API-bound pubgm-pcob telemetry as a live automatic feed', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-20T19:00:00.000Z'));
    const service = new PcobHealthService();

    service.onTelemetryWithContext('match-1', 'client-1', {
      status: MatchStatus.LIVE,
      dataSource: MatchDataSource.API,
      adapterKey: 'pubgm-pcob',
      authoritative: true,
      authoritySource: 'API_AUTHORITATIVE',
      scoringMode: 'AUTO_LOCKED',
    });

    expect(service.get('match-1')).toEqual(
      expect.objectContaining({
        status: 'ok',
        clientId: 'client-1',
        phase: TelemetryPhase.IN_GAME,
        feedState: 'PCOB_LIVE',
        authoritySource: 'API_AUTHORITATIVE',
        scoringMode: 'AUTO_LOCKED',
      }),
    );
  });
});
