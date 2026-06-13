import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Request } from 'express';
import { diskStorage } from 'multer';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { ApplyScreenshotResultsDto } from './dto/apply-screenshot-results.dto';
import { IngestScreenshotDto } from './dto/ingest-screenshot.dto';
import { IngestSlotMapScreenshotDto } from './dto/ingest-slot-map-screenshot.dto';
import { ScreenshotIngestService } from './screenshot-ingest.service';

const screenshotUploadRoot = path.join(process.cwd(), 'uploads', 'results');
const screenshotImageTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);
const screenshotImageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function ensureScreenshotUploadDir() {
  fs.mkdirSync(screenshotUploadRoot, { recursive: true });
  return screenshotUploadRoot;
}

function resolvePublicBase(req: Request) {
  return (
    process.env.API_PUBLIC_URL ||
    process.env.API_BASE_URL ||
    `${req.protocol}://${req.get('host')}`
  ).replace(/\/$/, '');
}

@Controller('ingest')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER, Role.REFEREE)
export class ScreenshotIngestController {
  constructor(private readonly screenshotIngest: ScreenshotIngestService) {}

  @Post('screenshot/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          try {
            cb(null, ensureScreenshotUploadDir());
          } catch (error) {
            cb(error as Error, '');
          }
        },
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname ?? '').toLowerCase();
          const safeExt = screenshotImageExtensions.has(ext) ? ext : '.png';
          cb(null, `${randomUUID()}${safeExt}`);
        },
      }),
      limits: { fileSize: 8 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname ?? '').toLowerCase();
        const mime = (file.mimetype ?? '').toLowerCase();
        if (
          !screenshotImageTypes.has(mime) &&
          !screenshotImageExtensions.has(ext)
        ) {
          return cb(
            new BadRequestException(
              'Only PNG, JPG, JPEG, and WEBP screenshots are allowed',
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: AuthenticatedRequest & Request,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    const imageUrl = `${resolvePublicBase(req)}/uploads/results/${file.filename}`;
    return {
      ok: true,
      imageUrl,
      url: imageUrl,
    };
  }

  @Post('screenshot')
  preview(@Body() dto: IngestScreenshotDto, @Req() req: AuthenticatedRequest) {
    return this.screenshotIngest.previewScreenshot(req.user, dto);
  }

  @Post('screenshot/slot-map')
  mapSlots(
    @Body() dto: IngestSlotMapScreenshotDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.screenshotIngest.mapSlotScreenshot(req.user, dto);
  }

  @Post('screenshot/apply')
  apply(
    @Body() dto: ApplyScreenshotResultsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.screenshotIngest.applyScreenshotResults(req.user, dto);
  }
}
