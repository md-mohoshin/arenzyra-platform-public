import axios, {
  AxiosError,
  AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from 'axios';
import { botConfig } from '../config';
import { BotApiAuthService } from '../services/api-auth.service';

export type SessionType = 'SCRIM' | 'EVENT' | 'CUSTOM' | 'PRACTICE';
export type SessionStatus =
  | 'DRAFT'
  | 'OPEN'
  | 'CHECKIN'
  | 'LOCKED'
  | 'LIVE'
  | 'ENDED'
  | 'ARCHIVED';
export type SessionRegistrationStatus =
  | 'REGISTERED'
  | 'WAITLIST'
  | 'CONFIRMED'
  | 'REMOVED'
  | 'CHECKED_IN'
  | 'DECLINED';

export type SessionResponse = {
  id: string;
  name: string;
  slug: string | null;
  type: SessionType;
  status: SessionStatus;
  createdById?: string | null;
  slotCount: number;
  maxTeams: number;
  waitlistEnabled: boolean;
  startsAt: string | null;
  counts: {
    confirmedCount: number;
    waitlistCount: number;
    totalRegisteredCount: number;
  };
};

export type SessionRegistrationResponse = {
  id: string;
  teamId: string;
  status: SessionRegistrationStatus;
  slotNumber: number | null;
  waitlistPosition: number | null;
  checkedInAt: string | null;
  confirmedAt: string | null;
  removedAt: string | null;
  removalReason: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  team: {
    id: string;
    name: string;
    tag: string | null;
    logoUrl: string | null;
    countryCode: string | null;
    region: string | null;
  } | null;
};

export type SessionMatchResponse = {
  id: string;
  sessionId: string;
  name: string | null;
  status: string;
  matchNumber?: number | null;
};

export type SessionStandingsResponse = {
  sessionId: string;
  teams: Array<{
    teamId: string;
    tag: string | null;
    totalPoints: number;
    totalKills: number;
    matchesPlayed: number;
    avgPlacement: number | null;
    rank: number;
  }>;
};

export type TeamSummary = {
  id: string;
  name: string;
  tag: string | null;
};

export type TeamMemberSummary = {
  id: string;
  teamId: string;
  organizationId: string;
  discordUserId: string;
  discordUsername: string | null;
  displayName: string | null;
  role: 'LEADER' | 'PLAYER';
  createdAt: string;
  updatedAt: string;
  leftAt: string | null;
  deletedAt: string | null;
};

export type RegisterDiscordTeamPayload = {
  name: string;
  tag: string;
  leaderDiscordUserId: string;
  leaderDiscordUsername?: string;
  leaderDisplayName?: string;
  members?: Array<{
    discordUserId: string;
    discordUsername?: string;
    displayName?: string | null;
  }>;
};

export type RegisterDiscordTeamResponse = {
  created: boolean;
  team: TeamSummary & {
    organizationId: string;
  };
  members: TeamMemberSummary[];
};

export type DiscordConfigResponse = {
  enabled: boolean;
  guildId: string | null;
  captainRoleId: string | null;
  participantRoleId: string | null;
  autoSyncRoles: boolean;
};

export type CreateSessionPayload = {
  name: string;
  type: SessionType;
  status: SessionStatus;
  slotCount: number;
  maxTeams: number;
  waitlistEnabled?: boolean;
};

export type RegisterTeamPayload = {
  teamId: string;
  note?: string;
};

export type CreateSessionMatchPayload = {
  name?: string;
};

export type ScreenshotPreviewStatus = 'OK' | 'UNRESOLVED' | 'AMBIGUOUS';

export type ScreenshotPreviewEntry = {
  position: number;
  tag: string;
  kills: number;
  teamId: string | null;
  slotId: string | null;
  slotNumber: number | null;
  status: ScreenshotPreviewStatus;
  reason?: string;
  candidateTeamIds?: string[];
};

export type ScreenshotPreviewResponse = {
  matchId: string;
  preview: ScreenshotPreviewEntry[];
  resolved: ScreenshotPreviewEntry[];
  unresolved: ScreenshotPreviewEntry[];
  ambiguous: ScreenshotPreviewEntry[];
};

export type PreviewScreenshotResultsPayload = {
  matchId: string;
  imageUrl: string;
};

export type ApplyScreenshotResultsPayload = {
  matchId: string;
  results: Array<{
    position: number;
    tag: string;
    kills: number;
    teamId?: string | null;
    slotId?: string | null;
    status: ScreenshotPreviewStatus;
  }>;
};

export type ApplyScreenshotResultsResponse = {
  ok: boolean;
  matchId: string;
  updatedCount: number;
};

export class ArenzyraApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly rawMessage: string | string[] | undefined,
  ) {
    super(message);
    this.name = 'ArenzyraApiError';
  }
}

