import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Role } from '@prisma/client';
import type { AuthRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { TournamentsService } from './tournaments.service';
import type { TournamentHardDeleteDto } from './dto/tournament.dto';

@Controller('tournaments')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class TournamentsLogoController {
  constructor(private readonly svc: TournamentsService) {}

  @Post(':id/logo')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadLogo(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthRequest,
  ) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    const data = await this.svc.uploadLogo(id, file, req.user);
    return { ok: true, data };
  }

  @Delete(':id/hard')
  async hardDelete(
    @Param('id') id: string,
    @Body() body: TournamentHardDeleteDto,
    @Req() req: AuthRequest,
  ) {
    return this.svc.hardDeleteTournament(id, req.user, body);
  }
}
