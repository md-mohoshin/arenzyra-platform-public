import {
  Body,
  BadRequestException,
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
} from '@nestjs/common';
import { MediaAssetType, Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { MediaAssetDto, UpdateMediaAssetDto } from './dto/media-asset.dto';
import { MediaService } from './media.service';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import {
  mediaUploadMulterOptions,
  optimizeUploadedImage,
  resolveUploadType,
} from './media-upload.config';

@Controller('api/media')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER, Role.REFEREE)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get('sync-status')
  async syncStatus() {
    const status = await this.media.syncStatus();
    return { ok: true, status };
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', mediaUploadMulterOptions))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: AuthenticatedRequest & Request,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    const type = resolveUploadType(req);
    const { url } = await optimizeUploadedImage(file, type);
    return { url };
  }

  @Get('assets')
  async list(
    @Query('type') type?: MediaAssetType,
    @Query('teamId') teamId?: string,
    @Query('playerId') playerId?: string,
    @Query('organizationId') organizationId?: string,
  ) {
    const filters = {
      type:
        type && Object.values(MediaAssetType).includes(type) ? type : undefined,
      teamId: teamId ?? undefined,
      playerId: playerId ?? undefined,
      organizationId: organizationId ?? undefined,
    };
    const assets = await this.media.list(filters);
    return { ok: true, assets };
  }

  @Post('assets')
  async create(@Body() dto: MediaAssetDto, @Req() req: AuthenticatedRequest) {
    const actor = req.user;
    const asset = await this.media.create(dto, actor);
    return { ok: true, asset };
  }

  @Patch('assets/:assetId')
  async update(
    @Param('assetId') assetId: string,
    @Body() dto: UpdateMediaAssetDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const asset = await this.media.update(assetId, dto, req.user);
    return { ok: true, asset };
  }

  @Delete('assets/:assetId')
  async remove(
    @Param('assetId') assetId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const asset = await this.media.remove(assetId, req.user);
    return { ok: true, asset };
  }
}
