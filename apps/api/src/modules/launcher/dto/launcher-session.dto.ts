import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LauncherSessionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  machineId!: string;
}
