import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { OrganizationDiscordController } from './organization-discord.controller';
import { OrganizationDiscordService } from './organization-discord.service';
import { SuperDiscordConfigController } from './super-discord-config.controller';

@Module({
  imports: [AuthModule],
  controllers: [OrganizationDiscordController, SuperDiscordConfigController],
  providers: [OrganizationDiscordService],
  exports: [OrganizationDiscordService],
})
export class OrganizationDiscordModule {}
