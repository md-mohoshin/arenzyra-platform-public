import { SimEvent, SimPhase, SimSnapshot, SimTeam } from './pubgm-sim.types';

type EngineOptions = {
  tickMs: number;
  onUpdate: (snapshot: SimSnapshot) => void;
  seed?: number;
};

const DEFAULT_TICK_MS = 1000;

export class PubgmSimEngine {
  private readonly matchId: string;
  private readonly onUpdate: (snapshot: SimSnapshot) => void;
  private readonly tickMs: number;
  private readonly rng: () => number;
  private teams: SimTeam[];
  private interval: NodeJS.Timeout | null = null;
  private startedAt: number;
  private events: SimEvent[] = [];
  private phase: SimPhase = 'LOBBY';

  constructor(matchId: string, teams: SimTeam[], options: EngineOptions) {
    this.matchId = matchId;
    this.onUpdate = options.onUpdate;
    this.tickMs = options.tickMs || DEFAULT_TICK_MS;
    this.teams = teams;
    this.startedAt = Date.now();
    this.rng = this.seededRng(options.seed ?? Date.now());
  }

  start() {
    this.stop();
    this.startedAt = Date.now();
    this.interval = setInterval(() => this.tick(), this.tickMs);
    // Emit initial snapshot
    this.tick();
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  forcePhase(phase: SimPhase) {
    this.phase = phase;
  }

  snapshot(): SimSnapshot {
    const aliveTeams = this.teams.filter((t) => t.alive).length;
    const alivePlayers = aliveTeams * 4; // heuristic
    return {
      matchId: this.matchId,
      updatedAt: new Date().toISOString(),
      phase: this.phase,
      elapsedSec: Math.floor((Date.now() - this.startedAt) / 1000),
      aliveTeams,
      alivePlayers,
      teams: [...this.teams],
      events: [...this.events],
    };
  }

  private tick() {
    try {
      this.advancePhase();
      this.generateKills();
      this.maybeEliminate();
      const snap = this.snapshot();
      this.onUpdate(snap);
      if (this.phase === 'FINISHED') {
        this.stop();
      }
    } catch {
      // do nothing; keep engine resilient
    }
  }

  private advancePhase() {
    const elapsed = (Date.now() - this.startedAt) / 1000;
    if (this.phase === 'FINISHED') return;
    if (elapsed < 10) this.phase = 'LOBBY';
    else if (elapsed < 60) this.phase = 'DROP';
    else if (elapsed < 240) this.phase = 'MID';
    else this.phase = 'END';

    const alive = this.teams.filter((t) => t.alive).length;
    if (alive <= 1) {
      this.phase = 'FINISHED';
      const last = this.teams.find((t) => t.alive);
      if (last) {
        last.placement = 1;
      }
    }
  }

  private generateKills() {
    const alive = this.teams.filter((t) => t.alive);
    if (alive.length < 2) return;
    const pKill = 0.35;
    if (this.rng() > pKill) return;
    const killCount = 1 + Math.floor(this.rng() * 3); // 1-3 kills
    for (let i = 0; i < killCount; i++) {
      const killer = alive[Math.floor(this.rng() * alive.length)];
      let victim = alive[Math.floor(this.rng() * alive.length)];
      if (alive.length > 1) {
        while (victim.teamId === killer.teamId) {
          victim = alive[Math.floor(this.rng() * alive.length)];
        }
      }
      killer.kills += 1;
      this.events.push({
        t: new Date().toISOString(),
        type: 'KILL',
        killerTeamId: killer.teamId,
        victimTeamId: victim.teamId,
        count: 1,
      });
    }
  }

  private maybeEliminate() {
    const alive = this.teams.filter((t) => t.alive);
    if (alive.length <= 1) {
      if (alive.length === 1) {
        alive[0].placement = 1;
      }
      this.phase = 'FINISHED';
      return;
    }
    const pElim = 0.15;
    if (this.rng() > pElim) return;
    const weighted = alive.sort((a, b) => a.kills - b.kills);
    const victim =
      weighted[
        Math.floor(this.rng() * Math.max(1, Math.floor(weighted.length / 2)))
      ];
    const placement = alive.length;
    victim.alive = false;
    victim.placement = placement;
    this.events.push({
      t: new Date().toISOString(),
      type: 'ELIM',
      victimTeamId: victim.teamId,
    });
  }

  private seededRng(seed: number): () => number {
    let state = seed % 2147483647;
    if (state <= 0) state += 2147483646;
    return () => {
      state = (state * 16807) % 2147483647;
      return (state - 1) / 2147483646;
    };
  }
}
