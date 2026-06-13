import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'crypto';
import {
  Prisma,
  LiveState,
  MatchStatus,
  Role,
  YoutubeAutomationMatchMode,
  YoutubeChannelStatus,
  YoutubeCommentReviewStatus,
  YoutubeGiveawayMode,
  YoutubeGiveawayStatus,
  YoutubeLiveChatSessionStatus,
  YoutubeReplyStatus,
} from '@prisma/client';
import type { Actor } from '../../common/auth/jwt.strategy';
import { compareRankingRows } from '../../common/ranking-tiebreakers.util';
import { effectiveOrganizationId } from '../../common/org/org.util';
import { env } from '../../config/env.validation';
import { PrismaService } from '../../db/prisma.service';
import {
  CollectYoutubeGiveawayEntriesDto,
  CompleteYoutubeOAuthDto,
  CreateYoutubeGiveawayDto,
  DetectYoutubeLiveChatDto,
  DrawYoutubeGiveawayDto,
  ReplyToYoutubeLiveChatMessageDto,
  ReplyToYoutubeCommentDto,
  ReviewYoutubeCommentDto,
  StartYoutubeLiveChatDto,
  SyncYoutubeCommentsDto,
  UpdateYoutubeLiveChatSessionDto,
  UpdateYoutubeGiveawayDto,
  UpdateYoutubePlanDto,
  UpsertYoutubeAutomationRuleDto,
  UpsertYoutubeChallengeDto,
  UpsertYoutubeChatCommandDto,
  UpsertYoutubeChatTimerDto,
  UpsertYoutubePollDto,
  YoutubeCreatorCompetitorsQueryDto,
  YoutubeCreatorDashboardQueryDto,
  YoutubeSeoAssistDto,
} from './dto/youtube.dto';

const YOUTUBE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const YOUTUBE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YOUTUBE_API_BASE_URL = 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_LIVE_WORKER_INTERVAL_MS = 5000;
const YOUTUBE_LIVE_DEFAULT_POLL_MS = 5000;
const YOUTUBE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/youtube.force-ssl',
];
const YOUTUBE_STATE_TTL_MS = 10 * 60 * 1000;
const YOUTUBE_PLAN_ADDONS = [
  'youtube.basic',
  'youtube.pro',
  'youtube.premium',
  'youtube.agency',
] as const;

type YoutubePlanId = 'off' | 'basic' | 'pro' | 'premium' | 'agency';

type YoutubePlanLimits = {
  plan: YoutubePlanId;
  label: string;
  priceUsd: number | null;
  channelLimit: number;
  commentSync: boolean;
  manualReplies: boolean;
  safeAutomation: boolean;
  maxRepliesPerHour: number;
  activeGiveawayLimit: number;
  liveChat: boolean;
  maxLiveSessions: number;
  liveRepliesPerHour: number;
};

const YOUTUBE_PLAN_LIMITS: Record<YoutubePlanId, YoutubePlanLimits> = {
  off: {
    plan: 'off',
    label: 'Off',
    priceUsd: null,
    channelLimit: 0,
    commentSync: false,
    manualReplies: false,
    safeAutomation: false,
    maxRepliesPerHour: 0,
    activeGiveawayLimit: 0,
    liveChat: false,
    maxLiveSessions: 0,
    liveRepliesPerHour: 0,
  },
  basic: {
    plan: 'basic',
    label: 'YouTube Basic',
    priceUsd: 10.99,
    channelLimit: 1,
    commentSync: true,
    manualReplies: true,
    safeAutomation: false,
    maxRepliesPerHour: 0,
    activeGiveawayLimit: 2,
    liveChat: true,
    maxLiveSessions: 1,
    liveRepliesPerHour: 10,
  },
  pro: {
    plan: 'pro',
    label: 'YouTube Pro',
    priceUsd: 19.99,
    channelLimit: 2,
    commentSync: true,
    manualReplies: true,
    safeAutomation: true,
    maxRepliesPerHour: 20,
    activeGiveawayLimit: 6,
    liveChat: true,
    maxLiveSessions: 1,
    liveRepliesPerHour: 20,
  },
  premium: {
    plan: 'premium',
    label: 'YouTube Premium',
    priceUsd: 29.99,
    channelLimit: 5,
    commentSync: true,
    manualReplies: true,
    safeAutomation: true,
    maxRepliesPerHour: 60,
    activeGiveawayLimit: 15,
    liveChat: true,
    maxLiveSessions: 2,
    liveRepliesPerHour: 60,
  },
  agency: {
    plan: 'agency',
    label: 'YouTube Agency',
    priceUsd: 59.99,
    channelLimit: 15,
    commentSync: true,
    manualReplies: true,
    safeAutomation: true,
    maxRepliesPerHour: 200,
    activeGiveawayLimit: 50,
    liveChat: true,
    maxLiveSessions: 15,
    liveRepliesPerHour: 200,
  },
};

type YoutubeOAuthStatePayload = {
  organizationId: string;
  actorId: string | null;
  nonce: string;
  exp: number;
};

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type YoutubeChannelApiResponse = {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
      customUrl?: string;
      thumbnails?: Record<string, { url?: string } | undefined>;
    };
  }>;
};

type YoutubeCommentThreadResponse = {
  items?: YoutubeCommentThreadItem[];
};

type YoutubeCommentThreadItem = {
  id?: string;
  snippet?: {
    videoId?: string;
    topLevelComment?: YoutubeCommentItem;
  };
};

type YoutubeCommentItem = {
  id?: string;
  snippet?: {
    authorDisplayName?: string;
    authorChannelId?: { value?: string };
    textDisplay?: string;
    textOriginal?: string;
    likeCount?: number;
    publishedAt?: string;
    updatedAt?: string;
    moderationStatus?: string;
  };
};

type YoutubeCommentInsertResponse = {
  id?: string;
};

type YoutubeVideoListResponse = {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
      description?: string;
      publishedAt?: string;
      tags?: string[];
      thumbnails?: Record<string, { url?: string } | undefined>;
    };
    statistics?: {
      viewCount?: string;
      likeCount?: string;
      commentCount?: string;
    };
    liveStreamingDetails?: {
      activeLiveChatId?: string;
      actualStartTime?: string;
      actualEndTime?: string;
    };
  }>;
};

type YoutubeChannelStatsResponse = {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
      description?: string;
      customUrl?: string;
      thumbnails?: Record<string, { url?: string } | undefined>;
    };
    statistics?: {
      subscriberCount?: string;
      hiddenSubscriberCount?: boolean;
      viewCount?: string;
      videoCount?: string;
    };
    brandingSettings?: {
      channel?: {
        keywords?: string;
      };
    };
  }>;
};

type YoutubeSearchListResponse = {
  items?: Array<{
    id?: {
      videoId?: string;
      channelId?: string;
    };
    snippet?: {
      title?: string;
      description?: string;
      channelTitle?: string;
      channelId?: string;
      publishedAt?: string;
      thumbnails?: Record<string, { url?: string } | undefined>;
    };
  }>;
};

type YoutubeLiveBroadcastListResponse = {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
      liveChatId?: string;
      scheduledStartTime?: string;
      actualStartTime?: string;
    };
    status?: {
      lifeCycleStatus?: string;
    };
  }>;
};

type YoutubeLiveChatMessagesResponse = {
  nextPageToken?: string;
  pollingIntervalMillis?: number;
  items?: YoutubeLiveChatMessageItem[];
};

type YoutubeLiveChatMessageItem = {
  id?: string;
  snippet?: {
    liveChatId?: string;
    type?: string;
    authorChannelId?: string;
    publishedAt?: string;
    displayMessage?: string;
    textMessageDetails?: {
      messageText?: string;
    };
  };
  authorDetails?: {
    channelId?: string;
    displayName?: string;
    profileImageUrl?: string;
    isChatOwner?: boolean;
    isChatModerator?: boolean;
    isChatSponsor?: boolean;
    isVerified?: boolean;
  };
};

type YoutubeLiveChatMessageInsertResponse = {
  id?: string;
};

type OpenAiResponsesApiResponse = {
  output_text?: string | null;
  output?: Array<{
    content?: Array<{
      text?: string | { value?: string | null } | null;
    }> | null;
  }> | null;
};

type OrganizationForYoutube = {
  id: string;
  name: string;
  slug: string;
  deletedAt: Date | null;
  enabledAddOns: string[];
};

type YoutubeCommandMatch = {
  id: string;
  organizationId: string;
  name: string | null;
  matchNumber: number | null;
  slotCount: number;
  status: MatchStatus;
  liveState: LiveState;
  scheduledAt: Date | null;
  tournament: { name: string } | null;
  stage: { name: string } | null;
  group: { name: string } | null;
  matchSlots: Array<{
    slotNumber: number;
    lobbyStatus: string;
    team: { id: string; name: string; tag: string | null } | null;
  }>;
  slotResults: Array<{
    slotNumber: number;
    teamId: string | null;
    placement: number | null;
    finalPlacement: number | null;
    placementPoints: number;
    totalKills: number;
    finalKills: number | null;
    totalPoints: number;
    points: number;
    wasPresentInMatch: boolean | null;
    team: { id: string; name: string; tag: string | null } | null;
    players: Array<{ playerName: string; kills: number }>;
  }>;
  topFragger: {
    finalPlayerIgn: string | null;
    finalTeamTag: string | null;
    finalKills: number | null;
    autoPlayerIgn: string | null;
    autoTeamTag: string | null;
    autoKills: number;
  } | null;
};

