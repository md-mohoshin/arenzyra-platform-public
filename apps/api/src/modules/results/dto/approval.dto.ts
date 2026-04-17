import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ApprovalDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class UnlockDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
