import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ImportTelegramEventDto {
  @IsString()
  @IsNotEmpty()
  chatId!: string;

  @IsString()
  @IsNotEmpty()
  messageId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  eventName?: string | null;

  @IsOptional()
  @IsBoolean()
  importTeams?: boolean;

  @IsOptional()
  @IsString()
  gameKey?: string;
}
