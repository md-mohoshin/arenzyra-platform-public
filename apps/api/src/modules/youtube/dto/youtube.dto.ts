import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CompleteYoutubeOAuthDto {
  @IsString()
  @MaxLength(4096)
  code!: string;

  @IsString()
  @MaxLength(4096)
  state!: string;
}

export class SyncYoutubeCommentsDto {
  @IsString()
  @MaxLength(64)
  videoId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxResults?: number;
}

export class ReviewYoutubeCommentDto {
  @IsString()
  @IsIn(['NEW', 'REVIEWED', 'NEEDS_REPLY', 'REPLIED', 'IGNORED', 'HELD'])
  reviewStatus!: string;
}

export class ReplyToYoutubeCommentDto {
  @IsString()
  @MaxLength(2000)
  body!: string;

  @IsOptional()
  @IsBoolean()
  postNow?: boolean;
}

export class StartYoutubeLiveChatDto {
  @IsString()
  @MaxLength(80)
  channelId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  matchId?: string | null;

  @IsString()
  @MaxLength(64)
  videoId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string | null;

  @IsOptional()
  @IsBoolean()
  autoReplyEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  tournamentCommandsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  greetingEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  greetingTemplate?: string | null;

  @IsOptional()
  @IsBoolean()
  aiHostEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  matchUpdatesEnabled?: boolean;
}

export class DetectYoutubeLiveChatDto {
  @IsString()
  @MaxLength(80)
  channelId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  matchId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string | null;

  @IsOptional()
  @IsBoolean()
  autoStart?: boolean;

  @IsOptional()
  @IsBoolean()
  autoReplyEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  tournamentCommandsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  greetingEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  greetingTemplate?: string | null;

  @IsOptional()
  @IsBoolean()
  aiHostEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  matchUpdatesEnabled?: boolean;
}

export class UpdateYoutubeLiveChatSessionDto {
  @IsOptional()
  @IsString()
  @IsIn(['READY', 'RUNNING', 'PAUSED', 'ENDED', 'ERROR'])
  status?: string;

  @IsOptional()
  @IsBoolean()
  autoReplyEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  tournamentCommandsEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  matchId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string | null;

  @IsOptional()
  @IsBoolean()
  greetingEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  greetingTemplate?: string | null;

  @IsOptional()
  @IsBoolean()
  aiHostEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  matchUpdatesEnabled?: boolean;
}

export class UpsertYoutubePollDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  channelId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  liveSessionId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  options?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(40)
  keyword?: string;

  @IsOptional()
  @IsString()
  @IsIn(['OPEN', 'CLOSED'])
  status?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  pointsReward?: number;
}

export class UpsertYoutubeChallengeDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  channelId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  liveSessionId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  keyword?: string;

  @IsOptional()
  @IsString()
  @IsIn(['OPEN', 'CLOSED'])
  status?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5000)
  pointsReward?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  maxCompletions?: number;
}

export class ReplyToYoutubeLiveChatMessageDto {
  @IsString()
  @MaxLength(200)
  body!: string;

  @IsOptional()
  @IsBoolean()
  postNow?: boolean;
}

export class YoutubeCreatorDashboardQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  channelId?: string;
}

export class YoutubeCreatorCompetitorsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  channelId?: string;

  @IsString()
  @MaxLength(120)
  q!: string;
}

export class YoutubeSeoAssistDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  channelId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  videoId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  topic?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  currentTitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  currentDescription?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  keywords?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(40)
  language?: string | null;
}

export class UpsertYoutubeAutomationRuleDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  channelId?: string | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['KEYWORD', 'CONTAINS', 'REGEX'])
  matchMode?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  keywords?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  responseTemplate?: string;

  @IsOptional()
  @IsBoolean()
  requireApproval?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86400)
  cooldownSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
  maxRepliesPerHour?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  blockedWords?: string[];
}

export class UpsertYoutubeChatCommandDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  channelId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  command?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  responseTemplate?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86400)
  cooldownSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86400)
  userCooldownSeconds?: number;
}

export class UpsertYoutubeChatTimerDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  channelId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  liveSessionId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  message?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  intervalMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  minChatLines?: number;
}

export class CreateYoutubeGiveawayDto {
  @IsString()
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  @IsIn(['KEYWORD', 'PREDICTION'])
  mode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  channelId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  matchId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  videoId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  liveSessionId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  keyword?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  predictionQuestion?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  predictionCorrectTeamId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  predictionBoostMultiplier?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxWinners?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  startsAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  endsAt?: string | null;
}

export class UpdateYoutubeGiveawayDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @IsIn(['KEYWORD', 'PREDICTION'])
  mode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  channelId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  matchId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  videoId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  liveSessionId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  keyword?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  predictionQuestion?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  predictionCorrectTeamId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  predictionBoostMultiplier?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxWinners?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  startsAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  endsAt?: string | null;

  @IsOptional()
  @IsString()
  @IsIn(['DRAFT', 'OPEN', 'CLOSED', 'DRAWN', 'CANCELLED'])
  status?: string;
}

export class CollectYoutubeGiveawayEntriesDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  videoId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  liveSessionId?: string | null;
}

export class DrawYoutubeGiveawayDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  winnerCount?: number;
}

export class UpdateYoutubePlanDto {
  @IsString()
  @IsIn(['off', 'basic', 'pro', 'premium', 'agency'])
  plan!: string;
}
