import { IsIn, IsOptional } from 'class-validator';

export class UpdateManagedUserDto {
  @IsOptional()
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status?: 'ACTIVE' | 'SUSPENDED';

  @IsOptional()
  @IsIn(['ADMIN', 'ORGANIZER'])
  role?: 'ADMIN' | 'ORGANIZER';

  @IsOptional()
  @IsIn(['FULL_PRODUCTION', 'DISCORD_ONLY'])
  organizerAccessMode?: 'FULL_PRODUCTION' | 'DISCORD_ONLY';
}
