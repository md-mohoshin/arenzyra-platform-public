import {
  type ApplyScreenshotResultsPayload,
  type DiscordConfigResponse,
  type RegisterDiscordTeamResponse,
  type ScreenshotPreviewEntry,
  type ScreenshotPreviewResponse,
  type SessionRegistrationResponse,
  type TeamMemberSummary,
  type TeamSummary,
  ArenzyraApiClient,
  toFriendlyApiError,
} from '../api/api-client';
import type { Guild } from 'discord.js';

const CHECK = '\u2705';
const CROSS = '\u274C';
const WARNING = '\u26A0\uFE0F';
const CAMERA = '\u{1F4F7}';
const CHART = '\u{1F4CA}';
const FIRE = '\u{1F525}';
const CLOCK = '\u{1F552}';
const TROPHY = '\u{1F3C6}';
const EM_DASH = '\u2014';

export type ApplyResultsDiscordResponse = {
  content: string;
  imageBuffer?: Buffer;
};

type DiscordSessionApi = Pick<
  ArenzyraApiClient,
  | 'applyScreenshotResults'
  | 'createSession'
  | 'createSessionMatch'
  | 'getDiscordConfig'
  | 'getMatchRenderImage'
  | 'getSession'
  | 'getSessionStandings'
  | 'getTeamByTag'
  | 'listRegistrations'
  | 'listTeamMembers'
  | 'previewScreenshotResults'
  | 'registerDiscordTeam'
  | 'registerTeam'
  | 'removeRegistration'
>;

export class DiscordSessionService {
  private readonly apiClient: DiscordSessionApi;

  // Temporary creator tracking until Discord users are linked to backend users.
  private readonly sessionCreatorById = new Map<string, string>();

  constructor(apiClient: DiscordSessionApi = new ArenzyraApiClient()) {
    this.apiClient = apiClient;
  }

  private normalizeTag(tag: string): string {
    return tag.trim().toUpperCase().replace(/\s+/g, '');
  }

  private isActiveMember(member: TeamMemberSummary): boolean {
    return member.leftAt === null && member.deletedAt === null;
  }

  private reasonLabel(reason?: string): string | null {
    switch (reason) {
      case 'TEAM_TAG_NOT_FOUND':
        return 'team tag not found';
      case 'TEAM_NOT_ASSIGNED_TO_MATCH':
        return 'team not assigned to match';
      case 'MULTIPLE_TEAMS_FOR_TAG':
        return 'multiple teams matched this tag';
      default:
        return null;
    }
  }

  private resolveTeamLabel(
    registration: Pick<SessionRegistrationResponse, 'team' | 'teamId'>,
  ): string {
    return (
      registration.team?.tag?.trim() ||
      registration.team?.name?.trim() ||
      registration.teamId ||
      'UNKNOWN'
    );
  }

  private sortBySlotOrWaitlist(
    registrations: SessionRegistrationResponse[],
  ): SessionRegistrationResponse[] {
    return registrations.slice().sort((left, right) => {
      const leftSlot = left.slotNumber ?? Number.MAX_SAFE_INTEGER;
      const rightSlot = right.slotNumber ?? Number.MAX_SAFE_INTEGER;
      if (leftSlot !== rightSlot) {
        return leftSlot - rightSlot;
      }

      const leftWait = left.waitlistPosition ?? Number.MAX_SAFE_INTEGER;
      const rightWait = right.waitlistPosition ?? Number.MAX_SAFE_INTEGER;
      if (leftWait !== rightWait) {
        return leftWait - rightWait;
      }

      return left.id.localeCompare(right.id);
    });
  }

  private formatPreviewEntry(entry: ScreenshotPreviewEntry): string {
    return `${entry.position}. ${entry.tag} ${EM_DASH} ${entry.kills} kills`;
  }

  private formatIssueEntry(entry: ScreenshotPreviewEntry): string {
    const reason = this.reasonLabel(entry.reason);
    return reason ? `- ${entry.tag} (${reason})` : `- ${entry.tag}`;
  }

  private formatPreview(
    preview: ScreenshotPreviewResponse,
    opts: { title?: string; includeInstruction?: boolean } = {},
  ): string {
    if (!preview.preview.length) {
      return `${CROSS} No usable result rows detected from screenshot`;
    }

    const lines = [opts.title ?? `${CAMERA} RESULT PREVIEW`, ''];

    if (preview.resolved.length > 0) {
      lines.push(`${CHECK} Resolved`);
      lines.push(...preview.resolved.map((entry) => this.formatPreviewEntry(entry)));
    }

    if (preview.unresolved.length > 0) {
      if (lines[lines.length - 1] !== '') {
        lines.push('');
      }
      lines.push(`${CROSS} Unresolved`);
      lines.push(...preview.unresolved.map((entry) => this.formatIssueEntry(entry)));
    }

    if (preview.ambiguous.length > 0) {
      if (lines[lines.length - 1] !== '') {
        lines.push('');
      }
      lines.push(`${WARNING} Ambiguous`);
      lines.push(...preview.ambiguous.map((entry) => this.formatIssueEntry(entry)));
    }

    if (opts.includeInstruction !== false) {
      lines.push('', 'Use /apply-results to confirm once preview looks correct.');
    }

    return lines.join('\n');
  }

