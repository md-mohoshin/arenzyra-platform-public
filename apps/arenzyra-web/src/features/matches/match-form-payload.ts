export type MatchSourceSelection = "API" | "MANUAL";

export type MatchTelemetryProvider = "MANUAL" | "API" | "SHADOW" | "PCOB";

export const PCOB_TELEMETRY_ADAPTER_KEY = "pubgm-pcob";
export const MATCH_SOURCE_OPTIONS: ReadonlyArray<{
  value: MatchSourceSelection;
  label: string;
}> = [
  { value: "API", label: "Automatic" },
  { value: "MANUAL", label: "Manual" },
] as const;

const PCOB_BINDING_FIELDS = [
  "pcobSessionId",
  "pcobBoundAt",
  "pcobLastSeenAt",
  "pcobMode",
  "pcobKillSyncEnabled",
  "pcobStatus",
  "adapterKey",
] as const;

const TELEMETRY_CONTRACT_FIELDS = [
  "dataMode",
  "dataSource",
  "telemetryProvider",
] as const;

const normalizeUpper = (value: string | null | undefined) =>
  String(value ?? "").trim().toUpperCase();

const firstNormalizedValue = (...values: Array<string | null | undefined>) => {
  for (const value of values) {
    const normalized = normalizeUpper(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
};

const normalizeSessionId = (value: string | null | undefined) => {
  const normalized = String(value ?? "").trim();
  return normalized.length ? normalized : null;
};

const stripPcobOnlyFields = (payload: Record<string, unknown>) => {
  for (const field of PCOB_BINDING_FIELDS) {
    delete payload[field];
  }

  for (const field of Object.keys(payload)) {
    if (field.toLowerCase().startsWith("pcob")) {
      delete payload[field];
    }
  }
};

const setCanonicalTelemetryProvider = (
  payload: Record<string, unknown>,
  telemetryProvider: MatchTelemetryProvider,
) => {
  for (const field of TELEMETRY_CONTRACT_FIELDS) {
    delete payload[field];
  }

  payload.telemetryProvider = telemetryProvider;
  payload.dataSource = telemetryProvider;
};

export function isManualTelemetrySource(value: string | null | undefined) {
  return normalizeUpper(value) === "MANUAL";
}

export function getTelemetrySourceLabel(value: string | null | undefined) {
  return isManualTelemetrySource(value) ? "Manual" : "Automatic";
}

export function getMatchSourceSelection(input: {
  telemetryProvider?: string | null;
  dataSource?: string | null;
}): MatchSourceSelection {
  return firstNormalizedValue(input.telemetryProvider, input.dataSource) === "MANUAL"
    ? "MANUAL"
    : "API";
}

export function toTelemetryProvider(
  selection: string | null | undefined,
): MatchTelemetryProvider {
  const normalized = normalizeUpper(selection);
  if (normalized === "MANUAL") {
    return "MANUAL";
  }
  if (normalized === "PCOB") {
    return "PCOB";
  }
  return "API";
}

export function sanitizeMatchFormPayload(
  basePayload: Record<string, unknown>,
  options: {
    sourceSelection?: string | null;
    pcobSessionId?: string | null;
    allowPcobProvider?: boolean;
  },
) {
  const telemetryProvider = toTelemetryProvider(options.sourceSelection);
  const payload: Record<string, unknown> = { ...basePayload };

  stripPcobOnlyFields(payload);
  setCanonicalTelemetryProvider(payload, telemetryProvider);

  if (telemetryProvider !== "PCOB") {
    return {
      payload,
      telemetryProvider,
      error: null,
    };
  }

  if (options.allowPcobProvider !== true) {
    return {
      payload,
      telemetryProvider,
      error:
        "Use the dedicated PCOB binding flow to enable PCOB on an existing match.",
    };
  }

  const pcobSessionId = normalizeSessionId(options.pcobSessionId);
  if (!pcobSessionId) {
    return {
      payload,
      telemetryProvider,
      error: "PCOB session ID is required when Telemetry Source is PCOB.",
    };
  }

  setCanonicalTelemetryProvider(payload, "PCOB");
  payload.pcobSessionId = pcobSessionId;
  payload.adapterKey = PCOB_TELEMETRY_ADAPTER_KEY;

  return {
    payload,
    telemetryProvider,
    error: null,
  };
}
