import { TelemetrySource } from '@prisma/client';
import {
  assertTelemetrySourceAllowed,
  canonicalizeTelemetryRuntimeSource,
  isTelemetrySourceLocked,
  normalizeTelemetrySource,
} from './telemetry-source.util';

describe('telemetry source normalization', () => {
  it('canonicalizes launcher aliases to API', () => {
    expect(normalizeTelemetrySource(TelemetrySource.LAUNCHER)).toBe(
      TelemetrySource.API,
    );
    expect(normalizeTelemetrySource('OBSERVER')).toBe(TelemetrySource.API);
    expect(normalizeTelemetrySource(TelemetrySource.API)).toBe(
      TelemetrySource.API,
    );
  });

  it('treats legacy launcher locks as equivalent to API ingress', () => {
    expect(
      assertTelemetrySourceAllowed(
        {
          id: 'match-1',
          telemetrySource: TelemetrySource.LAUNCHER,
        },
        TelemetrySource.API,
      ),
    ).toEqual({
      incomingSource: TelemetrySource.API,
      activeSource: TelemetrySource.API,
      shouldLock: false,
    });
  });

  it('locks legacy launcher ingress requests as canonical API', () => {
    expect(
      assertTelemetrySourceAllowed(
        {
          id: 'match-1',
          telemetrySource: TelemetrySource.AUTO,
        },
        TelemetrySource.LAUNCHER,
      ),
    ).toEqual({
      incomingSource: TelemetrySource.API,
      activeSource: TelemetrySource.AUTO,
      shouldLock: true,
    });
  });

  it('treats launcher aliases as locked telemetry sources', () => {
    expect(isTelemetrySourceLocked(TelemetrySource.LAUNCHER)).toBe(true);
    expect(isTelemetrySourceLocked(TelemetrySource.AUTO)).toBe(false);
  });

  it('canonicalizes runtime source labels to API', () => {
    expect(canonicalizeTelemetryRuntimeSource(TelemetrySource.LAUNCHER)).toBe(
      TelemetrySource.API,
    );
    expect(canonicalizeTelemetryRuntimeSource('OBSERVER')).toBe(
      TelemetrySource.API,
    );
    expect(canonicalizeTelemetryRuntimeSource('PCOB_PUSH')).toBe(
      TelemetrySource.API,
    );
  });
});
