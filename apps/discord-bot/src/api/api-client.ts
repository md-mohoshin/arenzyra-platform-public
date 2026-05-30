import axios, {
  AxiosError,
  AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import { AsyncLocalStorage } from "node:async_hooks";
import { botConfig } from "../config";
import { BotApiAuthService } from "../services/api-auth.service";

export type SessionType = "SCRIM" | "EVENT" | "CUSTOM" | "PRACTICE";
export type SessionStatus =
  | "DRAFT"
  | "OPEN"
  | "CHECKIN"
  | "LOCKED"
  | "LIVE"
  | "ENDED"
  | "ARCHIVED";
export type SessionRegistrationStatus =
  | "REGISTERED"
  | "WAITLIST"
  | "CONFIRMED"
  | "REMOVED"
  | "CHECKED_IN"
  | "DECLINED";

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
  registrationOpenAt: string | null;
  registrationCloseAt: string | null;
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
  leaderDiscordUserId: string | null;
  managerDiscordUserIds: string[];
  tournamentRosterJson?: Record<string, unknown> | null;
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

export type RemoveRegistrationResponse = {
  removedRegistration: SessionRegistrationResponse;
  promotedRegistration: SessionRegistrationResponse | null;
};

export type SessionResultResetResponse = {
  sessionId: string;
  organizationId: string;
  matchesRemoved: number;
  matchIds: string[];
  reason: string | null;
  resetAt: string;
};

export type RefreshDiscordSourceImportsResponse = {
  refreshed: number;
  skipped: boolean;
};

export type RemoveSlotRegistrationsResponse = {
  removedRegistrations: SessionRegistrationResponse[];
  removedTeamIds: string[];
  removedSlots?: number[];
  resultReset?: SessionResultResetResponse;
};

export type SessionDiscordConfigResponse = {
  id: string;
  organizationId: string;
  sessionId: string;
  enabled: boolean;
  registrationMode: "SCRIM" | "EVENT" | "TOURNAMENT" | string;
  guildId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  registrationChannelId: string | null;
  registrationChannelName: string | null;
  slotListChannelId: string | null;
  slotListChannelName: string | null;
  waitlistChannelId: string | null;
  waitlistChannelName: string | null;
  idpChannelId: string | null;
  idpChannelName: string | null;
  managerChannelId: string | null;
  managerChannelName: string | null;
  transferChannelId: string | null;
  transferChannelName: string | null;
  manageChannelId: string | null;
  manageChannelName: string | null;
  resultsChannelId: string | null;
  resultsChannelName: string | null;
  screenshotsChannelId: string | null;
  screenshotsChannelName: string | null;
  bansChannelId: string | null;
  bansChannelName: string | null;
  logChannelId: string | null;
  logChannelName: string | null;
  slotRoleId: string | null;
  slotRoleName: string | null;
  waitlistRoleId: string | null;
  waitlistRoleName: string | null;
  idpRoleId: string | null;
  idpRoleName: string | null;
  bannedRoleId: string | null;
  bannedRoleName: string | null;
  earlyAccessRoleId: string | null;
  earlyAccessRoleName: string | null;
  vipAccessRoleId: string | null;
  vipAccessRoleName: string | null;
  registrationRoleIds: string[];
  specialRegistrationRoleIds: string[];
  manageRoleIds: string[];
  vipRoleIds: string[];
  startSlot: number;
  normalSlots: number;
  vipSlots: number;
  maxManagersPerTeam: number;
  maxTeamsPerManager: number;
  tournamentMainPlayersRequired: number;
  tournamentLogoRequired: boolean;
  registrationCommand: string;
  registrationFormat: string | null;
  disableSlotAndVipRegistration: boolean;
  slotTeamEmojiEnabled: boolean;
  downloadPlayerElims: boolean;
  spreadsheetId: string | null;
  emojis: Record<string, string>;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};
export type ResolvedDiscordChannelResponse = {
  session: SessionResponse;
  config: SessionDiscordConfigResponse;
  channelKind: string;
};

export type DiscordChannelPauseResponse = {
  guildId: string;
  channelId: string;
  paused: boolean;
};

export type UpdateDiscordChannelPausePayload = {
  guildId: string;
  channelId: string;
  paused: boolean;
};

export type UpdateSessionDiscordConfigPayload = Partial<
  Omit<
    SessionDiscordConfigResponse,
    "id" | "organizationId" | "sessionId" | "createdAt" | "updatedAt"
  >
>;

export type UpdateSessionPayload = Partial<
  Pick<
    SessionResponse,
    | "name"
    | "slug"
    | "type"
    | "status"
    | "maxTeams"
    | "slotCount"
    | "waitlistEnabled"
    | "registrationOpenAt"
    | "registrationCloseAt"
    | "startsAt"
  >
>;

export type SessionMatchResponse = {
  id: string;
  sessionId: string;
  name: string | null;
  status: string;
  liveState?: string | null;
  matchNumber?: number | null;
  slotCount?: number | null;
  map?: string | null;
  dataMode?: string | null;
  dataSource?: string | null;
  scheduledAt?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  teamCount?: number | null;
};

export type MatchSlotResponse = {
  id: string;
  matchId: string;
  slotNumber: number;
  teamId: string | null;
  lobbyStatus?: string | null;
  playersInLobby?: number | null;
  team?: {
    id: string;
    name?: string | null;
    tag?: string | null;
    logoUrl?: string | null;
  } | null;
};

export type SyncSessionMatchSlotsResponse = {
  matchId: string;
  teams: number;
  slots: number;
};

export type TeamBanScope = "TEAM" | "SESSION" | "MATCH";

export type TeamBanResponse = {
  id: string;
  organizationId: string;
  teamId: string;
  scope: TeamBanScope;
  sessionId: string | null;
  matchId: string | null;
  reason: string;
  note: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  createdAt: string;
  updatedAt: string;
  active: boolean;
  team?: {
    id: string;
    name: string;
    tag: string | null;
    logoUrl?: string | null;
  } | null;
  session?: { id: string; name: string | null; status: string } | null;
  match?: {
    id: string;
    name: string | null;
    matchNumber: number | null;
    status: string;
  } | null;
};

export type ManagerBanResponse = {
  id: string;
  organizationId: string;
  discordUserId: string;
  discordUsername: string | null;
  displayName: string | null;
  scope: TeamBanScope;
  sessionId: string | null;
  matchId: string | null;
  reason: string;
  note: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  createdAt: string;
  updatedAt: string;
  active: boolean;
  session?: { id: string; name: string | null; status: string } | null;
  match?: {
    id: string;
    name: string | null;
    matchNumber: number | null;
    status: string;
  } | null;
};

export type SessionStandingsResponse = {
  sessionId: string;
  teams: Array<{
    teamId: string;
    teamName: string | null;
    tag: string | null;
    totalPoints: number;
    totalKills: number;
    placementPoints: number;
    wwcd: number;
    matchesPlayed: number;
    avgPlacement: number | null;
    rank: number;
  }>;
};

export type TeamSummary = {
  id: string;
  name: string;
  tag: string | null;
  logoUrl?: string | null;
};

export type TeamMemberSummary = {
  id: string;
  teamId: string;
  organizationId: string;
  discordUserId: string;
  discordUsername: string | null;
  displayName: string | null;
  role: "LEADER" | "PLAYER";
  createdAt: string;
  updatedAt: string;
  leftAt: string | null;
  deletedAt: string | null;
};

export type RegisterDiscordTeamPayload = {
  name: string;
  tag: string;
  logoUrl?: string | null;
  leaderDiscordUserId: string;
  leaderDiscordUsername?: string;
  leaderDisplayName?: string;
  allowDiscordMemberTransfer?: boolean;
  contextSessionId?: string;
  members?: Array<{
    discordUserId: string;
    discordUsername?: string | null;
    displayName?: string | null;
    role?: "LEADER" | "PLAYER";
  }>;
};

export type RegisterDiscordTeamResponse = {
  created: boolean;
  team: TeamSummary & {
    organizationId: string;
  };
  members: TeamMemberSummary[];
};

export type CleanupDiscordTeamResponse = {
  ok: true;
  teamId: string;
  releasedMembers: number;
};

export type ReleaseDiscordTeamMemberResponse = {
  ok: true;
  teamId: string;
  removedMember: TeamMemberSummary;
  promotedMember: TeamMemberSummary | null;
};

export type TeamLogoUpload = {
  buffer: Buffer;
  filename: string;
  contentType: string;
};
export type PlayerPhotoUpload = TeamLogoUpload;

export type TeamLogoUploadResponse = {
  ok: boolean;
  logoUrl: string;
  version: number;
};

export type DiscordPlayerPhotoUploadPayload = {
  sessionId?: string | null;
  registrationMode?: string | null;
  uid: string;
  teamName?: string | null;
  playerName?: string | null;
};

export type DiscordPlayerPhotoUploadResponse = {
  ok: boolean;
  playerId: string;
  uid: string;
  playerName: string;
  team: {
    id: string;
    name: string;
    tag: string | null;
  } | null;
  created: boolean;
  matchedRoster: boolean;
  photoUrl: string;
  version: number;
};

export type DiscordConfigResponse = {
  enabled: boolean;
  guildId: string | null;
  captainRoleId: string | null;
  participantRoleId: string | null;
  autoSyncRoles: boolean;
};

export type DiscordGuildRemovedResponse = {
  guildId: string;
  guildName: string | null;
  disabledGuildLinks: number;
  disabledPrimaryConfigs: number;
  disabledAt: string;
};

export type ResolvedDiscordGuildResponse = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  guildId: string;
  guildName: string | null;
  source: "guild-link" | "legacy-config";
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
  bypassRegistrationWindow?: boolean;
  placement?: "NORMAL" | "VIP";
  leaderDiscordUserId?: string | null;
  managerDiscordUserIds?: string[];
  tournamentRosterJson?: Record<string, unknown>;
};