function extractApiMessage(payload: unknown): string | string[] | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const message = (payload as { message?: unknown }).message;
  if (typeof message === 'string') {
    return message;
  }
  if (Array.isArray(message)) {
    return message.filter((entry): entry is string => typeof entry === 'string');
  }
  return undefined;
}

function normalizeApiError(error: unknown): ArenzyraApiError {
  if (error instanceof ArenzyraApiError) {
    return error;
  }

  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status ?? null;
    const rawMessage = extractApiMessage(axiosError.response?.data);
    const normalized =
      typeof rawMessage === 'string'
        ? rawMessage
        : Array.isArray(rawMessage)
          ? rawMessage.join(', ')
          : axiosError.message;

    return new ArenzyraApiError(normalized, status, rawMessage);
  }

  const fallback =
    error instanceof Error ? error.message : 'Unknown API client error';
  return new ArenzyraApiError(fallback, null, undefined);
}

export function toFriendlyApiError(error: unknown): string {
  const apiError = normalizeApiError(error);
  const normalized = apiError.message.toLowerCase();

  if (apiError.status === 404 && normalized.includes('session not found')) {
    return 'Session not found';
  }
  if (apiError.status === 404 && normalized.includes('match not found')) {
    return 'Match not found';
  }
  if (normalized.includes('session full')) {
    return 'Scrim full';
  }
  if (normalized.includes('already registered')) {
    return 'Already registered';
  }
  if (normalized.includes('already registered to another leader')) {
    return 'Team already registered to another leader';
  }
  if (normalized.includes('already belongs to')) {
    return 'A mentioned user already belongs to another team';
  }
  if (normalized.includes('team not found')) {
    return 'Team not found';
  }
  if (
    normalized.includes('screenshot ocr request failed') ||
    normalized.includes('screenshot parser returned invalid json') ||
    normalized.includes('screenshot parser returned an empty response') ||
    normalized.includes('screenshot parser returned a non-object row') ||
    normalized.includes('screenshot parser returned invalid')
  ) {
    return 'Screenshot parse failed';
  }
  if (normalized.includes('screenshot parser did not detect any team rows')) {
    return 'No usable result rows detected from screenshot';
  }
  if (
    normalized.includes('cannot apply screenshot results with unresolved or ambiguous entries')
  ) {
    return 'Preview still has unresolved or ambiguous rows';
  }
  if (
    normalized.includes('results are locked') ||
    normalized.includes('results are finalized for this match')
  ) {
    return 'Apply rejected because match results are locked or finalized';
  }
  if (normalized.includes('organization context missing')) {
    return 'Bot token is missing organization access';
  }
  if (apiError.status === 401 || apiError.status === 403) {
    return 'Bot is not authorized to call the Arenzyra API';
  }
  if (apiError.status === 404) {
    return 'Requested resource not found';
  }

  return apiError.message || 'Unexpected API error';
}

export class ArenzyraApiClient {
  private readonly client: AxiosInstance;
  private readonly authService: BotApiAuthService;

  constructor(authService = new BotApiAuthService()) {
    this.authService = authService;
    this.client = axios.create({
      baseURL: botConfig.apiBaseUrl,
      headers: {
        'User-Agent': botConfig.apiUserAgent,
      },
    });
  }

