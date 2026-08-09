import type {
  CommandAuthorizationMetadata,
  CommandAuthorizationPolicy,
  CommandPolicyInteraction,
  MessageContextMenuCommand,
  MessageContextMenuCommandRegistration,
  SlashCommand,
  SlashCommandRegistration,
} from "./command-contract";
import type { ChatInputCommandInteraction } from "discord.js";
import { applyResultsCommand } from "./commands/applyResults";
import { arenzyraDoctorCommand } from "./commands/arenzyraDoctor";
import { banControlCommand } from "./commands/banControl";
import { captainPanelCommand } from "./commands/captainPanel";
import { changeNameCommand } from "./commands/changeName";
import { contextBanManagerCommand } from "./commands/contextBanManager";
import { controlPanelCommand } from "./commands/controlPanel";
import { createScrimCommand } from "./commands/createScrim";
import { idpBroadcastCommand } from "./commands/idpBroadcast";
import { idpCommand } from "./commands/idp";
import { joinScrimCommand } from "./commands/joinScrim";
import { leaveScrimCommand } from "./commands/leaveScrim";
import { listSlotsCommand } from "./commands/listSlots";
import { liveCenterCommand } from "./commands/liveCenter";
import { mapSlotsCommand } from "./commands/mapSlots";
import { playButtonsCommand } from "./commands/playButtons";
import { previewResultsCommand } from "./commands/previewResults";
import { productionPinsCommand } from "./commands/productionPins";
import { productionSetupCommand } from "./commands/productionSetup";
import { registerCommand } from "./commands/register";
import { registerTeamCommand } from "./commands/registerTeam";
import { resultControlCommand } from "./commands/resultControl";
import { scheduleEventCommand } from "./commands/scheduleEvent";
import { sessionAdminCommand } from "./commands/sessionAdmin";
import { sessionAuditCommand } from "./commands/sessionAudit";
import { slotCommand } from "./commands/slot";
import { staffTasksCommand } from "./commands/staffTasks";
import { standingsCommand } from "./commands/standings";
import { startScrimCommand } from "./commands/startScrim";
import { ticketCloseCommand } from "./commands/ticketClose";
import { ticketOpenCommand } from "./commands/ticketOpen";
import { ticketPanelCommand } from "./commands/ticketPanel";
import { teamManagerCommand } from "./commands/teamManager";
import { teamMediaCommand } from "./commands/teamMedia";
import { waitlistControlCommand } from "./commands/waitlistControl";

const neverAllowedWhilePaused = (_interaction: CommandPolicyInteraction) =>
  false;

type AuthorizationOptions = Readonly<{
  sessionIdOption?: string;
  inferSessionFromConfiguredChannel?: boolean;
  channelOption?: string;
  allowedWhilePaused?: (interaction: CommandPolicyInteraction) => boolean;
}>;

function authorization(
  policy: CommandAuthorizationPolicy,
  options: AuthorizationOptions = {},
): CommandAuthorizationMetadata {
  return Object.freeze({
    policy,
    ...(options.sessionIdOption
      ? { sessionIdOption: options.sessionIdOption }
      : {}),
    ...(options.inferSessionFromConfiguredChannel
      ? { inferSessionFromConfiguredChannel: true }
      : {}),
    ...(options.channelOption ? { channelOption: options.channelOption } : {}),
    allowedWhilePaused:
      options.allowedWhilePaused ?? neverAllowedWhilePaused,
  });
}

function slash(
  command: SlashCommand,
  policy: CommandAuthorizationPolicy,
  options: AuthorizationOptions = {},
): SlashCommandRegistration {
  return Object.freeze({
    kind: "chat-input",
    command,
    authorization: authorization(policy, options),
  });
}

function message(
  command: MessageContextMenuCommand,
  policy: CommandAuthorizationPolicy,
  options: AuthorizationOptions = {},
): MessageContextMenuCommandRegistration {
  return Object.freeze({
    kind: "message",
    command,
    authorization: authorization(policy, options),
  });
}

