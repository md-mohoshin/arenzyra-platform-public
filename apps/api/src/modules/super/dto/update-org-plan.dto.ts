import { GameKey } from '@prisma/client';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class UpdateOrgPlanDto {
  @IsString()
  planId!: string;

  @IsOptional()
  @IsArray()
  enabledGames?: GameKey[];

  @IsOptional()
  @IsArray()
  enabledAddOns?: string[];
}
