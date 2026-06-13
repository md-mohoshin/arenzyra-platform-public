import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { GameKey, Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { RulesetsService } from './rulesets.service';
import type { RulesetInput } from './rulesets.types';

@Controller('rulesets')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class RulesetsController {
  constructor(private readonly rulesets: RulesetsService) {}

  @Get()
  list(
    @Query('gameKey') gameKey: string | undefined,
    @Query('orgId') orgId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const parsedGame =
      gameKey && (Object.values(GameKey) as string[]).includes(gameKey)
        ? (gameKey as GameKey)
        : undefined;
    return this.rulesets.list({ gameKey: parsedGame, orgId }, req.user);
  }

  @Post()
  create(@Body() body: RulesetInput, @Req() req: AuthenticatedRequest) {
    const parsedGame =
      body?.gameKey &&
      (Object.values(GameKey) as string[]).includes(body.gameKey)
        ? body.gameKey
        : (body.gameKey as unknown as GameKey | undefined);
    return this.rulesets.create(
      {
        name: body?.name,
        description: body?.description,
        gameKey: parsedGame as GameKey,
        config: body?.config ?? {},
        isDefault: body?.isDefault ?? false,
        orgId: body?.orgId,
      },
      req.user,
    );
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: Partial<RulesetInput>,
    @Req() req: AuthenticatedRequest,
  ) {
    const parsedGame =
      body?.gameKey && Object.values(GameKey).includes(body.gameKey)
        ? body.gameKey
        : (body?.gameKey as unknown as GameKey | undefined);
    return this.rulesets.update(
      id,
      {
        name: body?.name,
        description: body?.description,
        gameKey: parsedGame,
        config: body?.config,
        isDefault: body?.isDefault,
        orgId: body?.orgId,
      },
      req.user,
    );
  }
}
