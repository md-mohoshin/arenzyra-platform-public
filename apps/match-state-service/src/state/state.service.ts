import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import axios, { AxiosInstance } from "axios";
import { StateGateway } from "./state.gateway";
import {
  CircleInfo,
  MatchStateSnapshot,
  NormalizedBackpack,
  NormalizedKill,
  NormalizedPlayer,
  NormalizedTeam,
  ObserverInfo,
  RawState,
} from "./state.types";

@Injectable()
export class StateService implements OnModuleInit, OnModuleDestroy {
  private client: AxiosInstance;
  private pollIntervalMs: number;
  private timeoutMs: number;
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private latest: MatchStateSnapshot | null = null;
  private history: MatchStateSnapshot[] = [];
  private lastError: string | null = null;
  private lastPollTs: number | null = null;

  constructor(private readonly gateway: StateGateway) {
    this.pollIntervalMs = parseInt(process.env.POLL_INTERVAL_MS ?? "300", 10);
    this.timeoutMs = parseInt(process.env.POLL_TIMEOUT_MS ?? "1000", 10);
    const baseURL = (process.env.FLASK_BASE_URL || "http://127.0.0.1:5000").replace(/\/$/, "");
    this.client = axios.create({ baseURL, timeout: this.timeoutMs });
  }

