import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';

export class CreateManagedUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsIn(['ADMIN', 'ORGANIZER'])
  role!: 'ADMIN' | 'ORGANIZER';
}
