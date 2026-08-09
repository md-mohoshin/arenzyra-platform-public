import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type MessageContextMenuCommandInteraction,
  type Message,
  type PartialMessage,
  type MessageReaction,
  type ModalSubmitInteraction,
  type PartialMessageReaction,
  type PartialUser,
  type StringSelectMenuInteraction,
  type User,
} from "discord.js";
import { botConfig } from "./config";
import {
  isCommandAuthorizationPolicy,
  type ApplicationCommandRegistration,
  type CommandPolicyInteraction,
  type CommandServices,
} from "./command-contract";
import {
  applicationCommandRegistry,
  findMessageContextCommandRegistration,
  findSlashCommandRegistration,
} from "./command-registry";
import { DiscordSessionService } from "./services/session.service";
import { TicketService } from "./services/ticket.service";
import { ControlPanelService } from "./services/control-panel.service";
import { MessageRegistrationService } from "./services/message-registration.service";
import { OfficialPricingPromoService } from "./services/official-pricing-promo.service";
import { DiscordOnboardingService } from "./services/onboarding.service";
import { toFriendlyApiError } from "./api/api-client";
import { GatewayHealthMarker } from "./gateway-health";
import { StaffTaskService } from "./services/staff-task.service";
import { DiscordIdpBroadcastService } from "./services/idp-broadcast.service";
import { DiscordIdpScheduleService } from "./services/idp-schedule.service";
import { DiscordMediaInteractionService } from "./services/media-interaction.service";
import { DiscordScheduledMessageService } from "./services/discord-scheduled-message.service";
import {
  componentAuthorizationPolicy,
  componentAuthorizationSessionId,
  interactionIsPausedFailClosed,
  resolveCommandAuthorizationSession,
} from "./command-authorization";

type ReplyableInteraction =
  | ChatInputCommandInteraction
  | MessageContextMenuCommandInteraction
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ModalSubmitInteraction;

type PauseAwareInteraction = ReplyableInteraction | AutocompleteInteraction;

function userFacingError(error: unknown) {
  const message = toFriendlyApiError(error).trim();
  return message || "Unexpected Discord bot error";
}
const SLASH_COMMAND_REGISTRATION_TIMEOUT_MS = 20_000;

const sessionService = new DiscordSessionService();
const ticketService = new TicketService();
const controlPanelService = new ControlPanelService(sessionService);
const messageRegistrationService = new MessageRegistrationService(
  sessionService,
  controlPanelService,
);
const officialPricingPromoService = new OfficialPricingPromoService();
const onboardingService = new DiscordOnboardingService();
const staffTaskService = new StaffTaskService();
const idpScheduleService = new DiscordIdpScheduleService();
const idpBroadcastService = new DiscordIdpBroadcastService(sessionService);
const mediaInteractionService = new DiscordMediaInteractionService(
  sessionService,
);
const scheduledMessageService = new DiscordScheduledMessageService();
const commandServices: CommandServices = {
  sessionService,
  ticketService,
  controlPanelService,
  messageRegistrationService,
  idpBroadcastService,
  mediaInteractionService,
  staffTaskService,
  idpScheduleService,
};
const gatewayHealthMarker = new GatewayHealthMarker();
const DISCORD_LOGIN_TIMEOUT_MS = 30_000;
const DISCORD_LOGIN_RETRY_MS = 10_000;
const INTERACTION_PAUSE_LOOKUP_TIMEOUT_MS = 750;
let gatewayClient: Client | null = null;
let shutdownPromise: Promise<void> | null = null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
) {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function isIgnoredInteractionResponseError(error: unknown) {
  const code = (error as { code?: unknown })?.code;
  return code === 10062 || code === 40060;
}

async function safeInteractionErrorReply(
  interaction: ReplyableInteraction,
  message: string,
) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message);
      return;
    }

    await interaction.reply({
      content: message,
      ephemeral: true,
    });
  } catch (replyError) {
    if (isIgnoredInteractionResponseError(replyError)) {
      console.warn(
        `Skipped expired interaction error response for ${interaction.id}: ${String(
          replyError,
        )}`,
      );
      return;
    }

    console.warn("Failed to send interaction error response:", replyError);
  }
}

async function safeEphemeralReply(
  interaction: ReplyableInteraction,
  content: string,
) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(content);
      return;
    }
    await interaction.reply({ content, ephemeral: true });
  } catch (replyError) {
    if (isIgnoredInteractionResponseError(replyError)) {
      console.warn(
        `Skipped expired interaction response for ${interaction.id}: ${String(
          replyError,
        )}`,
      );
      return;
    }
    throw replyError;
  }
}