export type UpdateRegistrationPlacementPayload = {
  action: "APPROVE" | "SLOT" | "WAITLIST" | "VIP";
  slotNumber?: number;
  note?: string;
};

export type UpdateRegistrationPlayStatusPayload = {
  action: "CONFIRM" | "NOT_PLAYING" | "CLEAR";
  discordUserId?: string;
  discordUsername?: string;
};

export type UpdateRegistrationManagersPayload = {
  leaderDiscordUserId?: string | null;
  managerDiscordUserIds: string[];
};

export type CreateSessionMatchPayload = {
  name?: string;
  matchNumber?: number;
  gameKey?: string;
  map?: string;
  dataMode?: string;
  dataSource?: string;
  status?: string;
  startAt?: string;
  endsAt?: string;
};

export type ListTeamBansParams = {
  active?: boolean;
  teamId?: string;
  sessionId?: string;
  matchId?: string;
  scope?: TeamBanScope;
};

export type CreateTeamBanPayload = {
  teamId: string;
  scope: TeamBanScope;
  sessionId?: string | null;
  matchId?: string | null;
  matchIds?: string[];
  reason: string;
  note?: string | null;
  expiresAt?: string | null;
};

export type ListManagerBansParams = {
  active?: boolean;
  discordUserId?: string;
  sessionId?: string;
  matchId?: string;
  scope?: TeamBanScope;
};