  private buildApplyPayload(
    preview: ScreenshotPreviewResponse,
  ): ApplyScreenshotResultsPayload {
    return {
      matchId: preview.matchId,
      results: preview.preview.map((entry) => ({
        position: entry.position,
        tag: entry.tag,
        kills: entry.kills,
        teamId: entry.teamId,
        slotId: entry.slotId,
        status: entry.status,
      })),
    };
  }

  private topResultLines(preview: ScreenshotPreviewResponse, limit = 3): string[] {
    return preview.resolved
      .slice()
      .sort((left, right) => left.position - right.position)
      .slice(0, limit)
      .map((entry) => this.formatPreviewEntry(entry));
  }

  private async resolveTeamByTag(rawTag: string): Promise<TeamSummary> {
    const normalizedTag = this.normalizeTag(rawTag);
    if (!normalizedTag) {
      throw new Error(`${CROSS} Team tag is required`);
    }

    try {
      return await this.apiClient.getTeamByTag(normalizedTag);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(CROSS)) {
        throw error;
      }
      throw new Error(toFriendlyApiError(error));
    }
  }

  async registerTeam(
    leaderDiscordId: string,
    leaderUsername: string,
    leaderDisplayName: string | null,
    rawTag: string,
    rawName: string,
    members: Array<{
      discordUserId: string;
      discordUsername: string;
      displayName: string | null;
    }>,
    guild: Guild | null,
  ): Promise<string> {
    const normalizedTag = this.normalizeTag(rawTag);
    const normalizedName = rawName.trim();
    if (!normalizedTag) {
      return `${CROSS} Team tag is required`;
    }
    if (!normalizedName) {
      return `${CROSS} Team name is required`;
    }

    try {
      const response = await this.apiClient.registerDiscordTeam({
        tag: normalizedTag,
        name: normalizedName,
        leaderDiscordUserId: leaderDiscordId,
        leaderDiscordUsername: leaderUsername,
        leaderDisplayName: leaderDisplayName ?? undefined,
        members,
      });

      const roleSyncNote = await this.syncDiscordRoles(response, guild);
      return this.formatRegisteredTeam(response, roleSyncNote);
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  private formatRegisteredTeam(
    registration: RegisterDiscordTeamResponse,
    roleSyncNote?: string | null,
  ): string {
    const leaders = registration.members.filter((member) => member.role === 'LEADER');
    const players = registration.members.filter((member) => member.role === 'PLAYER');
    const leaderLabel =
      leaders[0]?.displayName ||
      leaders[0]?.discordUsername ||
      leaders[0]?.discordUserId ||
      'Unknown';

    const lines = [
      `${CHECK} Team ${registration.team.tag ?? registration.team.id} ${
        registration.created ? 'registered' : 'updated'
      }`,
      '',
      `Team: ${registration.team.name}`,
      `Leader: ${leaderLabel}`,
      `Players: ${players.length}`,
      '',
      `Use /join-scrim with tag ${registration.team.tag ?? registration.team.id}`,
    ];

    if (roleSyncNote) {
      lines.push('', roleSyncNote);
    }

    return lines.join('\n');
  }

  private async requireLeaderForTeam(
    requesterDiscordId: string,
    team: TeamSummary,
  ): Promise<void> {
    const members = await this.apiClient.listTeamMembers(team.id);
    const activeLeader = members.find(
      (member) => member.role === 'LEADER' && this.isActiveMember(member),
    );

    if (!activeLeader || activeLeader.discordUserId !== requesterDiscordId) {
      throw new Error(
        `${CROSS} Only the registered team leader can use this command. Register the team first if needed.`,
      );
    }
  }

  private async loadRoleSyncConfig(): Promise<DiscordConfigResponse | null> {
    try {
      const config = await this.apiClient.getDiscordConfig();
      if (!config.enabled || !config.autoSyncRoles) {
        return null;
      }
      return config;
    } catch (error) {
      console.warn(`Discord role sync config fetch failed: ${toFriendlyApiError(error)}`);
      return null;
    }
  }

  private async syncDiscordRoles(
    registration: RegisterDiscordTeamResponse,
    guild: Guild | null,
  ): Promise<string | null> {
    const config = await this.loadRoleSyncConfig();
    if (!config) {
      return null;
    }

    if (!guild) {
      return `${WARNING} Discord role sync skipped because this command was not used in a server.`;
    }

    if (config.guildId && config.guildId !== guild.id) {
      return `${WARNING} Discord role sync skipped because this server does not match the configured Arenzyra guild.`;
    }

    let captainRoleId: string | null = null;
    let participantRoleId: string | null = null;

    if (config.captainRoleId) {
      const captainRole = await guild.roles.fetch(config.captainRoleId).catch(() => null);
      if (captainRole) {
        captainRoleId = config.captainRoleId;
      }
    }

    if (config.participantRoleId) {
      const participantRole = await guild.roles
        .fetch(config.participantRoleId)
        .catch(() => null);
      if (participantRole) {
        participantRoleId = config.participantRoleId;
      }
    }

    if (!captainRoleId && !participantRoleId) {
      return `${WARNING} Discord role sync skipped because no configured team roles were found in this server.`;
    }

    let syncedCount = 0;
    let failedCount = 0;

    for (const member of registration.members.filter((entry) => this.isActiveMember(entry))) {
      const roleIds = new Set<string>();
      if (participantRoleId) {
        roleIds.add(participantRoleId);
      }
      if (member.role === 'LEADER' && captainRoleId) {
        roleIds.add(captainRoleId);
      }
      if (roleIds.size === 0) {
        continue;
      }

      try {
        const guildMember = await guild.members.fetch(member.discordUserId);
        await guildMember.roles.add([...roleIds]);
        syncedCount += 1;
      } catch (error) {
        failedCount += 1;
        console.warn(
          `Discord role sync failed for team ${registration.team.id} user ${member.discordUserId}: ${toFriendlyApiError(error)}`,
        );
      }
    }

    if (syncedCount === 0 && failedCount > 0) {
      return `${WARNING} Discord role sync could not update any registered members in this server.`;
    }

    if (syncedCount > 0 && failedCount > 0) {
      return `${WARNING} Discord role sync updated ${syncedCount} member(s); ${failedCount} member(s) could not be updated.`;
    }

    if (syncedCount > 0) {
      return `${CHECK} Discord roles synced for ${syncedCount} member(s).`;
    }

    return null;
  }

  async createScrim(
    creatorDiscordId: string,
    name: string,
    slots?: number,
  ): Promise<string> {
    const slotCount = slots ?? 25;

    try {
      const session = await this.apiClient.createSession({
        name,
        type: 'SCRIM',
        status: 'OPEN',
        slotCount,
        maxTeams: slotCount,
        waitlistEnabled: true,
      });
      this.sessionCreatorById.set(session.id, creatorDiscordId);
      return `${CHECK} Scrim created: ${session.name}\nID: ${session.id}`;
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async joinScrim(
    requesterDiscordId: string,
    sessionId: string,
    rawTag: string,
  ): Promise<string> {
    const normalizedTag = this.normalizeTag(rawTag);
    const team = await this.resolveTeamByTag(normalizedTag);
    await this.requireLeaderForTeam(requesterDiscordId, team);

    try {
      const registration = await this.apiClient.registerTeam(sessionId, {
        teamId: team.id,
        note: `Joined via Discord for tag ${normalizedTag}`,
      });

      if (
        (registration.status === 'CONFIRMED' ||
          registration.status === 'CHECKED_IN') &&
        registration.slotNumber !== null
      ) {
        return `${CHECK} Joined (Slot #${registration.slotNumber})`;
      }

      if (
        registration.status === 'WAITLIST' &&
        registration.waitlistPosition !== null
      ) {
        return `${CLOCK} Added to waitlist (Position #${registration.waitlistPosition})`;
      }

      return `${CHECK} ${team.tag ?? normalizedTag} registered for scrim`;
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async leaveScrim(
    requesterDiscordId: string,
    sessionId: string,
    rawTag: string,
  ): Promise<string> {
    const normalizedTag = this.normalizeTag(rawTag);
    const team = await this.resolveTeamByTag(normalizedTag);
    await this.requireLeaderForTeam(requesterDiscordId, team);

    try {
      const registrations = await this.apiClient.listRegistrations(sessionId);
      const registration =
        registrations.find((entry) => entry.teamId === team.id) ?? null;

      if (!registration) {
        return `${CROSS} Team not registered in this scrim`;
      }

      await this.apiClient.removeRegistration(sessionId, registration.id);
      return `${CROSS} ${normalizedTag} removed from scrim`;
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async listSlots(sessionId: string): Promise<string> {
    try {
      const [session, registrations] = await Promise.all([
        this.apiClient.getSession(sessionId),
        this.apiClient.listRegistrations(sessionId),
      ]);
      const sorted = this.sortBySlotOrWaitlist(registrations);
      const confirmed = sorted
        .filter(
          (registration): registration is SessionRegistrationResponse & {
            slotNumber: number;
          } => registration.slotNumber !== null,
        )
        .sort((left, right) => left.slotNumber - right.slotNumber);
      const waitlist = sorted
        .filter(
          (registration): registration is SessionRegistrationResponse & {
            waitlistPosition: number;
          } => registration.waitlistPosition !== null,
        )
        .sort(
          (left, right) => left.waitlistPosition - right.waitlistPosition,
        );

      const lines = [`\u{1F4CB} SLOTS (${confirmed.length}/${session.slotCount})`, ''];

      if (confirmed.length === 0) {
        lines.push('No confirmed teams yet.');
      } else {
        lines.push(
          ...confirmed.map(
            (registration) =>
              `${registration.slotNumber}. ${this.resolveTeamLabel(registration)}`,
          ),
        );
      }

      lines.push('', `${CLOCK} WAITLIST (${waitlist.length})`, '');

      if (waitlist.length === 0) {
        lines.push('None');
      } else {
        lines.push(
          ...waitlist.map(
            (registration) =>
              `${registration.waitlistPosition}. ${this.resolveTeamLabel(
                registration,
              )}`,
          ),
        );
      }

      return lines.join('\n');
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async startScrim(
    requesterDiscordId: string,
    sessionId: string,
  ): Promise<string> {
    const creatorDiscordId = this.sessionCreatorById.get(sessionId) ?? null;
    if (!creatorDiscordId || creatorDiscordId !== requesterDiscordId) {
      return `${CROSS} Only session creator can start the scrim`;
    }

    try {
      const match = await this.apiClient.createSessionMatch(sessionId);
      return `${FIRE} Scrim match created\n\nMatch ID: ${match.id}\n\nUse this match to submit results after play.`;
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async standings(sessionId: string): Promise<string> {
    try {
      const standings = await this.apiClient.getSessionStandings(sessionId);
      if (standings.teams.length === 0) {
        return `${CHART} STANDINGS\n\nNo completed session matches yet.`;
      }

      const lines = [`${CHART} STANDINGS`, ''];
      lines.push(
        ...standings.teams.map(
          (team) =>
            `${team.rank}. ${team.tag ?? team.teamId} ${EM_DASH} ${team.totalPoints} pts`,
        ),
      );

      return lines.join('\n');
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async previewResults(matchId: string, imageUrl: string): Promise<string> {
    try {
      const preview = await this.apiClient.previewScreenshotResults({
        matchId,
        imageUrl,
      });
      return this.formatPreview(preview);
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async applyResults(
    matchId: string,
    imageUrl: string,
  ): Promise<ApplyResultsDiscordResponse> {
    try {
      const preview = await this.apiClient.previewScreenshotResults({
        matchId,
        imageUrl,
      });

      if (!preview.preview.length) {
        return {
          content: `${CROSS} No usable result rows detected from screenshot`,
        };
      }

      if (preview.unresolved.length > 0 || preview.ambiguous.length > 0) {
        return {
          content: [
            `${CROSS} Cannot apply results yet`,
            '',
            this.formatPreview(preview, {
              title: `${CAMERA} RESULT PREVIEW`,
              includeInstruction: false,
            }),
            '',
            'Resolve the preview issues and run /apply-results again.',
          ].join('\n'),
        };
      }

      const applyPayload = this.buildApplyPayload(preview);
      const applied = await this.apiClient.applyScreenshotResults(applyPayload);
      const topResults = this.topResultLines(preview);
      const lines = [
        `${CHECK} Results applied`,
        '',
        `Match ID: ${applied.matchId}`,
      ];

      if (topResults.length > 0) {
        lines.push('', `${TROPHY} Match Results`, ...topResults);
      }

      try {
        const imageBuffer = await this.apiClient.getMatchRenderImage(matchId);
        return {
          content: lines.join('\n'),
          imageBuffer,
        };
      } catch (error) {
        console.warn(
          `Render image fetch failed for match ${matchId}: ${toFriendlyApiError(error)}`,
        );
        const fallbackLines = [`${CHECK} Results applied (image generation failed)`];
        if (lines.length > 2) {
          fallbackLines.push('', ...lines.slice(2));
        }
        return {
          content: fallbackLines.join('\n'),
        };
      }
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }
}