function isStalePlayButtonError(error: unknown) {
  return userFacingError(error).toLowerCase().includes("session not found");
}

async function disableStalePlayButtonMessage(interaction: ButtonInteraction) {
  const message = interaction.message as Message;
  if (!message.editable) {
    return;
  }

  await message.edit({ components: [] }).catch((error) => {
    console.warn(
      `Failed to disable stale play button message ${message.id}: ${String(
        error,
      )}`,
    );
  });
}

async function isInteractionChannelPaused(interaction: PauseAwareInteraction) {
  return interactionIsPausedFailClosed(
    () =>
      withTimeout(
        sessionService.isDiscordChannelPaused(
          interaction.guildId,
          interaction.channelId,
        ),
        INTERACTION_PAUSE_LOOKUP_TIMEOUT_MS,
        "Discord interaction pause lookup",
      ),
    (error) => {
      console.warn(
        `Discord interaction pause lookup failed closed guild=${interaction.guildId ?? "unknown"} channel=${interaction.channelId ?? "unknown"}: ${String(error)}`,
      );
    },
  );
}

function hasClassifiedCommandAuthorization(
  registration: ApplicationCommandRegistration,
) {
  return (
    isCommandAuthorizationPolicy(registration.authorization.policy) &&
    typeof registration.authorization.allowedWhilePaused === "function"
  );
}

function isCommandAllowedWhilePaused(
  registration: ApplicationCommandRegistration,
  interaction: CommandPolicyInteraction,
) {
  return registration.authorization.allowedWhilePaused(interaction) === true;
}

async function registerSlashCommands() {
  const rest = new REST({ version: "10" }).setToken(botConfig.discordToken);
  const body = applicationCommandRegistry.map((registration) =>
    registration.command.data.toJSON(),
  );

  if (botConfig.discordGuildId) {
    await rest.put(
      Routes.applicationGuildCommands(
        botConfig.discordClientId,
        botConfig.discordGuildId,
      ),
      { body },
    );
    console.log(
      `Registered ${applicationCommandRegistry.length} guild application commands for guild ${botConfig.discordGuildId}.`,
    );
  }

  if (botConfig.registerGlobalCommands || !botConfig.discordGuildId) {
    await rest.put(Routes.applicationCommands(botConfig.discordClientId), {
      body,
    });
    console.log(
      `Registered ${applicationCommandRegistry.length} global application commands.`,
    );
  }
}

async function handleCommand(interaction: ChatInputCommandInteraction) {
  const registration = findSlashCommandRegistration(interaction.commandName);
  if (!registration || !hasClassifiedCommandAuthorization(registration)) {
    await safeEphemeralReply(
      interaction,
      "This command is unknown or no longer supported.",
    );
    return;
  }

  if (
    !isCommandAllowedWhilePaused(registration, interaction) &&
    (await isInteractionChannelPaused(interaction))
  ) {
    await safeEphemeralReply(
      interaction,
      "Arenzyra bot is paused in this channel. Ask staff to use `/session-admin channel-state` with state `Active` here (legacy `%start` also works).",
    );
    return;
  }

  if (registration.authorization.policy === "staff") {
    const sessionResolution = await resolveCommandAuthorizationSession(
      registration,
      interaction,
      (guildId, channelId, topic) =>
        withTimeout(
          sessionService.findConfiguredScrimForDiscordChannel(
            guildId,
            channelId,
            topic,
          ),
          INTERACTION_PAUSE_LOOKUP_TIMEOUT_MS,
          "Discord command session lookup",
        ),
    );
    if (!sessionResolution.allowed) {
      if (sessionResolution.error) {
        console.warn(
          `Discord command session lookup failed closed guild=${interaction.guildId ?? "unknown"} channel=${interaction.channelId ?? "unknown"}: ${String(sessionResolution.error)}`,
        );
      }
      await safeEphemeralReply(interaction, sessionResolution.reason);
      return;
    }
    const authorization = await sessionService.authorizeStaffCommand(
      interaction.user.id,
      interaction.guild,
      sessionResolution.sessionId,
    );
    if (!authorization.allowed) {
      await safeEphemeralReply(
        interaction,
        authorization.reason || "Only Arenzyra staff can use this command.",
      );
      return;
    }
  }

  try {
    await registration.command.execute(interaction, commandServices);
  } catch (error) {
    const message = userFacingError(error);
    console.error(`Command ${interaction.commandName} failed:`, error);

    await safeInteractionErrorReply(interaction, message);
  }
}

