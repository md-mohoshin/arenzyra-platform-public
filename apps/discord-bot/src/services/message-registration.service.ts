import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Collection,
  type ButtonInteraction,
  ComponentType,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type Attachment,
  type GuildTextBasedChannel,
  type GuildMember,
  type Message,
  type MessageMentionOptions,
  type MessageReaction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
  type User,
} from "discord.js";
import type {
  MatchSlotResponse,
  NoShowTeamBanResponse,
  PlayerPhotoUpload,
  SessionDiscordConfigResponse,
  SessionResultResetResponse,
  TeamLogoUpload,
} from "../api/api-client";
import { toFriendlyApiError } from "../api/api-client";
import type {
  ApplyResultsDiscordResponse,
  AutomaticResultPreviewResponse,
  DiscordNoShowTeamBanCommand,
  DiscordTeamLogoSource,
  DiscordSessionService,
  DiscordTeamBanCommand,
  DiscordTeamBanServerAction,
  DiscordTeamBanTarget,
  DiscordTeamUnbanCommand,
  ResultSummaryConfigPatch,
  ReviewedResultRow,
} from "./session.service";
import { configuredDiscordEmoji } from "./discord-emojis";

const REGISTER_COMMAND_PATTERN = /^(?:<@!?\d+>\s*)?%register\b/i;
const ARENZYRA_SESSION_TOPIC_PATTERN =
  /(?:^|[;\s])arenzyra-session=[0-9a-f-]{36}(?:$|[;\s])/i;
const START_CHANNEL_COMMAND_PATTERN = /^(?:<@!?\d+>\s*)?%start\s*$/i;
const STOP_CHANNEL_COMMAND_PATTERN = /^(?:<@!?\d+>\s*)?%stop\s*$/i;
const OPEN_REGISTRATION_COMMAND_PATTERN = /^(?:<@!?\d+>\s*)?!open\s*$/i;
const CLOSE_REGISTRATION_COMMAND_PATTERN =
  /^(?:<@!?\d+>\s*)?!(?:close|closed)\s*$/i;
const ADD_MANAGER_COMMAND_PATTERN = /^(?:<@!?\d+>\s*)?%manager\b/i;
const REMOVE_MANAGER_COMMAND_PATTERN = /^(?:<@!?\d+>\s*)?%remove\b/i;
const LOGO_COMMAND_PATTERN = /^(?:<@!?\d+>\s*)?%logo\b/i;
const PLAYER_PHOTO_COMMAND_PATTERN = /^(?:<@!?\d+>\s*)?%photo\b/i;
const CLEAN_ALL_SLOTS_COMMAND_PATTERN =
  /^(?:<@!?\d+>\s*)?%clean(?:-|\s+)all(?:-|\s+)slots\b/i;
const CLEAN_WAITLIST_COMMAND_PATTERN =
  /^(?:<@!?\d+>\s*)?%clean(?:-|\s+)waitlist\s*$/i;
const CLEAN_SCRIM_ROLES_COMMAND_PATTERN =
  /^(?:<@!?\d+>\s*)?%clean(?:-|\s+)scrim(?:-|\s+)roles(?:\s+(all|strip))?\s*$/i;
const CLEAN_COMMAND_PATTERN = /^(?:<@!?\d+>\s*)?%clean(?:\s+slot)?\s+(\d+)\b/i;
const CLEAN_CHANNEL_COMMAND_PATTERN = /^(?:<@!?\d+>\s*)?%clean-channel\b/i;
const BAN_MISSING_COMMAND_PATTERN =
  /^(?:<@!?\d+>\s*)?%(?:ban(?:-|\s+)(?:missing|no[-\s]?shows?)|ban-missing|ban-no-shows?)\b/i;
const BAN_TEAM_COMMAND_PATTERN = /^(?:<@!?\d+>\s*)?%(?:ban-team|team-ban)\b/i;
const UNBAN_TEAM_COMMAND_PATTERN =
  /^(?:<@!?\d+>\s*)?%(?:unban-team|team-unban)\b/i;
const BAN_LIST_COMMAND_PATTERN = /^(?:<@!?\d+>\s*)?%(?:ban-list|team-bans)\b/i;
const RESULT_SUMMARY_COMMAND_PATTERN = /^(?:<@!?\d+>\s*)?%result-summary\b/i;
const CONFIRM_SLOT_COMMAND_PATTERN =
  /^(?:<@!?\d+>\s*)?%(?:confirm|cofirrm)(?:\s+slot)?\s+(\d+)\s*$/i;
const SLOT_STATUS_COMMAND_PATTERN =
  /^(?:<@!?\d+>\s*)?%slot\s+status\s+(on|off)\s*$/i;