export type CreateManagerBanPayload = {
  teamId?: string | null;
  discordUserId?: string | null;
  discordUserIds?: string[];
  discordUsername?: string | null;
  displayName?: string | null;
  scope: TeamBanScope;
  sessionId?: string | null;
  matchId?: string | null;
  matchIds?: string[];
  reason: string;
  note?: string | null;
  expiresAt?: string | null;
};

export type NoShowTeamBanPayload = {
  sessionId: string;
  matchId?: string | null;
  matchNumber?: number | null;
  scope?: TeamBanScope;
  reason?: string | null;
  note?: string | null;
  expiresAt?: string | null;
  teamIds?: string[];
  managerDiscordUserIds?: string[];
};

export type NoShowTeamBanResponse = {
  session: { id: string; name: string | null; status: string };
  match: {
    id: string;
    name: string | null;
    matchNumber: number | null;
    status: string;
  };
  scope: TeamBanScope;
  reason: string;
  expiresAt: string | null;
  teams: Array<{
    teamId: string;
    slotNumber: number;
    team: {
      id: string;
      name: string;
      tag: string | null;
      logoUrl?: string | null;
    };
    alreadyBanned: boolean;
    missedMatches?: Array<{
      matchId: string;
      matchNumber: number | null;
      matchName: string | null;
      slotNumber: number;
    }>;
    managers?: Array<{
      discordUserId: string;
      discordUsername: string | null;
      displayName: string | null;
    }>;
  }>;
  noShowCount: number;
  alreadyBannedCount: number;
  creatableCount: number;
  createdCount: number;
  createdManagerBans?: number;
  createdBans: TeamBanResponse[];
};