  private async request<T>(
    config: AxiosRequestConfig,
    retryOnUnauthorized = true,
  ): Promise<AxiosResponse<T>> {
    try {
      const token = await this.authService.getAccessToken();
      return await this.client.request<T>({
        ...config,
        headers: {
          ...(config.headers ?? {}),
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (error) {
      if (retryOnUnauthorized && this.authService.isUnauthorizedError(error)) {
        try {
          this.authService.invalidateAccessToken();
          await this.authService.refreshAccessTokenOrLogin();
          return this.request<T>(config, false);
        } catch (authError) {
          throw normalizeApiError(authError);
        }
      }

      throw normalizeApiError(error);
    }
  }

  async createSession(payload: CreateSessionPayload): Promise<SessionResponse> {
    try {
      const response = await this.request<SessionResponse>({
        method: 'post',
        url: '/sessions',
        data: payload,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async listSessions(): Promise<SessionResponse[]> {
    try {
      const response = await this.request<SessionResponse[]>({
        method: 'get',
        url: '/sessions',
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async getSession(sessionId: string): Promise<SessionResponse> {
    try {
      const response = await this.request<SessionResponse>({
        method: 'get',
        url: `/sessions/${sessionId}`,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async registerTeam(
    sessionId: string,
    payload: RegisterTeamPayload,
  ): Promise<SessionRegistrationResponse> {
    try {
      const response = await this.request<SessionRegistrationResponse>({
        method: 'post',
        url: `/sessions/${sessionId}/register-team`,
        data: payload,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async listRegistrations(
    sessionId: string,
  ): Promise<SessionRegistrationResponse[]> {
    try {
      const response = await this.request<SessionRegistrationResponse[]>({
        method: 'get',
        url: `/sessions/${sessionId}/registrations`,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async removeRegistration(
    sessionId: string,
    registrationId: string,
  ): Promise<unknown> {
    try {
      const response = await this.request({
        method: 'delete',
        url: `/sessions/${sessionId}/registrations/${registrationId}`,
        data: {
          removalReason: 'Removed via Discord bot',
        },
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async createSessionMatch(
    sessionId: string,
    payload: CreateSessionMatchPayload = {},
  ): Promise<SessionMatchResponse> {
    try {
      const response = await this.request<SessionMatchResponse>({
        method: 'post',
        url: `/sessions/${sessionId}/matches`,
        data: payload,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async getSessionStandings(
    sessionId: string,
  ): Promise<SessionStandingsResponse> {
    try {
      const response = await this.request<SessionStandingsResponse>({
        method: 'get',
        url: `/sessions/${sessionId}/standings`,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async searchTeams(search: string): Promise<TeamSummary[]> {
    try {
      const response = await this.request<TeamSummary[]>({
        method: 'get',
        url: '/organizer/teams',
        params: { search },
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async getTeamByTag(tag: string): Promise<TeamSummary> {
    try {
      const response = await this.request<TeamSummary>({
        method: 'get',
        url: `/organizer/teams/by-tag/${encodeURIComponent(tag)}`,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async registerDiscordTeam(
    payload: RegisterDiscordTeamPayload,
  ): Promise<RegisterDiscordTeamResponse> {
    try {
      const response = await this.request<RegisterDiscordTeamResponse>({
        method: 'post',
        url: '/organizer/teams/register-discord',
        data: payload,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async listTeamMembers(teamId: string): Promise<TeamMemberSummary[]> {
    try {
      const response = await this.request<TeamMemberSummary[]>({
        method: 'get',
        url: `/organizer/teams/${teamId}/members`,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async getDiscordConfig(): Promise<DiscordConfigResponse> {
    try {
      const response = await this.request<DiscordConfigResponse>({
        method: 'get',
        url: '/organizer/discord-config',
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async previewScreenshotResults(
    payload: PreviewScreenshotResultsPayload,
  ): Promise<ScreenshotPreviewResponse> {
    try {
      const response = await this.request<ScreenshotPreviewResponse>({
        method: 'post',
        url: '/ingest/screenshot',
        data: payload,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async applyScreenshotResults(
    payload: ApplyScreenshotResultsPayload,
  ): Promise<ApplyScreenshotResultsResponse> {
    try {
      const response = await this.request<ApplyScreenshotResultsResponse>({
        method: 'post',
        url: '/ingest/screenshot/apply',
        data: payload,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async getMatchRenderImage(matchId: string): Promise<Buffer> {
    try {
      const response = await this.request<ArrayBuffer>({
        method: 'get',
        url: `/render/match/${matchId}`,
        responseType: 'arraybuffer',
      });
      return Buffer.from(response.data);
    } catch (error) {
      throw normalizeApiError(error);
    }
  }
}
