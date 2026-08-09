import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  MessageContextMenuCommandInteraction,
} from "discord.js";
import type { ControlPanelService } from "./services/control-panel.service";
import type { DiscordIdpBroadcastService } from "./services/idp-broadcast.service";
import type { DiscordIdpScheduleService } from "./services/idp-schedule.service";
import type { DiscordMediaInteractionService } from "./services/media-interaction.service";
import type { MessageRegistrationService } from "./services/message-registration.service";
import type { DiscordSessionService } from "./services/session.service";
import type { StaffTaskService } from "./services/staff-task.service";
import type { TicketService } from "./services/ticket.service";

export type CommandServices = {
  sessionService: DiscordSessionService;
  ticketService: TicketService;
  controlPanelService: ControlPanelService;
  messageRegistrationService: MessageRegistrationService;
  idpBroadcastService: DiscordIdpBroadcastService;
  mediaInteractionService: DiscordMediaInteractionService;
  staffTaskService: StaffTaskService;
  idpScheduleService: DiscordIdpScheduleService;
};

export type SlashCommand = {
  data: {
    name: string;
    toJSON(): object;
  };
  autocomplete?(
    interaction: AutocompleteInteraction,
    services: CommandServices,
  ): Promise<void>;
  execute(
    interaction: ChatInputCommandInteraction,
    services: CommandServices,
  ): Promise<void>;
};

export type MessageContextMenuCommand = {
  data: {
    name: string;
    toJSON(): object;
  };
  execute(
    interaction: MessageContextMenuCommandInteraction,
    services: CommandServices,
  ): Promise<void>;
};

export type CommandAuthorizationPolicy =
  | "staff"
  | "self-service"
  | "contextual";

export type CommandPolicyInteraction =
  | ChatInputCommandInteraction
  | MessageContextMenuCommandInteraction
  | AutocompleteInteraction;

export type CommandAuthorizationMetadata = Readonly<{
  policy: CommandAuthorizationPolicy;
  sessionIdOption?: string;
  inferSessionFromConfiguredChannel?: boolean;
  channelOption?: string;
  allowedWhilePaused: (interaction: CommandPolicyInteraction) => boolean;
}>;

export type SlashCommandRegistration = Readonly<{
  kind: "chat-input";
  command: SlashCommand;
  authorization: CommandAuthorizationMetadata;
}>;

export type MessageContextMenuCommandRegistration = Readonly<{
  kind: "message";
  command: MessageContextMenuCommand;
  authorization: CommandAuthorizationMetadata;
}>;

export type ApplicationCommandRegistration =
  | SlashCommandRegistration
  | MessageContextMenuCommandRegistration;

export function isCommandAuthorizationPolicy(
  value: unknown,
): value is CommandAuthorizationPolicy {
  return value === "staff" || value === "self-service" || value === "contextual";
}
