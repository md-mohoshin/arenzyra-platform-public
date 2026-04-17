jest.mock('../../common/telemetry-source.util', () => {
  const actual = jest.requireActual('../../common/telemetry-source.util');
  return {
    ...actual,
    enforceTelemetrySourceAllowed: jest.fn().mockResolvedValue(undefined),
  };
});

import type { PrismaService } from '../../db/prisma.service';
import type { ResultsIngestService } from '../results/results-ingest.service';
import type { OverlayGateway } from './overlay.gateway';
import { LiveSyncService } from './live-sync.service';

describe('LiveSyncService official result writes', () => {
  const baseState = {
    ts: 1,
    status: 'LIVE',
    teams: [
      {
        id: 'live-team-1',
        name: 'Team One',
        tag: 'T1',
        slot: 1,
        kills: 2,
        placement: null,
        logoUrl: null,
      },
    ],
    players: [],
    kills: [],
    circle: null,
    observer: null,
    backpacks: [],
    raw: {},
  };

  beforeEach(() => {
    process.env.ACTIVE_MATCH_ID = 'match-1';
    delete process.env.LIVE_SYNC_RESULTS_WRITE_ENABLED;
    jest.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.ACTIVE_MATCH_ID;
    delete process.env.LIVE_SYNC_RESULTS_WRITE_ENABLED;
  });

  function buildService() {
    const prisma = {} as PrismaService;
    const overlay = {
      broadcast: jest.fn(),
    } as unknown as OverlayGateway;
    const results = {
      ingest: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsIngestService;

    const service = new LiveSyncService(prisma, overlay, results);
    (service as any).client = {
      getState: jest.fn().mockResolvedValue(baseState),
    };
    (service as any).lookupOrg = jest.fn().mockResolvedValue(null);
    (service as any).persist = jest.fn().mockResolvedValue(undefined);
    (service as any).buildSnapshot = jest.fn().mockResolvedValue({
      matchId: 'match-1',
      ts: 1,
      organizationId: null,
      teams: [],
      players: [],
      circle: null,
      raw: {},
    });

    return { service, overlay, results };
  }

  it('does not write official results by default', async () => {
    const { service, overlay, results } = buildService();

    await (service as any).tick();

    expect(results.ingest as jest.Mock).not.toHaveBeenCalled();
    expect(overlay.broadcast as jest.Mock).toHaveBeenCalledTimes(1);
  });

  it('allows legacy official result writes only when explicitly enabled', async () => {
    process.env.LIVE_SYNC_RESULTS_WRITE_ENABLED = '1';
    const { service, results } = buildService();

    await (service as any).tick();

    expect(results.ingest as jest.Mock).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({
        status: 'LIVE',
      }),
    );
  });
});
