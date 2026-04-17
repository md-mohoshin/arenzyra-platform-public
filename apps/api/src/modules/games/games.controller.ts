import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { GamesService } from './games.service';

@Controller('games')
@UseGuards(JwtAuthGuard)
export class GamesController {
  constructor(private readonly games: GamesService) {}

  @Get()
  listEnabled() {
    return this.games.listEnabled();
  }

  @Get('all')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  listAll() {
    return this.games.listAll();
  }
}