function resumesCurrentPausedChannel(interaction: CommandPolicyInteraction) {
  try {
    const commandInteraction = interaction as ChatInputCommandInteraction;
    if (
      commandInteraction.options.getSubcommand(false) !== "channel-state" ||
      commandInteraction.options.getString("state") !== "active"
    ) {
      return false;
    }
    const targetChannel = commandInteraction.options.getChannel("channel");
    return !targetChannel || targetChannel.id === commandInteraction.channelId;
  } catch {
    return false;
  }
}

export const slashCommandRegistry = Object.freeze([
  slash(createScrimCommand, "staff"),
  slash(registerCommand, "contextual"),
  slash(registerTeamCommand, "contextual", {
    sessionIdOption: "session-id",
  }),
  slash(joinScrimCommand, "contextual", { sessionIdOption: "session-id" }),
  slash(leaveScrimCommand, "contextual", { sessionIdOption: "session-id" }),
  slash(listSlotsCommand, "self-service", {
    sessionIdOption: "session-id",
  }),
  slash(changeNameCommand, "staff"),
  slash(startScrimCommand, "staff", { sessionIdOption: "session-id" }),
  slash(standingsCommand, "self-service", {
    sessionIdOption: "session-id",
  }),
  slash(mapSlotsCommand, "staff"),
  slash(previewResultsCommand, "staff"),
  slash(applyResultsCommand, "staff"),
  slash(ticketOpenCommand, "self-service"),
  slash(ticketCloseCommand, "contextual"),
  slash(ticketPanelCommand, "staff"),
  slash(controlPanelCommand, "staff", { sessionIdOption: "session-id" }),
  slash(banControlCommand, "staff"),
  slash(resultControlCommand, "staff", { sessionIdOption: "session-id" }),
  slash(playButtonsCommand, "staff"),
  slash(waitlistControlCommand, "staff"),
  slash(arenzyraDoctorCommand, "staff", {
    sessionIdOption: "session-id",
  }),
  slash(scheduleEventCommand, "staff", { sessionIdOption: "session-id" }),
  slash(captainPanelCommand, "staff", { sessionIdOption: "session-id" }),
  slash(liveCenterCommand, "staff", { sessionIdOption: "session-id" }),
  slash(sessionAuditCommand, "staff", { sessionIdOption: "session-id" }),
  slash(sessionAdminCommand, "staff", {
    sessionIdOption: "session-id",
    inferSessionFromConfiguredChannel: true,
    channelOption: "channel",
    allowedWhilePaused: resumesCurrentPausedChannel,
  }),
  slash(teamManagerCommand, "contextual", {
    sessionIdOption: "session-id",
  }),
  slash(slotCommand, "self-service"),
  slash(teamMediaCommand, "contextual"),
  slash(idpBroadcastCommand, "staff", {
    inferSessionFromConfiguredChannel: true,
  }),
  slash(productionSetupCommand, "staff"),
  slash(productionPinsCommand, "staff"),
  slash(staffTasksCommand, "staff"),
  slash(idpCommand, "staff"),
] satisfies readonly SlashCommandRegistration[]);

export const messageContextCommandRegistry = Object.freeze([
  message(contextBanManagerCommand, "staff"),
] satisfies readonly MessageContextMenuCommandRegistration[]);

export const applicationCommandRegistry = Object.freeze([
  ...slashCommandRegistry,
  ...messageContextCommandRegistry,
]);

const slashCommandsByName = new Map(
  slashCommandRegistry.map((registration) => [
    registration.command.data.name,
    registration,
  ]),
);
const messageContextCommandsByName = new Map(
  messageContextCommandRegistry.map((registration) => [
    registration.command.data.name,
    registration,
  ]),
);
const applicationCommandsByNormalizedName = new Map(
  applicationCommandRegistry.map((registration) => [
    registration.command.data.name.trim().toLowerCase(),
    registration,
  ]),
);

export function findSlashCommandRegistration(commandName: string) {
  return slashCommandsByName.get(commandName);
}

export function findMessageContextCommandRegistration(commandName: string) {
  return messageContextCommandsByName.get(commandName);
}

export function findApplicationCommandRegistration(commandName: string) {
  return applicationCommandsByNormalizedName.get(
    String(commandName || "").trim().toLowerCase(),
  );
}