async function handleAutocomplete(interaction: AutocompleteInteraction) {
  const registration = findSlashCommandRegistration(interaction.commandName);
  if (!registration || !hasClassifiedCommandAuthorization(registration)) {
    await interaction.respond([]).catch(() => undefined);
    return;
  }
  const autocomplete = registration.command.autocomplete;
  if (!autocomplete) {
    await interaction.respond([]).catch(() => undefined);
    return;
  }

  if (
    !isCommandAllowedWhilePaused(registration, interaction) &&
    (await isInteractionChannelPaused(interaction))
  ) {
    await interaction.respond([]).catch(() => undefined);
    return;
  }

  if (registration.authorization.policy === "staff") {
    const sessionResolution = await resolveCommandAuthorizationSession(
      registration,
      interaction,
      (guildId, channelId, topic) =>
        withTimeout(
          sessionService.findConfiguredScrimForDiscordChannel(
            guildId,
            channelId,
            topic,
          ),
          INTERACTION_PAUSE_LOOKUP_TIMEOUT_MS,
          "Discord command session lookup",
        ),
    );
    if (!sessionResolution.allowed) {
      await interaction.respond([]).catch(() => undefined);
      return;
    }
    const authorization = await sessionService.authorizeStaffCommand(
      interaction.user.id,
      interaction.guild,
      sessionResolution.sessionId,
    );
    if (!authorization.allowed) {
      await interaction.respond([]).catch(() => undefined);
      return;
    }
  }

  try {
    await autocomplete(interaction, commandServices);
  } catch (error) {
    console.error(`Autocomplete ${interaction.commandName} failed:`, error);
    await interaction.respond([]).catch(() => undefined);
  }
}

async function handleMessageContextCommand(
  interaction: MessageContextMenuCommandInteraction,
) {
  const registration = findMessageContextCommandRegistration(
    interaction.commandName,
  );
  if (!registration || !hasClassifiedCommandAuthorization(registration)) {
    await safeEphemeralReply(
      interaction,
      "This context action is unknown or no longer supported.",
    );
    return;
  }

  if (
    !isCommandAllowedWhilePaused(registration, interaction) &&
    (await isInteractionChannelPaused(interaction))
  ) {
    await safeEphemeralReply(
      interaction,
      "Arenzyra bot is paused in this channel. Ask staff to use `/session-admin channel-state` with state `Active` here (legacy `%start` also works).",
    );
    return;
  }

  if (registration.authorization.policy === "staff") {
    const authorization = await sessionService.authorizeStaffCommand(
      interaction.user.id,
      interaction.guild,
    );
    if (!authorization.allowed) {
      await safeEphemeralReply(
        interaction,
        authorization.reason || "Only Arenzyra staff can use this action.",
      );
      return;
    }
  }

  try {
    await registration.command.execute(interaction, commandServices);
  } catch (error) {
    const message = userFacingError(error);
    console.error(`Context action ${interaction.commandName} failed:`, error);

    await safeInteractionErrorReply(interaction, message);
  }
}

async function authorizeSensitiveComponent(
  interaction:
    | ButtonInteraction
    | StringSelectMenuInteraction
    | ModalSubmitInteraction,
) {
  const policy = componentAuthorizationPolicy(interaction.customId);
  if (policy === "self-service") return true;
  if (policy === "unclassified") {
    await safeEphemeralReply(
      interaction,
      "This interaction is unknown or no longer supported.",
    );
    return false;
  }

  const authorization = await sessionService.authorizeStaffCommand(
    interaction.user.id,
    interaction.guild,
    componentAuthorizationSessionId(interaction.customId),
  );
  if (authorization.allowed) return true;

  await safeEphemeralReply(
    interaction,
    authorization.reason || "Only Arenzyra staff can use this action.",
  );
  return false;
}

