import type { MatchLifecycleStatus } from './match-status.util';
import { canonicalizeTelemetryRuntimeSource } from './telemetry-source.util';

export const TELEMETRY_RUNTIME_TRANSPORT_WINDOW_MS = 15_000;
export const TELEMETRY_RUNTIME_PACKET_WINDOW_MS = 15_000;
export const TELEMETRY_RUNTIME_ACCEPTED_WINDOW_MS = 15_000;

export type TelemetryRuntimeMeta = {
  lastTransportAt: string | null;
  lastPacketAt: string | null;
  lastTransportSource: string | null;
  lastAcceptedAt: string | null;
  lastAcceptedSource: string | null;
  lastAcceptedSequence: number | null;
  lastIgnoredAt: string | null;
  lastIgnoredReason: string | null;
};

export type TelemetryRuntimeContract = TelemetryRuntimeMeta & {
  transportConnected: boolean;
  packetsReceiving: boolean;
  telemetryAccepted: boolean;
  telemetryActive: boolean;
};

type DeriveTelemetryRuntimeContractParams = {
  lifecycleStatus: MatchLifecycleStatus;
  metaJson: unknown;
  nowMs?: number;
  fallbackTransportAt?: unknown;
  fallbackPacketAt?: unknown;
  fallbackAcceptedAt?: unknown;
};

const asJsonRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const normalizeTimestamp = (value: unknown): string | null => {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
};

const normalizeSequence = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeReason = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isFresh = (
  value: string | null,
  nowMs: number,
  freshnessWindowMs: number,
): boolean => {
  if (!value) {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && nowMs - parsed <= freshnessWindowMs;
};

export function readTelemetryRuntimeMeta(
  metaJson: unknown,
): TelemetryRuntimeMeta {
  const meta = asJsonRecord(metaJson);
  const runtime = asJsonRecord(meta?.telemetryRuntime);
  return {
    lastTransportAt: normalizeTimestamp(runtime?.lastTransportAt),
    lastPacketAt: normalizeTimestamp(runtime?.lastPacketAt),
    lastTransportSource: canonicalizeTelemetryRuntimeSource(
      normalizeReason(runtime?.lastTransportSource),
    ),
    lastAcceptedAt: normalizeTimestamp(runtime?.lastAcceptedAt),
    lastAcceptedSource: canonicalizeTelemetryRuntimeSource(
      normalizeReason(runtime?.lastAcceptedSource),
    ),
    lastAcceptedSequence: normalizeSequence(runtime?.lastAcceptedSequence),
    lastIgnoredAt: normalizeTimestamp(runtime?.lastIgnoredAt),
    lastIgnoredReason: normalizeReason(runtime?.lastIgnoredReason),
  };
}

export function writeTelemetryRuntimeMeta(
  metaJson: unknown,
  patch: Partial<TelemetryRuntimeMeta>,
): Record<string, unknown> {
  const meta = asJsonRecord(metaJson) ?? {};
  const current = readTelemetryRuntimeMeta(metaJson);
  const next: TelemetryRuntimeMeta = {
    ...current,
    ...patch,
    lastTransportAt: normalizeTimestamp(
      patch.lastTransportAt ?? current.lastTransportAt,
    ),
    lastPacketAt: normalizeTimestamp(
      patch.lastPacketAt ?? current.lastPacketAt,
    ),
    lastTransportSource: canonicalizeTelemetryRuntimeSource(
      patch.lastTransportSource ?? current.lastTransportSource,
    ),
    lastAcceptedAt: normalizeTimestamp(
      patch.lastAcceptedAt ?? current.lastAcceptedAt,
    ),
    lastAcceptedSource: canonicalizeTelemetryRuntimeSource(
      patch.lastAcceptedSource ?? current.lastAcceptedSource,
    ),
    lastAcceptedSequence: normalizeSequence(
      patch.lastAcceptedSequence ?? current.lastAcceptedSequence,
    ),
    lastIgnoredAt: normalizeTimestamp(
      patch.lastIgnoredAt ?? current.lastIgnoredAt,
    ),
    lastIgnoredReason: normalizeReason(
      patch.lastIgnoredReason ?? current.lastIgnoredReason,
    ),
  };

  return {
    ...meta,
    telemetryRuntime: next,
  };
}

export function deriveTelemetryRuntimeContract(
  params: DeriveTelemetryRuntimeContractParams,
): TelemetryRuntimeContract {
  const nowMs = params.nowMs ?? Date.now();
  const runtime = readTelemetryRuntimeMeta(params.metaJson);
  const lastTransportAt =
    runtime.lastTransportAt ?? normalizeTimestamp(params.fallbackTransportAt);
  const lastPacketAt =
    runtime.lastPacketAt ??
    normalizeTimestamp(params.fallbackPacketAt) ??
    lastTransportAt;
  const lastAcceptedAt =
    runtime.lastAcceptedAt ?? normalizeTimestamp(params.fallbackAcceptedAt);

  const transportConnected = isFresh(
    lastTransportAt,
    nowMs,
    TELEMETRY_RUNTIME_TRANSPORT_WINDOW_MS,
  );
  const packetsReceiving = isFresh(
    lastPacketAt,
    nowMs,
    TELEMETRY_RUNTIME_PACKET_WINDOW_MS,
  );
  const telemetryAccepted = isFresh(
    lastAcceptedAt,
    nowMs,
    TELEMETRY_RUNTIME_ACCEPTED_WINDOW_MS,
  );

  return {
    ...runtime,
    lastTransportAt,
    lastPacketAt,
    lastAcceptedAt,
    transportConnected,
    packetsReceiving,
    telemetryAccepted,
    telemetryActive:
      params.lifecycleStatus === 'LIVE' &&
      transportConnected &&
      packetsReceiving &&
      telemetryAccepted,
  };
}
