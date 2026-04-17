// Placeholder types for PCOB socket payloads (read-only relay)
export type PcobTelemetryPayload = {
  type: string;
  matchId: string;
  ts: number;
  payload: Record<string, unknown>;
  meta?: {
    nodeId?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};
