import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';

@Injectable()
export class MatchStreamService {
  private readonly logger = new Logger('MatchStream');
  private readonly clients = new Map<string, Set<Response>>();
  private readonly heartbeats = new WeakMap<Response, NodeJS.Timeout>();
  private readonly heartbeatMs = 15000;

  add(matchId: string, res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Connection', 'keep-alive');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    const set = this.clients.get(matchId) ?? new Set<Response>();
    set.add(res);
    this.clients.set(matchId, set);

    const ping = setInterval(() => {
      this.write(res, 'ping', { ts: Date.now() });
    }, this.heartbeatMs);
    this.heartbeats.set(res, ping);

    res.on('close', () => this.remove(matchId, res));
    res.on('error', () => this.remove(matchId, res));
  }

  remove(matchId: string, res: Response): void {
    const set = this.clients.get(matchId);
    if (set) {
      set.delete(res);
      if (set.size === 0) {
        this.clients.delete(matchId);
      }
    }
    const hb = this.heartbeats.get(res);
    if (hb) {
      clearInterval(hb);
      this.heartbeats.delete(res);
    }
    try {
      res.end();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to end SSE response: ${msg}`);
    }
  }

  emit(matchId: string, event: string, data: unknown): void {
    const payload = this.format(event, data);
    const set = this.clients.get(matchId);
    if (!set || set.size === 0) return;
    for (const res of set) {
      try {
        res.write(payload);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Failed to write SSE payload to client: ${msg}`);
        this.remove(matchId, res);
      }
    }
  }

  connectedCount(matchId: string): number {
    return this.clients.get(matchId)?.size ?? 0;
  }

  private write(res: Response, event: string, data: unknown) {
    try {
      res.write(this.format(event, data));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to write SSE payload: ${msg}`);
    }
  }

  private format(event: string, data: unknown): string {
    const json: string =
      typeof data === 'string'
        ? data
        : (JSON.stringify(data ?? {}, (_key: string, value: unknown) =>
            typeof value === 'bigint' ? value.toString() : value,
          ) ?? '{}');
    return `event: ${event}\ndata: ${json}\n\n`;
  }
}
