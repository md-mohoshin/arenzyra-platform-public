import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateSessionRegistrationManagersDto {
  @IsOptional()
  @IsString()
  leaderDiscordUserId?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  managerDiscordUserIds!: string[];
}
