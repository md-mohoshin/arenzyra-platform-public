import { IsString, MinLength } from 'class-validator';

export class ReasonDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}
