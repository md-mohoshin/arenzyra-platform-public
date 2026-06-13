export const AI_CASTER_FEATURE_KEY = 'ai-caster';
export const AI_CASTER_WIDGET_KEY = 'ai-caster';

export const AI_CASTER_ALLOWED_ROLES = ['ADMIN', 'ORGANIZER'] as const;
export const AI_CASTER_VOICE_MODES = ['single', 'dual'] as const;
export const AI_CASTER_MODES = ['professional', 'hype'] as const;
export const AI_CASTER_TALK_FREQUENCIES = ['low', 'balanced', 'high'] as const;
export const AI_CASTER_SPEAKING_SPEEDS = ['slow', 'normal', 'fast'] as const;
export const AI_CASTER_EXPRESSIONS = [
  'neutral',
  'professional',
  'energetic',
  'dramatic',
] as const;
export const AI_CASTER_TTS_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'cedar',
  'coral',
  'echo',
  'fable',
  'marin',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
] as const;

export type AiCasterAllowedRole = (typeof AI_CASTER_ALLOWED_ROLES)[number];
export type AiCasterVoiceMode = (typeof AI_CASTER_VOICE_MODES)[number];
export type AiCasterMode = (typeof AI_CASTER_MODES)[number];
export type AiCasterTalkFrequency = (typeof AI_CASTER_TALK_FREQUENCIES)[number];
export type AiCasterSpeakingSpeed = (typeof AI_CASTER_SPEAKING_SPEEDS)[number];
export type AiCasterExpression = (typeof AI_CASTER_EXPRESSIONS)[number];
export type AiCasterTtsVoice = (typeof AI_CASTER_TTS_VOICES)[number];

export type AiCasterSettings = {
  enabled: boolean;
  muted: boolean;
  mode: AiCasterMode;
  voiceMode: AiCasterVoiceMode;
  primaryVoice: string;
  secondaryVoice: string;
  language: string;
  talkFrequency: AiCasterTalkFrequency;
  minGapMs: number;
  maxLineWords: number;
  speakingSpeed: AiCasterSpeakingSpeed;
  expression: AiCasterExpression;
  priority: 'high-value' | 'balanced' | 'all';
  profanityFilter: boolean;
  logLines: boolean;
  allowedRoles: AiCasterAllowedRole[];
};

export const DEFAULT_AI_CASTER_SETTINGS: AiCasterSettings = {
  enabled: false,
  muted: false,
  mode: 'professional',
  voiceMode: 'single',
  primaryVoice: 'play-by-play',
  secondaryVoice: 'analyst',
  language: 'en',
  talkFrequency: 'balanced',
  minGapMs: 10000,
  maxLineWords: 22,
  speakingSpeed: 'normal',
  expression: 'professional',
  priority: 'high-value',
  profanityFilter: true,
  logLines: true,
  allowedRoles: ['ADMIN', 'ORGANIZER'],
};
