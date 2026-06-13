import { IsBoolean, IsString } from 'class-validator';

export class UpdateDiscordChannelPauseDto {
  @IsString()
  guildId!: string;

  @IsString()
  channelId!: string;

  @IsBoolean()
  paused!: boolean;
}
