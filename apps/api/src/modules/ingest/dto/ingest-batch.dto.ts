import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { MatchEventDto } from './match-event.dto';

export class IngestBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MatchEventDto)
  events!: MatchEventDto[];
}
