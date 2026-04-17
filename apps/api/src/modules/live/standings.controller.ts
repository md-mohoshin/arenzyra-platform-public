import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { StandingsService, Scope } from './standings.service';
import { StandingsSnapshotsService } from './standings-snapshots.service';
import { Public } from '../../common/auth/public.decorator';

@Controller('api')
export class StandingsController {
  constructor(
    private readonly standings: StandingsService,
    private readonly snapshots: StandingsSnapshotsService,
  ) {}

  @Get('stages/:stageId/standings')
  @Public()
  async stage(@Param('stageId') stageId: string, @Query('mode') mode?: string) {
    if (mode === 'active_snapshot') {
      const snap = this.snapshots.getLatestSnapshot('STAGE', stageId);
      if (snap) return snap.data;
    }
    return this.standings.computeStandings({
      scope: 'STAGE',
      scopeId: stageId,
    });
  }

  @Get('groups/:groupId/standings')
  @Public()
  async group(@Param('groupId') groupId: string, @Query('mode') mode?: string) {
    if (mode === 'active_snapshot') {
      const snap = this.snapshots.getLatestSnapshot('GROUP', groupId);
      if (snap) return snap.data;
    }
    return this.standings.computeStandings({
      scope: 'GROUP',
      scopeId: groupId,
    });
  }

  private resolveScope(pathScope: string): Scope {
    if (pathScope === 'tournaments') return 'TOURNAMENT';
    if (pathScope === 'stages') return 'STAGE';
    return 'GROUP';
  }

  @Post(':scope/:scopeId/standings/snapshots')
  async createSnapshot(
    @Param('scope') scopeParam: string,
    @Param('scopeId') scopeId: string,
    @Body('label') label?: string,
  ) {
    const scope = this.resolveScope(scopeParam);
    return this.snapshots.createSnapshot({ scope, scopeId, label });
  }

  @Get(':scope/:scopeId/standings/snapshots')
  listSnapshots(
    @Param('scope') scopeParam: string,
    @Param('scopeId') scopeId: string,
  ) {
    const scope = this.resolveScope(scopeParam);
    return this.snapshots.listSnapshots(scope, scopeId);
  }

  @Get(':scope/:scopeId/standings/snapshots/latest')
  latestSnapshot(
    @Param('scope') scopeParam: string,
    @Param('scopeId') scopeId: string,
  ) {
    const scope = this.resolveScope(scopeParam);
    return this.snapshots.getLatestSnapshot(scope, scopeId);
  }

  @Post('standings/snapshots/:snapshotId/activate')
  activate(@Param('snapshotId') snapshotId: string) {
    this.snapshots.setActiveSnapshot(snapshotId);
    return { success: true };
  }

  @Delete('standings/snapshots/:snapshotId')
  deleteSnapshot(@Param('snapshotId') snapshotId: string) {
    this.snapshots.softDeleteSnapshot(snapshotId);
    return { success: true };
  }
}
