import { IsNumber, IsOptional, IsString } from 'class-validator';

export class AdjustWalletDto {
  @IsNumber()
  amount!: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