export type RevokeTeamBanPayload = {
  reason?: string | null;
};

export type ScreenshotPreviewStatus = "OK" | "UNRESOLVED" | "AMBIGUOUS";

export type ScreenshotPlayerKillEntry = {
  name: string;
  kills: number;
};

export type ScreenshotPreviewEntry = {
  position: number;
  tag: string;
  kills: number;
  players?: ScreenshotPlayerKillEntry[];
  teamName?: string | null;
  teamId: string | null;
  slotId: string | null;
  slotNumber: number | null;
  status: ScreenshotPreviewStatus;
  reason?: string;
  candidateTeamIds?: string[];
  playerNames?: string[];
  confidence?: number | null;
  matchEvidence?: string;
};

export type ScreenshotPreviewResponse = {
  matchId: string;
  sessionId?: string | null;
  ocrMode?: "AI" | "BASIC" | "MANUAL";
  preview: ScreenshotPreviewEntry[];
  resolved: ScreenshotPreviewEntry[];
  unresolved: ScreenshotPreviewEntry[];
  ambiguous: ScreenshotPreviewEntry[];
  slots?: MatchSlotResponse[];
};

export type PreviewScreenshotResultsPayload = {
  matchId: string;
  imageUrl?: string;
  imageUrls?: string[];
};

export type SlotMapPreviewEntry = {
  slotNumber: number;
  tag: string | null;
  playerNames: string[];
  teamId: string | null;
  slotId: string | null;
  status: ScreenshotPreviewStatus;
  reason?: string;
  confidence?: number | null;
};

export type SlotMapPreviewResponse = {
  matchId: string;
  ocrMode?: "AI" | "BASIC";
  preview: SlotMapPreviewEntry[];
  mapped: SlotMapPreviewEntry[];
  unresolved: SlotMapPreviewEntry[];
  ambiguous: SlotMapPreviewEntry[];
};

export type MapScreenshotSlotsPayload = {
  matchId: string;
  imageUrl?: string;
  imageUrls?: string[];
};

export type ApplyScreenshotResultsPayload = {
  matchId: string;
  markMissingSlotsNoShow?: boolean;
  results: Array<{
    position: number;
    tag: string;
    kills: number;
    players?: ScreenshotPlayerKillEntry[];
    teamId?: string | null;
    slotId?: string | null;
    status: ScreenshotPreviewStatus;
  }>;
};

export type ApplyScreenshotResultsResponse = {
  ok: boolean;
  matchId: string;
  updatedCount: number;
  noShowCount?: number;
  summary?: Array<{
    position: number;
    teamName: string | null;
    tag: string;
    kills: number;
    placementPoints: number;
    totalPoints: number;
    slotNumber: number;
    teamId: string | null;
  }>;
};

export type ApplyNoShowAutoBansResponse = {
  ok: boolean;
  matchId: string;
  candidateTeamCount: number;
  rulesConfigured: number;
  createdTeamBans: number;
  createdManagerBans: number;
  createdTeamIds: string[];
  skippedAlreadyBanned: number;
  skippedProtected: number;
  skippedNoRule: number;
};

export type MatchRenderKind =
  | "match-result"
  | "overall-ranking"
  | "top-mvp"
  | "top-fraggers"
  | "overall-top-mvp"
  | "overall-top-fraggers";

export class ArenzyraApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly rawMessage: string | string[] | undefined,
  ) {
    super(message);
    this.name = "ArenzyraApiError";
  }
}

function extractApiMessage(payload: unknown): string | string[] | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const message = (payload as { message?: unknown }).message;
  if (typeof message === "string") {
    return message;
  }
  if (Array.isArray(message)) {
    return message.filter(
      (entry): entry is string => typeof entry === "string",
    );
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
      typeof rawMessage === "string"
        ? rawMessage
        : Array.isArray(rawMessage)
          ? rawMessage.join(", ")
          : axiosError.message;

    return new ArenzyraApiError(normalized, status, rawMessage);
  }

  const fallback =
    error instanceof Error ? error.message : "Unknown API client error";
  return new ArenzyraApiError(fallback, null, undefined);
}

