import {
  Body,
  Controller,
  Delete,
  BadRequestException,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { FileInterceptor } from '@nestjs/platform-express';
import type { StorageEngine } from 'multer';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { Roles } from '../../common/auth/roles.decorator';
import { TeamsApiService } from './teams.api.service';
import type { TeamCreateDto, TeamUpdateDto } from './dto/team.api.dto';
import { storeTeamLogoProcessed } from './asset.util';
import { RegisterDiscordTeamDto } from './dto/register-discord-team.dto';
import { ReleaseDiscordTeamMemberDto } from './dto/release-discord-team-member.dto';
import { ListDiscordManagedTeamsDto } from './dto/list-discord-managed-teams.dto';

type SafeMulterOptions = MulterOptions & { storage: StorageEngine };

const memoryStorageEngine: StorageEngine = {
  _handleFile(
    _req,
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
  _removeFile(_req, _file, cb: (error: Error | null) => void): void {
    cb(null);
  },
};

const uploadOptions: SafeMulterOptions = {
  storage: memoryStorageEngine,
  limits: { fileSize: 8 * 1024 * 1024 },
};

@Controller('organizer')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ORGANIZER)
export class OrganizerTeamsController {
  constructor(private readonly teams: TeamsApiService) {}

  private requireOrg(req: AuthenticatedRequest): string {
    const orgId = req.orgId ?? null;
    if (!orgId) {
      throw new ForbiddenException('Organization context missing');
    }
    return orgId;
  }

  @Get('teams')
  list(
    @Req() req: AuthenticatedRequest,
    @Query('search') search?: string,
    @Query('scope') scope?: 'manual' | 'live-mapping' | 'all',
  ) {
    const orgId = this.requireOrg(req);
    return this.teams.list(req.user, { search, orgId, scope });
  }

  @Get('teams/by-tag/:tag')
  getByTag(@Req() req: AuthenticatedRequest, @Param('tag') tag: string) {
    const orgId = this.requireOrg(req);
    return this.teams.getByTag(req.user, tag, orgId);
  }

  @Post('teams')
  create(@Req() req: AuthenticatedRequest, @Body() body: TeamCreateDto) {
    const orgId = this.requireOrg(req);
    return this.teams.create(req.user, { ...body, organizationId: orgId });
  }

  @Post('teams/register-discord')
  registerDiscord(
    @Req() req: AuthenticatedRequest,
    @Body() body: RegisterDiscordTeamDto,
  ) {
    const orgId = this.requireOrg(req);
    return this.teams.registerDiscordTeam(req.user, body, orgId);
  }

  @Post('teams/discord-managed')
  listDiscordManagedTeams(
    @Req() req: AuthenticatedRequest,
    @Body() body: ListDiscordManagedTeamsDto,
  ) {
    const orgId = this.requireOrg(req);
    return this.teams.listDiscordManagedTeams(
      req.user,
      orgId,
      body.discordUserIds ?? [],
      body.limit,
    );
  }

  @Patch('teams/:teamId')
  update(
    @Param('teamId') teamId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: TeamUpdateDto,
  ) {
    const orgId = this.requireOrg(req);
    return this.teams.update(req.user, teamId, {
      ...body,
      organizationId: orgId,
    });
  }

  @Get('teams/:teamId/members')
  members(@Param('teamId') teamId: string, @Req() req: AuthenticatedRequest) {
    const orgId = this.requireOrg(req);
    return this.teams.listMembers(req.user, teamId, orgId);
  }

  @Delete('teams/:teamId')
  remove(@Param('teamId') teamId: string, @Req() req: AuthenticatedRequest) {
    this.requireOrg(req);
    return this.teams.softDelete(req.user, teamId);
  }

  @Post('teams/:teamId/discord-cleanup')
  cleanupDiscordTeam(
    @Param('teamId') teamId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const orgId = this.requireOrg(req);
    return this.teams.cleanupDiscordTeam(req.user, teamId, orgId);
  }

  @Post('teams/:teamId/discord-members/release')
  releaseDiscordTeamMember(
    @Param('teamId') teamId: string,
    @Body() body: ReleaseDiscordTeamMemberDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const orgId = this.requireOrg(req);
    return this.teams.releaseDiscordTeamMember(
      req.user,
      teamId,
      body.discordUserId,
      orgId,
    );
  }

  @Post('teams/:teamId/logo')
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  async uploadLogo(
    @Param('teamId') teamId: string,
    @UploadedFile() file: { mimetype?: string; buffer: Buffer },
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireOrg(req);
    if (!file) {
      throw new BadRequestException('File is required');
    }
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    const mimetype = file.mimetype;
    if (!mimetype || !allowed.includes(mimetype)) {
      throw new BadRequestException('Invalid file type');
    }
    const { url, version } = await (async () => {
      try {
        return await storeTeamLogoProcessed(teamId, file);
      } catch (err) {
        throw new BadRequestException(
          err instanceof Error ? err.message : 'Upload failed',
        );
      }
    })();
    await this.teams.update(req.user, teamId, { logoUrl: url });
    return { ok: true, logoUrl: url, version };
  }
}