async function handleButton(interaction: ButtonInteraction) {
  try {
    if (!(await authorizeSensitiveComponent(interaction))) return;
    if (await isInteractionChannelPaused(interaction)) {
      await safeEphemeralReply(
        interaction,
        "Arenzyra bot is paused in this channel. Ask staff to use `/session-admin channel-state` with state `Active` here (legacy `%start` also works).",
      );
      return;
    }
    if (interaction.customId.startsWith("destructive:")) {
      const handled =
        await messageRegistrationService.handleButton(interaction);
      if (handled) {
        return;
      }
    }

    if (interaction.customId.startsWith("play:")) {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }
      const handled = await controlPanelService.handleButton(interaction);
      if (handled) {
        return;
      }
    }

    if (interaction.customId.startsWith("autoclean:full:")) {
      const handled =
        await sessionService.handleAutoCleanupConfirmationButton(interaction);
      if (handled) {
        return;
      }
    }

    if (interaction.customId.startsWith("clean-channel:")) {
      return;
    }

    const handled =
      (await staffTaskService.handleButton(interaction)) ||
      (await messageRegistrationService.handleButton(interaction)) ||
      (await ticketService.handleButton(interaction)) ||
      (await controlPanelService.handleButton(interaction));
    if (!handled && !interaction.replied && !interaction.deferred) {
      await safeEphemeralReply(interaction, "Unknown button action");
    }
  } catch (error) {
    if (isIgnoredInteractionResponseError(error)) {
      console.warn(
        `Skipped expired button interaction ${interaction.customId}: ${String(
          error,
        )}`,
      );
      return;
    }

    if (
      interaction.customId.startsWith("play:") &&
      isStalePlayButtonError(error)
    ) {
      console.warn(
        `Disabled stale play button ${interaction.customId}: ${userFacingError(
          error,
        )}`,
      );
      await disableStalePlayButtonMessage(interaction);
      await safeInteractionErrorReply(
        interaction,
        "This old play confirmation panel is no longer connected. Use the latest slot list.",
      );
      return;
    }

    const message = userFacingError(error);
    console.error(`Button ${interaction.customId} failed:`, error);

    await safeInteractionErrorReply(interaction, message);
  }
}

async function handleStringSelectMenu(
  interaction: StringSelectMenuInteraction,
) {
  try {
    if (!(await authorizeSensitiveComponent(interaction))) return;
    if (await isInteractionChannelPaused(interaction)) {
      await safeEphemeralReply(
        interaction,
        "Arenzyra bot is paused in this channel. Ask staff to use `/session-admin channel-state` with state `Active` here (legacy `%start` also works).",
      );
      return;
    }

    const handled =
      (await staffTaskService.handleStringSelectMenu(interaction)) ||
      (await messageRegistrationService.handleStringSelectMenu(interaction)) ||
      (await controlPanelService.handleStringSelectMenu(interaction));
    if (!handled && !interaction.replied && !interaction.deferred) {
      await safeEphemeralReply(interaction, "Unknown menu action");
    }
  } catch (error) {
    const message = userFacingError(error);
    console.error(`Menu ${interaction.customId} failed:`, error);

    await safeInteractionErrorReply(interaction, message);
  }
}

async function handleModalSubmit(interaction: ModalSubmitInteraction) {
  try {
    if (!(await authorizeSensitiveComponent(interaction))) return;
    if (await isInteractionChannelPaused(interaction)) {
      await safeEphemeralReply(
        interaction,
        "Arenzyra bot is paused in this channel. Ask staff to use `/session-admin channel-state` with state `Active` here (legacy `%start` also works).",
      );
      return;
    }

    const handled =
      (await staffTaskService.handleModalSubmit(interaction)) ||
      (await messageRegistrationService.handleModalSubmit(interaction)) ||
      (await controlPanelService.handleModalSubmit(interaction));
    if (!handled && !interaction.replied && !interaction.deferred) {
      await safeEphemeralReply(interaction, "Unknown form action");
    }
  } catch (error) {
    const message = userFacingError(error);
    console.error(`Modal ${interaction.customId} failed:`, error);

    await safeInteractionErrorReply(interaction, message);
  }
}

async function handleMessage(message: Message) {
  try {
    if (await sessionService.cleanupStaleManagedBotMessage(message)) {
      return;
    }
    await messageRegistrationService.handleMessage(message);
  } catch (error) {
    const reply = userFacingError(error);
    console.error(`Message registration failed:`, error);
    await message.reply(reply).catch(() => undefined);
  }
}

async function handleMessageUpdate(
  _oldMessage: Message | PartialMessage,
  message: Message | PartialMessage,
) {
  try {
    const hydrated = message.partial
      ? await message.fetch().catch(() => null)
      : message;
    if (hydrated) {
      if (await sessionService.cleanupStaleManagedBotMessage(hydrated)) {
        return;
      }
      await messageRegistrationService.handleMessage(hydrated);
    }
  } catch (error) {
    console.error("Discord message cleanup after update failed:", error);
  }
}

async function handleReactionAdd(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
) {
  try {
    await sessionService.handlePlayStatusReaction(reaction, user);
  } catch (error) {
    console.error("Play-status reaction failed:", error);
  }
}

