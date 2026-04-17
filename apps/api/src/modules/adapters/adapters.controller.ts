import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { AdaptersService } from './adapters.service';

@Controller('adapters')
@UseGuards(JwtAuthGuard)
export class AdaptersController {
  constructor(private readonly adapters: AdaptersService) {}

  @Get()
  list(@Query('enabled') enabled?: string) {
    const enabledOnly = enabled === 'true';
    return enabledOnly
      ? this.adapters.getEnabledAdapters()
      : this.adapters.getRegisteredAdapters();
  }

  @Get('enabled')
  listEnabled() {
    return this.adapters.getEnabledAdapters();
  }

  @Get('by-game/:gameKey')
  listByGame(@Param('gameKey') gameKey: string) {
    const parsed = this.adapters.parseGameKey(gameKey);
    if (!parsed) return [];
    return this.adapters.getAdaptersByGame(parsed);
  }
}
