import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  AI_CASTER_EXPRESSIONS,
  AI_CASTER_MODES,
  AI_CASTER_SPEAKING_SPEEDS,
} from '../ai-caster.constants';

export class PreviewAiCasterVoiceDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  voice?: string;

  @IsOptional()
  @IsIn(['play-by-play', 'analyst'])
  role?: 'play-by-play' | 'analyst';

  @IsOptional()
  @IsString()
  @MaxLength(220)
  text?: string;

  @IsOptional()
  @IsIn(AI_CASTER_MODES)
  mode?: string;

  @IsOptional()
  @IsIn(AI_CASTER_SPEAKING_SPEEDS)
  speakingSpeed?: string;

  @IsOptional()
  @IsIn(AI_CASTER_EXPRESSIONS)
  expression?: string;
}