async function handleGuildDelete(guild: Guild) {
  try {
    const result = await sessionService.markDiscordGuildRemoved(guild);
    console.log(
      `[DiscordGuild] removed guild=${guild.id} name="${guild.name}" disabledGuildLinks=${result.disabledGuildLinks} disabledPrimaryConfigs=${result.disabledPrimaryConfigs}`,
    );
  } catch (error) {
    console.warn(
      `[DiscordGuild] failed to mark removed guild=${guild.id} name="${guild.name}": ${String(
        error,
      )}`,
    );
  }
}

async function handleGuildCreate(guild: Guild) {
  try {
    await onboardingService.ensureGuildOnboarding(guild);
  } catch (error) {
    console.warn(
      `[DiscordGuild] failed to sync onboarding guild=${guild.id} name="${guild.name}": ${String(
        error,
      )}`,
    );
  }
}

async function bootstrap() {
  await gatewayHealthMarker.clear();
  await withTimeout(
    registerSlashCommands(),
    SLASH_COMMAND_REGISTRATION_TIMEOUT_MS,
    "Slash command registration",
  ).catch((error) => {
    console.warn(
      `Continuing Discord bot startup without refreshing slash commands: ${String(
        error,
      )}`,
    );
  });

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      ...(botConfig.guildMembersIntent ? [GatewayIntentBits.GuildMembers] : []),
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      ...(botConfig.messageContentIntent
        ? [GatewayIntentBits.MessageContent]
        : []),
    ],
    partials: [
      Partials.Channel,
      Partials.Message,
      Partials.Reaction,
      Partials.User,
    ],
  });
  gatewayClient = client;

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Discord bot ready as ${readyClient.user.tag}`);
    gatewayHealthMarker.start(readyClient);
    sessionService.startConfirmationWindowRefresh(readyClient);
    sessionService.startActiveDiscordSessionReconciler(readyClient);
    sessionService.startExpiredBanRoleCleanup(readyClient);
    officialPricingPromoService.start(readyClient);
    onboardingService.start(readyClient);
    staffTaskService.start(readyClient);
    idpScheduleService.start(readyClient);
    scheduledMessageService.start(readyClient);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isAutocomplete()) {
        await handleAutocomplete(interaction);
        return;
      }
      if (interaction.isChatInputCommand()) {
        await handleCommand(interaction);
        return;
      }
      if (interaction.isMessageContextMenuCommand()) {
        await handleMessageContextCommand(interaction);
        return;
      }
      if (interaction.isButton()) {
        await handleButton(interaction);
        return;
      }
      if (interaction.isStringSelectMenu()) {
        await handleStringSelectMenu(interaction);
        return;
      }
      if (interaction.isModalSubmit()) {
        await handleModalSubmit(interaction);
      }
    } catch (error) {
      console.error("Unhandled Discord interaction failed:", error);
    }
  });

  client.on(Events.MessageCreate, handleMessage);
  client.on(Events.MessageUpdate, handleMessageUpdate);
  client.on(Events.MessageReactionAdd, handleReactionAdd);
  client.on(Events.GuildCreate, handleGuildCreate);
  client.on(Events.GuildDelete, handleGuildDelete);

  for (;;) {
    try {
      console.log("Connecting to Discord gateway...");
      await withTimeout(
        client.login(botConfig.discordToken),
        DISCORD_LOGIN_TIMEOUT_MS,
        "Discord gateway login",
      );
      return;
    } catch (error) {
      console.warn(
        `Discord gateway login failed; retrying in ${DISCORD_LOGIN_RETRY_MS}ms: ${String(
          error,
        )}`,
      );
      client.destroy();
      await sleep(DISCORD_LOGIN_RETRY_MS);
    }
  }
}

async function gracefulShutdown(reason: string) {
  if (shutdownPromise) {
    return shutdownPromise;
  }
  shutdownPromise = (async () => {
    console.log(`Discord bot shutdown started: ${reason}`);
    sessionService.stopBackgroundTasks();
    officialPricingPromoService.stop();
    staffTaskService.stop();
    idpScheduleService.stop();
    scheduledMessageService.stop();
    await gatewayHealthMarker.stop();
    gatewayClient?.destroy();
    gatewayClient = null;
    console.log("Discord bot shutdown complete.");
  })();
  return shutdownPromise;
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    const forcedExit = setTimeout(() => process.exit(1), 10_000);
    forcedExit.unref?.();
    void gracefulShutdown(signal).finally(() => {
      clearTimeout(forcedExit);
      process.exit(0);
    });
  });
}

bootstrap().catch((error) => {
  console.error("Failed to start Discord bot:", error);
  process.exit(1);
});
