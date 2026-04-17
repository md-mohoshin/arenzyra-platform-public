import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { OrgScopeGuard } from '../../common/org/org-scope.guard';
import { TeamsService } from './teams.service';
import { FileInterceptor } from '@nestjs/platform-express';
import type { StorageEngine } from 'multer';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import type { Request } from 'express';
import type { AuthRequest } from '../../common/auth/auth.types';
import type {
  TeamCreateBody,
  TeamUpdateBody,
  TeamPlayerBody,
} from './teams.service';
import {
  storePlayerPhoto,
  storeTeamBrandLogo,
  storeTeamLogo,
} from './asset.util';
import { BroadcastGateway } from '../overlay/broadcast.gateway';

type SafeMulterOptions = MulterOptions & { storage: StorageEngine };

const memoryStorageEngine: StorageEngine = {
  _handleFile(
    _req: Request,
    file: { stream: NodeJS.ReadableStream },
    cb: (error: Error | null, info?: { buffer: Buffer }) => void,
  ): void {
    if (!file || typeof file !== 'object' || !('stream' in file)) {
      cb(new Error('Invalid file stream'));
      return;
    }
    const chunks: Buffer[] = [];
    const stream = file.stream;
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => cb(null, { buffer: Buffer.concat(chunks) }));
    stream.on('error', (err: Error) => cb(err));
  },
  _removeFile(
    _req: Request,
    _file: { stream: NodeJS.ReadableStream },
    cb: (error: Error | null) => void,
  ): void {
    cb(null);
  },
};
const uploadOptions: SafeMulterOptions = {
  storage: memoryStorageEngine,
  limits: { fileSize: 2 * 1024 * 1024 },
};

@Controller('org/:orgId')
@UseGuards(JwtAuthGuard, OrgScopeGuard)
@Roles(Role.ADMIN, Role.ORGANIZER, Role.SUPER_ADMIN)
export class TeamsController {
  constructor(
    private teams: TeamsService,
    private readonly broadcast: BroadcastGateway,
  ) {}

  @Get('teams')
  list(
    @Req() req: AuthRequest,
    @Param('orgId') orgId: string,
    @Query('search') search?: string,
    @Query('scope') scope?: 'manual' | 'live-mapping' | 'all',
  ) {
    return this.teams.list(req.user, orgId, search, scope);
  }

  @Get('teams/check-name')
  checkName(
    @Req() req: AuthRequest,
    @Param('orgId') orgId: string,
    @Query('name') name?: string,
  ) {
    return this.teams.checkName(req.user, name ?? '', orgId);
  }

  @Get('teams/:teamId')
  get(@Param('teamId') teamId: string, @Req() req: AuthRequest) {
    return this.teams.get(req.user, teamId);
  }

  @Post('teams')
  create(
    @Body() body: TeamCreateBody,
    @Param('orgId') orgId: string,
    @Req() req: AuthRequest,
  ) {
    return this.teams.create(req.user, body, orgId);
  }

  @Patch('teams/:teamId')
  update(
    @Param('teamId') teamId: string,
    @Body() body: TeamUpdateBody,
    @Req() req: AuthRequest,
  ) {
    return this.teams.update(req.user, teamId, body);
  }

  @Delete('teams/:teamId')
  delete(@Param('teamId') teamId: string, @Req() req: AuthRequest) {
    return this.teams.softDelete(req.user, teamId);
  }

  @Post('teams/:teamId/restore')
  restore(@Param('teamId') teamId: string, @Req() req: AuthRequest) {
    return this.teams.restore(req.user, teamId);
  }

  @Post('teams/:teamId/roster')
  addPlayer(
    @Param('orgId') orgId: string,
    @Param('teamId') teamId: string,
    @Body() body: { playerId: string },
  ) {
    return this.teams.addPlayer(orgId, teamId, body.playerId);
  }

  @Get('teams/:teamId/roster')
  roster(@Param('orgId') orgId: string, @Param('teamId') teamId: string) {
    return this.teams.roster(orgId, teamId);
  }

  @Delete('teams/:teamId/roster/:playerId')
  removeFromRoster(
    @Param('orgId') orgId: string,
    @Param('teamId') teamId: string,
    @Param('playerId') playerId: string,
  ) {
    return this.teams.removePlayer(orgId, teamId, playerId);
  }

  @Post('teams/:teamId/logo')
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  async uploadLogo(
    @Param('teamId') teamId: string,
    @UploadedFile() file: { mimetype?: string; buffer: Buffer },
    @Req() req: AuthRequest,
  ) {
    if (!file) throw new BadRequestException('File is required');
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    const mimetype = file.mimetype;
    if (!mimetype || !allowed.includes(mimetype)) {
      throw new BadRequestException('Invalid file type');
    }
    const { url, version } = (() => {
      try {
        return storeTeamLogo(teamId, file);
      } catch (err) {
        throw new BadRequestException(
          err instanceof Error ? err.message : 'Upload failed',
        );
      }
    })();
    await this.teams.update(req.user, teamId, { logoUrl: url });
    this.broadcast.emitTeamAssetUpdated({ teamId, version, logoUrl: url });
    return { ok: true, logoUrl: url, version };
  }

