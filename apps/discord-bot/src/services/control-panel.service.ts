import {
  ActionRowBuilder,
  AttachmentBuilder,
  AutocompleteInteraction,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  type Guild,
  type GuildTextBasedChannel,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildMember,
  MessageContextMenuCommandInteraction,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { randomUUID } from "node:crypto";
import type {
  DiscordNoShowTeamBanCommand,
  DiscordResultControlBanTarget,
  DiscordSessionService,
  DiscordTeamBanCommand,
  DiscordTeamBanServerAction,
  DiscordTeamBanTarget,
  ApplyResultsDiscordResponse,
  RegistrationPlayStatusAction,
  RegistrationPlayStatusTarget,
} from "./session.service";
import type {
  SessionResponse,
  SessionDiscordConfigResponse,
  SessionMatchResponse,
  ResultBackupDetailResponse,
  ResultBackupPlayerResponse,
  ResultBackupRowResponse,
  ResultBackupSummaryResponse,
  TeamBanScope,
  MatchResultPlayerResponse,
  MatchResultRowResponse,
  MatchResultsResponse,
  ManualMatchResultRowPayload,
  PreviewConditionalBanEnrollmentResponse,
  UpdateMatchResultPayload,
  UpdateResultBackupRowPayload,
} from "../api/api-client";

export type ControlPanelAudience = "teams" | "staff" | "manage" | "result";

type ControlAction =
  | "register-team"
  | "join-scrim"
  | "leave-scrim"
  | "list-slots"
  | "standings"
  | "create-scrim"
  | "configure-scrim"
  | "setup-channels"
  | "sync-discord"
  | "remove-team"
  | "start-scrim"
  | "post-room"
  | "map-slots"
  | "preview-results"
  | "apply-results";

type PanelInteraction =
  | ChatInputCommandInteraction
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ModalSubmitInteraction
  | MessageContextMenuCommandInteraction;

type ResolvedSessionContext = {
  session: SessionResponse;
  config: SessionDiscordConfigResponse;
};

type TextInputConfig = {
  customId: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  style?: TextInputStyle;
  maxLength?: number;
  value?: string;
};

type ParsedControlAction = {
  action: ControlAction;
  sessionId: string | null;
};

type RegistrationControlAction = "a" | "s" | "w" | "v" | "r";

type ParsedRegistrationControlAction = {
  action: RegistrationControlAction;
  sessionId: string;
  registrationId: string;
};

type ParsedRegistrationRemoveConfirmationAction = {
  action: "confirm" | "cancel" | "expired";
  sessionId?: string;
  registrationId?: string;
};

type ParsedPlayStatusAction = {
  action: RegistrationPlayStatusAction;
  sessionId: string;
};

type ParsedPlayStatusTargetSelectAction = {
  action: RegistrationPlayStatusAction;
  sessionId: string;
};

type ParsedWaitlistControlPageAction = {
  sessionId: string;
  page: number;
};

type ParsedWaitlistControlSelectAction = {
  sessionId: string;
  page: number;
};

type BanControlAction =
  | "create"
  | "missing"
  | "conditional"
  | "list"
  | "refresh"
  | "confirm"
  | "cancel";

type ParsedBanControlAction = {
  action: BanControlAction;
  sessionId: string | null;
  token: string | null;
};

type ManageCardBanAction = "d" | "p";

type ParsedManageCardBanAction = {
  action: ManageCardBanAction;
  sessionId: string;
  teamId: string;
};

type ParsedCaptainPanelAction = {
  action: "logo-help";
  sessionId: string;
};

type ParsedLiveCenterAction = {
  action: "refresh";
  sessionId: string;
};

type ResultControlAction =
  | "refresh"
  | "match"
  | "overall"
  | "ban"
  | "text"
  | "edit-results"
  | "final-refresh"
  | "final-repost"
  | "defaults"
  | "rules";

type ParsedResultControlAction = {
  action: ResultControlAction;
  sessionId: string;
};

type ResultControlSettingsKind = "text" | "defaults" | "rules";

type ParsedResultControlSettingsModal = {
  kind: ResultControlSettingsKind;
  sessionId: string;
};

type ResultNoShowRuleSetting = {
  enabled: boolean;
  type: "TOTAL_MISSES" | "MATCH_MISSED";
  misses: number | null;
  matchNumber: number | null;
  durationDays: number | null;
  scope: "SESSION" | "TEAM";
  reason: string;
};

type ParsedResultBanSelectAction = {
  sessionId: string;
  panelChannelId: string | null;
  panelMessageId: string | null;
};

type ParsedResultBanPendingAction = {
  action: "unban" | "cancel";
  token: string;
};

type ParsedResultEditMatchSelectAction = {
  sessionId: string;
};

type ResultEditSourceKind = "match" | "backup";

type ResultEditSource = {
  kind: ResultEditSourceKind;
  id: string;
  key: string;
};

type ResultEditSourceSummary = ResultEditSource & {
  label: string;
  description: string;
  matchNumber: number | null;
};

type ResultEditRow = MatchResultRowResponse & {
  resultEditRowKey?: string;
  backupRowId?: string | null;
  backupRow?: ResultBackupRowResponse | null;
};

type ParsedResultEditRowsSelectAction = {
  sessionId: string;
  sourceKey: string;
  page: number;
};

type ParsedResultEditPageAction = {
  sessionId: string;
  sourceKey: string;
  page: number;
};

type ParsedResultManualEditAction = {
  sessionId: string;
  sourceKey: string;
};

type PendingResultEditAction = {
  userId: string;
  sessionId: string;
  source: ResultEditSource;
  rowKey: string;
  teamId: string | null;
  page: number;
  row: ResultEditRow;
  expiresAt: number;
};

type PendingManualResultEditAction = {
  userId: string;
  sessionId: string;
  source: ResultEditSource;
  sourceLabel: string;
  rows: ResultEditRow[];
  expectedVersion: number | null;
  expiresAt: number;
};

type SessionManageAction =
  | "refresh"
  | "open-registration"
  | "close-registration"
  | "sync-discord"
  | "waitlist"
  | "slots"
  | "standings"
  | "start-match"
  | "post-room"
  | "map-slots"
  | "preview-results"
  | "apply-results"
  | "no-show"
  | "active-bans"
  | "sync-logos"
  | "sync-photos";

type ParsedSessionManageAction = {
  action: SessionManageAction;
  sessionId: string;
};

type PendingBanControlAction =
  | {
      kind: "team";
      userId: string;
      sessionId: string;
      command: DiscordTeamBanCommand;
      expiresAt: number;
    }
  | {
      kind: "no-show";
      userId: string;
      sessionId: string;
      command: DiscordNoShowTeamBanCommand;
      expiresAt: number;
    }
  | {
      kind: "conditional";
      userId: string;
      sessionId: string;
      requestKey: string;
      preview: PreviewConditionalBanEnrollmentResponse;
      reason: string;
      expiresAt: number;
    };

type PendingResultUnbanAction = {
  userId: string;
  sessionId: string;
  targetValue: string;
  panelChannelId: string | null;
  panelMessageId: string | null;
  expiresAt: number;
};

type DiscordRegistrationMemberInput = {
  discordUserId: string;
  discordUsername: string | null;
  displayName: string | null;
};

const STAFF_ROLE_NAMES = [
  "[OWNER]",
  "Arenzyra Admin",
  "Arenzyra Staff",
  "Production Lead",
  "Tournament Organizer",
];
const CHECK = "\u2705";
const ACTION_CONFIRMATION_DELETE_DELAY_MS = 2000;
const BAN_CONTROL_CONFIRMATION_TTL_MS = 60_000;
const RESULT_CONTROL_UNBAN_TTL_MS = 5 * 60_000;
const RESULT_CONTROL_EDIT_TTL_MS = 5 * 60_000;
const RESULT_CONTROL_RESULT_ROWS_PAGE_SIZE = 25;
const MATCH_NUMBER_TEXT_PATTERN =
  /(?:^|[\s,;:])(?:game|match|round|g|m)\s*(?:(?:no|num|number)\.?\s*)?[-#]?\s*(\d{1,3})(?=$|[\s,;:!.?()\-])/gi;

const STAFF_ACTIONS = new Set<ControlAction>([
  "create-scrim",
  "configure-scrim",
  "setup-channels",
  "sync-discord",
  "remove-team",
  "start-scrim",
  "post-room",
  "map-slots",
  "preview-results",
  "apply-results",
]);

function controlButton(
  action: ControlAction,
  label: string,
  style = ButtonStyle.Secondary,
  sessionId?: string | null,
) {
  return new ButtonBuilder()
    .setCustomId(
      sessionId ? `control:${action}:${sessionId}` : `control:${action}`,
    )
    .setLabel(label)
    .setStyle(style);
}

function modalId(action: ControlAction, sessionId?: string | null) {
  return sessionId
    ? `control-modal:${action}:${sessionId}`
    : `control-modal:${action}`;
}

function actionFromCustomId(
  customId: string,
  prefix: string,
): ParsedControlAction | null {
  if (!customId.startsWith(prefix)) {
    return null;
  }
  const payload = customId.slice(prefix.length);
  const [action, ...rest] = payload.split(":");
  if (!isControlAction(action)) {
    return null;
  }
  return {
    action,
    sessionId: rest.join(":") || null,
  };
}

function registrationActionFromCustomId(
  customId: string,
): ParsedRegistrationControlAction | null {
  if (!customId.startsWith("regctl:")) {
    return null;
  }
  const [, action, sessionId, registrationId] = customId.split(":");
  if (!isRegistrationControlAction(action) || !sessionId || !registrationId) {
    return null;
  }
  return { action, sessionId, registrationId };
}

function registrationRemoveConfirmationFromCustomId(
  customId: string,
): ParsedRegistrationRemoveConfirmationAction | null {
  if (customId.startsWith("regctl-remove-confirm:")) {
    return { action: "expired" };
  }
  if (customId.startsWith("regctl-remove-cancel:")) {
    return { action: "expired" };
  }
  if (!customId.startsWith("regctl:rm:")) {
    return null;
  }
  const [, , action, sessionId, registrationId] = customId.split(":");
  if (
    (action !== "confirm" && action !== "cancel") ||
    !sessionId ||
    !registrationId
  ) {
    return null;
  }
  return { action, sessionId, registrationId };
}

function waitlistControlPageFromCustomId(
  customId: string,
): ParsedWaitlistControlPageAction | null {
  if (!customId.startsWith("waitctl:p:")) {
    return null;
  }
  const [, , sessionId, rawPage] = customId.split(":");
  const page = Number(rawPage);
  if (!sessionId || !Number.isInteger(page) || page < 0) {
    return null;
  }
  return { sessionId, page };
}

function waitlistControlSelectFromCustomId(
  customId: string,
): ParsedWaitlistControlSelectAction | null {
  if (!customId.startsWith("waitctl:select:")) {
    return null;
  }
  const [, , sessionId, rawPage] = customId.split(":");
  const page = Number(rawPage);
  if (!sessionId || !Number.isInteger(page) || page < 0) {
    return null;
  }
  return { sessionId, page };
}

function banControlCustomId(
  action: BanControlAction,
  sessionIdOrToken?: string | null,
) {
  return sessionIdOrToken
    ? `banctl:${action}:${sessionIdOrToken}`
    : `banctl:${action}`;
}

function banControlModalId(
  action: "create" | "missing" | "conditional",
  sessionId: string,
) {
  return `banctl-modal:${action}:${sessionId}`;
}

function banControlActionFromCustomId(
  customId: string,
): ParsedBanControlAction | null {
  if (!customId.startsWith("banctl:")) {
    return null;
  }
  const [, action, value] = customId.split(":");
  if (!isBanControlAction(action)) {
    return null;
  }
  if (action === "confirm" || action === "cancel") {
    return { action, sessionId: null, token: value ?? null };
  }
  return { action, sessionId: value ?? null, token: null };
}

function banControlModalFromCustomId(customId: string): {
  action: "create" | "missing" | "conditional";
  sessionId: string;
} | null {
  if (!customId.startsWith("banctl-modal:")) {
    return null;
  }
  const [, action, sessionId] = customId.split(":");
  if (
    (action !== "create" && action !== "missing" && action !== "conditional") ||
    !sessionId
  ) {
    return null;
  }
  return { action, sessionId };
}

function manageCardBanActionFromCustomId(
  customId: string,
): ParsedManageCardBanAction | null {
  if (!customId.startsWith("cardban:")) {
    return null;
  }
  const [, action, sessionId, teamId] = customId.split(":");
  if ((action !== "d" && action !== "p") || !sessionId || !teamId) {
    return null;
  }
  return { action, sessionId, teamId };
}

function manageCardBanModalId(sessionId: string, teamId: string) {
  return `cardban-modal:${sessionId}:${teamId}`;
}

function manageCardPermanentBanModalId(sessionId: string, teamId: string) {
  return `cardban-permanent-modal:${sessionId}:${teamId}`;
}

function manageCardBanModalFromCustomId(
  customId: string,
): Pick<ParsedManageCardBanAction, "sessionId" | "teamId"> | null {
  if (!customId.startsWith("cardban-modal:")) {
    return null;
  }
  const [, sessionId, teamId] = customId.split(":");
  return sessionId && teamId ? { sessionId, teamId } : null;
}

function manageCardPermanentBanModalFromCustomId(
  customId: string,
): Pick<ParsedManageCardBanAction, "sessionId" | "teamId"> | null {
  if (!customId.startsWith("cardban-permanent-modal:")) {
    return null;
  }
  const [, sessionId, teamId] = customId.split(":");
  return sessionId && teamId ? { sessionId, teamId } : null;
}

function captainPanelActionFromCustomId(
  customId: string,
): ParsedCaptainPanelAction | null {
  if (!customId.startsWith("captain:")) {
    return null;
  }
  const [, action, sessionId] = customId.split(":");
  if (action !== "logo-help" || !sessionId) {
    return null;
  }
  return { action, sessionId };
}

function liveCenterActionFromCustomId(
  customId: string,
): ParsedLiveCenterAction | null {
  if (!customId.startsWith("livecenter:")) {
    return null;
  }
  const [, action, sessionId] = customId.split(":");
  if (action !== "refresh" || !sessionId) {
    return null;
  }
  return { action, sessionId };
}

function resultControlCustomId(action: ResultControlAction, sessionId: string) {
  return `resultctl:${action}:${sessionId}`;
}

function resultControlSessionSelectCustomId() {
  return "resultctl-session-select";
}

function resultEditMatchSelectCustomId(sessionId: string) {
  return `resultedit:match:${sessionId}`;
}

function resultEditMatchSelectFromCustomId(
  customId: string,
): ParsedResultEditMatchSelectAction | null {
  if (!customId.startsWith("resultedit:match:")) {
    return null;
  }
  const sessionId = customId.slice("resultedit:match:".length);
  return sessionId ? { sessionId } : null;
}

function resultEditSourceKey(source: Pick<ResultEditSource, "kind" | "id">) {
  return source.kind === "backup" ? `b_${source.id}` : source.id;
}

function resultEditSourceFromKey(sourceKey: string): ResultEditSource | null {
  const key = sourceKey.trim();
  if (!key) {
    return null;
  }
  if (key.startsWith("b_")) {
    const id = key.slice(2);
    return id ? { kind: "backup", id, key } : null;
  }
  if (key.startsWith("m_")) {
    const id = key.slice(2);
    return id ? { kind: "match", id, key } : null;
  }
  return { kind: "match", id: key, key };
}

function resultEditRowsSelectCustomId(
  sessionId: string,
  sourceKey: string,
  page: number,
) {
  return `resultedit:rows:${sessionId}:${sourceKey}:${page}`;
}

function resultEditRowsSelectFromCustomId(
  customId: string,
): ParsedResultEditRowsSelectAction | null {
  if (!customId.startsWith("resultedit:rows:")) {
    return null;
  }
  const [, , sessionId, sourceKey, rawPage] = customId.split(":");
  const page = Number(rawPage);
  if (!sessionId || !sourceKey || !Number.isInteger(page) || page < 0) {
    return null;
  }
  return { sessionId, sourceKey, page };
}

function resultEditPageCustomId(
  sessionId: string,
  sourceKey: string,
  page: number,
) {
  return `resultedit:page:${sessionId}:${sourceKey}:${page}`;
}

function resultEditPageFromCustomId(
  customId: string,
): ParsedResultEditPageAction | null {
  if (!customId.startsWith("resultedit:page:")) {
    return null;
  }
  const [, , sessionId, sourceKey, rawPage] = customId.split(":");
  const page = Number(rawPage);
  if (!sessionId || !sourceKey || !Number.isInteger(page) || page < 0) {
    return null;
  }
  return { sessionId, sourceKey, page };
}

function resultManualEditButtonCustomId(sessionId: string, sourceKey: string) {
  return `resultmanual:open:${sessionId}:${sourceKey}`;
}

function resultManualEditButtonFromCustomId(
  customId: string,
): ParsedResultManualEditAction | null {
  if (!customId.startsWith("resultmanual:open:")) {
    return null;
  }
  const [, , sessionId, sourceKey] = customId.split(":");
  if (!sessionId || !sourceKey) {
    return null;
  }
  return { sessionId, sourceKey };
}

function resultEditModalId(token: string) {
  return `resultedit-modal:${token}`;
}

function resultEditModalFromCustomId(
  customId: string,
): { token: string } | null {
  if (!customId.startsWith("resultedit-modal:")) {
    return null;
  }
  const token = customId.slice("resultedit-modal:".length);
  return token ? { token } : null;
}

function resultManualEditModalId(token: string) {
  return `resultmanual-modal:${token}`;
}

function resultManualEditModalFromCustomId(
  customId: string,
): { token: string } | null {
  if (!customId.startsWith("resultmanual-modal:")) {
    return null;
  }
  const token = customId.slice("resultmanual-modal:".length);
  return token ? { token } : null;
}

function resultControlActionFromCustomId(
  customId: string,
): ParsedResultControlAction | null {
  if (!customId.startsWith("resultctl:")) {
    return null;
  }
  const [, action, ...rest] = customId.split(":");
  const sessionId = rest.join(":");
  if (!isResultControlAction(action) || !sessionId) {
    return null;
  }
  return { action, sessionId };
}

function resultBanSelectCustomId(
  sessionId: string,
  panelChannelId?: string | null,
  panelMessageId?: string | null,
) {
  return [
    "resultban",
    "select",
    sessionId,
    panelChannelId ?? "",
    panelMessageId ?? "",
  ].join(":");
}

function resultBanSelectFromCustomId(
  customId: string,
): ParsedResultBanSelectAction | null {
  if (!customId.startsWith("resultban:select:")) {
    return null;
  }
  const [, , sessionId, panelChannelId, panelMessageId] = customId.split(":");
  if (!sessionId) {
    return null;
  }
  return {
    sessionId,
    panelChannelId: panelChannelId || null,
    panelMessageId: panelMessageId || null,
  };
}

function resultBanPendingCustomId(
  action: ParsedResultBanPendingAction["action"],
  token: string,
) {
  return `resultban:${action}:${token}`;
}

function resultBanPendingFromCustomId(
  customId: string,
): ParsedResultBanPendingAction | null {
  if (!customId.startsWith("resultban:")) {
    return null;
  }
  const [, action, token] = customId.split(":");
  if ((action !== "unban" && action !== "cancel") || !token) {
    return null;
  }
  return { action, token };
}

function resultBanModalId(token: string) {
  return `resultban-modal:${token}`;
}

function resultBanModalFromCustomId(
  customId: string,
): { token: string } | null {
  if (!customId.startsWith("resultban-modal:")) {
    return null;
  }
  const [, token] = customId.split(":");
  return token ? { token } : null;
}

function resultControlSettingsModalId(
  kind: ResultControlSettingsKind,
  sessionId: string,
) {
  return `resultctl-modal:${kind}:${sessionId}`;
}

function resultControlSettingsModalFromCustomId(
  customId: string,
): ParsedResultControlSettingsModal | null {
  if (!customId.startsWith("resultctl-modal:")) {
    return null;
  }
  const [, kind, ...rest] = customId.split(":");
  const sessionId = rest.join(":");
  if (!isResultControlSettingsKind(kind) || !sessionId) {
    return null;
  }
  return { kind, sessionId };
}

function sessionManageCustomId(action: SessionManageAction, sessionId: string) {
  return `sessctl:${action}:${sessionId}`;
}

function sessionManageActionFromCustomId(
  customId: string,
): ParsedSessionManageAction | null {
  if (!customId.startsWith("sessctl:")) {
    return null;
  }
  const [, action, ...rest] = customId.split(":");
  const sessionId = rest.join(":");
  if (!isSessionManageAction(action) || !sessionId) {
    return null;
  }
  return { action, sessionId };
}

function isSessionManageAction(value: string): value is SessionManageAction {
  return [
    "refresh",
    "open-registration",
    "close-registration",
    "sync-discord",
    "waitlist",
    "slots",
    "standings",
    "start-match",
    "post-room",
    "map-slots",
    "preview-results",
    "apply-results",
    "no-show",
    "active-bans",
    "sync-logos",
    "sync-photos",
  ].includes(value);
}

function isResultControlAction(value: string): value is ResultControlAction {
  return [
    "refresh",
    "match",
    "overall",
    "ban",
    "text",
    "edit-results",
    "final-refresh",
    "final-repost",
    "defaults",
    "rules",
  ].includes(value);
}

function isResultControlSettingsKind(
  value: string,
): value is ResultControlSettingsKind {
  return ["text", "defaults", "rules"].includes(value);
}

function isBanControlAction(value: string): value is BanControlAction {
  return [
    "create",
    "missing",
    "conditional",
    "list",
    "refresh",
    "confirm",
    "cancel",
  ].includes(value);
}

function playStatusActionFromCustomId(
  customId: string,
): ParsedPlayStatusAction | null {
  if (!customId.startsWith("play:")) {
    return null;
  }
  const [, action, sessionId] = customId.split(":");
  if (!sessionId) {
    return null;
  }
  if (action === "confirm") {
    return { action: "CONFIRM", sessionId };
  }
  if (action === "not") {
    return { action: "NOT_PLAYING", sessionId };
  }
  return null;
}

function playStatusTargetSelectCustomId(
  action: RegistrationPlayStatusAction,
  sessionId: string,
) {
  return `playpick:${action === "NOT_PLAYING" ? "n" : "c"}:${sessionId}`;
}

function playStatusTargetSelectFromCustomId(
  customId: string,
): ParsedPlayStatusTargetSelectAction | null {
  if (!customId.startsWith("playpick:")) {
    return null;
  }
  const [, action, sessionId] = customId.split(":");
  if (!sessionId) {
    return null;
  }
  if (action === "c") {
    return { action: "CONFIRM", sessionId };
  }
  if (action === "n") {
    return { action: "NOT_PLAYING", sessionId };
  }
  return null;
}

function registrationSlotModalId(sessionId: string, registrationId: string) {
  return `regslot:${sessionId}:${registrationId}`;
}

function registrationSlotModalFromCustomId(
  customId: string,
): Pick<
  ParsedRegistrationControlAction,
  "sessionId" | "registrationId"
> | null {
  if (!customId.startsWith("regslot:")) {
    return null;
  }
  const [, sessionId, registrationId] = customId.split(":");
  return sessionId && registrationId ? { sessionId, registrationId } : null;
}

function isRegistrationControlAction(
  value: string,
): value is RegistrationControlAction {
  return ["a", "s", "w", "v", "r"].includes(value);
}

function isControlAction(value: string): value is ControlAction {
  return [
    "register-team",
    "join-scrim",
    "leave-scrim",
    "list-slots",
    "standings",
    "create-scrim",
    "configure-scrim",
    "setup-channels",
    "sync-discord",
    "remove-team",
    "start-scrim",
    "post-room",
    "map-slots",
    "preview-results",
    "apply-results",
  ].includes(value);
}

function limitDiscordContent(content: string) {
  if (content.length <= 1900) {
    return content;
  }
  return `${content.slice(0, 1870)}\n\nOutput truncated. Use the web dashboard for the full view.`;
}

function inputValue(interaction: ModalSubmitInteraction, customId: string) {
  return interaction.fields.getTextInputValue(customId).trim();
}

function optionalInputValue(
  interaction: ModalSubmitInteraction,
  customId: string,
) {
  try {
    return inputValue(interaction, customId);
  } catch {
    return "";
  }
}

export class ControlPanelService {
  private readonly activeSessionByGuildId = new Map<string, string>();
  private readonly pendingBanActions = new Map<
    string,
    PendingBanControlAction
  >();
  private readonly pendingResultUnbans = new Map<
    string,
    PendingResultUnbanAction
  >();
  private readonly pendingResultEdits = new Map<
    string,
    PendingResultEditAction
  >();
  private readonly pendingManualResultEdits = new Map<
    string,
    PendingManualResultEditAction
  >();

  constructor(private readonly sessionService: DiscordSessionService) {}

  private async syncWinnerRoleAccessForSourceSession(
    guild: Guild | null,
    sessionId: string,
    sourceRunFallbackId?: string | null,
  ) {
    const syncer = (
      this.sessionService as unknown as {
        syncWinnerRoleAccessForSourceSession?: DiscordSessionService["syncWinnerRoleAccessForSourceSession"];
      }
    ).syncWinnerRoleAccessForSourceSession;
    if (typeof syncer !== "function") {
      return;
    }
    await syncer.call(this.sessionService, guild, sessionId, {
      sourceRunFallbackId,
    });
  }

  private async resolveInteractionOrganizationId(
    interaction: PanelInteraction,
    sessionId?: string | null,
  ) {
    if (!interaction.guild || !interaction.channelId) {
      if (sessionId) {
        const context = await this.sessionService
          .getSessionContext(sessionId)
          .catch(() => null);
        return context?.config.organizationId ?? null;
      }
      return null;
    }

    const resolved = await this.sessionService
      .findScrimForDiscordChannel(interaction.guild.id, interaction.channelId)
      .catch(() => null);
    if (resolved && (!sessionId || resolved.session.id === sessionId)) {
      return resolved.config.organizationId;
    }
    if (sessionId) {
      const context = await this.sessionService
        .getSessionContext(sessionId)
        .catch(() => null);
      if (context?.config.organizationId) {
        return context.config.organizationId;
      }
    }
    if (interaction.guildId) {
      return Promise.race([
        this.sessionService.resolveOrganizationIdForGuild(interaction.guildId),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
      ]);
    }
    return null;
  }

  private async withInteractionOrganization<T>(
    interaction: PanelInteraction,
    sessionId: string | null | undefined,
    fn: () => Promise<T>,
  ) {
    const organizationId = await this.resolveInteractionOrganizationId(
      interaction,
      sessionId,
    );
    return this.sessionService.withOrganization(organizationId, fn);
  }

  buildControlPanelMessage(audience: ControlPanelAudience = "staff") {
    if (audience === "teams") {
      return this.buildTeamsPanelMessage();
    }
    if (audience === "staff") {
      return this.buildStaffPanelMessage();
    }
    throw new Error(
      `buildControlPanelMessage: unsupported audience "${audience}" — use postControlPanel instead`,
    );
  }

  async postControlPanel(
    interaction: ChatInputCommandInteraction,
    audience: ControlPanelAudience,
  ) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Control panels can only be posted inside a server.",
        ephemeral: true,
      });
      return;
    }

    if (audience === "manage") {
      await interaction.deferReply({ ephemeral: true });
      const context = await this.resolveSessionContextForInteraction(
        interaction,
        interaction.options.getString("session-id"),
      );
      if (!context) {
        await interaction.editReply(
          "No synced scrim session was found. Add a session ID or run this inside a synced scrim channel.",
        );
        return;
      }
      if (!(await this.canUseStaffControls(interaction, context.session.id))) {
        await interaction.editReply("Only Arenzyra staff can post this panel.");
        return;
      }
      const channel = interaction.channel;
      if (!channel?.isTextBased()) {
        await interaction.editReply("Run this command in a text channel.");
        return;
      }
      const panel = await channel.send(
        await this.buildSessionManagePanelMessage(context, interaction.guild),
      );
      await panel
        .pin("Pin Arenzyra session manage panel")
        .catch(() => undefined);
      await interaction.editReply(
        `Session manage panel posted in <#${channel.id}>.`,
      );
      return;
    }

    if (audience === "result") {
      await interaction.deferReply({ ephemeral: true });
      const submittedSessionId = interaction.options.getString("session-id");
      const context =
        await this.resolveResultControlSessionContextForInteraction(
          interaction,
          submittedSessionId,
        );
      if (!context) {
        await this.showResultControlSessionPicker(interaction);
        return;
      }
      if (!(await this.canUseStaffControls(interaction, context.session.id))) {
        await interaction.editReply("Only Arenzyra staff can post this panel.");
        return;
      }
      const channelId = await this.postResultControlPanelToChannel(
        interaction,
        context,
      );
      await interaction.editReply(
        `Result control panel posted in <#${channelId}> for **${context.session.name}**.`,
      );
      return;
    }

    if (!(await this.canUseStaffControls(interaction))) {
      await interaction.reply({
        content: "Only Arenzyra staff can post control panels.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const channel = interaction.channel;
    if (!channel?.isTextBased()) {
      await interaction.editReply("Run this command in a text channel.");
      return;
    }

    const panel = await channel.send(this.buildControlPanelMessage(audience));
    await panel.pin("Pin Arenzyra control panel").catch(() => undefined);
    await interaction.editReply(`Control panel posted in <#${channel.id}>.`);
  }

  async postOrUpdateResultControlPanel(
    guild: Guild | null | undefined,
    sessionId: string,
    options: { organizationId?: string | null } = {},
  ) {
    if (!guild) {
      return {
        posted: false,
        updated: false,
        channelId: null,
        messageId: null,
      };
    }

    const context = await this.sessionService.withOrganization(
      options.organizationId ?? null,
      () => this.sessionService.getSessionContext(sessionId),
    );
    const channelId = this.resultControlPanelChannelId(context.config);
    if (!channelId) {
      return {
        posted: false,
        updated: false,
        channelId: null,
        messageId: null,
      };
    }

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !("send" in channel)) {
      return { posted: false, updated: false, channelId, messageId: null };
    }

    const textChannel = channel as GuildTextBasedChannel;
    const payload = await this.buildResultControlPanelMessage(context, guild);
    const storedMessageId =
      context.config.emojis?.resultControlPanelMessageId?.trim() || null;
    const existing = storedMessageId
      ? await textChannel.messages.fetch(storedMessageId).catch(() => null)
      : null;
    if (existing?.editable) {
      await existing.edit(payload);
      return {
        posted: false,
        updated: true,
        channelId: textChannel.id,
        messageId: existing.id,
      };
    }

    const sent = await textChannel.send(payload);
    await this.sessionService
      .rememberResultControlPanelMessage(sessionId, textChannel.id, sent.id)
      .catch(() => undefined);
    return {
      posted: true,
      updated: false,
      channelId: textChannel.id,
      messageId: sent.id,
    };
  }

  private async resolveSyncedSessionContextForInteraction(
    interaction: PanelInteraction,
  ): Promise<ResolvedSessionContext | null> {
    if (!interaction.guild || !interaction.channelId) {
      return null;
    }
    const resolved = await this.sessionService
      .findScrimForDiscordChannel(interaction.guild.id, interaction.channelId)
      .catch(() => null);
    if (!resolved) {
      return null;
    }
    this.activeSessionByGuildId.set(interaction.guild.id, resolved.session.id);
    return { session: resolved.session, config: resolved.config };
  }

  private async resolveSubmittedSessionContextForInteraction(
    interaction: PanelInteraction,
    submittedSessionId: string | null | undefined,
  ): Promise<ResolvedSessionContext | null> {
    const sessionId = submittedSessionId?.trim();
    if (!sessionId) {
      return null;
    }

    const organizationId = await this.resolveInteractionOrganizationId(
      interaction,
      sessionId,
    );
    const direct = await this.sessionService
      .withOrganization(organizationId, () =>
        this.sessionService.getSessionContext(sessionId),
      )
      .catch(() => null);
    if (direct) {
      if (interaction.guildId) {
        this.activeSessionByGuildId.set(interaction.guildId, direct.session.id);
      }
      return direct;
    }

    if (!interaction.guildId) {
      return null;
    }
    const normalized = sessionId.toLowerCase();
    const activeContexts = await this.sessionService
      .listActiveGuildScrims(interaction.guildId)
      .catch(() => []);
    const named = activeContexts.find(
      (context) =>
        context.session.id.toLowerCase() === normalized ||
        context.session.name.toLowerCase() === normalized,
    );
    if (named) {
      this.activeSessionByGuildId.set(interaction.guildId, named.session.id);
      return named;
    }
    return null;
  }

  private async resolveResultControlSessionContextForInteraction(
    interaction: PanelInteraction,
    submittedSessionId: string | null | undefined,
  ): Promise<ResolvedSessionContext | null> {
    const submitted = submittedSessionId?.trim();
    if (submitted) {
      const submittedContext =
        await this.resolveSubmittedSessionContextForInteraction(
          interaction,
          submitted,
        );
      if (submittedContext) {
        return submittedContext;
      }
    }

    return this.resolveSyncedSessionContextForInteraction(interaction);
  }

  private resultSessionChoiceName(session: SessionResponse) {
    const counts = session.counts
      ? `${session.counts.confirmedCount}/${session.maxTeams}`
      : `${session.maxTeams} teams`;
    return this.truncateSelectText(
      `${session.name} | ${session.status} | ${counts}`,
      100,
    );
  }

  private resultSessionOptionDescription(context: ResolvedSessionContext) {
    const counts = context.session.counts;
    const summary = counts
      ? `${counts.confirmedCount} confirmed, ${counts.waitlistCount} waitlist`
      : `${context.session.maxTeams} max teams`;
    const channel =
      context.config.resultsChannelId || context.config.manageChannelId
        ? ` | results <#${context.config.resultsChannelId || context.config.manageChannelId}>`
        : "";
    return this.truncateSelectText(`${summary}${channel}`, 100);
  }

  private buildResultControlSessionSelect(contexts: ResolvedSessionContext[]) {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(resultControlSessionSelectCustomId())
        .setPlaceholder("Choose active scrim session")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
          contexts
            .slice(0, 25)
            .map((context) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(this.resultSessionChoiceName(context.session))
                .setDescription(this.resultSessionOptionDescription(context))
                .setValue(context.session.id),
            ),
        ),
    );
  }

  private async showResultControlSessionPicker(
    interaction: ChatInputCommandInteraction,
  ) {
    if (!interaction.guildId) {
      await interaction.editReply(
        "No Discord server was found for this command.",
      );
      return;
    }
    const contexts = await this.sessionService.listActiveGuildScrims(
      interaction.guildId,
    );
    if (contexts.length === 0) {
      await interaction.editReply(
        "No active synced scrim sessions were found for this Discord server.",
      );
      return;
    }
    await interaction.editReply({
      content:
        contexts.length > 25
          ? "Choose the result-control session. Showing the first 25 active sessions; use the `session-id` autocomplete option to search by name if needed."
          : "Choose the result-control session.",
      components: [this.buildResultControlSessionSelect(contexts)],
      allowedMentions: { parse: [] },
    });
  }

  private async postResultControlPanelToChannel(
    interaction: ChatInputCommandInteraction | StringSelectMenuInteraction,
    context: ResolvedSessionContext,
  ) {
    const channel = interaction.channel;
    if (!channel?.isTextBased() || channel.isDMBased()) {
      throw new Error("Run this command in a server text channel.");
    }
    const panel = await (channel as GuildTextBasedChannel).send(
      await this.buildResultControlPanelMessage(context, interaction.guild),
    );
    await this.sessionService
      .rememberResultControlPanelMessage(
        context.session.id,
        channel.id,
        panel.id,
      )
      .catch(() => undefined);
    await panel.pin("Pin Arenzyra result control panel").catch(() => undefined);
    return channel.id;
  }

  async postBanControlPanel(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Ban controls can only be posted inside a server.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const channel = interaction.channel;
    if (!channel?.isTextBased()) {
      await interaction.editReply("Run this command in a text channel.");
      return;
    }

    const resolved = await this.sessionService.findScrimForDiscordChannel(
      interaction.guild!.id,
      interaction.channelId,
    );
    if (!resolved) {
      await interaction.editReply(
        "Use `/ban-control` inside a synced scrim Discord channel.",
      );
      return;
    }

    if (!(await this.canUseStaffControls(interaction, resolved.session.id))) {
      await interaction.editReply("Only Arenzyra staff can post ban controls.");
      return;
    }

    if (
      (resolved.config.emojis?.banControlsEnabled ?? "true")
        .trim()
        .toLowerCase() === "false"
    ) {
      await interaction.editReply(
        "Discord ban controls are disabled for this scrim in the web app.",
      );
      return;
    }

    const panel = await channel.send(
      this.buildBanControlPanelMessage(
        resolved.session.id,
        resolved.session.name,
        resolved.config,
      ),
    );
    await panel.pin("Pin Arenzyra ban control panel").catch(() => undefined);
    await interaction.editReply(
      `Ban control panel posted in <#${channel.id}>.`,
    );
  }

  async showWaitlistControlPanel(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Waitlist controls can only be opened inside a server.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const resolved = await this.sessionService.findScrimForDiscordChannel(
      interaction.guild!.id,
      interaction.channelId,
    );
    if (!resolved || resolved.channelKind !== "waitlist") {
      await interaction.editReply(
        "Use this command inside the scrim waitlist channel.",
      );
      return;
    }

    if (!(await this.canUseStaffControls(interaction, resolved.session.id))) {
      await interaction.editReply("Only Arenzyra staff can use this control.");
      return;
    }

    const panel = await this.sessionService.withOrganization(
      resolved.config.organizationId,
      () => this.sessionService.buildWaitlistControlPanel(resolved.session.id),
    );
    await interaction.editReply({
      ...panel.payload,
      content: panel.payload.content ?? undefined,
      allowedMentions: panel.payload.allowedMentions ?? { parse: [] },
    });
  }

  async postCaptainPanel(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Captain panels can only be posted inside a server.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const context = await this.resolveSessionContextForInteraction(
      interaction,
      interaction.options.getString("session-id"),
    );
    if (!context) {
      await interaction.editReply(
        "No synced scrim session was found for this channel. Add a session ID or run this inside a synced scrim channel.",
      );
      return;
    }

    if (!(await this.canUseStaffControls(interaction, context.session.id))) {
      await interaction.editReply("Only Arenzyra staff can post this panel.");
      return;
    }

    const channel = interaction.channel;
    if (!channel?.isTextBased()) {
      await interaction.editReply("Run this command in a text channel.");
      return;
    }

    const panel = this.buildCaptainPanelMessage(context);
    const message = await channel.send(panel);
    await message.pin("Pin Arenzyra captain panel").catch(() => undefined);
    await interaction.editReply(`Captain panel posted in <#${channel.id}>.`);
  }

  async postLiveCenter(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Live center can only be posted inside a server.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const context = await this.resolveSessionContextForInteraction(
      interaction,
      interaction.options.getString("session-id"),
    );
    if (!context) {
      await interaction.editReply(
        "No synced scrim session was found for this channel. Add a session ID or run this inside a synced scrim channel.",
      );
      return;
    }

    if (!(await this.canUseStaffControls(interaction, context.session.id))) {
      await interaction.editReply("Only Arenzyra staff can post live center.");
      return;
    }

    const channel = interaction.channel;
    if (!channel?.isTextBased()) {
      await interaction.editReply("Run this command in a text channel.");
      return;
    }

    const panel = await this.buildLiveCenterMessage(context, interaction.guild);
    const message = await channel.send(panel);
    await message.pin("Pin Arenzyra live center").catch(() => undefined);
    await interaction.editReply(`Live center posted in <#${channel.id}>.`);
  }

  async runDoctor(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Doctor can only inspect a Discord server.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const context = await this.resolveSessionContextForInteraction(
      interaction,
      interaction.options.getString("session-id"),
    );
    const guild = interaction.guild!;
    const botMember = await guild.members.fetchMe().catch(() => null);
    const lines = ["Arenzyra Discord Doctor", ""];

    if (!botMember) {
      lines.push("WARNING Bot member could not be fetched.");
      await interaction.editReply(limitDiscordContent(lines.join("\n")));
      return;
    }

    lines.push(
      botMember.permissions.has(PermissionFlagsBits.ManageEvents)
        ? "OK Manage Events permission is available."
        : "WARNING Manage Events permission is missing; scheduled events may fail.",
      botMember.permissions.has(PermissionFlagsBits.ManageRoles)
        ? "OK Manage Roles permission is available."
        : "WARNING Manage Roles permission is missing; slot/waitlist/ban role sync may fail.",
      botMember.permissions.has(PermissionFlagsBits.ManageChannels)
        ? "OK Manage Channels permission is available."
        : "WARNING Manage Channels permission is missing; setup/channel repair may fail.",
    );

    if (!context) {
      lines.push(
        "",
        "WARNING No synced scrim was resolved from this channel. Use a session ID to inspect a specific scrim.",
      );
      await interaction.editReply(limitDiscordContent(lines.join("\n")));
      return;
    }

    lines.push(
      "",
      `Session: ${context.session.name}`,
      `Status: ${context.session.status}`,
      `Slots: ${context.session.counts.confirmedCount}/${context.session.slotCount}`,
      `Waitlist: ${context.session.counts.waitlistCount}`,
      "",
      "Channels:",
    );

    const channelChecks: Array<[string, string | null]> = [
      ["registration", context.config.registrationChannelId],
      ["slot list", context.config.slotListChannelId],
      ["waitlist", context.config.waitlistChannelId],
      ["screenshots", context.config.screenshotsChannelId],
      ["results", context.config.resultsChannelId],
      ["bans", context.config.bansChannelId],
      ["log", context.config.logChannelId],
      ["manager", context.config.managerChannelId],
      ["idp", context.config.idpChannelId],
    ];

    for (const [label, channelId] of channelChecks) {
      if (!channelId) {
        lines.push(`WARNING ${label}: not configured`);
        continue;
      }
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        lines.push(`WARNING ${label}: channel missing or not text-based`);
        continue;
      }
      const permissions = channel.permissionsFor(botMember);
      const ok =
        permissions?.has(PermissionFlagsBits.ViewChannel) &&
        permissions.has(PermissionFlagsBits.SendMessages) &&
        permissions.has(PermissionFlagsBits.ReadMessageHistory) &&
        permissions.has(PermissionFlagsBits.EmbedLinks) &&
        permissions.has(PermissionFlagsBits.AttachFiles);
      lines.push(`${ok ? "OK" : "WARNING"} ${label}: <#${channelId}>`);
    }

    await interaction.editReply(limitDiscordContent(lines.join("\n")));
  }

  async createScheduledEvent(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Scheduled events can only be created inside a server.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const context = await this.resolveSessionContextForInteraction(
      interaction,
      interaction.options.getString("session-id"),
    );
    if (!context) {
      await interaction.editReply(
        "No synced scrim session was found. Add a session ID or run this inside a synced scrim channel.",
      );
      return;
    }

    if (!(await this.canUseStaffControls(interaction, context.session.id))) {
      await interaction.editReply("Only Arenzyra staff can create events.");
      return;
    }

    const startInput =
      interaction.options.getString("starts-at") ?? context.session.startsAt;
    const startsAt = this.parseEventDate(startInput);
    if (!startsAt) {
      await interaction.editReply(
        "Add `starts-at` or set the scrim start time in the web app first.",
      );
      return;
    }
    if (startsAt.getTime() <= Date.now()) {
      await interaction.editReply("Scheduled event start time must be future.");
      return;
    }

    const durationMinutes =
      interaction.options.getInteger("duration-minutes") ?? 120;
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
    const title =
      interaction.options.getString("title")?.trim() ||
      context.session.name ||
      "Arenzyra Scrim";
    const description =
      interaction.options.getString("description")?.trim() ||
      `Arenzyra scrim event for ${context.session.name}.`;
    const location = context.config.idpChannelId
      ? `Discord IDP channel: #${context.config.idpChannelName ?? "idp"}`
      : "Arenzyra Discord scrim channels";

    const event = await interaction.guild!.scheduledEvents.create({
      name: title.slice(0, 100),
      description: description.slice(0, 1000),
      scheduledStartTime: startsAt,
      scheduledEndTime: endsAt,
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: GuildScheduledEventEntityType.External,
      entityMetadata: { location: location.slice(0, 100) },
      reason: `Created by ${interaction.user.tag} from Arenzyra bot`,
    });

    await this.sessionService.sendDiscordActionLog(
      interaction.guild,
      context.config,
      {
        action: "Discord event scheduled",
        sessionId: context.session.id,
        sessionName: context.session.name,
        actorDiscordId: interaction.user.id,
        actorLabel: interaction.user.tag,
        sourceChannelId: interaction.channelId ?? null,
        status: title,
        details: [
          `Starts: <t:${Math.floor(startsAt.getTime() / 1000)}:F>`,
          `Event: https://discord.com/events/${interaction.guildId}/${event.id}`,
        ],
        color: 0x38bdf8,
      },
    );

    await interaction.editReply(
      [
        `${CHECK} Discord scheduled event created.`,
        `Event: https://discord.com/events/${interaction.guildId}/${event.id}`,
        `Starts: <t:${Math.floor(startsAt.getTime() / 1000)}:F>`,
      ].join("\n"),
    );
  }

  async showAuditTimeline(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Audit timeline can only be shown inside a server.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const context = await this.resolveSessionContextForInteraction(
      interaction,
      interaction.options.getString("session-id"),
    );
    if (!context) {
      await interaction.editReply(
        "No synced scrim session was found. Add a session ID or run this inside a synced scrim channel.",
      );
      return;
    }
    if (!(await this.canUseStaffControls(interaction, context.session.id))) {
      await interaction.editReply("Only Arenzyra staff can view audit logs.");
      return;
    }
    if (!context.config.logChannelId) {
      await interaction.editReply("This scrim has no Discord log channel.");
      return;
    }

    const channel = await interaction
      .guild!.channels.fetch(context.config.logChannelId)
      .catch(() => null);
    if (!channel?.isTextBased()) {
      await interaction.editReply("The configured log channel is unavailable.");
      return;
    }

    const messages = await channel.messages.fetch({ limit: 12 });
    const rows = messages
      .filter((message) => !message.system)
      .map((message) => {
        const title =
          message.embeds[0]?.title ||
          message.content.trim().split("\n")[0] ||
          "Arenzyra log entry";
        return `- <t:${Math.floor(message.createdTimestamp / 1000)}:R> ${title}`;
      });
    await interaction.editReply(
      limitDiscordContent(
        [
          `Audit timeline for ${context.session.name}`,
          "",
          rows.length ? rows.join("\n") : "No recent Discord log entries.",
        ].join("\n"),
      ),
    );
  }

  async previewMessageAuthorBan(
    interaction: MessageContextMenuCommandInteraction,
  ) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "Manager bans can only be started inside a server.",
        ephemeral: true,
      });
      return;
    }

    const targetMessage = interaction.targetMessage;
    if (targetMessage.author.bot) {
      await interaction.reply({
        content: "Bot messages cannot be manager-banned.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const context = await this.resolveSessionContextForInteraction(
      interaction,
      null,
    );
    if (!context) {
      await interaction.editReply(
        "Use this action inside a synced scrim channel so the bot knows the ban scope.",
      );
      return;
    }
    if (!(await this.canUseStaffControls(interaction, context.session.id))) {
      await interaction.editReply("Only Arenzyra staff can ban managers.");
      return;
    }

    const command: DiscordTeamBanCommand = {
      target: { kind: "manager", discordUserId: targetMessage.author.id },
      scope: "SESSION",
      sessionId: context.session.id,
      days: this.parseBanDurationDays(
        context.config.emojis?.banDefaultDurationDays ?? "",
        context.config,
      ),
      reason:
        context.config.emojis?.banDefaultReason || "Manual Discord manager ban",
      note: `Created from message context action: ${targetMessage.url}`,
      serverAction: null,
    };
    const preview = await this.withInteractionOrganization(
      interaction,
      context.session.id,
      () => this.sessionService.previewTeamBanFromDiscord(command),
    );
    const token = this.storePendingBanAction({
      kind: "team",
      userId: interaction.user.id,
      sessionId: context.session.id,
      command: preview.command,
      expiresAt: Date.now() + BAN_CONTROL_CONFIRMATION_TTL_MS,
    });
    await interaction.editReply({
      content: preview.content,
      components: [this.buildBanConfirmationRow(token, "Ban Manager")],
      allowedMentions: { parse: [] },
    });
  }

  async handleButton(interaction: ButtonInteraction) {
    const playStatus = playStatusActionFromCustomId(interaction.customId);
    if (playStatus) {
      await this.handlePlayStatusButton(interaction, playStatus);
      return true;
    }

    const waitlistPage = waitlistControlPageFromCustomId(interaction.customId);
    if (waitlistPage) {
      await this.handleWaitlistControlPageButton(interaction, waitlistPage);
      return true;
    }

    const removeConfirmation = registrationRemoveConfirmationFromCustomId(
      interaction.customId,
    );
    if (removeConfirmation) {
      await this.handleRegistrationRemoveConfirmationButton(
        interaction,
        removeConfirmation,
      );
      return true;
    }

    const registrationControl = registrationActionFromCustomId(
      interaction.customId,
    );
    if (registrationControl) {
      await this.handleRegistrationControlButton(
        interaction,
        registrationControl,
      );
      return true;
    }

    const banControl = banControlActionFromCustomId(interaction.customId);
    if (banControl) {
      await this.handleBanControlButton(interaction, banControl);
      return true;
    }

    const manageCardBan = manageCardBanActionFromCustomId(interaction.customId);
    if (manageCardBan) {
      await this.handleManageCardBanButton(interaction, manageCardBan);
      return true;
    }

    const captainAction = captainPanelActionFromCustomId(interaction.customId);
    if (captainAction) {
      await this.handleCaptainPanelButton(interaction, captainAction);
      return true;
    }

    const liveCenterAction = liveCenterActionFromCustomId(interaction.customId);
    if (liveCenterAction) {
      await this.handleLiveCenterButton(interaction, liveCenterAction);
      return true;
    }

    const resultBanPending = resultBanPendingFromCustomId(interaction.customId);
    if (resultBanPending) {
      await this.handleResultBanPendingButton(interaction, resultBanPending);
      return true;
    }

    const resultEditPage = resultEditPageFromCustomId(interaction.customId);
    if (resultEditPage) {
      await this.handleResultEditPageButton(interaction, resultEditPage);
      return true;
    }

    const resultManualEdit = resultManualEditButtonFromCustomId(
      interaction.customId,
    );
    if (resultManualEdit) {
      await this.handleResultManualEditButton(interaction, resultManualEdit);
      return true;
    }

    const resultControlAction = resultControlActionFromCustomId(
      interaction.customId,
    );
    if (resultControlAction) {
      await this.handleResultControlButton(interaction, resultControlAction);
      return true;
    }

    const sessionManageAction = sessionManageActionFromCustomId(
      interaction.customId,
    );
    if (sessionManageAction) {
      await this.handleSessionManageButton(interaction, sessionManageAction);
      return true;
    }

    const parsed = actionFromCustomId(interaction.customId, "control:");
    if (!parsed) {
      return false;
    }

    if (
      STAFF_ACTIONS.has(parsed.action) &&
      !(await this.canUseStaffControls(interaction, parsed.sessionId))
    ) {
      await interaction.reply({
        content: "Only Arenzyra staff can use this control.",
        ephemeral: true,
      });
      return true;
    }

    if (parsed.sessionId && parsed.action === "list-slots") {
      await interaction.deferReply({ ephemeral: true });
      const content = await this.sessionService.listSlots(
        parsed.sessionId,
        interaction.guild,
      );
      await interaction.editReply(limitDiscordContent(content));
      return true;
    }

    if (parsed.sessionId && parsed.action === "standings") {
      await interaction.deferReply({ ephemeral: true });
      const content = await this.sessionService.standings(parsed.sessionId);
      await interaction.editReply(limitDiscordContent(content));
      return true;
    }

    await interaction.showModal(
      this.buildModal(parsed.action, parsed.sessionId),
    );
    return true;
  }

  async handleStringSelectMenu(interaction: StringSelectMenuInteraction) {
    if (interaction.customId === resultControlSessionSelectCustomId()) {
      await this.handleResultControlSessionSelect(interaction);
      return true;
    }

    const resultEditMatchSelect = resultEditMatchSelectFromCustomId(
      interaction.customId,
    );
    if (resultEditMatchSelect) {
      await this.handleResultEditMatchSelect(
        interaction,
        resultEditMatchSelect,
      );
      return true;
    }

    const resultEditRowsSelect = resultEditRowsSelectFromCustomId(
      interaction.customId,
    );
    if (resultEditRowsSelect) {
      await this.handleResultEditRowsSelect(interaction, resultEditRowsSelect);
      return true;
    }

    const playStatusTarget = playStatusTargetSelectFromCustomId(
      interaction.customId,
    );
    if (playStatusTarget) {
      await this.handlePlayStatusTargetSelect(interaction, playStatusTarget);
      return true;
    }

    const resultBanSelect = resultBanSelectFromCustomId(interaction.customId);
    if (resultBanSelect) {
      await this.handleResultBanSelect(interaction, resultBanSelect);
      return true;
    }

    const parsed = waitlistControlSelectFromCustomId(interaction.customId);
    if (!parsed) {
      return false;
    }

    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can use this control.",
        ephemeral: true,
      });
      return true;
    }

    const registrationId = interaction.values[0];
    if (!registrationId) {
      await interaction.reply({
        content: "Select one waitlist team first.",
        ephemeral: true,
      });
      return true;
    }

    const target = await this.withInteractionOrganization(
      interaction,
      parsed.sessionId,
      () =>
        this.sessionService.describeRegistrationControlTarget(
          parsed.sessionId,
          registrationId,
        ),
    );
    if (!target.found) {
      await interaction.reply({
        content: target.content,
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return true;
    }

    await interaction.reply({
      content: target.content,
      components: [
        this.buildRegistrationControlActionRow(
          parsed.sessionId,
          registrationId,
        ),
      ],
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return true;
  }

  private async handleResultControlSessionSelect(
    interaction: StringSelectMenuInteraction,
  ) {
    const sessionId = interaction.values[0]?.trim();
    if (!sessionId) {
      await interaction.reply({
        content: "Select a session first.",
        ephemeral: true,
      });
      return;
    }

    if (!(await this.canUseStaffControls(interaction, sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can post this panel.",
        ephemeral: true,
      });
      return;
    }

    await interaction.update({
      content: "Posting result control panel...",
      components: [],
    });
    const context = await this.resolveSessionContextForInteraction(
      interaction,
      sessionId,
    );
    if (!context) {
      await interaction.editReply("This session is no longer available.");
      return;
    }
    const channelId = await this.postResultControlPanelToChannel(
      interaction,
      context,
    );
    await interaction.editReply(
      `Result control panel posted in <#${channelId}> for **${context.session.name}**.`,
    );
  }

  async autocompleteResultControlSession(interaction: AutocompleteInteraction) {
    if (!interaction.guildId) {
      await interaction.respond([]);
      return;
    }

    const focused = String(interaction.options.getFocused() ?? "")
      .trim()
      .toLowerCase();
    const contexts = await this.sessionService
      .listActiveGuildScrims(interaction.guildId)
      .catch(() => []);
    const choices = contexts
      .filter((context) => {
        if (!focused) {
          return true;
        }
        return (
          context.session.name.toLowerCase().includes(focused) ||
          context.session.id.toLowerCase().includes(focused) ||
          context.session.status.toLowerCase().includes(focused)
        );
      })
      .slice(0, 25)
      .map((context) => ({
        name: this.resultSessionChoiceName(context.session),
        value: context.session.id,
      }));
    await interaction.respond(choices);
  }

  private async handleWaitlistControlPageButton(
    interaction: ButtonInteraction,
    parsed: ParsedWaitlistControlPageAction,
  ) {
    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can use this control.",
        ephemeral: true,
      });
      return;
    }

    const panel = await this.withInteractionOrganization(
      interaction,
      parsed.sessionId,
      () =>
        this.sessionService.buildWaitlistControlPanel(
          parsed.sessionId,
          parsed.page,
        ),
    );
    await interaction.update({
      ...panel.payload,
      content: panel.payload.content ?? undefined,
      allowedMentions: panel.payload.allowedMentions ?? { parse: [] },
    });
  }

  private async handlePlayStatusButton(
    interaction: ButtonInteraction,
    parsed: ParsedPlayStatusAction,
  ) {
    if (!interaction.guild) {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(
          "Use this control inside the Discord server.",
        );
      } else {
        await interaction.reply({
          content: "Use this control inside the Discord server.",
          ephemeral: true,
        });
      }
      return;
    }

    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }
    const targetResolution = await this.withInteractionOrganization(
      interaction,
      parsed.sessionId,
      () =>
        this.sessionService.resolveRegistrationPlayStatusTargets(
          parsed.sessionId,
          interaction.user.id,
          parsed.action,
        ),
    );
    if (targetResolution.kind === "blocked") {
      await interaction.editReply(
        limitDiscordContent(targetResolution.content),
      );
      this.deleteInteractionReplySoon(interaction);
      return;
    }

    if (targetResolution.kind === "multiple") {
      await interaction.editReply({
        content: limitDiscordContent(targetResolution.content),
        components: [
          this.buildPlayStatusTargetSelect(parsed, targetResolution.targets),
        ],
        allowedMentions: { parse: [] },
      });
      return;
    }

    const content = await this.withInteractionOrganization(
      interaction,
      parsed.sessionId,
      () =>
        this.sessionService.updateRegistrationPlayStatus(
          parsed.sessionId,
          interaction.user.id,
          interaction.user.username,
          parsed.action,
          interaction.guild,
          {
            actorDiscordId: interaction.user.id,
            actorLabel: interaction.user.tag,
            sourceChannelId: interaction.channelId ?? null,
          },
          { registrationId: targetResolution.target.registrationId },
        ),
    );
    await interaction.editReply(limitDiscordContent(content));
    this.deleteInteractionReplySoon(interaction);
  }

  private async handlePlayStatusTargetSelect(
    interaction: StringSelectMenuInteraction,
    parsed: ParsedPlayStatusTargetSelectAction,
  ) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "Use this control inside the Discord server.",
        ephemeral: true,
      });
      return;
    }

    const selected = interaction.values[0];
    if (!selected) {
      await interaction.reply({
        content: "Select a team first.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferUpdate();
    const content = await this.withInteractionOrganization(
      interaction,
      parsed.sessionId,
      () =>
        this.sessionService.updateRegistrationPlayStatus(
          parsed.sessionId,
          interaction.user.id,
          interaction.user.username,
          parsed.action,
          interaction.guild,
          {
            actorDiscordId: interaction.user.id,
            actorLabel: interaction.user.tag,
            sourceChannelId: interaction.channelId ?? null,
          },
          selected === "all"
            ? { applyAll: true }
            : { registrationId: selected },
        ),
    );
    await interaction.editReply({
      content: limitDiscordContent(content),
      components: [],
      allowedMentions: { parse: [] },
    });
    this.deleteInteractionReplySoon(interaction);
  }

  private buildPlayStatusTargetSelect(
    parsed: ParsedPlayStatusAction,
    targets: RegistrationPlayStatusTarget[],
  ) {
    const actionLabel =
      parsed.action === "NOT_PLAYING" ? "mark not playing" : "confirm";
    const options = targets
      .slice(0, 24)
      .map((target) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(target.optionLabel)
          .setDescription(target.optionDescription)
          .setValue(target.registrationId),
      );
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel("All teams")
        .setDescription(`Apply to all ${targets.length} teams`)
        .setValue("all"),
    );

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(
          playStatusTargetSelectCustomId(parsed.action, parsed.sessionId),
        )
        .setPlaceholder(`Choose team to ${actionLabel}`)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options),
    );
  }

  private deleteInteractionReplySoon(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
  ) {
    setTimeout(() => {
      void interaction.deleteReply().catch(() => undefined);
    }, ACTION_CONFIRMATION_DELETE_DELAY_MS).unref?.();
  }

  private async showRegistrationRemovalConfirmation(
    interaction: ButtonInteraction,
    parsed: ParsedRegistrationControlAction,
  ) {
    const confirmId = `regctl:rm:confirm:${parsed.sessionId}:${parsed.registrationId}`;
    const cancelId = `regctl:rm:cancel:${parsed.sessionId}:${parsed.registrationId}`;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(confirmId)
        .setLabel("Remove Team")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(cancelId)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({
      content: [
        "Remove this team from the scrim?",
        "This releases its slot/waitlist placement and roster links.",
        "Confirm within 30 seconds.",
      ].join("\n"),
      components: [row],
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  }

  private async handleRegistrationRemoveConfirmationButton(
    interaction: ButtonInteraction,
    parsed: ParsedRegistrationRemoveConfirmationAction,
  ) {
    if (parsed.action === "expired") {
      await interaction.reply({
        content: "This removal confirmation expired. Press Remove again.",
        ephemeral: true,
      });
      return;
    }

    if (!parsed.sessionId || !parsed.registrationId) {
      await interaction.reply({
        content: "This removal confirmation is invalid. Press Remove again.",
        ephemeral: true,
      });
      return;
    }

    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can use this control.",
        ephemeral: true,
      });
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: "Run this control inside the Discord server.",
        ephemeral: true,
      });
      return;
    }

    if (parsed.action === "cancel") {
      await interaction.update({
        content: "Team removal cancelled.",
        components: [],
      });
      return;
    }

    await interaction.update({
      content: "Removing team...",
      components: [],
    });
    const content = await this.withInteractionOrganization(
      interaction,
      parsed.sessionId,
      () =>
        this.sessionService.updateRegistrationPlacement(
          parsed.sessionId!,
          parsed.registrationId!,
          { action: "REMOVE" },
          interaction.guild,
          {
            actorDiscordId: interaction.user.id,
            actorLabel: interaction.user.tag,
            sourceChannelId: interaction.channelId ?? null,
          },
        ),
    );
    await interaction.editReply(limitDiscordContent(content));
  }

  async handleModalSubmit(interaction: ModalSubmitInteraction) {
    const registrationSlotModal = registrationSlotModalFromCustomId(
      interaction.customId,
    );
    if (registrationSlotModal) {
      await this.handleRegistrationSlotModal(
        interaction,
        registrationSlotModal,
      );
      return true;
    }

    const resultBanModal = resultBanModalFromCustomId(interaction.customId);
    if (resultBanModal) {
      await this.handleResultBanModal(interaction, resultBanModal);
      return true;
    }

    const resultEditModal = resultEditModalFromCustomId(interaction.customId);
    if (resultEditModal) {
      await this.handleResultEditModal(interaction, resultEditModal);
      return true;
    }

    const resultManualEditModal = resultManualEditModalFromCustomId(
      interaction.customId,
    );
    if (resultManualEditModal) {
      await this.handleResultManualEditModal(
        interaction,
        resultManualEditModal,
      );
      return true;
    }

    const resultControlSettingsModal = resultControlSettingsModalFromCustomId(
      interaction.customId,
    );
    if (resultControlSettingsModal) {
      await this.handleResultControlSettingsModal(
        interaction,
        resultControlSettingsModal,
      );
      return true;
    }

    const banControlModal = banControlModalFromCustomId(interaction.customId);
    if (banControlModal) {
      await this.handleBanControlModal(interaction, banControlModal);
      return true;
    }

    const manageCardBanModal = manageCardBanModalFromCustomId(
      interaction.customId,
    );
    if (manageCardBanModal) {
      await this.handleManageCardBanModal(interaction, manageCardBanModal);
      return true;
    }

    const manageCardPermanentBanModal = manageCardPermanentBanModalFromCustomId(
      interaction.customId,
    );
    if (manageCardPermanentBanModal) {
      await this.handleManageCardPermanentBanModal(
        interaction,
        manageCardPermanentBanModal,
      );
      return true;
    }

    const parsed = actionFromCustomId(interaction.customId, "control-modal:");
    if (!parsed) {
      return false;
    }

    if (
      STAFF_ACTIONS.has(parsed.action) &&
      !(await this.canUseStaffControls(interaction, parsed.sessionId))
    ) {
      await interaction.reply({
        content: "Only Arenzyra staff can use this control.",
        ephemeral: true,
      });
      return true;
    }

    await this.executeModalAction(interaction, parsed);
    return true;
  }

  private async handleCaptainPanelButton(
    interaction: ButtonInteraction,
    parsed: ParsedCaptainPanelAction,
  ) {
    if (parsed.action !== "logo-help") {
      return;
    }

    const context = await this.resolveSessionContextForInteraction(
      interaction,
      parsed.sessionId,
    );
    const logoChannelId = context?.config.emojis?.organizationLogoChannelId
      ? context.config.emojis.organizationLogoChannelId
      : context?.config.screenshotsChannelId;
    await interaction.reply({
      content: [
        "Logo upload",
        logoChannelId
          ? `Use \`/team-media logo\` with a PNG, JPG, or WEBP image in <#${logoChannelId}>. The legacy \`%logo\` format also remains available during migration.`
          : "Use `/team-media logo` with a PNG, JPG, or WEBP image in the synced logo channel. The legacy `%logo` format also remains available during migration.",
        "The saved logo is reused for registrations, slots, and result widgets.",
      ].join("\n"),
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  }

  private async handleLiveCenterButton(
    interaction: ButtonInteraction,
    parsed: ParsedLiveCenterAction,
  ) {
    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can refresh live center.",
        ephemeral: true,
      });
      return;
    }
    const context = await this.resolveSessionContextForInteraction(
      interaction,
      parsed.sessionId,
    );
    if (!context) {
      await interaction.reply({
        content: "This live center is no longer linked to a scrim.",
        ephemeral: true,
      });
      return;
    }
    await interaction.update(
      await this.buildLiveCenterMessage(context, interaction.guild),
    );
  }

  private async handleResultControlButton(
    interaction: ButtonInteraction,
    parsed: ParsedResultControlAction,
  ) {
    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can use this result panel.",
        ephemeral: true,
      });
      return;
    }

    const context = await this.resolveSessionContextForInteraction(
      interaction,
      parsed.sessionId,
    );
    if (!context) {
      await interaction.reply({
        content: "This result panel is no longer linked to a scrim session.",
        ephemeral: true,
      });
      return;
    }

    if (parsed.action === "refresh") {
      await interaction.update(
        await this.buildResultControlPanelMessage(context, interaction.guild),
      );
      return;
    }

    if (parsed.action === "text") {
      await interaction.showModal(
        this.buildResultTextSettingsModal(parsed.sessionId, context.config),
      );
      return;
    }

    if (parsed.action === "defaults") {
      await interaction.showModal(
        this.buildResultBanDefaultsSettingsModal(
          parsed.sessionId,
          context.config,
        ),
      );
      return;
    }

    if (parsed.action === "rules") {
      await interaction.showModal(
        this.buildResultNoShowRulesSettingsModal(
          parsed.sessionId,
          context.config,
        ),
      );
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    if (parsed.action === "final-refresh" || parsed.action === "final-repost") {
      await this.handleFinalResultPostControl(
        interaction,
        context,
        parsed.action === "final-refresh" ? "refresh" : "repost",
      );
      return;
    }

    if (parsed.action === "edit-results") {
      await this.handleResultEditStart(interaction, context);
      return;
    }

    if (parsed.action === "match") {
      const matches = await this.sessionService.withOrganization(
        context.config.organizationId,
        () =>
          this.sessionService.listSessionMatchesForDiscord(parsed.sessionId),
      );
      const lines = [
        "Match Results",
        `Session: ${context.session.name}`,
        matches.length
          ? `Matches: ${matches.length}`
          : "No matches created yet.",
        "",
        ...matches
          .slice()
          .sort(
            (left, right) => (right.matchNumber ?? 0) - (left.matchNumber ?? 0),
          )
          .slice(0, 8)
          .map(
            (match) =>
              `- ${match.matchNumber ? `G${match.matchNumber}` : (match.name ?? "Match")} | ${match.status} | ID ${match.id}`,
          ),
        context.config.screenshotsChannelId
          ? `Screenshots: <#${context.config.screenshotsChannelId}>`
          : "Screenshots channel is not configured.",
        context.config.resultsChannelId
          ? `Results: <#${context.config.resultsChannelId}>`
          : "Results channel is not configured.",
      ].filter((line) => line !== "");
      await interaction.editReply({
        content: limitDiscordContent(lines.join("\n")),
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (parsed.action === "overall") {
      const content = await this.sessionService.withOrganization(
        context.config.organizationId,
        () => this.sessionService.standings(parsed.sessionId),
      );
      await interaction.editReply({
        content: limitDiscordContent(content),
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (parsed.action !== "ban") {
      await interaction.editReply({
        content:
          "Unknown result control action. Refresh the panel and try again.",
        allowedMentions: { parse: [] },
      });
      return;
    }

    const state = await this.sessionService.withOrganization(
      context.config.organizationId,
      () =>
        this.sessionService.getResultControlStateForDiscord(parsed.sessionId),
    );
    if (!state.targets.length) {
      await interaction.editReply({
        content: "No active team or manager bans for this session.",
        allowedMentions: { parse: [] },
      });
      return;
    }

    await interaction.editReply({
      content: [
        "Ban Control",
        `Active team ban records: ${state.activeTeamBanCount}`,
        `Active manager ban records: ${state.activeManagerBanCount}`,
        "Select a row to review unban controls.",
      ].join("\n"),
      components: [
        this.buildResultBanSelectRow(
          parsed.sessionId,
          state.targets,
          interaction.channelId,
          interaction.message.id,
        ),
      ],
      allowedMentions: { parse: [] },
    });
  }

  private async handleResultControlSettingsModal(
    interaction: ModalSubmitInteraction,
    parsed: ParsedResultControlSettingsModal,
  ) {
    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can update result settings.",
        ephemeral: true,
      });
      return;
    }

    const context = await this.resolveSessionContextForInteraction(
      interaction,
      parsed.sessionId,
    );
    if (!context) {
      await interaction.reply({
        content: "This result panel is no longer linked to a scrim session.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      const emojiPatch =
        parsed.kind === "text"
          ? this.resultTextSettingsPatch(interaction)
          : parsed.kind === "defaults"
            ? this.resultBanDefaultsSettingsPatch(interaction, context.config)
            : this.resultNoShowRulesSettingsPatch(interaction, context.config);
      await this.sessionService.withOrganization(
        context.config.organizationId,
        () =>
          this.sessionService.updateResultControlSettings(
            parsed.sessionId,
            emojiPatch,
          ),
      );
      await this.refreshStoredResultControlPanel(
        interaction.guild,
        {
          sessionId: parsed.sessionId,
          panelChannelId: null,
          panelMessageId: null,
        },
        context.config.organizationId,
      );
      await interaction.editReply({
        content:
          parsed.kind === "text"
            ? "Result text settings saved."
            : parsed.kind === "defaults"
              ? "Result ban defaults saved."
              : "Result no-show ban rules saved.",
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Result settings could not be saved.";
      await interaction.editReply({
        content: limitDiscordContent(`Result settings not saved: ${message}`),
        allowedMentions: { parse: [] },
      });
    }
  }

  private resultTextSettingsPatch(interaction: ModalSubmitInteraction) {
    const winnerCount = optionalInputValue(interaction, "winner-count");
    if (winnerCount) {
      const parsed = Number(winnerCount);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 20) {
        throw new Error("Winner count must be a number from 0 to 20.");
      }
    }

    return {
      finalResultPostTemplate: optionalInputValue(interaction, "post-template"),
      finalResultMessageTemplate: optionalInputValue(
        interaction,
        "message-template",
      ),
      finalResultWinnerRowTemplate: optionalInputValue(
        interaction,
        "winner-row-template",
      ),
      finalResultWinnerCount: winnerCount,
      finalResultRankEmojis: optionalInputValue(interaction, "rank-emojis"),
    };
  }

  private resultBanDefaultsSettingsPatch(
    interaction: ModalSubmitInteraction,
    config: SessionDiscordConfigResponse,
  ) {
    const defaultScope = optionalInputValue(interaction, "default-scope");
    const durationDays = optionalInputValue(interaction, "duration-days");
    const serverAction = optionalInputValue(interaction, "server-action");

    return {
      banDefaultScope: this.normalizeResultBanScope(defaultScope),
      banDefaultDurationDays: this.normalizeResultBanDuration(
        durationDays,
        config,
      ),
      banDefaultReason: optionalInputValue(interaction, "default-reason"),
      banServerAction: this.normalizeResultBanServerAction(serverAction),
    };
  }

  private resultNoShowRulesSettingsPatch(
    interaction: ModalSubmitInteraction,
    config: SessionDiscordConfigResponse,
  ) {
    return {
      noShowBanRules: this.normalizeNoShowCustomRules(
        {
          totalRules: optionalInputValue(interaction, "total-rules"),
          matchRules: optionalInputValue(interaction, "match-rules"),
          defaultScope: optionalInputValue(interaction, "default-scope"),
          defaultReason: optionalInputValue(interaction, "default-reason"),
        },
        config,
      ),
    };
  }

  private normalizeResultBanScope(value: string) {
    const raw = value.trim();
    if (!raw) {
      return "";
    }
    if (/^(?:sessions?|scrims?)\s*[:=]\s*.+$/i.test(raw)) {
      return raw;
    }
    const normalized = raw.toLowerCase().replace(/[\s_]+/g, "-");
    if (["session", "scrim", "current"].includes(normalized)) {
      return "SESSION";
    }
    if (
      [
        "team",
        "teams",
        "all-sessions",
        "all-session",
        "global",
        "all",
      ].includes(normalized)
    ) {
      return "TEAM";
    }
    if (["match", "matches"].includes(normalized)) {
      return "MATCH";
    }
    if (["all-matches", "allmatches"].includes(normalized)) {
      return "all-matches";
    }
    if (["server", "guild", "discord-server"].includes(normalized)) {
      return "server";
    }
    throw new Error(
      "Default scope must be session, all-sessions, match, all-matches, server, or sessions: name1,name2.",
    );
  }

  private normalizeResultBanDuration(
    value: string,
    config: SessionDiscordConfigResponse,
  ) {
    const raw = value.trim();
    if (!raw) {
      return "";
    }
    this.parseBanDurationDays(raw, config);
    return /^(permanent|perm|none|0)$/i.test(raw) ? "permanent" : raw;
  }

  private normalizeResultBanServerAction(value: string) {
    const raw = value.trim();
    if (!raw) {
      return "";
    }
    const normalized = raw.toLowerCase().replace(/[\s_]+/g, "-");
    if (["role", "banned-role", "ban-role"].includes(normalized)) {
      return "ROLE";
    }
    if (["none", "off", "disabled"].includes(normalized)) {
      return "NONE";
    }
    if (["discord-ban", "server-ban", "ban"].includes(normalized)) {
      return "DISCORD_BAN";
    }
    throw new Error("Server action must be ROLE, NONE, or DISCORD_BAN.");
  }

  private normalizeNoShowBanRules(value: string) {
    const raw = value.trim();
    if (!raw) {
      return "";
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("No-show rules must be valid JSON.");
    }
    if (!Array.isArray(parsed)) {
      throw new Error("No-show rules must be a JSON array.");
    }
    const rules = parsed.map((entry, index) =>
      this.normalizeNoShowRuleRecord(entry, `No-show rule #${index + 1}`),
    );
    return rules.length ? JSON.stringify(rules) : "";
  }

  private normalizeNoShowRuleRecord(
    entry: unknown,
    label: string,
  ): ResultNoShowRuleSetting {
    if (!entry || typeof entry !== "object") {
      throw new Error(`${label} must be an object.`);
    }
    const record = entry as Record<string, unknown>;
    const type = this.normalizeNoShowRuleType(record);
    const misses =
      type === "TOTAL_MISSES"
        ? this.parseNoShowPositiveInt(
            record.misses,
            1,
            20,
            1,
            `${label} misses`,
          )
        : null;
    const matchNumber =
      type === "MATCH_MISSED"
        ? this.parseNoShowPositiveInt(
            record.matchNumber ?? record.match ?? record.game,
            1,
            99,
            1,
            `${label} match number`,
          )
        : null;
    return {
      enabled: record.enabled === true,
      type,
      misses,
      matchNumber,
      durationDays: this.parseNoShowDurationDays(
        Object.prototype.hasOwnProperty.call(record, "durationDays")
          ? record.durationDays
          : record.days,
        record,
        label,
      ),
      scope: this.normalizeNoShowRuleScope(
        typeof record.scope === "string" ? record.scope : "",
        null,
      ),
      reason:
        typeof record.reason === "string" && record.reason.trim()
          ? record.reason.trim()
          : "Missed {misses} match(es) in {session}",
    };
  }

  private normalizeNoShowRuleType(
    record: Record<string, unknown>,
  ): ResultNoShowRuleSetting["type"] {
    const raw =
      typeof record.type === "string"
        ? record.type
        : typeof record.ruleType === "string"
          ? record.ruleType
          : typeof record.kind === "string"
            ? record.kind
            : "";
    const normalized = raw
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_");
    if (
      normalized === "MATCH_MISSED" ||
      normalized === "SPECIFIC_MATCH" ||
      normalized === "MATCH"
    ) {
      return "MATCH_MISSED";
    }
    if (
      normalized === "TOTAL_MISSES" ||
      normalized === "TOTAL" ||
      normalized === "MISSES"
    ) {
      return "TOTAL_MISSES";
    }
    if (
      this.hasNoShowMatchRuleValue(record.matchNumber) ||
      this.hasNoShowMatchRuleValue(record.match) ||
      this.hasNoShowMatchRuleValue(record.game)
    ) {
      return "MATCH_MISSED";
    }
    return "TOTAL_MISSES";
  }

  private hasNoShowMatchRuleValue(value: unknown) {
    return value !== undefined && value !== null && String(value).trim() !== "";
  }

  private parseNoShowPositiveInt(
    value: unknown,
    min: number,
    max: number,
    fallback: number,
    label: string,
  ) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    const normalized = Math.trunc(parsed);
    if (normalized < min || normalized > max) {
      throw new Error(`${label} must be ${min} to ${max}.`);
    }
    return normalized;
  }

  private parseNoShowDurationDays(
    value: unknown,
    record: Record<string, unknown>,
    label: string,
  ) {
    const duration =
      typeof record.duration === "string"
        ? record.duration
        : typeof record.durationType === "string"
          ? record.durationType
          : "";
    if (
      record.permanent === true ||
      /^(permanent|perm|none|0)$/i.test(duration.trim()) ||
      value === null
    ) {
      return null;
    }
    return this.parseNoShowPositiveInt(
      value,
      1,
      3650,
      1,
      `${label} duration days`,
    );
  }

  private parseNoShowBanRulesForSettings(config: SessionDiscordConfigResponse) {
    const raw = config.emojis?.noShowBanRules?.trim();
    if (!raw) {
      return [];
    }
    try {
      return JSON.parse(
        this.normalizeNoShowBanRules(raw),
      ) as ResultNoShowRuleSetting[];
    } catch {
      return [];
    }
  }

  private firstNoShowRuleScope(config: SessionDiscordConfigResponse) {
    return this.parseNoShowBanRulesForSettings(config)[0]?.scope ?? "";
  }

  private firstNoShowRuleReason(config: SessionDiscordConfigResponse) {
    return this.parseNoShowBanRulesForSettings(config)[0]?.reason ?? "";
  }

  private noShowRuleLines(
    config: SessionDiscordConfigResponse,
    type: ResultNoShowRuleSetting["type"],
  ) {
    return this.parseNoShowBanRulesForSettings(config)
      .filter((rule) => rule.enabled && rule.type === type)
      .map((rule) => {
        const trigger =
          type === "MATCH_MISSED"
            ? `match ${rule.matchNumber ?? 1}`
            : String(rule.misses ?? 1);
        const duration =
          rule.durationDays === null ? "permanent" : `${rule.durationDays}d`;
        const scope = rule.scope === "TEAM" ? "all-sessions" : "session";
        const reason = rule.reason?.trim();
        return `${trigger}=${duration} ${scope}${reason ? ` | ${reason}` : ""}`;
      })
      .join("\n");
  }

  private normalizeNoShowCustomRules(
    input: {
      totalRules: string;
      matchRules: string;
      defaultScope: string;
      defaultReason: string;
    },
    config: SessionDiscordConfigResponse,
  ) {
    const rules = [
      ...this.parseNoShowRuleLines(
        "TOTAL_MISSES",
        input.totalRules,
        input,
        config,
      ),
      ...this.parseNoShowRuleLines(
        "MATCH_MISSED",
        input.matchRules,
        input,
        config,
      ),
    ];
    return rules.length ? JSON.stringify(rules) : "";
  }

  private parseNoShowRuleLines(
    type: ResultNoShowRuleSetting["type"],
    value: string,
    input: {
      defaultScope: string;
      defaultReason: string;
    },
    config: SessionDiscordConfigResponse,
  ) {
    const defaultScope = this.normalizeNoShowRuleScope(
      input.defaultScope,
      config,
    );
    const defaultReason =
      input.defaultReason.trim() ||
      this.firstNoShowRuleReason(config) ||
      "Missed {misses} match(es) in {session}";
    return value
      .split(/\r?\n/)
      .map((line, index) =>
        this.parseNoShowRuleLine(
          type,
          line,
          index + 1,
          defaultScope,
          defaultReason,
        ),
      )
      .filter((rule): rule is ResultNoShowRuleSetting => Boolean(rule));
  }

  private parseNoShowRuleLine(
    type: ResultNoShowRuleSetting["type"],
    line: string,
    lineNumber: number,
    defaultScope: "SESSION" | "TEAM",
    defaultReason: string,
  ): ResultNoShowRuleSetting | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) {
      return null;
    }
    const [rulePart, ...reasonParts] = trimmed.split("|");
    const reason = reasonParts.join("|").trim() || defaultReason;
    const match =
      /^(?:match|game|g|miss|misses|total)?\s*#?\s*(\d{1,2})\s*(?:=>|=|:)\s*(permanent|perm|none|0|\d{1,4}(?:d|day|days)?)\s*(?:(session|scrim|current|team|teams|all-sessions|all-session|global|all))?$/i.exec(
        rulePart?.trim() ?? "",
      );
    if (!match) {
      throw new Error(
        `No-show ${type === "MATCH_MISSED" ? "match" : "total"} rule line ${lineNumber} must look like "1=3d session | reason" or "2=permanent all-sessions".`,
      );
    }
    const trigger = Number.parseInt(match[1], 10);
    const durationDays = this.parseNoShowLineDuration(match[2], lineNumber);
    const scope = match[3]
      ? this.normalizeNoShowRuleScope(match[3], null)
      : defaultScope;
    return {
      enabled: true,
      type,
      misses: type === "TOTAL_MISSES" ? trigger : null,
      matchNumber: type === "MATCH_MISSED" ? trigger : null,
      durationDays,
      scope,
      reason,
    };
  }

  private parseNoShowLineDuration(value: string, lineNumber: number) {
    const raw = value.trim();
    if (/^(permanent|perm|none|0)$/i.test(raw)) {
      return null;
    }
    const match = /^(\d{1,4})(?:d|day|days)?$/i.exec(raw);
    if (!match) {
      throw new Error(
        `No-show rule line ${lineNumber} duration must be days or permanent.`,
      );
    }
    const days = Number.parseInt(match[1], 10);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      throw new Error(
        `No-show rule line ${lineNumber} days must be 1 to 3650.`,
      );
    }
    return days;
  }

  private normalizeNoShowRuleScope(
    value: string,
    config: SessionDiscordConfigResponse | null,
  ): "SESSION" | "TEAM" {
    const raw =
      value.trim() ||
      (config ? this.firstNoShowRuleScope(config) : "") ||
      config?.emojis?.banDefaultScope ||
      "SESSION";
    const normalized = raw.toLowerCase().replace(/[\s_]+/g, "-");
    if (["session", "scrim", "current"].includes(normalized)) {
      return "SESSION";
    }
    if (
      [
        "team",
        "teams",
        "all-sessions",
        "all-session",
        "global",
        "all",
      ].includes(normalized)
    ) {
      return "TEAM";
    }
    throw new Error("No-show scope must be session or all-sessions.");
  }

  private resultEditMatchLabel(match: SessionMatchResponse) {
    const numberLabel = match.matchNumber ? `G${match.matchNumber}` : "Match";
    const map = match.map?.trim();
    const name = match.name?.trim();
    if (map) {
      return `${numberLabel} - ${map}`;
    }
    if (name && name.toLowerCase() !== numberLabel.toLowerCase()) {
      return `${numberLabel} - ${name}`;
    }
    return numberLabel;
  }

  private resultEditBackupLabel(
    backup: Pick<
      ResultBackupSummaryResponse,
      "matchNumber" | "matchName" | "title"
    >,
  ) {
    const numberLabel = backup.matchNumber
      ? `G${backup.matchNumber}`
      : "Saved match";
    const name = backup.matchName?.trim() || backup.title?.trim();
    if (name && name.toLowerCase() !== numberLabel.toLowerCase()) {
      return `${numberLabel} - ${name}`;
    }
    return numberLabel;
  }

  private resultEditSourceLabel(source: ResultEditSourceSummary) {
    return source.label;
  }

  private resultEditSourcesFromMatches(
    matches: SessionMatchResponse[],
  ): ResultEditSourceSummary[] {
    return matches.map((match) => ({
      kind: "match",
      id: match.id,
      key: resultEditSourceKey({ kind: "match", id: match.id }),
      label: this.resultEditMatchLabel(match),
      description: [
        match.status ? `Status ${match.status}` : null,
        Number.isFinite(match.teamCount ?? null)
          ? `${match.teamCount} teams`
          : null,
        match.id,
      ]
        .filter(Boolean)
        .join(" | "),
      matchNumber: match.matchNumber ?? null,
    }));
  }

  private resultEditSourcesFromBackups(
    backups: ResultBackupSummaryResponse[],
  ): ResultEditSourceSummary[] {
    return backups.map((backup) => ({
      kind: "backup",
      id: backup.id,
      key: resultEditSourceKey({ kind: "backup", id: backup.id }),
      label: this.resultEditBackupLabel(backup),
      description: [
        "Saved backup",
        Number.isFinite(backup.rowCount ?? null)
          ? `${backup.rowCount} rows`
          : null,
        backup.createdAt
          ? new Date(backup.createdAt)
              .toISOString()
              .slice(0, 16)
              .replace("T", " ")
          : null,
      ]
        .filter(Boolean)
        .join(" | "),
      matchNumber: backup.matchNumber ?? null,
    }));
  }

  private resultEditTeamLabel(row: ResultEditRow) {
    const tag = row.team?.tag?.trim();
    const name = row.team?.name?.trim();
    if (tag && name && tag.toLowerCase() !== name.toLowerCase()) {
      return `${tag} - ${name}`;
    }
    return tag || name || row.teamId;
  }

  private matchResultRows(results: MatchResultsResponse) {
    return (results.results?.length ? results.results : (results.data ?? []))
      .filter((row) => row.teamId)
      .slice()
      .sort((left, right) => {
        const leftPlacement =
          Number.isInteger(left.placement) && (left.placement ?? 0) > 0
            ? (left.placement as number)
            : Number.MAX_SAFE_INTEGER;
        const rightPlacement =
          Number.isInteger(right.placement) && (right.placement ?? 0) > 0
            ? (right.placement as number)
            : Number.MAX_SAFE_INTEGER;
        if (leftPlacement !== rightPlacement) {
          return leftPlacement - rightPlacement;
        }
        return (left.slot ?? 9999) - (right.slot ?? 9999);
      }) as ResultEditRow[];
  }

  private manualResultRows(rows: ResultEditRow[]) {
    return rows
      .filter((row) => row.teamId && row.wasPresentInMatch !== false)
      .slice()
      .sort((left, right) => {
        const leftSlot = Number.isInteger(left.slot) ? left.slot! : 9999;
        const rightSlot = Number.isInteger(right.slot) ? right.slot! : 9999;
        if (leftSlot !== rightSlot) {
          return leftSlot - rightSlot;
        }
        return this.resultEditTeamLabel(left).localeCompare(
          this.resultEditTeamLabel(right),
        );
      });
  }

  private resultEditRowFromBackup(
    backup: ResultBackupDetailResponse,
    row: ResultBackupRowResponse,
  ): ResultEditRow {
    const rowKey = row.id?.trim() || row.teamId?.trim() || `rank-${row.rank}`;
    const teamId = row.teamId?.trim() || rowKey;
    return {
      id: row.id,
      matchId: backup.id,
      teamId,
      slot: row.slotNumber,
      kills: row.kills ?? 0,
      teamKills: row.kills ?? 0,
      placement: row.placement ?? row.rank ?? null,
      placementPoints: row.placementPoints ?? 0,
      totalPoints: row.totalPoints ?? 0,
      team: {
        id: teamId,
        name: row.teamName,
        tag: row.teamTag,
        logoUrl: row.logoUrl,
      },
      players: this.resultEditPlayersFromBackup(row.players),
      resultEditRowKey: rowKey,
      backupRowId: row.id,
      backupRow: row,
    };
  }

  private resultEditPlayersFromBackup(
    players?: ResultBackupPlayerResponse[] | null,
  ): MatchResultPlayerResponse[] {
    const normalized: MatchResultPlayerResponse[] = [];
    for (const [index, player] of (players ?? []).entries()) {
      const name = player.name?.trim() || player.playerName?.trim() || null;
      if (!name) {
        continue;
      }
      const id =
        player.id?.trim() || this.backupResultEditPlayerId(name, index);
      normalized.push({
        id,
        playerId: player.playerId?.trim() || id,
        externalPlayerId: player.externalPlayerId ?? null,
        name,
        avatar: player.avatar ?? null,
        kills: Number.isFinite(player.kills) ? player.kills : 0,
        knocks: player.knocks ?? null,
        assists: player.assists ?? null,
        alive: player.alive ?? player.isAlive ?? null,
        isAlive: player.isAlive ?? player.alive ?? null,
        isKnocked: player.isKnocked ?? null,
      });
    }
    return normalized;
  }

  private backupResultRows(backup: ResultBackupDetailResponse) {
    return backup.rows
      .map((row) => this.resultEditRowFromBackup(backup, row))
      .sort((left, right) => {
        const leftPlacement =
          Number.isInteger(left.placement) && (left.placement ?? 0) > 0
            ? (left.placement as number)
            : Number.MAX_SAFE_INTEGER;
        const rightPlacement =
          Number.isInteger(right.placement) && (right.placement ?? 0) > 0
            ? (right.placement as number)
            : Number.MAX_SAFE_INTEGER;
        if (leftPlacement !== rightPlacement) {
          return leftPlacement - rightPlacement;
        }
        return (left.backupRow?.rank ?? 9999) - (right.backupRow?.rank ?? 9999);
      });
  }

  private resultEditRowKey(row: ResultEditRow) {
    return row.resultEditRowKey?.trim() || row.teamId;
  }

  private resultEditRowLabel(row: ResultEditRow) {
    const placement = Number.isInteger(row.placement)
      ? `#${row.placement}`
      : "#?";
    const slot = Number.isInteger(row.slot) ? `S${row.slot}` : "no slot";
    const kills = Number.isFinite(row.kills) ? row.kills : 0;
    return this.truncateSelectText(
      `${placement} ${this.resultEditTeamLabel(row)} ${slot} ${kills}K`,
      100,
    );
  }

  private resultEditRowDescription(row: ResultEditRow) {
    const total = Number.isFinite(row.totalPoints) ? row.totalPoints : 0;
    const placementPoints = Number.isFinite(row.placementPoints)
      ? row.placementPoints
      : 0;
    return this.truncateSelectText(
      `${total} pts | PLC ${placementPoints} | Team ID ${row.teamId}`,
      100,
    );
  }

  private buildResultEditMatchSelectRow(
    sessionId: string,
    sources: ResultEditSourceSummary[],
  ) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(resultEditMatchSelectCustomId(sessionId))
      .setPlaceholder("Choose match to edit")
      .addOptions(
        sources.slice(0, 25).map((source) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(
              this.truncateSelectText(this.resultEditSourceLabel(source), 100),
            )
            .setDescription(this.truncateSelectText(source.description, 100))
            .setValue(source.key),
        ),
      );
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
  }

  private buildResultEditRowsSelectRow(
    sessionId: string,
    sourceKey: string,
    page: number,
    rows: ResultEditRow[],
    disabled: boolean,
  ) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(resultEditRowsSelectCustomId(sessionId, sourceKey, page))
      .setPlaceholder("Choose team result row")
      .setDisabled(disabled)
      .addOptions(
        rows.map((row) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(this.resultEditRowLabel(row))
            .setDescription(this.resultEditRowDescription(row))
            .setValue(this.resultEditRowKey(row)),
        ),
      );
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
  }

  private buildResultEditPageRow(
    sessionId: string,
    sourceKey: string,
    page: number,
    pageCount: number,
  ) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(resultEditPageCustomId(sessionId, sourceKey, page - 1))
        .setLabel("Back")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(resultEditPageCustomId(sessionId, sourceKey, page))
        .setLabel(`Page ${page + 1}/${Math.max(1, pageCount)}`)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(resultEditPageCustomId(sessionId, sourceKey, page + 1))
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= pageCount - 1),
    );
  }

  private async loadResultEditRows(
    context: ResolvedSessionContext,
    sourceKey: string,
  ): Promise<{
    source: ResultEditSource;
    label: string;
    rows: ResultEditRow[];
    locked: boolean;
    lockReason: string | null;
    version: number | null;
    hasTruncatedSources: boolean;
  }> {
    const source = resultEditSourceFromKey(sourceKey);
    if (!source) {
      throw new Error(
        "This result edit source is invalid. Open Edit Results again.",
      );
    }
    if (source.kind === "backup") {
      const backup = await this.sessionService.withOrganization(
        context.config.organizationId,
        () => this.sessionService.getResultBackupForDiscord(source.id),
      );
      return {
        source,
        label: this.resultEditBackupLabel(backup),
        rows: this.backupResultRows(backup),
        locked: false,
        lockReason: null,
        version: null,
        hasTruncatedSources: false,
      };
    }

    const [matches, results] = await this.sessionService.withOrganization(
      context.config.organizationId,
      () =>
        Promise.all([
          this.sessionService.listSessionMatchesForDiscord(context.session.id),
          this.sessionService.getMatchResultsForDiscord(source.id),
        ]),
    );
    const match = matches.find((entry) => entry.id === source.id) ?? null;
    const locked =
      results.locked === true || results.lockState?.toUpperCase() === "LOCKED";
    return {
      source,
      label: match ? this.resultEditMatchLabel(match) : source.id,
      rows: this.matchResultRows(results),
      locked,
      lockReason: results.lockReason || "results are locked",
      version: results.version ?? null,
      hasTruncatedSources: matches.length > 25,
    };
  }

  private async buildResultEditRowsMessage(
    context: ResolvedSessionContext,
    sourceKey: string,
    requestedPage: number,
  ) {
    const { source, label, rows, locked, lockReason, hasTruncatedSources } =
      await this.loadResultEditRows(context, sourceKey);
    const manualRows =
      source.kind === "match" ? this.manualResultRows(rows) : [];
    const pageCount = Math.max(
      1,
      Math.ceil(rows.length / RESULT_CONTROL_RESULT_ROWS_PAGE_SIZE),
    );
    const page = Math.min(Math.max(0, requestedPage), pageCount - 1);
    const pageRows = rows.slice(
      page * RESULT_CONTROL_RESULT_ROWS_PAGE_SIZE,
      (page + 1) * RESULT_CONTROL_RESULT_ROWS_PAGE_SIZE,
    );
    const components: Array<
      ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>
    > = [];
    if (pageRows.length > 0) {
      components.push(
        this.buildResultEditRowsSelectRow(
          context.session.id,
          source.key,
          page,
          pageRows,
          locked,
        ),
      );
    }
    if (pageCount > 1) {
      components.push(
        this.buildResultEditPageRow(
          context.session.id,
          source.key,
          page,
          pageCount,
        ),
      );
    }
    if (source.kind === "match" && manualRows.length > 0) {
      components.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(
              resultManualEditButtonCustomId(context.session.id, source.key),
            )
            .setLabel("Manual Full Result")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(locked),
        ),
      );
    }
    const lines = [
      "Edit Results",
      `Session: ${context.session.name}`,
      `Match: ${label}`,
      `Rows: ${rows.length}`,
      locked
        ? `Locked: ${lockReason || "results are locked"}`
        : source.kind === "backup"
          ? "Select a team row to edit placement, kills, player kills, and points."
          : "Select a team row to edit placement, kills, and player kills.",
      source.kind === "match" && manualRows.length > 0 && !locked
        ? "Manual Full Result: save every active slot team in one place/kills table."
        : null,
    ];
    if (!rows.length) {
      lines.push("No result rows are available for this match yet.");
    }
    if (source.kind === "backup") {
      lines.push(
        "Editing saved backup rows because no live match records were found.",
      );
    }
    if (hasTruncatedSources) {
      lines.push("Only the first 25 matches are shown in the match picker.");
    }
    return {
      content: limitDiscordContent(
        lines.filter((line): line is string => Boolean(line)).join("\n"),
      ),
      components,
      allowedMentions: { parse: [] },
    };
  }

  private async listEditableResultBackupsForEditor(sessionId: string) {
    const service = this.sessionService as DiscordSessionService & {
      listEditableResultBackupsForDiscord?: (
        sessionId: string,
      ) => Promise<ResultBackupSummaryResponse[]>;
    };
    if (!service.listEditableResultBackupsForDiscord) {
      return [];
    }
    return service.listEditableResultBackupsForDiscord(sessionId);
  }

  private async handleResultEditStart(
    interaction: ButtonInteraction,
    context: ResolvedSessionContext,
  ) {
    const matches = await this.sessionService.withOrganization(
      context.config.organizationId,
      () =>
        this.sessionService.listSessionMatchesForDiscord(context.session.id),
    );
    const sorted = matches
      .slice()
      .sort(
        (left, right) =>
          (left.matchNumber ?? 9999) - (right.matchNumber ?? 9999),
      );
    const backups = sorted.length
      ? []
      : await this.sessionService.withOrganization(
          context.config.organizationId,
          () => this.listEditableResultBackupsForEditor(context.session.id),
        );
    const sources = sorted.length
      ? this.resultEditSourcesFromMatches(sorted)
      : this.resultEditSourcesFromBackups(backups);
    if (!sources.length) {
      await interaction.editReply({
        content:
          "No editable result matches or saved result backups found for this session.",
        allowedMentions: { parse: [] },
      });
      return;
    }
    await interaction.editReply({
      content: [
        "Edit Results",
        `Session: ${context.session.name}`,
        "Choose the match first, then choose the team row to edit.",
        !sorted.length
          ? "Using saved result backups because no live match records were found."
          : null,
        sources.length > 25
          ? "Showing the first 25 matches because Discord select menus are limited."
          : null,
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n"),
      components: [
        this.buildResultEditMatchSelectRow(context.session.id, sources),
      ],
      allowedMentions: { parse: [] },
    });
  }

  private async handleResultEditMatchSelect(
    interaction: StringSelectMenuInteraction,
    parsed: ParsedResultEditMatchSelectAction,
  ) {
    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can edit results.",
        ephemeral: true,
      });
      return;
    }
    const sourceKey = interaction.values[0];
    if (!sourceKey) {
      await interaction.reply({
        content: "Select one match first.",
        ephemeral: true,
      });
      return;
    }
    const context = await this.resolveSessionContextForInteraction(
      interaction,
      parsed.sessionId,
    );
    if (!context) {
      await interaction.reply({
        content: "This result panel is no longer linked to a scrim session.",
        ephemeral: true,
      });
      return;
    }
    await interaction.deferUpdate();
    await interaction.editReply(
      await this.buildResultEditRowsMessage(context, sourceKey, 0),
    );
  }

  private async handleResultEditPageButton(
    interaction: ButtonInteraction,
    parsed: ParsedResultEditPageAction,
  ) {
    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can edit results.",
        ephemeral: true,
      });
      return;
    }
    const context = await this.resolveSessionContextForInteraction(
      interaction,
      parsed.sessionId,
    );
    if (!context) {
      await interaction.reply({
        content: "This result panel is no longer linked to a scrim session.",
        ephemeral: true,
      });
      return;
    }
    await interaction.deferUpdate();
    await interaction.editReply(
      await this.buildResultEditRowsMessage(
        context,
        parsed.sourceKey,
        parsed.page,
      ),
    );
  }

  private async handleResultEditRowsSelect(
    interaction: StringSelectMenuInteraction,
    parsed: ParsedResultEditRowsSelectAction,
  ) {
    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can edit results.",
        ephemeral: true,
      });
      return;
    }
    const rowKey = interaction.values[0];
    if (!rowKey) {
      await interaction.reply({
        content: "Select one team result row first.",
        ephemeral: true,
      });
      return;
    }
    const context = await this.resolveSessionContextForInteraction(
      interaction,
      parsed.sessionId,
    );
    if (!context) {
      await interaction.reply({
        content: "This result panel is no longer linked to a scrim session.",
        ephemeral: true,
      });
      return;
    }
    const source = resultEditSourceFromKey(parsed.sourceKey);
    if (!source) {
      await interaction.reply({
        content: "This result edit source is invalid. Open Edit Results again.",
        ephemeral: true,
      });
      return;
    }
    const loaded = await this.loadResultEditRows(context, parsed.sourceKey);
    const row =
      loaded.rows.find((entry) => this.resultEditRowKey(entry) === rowKey) ??
      null;
    if (!row) {
      await interaction.reply({
        content: "That result row is no longer available. Refresh the editor.",
        ephemeral: true,
      });
      return;
    }
    const token = this.storePendingResultEdit({
      userId: interaction.user.id,
      sessionId: parsed.sessionId,
      source,
      rowKey,
      teamId:
        source.kind === "match" ? row.teamId : (row.backupRow?.teamId ?? null),
      page: parsed.page,
      row,
      expiresAt: Date.now() + RESULT_CONTROL_EDIT_TTL_MS,
    });
    await interaction.showModal(
      this.buildResultEditRowModal(token, row, source.kind),
    );
  }

  private formatManualResultRowsInput(rows: ResultEditRow[]) {
    return this.manualResultRows(rows)
      .map((row, index) => {
        const placement =
          Number.isInteger(row.placement) && (row.placement ?? 0) > 0
            ? (row.placement as number)
            : index + 1;
        const killsValue = row.teamKills ?? row.kills ?? 0;
        const kills = Number.isFinite(killsValue)
          ? Math.max(0, Math.trunc(killsValue))
          : 0;
        const slot = Number.isInteger(row.slot) ? `slot ${row.slot}` : "team";
        const label = this.truncateSelectText(
          this.resultEditTeamLabel(row).replace(/\s+/g, " "),
          40,
        );
        return `${slot} ${label} = ${placement} ${kills}`;
      })
      .join("\n");
  }

  private buildResultManualEditModal(
    token: string,
    label: string,
    rows: ResultEditRow[],
  ) {
    return new ModalBuilder()
      .setCustomId(resultManualEditModalId(token))
      .setTitle(this.truncateSelectText(`Manual ${label}`, 45))
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("rows")
            .setLabel("Each line: slot/team = place kills")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(4000)
            .setValue(this.formatManualResultRowsInput(rows).slice(0, 4000))
            .setPlaceholder("slot 4 4Q = 1 8\nslot 5 ABC = 2 5"),
        ),
      );
  }

  private async handleResultManualEditButton(
    interaction: ButtonInteraction,
    parsed: ParsedResultManualEditAction,
  ) {
    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can edit results.",
        ephemeral: true,
      });
      return;
    }
    const context = await this.resolveSessionContextForInteraction(
      interaction,
      parsed.sessionId,
    );
    if (!context) {
      await interaction.reply({
        content: "This result panel is no longer linked to a scrim session.",
        ephemeral: true,
      });
      return;
    }
    const loaded = await this.loadResultEditRows(context, parsed.sourceKey);
    if (loaded.source.kind !== "match") {
      await interaction.reply({
        content: "Manual Full Result is only available for live match records.",
        ephemeral: true,
      });
      return;
    }
    if (loaded.locked) {
      await interaction.reply({
        content: `Results are locked: ${loaded.lockReason || "results are locked"}`,
        ephemeral: true,
      });
      return;
    }
    const rows = this.manualResultRows(loaded.rows);
    if (!rows.length) {
      await interaction.reply({
        content:
          "No active slot teams are available for this match. Sync the slot list first.",
        ephemeral: true,
      });
      return;
    }
    const token = this.storePendingManualResultEdit({
      userId: interaction.user.id,
      sessionId: parsed.sessionId,
      source: loaded.source,
      sourceLabel: loaded.label,
      rows,
      expectedVersion: loaded.version,
      expiresAt: Date.now() + RESULT_CONTROL_EDIT_TTL_MS,
    });
    await interaction.showModal(
      this.buildResultManualEditModal(token, loaded.label, rows),
    );
  }

  private buildResultEditRowModal(
    token: string,
    row: ResultEditRow,
    sourceKind: ResultEditSourceKind,
  ) {
    const title = this.truncateSelectText(
      `Edit ${this.resultEditTeamLabel(row)}`,
      45,
    );
    const kills = Number.isFinite(row.teamKills ?? row.kills)
      ? (row.teamKills ?? row.kills)
      : 0;
    return new ModalBuilder()
      .setCustomId(resultEditModalId(token))
      .setTitle(title)
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("placement")
            .setLabel("Placement")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(row.placement ? String(row.placement) : ""),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("kills")
            .setLabel("Team kills")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(String(kills)),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("player-kills")
            .setLabel("Player kills (optional)")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(1000)
            .setPlaceholder("Player One=5\nPlayer Two=3")
            .setValue(this.formatResultPlayerKillsInput(row.players)),
        ),
        ...(sourceKind === "backup"
          ? [
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId("placement-points")
                  .setLabel("Placement points override")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder(
                    `Current ${row.placementPoints ?? 0}. Blank = auto`,
                  ),
              ),
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId("total-points")
                  .setLabel("Total points override")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder(
                    `Current ${row.totalPoints ?? 0}. Blank = PLC + kills`,
                  ),
              ),
            ]
          : []),
      );
  }

  private formatResultPlayerKillsInput(
    players?: MatchResultPlayerResponse[] | null,
  ) {
    return (players ?? [])
      .filter((player) => player.id && player.name?.trim())
      .slice(0, 8)
      .map(
        (player, index) =>
          `${index + 1}. ${player.name.trim()}=${player.kills ?? 0}`,
      )
      .join("\n");
  }

  private normalizeResultPlayerName(value: string) {
    return value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  private stripResultPlayerListPrefix(value: string) {
    return value.replace(/^(?:#?\s*)?\d{1,2}\s*[.)]\s*/, "").trim();
  }

  private backupResultEditPlayerId(name: string, index: number) {
    const normalized = this.normalizeResultPlayerName(name).slice(0, 40);
    return `backup-player-${index + 1}${normalized ? `-${normalized}` : ""}`;
  }

  private parseResultEditInteger(value: string, label: string, min: number) {
    const parsed = Number(value.trim());
    if (!Number.isInteger(parsed) || parsed < min) {
      return {
        ok: false as const,
        error: `${label} must be a whole number${min > 0 ? ` ${min} or higher` : ""}.`,
      };
    }
    return { ok: true as const, value: parsed };
  }

  private parseOptionalResultEditInteger(
    value: string,
    label: string,
    min: number,
  ) {
    const trimmed = value.trim();
    if (!trimmed) {
      return { ok: true as const, value: null };
    }
    const parsed = this.parseResultEditInteger(trimmed, label, min);
    if (!parsed.ok) {
      return parsed;
    }
    return { ok: true as const, value: parsed.value };
  }

  private defaultResultEditPlacementPoints(placement: number) {
    if (placement === 1) return 10;
    if (placement === 2) return 6;
    if (placement === 3) return 5;
    if (placement === 4) return 4;
    if (placement === 5) return 3;
    if (placement === 6) return 2;
    if (placement === 7 || placement === 8) return 1;
    return 0;
  }

  private parseResultEditPlayerKillsInput(
    rawValue: string,
    row: ResultEditRow,
    teamKills: number,
  ):
    | {
        ok: true;
        playerKills?: NonNullable<UpdateMatchResultPayload["playerKills"]>;
      }
    | { ok: false; error: string } {
    const raw = rawValue.trim();
    if (!raw) {
      return { ok: true };
    }
    const players = (row.players ?? []).filter((player) => player.id);
    if (!players.length) {
      return {
        ok: false,
        error:
          "This row has no player result rows. Leave player kills blank and edit team kills only.",
      };
    }
    const byName = new Map(
      players.map((player) => [
        this.normalizeResultPlayerName(player.name ?? ""),
        player,
      ]),
    );
    const entries = raw
      .split(/\r?\n|;/g)
      .map((entry) => entry.trim().replace(/^[-*]\s*/, ""))
      .filter(Boolean);
    if (entries.length > players.length) {
      return {
        ok: false,
        error: `Use at most ${players.length} player kill row(s).`,
      };
    }
    const seen = new Set<string>();
    const playerKills: NonNullable<UpdateMatchResultPayload["playerKills"]> =
      [];
    for (const entry of entries) {
      const numbered =
        /^(?:#?\s*)?(\d{1,2})\s*(?:[.)])?\s*(?:=|:|-|\s+)\s*(\d+)$/.exec(entry);
      const named = numbered ? null : /^(.+?)\s*(?:=|:|-)\s*(\d+)$/.exec(entry);
      const namedLabel = named
        ? this.stripResultPlayerListPrefix(named[1])
        : null;
      const player = numbered
        ? players[Number.parseInt(numbered[1], 10) - 1]
        : named
          ? (byName.get(this.normalizeResultPlayerName(namedLabel ?? "")) ??
            null)
          : null;
      const killsRaw = numbered ? numbered[2] : named?.[2];
      const kills = Number(killsRaw);
      if (!player || !Number.isInteger(kills) || kills < 0) {
        return {
          ok: false,
          error:
            "Player kills must use `Player Name=5` or `1=5` for players shown in the modal.",
        };
      }
      if (seen.has(player.id)) {
        return {
          ok: false,
          error: `Duplicate player kill row for ${player.name}.`,
        };
      }
      seen.add(player.id);
      playerKills.push({
        playerResultId: player.id,
        playerId: player.playerId,
        kills,
        isAlive: player.isAlive ?? player.alive ?? null,
        isKnocked: player.isKnocked ?? null,
      });
    }
    const total = playerKills.reduce((sum, player) => sum + player.kills, 0);
    if (total !== teamKills) {
      return {
        ok: false,
        error: `Player kills must add up to team kills (${teamKills}). Current player total is ${total}.`,
      };
    }
    return { ok: true, playerKills };
  }

  private parseBackupResultEditPlayerKillsInput(
    rawValue: string,
    row: ResultEditRow,
    teamKills: number,
  ):
    | {
        ok: true;
        players?: NonNullable<UpdateResultBackupRowPayload["players"]>;
      }
    | { ok: false; error: string } {
    const raw = rawValue.trim();
    if (!raw) {
      return { ok: true };
    }
    const existingPlayers = (row.players ?? []).filter((player) =>
      player.name?.trim(),
    );
    const byName = new Map(
      existingPlayers.map((player) => [
        this.normalizeResultPlayerName(player.name ?? ""),
        player,
      ]),
    );
    const entries = raw
      .split(/\r?\n|;/g)
      .map((entry) => entry.trim().replace(/^[-*]\s*/, ""))
      .filter(Boolean);
    if (entries.length > 16) {
      return {
        ok: false,
        error: "Use at most 16 player kill row(s).",
      };
    }
    const seen = new Set<string>();
    const players: NonNullable<UpdateResultBackupRowPayload["players"]> = [];
    for (const [index, entry] of entries.entries()) {
      const numbered =
        /^(?:#?\s*)?(\d{1,2})\s*(?:[.)])?\s*(?:=|:|-|\s+)\s*(\d+)$/.exec(entry);
      const named = numbered ? null : /^(.+?)\s*(?:=|:|-)\s*(\d+)$/.exec(entry);
      const namedLabel = named
        ? this.stripResultPlayerListPrefix(named[1])
        : null;
      const existing = numbered
        ? (existingPlayers[Number.parseInt(numbered[1], 10) - 1] ?? null)
        : namedLabel
          ? (byName.get(this.normalizeResultPlayerName(namedLabel)) ?? null)
          : null;
      const name = existing?.name?.trim() || namedLabel?.trim() || "";
      const killsRaw = numbered ? numbered[2] : named?.[2];
      const kills = Number(killsRaw);
      if (!name || !Number.isInteger(kills) || kills < 0) {
        return {
          ok: false,
          error:
            "Player kills must use `Player Name=5` for saved match posts. Existing rows also accept `1=5`.",
        };
      }
      if (numbered && !existing) {
        return {
          ok: false,
          error:
            "Numbered player kills can only reference players already shown in the modal. Use `Player Name=5` to add a saved player row.",
        };
      }
      const dedupeKey = this.normalizeResultPlayerName(name);
      if (seen.has(dedupeKey)) {
        return {
          ok: false,
          error: `Duplicate player kill row for ${name}.`,
        };
      }
      seen.add(dedupeKey);
      players.push({
        id: existing?.id ?? this.backupResultEditPlayerId(name, index),
        playerId: existing?.playerId ?? null,
        externalPlayerId: existing?.externalPlayerId ?? null,
        name,
        kills,
        knocks: existing?.knocks ?? null,
        assists: existing?.assists ?? null,
        alive: existing?.alive ?? existing?.isAlive ?? null,
        isAlive: existing?.isAlive ?? existing?.alive ?? null,
        isKnocked: existing?.isKnocked ?? null,
        avatar: existing?.avatar ?? null,
      });
    }
    const total = players.reduce((sum, player) => sum + (player.kills ?? 0), 0);
    if (total !== teamKills) {
      return {
        ok: false,
        error: `Player kills must add up to team kills (${teamKills}). Current player total is ${total}.`,
      };
    }
    return { ok: true, players };
  }

  private normalizeManualResultKey(value: string) {
    return value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  private parseManualResultRowsInput(
    rawValue: string,
    rows: ResultEditRow[],
  ):
    | {
        ok: true;
        rows: ManualMatchResultRowPayload[];
        winnerLabel: string;
        totalKills: number;
      }
    | { ok: false; error: string } {
    const editableRows = this.manualResultRows(rows);
    const lines = rawValue
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    if (lines.length !== editableRows.length) {
      return {
        ok: false,
        error: `Manual result needs exactly ${editableRows.length} active team row(s). Current input has ${lines.length}.`,
      };
    }

    const bySlot = new Map<number, ResultEditRow>();
    const byKey = new Map<string, ResultEditRow[]>();
    const addKey = (value: string | null | undefined, row: ResultEditRow) => {
      const key = this.normalizeManualResultKey(value ?? "");
      if (!key) {
        return;
      }
      const existing = byKey.get(key) ?? [];
      if (
        !existing.some(
          (entry) =>
            this.resultEditRowKey(entry) === this.resultEditRowKey(row),
        )
      ) {
        existing.push(row);
      }
      byKey.set(key, existing);
    };

    for (const row of editableRows) {
      if (Number.isInteger(row.slot)) {
        bySlot.set(row.slot as number, row);
      }
      addKey(row.teamId, row);
      addKey(this.resultEditRowKey(row), row);
      addKey(row.team?.tag, row);
      addKey(row.team?.name, row);
      addKey(this.resultEditTeamLabel(row), row);
    }

    const seenTeamIds = new Set<string>();
    const seenPlacements = new Set<number>();
    const parsedRows: ManualMatchResultRowPayload[] = [];
    let winnerLabel = "";
    let totalKills = 0;

    for (const [index, line] of lines.entries()) {
      const cleaned = line
        .replace(/^\s*[-*]\s*/, "")
        .replace(/^\d{1,3}[.)]\s+/, "")
        .trim();
      const numberMatches = [...cleaned.matchAll(/-?\d+/g)];
      if (numberMatches.length < 2) {
        return {
          ok: false,
          error: `Line ${index + 1} must end with placement and kills.`,
        };
      }
      const placementMatch = numberMatches[numberMatches.length - 2];
      const killsMatch = numberMatches[numberMatches.length - 1];
      const placement = Number(placementMatch[0]);
      const kills = Number(killsMatch[0]);
      if (!Number.isInteger(placement) || placement < 1) {
        return {
          ok: false,
          error: `Line ${index + 1} placement must be 1 or higher.`,
        };
      }
      if (!Number.isInteger(kills) || kills < 0) {
        return {
          ok: false,
          error: `Line ${index + 1} kills must be zero or higher.`,
        };
      }

      let identifier = cleaned.slice(0, placementMatch.index ?? 0).trim();
      identifier = identifier
        .replace(/[=|,:;-]+/g, " ")
        .replace(/\b(?:place|placement|kills?|team)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

      let row: ResultEditRow | null = null;
      const slotMatch =
        /\b(?:slot|s)\s*#?\s*(\d{1,3})\b/i.exec(identifier) ??
        /^#\s*(\d{1,3})\b/.exec(identifier);
      if (slotMatch) {
        row = bySlot.get(Number(slotMatch[1])) ?? null;
      }
      if (!row && identifier) {
        const candidates =
          byKey.get(this.normalizeManualResultKey(identifier)) ?? [];
        if (candidates.length > 1) {
          return {
            ok: false,
            error: `Line ${index + 1} matches more than one team. Use slot number.`,
          };
        }
        row = candidates[0] ?? null;
      }
      if (!row && !identifier) {
        row = editableRows[index] ?? null;
      }
      if (!row) {
        return {
          ok: false,
          error: `Line ${index + 1} does not match any active slot/team.`,
        };
      }
      if (!row.teamId) {
        return {
          ok: false,
          error: `Line ${index + 1} matched a row without a team ID.`,
        };
      }
      if (seenTeamIds.has(row.teamId)) {
        return {
          ok: false,
          error: `Duplicate team row for ${this.resultEditTeamLabel(row)}.`,
        };
      }
      if (seenPlacements.has(placement)) {
        return { ok: false, error: `Duplicate placement ${placement}.` };
      }

      seenTeamIds.add(row.teamId);
      seenPlacements.add(placement);
      if (placement === 1) {
        winnerLabel = this.resultEditTeamLabel(row);
      }
      totalKills += kills;
      parsedRows.push({ teamId: row.teamId, placement, kills });
    }

    for (let placement = 1; placement <= editableRows.length; placement += 1) {
      if (!seenPlacements.has(placement)) {
        return { ok: false, error: `Placement ${placement} is missing.` };
      }
    }

    return {
      ok: true,
      rows: parsedRows,
      winnerLabel: winnerLabel || "placement 1",
      totalKills,
    };
  }

  private resultEditPayloadFromModal(
    interaction: ModalSubmitInteraction,
    pending: PendingResultEditAction,
  ):
    | { ok: true; payload: UpdateMatchResultPayload }
    | { ok: false; error: string } {
    const placement = this.parseResultEditInteger(
      optionalInputValue(interaction, "placement"),
      "Placement",
      1,
    );
    if (!placement.ok) {
      return placement;
    }
    const kills = this.parseResultEditInteger(
      optionalInputValue(interaction, "kills"),
      "Team kills",
      0,
    );
    if (!kills.ok) {
      return kills;
    }
    const playerKills = this.parseResultEditPlayerKillsInput(
      optionalInputValue(interaction, "player-kills"),
      pending.row,
      kills.value,
    );
    if (!playerKills.ok) {
      return playerKills;
    }
    return {
      ok: true,
      payload: {
        placement: placement.value,
        kills: kills.value,
        teamKills: kills.value,
        ...(playerKills.playerKills
          ? { playerKills: playerKills.playerKills }
          : {}),
      },
    };
  }

  private backupResultEditPayloadFromModal(
    interaction: ModalSubmitInteraction,
    pending: PendingResultEditAction,
  ):
    | {
        ok: true;
        placement: number;
        kills: number;
        placementPoints: number;
        totalPoints: number;
        players?: NonNullable<UpdateResultBackupRowPayload["players"]>;
      }
    | { ok: false; error: string } {
    const placement = this.parseResultEditInteger(
      optionalInputValue(interaction, "placement"),
      "Placement",
      1,
    );
    if (!placement.ok) {
      return placement;
    }
    const kills = this.parseResultEditInteger(
      optionalInputValue(interaction, "kills"),
      "Team kills",
      0,
    );
    if (!kills.ok) {
      return kills;
    }
    const playerKills = this.parseBackupResultEditPlayerKillsInput(
      optionalInputValue(interaction, "player-kills"),
      pending.row,
      kills.value,
    );
    if (!playerKills.ok) {
      return playerKills;
    }
    const placementPoints = this.parseOptionalResultEditInteger(
      optionalInputValue(interaction, "placement-points"),
      "Placement points",
      0,
    );
    if (!placementPoints.ok) {
      return placementPoints;
    }
    const resolvedPlacementPoints =
      placementPoints.value ??
      this.defaultResultEditPlacementPoints(placement.value);
    const totalPoints = this.parseOptionalResultEditInteger(
      optionalInputValue(interaction, "total-points"),
      "Total points",
      0,
    );
    if (!totalPoints.ok) {
      return totalPoints;
    }
    return {
      ok: true,
      placement: placement.value,
      kills: kills.value,
      placementPoints: resolvedPlacementPoints,
      totalPoints: totalPoints.value ?? resolvedPlacementPoints + kills.value,
      ...(playerKills.players ? { players: playerKills.players } : {}),
    };
  }

  private resultEditSaveSummary(
    before: ResultEditRow,
    after: ResultEditRow | null,
    playerKillCount: number,
    finalRefreshLine: string | null,
  ) {
    const placementAfter = after?.placement ?? before.placement ?? "?";
    const killsAfter = after?.teamKills ?? after?.kills ?? before.kills ?? 0;
    const pointsAfter = after?.totalPoints ?? before.totalPoints ?? 0;
    return [
      "Result row saved.",
      `Team: ${this.resultEditTeamLabel(after ?? before)}`,
      `Placement: ${before.placement ?? "?"} -> ${placementAfter}`,
      `Kills: ${before.teamKills ?? before.kills ?? 0} -> ${killsAfter}`,
      `Total points now: ${pointsAfter}`,
      playerKillCount > 0 ? `Player kills updated: ${playerKillCount}` : null,
      finalRefreshLine,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  }

  private manualResultSaveSummary(
    parsed: {
      rows: ManualMatchResultRowPayload[];
      winnerLabel: string;
      totalKills: number;
    },
    version: number | null | undefined,
    finalRefreshLine: string | null,
  ) {
    return [
      "Manual full result saved.",
      `Teams: ${parsed.rows.length}`,
      `Winner: ${parsed.winnerLabel}`,
      `Total kills: ${parsed.totalKills}`,
      typeof version === "number" ? `Result version: ${version}` : null,
      finalRefreshLine,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  }

  private async refreshStoredFinalPostAfterResultEdit(
    guild: Guild | null,
    context: ResolvedSessionContext,
    matchId: string,
  ) {
    if (!guild) {
      return null;
    }
    const storedChannelId = this.configuredChannelId(
      context.config.emojis?.finalResultPostChannelId,
    );
    const storedMessageId = this.configuredChannelId(
      context.config.emojis?.finalResultPostMessageId,
    );
    if (!storedChannelId || !storedMessageId) {
      return "Final post: not saved yet.";
    }
    try {
      const result = await this.sessionService.withOrganization(
        context.config.organizationId,
        () =>
          this.sessionService.buildFinalResultPost(matchId, {
            ...context.config,
            sessionId: context.session.id,
          }),
      );
      const edited = await this.editStoredFinalResultPost(
        guild,
        storedChannelId,
        storedMessageId,
        result,
      );
      return edited
        ? `Final post refreshed in <#${storedChannelId}>.`
        : "Final post was saved, but the original Discord message was unavailable. Use Repost Final.";
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : "unknown error";
      return `Final post refresh failed: ${message}`;
    }
  }

  private async handleResultManualEditModal(
    interaction: ModalSubmitInteraction,
    parsed: { token: string },
  ) {
    const pending = this.pendingManualResultEdits.get(parsed.token);
    if (!pending) {
      await interaction.reply({
        content: "This manual result edit expired. Open Edit Results again.",
        ephemeral: true,
      });
      return;
    }
    if (pending.userId !== interaction.user.id) {
      await interaction.reply({
        content:
          "Only the staff member who opened this manual result edit can save it.",
        ephemeral: true,
      });
      return;
    }
    if (!(await this.canUseStaffControls(interaction, pending.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can edit results.",
        ephemeral: true,
      });
      return;
    }
    const context = await this.resolveSessionContextForInteraction(
      interaction,
      pending.sessionId,
    );
    if (!context) {
      await interaction.reply({
        content: "This result panel is no longer linked to a scrim session.",
        ephemeral: true,
      });
      return;
    }

    const parsedRows = this.parseManualResultRowsInput(
      optionalInputValue(interaction, "rows"),
      pending.rows,
    );
    if (!parsedRows.ok) {
      await interaction.reply({
        content: parsedRows.error,
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      const result = await this.sessionService.withOrganization(
        context.config.organizationId,
        () =>
          this.sessionService.updateManualMatchResultsFromDiscord(
            pending.source.id,
            parsedRows.rows,
            pending.expectedVersion,
          ),
      );
      const finalRefreshLine = await this.refreshStoredFinalPostAfterResultEdit(
        interaction.guild,
        context,
        pending.source.id,
      );
      this.pendingManualResultEdits.delete(parsed.token);
      await interaction.editReply({
        content: limitDiscordContent(
          this.manualResultSaveSummary(
            parsedRows,
            result.version ?? null,
            finalRefreshLine,
          ),
        ),
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(
                resultEditPageCustomId(
                  pending.sessionId,
                  pending.source.key,
                  0,
                ),
              )
              .setLabel("Edit More Rows")
              .setStyle(ButtonStyle.Secondary),
          ),
        ],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : "Manual result could not be saved.";
      await interaction.editReply({
        content: limitDiscordContent(`Manual result not saved: ${message}`),
        allowedMentions: { parse: [] },
      });
    }
  }

  private resultBackupRowKey(row: ResultBackupRowResponse) {
    return row.id?.trim() || row.teamId?.trim() || `rank-${row.rank}`;
  }

  private resultBackupRowPayload(row: {
    rank: number;
    teamId?: string | null;
    teamName?: string | null;
    teamTag?: string | null;
    logoUrl?: string | null;
    slotNumber?: number | null;
    placement?: number | null;
    wwcd?: number | null;
    placementPoints?: number | null;
    kills?: number | null;
    totalPoints?: number | null;
    players?: UpdateResultBackupRowPayload["players"];
  }): UpdateResultBackupRowPayload {
    return {
      rank: row.rank,
      teamId: row.teamId,
      teamName:
        row.teamName?.trim() ||
        row.teamTag?.trim() ||
        row.teamId?.trim() ||
        `Team ${row.rank}`,
      teamTag: row.teamTag,
      logoUrl: row.logoUrl,
      slotNumber: row.slotNumber,
      placement: row.placement,
      wwcd: row.wwcd,
      placementPoints: row.placementPoints,
      kills: row.kills,
      totalPoints: row.totalPoints,
      players: row.players,
    };
  }

  private updatedBackupRowsPayload(
    backup: ResultBackupDetailResponse,
    rowKey: string,
    edit: {
      placement: number;
      kills: number;
      placementPoints: number;
      totalPoints: number;
      players?: NonNullable<UpdateResultBackupRowPayload["players"]>;
    },
  ): UpdateResultBackupRowPayload[] {
    const target = backup.rows.find(
      (row) => this.resultBackupRowKey(row) === rowKey,
    );
    if (!target) {
      throw new Error("That saved backup row is no longer available.");
    }
    const previousPlacement = target.placement ?? target.rank ?? null;
    const rows = backup.rows.map((row) => {
      if (this.resultBackupRowKey(row) === rowKey) {
        return {
          ...row,
          placement: edit.placement,
          wwcd: edit.placement === 1 ? 1 : 0,
          placementPoints: edit.placementPoints,
          kills: edit.kills,
          totalPoints: edit.totalPoints,
          players: edit.players ?? row.players,
        };
      }
      const rowPlacement = row.placement ?? row.rank ?? null;
      if (
        previousPlacement &&
        rowPlacement === edit.placement &&
        edit.placement !== previousPlacement
      ) {
        const placementPoints =
          this.defaultResultEditPlacementPoints(previousPlacement);
        const kills = row.kills ?? 0;
        return {
          ...row,
          placement: previousPlacement,
          wwcd: previousPlacement === 1 ? 1 : 0,
          placementPoints,
          totalPoints: placementPoints + kills,
        };
      }
      return row;
    });

    return rows
      .slice()
      .sort((left, right) => {
        const leftPlacement = left.placement ?? left.rank ?? 9999;
        const rightPlacement = right.placement ?? right.rank ?? 9999;
        if (leftPlacement !== rightPlacement) {
          return leftPlacement - rightPlacement;
        }
        if ((right.totalPoints ?? 0) !== (left.totalPoints ?? 0)) {
          return (right.totalPoints ?? 0) - (left.totalPoints ?? 0);
        }
        return (right.kills ?? 0) - (left.kills ?? 0);
      })
      .map((row, index) => ({
        ...this.resultBackupRowPayload(row),
        rank: index + 1,
      }));
  }

  private async refreshStoredFinalPostAfterBackupResultEdit(
    guild: Guild | null,
    context: ResolvedSessionContext,
  ) {
    const sessionService = this.sessionService as DiscordSessionService & {
      rebuildOverallResultBackupFromDiscord?: (
        sessionId: string,
      ) => Promise<ResultBackupDetailResponse | null>;
    };
    if (
      typeof sessionService.rebuildOverallResultBackupFromDiscord === "function"
    ) {
      await this.sessionService
        .withOrganization(context.config.organizationId, () =>
          sessionService.rebuildOverallResultBackupFromDiscord!(
            context.session.id,
          ),
        )
        .catch((error) => {
          console.warn(
            `Overall result backup rebuild failed session=${context.session.id}: ${String(
              error,
            )}`,
          );
          return null;
        });
    }

    if (!guild) {
      return null;
    }
    const storedChannelId = this.configuredChannelId(
      context.config.emojis?.finalResultPostChannelId,
    );
    const storedMessageId = this.configuredChannelId(
      context.config.emojis?.finalResultPostMessageId,
    );
    if (!storedChannelId || !storedMessageId) {
      return "Final post: not saved yet.";
    }
    try {
      const result = await this.sessionService.withOrganization(
        context.config.organizationId,
        () => this.buildFinalResultControlPost(context),
      );
      const edited = await this.editStoredFinalResultPost(
        guild,
        storedChannelId,
        storedMessageId,
        result,
      );
      if (!edited) {
        return "Final post was saved, but the original Discord message was unavailable. Use Repost Final.";
      }
      await this.sessionService.withOrganization(
        context.config.organizationId,
        () =>
          this.sessionService.rememberFinalResultPost(
            context.session.id,
            storedChannelId,
            storedMessageId,
            result.backupId,
          ),
      );
      return `Final post refreshed in <#${storedChannelId}>.`;
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : "unknown error";
      return `Final post refresh failed: ${message}`;
    }
  }

  private async handleResultEditModal(
    interaction: ModalSubmitInteraction,
    parsed: { token: string },
  ) {
    const pending = this.pendingResultEdits.get(parsed.token);
    if (!pending) {
      await interaction.reply({
        content: "This result edit expired. Open Edit Results again.",
        ephemeral: true,
      });
      return;
    }
    if (pending.userId !== interaction.user.id) {
      await interaction.reply({
        content:
          "Only the staff member who opened this result edit can save it.",
        ephemeral: true,
      });
      return;
    }
    if (!(await this.canUseStaffControls(interaction, pending.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can edit results.",
        ephemeral: true,
      });
      return;
    }
    const context = await this.resolveSessionContextForInteraction(
      interaction,
      pending.sessionId,
    );
    if (!context) {
      await interaction.reply({
        content: "This result panel is no longer linked to a scrim session.",
        ephemeral: true,
      });
      return;
    }
    if (pending.source.kind === "backup") {
      const parsedPayload = this.backupResultEditPayloadFromModal(
        interaction,
        pending,
      );
      if (!parsedPayload.ok) {
        await interaction.reply({
          content: parsedPayload.error,
          ephemeral: true,
        });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      try {
        const backup = await this.sessionService.withOrganization(
          context.config.organizationId,
          () =>
            this.sessionService.getResultBackupForDiscord(pending.source.id),
        );
        const updated = await this.sessionService.withOrganization(
          context.config.organizationId,
          () =>
            this.sessionService.updateResultBackupRowsFromDiscord(
              pending.source.id,
              this.updatedBackupRowsPayload(
                backup,
                pending.rowKey,
                parsedPayload,
              ),
            ),
        );
        const updatedRow =
          this.backupResultRows(updated).find(
            (entry) => this.resultEditRowKey(entry) === pending.rowKey,
          ) ?? null;
        const playerKillCount = parsedPayload.players?.length ?? 0;
        const finalRefreshLine =
          await this.refreshStoredFinalPostAfterBackupResultEdit(
            interaction.guild,
            context,
          );
        this.pendingResultEdits.delete(parsed.token);
        await interaction.editReply({
          content: limitDiscordContent(
            this.resultEditSaveSummary(
              pending.row,
              updatedRow,
              playerKillCount,
              finalRefreshLine,
            ),
          ),
          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(
                  resultEditPageCustomId(
                    pending.sessionId,
                    pending.source.key,
                    pending.page,
                  ),
                )
                .setLabel("Edit More Rows")
                .setStyle(ButtonStyle.Secondary),
            ),
          ],
          allowedMentions: { parse: [] },
        });
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim()
            ? error.message.trim()
            : "Result row could not be saved.";
        await interaction.editReply({
          content: limitDiscordContent(`Result row not saved: ${message}`),
          allowedMentions: { parse: [] },
        });
      }
      return;
    }

    const parsedPayload = this.resultEditPayloadFromModal(interaction, pending);
    if (!parsedPayload.ok) {
      await interaction.reply({
        content: parsedPayload.error,
        ephemeral: true,
      });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      if (!pending.teamId) {
        throw new Error("That result row has no team ID.");
      }
      const teamId = pending.teamId;
      const result = await this.sessionService.withOrganization(
        context.config.organizationId,
        () =>
          this.sessionService.updateMatchResultFromDiscord(
            pending.source.id,
            teamId,
            parsedPayload.payload,
          ),
      );
      const updatedRow =
        this.matchResultRows(result).find((entry) => entry.teamId === teamId) ??
        null;
      const playerKillCount = parsedPayload.payload.playerKills?.length ?? 0;
      const finalRefreshLine = await this.refreshStoredFinalPostAfterResultEdit(
        interaction.guild,
        context,
        pending.source.id,
      );
      this.pendingResultEdits.delete(parsed.token);
      await interaction.editReply({
        content: limitDiscordContent(
          this.resultEditSaveSummary(
            pending.row,
            updatedRow,
            playerKillCount,
            finalRefreshLine,
          ),
        ),
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(
                resultEditPageCustomId(
                  pending.sessionId,
                  pending.source.key,
                  pending.page,
                ),
              )
              .setLabel("Edit More Rows")
              .setStyle(ButtonStyle.Secondary),
          ),
        ],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : "Result row could not be saved.";
      await interaction.editReply({
        content: limitDiscordContent(`Result row not saved: ${message}`),
        allowedMentions: { parse: [] },
      });
    }
  }

  private async handleResultBanSelect(
    interaction: StringSelectMenuInteraction,
    parsed: ParsedResultBanSelectAction,
  ) {
    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can use result ban controls.",
        ephemeral: true,
      });
      return;
    }
    const selectedValue = interaction.values[0];
    if (!selectedValue) {
      await interaction.reply({
        content: "Select one ban target first.",
        ephemeral: true,
      });
      return;
    }

    const context = await this.resolveSessionContextForInteraction(
      interaction,
      parsed.sessionId,
    );
    if (!context) {
      await interaction.reply({
        content: "This result panel is no longer linked to a scrim session.",
        ephemeral: true,
      });
      return;
    }
    const state = await this.sessionService.withOrganization(
      context.config.organizationId,
      () =>
        this.sessionService.getResultControlStateForDiscord(parsed.sessionId),
    );
    const target = state.targets.find((entry) => entry.value === selectedValue);
    if (!target) {
      await interaction.update({
        content: "That ban target is no longer active. Refresh the panel.",
        components: [],
        allowedMentions: { parse: [] },
      });
      return;
    }

    const token = this.storePendingResultUnban({
      userId: interaction.user.id,
      sessionId: parsed.sessionId,
      targetValue: selectedValue,
      panelChannelId: parsed.panelChannelId,
      panelMessageId: parsed.panelMessageId,
      expiresAt: Date.now() + RESULT_CONTROL_UNBAN_TTL_MS,
    });
    await interaction.update({
      content: this.resultBanTargetDetails(target),
      components: [this.buildResultUnbanRow(token)],
      allowedMentions: { parse: [] },
    });
  }

  private async handleResultBanPendingButton(
    interaction: ButtonInteraction,
    parsed: ParsedResultBanPendingAction,
  ) {
    const pending = this.pendingResultUnbans.get(parsed.token);
    if (!pending) {
      await interaction.reply({
        content: "This unban control expired. Open Ban Control again.",
        ephemeral: true,
      });
      return;
    }
    if (pending.userId !== interaction.user.id) {
      await interaction.reply({
        content:
          "Only the staff member who opened this unban control can use it.",
        ephemeral: true,
      });
      return;
    }
    if (!(await this.canUseStaffControls(interaction, pending.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can use result ban controls.",
        ephemeral: true,
      });
      return;
    }
    if (parsed.action === "cancel") {
      this.pendingResultUnbans.delete(parsed.token);
      await interaction.update({
        content: "Unban cancelled.",
        components: [],
        allowedMentions: { parse: [] },
      });
      return;
    }
    await interaction.showModal(this.buildResultUnbanModal(parsed.token));
  }

  private async handleResultBanModal(
    interaction: ModalSubmitInteraction,
    parsed: { token: string },
  ) {
    const pending = this.pendingResultUnbans.get(parsed.token);
    if (!pending) {
      await interaction.reply({
        content: "This unban control expired. Open Ban Control again.",
        ephemeral: true,
      });
      return;
    }
    if (pending.userId !== interaction.user.id) {
      await interaction.reply({
        content:
          "Only the staff member who opened this unban control can use it.",
        ephemeral: true,
      });
      return;
    }
    if (!(await this.canUseStaffControls(interaction, pending.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can use result ban controls.",
        ephemeral: true,
      });
      return;
    }

    const context = await this.resolveSessionContextForInteraction(
      interaction,
      pending.sessionId,
    );
    if (!context) {
      await interaction.reply({
        content: "This result panel is no longer linked to a scrim session.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const content = await this.sessionService.withOrganization(
      context.config.organizationId,
      () =>
        this.sessionService.revokeResultControlBanTargetFromDiscord(
          {
            sessionId: pending.sessionId,
            targetValue: pending.targetValue,
            reason: optionalInputValue(interaction, "reason"),
          },
          interaction.guild,
          {
            actorDiscordId: interaction.user.id,
            actorLabel: interaction.user.tag,
            sourceChannelId: interaction.channelId ?? null,
            sessionName: context.session.name,
          },
        ),
    );
    this.pendingResultUnbans.delete(parsed.token);
    await this.refreshStoredResultControlPanel(
      interaction.guild,
      pending,
      context.config.organizationId,
    );
    await interaction.editReply({
      content: limitDiscordContent(content),
      allowedMentions: { parse: [] },
    });
  }

  private async handleSessionManageButton(
    interaction: ButtonInteraction,
    parsed: ParsedSessionManageAction,
  ) {
    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can use this panel.",
        ephemeral: true,
      });
      return;
    }

    const context = await this.resolveSessionContextForInteraction(
      interaction,
      parsed.sessionId,
    );
    if (!context) {
      await interaction.reply({
        content: "This manage panel is no longer linked to a scrim session.",
        ephemeral: true,
      });
      return;
    }

    switch (parsed.action) {
      case "refresh":
        await interaction.update(
          await this.buildSessionManagePanelMessage(context, interaction.guild),
        );
        return;
      case "post-room":
        await interaction.showModal(
          this.buildModal("post-room", parsed.sessionId),
        );
        return;
      case "map-slots":
      case "preview-results":
      case "apply-results":
        await interaction.showModal(
          this.buildModal(parsed.action, parsed.sessionId),
        );
        return;
      case "no-show":
        await interaction.showModal(
          this.buildNoShowBanModal(parsed.sessionId, context.config),
        );
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    switch (parsed.action) {
      case "open-registration":
      case "close-registration": {
        if (!interaction.guild) {
          await interaction.editReply("Run this control inside the server.");
          return;
        }
        const state = parsed.action === "open-registration" ? "open" : "closed";
        const content = await this.sessionService.withOrganization(
          context.config.organizationId,
          () =>
            this.sessionService.setRegistrationChannelState(
              interaction.guild!,
              parsed.sessionId,
              state,
              {
                actorDiscordId: interaction.user.id,
                actorLabel: interaction.user.tag,
                sourceChannelId: interaction.channelId ?? null,
                sessionName: context.session.name,
              },
            ),
        );
        await interaction.editReply(limitDiscordContent(content));
        await this.refreshSessionManageMessage(interaction, parsed.sessionId);
        return;
      }
      case "sync-discord": {
        if (!interaction.guild) {
          await interaction.editReply("Run this control inside the server.");
          return;
        }
        const setup = await this.sessionService.withOrganization(
          context.config.organizationId,
          () =>
            this.sessionService.syncDiscordScrimState(
              interaction.guild!,
              parsed.sessionId,
            ),
        );
        await interaction.editReply({
          content: [
            `${CHECK} Discord state synced.`,
            `Slot List: <#${setup.slotListChannelId}>`,
            `Waitlist: <#${setup.waitlistChannelId}>`,
            `IDP: <#${setup.idpChannelId}>`,
          ].join("\n"),
          allowedMentions: { parse: [] },
        });
        await this.refreshSessionManageMessage(interaction, parsed.sessionId);
        return;
      }
      case "waitlist": {
        const panel = await this.sessionService.withOrganization(
          context.config.organizationId,
          () => this.sessionService.buildWaitlistControlPanel(parsed.sessionId),
        );
        await interaction.editReply({
          ...panel.payload,
          content: panel.payload.content ?? undefined,
          allowedMentions: panel.payload.allowedMentions ?? { parse: [] },
        });
        return;
      }
      case "slots": {
        const content = await this.sessionService.withOrganization(
          context.config.organizationId,
          () =>
            this.sessionService.listSlots(parsed.sessionId, interaction.guild),
        );
        await interaction.editReply(limitDiscordContent(content));
        return;
      }
      case "standings": {
        const content = await this.sessionService.withOrganization(
          context.config.organizationId,
          () => this.sessionService.standings(parsed.sessionId),
        );
        await interaction.editReply(limitDiscordContent(content));
        return;
      }
      case "start-match": {
        const content = await this.sessionService.withOrganization(
          context.config.organizationId,
          () =>
            this.sessionService.startScrim(
              interaction.user.id,
              parsed.sessionId,
              {
                allowOrganizerOverride: true,
              },
            ),
        );
        await interaction.editReply(limitDiscordContent(content));
        await this.refreshSessionManageMessage(interaction, parsed.sessionId);
        return;
      }
      case "active-bans": {
        const content = await this.sessionService.withOrganization(
          context.config.organizationId,
          () => this.sessionService.listTeamBansForDiscord(parsed.sessionId),
        );
        await interaction.editReply({
          content: limitDiscordContent(content),
          allowedMentions: { parse: [] },
        });
        return;
      }
      case "sync-logos": {
        const result = await this.sessionService.syncOldDiscordLogos({
          sessionId: parsed.sessionId,
          organizationId: context.config.organizationId,
          channelId: "",
          limit: 500,
        });
        await interaction.editReply({
          content: this.formatHistorySyncResult("Logo", result),
          allowedMentions: { parse: [] },
        });
        return;
      }
      case "sync-photos": {
        const result = await this.sessionService.syncOldDiscordPlayerPhotos({
          sessionId: parsed.sessionId,
          organizationId: context.config.organizationId,
          channelId: "",
          limit: 500,
        });
        await interaction.editReply({
          content: this.formatHistorySyncResult("Player photo", result),
          allowedMentions: { parse: [] },
        });
        return;
      }
    }
  }

  private async handleBanControlButton(
    interaction: ButtonInteraction,
    parsed: ParsedBanControlAction,
  ) {
    if (parsed.action === "confirm" || parsed.action === "cancel") {
      await this.handlePendingBanControlButton(interaction, parsed);
      return;
    }

    if (!parsed.sessionId) {
      await interaction.reply({
        content: "This ban control is missing its session context.",
        ephemeral: true,
      });
      return;
    }

    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can use ban controls.",
        ephemeral: true,
      });
      return;
    }

    const resolved = await this.resolveBanControlSession(
      interaction,
      parsed.sessionId,
    );
    if (!resolved) {
      await interaction.reply({
        content: "Use this ban control inside the synced scrim channel.",
        ephemeral: true,
      });
      return;
    }

    if (
      (resolved.config.emojis?.banControlsEnabled ?? "true")
        .trim()
        .toLowerCase() === "false"
    ) {
      await interaction.reply({
        content: "Discord ban controls are disabled for this scrim.",
        ephemeral: true,
      });
      return;
    }

    if (parsed.action === "create") {
      await interaction.showModal(
        this.buildBanTeamModal(parsed.sessionId, resolved.config),
      );
      return;
    }

    if (parsed.action === "missing") {
      await interaction.showModal(
        this.buildNoShowBanModal(parsed.sessionId, resolved.config),
      );
      return;
    }

    if (parsed.action === "conditional") {
      await interaction.showModal(
        this.buildConditionalBannedTeamRegistrationModal(parsed.sessionId),
      );
      return;
    }

    if (parsed.action === "list") {
      await interaction.deferReply({ ephemeral: true });
      const content = await this.withInteractionOrganization(
        interaction,
        parsed.sessionId,
        () => this.sessionService.listTeamBansForDiscord(parsed.sessionId),
      );
      await interaction.editReply({
        content: limitDiscordContent(content),
        allowedMentions: { parse: [] },
      });
      return;
    }

    await interaction.update(
      this.buildBanControlPanelMessage(
        resolved.session.id,
        resolved.session.name,
        resolved.config,
      ),
    );
  }

  private async handleManageCardBanButton(
    interaction: ButtonInteraction,
    parsed: ParsedManageCardBanAction,
  ) {
    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can use ban controls.",
        ephemeral: true,
      });
      return;
    }

    const resolved = await this.resolveBanControlSession(
      interaction,
      parsed.sessionId,
    );
    if (!resolved) {
      await interaction.reply({
        content: "This ban button is no longer linked to this scrim.",
        ephemeral: true,
      });
      return;
    }

    if (!this.discordBanControlsEnabled(resolved.config)) {
      await interaction.reply({
        content: "Discord ban controls are disabled for this scrim.",
        ephemeral: true,
      });
      return;
    }

    if (parsed.action === "d") {
      await interaction.showModal(
        this.buildManageCardBanDurationModal(
          parsed.sessionId,
          parsed.teamId,
          resolved.config,
        ),
      );
      return;
    }

    await interaction.showModal(
      this.buildManageCardPermanentBanReasonModal(
        parsed.sessionId,
        parsed.teamId,
        resolved.config,
      ),
    );
  }

  private async handlePendingBanControlButton(
    interaction: ButtonInteraction,
    parsed: ParsedBanControlAction,
  ) {
    const token = parsed.token;
    const pending = token ? this.pendingBanActions.get(token) : null;
    if (!token || !pending) {
      await interaction.reply({
        content: "This ban confirmation expired. Open the ban control again.",
        ephemeral: true,
      });
      return;
    }

    if (pending.userId !== interaction.user.id) {
      await interaction.reply({
        content:
          "Only the staff member who opened this confirmation can use it.",
        ephemeral: true,
      });
      return;
    }

    if (Date.now() > pending.expiresAt) {
      this.pendingBanActions.delete(token);
      await interaction.update({
        content: "This ban confirmation expired. Open the ban control again.",
        components: [],
      });
      return;
    }

    if (!(await this.canUseStaffControls(interaction, pending.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can use ban controls.",
        ephemeral: true,
      });
      return;
    }

    if (parsed.action === "cancel") {
      this.pendingBanActions.delete(token);
      await interaction.update({
        content: "Ban action cancelled.",
        components: [],
      });
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: "Run this control inside the Discord server.",
        ephemeral: true,
      });
      return;
    }
    const guild = interaction.guild;

    if (pending.kind === "conditional") {
      await interaction.update({
        content: "Applying conditional banned-team registration...",
        components: [],
      });
      try {
        const response = await this.withInteractionOrganization(
          interaction,
          pending.sessionId,
          () =>
            this.sessionService.createConditionalBannedTeamRegistration(
              pending.sessionId,
              {
                requestKey: pending.requestKey,
                confirmationToken: pending.preview.confirmationToken,
                teamId: pending.preview.team.id,
                managerDiscordUserIds: pending.preview.managerDiscordUserIds,
                requiredMatchCount: pending.preview.requiredMatchCount,
                approvedByDiscordId: interaction.user.id,
                approvedByDiscordUsername: interaction.user.tag,
                reason: pending.reason,
              },
              guild,
            ),
        );
        this.pendingBanActions.delete(token);
        const teamLabel = response.registration.team?.tag
          ? `${response.registration.team.name} (${response.registration.team.tag})`
          : response.registration.team?.name || response.registration.teamId;
        await interaction.editReply({
          content: limitDiscordContent(
            [
              response.recovered
                ? `Conditional registration recovered for ${teamLabel}.`
                : `Conditional registration active for ${teamLabel}.`,
              `Confirmed slot: #${response.registration.slotNumber}`,
              `Manager(s): ${response.enrollment.managerDiscordUserIds
                .map((id) => `<@${id}>`)
                .join(", ")}`,
              `Required matches: ${response.enrollment.requiredMatchCount}`,
              `Slot/IDP roles added: ${response.roleSync.addedAccessRoles}`,
              `Ban roles restored or preserved: ${response.roleSync.restoredBanRoles}`,
              "Only the exact snapshotted bans can be released after every required match is present and applied in a successfully posted final result.",
            ].join("\n"),
          ),
          components: [],
          allowedMentions: { parse: [] },
        });
      } catch (error) {
        const stillActive = Date.now() <= pending.expiresAt;
        if (!stillActive) {
          this.pendingBanActions.delete(token);
        }
        const message =
          error instanceof Error ? error.message : "Unknown registration error";
        await interaction.editReply({
          content: limitDiscordContent(
            [
              "Conditional registration was not fully applied.",
              message,
              stillActive
                ? "You can retry this same idempotent confirmation, or cancel and open a fresh preview if the team, slot, managers, or bans changed."
                : "The confirmation expired; open a fresh preview.",
            ].join("\n"),
          ),
          components: stillActive
            ? [
                this.buildBanConfirmationRow(
                  token,
                  "Retry Conditional Registration",
                  ButtonStyle.Success,
                ),
              ]
            : [],
          allowedMentions: { parse: [] },
        });
      }
      return;
    }

    this.pendingBanActions.delete(token);
    await interaction.update({
      content: "Applying ban action...",
      components: [],
    });

    const content = await this.withInteractionOrganization(
      interaction,
      pending.sessionId,
      () =>
        pending.kind === "team"
          ? this.sessionService.createTeamBanFromDiscord(
              pending.command,
              guild,
              {
                actorDiscordId: interaction.user.id,
                actorLabel: interaction.user.tag,
                sourceChannelId: interaction.channelId ?? null,
              },
            )
          : this.sessionService.createNoShowTeamBansFromDiscord(
              pending.command,
              guild,
              {
                actorDiscordId: interaction.user.id,
                actorLabel: interaction.user.tag,
                sourceChannelId: interaction.channelId ?? null,
              },
            ),
    );
    await interaction.editReply({
      content: limitDiscordContent(content),
      allowedMentions: { parse: [] },
    });
  }

  private async handleManageCardBanModal(
    interaction: ModalSubmitInteraction,
    parsed: Pick<ParsedManageCardBanAction, "sessionId" | "teamId">,
  ) {
    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can use ban controls.",
        ephemeral: true,
      });
      return;
    }

    const resolved = await this.resolveBanControlSession(
      interaction,
      parsed.sessionId,
    );
    if (!resolved) {
      await interaction.reply({
        content: "This ban button is no longer linked to this scrim.",
        ephemeral: true,
      });
      return;
    }

    if (!this.discordBanControlsEnabled(resolved.config)) {
      await interaction.reply({
        content: "Discord ban controls are disabled for this scrim.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const days = this.parseBanDurationDays(
      optionalInputValue(interaction, "days"),
      resolved.config,
    );
    await this.previewManageCardBan(interaction, parsed, resolved.config, {
      days,
      reason:
        optionalInputValue(interaction, "reason") ||
        resolved.config.emojis?.banDefaultReason ||
        "Manual Discord manager ban",
      confirmLabel: days ? "Apply Ban" : "Permanent Ban",
    });
  }

  private async handleManageCardPermanentBanModal(
    interaction: ModalSubmitInteraction,
    parsed: Pick<ParsedManageCardBanAction, "sessionId" | "teamId">,
  ) {
    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can use ban controls.",
        ephemeral: true,
      });
      return;
    }

    const resolved = await this.resolveBanControlSession(
      interaction,
      parsed.sessionId,
    );
    if (!resolved) {
      await interaction.reply({
        content: "This ban button is no longer linked to this scrim.",
        ephemeral: true,
      });
      return;
    }

    if (!this.discordBanControlsEnabled(resolved.config)) {
      await interaction.reply({
        content: "Discord ban controls are disabled for this scrim.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    await this.previewManageCardBan(interaction, parsed, resolved.config, {
      days: null,
      reason:
        optionalInputValue(interaction, "reason") ||
        resolved.config.emojis?.banDefaultReason ||
        "Permanent Discord manager ban",
      confirmLabel: "Permanent Ban",
    });
  }

  private async handleBanControlModal(
    interaction: ModalSubmitInteraction,
    parsed: {
      action: "create" | "missing" | "conditional";
      sessionId: string;
    },
  ) {
    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can use ban controls.",
        ephemeral: true,
      });
      return;
    }

    const resolved = await this.resolveBanControlSession(
      interaction,
      parsed.sessionId,
    );
    if (!resolved) {
      await interaction.reply({
        content: "Use this ban control inside the synced scrim channel.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    if (parsed.action === "create") {
      await this.handleBanTeamModal(
        interaction,
        parsed.sessionId,
        resolved.config,
      );
      return;
    }
    if (parsed.action === "conditional") {
      await this.handleConditionalBannedTeamRegistrationModal(
        interaction,
        parsed.sessionId,
        resolved.config,
      );
      return;
    }
    await this.handleNoShowBanModal(
      interaction,
      parsed.sessionId,
      resolved.config,
    );
  }

  private async handleBanTeamModal(
    interaction: ModalSubmitInteraction,
    sessionId: string,
    config: SessionDiscordConfigResponse,
  ) {
    const targetText = inputValue(interaction, "team-target");
    const parsedScope = this.parseBanControlScope(
      optionalInputValue(interaction, "scope"),
      config,
    );
    const matchInput = optionalInputValue(interaction, "matches");
    const parsedMatches = this.parseBanMatchNumbers(matchInput);
    const command: DiscordTeamBanCommand = {
      target: this.parseBanControlTarget(targetText),
      scope: parsedScope.scope,
      sessionId,
      sessionSelectors: parsedScope.sessionSelectors,
      matchNumbers: parsedMatches.matchNumbers,
      allMatches: parsedScope.allMatches || parsedMatches.allMatches,
      days: this.parseBanDurationDays(
        optionalInputValue(interaction, "days"),
        config,
      ),
      reason:
        optionalInputValue(interaction, "reason") ||
        config.emojis?.banDefaultReason ||
        "Manual Discord ban",
      note: "Created from Discord ban control",
      serverAction: parsedScope.serverAction,
    };

    const preview = await this.withInteractionOrganization(
      interaction,
      sessionId,
      () => this.sessionService.previewTeamBanFromDiscord(command),
    );
    const token = this.storePendingBanAction({
      kind: "team",
      userId: interaction.user.id,
      sessionId,
      command: preview.command,
      expiresAt: Date.now() + BAN_CONTROL_CONFIRMATION_TTL_MS,
    });
    await interaction.editReply({
      content: preview.content,
      components: [this.buildBanConfirmationRow(token, "Apply Ban")],
      allowedMentions: { parse: [] },
    });
  }

  private parseConditionalManagerMentions(value: string) {
    const ids = [
      ...new Set(
        [...value.matchAll(/<@!?(\d{15,25})>/g)]
          .map((match) => match[1])
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const leftover = value
      .replace(/<@!?\d{15,25}>/g, "")
      .replace(/[\s,;]+/g, "");
    if (!ids.length || leftover) {
      throw new Error(
        "Manager input must contain Discord @mentions only (for example: @Manager1 @Manager2).",
      );
    }
    return ids;
  }

  private parseConditionalRequiredMatchCount(value: string) {
    const count = Number(value.trim());
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      throw new Error("Required matches must be a whole number from 1 to 50.");
    }
    return count;
  }

  private async handleConditionalBannedTeamRegistrationModal(
    interaction: ModalSubmitInteraction,
    sessionId: string,
    config: SessionDiscordConfigResponse,
  ) {
    if (!interaction.guild) {
      throw new Error("Run this control inside the Discord server.");
    }
    const teamQuery = inputValue(interaction, "conditional-team");
    const managerDiscordUserIds = this.parseConditionalManagerMentions(
      inputValue(interaction, "conditional-managers"),
    );
    const maxManagers = Math.min(
      10,
      Math.max(1, Number(config.maxManagersPerTeam) || 2),
    );
    if (managerDiscordUserIds.length > maxManagers) {
      throw new Error(
        `This scrim allows at most ${maxManagers} manager mention${maxManagers === 1 ? "" : "s"} per team.`,
      );
    }
    for (const discordUserId of managerDiscordUserIds) {
      let member: GuildMember;
      try {
        member = await interaction.guild.members.fetch({
          user: discordUserId,
          force: true,
        });
      } catch {
        throw new Error(
          `Manager <@${discordUserId}> is not an active member of this Discord server.`,
        );
      }
      if (member.user.bot) {
        throw new Error(`Manager <@${discordUserId}> cannot be a bot account.`);
      }
    }

    const requiredMatchCount = this.parseConditionalRequiredMatchCount(
      inputValue(interaction, "conditional-matches"),
    );
    const reason =
      optionalInputValue(interaction, "conditional-reason") ||
      "Staff-approved conditional banned-team participation";
    const preview = await this.withInteractionOrganization(
      interaction,
      sessionId,
      () =>
        this.sessionService.previewConditionalBannedTeamRegistration(
          sessionId,
          { teamQuery, managerDiscordUserIds, requiredMatchCount },
        ),
    );
    const token = this.storePendingBanAction({
      kind: "conditional",
      userId: interaction.user.id,
      sessionId,
      requestKey: randomUUID(),
      preview,
      reason,
      expiresAt: Date.now() + BAN_CONTROL_CONFIRMATION_TTL_MS,
    });
    const teamLabel = preview.team.tag
      ? `${preview.team.name} (${preview.team.tag})`
      : preview.team.name;
    const teamBanLines = preview.teamBans.map(
      (ban) => `- ${ban.scope} team ban ${ban.id.slice(0, 8)}: ${ban.reason}`,
    );
    const managerBanLines = preview.managerBans.map(
      (ban) =>
        `- <@${ban.discordUserId}> ${ban.scope} ban ${ban.id.slice(0, 8)}: ${ban.reason}`,
    );
    const plannedCompanionLines = (
      preview.plannedManagerBanCompanions ?? []
    ).map(
      (ban) =>
        `- <@${ban.discordUserId}> ${ban.scope} manager companion for team ban${ban.sourceTeamBanIds.length === 1 ? "" : "s"} ${ban.sourceTeamBanIds.map((id) => id.slice(0, 8)).join(", ")}: ${ban.reason}`,
    );
    await interaction.editReply({
      content: limitDiscordContent(
        [
          preview.recovery
            ? "Conditional banned-team registration recovery preview"
            : "Conditional banned-team registration preview",
          `Team: ${teamLabel}`,
          `Confirmed slot: #${preview.proposedSlotNumber}`,
          `Manager(s): ${managerDiscordUserIds.map((id) => `<@${id}>`).join(", ")}`,
          `Required matches: ${preview.requiredMatchCount}`,
          `Reason: ${reason}`,
          ...(preview.recovery
            ? [
                "Recovery mode: no new registration or enrollment will be created; Discord roles will be reconciled from the existing exact snapshot.",
              ]
            : []),
          "",
          `Exact team bans to release after full attendance (${teamBanLines.length}):`,
          ...(teamBanLines.length ? teamBanLines : ["- None"]),
          `Exact manager bans to release after full attendance (${managerBanLines.length}):`,
          ...(managerBanLines.length ? managerBanLines : ["- None"]),
          `Manager-ban companions that confirmation will create and release after full attendance (${plannedCompanionLines.length}):`,
          ...(plannedCompanionLines.length
            ? plannedCompanionLines
            : ["- None"]),
          "",
          "The ban role stays during play. Slot + IDP access is added now. Any missed, absent, duplicate, unapplied, new, or unrelated ban remains enforced.",
        ].join("\n"),
      ),
      components: [
        this.buildBanConfirmationRow(
          token,
          preview.recovery
            ? "Recover Conditional Registration"
            : "Register Conditionally",
          ButtonStyle.Success,
        ),
      ],
      allowedMentions: { parse: [] },
    });
  }

  private buildManageCardBanDurationModal(
    sessionId: string,
    teamId: string,
    config: SessionDiscordConfigResponse,
  ) {
    const defaultDays = (config.emojis?.banDefaultDurationDays || "").trim();
    const safeDefaultDays = /^(permanent|perm|none|0)$/i.test(defaultDays)
      ? "3"
      : defaultDays || "3";
    const modal = new ModalBuilder()
      .setCustomId(manageCardBanModalId(sessionId, teamId))
      .setTitle("Ban Manager");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("days")
          .setLabel("Ban days")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Example: 3")
          .setRequired(true)
          .setMaxLength(20)
          .setValue(safeDefaultDays),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Reason")
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder(
            config.emojis?.banDefaultReason || "Manual Discord ban",
          )
          .setRequired(false)
          .setMaxLength(300),
      ),
    );
    return modal;
  }

  private buildManageCardPermanentBanReasonModal(
    sessionId: string,
    teamId: string,
    config: SessionDiscordConfigResponse,
  ) {
    const modal = new ModalBuilder()
      .setCustomId(manageCardPermanentBanModalId(sessionId, teamId))
      .setTitle("Permanent Ban Reason");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Reason")
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder(
            config.emojis?.banDefaultReason || "Permanent Discord manager ban",
          )
          .setRequired(true)
          .setMaxLength(300),
      ),
    );
    return modal;
  }

  private async previewManageCardBan(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    target: Pick<ParsedManageCardBanAction, "sessionId" | "teamId">,
    config: SessionDiscordConfigResponse,
    options: { days: number | null; reason: string; confirmLabel: string },
  ) {
    const command: DiscordTeamBanCommand = {
      target: { kind: "team-id", teamId: target.teamId },
      scope: "SESSION",
      sessionId: target.sessionId,
      days: options.days,
      reason: options.reason,
      note: "Created from Discord manage card",
      serverAction: null,
    };
    const preview = await this.withInteractionOrganization(
      interaction,
      target.sessionId,
      () => this.sessionService.previewTeamBanFromDiscord(command),
    );
    const token = this.storePendingBanAction({
      kind: "team",
      userId: interaction.user.id,
      sessionId: target.sessionId,
      command: preview.command,
      expiresAt: Date.now() + BAN_CONTROL_CONFIRMATION_TTL_MS,
    });
    await interaction.editReply({
      content: preview.content,
      components: [this.buildBanConfirmationRow(token, options.confirmLabel)],
      allowedMentions: { parse: [] },
    });
  }

  private async handleNoShowBanModal(
    interaction: ModalSubmitInteraction,
    sessionId: string,
    config: SessionDiscordConfigResponse,
  ) {
    const command: DiscordNoShowTeamBanCommand = {
      sessionId,
      matchNumber: this.parseOptionalMatchNumber(
        optionalInputValue(interaction, "match"),
      ),
      scope: this.parseNoShowBanScope(optionalInputValue(interaction, "scope")),
      days: this.parseBanDurationDays(
        optionalInputValue(interaction, "days"),
        config,
      ),
      reason:
        optionalInputValue(interaction, "reason") ||
        config.emojis?.banDefaultReason ||
        "Manual Discord no-show ban",
      note: "Created from Discord ban control",
    };

    const preview = await this.withInteractionOrganization(
      interaction,
      sessionId,
      () => this.sessionService.previewNoShowTeamBansFromDiscord(command),
    );
    if (preview.response.creatableCount === 0) {
      await interaction.editReply({
        content: preview.content,
        allowedMentions: { parse: [] },
      });
      return;
    }

    const token = this.storePendingBanAction({
      kind: "no-show",
      userId: interaction.user.id,
      sessionId,
      command,
      expiresAt: Date.now() + BAN_CONTROL_CONFIRMATION_TTL_MS,
    });
    await interaction.editReply({
      content: limitDiscordContent(preview.content),
      components: [this.buildBanConfirmationRow(token, "Ban No-Shows")],
      allowedMentions: { parse: [] },
    });
  }

  private async resolveBanControlSession(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    sessionId: string,
  ) {
    if (!interaction.guild || !interaction.channelId) {
      return null;
    }
    const resolved = await this.sessionService
      .findScrimForDiscordChannel(interaction.guild.id, interaction.channelId)
      .catch(() => null);
    if (!resolved || resolved.session.id !== sessionId) {
      return null;
    }
    return resolved;
  }

  private buildBanTeamModal(
    sessionId: string,
    config: SessionDiscordConfigResponse,
  ) {
    return this.banModal("Ban Manager", "create", sessionId, [
      {
        customId: "team-target",
        label: "Team name, tag, or @manager",
        placeholder: "Example: DXB or @manager",
        maxLength: 120,
      },
      {
        customId: "scope",
        label: "Scope or sessions",
        placeholder: "session, all-sessions, match, sessions: 16,20",
        required: false,
        maxLength: 120,
        value: config.emojis?.banDefaultScope || "SESSION",
      },
      {
        customId: "matches",
        label: "Match numbers",
        placeholder: "Example: 1,2 or all",
        required: false,
        maxLength: 80,
      },
      {
        customId: "days",
        label: "Ban days",
        placeholder: "Example: 3 or permanent",
        required: false,
        maxLength: 20,
        value: config.emojis?.banDefaultDurationDays || "3",
      },
      {
        customId: "reason",
        label: "Reason",
        placeholder: config.emojis?.banDefaultReason || "Manual Discord ban",
        required: false,
        maxLength: 300,
      },
    ]);
  }

  private buildNoShowBanModal(
    sessionId: string,
    config: SessionDiscordConfigResponse,
  ) {
    return this.banModal("Ban No-Shows", "missing", sessionId, [
      {
        customId: "match",
        label: "Match number",
        placeholder: "Leave blank for latest eligible match",
        required: false,
        maxLength: 20,
      },
      {
        customId: "scope",
        label: "Scope",
        placeholder: "session, team, or match",
        required: false,
        maxLength: 40,
        value: config.emojis?.banDefaultScope || "SESSION",
      },
      {
        customId: "days",
        label: "Ban days",
        placeholder: "Example: 3 or permanent",
        required: false,
        maxLength: 20,
        value: config.emojis?.banDefaultDurationDays || "3",
      },
      {
        customId: "reason",
        label: "Reason",
        placeholder: config.emojis?.banDefaultReason || "Manual no-show ban",
        required: false,
        maxLength: 300,
      },
    ]);
  }

  private buildConditionalBannedTeamRegistrationModal(sessionId: string) {
    return this.banModal(
      "Conditional Team Registration",
      "conditional",
      sessionId,
      [
        {
          customId: "conditional-team",
          label: "Banned team exact name, tag, or ID",
          placeholder: "Example: DXB",
          maxLength: 120,
        },
        {
          customId: "conditional-managers",
          label: "Manager Discord mentions",
          placeholder: "Example: @Manager1 @Manager2",
          maxLength: 160,
        },
        {
          customId: "conditional-matches",
          label: "Matches required for automatic unban",
          placeholder: "Example: 4",
          maxLength: 3,
        },
        {
          customId: "conditional-reason",
          label: "Approval reason / note",
          placeholder: "Why this banned team may play this event",
          required: false,
          style: TextInputStyle.Paragraph,
          maxLength: 300,
        },
      ],
    );
  }

  private banModal(
    title: string,
    action: "create" | "missing" | "conditional",
    sessionId: string,
    inputs: TextInputConfig[],
  ) {
    const modal = new ModalBuilder()
      .setCustomId(banControlModalId(action, sessionId))
      .setTitle(title);
    modal.addComponents(
      ...inputs.map((input) =>
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          (() => {
            const builder = new TextInputBuilder()
              .setCustomId(input.customId)
              .setLabel(input.label)
              .setStyle(input.style ?? TextInputStyle.Short)
              .setPlaceholder(input.placeholder ?? "")
              .setRequired(input.required ?? true)
              .setMaxLength(input.maxLength ?? 200);
            if (input.value) {
              builder.setValue(input.value);
            }
            return builder;
          })(),
        ),
      ),
    );
    return modal;
  }

  private buildBanConfirmationRow(
    token: string,
    label: string,
    confirmStyle: ButtonStyle = ButtonStyle.Danger,
  ) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(banControlCustomId("confirm", token))
        .setLabel(label)
        .setStyle(confirmStyle),
      new ButtonBuilder()
        .setCustomId(banControlCustomId("cancel", token))
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );
  }

  private storePendingBanAction(action: PendingBanControlAction) {
    const token = `${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    this.pendingBanActions.set(token, action);
    setTimeout(() => {
      this.pendingBanActions.delete(token);
    }, BAN_CONTROL_CONFIRMATION_TTL_MS).unref?.();
    return token;
  }

  private discordBanControlsEnabled(config: SessionDiscordConfigResponse) {
    return (
      (config.emojis?.banControlsEnabled ?? "true").trim().toLowerCase() !==
      "false"
    );
  }

  private parseBanControlTarget(value: string): DiscordTeamBanTarget {
    const mention = /<@!?(\d{15,25})>/.exec(value);
    if (mention?.[1]) {
      return { kind: "manager", discordUserId: mention[1] };
    }
    const query = value.trim().replace(/^"|"$/g, "").trim();
    if (!query) {
      throw new Error("Add a team name, tag, or manager mention.");
    }
    return { kind: "team", query };
  }

  private parseBanControlScope(
    value: string,
    config: SessionDiscordConfigResponse,
  ): {
    scope: TeamBanScope;
    allMatches: boolean;
    sessionSelectors: string[];
    serverAction: DiscordTeamBanServerAction | null;
  } {
    const raw = (value || config.emojis?.banDefaultScope || "SESSION").trim();
    const selectedSessions = /^(?:sessions?|scrims?)\s*[:=]\s*(.+)$/i.exec(raw);
    if (selectedSessions?.[1]) {
      const sessionSelectors = this.parseBanControlSessionSelectors(
        selectedSessions[1],
      );
      if (!sessionSelectors.length) {
        throw new Error("Add at least one session name or ID after sessions:.");
      }
      return {
        scope: "SESSION",
        allMatches: false,
        sessionSelectors,
        serverAction: null,
      };
    }

    const normalized = (raw || "SESSION")
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-");
    if (["session", "scrim", "current"].includes(normalized)) {
      return {
        scope: "SESSION",
        allMatches: false,
        sessionSelectors: [],
        serverAction: null,
      };
    }
    if (
      [
        "team",
        "teams",
        "all-sessions",
        "all-session",
        "global",
        "all",
      ].includes(normalized)
    ) {
      return {
        scope: "TEAM",
        allMatches: false,
        sessionSelectors: [],
        serverAction: null,
      };
    }
    if (["match", "matches"].includes(normalized)) {
      return {
        scope: "MATCH",
        allMatches: false,
        sessionSelectors: [],
        serverAction: null,
      };
    }
    if (["all-matches", "allmatches"].includes(normalized)) {
      return {
        scope: "MATCH",
        allMatches: true,
        sessionSelectors: [],
        serverAction: null,
      };
    }
    if (["server", "guild", "discord-server"].includes(normalized)) {
      return {
        scope: "TEAM",
        allMatches: false,
        sessionSelectors: [],
        serverAction: this.parseConfiguredBanServerAction(
          config.emojis?.banServerAction,
        ),
      };
    }
    throw new Error(
      "Scope must be session, all-sessions, match, all-matches, server, or sessions: name1,name2.",
    );
  }

  private parseBanControlSessionSelectors(value: string) {
    return [
      ...new Set(
        value
          .split(/[;,|]+/g)
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    ];
  }

  private parseNoShowBanScope(value: string): TeamBanScope {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-");
    if (!normalized || ["session", "scrim", "current"].includes(normalized)) {
      return "SESSION";
    }
    if (
      ["team", "teams", "all-sessions", "global", "all"].includes(normalized)
    ) {
      return "TEAM";
    }
    if (["match", "matches"].includes(normalized)) {
      return "MATCH";
    }
    throw new Error("No-show scope must be session, team, or match.");
  }

  private parseConfiguredBanServerAction(
    value: string | null | undefined,
  ): DiscordTeamBanServerAction {
    const normalized = (value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-");
    if (["discord-ban", "server-ban", "ban"].includes(normalized)) {
      return "DISCORD_BAN";
    }
    if (["role", "banned-role", "ban-role", ""].includes(normalized)) {
      return "ROLE";
    }
    return "NONE";
  }

  private parseBanDurationDays(
    value: string,
    config: SessionDiscordConfigResponse,
  ): number | null {
    const raw = (value || config.emojis?.banDefaultDurationDays || "").trim();
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

  private parseBanMatchNumbers(value: string): {
    matchNumbers: number[];
    allMatches: boolean;
  } {
    const trimmed = value.trim();
    if (!trimmed) {
      return { matchNumbers: [], allMatches: false };
    }
    if (
      ["all", "all-matches", "allmatches", "*"].includes(trimmed.toLowerCase())
    ) {
      return { matchNumbers: [], allMatches: true };
    }
    const matchNumbers = this.parseMatchNumberList(trimmed);
    if (!matchNumbers.length) {
      throw new Error("Match numbers must look like 1,2, match 1, M1, or all.");
    }
    return { matchNumbers, allMatches: false };
  }

  private parseOptionalMatchNumber(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = this.parseMatchNumberList(trimmed)[0] ?? null;
    if (!parsed || parsed < 1 || parsed > 100) {
      throw new Error(
        "Match number must be between 1 and 100, for example 1, match 1, or M1.",
      );
    }
    return parsed;
  }

  private parseMatchNumberList(value: string): number[] {
    const explicitMatches = Array.from(
      value.matchAll(MATCH_NUMBER_TEXT_PATTERN),
    ).map((match) => Number.parseInt(match[1] ?? "", 10));
    const fallbackMatches = value
      .split(/[,\s]+/)
      .map((entry) => Number.parseInt(entry.replace(/^#/, ""), 10));
    return [
      ...new Set(
        [...explicitMatches, ...fallbackMatches].filter(
          (entry) => Number.isInteger(entry) && entry > 0 && entry <= 100,
        ),
      ),
    ];
  }

  private async handleRegistrationControlButton(
    interaction: ButtonInteraction,
    parsed: ParsedRegistrationControlAction,
  ) {
    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can use this control.",
        ephemeral: true,
      });
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: "Run this control inside the Discord server.",
        ephemeral: true,
      });
      return;
    }

    if (parsed.action === "s") {
      await interaction.showModal(this.buildRegistrationSlotModal(parsed));
      return;
    }

    const action =
      parsed.action === "a"
        ? "APPROVE"
        : parsed.action === "w"
          ? "WAITLIST"
          : parsed.action === "v"
            ? "VIP"
            : "REMOVE";

    if (action === "REMOVE") {
      await this.showRegistrationRemovalConfirmation(interaction, parsed);
      return;
    } else {
      await interaction.deferReply({ ephemeral: true });
    }

    const content = await this.withInteractionOrganization(
      interaction,
      parsed.sessionId,
      () =>
        this.sessionService.updateRegistrationPlacement(
          parsed.sessionId,
          parsed.registrationId,
          { action },
          interaction.guild,
          {
            actorDiscordId: interaction.user.id,
            actorLabel: interaction.user.tag,
            sourceChannelId: interaction.channelId ?? null,
          },
        ),
    );
    await interaction.editReply(limitDiscordContent(content));
  }

  private async handleRegistrationSlotModal(
    interaction: ModalSubmitInteraction,
    parsed: Pick<
      ParsedRegistrationControlAction,
      "sessionId" | "registrationId"
    >,
  ) {
    if (!(await this.canUseStaffControls(interaction, parsed.sessionId))) {
      await interaction.reply({
        content: "Only Arenzyra staff can use this control.",
        ephemeral: true,
      });
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: "Run this control inside the Discord server.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const slotNumber = this.parseIntegerInput(
      inputValue(interaction, "slot-number"),
      "Slot number",
      { min: 1, max: 100 },
    );
    const content = await this.withInteractionOrganization(
      interaction,
      parsed.sessionId,
      () =>
        this.sessionService.updateRegistrationPlacement(
          parsed.sessionId,
          parsed.registrationId,
          { action: "SLOT", slotNumber },
          interaction.guild,
          {
            actorDiscordId: interaction.user.id,
            actorLabel: interaction.user.tag,
            sourceChannelId: interaction.channelId ?? null,
          },
        ),
    );
    await interaction.editReply(limitDiscordContent(content));
  }

  private buildCaptainPanelMessage(context: ResolvedSessionContext) {
    const sessionId = context.session.id;
    const embed = new EmbedBuilder()
      .setColor(0x06b6d4)
      .setTitle("Arenzyra Captain Panel")
      .setDescription(
        "Manager self-service controls for slot confirmation, logo upload, slots, and standings.",
      )
      .addFields(
        { name: "Session", value: context.session.name, inline: true },
        { name: "Status", value: context.session.status, inline: true },
        {
          name: "Slots",
          value: `${context.session.counts.confirmedCount}/${context.session.slotCount}`,
          inline: true,
        },
      )
      .setFooter({ text: "Arenzyra Captain Controls" })
      .setTimestamp(new Date());

    const playRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`play:confirm:${sessionId}`)
        .setLabel("Confirm Slot")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`play:not:${sessionId}`)
        .setLabel("Not Playing")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`captain:logo-help:${sessionId}`)
        .setLabel("Logo Help")
        .setStyle(ButtonStyle.Secondary),
    );
    const infoRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      controlButton("list-slots", "Slots", ButtonStyle.Secondary, sessionId),
      controlButton("standings", "Standings", ButtonStyle.Secondary, sessionId),
    );

    return {
      embeds: [embed],
      components: [playRow, infoRow],
      allowedMentions: { parse: [] },
    };
  }

  private async buildLiveCenterMessage(
    context: ResolvedSessionContext,
    guild: ButtonInteraction["guild"],
  ) {
    const matches = await this.sessionService
      .listSessionMatchesForDiscord(context.session.id)
      .catch(() => []);
    const latestMatch = [...matches].sort(
      (left, right) => (right.matchNumber ?? 0) - (left.matchNumber ?? 0),
    )[0];
    const startsAt = context.session.startsAt
      ? `<t:${Math.floor(Date.parse(context.session.startsAt) / 1000)}:F>`
      : "Not set";

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Arenzyra Live Match Center")
      .setDescription(context.session.name)
      .addFields(
        {
          name: "Session",
          value: [
            `Status: ${context.session.status}`,
            `Start: ${startsAt}`,
            `Slots: ${context.session.counts.confirmedCount}/${context.session.slotCount}`,
            `Waitlist: ${context.session.counts.waitlistCount}`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "Matches",
          value: latestMatch
            ? [
                `Created: ${matches.length}`,
                `Latest: #${latestMatch.matchNumber ?? "?"}`,
                `ID: ${latestMatch.id}`,
              ].join("\n")
            : "No match has been created yet.",
          inline: true,
        },
        {
          name: "Channels",
          value: [
            context.config.slotListChannelId
              ? `Slots: <#${context.config.slotListChannelId}>`
              : "Slots: not configured",
            context.config.resultsChannelId
              ? `Results: <#${context.config.resultsChannelId}>`
              : "Results: not configured",
            context.config.logChannelId
              ? `Log: <#${context.config.logChannelId}>`
              : "Log: not configured",
          ].join("\n"),
          inline: false,
        },
      )
      .setFooter({
        text: guild ? `Server: ${guild.name}` : "Arenzyra Production Control",
      })
      .setTimestamp(new Date());

    const sessionId = context.session.id;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      controlButton("list-slots", "Slots", ButtonStyle.Secondary, sessionId),
      controlButton("standings", "Standings", ButtonStyle.Secondary, sessionId),
      controlButton("sync-discord", "Sync", ButtonStyle.Secondary, sessionId),
      controlButton(
        "start-scrim",
        "Start Match",
        ButtonStyle.Success,
        sessionId,
      ),
      new ButtonBuilder()
        .setCustomId(`livecenter:refresh:${sessionId}`)
        .setLabel("Refresh")
        .setStyle(ButtonStyle.Primary),
    );
    const banRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(banControlCustomId("missing", sessionId))
        .setLabel("No-Show Assistant")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(banControlCustomId("list", sessionId))
        .setLabel("Ban Intelligence")
        .setStyle(ButtonStyle.Secondary),
    );

    return {
      embeds: [embed],
      components: [row, banRow],
      allowedMentions: { parse: [] },
    };
  }

  private async buildSessionManagePanelMessage(
    context: ResolvedSessionContext,
    guild: ButtonInteraction["guild"],
  ) {
    const sessionId = context.session.id;
    const matches = await this.sessionService
      .listSessionMatchesForDiscord(sessionId)
      .catch(() => []);
    const latestMatch = [...matches].sort(
      (left, right) => (right.matchNumber ?? 0) - (left.matchNumber ?? 0),
    )[0];
    const startsAt = context.session.startsAt
      ? `<t:${Math.floor(Date.parse(context.session.startsAt) / 1000)}:F>`
      : "Not set";
    const registration = this.registrationStateSummary(context);

    const embed = new EmbedBuilder()
      .setColor(registration.open ? 0x22c55e : 0xf59e0b)
      .setTitle("Arenzyra Session Manage Panel")
      .setDescription(context.session.name)
      .addFields(
        {
          name: "Session",
          value: [
            `Status: ${context.session.status}`,
            `Registration: ${registration.label}`,
            `Start: ${startsAt}`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "Teams",
          value: [
            `Slots: ${context.session.counts.confirmedCount}/${context.session.slotCount}`,
            `Waitlist: ${context.session.counts.waitlistCount}`,
            `Total: ${context.session.counts.totalRegisteredCount}`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "Matches",
          value: latestMatch
            ? [
                `Created: ${matches.length}`,
                `Latest: #${latestMatch.matchNumber ?? "?"}`,
                `ID: ${latestMatch.id}`,
              ].join("\n")
            : "No match has been created yet.",
          inline: true,
        },
        {
          name: "Channels",
          value: [
            context.config.registrationChannelId
              ? `Registration: <#${context.config.registrationChannelId}>`
              : "Registration: not configured",
            context.config.slotListChannelId
              ? `Slots: <#${context.config.slotListChannelId}>`
              : "Slots: not configured",
            context.config.waitlistChannelId
              ? `Waitlist: <#${context.config.waitlistChannelId}>`
              : "Waitlist: not configured",
            context.config.resultsChannelId
              ? `Results: <#${context.config.resultsChannelId}>`
              : "Results: not configured",
            context.config.screenshotsChannelId
              ? `Screenshots: <#${context.config.screenshotsChannelId}>`
              : "Screenshots: not configured",
          ].join("\n"),
          inline: false,
        },
      )
      .setFooter({
        text: guild
          ? `Server: ${guild.name} | Session ID: ${sessionId}`
          : `Session ID: ${sessionId}`,
      })
      .setTimestamp(new Date());

    const registrationRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(sessionManageCustomId("refresh", sessionId))
        .setLabel("Refresh")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(sessionManageCustomId("open-registration", sessionId))
        .setLabel("Open Reg")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(sessionManageCustomId("close-registration", sessionId))
        .setLabel("Close Reg")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(sessionManageCustomId("sync-discord", sessionId))
        .setLabel("Sync Discord")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(sessionManageCustomId("waitlist", sessionId))
        .setLabel("Waitlist")
        .setStyle(ButtonStyle.Secondary),
    );
    const monitorRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(sessionManageCustomId("slots", sessionId))
        .setLabel("Slots")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(sessionManageCustomId("standings", sessionId))
        .setLabel("Standings")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(sessionManageCustomId("start-match", sessionId))
        .setLabel("Start Match")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(sessionManageCustomId("post-room", sessionId))
        .setLabel("Room Info")
        .setStyle(ButtonStyle.Primary),
    );
    const resultRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(sessionManageCustomId("map-slots", sessionId))
        .setLabel("Map Slots")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(sessionManageCustomId("preview-results", sessionId))
        .setLabel("Preview Result")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(sessionManageCustomId("apply-results", sessionId))
        .setLabel("Apply Result")
        .setStyle(ButtonStyle.Danger),
    );
    const assetsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(sessionManageCustomId("sync-logos", sessionId))
        .setLabel("Sync Logos")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(sessionManageCustomId("sync-photos", sessionId))
        .setLabel("Sync Photos")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(sessionManageCustomId("no-show", sessionId))
        .setLabel("No-Show")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(sessionManageCustomId("active-bans", sessionId))
        .setLabel("Active Bans")
        .setStyle(ButtonStyle.Secondary),
    );

    return {
      embeds: [embed],
      components: [registrationRow, monitorRow, resultRow, assetsRow],
      allowedMentions: { parse: [] },
    };
  }

  private resultControlPanelChannelId(config: SessionDiscordConfigResponse) {
    return (
      config.emojis?.resultControlPanelChannelId?.trim() ||
      config.manageChannelId?.trim() ||
      config.managerChannelId?.trim() ||
      config.screenshotsChannelId?.trim() ||
      config.resultsChannelId?.trim() ||
      null
    );
  }

  private configuredChannelId(value: string | null | undefined) {
    const trimmed = value?.trim() ?? "";
    return trimmed || null;
  }

  private finalResultPostTargetChannelId(config: SessionDiscordConfigResponse) {
    return (
      this.configuredChannelId(config.emojis?.finalResultPostChannelId) ??
      this.configuredChannelId(config.emojis?.overallResultPostChannelId) ??
      this.configuredChannelId(config.resultsChannelId)
    );
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

  private finalResultPostPayload(
    result: ApplyResultsDiscordResponse,
    opts: { replaceAttachments?: boolean } = {},
  ) {
    const payload: {
      content: string;
      files: AttachmentBuilder[];
      allowedMentions: { parse: [] };
      attachments?: [];
    } = {
      content: limitDiscordContent(result.publicContent ?? result.content),
      files: this.resultAttachments(result),
      allowedMentions: { parse: [] },
    };
    if (opts.replaceAttachments) {
      payload.attachments = [];
    }
    return payload;
  }

  private async fetchGuildTextChannel(
    guild: Guild,
    channelId: string,
  ): Promise<GuildTextBasedChannel | null> {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !("send" in channel)) {
      return null;
    }
    return channel as GuildTextBasedChannel;
  }

  private async editStoredFinalResultPost(
    guild: Guild,
    channelId: string,
    messageId: string,
    result: ApplyResultsDiscordResponse,
  ) {
    const channel = await this.fetchGuildTextChannel(guild, channelId);
    const messages = (
      channel as unknown as {
        messages?: { fetch?: (messageId: string) => Promise<unknown> };
      } | null
    )?.messages;
    if (!messages?.fetch) {
      return false;
    }

    const message = (await messages.fetch(messageId).catch(() => null)) as {
      editable?: boolean;
      edit?: (payload: unknown) => Promise<unknown>;
    } | null;
    if (!message?.edit || message.editable === false) {
      return false;
    }

    await message.edit(
      this.finalResultPostPayload(result, {
        replaceAttachments: true,
      }),
    );
    return true;
  }

  private async sendFinalResultPost(
    guild: Guild,
    channelId: string,
    result: ApplyResultsDiscordResponse,
  ) {
    const channel = await this.fetchGuildTextChannel(guild, channelId);
    if (!channel) {
      return null;
    }
    return (await channel.send(this.finalResultPostPayload(result))) as {
      id?: string | null;
    };
  }

  private latestMatchForFinalResultPost(matches: SessionMatchResponse[]) {
    return matches
      .filter((match) => match.id?.trim())
      .slice()
      .sort((left, right) => {
        const leftNumber = Number.isInteger(left.matchNumber)
          ? (left.matchNumber as number)
          : -1;
        const rightNumber = Number.isInteger(right.matchNumber)
          ? (right.matchNumber as number)
          : -1;
        if (rightNumber !== leftNumber) {
          return rightNumber - leftNumber;
        }
        const leftTime =
          Date.parse(
            left.endedAt ??
              left.updatedAt ??
              left.startedAt ??
              left.createdAt ??
              "",
          ) || 0;
        const rightTime =
          Date.parse(
            right.endedAt ??
              right.updatedAt ??
              right.startedAt ??
              right.createdAt ??
              "",
          ) || 0;
        return rightTime - leftTime;
      })[0];
  }

  private async buildFinalResultControlPost(
    context: ResolvedSessionContext,
  ): Promise<ApplyResultsDiscordResponse & { backupId?: string }> {
    const service = this.sessionService as DiscordSessionService & {
      listSessionMatchesForDiscord?: (
        sessionId: string,
      ) => Promise<SessionMatchResponse[]>;
      rebuildOverallResultBackupFromDiscord?: (
        sessionId: string,
      ) => Promise<ResultBackupDetailResponse | null>;
    };
    const liveMatches =
      typeof service.listSessionMatchesForDiscord === "function"
        ? await service
            .listSessionMatchesForDiscord(context.session.id)
            .catch((error) => {
              console.warn(
                `Final result live match lookup failed session=${context.session.id}: ${String(
                  error,
                )}`,
              );
              return [];
            })
        : [];
    const rebuiltBackup =
      typeof service.rebuildOverallResultBackupFromDiscord === "function"
        ? await service
            .rebuildOverallResultBackupFromDiscord(context.session.id)
            .catch((error) => {
              console.warn(
                `Overall result backup rebuild failed session=${context.session.id}: ${String(
                  error,
                )}`,
              );
              return null;
            })
        : null;
    const latestMatch = this.latestMatchForFinalResultPost(liveMatches);
    if (latestMatch) {
      const result = await this.sessionService.buildFinalResultPost(
        latestMatch.id,
        {
          ...context.config,
          sessionId: context.session.id,
        },
      );
      return {
        ...result,
        backupId: result.backupId ?? rebuiltBackup?.id,
      };
    }

    return this.sessionService.buildFinalResultBackupPost(context.session.id, {
      ...context.config,
      sessionId: context.session.id,
    });
  }

  private async handleFinalResultPostControl(
    interaction: ButtonInteraction,
    context: ResolvedSessionContext,
    mode: "refresh" | "repost",
  ) {
    if (!interaction.guild) {
      await interaction.editReply({
        content: "Use this result control inside the Discord server.",
        allowedMentions: { parse: [] },
      });
      return;
    }

    try {
      const result = await this.sessionService.withOrganization(
        context.config.organizationId,
        () => this.buildFinalResultControlPost(context),
      );
      const backupId = result.backupId;
      const storedChannelId = this.configuredChannelId(
        context.config.emojis?.finalResultPostChannelId,
      );
      const storedMessageId = this.configuredChannelId(
        context.config.emojis?.finalResultPostMessageId,
      );

      if (mode === "refresh" && storedChannelId && storedMessageId) {
        const edited = await this.editStoredFinalResultPost(
          interaction.guild,
          storedChannelId,
          storedMessageId,
          result,
        );
        if (edited) {
          await this.sessionService.withOrganization(
            context.config.organizationId,
            () =>
              this.sessionService.rememberFinalResultPost(
                context.session.id,
                storedChannelId,
                storedMessageId,
                backupId,
              ),
          );
          await this.sessionService
            .withOrganization(context.config.organizationId, () =>
              this.syncWinnerRoleAccessForSourceSession(
                interaction.guild,
                context.session.id,
                storedMessageId,
              ),
            )
            .catch((error) => {
              console.warn(
                `Winner access sync after final refresh failed session=${context.session.id}: ${String(
                  error,
                )}`,
              );
            });
          await interaction.editReply({
            content: `Final result post refreshed in <#${storedChannelId}>.`,
            allowedMentions: { parse: [] },
          });
          return;
        }
      }

      const targetChannelId = this.finalResultPostTargetChannelId(
        context.config,
      );
      if (!targetChannelId) {
        await interaction.editReply({
          content:
            "No final/overall result channel is configured for this session.",
          allowedMentions: { parse: [] },
        });
        return;
      }

      const sent = await this.sendFinalResultPost(
        interaction.guild,
        targetChannelId,
        result,
      );
      const messageId = sent?.id?.trim();
      if (!messageId) {
        await interaction.editReply({
          content: `Could not post final result to <#${targetChannelId}>.`,
          allowedMentions: { parse: [] },
        });
        return;
      }

      await this.sessionService.withOrganization(
        context.config.organizationId,
        () =>
          this.sessionService.rememberFinalResultPost(
            context.session.id,
            targetChannelId,
            messageId,
            backupId,
          ),
      );
      await this.sessionService
        .withOrganization(context.config.organizationId, () =>
          this.syncWinnerRoleAccessForSourceSession(
            interaction.guild,
            context.session.id,
            messageId,
          ),
        )
        .catch((error) => {
          console.warn(
            `Winner access sync after final repost failed session=${context.session.id}: ${String(
              error,
            )}`,
          );
        });
      await interaction.editReply({
        content:
          mode === "refresh"
            ? `Original final post was unavailable, so a new final result was posted in <#${targetChannelId}>.`
            : `Final result reposted in <#${targetChannelId}>.`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : "Final result post could not be refreshed.";
      await interaction.editReply({
        content: limitDiscordContent(`Final result post failed: ${message}`),
        allowedMentions: { parse: [] },
      });
    }
  }

  private async buildResultControlPanelMessage(
    context: ResolvedSessionContext,
    guild: ButtonInteraction["guild"],
  ) {
    const state = await this.sessionService.withOrganization(
      context.config.organizationId,
      () =>
        this.sessionService.getResultControlStateForDiscord(context.session.id),
    );
    const matchResultChannelId =
      context.config.emojis?.matchResultPostChannelId?.trim() ||
      context.config.resultsChannelId;
    const overallResultChannelId =
      context.config.emojis?.overallResultPostChannelId?.trim() ||
      context.config.resultsChannelId;
    const emojis = context.config.emojis ?? {};
    const finalPostChannelId = emojis.finalResultPostChannelId?.trim() || "";
    const finalPostMessageId = emojis.finalResultPostMessageId?.trim() || "";
    const noShowRuleSummary = this.noShowBanRuleSummary(context.config);
    const embed = new EmbedBuilder()
      .setColor(
        state.activeTeamBanCount || state.activeManagerBanCount
          ? 0xef4444
          : 0x2563eb,
      )
      .setTitle("Arenzyra Result Control")
      .setDescription(context.session.name)
      .addFields(
        {
          name: "Results",
          value: [
            `Matches: ${state.matchCount}`,
            `Latest: ${state.latestMatchLabel ?? "none"}`,
            matchResultChannelId
              ? `Match post: <#${matchResultChannelId}>`
              : "Match post: not configured",
            overallResultChannelId
              ? `Overall post: <#${overallResultChannelId}>`
              : "Overall post: not configured",
            finalPostChannelId && finalPostMessageId
              ? `Final post: saved in <#${finalPostChannelId}>`
              : "Final post: not saved yet",
          ].join("\n"),
          inline: true,
        },
        {
          name: "Ban Counts",
          value: [
            `Banned teams: ${state.bannedTeamCount}`,
            `Team ban records: ${state.activeTeamBanCount}`,
            `Manager ban records: ${state.activeManagerBanCount}`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "Channels",
          value: [
            context.config.screenshotsChannelId
              ? `Screenshots: <#${context.config.screenshotsChannelId}>`
              : "Screenshots: not configured",
            context.config.resultsChannelId
              ? `Results: <#${context.config.resultsChannelId}>`
              : "Results: not configured",
            context.config.bansChannelId
              ? `Bans: <#${context.config.bansChannelId}>`
              : "Bans: not configured",
          ].join("\n"),
          inline: false,
        },
        {
          name: "Text Settings",
          value: [
            `Winner rows: ${emojis.finalResultWinnerCount?.trim() || "3"}`,
            `Post template: ${emojis.finalResultPostTemplate?.trim() ? "custom" : "default"}`,
            `Message template: ${emojis.finalResultMessageTemplate?.trim() ? "custom" : "default"}`,
            `Winner row: ${emojis.finalResultWinnerRowTemplate?.trim() ? "custom" : "default"}`,
            `Rank emojis: ${emojis.finalResultRankEmojis?.trim() ? "custom" : "default"}`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "Ban Defaults",
          value: [
            `Scope: ${emojis.banDefaultScope?.trim() || "SESSION"}`,
            `Duration: ${emojis.banDefaultDurationDays?.trim() || "3"}`,
            `Server action: ${emojis.banServerAction?.trim() || "ROLE"}`,
            `No-show: ${noShowRuleSummary}`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "No-Show Rule Format",
          value: this.noShowRuleHelpText(),
          inline: false,
        },
      )
      .setFooter({
        text: guild
          ? `Server: ${guild.name} | Session ID: ${context.session.id}`
          : `Session ID: ${context.session.id}`,
      })
      .setTimestamp(new Date());

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(resultControlCustomId("match", context.session.id))
        .setLabel("Match Result")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(resultControlCustomId("overall", context.session.id))
        .setLabel("Overall Result")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(resultControlCustomId("ban", context.session.id))
        .setLabel("Ban Control")
        .setStyle(
          state.activeTeamBanCount || state.activeManagerBanCount
            ? ButtonStyle.Danger
            : ButtonStyle.Secondary,
        ),
      new ButtonBuilder()
        .setCustomId(resultControlCustomId("refresh", context.session.id))
        .setLabel("Refresh")
        .setStyle(ButtonStyle.Primary),
    );
    const settingsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(resultControlCustomId("text", context.session.id))
        .setLabel("Edit Final Text")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(resultControlCustomId("edit-results", context.session.id))
        .setLabel("Edit Results")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(resultControlCustomId("final-refresh", context.session.id))
        .setLabel("Refresh Final Post")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(resultControlCustomId("final-repost", context.session.id))
        .setLabel("Repost Final")
        .setStyle(ButtonStyle.Secondary),
    );
    const banSettingsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(resultControlCustomId("defaults", context.session.id))
        .setLabel("Ban Defaults")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(resultControlCustomId("rules", context.session.id))
        .setLabel("No-Show Rules")
        .setStyle(ButtonStyle.Secondary),
    );

    return {
      embeds: [embed],
      components: [row, settingsRow, banSettingsRow],
      allowedMentions: { parse: [] },
    };
  }

  private noShowBanRuleSummary(config: SessionDiscordConfigResponse) {
    const raw = config.emojis?.noShowBanRules?.trim();
    if (!raw) {
      return "none";
    }
    try {
      const parsed = this.parseNoShowBanRulesForSettings(config);
      if (!parsed.length) {
        return "none";
      }
      return parsed
        .slice(0, 3)
        .map((rule) => {
          const trigger =
            rule.type === "MATCH_MISSED"
              ? `G${rule.matchNumber}`
              : `${rule.misses} miss${rule.misses === 1 ? "" : "es"}`;
          const duration =
            rule.durationDays === null ? "permanent" : `${rule.durationDays}d`;
          return `${trigger}=${duration}`;
        })
        .join(", ");
    } catch {
      return "invalid JSON";
    }
  }

  private noShowRuleHelpText() {
    return [
      "Open **No-Show Rules** and enter one rule per line.",
      "`1=3d session` = one total miss, 3-day ban for this scrim.",
      "`match 2=permanent all-sessions` = missing G2, permanent Discord-wide ban.",
      "`match 2=7d session | Missed {match}` = custom reason.",
      "Scopes: `session` or `all-sessions`. Durations: `3d` or `permanent`.",
    ].join("\n");
  }

  private truncateSelectText(value: string, maxLength: number) {
    return value.length <= maxLength
      ? value
      : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
  }

  private resultControlManagerLabel(
    manager: DiscordResultControlBanTarget["managers"][number] | undefined,
  ) {
    if (!manager) {
      return "No linked manager";
    }
    return (
      manager.displayName?.trim() ||
      manager.discordUsername?.trim() ||
      `<@${manager.discordUserId}>`
    );
  }

  private resultBanTargetLabel(target: DiscordResultControlBanTarget) {
    if (target.kind === "team") {
      return target.teamTag
        ? `${target.teamName} (${target.teamTag})`
        : target.teamName;
    }
    return `Manager ${this.resultControlManagerLabel(target.managers[0])}`;
  }

  private resultBanTargetDescription(target: DiscordResultControlBanTarget) {
    const managerCount = target.managers.length;
    const recordCount =
      target.kind === "team"
        ? target.teamBanIds.length + target.managerBanIds.length
        : target.managerBanIds.length;
    const scopes = target.scopeLabels.slice(0, 2).join(", ") || "active";
    return this.truncateSelectText(
      `${managerCount} manager${managerCount === 1 ? "" : "s"} | ${recordCount} record${recordCount === 1 ? "" : "s"} | ${scopes}`,
      100,
    );
  }

  private buildResultBanSelectRow(
    sessionId: string,
    targets: DiscordResultControlBanTarget[],
    panelChannelId?: string | null,
    panelMessageId?: string | null,
  ) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(
        resultBanSelectCustomId(sessionId, panelChannelId, panelMessageId),
      )
      .setPlaceholder("Select banned team or manager")
      .addOptions(
        targets.slice(0, 25).map((target) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(
              this.truncateSelectText(this.resultBanTargetLabel(target), 100),
            )
            .setDescription(this.resultBanTargetDescription(target))
            .setValue(target.value),
        ),
      );
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
  }

  private resultBanTargetDetails(target: DiscordResultControlBanTarget) {
    const managers = target.managers.length
      ? target.managers
          .map((manager) => `- ${this.resultControlManagerLabel(manager)}`)
          .join("\n")
      : "- No linked manager";
    const teamBanCount = target.kind === "team" ? target.teamBanIds.length : 0;
    const managerBanCount = target.managerBanIds.length;
    const expiry = target.expiresAt
      ? `Earliest expiry: ${new Date(target.expiresAt).toLocaleString()}`
      : "Expiry: permanent or mixed";
    return [
      "Ban Target",
      `Target: ${this.resultBanTargetLabel(target)}`,
      `Team ban records: ${teamBanCount}`,
      `Manager ban records: ${managerBanCount}`,
      `Scope: ${target.scopeLabels.join(", ") || "active"}`,
      expiry,
      "",
      "Managers:",
      managers,
      "",
      "Unban will revoke this target's active team/manager ban records and remove configured ban roles only where no other active ban remains.",
    ].join("\n");
  }

  private buildResultTextSettingsModal(
    sessionId: string,
    config: SessionDiscordConfigResponse,
  ) {
    return this.resultControlSettingsModal(
      "Result Text Settings",
      "text",
      sessionId,
      [
        {
          customId: "post-template",
          label: "Post template",
          placeholder: "{message}",
          required: false,
          style: TextInputStyle.Paragraph,
          maxLength: 1800,
          value: config.emojis?.finalResultPostTemplate ?? "",
        },
        {
          customId: "message-template",
          label: "Message template",
          placeholder:
            "{trophy} Final Results\\n\\nChampion:\\n{top1}\\n\\nRunner-up:\\n{top2}",
          required: false,
          style: TextInputStyle.Paragraph,
          maxLength: 1800,
          value: config.emojis?.finalResultMessageTemplate ?? "",
        },
        {
          customId: "winner-row-template",
          label: "Winner row template",
          placeholder: "{rank}. {teamTag} - {points} pts ({kills} kills)",
          required: false,
          style: TextInputStyle.Paragraph,
          maxLength: 700,
          value: config.emojis?.finalResultWinnerRowTemplate ?? "",
        },
        {
          customId: "winner-count",
          label: "Winner rows count",
          placeholder: "3",
          required: false,
          maxLength: 2,
          value: config.emojis?.finalResultWinnerCount ?? "",
        },
        {
          customId: "rank-emojis",
          label: "Rank emojis",
          placeholder: "1=<:first:123>\\n2=<:second:456>\\n3=<:third:789>",
          required: false,
          style: TextInputStyle.Paragraph,
          maxLength: 1000,
          value: config.emojis?.finalResultRankEmojis ?? "",
        },
      ],
    );
  }

  private buildResultBanDefaultsSettingsModal(
    sessionId: string,
    config: SessionDiscordConfigResponse,
  ) {
    return this.resultControlSettingsModal(
      "Result Ban Defaults",
      "defaults",
      sessionId,
      [
        {
          customId: "default-scope",
          label: "Default scope",
          placeholder: "session, all-sessions, match, server",
          required: false,
          maxLength: 120,
          value: config.emojis?.banDefaultScope ?? "",
        },
        {
          customId: "duration-days",
          label: "Default duration",
          placeholder: "3 or permanent",
          required: false,
          maxLength: 20,
          value: config.emojis?.banDefaultDurationDays ?? "",
        },
        {
          customId: "default-reason",
          label: "Default reason",
          placeholder: "Manual Discord ban",
          required: false,
          style: TextInputStyle.Paragraph,
          maxLength: 300,
          value: config.emojis?.banDefaultReason ?? "",
        },
        {
          customId: "server-action",
          label: "Server action",
          placeholder: "ROLE, NONE, or DISCORD_BAN",
          required: false,
          maxLength: 20,
          value: config.emojis?.banServerAction ?? "",
        },
      ],
    );
  }

  private buildResultNoShowRulesSettingsModal(
    sessionId: string,
    config: SessionDiscordConfigResponse,
  ) {
    return this.resultControlSettingsModal(
      "No-Show Ban Rules",
      "rules",
      sessionId,
      [
        {
          customId: "total-rules",
          label: "Total missed rules",
          placeholder: "1=3d session\n2=7d session\n3=permanent all-sessions",
          required: false,
          style: TextInputStyle.Paragraph,
          maxLength: 1200,
          value: this.noShowRuleLines(config, "TOTAL_MISSES"),
        },
        {
          customId: "match-rules",
          label: "Specific match rules",
          placeholder: "match 1=3d session\nmatch 2=permanent all-sessions",
          required: false,
          style: TextInputStyle.Paragraph,
          maxLength: 1200,
          value: this.noShowRuleLines(config, "MATCH_MISSED"),
        },
        {
          customId: "default-scope",
          label: "Default scope",
          placeholder: "session or all-sessions",
          required: false,
          maxLength: 40,
          value: this.firstNoShowRuleScope(config) || "SESSION",
        },
        {
          customId: "default-reason",
          label: "Default reason template",
          placeholder: "Missed {misses} match(es) in {session}",
          required: false,
          style: TextInputStyle.Paragraph,
          maxLength: 300,
          value: this.firstNoShowRuleReason(config),
        },
      ],
    );
  }

  private resultControlSettingsModal(
    title: string,
    kind: ResultControlSettingsKind,
    sessionId: string,
    inputs: TextInputConfig[],
  ) {
    const modal = new ModalBuilder()
      .setCustomId(resultControlSettingsModalId(kind, sessionId))
      .setTitle(title);
    modal.addComponents(
      ...inputs.map((input) =>
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          (() => {
            const maxLength = input.maxLength ?? 200;
            const builder = new TextInputBuilder()
              .setCustomId(input.customId)
              .setLabel(input.label)
              .setStyle(input.style ?? TextInputStyle.Short)
              .setPlaceholder(input.placeholder ?? "")
              .setRequired(input.required ?? true)
              .setMaxLength(maxLength);
            if (input.value) {
              builder.setValue(input.value.slice(0, maxLength));
            }
            return builder;
          })(),
        ),
      ),
    );
    return modal;
  }

  private buildResultUnbanRow(token: string) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(resultBanPendingCustomId("unban", token))
        .setLabel("Unban")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(resultBanPendingCustomId("cancel", token))
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );
  }

  private buildResultUnbanModal(token: string) {
    return new ModalBuilder()
      .setCustomId(resultBanModalId(token))
      .setTitle("Confirm Unban")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("reason")
            .setLabel("Reason")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(300)
            .setPlaceholder("Optional reason"),
        ),
      );
  }

  private storePendingResultUnban(action: PendingResultUnbanAction) {
    const token = `${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    this.pendingResultUnbans.set(token, action);
    setTimeout(() => {
      this.pendingResultUnbans.delete(token);
    }, RESULT_CONTROL_UNBAN_TTL_MS).unref?.();
    return token;
  }

  private storePendingResultEdit(action: PendingResultEditAction) {
    const token = `${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    this.pendingResultEdits.set(token, action);
    setTimeout(() => {
      this.pendingResultEdits.delete(token);
    }, RESULT_CONTROL_EDIT_TTL_MS).unref?.();
    return token;
  }

  private storePendingManualResultEdit(action: PendingManualResultEditAction) {
    const token = `${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    this.pendingManualResultEdits.set(token, action);
    setTimeout(() => {
      this.pendingManualResultEdits.delete(token);
    }, RESULT_CONTROL_EDIT_TTL_MS).unref?.();
    return token;
  }

  private async refreshStoredResultControlPanel(
    guild: Guild | null | undefined,
    pending: Pick<
      PendingResultUnbanAction,
      "sessionId" | "panelChannelId" | "panelMessageId"
    >,
    organizationId?: string | null,
  ) {
    if (!guild) {
      return;
    }
    if (pending.panelChannelId && pending.panelMessageId) {
      const context = await this.sessionService.withOrganization(
        organizationId ?? null,
        () => this.sessionService.getSessionContext(pending.sessionId),
      );
      const channel = await guild.channels
        .fetch(pending.panelChannelId)
        .catch(() => null);
      if (channel && "messages" in channel) {
        const message = await (channel as GuildTextBasedChannel).messages
          .fetch(pending.panelMessageId)
          .catch(() => null);
        if (message?.editable) {
          await message
            .edit(await this.buildResultControlPanelMessage(context, guild))
            .catch(() => undefined);
          return;
        }
      }
    }
    await this.postOrUpdateResultControlPanel(guild, pending.sessionId, {
      organizationId,
    }).catch(() => undefined);
  }

  private registrationStateSummary(context: ResolvedSessionContext) {
    const emojis = context.config.emojis ?? {};
    const manualState =
      emojis.registrationScheduleOverrideState?.trim().toLowerCase() ||
      emojis.registrationManualState?.trim().toLowerCase();
    if (manualState === "open") {
      return { label: "Open", open: true };
    }
    if (manualState === "closed") {
      return { label: "Closed", open: false };
    }
    if (context.config.disableSlotAndVipRegistration) {
      return { label: "Closed", open: false };
    }

    const now = Date.now();
    const opensAt = context.session.registrationOpenAt
      ? Date.parse(context.session.registrationOpenAt)
      : null;
    const closesAt = context.session.registrationCloseAt
      ? Date.parse(context.session.registrationCloseAt)
      : null;
    if (opensAt && Number.isFinite(opensAt) && opensAt > now) {
      return {
        label: `Scheduled <t:${Math.floor(opensAt / 1000)}:R>`,
        open: false,
      };
    }
    if (closesAt && Number.isFinite(closesAt) && closesAt <= now) {
      return { label: "Closed", open: false };
    }
    if (context.session.status === "DRAFT") {
      return { label: "Draft", open: false };
    }
    return { label: "Open", open: true };
  }

  private async refreshSessionManageMessage(
    interaction: ButtonInteraction,
    sessionId: string,
  ) {
    const message = interaction.message;
    if (!message?.editable) {
      return;
    }
    const context = await this.resolveSessionContextForInteraction(
      interaction,
      sessionId,
    ).catch(() => null);
    if (!context) {
      return;
    }
    await message
      .edit(
        await this.buildSessionManagePanelMessage(context, interaction.guild),
      )
      .catch(() => undefined);
  }

  private formatHistorySyncResult(
    label: string,
    result: {
      scanned: number;
      matched: number;
      saved: number;
      pending?: number;
      backfilled?: number;
      skipped: number;
      failed: number;
      failures?: Array<{
        channelId: string;
        messageId: string;
        reason: string;
      }>;
    },
  ) {
    const lines = [
      `${CHECK} ${label} sync finished.`,
      `Scanned: ${result.scanned}`,
      `Matched: ${result.matched}`,
      `Saved: ${result.saved}`,
      ...(typeof result.pending === "number"
        ? [`Pending: ${result.pending}`]
        : []),
      ...(typeof result.backfilled === "number"
        ? [`Backfilled active teams: ${result.backfilled}`]
        : []),
      `Skipped: ${result.skipped}`,
      `Failed: ${result.failed}`,
    ];
    if (result.failures?.length) {
      lines.push(
        "",
        "Failures:",
        ...result.failures
          .slice(0, 5)
          .map(
            (failure) =>
              `- <#${failure.channelId}> ${failure.messageId}: ${failure.reason}`,
          ),
      );
      if (result.failures.length > 5) {
        lines.push(`- ${result.failures.length - 5} more failure(s) hidden`);
      }
    }
    return limitDiscordContent(lines.join("\n"));
  }

  private buildTeamsPanelMessage() {
    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle("Arenzyra Scrim Registration")
      .setDescription(
        "Use `/register team` in the registration channel. Legacy `%register` remains available during migration. This panel is only for scrim status actions.",
      )
      .addFields(
        {
          name: "Team leaders",
          value:
            "Run `/register team` with the team name, tag, and managers in the registration channel.",
        },
        {
          name: "Results",
          value:
            "Organizers review and apply match results from the staff control panel.",
        },
      )
      .setFooter({ text: "Arenzyra PUBG Production Control" })
      .setTimestamp(new Date());

    const teamRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      controlButton("join-scrim", "Join Scrim", ButtonStyle.Success),
      controlButton("leave-scrim", "Leave Scrim", ButtonStyle.Danger),
    );
    const infoRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      controlButton("list-slots", "Slots"),
      controlButton("standings", "Standings"),
    );

    return {
      embeds: [embed],
      components: [teamRow, infoRow],
      allowedMentions: { parse: [] },
    };
  }

  private buildStaffPanelMessage() {
    const embed = new EmbedBuilder()
      .setColor(0x16a34a)
      .setTitle("Arenzyra Tournament Control")
      .setDescription(
        "Organizer controls for scrim creation, slots, match starts, room posts, standings, and screenshot result workflows.",
      )
      .addFields(
        {
          name: "Scrim flow",
          value:
            "Create scrim, publish room info, start a match, then monitor slots and standings.",
        },
        {
          name: "Result flow",
          value:
            "Preview screenshot OCR first. Apply only after every row resolves correctly.",
        },
      )
      .setFooter({ text: "Arenzyra PUBG Production Control" })
      .setTimestamp(new Date());

    const scrimRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      controlButton("create-scrim", "Create Scrim", ButtonStyle.Primary),
      controlButton("configure-scrim", "Configure"),
      controlButton("setup-channels", "Setup Channels"),
      controlButton("sync-discord", "Sync Discord"),
    );
    const opsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      controlButton("start-scrim", "Start Match", ButtonStyle.Success),
      controlButton("post-room", "Post Room Info"),
      controlButton("remove-team", "Remove Team", ButtonStyle.Danger),
    );
    const monitorRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      controlButton("list-slots", "Slots"),
      controlButton("standings", "Standings"),
    );
    const resultsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      controlButton("map-slots", "Map Slots"),
      controlButton("preview-results", "Preview Results"),
      controlButton("apply-results", "Apply Results", ButtonStyle.Danger),
    );

    return {
      embeds: [embed],
      components: [scrimRow, opsRow, monitorRow, resultsRow],
      allowedMentions: { parse: [] },
    };
  }

  private buildBanControlPanelMessage(
    sessionId: string,
    sessionName: string | null | undefined,
    config?: SessionDiscordConfigResponse | null,
  ) {
    const defaultScope = (config?.emojis?.banDefaultScope ?? "SESSION").trim();
    const defaultDays = (config?.emojis?.banDefaultDurationDays ?? "3").trim();
    const serverAction = (config?.emojis?.banServerAction ?? "ROLE").trim();
    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Arenzyra Ban Control")
      .setDescription(
        "Staff controls for manager bans, no-show previews, conditional banned-team registration, active ban review, and server-level actions.",
      )
      .addFields(
        {
          name: "Session",
          value: sessionName?.trim() || sessionId,
          inline: true,
        },
        {
          name: "Defaults",
          value: `Scope: ${defaultScope || "SESSION"}\nDays: ${
            defaultDays || "permanent"
          }\nServer action: ${serverAction || "ROLE"}`,
          inline: true,
        },
      )
      .setFooter({ text: "Confirm destructive actions before they run" })
      .setTimestamp(new Date());

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(banControlCustomId("create", sessionId))
        .setLabel("Ban Manager")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(banControlCustomId("missing", sessionId))
        .setLabel("No-Show Assistant")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(banControlCustomId("conditional", sessionId))
        .setLabel("Conditional Register")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(banControlCustomId("list", sessionId))
        .setLabel("Active Bans")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(banControlCustomId("refresh", sessionId))
        .setLabel("Refresh")
        .setStyle(ButtonStyle.Secondary),
    );

    return {
      embeds: [embed],
      components: [row],
      allowedMentions: { parse: [] },
    };
  }

  private buildRegistrationControlActionRow(
    sessionId: string,
    registrationId: string,
  ) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`regctl:a:${sessionId}:${registrationId}`)
        .setLabel("Approve")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`regctl:s:${sessionId}:${registrationId}`)
        .setLabel("Set Slot")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`regctl:w:${sessionId}:${registrationId}`)
        .setLabel("Waitlist")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`regctl:v:${sessionId}:${registrationId}`)
        .setLabel("VIP")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`regctl:r:${sessionId}:${registrationId}`)
        .setLabel("Remove")
        .setStyle(ButtonStyle.Danger),
    );
  }

  private buildRegistrationSlotModal(parsed: ParsedRegistrationControlAction) {
    const modal = new ModalBuilder()
      .setCustomId(
        registrationSlotModalId(parsed.sessionId, parsed.registrationId),
      )
      .setTitle("Set Team Slot");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("slot-number")
          .setLabel("Slot number")
          .setPlaceholder("3")
          .setRequired(true)
          .setMaxLength(3)
          .setStyle(TextInputStyle.Short),
      ),
    );
    return modal;
  }

  private buildModal(action: ControlAction, sessionId?: string | null) {
    switch (action) {
      case "register-team":
        return this.modal(
          "Register Team",
          action,
          [
            ...(sessionId
              ? []
              : [
                  {
                    customId: "session-id",
                    label: "Session ID",
                    placeholder: "Leave blank to use the active scrim",
                    required: false,
                    maxLength: 80,
                  },
                ]),
            {
              customId: "tag",
              label: "Team tag",
              placeholder: "Example: ARZ",
              maxLength: 24,
            },
            {
              customId: "team-name",
              label: "Team name",
              placeholder: "Example: Arenzyra Esports",
              maxLength: 80,
            },
            {
              customId: "manager-mentions",
              label: "Manager/player mentions",
              placeholder: "@manager @player",
              required: false,
              maxLength: 300,
            },
            {
              customId: "team-logo",
              label: "Team logo URL",
              placeholder: "https://example.com/logo.png",
              required: false,
              maxLength: 1000,
            },
          ],
          sessionId,
        );
      case "join-scrim":
        return this.modal(
          "Join Scrim",
          action,
          [...(sessionId ? [] : [this.sessionIdInput()]), this.teamTagInput()],
          sessionId,
        );
      case "leave-scrim":
        return this.modal(
          "Leave Scrim",
          action,
          [...(sessionId ? [] : [this.sessionIdInput()]), this.teamTagInput()],
          sessionId,
        );
      case "list-slots":
        return this.modal(
          "List Slots",
          action,
          [this.sessionIdInput()],
          sessionId,
        );
      case "standings":
        return this.modal(
          "Standings",
          action,
          [this.sessionIdInput()],
          sessionId,
        );
      case "create-scrim":
        return this.modal(
          "Create Scrim",
          action,
          [
            {
              customId: "name",
              label: "Scrim name",
              placeholder: "Example: Arenzyra Practice Scrim",
              maxLength: 100,
            },
            {
              customId: "slots",
              label: "Slots",
              placeholder: "25",
              required: false,
              maxLength: 3,
            },
          ],
          sessionId,
        );
      case "configure-scrim":
        return this.modal(
          "Configure Scrim",
          action,
          [
            this.sessionIdInput(),
            {
              customId: "start-slot",
              label: "Start slot",
              placeholder: "3",
              maxLength: 3,
            },
            {
              customId: "normal-slots",
              label: "Normal slots",
              placeholder: "23",
              maxLength: 3,
            },
            {
              customId: "vip-slots",
              label: "VIP slots",
              placeholder: "0",
              required: false,
              maxLength: 3,
            },
            {
              customId: "manager-limits",
              label: "Managers / teams per manager",
              placeholder: "2/1",
              required: false,
              maxLength: 12,
            },
          ],
          sessionId,
        );
      case "setup-channels":
        return this.modal(
          "Setup Channels",
          action,
          [this.sessionIdInput()],
          sessionId,
        );
      case "sync-discord":
        return this.modal(
          "Sync Discord",
          action,
          [this.sessionIdInput()],
          sessionId,
        );
      case "remove-team":
        return this.modal(
          "Remove Team",
          action,
          [
            this.sessionIdInput(),
            this.teamTagInput(),
            {
              customId: "confirm-remove",
              label: "Type REMOVE to confirm",
              placeholder: "REMOVE",
              maxLength: 20,
            },
          ],
          sessionId,
        );
      case "start-scrim":
        return this.modal(
          "Start Match",
          action,
          [this.sessionIdInput()],
          sessionId,
        );
      case "post-room":
        return this.modal(
          "Post Room Info",
          action,
          [
            {
              customId: "session-id",
              label: "Session or match ID",
              required: false,
              maxLength: 80,
            },
            {
              customId: "room-id",
              label: "Room ID",
              maxLength: 80,
            },
            {
              customId: "password",
              label: "Password",
              maxLength: 80,
            },
            {
              customId: "map",
              label: "Map",
              required: false,
              placeholder: "Example: Erangel",
              maxLength: 50,
            },
            {
              customId: "starts-at",
              label: "Start time",
              required: false,
              placeholder: "Example: 21:00",
              maxLength: 50,
            },
          ],
          sessionId,
        );
      case "map-slots":
      case "preview-results":
      case "apply-results":
        return this.modal(
          action === "map-slots"
            ? "Map Slots"
            : action === "preview-results"
              ? "Preview Results"
              : "Apply Results",
          action,
          [
            {
              customId: "match-id",
              label: "Match ID",
              maxLength: 80,
            },
            {
              customId: "image-url",
              label: "Public screenshot URL",
              style: TextInputStyle.Paragraph,
              maxLength: 1000,
            },
          ],
          sessionId,
        );
    }
  }

  private modal(
    title: string,
    action: ControlAction,
    inputs: TextInputConfig[],
    sessionId?: string | null,
  ) {
    const modal = new ModalBuilder()
      .setCustomId(modalId(action, sessionId))
      .setTitle(title);
    modal.addComponents(
      ...inputs.map((input) =>
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          (() => {
            const builder = new TextInputBuilder()
              .setCustomId(input.customId)
              .setLabel(input.label)
              .setStyle(input.style ?? TextInputStyle.Short)
              .setPlaceholder(input.placeholder ?? "")
              .setRequired(input.required ?? true)
              .setMaxLength(input.maxLength ?? 200);
            if (input.value) {
              builder.setValue(input.value);
            }
            return builder;
          })(),
        ),
      ),
    );
    return modal;
  }

  private sessionIdInput(): TextInputConfig {
    return {
      customId: "session-id",
      label: "Session ID",
      maxLength: 80,
    };
  }

  private teamTagInput(): TextInputConfig {
    return {
      customId: "tag",
      label: "Team tag",
      placeholder: "Example: ARZ",
      maxLength: 24,
    };
  }

  private async executeModalAction(
    interaction: ModalSubmitInteraction,
    parsed: ParsedControlAction,
  ) {
    const { action, sessionId: boundSessionId } = parsed;
    if (action === "post-room") {
      await this.postRoomInfo(interaction, boundSessionId);
      return;
    }

    await interaction.deferReply();

    switch (action) {
      case "register-team": {
        const sessionId = await this.resolveSessionId(
          interaction,
          boundSessionId ?? optionalInputValue(interaction, "session-id"),
        );
        if (!sessionId) {
          await interaction.editReply(
            "Session ID is required. Staff can create a scrim first or you can paste the session ID in this form.",
          );
          return;
        }

        const members = await this.resolveMentionedMembers(
          interaction,
          optionalInputValue(interaction, "manager-mentions"),
        );
        const logoUrl = this.parseOptionalUrl(
          optionalInputValue(interaction, "team-logo"),
          "Team logo URL",
        );
        const leader = members[0] ?? {
          discordUserId: interaction.user.id,
          discordUsername: interaction.user.username,
          displayName: interaction.user.globalName ?? null,
        };
        const content = await this.sessionService.registerTeamAndJoinScrim(
          leader.discordUserId,
          leader.discordUsername ?? leader.discordUserId,
          leader.displayName ?? null,
          inputValue(interaction, "tag"),
          inputValue(interaction, "team-name"),
          members,
          interaction.guild,
          sessionId,
          logoUrl,
          null,
          {
            requesterDiscordId: interaction.user.id,
            audit: {
              actorDiscordId: interaction.user.id,
              actorLabel: interaction.user.tag,
              sourceChannelId: interaction.channelId ?? null,
            },
          },
        );
        await interaction.editReply(limitDiscordContent(content));
        return;
      }
      case "join-scrim": {
        const content = await this.sessionService.joinScrim(
          interaction.user.id,
          boundSessionId ?? inputValue(interaction, "session-id"),
          inputValue(interaction, "tag"),
          interaction.guild,
          {
            actorDiscordId: interaction.user.id,
            actorLabel: interaction.user.tag,
            sourceChannelId: interaction.channelId ?? null,
          },
        );
        await interaction.editReply(limitDiscordContent(content));
        return;
      }
      case "leave-scrim": {
        const content = await this.sessionService.leaveScrim(
          interaction.user.id,
          boundSessionId ?? inputValue(interaction, "session-id"),
          inputValue(interaction, "tag"),
          interaction.guild,
          {
            actorDiscordId: interaction.user.id,
            actorLabel: interaction.user.tag,
            sourceChannelId: interaction.channelId ?? null,
          },
        );
        await interaction.editReply(limitDiscordContent(content));
        return;
      }
      case "list-slots": {
        const content = await this.sessionService.listSlots(
          boundSessionId ?? inputValue(interaction, "session-id"),
          interaction.guild,
        );
        await interaction.editReply(limitDiscordContent(content));
        return;
      }
      case "standings": {
        const content = await this.sessionService.standings(
          boundSessionId ?? inputValue(interaction, "session-id"),
        );
        await interaction.editReply(limitDiscordContent(content));
        return;
      }
      case "create-scrim": {
        const slots = this.parseSlots(inputValue(interaction, "slots"));
        const content = await this.sessionService.createScrim(
          interaction.user.id,
          inputValue(interaction, "name"),
          slots,
          interaction.guild,
        );
        this.rememberActiveSession(interaction, content);
        await interaction.editReply(limitDiscordContent(content));
        return;
      }
      case "configure-scrim": {
        if (!interaction.guild) {
          await interaction.editReply("Run this control inside the server.");
          return;
        }
        const managerLimits = this.parseManagerLimits(
          optionalInputValue(interaction, "manager-limits"),
        );
        const content = await this.sessionService.configureSessionDiscord(
          interaction.guild,
          boundSessionId ?? inputValue(interaction, "session-id"),
          {
            startSlot: this.parseIntegerInput(
              inputValue(interaction, "start-slot"),
              "Start slot",
              { min: 3, max: 100 },
            ),
            normalSlots: this.parseIntegerInput(
              inputValue(interaction, "normal-slots"),
              "Normal slots",
              { min: 1, max: 100 },
            ),
            vipSlots: this.parseIntegerInput(
              optionalInputValue(interaction, "vip-slots"),
              "VIP slots",
              { min: 0, max: 50, required: false },
            ),
            ...managerLimits,
          },
        );
        await interaction.editReply(limitDiscordContent(content));
        return;
      }
      case "setup-channels": {
        if (!interaction.guild) {
          await interaction.editReply("Run this control inside the server.");
          return;
        }
        const content = await this.sessionService.ensureDiscordScrimSetup(
          interaction.guild,
          boundSessionId ?? inputValue(interaction, "session-id"),
        );
        await interaction.editReply(limitDiscordContent(content));
        return;
      }
      case "sync-discord": {
        if (!interaction.guild) {
          await interaction.editReply("Run this control inside the server.");
          return;
        }
        const setup = await this.sessionService.syncDiscordScrimState(
          interaction.guild,
          boundSessionId ?? inputValue(interaction, "session-id"),
        );
        await interaction.editReply(
          [
            `${CHECK} Discord roles and slot/waitlist messages synced.`,
            "",
            `Slot List: <#${setup.slotListChannelId}>`,
            `Waitlist: <#${setup.waitlistChannelId}>`,
            `IDP: <#${setup.idpChannelId}>`,
          ].join("\n"),
        );
        return;
      }
      case "remove-team": {
        if (
          optionalInputValue(interaction, "confirm-remove").toUpperCase() !==
          "REMOVE"
        ) {
          await interaction.editReply(
            "Team removal cancelled. Type REMOVE to confirm.",
          );
          return;
        }
        const content = await this.sessionService.removeTeamFromScrim(
          boundSessionId ?? inputValue(interaction, "session-id"),
          inputValue(interaction, "tag"),
          interaction.guild,
          {
            actorDiscordId: interaction.user.id,
            actorLabel: interaction.user.tag,
            sourceChannelId: interaction.channelId ?? null,
          },
        );
        await interaction.editReply(limitDiscordContent(content));
        return;
      }
      case "start-scrim": {
        const content = await this.sessionService.startScrim(
          interaction.user.id,
          boundSessionId ?? inputValue(interaction, "session-id"),
          { allowOrganizerOverride: true },
        );
        await interaction.editReply(limitDiscordContent(content));
        return;
      }
      case "preview-results": {
        const content = await this.sessionService.previewResults(
          inputValue(interaction, "match-id"),
          inputValue(interaction, "image-url"),
        );
        await interaction.editReply(limitDiscordContent(content));
        return;
      }
      case "map-slots": {
        const content = await this.sessionService.mapSlotsForResults(
          inputValue(interaction, "match-id"),
          inputValue(interaction, "image-url"),
        );
        await interaction.editReply(limitDiscordContent(content));
        return;
      }
      case "apply-results": {
        const result = await this.sessionService.applyResults(
          inputValue(interaction, "match-id"),
          inputValue(interaction, "image-url"),
        );
        const files = result.imageFiles?.length
          ? result.imageFiles.map(
              (file) => new AttachmentBuilder(file.buffer, { name: file.name }),
            )
          : result.imageBuffer
            ? [
                new AttachmentBuilder(result.imageBuffer, {
                  name: "result.png",
                }),
              ]
            : [];
        await interaction.editReply({
          content: limitDiscordContent(result.content),
          files,
        });
        return;
      }
    }
  }

  private async postRoomInfo(
    interaction: ModalSubmitInteraction,
    boundSessionId: string | null,
  ) {
    await interaction.deferReply();
    const sessionId = boundSessionId ?? inputValue(interaction, "session-id");
    const roomId = inputValue(interaction, "room-id");
    const password = inputValue(interaction, "password");
    const map = inputValue(interaction, "map");
    const startsAt = inputValue(interaction, "starts-at");

    const embed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle("Arenzyra Room Information")
      .addFields(
        ...(sessionId
          ? [{ name: "Session / Match", value: sessionId, inline: false }]
          : []),
        { name: "Room ID", value: roomId, inline: true },
        { name: "Password", value: password, inline: true },
        ...(map ? [{ name: "Map", value: map, inline: true }] : []),
        ...(startsAt
          ? [{ name: "Start Time", value: startsAt, inline: true }]
          : []),
      )
      .setFooter({ text: "Arenzyra Tournament Operations" })
      .setTimestamp(new Date());

    if (sessionId && interaction.guild) {
      const content = await this.sessionService.postIdpToDiscord(
        interaction.guild,
        sessionId,
        embed,
      );
      await interaction.editReply(content);
      return;
    }

    await interaction.editReply({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  }

  private extractDiscordUserIds(value: string): string[] {
    const matches = value.matchAll(/<@!?(\d{15,25})>|\b(\d{15,25})\b/g);
    return [
      ...new Set(
        Array.from(matches)
          .map((match) => match[1] ?? match[2])
          .filter((id): id is string => Boolean(id)),
      ),
    ];
  }

  private async resolveMentionedMembers(
    interaction: ModalSubmitInteraction,
    value: string,
  ): Promise<DiscordRegistrationMemberInput[]> {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    const discordUserIds = this.extractDiscordUserIds(trimmed);
    if (discordUserIds.length === 0) {
      throw new Error(
        "Mention managers/players with @name so the bot can read their Discord IDs.",
      );
    }
    if (discordUserIds.length > 10) {
      throw new Error("Add up to 10 manager/player mentions.");
    }

    const members: DiscordRegistrationMemberInput[] = [];
    for (const discordUserId of discordUserIds) {
      const guildMember = interaction.guild
        ? await interaction.guild.members.fetch(discordUserId).catch(() => null)
        : null;
      members.push({
        discordUserId,
        discordUsername: guildMember?.user.username ?? null,
        displayName:
          guildMember?.displayName ?? guildMember?.user.globalName ?? null,
      });
    }
    return members;
  }

  private parseOptionalUrl(value: string, label: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error(`${label} must be a valid http or https URL.`);
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`${label} must be a valid http or https URL.`);
    }

    return trimmed;
  }

  private parseSlots(value: string): number | undefined {
    if (!value) {
      return undefined;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      throw new Error("Slots must be a number from 1 to 100.");
    }
    return parsed;
  }

  private parseIntegerInput(
    value: string,
    label: string,
    opts: { min: number; max: number; required?: boolean },
  ): number | undefined {
    if (!value.trim()) {
      if (opts.required === false) {
        return undefined;
      }
      throw new Error(`${label} is required.`);
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < opts.min || parsed > opts.max) {
      throw new Error(
        `${label} must be a number from ${opts.min} to ${opts.max}.`,
      );
    }
    return parsed;
  }

  private parseManagerLimits(value: string) {
    if (!value.trim()) {
      return {};
    }

    const [managerLimit, teamLimit] = value
      .split(/[\/,\s]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);

    return {
      maxManagersPerTeam: this.parseIntegerInput(
        managerLimit ?? "",
        "Max managers",
        {
          min: 1,
          max: 10,
        },
      ),
      maxTeamsPerManager: this.parseIntegerInput(
        teamLimit ?? "",
        "Max teams per manager",
        {
          min: 1,
          max: 10,
        },
      ),
    };
  }

  private rememberActiveSession(
    interaction: ModalSubmitInteraction,
    content: string,
  ) {
    const guildId = interaction.guildId;
    const match = /^ID:\s*(\S+)/m.exec(content);
    if (guildId && match?.[1]) {
      this.activeSessionByGuildId.set(guildId, match[1]);
    }
  }

  private parseEventDate(value: string | null | undefined): Date | null {
    const trimmed = value?.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = new Date(trimmed);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  private async resolveSessionContextForInteraction(
    interaction: PanelInteraction,
    submittedSessionId: string | null | undefined,
  ): Promise<ResolvedSessionContext | null> {
    const sessionId = submittedSessionId?.trim();
    if (sessionId) {
      return this.resolveSubmittedSessionContextForInteraction(
        interaction,
        sessionId,
      );
    }

    if (interaction.guild && interaction.channelId) {
      const resolved = await this.sessionService
        .findScrimForDiscordChannel(interaction.guild.id, interaction.channelId)
        .catch(() => null);
      if (resolved) {
        this.activeSessionByGuildId.set(
          interaction.guild.id,
          resolved.session.id,
        );
        return { session: resolved.session, config: resolved.config };
      }
    }

    if (interaction.guildId) {
      const activeSessionId = this.activeSessionByGuildId.get(
        interaction.guildId,
      );
      if (activeSessionId) {
        return this.resolveSubmittedSessionContextForInteraction(
          interaction,
          activeSessionId,
        );
      }
    }

    if (interaction.guildId) {
      const latestGuildScrim = await this.sessionService.findLatestGuildScrim(
        interaction.guildId,
      );
      if (latestGuildScrim) {
        this.activeSessionByGuildId.set(
          interaction.guildId,
          latestGuildScrim.session.id,
        );
        return latestGuildScrim;
      }
    }

    const latestScrim = await this.sessionService.findLatestAcceptingScrim();
    if (!latestScrim) {
      return null;
    }
    if (interaction.guildId) {
      this.activeSessionByGuildId.set(interaction.guildId, latestScrim.id);
    }
    return this.sessionService.getSessionContext(latestScrim.id);
  }

  private async resolveSessionId(
    interaction: ModalSubmitInteraction,
    submittedSessionId: string,
  ): Promise<string | null> {
    if (submittedSessionId) {
      return submittedSessionId;
    }
    if (interaction.guildId) {
      const activeSessionId = this.activeSessionByGuildId.get(
        interaction.guildId,
      );
      if (activeSessionId) {
        return activeSessionId;
      }
    }

    const latestScrim = await this.sessionService.findLatestAcceptingScrim();
    if (latestScrim && interaction.guildId) {
      this.activeSessionByGuildId.set(interaction.guildId, latestScrim.id);
    }

    return latestScrim?.id ?? null;
  }

  private async canUseStaffControls(
    interaction: PanelInteraction,
    sessionId?: string | null,
  ) {
    if (!interaction.inGuild()) {
      return false;
    }

    const member = await interaction.guild!.members.fetch(interaction.user.id);
    if (this.isStaffMember(member)) {
      return true;
    }

    const resolvedSessionId =
      sessionId ?? this.activeSessionByGuildId.get(interaction.guildId) ?? null;
    const checkStaffAccess = () =>
      this.sessionService.userHasStaffAccess(
        interaction.user.id,
        interaction.guild,
        resolvedSessionId,
      );
    if (!resolvedSessionId) {
      return checkStaffAccess();
    }
    return this.withInteractionOrganization(
      interaction,
      resolvedSessionId,
      checkStaffAccess,
    ).catch(() => false);
  }

  private isStaffMember(member: GuildMember) {
    if (
      member.permissions.has(PermissionFlagsBits.ManageGuild) ||
      member.permissions.has(PermissionFlagsBits.ManageChannels)
    ) {
      return true;
    }

    return STAFF_ROLE_NAMES.some((roleName) =>
      member.roles.cache.some((role) => role.name === roleName),
    );
  }
}
