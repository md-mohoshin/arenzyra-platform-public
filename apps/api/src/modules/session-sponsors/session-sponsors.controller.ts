import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as fs from 'fs';
import * as path from 'path';
import { diskStorage } from 'multer';
import type { AuthRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CreateSessionSponsorDto } from './dto/create-session-sponsor.dto';
import { UpdateSessionSponsorDto } from './dto/update-session-sponsor.dto';
import { SessionSponsorsService } from './session-sponsors.service';

const uploadDir = path.join(process.cwd(), 'uploads', 'sponsors');
fs.mkdirSync(uploadDir, { recursive: true });

const sponsorStorage = diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${randomUUID()}${ext}`);
  },
});

const boolFromBody = (val: unknown) =>
  val === true || val === 'true' || val === '1' || val === 1 || val === 'on';

@Controller('sessions/:sessionId/sponsors')
@UseGuards(JwtAuthGuard)
@Roles(Role.ORGANIZER, Role.ADMIN, Role.SUPER_ADMIN)
export class SessionSponsorsController {
  constructor(private readonly svc: SessionSponsorsService) {}

  @Get()
  listSponsors(@Param('sessionId') sessionId: string, @Req() req: AuthRequest) {
    return this.svc.listSponsors(sessionId, req.user);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: sponsorStorage }))
  createSponsor(
    @Param('sessionId') sessionId: string,
    @Body() body: CreateSessionSponsorDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: AuthRequest,
  ) {
    const logoUrl = file?.filename
      ? `/uploads/sponsors/${file.filename}`
      : body.logoUrl?.trim() || null;

    if (!logoUrl) {
      throw new BadRequestException({
        error: 'LOGO_REQUIRED',
        message: 'Provide a logo upload or logoUrl',
      });
    }

    const payload: CreateSessionSponsorDto = {
      ...body,
      logoUrl,
      displayOrder: Number(body.displayOrder) || 0,
      isActive:
        body.isActive !== undefined ? boolFromBody(body.isActive) : true,
    };

    return this.svc.createSponsor(sessionId, payload, req.user);
  }

  @Patch(':sponsorId')
  @UseInterceptors(FileInterceptor('file', { storage: sponsorStorage }))
  updateSponsor(
    @Param('sessionId') sessionId: string,
    @Param('sponsorId') sponsorId: string,
    @Body() body: UpdateSessionSponsorDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: AuthRequest,
  ) {
    const logoUrl = file?.filename
      ? `/uploads/sponsors/${file.filename}`
      : body.logoUrl;

    const payload: UpdateSessionSponsorDto = {
      ...body,
      ...(logoUrl !== undefined ? { logoUrl } : {}),
      ...(body.displayOrder !== undefined
        ? { displayOrder: Number(body.displayOrder) || 0 }
        : {}),
      ...(body.isActive !== undefined
        ? { isActive: boolFromBody(body.isActive) }
        : {}),
    };

    return this.svc.updateSponsor(sessionId, sponsorId, payload, req.user);
  }

  @Delete(':sponsorId')
  deleteSponsor(
    @Param('sessionId') sessionId: string,
    @Param('sponsorId') sponsorId: string,
    @Req() req: AuthRequest,
  ) {
    return this.svc.deleteSponsor(sessionId, sponsorId, req.user);
  }
}