const FREE_SLOT_QUERY_PATTERN = /\bfree\s+slots?\b|\bslots?\s+free\b/i;
const DISCORD_USER_MENTION_PATTERN = /<@!?\d+>/;
const DISCORD_USER_MENTION_CAPTURE_PATTERN = /<@!?(\d{17,22})>/g;
const RESULT_GAME_CODE_PATTERN =
  /(?:^|[\s,;:])(?:game|match|round|g|m)\s*(?:(?:no|num|number)\.?\s*)?[-#]?\s*(\d{1,3})(?=$|[\s,;:!.?()\-])/i;
const MAX_LOGO_BYTES = 8 * 1024 * 1024;
const CLEAN_CONFIRMATION_DELETE_DELAY_MS = 2000;
const CONFIRM_SLOT_REPLY_DELETE_DELAY_MS = 5000;
const REGISTRATION_CHANNEL_WARNING_DELETE_DELAY_MS = 2000;
const REGISTRATION_MESSAGE_PROCESSING_TTL_MS = 5 * 60_000;
const CLEAN_CHANNEL_CONFIRMATION_MS = 30_000;
const DESTRUCTIVE_ACTION_CONFIRMATION_MS = 30_000;
const CLEAN_CHANNEL_DEFAULT_LIMIT = 100;
const CLEAN_CHANNEL_ALL_LIMIT = 500;
const CLEAN_CHANNEL_MAX_LIMIT = 1_000;
const DISCORD_BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const SLOT_STATUS_REPLY_COOLDOWN_MS = 15_000;
const RESULT_WIDGET_ATTACHMENT_PATTERN =
  /^(?:match-result|overall-ranking|top-mvp|top-fraggers|overall-top-mvp|overall-top-fraggers)\.png$/i;
const RESULT_WIDGET_UNMARKED_CLEANUP_WINDOW_MS = 6 * 60 * 60 * 1000;
const REGISTER_PROCESSING_REACTION = "\u23F3";
const REGISTER_SUCCESS_REACTION = "\u2705";
const REGISTER_WAITLIST_REACTION = "\u{1F552}";
const REGISTER_WARNING_REACTION = "\u26A0\uFE0F";
const REGISTER_REJECT_REACTION = "\u274C";
const ALLOWED_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const REGISTRATION_STATE_CONFIRMATION_PATTERN =
  /Registration is (?:open|closed)\./i;
const CHANNEL_ACTIVITY_STATE_CONFIRMATION_PATTERN =
  /Arenzyra bot is now (?:active|paused) in this channel\./i;
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const AUTO_RESULT_PENDING_TTL_MS = 2 * 60 * 60 * 1000;
const AUTO_RESULT_BUTTON_PREFIX = "result:auto:";
const AUTO_NO_SHOW_BAN_CONFIRMATION_MS = 60_000;
const FINAL_NO_SHOW_BAN_REVIEW_MS = 15 * 60_000;
const STAFF_ROLE_NAMES = [
  "[OWNER]",
  "Arenzyra Admin",
  "Arenzyra Staff",
  "Production Lead",
  "Tournament Organizer",
];

type ParsedRegisterMessage = {
  teamName: string;
  tag: string;
  placement: "NORMAL" | "VIP";
  logoUrl: string | null;
  logoSource: MessageLogoSource | null;
  tournamentRoster?: ParsedTournamentRoster | null;
};
type RegistrationInputMode = "SCRIM" | "EVENT" | "TOURNAMENT";
type TournamentRosterLineupType = "MAIN" | "SUBSTITUTE";
type ParsedTournamentRosterPlayer = {
  slot: number;
  lineupType: TournamentRosterLineupType;
  name: string;
  uid: string;
  discordUserId: string;
  discordUsername: string | null;
  displayName: string | null;
};
type ParsedTournamentRoster = {
  teamTag: string;
  managerDiscordUserId: string;
  managerDiscordUsername: string | null;
  managerDisplayName: string | null;
  managerUser: User;
  requiredMainPlayers: number;
  logoRequired: boolean;
  players: ParsedTournamentRosterPlayer[];
};
type ParsedLogoMessage = {
  teamName: string;
};
type ParsedPlayerPhotoMessage = {
  uid: string;
  teamName: string | null;
  playerName: string | null;
};
type MessageLogoSource = {
  url: string;
  attachmentId?: string | null;
  filename?: string | null;
  contentType?: string | null;
};
type CleanChannelMode = "safe" | "all";
type ParsedCleanChannelCommand = {
  mode: CleanChannelMode;
  dryRun: boolean;
  limit: number;
  channelId: string | null;
};
type CleanChannelResolvedSession = Awaited<
  ReturnType<DiscordSessionService["findScrimForDiscordChannel"]>
>;
type CleanChannelConfirmation = {
  confirmed: boolean;
  prompt: Message | null;
};
type DestructiveActionConfirmation = {
  confirmed: boolean;
  prompt: Message | null;
};
type PendingDestructiveAction = {
  authorId: string;
  confirmId: string;
  cancelId: string;
  prompt: Message;
  runningText: string;
  cancelledText: string;
  timeout: NodeJS.Timeout;
  completed: boolean;
  resolve: (confirmation: DestructiveActionConfirmation) => void;
};
type PauseControlResolvedSession = {
  session: { id: string; name?: string | null };
  config: SessionDiscordConfigResponse;
  channelKind: string;
};
type ParsedBanOptions = {
  scope: "TEAM" | "SESSION" | "MATCH" | null;
  matchNumbers: number[];
  allMatches: boolean;
  serverAction: DiscordTeamBanServerAction | null;
  days: number | null;
  reason: string | null;
  remaining: string;
};
type AutoResultPending = {
  sessionId: string;
  matchId: string;
  matchLabel: string;
  imageUrl: string;
  imageUrls: string[];
  sourceGuildId: string;
  sourceMessageId: string;
  sourceChannelId: string;
  dashboardChannelId: string;
  dashboardMessageId: string;
  reviewPanelChannelId?: string | null;
  reviewPanelMessageId?: string | null;
  config: SessionDiscordConfigResponse;
  rows: ReviewedResultRow[];
  slots: MatchSlotResponse[];
  expiresAt: number;
  processing?: boolean;
  completed?: boolean;
};
type PendingAutoNoShowBanAction = {
  userId: string;
  sourceMessageId: string;
  sessionId: string;
  matchId: string;
  command: DiscordNoShowTeamBanCommand;
  config: SessionDiscordConfigResponse;
  expiresAt: number;
};
type PendingFinalNoShowBanReview = {
  userId: string;
  sessionId: string;
  matchId: string;
  command: DiscordNoShowTeamBanCommand;
  config: SessionDiscordConfigResponse;
  preview: NoShowTeamBanResponse;
  selectedTeamIds: Set<string>;
  selectedManagerIds: Set<string>;
  expiresAt: number;
  processing?: boolean;
};

function limitDiscordContent(content: string) {
  if (content.length <= 1900) {
    return content;
  }
  return `${content.slice(0, 1870)}\n\nOutput truncated. Use the web dashboard for the full view.`;
}

export class MessageRegistrationService {
  private readonly pendingAutoResults = new Map<string, AutoResultPending>();
  private readonly pendingAutoNoShowBans = new Map<
    string,
    PendingAutoNoShowBanAction
  >();
  private readonly pendingFinalNoShowBanReviews = new Map<
    string,
    PendingFinalNoShowBanReview
  >();
  private readonly slotStatusReplyCooldowns = new Map<string, number>();
  private readonly processingRegistrationMessageIds = new Set<string>();
  private readonly pendingDestructiveActions = new Map<
    string,
    PendingDestructiveAction
  >();

  constructor(private readonly sessionService: DiscordSessionService) {}

  private channelTopic(
    channel: Message["channel"] | GuildTextBasedChannel | null | undefined,
  ) {
    const topic = (channel as { topic?: unknown } | null | undefined)?.topic;
    return typeof topic === "string" ? topic : null;
  }

  private async shouldIgnoreUnknownSessionTopic(message: Message) {
    if (!message.guild) {
      return false;
    }

    const topic = this.channelTopic(message.channel);
    if (!topic || !ARENZYRA_SESSION_TOPIC_PATTERN.test(topic)) {
      return false;
    }

    const resolved = await this.sessionService
      .findScrimForDiscordChannel(message.guild.id, message.channel.id, topic)
      .catch(() => null);
    if (resolved) {
      return false;
    }

    console.warn(
      `[DiscordGuard] ignoring message in unknown Arenzyra session channel=${message.channel.id} guild=${message.guild.id}`,
    );
    return true;
  }

  private canSendDiscordActionLog() {
    return (
      typeof (
        this.sessionService as unknown as {
          sendDiscordActionLog?: unknown;
        }
      ).sendDiscordActionLog === "function"
    );
  }

  private async sendDiscordActionLog(
    ...args: Parameters<DiscordSessionService["sendDiscordActionLog"]>
  ) {
    const logger = (
      this.sessionService as unknown as {
        sendDiscordActionLog?: DiscordSessionService["sendDiscordActionLog"];
      }
    ).sendDiscordActionLog;
    if (typeof logger !== "function") {
      return;
    }
    await logger.call(this.sessionService, ...args);
  }

  private withOrganization<T>(
    organizationId: string | null | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    const sessionService = this.sessionService as unknown as {
      withOrganization?<TValue>(
        organizationId: string | null | undefined,
        fn: () => Promise<TValue>,
      ): Promise<TValue>;
    };
    return sessionService.withOrganization
      ? sessionService.withOrganization(organizationId, fn)
      : fn();
  }

  private async replyWithAutoDelete(
    message: Message,
    content: string,
    delayMs: number,
  ): Promise<void> {
    const reply = await message.reply(content).catch(() => null);
    if (!reply) {
      return;
    }

    const timeout = setTimeout(() => {
      void reply.delete().catch(() => undefined);
    }, delayMs);
    if (typeof timeout === "object" && "unref" in timeout) {
      timeout.unref();
    }
  }

  private async sendChannelMessage(message: Message, content: string) {
    const channel = message.channel as GuildTextBasedChannel;
    const allowedMentions = this.allowedUserMentionsFromContent(content);
    if (typeof channel.send === "function") {
      return channel.send({
        content,
        allowedMentions,
      });
    }
    return message.reply({
      content,
      allowedMentions,
    });
  }

  private allowedUserMentionsFromContent(
    content: string,
  ): MessageMentionOptions {
    const users = Array.from(
      new Set(
        Array.from(content.matchAll(DISCORD_USER_MENTION_CAPTURE_PATTERN))
          .map((match) => match[1])
          .filter((userId): userId is string => Boolean(userId)),
      ),
    ).slice(0, 100);
    return users.length > 0 ? { parse: [], users } : { parse: [] };
  }

  private async sendChannelMessageWithAutoDelete(
    message: Message,
    content: string,
    delayMs: number,
  ) {
    const sent = await this.sendChannelMessage(message, content).catch(
      () => null,
    );
    if (!sent) {
      return;
    }
    const timeout = setTimeout(() => {
      void sent.delete().catch(() => undefined);
    }, delayMs);
    if (typeof timeout === "object" && "unref" in timeout) {
      timeout.unref();
    }
  }

  private async replyWithNoMentionAutoDelete(
    message: Message,
    content: string,
    delayMs: number,
  ) {
    const reply = await message
      .reply({
        content,
        allowedMentions: { parse: [] },
      })
      .catch(() => null);
    if (!reply) {
      return;
    }
    const timeout = setTimeout(() => {
      void reply.delete().catch(() => undefined);
    }, delayMs);
    if (typeof timeout === "object" && "unref" in timeout) {
      timeout.unref();
    }
  }

  private isRegistrationStateConfirmation(content: string | null | undefined) {
    return REGISTRATION_STATE_CONFIRMATION_PATTERN.test(content ?? "");
  }

  private isChannelActivityStateConfirmation(
    content: string | null | undefined,
  ) {
    return CHANNEL_ACTIVITY_STATE_CONFIRMATION_PATTERN.test(content ?? "");
  }

  private async replaceRegistrationStateConfirmation(
    message: Message,
    content: string,
  ) {
    const channel = message.channel as GuildTextBasedChannel;
    const botUserId = message.client.user?.id ?? null;
    if (botUserId && channel.messages?.fetch) {
      const messages = await channel.messages
        .fetch({ limit: 50 })
        .catch(() => null);
      const oldConfirmations = messages?.filter(
        (entry) =>
          entry.author.id === botUserId &&
          !entry.pinned &&
          this.isRegistrationStateConfirmation(entry.content),
      );
      for (const oldMessage of oldConfirmations?.values() ?? []) {
        await oldMessage.delete().catch(() => undefined);
      }
    }
    await this.sendChannelMessage(message, content);
  }

  private async replaceChannelActivityStateConfirmation(
    message: Message,
    content: string,
  ) {
    const channel = message.channel as GuildTextBasedChannel;
    const botUserId = message.client.user?.id ?? null;
    if (botUserId && channel.messages?.fetch) {
      const messages = await channel.messages
        .fetch({ limit: 50 })
        .catch(() => null);
      const oldConfirmations = messages?.filter(
        (entry) =>
          entry.author.id === botUserId &&
          !entry.pinned &&
          this.isChannelActivityStateConfirmation(entry.content),
      );
      for (const oldMessage of oldConfirmations?.values() ?? []) {
        await oldMessage.delete().catch(() => undefined);
      }
    }
    await this.sendChannelMessage(message, content);
  }

  private async resolvePauseControlContext(
    message: Message,
  ): Promise<PauseControlResolvedSession | null> {
    if (!message.guild) {
      return null;
    }

    const sessionService = this.sessionService as unknown as {
      findScrimForDiscordChannel?: DiscordSessionService["findScrimForDiscordChannel"];
      findScrimForLogoChannel?: DiscordSessionService["findScrimForLogoChannel"];
    };

    const resolved =
      typeof sessionService.findScrimForDiscordChannel === "function"
        ? await sessionService.findScrimForDiscordChannel(
            message.guild.id,
            message.channel.id,
            this.channelTopic(message.channel),
          )
        : null;
    if (resolved) {
      return resolved;
    }

    const logoResolved =
      typeof sessionService.findScrimForLogoChannel === "function"
        ? await sessionService.findScrimForLogoChannel(
            message.guild.id,
            message.channel.id,
            this.channelTopic(message.channel),
          )
        : null;
    if (logoResolved) {
      return { ...logoResolved, channelKind: "logos" };
    }

    return null;
  }

  private async isMessageChannelPaused(message: Message) {
    const sessionService = this.sessionService as unknown as {
      isDiscordChannelPaused?: DiscordSessionService["isDiscordChannelPaused"];
    };
    return typeof sessionService.isDiscordChannelPaused === "function"
      ? sessionService.isDiscordChannelPaused(
          message.guild?.id,
          message.channel.id,
        )
      : false;
  }

  private async handleChannelActivityStateMessage(
    message: Message,
    paused: boolean,
  ): Promise<boolean> {
    if (!message.guild) {
      await message.reply("Use this command inside a synced Discord channel.");
      return true;
    }

    const resolved = await this.resolvePauseControlContext(message);
    await message.delete().catch(() => undefined);

    if (!this.hasStaffAccess(message, resolved?.config ?? null)) {
      await this.sendChannelMessageWithAutoDelete(
        message,
        "Only Arenzyra staff can pause or resume bot activity.",
        REGISTRATION_CHANNEL_WARNING_DELETE_DELAY_MS,
      );
      return true;
    }

    const updated = await this.withOrganization(
      resolved?.config.organizationId,
      () =>
        this.sessionService.setDiscordChannelPaused(
          message.guild!.id,
          message.channel.id,
          paused,
        ),
    );
    await this.replaceChannelActivityStateConfirmation(
      message,
      updated.paused
        ? "Arenzyra bot is now paused in this channel. Use `%start` to resume."
        : "Arenzyra bot is now active in this channel.",
    );
    return true;
  }

  private messageCanTriggerBotActivity(
    content: string,
    resultScreenshotUrls: string[],
  ) {
    return (
      BAN_MISSING_COMMAND_PATTERN.test(content) ||
      BAN_TEAM_COMMAND_PATTERN.test(content) ||
      OPEN_REGISTRATION_COMMAND_PATTERN.test(content) ||
      CLOSE_REGISTRATION_COMMAND_PATTERN.test(content) ||
      ADD_MANAGER_COMMAND_PATTERN.test(content) ||
      REMOVE_MANAGER_COMMAND_PATTERN.test(content) ||
      UNBAN_TEAM_COMMAND_PATTERN.test(content) ||
      BAN_LIST_COMMAND_PATTERN.test(content) ||
      RESULT_SUMMARY_COMMAND_PATTERN.test(content) ||
      CONFIRM_SLOT_COMMAND_PATTERN.test(content) ||
      SLOT_STATUS_COMMAND_PATTERN.test(content) ||
      this.isFreeSlotStatusQuery(content) ||
      LOGO_COMMAND_PATTERN.test(content) ||
      PLAYER_PHOTO_COMMAND_PATTERN.test(content) ||
      CLEAN_CHANNEL_COMMAND_PATTERN.test(content) ||
      CLEAN_WAITLIST_COMMAND_PATTERN.test(content) ||
      CLEAN_SCRIM_ROLES_COMMAND_PATTERN.test(content) ||
      CLEAN_ALL_SLOTS_COMMAND_PATTERN.test(content) ||
      CLEAN_COMMAND_PATTERN.test(content) ||
      resultScreenshotUrls.length > 0 ||
      Boolean(this.detectNoCommandRegistrationMode(content)) ||
      REGISTER_COMMAND_PATTERN.test(content)
    );
  }

  private isFreeSlotStatusQuery(content: string) {
    return FREE_SLOT_QUERY_PATTERN.test(content);
  }

  private slotStatusResponsesEnabled(
    config: SessionDiscordConfigResponse | null | undefined,
  ) {
    return config?.emojis?.slotStatusResponseEnabled !== "false";
  }

  private slotStatusCooldownActive(message: Message) {
    const guildId = message.guild?.id ?? "dm";
    const key = `${guildId}:${message.channel.id}`;
    const now = Date.now();
    const mutedUntil = this.slotStatusReplyCooldowns.get(key) ?? 0;
    if (mutedUntil > now) {
      return true;
    }
    this.slotStatusReplyCooldowns.set(key, now + SLOT_STATUS_REPLY_COOLDOWN_MS);
    return false;
  }

  async handleMessage(message: Message): Promise<boolean> {
    if (message.author.bot) {
      return false;
    }

    const content = message.content.trim();
    if (STOP_CHANNEL_COMMAND_PATTERN.test(content)) {
      return this.handleChannelActivityStateMessage(message, true);
    }

    if (START_CHANNEL_COMMAND_PATTERN.test(content)) {
      return this.handleChannelActivityStateMessage(message, false);
    }

    const resultScreenshotUrls = this.findImageUrls(message);
    const canTriggerBotActivity = this.messageCanTriggerBotActivity(
      content,
      resultScreenshotUrls,
    );
    if (
      canTriggerBotActivity &&
      (await this.shouldIgnoreUnknownSessionTopic(message))
    ) {
      return true;
    }

    if (canTriggerBotActivity && (await this.isMessageChannelPaused(message))) {
      return true;
    }

    if (OPEN_REGISTRATION_COMMAND_PATTERN.test(content)) {
      return this.handleRegistrationStateMessage(message, "open");
    }

    if (CLOSE_REGISTRATION_COMMAND_PATTERN.test(content)) {
      return this.handleRegistrationStateMessage(message, "closed");
    }

    if (ADD_MANAGER_COMMAND_PATTERN.test(content)) {
      return this.handleManagerTransferMessage(message, "add");
    }

    if (REMOVE_MANAGER_COMMAND_PATTERN.test(content)) {
      return this.handleManagerTransferMessage(message, "remove");
    }

    if (BAN_MISSING_COMMAND_PATTERN.test(content)) {
      return this.handleBanMissingTeamsMessage(message);
    }

    if (BAN_TEAM_COMMAND_PATTERN.test(content)) {
      return this.handleBanTeamMessage(message);
    }

    if (UNBAN_TEAM_COMMAND_PATTERN.test(content)) {
      return this.handleUnbanTeamMessage(message);
    }

    if (BAN_LIST_COMMAND_PATTERN.test(content)) {
      return this.handleBanListMessage(message);
    }

    if (RESULT_SUMMARY_COMMAND_PATTERN.test(content)) {
      return this.handleResultSummaryMessage(message);
    }

    if (CONFIRM_SLOT_COMMAND_PATTERN.test(content)) {
      return this.handleConfirmSlotMessage(message);
    }

    if (SLOT_STATUS_COMMAND_PATTERN.test(content)) {
      return this.handleSlotStatusCommandMessage(message);
    }

    if (LOGO_COMMAND_PATTERN.test(content)) {
      return this.handleLogoMessage(message);
    }

    if (PLAYER_PHOTO_COMMAND_PATTERN.test(content)) {
      return this.handlePlayerPhotoMessage(message);
    }

    if (CLEAN_CHANNEL_COMMAND_PATTERN.test(content)) {
      return this.handleCleanChannelMessage(message);
    }

    if (CLEAN_WAITLIST_COMMAND_PATTERN.test(content)) {
      return this.handleCleanWaitlistMessage(message);
    }

    if (CLEAN_SCRIM_ROLES_COMMAND_PATTERN.test(content)) {
      return this.handleCleanScrimRolesMessage(message);
    }

    if (CLEAN_ALL_SLOTS_COMMAND_PATTERN.test(content)) {
      return this.handleCleanAllSlotsMessage(message);
    }

    if (CLEAN_COMMAND_PATTERN.test(content)) {
      return this.handleCleanSlotMessage(message);
    }

    if (resultScreenshotUrls.length > 0) {
      const handled = await this.handleAutomaticResultScreenshot(
        message,
        resultScreenshotUrls,
      );
      if (handled) {
        return true;
      }
    }

    const noCommandRegistrationMode =
      this.detectNoCommandRegistrationMode(content);
    if (noCommandRegistrationMode) {
      const handled = await this.handleNoCommandRegisterMessage(
        message,
        noCommandRegistrationMode,
      );
      if (handled) {
        return true;
      }
    }

    if (REGISTER_COMMAND_PATTERN.test(content)) {
      const waitlistHandled =
        await this.handleWaitlistPromotionMessage(message);
      if (waitlistHandled) {
        return true;
      }
      return this.handleRegisterMessage(message, "SCRIM");
    }

    if (this.isFreeSlotStatusQuery(content)) {
      return this.handleFreeSlotStatusQueryMessage(message);
    }

    return false;
  }

  private async handleRegistrationStateMessage(
    message: Message,
    state: "open" | "closed",
  ): Promise<boolean> {
    if (!message.guild) {
      await message.reply(
        "Use this command inside the synced registration channel.",
      );
      return true;
    }

    const resolved = await this.sessionService.findScrimForRegistrationChannel(
      message.guild.id,
      message.channel.id,
      this.channelTopic(message.channel),
    );
    if (!resolved) {
      await this.replyWithAutoDelete(
        message,
        "This command only works inside a synced registration channel.",
        REGISTRATION_CHANNEL_WARNING_DELETE_DELAY_MS,
      );
      return true;
    }

    await message.delete().catch(() => undefined);

    if (!this.hasStaffAccess(message, resolved.config)) {
      await this.sendChannelMessageWithAutoDelete(
        message,
        "Only Arenzyra staff can open or close registration.",
        REGISTRATION_CHANNEL_WARNING_DELETE_DELAY_MS,
      );
      return true;
    }

    const result = await this.withOrganization(
      resolved.config.organizationId,
      () =>
        this.sessionService.setRegistrationChannelState(
          message.guild!,
          resolved.session.id,
          state,
          {
            actorDiscordId: message.author.id,
            actorLabel: message.author.tag,
            sourceChannelId: message.channel.id,
            sessionName: resolved.session.name,
          },
        ),
    );
    await this.replaceRegistrationStateConfirmation(message, result);
    return true;
  }

  private async handleSlotStatusCommandMessage(
    message: Message,
  ): Promise<boolean> {
    if (!message.guild) {
      await message.reply("Use this command inside a synced session channel.");
      return true;
    }

    const match = SLOT_STATUS_COMMAND_PATTERN.exec(message.content.trim());
    const enabled = match?.[1]?.toLowerCase() === "on";
    const resolved = await this.sessionService.findScrimForDiscordChannel(
      message.guild.id,
      message.channel.id,
      this.channelTopic(message.channel),
    );
    if (!resolved) {
      await this.replyWithAutoDelete(
        message,
        "This command only works inside a synced session channel.",
        REGISTRATION_CHANNEL_WARNING_DELETE_DELAY_MS,
      );
      return true;
    }

    await message.delete().catch(() => undefined);

    if (!this.hasStaffAccess(message, resolved.config)) {
      await this.sendChannelMessageWithAutoDelete(
        message,
        "Only Arenzyra staff can change free-slot status replies.",
        REGISTRATION_CHANNEL_WARNING_DELETE_DELAY_MS,
      );
      return true;
    }

    const updated = await this.withOrganization(
      resolved.config.organizationId,
      () =>
        this.sessionService.setSlotStatusResponseEnabled(
          resolved.session.id,
          enabled,
        ),
    );
    await this.sendChannelMessage(
      message,
      `${configuredDiscordEmoji("check", "check", updated)} Free-slot status replies are now ${
        enabled ? "on" : "off"
      } for ${resolved.session.name}.`,
    );
    return true;
  }

  private async handleFreeSlotStatusQueryMessage(
    message: Message,
  ): Promise<boolean> {
    if (!message.guild) {
      return false;
    }

    const resolved = await this.sessionService.findScrimForDiscordChannel(
      message.guild.id,
      message.channel.id,
      this.channelTopic(message.channel),
    );
    if (!resolved || !this.slotStatusResponsesEnabled(resolved.config)) {
      return false;
    }

    if (this.slotStatusCooldownActive(message)) {
      return true;
    }

    const content = await this.withOrganization(
      resolved.config.organizationId,
      () => this.sessionService.freeSlotStatusMessage(resolved.session.id),
    );
    await this.sendChannelMessage(message, content);
    return true;
  }

  private managerTransferUsage(action: "add" | "remove") {
    return [
      "Use this format:",
      "",
      action === "add" ? "%manager" : "%remove",
      "Team Name",
      "@manager",
    ].join("\n");
  }

  private async parseManagerTransferMessage(
    message: Message,
    action: "add" | "remove",
  ) {
    const commandPattern =
      action === "add"
        ? ADD_MANAGER_COMMAND_PATTERN
        : REMOVE_MANAGER_COMMAND_PATTERN;
    const lines = message.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const commandTail =
      lines[0]
        ?.replace(commandPattern, "")
        .replace(DISCORD_USER_MENTION_CAPTURE_PATTERN, " ")
        .replace(/\s+/g, " ")
        .trim() ?? "";
    const fields = [commandTail, ...lines.slice(1)]
      .map((line) =>
        line
          .replace(DISCORD_USER_MENTION_CAPTURE_PATTERN, " ")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean);
    const teamQuery = fields[0] ?? "";
    if (!teamQuery) {
      throw new Error(this.managerTransferUsage(action));
    }

    const managers = await this.parseMentionedManagers(message);
    if (managers.length !== 1) {
      throw new Error("Mention exactly 1 manager.");
    }
    return {
      teamQuery,
      manager: managers[0],
    };
  }

  private async handleManagerTransferMessage(
    message: Message,
    action: "add" | "remove",
  ): Promise<boolean> {
    if (!message.guild) {
      await message.reply(
        "Use this command inside the session transfer roles channel.",
      );
      return true;
    }

    const resolved = await this.sessionService.findScrimForDiscordChannel(
      message.guild.id,
      message.channel.id,
      this.channelTopic(message.channel),
    );
    if (!resolved || resolved.channelKind !== "transfer") {
      await this.replyWithAutoDelete(
        message,
        "This command only works inside the synced transfer roles channel.",
        REGISTRATION_CHANNEL_WARNING_DELETE_DELAY_MS,
      );
      return true;
    }

    await message.delete().catch(() => undefined);

    try {
      const parsed = await this.parseManagerTransferMessage(message, action);
      const staffBypass = this.hasStaffAccess(message, resolved.config);
      const audit = {
        actorDiscordId: message.author.id,
        actorLabel: message.author.tag,
        sourceChannelId: message.channel.id,
        sessionName: resolved.session.name,
      };
      const result = await this.withOrganization(
        resolved.config.organizationId,
        () =>
          action === "add"
            ? this.sessionService.addSessionTeamManager(
                message.guild!,
                resolved.session.id,
                parsed.teamQuery,
                parsed.manager,
                {
                  ...audit,
                  requesterDiscordId: message.author.id,
                  staffBypass,
                },
              )
            : this.sessionService.removeSessionTeamManager(
                message.guild!,
                resolved.session.id,
                parsed.teamQuery,
                parsed.manager.discordUserId,
                {
                  ...audit,
                  requesterDiscordId: message.author.id,
                  staffBypass,
                },
              ),
      );
      await this.sendChannelMessage(message, result);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      await this.sendChannelMessageWithAutoDelete(message, details, 8_000);
    }
    return true;
  }

  async handleButton(interaction: ButtonInteraction): Promise<boolean> {
    if (interaction.customId.startsWith("destructive:")) {
      return this.handleDestructiveActionButton(interaction);
    }

    const finalNoShowBanReview = this.parseFinalNoShowBanReviewButtonId(
      interaction.customId,
    );
    if (finalNoShowBanReview) {
      return this.handleFinalNoShowBanReviewButton(
        interaction,
        finalNoShowBanReview,
      );
    }

    const noShowBanConfirmation = this.parseAutoNoShowBanConfirmationId(
      interaction.customId,
    );
    if (noShowBanConfirmation) {
      return this.handleAutoNoShowBanConfirmationButton(
        interaction,
        noShowBanConfirmation,
      );
    }

    const parsed = this.parseAutoResultButtonId(interaction.customId);
    if (!parsed) {
      return false;
    }

    this.pruneExpiredAutoResults();
    const pending = this.pendingAutoResults.get(parsed.sourceMessageId);
    if (!pending) {
      await interaction.reply({
        content: "This result preview expired. Send the screenshot again.",
        ephemeral: true,
      });
      return true;
    }

    if (!this.hasInteractionStaffAccess(interaction, pending.config)) {
      await interaction.reply({
        content: "Only Arenzyra staff can apply results.",
        ephemeral: true,
      });
      return true;
    }

    if (parsed.action === "ban-missing") {
      await this.handleAutoNoShowBanPreview(interaction, pending);
      return true;
    }

    if (parsed.action === "preview") {
      await interaction.reply({
        content: this.formatAutoResultDetails(pending),
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return true;
    }

    if (parsed.action === "refresh") {
      await interaction.deferReply({ ephemeral: true });
      await this.refreshAutoResultDashboard(interaction, pending);
      await interaction.editReply({
        content: "Result review panel refreshed.",
        allowedMentions: { parse: [] },
      });
      return true;
    }

    if (parsed.action === "add-row") {
      await interaction.showModal(
        this.buildAutoResultAddRowModal(parsed.sourceMessageId, pending),
      );
      return true;
    }

    if (parsed.action === "cancel") {
      this.pendingAutoResults.delete(parsed.sourceMessageId);
      await interaction.deferUpdate();
      await this.updateAutoResultPanels(interaction, pending, {
        content: "Discord result review cancelled.",
        components: [],
        allowedMentions: { parse: [] },
      });
      await this.sendDiscordActionLog(interaction.guild, pending.config, {
        action: "OCR result review cancelled",
        actorDiscordId: interaction.user?.id ?? null,
        actorLabel: interaction.user?.tag ?? null,
        sourceChannelId: interaction.channelId,
        sessionId: pending.sessionId,
        status: pending.matchLabel,
        details: `Source screenshot: ${pending.sourceMessageId}`,
        color: 0xf59e0b,
      });
      return true;
    }

    const issues = this.reviewIssues(pending);
    if (issues.length > 0) {
      await interaction.reply({
        content: `Cannot apply yet:\n${issues.map((issue) => `- ${issue}`).join("\n")}`,
        ephemeral: true,
      });
      return true;
    }

    if (pending.completed) {
      await interaction.reply({
        content: "This result review was already applied.",
        ephemeral: true,
      });
      return true;
    }

    if (pending.processing) {
      await interaction.reply({
        content:
          "This result review is already being applied. Wait for the current action to finish.",
        ephemeral: true,
      });
      return true;
    }

    pending.processing = true;
    try {
      await interaction.deferUpdate();
      const {
        result,
        postedToManager,
        finalPostedToResults,
        matchResultChannelId,
        overallResultChannelId,
        resultReset,
        resultResetFailed,
        finalNoShowBanReviewStatus,
      } = await this.withOrganization(
        pending.config.organizationId,
        async () => {
          const appliedResult = await this.sessionService.applyReviewedResults(
            pending.matchId,
            pending.rows,
            pending.config,
            {
              markMissingSlotsNoShow:
                parsed.action === "apply-noshow" || parsed.action === "final",
            },
          );
          const matchResultChannelId = this.matchResultPostChannelId(
            pending.config,
          );
          const overallResultChannelId = this.overallResultPostChannelId(
            pending.config,
          );
          const postedManager = await this.postResultToConfiguredChannel(
            interaction,
            matchResultChannelId,
            appliedResult,
            {
              matchId: pending.matchId,
              replacePreviousWidgets: true,
              widgetGroup: "match",
            },
          );

          let postedResults = false;
          if (parsed.action === "final") {
            const finalResult = await this.sessionService.buildFinalResultPost(
              pending.matchId,
              pending.config,
            );
            postedResults = await this.postResultToConfiguredChannel(
              interaction,
              overallResultChannelId,
              finalResult,
              {
                matchId: pending.matchId,
                replacePreviousWidgets: true,
                widgetGroup: "final",
              },
            );
          }

          let finalBanReview: { status: string } | null = null;
          if (parsed.action === "final" && postedResults) {
            finalBanReview = await this.createFinalNoShowBanReview(
              interaction,
              pending,
            );
          }

          let resetResult: SessionResultResetResponse | null = null;
          let resetFailed = false;
          if (parsed.action === "final" && postedResults) {
            try {
              resetResult = await this.sessionService.resetSessionResultSystem(
                pending.sessionId,
                interaction.guild,
                pending.config,
                "Final result posted",
                {
                  actorDiscordId: interaction.user?.id ?? null,
                  actorLabel: interaction.user?.tag ?? null,
                  sourceChannelId: interaction.channelId,
                },
              );
            } catch (error) {
              resetFailed = true;
              console.warn(
                `Result system reset failed after final post session=${pending.sessionId}: ${String(
                  error,
                )}`,
              );
            }
          }

          return {
            result: appliedResult,
            postedToManager: postedManager,
            finalPostedToResults: postedResults,
            matchResultChannelId,
            overallResultChannelId,
            resultReset: resetResult,
            resultResetFailed: resetFailed,
            finalNoShowBanReviewStatus: finalBanReview?.status ?? null,
          };
        },
      );

      pending.completed = true;
      pending.processing = false;
      this.pendingAutoResults.delete(parsed.sourceMessageId);
      const completionComponents: Array<ActionRowBuilder<ButtonBuilder>> = [];
      const statusLines = [
        result.content,
        "",
        postedToManager && matchResultChannelId
          ? `Match widgets posted to <#${matchResultChannelId}>.`
          : "Match widgets could not be posted to the configured match result channel.",
      ];

      if (parsed.action === "final") {
        statusLines.push(
          finalPostedToResults && overallResultChannelId
            ? `Final overall widgets posted to <#${overallResultChannelId}>.`
            : "Final overall widgets could not be posted to the configured overall result channel.",
        );
        if (resultReset) {
          statusLines.push(
            `Result system reset: ${resultReset.matchesRemoved} old match${
              resultReset.matchesRemoved === 1 ? "" : "es"
            } removed.`,
          );
        } else if (resultResetFailed) {
          statusLines.push(
            "Result system reset failed. Old match data may still exist.",
          );
        }
        if (finalNoShowBanReviewStatus) {
          statusLines.push(finalNoShowBanReviewStatus);
        }
      }

      await interaction.editReply({
        content: limitDiscordContent(statusLines.join("\n")),
        files: postedToManager ? [] : this.resultAttachments(result),
        components: completionComponents,
        allowedMentions: { parse: [] },
      });
      await this.updateAutoResultPanels(interaction, pending, {
        content: limitDiscordContent(statusLines.join("\n")),
        components: completionComponents,
        allowedMentions: { parse: [] },
      });
      await this.sendDiscordActionLog(interaction.guild, pending.config, {
        action:
          parsed.action === "final"
            ? "OCR results applied and final posted"
            : parsed.action === "apply-noshow"
              ? "OCR results applied with ban count"
              : "OCR results applied",
        actorDiscordId: interaction.user?.id ?? null,
        actorLabel: interaction.user?.tag ?? null,
        sourceChannelId: interaction.channelId,
        sessionId: pending.sessionId,
        status: pending.matchLabel,
        details: [
          `Rows selected: ${pending.rows.filter((row) => row.include).length}`,
          `Rows skipped: ${pending.rows.filter((row) => !row.include).length}`,
          postedToManager && matchResultChannelId
            ? `Posted match widgets: <#${matchResultChannelId}>`
            : "Match widgets not posted to configured match channel",
          parsed.action === "final" &&
          finalPostedToResults &&
          overallResultChannelId
            ? `Posted final widgets: <#${overallResultChannelId}>`
            : "",
          parsed.action === "final" && resultReset
            ? `Result system reset: ${resultReset.matchesRemoved} match${
                resultReset.matchesRemoved === 1 ? "" : "es"
              } removed`
            : "",
          parsed.action === "final" && resultResetFailed
            ? "Result system reset failed"
            : "",
          parsed.action === "final" && finalNoShowBanReviewStatus
            ? finalNoShowBanReviewStatus
            : "",
        ],
        color: 0x22c55e,
      });
      return true;
    } catch (error) {
      pending.processing = false;
      if (this.isMissingSlotMapError(error)) {
        const payload = {
          content: this.missingSlotMapResponse(pending),
          components: this.autoResultComponents(pending),
          allowedMentions: { parse: [] as [] },
        };
        await interaction.editReply(payload);
        await this.updateAutoResultPanels(interaction, pending, payload);
        return true;
      }
      throw error;
    }
  }

  private configuredChannelId(value: string | null | undefined) {
    const trimmed = value?.trim() ?? "";
    return trimmed || null;
  }

  private matchResultPostChannelId(config: SessionDiscordConfigResponse) {
    return (
      this.configuredChannelId(config.emojis?.matchResultPostChannelId) ??
      this.configuredChannelId(config.resultsChannelId) ??
      this.configuredChannelId(config.managerChannelId)
    );
  }

  private overallResultPostChannelId(config: SessionDiscordConfigResponse) {
    return (
      this.configuredChannelId(config.emojis?.overallResultPostChannelId) ??
      this.configuredChannelId(config.resultsChannelId)
    );
  }

  private resultReviewChannelId(config: SessionDiscordConfigResponse) {
    return (
      this.configuredChannelId(config.emojis?.resultReviewChannelId) ??
      this.configuredChannelId(config.screenshotsChannelId) ??
      this.configuredChannelId(config.manageChannelId)
    );
  }

  private async postResultToConfiguredChannel(
    interaction: ButtonInteraction,
    channelId: string | null | undefined,
    result: ApplyResultsDiscordResponse,
    opts: {
      matchId?: string | null;
      replacePreviousWidgets?: boolean;
      widgetGroup?: "match" | "final";
    } = {},
  ): Promise<boolean> {
    const targetId = this.configuredChannelId(channelId);
    if (!targetId || !interaction.guild) {
      return false;
    }

    const channel = await interaction.guild.channels
      .fetch(targetId)
      .catch(() => null);
    if (!channel || !("send" in channel)) {
      return false;
    }

    const sent = await (channel as GuildTextBasedChannel).send({
      content: this.resultPostContent(
        result.publicContent ?? result.content,
        opts.matchId,
      ),
      files: this.resultAttachments(result),
      allowedMentions: { parse: [] },
    });
    if (opts.replacePreviousWidgets) {
      await this.deletePreviousResultWidgetMessages(
        channel as GuildTextBasedChannel,
        opts.matchId,
        sent.id,
        interaction.client?.user?.id ?? null,
        opts.widgetGroup,
      );
    }
    return true;
  }

  private resultWidgetAttachmentName(attachment: unknown): string | null {
    const record =
      attachment && typeof attachment === "object"
        ? (attachment as { name?: unknown; filename?: unknown })
        : null;
    const name =
      typeof record?.name === "string"
        ? record.name
        : typeof record?.filename === "string"
          ? record.filename
          : null;
    return name?.trim() || null;
  }

  private messageHasResultWidgetAttachment(
    message: Message,
    widgetGroup?: "match" | "final",
  ) {
    return message.attachments.some((attachment) => {
      const name = this.resultWidgetAttachmentName(attachment);
      if (!name || !RESULT_WIDGET_ATTACHMENT_PATTERN.test(name)) {
        return false;
      }
      if (widgetGroup === "match") {
        return /^(match-result|top-mvp|top-fraggers)\.png$/i.test(name);
      }
      if (widgetGroup === "final") {
        return /^overall-top-(mvp|fraggers)\.png$/i.test(name);
      }
      return true;
    });
  }

  private resultMatchMarker(matchId: string | null | undefined) {
    const normalized = matchId?.trim();
    return normalized ? `Match ID: ${normalized}` : null;
  }

  private resultPostContent(
    content: string,
    matchId: string | null | undefined,
  ) {
    void matchId;
    return limitDiscordContent(this.stripResultMatchMarkers(content));
  }

  private stripResultMatchMarkers(content: string) {
    return content
      .split(/\r?\n/)
      .filter((line) => !/^\s*Match ID:\s*\S+\s*$/.test(line))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  private messageHasAnyResultMatchMarker(message: Message) {
    return /\bMatch ID:\s*\S+/.test(message.content);
  }

  private messageIsRecentUnmarkedResultWidget(message: Message) {
    if (this.messageHasAnyResultMatchMarker(message)) {
      return false;
    }
    const createdAt =
      typeof message.createdTimestamp === "number"
        ? message.createdTimestamp
        : null;
    if (!createdAt) {
      return false;
    }
    return Date.now() - createdAt <= RESULT_WIDGET_UNMARKED_CLEANUP_WINDOW_MS;
  }

  private async deletePreviousResultWidgetMessages(
    channel: GuildTextBasedChannel,
    matchId: string | null | undefined,
    keepMessageId: string,
    botUserId: string | null,
    widgetGroup?: "match" | "final",
  ) {
    const normalizedMatchId = matchId?.trim();
    if (!normalizedMatchId) {
      return;
    }

    const messagesApi = (
      channel as unknown as {
        messages?: {
          fetch?: (options: { limit: number }) => Promise<unknown>;
        };
      }
    ).messages;
    if (typeof messagesApi?.fetch !== "function") {
      return;
    }

    const fetched = await messagesApi.fetch({ limit: 50 }).catch(() => null);
    const messages =
      fetched instanceof Collection
        ? fetched
        : fetched &&
            typeof fetched === "object" &&
            "values" in fetched &&
            typeof (fetched as { values?: unknown }).values === "function"
          ? (fetched as Collection<string, Message>)
          : null;
    if (!messages) {
      return;
    }

    const matchMarker = this.resultMatchMarker(normalizedMatchId);
    if (!matchMarker) {
      return;
    }
    for (const message of messages.values()) {
      if (message.id === keepMessageId) {
        continue;
      }
      if (botUserId) {
        if (message.author?.id !== botUserId) {
          continue;
        }
      } else if (!message.author?.bot) {
        continue;
      }
      const hasCurrentMatchMarker = message.content.includes(matchMarker);
      if (
        !hasCurrentMatchMarker &&
        !this.messageIsRecentUnmarkedResultWidget(message)
      ) {
        continue;
      }
      if (!this.messageHasResultWidgetAttachment(message, widgetGroup)) {
        continue;
      }
      await message.delete().catch((error: unknown) => {
        console.warn(
          `Failed to delete stale result widget message ${message.id}: ${String(
            error,
          )}`,
        );
      });
    }
  }

  private parseAutoResultButtonId(customId: string) {
    if (!customId.startsWith(AUTO_RESULT_BUTTON_PREFIX)) {
      return null;
    }
    const [, , action, sourceMessageId] = customId.split(":");
    if (
      (action !== "apply" &&
        action !== "apply-noshow" &&
        action !== "add-row" &&
        action !== "ban-missing" &&
        action !== "cancel" &&
        action !== "final" &&
        action !== "preview" &&
        action !== "refresh") ||
      !/^\d{10,25}$/.test(sourceMessageId ?? "")
    ) {
      return null;
    }
    return {
      action,
      sourceMessageId,
    };
  }

  private parseAutoNoShowBanConfirmationId(
    customId: string,
  ): { action: "ban-confirm" | "ban-cancel"; token: string } | null {
    if (!customId.startsWith(AUTO_RESULT_BUTTON_PREFIX)) {
      return null;
    }
    const [, , action, token] = customId.split(":");
    if (
      (action !== "ban-confirm" && action !== "ban-cancel") ||
      !/^[a-z0-9-]{8,40}$/i.test(token ?? "")
    ) {
      return null;
    }
    return { action, token };
  }

  private parseFinalNoShowBanReviewButtonId(
    customId: string,
  ): { action: "final-ban-edit" | "final-ban-apply" | "final-ban-cancel"; token: string } | null {
    if (!customId.startsWith(AUTO_RESULT_BUTTON_PREFIX)) {
      return null;
    }
    const [, , action, token] = customId.split(":");
    if (
      (action !== "final-ban-edit" &&
        action !== "final-ban-apply" &&
        action !== "final-ban-cancel") ||
      !/^[a-z0-9-]{8,40}$/i.test(token ?? "")
    ) {
      return null;
    }
    return { action, token };
  }

  private parseAutoResultSelectId(customId: string) {
    if (!customId.startsWith(AUTO_RESULT_BUTTON_PREFIX)) {
      return null;
    }
    const [, , action, sourceMessageId] = customId.split(":");
    if (action !== "edit" || !/^\d{10,25}$/.test(sourceMessageId ?? "")) {
      return null;
    }
    return { sourceMessageId };
  }

  private parseAutoResultModalId(customId: string) {
    if (!customId.startsWith(AUTO_RESULT_BUTTON_PREFIX)) {
      return null;
    }
    const [, , action, sourceMessageId, rawIndex] = customId.split(":");
    if (!/^\d{10,25}$/.test(sourceMessageId ?? "")) {
      return null;
    }
    if (action === "add-modal") {
      return { action: "add" as const, sourceMessageId };
    }
    const rowIndex = Number(rawIndex);
    if (
      action !== "modal" ||
      !Number.isInteger(rowIndex) ||
      rowIndex < 0
    ) {
      return null;
    }
    return { action: "edit" as const, sourceMessageId, rowIndex };
  }

  private parseFinalNoShowBanReviewModalId(customId: string) {
    if (!customId.startsWith(AUTO_RESULT_BUTTON_PREFIX)) {
      return null;
    }
    const [, , action, token] = customId.split(":");
    if (
      action !== "final-ban-modal" ||
      !/^[a-z0-9-]{8,40}$/i.test(token ?? "")
    ) {
      return null;
    }
    return { token };
  }

  async handleStringSelectMenu(
    interaction: StringSelectMenuInteraction,
  ): Promise<boolean> {
    const parsed = this.parseAutoResultSelectId(interaction.customId);
    if (!parsed) {
      return false;
    }

    this.pruneExpiredAutoResults();
    const pending = this.pendingAutoResults.get(parsed.sourceMessageId);
    if (!pending) {
      await interaction.reply({
        content: "This result preview expired. Send the screenshot again.",
        ephemeral: true,
      });
      return true;
    }

    if (!this.hasInteractionStaffAccess(interaction, pending.config)) {
      await interaction.reply({
        content: "Only Arenzyra staff can edit results.",
        ephemeral: true,
      });
      return true;
    }

    const rowIndex = Number(interaction.values[0]);
    const row = pending.rows[rowIndex];
    if (!Number.isInteger(rowIndex) || !row) {
      await interaction.reply({
        content: "This OCR row is no longer available.",
        ephemeral: true,
      });
      return true;
    }

    await interaction.showModal(
      this.buildAutoResultEditModal(parsed.sourceMessageId, rowIndex, row),
    );
    return true;
  }

  async handleModalSubmit(
    interaction: ModalSubmitInteraction,
  ): Promise<boolean> {
    const finalBanReview = this.parseFinalNoShowBanReviewModalId(
      interaction.customId,
    );
    if (finalBanReview) {
      return this.handleFinalNoShowBanReviewModal(interaction, finalBanReview);
    }

    const parsed = this.parseAutoResultModalId(interaction.customId);
    if (!parsed) {
      return false;
    }

    this.pruneExpiredAutoResults();
    const pending = this.pendingAutoResults.get(parsed.sourceMessageId);
    if (!pending) {
      await interaction.reply({
        content: "This result preview expired. Send the screenshot again.",
        ephemeral: true,
      });
      return true;
    }

    if (!this.hasInteractionStaffAccess(interaction, pending.config)) {
      await interaction.reply({
        content: "Only Arenzyra staff can edit results.",
        ephemeral: true,
      });
      return true;
    }

    if (parsed.action === "add") {
      const nextRow = this.readAddedResultRow(interaction, pending);
      if (!nextRow.ok) {
        await interaction.reply({
          content: nextRow.error,
          ephemeral: true,
        });
        return true;
      }

      pending.rows.push(nextRow.row);
      this.sortReviewedRows(pending.rows);
      await interaction.deferReply({ ephemeral: true });
      await this.refreshAutoResultDashboard(interaction, pending);
      await interaction.editReply({
        content: `Added placement ${nextRow.row.position} for slot ${nextRow.row.slotNumber}.`,
        allowedMentions: { parse: [] },
      });
      return true;
    }

    const row = pending.rows[parsed.rowIndex];
    if (!row) {
      await interaction.reply({
        content: "This OCR row is no longer available.",
        ephemeral: true,
      });
      return true;
    }

    const nextRow = this.readEditedResultRow(interaction, pending, row);
    if (!nextRow.ok) {
      await interaction.reply({
        content: nextRow.error,
        ephemeral: true,
      });
      return true;
    }

    pending.rows[parsed.rowIndex] = nextRow.row;
    await interaction.deferReply({ ephemeral: true });
    await this.refreshAutoResultDashboard(interaction, pending);
    await interaction.editReply({
      content: `Updated row ${parsed.rowIndex + 1}.`,
      allowedMentions: { parse: [] },
    });
    return true;
  }

  private pruneExpiredAutoResults() {
    const now = Date.now();
    for (const [key, pending] of this.pendingAutoResults) {
      if (pending.expiresAt <= now) {
        this.pendingAutoResults.delete(key);
      }
    }
  }

  private parseResultGameCode(content: string): number | null {
    const match = RESULT_GAME_CODE_PATTERN.exec(content.trim());
    const parsed = Number(match?.[1]);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      return null;
    }
    return parsed;
  }

  private parseAutomaticScreenshotMode(
    content: string,
  ): "results" | "slot-map" {
    const normalized = ` ${content.trim().toLowerCase()} `;
    if (
      /(?:^|[\s,;:])(?:slot-map|slot map|map|lineup|lobby|start)(?=$|[\s,;:!.?()\-])/.test(
        normalized,
      ) ||
      /(?:^|[\s,;:])(?:slot|slots)\s+(?:player|players|mapping|map)(?=$|[\s,;:!.?()\-])/.test(
        normalized,
      )
    ) {
      return "slot-map";
    }
    return "results";
  }

  private parseResultSummaryCommand(
    content: string,
  ):
    | { ok: true; patch: ResultSummaryConfigPatch }
    | { ok: false; error: string } {
    const rest = content.replace(RESULT_SUMMARY_COMMAND_PATTERN, "").trim();
    if (!rest) {
      return {
        ok: false,
        error: [
          "Usage:",
          "`%result-summary count 3`",
          "`%result-summary title {trophy} Match Results`",
          "`%result-summary row {position}. {teamName} - {totalPoints} pts ({kills} kills)`",
          "`%result-summary reset`",
        ].join("\n"),
      };
    }

    const [actionRaw = "", ...parts] = rest.split(/\s+/);
    const action = actionRaw.toLowerCase();
    const value = parts.join(" ").trim();

    if (action === "reset") {
      return { ok: true, patch: { action: "reset" } };
    }
    if (action === "count") {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 20) {
        return {
          ok: false,
          error: "Count must be a whole number from 0 to 20.",
        };
      }
      return { ok: true, patch: { action: "count", value: parsed } };
    }
    if (action === "title") {
      if (!value) {
        return { ok: false, error: "Title text is required." };
      }
      return { ok: true, patch: { action: "title", value } };
    }
    if (action === "row") {
      if (!value) {
        return { ok: false, error: "Row template is required." };
      }
      return { ok: true, patch: { action: "row", value } };
    }

    return {
      ok: false,
      error: "Use one of: count, title, row, reset.",
    };
  }

  private reasonLabel(reason?: string): string | null {
    switch (reason) {
      case "TEAM_TAG_NOT_FOUND":
        return "team tag not found";
      case "TEAM_NOT_ASSIGNED_TO_MATCH":
        return "team not assigned to match";
      case "MULTIPLE_TEAMS_FOR_TAG":
        return "multiple teams matched this tag";
      case "MULTIPLE_TEAMS_FOR_SCREENSHOT_ROW":
        return "multiple teams matched this row";
      case "TEAM_EVIDENCE_NOT_MATCHED":
        return "team evidence did not match slots";
      case "MATCH_SLOT_NOT_FOUND":
        return "match slot not found";
      case "MATCH_SLOT_HAS_NO_TEAM":
        return "match slot has no team";
      default:
        return null;
    }
  }

  private toReviewedRows(
    preview: AutomaticResultPreviewResponse,
  ): ReviewedResultRow[] {
    return (preview.preview?.preview ?? []).map((entry) => ({
      ...entry,
      include: entry.status === "OK",
    }));
  }

  private truncateOptionText(value: string, maxLength: number) {
    return value.length <= maxLength
      ? value
      : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
  }

  private reviewedRowLabel(row: ReviewedResultRow, index: number) {
    const slot = row.slotNumber ? `S${row.slotNumber}` : "no slot";
    const status = row.include ? "apply" : "skip";
    const edited = row.edited ? " edited" : "";
    return this.truncateOptionText(
      `${index + 1}. P${row.position} ${row.tag} ${slot} ${row.kills}k ${status}${edited}`,
      100,
    );
  }

  private reviewedRowLine(row: ReviewedResultRow, index: number) {
    const mark = row.include ? "[apply]" : "[skip]";
    const slot = row.slotNumber ? `slot ${row.slotNumber}` : "no slot";
    const players = this.playerKillsSummary(row.players);
    const reason =
      row.reason && row.status !== "OK"
        ? ` (${this.reasonLabel(row.reason)})`
        : "";
    const edited = row.edited ? " edited" : "";
    return `${mark} ${index + 1}) P${row.position} ${row.tag} ${slot} - ${row.kills} kills${players}${edited}${reason}`;
  }

  private reviewRowDisplay(row: ReviewedResultRow) {
    const tag = row.tag?.trim() || row.teamName?.trim() || "unknown team";
    const slot = Number.isInteger(row.slotNumber)
      ? `slot ${row.slotNumber}`
      : "no slot";
    return `${tag} ${slot}`;
  }

  private reviewIssues(pending: AutoResultPending) {
    const issues: string[] = [];
    const included = pending.rows.filter((row) => row.include);
    if (!included.length) {
      issues.push("No rows are selected to apply.");
      return issues;
    }

    const seenPlacements = new Map<number, string>();
    const seenSlots = new Map<string, { label: string; display: string }>();
    const seenTeams = new Map<string, { label: string; display: string }>();

    for (const [index, row] of pending.rows.entries()) {
      const label = `row ${index + 1}`;
      if (!row.include) {
        if (!row.edited) {
          issues.push(
            `${label} is skipped. Edit it to map a slot or confirm skip.`,
          );
        }
        continue;
      }

      if (
        row.status !== "OK" ||
        !row.teamId ||
        !row.slotId ||
        !Number.isInteger(row.position) ||
        row.position < 1 ||
        !Number.isInteger(row.kills) ||
        row.kills < 0
      ) {
        issues.push(`${label} needs a valid placement, kills, and slot.`);
        continue;
      }

      const placementOwner = seenPlacements.get(row.position);
      if (placementOwner) {
        issues.push(
          `${label} duplicates placement ${row.position} with ${placementOwner}.`,
        );
      } else {
        seenPlacements.set(row.position, label);
      }

      const slotOwner = seenSlots.get(row.slotId);
      if (slotOwner) {
        issues.push(
          `${label} duplicates ${slotOwner.label}'s slot (${slotOwner.display}).`,
        );
      } else {
        seenSlots.set(row.slotId, {
          label,
          display: this.reviewRowDisplay(row),
        });
      }

      const teamOwner = seenTeams.get(row.teamId);
      if (teamOwner) {
        issues.push(
          `${label} duplicates ${teamOwner.label}'s team (${teamOwner.display}).`,
        );
      } else {
        seenTeams.set(row.teamId, {
          label,
          display: this.reviewRowDisplay(row),
        });
      }
    }

    const missingPlacements = this.missingResultPlacements(included);
    if (missingPlacements.length) {
      issues.push(
        `Missing placement row(s): ${this.formatPlacementList(missingPlacements)}. Edit a skipped OCR row, use Add Row, or resend the complete result screenshots before applying.`,
      );
    }

    return issues;
  }

  private missingResultPlacements(rows: ReviewedResultRow[]) {
    const placements = rows
      .map((row) => row.position)
      .filter((position) => Number.isInteger(position) && position > 0);
    if (!placements.length) {
      return [];
    }

    const seen = new Set(placements);
    const maxPlacement = Math.max(...placements);
    const missing: number[] = [];
    for (let placement = 1; placement <= maxPlacement; placement += 1) {
      if (!seen.has(placement)) {
        missing.push(placement);
      }
    }
    return missing;
  }

  private formatPlacementList(placements: number[]) {
    const visible = placements.slice(0, 12).join(", ");
    const remaining = placements.length - 12;
    return remaining > 0 ? `${visible}, +${remaining} more` : visible;
  }

  private nextResultPlacement(pending: AutoResultPending) {
    const included = pending.rows.filter((row) => row.include);
    const missing = this.missingResultPlacements(included);
    if (missing.length > 0) {
      return missing[0];
    }

    const placements = included
      .map((row) => row.position)
      .filter((position) => Number.isInteger(position) && position > 0);
    return placements.length ? Math.max(...placements) + 1 : 1;
  }

  private sortReviewedRows(rows: ReviewedResultRow[]) {
    rows.sort((left, right) => {
      const leftPosition =
        Number.isInteger(left.position) && left.position > 0
          ? left.position
          : Number.MAX_SAFE_INTEGER;
      const rightPosition =
        Number.isInteger(right.position) && right.position > 0
          ? right.position
          : Number.MAX_SAFE_INTEGER;
      if (leftPosition !== rightPosition) {
        return leftPosition - rightPosition;
      }
      return (left.slotNumber ?? 9999) - (right.slotNumber ?? 9999);
    });
  }

  private noShowCandidateSlots(pending: AutoResultPending) {
    const appliedSlotNumbers = new Set(
      pending.rows
        .filter((row) => row.include && Number.isInteger(row.slotNumber))
        .map((row) => row.slotNumber as number),
    );
    return pending.slots.filter(
      (slot) => slot.teamId && !appliedSlotNumbers.has(slot.slotNumber),
    );
  }

  private configuredNoShowBanScope(
    config: SessionDiscordConfigResponse,
  ): DiscordNoShowTeamBanCommand["scope"] {
    const normalized = (config.emojis?.banDefaultScope ?? "SESSION")
      .trim()
      .toUpperCase();
    if (normalized === "TEAM" || normalized === "MATCH") {
      return normalized;
    }
    return "SESSION";
  }

  private configuredBanDurationDays(config: SessionDiscordConfigResponse) {
    const raw = (config.emojis?.banDefaultDurationDays ?? "3").trim();
    if (!raw || /^(permanent|perm|none|0)$/i.test(raw)) {
      return null;
    }
    const match = /^(\d{1,3})(?:d|day|days)?$/i.exec(raw);
    if (!match) {
      throw new Error("Ban days must be a number from 1 to 365 or permanent.");
    }
    const days = Number.parseInt(match[1], 10);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw new Error("Ban days must be between 1 and 365.");
    }
    return days;
  }

  private noShowBanCommandForAutoResult(
    pending: AutoResultPending,
  ): DiscordNoShowTeamBanCommand {
    return {
      sessionId: pending.sessionId,
      matchId: pending.matchId,
      scope: this.configuredNoShowBanScope(pending.config),
      days: this.configuredBanDurationDays(pending.config),
      reason:
        pending.config.emojis?.banDefaultReason ||
        `No-show in ${pending.matchLabel}`,
      note: `Created from Discord result review for ${pending.matchLabel}`,
    };
  }

  private autoNoShowBanButton(sourceMessageId: string) {
    return new ButtonBuilder()
      .setCustomId(`${AUTO_RESULT_BUTTON_PREFIX}ban-missing:${sourceMessageId}`)
      .setLabel("Ban Missing Teams")
      .setStyle(ButtonStyle.Danger);
  }

  private autoNoShowBanComponents(pending: AutoResultPending) {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        this.autoNoShowBanButton(pending.sourceMessageId),
      ),
    ];
  }

  private autoNoShowBanConfirmationComponents(token: string) {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${AUTO_RESULT_BUTTON_PREFIX}ban-confirm:${token}`)
          .setLabel("Ban Missing Teams")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`${AUTO_RESULT_BUTTON_PREFIX}ban-cancel:${token}`)
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary),
      ),
    ];
  }

  private storePendingAutoNoShowBan(
    input: Omit<PendingAutoNoShowBanAction, "expiresAt">,
  ) {
    const token = `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    this.pendingAutoNoShowBans.set(token, {
      ...input,
      expiresAt: Date.now() + AUTO_NO_SHOW_BAN_CONFIRMATION_MS,
    });
    return token;
  }

  private pruneExpiredAutoNoShowBans() {
    const now = Date.now();
    for (const [token, pending] of this.pendingAutoNoShowBans) {
      if (pending.expiresAt <= now) {
        this.pendingAutoNoShowBans.delete(token);
      }
    }
    for (const [token, pending] of this.pendingFinalNoShowBanReviews) {
      if (pending.expiresAt <= now) {
        this.pendingFinalNoShowBanReviews.delete(token);
      }
    }
  }

  private noShowBanCommandForFinalResult(
    pending: AutoResultPending,
  ): DiscordNoShowTeamBanCommand {
    const configuredScope = this.configuredNoShowBanScope(pending.config);
    return {
      sessionId: pending.sessionId,
      scope: configuredScope === "MATCH" ? "SESSION" : configuredScope,
      days: this.configuredBanDurationDays(pending.config),
      reason:
        pending.config.emojis?.banDefaultReason ||
        `No-show in ${pending.matchLabel}`,
      note: `Created from Discord final no-show review for ${pending.matchLabel}`,
    };
  }

  private finalNoShowManagerEntries(review: PendingFinalNoShowBanReview) {
    const entries: Array<{
      index: number;
      teamId: string;
      teamName: string;
      manager: {
        discordUserId: string;
        discordUsername: string | null;
        displayName: string | null;
      };
    }> = [];
    let index = 1;
    for (const team of review.preview.teams) {
      if (!review.selectedTeamIds.has(team.teamId)) {
        continue;
      }
      for (const manager of team.managers ?? []) {
        entries.push({
          index,
          teamId: team.teamId,
          teamName: team.team.name,
          manager,
        });
        index += 1;
      }
    }
    return entries;
  }

  private selectedFinalNoShowManagerIds(
    review: PendingFinalNoShowBanReview,
  ) {
    const available = new Set(
      this.finalNoShowManagerEntries(review).map(
        (entry) => entry.manager.discordUserId,
      ),
    );
    return [...review.selectedManagerIds].filter((id) => available.has(id));
  }

  private finalNoShowBanReviewContent(review: PendingFinalNoShowBanReview) {
    const selectedTeams = review.preview.teams.filter(
      (team) => review.selectedTeamIds.has(team.teamId) && !team.alreadyBanned,
    );
    const managerEntries = this.finalNoShowManagerEntries(review);
    const selectedManagerIds = new Set(
      this.selectedFinalNoShowManagerIds(review),
    );
    const selectedManagerCount = managerEntries.filter((entry) =>
      selectedManagerIds.has(entry.manager.discordUserId),
    ).length;
    const lines = [
      "No-show Ban Review",
      `Session: ${review.preview.session.name ?? review.sessionId}`,
      `Scope: ${review.preview.scope}`,
      `Duration: ${
        review.command.days && review.command.days > 0
          ? `${Math.ceil(review.command.days)} day(s)`
          : "permanent"
      }`,
      `Reason: ${review.preview.reason}`,
      "",
      `Selected teams: ${selectedTeams.length}/${review.preview.creatableCount}`,
      `Selected managers: ${selectedManagerCount}/${managerEntries.length}`,
      "",
    ];

    if (!selectedTeams.length) {
      lines.push("No teams selected.");
    }

    selectedTeams.slice(0, 12).forEach((team) => {
      const originalIndex =
        review.preview.teams.findIndex(
          (candidate) => candidate.teamId === team.teamId,
        ) + 1;
      const missed = (team.missedMatches ?? [])
        .map((match) =>
          match.matchNumber
            ? `G${match.matchNumber}`
            : match.matchName?.trim() || "match",
        )
        .join(", ");
      lines.push(
        `${originalIndex}. ${team.team.name}${team.team.tag ? ` (${team.team.tag})` : ""}${missed ? ` | missed ${missed}` : ""}`,
      );
      const teamManagers = managerEntries.filter(
        (entry) => entry.teamId === team.teamId,
      );
      if (teamManagers.length) {
        lines.push(
          `   Managers: ${teamManagers
            .map(
              (entry) =>
                `M${entry.index} <@${entry.manager.discordUserId}>${
                  selectedManagerIds.has(entry.manager.discordUserId)
                    ? ""
                    : " removed"
                }`,
            )
            .join(", ")}`,
        );
      } else {
        lines.push("   Managers: none found");
      }
    });
    if (selectedTeams.length > 12) {
      lines.push(`...${selectedTeams.length - 12} more team(s)`);
    }
    lines.push(
      "",
      "Edit Selection lets staff remove team numbers or manager numbers before applying bans.",
    );
    return limitDiscordContent(lines.join("\n"));
  }

  private finalNoShowBanReviewComponents(
    token: string,
    review: PendingFinalNoShowBanReview,
  ) {
    const hasTeams = review.preview.teams.some(
      (team) => review.selectedTeamIds.has(team.teamId) && !team.alreadyBanned,
    );
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${AUTO_RESULT_BUTTON_PREFIX}final-ban-edit:${token}`)
          .setLabel("Edit Selection")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`${AUTO_RESULT_BUTTON_PREFIX}final-ban-apply:${token}`)
          .setLabel("Apply Bans")
          .setStyle(ButtonStyle.Danger)
          .setDisabled(!hasTeams),
        new ButtonBuilder()
          .setCustomId(`${AUTO_RESULT_BUTTON_PREFIX}final-ban-cancel:${token}`)
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary),
      ),
    ];
  }

  private buildFinalNoShowBanReviewModal(
    token: string,
    review: PendingFinalNoShowBanReview,
  ) {
    const selectedTeamNumbers = review.preview.teams
      .map((team, index) =>
        review.selectedTeamIds.has(team.teamId) && !team.alreadyBanned
          ? String(index + 1)
          : null,
      )
      .filter((value): value is string => Boolean(value))
      .join(",");
    const selectedManagerNumbers = this.finalNoShowManagerEntries(review)
      .filter((entry) => review.selectedManagerIds.has(entry.manager.discordUserId))
      .map((entry) => String(entry.index))
      .join(",");
    return new ModalBuilder()
      .setCustomId(`${AUTO_RESULT_BUTTON_PREFIX}final-ban-modal:${token}`)
      .setTitle("Edit no-show bans")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("teamNumbers")
            .setLabel("Teams to ban (numbers shown)")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(1000)
            .setPlaceholder("Example: 1,2,5")
            .setValue(selectedTeamNumbers),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("managerNumbers")
            .setLabel("Managers to ban (M numbers shown)")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(1000)
            .setPlaceholder("Example: 1,3,4")
            .setValue(selectedManagerNumbers),
        ),
      );
  }

  private parseNumberList(value: string, max: number) {
    const trimmed = value.trim();
    if (!trimmed) {
      return new Set<number>();
    }
    const numbers = new Set<number>();
    for (const part of trimmed.split(/[\s,]+/)) {
      if (!part) continue;
      const normalized = part.replace(/^m/i, "");
      const parsed = Number(normalized);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
        throw new Error(`Invalid number: ${part}`);
      }
      numbers.add(parsed);
    }
    return numbers;
  }

  private storePendingFinalNoShowBanReview(
    input: Omit<PendingFinalNoShowBanReview, "expiresAt">,
  ) {
    const token = `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    this.pendingFinalNoShowBanReviews.set(token, {
      ...input,
      expiresAt: Date.now() + FINAL_NO_SHOW_BAN_REVIEW_MS,
    });
    return token;
  }

  private async createFinalNoShowBanReview(
    interaction: ButtonInteraction,
    pending: AutoResultPending,
  ) {
    let command: DiscordNoShowTeamBanCommand;
    try {
      command = this.noShowBanCommandForFinalResult(pending);
    } catch (error) {
      return {
        posted: false,
        status:
          error instanceof Error
            ? `No-show ban review not created: ${error.message}`
            : "No-show ban review not created.",
      };
    }

    let preview: Awaited<
      ReturnType<DiscordSessionService["previewNoShowTeamBansFromDiscord"]>
    >;
    try {
      preview = await this.withOrganization(pending.config.organizationId, () =>
        this.sessionService.previewNoShowTeamBansFromDiscord(command),
      );
    } catch (error) {
      return {
        posted: false,
        status:
          error instanceof Error && error.message.trim()
            ? `No-show ban review not created: ${error.message.trim()}`
            : "No-show ban review not created.",
      };
    }

    const selectedTeams = preview.response.teams.filter(
      (team) => !team.alreadyBanned,
    );
    if (!selectedTeams.length) {
      return {
        posted: false,
        status: "No-show ban review skipped: no new ban candidates.",
      };
    }
    const selectedTeamIds = new Set(selectedTeams.map((team) => team.teamId));
    const selectedManagerIds = new Set(
      selectedTeams.flatMap((team) =>
        (team.managers ?? []).map((manager) => manager.discordUserId),
      ),
    );
    const token = this.storePendingFinalNoShowBanReview({
      userId: interaction.user.id,
      sessionId: pending.sessionId,
      matchId: pending.matchId,
      command,
      config: pending.config,
      preview: preview.response,
      selectedTeamIds,
      selectedManagerIds,
    });
    const review = this.pendingFinalNoShowBanReviews.get(token);
    if (!review) {
      return {
        posted: false,
        status: "No-show ban review could not be prepared.",
      };
    }
    const channel = interaction.channel;
    if (!channel || !("send" in channel)) {
      return {
        posted: false,
        status: "No-show ban review could not be posted in this channel.",
      };
    }
    await (channel as GuildTextBasedChannel).send({
      content: this.finalNoShowBanReviewContent(review),
      components: this.finalNoShowBanReviewComponents(token, review),
      allowedMentions: { parse: [] },
    });
    return {
      posted: true,
      status: `No-show ban review posted with ${selectedTeams.length} team candidate(s).`,
    };
  }

  private async handleFinalNoShowBanReviewButton(
    interaction: ButtonInteraction,
    parsed: {
      action: "final-ban-edit" | "final-ban-apply" | "final-ban-cancel";
      token: string;
    },
  ) {
    this.pruneExpiredAutoNoShowBans();
    const review = this.pendingFinalNoShowBanReviews.get(parsed.token);
    if (!review) {
      await interaction.reply({
        content: "This no-show ban review expired.",
        ephemeral: true,
      });
      return true;
    }
    if (!this.hasInteractionStaffAccess(interaction, review.config)) {
      await interaction.reply({
        content: "Only Arenzyra staff can manage no-show bans.",
        ephemeral: true,
      });
      return true;
    }
    if (parsed.action === "final-ban-edit") {
      await interaction.showModal(
        this.buildFinalNoShowBanReviewModal(parsed.token, review),
      );
      return true;
    }
    if (parsed.action === "final-ban-cancel") {
      this.pendingFinalNoShowBanReviews.delete(parsed.token);
      await interaction.update({
        content: "No-show ban review cancelled.",
        components: [],
        allowedMentions: { parse: [] },
      });
      return true;
    }
    if (review.processing) {
      await interaction.reply({
        content: "This ban review is already being applied.",
        ephemeral: true,
      });
      return true;
    }
    if (!interaction.guild) {
      await interaction.reply({
        content: "Run this control inside the Discord server.",
        ephemeral: true,
      });
      return true;
    }
    const teamIds = review.preview.teams
      .filter(
        (team) =>
          review.selectedTeamIds.has(team.teamId) && !team.alreadyBanned,
      )
      .map((team) => team.teamId);
    if (!teamIds.length) {
      await interaction.reply({
        content: "No teams are selected for bans.",
        ephemeral: true,
      });
      return true;
    }
    review.processing = true;
    await interaction.update({
      content: "Applying no-show bans...",
      components: [],
      allowedMentions: { parse: [] },
    });
    try {
      const result = await this.withOrganization(
        review.config.organizationId,
        () =>
          this.sessionService.createNoShowTeamBansFromDiscord(
            {
              ...review.command,
              teamIds,
              managerDiscordUserIds:
                this.selectedFinalNoShowManagerIds(review),
            },
            interaction.guild,
            {
              actorDiscordId: interaction.user.id,
              actorLabel: interaction.user.tag,
              sourceChannelId: interaction.channelId,
            },
          ),
      );
      this.pendingFinalNoShowBanReviews.delete(parsed.token);
      await interaction.editReply({
        content: limitDiscordContent(result),
        components: [],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      review.processing = false;
      await interaction.editReply({
        content:
          error instanceof Error && error.message.trim()
            ? error.message.trim()
            : "No-show bans failed.",
        components: this.finalNoShowBanReviewComponents(parsed.token, review),
        allowedMentions: { parse: [] },
      });
    }
    return true;
  }

  private async handleFinalNoShowBanReviewModal(
    interaction: ModalSubmitInteraction,
    parsed: { token: string },
  ) {
    this.pruneExpiredAutoNoShowBans();
    const review = this.pendingFinalNoShowBanReviews.get(parsed.token);
    if (!review) {
      await interaction.reply({
        content: "This no-show ban review expired.",
        ephemeral: true,
      });
      return true;
    }
    if (!this.hasInteractionStaffAccess(interaction, review.config)) {
      await interaction.reply({
        content: "Only Arenzyra staff can edit no-show bans.",
        ephemeral: true,
      });
      return true;
    }

    let teamNumbers: Set<number>;
    let managerNumbers: Set<number>;
    const previousManagerEntries = this.finalNoShowManagerEntries(review);
    try {
      teamNumbers = this.parseNumberList(
        this.modalTextValue(interaction, "teamNumbers"),
        review.preview.teams.length,
      );
      managerNumbers = this.parseNumberList(
        this.modalTextValue(interaction, "managerNumbers"),
        previousManagerEntries.length,
      );
    } catch (error) {
      await interaction.reply({
        content: error instanceof Error ? error.message : String(error),
        ephemeral: true,
      });
      return true;
    }

    review.selectedTeamIds = new Set(
      review.preview.teams
        .map((team, index) =>
          teamNumbers.has(index + 1) && !team.alreadyBanned
            ? team.teamId
            : null,
        )
        .filter((teamId): teamId is string => Boolean(teamId)),
    );
    review.selectedManagerIds = new Set(
      previousManagerEntries
        .filter((entry) => managerNumbers.has(entry.index))
        .filter((entry) => review.selectedTeamIds.has(entry.teamId))
        .map((entry) => entry.manager.discordUserId),
    );
    const payload = {
      content: this.finalNoShowBanReviewContent(review),
      components: this.finalNoShowBanReviewComponents(parsed.token, review),
      allowedMentions: { parse: [] },
    };
    const messageInteraction = interaction as unknown as {
      update?: (options: typeof payload) => Promise<unknown>;
      message?: { edit?: (options: typeof payload) => Promise<unknown> };
    };
    if (typeof messageInteraction.update === "function") {
      await messageInteraction.update(payload);
    } else {
      await interaction.reply({
        content: "No-show ban review updated.",
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      await messageInteraction.message?.edit?.(payload).catch(() => null);
    }
    return true;
  }

  private async handleAutoNoShowBanPreview(
    interaction: ButtonInteraction,
    pending: AutoResultPending,
  ) {
    await interaction.deferReply({ ephemeral: true });

    let command: DiscordNoShowTeamBanCommand;
    try {
      command = this.noShowBanCommandForAutoResult(pending);
    } catch (error) {
      await interaction.editReply({
        content: error instanceof Error ? error.message : String(error),
        allowedMentions: { parse: [] },
      });
      return;
    }

    let preview: Awaited<
      ReturnType<DiscordSessionService["previewNoShowTeamBansFromDiscord"]>
    >;
    try {
      preview = await this.withOrganization(
        pending.config.organizationId,
        () => this.sessionService.previewNoShowTeamBansFromDiscord(command),
      );
    } catch (error) {
      await interaction.editReply({
        content:
          error instanceof Error && error.message.trim()
            ? error.message.trim()
            : "No-show ban preview failed.",
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (preview.response.creatableCount === 0) {
      await interaction.editReply({
        content: preview.content,
        allowedMentions: { parse: [] },
      });
      return;
    }

    const token = this.storePendingAutoNoShowBan({
      userId: interaction.user.id,
      sourceMessageId: pending.sourceMessageId,
      sessionId: pending.sessionId,
      matchId: pending.matchId,
      command,
      config: pending.config,
    });
    await interaction.editReply({
      content: limitDiscordContent(
        [
          preview.content,
          "",
          "This creates bans for teams already marked no-show in this match.",
          "Confirm within 60 seconds.",
        ].join("\n"),
      ),
      components: this.autoNoShowBanConfirmationComponents(token),
      allowedMentions: { parse: [] },
    });
  }

  private async handleAutoNoShowBanConfirmationButton(
    interaction: ButtonInteraction,
    parsed: { action: "ban-confirm" | "ban-cancel"; token: string },
  ) {
    this.pruneExpiredAutoNoShowBans();
    const pending = this.pendingAutoNoShowBans.get(parsed.token);
    if (!pending) {
      await interaction.reply({
        content: "This no-show ban confirmation expired.",
        ephemeral: true,
      });
      return true;
    }

    if (pending.userId !== interaction.user.id) {
      await interaction.reply({
        content: "Only the staff member who opened this confirmation can use it.",
        ephemeral: true,
      });
      return true;
    }

    if (!this.hasInteractionStaffAccess(interaction, pending.config)) {
      await interaction.reply({
        content: "Only Arenzyra staff can ban missing teams.",
        ephemeral: true,
      });
      return true;
    }

    this.pendingAutoNoShowBans.delete(parsed.token);
    if (parsed.action === "ban-cancel") {
      await interaction.update({
        content: "No-show ban cancelled.",
        components: [],
        allowedMentions: { parse: [] },
      });
      return true;
    }

    if (!interaction.guild) {
      await interaction.update({
        content: "Run this control inside the Discord server.",
        components: [],
        allowedMentions: { parse: [] },
      });
      return true;
    }

    await interaction.update({
      content: "Banning no-show teams...",
      components: [],
      allowedMentions: { parse: [] },
    });

    try {
      const result = await this.withOrganization(
        pending.config.organizationId,
        () =>
          this.sessionService.createNoShowTeamBansFromDiscord(
            pending.command,
            interaction.guild,
            {
              actorDiscordId: interaction.user.id,
              actorLabel: interaction.user.tag,
              sourceChannelId: interaction.channelId,
            },
          ),
      );
      await interaction.editReply({
        content: limitDiscordContent(result),
        components: [],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      await interaction.editReply({
        content:
          error instanceof Error && error.message.trim()
            ? error.message.trim()
            : "No-show ban failed.",
        components: [],
        allowedMentions: { parse: [] },
      });
    }
    return true;
  }

  private isMissingSlotMapError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return message
      .toLowerCase()
      .includes("slot/player screenshot mapping is required");
  }

  private missingSlotMapResponse(pending: AutoResultPending) {
    const gameLabel = pending.matchLabel.trim() || "this game";
    return limitDiscordContent(
      [
        "Cannot apply no-shows yet.",
        `Send the slot/player screenshot for ${gameLabel} first, then refresh this review and try again.`,
        "Current results were not applied.",
      ].join("\n"),
    );
  }

  private autoResultSourceLink(pending: AutoResultPending) {
    return `https://discord.com/channels/${pending.sourceGuildId}/${pending.sourceChannelId}/${pending.sourceMessageId}`;
  }

  private formatAutoResultDashboard(pending: AutoResultPending) {
    const includedCount = pending.rows.filter((row) => row.include).length;
    const skippedCount = pending.rows.length - includedCount;
    const issues = this.reviewIssues(pending);
    const noShowCandidates = this.noShowCandidateSlots(pending);
    const lines = [
      "Result Review Panel",
      `Manage ${pending.matchLabel}`,
      `Source: ${this.autoResultSourceLink(pending)}`,
      "",
      issues.length > 0 ? "Status: cannot apply yet" : "Status: ready to apply",
      issues.length > 0
        ? issues
            .slice(0, 5)
            .map((issue) => `- ${issue}`)
            .join("\n")
        : "No blocking issues found.",
      "",
      pending.imageUrls.length > 1
        ? `Images: ${pending.imageUrls.length}`
        : null,
      "Slot source: official scrim slot list",
      `Ban-count candidates: ${noShowCandidates.length}`,
      `Rows: ${includedCount} apply / ${skippedCount} skipped`,
      "",
      "1 Preview details",
      "2 Apply result",
      "3 Apply + Ban Count",
      "4 Final result",
      "Final result opens a separate no-show ban review before bans are created.",
      "Clear cancels this review. Refresh rechecks the current edits.",
      "",
      "Use the menu to edit a row when a blocker is shown.",
    ].filter((line): line is string => line !== null);
    return limitDiscordContent(lines.join("\n"));
  }

  private formatAutoResultDetails(pending: AutoResultPending) {
    const issues = this.reviewIssues(pending);
    const lines = [
      `Preview details for ${pending.matchLabel}`,
      issues.length > 0 ? "Fix before apply:" : "Ready to apply.",
      ...issues.slice(0, 5).map((issue) => `- ${issue}`),
      "",
      ...pending.rows
        .slice(0, 18)
        .map((row, index) => this.reviewedRowLine(row, index)),
    ];
    if (pending.rows.length > 18) {
      lines.push(`...${pending.rows.length - 18} more rows`);
    }
    return limitDiscordContent(lines.join("\n"));
  }

  private playerKillsSummary(
    players?: Array<{ name: string; kills: number }> | null,
  ) {
    const validPlayers = (players ?? [])
      .filter(
        (player) =>
          player.name?.trim() &&
          Number.isInteger(player.kills) &&
          player.kills >= 0,
      )
      .slice(0, 4);
    if (!validPlayers.length) {
      return "";
    }

    const summary = validPlayers
      .map((player) => `${player.name.trim()} ${player.kills}`)
      .join(", ");
    const more = (players?.length ?? 0) > validPlayers.length ? ", ..." : "";
    return ` | players: ${this.truncateOptionText(`${summary}${more}`, 96)}`;
  }

  private formatPlayerKillsInput(
    players?: Array<{ name: string; kills: number }> | null,
  ) {
    return (players ?? [])
      .filter(
        (player) =>
          player.name?.trim() &&
          Number.isInteger(player.kills) &&
          player.kills >= 0,
      )
      .slice(0, 8)
      .map((player) => `${player.name.trim()}=${player.kills}`)
      .join("\n")
      .slice(0, 1000);
  }

  private autoResultComponents(pending: AutoResultPending) {
    if (!pending.rows.length) {
      return [];
    }

    const components: Array<
      ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>
    > = [];
    const options = pending.rows.slice(0, 25).map((row, index) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(this.reviewedRowLabel(row, index))
        .setDescription(
          this.truncateOptionText(
            `${row.include ? "Apply" : "Skip"} row. Select to edit.`,
            100,
          ),
        )
        .setValue(String(index)),
    );

    if (options.length > 0) {
      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(
              `${AUTO_RESULT_BUTTON_PREFIX}edit:${pending.sourceMessageId}`,
            )
            .setPlaceholder("Edit or skip an OCR row")
            .addOptions(options),
        ),
      );
    }

    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            `${AUTO_RESULT_BUTTON_PREFIX}preview:${pending.sourceMessageId}`,
          )
          .setLabel("1 Preview")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(
            `${AUTO_RESULT_BUTTON_PREFIX}apply:${pending.sourceMessageId}`,
          )
          .setLabel("2 Apply")
          .setStyle(ButtonStyle.Success)
          .setDisabled(this.reviewIssues(pending).length > 0),
        new ButtonBuilder()
          .setCustomId(
            `${AUTO_RESULT_BUTTON_PREFIX}apply-noshow:${pending.sourceMessageId}`,
          )
          .setLabel("3 Apply + Ban Count")
          .setStyle(ButtonStyle.Danger)
          .setDisabled(this.reviewIssues(pending).length > 0),
        new ButtonBuilder()
          .setCustomId(
            `${AUTO_RESULT_BUTTON_PREFIX}final:${pending.sourceMessageId}`,
          )
          .setLabel("4 Final")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(this.reviewIssues(pending).length > 0),
      ),
    );

    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            `${AUTO_RESULT_BUTTON_PREFIX}refresh:${pending.sourceMessageId}`,
          )
          .setLabel("Refresh")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(
            `${AUTO_RESULT_BUTTON_PREFIX}cancel:${pending.sourceMessageId}`,
          )
          .setLabel("Clear Review")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(
            `${AUTO_RESULT_BUTTON_PREFIX}add-row:${pending.sourceMessageId}`,
          )
          .setLabel("Add Row")
          .setStyle(ButtonStyle.Secondary),
      ),
    );

    return components;
  }

  private buildAutoResultEditModal(
    sourceMessageId: string,
    rowIndex: number,
    row: ReviewedResultRow,
  ) {
    return new ModalBuilder()
      .setCustomId(
        `${AUTO_RESULT_BUTTON_PREFIX}modal:${sourceMessageId}:${rowIndex}`,
      )
      .setTitle(`Edit OCR row ${rowIndex + 1}`)
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("include")
            .setLabel("Apply this row? yes/no")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(row.include ? "yes" : "no"),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("position")
            .setLabel("Placement")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(String(row.position)),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("kills")
            .setLabel("Kills")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(String(row.kills)),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("slot")
            .setLabel("Official slot number")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setValue(row.slotNumber ? String(row.slotNumber) : ""),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("players")
            .setLabel("Player kills (blank = team only)")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(1000)
            .setPlaceholder("Player One=5\nPlayer Two=3")
          .setValue(this.formatPlayerKillsInput(row.players)),
        ),
      );
  }

  private buildAutoResultAddRowModal(
    sourceMessageId: string,
    pending: AutoResultPending,
  ) {
    return new ModalBuilder()
      .setCustomId(`${AUTO_RESULT_BUTTON_PREFIX}add-modal:${sourceMessageId}`)
      .setTitle("Add result row")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("position")
            .setLabel("Placement")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(String(this.nextResultPlacement(pending))),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("kills")
            .setLabel("Kills")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue("0"),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("slot")
            .setLabel("Official slot number")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder("Example: 7"),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("players")
            .setLabel("Player kills (blank = team only)")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(1000)
            .setPlaceholder("Player One=5\nPlayer Two=3"),
        ),
      );
  }

  private parseYesNo(value: string) {
    const normalized = value.trim().toLowerCase();
    if (["yes", "y", "true", "1", "apply", "include"].includes(normalized)) {
      return true;
    }
    if (["no", "n", "false", "0", "skip", "ignore"].includes(normalized)) {
      return false;
    }
    return null;
  }

  private parseNonNegativeInteger(value: string, label: string) {
    const parsed = Number(value.trim());
    if (!Number.isInteger(parsed) || parsed < 0) {
      return { ok: false as const, error: `${label} must be a whole number.` };
    }
    return { ok: true as const, value: parsed };
  }

  private modalTextValue(
    interaction: ModalSubmitInteraction,
    customId: string,
  ) {
    try {
      return interaction.fields.getTextInputValue(customId);
    } catch {
      return "";
    }
  }

  private normalizePlayerKillName(value: string) {
    return value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  private parsePlayerKillsInput(value: string, teamKills: number) {
    const raw = value.trim();
    if (!raw) {
      return { ok: true as const, players: [] };
    }

    const hasLineSeparators = /[\r\n;]/.test(raw);
    const entries = raw
      .split(hasLineSeparators ? /\r?\n|;/g : /,/g)
      .map((entry) => entry.trim().replace(/^[-*]\s*/, ""))
      .filter(Boolean);

    if (entries.length > 8) {
      return {
        ok: false as const,
        error: "Use at most 8 player kill rows.",
      };
    }

    const seen = new Set<string>();
    const players: Array<{ name: string; kills: number }> = [];
    for (const entry of entries) {
      const match = /^(.+?)(?:\s*(?:=|:|-)\s*|\s+)(\d+)$/.exec(entry);
      if (!match) {
        return {
          ok: false as const,
          error:
            "Player kills must use one row per player, like `Player Name=5`.",
        };
      }

      const name = match[1].trim();
      const kills = Number(match[2]);
      if (!name || name.length > 80 || !Number.isInteger(kills) || kills < 0) {
        return {
          ok: false as const,
          error:
            "Each player kill row needs a player name and a whole kill number.",
        };
      }

      const key = this.normalizePlayerKillName(name);
      if (!key) {
        return {
          ok: false as const,
          error: "Each player kill row needs a readable player name.",
        };
      }
      if (seen.has(key)) {
        return {
          ok: false as const,
          error: `Duplicate player in player kills: ${name}.`,
        };
      }
      seen.add(key);
      players.push({ name, kills });
    }

    const total = players.reduce((sum, player) => sum + player.kills, 0);
    if (total !== teamKills) {
      return {
        ok: false as const,
        error: `Player kills must add up to team kills (${teamKills}). Current player total is ${total}.`,
      };
    }

    return { ok: true as const, players };
  }

  private findSlotByNumber(pending: AutoResultPending, slotNumber: number) {
    return pending.slots.find((slot) => slot.slotNumber === slotNumber) ?? null;
  }

  private readEditedResultRow(
    interaction: ModalSubmitInteraction,
    pending: AutoResultPending,
    current: ReviewedResultRow,
  ): { ok: true; row: ReviewedResultRow } | { ok: false; error: string } {
    const include = this.parseYesNo(
      this.modalTextValue(interaction, "include"),
    );
    if (include === null) {
      return { ok: false, error: "Apply this row must be yes or no." };
    }

    const position = this.parseNonNegativeInteger(
      this.modalTextValue(interaction, "position"),
      "Placement",
    );
    if (!position.ok || position.value < 1) {
      return { ok: false, error: "Placement must be 1 or higher." };
    }

    const kills = this.parseNonNegativeInteger(
      this.modalTextValue(interaction, "kills"),
      "Kills",
    );
    if (!kills.ok) {
      return kills;
    }

    const players = this.parsePlayerKillsInput(
      this.modalTextValue(interaction, "players"),
      kills.value,
    );
    if (!players.ok) {
      return players;
    }

    const slotInput = this.modalTextValue(interaction, "slot").trim();
    if (!include) {
      return {
        ok: true,
        row: {
          ...current,
          include: false,
          position: position.value,
          kills: kills.value,
          players: players.players,
          edited: true,
        },
      };
    }

    const slotNumberResult = this.parseNonNegativeInteger(
      slotInput,
      "Official slot number",
    );
    if (!slotNumberResult.ok || slotNumberResult.value < 1) {
      return {
        ok: false,
        error: "Official slot number is required when applying a row.",
      };
    }

    const slot = this.findSlotByNumber(pending, slotNumberResult.value);
    const canKeepCurrentSlot =
      current.slotNumber === slotNumberResult.value &&
      current.slotId &&
      current.teamId;
    if (!slot && !canKeepCurrentSlot) {
      return {
        ok: false,
        error: `Slot ${slotNumberResult.value} was not found in the official slot list.`,
      };
    }

    const slotId = slot?.id ?? current.slotId;
    const teamId = slot?.teamId ?? current.teamId;
    if (!slotId || !teamId) {
      return {
        ok: false,
        error: `Slot ${slotNumberResult.value} does not have a registered team.`,
      };
    }

    return {
      ok: true,
      row: {
        ...current,
        include: true,
        edited: true,
        position: position.value,
        kills: kills.value,
        players: players.players,
        slotId,
        teamId,
        slotNumber: slotNumberResult.value,
        tag: slot?.team?.tag?.trim() || current.tag,
        teamName: slot?.team?.name?.trim() || current.teamName || null,
        status: "OK",
        reason: undefined,
      },
    };
  }

  private readAddedResultRow(
    interaction: ModalSubmitInteraction,
    pending: AutoResultPending,
  ): { ok: true; row: ReviewedResultRow } | { ok: false; error: string } {
    const position = this.parseNonNegativeInteger(
      this.modalTextValue(interaction, "position"),
      "Placement",
    );
    if (!position.ok || position.value < 1) {
      return { ok: false, error: "Placement must be 1 or higher." };
    }

    const kills = this.parseNonNegativeInteger(
      this.modalTextValue(interaction, "kills"),
      "Kills",
    );
    if (!kills.ok) {
      return kills;
    }

    const players = this.parsePlayerKillsInput(
      this.modalTextValue(interaction, "players"),
      kills.value,
    );
    if (!players.ok) {
      return players;
    }

    const slotNumberResult = this.parseNonNegativeInteger(
      this.modalTextValue(interaction, "slot"),
      "Official slot number",
    );
    if (!slotNumberResult.ok || slotNumberResult.value < 1) {
      return {
        ok: false,
        error: "Official slot number is required when adding a row.",
      };
    }

    const slot = this.findSlotByNumber(pending, slotNumberResult.value);
    if (!slot) {
      return {
        ok: false,
        error: `Slot ${slotNumberResult.value} was not found in the official slot list.`,
      };
    }
    if (!slot.teamId) {
      return {
        ok: false,
        error: `Slot ${slotNumberResult.value} does not have a registered team.`,
      };
    }

    const tag =
      slot.team?.tag?.trim() ||
      slot.team?.name?.trim() ||
      `S${slot.slotNumber}`;

    return {
      ok: true,
      row: {
        position: position.value,
        tag,
        kills: kills.value,
        players: players.players,
        teamName: slot.team?.name?.trim() || null,
        teamId: slot.teamId,
        slotId: slot.id,
        slotNumber: slot.slotNumber,
        status: "OK",
        include: true,
        edited: true,
      },
    };
  }

  private async refreshAutoResultDashboard(
    interaction: Pick<ModalSubmitInteraction, "client">,
    pending: AutoResultPending,
  ) {
    await this.updateAutoResultPanels(interaction, pending, {
      content: this.formatAutoResultDashboard(pending),
      components: this.autoResultComponents(pending),
      allowedMentions: { parse: [] },
    });
  }

  private async updateAutoResultPanels(
    interaction: Pick<ButtonInteraction | ModalSubmitInteraction, "client">,
    pending: AutoResultPending,
    payload: {
      content: string;
      components: Array<
        ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>
      >;
      allowedMentions: { parse: [] };
    },
  ) {
    const targets = [
      {
        channelId: pending.dashboardChannelId,
        messageId: pending.dashboardMessageId,
      },
      pending.reviewPanelChannelId && pending.reviewPanelMessageId
        ? {
            channelId: pending.reviewPanelChannelId,
            messageId: pending.reviewPanelMessageId,
          }
        : null,
    ];
    const seen = new Set<string>();
    const channelClient = (
      interaction.client as unknown as {
        channels?: { fetch?: (channelId: string) => Promise<unknown> };
      }
    )?.channels;
    const fetchChannel = channelClient?.fetch;
    if (!fetchChannel) {
      return;
    }
    for (const target of targets) {
      if (!target) continue;
      const key = `${target.channelId}:${target.messageId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const channel = (await fetchChannel
        .call(channelClient, target.channelId)
        .catch(() => null)) as GuildTextBasedChannel | null;
      if (!channel?.isTextBased() || channel.isDMBased()) {
        continue;
      }

      const message = await (channel as GuildTextBasedChannel).messages
        .fetch(target.messageId)
        .catch(() => null);
      await message?.edit(payload).catch(() => undefined);
    }
  }

  private async postAutoResultReviewPanel(
    sourceMessage: Message,
    pending: AutoResultPending,
  ): Promise<boolean> {
    const reviewChannelId = this.resultReviewChannelId(pending.config);
    if (
      !reviewChannelId ||
      reviewChannelId === pending.dashboardChannelId ||
      !sourceMessage.guild
    ) {
      return false;
    }

    const fetchChannel = (
      sourceMessage.guild as unknown as {
        channels?: { fetch?: (channelId: string) => Promise<unknown> };
      }
    ).channels?.fetch;
    if (!fetchChannel) {
      return false;
    }

    const channel = (await fetchChannel
      .call(sourceMessage.guild.channels, reviewChannelId)
      .catch(() => null)) as GuildTextBasedChannel | null;
    if (!channel?.isTextBased() || channel.isDMBased()) {
      return false;
    }

    const sent = await (channel as GuildTextBasedChannel)
      .send({
        content: this.formatAutoResultDashboard(pending),
        components: this.autoResultComponents(pending),
        allowedMentions: { parse: [] },
      })
      .catch(() => null);
    if (!sent) {
      return false;
    }
    pending.reviewPanelChannelId = reviewChannelId;
    pending.reviewPanelMessageId = sent.id;
    return true;
  }

  private resultAttachments(result: ApplyResultsDiscordResponse) {
    return result.imageFiles?.length
      ? result.imageFiles.map(
          (file) => new AttachmentBuilder(file.buffer, { name: file.name }),
        )
      : result.imageBuffer
        ? [new AttachmentBuilder(result.imageBuffer, { name: "result.png" })]
        : [];
  }

  private async handleAutomaticResultScreenshot(
    message: Message,
    imageUrls: string[],
  ): Promise<boolean> {
    if (!message.guild) {
      return false;
    }

    const resolved = await this.sessionService.findScrimForDiscordChannel(
      message.guild.id,
      message.channel.id,
      this.channelTopic(message.channel),
    );
    if (!resolved || resolved.channelKind !== "screenshots") {
      return false;
    }

    if (!this.hasStaffAccess(message, resolved.config)) {
      await message.reply({
        content: "Only Arenzyra staff can submit result screenshots here.",
        allowedMentions: { parse: [] },
      });
      return true;
    }

    const matchNumber = this.parseResultGameCode(message.content);
    if (!matchNumber) {
      await this.react(message, REGISTER_REJECT_REACTION);
      await this.sendDiscordActionLog(message.guild, resolved.config, {
        action: "OCR screenshot rejected",
        actorDiscordId: message.author.id,
        actorLabel: message.author.tag,
        sourceChannelId: message.channel.id,
        sessionId: resolved.session.id,
        sessionName: resolved.session.name,
        status: "missing game code",
        reason: "Screenshot message did not include G1, match 1, M1, etc.",
        color: 0xef4444,
      });
      await message.reply({
        content:
          "Add a game code with the result screenshot, for example `G1`, `match 1`, or `M1` when game 1 is finished.",
        allowedMentions: { parse: [] },
      });
      return true;
    }

    await this.react(message, REGISTER_PROCESSING_REACTION);
    const screenshotMode = this.parseAutomaticScreenshotMode(message.content);
    const pendingReply = await message.reply({
      content:
        screenshotMode === "slot-map"
          ? `Reading G${matchNumber} slot/player screenshot and saving OCR mappings...`
          : `Reading G${matchNumber} result screenshot and matching it with the official slot list...`,
      allowedMentions: { parse: [] },
    });

    try {
      const preview = await this.withOrganization(
        resolved.config.organizationId,
        () =>
          this.sessionService.previewAutomaticResultScreenshot(
            resolved.session.id,
            imageUrls,
            screenshotMode,
            resolved.config,
            { matchNumber },
          ),
      );
      if (preview.mode === "slot-map") {
        await pendingReply.edit({
          content: limitDiscordContent(preview.content),
          components: [],
          allowedMentions: { parse: [] },
        });
        await this.finishRegisterReaction(message, REGISTER_SUCCESS_REACTION);
        await this.sendDiscordActionLog(message.guild, resolved.config, {
          action: "OCR slot map saved",
          actorDiscordId: message.author.id,
          actorLabel: message.author.tag,
          sourceChannelId: message.channel.id,
          sessionId: resolved.session.id,
          sessionName: resolved.session.name,
          status: `G${matchNumber}`,
          details: preview.content,
          color: 0x22c55e,
        });
        return true;
      }

      const rows = this.toReviewedRows(preview);
      const dashboardMessageId =
        (pendingReply as { id?: string }).id?.trim() || message.id;
      const pending: AutoResultPending | null =
        preview.mode === "results" && rows.length > 0
          ? {
              sessionId: resolved.session.id,
              matchId: preview.matchId,
              matchLabel: preview.matchLabel,
              imageUrl: preview.imageUrl,
              imageUrls: preview.imageUrls?.length
                ? preview.imageUrls
                : imageUrls,
              sourceGuildId: message.guild.id,
              sourceMessageId: message.id,
              sourceChannelId: message.channel.id,
              dashboardChannelId:
                (pendingReply as { channel?: { id?: string } }).channel?.id ??
                message.channel.id,
              dashboardMessageId,
              config: resolved.config,
              rows,
              slots: preview.slots ?? [],
              expiresAt: Date.now() + AUTO_RESULT_PENDING_TTL_MS,
            }
          : null;

      if (pending) {
        this.pendingAutoResults.set(message.id, pending);
      }

      let dashboardHasReviewControls = Boolean(pending);
      if (pending) {
        const reviewChannelId = this.resultReviewChannelId(resolved.config);
        if (reviewChannelId && reviewChannelId !== pending.dashboardChannelId) {
          dashboardHasReviewControls = !(await this.postAutoResultReviewPanel(
            message,
            pending,
          ));
        }
      }

      await pendingReply.edit({
        content: pending
          ? dashboardHasReviewControls
            ? this.formatAutoResultDashboard(pending)
            : [
                `${this.registrationReaction("check", "check", resolved.config)} Result review is ready in <#${pending.reviewPanelChannelId}>.`,
                `Source: ${this.autoResultSourceLink(pending)}`,
              ].join("\n")
          : limitDiscordContent(preview.content),
        components:
          pending && dashboardHasReviewControls
            ? this.autoResultComponents(pending)
            : [],
        allowedMentions: { parse: [] },
      });
      const skippedRows =
        pending?.rows.filter((row) => !row.include).length ?? 0;
      await this.finishRegisterReaction(
        message,
        pending && this.reviewIssues(pending).length === 0 && skippedRows === 0
          ? REGISTER_SUCCESS_REACTION
          : REGISTER_WARNING_REACTION,
      );
      await this.sendDiscordActionLog(message.guild, resolved.config, {
        action: pending ? "OCR result preview ready" : "OCR result parsed",
        actorDiscordId: message.author.id,
        actorLabel: message.author.tag,
        sourceChannelId: message.channel.id,
        sessionId: resolved.session.id,
        sessionName: resolved.session.name,
        status: `G${matchNumber}`,
        details: [
          `Match: ${preview.matchLabel}`,
          `Rows: ${rows.length}`,
          `Skipped: ${skippedRows}`,
          pending ? `Review message: ${pending.dashboardMessageId}` : "",
        ],
        color:
          pending &&
          this.reviewIssues(pending).length === 0 &&
          skippedRows === 0
            ? 0x22c55e
            : 0xf59e0b,
      });
      return true;
    } catch (error) {
      const reason =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : "Screenshot preview failed.";
      await pendingReply
        .edit({
          content: limitDiscordContent(reason),
          components: [],
          allowedMentions: { parse: [] },
        })
        .catch(() => undefined);
      await this.finishRegisterReaction(message, REGISTER_REJECT_REACTION);
      await this.sendDiscordActionLog(message.guild, resolved.config, {
        action: "OCR screenshot failed",
        actorDiscordId: message.author.id,
        actorLabel: message.author.tag,
        sourceChannelId: message.channel.id,
        sessionId: resolved.session.id,
        sessionName: resolved.session.name,
        status: `G${matchNumber}`,
        reason,
        color: 0xef4444,
      });
      return true;
    }
  }

  private async handleLogoMessage(message: Message): Promise<boolean> {
    await this.react(message, REGISTER_PROCESSING_REACTION);

    if (!message.guild) {
      await this.finishRegisterReaction(message, REGISTER_REJECT_REACTION);
      await message.reply({
        content: "Use `%logo` inside a synced server logo channel.",
        allowedMentions: { parse: [] },
      });
      return true;
    }

    try {
      const guild = message.guild;
      const resolved = await this.sessionService.findScrimForLogoChannel(
        guild.id,
        message.channel.id,
        this.channelTopic(message.channel),
      );
      if (!resolved) {
        await this.finishRegisterReaction(message, REGISTER_REJECT_REACTION);
        await message.reply({
          content: "This command only works inside a synced logo channel.",
          allowedMentions: { parse: [] },
        });
        return true;
      }

      const parsed = this.parseLogoMessage(message);
      const logoSource = this.findLogoSource(message);
      const logoUpload = await this.loadLogoUpload(logoSource?.url ?? null);
      if (!logoUpload) {
        throw new Error(this.logoUsageMessage());
      }
      const pendingSource = this.toDiscordTeamLogoSource(
        message,
        parsed.teamName,
        null,
        logoSource,
      );

      const reply = await this.withOrganization(
        resolved.config.organizationId,
        () =>
          this.sessionService.updateTeamLogoFromDiscord(
            parsed.teamName,
            logoUpload,
            resolved.config,
            pendingSource,
            resolved.organizationLogoChannel
              ? { savePendingToActiveGuildSessions: { guildId: guild.id } }
              : undefined,
          ),
      );
      await this.finishRegisterReaction(message, REGISTER_SUCCESS_REACTION);
      await message.reply({
        content: reply,
        allowedMentions: { parse: [] },
      });
      this.sessionService.queueVisibleDiscordScrimRefresh(
        message.guild,
        resolved.session.id,
        resolved.config,
      );
      await this.sendDiscordActionLog(message.guild, resolved.config, {
        action: "Team logo saved",
        actorDiscordId: message.author.id,
        actorLabel: message.author.tag,
        sourceChannelId: message.channel.id,
        sessionId: resolved.session.id,
        sessionName: resolved.session.name,
        team: { name: parsed.teamName },
        status: "saved",
        details: reply,
        color: 0x22c55e,
      });
      return true;
    } catch (error) {
      await this.finishRegisterReaction(message, REGISTER_REJECT_REACTION);
      const reason =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : "Logo sync failed. Please check the format and image.";
      await message
        .reply({
          content: reason,
          allowedMentions: { parse: [] },
        })
        .catch(() => undefined);
      return true;
    }
  }

  private async handlePlayerPhotoMessage(message: Message): Promise<boolean> {
    await this.react(message, REGISTER_PROCESSING_REACTION);

    if (!message.guild) {
      await this.finishRegisterReaction(message, REGISTER_REJECT_REACTION);
      await message.reply({
        content: "Use `%photo` inside a synced player photo channel.",
        allowedMentions: { parse: [] },
      });
      return true;
    }

    try {
      const guild = message.guild;
      const resolved = await this.sessionService.findScrimForPlayerPhotoChannel(
        guild.id,
        message.channel.id,
        this.channelTopic(message.channel),
      );
      if (!resolved) {
        await this.finishRegisterReaction(message, REGISTER_REJECT_REACTION);
        await message.reply({
          content:
            "This command only works inside a synced player photo channel.",
          allowedMentions: { parse: [] },
        });
        return true;
      }

      const parsed = this.parsePlayerPhotoMessage(
        message,
        resolved.config.registrationMode,
      );
      const photoSource = this.findLogoSource(message, "Player photo");
      const photoUpload = await this.loadPlayerPhotoUpload(
        photoSource?.url ?? null,
      );
      if (!photoUpload) {
        throw new Error(this.playerPhotoUsageMessage(resolved.config));
      }

      const reply = await this.withOrganization(
        resolved.config.organizationId,
        () =>
          this.sessionService.updatePlayerPhotoFromDiscord(
            parsed,
            photoUpload,
            resolved.config,
          ),
      );
      await this.finishRegisterReaction(message, REGISTER_SUCCESS_REACTION);
      await message.reply({
        content: reply,
        allowedMentions: { parse: [] },
      });
      this.sessionService.queueVisibleDiscordScrimRefresh(
        message.guild,
        resolved.session.id,
        resolved.config,
      );
      await this.sendDiscordActionLog(message.guild, resolved.config, {
        action: "Player photo saved",
        actorDiscordId: message.author.id,
        actorLabel: message.author.tag,
        sourceChannelId: message.channel.id,
        sessionId: resolved.session.id,
        sessionName: resolved.session.name,
        team: parsed.teamName ? { name: parsed.teamName } : undefined,
        status: parsed.uid,
        details: reply,
        color: 0x22c55e,
      });
      return true;
    } catch (error) {
      await this.finishRegisterReaction(message, REGISTER_REJECT_REACTION);
      const reason =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : "Player photo sync failed. Please check the format and image.";
      await message
        .reply({
          content: reason,
          allowedMentions: { parse: [] },
        })
        .catch(() => undefined);
      return true;
    }
  }

  private async handleResultSummaryMessage(message: Message): Promise<boolean> {
    if (!message.guild) {
      await message.reply({
        content: "Use `%result-summary` inside the Discord server.",
        allowedMentions: { parse: [] },
      });
      return true;
    }

    const resolved = await this.sessionService.findScrimForDiscordChannel(
      message.guild.id,
      message.channel.id,
      this.channelTopic(message.channel),
    );
    if (!resolved) {
      await message.reply({
        content:
          "Use `%result-summary` inside a configured scrim Discord channel.",
        allowedMentions: { parse: [] },
      });
      return true;
    }
    if (!this.hasStaffAccess(message, resolved.config)) {
      await message.reply({
        content: "Only Arenzyra staff can edit result summary settings.",
        allowedMentions: { parse: [] },
      });
      return true;
    }

    const parsed = this.parseResultSummaryCommand(message.content);
    if (!parsed.ok) {
      await message.reply({
        content: parsed.error,
        allowedMentions: { parse: [] },
      });
      return true;
    }

    try {
      const content = await this.withOrganization(
        resolved.config.organizationId,
        () =>
          this.sessionService.updateResultSummaryConfig(
            resolved.session.id,
            parsed.patch,
          ),
      );
      await message.reply({
        content,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      await message.reply({
        content:
          error instanceof Error && error.message.trim()
            ? error.message.trim()
            : "Failed to update result summary settings.",
        allowedMentions: { parse: [] },
      });
    }
    return true;
  }

  private async handleConfirmSlotMessage(message: Message): Promise<boolean> {
    const deleteCommandMessage = async () => {
      if (typeof message.delete !== "function") {
        return;
      }
      await message.delete().catch(() => undefined);
    };

    if (!message.guild) {
      await this.replyWithNoMentionAutoDelete(
        message,
        "Use `%confirm 22` inside a configured scrim Discord channel.",
        CONFIRM_SLOT_REPLY_DELETE_DELAY_MS,
      );
      return true;
    }

    const match = CONFIRM_SLOT_COMMAND_PATTERN.exec(message.content.trim());
    const slotNumber = Number.parseInt(match?.[1] ?? "", 10);
    if (!Number.isInteger(slotNumber) || slotNumber < 1) {
      await this.replyWithNoMentionAutoDelete(
        message,
        "Use `%confirm 22` with the slot number from the slot list.",
        CONFIRM_SLOT_REPLY_DELETE_DELAY_MS,
      );
      await deleteCommandMessage();
      return true;
    }

    const resolved = await this.sessionService.findScrimForDiscordChannel(
      message.guild.id,
      message.channel.id,
      this.channelTopic(message.channel),
    );
    if (!resolved) {
      await this.replyWithNoMentionAutoDelete(
        message,
        "Use `%confirm 22` inside a configured scrim Discord channel.",
        CONFIRM_SLOT_REPLY_DELETE_DELAY_MS,
      );
      await deleteCommandMessage();
      return true;
    }

    try {
      const result = await this.withOrganization(
        resolved.config.organizationId,
        () =>
          this.sessionService.confirmSlotFromDiscord(
            message.author.id,
            message.author.tag ?? message.author.username ?? null,
            slotNumber,
            message.guild,
            resolved.session.id,
            {
              actorDiscordId: message.author.id,
              actorLabel: message.author.tag ?? message.author.username,
              sourceChannelId: message.channel.id,
              sessionName: resolved.session.name,
            },
          ),
      );
      await this.replyWithNoMentionAutoDelete(
        message,
        result,
        CONFIRM_SLOT_REPLY_DELETE_DELAY_MS,
      );
    } catch (error) {
      await this.replyWithNoMentionAutoDelete(
        message,
        toFriendlyApiError(error),
        CONFIRM_SLOT_REPLY_DELETE_DELAY_MS,
      );
    }
    await deleteCommandMessage();
    return true;
  }

  private async handleBanTeamMessage(message: Message): Promise<boolean> {
    if (!message.guild) {
      await message.reply("Use `%ban-team` inside the Discord server.");
      return true;
    }

    const resolved = await this.sessionService.findScrimForDiscordChannel(
      message.guild.id,
      message.channel.id,
      this.channelTopic(message.channel),
    );
    if (!this.hasStaffAccess(message, resolved?.config ?? null)) {
      await message.reply("Only Arenzyra staff can ban teams.");
      return true;
    }

    const parsed = this.parseBanCommand(message, BAN_TEAM_COMMAND_PATTERN);
    const scope =
      parsed.scope ??
      (parsed.matchNumbers.length || parsed.allMatches
        ? "MATCH"
        : resolved
          ? "SESSION"
          : "TEAM");
    const command: DiscordTeamBanCommand = {
      target: this.resolveBanTarget(message, parsed.remaining),
      scope,
      sessionId: resolved?.session.id ?? null,
      matchNumbers: parsed.matchNumbers,
      allMatches: parsed.allMatches,
      serverAction: parsed.serverAction,
      days: parsed.days,
      reason: parsed.reason,
    };

    const reply = resolved
      ? await this.withOrganization(resolved.config.organizationId, () =>
          this.sessionService.createTeamBanFromDiscord(command, message.guild, {
            actorDiscordId: message.author.id,
            actorLabel: message.author.tag,
            sourceChannelId: message.channel.id,
            sessionName: resolved.session.name,
          }),
        )
      : await this.sessionService.createTeamBanFromDiscord(
          command,
          message.guild,
          {
            actorDiscordId: message.author.id,
            actorLabel: message.author.tag,
            sourceChannelId: message.channel.id,
          },
        );
    await message.reply({ content: reply, allowedMentions: { parse: [] } });
    return true;
  }

  private async handleBanMissingTeamsMessage(
    message: Message,
  ): Promise<boolean> {
    if (!message.guild) {
      await message.reply("Use `%ban-missing` inside the Discord server.");
      return true;
    }

    const resolved = await this.sessionService.findScrimForDiscordChannel(
      message.guild.id,
      message.channel.id,
      this.channelTopic(message.channel),
    );
    if (!resolved) {
      await message.reply(
        "Use `%ban-missing` inside a configured scrim Discord channel.",
      );
      return true;
    }
    if (!this.hasStaffAccess(message, resolved.config)) {
      await message.reply("Only Arenzyra staff can ban missing teams.");
      return true;
    }

    let parsed: ParsedBanOptions;
    try {
      parsed = this.parseBanCommand(message, BAN_MISSING_COMMAND_PATTERN, {
        inferMatchScope: false,
      });
    } catch (error) {
      await message.reply({
        content: error instanceof Error ? error.message : String(error),
        allowedMentions: { parse: [] },
      });
      return true;
    }
    if (parsed.matchNumbers.length > 1) {
      await message.reply({
        content: "Use one match at a time, for example `%ban-missing match=1`.",
        allowedMentions: { parse: [] },
      });
      return true;
    }

    const command: DiscordNoShowTeamBanCommand = {
      sessionId: resolved.session.id,
      matchNumber: parsed.matchNumbers[0] ?? null,
      scope: parsed.scope ?? "SESSION",
      days: parsed.days ?? 3,
      reason: parsed.reason,
      note: "Created from Discord no-show command",
    };

    let preview: Awaited<
      ReturnType<DiscordSessionService["previewNoShowTeamBansFromDiscord"]>
    >;
    try {
      preview = await this.withOrganization(
        resolved.config.organizationId,
        () => this.sessionService.previewNoShowTeamBansFromDiscord(command),
      );
    } catch (error) {
      await message.reply({
        content:
          error instanceof Error && error.message.trim()
            ? error.message.trim()
            : "No-show ban preview failed.",
        allowedMentions: { parse: [] },
      });
      return true;
    }

    if (preview.response.creatableCount === 0) {
      await message.reply({
        content: preview.content,
        allowedMentions: { parse: [] },
      });
      return true;
    }

    const confirmation = await this.confirmDestructiveAction(message, {
      actionId: "ban-missing",
      summary: limitDiscordContent(
        [
          preview.content,
          "",
          command.scope === "MATCH"
            ? "This creates match bans for the listed no-show teams."
            : "This creates bans and removes the listed teams from affected Discord slots/waitlists.",
        ].join("\n"),
      ),
      confirmLabel: "Ban No-Shows",
      runningText: "Banning no-show teams...",
      cancelledText: "No-show ban cancelled.",
      timeoutText: "No-show ban confirmation timed out.",
    });
    if (!confirmation.confirmed) {
      return true;
    }

    await message.delete().catch(() => undefined);
    try {
      const result = await this.withOrganization(
        resolved.config.organizationId,
        () =>
          this.sessionService.createNoShowTeamBansFromDiscord(
            command,
            message.guild,
            {
              actorDiscordId: message.author.id,
              actorLabel: message.author.tag,
              sourceChannelId: message.channel.id,
              sessionName: resolved.session.name,
            },
          ),
      );
      await confirmation.prompt?.edit({
        content: limitDiscordContent(result),
        components: [],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      await confirmation.prompt?.edit({
        content:
          error instanceof Error && error.message.trim()
            ? error.message.trim()
            : "No-show ban failed.",
        components: [],
        allowedMentions: { parse: [] },
      });
    }
    return true;
  }

  private async handleUnbanTeamMessage(message: Message): Promise<boolean> {
    if (!message.guild) {
      await message.reply("Use `%unban-team` inside the Discord server.");
      return true;
    }

    const resolved = await this.sessionService.findScrimForDiscordChannel(
      message.guild.id,
      message.channel.id,
      this.channelTopic(message.channel),
    );
    if (!this.hasStaffAccess(message, resolved?.config ?? null)) {
      await message.reply("Only Arenzyra staff can unban teams.");
      return true;
    }

    const parsed = this.parseBanCommand(message, UNBAN_TEAM_COMMAND_PATTERN);
    const command: DiscordTeamUnbanCommand = {
      target: this.resolveBanTarget(message, parsed.remaining),
      scope: parsed.scope,
      sessionId: resolved?.session.id ?? null,
      matchNumbers: parsed.matchNumbers,
      allMatches: parsed.allMatches,
      reason: parsed.reason,
    };

    const reply = resolved
      ? await this.withOrganization(resolved.config.organizationId, () =>
          this.sessionService.revokeTeamBansFromDiscord(
            command,
            message.guild,
            {
              actorDiscordId: message.author.id,
              actorLabel: message.author.tag,
              sourceChannelId: message.channel.id,
              sessionName: resolved.session.name,
            },
          ),
        )
      : await this.sessionService.revokeTeamBansFromDiscord(
          command,
          message.guild,
          {
            actorDiscordId: message.author.id,
            actorLabel: message.author.tag,
            sourceChannelId: message.channel.id,
          },
        );
    await message.reply({ content: reply, allowedMentions: { parse: [] } });
    return true;
  }

  private async handleBanListMessage(message: Message): Promise<boolean> {
    if (!message.guild) {
      await message.reply("Use `%ban-list` inside the Discord server.");
      return true;
    }

    const resolved = await this.sessionService.findScrimForDiscordChannel(
      message.guild.id,
      message.channel.id,
      this.channelTopic(message.channel),
    );
    if (!this.hasStaffAccess(message, resolved?.config ?? null)) {
      await message.reply("Only Arenzyra staff can list team bans.");
      return true;
    }

    const reply = resolved
      ? await this.withOrganization(resolved.config.organizationId, () =>
          this.sessionService.listTeamBansForDiscord(resolved.session.id),
        )
      : await this.sessionService.listTeamBansForDiscord(null);
    await message.reply({ content: reply, allowedMentions: { parse: [] } });
    return true;
  }

  private parseBanCommand(
    message: Message,
    commandPattern: RegExp,
    options: { inferMatchScope?: boolean } = {},
  ): ParsedBanOptions {
    let remaining = message.content.replace(commandPattern, "").trim();
    let reason: string | null = null;
    const reasonPattern = /\s+(?:reason|because)[:=]\s*([\s\S]+)$/i;
    const reasonMatch = reasonPattern.exec(remaining);
    if (reasonMatch) {
      reason = reasonMatch[1].trim() || null;
      remaining = remaining.slice(0, reasonMatch.index).trim();
    }

    let scope: ParsedBanOptions["scope"] = null;
    let days: number | null = null;
    const matchNumbers: number[] = [];
    let allMatches = false;
    let serverAction: DiscordTeamBanServerAction | null = null;
    const optionPattern =
      /\b(scope|days|duration|match|matches|server|action)=(?:"([^"]+)"|([^\s]+))/gi;
    remaining = remaining
      .replace(
        optionPattern,
        (_full, key: string, quoted?: string, bare?: string) => {
          const value = (quoted ?? bare ?? "").trim();
          const normalizedKey = key.toLowerCase();
          if (normalizedKey === "scope") {
            const parsedScope = this.parseBanScope(value);
            scope = parsedScope.scope;
            allMatches ||= parsedScope.allMatches;
            serverAction = parsedScope.serverAction ?? serverAction;
            return "";
          }
          if (normalizedKey === "days" || normalizedKey === "duration") {
            days = this.parseBanDays(value);
            return "";
          }
          if (normalizedKey === "server" || normalizedKey === "action") {
            serverAction = this.parseBanServerAction(value);
            return "";
          }
          if (this.isAllMatchesValue(value)) {
            allMatches = true;
            return "";
          }
          matchNumbers.push(...this.parseMatchNumbers(value));
          return "";
        },
      )
      .replace(/\s+/g, " ")
      .trim();

    if (
      options.inferMatchScope !== false &&
      (matchNumbers.length > 0 || allMatches) &&
      !scope
    ) {
      scope = "MATCH";
    }

    return {
      scope,
      days,
      reason,
      matchNumbers: [...new Set(matchNumbers)],
      allMatches,
      serverAction,
      remaining,
    };
  }

  private parseBanScope(
    value: string,
  ): Pick<ParsedBanOptions, "scope" | "allMatches" | "serverAction"> {
    const normalized = value.trim().toLowerCase();
    if (
      ["team", "team-wide", "teamwide", "all", "global", "everywhere"].includes(
        normalized,
      )
    ) {
      return { scope: "TEAM", allMatches: false, serverAction: null };
    }
    if (["server", "guild", "discord-server"].includes(normalized)) {
      return {
        scope: "TEAM",
        allMatches: false,
        serverAction: "DISCORD_BAN",
      };
    }
    if (["scrim", "session", "current"].includes(normalized)) {
      return { scope: "SESSION", allMatches: false, serverAction: null };
    }
    if (
      ["match", "matches", "all-matches", "allmatches"].includes(normalized)
    ) {
      return {
        scope: "MATCH",
        allMatches: normalized.startsWith("all"),
        serverAction: null,
      };
    }
    throw new Error(
      "Use scope=team, scope=session, scope=match, or scope=server.",
    );
  }

  private isAllMatchesValue(value: string): boolean {
    return ["all", "all-matches", "allmatches", "*"].includes(
      value.trim().toLowerCase(),
    );
  }

  private parseBanServerAction(value: string): DiscordTeamBanServerAction {
    const normalized = value.trim().toLowerCase();
    if (["none", "off", "false", "no"].includes(normalized)) {
      return "NONE";
    }
    if (["role", "banned-role", "ban-role"].includes(normalized)) {
      return "ROLE";
    }
    if (["ban", "server-ban", "discord-ban", "kick-ban"].includes(normalized)) {
      return "DISCORD_BAN";
    }
    throw new Error("Use action=role, action=discord-ban, or action=none.");
  }

  private parseBanDays(value: string): number {
    const match = /^(\d{1,3})(?:d|day|days)?$/i.exec(value.trim());
    if (!match) {
      throw new Error("Use days=3 or duration=3d.");
    }
    const days = Number.parseInt(match[1], 10);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw new Error("Ban duration must be between 1 and 365 days.");
    }
    return days;
  }

  private parseMatchNumbers(value: string): number[] {
    return value
      .split(/[,\s]+/)
      .map((entry) => Number.parseInt(entry.replace(/^#/, ""), 10))
      .filter((entry) => Number.isInteger(entry) && entry > 0);
  }

  private resolveBanTarget(
    message: Message,
    remaining: string,
  ): DiscordTeamBanTarget {
    const botUserId = message.client.user?.id ?? null;
    const mentionedManager = message.mentions.users.find(
      (user) => user.id !== botUserId,
    );
    if (mentionedManager) {
      return { kind: "manager", discordUserId: mentionedManager.id };
    }

    const query = remaining
      .replace(/<@!?\d+>/g, "")
      .trim()
      .replace(/^"|"$/g, "")
      .trim();
    if (!query) {
      throw new Error("Add a team name or mention the team manager.");
    }
    return { kind: "team", query };
  }

  private async handleNoCommandRegisterMessage(
    message: Message,
    inputMode: RegistrationInputMode,
  ): Promise<boolean> {
    if (!message.guild) {
      return false;
    }

    const resolved = await this.sessionService.findScrimForRegistrationChannel(
      message.guild.id,
      message.channel.id,
      this.channelTopic(message.channel),
    );
    if (!resolved) {
      return false;
    }

    return this.handleRegisterMessage(message, inputMode, resolved);
  }

  private async handleWaitlistPromotionMessage(
    message: Message,
  ): Promise<boolean> {
    if (!message.guild) {
      return false;
    }

    const resolver = (
      this.sessionService as unknown as {
        findScrimForWaitlistChannel?: DiscordSessionService["findScrimForWaitlistChannel"];
      }
    ).findScrimForWaitlistChannel;
    if (typeof resolver !== "function") {
      return false;
    }

    const resolved = await resolver.call(
      this.sessionService,
      message.guild.id,
      message.channel.id,
      this.channelTopic(message.channel),
    );
    if (!resolved) {
      return false;
    }
    if (!this.markRegistrationMessageProcessing(message)) {
      return true;
    }

    await this.react(message, REGISTER_PROCESSING_REACTION);
    let finalReactionSent = false;
    const finishRegistrationReaction = async (emoji: string) => {
      if (finalReactionSent) {
        return;
      }
      finalReactionSent = true;
      await this.finishRegisterReaction(message, emoji, resolved.config);
    };

    try {
      const parsed = await this.parseRegisterMessage(message, "SCRIM");
      const members = await this.parseMentionedManagers(message);
      return await this.withOrganization(
        resolved.config.organizationId,
        async () => {
          const staffAccess = this.hasStaffAccess(message, resolved.config);
          if (parsed.placement === "VIP") {
            await finishRegistrationReaction(
              this.registrationRejectReaction(resolved.config),
            );
            await message.reply({
              content:
                "Use normal `%register` format in the waitlist channel. VIP slots do not open waitlist promotion.",
              allowedMentions: { parse: [] },
            });
            return true;
          }

          if (!resolved.accepting && !staffAccess) {
            await finishRegistrationReaction(
              this.registrationRejectReaction(resolved.config),
            );
            await message.reply({
              content:
                "Waitlist promotion is closed. It opens only during the waitlist schedule and when a normal slot is empty.",
              allowedMentions: { parse: [] },
            });
            return true;
          }

          const content =
            await this.sessionService.promoteWaitlistedTeamFromDiscord(
              message.author.id,
              message.author.tag,
              parsed.tag,
              parsed.teamName,
              members,
              message.guild,
              resolved.session.id,
              {
                actorDiscordId: message.author.id,
                actorLabel: message.author.tag,
                sourceChannelId: message.channel.id,
                sessionName: resolved.session.name,
              },
            );
          await finishRegistrationReaction(
            this.registrationResultReaction("registered", resolved.config),
          );
          await message.reply({
            content,
            allowedMentions: { parse: [] },
          });
          return true;
        },
      );
    } catch (error) {
      await finishRegistrationReaction(
        this.isBanRegistrationError(error)
          ? this.registrationBanReaction(resolved.config)
          : this.registrationRejectReaction(resolved.config),
      );
      const reason = this.registrationErrorMessage(
        error,
        "Waitlist promotion failed. Please check the format and try again.",
      );
      await message
        .reply({
          content: reason,
          allowedMentions: { parse: [] },
        })
        .catch(() => undefined);
      return true;
    }
  }

  private async handleRegisterMessage(
    message: Message,
    inputMode: RegistrationInputMode,
    resolvedRegistration?: {
      session: { id: string; name: string };
      config: SessionDiscordConfigResponse;
      accepting: boolean;
    } | null,
  ): Promise<boolean> {
    if (!this.markRegistrationMessageProcessing(message)) {
      return true;
    }

    await this.react(message, REGISTER_PROCESSING_REACTION);
    let activeConfig: SessionDiscordConfigResponse | null = null;
    let finalReactionSent = false;
    const finishRegistrationReaction = async (
      emoji: string,
      config: SessionDiscordConfigResponse | null = activeConfig,
    ) => {
      if (finalReactionSent) {
        return;
      }
      finalReactionSent = true;
      await this.finishRegisterReaction(message, emoji, config);
    };

    if (!message.guild) {
      await finishRegistrationReaction(this.registrationRejectReaction(null));
      await message.reply(
        "Use %register inside the Discord server registration channel.",
      );
      return true;
    }

    try {
      const resolved =
        resolvedRegistration ??
        (await this.sessionService.findScrimForRegistrationChannel(
          message.guild.id,
          message.channel.id,
          this.channelTopic(message.channel),
        ));

      if (!resolved) {
        await finishRegistrationReaction(this.registrationRejectReaction(null));
        await this.replyWithAutoDelete(
          message,
          "This command only works inside a synced registration channel.",
          REGISTRATION_CHANNEL_WARNING_DELETE_DELAY_MS,
        );
        return true;
      }

      return await this.withOrganization(
        resolved.config.organizationId,
        async () => {
          activeConfig = resolved.config;
          const sessionMode = this.registrationMode(resolved.config);
          if (sessionMode !== inputMode) {
            await finishRegistrationReaction(
              this.registrationRejectReaction(resolved.config),
              resolved.config,
            );
            await this.replyWithAutoDelete(
              message,
              this.registrationUsageMessage(sessionMode),
              REGISTRATION_CHANNEL_WARNING_DELETE_DELAY_MS,
            );
            return true;
          }

          const parsed = await this.parseRegisterMessage(
            message,
            inputMode,
            resolved.config,
          );
          const staffAccess = this.hasStaffAccess(message, resolved.config);
          const vipAccess =
            parsed.placement === "VIP" && !staffAccess
              ? await this.sessionService.userHasVipRegistrationAccess(
                  message.author.id,
                  message.guild,
                  resolved.config,
                )
              : false;
          const earlyAccess =
            !resolved.accepting && !staffAccess
              ? await this.sessionService.userHasEarlyAccessRegistrationAccess(
                  message.author.id,
                  message.guild,
                  resolved.config,
                )
              : false;
          if (parsed.placement === "VIP" && !staffAccess && !vipAccess) {
            await finishRegistrationReaction(
              this.registrationRejectReaction(resolved.config),
              resolved.config,
            );
            await message.reply({
              content:
                "VIP registration is closed or you do not have the configured VIP role.",
              allowedMentions: { parse: [] },
            });
            return true;
          }
          if (
            !resolved.accepting &&
            !staffAccess &&
            !earlyAccess &&
            !vipAccess
          ) {
            const modeLabel = this.registrationModeLabel(resolved.config);
            await finishRegistrationReaction(
              this.registrationRejectReaction(resolved.config),
              resolved.config,
            );
            await this.sendDiscordActionLog(message.guild, resolved.config, {
              action: "Registration blocked",
              actorDiscordId: message.author.id,
              actorLabel: message.author.tag,
              sourceChannelId: message.channel.id,
              sessionId: resolved.session.id,
              sessionName: resolved.session.name,
              team: { name: parsed.teamName, tag: parsed.tag },
              status: "closed",
              reason: "Registration is closed for normal users",
              color: 0xef4444,
            });
            await message.reply(
              `Registration is currently closed for this ${modeLabel}.`,
            );
            return true;
          }

          const tournamentRoster = parsed.tournamentRoster ?? null;
          const members = tournamentRoster
            ? []
            : await this.parseMentionedManagers(message, resolved.config);
          const leader = tournamentRoster
            ? this.userToMemberInput(tournamentRoster.managerUser)
            : staffAccess
              ? members[0]
              : this.userToMemberInput(message.author);
          const logoUpload = await this.loadLogoUpload(parsed.logoUrl);
          const registrationOptions: {
            requesterDiscordId: string;
            registrationWindowBypass?: boolean;
            tournamentRosterJson?: Record<string, unknown>;
            logoSource?: DiscordTeamLogoSource | null;
            audit?: {
              actorDiscordId: string;
              actorLabel: string;
              sourceChannelId: string;
              sessionName: string;
            };
          } = {
            requesterDiscordId: message.author.id,
            registrationWindowBypass: earlyAccess || vipAccess,
          };
          if (this.canSendDiscordActionLog()) {
            registrationOptions.audit = {
              actorDiscordId: message.author.id,
              actorLabel: message.author.tag,
              sourceChannelId: message.channel.id,
              sessionName: resolved.session.name,
            };
          }
          if (parsed.logoSource) {
            registrationOptions.logoSource = this.toDiscordTeamLogoSource(
              message,
              parsed.teamName,
              parsed.tag,
              parsed.logoSource,
            );
          }
          if (tournamentRoster) {
            registrationOptions.tournamentRosterJson =
              this.tournamentRosterJson(tournamentRoster);
          }
          const registrationResult =
            await this.sessionService.registerTeamAndJoinScrim(
              leader.discordUserId,
              leader.discordUsername ?? leader.discordUserId,
              leader.displayName ?? null,
              parsed.tag,
              parsed.teamName,
              members,
              message.guild,
              resolved.session.id,
              null,
              logoUpload,
              {
                ...registrationOptions,
                placement: parsed.placement,
                backgroundDiscordSync: true,
                onSessionRegistration: async (result) => {
                  await finishRegistrationReaction(
                    this.registrationResultReaction(result, resolved.config),
                    resolved.config,
                  );
                },
              },
            );

          if (!finalReactionSent) {
            await finishRegistrationReaction(
              this.registrationResultReaction(
                registrationResult,
                resolved.config,
              ),
              resolved.config,
            );
          }
          return true;
        },
      );
    } catch (error) {
      await finishRegistrationReaction(
        this.isBanRegistrationError(error)
          ? this.registrationBanReaction(activeConfig)
          : this.registrationRejectReaction(activeConfig),
        activeConfig,
      );
      const reason = this.registrationErrorMessage(
        error,
        "Registration failed. Please check the format and try again.",
      );
      await message
        .reply({
          content: reason,
          allowedMentions: { parse: [] },
        })
        .catch(() => undefined);
      return true;
    }
  }

  private registrationErrorMessage(error: unknown, fallback: string) {
    const friendly = toFriendlyApiError(error).trim();
    return friendly || fallback;
  }

  private markRegistrationMessageProcessing(message: Message) {
    if (this.processingRegistrationMessageIds.has(message.id)) {
      return false;
    }

    this.processingRegistrationMessageIds.add(message.id);
    setTimeout(() => {
      this.processingRegistrationMessageIds.delete(message.id);
    }, REGISTRATION_MESSAGE_PROCESSING_TTL_MS).unref?.();
    return true;
  }

  private isBanRegistrationError(error: unknown) {
    const friendly = toFriendlyApiError(error).toLowerCase();
    return (
      friendly.includes("team is banned") ||
      friendly.includes("manager is banned") ||
      friendly.includes("banned from this scrim") ||
      friendly.includes("blocked from registering") ||
      friendly.includes("blocked from this")
    );
  }

  private async handleCleanChannelMessage(message: Message): Promise<boolean> {
    if (!message.guild) {
      await message.reply("Use `%clean-channel` inside the Discord server.");
      return true;
    }

    const parsed = this.parseCleanChannelCommand(message);
    const targetChannel =
      parsed.channelId && parsed.channelId !== message.channel.id
        ? await message.guild.channels.fetch(parsed.channelId).catch(() => null)
        : message.channel;
    if (
      !targetChannel ||
      !targetChannel.isTextBased() ||
      targetChannel.isDMBased()
    ) {
      await message.reply("Choose a server text channel to clean.");
      return true;
    }

    const textChannel = targetChannel as GuildTextBasedChannel;
    const resolved = await this.sessionService.findScrimForDiscordChannel(
      message.guild.id,
      textChannel.id,
      this.channelTopic(textChannel),
    );
    if (!this.canUseCleanChannelCommand(message, resolved?.config ?? null)) {
      await message.reply("Only Arenzyra staff can clean a channel.");
      return true;
    }

    const protectedIds = this.protectedMessageIds(resolved);
    const targets = await this.collectCleanChannelTargets(
      textChannel,
      parsed.limit,
      protectedIds,
    );
    const summary = this.cleanChannelSummary(
      targets.length,
      textChannel.id,
      parsed,
      resolved,
    );

    if (parsed.dryRun) {
      await message.reply(
        `${summary}\nDry run only. Add \`confirm\` to delete.`,
      );
      return true;
    }

    if (targets.length === 0) {
      await message.reply(`${summary}\nNothing to delete.`);
      return true;
    }

    const confirmation = await this.confirmCleanChannel(message, summary);
    if (!confirmation.confirmed) {
      return true;
    }

    const result = await this.deleteCleanChannelTargets(targets);
    await confirmation.prompt?.delete().catch(() => undefined);
    const replyChannel = message.channel as GuildTextBasedChannel;
    const reply = await replyChannel.send({
      content: `Cleaned <#${textChannel.id}>: deleted ${result.deleted}/${targets.length} message(s).`,
      allowedMentions: { parse: [] },
    });
    await this.logCleanChannelResult(
      message,
      textChannel,
      resolved,
      parsed,
      result,
    );
    setTimeout(() => {
      void reply.delete().catch(() => undefined);
    }, CLEAN_CONFIRMATION_DELETE_DELAY_MS).unref?.();
    return true;
  }

  private async handleCleanAllSlotsMessage(message: Message): Promise<boolean> {
    if (!message.guild) {
      await message.reply(
        "Use `%clean-all-slots` inside the Discord server slot-list channel.",
      );
      return true;
    }

    const resolved = await this.sessionService.findScrimForSlotListChannel(
      message.guild.id,
      message.channel.id,
      this.channelTopic(message.channel),
    );
    if (!resolved) {
      await message.reply(
        "This command only works inside a synced slot-list channel for an active scrim.",
      );
      return true;
    }

    if (!this.canUseCleanCommand(message, resolved.config)) {
      await message.reply("Only Arenzyra staff can clean slots.");
      return true;
    }

    const confirmation = await this.confirmDestructiveAction(message, {
      actionId: "clean-all-slots",
      summary: [
        `Clean all assigned slots for ${resolved.session.name}.`,
        "This removes every normal/VIP slot team from the scrim.",
        "Waitlist entries are kept.",
      ].join("\n"),
      confirmLabel: "Clean Slots",
      runningText: "Cleaning all assigned slots...",
      cancelledText: "Clean all slots cancelled.",
      timeoutText: "Clean all slots confirmation timed out.",
    });
    if (!confirmation.confirmed) {
      return true;
    }
    await message.delete().catch(() => undefined);
    const result = await this.withOrganization(
      resolved.config.organizationId,
      () =>
        this.sessionService.cleanAllSlotsFromScrim(
          resolved.session.id,
          message.guild,
          {
            actorDiscordId: message.author.id,
            actorLabel: message.author.tag,
            sourceChannelId: message.channel.id,
            sessionName: resolved.session.name,
          },
        ),
    );
    const prompt = await confirmation.prompt?.edit(result);
    setTimeout(() => {
      void prompt?.delete().catch(() => undefined);
    }, CLEAN_CONFIRMATION_DELETE_DELAY_MS).unref?.();
    return true;
  }

  private async handleCleanWaitlistMessage(message: Message): Promise<boolean> {
    if (!message.guild) {
      await message.reply(
        "Use `%clean-waitlist` inside the Discord server slot-list or waitlist channel.",
      );
      return true;
    }

    const resolved = await this.sessionService.findScrimForDiscordChannel(
      message.guild.id,
      message.channel.id,
      this.channelTopic(message.channel),
    );
    if (
      !resolved ||
      !["slot-list", "waitlist"].includes(resolved.channelKind)
    ) {
      await message.reply(
        "This command only works inside a synced slot-list or waitlist channel for an active scrim.",
      );
      return true;
    }

    if (!this.canUseCleanCommand(message, resolved.config)) {
      await message.reply("Only Arenzyra staff can clean the waitlist.");
      return true;
    }

    const confirmation = await this.confirmDestructiveAction(message, {
      actionId: "clean-waitlist",
      summary: [
        `Clean waitlist for ${resolved.session.name}.`,
        "This removes every waitlist team from the scrim.",
        "Assigned slot teams are kept.",
      ].join("\n"),
      confirmLabel: "Clean Waitlist",
      runningText: "Cleaning waitlist...",
      cancelledText: "Clean waitlist cancelled.",
      timeoutText: "Clean waitlist confirmation timed out.",
    });
    if (!confirmation.confirmed) {
      return true;
    }
    await message.delete().catch(() => undefined);
    const result = await this.withOrganization(
      resolved.config.organizationId,
      () =>
        this.sessionService.cleanWaitlistFromScrim(
          resolved.session.id,
          message.guild,
          {
            actorDiscordId: message.author.id,
            actorLabel: message.author.tag,
            sourceChannelId: message.channel.id,
            sessionName: resolved.session.name,
          },
        ),
    );
    const prompt = await confirmation.prompt?.edit(result);
    setTimeout(() => {
      void prompt?.delete().catch(() => undefined);
    }, CLEAN_CONFIRMATION_DELETE_DELAY_MS).unref?.();
    return true;
  }

  private async handleCleanScrimRolesMessage(
    message: Message,
  ): Promise<boolean> {
    if (!message.guild) {
      await message.reply(
        "Use `%clean-scrim-roles` inside the Discord server slot-list channel.",
      );
      return true;
    }

    const resolved = await this.sessionService.findScrimForSlotListChannel(
      message.guild.id,
      message.channel.id,
      this.channelTopic(message.channel),
    );
    if (!resolved) {
      await message.reply(
        "This command only works inside a synced slot-list channel for an active scrim.",
      );
      return true;
    }

    if (!this.canUseCleanCommand(message, resolved.config)) {
      await message.reply("Only Arenzyra staff can clean scrim roles.");
      return true;
    }

    const match = CLEAN_SCRIM_ROLES_COMMAND_PATTERN.exec(
      message.content.trim(),
    );
    const mode: "strip" | "reconcile" = match?.[1] ? "strip" : "reconcile";
    const confirmation = await this.confirmDestructiveAction(message, {
      actionId: `clean-scrim-roles-${mode}`,
      summary:
        mode === "strip"
          ? [
              `Remove all managed scrim roles for ${resolved.session.name}.`,
              "This strips slot, waitlist, and IDP roles from cached members.",
            ].join("\n")
          : [
              `Reconcile managed scrim roles for ${resolved.session.name}.`,
              "This removes wrong scrim roles and adds missing correct roles.",
            ].join("\n"),
      confirmLabel: mode === "strip" ? "Strip Roles" : "Reconcile Roles",
      runningText:
        mode === "strip"
          ? "Removing all managed scrim roles..."
          : "Reconciling managed scrim roles...",
      cancelledText: "Scrim role cleanup cancelled.",
      timeoutText: "Scrim role cleanup confirmation timed out.",
    });
    if (!confirmation.confirmed) {
      return true;
    }
    await message.delete().catch(() => undefined);
    const result = await this.withOrganization(
      resolved.config.organizationId,
      () =>
        this.sessionService.cleanScrimRolesFromScrim(
          resolved.session.id,
          message.guild,
          mode,
          {
            actorDiscordId: message.author.id,
            actorLabel: message.author.tag,
            sourceChannelId: message.channel.id,
            sessionName: resolved.session.name,
          },
        ),
    );
    const prompt = await confirmation.prompt?.edit(result);
    setTimeout(() => {
      void prompt?.delete().catch(() => undefined);
    }, CLEAN_CONFIRMATION_DELETE_DELAY_MS).unref?.();
    return true;
  }

  private async handleCleanSlotMessage(message: Message): Promise<boolean> {
    if (!message.guild) {
      await message.reply(
        "Use %clean inside the Discord server slot-list channel.",
      );
      return true;
    }

    const match = CLEAN_COMMAND_PATTERN.exec(message.content.trim());
    const slotNumber = Number.parseInt(match?.[1] ?? "", 10);
    if (!Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 100) {
      await message.reply(
        "Use `%clean 7` inside the synced slot-list channel.",
      );
      return true;
    }

    const resolved = await this.sessionService.findScrimForSlotListChannel(
      message.guild.id,
      message.channel.id,
      this.channelTopic(message.channel),
    );
    if (!resolved) {
      await message.reply(
        "This command only works inside a synced slot-list channel for an active scrim.",
      );
      return true;
    }

    if (!this.canUseCleanCommand(message, resolved.config)) {
      await message.reply("Only Arenzyra staff can clean a slot.");
      return true;
    }

    const confirmation = await this.confirmDestructiveAction(message, {
      actionId: `clean-slot-${slotNumber}`,
      summary: [
        `Clean slot #${slotNumber} for ${resolved.session.name}.`,
        "This removes that team from the scrim and releases its roster links.",
      ].join("\n"),
      confirmLabel: "Clean Slot",
      runningText: `Cleaning slot #${slotNumber}...`,
      cancelledText: `Clean slot #${slotNumber} cancelled.`,
      timeoutText: `Clean slot #${slotNumber} confirmation timed out.`,
    });
    if (!confirmation.confirmed) {
      return true;
    }
    await message.delete().catch(() => undefined);
    const result = await this.withOrganization(
      resolved.config.organizationId,
      () =>
        this.sessionService.cleanSlotFromScrim(
          resolved.session.id,
          slotNumber,
          message.guild,
          {
            actorDiscordId: message.author.id,
            actorLabel: message.author.tag,
            sourceChannelId: message.channel.id,
            sessionName: resolved.session.name,
          },
        ),
    );
    const prompt = await confirmation.prompt?.edit(result);
    setTimeout(() => {
      void prompt?.delete().catch(() => undefined);
    }, CLEAN_CONFIRMATION_DELETE_DELAY_MS).unref?.();
    return true;
  }

  private canUseCleanCommand(
    message: Message,
    config: SessionDiscordConfigResponse,
  ) {
    return this.hasStaffAccess(message, config);
  }

  private canUseCleanChannelCommand(
    message: Message,
    config: SessionDiscordConfigResponse | null,
  ) {
    return this.hasStaffAccess(message, config);
  }

  private async confirmDestructiveAction(
    message: Message,
    opts: {
      actionId: string;
      summary: string;
      confirmLabel: string;
      runningText: string;
      cancelledText: string;
      timeoutText: string;
    },
  ): Promise<DestructiveActionConfirmation> {
    const confirmId = `destructive:${opts.actionId}:confirm:${message.id}`;
    const cancelId = `destructive:${opts.actionId}:cancel:${message.id}`;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(confirmId)
        .setLabel(opts.confirmLabel)
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(cancelId)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );
    const prompt = await message.reply({
      content: `${opts.summary}\nConfirm within 30 seconds.`,
      components: [row],
      allowedMentions: { parse: [] },
    });

    return new Promise<DestructiveActionConfirmation>((resolve) => {
      let pending: PendingDestructiveAction | null = null;
      const timeout = setTimeout(() => {
        if (!pending || pending.completed) {
          return;
        }
        this.finishPendingDestructiveAction(pending);
        void prompt
          .edit({
            content: opts.timeoutText,
            components: [],
          })
          .catch(() => undefined);
        this.deleteCleanConfirmationPromptSoon(prompt);
        resolve({ confirmed: false, prompt });
      }, DESTRUCTIVE_ACTION_CONFIRMATION_MS);
      timeout.unref?.();

      pending = {
        authorId: message.author.id,
        confirmId,
        cancelId,
        prompt,
        runningText: opts.runningText,
        cancelledText: opts.cancelledText,
        timeout,
        completed: false,
        resolve,
      };
      this.pendingDestructiveActions.set(confirmId, pending);
      this.pendingDestructiveActions.set(cancelId, pending);
    });
  }

  private async handleDestructiveActionButton(
    interaction: ButtonInteraction,
  ): Promise<boolean> {
    const pending = this.pendingDestructiveActions.get(interaction.customId);
    if (!pending || pending.completed) {
      await interaction.reply({
        content: "This confirmation expired. Run the command again.",
        ephemeral: true,
      });
      return true;
    }

    if (interaction.user.id !== pending.authorId) {
      await interaction.reply({
        content: "Only the staff member who started this action can use it.",
        ephemeral: true,
      });
      return true;
    }

    await interaction.deferUpdate();

    pending.completed = true;
    this.pendingDestructiveActions.delete(pending.confirmId);
    this.pendingDestructiveActions.delete(pending.cancelId);
    clearTimeout(pending.timeout);

    if (interaction.customId === pending.cancelId) {
      await pending.prompt.edit({
        content: pending.cancelledText,
        components: [],
      });
      this.deleteCleanConfirmationPromptSoon(pending.prompt);
      pending.resolve({ confirmed: false, prompt: pending.prompt });
      return true;
    }

    await pending.prompt.edit({
      content: pending.runningText,
      components: [],
    });
    pending.resolve({ confirmed: true, prompt: pending.prompt });
    return true;
  }

  private finishPendingDestructiveAction(pending: PendingDestructiveAction) {
    pending.completed = true;
    this.pendingDestructiveActions.delete(pending.confirmId);
    this.pendingDestructiveActions.delete(pending.cancelId);
    clearTimeout(pending.timeout);
  }

  private deleteCleanConfirmationPromptSoon(prompt: Message) {
    setTimeout(() => {
      void prompt.delete().catch(() => undefined);
    }, CLEAN_CONFIRMATION_DELETE_DELAY_MS).unref?.();
  }

  private hasStaffAccess(
    message: Message,
    config: SessionDiscordConfigResponse | null,
  ) {
    const member = message.member;
    if (!member) {
      return false;
    }

    if (
      member.permissions.has(PermissionFlagsBits.Administrator) ||
      member.permissions.has(PermissionFlagsBits.ManageGuild) ||
      member.permissions.has(PermissionFlagsBits.ManageChannels) ||
      member.permissions.has(PermissionFlagsBits.ManageMessages)
    ) {
      return true;
    }

    const configuredManageRoleIds = (config?.manageRoleIds ?? []).filter(
      (roleId) => roleId.trim().length > 0,
    );
    const staffRoleIds =
      configuredManageRoleIds.length > 0
        ? configuredManageRoleIds
        : [config?.emojis?.staffRoleId ?? ""].filter(
            (roleId) => roleId.trim().length > 0,
          );
    if (staffRoleIds.some((roleId) => member.roles.cache.has(roleId))) {
      return true;
    }

    if (configuredManageRoleIds.length > 0) {
      return false;
    }

    return STAFF_ROLE_NAMES.some((roleName) =>
      member.roles.cache.some((role) => role.name === roleName),
    );
  }

  private registrationModeLabel(config: SessionDiscordConfigResponse | null) {
    const mode = this.registrationMode(config);
    if (mode === "TOURNAMENT") return "tournament";
    if (mode === "EVENT") return "event";
    return "scrim";
  }

  private registrationMode(
    config: Pick<SessionDiscordConfigResponse, "registrationMode"> | null,
  ): RegistrationInputMode {
    const mode = String(config?.registrationMode ?? "SCRIM").toUpperCase();
    if (mode === "EVENT" || mode === "TOURNAMENT") {
      return mode;
    }
    return "SCRIM";
  }

  private detectNoCommandRegistrationMode(
    content: string,
  ): Exclude<RegistrationInputMode, "SCRIM"> | null {
    if (REGISTER_COMMAND_PATTERN.test(content)) {
      return null;
    }
    const fields = content
      .split("|")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (
      fields.length >= 3 &&
      Boolean(fields[0]) &&
      Boolean(fields[1]) &&
      DISCORD_USER_MENTION_PATTERN.test(fields.slice(2).join(" | "))
    ) {
      return "EVENT";
    }

    const normalized = content.toLowerCase();
    const hasTournamentKey =
      /\bteam\s+name\s*:/i.test(content) ||
      /\bteam\s+manager\s*:/i.test(content) ||
      /\bplayer\s+[1-4]\s+name\s*:/i.test(content);
    const hasMultiLineMention =
      content.split(/\r?\n/).filter((line) => line.trim()).length >= 4 &&
      DISCORD_USER_MENTION_PATTERN.test(content);
    if (
      hasTournamentKey ||
      (hasMultiLineMention && !normalized.includes("|"))
    ) {
      return "TOURNAMENT";
    }

    return null;
  }

  private hasInteractionStaffAccess(
    interaction:
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction,
    config: SessionDiscordConfigResponse | null,
  ) {
    const permissions = interaction.memberPermissions;
    if (
      permissions?.has(PermissionFlagsBits.Administrator) ||
      permissions?.has(PermissionFlagsBits.ManageGuild) ||
      permissions?.has(PermissionFlagsBits.ManageChannels) ||
      permissions?.has(PermissionFlagsBits.ManageMessages)
    ) {
      return true;
    }

    const member = interaction.member as
      | {
          roles?:
            | string[]
            | {
                cache?: {
                  has(roleId: string): boolean;
                  some(
                    predicate: (role: { name?: string }) => boolean,
                  ): boolean;
                };
              };
        }
      | null
      | undefined;
    const configuredManageRoleIds = (config?.manageRoleIds ?? []).filter(
      (roleId) => roleId.trim().length > 0,
    );
    const staffRoleIds =
      configuredManageRoleIds.length > 0
        ? configuredManageRoleIds
        : [config?.emojis?.staffRoleId ?? ""].filter(
            (roleId) => roleId.trim().length > 0,
          );
    const roles = member?.roles;
    if (Array.isArray(roles)) {
      return staffRoleIds.some((roleId) => roles.includes(roleId));
    }
    if (
      roles?.cache?.has &&
      staffRoleIds.some((roleId) => roles.cache?.has(roleId))
    ) {
      return true;
    }
    if (configuredManageRoleIds.length > 0) {
      return false;
    }
    return Boolean(
      roles?.cache?.some((role) =>
        STAFF_ROLE_NAMES.some((roleName) => role.name === roleName),
      ),
    );
  }

  private parseCleanChannelCommand(
    message: Message,
  ): ParsedCleanChannelCommand {
    const tokens = message.content
      .replace(CLEAN_CHANNEL_COMMAND_PATTERN, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    let mode: CleanChannelMode = "safe";
    let dryRun = false;
    let channelId: string | null =
      message.mentions.channels.first()?.id ?? null;
    let limit: number | null = null;

    for (const token of tokens) {
      const normalized = token.toLowerCase();
      const channelMatch =
        /^<#(\d+)>$/.exec(token) ?? /^(\d{15,25})$/.exec(token);
      if (channelMatch && !channelId) {
        channelId = channelMatch[1];
        continue;
      }
      if (normalized === "all") {
        mode = "all";
        continue;
      }
      if (
        normalized === "dry" ||
        normalized === "dry-run" ||
        normalized === "preview"
      ) {
        dryRun = true;
        continue;
      }
      if (normalized === "confirm") {
        dryRun = false;
        continue;
      }
      const limitMatch = /^(?:limit=)?(\d{1,4})$/.exec(normalized);
      if (limitMatch) {
        limit = Number.parseInt(limitMatch[1], 10);
      }
    }

    const defaultLimit =
      mode === "all" ? CLEAN_CHANNEL_ALL_LIMIT : CLEAN_CHANNEL_DEFAULT_LIMIT;
    return {
      mode,
      dryRun,
      channelId,
      limit: Math.min(
        Math.max(limit ?? defaultLimit, 1),
        CLEAN_CHANNEL_MAX_LIMIT,
      ),
    };
  }

  private protectedMessageIds(resolved: CleanChannelResolvedSession) {
    const emojis = resolved?.config.emojis ?? {};
    return new Set(
      [
        emojis.managedRegistrationPanelMessageId,
        emojis.managedRegistrationStatusMessageId,
        emojis.managedSlotListMessageId,
        emojis.managedWaitlistMessageId,
        emojis.managedConfirmationMessageId,
      ]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    );
  }

  private async collectCleanChannelTargets(
    channel: GuildTextBasedChannel,
    limit: number,
    protectedIds: Set<string>,
  ): Promise<Message[]> {
    const targets: Message[] = [];
    let before: string | undefined;

    while (targets.length < limit) {
      const batch = await channel.messages.fetch({
        limit: 100,
        ...(before ? { before } : {}),
      });
      if (batch.size === 0) {
        break;
      }

      for (const candidate of batch.values()) {
        if (this.shouldDeleteForCleanChannel(candidate, protectedIds)) {
          targets.push(candidate);
          if (targets.length >= limit) {
            break;
          }
        }
      }

      before = batch.last()?.id;
      if (!before || batch.size < 100) {
        break;
      }
    }

    return targets;
  }

  private shouldDeleteForCleanChannel(
    message: Message,
    protectedIds: Set<string>,
  ) {
    if (message.pinned || protectedIds.has(message.id)) {
      return false;
    }

    if (
      message.embeds.some((embed) =>
        embed.footer?.text?.startsWith("arenzyra:"),
      )
    ) {
      return false;
    }

    return true;
  }

  private cleanChannelSummary(
    count: number,
    channelId: string,
    parsed: ParsedCleanChannelCommand,
    resolved: CleanChannelResolvedSession,
  ) {
    const scope = resolved
      ? `${resolved.session.name} ${resolved.channelKind}`
      : "unlinked channel";
    return [
      `Clean preview for <#${channelId}> (${scope})`,
      `Mode: ${parsed.mode}`,
      `Checked limit: ${parsed.limit}`,
      `Messages selected: ${count}`,
      "Pinned and Arenzyra managed messages are protected.",
    ].join("\n");
  }

  private async confirmCleanChannel(
    message: Message,
    summary: string,
  ): Promise<CleanChannelConfirmation> {
    const confirmId = `clean-channel:confirm:${message.id}`;
    const cancelId = `clean-channel:cancel:${message.id}`;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(confirmId)
        .setLabel("Clean")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(cancelId)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );
    const prompt = await message.reply({
      content: `${summary}\nConfirm cleanup within 30 seconds.`,
      components: [row],
      allowedMentions: { parse: [] },
    });

    try {
      const interaction = await prompt.awaitMessageComponent({
        componentType: ComponentType.Button,
        time: CLEAN_CHANNEL_CONFIRMATION_MS,
        filter: (interaction) =>
          interaction.user.id === message.author.id &&
          (interaction.customId === confirmId ||
            interaction.customId === cancelId),
      });

      if (interaction.customId === cancelId) {
        await interaction.update({
          content: "Channel cleanup cancelled.",
          components: [],
        });
        setTimeout(() => {
          void prompt.delete().catch(() => undefined);
        }, CLEAN_CONFIRMATION_DELETE_DELAY_MS).unref?.();
        return { confirmed: false, prompt };
      }

      await interaction.update({
        content: "Cleaning channel...",
        components: [],
      });
      return { confirmed: true, prompt };
    } catch {
      await prompt
        .edit({
          content: "Channel cleanup timed out.",
          components: [],
        })
        .catch(() => undefined);
      setTimeout(() => {
        void prompt.delete().catch(() => undefined);
      }, CLEAN_CONFIRMATION_DELETE_DELAY_MS).unref?.();
      return { confirmed: false, prompt };
    }
  }

  private async deleteCleanChannelTargets(messages: Message[]) {
    const now = Date.now();
    const recent = messages.filter(
      (message) =>
        now - message.createdTimestamp < DISCORD_BULK_DELETE_MAX_AGE_MS,
    );
    const old = messages.filter(
      (message) =>
        now - message.createdTimestamp >= DISCORD_BULK_DELETE_MAX_AGE_MS,
    );
    let deleted = 0;
    let failed = 0;

    const byChannel = new Map<string, Message[]>();
    for (const message of recent) {
      const entries = byChannel.get(message.channel.id) ?? [];
      entries.push(message);
      byChannel.set(message.channel.id, entries);
    }

    for (const entries of byChannel.values()) {
      for (let index = 0; index < entries.length; index += 100) {
        const chunk = entries.slice(index, index + 100);
        const channel = chunk[0]?.channel;
        if (!channel || !("bulkDelete" in channel)) {
          failed += chunk.length;
          continue;
        }
        const deletedMessages = await channel
          .bulkDelete(chunk, true)
          .catch(() => null);
        deleted += deletedMessages?.size ?? 0;
        failed += chunk.length - (deletedMessages?.size ?? 0);
      }
    }

    for (const message of old) {
      try {
        await message.delete();
        deleted += 1;
      } catch {
        failed += 1;
      }
    }

    return { deleted, failed };
  }

  private async logCleanChannelResult(
    message: Message,
    targetChannel: GuildTextBasedChannel,
    resolved: CleanChannelResolvedSession,
    parsed: ParsedCleanChannelCommand,
    result: { deleted: number; failed: number },
  ) {
    const logChannelId = resolved?.config.logChannelId;
    if (!message.guild || !logChannelId || logChannelId === targetChannel.id) {
      return;
    }
    await this.sendDiscordActionLog(message.guild, resolved.config, {
      action: "Channel cleaned",
      actorDiscordId: message.author.id,
      actorLabel: message.author.tag,
      sourceChannelId: message.channel.id,
      targetChannelId: targetChannel.id,
      sessionId: resolved.session.id,
      sessionName: resolved.session.name,
      status: `${result.deleted}/${result.deleted + result.failed} deleted`,
      details: [
        `Mode: ${parsed.mode}`,
        `Limit: ${parsed.limit}`,
        `Failed: ${result.failed}`,
      ],
      color: 0xf59e0b,
    });
  }

  private async react(message: Message, emoji: string) {
    await message.react(emoji).catch(() => undefined);
  }

  private reactionValueKeys(value: string) {
    const keys = new Set<string>();
    const trimmed = value.trim();
    if (!trimmed) {
      return keys;
    }
    keys.add(trimmed);

    const custom = /^<a?:([^:>]+):(\d+)>$/.exec(trimmed);
    if (custom) {
      keys.add(custom[1]);
      keys.add(custom[2]);
      keys.add(`${custom[1]}:${custom[2]}`);
      keys.add(`<:${custom[1]}:${custom[2]}>`);
      keys.add(`<a:${custom[1]}:${custom[2]}>`);
    }

    return keys;
  }

  private reactionMatchesValue(reaction: MessageReaction, value: string) {
    const keys = this.reactionValueKeys(value);
    const name = reaction.emoji.name?.trim();
    const id = reaction.emoji.id?.trim();
    return (
      (name ? keys.has(name) : false) ||
      (id ? keys.has(id) : false) ||
      (name && id ? keys.has(`${name}:${id}`) : false)
    );
  }

  private async removeOwnReaction(message: Message, emoji: string) {
    const ownUserId = message.client.user?.id;
    if (!ownUserId) {
      return;
    }

    const reaction =
      message.reactions.resolve(emoji) ??
      message.reactions.cache.find((candidate) =>
        this.reactionMatchesValue(candidate, emoji),
      );
    await reaction?.users.remove(ownUserId).catch(() => undefined);
  }

  private registrationStatusReactions(
    config?: SessionDiscordConfigResponse | null,
  ) {
    return [
      REGISTER_PROCESSING_REACTION,
      REGISTER_SUCCESS_REACTION,
      REGISTER_WAITLIST_REACTION,
      REGISTER_WARNING_REACTION,
      REGISTER_REJECT_REACTION,
      this.registrationReaction("registrationSuccessReaction", "check", config),
      this.registrationRejectReaction(config),
      this.registrationReaction(
        "registrationWaitlistReaction",
        "waitlist",
        config,
      ),
      this.registrationReaction("registrationWarningReaction", "warning", config),
      this.registrationBanReaction(config),
    ].filter((emoji, index, emojis) => emoji && emojis.indexOf(emoji) === index);
  }

  private async clearOwnRegistrationStatusReactions(
    message: Message,
    keepEmoji: string,
    config?: SessionDiscordConfigResponse | null,
  ) {
    const keepKeys = this.reactionValueKeys(keepEmoji);
    for (const emoji of this.registrationStatusReactions(config)) {
      const keys = this.reactionValueKeys(emoji);
      if ([...keys].some((key) => keepKeys.has(key))) {
        continue;
      }
      await this.removeOwnReaction(message, emoji);
    }
  }

  private async finishRegisterReaction(
    message: Message,
    emoji: string,
    config?: SessionDiscordConfigResponse | null,
  ) {
    await this.clearOwnRegistrationStatusReactions(message, emoji, config);
    await this.react(message, emoji);
  }

  private registrationReaction(
    key: string,
    fallbackKey: "check" | "reject" | "warning" | "waitlist" | "ban",
    config?: SessionDiscordConfigResponse | null,
  ) {
    if (
      key === "registrationWarningReaction" &&
      !config?.emojis?.registrationWarningReaction?.trim()
    ) {
      return REGISTER_WARNING_REACTION;
    }

    return configuredDiscordEmoji(key, fallbackKey, config);
  }

  private registrationRejectReaction(
    config?: SessionDiscordConfigResponse | null,
  ) {
    return this.registrationReaction(
      "registrationRejectReaction",
      "reject",
      config,
    );
  }

  private registrationBanReaction(
    config?: SessionDiscordConfigResponse | null,
  ) {
    return this.registrationReaction("registrationBanReaction", "ban", config);
  }

  private registrationResultReaction(
    result:
      | string
      | {
          registration?: {
            status?: string | null;
            waitlistPosition?: number | null;
          } | null;
          status?: string | null;
          warning?: string | null;
        },
    config?: SessionDiscordConfigResponse | null,
  ) {
    if (typeof result !== "string") {
      const registration = result.registration ?? null;
      const normalizedStatus = (result.status ?? "").toLowerCase();
      if (
        result.warning ||
        normalizedStatus === "already registered" ||
        normalizedStatus === "already_registered" ||
        normalizedStatus === "not registered" ||
        normalizedStatus === "not_registered"
      ) {
        return this.registrationReaction(
          "registrationWarningReaction",
          "warning",
          config,
        );
      }
      if (
        normalizedStatus === "waitlisted" ||
        registration?.status === "WAITLIST" ||
        registration?.waitlistPosition != null
      ) {
        return this.registrationReaction(
          "registrationWaitlistReaction",
          "waitlist",
          config,
        );
      }
      return this.registrationReaction(
        "registrationSuccessReaction",
        "check",
        config,
      );
    }

    const normalized = result.toLowerCase();
    if (
      normalized.includes("failed") ||
      normalized.includes("could not") ||
      normalized.includes("already registered") ||
      normalized.includes("but")
    ) {
      return this.registrationReaction(
        "registrationWarningReaction",
        "warning",
        config,
      );
    }
    if (normalized.includes("waitlist")) {
      return this.registrationReaction(
        "registrationWaitlistReaction",
        "waitlist",
        config,
      );
    }
    return this.registrationReaction(
      "registrationSuccessReaction",
      "check",
      config,
    );
  }

  private async parseRegisterMessage(
    message: Message,
    inputMode: RegistrationInputMode,
    config?: SessionDiscordConfigResponse | null,
  ): Promise<ParsedRegisterMessage> {
    const lines = message.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const parsedScrim =
      inputMode === "SCRIM" ? this.scrimRegistrationFields(lines) : null;
    if (inputMode === "TOURNAMENT") {
      return this.parseTournamentRegisterMessage(message, config);
    }

    const fields =
      inputMode === "EVENT"
        ? message.content
            .split("|")
            .map((entry) => entry.trim())
            .filter(Boolean)
        : (parsedScrim?.fields ?? []);

    if (fields.length < (inputMode === "EVENT" ? 3 : 2)) {
      throw new Error(
        inputMode === "EVENT" ? this.eventUsageMessage() : this.usageMessage(),
      );
    }

    const teamName = fields[0].trim();
    const tag = fields[1].trim();
    if (!teamName || !tag) {
      throw new Error(
        inputMode === "EVENT" ? this.eventUsageMessage() : this.usageMessage(),
      );
    }

    const logoSource = this.findLogoSource(message);
    return {
      teamName,
      tag,
      placement: parsedScrim?.placement ?? "NORMAL",
      logoUrl: logoSource?.url ?? null,
      logoSource,
      tournamentRoster: null,
    };
  }

  private async parseTournamentRegisterMessage(
    message: Message,
    config?: SessionDiscordConfigResponse | null,
  ): Promise<ParsedRegisterMessage> {
    const logoSource = this.findLogoSource(message);
    const logoRequired = this.tournamentLogoRequired(config);
    if (logoRequired && !logoSource) {
      throw new Error(
        "Team logo is required for this tournament registration.",
      );
    }

    const requiredMainPlayers = this.tournamentMainPlayersRequired(config);
    const lines = this.registrationTextWithoutUrls(message.content)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const parsed = this.hasTournamentLabels(lines)
      ? this.parseTournamentLabeledRows(lines, requiredMainPlayers)
      : this.parseTournamentCompactRows(lines, requiredMainPlayers);
    this.validateTournamentRosterRows(parsed.players, requiredMainPlayers);

    const managerUser = await this.resolveMentionedUser(
      message,
      parsed.managerDiscordUserId,
      "Team manager",
    );
    const players: ParsedTournamentRosterPlayer[] = [];
    for (const player of parsed.players) {
      const user = await this.resolveMentionedUser(
        message,
        player.discordUserId,
        `${player.lineupType === "MAIN" ? "Player" : "Substitute"} ${
          player.slot
        }`,
      );
      players.push({
        ...player,
        discordUsername: user.username ?? null,
        displayName: user.globalName ?? null,
      });
    }

    const teamName = parsed.teamName.trim();
    if (!teamName) {
      throw new Error(this.tournamentUsageMessage());
    }

    return {
      teamName,
      tag: parsed.teamTag,
      placement: "NORMAL",
      logoUrl: logoSource?.url ?? null,
      logoSource,
      tournamentRoster: {
        teamTag: parsed.teamTag,
        managerDiscordUserId: managerUser.id,
        managerDiscordUsername: managerUser.username ?? null,
        managerDisplayName: managerUser.globalName ?? null,
        managerUser,
        requiredMainPlayers,
        logoRequired,
        players,
      },
    };
  }

  private tournamentMainPlayersRequired(
    config?: Pick<
      SessionDiscordConfigResponse,
      "tournamentMainPlayersRequired"
    > | null,
  ) {
    const configured = Number(config?.tournamentMainPlayersRequired ?? 4);
    if (!Number.isFinite(configured)) {
      return 4;
    }
    return Math.max(2, Math.min(4, Math.trunc(configured)));
  }

  private tournamentLogoRequired(
    config?: Pick<
      SessionDiscordConfigResponse,
      "tournamentLogoRequired"
    > | null,
  ) {
    return config?.tournamentLogoRequired === true;
  }

  private registrationTextWithoutUrls(content: string) {
    return content.replace(/https?:\/\/\S+/gi, " ");
  }

  private hasTournamentLabels(lines: string[]) {
    return lines.some((line) => {
      const key = this.tournamentLabelKey(line.split(":", 1)[0] ?? "");
      return (
        key === "teamname" ||
        key === "teamtag" ||
        key === "tag" ||
        key === "teammanager" ||
        /^player[1-4]name$/.test(key) ||
        /^(?:sub|substitute)(?:player)?[12]name$/.test(key)
      );
    });
  }

  private parseTournamentLabeledRows(
    lines: string[],
    requiredMainPlayers: number,
  ) {
    const values = new Map<string, string>();
    for (const line of lines) {
      const match = /^([^:]+):\s*(.*)$/.exec(line);
      if (!match) {
        continue;
      }
      const key = this.tournamentLabelKey(match[1] ?? "");
      if (!key) {
        continue;
      }
      values.set(key, match[2]?.trim() ?? "");
    }

    const teamName = values.get("teamname")?.trim() ?? "";
    const teamTag = this.cleanTournamentTag(
      values.get("teamtag") ?? values.get("tag") ?? "",
    );
    const managerDiscordUserId = this.parseExactlyOneMentionId(
      values.get("teammanager") ?? "",
      "Team manager",
    );
    if (!teamName) {
      throw new Error("Tournament registration needs `team name:`.");
    }

    const players: Array<
      Omit<ParsedTournamentRosterPlayer, "discordUsername" | "displayName">
    > = [];
    for (let slot = 1; slot <= 4; slot += 1) {
      const nameKey = `player${slot}name`;
      const uidKey = `player${slot}uid`;
      const nameValue = values.get(nameKey);
      const uidValue = values.get(uidKey);
      const required = slot <= requiredMainPlayers;
      if (!nameValue && !uidValue && !required) {
        continue;
      }
      if (!nameValue || !uidValue) {
        throw new Error(`Player ${slot} needs both name/mention and UID rows.`);
      }
      players.push({
        slot,
        lineupType: "MAIN",
        ...this.parseNameThenMention(nameValue, `Player ${slot}`),
        uid: this.cleanTournamentUid(uidValue, `Player ${slot} UID`),
      });
    }

    for (let slot = 1; slot <= 2; slot += 1) {
      const nameValue =
        values.get(`substitute${slot}name`) ??
        values.get(`substituteplayer${slot}name`) ??
        values.get(`sub${slot}name`) ??
        values.get(`subplayer${slot}name`);
      const uidValue =
        values.get(`substitute${slot}uid`) ??
        values.get(`substituteplayer${slot}uid`) ??
        values.get(`sub${slot}uid`) ??
        values.get(`subplayer${slot}uid`);
      if (!nameValue && !uidValue) {
        continue;
      }
      if (!nameValue || !uidValue) {
        throw new Error(
          `Substitute ${slot} needs both name/mention and UID rows.`,
        );
      }
      players.push({
        slot,
        lineupType: "SUBSTITUTE",
        ...this.parseNameThenMention(nameValue, `Substitute ${slot}`),
        uid: this.cleanTournamentUid(uidValue, `Substitute ${slot} UID`),
      });
    }

    return { teamName, teamTag, managerDiscordUserId, players };
  }

  private parseTournamentCompactRows(
    lines: string[],
    requiredMainPlayers: number,
  ) {
    if (lines.length < 3 + requiredMainPlayers * 2) {
      throw new Error(this.tournamentUsageMessage());
    }

    const teamName = lines[0]?.trim() ?? "";
    const teamTag = this.cleanTournamentTag(lines[1] ?? "");
    const managerDiscordUserId = this.parseExactlyOneMentionId(
      lines[2] ?? "",
      "Team manager",
    );
    const rosterLines = lines.slice(3);
    if (rosterLines.length % 2 !== 0) {
      throw new Error(
        "Each tournament player needs a name/mention line followed by a UID line.",
      );
    }

    const pairCount = rosterLines.length / 2;
    if (pairCount > 6) {
      throw new Error(
        "Tournament registration supports 4 players and 2 substitutes.",
      );
    }

    const players: Array<
      Omit<ParsedTournamentRosterPlayer, "discordUsername" | "displayName">
    > = [];
    for (let index = 0; index < pairCount; index += 1) {
      const lineupType: TournamentRosterLineupType =
        index < 4 ? "MAIN" : "SUBSTITUTE";
      const slot = index < 4 ? index + 1 : index - 3;
      const label =
        lineupType === "MAIN" ? `Player ${slot}` : `Substitute ${slot}`;
      players.push({
        slot,
        lineupType,
        ...this.parseNameThenMention(rosterLines[index * 2] ?? "", label),
        uid: this.cleanTournamentUid(
          rosterLines[index * 2 + 1] ?? "",
          `${label} UID`,
        ),
      });
    }

    return { teamName, teamTag, managerDiscordUserId, players };
  }

  private validateTournamentRosterRows(
    players: Array<
      Pick<ParsedTournamentRosterPlayer, "lineupType" | "discordUserId" | "uid">
    >,
    requiredMainPlayers: number,
  ) {
    const mainPlayers = players.filter(
      (player) => player.lineupType === "MAIN",
    );
    const substitutes = players.filter(
      (player) => player.lineupType === "SUBSTITUTE",
    );
    if (mainPlayers.length < requiredMainPlayers) {
      throw new Error(
        `This tournament requires ${requiredMainPlayers} main players.`,
      );
    }
    if (mainPlayers.length > 4 || substitutes.length > 2) {
      throw new Error(
        "Tournament registration supports 4 players and 2 substitutes.",
      );
    }

    const discordIds = new Set<string>();
    const uids = new Set<string>();
    for (const player of players) {
      if (discordIds.has(player.discordUserId)) {
        throw new Error(
          `Player Discord mention <@${player.discordUserId}> is used more than once.`,
        );
      }
      discordIds.add(player.discordUserId);

      const uidKey = player.uid.toLowerCase();
      if (uids.has(uidKey)) {
        throw new Error(`Player UID ${player.uid} is used more than once.`);
      }
      uids.add(uidKey);
    }
  }

  private parseNameThenMention(value: string, label: string) {
    const matches = [...value.matchAll(DISCORD_USER_MENTION_CAPTURE_PATTERN)];
    if (matches.length !== 1) {
      throw new Error(`${label} must include exactly one Discord mention.`);
    }
    const match = matches[0];
    const rawMention = match[0] ?? "";
    const discordUserId = match[1] ?? "";
    const mentionIndex = match.index ?? -1;
    const name = value.slice(0, mentionIndex).trim();
    const afterMention = value.slice(mentionIndex + rawMention.length).trim();
    if (!name || afterMention) {
      throw new Error(`${label} must be written as name first, then mention.`);
    }
    return { name, discordUserId };
  }

  private parseExactlyOneMentionId(value: string, label: string) {
    const matches = [...value.matchAll(DISCORD_USER_MENTION_CAPTURE_PATTERN)];
    if (matches.length !== 1 || !matches[0]?.[1]) {
      throw new Error(`${label} must include exactly one Discord mention.`);
    }
    return matches[0][1];
  }

  private cleanTournamentUid(value: string, label: string) {
    const uid = value.replace(/\s+/g, "").trim();
    if (!uid || DISCORD_USER_MENTION_PATTERN.test(uid)) {
      throw new Error(`${label} is required.`);
    }
    return uid.slice(0, 80);
  }

  private cleanTournamentTag(value: string, label = "Team tag") {
    const tag = value.trim().replace(/\s+/g, "").toUpperCase();
    if (!tag || DISCORD_USER_MENTION_PATTERN.test(tag)) {
      throw new Error(`${label} is required.`);
    }
    if (tag.length > 15) {
      throw new Error(`${label} must be 15 characters or fewer.`);
    }
    return tag;
  }

  private tournamentLabelKey(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  private async resolveMentionedUser(
    message: Message,
    userId: string,
    label: string,
  ) {
    const direct = message.mentions.users.get(userId);
    if (direct && !direct.bot) {
      return direct;
    }

    const member = await this.fetchMentionedGuildMember(message, userId);
    if (member && !member.user.bot) {
      return member.user;
    }

    throw new Error(
      `${label} <@${userId}> is not visible to the bot or is not in this server.`,
    );
  }

  private tournamentRosterJson(
    roster: ParsedTournamentRoster,
  ): Record<string, unknown> {
    return {
      type: "TOURNAMENT_ROSTER",
      version: 1,
      teamTag: roster.teamTag,
      requiredMainPlayers: roster.requiredMainPlayers,
      logoRequired: roster.logoRequired,
      manager: {
        discordUserId: roster.managerDiscordUserId,
        discordUsername: roster.managerDiscordUsername,
        displayName: roster.managerDisplayName,
      },
      players: roster.players.map((player) => ({
        slot: player.slot,
        lineupType: player.lineupType,
        name: player.name,
        uid: player.uid,
        discordUserId: player.discordUserId,
        discordUsername: player.discordUsername,
        displayName: player.displayName,
      })),
    };
  }

  private scrimRegistrationFields(lines: string[]) {
    const commandLine =
      lines[0]?.replace(REGISTER_COMMAND_PATTERN, "").trim() ?? "";
    const commandFields = commandLine.includes("|")
      ? commandLine
          .split("|")
          .map((entry) => entry.trim())
          .filter(Boolean)
      : commandLine
        ? [commandLine]
        : [];
    const fields = [...commandFields, ...lines.slice(1)];
    const first = fields[0]?.trim().toLowerCase();
    if (first === "vip") {
      return { placement: "VIP" as const, fields: fields.slice(1) };
    }
    return { placement: "NORMAL" as const, fields };
  }

  private parseLogoMessage(message: Message): ParsedLogoMessage {
    const content = message.content.replace(/https?:\/\/\S+/gi, " ");
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const commandLine =
      lines[0]?.replace(LOGO_COMMAND_PATTERN, "").trim() ?? "";
    const fields = commandLine
      ? [commandLine, ...lines.slice(1)]
      : lines.slice(1);
    const teamName = fields
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^"|"$/g, "")
      .trim();

    if (!teamName) {
      throw new Error(this.logoUsageMessage());
    }

    return { teamName };
  }

  private parsePlayerPhotoMessage(
    message: Message,
    registrationMode?: string | null,
  ): ParsedPlayerPhotoMessage {
    const content = message.content.replace(/https?:\/\/\S+/gi, " ");
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const commandLine =
      lines[0]?.replace(PLAYER_PHOTO_COMMAND_PATTERN, "").trim() ?? "";
    const commandFields = commandLine.includes("|")
      ? commandLine
          .split("|")
          .map((entry) => entry.trim())
          .filter(Boolean)
      : commandLine
        ? [commandLine]
        : [];
    const fields = [...commandFields, ...lines.slice(1)]
      .map((line) => line.trim())
      .filter(Boolean);
    const mode = (registrationMode ?? "SCRIM").toUpperCase();
    const usageConfig = { registrationMode: registrationMode ?? "SCRIM" };

    if (mode === "TOURNAMENT") {
      const uid = fields[0]?.replace(/\s+/g, "") ?? "";
      if (!uid) {
        throw new Error(this.playerPhotoUsageMessage(usageConfig));
      }
      return { uid, teamName: null, playerName: null };
    }

    const [teamName, playerName, rawUid] = fields;
    const uid = rawUid?.replace(/\s+/g, "") ?? "";
    if (!teamName || !playerName || !uid) {
      throw new Error(this.playerPhotoUsageMessage(usageConfig));
    }

    return { uid, teamName, playerName };
  }

  private maxManagersPerTeam(
    config?: Pick<SessionDiscordConfigResponse, "maxManagersPerTeam"> | null,
  ) {
    const configured = Number(config?.maxManagersPerTeam ?? 10);
    if (!Number.isFinite(configured)) {
      return 10;
    }
    return Math.max(1, Math.min(10, Math.trunc(configured)));
  }

  private async parseMentionedManagers(
    message: Message,
    config?: Pick<SessionDiscordConfigResponse, "maxManagersPerTeam"> | null,
  ) {
    const usersById = new Map<string, User>();
    for (const user of message.mentions.users.values()) {
      if (!user.bot) {
        usersById.set(user.id, user);
      }
    }

    const rawMentionIds = this.rawUserMentionIds(message);
    const unresolvedIds: string[] = [];
    for (const userId of rawMentionIds) {
      if (usersById.has(userId)) {
        continue;
      }

      const member = await this.fetchMentionedGuildMember(message, userId);
      if (!member || member.user.bot) {
        unresolvedIds.push(userId);
        continue;
      }

      usersById.set(member.user.id, member.user);
    }

    const users = [...usersById.values()];
    const maxManagers = this.maxManagersPerTeam(config);

    if (users.length < 1) {
      if (rawMentionIds.length > 0) {
        throw new Error(
          `Mentioned manager <@${unresolvedIds[0] ?? rawMentionIds[0]}> is not visible to the bot or is not in this server.`,
        );
      }
      throw new Error(
        "Mention at least 1 manager in the registration message.",
      );
    }
    if (users.length > maxManagers) {
      throw new Error(
        `Mention up to ${maxManagers} manager${maxManagers === 1 ? "" : "s"} per team.`,
      );
    }
    if (unresolvedIds.length > 0) {
      throw new Error(
        `Mentioned manager <@${unresolvedIds[0]}> is not visible to the bot or is not in this server.`,
      );
    }

    return users.map((user) => this.userToMemberInput(user));
  }

  private rawUserMentionIds(message: Message) {
    const ownUserId = message.client.user?.id ?? null;
    const ids: string[] = [];
    for (const match of message.content.matchAll(
      DISCORD_USER_MENTION_CAPTURE_PATTERN,
    )) {
      const userId = match[1];
      if (!userId || userId === ownUserId || ids.includes(userId)) {
        continue;
      }
      ids.push(userId);
    }
    return ids;
  }

  private async fetchMentionedGuildMember(
    message: Message,
    userId: string,
  ): Promise<GuildMember | null> {
    if (!message.guild) {
      return null;
    }

    return message.guild.members
      .fetch({ user: userId, force: true })
      .catch(() => null);
  }

  private userToMemberInput(user: User) {
    return {
      discordUserId: user.id,
      discordUsername: user.username,
      displayName: user.globalName ?? null,
      role: "LEADER" as const,
    };
  }

  private findLogoSource(
    message: Message,
    label = "Team logo",
  ): MessageLogoSource | null {
    const attachment = message.attachments.find((entry) =>
      this.isImageAttachment(entry),
    );
    if (attachment) {
      if (attachment.size > MAX_LOGO_BYTES) {
        throw new Error(`${label} must be 8 MB or smaller.`);
      }
      return {
        url: attachment.url,
        attachmentId: attachment.id,
        filename: attachment.name ?? null,
        contentType: attachment.contentType ?? null,
      };
    }

    const match = /https?:\/\/\S+/i.exec(message.content);
    const url = match?.[0]?.replace(/[)>.,]+$/, "") ?? null;
    return url ? { url } : null;
  }

  private findLogoUrl(message: Message): string | null {
    return this.findLogoSource(message)?.url ?? null;
  }

  private toDiscordTeamLogoSource(
    message: Message,
    teamName: string,
    tag: string | null,
    source: MessageLogoSource | null,
  ): DiscordTeamLogoSource | null {
    if (!source) {
      return null;
    }
    return {
      teamName,
      tag,
      channelId: message.channel.id,
      messageId: message.id,
      attachmentId: source.attachmentId ?? null,
      url: source.url,
      filename: source.filename ?? null,
      contentType: source.contentType ?? null,
      savedByDiscordId: message.author.id,
      savedByDiscordUsername: message.author.username,
    };
  }

  private findImageUrls(message: Message): string[] {
    const urls: string[] = [];
    const attachments = message.attachments as
      | {
          values?: () => Iterable<Attachment>;
          forEach?: (callback: (attachment: Attachment) => void) => void;
          find?: (
            callback: (attachment: Attachment) => boolean,
          ) => Attachment | undefined;
        }
      | undefined;
    const entries: Attachment[] = [];

    if (typeof attachments?.values === "function") {
      entries.push(...Array.from(attachments.values()));
    } else if (typeof attachments?.forEach === "function") {
      attachments.forEach((attachment) => entries.push(attachment));
    } else if (typeof attachments?.find === "function") {
      const attachment = attachments.find((entry) =>
        this.isImageAttachment(entry),
      );
      if (attachment) {
        entries.push(attachment);
      }
    }

    for (const attachment of entries) {
      if (this.isImageAttachment(attachment) && attachment.url) {
        urls.push(attachment.url);
      }
    }

    const matches = message.content.match(/https?:\/\/\S+/gi) ?? [];
    urls.push(
      ...matches
        .map((entry) => entry.replace(/[)>.,]+$/, ""))
        .filter((entry) => /\.(png|jpe?g|webp)(?:\?|$)/i.test(entry)),
    );
    return [...new Set(urls)];
  }

  private isImageAttachment(attachment: Attachment) {
    const contentType = attachment.contentType?.split(";")[0]?.toLowerCase();
    if (contentType && ALLOWED_LOGO_TYPES.has(contentType)) {
      return true;
    }
    return /\.(png|jpe?g|webp)(?:\?|$)/i.test(
      attachment.name ?? attachment.url,
    );
  }

  private async loadLogoUpload(
    logoUrl: string | null,
  ): Promise<TeamLogoUpload | null> {
    if (!logoUrl) {
      return null;
    }

    const response = await fetch(logoUrl);
    if (!response.ok) {
      throw new Error("Could not download the team logo.");
    }

    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > MAX_LOGO_BYTES) {
      throw new Error("Team logo must be 8 MB or smaller.");
    }

    const contentType = this.normalizeImageContentType(
      response.headers.get("content-type"),
      logoUrl,
    );
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_LOGO_BYTES) {
      throw new Error("Team logo must be 8 MB or smaller.");
    }

    return {
      buffer,
      filename: `team-logo.${IMAGE_EXTENSIONS[contentType]}`,
      contentType,
    };
  }

  private async loadPlayerPhotoUpload(
    photoUrl: string | null,
  ): Promise<PlayerPhotoUpload | null> {
    if (!photoUrl) {
      return null;
    }

    const response = await fetch(photoUrl);
    if (!response.ok) {
      throw new Error("Could not download the player photo.");
    }

    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > MAX_LOGO_BYTES) {
      throw new Error("Player photo must be 8 MB or smaller.");
    }

    const contentType = this.normalizeImageContentType(
      response.headers.get("content-type"),
      photoUrl,
      "Player photo",
    );
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_LOGO_BYTES) {
      throw new Error("Player photo must be 8 MB or smaller.");
    }

    return {
      buffer,
      filename: `player-photo.${IMAGE_EXTENSIONS[contentType]}`,
      contentType,
    };
  }

  private normalizeImageContentType(
    contentTypeHeader: string | null,
    logoUrl: string,
    label = "Team logo",
  ) {
    const contentType = contentTypeHeader?.split(";")[0]?.trim().toLowerCase();
    if (contentType && ALLOWED_LOGO_TYPES.has(contentType)) {
      return contentType;
    }

    if (/\.png(?:\?|$)/i.test(logoUrl)) return "image/png";
    if (/\.jpe?g(?:\?|$)/i.test(logoUrl)) return "image/jpeg";
    if (/\.webp(?:\?|$)/i.test(logoUrl)) return "image/webp";

    throw new Error(`${label} must be a PNG, JPG, or WEBP image.`);
  }

  private usageMessage() {
    return [
      "Use this format:",
      "",
      "%register",
      "Team Name",
      "TEAMTAG",
      "@manager",
      "",
      "For VIP only, use `%register vip` with the same lines.",
      "",
      "Attach the team logo image to the same message if you have one.",
    ].join("\n");
  }

  private eventUsageMessage() {
    return [
      "Use this format:",
      "",
      "Team Name | Team Tag | @manager",
      "",
      "Attach the team logo image to the same message if you have one.",
    ].join("\n");
  }

  private tournamentUsageMessage() {
    return [
      "Use this format:",
      "",
      "team name: Team Name",
      "team tag: TEAMTAG",
      "team manager: @manager",
      "player 1 name: Player Name @player",
      "player 1 uid: 123456789",
      "",
      "Repeat player rows for the required main players. Substitutes are optional, up to 2.",
      "",
      "Compact format is also accepted: team name, team tag, manager mention, then player name/mention and UID pairs.",
    ].join("\n");
  }

  private registrationUsageMessage(mode: RegistrationInputMode) {
    if (mode === "TOURNAMENT") return this.tournamentUsageMessage();
    if (mode === "EVENT") return this.eventUsageMessage();
    return this.usageMessage();
  }

  private logoUsageMessage() {
    return [
      "Use this format:",
      "",
      "%logo",
      "Team Name",
      "",
      "Attach the team logo image to the same message.",
    ].join("\n");
  }

  private playerPhotoUsageMessage(
    config?: Pick<SessionDiscordConfigResponse, "registrationMode"> | null,
  ) {
    const mode = (config?.registrationMode ?? "SCRIM").toUpperCase();
    if (mode === "TOURNAMENT") {
      return [
        "Use this format:",
        "",
        "%photo",
        "Player UID",
        "",
        "Attach the player photo image to the same message.",
      ].join("\n");
    }

    return [
      "Use this format:",
      "",
      "%photo",
      "Team Name",
      "Player Name",
      "Player UID",
      "",
      "Attach the player photo image to the same message.",
    ].join("\n");
  }
}
