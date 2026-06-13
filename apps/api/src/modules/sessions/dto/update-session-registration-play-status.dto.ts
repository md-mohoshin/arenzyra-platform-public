import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum SessionRegistrationPlayStatusAction {
  CONFIRM = 'CONFIRM',
  NOT_PLAYING = 'NOT_PLAYING',
  CLEAR = 'CLEAR',
}

export class UpdateSessionRegistrationPlayStatusDto {
  @IsEnum(SessionRegistrationPlayStatusAction)
  action!: SessionRegistrationPlayStatusAction;

  @IsOptional()
  @IsString()
  discordUserId?: string;

  @IsOptional()
  @IsString()
  discordUsername?: string;
}
