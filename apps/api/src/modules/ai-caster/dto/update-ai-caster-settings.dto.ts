import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  AI_CASTER_ALLOWED_ROLES,
  AI_CASTER_EXPRESSIONS,
  AI_CASTER_MODES,
  AI_CASTER_SPEAKING_SPEEDS,
  AI_CASTER_TALK_FREQUENCIES,
  AI_CASTER_VOICE_MODES,
} from '../ai-caster.constants';

export class UpdateAiCasterSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  muted?: boolean;

  @IsOptional()
  @IsIn(AI_CASTER_MODES)
  mode?: string;

  @IsOptional()
  @IsIn(AI_CASTER_VOICE_MODES)
  voiceMode?: string;

  @IsOptional()
  @IsString()
  primaryVoice?: string;

  @IsOptional()
  @IsString()
  secondaryVoice?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsIn(AI_CASTER_TALK_FREQUENCIES)
  talkFrequency?: string;

  @IsOptional()
  @IsInt()
  @Min(4000)
  @Max(30000)
  minGapMs?: number;

  @IsOptional()
  @IsInt()
  @Min(8)
  @Max(40)
  maxLineWords?: number;

  @IsOptional()
  @IsIn(AI_CASTER_SPEAKING_SPEEDS)
  speakingSpeed?: string;

  @IsOptional()
  @IsIn(AI_CASTER_EXPRESSIONS)
  expression?: string;

  @IsOptional()
  @IsIn(['high-value', 'balanced', 'all'])
  priority?: string;

  @IsOptional()
  @IsBoolean()
  profanityFilter?: boolean;

  @IsOptional()
  @IsBoolean()
  logLines?: boolean;

  @IsOptional()
  @IsArray()
  @IsIn(AI_CASTER_ALLOWED_ROLES, { each: true })
  allowedRoles?: string[];
}
