import {
  Body,
  Controller,
  Delete,
  Get,
  BadRequestException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { TournamentSponsorsService } from './tournament-sponsors.service';
import { CreateSponsorDto } from './dto/create-sponsor.dto';
import { UpdateSponsorDto } from './dto/update-sponsor.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import * as path from 'path';
import * as fs from 'fs';

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

@Controller('organizer/tournaments/:tournamentId/sponsors')
@UseGuards(JwtAuthGuard)
@Roles(Role.ORGANIZER, Role.ADMIN, Role.SUPER_ADMIN)
export class TournamentSponsorsController {
  constructor(private readonly svc: TournamentSponsorsService) {}

  @Get()
  listSponsors(
    @Param('tournamentId') tournamentId: string,
    @Req() req: AuthRequest,
  ) {
    return this.svc.listSponsors(tournamentId, req.user);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: sponsorStorage }))
  createSponsor(
    @Param('tournamentId') tournamentId: string,
    @Body() body: CreateSponsorDto,
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

    const payload: CreateSponsorDto = {
      ...body,
      logoUrl,
      displayOrder: Number(body.displayOrder) || 0,
      isActive:
        body.isActive !== undefined ? boolFromBody(body.isActive) : true,
    };

    return this.svc.createSponsor(tournamentId, payload, req.user);
  }

  @Patch(':sponsorId')
  @UseInterceptors(FileInterceptor('file', { storage: sponsorStorage }))
  updateSponsor(
    @Param('tournamentId') tournamentId: string,
    @Param('sponsorId') sponsorId: string,
    @Body() body: UpdateSponsorDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: AuthRequest,
  ) {
    const logoUrl = file?.filename
      ? `/uploads/sponsors/${file.filename}`
      : body.logoUrl;

    const payload: UpdateSponsorDto = {
      ...body,
      ...(logoUrl !== undefined ? { logoUrl } : {}),
      ...(body.displayOrder !== undefined
        ? { displayOrder: Number(body.displayOrder) || 0 }
        : {}),
      ...(body.isActive !== undefined
        ? { isActive: boolFromBody(body.isActive) }
        : {}),
    };

    return this.svc.updateSponsor(tournamentId, sponsorId, payload, req.user);
  }

  @Delete(':sponsorId')
  deleteSponsor(
    @Param('tournamentId') tournamentId: string,
    @Param('sponsorId') sponsorId: string,
    @Req() req: AuthRequest,
  ) {
    return this.svc.deleteSponsor(tournamentId, sponsorId, req.user);
  }
}
