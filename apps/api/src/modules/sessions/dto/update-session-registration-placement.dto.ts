import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export enum SessionRegistrationPlacementAction {
  APPROVE = 'APPROVE',
  SLOT = 'SLOT',
  WAITLIST = 'WAITLIST',
  VIP = 'VIP',
}

export class UpdateSessionRegistrationPlacementDto {
  @IsEnum(SessionRegistrationPlacementAction)
  action!: SessionRegistrationPlacementAction;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  slotNumber?: number;

  @IsOptional()
  @IsString()
  note?: string;
}
