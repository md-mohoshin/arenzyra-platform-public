import axios, { AxiosInstance } from 'axios';

export type MatchStateTeam = {
  id: string;
  name?: string | null;
  tag?: string | null;
  slot?: number | null;
  kills?: number | null;
  placement?: number | null;
  logoUrl?: string | null;
};

export type MatchStatePlayer = {
  id: string;
  ign?: string | null;
  name?: string | null;
  teamId?: string | null;
  photoUrl?: string | null;
};

export type MatchStateCircle = {
  phase: number | null;
  radius: number | null;
  shrinking: boolean | null;
  raw?: unknown;
};

export type MatchStateSnapshot = {
  ts: number;
  status: string;
  teams: MatchStateTeam[];
  players: MatchStatePlayer[];
  kills: unknown[];
  circle: MatchStateCircle | null;
  observer: unknown;
  backpacks: unknown[];
  raw: Record<string, unknown>;
};

export class MatchStateClient {
  private readonly client: AxiosInstance;

  constructor() {
    const base =
      (process.env.MATCH_STATE_BASE || 'http://127.0.0.1:4000').replace(
        /\/$/,
        '',
      ) || 'http://127.0.0.1:4000';
    const timeout = Number(process.env.MATCH_STATE_TIMEOUT_MS ?? 1500);
    this.client = axios.create({ baseURL: base, timeout });
  }

  async getState(): Promise<MatchStateSnapshot | null> {
    try {
      const res = await this.client.get<{
        ok: boolean;
        state: MatchStateSnapshot;
      }>('/api/state');
      return (res.data?.state as MatchStateSnapshot | undefined) ?? null;
    } catch {
      return null;
    }
  }
}
