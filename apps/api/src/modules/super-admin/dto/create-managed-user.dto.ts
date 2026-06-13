import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateManagedUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsIn(['ADMIN', 'ORGANIZER'])
  role!: 'ADMIN' | 'ORGANIZER';

  @IsOptional()
  @IsString()
  organizationId?: string | null;

  @IsOptional()
  @IsIn(['FULL_PRODUCTION', 'DISCORD_ONLY'])
  organizerAccessMode?: 'FULL_PRODUCTION' | 'DISCORD_ONLY';
}
