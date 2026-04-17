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
import type { AuthRequest } from '../../common/auth/auth.types';
import { TeamsService } from './teams.service';
import { PrismaService } from '../../db/prisma.service';
import { FileInterceptor } from '@nestjs/platform-express';
import type { StorageEngine } from 'multer';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import type { Request } from 'express';
import type {
  TeamCreateBody,
  TeamUpdateBody,
  TeamPlayerBody,
} from './teams.service';
import type { AuthUser } from '../../common/auth/auth.types';
import { storeTeamBrandLogo, storeTeamLogo } from './asset.util';
import { BroadcastGateway } from '../overlay/broadcast.gateway';

type MulterStreamFile = { stream: NodeJS.ReadableStream };
type SafeMulterOptions = MulterOptions & { storage: StorageEngine };

const memoryStorageEngine: StorageEngine = {
  _handleFile(
    _req: Request,
    file: MulterStreamFile,
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
    _file: MulterStreamFile,
    cb: (error: Error | null) => void,
  ): void {
    cb(null);
  },
};
const uploadOptions: SafeMulterOptions = {
  storage: memoryStorageEngine,
  limits: { fileSize: 2 * 1024 * 1024 },
};

@Controller('me/teams')
@UseGuards(JwtAuthGuard)
@Roles(Role.ADMIN, Role.ORGANIZER, Role.SUPER_ADMIN)
export class MeTeamsController {
  constructor(
    private teams: TeamsService,
    private prisma: PrismaService,
    private readonly broadcast: BroadcastGateway,
  ) {}

  private async resolveOrgId(user: AuthUser, teamId?: string) {
    const actorOrgId = user?.organizationId ?? user?.actingOrgId ?? user?.orgId;
    if (actorOrgId) return actorOrgId;

    if (teamId) {
      const team = await this.prisma.team.findFirst({
        where: { id: teamId, deletedAt: null },
        select: { organizationId: true, ownerUserId: true },
      });
      if (team?.organizationId) return team.organizationId;
      if (team?.ownerUserId) {
        const owner = await this.prisma.user.findUnique({
          where: { id: team.ownerUserId },
          select: { organizationId: true },
        });
        if (owner?.organizationId) {
          await this.prisma.team.update({
            where: { id: teamId },
            data: { organizationId: owner.organizationId },
          });
          return owner.organizationId;
        }
      }
    }

    return null;
  }

  @Get()
  list(
    @Req() req: AuthRequest,
    @Query('search') search?: string,
    @Query('scope') scope?: 'manual' | 'live-mapping' | 'all',
  ) {
    return this.teams.list(req.user, undefined, search, scope);
  }

  @Get('check-name')
  checkName(@Req() req: AuthRequest, @Query('name') name?: string) {
    return this.teams.checkName(req.user, name ?? '');
  }

  @Get(':teamId')
  get(@Param('teamId') teamId: string, @Req() req: AuthRequest) {
    return this.teams.get(req.user, teamId);
  }

  @Post()
  create(@Body() body: TeamCreateBody, @Req() req: AuthRequest) {
    return this.teams.create(req.user, body);
  }

  @Patch(':teamId')
  update(
    @Param('teamId') teamId: string,
    @Body() body: TeamUpdateBody,
    @Req() req: AuthRequest,
  ) {
    return this.teams.update(req.user, teamId, body);
  }

  @Delete(':teamId')
  delete(@Param('teamId') teamId: string, @Req() req: AuthRequest) {
    return this.teams.softDelete(req.user, teamId);
  }

  // Team-scoped players for the current organizer/admin
  @Get(':teamId/players')
  listTeamPlayers(@Param('teamId') teamId: string, @Req() req: AuthRequest) {
    return this.resolveOrgId(req.user, teamId).then((orgId) =>
      this.teams.listTeamPlayers(orgId, teamId, req.user),
    );
  }

  @Post(':teamId/players')
  createTeamPlayer(
    @Param('teamId') teamId: string,
    @Body() body: TeamPlayerBody,
    @Req() req: AuthRequest,
  ) {
    return this.resolveOrgId(req.user, teamId).then((orgId) =>
      this.teams.createTeamPlayer(orgId, teamId, body, req.user),
    );
  }

  @Patch(':teamId/players/:playerId')
  updateTeamPlayer(
    @Param('teamId') teamId: string,
    @Param('playerId') playerId: string,
    @Body() body: TeamPlayerBody,
    @Req() req: AuthRequest,
  ) {
    return this.resolveOrgId(req.user, teamId).then((orgId) =>
      this.teams.updateTeamPlayer(orgId, teamId, playerId, body, req.user),
    );
  }

  @Delete(':teamId/players/:playerId')
  deleteTeamPlayer(
    @Param('teamId') teamId: string,
    @Param('playerId') playerId: string,
    @Req() req: AuthRequest,
  ) {
    return this.resolveOrgId(req.user, teamId).then((orgId) =>
      this.teams.deleteTeamPlayer(orgId, teamId, playerId, req.user),
    );
  }

  @Post(':teamId/restore')
  restore(@Param('teamId') teamId: string, @Req() req: AuthRequest) {
    return this.teams.restore(req.user, teamId);
  }

  @Post(':teamId/logo')
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

  @Post(':teamId/logo-light')
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

  @Post(':teamId/logo-dark')
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
}