export function toFriendlyApiError(error: unknown): string {
  const apiError = normalizeApiError(error);
  const normalized = apiError.message.toLowerCase();

  if (
    apiError.status === 502 ||
    apiError.status === 503 ||
    apiError.status === 504 ||
    normalized.includes("econnrefused") ||
    normalized.includes("econnreset") ||
    normalized.includes("etimedout") ||
    normalized.includes("eai_again") ||
    normalized.includes("enotfound") ||
    normalized.includes("fetch failed") ||
    normalized.includes("socket hang up")
  ) {
    return "Arenzyra API is temporarily unavailable. Please try again in a few seconds.";
  }

  if (apiError.status === 404 && normalized.includes("session not found")) {
    return "Session not found";
  }
  if (apiError.status === 404 && normalized.includes("match not found")) {
    return "Match not found";
  }
  if (normalized.includes("session full")) {
    return "Scrim full";
  }
  if (normalized.includes("already registered to another leader")) {
    return "Team already registered to another leader";
  }
  if (normalized.includes("already registered")) {
    return "Already registered";
  }
  if (normalized.includes("already belongs to")) {
    return "A mentioned user already belongs to another team";
  }
  if (normalized.includes("team not found")) {
    return "Team not found";
  }
  if (
    normalized.includes("screenshot ocr request failed") ||
    normalized.includes("screenshot parser returned invalid json") ||
    normalized.includes("screenshot parser returned an empty response") ||
    normalized.includes("screenshot parser returned a non-object row") ||
    normalized.includes("screenshot parser returned invalid")
  ) {
    return "Screenshot parse failed";
  }
  if (normalized.includes("screenshot parser did not detect any team rows")) {
    return "No usable result rows detected from screenshot";
  }
  if (normalized.includes("screenshot parser did not detect any slot rows")) {
    return "No usable slot rows detected from screenshot";
  }
  if (
    normalized.includes(
      "cannot apply screenshot results with unresolved or ambiguous entries",
    )
  ) {
    return "Preview still has unresolved or ambiguous rows";
  }
  if (
    normalized.includes("results are locked") ||
    normalized.includes("results are finalized for this match")
  ) {
    return "Apply rejected because match results are locked or finalized";
  }
  if (normalized.includes("organization context missing")) {
    return "Bot token is missing organization access";
  }
  if (normalized.includes("discord server is not linked")) {
    return "This Discord server is not linked to an Arenzyra organization. Connect it from the organizer Discord settings first.";
  }
  if (apiError.status === 401 || apiError.status === 403) {
    return "Bot is not authorized to call the Arenzyra API";
  }
  if (apiError.status === 404) {
    return "Requested resource not found";
  }

  return apiError.message || "Unexpected API error";
}

export class ArenzyraApiClient {
  private readonly client: AxiosInstance;
  private readonly authService: BotApiAuthService;
  private readonly organizationContext = new AsyncLocalStorage<string | null>();

  constructor(authService = new BotApiAuthService()) {
    this.authService = authService;
    this.client = axios.create({
      baseURL: botConfig.apiBaseUrl,
      headers: {
        "User-Agent": botConfig.apiUserAgent,
      },
    });
  }

  withOrganization<T>(
    organizationId: string | null | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.organizationContext.run(organizationId?.trim() || null, fn);
  }

