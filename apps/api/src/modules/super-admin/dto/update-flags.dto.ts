import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateFlagsDto {
  @IsOptional()
  @IsBoolean()
  maintenanceMode?: boolean;

  @IsOptional()
  @IsBoolean()
  lockRegistrations?: boolean;

  @IsOptional()
  @IsBoolean()
  freezePayouts?: boolean;

  @IsOptional()
  @IsBoolean()
  superAdminRequiresReason?: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}