  @Post('teams/:teamId/logo-light')
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  async uploadLogoLight(
    @Param('teamId') teamId: string,
    @UploadedFile() file: { mimetype?: string; buffer: Buffer },
    @Req() req: AuthRequest,
  ) {
    if (!file) throw new BadRequestException('File is required');
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    const mimetype = file.mimetype;
    if (!mimetype || !allowed.includes(mimetype)) {
      throw new BadRequestException('Invalid file type');
    }
    const { url, version } = (() => {
      try {
        return storeTeamBrandLogo(teamId, 'logo-light', file);
      } catch (err) {
        throw new BadRequestException(
          err instanceof Error ? err.message : 'Upload failed',
        );
      }
    })();
    await this.teams.update(req.user, teamId, { logoLightUrl: url });
    return { ok: true, logoUrl: url, version };
  }

  @Post('teams/:teamId/logo-dark')
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  async uploadLogoDark(
    @Param('teamId') teamId: string,
    @UploadedFile() file: { mimetype?: string; buffer: Buffer },
    @Req() req: AuthRequest,
  ) {
    if (!file) throw new BadRequestException('File is required');
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    const mimetype = file.mimetype;
    if (!mimetype || !allowed.includes(mimetype)) {
      throw new BadRequestException('Invalid file type');
    }
    const { url, version } = (() => {
      try {
        return storeTeamBrandLogo(teamId, 'logo-dark', file);
      } catch (err) {
        throw new BadRequestException(
          err instanceof Error ? err.message : 'Upload failed',
        );
      }
    })();
    await this.teams.update(req.user, teamId, { logoDarkUrl: url });
    return { ok: true, logoUrl: url, version };
  }

  @Post('players/:playerId/photo')
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  async uploadPlayerPhoto(
    @Param('orgId') orgId: string,
    @Param('playerId') playerId: string,
    @UploadedFile() file: { mimetype?: string; buffer: Buffer },
  ) {
    if (!file) throw new BadRequestException('File is required');
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    const mimetype = file.mimetype;
    if (!mimetype || !allowed.includes(mimetype)) {
      throw new BadRequestException('Invalid file type');
    }
    const { url, version } = (() => {
      try {
        return storePlayerPhoto(playerId, file);
      } catch (err) {
        throw new BadRequestException(
          err instanceof Error ? err.message : 'Upload failed',
        );
      }
    })();
    await this.teams.updatePlayerPhoto(orgId, playerId, url);
    this.broadcast.emitPlayerAssetUpdated({
      playerId,
      version,
      photoUrl: url,
    });
    return { ok: true, photoUrl: url, version };
  }

  @Get('tags')
  listTags(@Param('orgId') orgId: string) {
    return this.teams.listTags(orgId);
  }

  @Post('tags')
  createTag(
    @Param('orgId') orgId: string,
    @Body('name') name: string,
    @Req() req: AuthRequest,
  ) {
    return this.teams.createTag(orgId, name, req.user?.id);
  }

  @Delete('tags/:tagId')
  deleteTag(@Param('orgId') orgId: string, @Param('tagId') tagId: string) {
    return this.teams.deleteTag(orgId, tagId);
  }

  @Post('teams/:teamId/tags')
  setTags(
    @Param('orgId') orgId: string,
    @Param('teamId') teamId: string,
    @Body('tagIds') tagIds: string[],
  ) {
    return this.teams.setTeamTags(orgId, teamId, tagIds ?? []);
  }

  // ---- Team-scoped players (organizer-managed) ----
  @Get('teams/:teamId/players')
  listTeamPlayers(
    @Param('orgId') orgId: string,
    @Param('teamId') teamId: string,
    @Req() req: AuthRequest,
  ) {
    return this.teams.listTeamPlayers(orgId, teamId, req.user);
  }

  @Post('teams/:teamId/players')
  createTeamPlayer(
    @Param('orgId') orgId: string,
    @Param('teamId') teamId: string,
    @Body() body: TeamPlayerBody,
    @Req() req: AuthRequest,
  ) {
    return this.teams.createTeamPlayer(orgId, teamId, body, req.user);
  }

  @Patch('teams/:teamId/players/:playerId')
  updateTeamPlayer(
    @Param('orgId') orgId: string,
    @Param('teamId') teamId: string,
    @Param('playerId') playerId: string,
    @Body() body: TeamPlayerBody,
    @Req() req: AuthRequest,
  ) {
    return this.teams.updateTeamPlayer(orgId, teamId, playerId, body, req.user);
  }

  @Delete('teams/:teamId/players/:playerId')
  deleteTeamPlayer(
    @Param('orgId') orgId: string,
    @Param('teamId') teamId: string,
    @Param('playerId') playerId: string,
    @Req() req: AuthRequest,
  ) {
    return this.teams.deleteTeamPlayer(orgId, teamId, playerId, req.user);
  }
}