@Injectable()
export class YoutubeService implements OnModuleInit, OnModuleDestroy {
  private liveWorkerTimer: NodeJS.Timeout | null = null;
  private liveWorkerRunning = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (this.optionalEnvValue('YOUTUBE_LIVE_CHAT_WORKER_DISABLED') === 'true') {
      return;
    }
    this.liveWorkerTimer = setInterval(() => {
      void this.runLiveChatWorker();
    }, YOUTUBE_LIVE_WORKER_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.liveWorkerTimer) {
      clearInterval(this.liveWorkerTimer);
      this.liveWorkerTimer = null;
    }
  }

  private getActorRole(actor: Actor | null | undefined): Role | null {
    return actor?.actorRole ?? actor?.role ?? null;
  }

  private assertSuperAdmin(actor: Actor | null | undefined) {
    if (this.getActorRole(actor) !== Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Only super admins can manage YouTube plans',
      );
    }
  }

  private resolveActorOrganizationId(actor: Actor | null | undefined): string {
    const organizationId = effectiveOrganizationId(actor ?? null);
    if (!organizationId) {
      throw new ForbiddenException('Organization context missing');
    }
    return organizationId;
  }

  private assertOrgScopedManager(
    actor: Actor | null | undefined,
    organizationId: string,
  ) {
    const role = this.getActorRole(actor);
    if (role === Role.SUPER_ADMIN) {
      return;
    }
    if (role !== Role.ADMIN && role !== Role.ORGANIZER) {
      throw new ForbiddenException('Not allowed to manage YouTube');
    }
    const actorOrgId = effectiveOrganizationId(actor ?? null);
    if (!actorOrgId || actorOrgId !== organizationId) {
      throw new ForbiddenException('Not allowed to manage this organization');
    }
  }

  private async requireOrganization(
    organizationId: string,
  ): Promise<OrganizationForYoutube> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        deletedAt: true,
        enabledAddOns: true,
      },
    });
    if (!organization || organization.deletedAt) {
      throw new NotFoundException('Organization not found');
    }
    return organization;
  }

  private youtubePlanForOrganization(
    organization: Pick<OrganizationForYoutube, 'enabledAddOns'>,
  ): YoutubePlanLimits {
    const addOns = organization.enabledAddOns ?? [];
    if (addOns.includes('youtube.agency')) return YOUTUBE_PLAN_LIMITS.agency;
    if (addOns.includes('youtube.premium')) return YOUTUBE_PLAN_LIMITS.premium;
    if (addOns.includes('youtube.pro')) return YOUTUBE_PLAN_LIMITS.pro;
    if (addOns.includes('youtube.basic')) return YOUTUBE_PLAN_LIMITS.basic;
    return YOUTUBE_PLAN_LIMITS.off;
  }

  private async limitsForOrgId(organizationId: string) {
    return this.youtubePlanForOrganization(
      await this.requireOrganization(organizationId),
    );
  }

  private assertFeatureEnabled(limits: YoutubePlanLimits) {
    if (limits.plan === 'off') {
      throw new ForbiddenException(
        'YouTube tools are not enabled for this organization',
      );
    }
  }

  private assertLiveChatEnabled(limits: YoutubePlanLimits) {
    this.assertFeatureEnabled(limits);
    if (!limits.liveChat) {
      throw new ForbiddenException(
        'YouTube Live Chat is not enabled for this organization',
      );
    }
  }

  private async assertLiveReplyLimit(
    organizationId: string,
    limits: YoutubePlanLimits,
  ) {
    if (limits.liveRepliesPerHour <= 0) {
      throw new ForbiddenException(
        'Live chat replies are disabled for this plan',
      );
    }
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const replyCount = await this.prisma.youtubeLiveChatMessage.count({
      where: {
        organizationId,
        replyStatus: YoutubeReplyStatus.POSTED,
        repliedAt: { gte: hourAgo },
      },
    });
    if (replyCount >= limits.liveRepliesPerHour) {
      throw new ForbiddenException(
        `Live chat reply limit reached (${replyCount}/${limits.liveRepliesPerHour} per hour)`,
      );
    }
  }

  private optionalEnvValue(...names: string[]): string | null {
    for (const name of names) {
      const value = process.env[name]?.trim();
      if (value) return value;
    }
    return null;
  }

  private youtubeClientId(): string {
    const clientId = this.optionalEnvValue(
      'YOUTUBE_CLIENT_ID',
      'GOOGLE_YOUTUBE_CLIENT_ID',
    );
    if (!clientId) {
      throw new ServiceUnavailableException(
        'YouTube OAuth client ID is not configured',
      );
    }
    return clientId;
  }

  private youtubeClientSecret(): string {
    const clientSecret = this.optionalEnvValue(
      'YOUTUBE_CLIENT_SECRET',
      'GOOGLE_YOUTUBE_CLIENT_SECRET',
    );
    if (!clientSecret) {
      throw new ServiceUnavailableException(
        'YouTube OAuth client secret is not configured',
      );
    }
    return clientSecret;
  }

  private youtubeRedirectUri(): string {
    const configured = this.optionalEnvValue(
      'YOUTUBE_REDIRECT_URI',
      'GOOGLE_YOUTUBE_REDIRECT_URI',
    );
    if (configured) return configured;

    const webOrigin =
      this.optionalEnvValue(
        'WEB_APP_ORIGIN',
        'FRONTEND_ORIGIN',
        'NEXT_PUBLIC_SITE_URL',
        'APP_URL',
      ) ?? 'http://localhost:3001';

    return `${webOrigin.replace(/\/+$/, '')}/organizer/youtube/callback`;
  }

  private youtubeStateSecret(): string {
    return (
      this.optionalEnvValue('YOUTUBE_STATE_SECRET') ??
      this.optionalEnvValue('JWT_SECRET') ??
      env.JWT_SECRET
    );
  }

  private tokenEncryptionSecret(): string {
    return (
      this.optionalEnvValue(
        'YOUTUBE_TOKEN_ENCRYPTION_KEY',
        'TOKEN_ENCRYPTION_KEY',
      ) ??
      this.optionalEnvValue('JWT_SECRET') ??
      env.JWT_SECRET
    );
  }

  private youtubeOAuthConfigured() {
    return Boolean(
      this.optionalEnvValue('YOUTUBE_CLIENT_ID', 'GOOGLE_YOUTUBE_CLIENT_ID') &&
      this.optionalEnvValue(
        'YOUTUBE_CLIENT_SECRET',
        'GOOGLE_YOUTUBE_CLIENT_SECRET',
      ),
    );
  }

  private encryptionKey(): Buffer {
    return createHash('sha256').update(this.tokenEncryptionSecret()).digest();
  }

  private encryptToken(value: string | null | undefined): string | null {
    if (!value) return null;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64url')}:${tag.toString(
      'base64url',
    )}:${encrypted.toString('base64url')}`;
  }

  private decryptToken(value: string | null | undefined): string | null {
    if (!value) return null;
    const [version, ivRaw, tagRaw, encryptedRaw] = value.split(':');
    if (version !== 'v1' || !ivRaw || !tagRaw || !encryptedRaw) {
      throw new ServiceUnavailableException('Stored YouTube token is invalid');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey(),
      Buffer.from(ivRaw, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  private signState(encodedPayload: string): string {
    return createHmac('sha256', this.youtubeStateSecret())
      .update(encodedPayload)
      .digest('base64url');
  }

  private createOAuthState(
    actor: Actor | null | undefined,
    organizationId: string,
  ) {
    const exp = Date.now() + YOUTUBE_STATE_TTL_MS;
    const payload: YoutubeOAuthStatePayload = {
      organizationId,
      actorId: actor?.id ?? null,
      nonce: randomBytes(16).toString('base64url'),
      exp,
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      'base64url',
    );
    return {
      state: `${encodedPayload}.${this.signState(encodedPayload)}`,
      expiresAt: new Date(exp),
    };
  }

  private verifyOAuthState(state: string): YoutubeOAuthStatePayload {
    const [encodedPayload, signature] = state.split('.');
    if (!encodedPayload || !signature) {
      throw new BadRequestException('Invalid YouTube OAuth state');
    }
    const expected = this.signState(encodedPayload);
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(signature);
    if (
      expectedBuffer.length !== actualBuffer.length ||
      !timingSafeEqual(expectedBuffer, actualBuffer)
    ) {
      throw new BadRequestException('Invalid YouTube OAuth state');
    }
    let payload: YoutubeOAuthStatePayload;
    try {
      payload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as YoutubeOAuthStatePayload;
    } catch {
      throw new BadRequestException('Invalid YouTube OAuth state');
    }
    if (!payload.organizationId || payload.exp < Date.now()) {
      throw new BadRequestException('Expired YouTube OAuth state');
    }
    return payload;
  }

  private parseDate(value: string | null | undefined): Date | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Date must be a valid ISO value');
    }
    return date;
  }

  private normalizeString(
    value: string | null | undefined,
  ): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private normalizeGreetingTemplate(value: string | null | undefined) {
    return (
      this.normalizeString(value)?.slice(0, 200) ??
      'Welcome {name} to the stream.'
    );
  }

  private normalizeStringArray(
    value: string[] | undefined,
  ): string[] | undefined {
    if (value === undefined) return undefined;
    return Array.from(
      new Set(value.map((item) => item.trim()).filter(Boolean)),
    ).slice(0, 50);
  }

  private parseYoutubeCount(value: string | null | undefined): number | null {
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private pickThumbnail(
    thumbnails: Record<string, { url?: string } | undefined> | undefined,
  ): string | null {
    if (!thumbnails) return null;
    return (
      thumbnails.maxres?.url ??
      thumbnails.standard?.url ??
      thumbnails.high?.url ??
      thumbnails.medium?.url ??
      thumbnails.default?.url ??
      null
    );
  }

  private splitYoutubeKeywords(value: string | null | undefined): string[] {
    if (!value) return [];
    const chunks: string[] = value.match(/"[^"]+"|[^\s,]+/g)?.slice() ?? [];
    return Array.from(
      new Set(
        chunks.map((item) => item.replace(/^"|"$/g, '').trim()).filter(Boolean),
      ),
    ).slice(0, 25);
  }

  private extractOpenAiOutputText(
    response: OpenAiResponsesApiResponse,
  ): string {
    if (
      typeof response.output_text === 'string' &&
      response.output_text.trim()
    ) {
      return response.output_text.trim();
    }

    const chunks: string[] = [];
    for (const item of response.output ?? []) {
      for (const content of item.content ?? []) {
        if (typeof content?.text === 'string' && content.text.trim()) {
          chunks.push(content.text.trim());
          continue;
        }
        const value =
          content?.text &&
          typeof content.text === 'object' &&
          typeof content.text.value === 'string'
            ? content.text.value.trim()
            : '';
        if (value) chunks.push(value);
      }
    }
    return chunks.join('\n').trim();
  }

  private stripCodeFence(value: string): string {
    return value
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    if (response.ok) {
      return (await response.json()) as T;
    }

    let detail = '';
    try {
      const payload = (await response.json()) as {
        error?: unknown;
        error_description?: unknown;
        message?: unknown;
      };
      const message =
        typeof payload.error_description === 'string'
          ? payload.error_description
          : typeof payload.message === 'string'
            ? payload.message
            : typeof payload.error === 'string'
              ? payload.error
              : null;
      detail = message ? `: ${message}` : '';
    } catch {
      detail = '';
    }

    throw new BadRequestException(
      `YouTube request failed (${response.status})${detail}`,
    );
  }

  private async exchangeOAuthCode(code: string): Promise<GoogleTokenResponse> {
    const body = new URLSearchParams({
      code,
      client_id: this.youtubeClientId(),
      client_secret: this.youtubeClientSecret(),
      redirect_uri: this.youtubeRedirectUri(),
      grant_type: 'authorization_code',
    });
    return this.fetchJson<GoogleTokenResponse>(YOUTUBE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  private async refreshAccessToken(channel: {
    id: string;
    refreshTokenEnc: string | null;
  }) {
    const refreshToken = this.decryptToken(channel.refreshTokenEnc);
    if (!refreshToken) {
      await this.prisma.youtubeChannel.update({
        where: { id: channel.id },
        data: { status: YoutubeChannelStatus.REAUTH_REQUIRED },
      });
      throw new ForbiddenException('Reconnect YouTube before posting');
    }

    const body = new URLSearchParams({
      client_id: this.youtubeClientId(),
      client_secret: this.youtubeClientSecret(),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const token = await this.fetchJson<GoogleTokenResponse>(YOUTUBE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!token.access_token) {
      throw new BadRequestException('YouTube did not return an access token');
    }

    const tokenExpiresAt = token.expires_in
      ? new Date(Date.now() + Math.max(60, token.expires_in - 60) * 1000)
      : null;

    await this.prisma.youtubeChannel.update({
      where: { id: channel.id },
      data: {
        accessTokenEnc: this.encryptToken(token.access_token),
        tokenExpiresAt,
        status: YoutubeChannelStatus.CONNECTED,
      },
    });

    return token.access_token;
  }

  private async getUsableAccessToken(channel: {
    id: string;
    accessTokenEnc: string | null;
    refreshTokenEnc: string | null;
    tokenExpiresAt: Date | null;
  }) {
    if (
      channel.accessTokenEnc &&
      channel.tokenExpiresAt &&
      channel.tokenExpiresAt.getTime() > Date.now() + 60_000
    ) {
      return this.decryptToken(channel.accessTokenEnc);
    }
    return this.refreshAccessToken(channel);
  }

  private async fetchMineChannel(accessToken: string) {
    const url = new URL(`${YOUTUBE_API_BASE_URL}/channels`);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('mine', 'true');
    const payload = await this.fetchJson<YoutubeChannelApiResponse>(
      url.toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const item = payload.items?.[0];
    if (!item?.id) {
      throw new BadRequestException(
        'No YouTube channel was returned for this account',
      );
    }
    const thumbnails = item.snippet?.thumbnails ?? {};
    const thumbnailUrl =
      thumbnails.high?.url ??
      thumbnails.medium?.url ??
      thumbnails.default?.url ??
      null;

    return {
      youtubeChannelId: item.id,
      title: item.snippet?.title?.trim() || 'YouTube Channel',
      handle: item.snippet?.customUrl ?? null,
      thumbnailUrl,
    };
  }

  private async fetchLiveVideoDetails(accessToken: string, videoId: string) {
    const url = new URL(`${YOUTUBE_API_BASE_URL}/videos`);
    url.searchParams.set('part', 'snippet,liveStreamingDetails');
    url.searchParams.set('id', videoId);
    const payload = await this.fetchJson<YoutubeVideoListResponse>(
      url.toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const item = payload.items?.[0];
    if (!item?.id) {
      throw new BadRequestException('YouTube video was not found');
    }
    const liveDetails = item.liveStreamingDetails;
    if (liveDetails?.actualEndTime) {
      throw new BadRequestException(
        'This YouTube live stream has already ended',
      );
    }
    const liveChatId = liveDetails?.activeLiveChatId;
    if (!liveChatId) {
      throw new BadRequestException(
        'This video does not have an active live chat yet',
      );
    }
    return {
      videoId: item.id,
      liveChatId,
      title: item.snippet?.title?.trim() || null,
    };
  }

  private async fetchActiveLiveVideoForChannel(
    accessToken: string,
    youtubeChannelId: string,
  ) {
    const broadcastsUrl = new URL(`${YOUTUBE_API_BASE_URL}/liveBroadcasts`);
    broadcastsUrl.searchParams.set('part', 'snippet,status');
    broadcastsUrl.searchParams.set('mine', 'true');
    broadcastsUrl.searchParams.set('broadcastStatus', 'active');
    broadcastsUrl.searchParams.set('broadcastType', 'all');
    broadcastsUrl.searchParams.set('maxResults', '5');

    try {
      const broadcasts = await this.fetchJson<YoutubeLiveBroadcastListResponse>(
        broadcastsUrl.toString(),
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const activeBroadcast = (broadcasts.items ?? []).find(
        (item) => item.id && item.snippet?.liveChatId,
      );
      if (activeBroadcast?.id && activeBroadcast.snippet?.liveChatId) {
        return {
          videoId: activeBroadcast.id,
          liveChatId: activeBroadcast.snippet.liveChatId,
          title: activeBroadcast.snippet.title?.trim() || null,
        };
      }
    } catch {
      // Fall back to public search below. Some channel/account setups cannot
      // read liveBroadcasts even though the live video is visible.
    }

    const searchUrl = new URL(`${YOUTUBE_API_BASE_URL}/search`);
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('channelId', youtubeChannelId);
    searchUrl.searchParams.set('eventType', 'live');
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('maxResults', '5');
    const search = await this.fetchJson<YoutubeSearchListResponse>(
      searchUrl.toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    for (const item of search.items ?? []) {
      const videoId = item.id?.videoId;
      if (!videoId) continue;
      try {
        return await this.fetchLiveVideoDetails(accessToken, videoId);
      } catch {
        continue;
      }
    }
    throw new NotFoundException(
      'No active YouTube live stream was found for this channel',
    );
  }

  private async fetchChannelStats(
    accessToken: string,
    youtubeChannelId: string,
  ) {
    const url = new URL(`${YOUTUBE_API_BASE_URL}/channels`);
    url.searchParams.set('part', 'snippet,statistics,brandingSettings');
    url.searchParams.set('id', youtubeChannelId);
    const payload = await this.fetchJson<YoutubeChannelStatsResponse>(
      url.toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const item = payload.items?.[0];
    if (!item?.id) {
      throw new BadRequestException('YouTube channel was not found');
    }
    return {
      youtubeChannelId: item.id,
      title: item.snippet?.title?.trim() || 'YouTube Channel',
      description: item.snippet?.description ?? null,
      handle: item.snippet?.customUrl ?? null,
      thumbnailUrl: this.pickThumbnail(item.snippet?.thumbnails),
      subscriberCount: this.parseYoutubeCount(item.statistics?.subscriberCount),
      hiddenSubscriberCount: item.statistics?.hiddenSubscriberCount ?? false,
      viewCount: this.parseYoutubeCount(item.statistics?.viewCount),
      videoCount: this.parseYoutubeCount(item.statistics?.videoCount),
      keywords: this.splitYoutubeKeywords(
        item.brandingSettings?.channel?.keywords,
      ),
    };
  }

  private async fetchRecentVideos(
    accessToken: string,
    youtubeChannelId: string,
    maxResults = 8,
  ) {
    const searchUrl = new URL(`${YOUTUBE_API_BASE_URL}/search`);
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('channelId', youtubeChannelId);
    searchUrl.searchParams.set('order', 'date');
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('maxResults', String(maxResults));
    const searchPayload = await this.fetchJson<YoutubeSearchListResponse>(
      searchUrl.toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const ids = Array.from(
      new Set(
        (searchPayload.items ?? [])
          .map((item) => item.id?.videoId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (ids.length === 0) return [];

    const videosUrl = new URL(`${YOUTUBE_API_BASE_URL}/videos`);
    videosUrl.searchParams.set('part', 'snippet,statistics,contentDetails');
    videosUrl.searchParams.set('id', ids.join(','));
    const videosPayload = await this.fetchJson<YoutubeVideoListResponse>(
      videosUrl.toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    return (videosPayload.items ?? []).map((item) => ({
      videoId: item.id ?? '',
      title: item.snippet?.title?.trim() || 'Untitled video',
      description: item.snippet?.description ?? null,
      publishedAt: item.snippet?.publishedAt ?? null,
      thumbnailUrl: this.pickThumbnail(item.snippet?.thumbnails),
      tags: item.snippet?.tags ?? [],
      viewCount: this.parseYoutubeCount(item.statistics?.viewCount),
      likeCount: this.parseYoutubeCount(item.statistics?.likeCount),
      commentCount: this.parseYoutubeCount(item.statistics?.commentCount),
    }));
  }

  private async fetchVideoSeoSource(
    accessToken: string,
    videoId: string,
  ): Promise<{
    title: string | null;
    description: string | null;
    tags: string[];
    viewCount: number | null;
    likeCount: number | null;
    commentCount: number | null;
  }> {
    const url = new URL(`${YOUTUBE_API_BASE_URL}/videos`);
    url.searchParams.set('part', 'snippet,statistics');
    url.searchParams.set('id', videoId);
    const payload = await this.fetchJson<YoutubeVideoListResponse>(
      url.toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const item = payload.items?.[0];
    if (!item?.id) {
      throw new BadRequestException('YouTube video was not found');
    }
    return {
      title: item.snippet?.title?.trim() || null,
      description: item.snippet?.description ?? null,
      tags: item.snippet?.tags ?? [],
      viewCount: this.parseYoutubeCount(item.statistics?.viewCount),
      likeCount: this.parseYoutubeCount(item.statistics?.likeCount),
      commentCount: this.parseYoutubeCount(item.statistics?.commentCount),
    };
  }

  private async postLiveChatMessage(
    channel: {
      id: string;
      accessTokenEnc: string | null;
      refreshTokenEnc: string | null;
      tokenExpiresAt: Date | null;
    },
    liveChatId: string,
    body: string,
  ) {
    const accessToken = await this.getUsableAccessToken(channel);
    return this.fetchJson<YoutubeLiveChatMessageInsertResponse>(
      `${YOUTUBE_API_BASE_URL}/liveChat/messages?part=snippet`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          snippet: {
            liveChatId,
            type: 'textMessageEvent',
            textMessageDetails: {
              messageText: body,
            },
          },
        }),
      },
    );
  }

  private toChannelView(channel: {
    id: string;
    youtubeChannelId: string;
    title: string;
    handle: string | null;
    thumbnailUrl: string | null;
    scopes: string[];
    status: YoutubeChannelStatus;
    tokenExpiresAt: Date | null;
    connectedAt: Date;
    lastSyncAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }) {
    return {
      id: channel.id,
      youtubeChannelId: channel.youtubeChannelId,
      title: channel.title,
      handle: channel.handle,
      thumbnailUrl: channel.thumbnailUrl,
      scopes: channel.scopes,
      status: channel.status,
      tokenExpiresAt: channel.tokenExpiresAt?.toISOString() ?? null,
      connectedAt: channel.connectedAt.toISOString(),
      lastSyncAt: channel.lastSyncAt?.toISOString() ?? null,
      createdAt: channel.createdAt.toISOString(),
      updatedAt: channel.updatedAt.toISOString(),
      deletedAt: channel.deletedAt?.toISOString() ?? null,
    };
  }

  private toCommentView(comment: {
    id: string;
    channelId: string;
    videoId: string;
    youtubeCommentId: string;
    authorName: string | null;
    authorChannelId: string | null;
    textDisplay: string | null;
    textOriginal: string | null;
    likeCount: number;
    publishedAt: Date | null;
    reviewStatus: YoutubeCommentReviewStatus;
    moderationStatus: string | null;
    updatedAt: Date;
    replies?: Array<{
      id: string;
      body: string;
      status: YoutubeReplyStatus;
      youtubeCommentId: string | null;
      error: string | null;
      postedAt: Date | null;
      createdAt: Date;
    }>;
  }) {
    return {
      id: comment.id,
      channelId: comment.channelId,
      videoId: comment.videoId,
      youtubeCommentId: comment.youtubeCommentId,
      authorName: comment.authorName,
      authorChannelId: comment.authorChannelId,
      textDisplay: comment.textDisplay,
      textOriginal: comment.textOriginal,
      likeCount: comment.likeCount,
      publishedAt: comment.publishedAt?.toISOString() ?? null,
      reviewStatus: comment.reviewStatus,
      moderationStatus: comment.moderationStatus,
      updatedAt: comment.updatedAt.toISOString(),
      replies:
        comment.replies?.map((reply) => ({
          id: reply.id,
          body: reply.body,
          status: reply.status,
          youtubeCommentId: reply.youtubeCommentId,
          error: reply.error,
          postedAt: reply.postedAt?.toISOString() ?? null,
          createdAt: reply.createdAt.toISOString(),
        })) ?? [],
    };
  }

  private toLiveSessionView(session: {
    id: string;
    channelId: string;
    matchId: string | null;
    videoId: string;
    liveChatId: string;
    title: string | null;
    status: YoutubeLiveChatSessionStatus;
    autoReplyEnabled: boolean;
    tournamentCommandsEnabled: boolean;
    greetingEnabled: boolean;
    greetingTemplate: string;
    aiHostEnabled: boolean;
    matchUpdatesEnabled: boolean;
    pollingIntervalMs: number | null;
    lastPolledAt: Date | null;
    nextPollAt: Date | null;
    importedCount: number;
    postedReplyCount: number;
    error: string | null;
    createdAt: Date;
    updatedAt: Date;
    endedAt: Date | null;
    match?: {
      id: string;
      name: string | null;
      matchNumber: number | null;
      status: MatchStatus;
      liveState: LiveState;
      scheduledAt: Date | null;
      tournament?: { name: string } | null;
      stage?: { name: string } | null;
      group?: { name: string } | null;
    } | null;
    _count?: {
      messages?: number;
      giveaways?: number;
      greetedViewers?: number;
    };
  }) {
    return {
      id: session.id,
      channelId: session.channelId,
      matchId: session.matchId,
      videoId: session.videoId,
      liveChatId: session.liveChatId,
      title: session.title,
      status: session.status,
      autoReplyEnabled: session.autoReplyEnabled,
      tournamentCommandsEnabled: session.tournamentCommandsEnabled,
      greetingEnabled: session.greetingEnabled,
      greetingTemplate: session.greetingTemplate,
      aiHostEnabled: session.aiHostEnabled,
      matchUpdatesEnabled: session.matchUpdatesEnabled,
      pollingIntervalMs: session.pollingIntervalMs,
      lastPolledAt: session.lastPolledAt?.toISOString() ?? null,
      nextPollAt: session.nextPollAt?.toISOString() ?? null,
      importedCount: session.importedCount,
      postedReplyCount: session.postedReplyCount,
      error: session.error,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
      match: session.match
        ? {
            id: session.match.id,
            name: this.matchLabel(session.match),
            status: session.match.status,
            liveState: session.match.liveState,
            scheduledAt: session.match.scheduledAt?.toISOString() ?? null,
          }
        : null,
      _count: session._count ?? {
        messages: 0,
        giveaways: 0,
        greetedViewers: 0,
      },
      greetedViewerCount: session._count?.greetedViewers ?? 0,
    };
  }

  private toLiveMessageView(message: {
    id: string;
    liveSessionId: string;
    channelId: string;
    youtubeMessageId: string;
    authorChannelId: string | null;
    authorName: string | null;
    authorPhotoUrl: string | null;
    messageText: string | null;
    messageType: string | null;
    publishedAt: Date | null;
    matchedRuleId: string | null;
    replyStatus: YoutubeReplyStatus | null;
    replyText: string | null;
    replyYoutubeMessageId: string | null;
    replyError: string | null;
    repliedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: message.id,
      liveSessionId: message.liveSessionId,
      channelId: message.channelId,
      youtubeMessageId: message.youtubeMessageId,
      authorChannelId: message.authorChannelId,
      authorName: message.authorName,
      authorPhotoUrl: message.authorPhotoUrl,
      messageText: message.messageText,
      messageType: message.messageType,
      publishedAt: message.publishedAt?.toISOString() ?? null,
      matchedRuleId: message.matchedRuleId,
      replyStatus: message.replyStatus,
      replyText: message.replyText,
      replyYoutubeMessageId: message.replyYoutubeMessageId,
      replyError: message.replyError,
      repliedAt: message.repliedAt?.toISOString() ?? null,
      createdAt: message.createdAt.toISOString(),
    };
  }

  private average(values: Array<number | null | undefined>): number | null {
    const usable = values.filter(
      (value): value is number => typeof value === 'number',
    );
    if (usable.length === 0) return null;
    return Math.round(
      usable.reduce((total, value) => total + value, 0) / usable.length,
    );
  }

  private startOfUtcDay(date = new Date()): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }

  private toDbBigInt(value: number | null | undefined): bigint | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return BigInt(Math.max(0, Math.round(value)));
  }

  private fromDbBigInt(
    value: bigint | number | null | undefined,
  ): number | null {
    if (value === null || value === undefined) return null;
    return Number(value);
  }

  private rankGrade(input: {
    subscriberCount: number | null;
    viewCount: number | null;
    averageRecentViews: number | null;
    uploadCadenceDays: number | null;
  }): string {
    let score = 0;
    if ((input.subscriberCount ?? 0) >= 100_000) score += 35;
    else if ((input.subscriberCount ?? 0) >= 10_000) score += 25;
    else if ((input.subscriberCount ?? 0) >= 1_000) score += 15;
    else if ((input.subscriberCount ?? 0) > 0) score += 8;

    if ((input.viewCount ?? 0) >= 10_000_000) score += 30;
    else if ((input.viewCount ?? 0) >= 1_000_000) score += 22;
    else if ((input.viewCount ?? 0) >= 100_000) score += 14;
    else if ((input.viewCount ?? 0) > 0) score += 6;

    if ((input.averageRecentViews ?? 0) >= 25_000) score += 20;
    else if ((input.averageRecentViews ?? 0) >= 5_000) score += 14;
    else if ((input.averageRecentViews ?? 0) >= 1_000) score += 9;
    else if ((input.averageRecentViews ?? 0) > 0) score += 4;

    if (input.uploadCadenceDays && input.uploadCadenceDays <= 3) score += 15;
    else if (input.uploadCadenceDays && input.uploadCadenceDays <= 7)
      score += 10;
    else if (input.uploadCadenceDays && input.uploadCadenceDays <= 14)
      score += 5;

    if (score >= 90) return 'S';
    if (score >= 75) return 'A';
    if (score >= 60) return 'B';
    if (score >= 40) return 'C';
    return 'D';
  }

  private estimateMonthlyEarnings(input: {
    currentViewCount: number | null;
    previousViewCount: number | null;
    previousCapturedAt: Date | null;
  }): { low: number | null; high: number | null } {
    if (
      typeof input.currentViewCount !== 'number' ||
      typeof input.previousViewCount !== 'number' ||
      !input.previousCapturedAt
    ) {
      return { low: null, high: null };
    }
    const diff = input.currentViewCount - input.previousViewCount;
    const elapsedDays = Math.max(
      1,
      (Date.now() - input.previousCapturedAt.getTime()) / (24 * 60 * 60 * 1000),
    );
    const monthlyViews = Math.max(0, (diff / elapsedDays) * 30);
    if (monthlyViews <= 0) return { low: null, high: null };
    return {
      low: Math.round((monthlyViews / 1000) * 0.25 * 100) / 100,
      high: Math.round((monthlyViews / 1000) * 4 * 100) / 100,
    };
  }

  private toSnapshotView(snapshot: {
    id: string;
    capturedDate: Date;
    capturedAt: Date;
    subscriberCount: bigint | number | null;
    hiddenSubscriberCount: boolean;
    viewCount: bigint | number | null;
    videoCount: bigint | number | null;
    averageRecentViews: bigint | number | null;
    averageRecentLikes: bigint | number | null;
    averageRecentComments: bigint | number | null;
    uploadCadenceDays: number | null;
    estimatedMonthlyLowUsd: number | null;
    estimatedMonthlyHighUsd: number | null;
    rankGrade: string | null;
  }) {
    return {
      id: snapshot.id,
      capturedDate: snapshot.capturedDate.toISOString(),
      capturedAt: snapshot.capturedAt.toISOString(),
      subscriberCount: this.fromDbBigInt(snapshot.subscriberCount),
      hiddenSubscriberCount: snapshot.hiddenSubscriberCount,
      viewCount: this.fromDbBigInt(snapshot.viewCount),
      videoCount: this.fromDbBigInt(snapshot.videoCount),
      averageRecentViews: this.fromDbBigInt(snapshot.averageRecentViews),
      averageRecentLikes: this.fromDbBigInt(snapshot.averageRecentLikes),
      averageRecentComments: this.fromDbBigInt(snapshot.averageRecentComments),
      uploadCadenceDays: snapshot.uploadCadenceDays,
      estimatedMonthlyLowUsd: snapshot.estimatedMonthlyLowUsd,
      estimatedMonthlyHighUsd: snapshot.estimatedMonthlyHighUsd,
      rankGrade: snapshot.rankGrade,
    };
  }

  private buildSnapshotTrends(
    snapshots: Array<ReturnType<YoutubeService['toSnapshotView']>>,
  ) {
    const sorted = [...snapshots].sort(
      (a, b) =>
        new Date(a.capturedDate).getTime() - new Date(b.capturedDate).getTime(),
    );
    const current = sorted.at(-1) ?? null;
    const deltaFrom = (days: number) => {
      if (!current || sorted.length < 2) {
        return {
          subscriberDelta: null,
          viewDelta: null,
          videoDelta: null,
          baselineDate: null,
        };
      }
      const target = Date.now() - days * 24 * 60 * 60 * 1000;
      const baseline =
        [...sorted]
          .reverse()
          .find(
            (snapshot) => new Date(snapshot.capturedDate).getTime() <= target,
          ) ?? sorted[0];
      return {
        subscriberDelta:
          current.subscriberCount !== null && baseline.subscriberCount !== null
            ? current.subscriberCount - baseline.subscriberCount
            : null,
        viewDelta:
          current.viewCount !== null && baseline.viewCount !== null
            ? current.viewCount - baseline.viewCount
            : null,
        videoDelta:
          current.videoCount !== null && baseline.videoCount !== null
            ? current.videoCount - baseline.videoCount
            : null,
        baselineDate: baseline.capturedDate,
      };
    };

    return {
      sevenDay: deltaFrom(7),
      thirtyDay: deltaFrom(30),
      currentGrade: current?.rankGrade ?? null,
      estimatedMonthlyLowUsd: current?.estimatedMonthlyLowUsd ?? null,
      estimatedMonthlyHighUsd: current?.estimatedMonthlyHighUsd ?? null,
    };
  }

  private readStringList(value: unknown, maxItems: number): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(
      new Set(
        value
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter(Boolean),
      ),
    ).slice(0, maxItems);
  }

  private keywordCandidates(input: {
    topic: string;
    title?: string | null;
    description?: string | null;
    keywords?: string[];
  }) {
    const source = [
      input.topic,
      input.title ?? '',
      input.description ?? '',
      ...(input.keywords ?? []),
    ].join(' ');
    const stopWords = new Set([
      'the',
      'and',
      'for',
      'with',
      'from',
      'this',
      'that',
      'your',
      'you',
      'are',
      'our',
      'live',
      'video',
      'new',
      'best',
    ]);
    const words = source
      .toLowerCase()
      .replace(/[^a-z0-9\s_-]/g, ' ')
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length >= 3 && !stopWords.has(word));
    const ranked = new Map<string, number>();
    for (const word of words) {
      ranked.set(word, (ranked.get(word) ?? 0) + 1);
    }
    return Array.from(ranked.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([word]) => word)
      .slice(0, 18);
  }

  private buildLocalSeoIdeas(input: {
    topic: string;
    currentTitle?: string | null;
    currentDescription?: string | null;
    keywords?: string[];
    language?: string | null;
    stats?: {
      viewCount: number | null;
      likeCount: number | null;
      commentCount: number | null;
    } | null;
  }) {
    const topic = input.topic.trim();
    const keywords = this.keywordCandidates({
      topic,
      title: input.currentTitle,
      description: input.currentDescription,
      keywords: input.keywords,
    });
    const primary = keywords[0] ?? topic;
    const secondary = keywords[1] ?? 'gameplay';
    const titleBase = input.currentTitle?.trim() || topic;
    const descriptionIntro =
      input.currentDescription?.trim().slice(0, 420) ||
      `${topic} with highlights, key moments, and viewer-friendly details.`;
    const titleLength = titleBase.length;
    const descriptionLength = descriptionIntro.length;
    const hasKeywords = keywords.length >= 5;
    const score = Math.max(
      35,
      Math.min(
        95,
        55 +
          (titleLength >= 45 && titleLength <= 75 ? 15 : 0) +
          (descriptionLength >= 180 ? 12 : 0) +
          (hasKeywords ? 10 : 0) +
          (input.stats?.commentCount ? 4 : 0),
      ),
    );

    return {
      provider: 'local',
      language: input.language?.trim() || 'English',
      score,
      titles: Array.from(
        new Set([
          `${topic} - Full Highlights and Best Moments`,
          `${primary.toUpperCase()} ${secondary} Breakdown | ${topic}`,
          `${topic}: What Happened, Key Plays, and Final Result`,
          `Best ${primary} Moments from ${topic}`,
          `${topic} Live Recap and Viewer Highlights`,
        ]),
      ).slice(0, 5),
      description: [
        descriptionIntro,
        '',
        'In this video:',
        `- Main topic: ${topic}`,
        `- Focus keywords: ${keywords.slice(0, 6).join(', ') || primary}`,
        '- Watch the full video for the best moments and final outcome.',
      ].join('\n'),
      tags: keywords,
      hashtags: keywords
        .slice(0, 5)
        .map((keyword) => `#${keyword.replace(/[^a-z0-9]/gi, '')}`)
        .filter((keyword) => keyword.length > 1),
      checklist: [
        {
          label: 'Title length',
          status: titleLength >= 45 && titleLength <= 75 ? 'good' : 'warning',
          advice:
            titleLength >= 45 && titleLength <= 75
              ? 'Title length is strong for search and browse.'
              : 'Aim for a clear title around 45 to 75 characters.',
        },
        {
          label: 'Description depth',
          status: descriptionLength >= 180 ? 'good' : 'warning',
          advice:
            descriptionLength >= 180
              ? 'Description has enough detail for context.'
              : 'Add a short summary, important names, and what viewers will see.',
        },
        {
          label: 'Keyword coverage',
          status: hasKeywords ? 'good' : 'missing',
          advice: hasKeywords
            ? 'Keywords are varied enough for a starter tag set.'
            : 'Add more specific game, team, event, and topic keywords.',
        },
      ],
      notes: [
        'Generated from local rules. If OpenAI is configured, Arenzyra will return a richer AI version.',
      ],
    };
  }

  private async tryGenerateAiSeoIdeas(input: {
    topic: string;
    currentTitle?: string | null;
    currentDescription?: string | null;
    keywords?: string[];
    language?: string | null;
    local: ReturnType<YoutubeService['buildLocalSeoIdeas']>;
  }) {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) return input.local;

    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.OPENAI_TEXT_MODEL?.trim() || 'gpt-4.1-mini',
          input: [
            {
              role: 'system',
              content:
                'You are a YouTube growth assistant for gaming creators. Return strict JSON only.',
            },
            {
              role: 'user',
              content: JSON.stringify({
                task: 'Generate SEO ideas for a YouTube gaming video.',
                requirements: {
                  titles: '5 clickable but honest titles, max 95 characters',
                  description:
                    'A complete description with search context and viewer value',
                  tags: '12-18 tags',
                  hashtags: '3-5 hashtags',
                  checklist:
                    '3-6 items with label, status good|warning|missing, and advice',
                  score: 'integer 0-100',
                },
                input: {
                  topic: input.topic,
                  currentTitle: input.currentTitle,
                  currentDescription: input.currentDescription,
                  keywords: input.keywords,
                  language: input.language || 'English',
                },
              }),
            },
          ],
          max_output_tokens: 1400,
        }),
      });
      if (!response.ok) return input.local;
      const payload = (await response.json()) as OpenAiResponsesApiResponse;
      const text = this.stripCodeFence(this.extractOpenAiOutputText(payload));
      const parsed = JSON.parse(text) as Record<string, unknown>;
      return {
        provider: 'openai',
        language:
          typeof parsed.language === 'string'
            ? parsed.language
            : input.local.language,
        score:
          typeof parsed.score === 'number'
            ? Math.max(0, Math.min(100, Math.round(parsed.score)))
            : input.local.score,
        titles: this.readStringList(parsed.titles, 5).length
          ? this.readStringList(parsed.titles, 5)
          : input.local.titles,
        description:
          typeof parsed.description === 'string' && parsed.description.trim()
            ? parsed.description.trim()
            : input.local.description,
        tags: this.readStringList(parsed.tags, 18).length
          ? this.readStringList(parsed.tags, 18)
          : input.local.tags,
        hashtags: this.readStringList(parsed.hashtags, 5).length
          ? this.readStringList(parsed.hashtags, 5)
          : input.local.hashtags,
        checklist: Array.isArray(parsed.checklist)
          ? parsed.checklist.slice(0, 6).map((item) => {
              const row = item as Record<string, unknown>;
              const status =
                row.status === 'good' ||
                row.status === 'warning' ||
                row.status === 'missing'
                  ? row.status
                  : 'warning';
              return {
                label:
                  typeof row.label === 'string' && row.label.trim()
                    ? row.label.trim()
                    : 'SEO check',
                status,
                advice:
                  typeof row.advice === 'string' && row.advice.trim()
                    ? row.advice.trim()
                    : 'Review this before publishing.',
              };
            })
          : input.local.checklist,
        notes: this.readStringList(parsed.notes, 5),
      };
    } catch {
      return input.local;
    }
  }

  private async audit(params: {
    organizationId: string;
    channelId?: string | null;
    actor?: Actor | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    before?: Prisma.InputJsonValue | null;
    after?: Prisma.InputJsonValue | null;
  }) {
    await this.prisma.youtubeAuditLog.create({
      data: {
        organizationId: params.organizationId,
        channelId: params.channelId ?? null,
        actorUserId: params.actor?.id ?? null,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId ?? null,
        before: params.before ?? Prisma.JsonNull,
        after: params.after ?? Prisma.JsonNull,
      },
    });
  }

  async getLimitsForActor(actor: Actor | null | undefined) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const organization = await this.requireOrganization(organizationId);
    const limits = this.youtubePlanForOrganization(organization);
    const connectedChannels = await this.prisma.youtubeChannel.count({
      where: {
        organizationId,
        deletedAt: null,
        status: { not: YoutubeChannelStatus.DISABLED },
      },
    });
    const activeLiveSessions = await this.prisma.youtubeLiveChatSession.count({
      where: {
        organizationId,
        deletedAt: null,
        status: {
          in: [
            YoutubeLiveChatSessionStatus.READY,
            YoutubeLiveChatSessionStatus.RUNNING,
            YoutubeLiveChatSessionStatus.PAUSED,
          ],
        },
      },
    });
    return {
      ...limits,
      connectedChannels,
      availableChannelSlots: Math.max(
        0,
        limits.channelLimit - connectedChannels,
      ),
      activeLiveSessions,
      availableLiveSessionSlots: Math.max(
        0,
        limits.maxLiveSessions - activeLiveSessions,
      ),
      oauthConfigured: this.youtubeOAuthConfigured(),
      redirectUri: this.youtubeRedirectUri(),
    };
  }

  async createOAuthUrl(actor: Actor | null | undefined) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const organization = await this.requireOrganization(organizationId);
    const limits = this.youtubePlanForOrganization(organization);
    this.assertFeatureEnabled(limits);

    const connectedChannels = await this.prisma.youtubeChannel.count({
      where: {
        organizationId,
        deletedAt: null,
        status: { not: YoutubeChannelStatus.DISABLED },
      },
    });
    if (connectedChannels >= limits.channelLimit) {
      throw new ForbiddenException(
        `YouTube channel limit reached (${connectedChannels}/${limits.channelLimit})`,
      );
    }

    const { state, expiresAt } = this.createOAuthState(actor, organizationId);
    const url = new URL(YOUTUBE_AUTH_URL);
    url.searchParams.set('client_id', this.youtubeClientId());
    url.searchParams.set('redirect_uri', this.youtubeRedirectUri());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', YOUTUBE_OAUTH_SCOPES.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('state', state);

    return {
      url: url.toString(),
      expiresAt: expiresAt.toISOString(),
      redirectUri: this.youtubeRedirectUri(),
      scopes: YOUTUBE_OAUTH_SCOPES,
    };
  }

  async completeOAuth(
    actor: Actor | null | undefined,
    dto: CompleteYoutubeOAuthDto,
  ) {
    const payload = this.verifyOAuthState(dto.state);
    const organizationId = payload.organizationId;
    this.assertOrgScopedManager(actor, organizationId);
    if (payload.actorId && actor?.id && payload.actorId !== actor.id) {
      throw new BadRequestException('YouTube OAuth state does not match user');
    }

    const organization = await this.requireOrganization(organizationId);
    const limits = this.youtubePlanForOrganization(organization);
    this.assertFeatureEnabled(limits);

    const token = await this.exchangeOAuthCode(dto.code);
    if (!token.access_token) {
      throw new BadRequestException('YouTube did not return an access token');
    }

    const channelInfo = await this.fetchMineChannel(token.access_token);
    const existing = await this.prisma.youtubeChannel.findUnique({
      where: {
        organizationId_youtubeChannelId: {
          organizationId,
          youtubeChannelId: channelInfo.youtubeChannelId,
        },
      },
    });

    if (!existing) {
      const connectedChannels = await this.prisma.youtubeChannel.count({
        where: {
          organizationId,
          deletedAt: null,
          status: { not: YoutubeChannelStatus.DISABLED },
        },
      });
      if (connectedChannels >= limits.channelLimit) {
        throw new ForbiddenException(
          `YouTube channel limit reached (${connectedChannels}/${limits.channelLimit})`,
        );
      }
    }

    const expiresIn = token.expires_in ?? 3600;
    const tokenExpiresAt = new Date(
      Date.now() + Math.max(60, expiresIn - 60) * 1000,
    );
    const scopes = token.scope
      ? token.scope.split(/\s+/).filter(Boolean)
      : YOUTUBE_OAUTH_SCOPES;

    const channel = await this.prisma.youtubeChannel.upsert({
      where: {
        organizationId_youtubeChannelId: {
          organizationId,
          youtubeChannelId: channelInfo.youtubeChannelId,
        },
      },
      create: {
        organizationId,
        youtubeChannelId: channelInfo.youtubeChannelId,
        title: channelInfo.title,
        handle: channelInfo.handle,
        thumbnailUrl: channelInfo.thumbnailUrl,
        scopes,
        accessTokenEnc: this.encryptToken(token.access_token),
        refreshTokenEnc: this.encryptToken(token.refresh_token),
        tokenExpiresAt,
        status: YoutubeChannelStatus.CONNECTED,
        connectedById: actor?.id ?? null,
      },
      update: {
        title: channelInfo.title,
        handle: channelInfo.handle,
        thumbnailUrl: channelInfo.thumbnailUrl,
        scopes,
        accessTokenEnc: this.encryptToken(token.access_token),
        refreshTokenEnc: token.refresh_token
          ? this.encryptToken(token.refresh_token)
          : existing?.refreshTokenEnc,
        tokenExpiresAt,
        status: YoutubeChannelStatus.CONNECTED,
        deletedAt: null,
        connectedById: actor?.id ?? existing?.connectedById ?? null,
      },
    });

    await this.audit({
      organizationId,
      channelId: channel.id,
      actor,
      action: 'youtube.channel.connected',
      targetType: 'youtubeChannel',
      targetId: channel.id,
      after: {
        youtubeChannelId: channel.youtubeChannelId,
        title: channel.title,
      },
    });

    return this.toChannelView(channel);
  }

  async listChannels(actor: Actor | null | undefined) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const channels = await this.prisma.youtubeChannel.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: [{ status: 'asc' }, { title: 'asc' }],
    });
    return channels.map((channel) => this.toChannelView(channel));
  }

  async disableChannel(actor: Actor | null | undefined, channelId: string) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const channel = await this.prisma.youtubeChannel.findFirst({
      where: { id: channelId, organizationId, deletedAt: null },
    });
    if (!channel) throw new NotFoundException('YouTube channel not found');

    const updated = await this.prisma.youtubeChannel.update({
      where: { id: channel.id },
      data: {
        status: YoutubeChannelStatus.DISABLED,
        accessTokenEnc: null,
        refreshTokenEnc: null,
        deletedAt: new Date(),
      },
    });
    await this.audit({
      organizationId,
      channelId: channel.id,
      actor,
      action: 'youtube.channel.disabled',
      targetType: 'youtubeChannel',
      targetId: channel.id,
    });
    return this.toChannelView(updated);
  }

  async syncComments(
    actor: Actor | null | undefined,
    channelId: string,
    dto: SyncYoutubeCommentsDto,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const limits = await this.limitsForOrgId(organizationId);
    this.assertFeatureEnabled(limits);
    if (!limits.commentSync) {
      throw new ForbiddenException('YouTube comment sync is disabled');
    }

    const channel = await this.prisma.youtubeChannel.findFirst({
      where: {
        id: channelId,
        organizationId,
        deletedAt: null,
        status: { not: YoutubeChannelStatus.DISABLED },
      },
    });
    if (!channel) throw new NotFoundException('YouTube channel not found');

    const accessToken = await this.getUsableAccessToken(channel);
    const videoId = dto.videoId.trim();
    const url = new URL(`${YOUTUBE_API_BASE_URL}/commentThreads`);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('videoId', videoId);
    url.searchParams.set('order', 'time');
    url.searchParams.set('textFormat', 'plainText');
    url.searchParams.set('maxResults', String(dto.maxResults ?? 50));

    const payload = await this.fetchJson<YoutubeCommentThreadResponse>(
      url.toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    let imported = 0;
    for (const item of payload.items ?? []) {
      const topLevelComment = item.snippet?.topLevelComment;
      const commentId = topLevelComment?.id ?? item.id;
      if (!commentId) continue;
      const snippet = topLevelComment?.snippet;
      const authorChannelId = snippet?.authorChannelId?.value ?? null;
      const publishedAt = snippet?.publishedAt
        ? new Date(snippet.publishedAt)
        : null;
      const updatedAtFromYoutube = snippet?.updatedAt
        ? new Date(snippet.updatedAt)
        : null;

      await this.prisma.youtubeComment.upsert({
        where: {
          channelId_youtubeCommentId: {
            channelId: channel.id,
            youtubeCommentId: commentId,
          },
        },
        create: {
          organizationId,
          channelId: channel.id,
          videoId,
          youtubeCommentId: commentId,
          authorName: snippet?.authorDisplayName ?? null,
          authorChannelId,
          textDisplay: snippet?.textDisplay ?? null,
          textOriginal: snippet?.textOriginal ?? null,
          likeCount: snippet?.likeCount ?? 0,
          publishedAt,
          updatedAtFromYoutube,
          moderationStatus: snippet?.moderationStatus ?? null,
          rawJson: item as Prisma.InputJsonValue,
        },
        update: {
          authorName: snippet?.authorDisplayName ?? null,
          authorChannelId,
          textDisplay: snippet?.textDisplay ?? null,
          textOriginal: snippet?.textOriginal ?? null,
          likeCount: snippet?.likeCount ?? 0,
          publishedAt,
          updatedAtFromYoutube,
          moderationStatus: snippet?.moderationStatus ?? null,
          rawJson: item as Prisma.InputJsonValue,
        },
      });
      imported += 1;
    }

    await this.prisma.youtubeChannel.update({
      where: { id: channel.id },
      data: { lastSyncAt: new Date() },
    });
    await this.audit({
      organizationId,
      channelId: channel.id,
      actor,
      action: 'youtube.comments.synced',
      targetType: 'youtubeVideo',
      targetId: videoId,
      after: { imported },
    });

    return { imported, videoId };
  }

  async listComments(
    actor: Actor | null | undefined,
    query: {
      channelId?: string;
      videoId?: string;
      reviewStatus?: YoutubeCommentReviewStatus;
    },
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const comments = await this.prisma.youtubeComment.findMany({
      where: {
        organizationId,
        ...(query.channelId ? { channelId: query.channelId } : {}),
        ...(query.videoId ? { videoId: query.videoId } : {}),
        ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
      },
      include: {
        replies: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return comments.map((comment) => this.toCommentView(comment));
  }

  async reviewComment(
    actor: Actor | null | undefined,
    commentId: string,
    dto: ReviewYoutubeCommentDto,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const current = await this.prisma.youtubeComment.findFirst({
      where: { id: commentId, organizationId },
    });
    if (!current) throw new NotFoundException('YouTube comment not found');
    const updated = await this.prisma.youtubeComment.update({
      where: { id: current.id },
      data: {
        reviewStatus: dto.reviewStatus as YoutubeCommentReviewStatus,
      },
      include: { replies: true },
    });
    await this.audit({
      organizationId,
      channelId: current.channelId,
      actor,
      action: 'youtube.comment.reviewed',
      targetType: 'youtubeComment',
      targetId: current.id,
      before: { reviewStatus: current.reviewStatus },
      after: { reviewStatus: updated.reviewStatus },
    });
    return this.toCommentView(updated);
  }

  async replyToComment(
    actor: Actor | null | undefined,
    commentId: string,
    dto: ReplyToYoutubeCommentDto,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const limits = await this.limitsForOrgId(organizationId);
    this.assertFeatureEnabled(limits);
    if (!limits.manualReplies) {
      throw new ForbiddenException('YouTube replies are disabled');
    }

    const body = dto.body.trim();
    if (!body) throw new BadRequestException('Reply body is required');

    const comment = await this.prisma.youtubeComment.findFirst({
      where: { id: commentId, organizationId },
      include: { channel: true },
    });
    if (!comment) throw new NotFoundException('YouTube comment not found');
    if (
      !comment.channel ||
      comment.channel.status === YoutubeChannelStatus.DISABLED
    ) {
      throw new ForbiddenException('Reconnect YouTube before replying');
    }

    if (!dto.postNow) {
      const reply = await this.prisma.youtubeCommentReply.create({
        data: {
          organizationId,
          channelId: comment.channelId,
          commentId: comment.id,
          body,
          status: YoutubeReplyStatus.PENDING_APPROVAL,
          createdById: actor?.id ?? null,
        },
      });
      return reply;
    }

    const accessToken = await this.getUsableAccessToken(comment.channel);
    const posted = await this.fetchJson<YoutubeCommentInsertResponse>(
      `${YOUTUBE_API_BASE_URL}/comments?part=snippet`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          snippet: {
            parentId: comment.youtubeCommentId,
            textOriginal: body,
          },
        }),
      },
    );

    const reply = await this.prisma.youtubeCommentReply.create({
      data: {
        organizationId,
        channelId: comment.channelId,
        commentId: comment.id,
        youtubeCommentId: posted.id ?? null,
        body,
        status: YoutubeReplyStatus.POSTED,
        postedAt: new Date(),
        createdById: actor?.id ?? null,
      },
    });
    await this.prisma.youtubeComment.update({
      where: { id: comment.id },
      data: { reviewStatus: YoutubeCommentReviewStatus.REPLIED },
    });
    await this.audit({
      organizationId,
      channelId: comment.channelId,
      actor,
      action: 'youtube.comment.replied',
      targetType: 'youtubeComment',
      targetId: comment.id,
      after: { replyId: reply.id, postedCommentId: posted.id ?? null },
    });
    return reply;
  }

  async listLiveChatSessions(actor: Actor | null | undefined) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const sessions = await this.prisma.youtubeLiveChatSession.findMany({
      where: { organizationId, deletedAt: null },
      include: {
        match: {
          select: {
            id: true,
            name: true,
            matchNumber: true,
            status: true,
            liveState: true,
            scheduledAt: true,
            tournament: { select: { name: true } },
            stage: { select: { name: true } },
            group: { select: { name: true } },
          },
        },
        _count: {
          select: { messages: true, giveaways: true, greetedViewers: true },
        },
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 50,
    });
    return sessions.map((session) => this.toLiveSessionView(session));
  }

  async listLiveContextMatches(actor: Actor | null | undefined) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const matches = await this.prisma.match.findMany({
      where: { organizationId, deletedAt: null },
      select: {
        id: true,
        name: true,
        matchNumber: true,
        status: true,
        liveState: true,
        scheduledAt: true,
        liveAt: true,
        startedAt: true,
        updatedAt: true,
        tournament: { select: { name: true } },
        stage: { select: { name: true } },
        group: { select: { name: true } },
        matchSlots: {
          where: { deletedAt: null, teamId: { not: null } },
          orderBy: { slotNumber: 'asc' },
          select: {
            slotNumber: true,
            team: {
              select: { id: true, name: true, tag: true, logoUrl: true },
            },
          },
        },
        matchTeams: {
          where: { deletedAt: null },
          orderBy: { slot: 'asc' },
          select: {
            slot: true,
            team: {
              select: { id: true, name: true, tag: true, logoUrl: true },
            },
          },
        },
      },
      orderBy: [
        { liveAt: { sort: 'desc', nulls: 'last' } },
        { scheduledAt: { sort: 'desc', nulls: 'last' } },
        { updatedAt: 'desc' },
      ],
      take: 80,
    });
    return matches.map((match) => {
      const teams = this.uniqueMatchTeams([
        ...match.matchSlots.map((slot) => ({
          slot: slot.slotNumber,
          team: slot.team,
        })),
        ...match.matchTeams.map((row) => ({
          slot: row.slot ?? null,
          team: row.team,
        })),
      ]);
      return {
        id: match.id,
        name: this.matchLabel(match),
        tournamentName: match.tournament?.name ?? null,
        stageName: match.stage?.name ?? match.group?.name ?? null,
        status: match.status,
        liveState: match.liveState,
        scheduledAt:
          match.scheduledAt?.toISOString() ??
          match.liveAt?.toISOString() ??
          match.startedAt?.toISOString() ??
          null,
        teamCount: teams.length,
        teams,
      };
    });
  }

  private async requireConnectedChannel(
    organizationId: string,
    channelId: string,
  ) {
    const channel = await this.prisma.youtubeChannel.findFirst({
      where: {
        id: channelId,
        organizationId,
        deletedAt: null,
        status: YoutubeChannelStatus.CONNECTED,
      },
    });
    if (!channel) throw new NotFoundException('YouTube channel not found');
    return channel;
  }

  async detectLiveChatSession(
    actor: Actor | null | undefined,
    dto: DetectYoutubeLiveChatDto,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const limits = await this.limitsForOrgId(organizationId);
    this.assertLiveChatEnabled(limits);
    const channel = await this.requireConnectedChannel(
      organizationId,
      dto.channelId,
    );
    const accessToken = await this.getUsableAccessToken(channel);
    if (!accessToken) {
      throw new ForbiddenException(
        'Reconnect YouTube before detecting live chat',
      );
    }
    const live = await this.fetchActiveLiveVideoForChannel(
      accessToken,
      channel.youtubeChannelId,
    );

    await this.audit({
      organizationId,
      channelId: channel.id,
      actor,
      action: 'youtube.live_chat.detected',
      targetType: 'youtubeLiveChatSession',
      targetId: live.videoId,
      after: live,
    });

    if (!dto.autoStart) {
      return { detected: live, session: null };
    }

    const session = await this.startLiveChatSession(actor, {
      channelId: channel.id,
      matchId: dto.matchId,
      videoId: live.videoId,
      title: this.normalizeString(dto.title) ?? live.title,
      autoReplyEnabled: dto.autoReplyEnabled,
      tournamentCommandsEnabled: dto.tournamentCommandsEnabled,
      greetingEnabled: dto.greetingEnabled,
      greetingTemplate: dto.greetingTemplate,
      aiHostEnabled: dto.aiHostEnabled,
      matchUpdatesEnabled: dto.matchUpdatesEnabled,
    });
    return { detected: live, session };
  }

  async startLiveChatSession(
    actor: Actor | null | undefined,
    dto: StartYoutubeLiveChatDto,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const limits = await this.limitsForOrgId(organizationId);
    this.assertLiveChatEnabled(limits);

    const videoId = dto.videoId.trim();
    if (!videoId) throw new BadRequestException('YouTube video ID is required');
    const channel = await this.requireConnectedChannel(
      organizationId,
      dto.channelId,
    );
    const matchId = await this.assertMatchBelongsToOrg(
      organizationId,
      dto.matchId,
    );

    const existing = await this.prisma.youtubeLiveChatSession.findUnique({
      where: {
        channelId_videoId: {
          channelId: channel.id,
          videoId,
        },
      },
    });
    if (!existing || existing.deletedAt) {
      const activeCount = await this.prisma.youtubeLiveChatSession.count({
        where: {
          organizationId,
          deletedAt: null,
          status: {
            in: [
              YoutubeLiveChatSessionStatus.READY,
              YoutubeLiveChatSessionStatus.RUNNING,
              YoutubeLiveChatSessionStatus.PAUSED,
            ],
          },
        },
      });
      if (activeCount >= limits.maxLiveSessions) {
        throw new ForbiddenException(
          `YouTube live session limit reached (${activeCount}/${limits.maxLiveSessions})`,
        );
      }
    }

    const accessToken = await this.getUsableAccessToken(channel);
    if (!accessToken) {
      throw new ForbiddenException(
        'Reconnect YouTube before starting live chat',
      );
    }
    const live = await this.fetchLiveVideoDetails(accessToken, videoId);
    const session = await this.prisma.youtubeLiveChatSession.upsert({
      where: {
        channelId_videoId: {
          channelId: channel.id,
          videoId,
        },
      },
      create: {
        organizationId,
        channelId: channel.id,
        matchId,
        videoId,
        liveChatId: live.liveChatId,
        title: this.normalizeString(dto.title) ?? live.title,
        status: YoutubeLiveChatSessionStatus.RUNNING,
        autoReplyEnabled: limits.safeAutomation
          ? (dto.autoReplyEnabled ?? false)
          : false,
        tournamentCommandsEnabled:
          Boolean(matchId) && (dto.tournamentCommandsEnabled ?? false),
        greetingEnabled: limits.safeAutomation
          ? (dto.greetingEnabled ?? false)
          : false,
        greetingTemplate: this.normalizeGreetingTemplate(dto.greetingTemplate),
        aiHostEnabled: limits.safeAutomation
          ? (dto.aiHostEnabled ?? false)
          : false,
        matchUpdatesEnabled: dto.matchUpdatesEnabled ?? true,
        nextAiHostAt:
          limits.safeAutomation && dto.aiHostEnabled
            ? new Date(Date.now() + 5 * 60_000)
            : null,
        nextPollAt: new Date(),
        createdById: actor?.id ?? null,
      },
      update: {
        matchId,
        liveChatId: live.liveChatId,
        title: this.normalizeString(dto.title) ?? live.title,
        status: YoutubeLiveChatSessionStatus.RUNNING,
        autoReplyEnabled: limits.safeAutomation
          ? (dto.autoReplyEnabled ?? existing?.autoReplyEnabled ?? false)
          : false,
        tournamentCommandsEnabled:
          Boolean(matchId) &&
          (dto.tournamentCommandsEnabled ??
            existing?.tournamentCommandsEnabled ??
            false),
        greetingEnabled: limits.safeAutomation
          ? (dto.greetingEnabled ?? existing?.greetingEnabled ?? false)
          : false,
        greetingTemplate: this.normalizeGreetingTemplate(
          dto.greetingTemplate ?? existing?.greetingTemplate,
        ),
        aiHostEnabled: limits.safeAutomation
          ? (dto.aiHostEnabled ?? existing?.aiHostEnabled ?? false)
          : false,
        matchUpdatesEnabled:
          dto.matchUpdatesEnabled ?? existing?.matchUpdatesEnabled ?? true,
        nextAiHostAt:
          dto.aiHostEnabled === true && !existing?.nextAiHostAt
            ? new Date(Date.now() + 5 * 60_000)
            : existing?.nextAiHostAt,
        error: null,
        endedAt: null,
        deletedAt: null,
        nextPollAt: new Date(),
      },
      include: {
        match: {
          select: {
            id: true,
            name: true,
            matchNumber: true,
            status: true,
            liveState: true,
            scheduledAt: true,
            tournament: { select: { name: true } },
            stage: { select: { name: true } },
            group: { select: { name: true } },
          },
        },
        _count: {
          select: { messages: true, giveaways: true, greetedViewers: true },
        },
      },
    });
    await this.audit({
      organizationId,
      channelId: channel.id,
      actor,
      action: 'youtube.live_chat.started',
      targetType: 'youtubeLiveChatSession',
      targetId: session.id,
      after: {
        videoId,
        liveChatId: live.liveChatId,
        autoReplyEnabled: session.autoReplyEnabled,
        tournamentCommandsEnabled: session.tournamentCommandsEnabled,
        greetingEnabled: session.greetingEnabled,
        aiHostEnabled: session.aiHostEnabled,
        matchUpdatesEnabled: session.matchUpdatesEnabled,
        matchId,
      },
    });
    return this.toLiveSessionView(session);
  }

  async updateLiveChatSession(
    actor: Actor | null | undefined,
    sessionId: string,
    dto: UpdateYoutubeLiveChatSessionDto,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const limits = await this.limitsForOrgId(organizationId);
    this.assertLiveChatEnabled(limits);
    const current = await this.prisma.youtubeLiveChatSession.findFirst({
      where: { id: sessionId, organizationId, deletedAt: null },
    });
    if (!current) throw new NotFoundException('YouTube live session not found');
    const status =
      dto.status !== undefined
        ? (dto.status as YoutubeLiveChatSessionStatus)
        : undefined;
    const matchId =
      dto.matchId === undefined
        ? undefined
        : await this.assertMatchBelongsToOrg(organizationId, dto.matchId);
    const updated = await this.prisma.youtubeLiveChatSession.update({
      where: { id: current.id },
      data: {
        ...(status !== undefined
          ? {
              status,
              endedAt:
                status === YoutubeLiveChatSessionStatus.ENDED
                  ? new Date()
                  : current.endedAt,
              nextPollAt:
                status === YoutubeLiveChatSessionStatus.RUNNING
                  ? new Date()
                  : current.nextPollAt,
            }
          : {}),
        ...(dto.autoReplyEnabled !== undefined
          ? { autoReplyEnabled: limits.safeAutomation && dto.autoReplyEnabled }
          : {}),
        ...(dto.tournamentCommandsEnabled !== undefined
          ? {
              tournamentCommandsEnabled:
                Boolean(matchId ?? current.matchId) &&
                dto.tournamentCommandsEnabled,
            }
          : {}),
        ...(dto.greetingEnabled !== undefined
          ? { greetingEnabled: limits.safeAutomation && dto.greetingEnabled }
          : {}),
        ...(dto.greetingTemplate !== undefined
          ? {
              greetingTemplate: this.normalizeGreetingTemplate(
                dto.greetingTemplate,
              ),
            }
          : {}),
        ...(dto.aiHostEnabled !== undefined
          ? {
              aiHostEnabled: limits.safeAutomation && dto.aiHostEnabled,
              nextAiHostAt:
                limits.safeAutomation && dto.aiHostEnabled
                  ? (current.nextAiHostAt ?? new Date(Date.now() + 5 * 60_000))
                  : null,
            }
          : {}),
        ...(dto.matchUpdatesEnabled !== undefined
          ? { matchUpdatesEnabled: dto.matchUpdatesEnabled }
          : {}),
        ...(matchId !== undefined
          ? {
              matchId,
              ...(matchId === null ? { tournamentCommandsEnabled: false } : {}),
            }
          : {}),
        ...(dto.title !== undefined
          ? { title: this.normalizeString(dto.title) ?? null }
          : {}),
        ...(status === YoutubeLiveChatSessionStatus.RUNNING
          ? { error: null }
          : {}),
      },
      include: {
        match: {
          select: {
            id: true,
            name: true,
            matchNumber: true,
            status: true,
            liveState: true,
            scheduledAt: true,
            tournament: { select: { name: true } },
            stage: { select: { name: true } },
            group: { select: { name: true } },
          },
        },
        _count: {
          select: { messages: true, giveaways: true, greetedViewers: true },
        },
      },
    });
    await this.audit({
      organizationId,
      channelId: current.channelId,
      actor,
      action: 'youtube.live_chat.updated',
      targetType: 'youtubeLiveChatSession',
      targetId: current.id,
      before: {
        status: current.status,
        autoReplyEnabled: current.autoReplyEnabled,
        tournamentCommandsEnabled: current.tournamentCommandsEnabled,
        greetingEnabled: current.greetingEnabled,
        greetingTemplate: current.greetingTemplate,
        aiHostEnabled: current.aiHostEnabled,
        matchUpdatesEnabled: current.matchUpdatesEnabled,
        matchId: current.matchId,
      },
      after: {
        status: updated.status,
        autoReplyEnabled: updated.autoReplyEnabled,
        tournamentCommandsEnabled: updated.tournamentCommandsEnabled,
        greetingEnabled: updated.greetingEnabled,
        greetingTemplate: updated.greetingTemplate,
        aiHostEnabled: updated.aiHostEnabled,
        matchUpdatesEnabled: updated.matchUpdatesEnabled,
        matchId: updated.matchId,
      },
    });
    return this.toLiveSessionView(updated);
  }

  async pollLiveChatSession(
    actor: Actor | null | undefined,
    sessionId: string,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const limits = await this.limitsForOrgId(organizationId);
    this.assertLiveChatEnabled(limits);
    const session = await this.prisma.youtubeLiveChatSession.findFirst({
      where: { id: sessionId, organizationId, deletedAt: null },
      include: { channel: true },
    });
    if (!session) throw new NotFoundException('YouTube live session not found');
    const result = await this.processLiveChatSession(session, limits);
    await this.audit({
      organizationId,
      channelId: session.channelId,
      actor,
      action: 'youtube.live_chat.polled',
      targetType: 'youtubeLiveChatSession',
      targetId: session.id,
      after: result,
    });
    return result;
  }

  async listLiveChatMessages(
    actor: Actor | null | undefined,
    sessionId: string,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const session = await this.prisma.youtubeLiveChatSession.findFirst({
      where: { id: sessionId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!session) throw new NotFoundException('YouTube live session not found');
    const messages = await this.prisma.youtubeLiveChatMessage.findMany({
      where: { organizationId, liveSessionId: session.id },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      take: 150,
    });
    return messages.map((message) => this.toLiveMessageView(message));
  }

  async replyToLiveChatMessage(
    actor: Actor | null | undefined,
    messageId: string,
    dto: ReplyToYoutubeLiveChatMessageDto,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const limits = await this.limitsForOrgId(organizationId);
    this.assertLiveChatEnabled(limits);

    const body = dto.body.trim();
    if (!body) throw new BadRequestException('Reply body is required');
    const message = await this.prisma.youtubeLiveChatMessage.findFirst({
      where: { id: messageId, organizationId },
      include: { channel: true, liveSession: true },
    });
    if (!message) throw new NotFoundException('YouTube live message not found');
    if (message.liveSession.status === YoutubeLiveChatSessionStatus.ENDED) {
      throw new ForbiddenException('This YouTube live chat has ended');
    }
    if (!dto.postNow) {
      const updated = await this.prisma.youtubeLiveChatMessage.update({
        where: { id: message.id },
        data: {
          replyStatus: YoutubeReplyStatus.PENDING_APPROVAL,
          replyText: body,
          replyError: null,
        },
      });
      return this.toLiveMessageView(updated);
    }

    await this.assertLiveReplyLimit(organizationId, limits);
    const posted = await this.postLiveChatMessage(
      message.channel,
      message.liveSession.liveChatId,
      body,
    );
    const updated = await this.prisma.youtubeLiveChatMessage.update({
      where: { id: message.id },
      data: {
        replyStatus: YoutubeReplyStatus.POSTED,
        replyText: body,
        replyYoutubeMessageId: posted.id ?? null,
        replyError: null,
        repliedAt: new Date(),
      },
    });
    await this.prisma.youtubeLiveChatSession.update({
      where: { id: message.liveSessionId },
      data: { postedReplyCount: { increment: 1 } },
    });
    await this.audit({
      organizationId,
      channelId: message.channelId,
      actor,
      action: 'youtube.live_chat.replied',
      targetType: 'youtubeLiveChatMessage',
      targetId: message.id,
      after: { postedMessageId: posted.id ?? null },
    });
    return this.toLiveMessageView(updated);
  }

  private async resolveCreatorChannel(
    organizationId: string,
    channelId: string | null | undefined,
  ) {
    if (channelId?.trim()) {
      return this.requireConnectedChannel(organizationId, channelId.trim());
    }
    const channel = await this.prisma.youtubeChannel.findFirst({
      where: {
        organizationId,
        deletedAt: null,
        status: YoutubeChannelStatus.CONNECTED,
      },
      orderBy: { connectedAt: 'desc' },
    });
    if (!channel)
      throw new NotFoundException('Connect a YouTube channel first');
    return channel;
  }

  async getCreatorDashboard(
    actor: Actor | null | undefined,
    query: YoutubeCreatorDashboardQueryDto,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const limits = await this.limitsForOrgId(organizationId);
    this.assertFeatureEnabled(limits);

    const channel = await this.resolveCreatorChannel(
      organizationId,
      query.channelId,
    );
    const accessToken = await this.getUsableAccessToken(channel);
    if (!accessToken) {
      throw new ForbiddenException(
        'Reconnect YouTube before loading analytics',
      );
    }

    const [channelStats, recentVideos] = await Promise.all([
      this.fetchChannelStats(accessToken, channel.youtubeChannelId),
      this.fetchRecentVideos(accessToken, channel.youtubeChannelId, 8),
    ]);
    const topVideo =
      [...recentVideos]
        .filter((video) => typeof video.viewCount === 'number')
        .sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0))[0] ?? null;
    const latestPublished = recentVideos
      .map((video) => (video.publishedAt ? new Date(video.publishedAt) : null))
      .filter((date): date is Date =>
        Boolean(date && !Number.isNaN(date.getTime())),
      );
    const oldest = latestPublished.length
      ? Math.min(...latestPublished.map((date) => date.getTime()))
      : null;
    const newest = latestPublished.length
      ? Math.max(...latestPublished.map((date) => date.getTime()))
      : null;
    const cadenceDays =
      oldest !== null && newest !== null && latestPublished.length > 1
        ? Math.max(
            1,
            Math.round(
              (newest - oldest) /
                (latestPublished.length - 1) /
                (24 * 60 * 60 * 1000),
            ),
          )
        : null;
    const averageRecentViews = this.average(
      recentVideos.map((video) => video.viewCount),
    );
    const averageRecentLikes = this.average(
      recentVideos.map((video) => video.likeCount),
    );
    const averageRecentComments = this.average(
      recentVideos.map((video) => video.commentCount),
    );
    const capturedDate = this.startOfUtcDay();
    const historyStart = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const existingSnapshots = await this.prisma.youtubeChannelSnapshot.findMany(
      {
        where: {
          channelId: channel.id,
          capturedDate: { gte: historyStart },
        },
        orderBy: { capturedDate: 'asc' },
      },
    );
    const previousSnapshot =
      [...existingSnapshots]
        .reverse()
        .find(
          (snapshot) =>
            snapshot.capturedDate.getTime() < capturedDate.getTime(),
        ) ?? null;
    const estimatedMonthly = this.estimateMonthlyEarnings({
      currentViewCount: channelStats.viewCount,
      previousViewCount: this.fromDbBigInt(previousSnapshot?.viewCount),
      previousCapturedAt: previousSnapshot?.capturedAt ?? null,
    });
    const rankGrade = this.rankGrade({
      subscriberCount: channelStats.hiddenSubscriberCount
        ? null
        : channelStats.subscriberCount,
      viewCount: channelStats.viewCount,
      averageRecentViews,
      uploadCadenceDays: cadenceDays,
    });
    await this.prisma.youtubeChannelSnapshot.upsert({
      where: {
        channelId_capturedDate: {
          channelId: channel.id,
          capturedDate,
        },
      },
      create: {
        organizationId,
        channelId: channel.id,
        youtubeChannelId: channel.youtubeChannelId,
        capturedDate,
        subscriberCount: channelStats.hiddenSubscriberCount
          ? null
          : this.toDbBigInt(channelStats.subscriberCount),
        hiddenSubscriberCount: channelStats.hiddenSubscriberCount,
        viewCount: this.toDbBigInt(channelStats.viewCount),
        videoCount: this.toDbBigInt(channelStats.videoCount),
        averageRecentViews: this.toDbBigInt(averageRecentViews),
        averageRecentLikes: this.toDbBigInt(averageRecentLikes),
        averageRecentComments: this.toDbBigInt(averageRecentComments),
        uploadCadenceDays: cadenceDays,
        estimatedMonthlyLowUsd: estimatedMonthly.low,
        estimatedMonthlyHighUsd: estimatedMonthly.high,
        rankGrade,
        rawJson: {
          source: 'creator-dashboard',
          channelStats,
          recentVideoCount: recentVideos.length,
        } as Prisma.InputJsonValue,
      },
      update: {
        capturedAt: new Date(),
        subscriberCount: channelStats.hiddenSubscriberCount
          ? null
          : this.toDbBigInt(channelStats.subscriberCount),
        hiddenSubscriberCount: channelStats.hiddenSubscriberCount,
        viewCount: this.toDbBigInt(channelStats.viewCount),
        videoCount: this.toDbBigInt(channelStats.videoCount),
        averageRecentViews: this.toDbBigInt(averageRecentViews),
        averageRecentLikes: this.toDbBigInt(averageRecentLikes),
        averageRecentComments: this.toDbBigInt(averageRecentComments),
        uploadCadenceDays: cadenceDays,
        estimatedMonthlyLowUsd: estimatedMonthly.low,
        estimatedMonthlyHighUsd: estimatedMonthly.high,
        rankGrade,
        rawJson: {
          source: 'creator-dashboard',
          channelStats,
          recentVideoCount: recentVideos.length,
        } as Prisma.InputJsonValue,
      },
    });
    const snapshots = await this.prisma.youtubeChannelSnapshot.findMany({
      where: {
        channelId: channel.id,
        capturedDate: { gte: historyStart },
      },
      orderBy: { capturedDate: 'asc' },
    });
    const snapshotViews = snapshots.map((snapshot) =>
      this.toSnapshotView(snapshot),
    );

    return {
      channel: {
        id: channel.id,
        youtubeChannelId: channel.youtubeChannelId,
        title: channelStats.title,
        handle: channelStats.handle ?? channel.handle,
        thumbnailUrl: channelStats.thumbnailUrl ?? channel.thumbnailUrl,
        description: channelStats.description,
        subscriberCount: channelStats.subscriberCount,
        hiddenSubscriberCount: channelStats.hiddenSubscriberCount,
        viewCount: channelStats.viewCount,
        videoCount: channelStats.videoCount,
        keywords: channelStats.keywords,
      },
      recentVideos,
      insights: {
        averageViews: averageRecentViews,
        averageLikes: averageRecentLikes,
        averageComments: averageRecentComments,
        topVideo,
        uploadCadenceDays: cadenceDays,
        quickWins: [
          recentVideos.some((video) => (video.tags?.length ?? 0) === 0)
            ? 'Some recent videos have no visible tags. Add focused game, event, and team tags.'
            : null,
          recentVideos.some(
            (video) => (video.description?.trim().length ?? 0) < 180,
          )
            ? 'Some descriptions are short. Add a useful first paragraph and chapter-style context.'
            : null,
          cadenceDays && cadenceDays > 7
            ? 'Upload cadence is wider than a week. Consider a repeatable content schedule.'
            : null,
        ].filter((item): item is string => Boolean(item)),
      },
      snapshots: snapshotViews,
      trends: this.buildSnapshotTrends(snapshotViews),
    };
  }

  async searchCreatorCompetitors(
    actor: Actor | null | undefined,
    query: YoutubeCreatorCompetitorsQueryDto,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const limits = await this.limitsForOrgId(organizationId);
    this.assertFeatureEnabled(limits);
    const q = query.q?.trim();
    if (!q) throw new BadRequestException('Search query is required');

    const channel = await this.resolveCreatorChannel(
      organizationId,
      query.channelId,
    );
    const accessToken = await this.getUsableAccessToken(channel);
    if (!accessToken) {
      throw new ForbiddenException(
        'Reconnect YouTube before searching channels',
      );
    }

    const searchUrl = new URL(`${YOUTUBE_API_BASE_URL}/search`);
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('type', 'channel');
    searchUrl.searchParams.set('q', q);
    searchUrl.searchParams.set('maxResults', '8');
    const searchPayload = await this.fetchJson<YoutubeSearchListResponse>(
      searchUrl.toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const channelIds = Array.from(
      new Set(
        (searchPayload.items ?? [])
          .map((item) => item.id?.channelId ?? item.snippet?.channelId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (channelIds.length === 0) return [];

    const channelsUrl = new URL(`${YOUTUBE_API_BASE_URL}/channels`);
    channelsUrl.searchParams.set('part', 'snippet,statistics');
    channelsUrl.searchParams.set('id', channelIds.join(','));
    const payload = await this.fetchJson<YoutubeChannelStatsResponse>(
      channelsUrl.toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    return (payload.items ?? []).map((item) => ({
      youtubeChannelId: item.id ?? '',
      title: item.snippet?.title?.trim() || 'YouTube Channel',
      description: item.snippet?.description ?? null,
      handle: item.snippet?.customUrl ?? null,
      thumbnailUrl: this.pickThumbnail(item.snippet?.thumbnails),
      subscriberCount: this.parseYoutubeCount(item.statistics?.subscriberCount),
      hiddenSubscriberCount: item.statistics?.hiddenSubscriberCount ?? false,
      viewCount: this.parseYoutubeCount(item.statistics?.viewCount),
      videoCount: this.parseYoutubeCount(item.statistics?.videoCount),
    }));
  }

  async generateSeoIdeas(
    actor: Actor | null | undefined,
    dto: YoutubeSeoAssistDto,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const limits = await this.limitsForOrgId(organizationId);
    this.assertFeatureEnabled(limits);

    let videoSource: {
      title: string | null;
      description: string | null;
      tags: string[];
      viewCount: number | null;
      likeCount: number | null;
      commentCount: number | null;
    } | null = null;
    const channelId = this.normalizeString(dto.channelId);
    const videoId = this.normalizeString(dto.videoId);
    if (channelId && videoId) {
      const channel = await this.resolveCreatorChannel(
        organizationId,
        channelId,
      );
      const accessToken = await this.getUsableAccessToken(channel);
      if (!accessToken) {
        throw new ForbiddenException(
          'Reconnect YouTube before analyzing videos',
        );
      }
      videoSource = await this.fetchVideoSeoSource(accessToken, videoId);
    }

    const topic =
      this.normalizeString(dto.topic) ??
      this.normalizeString(dto.currentTitle) ??
      videoSource?.title ??
      null;
    if (!topic) {
      throw new BadRequestException('Topic or current title is required');
    }
    const keywords = Array.from(
      new Set([
        ...(this.normalizeStringArray(dto.keywords) ?? []),
        ...(videoSource?.tags ?? []),
      ]),
    ).slice(0, 30);
    const currentTitle =
      this.normalizeString(dto.currentTitle) ?? videoSource?.title ?? null;
    const currentDescription =
      this.normalizeString(dto.currentDescription) ??
      videoSource?.description ??
      null;
    const local = this.buildLocalSeoIdeas({
      topic,
      currentTitle,
      currentDescription,
      keywords,
      language: dto.language,
      stats: videoSource,
    });
    return this.tryGenerateAiSeoIdeas({
      topic,
      currentTitle,
      currentDescription,
      keywords,
      language: dto.language,
      local,
    });
  }

  private async runLiveChatWorker() {
    if (this.liveWorkerRunning) return;
    this.liveWorkerRunning = true;
    try {
      const sessions = await this.prisma.youtubeLiveChatSession.findMany({
        where: {
          deletedAt: null,
          status: YoutubeLiveChatSessionStatus.RUNNING,
          OR: [{ nextPollAt: null }, { nextPollAt: { lte: new Date() } }],
        },
        include: {
          channel: true,
          organization: {
            select: {
              id: true,
              enabledAddOns: true,
            },
          },
        },
        orderBy: [{ nextPollAt: 'asc' }, { updatedAt: 'asc' }],
        take: 5,
      });
      for (const session of sessions) {
        const limits = this.youtubePlanForOrganization(session.organization);
        if (!limits.liveChat) continue;
        try {
          await this.processLiveChatSession(session, limits);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Live chat polling failed';
          await this.prisma.youtubeLiveChatSession.update({
            where: { id: session.id },
            data: {
              status: YoutubeLiveChatSessionStatus.ERROR,
              error: message.slice(0, 1000),
              nextPollAt: new Date(Date.now() + 60_000),
            },
          });
        }
      }
    } finally {
      this.liveWorkerRunning = false;
    }
  }

  private async processLiveChatSession(
    session: {
      id: string;
      organizationId: string;
      channelId: string;
      matchId: string | null;
      videoId: string;
      liveChatId: string;
      status: YoutubeLiveChatSessionStatus;
      autoReplyEnabled: boolean;
      tournamentCommandsEnabled: boolean;
      greetingEnabled: boolean;
      greetingTemplate: string;
      aiHostEnabled: boolean;
      matchUpdatesEnabled: boolean;
      nextAiHostAt: Date | null;
      lastMatchUpdateKey: string | null;
      nextPageToken: string | null;
      channel: {
        id: string;
        youtubeChannelId: string;
        accessTokenEnc: string | null;
        refreshTokenEnc: string | null;
        tokenExpiresAt: Date | null;
      };
    },
    limits: YoutubePlanLimits,
  ) {
    if (session.status === YoutubeLiveChatSessionStatus.ENDED) {
      throw new BadRequestException('This YouTube live chat has ended');
    }
    const accessToken = await this.getUsableAccessToken(session.channel);
    const url = new URL(`${YOUTUBE_API_BASE_URL}/liveChat/messages`);
    url.searchParams.set('part', 'snippet,authorDetails');
    url.searchParams.set('liveChatId', session.liveChatId);
    url.searchParams.set('maxResults', '200');
    if (session.nextPageToken) {
      url.searchParams.set('pageToken', session.nextPageToken);
    }
    const payload = await this.fetchJson<YoutubeLiveChatMessagesResponse>(
      url.toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    let imported = 0;
    let replied = 0;
    for (const item of payload.items ?? []) {
      const message = await this.upsertLiveChatMessage(session, item);
      if (!message) continue;
      if (message.created) {
        imported += 1;
        await this.recordLiveViewerActivity(session, message.record);
        await this.collectLiveGiveawayEntriesForMessage(message.record);
        await this.collectLivePollVoteForMessage(session, message.record);
        await this.collectLiveChallengeEntryForMessage(session, message.record);
        let commandReply: 'posted' | 'handled' | null = null;
        commandReply = await this.maybeReplyTournamentCommand(
          session,
          message.record,
          limits,
        );
        if (commandReply === 'posted') replied += 1;
        if (!commandReply) {
          commandReply = await this.maybeReplyCustomCommand(
            session,
            message.record,
            limits,
          );
          if (commandReply === 'posted') replied += 1;
        }
        if (!commandReply && session.greetingEnabled) {
          const greetingReply = await this.maybeGreetFirstLiveMessage(
            session,
            message.record,
            limits,
          );
          if (greetingReply === 'posted') replied += 1;
          if (greetingReply) commandReply = greetingReply;
        }
        if (!commandReply && session.autoReplyEnabled) {
          const didReply = await this.maybeAutoReplyLiveMessage(
            session,
            message.record,
            limits,
          );
          if (didReply) replied += 1;
        }
      }
    }
    replied += await this.maybeFireLiveTimers(session, limits);
    if (session.matchUpdatesEnabled) {
      replied += await this.maybePostMatchUpdate(session, limits);
    }
    if (session.aiHostEnabled) {
      replied += await this.maybePostAiHostMessage(session, limits);
    }

    const pollingIntervalMs = Math.max(
      2000,
      payload.pollingIntervalMillis ?? YOUTUBE_LIVE_DEFAULT_POLL_MS,
    );
    await this.prisma.youtubeLiveChatSession.update({
      where: { id: session.id },
      data: {
        status: YoutubeLiveChatSessionStatus.RUNNING,
        nextPageToken: payload.nextPageToken ?? session.nextPageToken,
        pollingIntervalMs,
        lastPolledAt: new Date(),
        nextPollAt: new Date(Date.now() + pollingIntervalMs),
        importedCount: { increment: imported },
        postedReplyCount: { increment: replied },
        error: null,
      },
    });
    return { imported, replied, pollingIntervalMs };
  }

  private async upsertLiveChatMessage(
    session: {
      id: string;
      organizationId: string;
      channelId: string;
      liveChatId: string;
    },
    item: YoutubeLiveChatMessageItem,
  ) {
    const youtubeMessageId = item.id;
    if (!youtubeMessageId) return null;
    const snippet = item.snippet;
    const author = item.authorDetails;
    const messageText =
      snippet?.textMessageDetails?.messageText ??
      snippet?.displayMessage ??
      null;
    const authorChannelId =
      author?.channelId ?? snippet?.authorChannelId ?? null;
    const publishedAt = snippet?.publishedAt
      ? new Date(snippet.publishedAt)
      : null;
    const existing = await this.prisma.youtubeLiveChatMessage.findUnique({
      where: {
        liveSessionId_youtubeMessageId: {
          liveSessionId: session.id,
          youtubeMessageId,
        },
      },
    });
    const data = {
      organizationId: session.organizationId,
      channelId: session.channelId,
      liveSessionId: session.id,
      liveChatId: snippet?.liveChatId ?? session.liveChatId,
      youtubeMessageId,
      authorChannelId,
      authorName: author?.displayName ?? null,
      authorPhotoUrl: author?.profileImageUrl ?? null,
      messageText,
      messageType: snippet?.type ?? null,
      publishedAt,
      rawJson: item as Prisma.InputJsonValue,
    };
    if (existing) {
      const record = await this.prisma.youtubeLiveChatMessage.update({
        where: { id: existing.id },
        data,
      });
      return { created: false, record };
    }
    const record = await this.prisma.youtubeLiveChatMessage.create({ data });
    return { created: true, record };
  }

  private viewerBadgeIds(profile: {
    points: number;
    messageCount: number;
    predictionCount: number;
    correctPredictionCount: number;
    pollVoteCount: number;
    challengeWinCount: number;
    giveawayWinCount: number;
  }) {
    const badges: string[] = [];
    if (profile.messageCount >= 1) badges.push('first-chat');
    if (profile.messageCount >= 20) badges.push('regular');
    if (profile.messageCount >= 100) badges.push('super-fan');
    if (profile.points >= 250) badges.push('points-hunter');
    if (profile.predictionCount >= 5) badges.push('predictor');
    if (profile.correctPredictionCount >= 3) badges.push('sharp-predictor');
    if (profile.pollVoteCount >= 3) badges.push('poll-voice');
    if (profile.challengeWinCount >= 1) badges.push('challenge-winner');
    if (profile.giveawayWinCount >= 1) badges.push('giveaway-winner');
    return badges;
  }

  private async updateViewerBadges(profile: {
    id: string;
    badgeIds: string[];
    points: number;
    messageCount: number;
    predictionCount: number;
    correctPredictionCount: number;
    pollVoteCount: number;
    challengeWinCount: number;
    giveawayWinCount: number;
  }) {
    const badgeIds = this.viewerBadgeIds(profile);
    if (badgeIds.join('|') === profile.badgeIds.join('|')) return profile;
    return this.prisma.youtubeViewerProfile.update({
      where: { id: profile.id },
      data: { badgeIds },
    });
  }

  private async upsertViewerProfile(data: {
    organizationId: string;
    channelId: string | null;
    authorChannelId: string | null;
    authorName: string | null;
    pointsDelta?: number;
    messageDelta?: number;
    commandDelta?: number;
    predictionDelta?: number;
    correctPredictionDelta?: number;
    pollVoteDelta?: number;
    challengeWinDelta?: number;
    giveawayWinDelta?: number;
    lastMessageAt?: Date | null;
  }) {
    if (!data.authorChannelId) return null;
    const now = new Date();
    const profile = await this.prisma.youtubeViewerProfile.upsert({
      where: {
        organizationId_authorChannelId: {
          organizationId: data.organizationId,
          authorChannelId: data.authorChannelId,
        },
      },
      create: {
        organizationId: data.organizationId,
        channelId: data.channelId,
        authorChannelId: data.authorChannelId,
        authorName: data.authorName,
        points: data.pointsDelta ?? 0,
        messageCount: data.messageDelta ?? 0,
        commandCount: data.commandDelta ?? 0,
        predictionCount: data.predictionDelta ?? 0,
        correctPredictionCount: data.correctPredictionDelta ?? 0,
        pollVoteCount: data.pollVoteDelta ?? 0,
        challengeWinCount: data.challengeWinDelta ?? 0,
        giveawayWinCount: data.giveawayWinDelta ?? 0,
        lastSeenAt: now,
        lastMessageAt: data.lastMessageAt ?? null,
      },
      update: {
        channelId: data.channelId,
        authorName: data.authorName ?? undefined,
        points: { increment: data.pointsDelta ?? 0 },
        messageCount: { increment: data.messageDelta ?? 0 },
        commandCount: { increment: data.commandDelta ?? 0 },
        predictionCount: { increment: data.predictionDelta ?? 0 },
        correctPredictionCount: {
          increment: data.correctPredictionDelta ?? 0,
        },
        pollVoteCount: { increment: data.pollVoteDelta ?? 0 },
        challengeWinCount: { increment: data.challengeWinDelta ?? 0 },
        giveawayWinCount: { increment: data.giveawayWinDelta ?? 0 },
        lastSeenAt: now,
        ...(data.lastMessageAt !== undefined
          ? { lastMessageAt: data.lastMessageAt }
          : {}),
      },
    });
    return this.updateViewerBadges(profile);
  }

  private async recordLiveViewerActivity(
    session: {
      organizationId: string;
      channelId: string;
      channel: { youtubeChannelId: string };
    },
    message: {
      authorChannelId: string | null;
      authorName: string | null;
      publishedAt: Date | null;
    },
  ) {
    if (!message.authorChannelId) return null;
    if (message.authorChannelId === session.channel.youtubeChannelId) {
      return null;
    }
    return this.upsertViewerProfile({
      organizationId: session.organizationId,
      channelId: session.channelId,
      authorChannelId: message.authorChannelId,
      authorName: message.authorName,
      pointsDelta: 1,
      messageDelta: 1,
      lastMessageAt: message.publishedAt ?? new Date(),
    });
  }

  private async collectLiveGiveawayEntriesForMessage(message: {
    id: string;
    organizationId: string;
    channelId: string;
    liveSessionId: string;
    youtubeMessageId: string;
    authorChannelId: string | null;
    authorName: string | null;
    messageText: string | null;
  }) {
    const giveaways = await this.prisma.youtubeGiveaway.findMany({
      where: {
        organizationId: message.organizationId,
        liveSessionId: message.liveSessionId,
        deletedAt: null,
        status: YoutubeGiveawayStatus.OPEN,
      },
    });
    let collected = 0;
    for (const giveaway of giveaways) {
      collected += await this.collectLiveGiveawayEntry(giveaway, message);
    }
    return collected;
  }

  private async collectLiveGiveawayEntry(
    giveaway: {
      id: string;
      organizationId: string;
      keyword: string | null;
      mode?: string | null;
      matchId?: string | null;
      predictionCorrectTeamId?: string | null;
      predictionBoostMultiplier?: number;
    },
    message: {
      id: string;
      channelId: string;
      youtubeMessageId: string;
      authorChannelId: string | null;
      authorName: string | null;
      messageText: string | null;
    },
  ) {
    const text = message.messageText ?? '';
    const isPrediction = giveaway.mode === YoutubeGiveawayMode.PREDICTION;
    const keyword = this.normalizeString(giveaway.keyword)?.toLowerCase();
    const predictionText = isPrediction
      ? this.extractPredictionText(text, keyword ?? '!predict')
      : null;
    if (isPrediction && !predictionText) return 0;
    if (!isPrediction && keyword && !text.toLowerCase().includes(keyword)) {
      return 0;
    }
    const authorChannelId =
      message.authorChannelId ?? `live:${message.youtubeMessageId}`;
    const prediction = isPrediction
      ? await this.resolvePredictionTeam(
          giveaway.organizationId,
          giveaway.matchId ?? null,
          predictionText,
        )
      : null;
    const predictionCorrect =
      isPrediction && prediction?.teamId && giveaway.predictionCorrectTeamId
        ? prediction.teamId === giveaway.predictionCorrectTeamId
        : null;
    const entryWeight =
      predictionCorrect === true
        ? Math.max(1, Math.min(20, giveaway.predictionBoostMultiplier ?? 3))
        : 1;
    const existing = await this.prisma.youtubeGiveawayEntry.findUnique({
      where: {
        giveawayId_authorChannelId: {
          giveawayId: giveaway.id,
          authorChannelId,
        },
      },
      select: { id: true },
    });
    await this.prisma.youtubeGiveawayEntry.upsert({
      where: {
        giveawayId_authorChannelId: {
          giveawayId: giveaway.id,
          authorChannelId,
        },
      },
      create: {
        organizationId: giveaway.organizationId,
        giveawayId: giveaway.id,
        liveMessageId: message.id,
        youtubeLiveMessageId: message.youtubeMessageId,
        authorChannelId,
        authorName: message.authorName,
        commentText: text,
        predictionTeamId: prediction?.teamId ?? null,
        predictionTeamName: prediction?.teamName ?? predictionText ?? null,
        predictionCorrect,
        entryWeight,
        eligible: isPrediction ? Boolean(prediction?.teamId) : true,
        disqualifiedReason:
          isPrediction && !prediction?.teamId
            ? 'Prediction team not found'
            : null,
      },
      update: {
        liveMessageId: message.id,
        youtubeLiveMessageId: message.youtubeMessageId,
        authorName: message.authorName,
        commentText: text,
        predictionTeamId: prediction?.teamId ?? null,
        predictionTeamName: prediction?.teamName ?? predictionText ?? null,
        predictionCorrect,
        entryWeight,
        eligible: isPrediction ? Boolean(prediction?.teamId) : true,
        disqualifiedReason:
          isPrediction && !prediction?.teamId
            ? 'Prediction team not found'
            : null,
      },
    });
    if (
      !existing &&
      isPrediction &&
      prediction?.teamId &&
      message.authorChannelId
    ) {
      await this.upsertViewerProfile({
        organizationId: giveaway.organizationId,
        channelId: message.channelId,
        authorChannelId: message.authorChannelId,
        authorName: message.authorName,
        pointsDelta: 5,
        predictionDelta: 1,
      });
    }
    return existing ? 0 : 1;
  }

  private parsePollVoteText(text: string | null, keyword: string) {
    const trimmed = (text ?? '').trim();
    if (!trimmed) return null;
    const normalizedKeyword = keyword.trim().toLowerCase() || '!vote';
    const lower = trimmed.toLowerCase();
    if (!lower.startsWith(normalizedKeyword.toLowerCase())) return null;
    return trimmed.slice(normalizedKeyword.length).trim();
  }

  private resolvePollOption(raw: string | null, options: string[]) {
    const value = this.normalizeTeamLookup(raw);
    if (!value) return null;
    const byNumber = Number(value);
    if (
      Number.isInteger(byNumber) &&
      byNumber >= 1 &&
      byNumber <= options.length
    ) {
      return options[byNumber - 1];
    }
    const letterIndex = value.length === 1 ? value.charCodeAt(0) - 97 : -1;
    if (letterIndex >= 0 && letterIndex < options.length) {
      return options[letterIndex];
    }
    return (
      options.find((option) => {
        const normalized = this.normalizeTeamLookup(option);
        return (
          normalized === value ||
          normalized.startsWith(value) ||
          value.startsWith(normalized)
        );
      }) ?? null
    );
  }

  private async collectLivePollVoteForMessage(
    session: {
      id: string;
      organizationId: string;
      channelId: string;
    },
    message: {
      id: string;
      authorChannelId: string | null;
      authorName: string | null;
      messageText: string | null;
    },
  ) {
    if (!message.authorChannelId || !message.messageText) return 0;
    const polls = await this.prisma.youtubePoll.findMany({
      where: {
        organizationId: session.organizationId,
        status: 'OPEN',
        deletedAt: null,
        AND: [
          { OR: [{ channelId: null }, { channelId: session.channelId }] },
          { OR: [{ liveSessionId: null }, { liveSessionId: session.id }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    });
    for (const poll of polls) {
      const rawOption = this.parsePollVoteText(
        message.messageText,
        poll.keyword,
      );
      const option = this.resolvePollOption(rawOption, poll.options);
      if (!option) continue;
      try {
        await this.prisma.youtubePollVote.create({
          data: {
            organizationId: session.organizationId,
            pollId: poll.id,
            liveSessionId: session.id,
            liveMessageId: message.id,
            authorChannelId: message.authorChannelId,
            authorName: message.authorName,
            option,
            pointsAwarded: poll.pointsReward,
          },
        });
      } catch {
        return 0;
      }
      await Promise.all([
        this.upsertViewerProfile({
          organizationId: session.organizationId,
          channelId: session.channelId,
          authorChannelId: message.authorChannelId,
          authorName: message.authorName,
          pointsDelta: poll.pointsReward,
          pollVoteDelta: 1,
        }),
        this.writeChatLog({
          organizationId: session.organizationId,
          channelId: session.channelId,
          liveSessionId: session.id,
          liveMessageId: message.id,
          action: 'POLL_VOTE',
          status: 'RECORDED',
          authorChannelId: message.authorChannelId,
          authorName: message.authorName,
          requestText: message.messageText,
          responseText: `${poll.title}: ${option}`,
        }),
      ]);
      return 1;
    }
    return 0;
  }

  private async collectLiveChallengeEntryForMessage(
    session: {
      id: string;
      organizationId: string;
      channelId: string;
    },
    message: {
      id: string;
      authorChannelId: string | null;
      authorName: string | null;
      messageText: string | null;
    },
  ) {
    if (!message.authorChannelId || !message.messageText) return 0;
    const text = message.messageText.toLowerCase();
    const challenges = await this.prisma.youtubeChallenge.findMany({
      where: {
        organizationId: session.organizationId,
        status: 'OPEN',
        deletedAt: null,
        AND: [
          { OR: [{ channelId: null }, { channelId: session.channelId }] },
          { OR: [{ liveSessionId: null }, { liveSessionId: session.id }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
        ],
      },
      include: { _count: { select: { entries: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    });
    for (const challenge of challenges) {
      const keyword = challenge.keyword.trim().toLowerCase();
      if (!keyword || !text.includes(keyword)) continue;
      if (
        challenge.maxCompletions !== null &&
        challenge._count.entries >= challenge.maxCompletions
      ) {
        await this.prisma.youtubeChallenge.update({
          where: { id: challenge.id },
          data: { status: 'CLOSED', closedAt: new Date() },
        });
        continue;
      }
      try {
        await this.prisma.youtubeChallengeEntry.create({
          data: {
            organizationId: session.organizationId,
            challengeId: challenge.id,
            liveSessionId: session.id,
            liveMessageId: message.id,
            authorChannelId: message.authorChannelId,
            authorName: message.authorName,
            messageText: message.messageText,
            pointsAwarded: challenge.pointsReward,
          },
        });
      } catch {
        return 0;
      }
      await Promise.all([
        this.upsertViewerProfile({
          organizationId: session.organizationId,
          channelId: session.channelId,
          authorChannelId: message.authorChannelId,
          authorName: message.authorName,
          pointsDelta: challenge.pointsReward,
          challengeWinDelta: 1,
        }),
        this.writeChatLog({
          organizationId: session.organizationId,
          channelId: session.channelId,
          liveSessionId: session.id,
          liveMessageId: message.id,
          action: 'CHALLENGE',
          status: 'RECORDED',
          authorChannelId: message.authorChannelId,
          authorName: message.authorName,
          requestText: message.messageText,
          responseText: `${challenge.title}: +${challenge.pointsReward} points`,
        }),
      ]);
      return 1;
    }
    return 0;
  }

  private matchLabel(match: {
    name: string | null;
    matchNumber: number | null;
    tournament?: { name: string } | null;
    stage?: { name: string } | null;
    group?: { name: string } | null;
  }) {
    const base = match.name ?? `Match ${match.matchNumber ?? ''}`.trim();
    const parts = [
      match.tournament?.name ?? null,
      match.stage?.name ?? match.group?.name ?? null,
    ].filter(Boolean);
    return parts.length ? `${base} - ${parts.join(' / ')}` : base;
  }

  private normalizeTeamLookup(value: string | null | undefined) {
    return (value ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .trim();
  }

  private uniqueMatchTeams(
    rows: Array<{
      slot: number | null;
      team: {
        id: string;
        name: string;
        tag: string | null;
        logoUrl?: string | null;
      } | null;
    }>,
  ) {
    const seen = new Set<string>();
    const teams: Array<{
      id: string;
      name: string;
      tag: string | null;
      logoUrl: string | null;
      slot: number | null;
    }> = [];
    for (const row of rows) {
      if (!row.team || seen.has(row.team.id)) continue;
      seen.add(row.team.id);
      teams.push({
        id: row.team.id,
        name: row.team.name,
        tag: row.team.tag ?? null,
        logoUrl: row.team.logoUrl ?? null,
        slot: row.slot,
      });
    }
    return teams;
  }

  private async assertMatchBelongsToOrg(
    organizationId: string,
    matchId: string | null | undefined,
  ) {
    if (matchId === undefined) return undefined;
    const normalized = this.normalizeString(matchId);
    if (!normalized) return null;
    const match = await this.prisma.match.findFirst({
      where: { id: normalized, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!match) throw new BadRequestException('Match not found');
    return match.id;
  }

  private async matchIdForLiveSession(liveSessionId: string) {
    const session = await this.prisma.youtubeLiveChatSession.findUnique({
      where: { id: liveSessionId },
      select: { matchId: true },
    });
    return session?.matchId ?? null;
  }

  private async assertPredictionTeamBelongsToMatch(
    organizationId: string,
    matchId: string | null | undefined,
    teamId: string | null | undefined,
  ) {
    if (teamId === undefined) return undefined;
    const normalized = this.normalizeString(teamId);
    if (!normalized) return null;
    if (!matchId) {
      throw new BadRequestException('Prediction winner needs a match');
    }
    const [slotCount, matchTeamCount, resultCount] = await Promise.all([
      this.prisma.matchSlot.count({
        where: { matchId, teamId: normalized, deletedAt: null },
      }),
      this.prisma.matchTeam.count({
        where: { matchId, teamId: normalized, deletedAt: null },
      }),
      this.prisma.matchSlotResult.count({
        where: { matchId, teamId: normalized, organizationId },
      }),
    ]);
    if (slotCount + matchTeamCount + resultCount === 0) {
      throw new BadRequestException('Prediction team is not in this match');
    }
    return normalized;
  }

  private extractPredictionText(text: string, keyword: string) {
    const trimmed = text.trim();
    const trigger = (keyword || '!predict').trim().toLowerCase();
    const lower = trimmed.toLowerCase();
    if (lower === trigger) return null;
    if (lower.startsWith(`${trigger} `)) {
      return trimmed.slice(trigger.length).trim() || null;
    }
    if (trigger !== '!predict' && lower.startsWith('!predict ')) {
      return trimmed.slice('!predict'.length).trim() || null;
    }
    return null;
  }

  private async resolvePredictionTeam(
    organizationId: string,
    matchId: string | null,
    predictionText: string | null,
  ) {
    const lookup = this.normalizeTeamLookup(predictionText);
    if (!matchId || !lookup) return null;
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, organizationId, deletedAt: null },
      select: {
        matchSlots: {
          where: { deletedAt: null, teamId: { not: null } },
          select: {
            slotNumber: true,
            team: { select: { id: true, name: true, tag: true } },
          },
        },
        matchTeams: {
          where: { deletedAt: null },
          select: {
            slot: true,
            team: { select: { id: true, name: true, tag: true } },
          },
        },
      },
    });
    if (!match) return null;
    const candidates = this.uniqueMatchTeams([
      ...match.matchSlots.map((slot) => ({
        slot: slot.slotNumber,
        team: slot.team,
      })),
      ...match.matchTeams.map((row) => ({
        slot: row.slot ?? null,
        team: row.team,
      })),
    ]);
    const exact = candidates.find(
      (team) =>
        this.normalizeTeamLookup(team.name) === lookup ||
        this.normalizeTeamLookup(team.tag) === lookup,
    );
    const fuzzy =
      exact ??
      candidates.find((team) => {
        const name = this.normalizeTeamLookup(team.name);
        const tag = this.normalizeTeamLookup(team.tag);
        return (
          (name && (name.includes(lookup) || lookup.includes(name))) ||
          (tag && (tag.includes(lookup) || lookup.includes(tag)))
        );
      });
    if (!fuzzy) return null;
    return {
      teamId: fuzzy.id,
      teamName: fuzzy.tag ? `${fuzzy.tag} ${fuzzy.name}` : fuzzy.name,
    };
  }

  private async refreshPredictionEntryWeights(giveawayId: string) {
    const giveaway = await this.prisma.youtubeGiveaway.findUnique({
      where: { id: giveawayId },
      select: {
        id: true,
        predictionCorrectTeamId: true,
        predictionBoostMultiplier: true,
      },
    });
    if (!giveaway?.predictionCorrectTeamId) return;
    const boost = Math.max(
      1,
      Math.min(20, giveaway.predictionBoostMultiplier ?? 3),
    );
    await Promise.all([
      this.prisma.youtubeGiveawayEntry.updateMany({
        where: {
          giveawayId,
          predictionTeamId: giveaway.predictionCorrectTeamId,
        },
        data: { predictionCorrect: true, entryWeight: boost, eligible: true },
      }),
      this.prisma.youtubeGiveawayEntry.updateMany({
        where: {
          giveawayId,
          predictionTeamId: { not: giveaway.predictionCorrectTeamId },
        },
        data: { predictionCorrect: false, entryWeight: 1 },
      }),
    ]);
  }

  private parseTournamentCommand(text: string | null) {
    const trimmed = (text ?? '').trim();
    if (!trimmed || !/^[!%]/.test(trimmed)) return null;
    const [rawCommand, ...parts] = trimmed.split(/\s+/);
    const command = rawCommand.replace(/^[!%]+/, '').toLowerCase();
    const args = parts.join(' ').trim();
    if (['slot', 'slots', 'free'].includes(command)) {
      return { command: 'slots', args };
    }
    if (['result', 'results', 'ranking', 'standings'].includes(command)) {
      return { command: 'result', args };
    }
    if (['next', 'nextmatch'].includes(command)) {
      return { command: 'next', args };
    }
    if (command === 'team') return { command: 'team', args };
    if (['mvp', 'fragger', 'topfragger'].includes(command)) {
      return { command: 'mvp', args };
    }
    if (['predict', 'prediction'].includes(command)) {
      return { command: 'predict', args };
    }
    if (['points', 'score', 'rank'].includes(command)) {
      return { command: command === 'rank' ? 'rank' : 'points', args };
    }
    if (['top', 'leaderboard', 'topchat'].includes(command)) {
      return { command: 'top', args };
    }
    if (['badges', 'badge'].includes(command)) {
      return { command: 'badges', args };
    }
    if (['poll', 'vote'].includes(command)) {
      return { command: 'poll', args };
    }
    if (['help', 'commands'].includes(command)) {
      return { command: 'help', args };
    }
    return null;
  }

  private normalizeChatCommandName(value: string | null | undefined) {
    const command = (value ?? '')
      .trim()
      .replace(/^[!%]+/, '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '');
    return command ? command.slice(0, 40) : null;
  }

  private parseCustomChatCommand(text: string | null) {
    const trimmed = (text ?? '').trim();
    if (!trimmed || !/^[!%]/.test(trimmed)) return null;
    const [rawCommand, ...parts] = trimmed.split(/\s+/);
    const command = this.normalizeChatCommandName(rawCommand);
    if (!command) return null;
    return { command, args: parts.join(' ').trim() };
  }

  private truncateLiveChatReply(text: string) {
    return text.trim().replace(/\s+/g, ' ').slice(0, 200);
  }

  private async countLiveBotPostsLastHour(organizationId: string) {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const [messageReplies, scheduledPosts] = await Promise.all([
      this.prisma.youtubeLiveChatMessage.count({
        where: {
          organizationId,
          replyStatus: YoutubeReplyStatus.POSTED,
          repliedAt: { gte: hourAgo },
        },
      }),
      this.prisma.youtubeChatLog.count({
        where: {
          organizationId,
          action: { in: ['TIMER', 'MATCH_UPDATE', 'AI_HOST'] },
          status: 'POSTED',
          createdAt: { gte: hourAgo },
        },
      }),
    ]);
    return messageReplies + scheduledPosts;
  }

  private async writeChatLog(data: {
    organizationId: string;
    channelId?: string | null;
    liveSessionId?: string | null;
    liveMessageId?: string | null;
    commandId?: string | null;
    timerId?: string | null;
    action: string;
    status: string;
    command?: string | null;
    authorChannelId?: string | null;
    authorName?: string | null;
    requestText?: string | null;
    responseText?: string | null;
    youtubeResponseId?: string | null;
    error?: string | null;
  }) {
    await this.prisma.youtubeChatLog.create({
      data: {
        organizationId: data.organizationId,
        channelId: data.channelId ?? null,
        liveSessionId: data.liveSessionId ?? null,
        liveMessageId: data.liveMessageId ?? null,
        commandId: data.commandId ?? null,
        timerId: data.timerId ?? null,
        action: data.action,
        status: data.status,
        command: data.command ?? null,
        authorChannelId: data.authorChannelId ?? null,
        authorName: data.authorName ?? null,
        requestText: data.requestText?.slice(0, 1000) ?? null,
        responseText: data.responseText?.slice(0, 1000) ?? null,
        youtubeResponseId: data.youtubeResponseId ?? null,
        error: data.error?.slice(0, 1000) ?? null,
      },
    });
  }

  private async maybeReplyTournamentCommand(
    session: {
      id: string;
      organizationId: string;
      channelId: string;
      matchId: string | null;
      videoId: string;
      liveChatId: string;
      tournamentCommandsEnabled: boolean;
      channel: {
        id: string;
        youtubeChannelId: string;
        accessTokenEnc: string | null;
        refreshTokenEnc: string | null;
        tokenExpiresAt: Date | null;
      };
    },
    message: {
      id: string;
      authorChannelId: string | null;
      authorName: string | null;
      messageText: string | null;
      replyStatus: YoutubeReplyStatus | null;
    },
    limits: YoutubePlanLimits,
  ): Promise<'posted' | 'handled' | null> {
    if (message.replyStatus || !message.messageText) return null;
    if (message.authorChannelId === session.channel.youtubeChannelId) {
      return null;
    }
    const parsed = this.parseTournamentCommand(message.messageText);
    if (!parsed) return null;
    const matchCommands = new Set(['slots', 'result', 'next', 'team', 'mvp']);
    if (
      matchCommands.has(parsed.command) &&
      !session.tournamentCommandsEnabled
    ) {
      return null;
    }
    const replyText = await this.buildTournamentCommandReply(
      session,
      parsed.command,
      parsed.args,
      message,
    );
    if (!replyText) return null;
    await this.upsertViewerProfile({
      organizationId: session.organizationId,
      channelId: session.channelId,
      authorChannelId: message.authorChannelId,
      authorName: message.authorName,
      commandDelta: 1,
    });

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const cooldownAt = new Date(Date.now() - 20_000);
    const [orgReplyCount, authorCooldownCount] = await Promise.all([
      this.prisma.youtubeLiveChatMessage.count({
        where: {
          organizationId: session.organizationId,
          replyStatus: YoutubeReplyStatus.POSTED,
          repliedAt: { gte: hourAgo },
        },
      }),
      message.authorChannelId
        ? this.prisma.youtubeLiveChatMessage.count({
            where: {
              liveSessionId: session.id,
              authorChannelId: message.authorChannelId,
              id: { not: message.id },
              replyStatus: YoutubeReplyStatus.POSTED,
              repliedAt: { gte: cooldownAt },
            },
          })
        : Promise.resolve(0),
    ]);
    if (
      limits.liveRepliesPerHour <= 0 ||
      orgReplyCount >= limits.liveRepliesPerHour ||
      authorCooldownCount > 0
    ) {
      await Promise.all([
        this.prisma.youtubeLiveChatMessage.update({
          where: { id: message.id },
          data: {
            replyStatus: YoutubeReplyStatus.PENDING_APPROVAL,
            replyText,
            replyError: 'Held by tournament command rate limit',
          },
        }),
        this.writeChatLog({
          organizationId: session.organizationId,
          channelId: session.channelId,
          liveSessionId: session.id,
          liveMessageId: message.id,
          action: 'COMMAND',
          status: 'HELD',
          command: parsed.command,
          authorChannelId: message.authorChannelId,
          authorName: message.authorName,
          requestText: message.messageText,
          responseText: replyText,
          error: 'Held by tournament command rate limit',
        }),
      ]);
      return 'handled';
    }

    try {
      const posted = await this.postLiveChatMessage(
        session.channel,
        session.liveChatId,
        replyText,
      );
      await Promise.all([
        this.prisma.youtubeLiveChatMessage.update({
          where: { id: message.id },
          data: {
            replyStatus: YoutubeReplyStatus.POSTED,
            replyText,
            replyYoutubeMessageId: posted.id ?? null,
            replyError: null,
            repliedAt: new Date(),
          },
        }),
        this.writeChatLog({
          organizationId: session.organizationId,
          channelId: session.channelId,
          liveSessionId: session.id,
          liveMessageId: message.id,
          action: 'COMMAND',
          status: 'POSTED',
          command: parsed.command,
          authorChannelId: message.authorChannelId,
          authorName: message.authorName,
          requestText: message.messageText,
          responseText: replyText,
          youtubeResponseId: posted.id ?? null,
        }),
      ]);
      return 'posted';
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message.slice(0, 1000) : 'Failed';
      await Promise.all([
        this.prisma.youtubeLiveChatMessage.update({
          where: { id: message.id },
          data: {
            replyStatus: YoutubeReplyStatus.FAILED,
            replyText,
            replyError: errorMessage,
          },
        }),
        this.writeChatLog({
          organizationId: session.organizationId,
          channelId: session.channelId,
          liveSessionId: session.id,
          liveMessageId: message.id,
          action: 'COMMAND',
          status: 'FAILED',
          command: parsed.command,
          authorChannelId: message.authorChannelId,
          authorName: message.authorName,
          requestText: message.messageText,
          responseText: replyText,
          error: errorMessage,
        }),
      ]);
      return 'handled';
    }
  }

  private viewerBadgeLabel(id: string) {
    const labels: Record<string, string> = {
      'first-chat': 'First Chat',
      regular: 'Regular',
      'super-fan': 'Super Fan',
      'points-hunter': 'Points Hunter',
      predictor: 'Predictor',
      'sharp-predictor': 'Sharp Predictor',
      'poll-voice': 'Poll Voice',
      'challenge-winner': 'Challenge Winner',
      'giveaway-winner': 'Giveaway Winner',
    };
    return labels[id] ?? id;
  }

  private viewerDisplayName(profile: {
    authorName: string | null;
    authorChannelId: string;
  }) {
    return profile.authorName?.trim() || profile.authorChannelId.slice(0, 10);
  }

  private async buildTournamentCommandReply(
    session: {
      id: string;
      organizationId: string;
      channelId: string;
      matchId: string | null;
    },
    command: string,
    args: string,
    message: { authorChannelId: string | null; authorName: string | null },
  ) {
    if (command === 'help') {
      return this.truncateLiveChatReply(
        'Arenzyra commands: !points, !rank, !top, !badges, !poll, !predict TEAM, !slots, !result, !next, !team TEAM, !mvp.',
      );
    }
    if (command === 'points' || command === 'rank') {
      if (!message.authorChannelId) {
        return this.truncateLiveChatReply('Points need a YouTube profile.');
      }
      const profile = await this.prisma.youtubeViewerProfile.findUnique({
        where: {
          organizationId_authorChannelId: {
            organizationId: session.organizationId,
            authorChannelId: message.authorChannelId,
          },
        },
      });
      if (!profile) {
        return this.truncateLiveChatReply(
          `${message.authorName ?? 'Viewer'}, you have 0 points. Chat more to climb the board.`,
        );
      }
      const rank =
        (await this.prisma.youtubeViewerProfile.count({
          where: {
            organizationId: session.organizationId,
            points: { gt: profile.points },
          },
        })) + 1;
      const badges = profile.badgeIds
        .slice(0, 3)
        .map((badge) => this.viewerBadgeLabel(badge))
        .join(', ');
      return this.truncateLiveChatReply(
        `${message.authorName ?? 'Viewer'}, you have ${profile.points} points and rank #${rank}.${badges ? ` Badges: ${badges}.` : ''}`,
      );
    }
    if (command === 'top') {
      const leaders = await this.prisma.youtubeViewerProfile.findMany({
        where: { organizationId: session.organizationId },
        orderBy: [{ points: 'desc' }, { lastSeenAt: 'asc' }],
        take: 5,
      });
      if (leaders.length === 0) {
        return this.truncateLiveChatReply(
          'Leaderboard is empty. First chats are earning points now.',
        );
      }
      return this.truncateLiveChatReply(
        `Top chat: ${leaders
          .map(
            (profile, index) =>
              `#${index + 1} ${this.viewerDisplayName(profile)} ${profile.points}pt`,
          )
          .join(', ')}`,
      );
    }
    if (command === 'badges') {
      if (!message.authorChannelId) {
        return this.truncateLiveChatReply('Badges need a YouTube profile.');
      }
      const profile = await this.prisma.youtubeViewerProfile.findUnique({
        where: {
          organizationId_authorChannelId: {
            organizationId: session.organizationId,
            authorChannelId: message.authorChannelId,
          },
        },
      });
      const badges = profile?.badgeIds ?? [];
      return this.truncateLiveChatReply(
        badges.length
          ? `${message.authorName ?? 'Viewer'} badges: ${badges
              .map((badge) => this.viewerBadgeLabel(badge))
              .join(', ')}.`
          : `${message.authorName ?? 'Viewer'}, no badges yet. Chat, vote, predict, and complete challenges.`,
      );
    }
    if (command === 'poll') {
      const poll = await this.prisma.youtubePoll.findFirst({
        where: {
          organizationId: session.organizationId,
          status: 'OPEN',
          deletedAt: null,
          AND: [
            { OR: [{ channelId: null }, { channelId: session.channelId }] },
            { OR: [{ liveSessionId: null }, { liveSessionId: session.id }] },
            { OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
          ],
        },
        orderBy: { updatedAt: 'desc' },
      });
      if (!poll) {
        return this.truncateLiveChatReply('No poll is open right now.');
      }
      return this.truncateLiveChatReply(
        `Poll: ${poll.title}. Vote with ${poll.keyword} ${poll.options
          .map((option, index) => `${index + 1}=${option}`)
          .join(', ')}.`,
      );
    }
    if (command === 'predict') {
      return this.buildPredictionCommandReply(session, args, message);
    }
    const match = await this.resolveCommandMatch(
      session.organizationId,
      session.matchId,
    );
    if (!match) {
      return this.truncateLiveChatReply(
        'No active Arenzyra match is linked yet.',
      );
    }
    if (command === 'slots') return this.buildSlotsReply(match);
    if (command === 'result') return this.buildResultReply(match);
    if (command === 'next') return this.buildNextMatchReply(match);
    if (command === 'team') return this.buildTeamReply(match, args);
    if (command === 'mvp') return this.buildMvpReply(match);
    return null;
  }

  private async buildPredictionCommandReply(
    session: { id: string; organizationId: string; matchId: string | null },
    args: string,
    message: { authorName: string | null },
  ) {
    const giveaway = await this.prisma.youtubeGiveaway.findFirst({
      where: {
        organizationId: session.organizationId,
        liveSessionId: session.id,
        mode: YoutubeGiveawayMode.PREDICTION,
        status: YoutubeGiveawayStatus.OPEN,
        deletedAt: null,
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (!giveaway) {
      return this.truncateLiveChatReply(
        'No prediction giveaway is open right now.',
      );
    }
    const prediction = await this.resolvePredictionTeam(
      session.organizationId,
      giveaway.matchId ?? session.matchId,
      args,
    );
    if (!prediction) {
      return this.truncateLiveChatReply(
        `${message.authorName ?? 'Viewer'}, send !predict TEAM using a team from this match.`,
      );
    }
    return this.truncateLiveChatReply(
      `${message.authorName ?? 'Viewer'} predicted ${prediction.teamName}. Good luck.`,
    );
  }

  private async resolveCommandMatch(
    organizationId: string,
    matchId: string | null,
  ): Promise<YoutubeCommandMatch | null> {
    const where = matchId
      ? { id: matchId, organizationId, deletedAt: null }
      : {
          organizationId,
          deletedAt: null,
          OR: [
            { status: MatchStatus.LIVE },
            { liveState: LiveState.LIVE },
            { status: MatchStatus.FINISH_PENDING },
          ],
        };
    return this.prisma.match.findFirst({
      where,
      select: this.commandMatchSelect(),
      orderBy: matchId
        ? undefined
        : [
            { liveAt: { sort: 'desc', nulls: 'last' } },
            { startedAt: { sort: 'desc', nulls: 'last' } },
            { updatedAt: 'desc' },
          ],
    }) as Promise<YoutubeCommandMatch | null>;
  }

  private commandMatchSelect() {
    return {
      id: true,
      organizationId: true,
      name: true,
      matchNumber: true,
      slotCount: true,
      status: true,
      liveState: true,
      scheduledAt: true,
      tournament: { select: { name: true } },
      stage: { select: { name: true } },
      group: { select: { name: true } },
      matchSlots: {
        where: { deletedAt: null },
        orderBy: { slotNumber: 'asc' },
        select: {
          slotNumber: true,
          lobbyStatus: true,
          team: { select: { id: true, name: true, tag: true } },
        },
      },
      slotResults: {
        where: { teamId: { not: null } },
        select: {
          slotNumber: true,
          teamId: true,
          placement: true,
          finalPlacement: true,
          placementPoints: true,
          totalKills: true,
          finalKills: true,
          totalPoints: true,
          points: true,
          wasPresentInMatch: true,
          team: { select: { id: true, name: true, tag: true } },
          players: {
            select: { playerName: true, kills: true },
            orderBy: { kills: 'desc' },
          },
        },
      },
      topFragger: true,
    } satisfies Prisma.MatchSelect;
  }

  private buildSlotsReply(match: YoutubeCommandMatch) {
    const assigned = match.matchSlots.filter((slot) => slot.team).length;
    const free = Math.max(
      0,
      (match.slotCount ?? match.matchSlots.length) - assigned,
    );
    const ready = match.matchSlots.filter(
      (slot) => slot.lobbyStatus === 'READY',
    ).length;
    const waiting = match.matchSlots.filter(
      (slot) => slot.lobbyStatus === 'WAITING',
    ).length;
    const offline = match.matchSlots.filter(
      (slot) => slot.lobbyStatus === 'OFFLINE',
    ).length;
    return this.truncateLiveChatReply(
      `${this.matchLabel(match)} slots: ${free} free, ${assigned} teams assigned. Ready ${ready}, waiting ${waiting}, offline ${offline}.`,
    );
  }

  private resultRows(match: YoutubeCommandMatch) {
    return match.slotResults
      .filter((row) => row.team && row.wasPresentInMatch !== false)
      .map((row) => ({
        teamId: row.teamId ?? '',
        teamName: row.team?.tag || row.team?.name || `Slot ${row.slotNumber}`,
        placement: row.finalPlacement ?? row.placement ?? null,
        totalKills: row.finalKills ?? row.totalKills ?? 0,
        placementPoints: row.placementPoints ?? 0,
        totalPoints:
          row.totalPoints ??
          row.points ??
          (row.finalKills ?? row.totalKills ?? 0) + (row.placementPoints ?? 0),
      }))
      .sort((left, right) => {
        const ranking = compareRankingRows(left, right);
        if (ranking !== 0) return ranking;
        if (left.placement !== null && right.placement !== null) {
          return left.placement - right.placement;
        }
        return 0;
      });
  }

  private buildResultReply(match: YoutubeCommandMatch) {
    const rows = this.resultRows(match).slice(0, 3);
    if (rows.length === 0) {
      return this.truncateLiveChatReply(
        `${this.matchLabel(match)} result is not posted yet.`,
      );
    }
    return this.truncateLiveChatReply(
      `${this.matchLabel(match)} top ${rows.length}: ${rows
        .map(
          (row, index) =>
            `#${index + 1} ${row.teamName} ${row.totalPoints}pt/${row.totalKills}k`,
        )
        .join(', ')}`,
    );
  }

  private async buildNextMatchReply(match: YoutubeCommandMatch) {
    const next = await this.prisma.match.findFirst({
      where: {
        organizationId: match.organizationId,
        deletedAt: null,
        id: { not: match.id },
        OR: [{ liveState: LiveState.UPCOMING }, { status: MatchStatus.DRAFT }],
      },
      orderBy: [
        { scheduledAt: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'asc' },
      ],
      select: {
        name: true,
        matchNumber: true,
        scheduledAt: true,
        tournament: { select: { name: true } },
        stage: { select: { name: true } },
        group: { select: { name: true } },
      },
    });
    if (!next)
      return this.truncateLiveChatReply('No next match is scheduled yet.');
    const time = next.scheduledAt
      ? ` at ${next.scheduledAt.toISOString().slice(0, 16).replace('T', ' ')}`
      : '';
    return this.truncateLiveChatReply(`Next: ${this.matchLabel(next)}${time}.`);
  }

  private buildTeamReply(match: YoutubeCommandMatch, args: string) {
    const lookup = this.normalizeTeamLookup(args);
    if (!lookup) {
      return this.truncateLiveChatReply('Use !team TEAM_NAME to check a team.');
    }
    const slot = match.matchSlots.find((row) => {
      const name = this.normalizeTeamLookup(row.team?.name);
      const tag = this.normalizeTeamLookup(row.team?.tag);
      return (
        name === lookup ||
        tag === lookup ||
        name.includes(lookup) ||
        tag.includes(lookup)
      );
    });
    const result = match.slotResults.find(
      (row) => row.team?.id === slot?.team?.id,
    );
    if (!slot?.team) {
      return this.truncateLiveChatReply(
        `Team "${args}" was not found in ${this.matchLabel(match)}.`,
      );
    }
    const resultText = result
      ? ` Result: ${result.totalPoints ?? result.points ?? 0}pt/${result.finalKills ?? result.totalKills ?? 0}k, place ${result.finalPlacement ?? result.placement ?? 'TBD'}.`
      : '';
    return this.truncateLiveChatReply(
      `${slot.team.tag ?? slot.team.name}: slot #${slot.slotNumber}, ${slot.lobbyStatus.toLowerCase()}.${resultText}`,
    );
  }

  private buildMvpReply(match: YoutubeCommandMatch) {
    const top = match.topFragger;
    if (top?.finalPlayerIgn || top?.autoPlayerIgn) {
      const name = top.finalPlayerIgn ?? top.autoPlayerIgn ?? 'Top fragger';
      const team = top.finalTeamTag ?? top.autoTeamTag ?? '';
      const kills = top.finalKills ?? top.autoKills ?? 0;
      return this.truncateLiveChatReply(
        `MVP/top fragger: ${name}${team ? ` (${team})` : ''} with ${kills} kills.`,
      );
    }
    const player = match.slotResults
      .flatMap((row) =>
        row.players.map((entry) => ({
          name: entry.playerName,
          kills: entry.kills ?? 0,
          team: row.team?.tag ?? row.team?.name ?? null,
        })),
      )
      .sort((left, right) => right.kills - left.kills)[0];
    if (!player?.name) {
      return this.truncateLiveChatReply(
        'MVP/top fragger is not available yet.',
      );
    }
    return this.truncateLiveChatReply(
      `MVP/top fragger: ${player.name}${player.team ? ` (${player.team})` : ''} with ${player.kills} kills.`,
    );
  }

  private async maybeReplyCustomCommand(
    session: {
      id: string;
      organizationId: string;
      channelId: string;
      videoId: string;
      liveChatId: string;
      channel: {
        id: string;
        youtubeChannelId: string;
        accessTokenEnc: string | null;
        refreshTokenEnc: string | null;
        tokenExpiresAt: Date | null;
      };
    },
    message: {
      id: string;
      authorChannelId: string | null;
      authorName: string | null;
      messageText: string | null;
      replyStatus: YoutubeReplyStatus | null;
    },
    limits: YoutubePlanLimits,
  ): Promise<'posted' | 'handled' | null> {
    if (message.replyStatus || !message.messageText) return null;
    if (message.authorChannelId === session.channel.youtubeChannelId) {
      return null;
    }
    const parsed = this.parseCustomChatCommand(message.messageText);
    if (!parsed) return null;

    const commands = await this.prisma.youtubeChatCommand.findMany({
      where: {
        organizationId: session.organizationId,
        command: parsed.command,
        enabled: true,
        deletedAt: null,
        OR: [{ channelId: null }, { channelId: session.channelId }],
      },
      orderBy: [{ channelId: 'desc' }, { updatedAt: 'desc' }],
      take: 2,
    });
    const command =
      commands.find((candidate) => candidate.channelId === session.channelId) ??
      commands[0];
    if (!command) return null;

    const replyText = this.renderLiveReplyTemplate(
      command.responseTemplate.replaceAll('{args}', parsed.args),
      message,
      { videoId: session.videoId },
    );
    if (!replyText) return 'handled';

    const now = Date.now();
    const commandOnCooldown =
      command.cooldownSeconds > 0 &&
      command.lastUsedAt &&
      command.lastUsedAt.getTime() > now - command.cooldownSeconds * 1000;
    const userCooldownCount =
      command.userCooldownSeconds > 0 && message.authorChannelId
        ? await this.prisma.youtubeChatLog.count({
            where: {
              commandId: command.id,
              authorChannelId: message.authorChannelId,
              status: 'POSTED',
              createdAt: {
                gte: new Date(now - command.userCooldownSeconds * 1000),
              },
            },
          })
        : 0;
    const orgReplyCount = await this.countLiveBotPostsLastHour(
      session.organizationId,
    );
    if (
      limits.liveRepliesPerHour <= 0 ||
      orgReplyCount >= limits.liveRepliesPerHour ||
      commandOnCooldown ||
      userCooldownCount > 0
    ) {
      await this.writeChatLog({
        organizationId: session.organizationId,
        channelId: session.channelId,
        liveSessionId: session.id,
        liveMessageId: message.id,
        commandId: command.id,
        action: 'COMMAND',
        status: 'SKIPPED',
        command: command.command,
        authorChannelId: message.authorChannelId,
        authorName: message.authorName,
        requestText: message.messageText,
        responseText: replyText,
        error: 'Command held by cooldown or rate limit',
      });
      return 'handled';
    }

    try {
      const posted = await this.postLiveChatMessage(
        session.channel,
        session.liveChatId,
        replyText,
      );
      await Promise.all([
        this.prisma.youtubeLiveChatMessage.update({
          where: { id: message.id },
          data: {
            replyStatus: YoutubeReplyStatus.POSTED,
            replyText,
            replyYoutubeMessageId: posted.id ?? null,
            replyError: null,
            repliedAt: new Date(),
          },
        }),
        this.prisma.youtubeChatCommand.update({
          where: { id: command.id },
          data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
        }),
        this.writeChatLog({
          organizationId: session.organizationId,
          channelId: session.channelId,
          liveSessionId: session.id,
          liveMessageId: message.id,
          commandId: command.id,
          action: 'COMMAND',
          status: 'POSTED',
          command: command.command,
          authorChannelId: message.authorChannelId,
          authorName: message.authorName,
          requestText: message.messageText,
          responseText: replyText,
          youtubeResponseId: posted.id ?? null,
        }),
      ]);
      return 'posted';
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message.slice(0, 1000) : 'Failed';
      await Promise.all([
        this.prisma.youtubeLiveChatMessage.update({
          where: { id: message.id },
          data: {
            replyStatus: YoutubeReplyStatus.FAILED,
            replyText,
            replyError: messageText,
          },
        }),
        this.writeChatLog({
          organizationId: session.organizationId,
          channelId: session.channelId,
          liveSessionId: session.id,
          liveMessageId: message.id,
          commandId: command.id,
          action: 'COMMAND',
          status: 'FAILED',
          command: command.command,
          authorChannelId: message.authorChannelId,
          authorName: message.authorName,
          requestText: message.messageText,
          responseText: replyText,
          error: messageText,
        }),
      ]);
      return 'handled';
    }
  }

  private async maybePostMatchUpdate(
    session: {
      id: string;
      organizationId: string;
      channelId: string;
      matchId: string | null;
      videoId: string;
      liveChatId: string;
      lastMatchUpdateKey: string | null;
      channel: {
        id: string;
        accessTokenEnc: string | null;
        refreshTokenEnc: string | null;
        tokenExpiresAt: Date | null;
      };
    },
    limits: YoutubePlanLimits,
  ) {
    if (!session.matchId || limits.liveRepliesPerHour <= 0) return 0;
    const match = await this.resolveCommandMatch(
      session.organizationId,
      session.matchId,
    );
    if (!match) return 0;

    const rows = this.resultRows(match).slice(0, 3);
    const key = [
      match.status,
      match.liveState,
      rows
        .map(
          (row) =>
            `${row.teamId}:${row.placement ?? ''}:${row.totalPoints}:${row.totalKills}`,
        )
        .join('|'),
      match.topFragger?.finalPlayerIgn ?? match.topFragger?.autoPlayerIgn ?? '',
      match.topFragger?.finalKills ?? match.topFragger?.autoKills ?? '',
    ].join(':');
    if (key === session.lastMatchUpdateKey) return 0;

    const replyText = rows.length
      ? this.truncateLiveChatReply(
          `${this.matchLabel(match)} update: ${rows
            .map(
              (row, index) =>
                `#${index + 1} ${row.teamName} ${row.totalPoints}pt/${row.totalKills}k`,
            )
            .join(', ')}. Try !result, !mvp, !top.`,
        )
      : this.truncateLiveChatReply(
          `${this.matchLabel(match)} is ${String(match.liveState).toLowerCase()}. Use !slots, !team TEAM, !predict TEAM, and !points.`,
        );
    const orgReplyCount = await this.countLiveBotPostsLastHour(
      session.organizationId,
    );
    if (orgReplyCount >= limits.liveRepliesPerHour) return 0;

    try {
      const posted = await this.postLiveChatMessage(
        session.channel,
        session.liveChatId,
        replyText,
      );
      await Promise.all([
        this.prisma.youtubeLiveChatSession.update({
          where: { id: session.id },
          data: { lastMatchUpdateKey: key },
        }),
        this.writeChatLog({
          organizationId: session.organizationId,
          channelId: session.channelId,
          liveSessionId: session.id,
          action: 'MATCH_UPDATE',
          status: 'POSTED',
          responseText: replyText,
          youtubeResponseId: posted.id ?? null,
        }),
      ]);
      return 1;
    } catch (error) {
      await this.writeChatLog({
        organizationId: session.organizationId,
        channelId: session.channelId,
        liveSessionId: session.id,
        action: 'MATCH_UPDATE',
        status: 'FAILED',
        responseText: replyText,
        error: error instanceof Error ? error.message.slice(0, 1000) : 'Failed',
      });
      return 0;
    }
  }

  private async maybePostAiHostMessage(
    session: {
      id: string;
      organizationId: string;
      channelId: string;
      matchId: string | null;
      videoId: string;
      liveChatId: string;
      nextAiHostAt: Date | null;
      channel: {
        id: string;
        accessTokenEnc: string | null;
        refreshTokenEnc: string | null;
        tokenExpiresAt: Date | null;
      };
    },
    limits: YoutubePlanLimits,
  ) {
    if (!limits.safeAutomation || limits.liveRepliesPerHour <= 0) return 0;
    const now = new Date();
    if (session.nextAiHostAt && session.nextAiHostAt > now) return 0;

    const [match, poll, challenge, leader] = await Promise.all([
      session.matchId
        ? this.resolveCommandMatch(session.organizationId, session.matchId)
        : Promise.resolve(null),
      this.prisma.youtubePoll.findFirst({
        where: {
          organizationId: session.organizationId,
          status: 'OPEN',
          deletedAt: null,
          AND: [
            { OR: [{ channelId: null }, { channelId: session.channelId }] },
            { OR: [{ liveSessionId: null }, { liveSessionId: session.id }] },
            { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
          ],
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.youtubeChallenge.findFirst({
        where: {
          organizationId: session.organizationId,
          status: 'OPEN',
          deletedAt: null,
          AND: [
            { OR: [{ channelId: null }, { channelId: session.channelId }] },
            { OR: [{ liveSessionId: null }, { liveSessionId: session.id }] },
            { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
          ],
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.youtubeViewerProfile.findFirst({
        where: { organizationId: session.organizationId },
        orderBy: [{ points: 'desc' }, { lastSeenAt: 'asc' }],
      }),
    ]);
    const rows = match ? this.resultRows(match).slice(0, 3) : [];
    const templates = [
      poll
        ? `Live poll: ${poll.title}. Vote with ${poll.keyword} 1, 2, or your option.`
        : null,
      challenge
        ? `Chat challenge is open: ${challenge.title}. Use ${challenge.keyword} for +${challenge.pointsReward} points.`
        : null,
      leader
        ? `${this.viewerDisplayName(leader)} leads chat with ${leader.points} points. Check yours with !points.`
        : null,
      rows.length
        ? `Scoreboard check: ${rows
            .map((row, index) => `#${index + 1} ${row.teamName}`)
            .join(', ')}. Use !result for details.`
        : null,
      match
        ? `${this.matchLabel(match)} is active. Predictions, points, and badges are live in chat.`
        : null,
      'New viewers earn points by chatting. Try !points, !rank, !top, and !badges.',
      'Keep the chat moving: vote in polls, join challenges, and watch for giveaway calls.',
      'Arenzyra chat rewards are live. Useful commands: !poll, !top, !predict TEAM.',
    ].filter((template): template is string => Boolean(template));
    if (templates.length === 0) return 0;

    const index = Math.floor(now.getTime() / (10 * 60_000)) % templates.length;
    const replyText = this.truncateLiveChatReply(templates[index]);
    const orgReplyCount = await this.countLiveBotPostsLastHour(
      session.organizationId,
    );
    if (orgReplyCount >= limits.liveRepliesPerHour) return 0;

    try {
      const posted = await this.postLiveChatMessage(
        session.channel,
        session.liveChatId,
        replyText,
      );
      await Promise.all([
        this.prisma.youtubeLiveChatSession.update({
          where: { id: session.id },
          data: {
            lastAiHostAt: now,
            nextAiHostAt: new Date(now.getTime() + 10 * 60_000),
          },
        }),
        this.writeChatLog({
          organizationId: session.organizationId,
          channelId: session.channelId,
          liveSessionId: session.id,
          action: 'AI_HOST',
          status: 'POSTED',
          responseText: replyText,
          youtubeResponseId: posted.id ?? null,
        }),
      ]);
      return 1;
    } catch (error) {
      await Promise.all([
        this.prisma.youtubeLiveChatSession.update({
          where: { id: session.id },
          data: { nextAiHostAt: new Date(now.getTime() + 2 * 60_000) },
        }),
        this.writeChatLog({
          organizationId: session.organizationId,
          channelId: session.channelId,
          liveSessionId: session.id,
          action: 'AI_HOST',
          status: 'FAILED',
          responseText: replyText,
          error:
            error instanceof Error ? error.message.slice(0, 1000) : 'Failed',
        }),
      ]);
      return 0;
    }
  }

  private async maybeFireLiveTimers(
    session: {
      id: string;
      organizationId: string;
      channelId: string;
      videoId: string;
      liveChatId: string;
      channel: {
        id: string;
        youtubeChannelId: string;
        accessTokenEnc: string | null;
        refreshTokenEnc: string | null;
        tokenExpiresAt: Date | null;
      };
    },
    limits: YoutubePlanLimits,
  ) {
    if (limits.liveRepliesPerHour <= 0) return 0;
    const now = new Date();
    const timers = await this.prisma.youtubeChatTimer.findMany({
      where: {
        organizationId: session.organizationId,
        enabled: true,
        deletedAt: null,
        OR: [{ nextFireAt: null }, { nextFireAt: { lte: now } }],
        AND: [
          { OR: [{ channelId: null }, { channelId: session.channelId }] },
          { OR: [{ liveSessionId: null }, { liveSessionId: session.id }] },
        ],
      },
      orderBy: [{ nextFireAt: 'asc' }, { updatedAt: 'asc' }],
      take: 5,
    });
    let postedCount = 0;
    for (const timer of timers) {
      const since = timer.lastFiredAt ?? timer.createdAt;
      if (timer.minChatLines > 0) {
        const chatLines = await this.prisma.youtubeLiveChatMessage.count({
          where: {
            liveSessionId: session.id,
            authorChannelId: { not: session.channel.youtubeChannelId },
            createdAt: { gte: since },
          },
        });
        if (chatLines < timer.minChatLines) {
          await this.prisma.youtubeChatTimer.update({
            where: { id: timer.id },
            data: { nextFireAt: new Date(Date.now() + 60_000) },
          });
          continue;
        }
      }

      const orgReplyCount = await this.countLiveBotPostsLastHour(
        session.organizationId,
      );
      if (orgReplyCount >= limits.liveRepliesPerHour) {
        await this.prisma.youtubeChatTimer.update({
          where: { id: timer.id },
          data: { nextFireAt: new Date(Date.now() + 60_000) },
        });
        continue;
      }

      const replyText = this.renderLiveReplyTemplate(
        timer.message,
        { authorName: null, messageText: null },
        { videoId: session.videoId },
      );
      if (!replyText) continue;
      try {
        const posted = await this.postLiveChatMessage(
          session.channel,
          session.liveChatId,
          replyText,
        );
        const nextFireAt = new Date(
          Date.now() + Math.max(1, timer.intervalMinutes) * 60_000,
        );
        await Promise.all([
          this.prisma.youtubeChatTimer.update({
            where: { id: timer.id },
            data: {
              postedCount: { increment: 1 },
              lastFiredAt: new Date(),
              nextFireAt,
            },
          }),
          this.writeChatLog({
            organizationId: session.organizationId,
            channelId: session.channelId,
            liveSessionId: session.id,
            timerId: timer.id,
            action: 'TIMER',
            status: 'POSTED',
            responseText: replyText,
            youtubeResponseId: posted.id ?? null,
          }),
        ]);
        postedCount += 1;
      } catch (error) {
        await this.writeChatLog({
          organizationId: session.organizationId,
          channelId: session.channelId,
          liveSessionId: session.id,
          timerId: timer.id,
          action: 'TIMER',
          status: 'FAILED',
          responseText: replyText,
          error:
            error instanceof Error ? error.message.slice(0, 1000) : 'Failed',
        });
        await this.prisma.youtubeChatTimer.update({
          where: { id: timer.id },
          data: { nextFireAt: new Date(Date.now() + 60_000) },
        });
      }
    }
    return postedCount;
  }

  private messageMatchesRule(
    rule: {
      matchMode: YoutubeAutomationMatchMode;
      keywords: string[];
      blockedWords: string[];
    },
    text: string,
  ) {
    const lower = text.toLowerCase();
    if (
      rule.blockedWords.some((blocked) =>
        lower.includes(blocked.trim().toLowerCase()),
      )
    ) {
      return false;
    }
    const keywords = rule.keywords.map((word) => word.trim()).filter(Boolean);
    if (keywords.length === 0) return false;
    if (rule.matchMode === YoutubeAutomationMatchMode.CONTAINS) {
      return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
    }
    if (rule.matchMode === YoutubeAutomationMatchMode.REGEX) {
      return keywords.some((keyword) => {
        try {
          return new RegExp(keyword, 'i').test(text);
        } catch {
          return false;
        }
      });
    }
    const words = new Set(lower.split(/[^\p{L}\p{N}_]+/u).filter(Boolean));
    return keywords.some((keyword) => words.has(keyword.toLowerCase()));
  }

  private renderLiveReplyTemplate(
    template: string,
    message: {
      authorName: string | null;
      messageText: string | null;
    },
    session: { videoId: string },
  ) {
    return template
      .replaceAll('{name}', message.authorName ?? 'viewer')
      .replaceAll('{message}', message.messageText ?? '')
      .replaceAll('{videoId}', session.videoId)
      .trim()
      .slice(0, 200);
  }

  private async maybeGreetFirstLiveMessage(
    session: {
      id: string;
      organizationId: string;
      channelId: string;
      videoId: string;
      liveChatId: string;
      greetingTemplate: string;
      channel: {
        id: string;
        youtubeChannelId: string;
        accessTokenEnc: string | null;
        refreshTokenEnc: string | null;
        tokenExpiresAt: Date | null;
      };
    },
    message: {
      id: string;
      authorChannelId: string | null;
      authorName: string | null;
      messageText: string | null;
      replyStatus: YoutubeReplyStatus | null;
    },
    limits: YoutubePlanLimits,
  ): Promise<'posted' | 'handled' | null> {
    if (message.replyStatus || !message.messageText) return null;
    if (!message.authorChannelId) return null;
    if (message.authorChannelId === session.channel.youtubeChannelId) {
      return null;
    }
    const existing = await this.prisma.youtubeLiveChatViewer.findUnique({
      where: {
        liveSessionId_authorChannelId: {
          liveSessionId: session.id,
          authorChannelId: message.authorChannelId,
        },
      },
      select: { id: true },
    });
    if (existing) return null;

    const replyText = this.renderLiveReplyTemplate(
      this.normalizeGreetingTemplate(session.greetingTemplate),
      message,
      { videoId: session.videoId },
    );
    if (!replyText) return null;

    const viewer = await this.prisma.youtubeLiveChatViewer.create({
      data: {
        organizationId: session.organizationId,
        channelId: session.channelId,
        liveSessionId: session.id,
        authorChannelId: message.authorChannelId,
        authorName: message.authorName,
        firstMessageId: message.id,
      },
    });

    if (!limits.safeAutomation || limits.liveRepliesPerHour <= 0) {
      await Promise.all([
        this.prisma.youtubeLiveChatViewer.update({
          where: { id: viewer.id },
          data: {
            greetingStatus: YoutubeReplyStatus.PENDING_APPROVAL,
            greetingText: replyText,
            greetingError: 'Held until live automation is enabled',
          },
        }),
        this.prisma.youtubeLiveChatMessage.update({
          where: { id: message.id },
          data: {
            replyStatus: YoutubeReplyStatus.PENDING_APPROVAL,
            replyText,
            replyError: 'Held until live automation is enabled',
          },
        }),
        this.writeChatLog({
          organizationId: session.organizationId,
          channelId: session.channelId,
          liveSessionId: session.id,
          liveMessageId: message.id,
          action: 'GREETING',
          status: 'HELD',
          authorChannelId: message.authorChannelId,
          authorName: message.authorName,
          requestText: message.messageText,
          responseText: replyText,
          error: 'Live automation is not enabled for this plan',
        }),
      ]);
      return 'handled';
    }

    const orgReplyCount = await this.countLiveBotPostsLastHour(
      session.organizationId,
    );
    if (orgReplyCount >= limits.liveRepliesPerHour) {
      await Promise.all([
        this.prisma.youtubeLiveChatViewer.update({
          where: { id: viewer.id },
          data: {
            greetingStatus: YoutubeReplyStatus.PENDING_APPROVAL,
            greetingText: replyText,
            greetingError: 'Held by greeting rate limit',
          },
        }),
        this.prisma.youtubeLiveChatMessage.update({
          where: { id: message.id },
          data: {
            replyStatus: YoutubeReplyStatus.PENDING_APPROVAL,
            replyText,
            replyError: 'Held by greeting rate limit',
          },
        }),
        this.writeChatLog({
          organizationId: session.organizationId,
          channelId: session.channelId,
          liveSessionId: session.id,
          liveMessageId: message.id,
          action: 'GREETING',
          status: 'SKIPPED',
          authorChannelId: message.authorChannelId,
          authorName: message.authorName,
          requestText: message.messageText,
          responseText: replyText,
          error: 'Greeting held by rate limit',
        }),
      ]);
      return 'handled';
    }

    try {
      const posted = await this.postLiveChatMessage(
        session.channel,
        session.liveChatId,
        replyText,
      );
      await Promise.all([
        this.prisma.youtubeLiveChatViewer.update({
          where: { id: viewer.id },
          data: {
            greetingStatus: YoutubeReplyStatus.POSTED,
            greetingText: replyText,
            greetingYoutubeMessageId: posted.id ?? null,
            greetingError: null,
            greetedAt: new Date(),
          },
        }),
        this.prisma.youtubeLiveChatMessage.update({
          where: { id: message.id },
          data: {
            replyStatus: YoutubeReplyStatus.POSTED,
            replyText,
            replyYoutubeMessageId: posted.id ?? null,
            replyError: null,
            repliedAt: new Date(),
          },
        }),
        this.writeChatLog({
          organizationId: session.organizationId,
          channelId: session.channelId,
          liveSessionId: session.id,
          liveMessageId: message.id,
          action: 'GREETING',
          status: 'POSTED',
          authorChannelId: message.authorChannelId,
          authorName: message.authorName,
          requestText: message.messageText,
          responseText: replyText,
          youtubeResponseId: posted.id ?? null,
        }),
      ]);
      return 'posted';
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message.slice(0, 1000) : 'Failed';
      await Promise.all([
        this.prisma.youtubeLiveChatViewer.update({
          where: { id: viewer.id },
          data: {
            greetingStatus: YoutubeReplyStatus.FAILED,
            greetingText: replyText,
            greetingError: messageText,
          },
        }),
        this.prisma.youtubeLiveChatMessage.update({
          where: { id: message.id },
          data: {
            replyStatus: YoutubeReplyStatus.FAILED,
            replyText,
            replyError: messageText,
          },
        }),
        this.writeChatLog({
          organizationId: session.organizationId,
          channelId: session.channelId,
          liveSessionId: session.id,
          liveMessageId: message.id,
          action: 'GREETING',
          status: 'FAILED',
          authorChannelId: message.authorChannelId,
          authorName: message.authorName,
          requestText: message.messageText,
          responseText: replyText,
          error: messageText,
        }),
      ]);
      return 'handled';
    }
  }

  private async maybeAutoReplyLiveMessage(
    session: {
      id: string;
      organizationId: string;
      channelId: string;
      videoId: string;
      liveChatId: string;
      channel: {
        id: string;
        youtubeChannelId: string;
        accessTokenEnc: string | null;
        refreshTokenEnc: string | null;
        tokenExpiresAt: Date | null;
      };
    },
    message: {
      id: string;
      authorChannelId: string | null;
      authorName: string | null;
      messageText: string | null;
      replyStatus: YoutubeReplyStatus | null;
    },
    limits: YoutubePlanLimits,
  ) {
    if (message.replyStatus || !message.messageText) return false;
    if (message.authorChannelId === session.channel.youtubeChannelId) {
      return false;
    }
    const rules = await this.prisma.youtubeAutomationRule.findMany({
      where: {
        organizationId: session.organizationId,
        deletedAt: null,
        enabled: true,
        OR: [{ channelId: null }, { channelId: session.channelId }],
      },
      orderBy: { updatedAt: 'desc' },
    });
    const rule = rules.find((candidate) =>
      this.messageMatchesRule(candidate, message.messageText ?? ''),
    );
    if (!rule) return false;
    const replyText = this.renderLiveReplyTemplate(
      rule.responseTemplate,
      message,
      {
        videoId: session.videoId,
      },
    );
    if (!replyText) return false;

    if (
      rule.requireApproval ||
      !limits.safeAutomation ||
      limits.liveRepliesPerHour <= 0
    ) {
      await this.prisma.youtubeLiveChatMessage.update({
        where: { id: message.id },
        data: {
          matchedRuleId: rule.id,
          replyStatus: YoutubeReplyStatus.PENDING_APPROVAL,
          replyText,
          replyError: null,
        },
      });
      return false;
    }

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const [orgReplyCount, ruleReplyCount, cooldownCount] = await Promise.all([
      this.prisma.youtubeLiveChatMessage.count({
        where: {
          organizationId: session.organizationId,
          replyStatus: YoutubeReplyStatus.POSTED,
          repliedAt: { gte: hourAgo },
        },
      }),
      this.prisma.youtubeLiveChatMessage.count({
        where: {
          organizationId: session.organizationId,
          matchedRuleId: rule.id,
          replyStatus: YoutubeReplyStatus.POSTED,
          repliedAt: { gte: hourAgo },
        },
      }),
      rule.cooldownSeconds > 0 && message.authorChannelId
        ? this.prisma.youtubeLiveChatMessage.count({
            where: {
              liveSessionId: session.id,
              authorChannelId: message.authorChannelId,
              matchedRuleId: rule.id,
              id: { not: message.id },
              repliedAt: {
                gte: new Date(Date.now() - rule.cooldownSeconds * 1000),
              },
            },
          })
        : Promise.resolve(0),
    ]);
    if (
      orgReplyCount >= limits.liveRepliesPerHour ||
      ruleReplyCount >= rule.maxRepliesPerHour ||
      cooldownCount > 0
    ) {
      await this.prisma.youtubeLiveChatMessage.update({
        where: { id: message.id },
        data: {
          matchedRuleId: rule.id,
          replyStatus: YoutubeReplyStatus.PENDING_APPROVAL,
          replyText,
          replyError: 'Held by live chat rate limit',
        },
      });
      return false;
    }

    try {
      const posted = await this.postLiveChatMessage(
        session.channel,
        session.liveChatId,
        replyText,
      );
      await this.prisma.youtubeLiveChatMessage.update({
        where: { id: message.id },
        data: {
          matchedRuleId: rule.id,
          replyStatus: YoutubeReplyStatus.POSTED,
          replyText,
          replyYoutubeMessageId: posted.id ?? null,
          replyError: null,
          repliedAt: new Date(),
        },
      });
      return true;
    } catch (error) {
      await this.prisma.youtubeLiveChatMessage.update({
        where: { id: message.id },
        data: {
          matchedRuleId: rule.id,
          replyStatus: YoutubeReplyStatus.FAILED,
          replyText,
          replyError:
            error instanceof Error ? error.message.slice(0, 1000) : 'Failed',
        },
      });
      return false;
    }
  }

  async listAutomationRules(actor: Actor | null | undefined) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    return this.prisma.youtubeAutomationRule.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: [{ enabled: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  private async assertChannelBelongsToOrg(
    organizationId: string,
    channelId: string | null | undefined,
  ) {
    if (!channelId) return null;
    const channel = await this.prisma.youtubeChannel.findFirst({
      where: { id: channelId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!channel) throw new BadRequestException('YouTube channel not found');
    return channel.id;
  }

  private async assertLiveSessionBelongsToOrg(
    organizationId: string,
    liveSessionId: string | null | undefined,
  ) {
    if (!liveSessionId) return null;
    const session = await this.prisma.youtubeLiveChatSession.findFirst({
      where: { id: liveSessionId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!session) {
      throw new BadRequestException('YouTube live session not found');
    }
    return session.id;
  }

  private async channelIdForLiveSession(liveSessionId: string) {
    const session = await this.prisma.youtubeLiveChatSession.findUnique({
      where: { id: liveSessionId },
      select: { channelId: true },
    });
    if (!session) {
      throw new BadRequestException('YouTube live session not found');
    }
    return session.channelId;
  }

  async createAutomationRule(
    actor: Actor | null | undefined,
    dto: UpsertYoutubeAutomationRuleDto,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const limits = await this.limitsForOrgId(organizationId);
    this.assertFeatureEnabled(limits);

    const responseTemplate = dto.responseTemplate?.trim();
    if (!responseTemplate) {
      throw new BadRequestException('Response template is required');
    }
    const channelId = await this.assertChannelBelongsToOrg(
      organizationId,
      dto.channelId,
    );
    const requireApproval = limits.safeAutomation
      ? (dto.requireApproval ?? true)
      : true;

    const rule = await this.prisma.youtubeAutomationRule.create({
      data: {
        organizationId,
        channelId,
        name: dto.name?.trim() || 'New YouTube Rule',
        enabled: dto.enabled ?? false,
        matchMode:
          (dto.matchMode as YoutubeAutomationMatchMode | undefined) ??
          YoutubeAutomationMatchMode.KEYWORD,
        keywords: this.normalizeStringArray(dto.keywords) ?? [],
        responseTemplate,
        requireApproval,
        cooldownSeconds: dto.cooldownSeconds ?? 300,
        maxRepliesPerHour: Math.min(
          dto.maxRepliesPerHour ?? limits.maxRepliesPerHour,
          limits.maxRepliesPerHour,
        ),
        blockedWords: this.normalizeStringArray(dto.blockedWords) ?? [],
      },
    });
    await this.audit({
      organizationId,
      channelId,
      actor,
      action: 'youtube.automation_rule.created',
      targetType: 'youtubeAutomationRule',
      targetId: rule.id,
      after: rule as Prisma.InputJsonValue,
    });
    return rule;
  }

  async updateAutomationRule(
    actor: Actor | null | undefined,
    ruleId: string,
    dto: UpsertYoutubeAutomationRuleDto,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const limits = await this.limitsForOrgId(organizationId);
    this.assertFeatureEnabled(limits);

    const current = await this.prisma.youtubeAutomationRule.findFirst({
      where: { id: ruleId, organizationId, deletedAt: null },
    });
    if (!current) throw new NotFoundException('YouTube rule not found');
    const channelId =
      dto.channelId === undefined
        ? undefined
        : await this.assertChannelBelongsToOrg(organizationId, dto.channelId);

    const updated = await this.prisma.youtubeAutomationRule.update({
      where: { id: current.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(channelId !== undefined ? { channelId } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.matchMode !== undefined
          ? { matchMode: dto.matchMode as YoutubeAutomationMatchMode }
          : {}),
        ...(dto.keywords !== undefined
          ? { keywords: this.normalizeStringArray(dto.keywords) ?? [] }
          : {}),
        ...(dto.responseTemplate !== undefined
          ? { responseTemplate: dto.responseTemplate.trim() }
          : {}),
        ...(dto.requireApproval !== undefined
          ? {
              requireApproval: limits.safeAutomation
                ? dto.requireApproval
                : true,
            }
          : {}),
        ...(dto.cooldownSeconds !== undefined
          ? { cooldownSeconds: dto.cooldownSeconds }
          : {}),
        ...(dto.maxRepliesPerHour !== undefined
          ? {
              maxRepliesPerHour: Math.min(
                dto.maxRepliesPerHour,
                limits.maxRepliesPerHour,
              ),
            }
          : {}),
        ...(dto.blockedWords !== undefined
          ? { blockedWords: this.normalizeStringArray(dto.blockedWords) ?? [] }
          : {}),
      },
    });
    await this.audit({
      organizationId,
      channelId: updated.channelId,
      actor,
      action: 'youtube.automation_rule.updated',
      targetType: 'youtubeAutomationRule',
      targetId: updated.id,
      before: current as Prisma.InputJsonValue,
      after: updated as Prisma.InputJsonValue,
    });
    return updated;
  }

  async deleteAutomationRule(actor: Actor | null | undefined, ruleId: string) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const current = await this.prisma.youtubeAutomationRule.findFirst({
      where: { id: ruleId, organizationId, deletedAt: null },
    });
    if (!current) throw new NotFoundException('YouTube rule not found');
    const updated = await this.prisma.youtubeAutomationRule.update({
      where: { id: current.id },
      data: { deletedAt: new Date(), enabled: false },
    });
    await this.audit({
      organizationId,
      channelId: current.channelId,
      actor,
      action: 'youtube.automation_rule.deleted',
      targetType: 'youtubeAutomationRule',
      targetId: current.id,
    });
    return updated;
  }

  async listChatCommands(actor: Actor | null | undefined) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    return this.prisma.youtubeChatCommand.findMany({
      where: { organizationId, deletedAt: null },
      include: {
        channel: { select: { id: true, title: true, handle: true } },
      },
      orderBy: [{ enabled: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  private async assertUniqueChatCommand(
    organizationId: string,
    channelId: string | null,
    command: string,
    ignoreId?: string,
  ) {
    const duplicate = await this.prisma.youtubeChatCommand.findFirst({
      where: {
        organizationId,
        channelId,
        command,
        deletedAt: null,
        ...(ignoreId ? { id: { not: ignoreId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException(
        `The !${command} command already exists for this scope`,
      );
    }
  }

  async createChatCommand(
    actor: Actor | null | undefined,
    dto: UpsertYoutubeChatCommandDto,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const limits = await this.limitsForOrgId(organizationId);
    this.assertLiveChatEnabled(limits);

    const command = this.normalizeChatCommandName(dto.command);
    if (!command) {
      throw new BadRequestException('Command name is required');
    }
    const responseTemplate = this.normalizeString(dto.responseTemplate);
    if (!responseTemplate) {
      throw new BadRequestException('Command reply is required');
    }
    const channelId = await this.assertChannelBelongsToOrg(
      organizationId,
      dto.channelId,
    );
    await this.assertUniqueChatCommand(organizationId, channelId, command);

    const created = await this.prisma.youtubeChatCommand.create({
      data: {
        organizationId,
        channelId,
        command,
        responseTemplate,
        enabled: dto.enabled ?? true,
        cooldownSeconds: dto.cooldownSeconds ?? 30,
        userCooldownSeconds: dto.userCooldownSeconds ?? 10,
      },
      include: {
        channel: { select: { id: true, title: true, handle: true } },
      },
    });
    await this.audit({
      organizationId,
      channelId: created.channelId,
      actor,
      action: 'youtube.chat_command.created',
      targetType: 'youtubeChatCommand',
      targetId: created.id,
      after: created as Prisma.InputJsonValue,
    });
    return created;
  }

  async updateChatCommand(
    actor: Actor | null | undefined,
    commandId: string,
    dto: UpsertYoutubeChatCommandDto,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const limits = await this.limitsForOrgId(organizationId);
    this.assertLiveChatEnabled(limits);

    const current = await this.prisma.youtubeChatCommand.findFirst({
      where: { id: commandId, organizationId, deletedAt: null },
    });
    if (!current) throw new NotFoundException('YouTube command not found');

    const channelId =
      dto.channelId === undefined
        ? current.channelId
        : await this.assertChannelBelongsToOrg(organizationId, dto.channelId);
    const command =
      dto.command === undefined
        ? current.command
        : this.normalizeChatCommandName(dto.command);
    if (!command) {
      throw new BadRequestException('Command name is required');
    }
    const responseTemplate =
      dto.responseTemplate === undefined
        ? current.responseTemplate
        : this.normalizeString(dto.responseTemplate);
    if (!responseTemplate) {
      throw new BadRequestException('Command reply is required');
    }
    if (channelId !== current.channelId || command !== current.command) {
      await this.assertUniqueChatCommand(
        organizationId,
        channelId,
        command,
        current.id,
      );
    }

    const updated = await this.prisma.youtubeChatCommand.update({
      where: { id: current.id },
      data: {
        channelId,
        command,
        responseTemplate,
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.cooldownSeconds !== undefined
          ? { cooldownSeconds: dto.cooldownSeconds }
          : {}),
        ...(dto.userCooldownSeconds !== undefined
          ? { userCooldownSeconds: dto.userCooldownSeconds }
          : {}),
      },
      include: {
        channel: { select: { id: true, title: true, handle: true } },
      },
    });
    await this.audit({
      organizationId,
      channelId: updated.channelId,
      actor,
      action: 'youtube.chat_command.updated',
      targetType: 'youtubeChatCommand',
      targetId: updated.id,
      before: current as Prisma.InputJsonValue,
      after: updated as Prisma.InputJsonValue,
    });
    return updated;
  }

  async deleteChatCommand(actor: Actor | null | undefined, commandId: string) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const current = await this.prisma.youtubeChatCommand.findFirst({
      where: { id: commandId, organizationId, deletedAt: null },
    });
    if (!current) throw new NotFoundException('YouTube command not found');
    const updated = await this.prisma.youtubeChatCommand.update({
      where: { id: current.id },
      data: { deletedAt: new Date(), enabled: false },
    });
    await this.audit({
      organizationId,
      channelId: current.channelId,
      actor,
      action: 'youtube.chat_command.deleted',
      targetType: 'youtubeChatCommand',
      targetId: current.id,
    });
    return updated;
  }

  async listChatTimers(actor: Actor | null | undefined) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    return this.prisma.youtubeChatTimer.findMany({
      where: { organizationId, deletedAt: null },
      include: {
        channel: { select: { id: true, title: true, handle: true } },
        liveSession: {
          select: { id: true, title: true, videoId: true, status: true },
        },
      },
      orderBy: [{ enabled: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  private nextTimerFire(intervalMinutes: number) {
    return new Date(Date.now() + Math.max(1, intervalMinutes) * 60_000);
  }

  async createChatTimer(
    actor: Actor | null | undefined,
    dto: UpsertYoutubeChatTimerDto,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const limits = await this.limitsForOrgId(organizationId);
    this.assertLiveChatEnabled(limits);

    const name = this.normalizeString(dto.name);
    if (!name) {
      throw new BadRequestException('Timer name is required');
    }
    const message = this.normalizeString(dto.message);
    if (!message) {
      throw new BadRequestException('Timer message is required');
    }
    const liveSessionId = await this.assertLiveSessionBelongsToOrg(
      organizationId,
      dto.liveSessionId,
    );
    const channelId = liveSessionId
      ? await this.channelIdForLiveSession(liveSessionId)
      : await this.assertChannelBelongsToOrg(organizationId, dto.channelId);
    const intervalMinutes = dto.intervalMinutes ?? 15;

    const created = await this.prisma.youtubeChatTimer.create({
      data: {
        organizationId,
        channelId,
        liveSessionId,
        name,
        message,
        enabled: dto.enabled ?? true,
        intervalMinutes,
        minChatLines: dto.minChatLines ?? 5,
        nextFireAt:
          (dto.enabled ?? true) ? this.nextTimerFire(intervalMinutes) : null,
      },
      include: {
        channel: { select: { id: true, title: true, handle: true } },
        liveSession: {
          select: { id: true, title: true, videoId: true, status: true },
        },
      },
    });
    await this.audit({
      organizationId,
      channelId: created.channelId,
      actor,
      action: 'youtube.chat_timer.created',
      targetType: 'youtubeChatTimer',
      targetId: created.id,
      after: created as Prisma.InputJsonValue,
    });
    return created;
  }

  async updateChatTimer(
    actor: Actor | null | undefined,
    timerId: string,
    dto: UpsertYoutubeChatTimerDto,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const limits = await this.limitsForOrgId(organizationId);
    this.assertLiveChatEnabled(limits);

    const current = await this.prisma.youtubeChatTimer.findFirst({
      where: { id: timerId, organizationId, deletedAt: null },
    });
    if (!current) throw new NotFoundException('YouTube timer not found');

    const liveSessionId =
      dto.liveSessionId === undefined
        ? current.liveSessionId
        : await this.assertLiveSessionBelongsToOrg(
            organizationId,
            dto.liveSessionId,
          );
    const channelId = liveSessionId
      ? await this.channelIdForLiveSession(liveSessionId)
      : dto.channelId === undefined
        ? current.channelId
        : await this.assertChannelBelongsToOrg(organizationId, dto.channelId);
    const name =
      dto.name === undefined ? current.name : this.normalizeString(dto.name);
    if (!name) {
      throw new BadRequestException('Timer name is required');
    }
    const message =
      dto.message === undefined
        ? current.message
        : this.normalizeString(dto.message);
    if (!message) {
      throw new BadRequestException('Timer message is required');
    }
    const intervalMinutes =
      dto.intervalMinutes === undefined
        ? current.intervalMinutes
        : dto.intervalMinutes;
    const enabled = dto.enabled === undefined ? current.enabled : dto.enabled;

    const shouldResetSchedule =
      dto.enabled === true ||
      dto.intervalMinutes !== undefined ||
      dto.liveSessionId !== undefined ||
      dto.channelId !== undefined;
    const updated = await this.prisma.youtubeChatTimer.update({
      where: { id: current.id },
      data: {
        channelId,
        liveSessionId,
        name,
        message,
        enabled,
        intervalMinutes,
        ...(dto.minChatLines !== undefined
          ? { minChatLines: dto.minChatLines }
          : {}),
        ...(enabled
          ? {
              nextFireAt: shouldResetSchedule
                ? this.nextTimerFire(intervalMinutes)
                : current.nextFireAt,
            }
          : { nextFireAt: null }),
      },
      include: {
        channel: { select: { id: true, title: true, handle: true } },
        liveSession: {
          select: { id: true, title: true, videoId: true, status: true },
        },
      },
    });
    await this.audit({
      organizationId,
      channelId: updated.channelId,
      actor,
      action: 'youtube.chat_timer.updated',
      targetType: 'youtubeChatTimer',
      targetId: updated.id,
      before: current as Prisma.InputJsonValue,
      after: updated as Prisma.InputJsonValue,
    });
    return updated;
  }

  async deleteChatTimer(actor: Actor | null | undefined, timerId: string) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const current = await this.prisma.youtubeChatTimer.findFirst({
      where: { id: timerId, organizationId, deletedAt: null },
    });
    if (!current) throw new NotFoundException('YouTube timer not found');
    const updated = await this.prisma.youtubeChatTimer.update({
      where: { id: current.id },
      data: { deletedAt: new Date(), enabled: false, nextFireAt: null },
    });
    await this.audit({
      organizationId,
      channelId: current.channelId,
      actor,
      action: 'youtube.chat_timer.deleted',
      targetType: 'youtubeChatTimer',
      targetId: current.id,
    });
    return updated;
  }

  async listChatLogs(actor: Actor | null | undefined) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    return this.prisma.youtubeChatLog.findMany({
      where: { organizationId },
      include: {
        channel: { select: { id: true, title: true, handle: true } },
        liveSession: {
          select: { id: true, title: true, videoId: true, status: true },
        },
        chatCommand: { select: { id: true, command: true } },
        chatTimer: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async listViewerProfiles(actor: Actor | null | undefined) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    return this.prisma.youtubeViewerProfile.findMany({
      where: { organizationId },
      include: {
        channel: { select: { id: true, title: true, handle: true } },
      },
      orderBy: [{ points: 'desc' }, { lastSeenAt: 'desc' }],
      take: 100,
    });
  }

  private normalizePollOptions(options: string[] | null | undefined) {
    const normalized = Array.from(
      new Set(
        (options ?? [])
          .map((option) => this.normalizeString(option))
          .filter((option): option is string => Boolean(option)),
      ),
    ).slice(0, 8);
    if (normalized.length < 2) {
      throw new BadRequestException('Poll needs at least two options');
    }
    return normalized;
  }

  private normalizeEngagementKeyword(
    value: string | null | undefined,
    fallback: string,
  ) {
    const keyword = this.normalizeString(value) ?? fallback;
    const normalized =
      keyword.startsWith('!') || keyword.startsWith('%')
        ? keyword
        : `!${keyword}`;
    return normalized.slice(0, 40);
  }

  private normalizeEngagementStatus(value: string | null | undefined) {
    return value === 'CLOSED' ? 'CLOSED' : 'OPEN';
  }

  async listPolls(actor: Actor | null | undefined) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const polls = await this.prisma.youtubePoll.findMany({
      where: { organizationId, deletedAt: null },
      include: {
        channel: { select: { id: true, title: true, handle: true } },
        liveSession: {
          select: { id: true, title: true, videoId: true, status: true },
        },
        _count: { select: { votes: true } },
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: 50,
    });
    if (polls.length === 0) return [];
    const counts = await this.prisma.youtubePollVote.groupBy({
      by: ['pollId', 'option'],
      where: {
        organizationId,
        pollId: { in: polls.map((poll) => poll.id) },
      },
      _count: { _all: true },
    });
    return polls.map((poll) => ({
      ...poll,
      voteCounts: counts
        .filter((count) => count.pollId === poll.id)
        .map((count) => ({
          option: count.option,
          count: count._count._all,
        })),
    }));
  }

  async createPoll(actor: Actor | null | undefined, dto: UpsertYoutubePollDto) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const limits = await this.limitsForOrgId(organizationId);
    this.assertLiveChatEnabled(limits);

    const title = this.normalizeString(dto.title);
    if (!title) throw new BadRequestException('Poll title is required');
    const liveSessionId = await this.assertLiveSessionBelongsToOrg(
      organizationId,
      dto.liveSessionId,
    );
    const channelId = liveSessionId
      ? await this.channelIdForLiveSession(liveSessionId)
      : await this.assertChannelBelongsToOrg(organizationId, dto.channelId);
    const status = this.normalizeEngagementStatus(dto.status);
    const poll = await this.prisma.youtubePoll.create({
      data: {
        organizationId,
        channelId,
        liveSessionId,
        title,
        options: this.normalizePollOptions(dto.options),
        keyword: this.normalizeEngagementKeyword(dto.keyword, '!vote'),
        status,
        pointsReward: dto.pointsReward ?? 3,
        closedAt: status === 'CLOSED' ? new Date() : null,
      },
      include: {
        channel: { select: { id: true, title: true, handle: true } },
        liveSession: {
          select: { id: true, title: true, videoId: true, status: true },
        },
        _count: { select: { votes: true } },
      },
    });
    await this.audit({
      organizationId,
      channelId: poll.channelId,
      actor,
      action: 'youtube.poll.created',
      targetType: 'youtubePoll',
      targetId: poll.id,
      after: {
        title: poll.title,
        keyword: poll.keyword,
        options: poll.options,
        status: poll.status,
      } as Prisma.InputJsonValue,
    });
    return { ...poll, voteCounts: [] };
  }

  async updatePoll(
    actor: Actor | null | undefined,
    pollId: string,
    dto: UpsertYoutubePollDto,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const limits = await this.limitsForOrgId(organizationId);
    this.assertLiveChatEnabled(limits);
    const current = await this.prisma.youtubePoll.findFirst({
      where: { id: pollId, organizationId, deletedAt: null },
    });
    if (!current) throw new NotFoundException('YouTube poll not found');

    const liveSessionId =
      dto.liveSessionId === undefined
        ? current.liveSessionId
        : await this.assertLiveSessionBelongsToOrg(
            organizationId,
            dto.liveSessionId,
          );
    const channelId = liveSessionId
      ? await this.channelIdForLiveSession(liveSessionId)
      : dto.channelId === undefined
        ? current.channelId
        : await this.assertChannelBelongsToOrg(organizationId, dto.channelId);
    const title =
      dto.title === undefined ? current.title : this.normalizeString(dto.title);
    if (!title) throw new BadRequestException('Poll title is required');
    const status =
      dto.status === undefined
        ? current.status
        : this.normalizeEngagementStatus(dto.status);
    const updated = await this.prisma.youtubePoll.update({
      where: { id: current.id },
      data: {
        channelId,
        liveSessionId,
        title,
        ...(dto.options !== undefined
          ? { options: this.normalizePollOptions(dto.options) }
          : {}),
        ...(dto.keyword !== undefined
          ? {
              keyword: this.normalizeEngagementKeyword(dto.keyword, '!vote'),
            }
          : {}),
        ...(dto.pointsReward !== undefined
          ? { pointsReward: dto.pointsReward }
          : {}),
        ...(dto.status !== undefined
          ? {
              status,
              closedAt:
                status === 'CLOSED' ? (current.closedAt ?? new Date()) : null,
            }
          : {}),
      },
      include: {
        channel: { select: { id: true, title: true, handle: true } },
        liveSession: {
          select: { id: true, title: true, videoId: true, status: true },
        },
        _count: { select: { votes: true } },
      },
    });
    await this.audit({
      organizationId,
      channelId: updated.channelId,
      actor,
      action: 'youtube.poll.updated',
      targetType: 'youtubePoll',
      targetId: updated.id,
      before: {
        title: current.title,
        keyword: current.keyword,
        status: current.status,
      } as Prisma.InputJsonValue,
      after: {
        title: updated.title,
        keyword: updated.keyword,
        status: updated.status,
      } as Prisma.InputJsonValue,
    });
    return { ...updated, voteCounts: [] };
  }

  async deletePoll(actor: Actor | null | undefined, pollId: string) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const current = await this.prisma.youtubePoll.findFirst({
      where: { id: pollId, organizationId, deletedAt: null },
    });
    if (!current) throw new NotFoundException('YouTube poll not found');
    const updated = await this.prisma.youtubePoll.update({
      where: { id: current.id },
      data: {
        status: 'CLOSED',
        closedAt: current.closedAt ?? new Date(),
        deletedAt: new Date(),
      },
    });
    await this.audit({
      organizationId,
      channelId: current.channelId,
      actor,
      action: 'youtube.poll.deleted',
      targetType: 'youtubePoll',
      targetId: current.id,
    });
    return updated;
  }

  async listChallenges(actor: Actor | null | undefined) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    return this.prisma.youtubeChallenge.findMany({
      where: { organizationId, deletedAt: null },
      include: {
        channel: { select: { id: true, title: true, handle: true } },
        liveSession: {
          select: { id: true, title: true, videoId: true, status: true },
        },
        _count: { select: { entries: true } },
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: 50,
    });
  }

  async createChallenge(
    actor: Actor | null | undefined,
    dto: UpsertYoutubeChallengeDto,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const limits = await this.limitsForOrgId(organizationId);
    this.assertLiveChatEnabled(limits);

    const title = this.normalizeString(dto.title);
    if (!title) throw new BadRequestException('Challenge title is required');
    const keyword = this.normalizeEngagementKeyword(dto.keyword, '!challenge');
    const liveSessionId = await this.assertLiveSessionBelongsToOrg(
      organizationId,
      dto.liveSessionId,
    );
    const channelId = liveSessionId
      ? await this.channelIdForLiveSession(liveSessionId)
      : await this.assertChannelBelongsToOrg(organizationId, dto.channelId);
    const status = this.normalizeEngagementStatus(dto.status);
    const challenge = await this.prisma.youtubeChallenge.create({
      data: {
        organizationId,
        channelId,
        liveSessionId,
        title,
        keyword,
        pointsReward: dto.pointsReward ?? 25,
        maxCompletions: dto.maxCompletions ?? null,
        status,
        closedAt: status === 'CLOSED' ? new Date() : null,
      },
      include: {
        channel: { select: { id: true, title: true, handle: true } },
        liveSession: {
          select: { id: true, title: true, videoId: true, status: true },
        },
        _count: { select: { entries: true } },
      },
    });
    await this.audit({
      organizationId,
      channelId: challenge.channelId,
      actor,
      action: 'youtube.challenge.created',
      targetType: 'youtubeChallenge',
      targetId: challenge.id,
      after: {
        title: challenge.title,
        keyword: challenge.keyword,
        status: challenge.status,
      } as Prisma.InputJsonValue,
    });
    return challenge;
  }

  async updateChallenge(
    actor: Actor | null | undefined,
    challengeId: string,
    dto: UpsertYoutubeChallengeDto,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const limits = await this.limitsForOrgId(organizationId);
    this.assertLiveChatEnabled(limits);
    const current = await this.prisma.youtubeChallenge.findFirst({
      where: { id: challengeId, organizationId, deletedAt: null },
    });
    if (!current) throw new NotFoundException('YouTube challenge not found');

    const liveSessionId =
      dto.liveSessionId === undefined
        ? current.liveSessionId
        : await this.assertLiveSessionBelongsToOrg(
            organizationId,
            dto.liveSessionId,
          );
    const channelId = liveSessionId
      ? await this.channelIdForLiveSession(liveSessionId)
      : dto.channelId === undefined
        ? current.channelId
        : await this.assertChannelBelongsToOrg(organizationId, dto.channelId);
    const title =
      dto.title === undefined ? current.title : this.normalizeString(dto.title);
    if (!title) throw new BadRequestException('Challenge title is required');
    const keyword =
      dto.keyword === undefined
        ? current.keyword
        : this.normalizeEngagementKeyword(dto.keyword, '!challenge');
    const status =
      dto.status === undefined
        ? current.status
        : this.normalizeEngagementStatus(dto.status);
    const updated = await this.prisma.youtubeChallenge.update({
      where: { id: current.id },
      data: {
        channelId,
        liveSessionId,
        title,
        keyword,
        ...(dto.pointsReward !== undefined
          ? { pointsReward: dto.pointsReward }
          : {}),
        ...(dto.maxCompletions !== undefined
          ? { maxCompletions: dto.maxCompletions }
          : {}),
        ...(dto.status !== undefined
          ? {
              status,
              closedAt:
                status === 'CLOSED' ? (current.closedAt ?? new Date()) : null,
            }
          : {}),
      },
      include: {
        channel: { select: { id: true, title: true, handle: true } },
        liveSession: {
          select: { id: true, title: true, videoId: true, status: true },
        },
        _count: { select: { entries: true } },
      },
    });
    await this.audit({
      organizationId,
      channelId: updated.channelId,
      actor,
      action: 'youtube.challenge.updated',
      targetType: 'youtubeChallenge',
      targetId: updated.id,
      before: {
        title: current.title,
        keyword: current.keyword,
        status: current.status,
      } as Prisma.InputJsonValue,
      after: {
        title: updated.title,
        keyword: updated.keyword,
        status: updated.status,
      } as Prisma.InputJsonValue,
    });
    return updated;
  }

  async deleteChallenge(actor: Actor | null | undefined, challengeId: string) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const current = await this.prisma.youtubeChallenge.findFirst({
      where: { id: challengeId, organizationId, deletedAt: null },
    });
    if (!current) throw new NotFoundException('YouTube challenge not found');
    const updated = await this.prisma.youtubeChallenge.update({
      where: { id: current.id },
      data: {
        status: 'CLOSED',
        closedAt: current.closedAt ?? new Date(),
        deletedAt: new Date(),
      },
    });
    await this.audit({
      organizationId,
      channelId: current.channelId,
      actor,
      action: 'youtube.challenge.deleted',
      targetType: 'youtubeChallenge',
      targetId: current.id,
    });
    return updated;
  }

  async listGiveaways(actor: Actor | null | undefined) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    return this.prisma.youtubeGiveaway.findMany({
      where: { organizationId, deletedAt: null },
      include: {
        _count: { select: { entries: true, winners: true } },
        winners: {
          include: { entry: true },
          orderBy: { position: 'asc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async createGiveaway(
    actor: Actor | null | undefined,
    dto: CreateYoutubeGiveawayDto,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const limits = await this.limitsForOrgId(organizationId);
    this.assertFeatureEnabled(limits);

    const activeCount = await this.prisma.youtubeGiveaway.count({
      where: {
        organizationId,
        deletedAt: null,
        status: {
          in: [YoutubeGiveawayStatus.DRAFT, YoutubeGiveawayStatus.OPEN],
        },
      },
    });
    if (activeCount >= limits.activeGiveawayLimit) {
      throw new ForbiddenException(
        `Active YouTube giveaway limit reached (${activeCount}/${limits.activeGiveawayLimit})`,
      );
    }

    const channelId = await this.assertChannelBelongsToOrg(
      organizationId,
      dto.channelId,
    );
    const liveSessionId = await this.assertLiveSessionBelongsToOrg(
      organizationId,
      dto.liveSessionId,
    );
    const liveSessionMatchId = liveSessionId
      ? await this.matchIdForLiveSession(liveSessionId)
      : null;
    const matchId =
      (await this.assertMatchBelongsToOrg(organizationId, dto.matchId)) ??
      liveSessionMatchId;
    const mode = (dto.mode ?? 'KEYWORD') as YoutubeGiveawayMode;
    if (mode === YoutubeGiveawayMode.PREDICTION && !matchId) {
      throw new BadRequestException(
        'Prediction giveaways must be linked to a match',
      );
    }
    const predictionCorrectTeamId =
      await this.assertPredictionTeamBelongsToMatch(
        organizationId,
        matchId,
        dto.predictionCorrectTeamId,
      );
    const giveaway = await this.prisma.youtubeGiveaway.create({
      data: {
        organizationId,
        channelId: liveSessionId
          ? await this.channelIdForLiveSession(liveSessionId)
          : channelId,
        matchId,
        liveSessionId,
        title: dto.title.trim(),
        videoId: this.normalizeString(dto.videoId) ?? null,
        keyword: this.normalizeString(dto.keyword) ?? null,
        mode,
        predictionQuestion:
          this.normalizeString(dto.predictionQuestion) ?? null,
        predictionCorrectTeamId,
        predictionBoostMultiplier: Math.max(
          1,
          Math.min(20, dto.predictionBoostMultiplier ?? 3),
        ),
        status: liveSessionId
          ? YoutubeGiveawayStatus.OPEN
          : YoutubeGiveawayStatus.DRAFT,
        maxWinners: dto.maxWinners ?? 1,
        startsAt: this.parseDate(dto.startsAt) ?? null,
        endsAt: this.parseDate(dto.endsAt) ?? null,
        createdById: actor?.id ?? null,
      },
    });
    await this.audit({
      organizationId,
      channelId,
      actor,
      action: 'youtube.giveaway.created',
      targetType: 'youtubeGiveaway',
      targetId: giveaway.id,
      after: giveaway as Prisma.InputJsonValue,
    });
    return giveaway;
  }

  async updateGiveaway(
    actor: Actor | null | undefined,
    giveawayId: string,
    dto: UpdateYoutubeGiveawayDto,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const current = await this.prisma.youtubeGiveaway.findFirst({
      where: { id: giveawayId, organizationId, deletedAt: null },
    });
    if (!current) throw new NotFoundException('YouTube giveaway not found');
    const channelId =
      dto.channelId === undefined
        ? undefined
        : await this.assertChannelBelongsToOrg(organizationId, dto.channelId);
    const liveSessionId =
      dto.liveSessionId === undefined
        ? undefined
        : await this.assertLiveSessionBelongsToOrg(
            organizationId,
            dto.liveSessionId,
          );
    const matchId =
      dto.matchId === undefined
        ? undefined
        : await this.assertMatchBelongsToOrg(organizationId, dto.matchId);
    const nextMatchId =
      matchId !== undefined
        ? matchId
        : liveSessionId
          ? await this.matchIdForLiveSession(liveSessionId)
          : current.matchId;
    const nextMode =
      dto.mode !== undefined ? (dto.mode as YoutubeGiveawayMode) : current.mode;
    if (nextMode === YoutubeGiveawayMode.PREDICTION && !nextMatchId) {
      throw new BadRequestException(
        'Prediction giveaways must be linked to a match',
      );
    }
    const predictionCorrectTeamId =
      dto.predictionCorrectTeamId === undefined
        ? undefined
        : await this.assertPredictionTeamBelongsToMatch(
            organizationId,
            nextMatchId,
            dto.predictionCorrectTeamId,
          );
    const updated = await this.prisma.youtubeGiveaway.update({
      where: { id: current.id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.mode !== undefined ? { mode: nextMode } : {}),
        ...(channelId !== undefined ? { channelId } : {}),
        ...(matchId !== undefined ? { matchId } : {}),
        ...(liveSessionId !== undefined
          ? {
              liveSessionId,
              ...(liveSessionId
                ? {
                    channelId:
                      await this.channelIdForLiveSession(liveSessionId),
                    matchId: await this.matchIdForLiveSession(liveSessionId),
                  }
                : {}),
            }
          : {}),
        ...(dto.videoId !== undefined
          ? { videoId: this.normalizeString(dto.videoId) ?? null }
          : {}),
        ...(dto.keyword !== undefined
          ? { keyword: this.normalizeString(dto.keyword) ?? null }
          : {}),
        ...(dto.predictionQuestion !== undefined
          ? {
              predictionQuestion:
                this.normalizeString(dto.predictionQuestion) ?? null,
            }
          : {}),
        ...(predictionCorrectTeamId !== undefined
          ? { predictionCorrectTeamId }
          : {}),
        ...(dto.predictionBoostMultiplier !== undefined
          ? {
              predictionBoostMultiplier: Math.max(
                1,
                Math.min(20, dto.predictionBoostMultiplier),
              ),
            }
          : {}),
        ...(dto.maxWinners !== undefined ? { maxWinners: dto.maxWinners } : {}),
        ...(dto.startsAt !== undefined
          ? { startsAt: this.parseDate(dto.startsAt) ?? null }
          : {}),
        ...(dto.endsAt !== undefined
          ? { endsAt: this.parseDate(dto.endsAt) ?? null }
          : {}),
        ...(dto.status !== undefined
          ? { status: dto.status as YoutubeGiveawayStatus }
          : {}),
      },
    });
    await this.audit({
      organizationId,
      channelId: updated.channelId,
      actor,
      action: 'youtube.giveaway.updated',
      targetType: 'youtubeGiveaway',
      targetId: updated.id,
      before: current as Prisma.InputJsonValue,
      after: updated as Prisma.InputJsonValue,
    });
    if (
      updated.mode === YoutubeGiveawayMode.PREDICTION &&
      updated.predictionCorrectTeamId
    ) {
      await this.refreshPredictionEntryWeights(updated.id);
    }
    return updated;
  }

  async collectGiveawayEntries(
    actor: Actor | null | undefined,
    giveawayId: string,
    dto: CollectYoutubeGiveawayEntriesDto,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const giveaway = await this.prisma.youtubeGiveaway.findFirst({
      where: { id: giveawayId, organizationId, deletedAt: null },
    });
    if (!giveaway) throw new NotFoundException('YouTube giveaway not found');
    const requestedLiveSessionId =
      this.normalizeString(dto.liveSessionId) ?? giveaway.liveSessionId;
    if (requestedLiveSessionId) {
      await this.assertLiveSessionBelongsToOrg(
        organizationId,
        requestedLiveSessionId,
      );
      const messages = await this.prisma.youtubeLiveChatMessage.findMany({
        where: {
          organizationId,
          liveSessionId: requestedLiveSessionId,
        },
        orderBy: [{ publishedAt: 'asc' }, { createdAt: 'asc' }],
        take: 5000,
      });
      let collected = 0;
      for (const message of messages) {
        collected += await this.collectLiveGiveawayEntry(giveaway, message);
      }
      await this.audit({
        organizationId,
        channelId: giveaway.channelId,
        actor,
        action: 'youtube.giveaway.live_entries_collected',
        targetType: 'youtubeGiveaway',
        targetId: giveaway.id,
        after: { collected, liveSessionId: requestedLiveSessionId },
      });
      return { collected };
    }
    const videoId = this.normalizeString(dto.videoId) ?? giveaway.videoId;
    const keyword = this.normalizeString(giveaway.keyword)?.toLowerCase();
    const comments = await this.prisma.youtubeComment.findMany({
      where: {
        organizationId,
        ...(giveaway.channelId ? { channelId: giveaway.channelId } : {}),
        ...(videoId ? { videoId } : {}),
      },
      orderBy: [{ publishedAt: 'asc' }, { createdAt: 'asc' }],
      take: 1000,
    });

    let collected = 0;
    for (const comment of comments) {
      const text = comment.textOriginal ?? comment.textDisplay ?? '';
      if (keyword && !text.toLowerCase().includes(keyword)) continue;
      const authorChannelId =
        comment.authorChannelId ?? `comment:${comment.youtubeCommentId}`;
      try {
        await this.prisma.youtubeGiveawayEntry.upsert({
          where: {
            giveawayId_authorChannelId: {
              giveawayId: giveaway.id,
              authorChannelId,
            },
          },
          create: {
            organizationId,
            giveawayId: giveaway.id,
            commentId: comment.id,
            youtubeCommentId: comment.youtubeCommentId,
            authorChannelId,
            authorName: comment.authorName,
            commentText: text,
            eligible: true,
          },
          update: {
            commentId: comment.id,
            youtubeCommentId: comment.youtubeCommentId,
            authorName: comment.authorName,
            commentText: text,
          },
        });
        collected += 1;
      } catch (error) {
        const candidate = error as { code?: unknown };
        if (candidate.code !== 'P2002') throw error;
      }
    }
    await this.audit({
      organizationId,
      channelId: giveaway.channelId,
      actor,
      action: 'youtube.giveaway.entries_collected',
      targetType: 'youtubeGiveaway',
      targetId: giveaway.id,
      after: { collected },
    });
    return { collected };
  }

  async drawGiveawayWinners(
    actor: Actor | null | undefined,
    giveawayId: string,
    dto: DrawYoutubeGiveawayDto,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const giveaway = await this.prisma.youtubeGiveaway.findFirst({
      where: { id: giveawayId, organizationId, deletedAt: null },
      include: {
        winners: true,
        entries: { where: { eligible: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!giveaway) throw new NotFoundException('YouTube giveaway not found');

    const existingEntryIds = new Set(
      giveaway.winners.map((winner) => winner.entryId),
    );
    const pool = giveaway.entries.filter(
      (entry) => !existingEntryIds.has(entry.id),
    );
    const weightedPool =
      giveaway.mode === YoutubeGiveawayMode.PREDICTION
        ? pool.flatMap((entry) =>
            Array.from(
              {
                length: Math.max(1, Math.min(20, entry.entryWeight ?? 1)),
              },
              () => entry,
            ),
          )
        : pool;
    const remainingSlots = Math.max(
      0,
      giveaway.maxWinners - giveaway.winners.length,
    );
    const winnerCount = Math.min(
      dto.winnerCount ?? remainingSlots,
      remainingSlots,
    );
    if (winnerCount <= 0) {
      throw new BadRequestException('No winner slots remain');
    }
    if (pool.length < winnerCount) {
      throw new BadRequestException('Not enough eligible entries');
    }

    const currentMaxPosition = giveaway.winners.reduce(
      (max, winner) => Math.max(max, winner.position),
      0,
    );
    const selected = [...weightedPool];
    const created: Array<{ id: string }> = [];
    for (let index = 0; index < winnerCount; index += 1) {
      const selectedIndex = randomInt(selected.length);
      const entry = selected.splice(selectedIndex, 1)[0];
      for (let cursor = selected.length - 1; cursor >= 0; cursor -= 1) {
        if (selected[cursor].id === entry.id) selected.splice(cursor, 1);
      }
      created.push(
        await this.prisma.youtubeGiveawayWinner.create({
          data: {
            organizationId,
            giveawayId: giveaway.id,
            entryId: entry.id,
            position: currentMaxPosition + index + 1,
            pickedById: actor?.id ?? null,
          },
          include: { entry: true },
        }),
      );
    }
    await this.prisma.youtubeGiveaway.update({
      where: { id: giveaway.id },
      data: { status: YoutubeGiveawayStatus.DRAWN },
    });
    await this.audit({
      organizationId,
      channelId: giveaway.channelId,
      actor,
      action: 'youtube.giveaway.winners_drawn',
      targetType: 'youtubeGiveaway',
      targetId: giveaway.id,
      after: { winners: created.map((winner) => winner.id) },
    });
    return created;
  }

  async exportGiveaway(actor: Actor | null | undefined, giveawayId: string) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const giveaway = await this.prisma.youtubeGiveaway.findFirst({
      where: { id: giveawayId, organizationId, deletedAt: null },
      include: {
        entries: { orderBy: { createdAt: 'asc' } },
        winners: { include: { entry: true }, orderBy: { position: 'asc' } },
      },
    });
    if (!giveaway) throw new NotFoundException('YouTube giveaway not found');
    return giveaway;
  }

  async listSuperSettings(actor: Actor | null | undefined) {
    this.assertSuperAdmin(actor);
    const organizations = await this.prisma.organization.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        enabledAddOns: true,
        _count: {
          select: {
            youtubeChannels: true,
            youtubeGiveaways: true,
            youtubeLiveSessions: true,
          },
        },
      },
    });
    return organizations.map((organization) => ({
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        status: organization.status,
      },
      limits: this.youtubePlanForOrganization(organization),
      counts: {
        channels: organization._count.youtubeChannels,
        giveaways: organization._count.youtubeGiveaways,
        liveSessions: organization._count.youtubeLiveSessions,
      },
    }));
  }

  async updateSuperSettings(
    actor: Actor | null | undefined,
    organizationId: string,
    dto: UpdateYoutubePlanDto,
  ) {
    this.assertSuperAdmin(actor);
    const organization = await this.requireOrganization(organizationId);
    const withoutYoutube = organization.enabledAddOns.filter(
      (addon) =>
        !YOUTUBE_PLAN_ADDONS.includes(
          addon as (typeof YOUTUBE_PLAN_ADDONS)[number],
        ),
    );
    const enabledAddOns =
      dto.plan === 'off'
        ? withoutYoutube
        : [...withoutYoutube, `youtube.${dto.plan}`];
    const updated = await this.prisma.organization.update({
      where: { id: organization.id },
      data: { enabledAddOns },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        enabledAddOns: true,
        _count: {
          select: {
            youtubeChannels: true,
            youtubeGiveaways: true,
            youtubeLiveSessions: true,
          },
        },
      },
    });
    await this.audit({
      organizationId: organization.id,
      actor,
      action: 'youtube.plan.updated',
      targetType: 'organization',
      targetId: organization.id,
      before: { enabledAddOns: organization.enabledAddOns },
      after: { enabledAddOns },
    });
    return {
      organization: {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        status: updated.status,
      },
      limits: this.youtubePlanForOrganization(updated),
      counts: {
        channels: updated._count.youtubeChannels,
        giveaways: updated._count.youtubeGiveaways,
        liveSessions: updated._count.youtubeLiveSessions,
      },
    };
  }
}