  onModuleInit() {
    this.startPolling();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  getLatest() {
    return this.latest;
  }

  getHistory() {
    return this.history;
  }

  getHealth() {
    return {
      status: this.latest ? "ok" : "waiting",
      lastUpdate: this.latest?.ts ?? null,
      lastPollTs: this.lastPollTs,
      historySize: this.history.length,
      pollIntervalMs: this.pollIntervalMs,
      timeoutMs: this.timeoutMs,
      flaskBaseUrl: this.client.defaults.baseURL,
      lastError: this.lastError,
    };
  }

  private startPolling() {
    this.timer = setInterval(() => this.tick(), this.pollIntervalMs);
    this.tick(); // fire immediately
  }

  private async tick() {
    if (this.inFlight) return;
    this.inFlight = true;
    this.lastPollTs = Date.now();
    try {
      const raw = await this.fetchRawState();
      if (!raw) return;
      const snapshot = this.normalize(raw);
      this.recordSnapshot(snapshot);
      this.gateway.pushLatest(snapshot);
      this.lastError = null;
    } catch (err: any) {
      this.lastError = err?.message ?? "unknown error";
      // Keep service alive even if polling fails
      console.error("[poller] error", this.lastError);
    } finally {
      this.inFlight = false;
    }
  }

  private async fetchRawState(): Promise<RawState | null> {
    const paths = [
      { key: "allInfo", path: "/getallinfo" },
      { key: "teamInfoList", path: "/getteaminfolist" },
      { key: "totalPlayerList", path: "/gettotalplayerlist" },
      { key: "killInfo", path: "/getkillinfo" },
      { key: "circleInfo", path: "/getcircleinfo" },
      { key: "teamBackpackInfo", path: "/getteambackpackinfo" },
      { key: "observingPlayer", path: "/getobservingplayer" },
    ] as const;

    const results = await Promise.all(paths.map(({ path }) => this.safeGet(path)));
    const raw: RawState = {
      allInfo: results[0],
      teamInfoList: results[1],
      totalPlayerList: results[2],
      killInfo: results[3],
      circleInfo: results[4],
      teamBackpackInfo: results[5],
      observingPlayer: results[6],
    };

    const hasData = Object.values(raw).some((v) => v !== null && v !== undefined);
    return hasData ? raw : null;
  }

  private async safeGet(path: string) {
    try {
      const res = await this.client.get(path);
      return res.data ?? null;
    } catch (err: any) {
      const status = err?.response?.status;
      const msg = status ? `HTTP ${status}` : err?.message;
      console.warn(`[poller] failed GET ${path}: ${msg}`);
      return null;
    }
  }

  private recordSnapshot(snapshot: MatchStateSnapshot) {
    this.latest = snapshot;
    this.history.unshift(snapshot);
    if (this.history.length > 200) {
      this.history.pop();
    }
  }

  private normalize(raw: RawState): MatchStateSnapshot {
    const teams = this.normalizeTeams(raw);
    const players = this.normalizePlayers(raw);
    const kills = this.normalizeKills(raw);
    const circle = this.normalizeCircle(raw);
    const observer = this.normalizeObserver(raw);
    const backpacks = this.normalizeBackpacks(raw);

    return {
      ts: Date.now(),
      status: "ok",
      teams,
      players,
      kills,
      circle,
      observer,
      backpacks,
      raw,
    };
  }

  private normalizeTeams(raw: RawState): NormalizedTeam[] {
    const source = this.firstArray(
      this.asArray(raw.teamInfoList, "teamInfoList"),
      this.asArray(raw.allInfo, "TeamInfoList"),
      this.asArray(raw.allInfo, "teamInfoList")
    );

    return source.map((team: any, idx: number) => {
      const id = this.pickString(team, ["teamId", "teamID", "TeamId", "TeamID", "id", "ID", "team_id"]) || `team-${idx + 1}`;
      return {
        id,
        name: this.pickString(team, ["teamName", "TeamName", "name"]),
        tag: this.pickString(team, ["teamTag", "tag", "Tag"]),
        slot: this.pickNumber(team, ["slot", "Slot", "teamNo", "teamNumber", "teamIndex"]),
        kills: this.pickNumber(team, ["kills", "Kills", "killNum", "KillNum", "killCount"]),
        alivePlayers: this.pickNumber(team, ["alivePlayers", "AlivePlayers", "alive", "AliveNum", "remainPlayerNum"]),
        totalPlayers: this.pickNumber(team, ["totalPlayers", "TotalPlayers", "PlayerNum"]),
        placement: this.pickNumber(team, ["rank", "Rank", "placement", "placementIndex"]),
        color: this.pickString(team, ["color", "Color"]) || null,
        raw: team,
      };
    });
  }

  private normalizePlayers(raw: RawState): NormalizedPlayer[] {
    const source = this.firstArray(
      this.asArray(raw.totalPlayerList, "playerInfoList"),
      this.asArray(raw.allInfo, "TotalPlayerList"),
      this.asArray(raw.allInfo, "PlayerList")
    );

    return source.map((player: any, idx: number) => {
      const id =
        this.pickString(player, ["playerId", "PlayerId", "PlayerID", "id", "ID"]) ||
        this.pickString(player, ["name", "playerName"]) ||
        `player-${idx + 1}`;
      return {
        id,
        ign: this.pickString(player, ["playerName", "PlayerName", "ign", "IGN", "name"]),
        teamId: this.pickString(player, ["teamId", "TeamId", "team_id", "team"]),
        status: this.pickString(player, ["status", "Status", "state", "State"]),
        hp: this.pickNumber(player, ["hp", "HP", "health"]),
        raw: player,
      };
    });
  }

  private normalizeKills(raw: RawState): NormalizedKill[] {
    const source = this.firstArray(
      this.asArray(raw.killInfo, "killList"),
      this.asArray(raw.killInfo, "KillList"),
      this.asArray(raw.killInfo, "kills"),
      this.asArray(raw.allInfo, "KillInfo"),
      this.asArray(raw.allInfo, "killInfo")
    );

    return source.map((kill: any) => {
      const ts = this.pickNumber(kill, ["ts", "timestamp", "time"]) ?? Date.now();
      return {
        ts,
        killerTeamId: this.pickString(kill, ["killerTeamId", "killerTeam", "teamId", "killerTeamID"]),
        victimTeamId: this.pickString(kill, ["victimTeamId", "victimTeam", "targetTeamId"]),
        killerName: this.pickString(kill, ["killerName", "killer", "killerPlayer"]),
        victimName: this.pickString(kill, ["victimName", "victim"]),
        weapon: this.pickString(kill, ["weapon", "weaponName"]),
        raw: kill,
      };
    });
  }

  private normalizeCircle(raw: RawState): CircleInfo | null {
    const source = raw.circleInfo || raw.allInfo?.CircleInfo || raw.allInfo?.circleInfo;
    if (!source || typeof source !== "object") return null;

    return {
      phase: this.pickNumber(source, ["phase", "Phase", "circlePhase"]),
      radius: this.pickNumber(source, ["radius", "Radius", "r"]),
      shrinking: this.pickBool(source, ["shrinking", "isShrinking"]),
      raw: source,
    };
  }

  private normalizeObserver(raw: RawState): ObserverInfo | null {
    const source = raw.observingPlayer || raw.allInfo?.ObservingPlayer || raw.allInfo?.observer;
    if (!source || typeof source !== "object") return null;

    return {
      playerName: this.pickString(source, ["playerName", "PlayerName", "observer"]),
      playerId: this.pickString(source, ["playerId", "PlayerId", "id"]),
      teamId: this.pickString(source, ["teamId", "TeamId", "team"]),
      raw: source,
    };
  }

  private normalizeBackpacks(raw: RawState): NormalizedBackpack[] {
    const source = this.firstArray(
      this.asArray(raw.teamBackpackInfo, "TeamBackpackInfo"),
      this.asArray(raw.teamBackpackInfo, "teamBackpackInfo"),
      this.asArray(raw.allInfo, "TeamBackpackInfo")
    );

    return source.map((entry: any) => ({
      teamId: this.pickString(entry, ["teamId", "TeamId", "team"]),
      items: entry?.items ?? entry?.Items ?? entry,
      raw: entry,
    }));
  }

  private asArray(value: any, childKey?: string): any[] {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (childKey && Array.isArray(value[childKey])) return value[childKey];
    if (Array.isArray(value.data)) return value.data;
    return [];
  }

  private firstArray(...arrays: any[][]): any[] {
    for (const arr of arrays) {
      if (Array.isArray(arr) && arr.length) return arr;
    }
    return arrays.find((arr) => Array.isArray(arr)) ?? [];
  }

  private pickString(obj: any, keys: string[], fallback: string | null = null): string | null {
    if (!obj || typeof obj !== "object") return fallback;
    for (const key of keys) {
      const val = obj[key];
      if (val === undefined || val === null) continue;
      if (typeof val === "string") return val;
      if (typeof val === "number" || typeof val === "boolean") return String(val);
    }
    return fallback;
  }

  private pickNumber(obj: any, keys: string[]): number | null {
    if (!obj || typeof obj !== "object") return null;
    for (const key of keys) {
      const val = obj[key];
      const num = typeof val === "string" ? Number(val) : typeof val === "number" ? val : null;
      if (num !== null && Number.isFinite(num)) return num;
    }
    return null;
  }

  private pickBool(obj: any, keys: string[]): boolean | null {
    if (!obj || typeof obj !== "object") return null;
    for (const key of keys) {
      const val = obj[key];
      if (typeof val === "boolean") return val;
      if (val === "true") return true;
      if (val === "false") return false;
    }
    return null;
  }
}
