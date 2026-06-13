import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { FeedBusService } from './feed-bus.service';
import { FeedEnvelope } from './feed.types';
import { randomUUID } from 'crypto';

type FeedAuditEntry = {
  id: string;
  matchId: string;
  source: string;
  authoritySource?: string | null;
  scoringMode?: string | null;
  payload: unknown;
  timestamp: string;
  operatorId?: string | null;
};

@Injectable()
export class FeedAuditService implements OnModuleInit, OnModuleDestroy {
  private store = new Map<string, FeedAuditEntry[]>();
  private sub: { unsubscribe: () => void } | null = null;

  constructor(private readonly bus: FeedBusService) {}

  onModuleInit(): void {
    this.sub = this.bus.stream().subscribe((evt) => {
      this.append(evt);
    });
  }

  onModuleDestroy(): void {
    if (this.sub?.unsubscribe) this.sub.unsubscribe();
    this.store.clear();
  }

  private append(evt: FeedEnvelope): void {
    if (!evt?.matchId) return;
    const entry: FeedAuditEntry = {
      id: randomUUID(),
      matchId: evt.matchId,
      source: evt.source,
      authoritySource: evt.authoritySource ?? null,
      scoringMode: evt.scoringMode ?? null,
      payload: evt.payload,
      timestamp: evt.sentAt || new Date().toISOString(),
      operatorId: (evt as { operatorId?: string | null })?.operatorId ?? null,
    };
    const list = this.store.get(evt.matchId) ?? [];
    list.unshift(entry);
    this.store.set(evt.matchId, list.slice(0, 500)); // keep recent only
  }

  getForMatch(matchId: string): FeedAuditEntry[] {
    return this.store.get(matchId) ?? [];
  }

  rollback(matchId: string, id: string): { removed: boolean; reason?: string } {
    const list = this.store.get(matchId) ?? [];
    const idx = list.findIndex((e) => e.id === id);
    if (idx === -1) return { removed: false, reason: 'not_found' };
    const entry = list[idx];
    if (
      entry.authoritySource === 'PCOB_AUTHORITATIVE' ||
      entry.authoritySource === 'API_AUTHORITATIVE'
    ) {
      return { removed: false, reason: 'pcob_authoritative' };
    }
    if (entry.source !== 'pcob-simulator' && entry.source !== 'manual') {
      return { removed: false, reason: 'not_allowed' };
    }
    list.splice(idx, 1);
    this.store.set(matchId, list);
    return { removed: true };
  }
}
