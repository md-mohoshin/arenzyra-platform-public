import { IsNotEmpty, IsString, IsUrl } from 'class-validator';

export class IngestScreenshotDto {
  @IsString()
  @IsNotEmpty()
  matchId!: string;

  @IsString()
  @IsNotEmpty()
  @IsUrl({
    require_protocol: true,
  })
  imageUrl!: string;
}
