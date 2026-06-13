export type FeedEnvelope = {
  source: string;
  matchId: string;
  sessionId?: string | null;
  sentAt: string;
  type: string;
  payload: any;
  authoritySource?: AuthoritySource;
  scoringMode?: ScoringMode;
};

export enum AuthoritySource {
  API_AUTHORITATIVE = 'API_AUTHORITATIVE',
  PCOB_AUTHORITATIVE = 'PCOB_AUTHORITATIVE',
  SIMULATOR_AUTOMATIC = 'SIMULATOR_AUTOMATIC',
  MANUAL = 'MANUAL',
  HEARTBEAT = 'HEARTBEAT',
}

export enum ScoringMode {
  AUTO_LOCKED = 'AUTO_LOCKED',
  AUTO_WITH_OVERRIDE = 'AUTO_WITH_OVERRIDE',
  MANUAL_ONLY = 'MANUAL_ONLY',
}