  private async request<T>(
    config: AxiosRequestConfig,
    retryOnUnauthorized = true,
  ): Promise<AxiosResponse<T>> {
    try {
      const authorization = await this.authService.getAuthorizationHeader();
      const headers = {
        ...(config.headers ?? {}),
      } as Record<string, string>;
      const explicitOrganizationId =
        headers["x-organization-id"]?.trim() ||
        headers["X-Organization-Id"]?.trim() ||
        null;
      const organizationId =
        explicitOrganizationId ??
        this.organizationContext.getStore()?.trim() ??
        botConfig.apiOrganizationId;
      if (organizationId) {
        headers["x-organization-id"] = organizationId;
      }
      return await this.client.request<T>({
        ...config,
        headers: {
          ...headers,
          Authorization: authorization,
        },
      });
    } catch (error) {
      if (
        retryOnUnauthorized &&
        !this.authService.usesServiceToken() &&
        this.authService.isUnauthorizedError(error)
      ) {
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
        method: "post",
        url: "/sessions",
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
        method: "get",
        url: "/sessions",
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async resolveDiscordChannel(
    guildId: string,
    channelId: string,
    topicSessionId?: string | null,
    topicKind?: string | null,
  ): Promise<ResolvedDiscordChannelResponse> {
    try {
      const response = await this.request<ResolvedDiscordChannelResponse>({
        method: "get",
        url: "/sessions/discord/resolve-channel",
        params: {
          guildId,
          channelId,
          ...(topicSessionId ? { topicSessionId } : {}),
          ...(topicKind ? { topicKind } : {}),
        },
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async resolveDiscordGuild(
    guildId: string,
  ): Promise<ResolvedDiscordGuildResponse> {
    try {
      const response = await this.request<ResolvedDiscordGuildResponse>({
        method: "get",
        url: "/sessions/discord/resolve-guild",
        params: { guildId },
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async getDiscordChannelPause(
    guildId: string,
    channelId: string,
  ): Promise<DiscordChannelPauseResponse> {
    try {
      const response = await this.request<DiscordChannelPauseResponse>({
        method: "get",
        url: "/sessions/discord/channel-pause",
        params: { guildId, channelId },
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async updateDiscordChannelPause(
    payload: UpdateDiscordChannelPausePayload,
  ): Promise<DiscordChannelPauseResponse> {
    try {
      const response = await this.request<DiscordChannelPauseResponse>({
        method: "patch",
        url: "/sessions/discord/channel-pause",
        data: payload,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async getSession(sessionId: string): Promise<SessionResponse> {
    try {
      const response = await this.request<SessionResponse>({
        method: "get",
        url: `/sessions/${sessionId}`,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async updateSession(
    sessionId: string,
    payload: UpdateSessionPayload,
  ): Promise<SessionResponse> {
    try {
      const response = await this.request<SessionResponse>({
        method: "patch",
        url: `/sessions/${sessionId}`,
        data: payload,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async getSessionDiscordConfig(
    sessionId: string,
  ): Promise<SessionDiscordConfigResponse> {
    try {
      const response = await this.request<SessionDiscordConfigResponse>({
        method: "get",
        url: `/sessions/${sessionId}/discord-config`,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async updateSessionDiscordConfig(
    sessionId: string,
    payload: UpdateSessionDiscordConfigPayload,
  ): Promise<SessionDiscordConfigResponse> {
    try {
      const response = await this.request<SessionDiscordConfigResponse>({
        method: "patch",
        url: `/sessions/${sessionId}/discord-config`,
        data: payload,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async refreshDiscordSourceImports(
    sessionId: string,
  ): Promise<RefreshDiscordSourceImportsResponse> {
    try {
      const response = await this.request<RefreshDiscordSourceImportsResponse>({
        method: "post",
        url: `/sessions/${sessionId}/discord-source-imports/refresh`,
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
        method: "post",
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
        method: "get",
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
    payload: { removalReason?: string; note?: string } = {},
  ): Promise<RemoveRegistrationResponse> {
    try {
      const response = await this.request<RemoveRegistrationResponse>({
        method: "delete",
        url: `/sessions/${sessionId}/registrations/${registrationId}`,
        data: {
          removalReason: payload.removalReason ?? "Removed via Discord bot",
          ...(payload.note ? { note: payload.note } : {}),
        },
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async removeSlotRegistrations(
    sessionId: string,
    payload: { removalReason?: string; note?: string } = {},
  ): Promise<RemoveSlotRegistrationsResponse> {
    try {
      const response = await this.request<RemoveSlotRegistrationsResponse>({
        method: "delete",
        url: `/sessions/${sessionId}/registrations/slots`,
        data: {
          removalReason:
            payload.removalReason ?? "Cleaned all slots via Discord bot",
          ...(payload.note ? { note: payload.note } : {}),
        },
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async resetSessionResults(
    sessionId: string,
    payload: { reason?: string } = {},
  ): Promise<SessionResultResetResponse> {
    try {
      const response = await this.request<SessionResultResetResponse>({
        method: "post",
        url: `/sessions/${sessionId}/results/reset`,
        data: {
          reason: payload.reason ?? "Reset session result system",
        },
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async updateRegistrationPlacement(
    sessionId: string,
    registrationId: string,
    payload: UpdateRegistrationPlacementPayload,
  ): Promise<SessionRegistrationResponse> {
    try {
      const response = await this.request<SessionRegistrationResponse>({
        method: "patch",
        url: `/sessions/${sessionId}/registrations/${registrationId}`,
        data: payload,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async updateRegistrationPlayStatus(
    sessionId: string,
    registrationId: string,
    payload: UpdateRegistrationPlayStatusPayload,
  ): Promise<SessionRegistrationResponse> {
    try {
      const response = await this.request<SessionRegistrationResponse>({
        method: "patch",
        url: `/sessions/${sessionId}/registrations/${registrationId}/play-status`,
        data: payload,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async updateRegistrationManagers(
    sessionId: string,
    registrationId: string,
    payload: UpdateRegistrationManagersPayload,
  ): Promise<SessionRegistrationResponse> {
    try {
      const response = await this.request<SessionRegistrationResponse>({
        method: "patch",
        url: `/sessions/${sessionId}/registrations/${registrationId}/managers`,
        data: payload,
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
        method: "post",
        url: `/sessions/${sessionId}/matches`,
        data: payload,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async listSessionMatches(sessionId: string): Promise<SessionMatchResponse[]> {
    try {
      const response = await this.request<SessionMatchResponse[]>({
        method: "get",
        url: `/sessions/${sessionId}/matches`,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async listMatchSlots(matchId: string): Promise<MatchSlotResponse[]> {
    try {
      const response = await this.request<MatchSlotResponse[]>({
        method: "get",
        url: `/me/matches/${matchId}/slots`,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async syncSessionMatchSlots(
    sessionId: string,
    matchId: string,
  ): Promise<SyncSessionMatchSlotsResponse> {
    try {
      const response = await this.request<SyncSessionMatchSlotsResponse>({
        method: "post",
        url: `/sessions/${sessionId}/matches/${matchId}/sync-slots`,
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
        method: "get",
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
        method: "get",
        url: "/organizer/teams",
        params: { search, scope: "all" },
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async listTeamBans(
    params: ListTeamBansParams = {},
  ): Promise<TeamBanResponse[]> {
    try {
      const response = await this.request<TeamBanResponse[]>({
        method: "get",
        url: "/organizer/team-bans",
        params: {
          ...params,
          active:
            typeof params.active === "boolean"
              ? String(params.active)
              : undefined,
        },
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async createTeamBan(
    payload: CreateTeamBanPayload,
  ): Promise<TeamBanResponse[]> {
    try {
      const response = await this.request<TeamBanResponse[]>({
        method: "post",
        url: "/organizer/team-bans",
        data: payload,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async listManagerBans(
    params: ListManagerBansParams = {},
  ): Promise<ManagerBanResponse[]> {
    try {
      const response = await this.request<ManagerBanResponse[]>({
        method: "get",
        url: "/organizer/team-bans/managers",
        params: {
          ...params,
          active:
            typeof params.active === "boolean"
              ? String(params.active)
              : undefined,
        },
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async createManagerBan(
    payload: CreateManagerBanPayload,
  ): Promise<ManagerBanResponse[]> {
    try {
      const response = await this.request<ManagerBanResponse[]>({
        method: "post",
        url: "/organizer/team-bans/managers",
        data: payload,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async revokeManagerBan(
    banId: string,
    payload: RevokeTeamBanPayload = {},
  ): Promise<ManagerBanResponse> {
    try {
      const response = await this.request<ManagerBanResponse>({
        method: "post",
        url: `/organizer/team-bans/managers/${banId}/revoke`,
        data: payload,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async previewNoShowTeamBans(
    payload: NoShowTeamBanPayload,
  ): Promise<NoShowTeamBanResponse> {
    try {
      const response = await this.request<NoShowTeamBanResponse>({
        method: "post",
        url: "/organizer/team-bans/no-shows/preview",
        data: payload,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async createNoShowTeamBans(
    payload: NoShowTeamBanPayload,
  ): Promise<NoShowTeamBanResponse> {
    try {
      const response = await this.request<NoShowTeamBanResponse>({
        method: "post",
        url: "/organizer/team-bans/no-shows",
        data: payload,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async revokeTeamBan(
    banId: string,
    payload: RevokeTeamBanPayload = {},
  ): Promise<TeamBanResponse> {
    try {
      const response = await this.request<TeamBanResponse>({
        method: "post",
        url: `/organizer/team-bans/${banId}/revoke`,
        data: payload,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async getTeamByTag(tag: string): Promise<TeamSummary> {
    try {
      const response = await this.request<TeamSummary>({
        method: "get",
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
        method: "post",
        url: "/organizer/teams/register-discord",
        data: payload,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async uploadTeamLogo(
    teamId: string,
    file: TeamLogoUpload,
  ): Promise<TeamLogoUploadResponse> {
    try {
      const formData = new FormData();
      const arrayBuffer = new ArrayBuffer(file.buffer.byteLength);
      new Uint8Array(arrayBuffer).set(file.buffer);
      formData.append(
        "file",
        new Blob([arrayBuffer], { type: file.contentType }),
        file.filename,
      );
      const response = await this.request<TeamLogoUploadResponse>({
        method: "post",
        url: `/organizer/teams/${teamId}/logo`,
        data: formData,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async uploadDiscordPlayerPhoto(
    payload: DiscordPlayerPhotoUploadPayload,
    file: PlayerPhotoUpload,
  ): Promise<DiscordPlayerPhotoUploadResponse> {
    try {
      const formData = new FormData();
      const arrayBuffer = new ArrayBuffer(file.buffer.byteLength);
      new Uint8Array(arrayBuffer).set(file.buffer);
      formData.append("uid", payload.uid);
      if (payload.sessionId) {
        formData.append("sessionId", payload.sessionId);
      }
      if (payload.registrationMode) {
        formData.append("registrationMode", payload.registrationMode);
      }
      if (payload.teamName) {
        formData.append("teamName", payload.teamName);
      }
      if (payload.playerName) {
        formData.append("playerName", payload.playerName);
      }
      formData.append(
        "file",
        new Blob([arrayBuffer], { type: file.contentType }),
        file.filename,
      );
      const response = await this.request<DiscordPlayerPhotoUploadResponse>({
        method: "post",
        url: "/organizer/players/discord-photo",
        data: formData,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async cleanupDiscordTeam(
    teamId: string,
  ): Promise<CleanupDiscordTeamResponse> {
    try {
      const response = await this.request<CleanupDiscordTeamResponse>({
        method: "post",
        url: `/organizer/teams/${teamId}/discord-cleanup`,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async releaseDiscordTeamMember(
    teamId: string,
    discordUserId: string,
  ): Promise<ReleaseDiscordTeamMemberResponse> {
    try {
      const response = await this.request<ReleaseDiscordTeamMemberResponse>({
        method: "post",
        url: `/organizer/teams/${teamId}/discord-members/release`,
        data: { discordUserId },
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async listTeamMembers(teamId: string): Promise<TeamMemberSummary[]> {
    try {
      const response = await this.request<TeamMemberSummary[]>({
        method: "get",
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
        method: "get",
        url: "/organizer/discord-config",
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async markDiscordGuildRemoved(
    guildId: string,
    guildName?: string | null,
  ): Promise<DiscordGuildRemovedResponse> {
    try {
      const response = await this.request<DiscordGuildRemovedResponse>({
        method: "post",
        url: "/organizer/discord-config/guild-removed",
        data: {
          guildId,
          ...(guildName ? { guildName } : {}),
        },
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
        method: "post",
        url: "/ingest/screenshot",
        data: payload,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async mapScreenshotSlots(
    payload: MapScreenshotSlotsPayload,
  ): Promise<SlotMapPreviewResponse> {
    try {
      const response = await this.request<SlotMapPreviewResponse>({
        method: "post",
        url: "/ingest/screenshot/slot-map",
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
        method: "post",
        url: "/ingest/screenshot/apply",
        data: payload,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async applyNoShowAutoBansForMatch(
    matchId: string,
  ): Promise<ApplyNoShowAutoBansResponse> {
    try {
      const response = await this.request<ApplyNoShowAutoBansResponse>({
        method: "post",
        url: `/api/matches/${encodeURIComponent(
          matchId,
        )}/results/no-show-auto-bans`,
      });
      return response.data;
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  async getMatchRenderImage(
    matchId: string,
    kind?: MatchRenderKind,
  ): Promise<Buffer> {
    try {
      const response = await this.request<ArrayBuffer>({
        method: "get",
        url: kind
          ? `/render/match/${matchId}/discord/${kind}`
          : `/render/match/${matchId}`,
        responseType: "arraybuffer",
      });
      return Buffer.from(response.data);
    } catch (error) {
      throw normalizeApiError(error);
    }
  }
}
