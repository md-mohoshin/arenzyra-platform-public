import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ImportProductionEventDto {
  @IsString()
  @IsNotEmpty()
  eventName!: string;

  @IsOptional()
  @IsString()
  gameKey?: string;
}
