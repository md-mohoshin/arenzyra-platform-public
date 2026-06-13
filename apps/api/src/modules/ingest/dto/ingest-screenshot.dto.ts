import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  ValidateIf,
} from 'class-validator';

export class IngestScreenshotDto {
  @IsString()
  @IsNotEmpty()
  matchId!: string;

  @ValidateIf((dto: IngestScreenshotDto) => !dto.imageUrls?.length)
  @IsString()
  @IsNotEmpty()
  @IsUrl({
    require_protocol: true,
  })
  imageUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsUrl(
    {
      require_protocol: true,
    },
    { each: true },
  )
  imageUrls?: string[];
}
