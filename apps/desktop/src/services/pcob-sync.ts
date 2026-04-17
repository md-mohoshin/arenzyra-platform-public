import type { AxiosInstance } from "axios";
import { fetchStatus, type BackendSnapshot } from "./backend";
import { makePcobClient, type PcobClient } from "./pcob";

export type PcobSyncState = {
  synced: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  retries: number;
};

const now = () => Date.now();

export class PcobSyncService {
  private state: PcobSyncState = {
    synced: false,
    lastSyncAt: null,
    lastError: null,
    retries: 0,
  };

  constructor(
    private readonly backend: AxiosInstance,
    private readonly pcob: PcobClient,
  ) {}

  getState(): PcobSyncState {
    return { ...this.state };
  }

  reset() {
    this.state = { synced: false, lastSyncAt: null, lastError: null, retries: 0 };
  }

  private setSynced(ok: boolean, error?: string | null) {
    this.state = {
      synced: ok,
      lastSyncAt: ok ? now() : this.state.lastSyncAt,
      lastError: error ?? null,
      retries: ok ? 0 : this.state.retries + 1,
    };
  }

  async sync(matchId: string, snapshot: BackendSnapshot): Promise<void> {
    const teams = snapshot.teams;
    const players = snapshot.players;

    if (!teams.length) {
      this.setSynced(false, "No teams to sync");
      return;
    }

    try {
      await this.pcob.loadTeams(teams);
      await this.pcob.loadLogos(teams);
      if (players.length) {
        await this.pcob.loadPlayers(players);
      }

      const slots = teams
        .filter((t) => t.slot !== null && t.slot !== undefined)
        .map((t) => ({ slot: t.slot as number, teamId: t.id }));
      if (slots.length) {
        await this.pcob.assignSlots(slots);
      }

      await this.pcob.updateScoreboard(matchId, teams);

      this.setSynced(true);
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.message || "pcob sync failed";
      this.setSynced(false, message);
      throw err;
    }
  }
}

export class MatchWatcherService {
  private lastStatus: string | null = null;
  private autoSync = true;

  constructor(private readonly backend: AxiosInstance) {}

  setAutoSync(enabled: boolean) {
    this.autoSync = enabled;
  }

  isAutoSyncEnabled() {
    return this.autoSync;
  }

  async status(matchId: string) {
    return fetchStatus(this.backend, matchId);
  }

  shouldSync(status?: string | null) {
    const prev = this.lastStatus;
    this.lastStatus = status ?? null;
    if (!this.autoSync) return false;
    if (!status) return false;
    return status === "LIVE" && prev !== "LIVE";
  }

  shouldReset(status?: string | null) {
    return status === "ENDED";
  }
}

export function makePcobSyncEngine(backend: AxiosInstance, pcobBase: string) {
  const pcob = makePcobClient(pcobBase);
  return {
    watcher: new MatchWatcherService(backend),
    sync: new PcobSyncService(backend, pcob),
  };
}
