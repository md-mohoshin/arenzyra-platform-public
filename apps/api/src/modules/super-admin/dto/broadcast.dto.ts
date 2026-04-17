import { IsEnum, IsOptional, IsString } from 'class-validator';
import { NotificationAudience } from '@prisma/client';

export class BroadcastDto {
  @IsString()
  title!: string;

  @IsString()
  body!: string;

  @IsOptional()
  @IsEnum(NotificationAudience)
  audience?: NotificationAudience;
}
