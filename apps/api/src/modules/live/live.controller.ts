import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/auth/public.decorator';
import { LiveService } from './live.service';
import { StandingsService } from './standings.service';
import { StandingsSnapshotsService } from './standings-snapshots.service';

@Controller()
@Public()
export class LiveController {
  constructor(
    private live: LiveService,
    private standings: StandingsService,
    private standingsSnapshots: StandingsSnapshotsService,
  ) {}

  // Fast cached standings (REST)
  @Get('live/standings/:tournamentId')
  async latest(
    @Param('tournamentId') tournamentId: string,
    @Query('mode') mode?: string,
  ): Promise<unknown> {
    if (mode === 'active_snapshot') {
      const snap = this.standingsSnapshots.getLatestSnapshot(
        'TOURNAMENT',
        tournamentId,
      );
      if (snap) return snap.data;
    }
    const cached = await this.live.getLatestStandings(tournamentId);
    if (cached) return JSON.parse(cached);
    const computed = await this.standings.computeStandings({
      scope: 'TOURNAMENT',
      scopeId: tournamentId,
    });
    await this.live.setLatestStandings(tournamentId, computed);
    return computed;
  }

  // Realtime standings (SSE)
  @Get('sse/standings/:tournamentId')
  async sse(
    @Param('tournamentId') tournamentId: string,
    @Query('mode') mode: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Send initial snapshot immediately
    let initial: string | null = null;
    if (mode === 'active_snapshot') {
      const snap = this.standingsSnapshots.getLatestSnapshot(
        'TOURNAMENT',
        tournamentId,
      );
      if (snap) initial = JSON.stringify(snap.data);
    }
    if (!initial) {
      initial = await this.live.getLatestStandings(tournamentId);
      if (!initial) {
        const computed = await this.standings.computeStandings({
          scope: 'TOURNAMENT',
          scopeId: tournamentId,
        });
        initial = JSON.stringify(computed);
        await this.live.setLatestStandings(tournamentId, computed);
      }
    }
    if (initial) res.write(`event: standings\ndata: ${initial}\n\n`);

    // Subscribe to Redis pub/sub
    const unsubscribe = await this.live.subscribeStandings(
      tournamentId,
      (msg) => {
        res.write(`event: standings\ndata: ${msg}\n\n`);
      },
    );

    // Keepalive ping (helps with proxies)
    const ping = setInterval(() => {
      res.write(`event: ping\ndata: {}\n\n`);
    }, 15000);

    res.on('close', () => {
      clearInterval(ping);
      void unsubscribe();
      res.end();
    });
  }
}
