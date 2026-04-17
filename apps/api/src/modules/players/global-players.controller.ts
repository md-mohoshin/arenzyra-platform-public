import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import {
  GlobalPlayersService,
  type GlobalPlayerBody,
} from './global-players.service';

@Controller('global/players')
@UseGuards(JwtAuthGuard)
@Roles(Role.ADMIN, Role.ORGANIZER, Role.SUPER_ADMIN)
export class GlobalPlayersController {
  constructor(private globalPlayers: GlobalPlayersService) {}

  @Get()
  list() {
    return this.globalPlayers.list();
  }

  @Post()
  create(@Body() body: GlobalPlayerBody) {
    return this.globalPlayers.create(body);
  }

  @Patch(':playerId')
  update(@Param('playerId') playerId: string, @Body() body: GlobalPlayerBody) {
    return this.globalPlayers.update(playerId, body);
  }

  @Delete(':playerId')
  delete(@Param('playerId') playerId: string) {
    return this.globalPlayers.softDelete(playerId);
  }
}
