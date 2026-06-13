import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ClientPortalSupportRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  category!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  subject!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message!: string;
}

export class ClientPortalPaymentProofDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  amount!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(12)
  currency!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  paymentMethod!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  reference!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message!: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  proofUrl?: string;
}
