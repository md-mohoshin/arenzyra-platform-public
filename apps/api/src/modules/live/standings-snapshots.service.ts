import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { StandingsService } from './standings.service';

type Scope = 'TOURNAMENT' | 'STAGE' | 'GROUP';

type SnapshotRecord = {
  id: string;
  scope: Scope;
  scopeId: string;
  label: string | null;
  createdById: string | null;
  isActive: boolean;
  data: unknown;
  createdAt: Date;
  deletedAt: Date | null;
};

@Injectable()
export class StandingsSnapshotsService {
  private readonly store = new Map<string, SnapshotRecord[]>();

  constructor(private readonly standings: StandingsService) {}

  private key(scope: Scope, scopeId: string) {
    return `${scope}:${scopeId}`;
  }

  private list(scope: Scope, scopeId: string) {
    return this.store.get(this.key(scope, scopeId)) ?? [];
  }

  async createSnapshot(params: {
    scope: Scope;
    scopeId: string;
    label?: string | null;
    createdById?: string | null;
  }) {
    const { scope, scopeId, label, createdById } = params;
    const payload = await this.standings.computeStandings({ scope, scopeId });
    const now = new Date();
    const key = this.key(scope, scopeId);
    const existing = this.list(scope, scopeId).map((s) => ({
      ...s,
      isActive: false,
    }));
    const snapshot: SnapshotRecord = {
      id: randomUUID(),
      scope,
      scopeId,
      label: label ?? null,
      createdById: createdById ?? null,
      isActive: existing.length === 0,
      data: payload,
      createdAt: now,
      deletedAt: null,
    };
    this.store.set(key, [...existing, snapshot]);
    return snapshot;
  }

  listSnapshots(scope: Scope, scopeId: string) {
    return this.list(scope, scopeId).filter((s) => !s.deletedAt);
  }

  getLatestSnapshot(scope: Scope, scopeId: string) {
    const active = this.list(scope, scopeId)
      .filter((s) => !s.deletedAt && s.isActive)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return active ?? null;
  }

  setActiveSnapshot(snapshotId: string) {
    let target: SnapshotRecord | null = null;
    for (const [key, snaps] of this.store.entries()) {
      const updated = snaps.map((s) => {
        if (s.id === snapshotId && !s.deletedAt) {
          target = s;
          return { ...s, isActive: true };
        }
        return { ...s, isActive: false };
      });
      this.store.set(key, updated);
    }
    if (!target) {
      throw new NotFoundException('Snapshot not found');
    }
  }

  softDeleteSnapshot(snapshotId: string) {
    let found = false;
    for (const [key, snaps] of this.store.entries()) {
      const updated = snaps.map((s) =>
        s.id === snapshotId
          ? { ...s, deletedAt: new Date(), isActive: false }
          : s,
      );
      if (
        snaps.length !== updated.length ||
        snaps.some((s) => s.id === snapshotId)
      ) {
        found = true;
        this.store.set(key, updated);
      }
    }
    if (!found) throw new NotFoundException('Snapshot not found');
  }
}
