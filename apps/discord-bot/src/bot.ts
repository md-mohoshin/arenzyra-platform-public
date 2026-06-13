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
import { createScrimCommand } from "./commands/createScrim";
import { registerTeamCommand } from "./commands/registerTeam";
import { joinScrimCommand } from "./commands/joinScrim";
import { leaveScrimCommand } from "./commands/leaveScrim";
import { listSlotsCommand } from "./commands/listSlots";
import { startScrimCommand } from "./commands/startScrim";
import { standingsCommand } from "./commands/standings";
import { mapSlotsCommand } from "./commands/mapSlots";
import { previewResultsCommand } from "./commands/previewResults";
import { applyResultsCommand } from "./commands/applyResults";
import { ticketOpenCommand } from "./commands/ticketOpen";
import { ticketCloseCommand } from "./commands/ticketClose";
import { ticketPanelCommand } from "./commands/ticketPanel";
import { controlPanelCommand } from "./commands/controlPanel";
import { banControlCommand } from "./commands/banControl";
import { resultControlCommand } from "./commands/resultControl";
import { playButtonsCommand } from "./commands/playButtons";
import { waitlistControlCommand } from "./commands/waitlistControl";
import { arenzyraDoctorCommand } from "./commands/arenzyraDoctor";
import { scheduleEventCommand } from "./commands/scheduleEvent";
import { captainPanelCommand } from "./commands/captainPanel";
import { liveCenterCommand } from "./commands/liveCenter";
import { sessionAuditCommand } from "./commands/sessionAudit";
import { productionSetupCommand } from "./commands/productionSetup";
import { productionPinsCommand } from "./commands/productionPins";
import { contextBanManagerCommand } from "./commands/contextBanManager";
import { DiscordSessionService } from "./services/session.service";
import { TicketService } from "./services/ticket.service";
import { ControlPanelService } from "./services/control-panel.service";
import { MessageRegistrationService } from "./services/message-registration.service";
import { OfficialPricingPromoService } from "./services/official-pricing-promo.service";
import { DiscordOnboardingService } from "./services/onboarding.service";
import { toFriendlyApiError } from "./api/api-client";

type CommandServices = {
  sessionService: DiscordSessionService;
  ticketService: TicketService;
  controlPanelService: ControlPanelService;
};

type SlashCommand = {
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

type MessageContextMenuCommand = {
  data: {
    name: string;
    toJSON(): object;
  };
  execute(
    interaction: MessageContextMenuCommandInteraction,
    services: CommandServices,
  ): Promise<void>;
};

type ReplyableInteraction =
  | ChatInputCommandInteraction
  | MessageContextMenuCommandInteraction
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ModalSubmitInteraction;

const commands: SlashCommand[] = [
  createScrimCommand,
  registerTeamCommand,
  joinScrimCommand,
  leaveScrimCommand,
  listSlotsCommand,
  startScrimCommand,
  standingsCommand,
  mapSlotsCommand,
  previewResultsCommand,
  applyResultsCommand,
  ticketOpenCommand,
  ticketCloseCommand,
  ticketPanelCommand,
  controlPanelCommand,
  banControlCommand,
  resultControlCommand,
  playButtonsCommand,
  waitlistControlCommand,
  arenzyraDoctorCommand,
  scheduleEventCommand,
  captainPanelCommand,
  liveCenterCommand,
  sessionAuditCommand,
  productionSetupCommand,
  productionPinsCommand,
];
const contextMenuCommands: MessageContextMenuCommand[] = [
  contextBanManagerCommand,
];
const registeredCommands = [...commands, ...contextMenuCommands];

function userFacingError(error: unknown) {
  const message = toFriendlyApiError(error).trim();
  return message || "Unexpected Discord bot error";
}
const SLASH_COMMAND_REGISTRATION_TIMEOUT_MS = 20_000;

const commandsByName = new Map(
  commands.map((command) => [command.data.name, command]),
);
const contextMenuCommandsByName = new Map(
  contextMenuCommands.map((command) => [command.data.name, command]),
);
const sessionService = new DiscordSessionService();
const ticketService = new TicketService();
const controlPanelService = new ControlPanelService(sessionService);
const messageRegistrationService = new MessageRegistrationService(
  sessionService,
  controlPanelService,
);
const officialPricingPromoService = new OfficialPricingPromoService();
const onboardingService = new DiscordOnboardingService();
const DISCORD_LOGIN_TIMEOUT_MS = 30_000;
const DISCORD_LOGIN_RETRY_MS = 10_000;

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

async function isInteractionChannelPaused(interaction: ReplyableInteraction) {
  return sessionService.isDiscordChannelPaused(
    interaction.guildId,
    interaction.channelId,
  );
}

async function registerSlashCommands() {
  const rest = new REST({ version: "10" }).setToken(botConfig.discordToken);
  const body = registeredCommands.map((command) => command.data.toJSON());

  if (botConfig.discordGuildId) {
    await rest.put(
      Routes.applicationGuildCommands(
        botConfig.discordClientId,
        botConfig.discordGuildId,
      ),
      { body },
    );
    console.log(
      `Registered ${registeredCommands.length} guild application commands for guild ${botConfig.discordGuildId}.`,
    );
  }

  if (botConfig.registerGlobalCommands || !botConfig.discordGuildId) {
    await rest.put(Routes.applicationCommands(botConfig.discordClientId), {
      body,
    });
    console.log(
      `Registered ${registeredCommands.length} global application commands.`,
    );
  }
}

async function handleCommand(interaction: ChatInputCommandInteraction) {
  if (await isInteractionChannelPaused(interaction)) {
    await safeEphemeralReply(
      interaction,
      "Arenzyra bot is paused in this channel. Ask staff to send `%start` here.",
    );
    return;
  }

  const command = commandsByName.get(interaction.commandName);
  if (!command) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "Unknown command",
        ephemeral: true,
      });
    }
    return;
  }

  try {
    await command.execute(interaction, {
      sessionService,
      ticketService,
      controlPanelService,
    });
  } catch (error) {
    const message = userFacingError(error);
    console.error(`Command ${interaction.commandName} failed:`, error);

    await safeInteractionErrorReply(interaction, message);
  }
}

async function handleAutocomplete(interaction: AutocompleteInteraction) {
  const command = commandsByName.get(interaction.commandName);
  if (!command?.autocomplete) {
    await interaction.respond([]).catch(() => undefined);
    return;
  }

  try {
    await command.autocomplete(interaction, {
      sessionService,
      ticketService,
      controlPanelService,
    });
  } catch (error) {
    console.error(`Autocomplete ${interaction.commandName} failed:`, error);
    await interaction.respond([]).catch(() => undefined);
  }
}

async function handleMessageContextCommand(
  interaction: MessageContextMenuCommandInteraction,
) {
  if (await isInteractionChannelPaused(interaction)) {
    await safeEphemeralReply(
      interaction,
      "Arenzyra bot is paused in this channel. Ask staff to send `%start` here.",
    );
    return;
  }

  const command = contextMenuCommandsByName.get(interaction.commandName);
  if (!command) {
    await safeEphemeralReply(interaction, "Unknown context action");
    return;
  }

  try {
    await command.execute(interaction, {
      sessionService,
      ticketService,
      controlPanelService,
    });
  } catch (error) {
    const message = userFacingError(error);
    console.error(`Context action ${interaction.commandName} failed:`, error);

    await safeInteractionErrorReply(interaction, message);
  }
}

async function handleButton(interaction: ButtonInteraction) {
  try {
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

    if (await isInteractionChannelPaused(interaction)) {
      await safeEphemeralReply(
        interaction,
        "Arenzyra bot is paused in this channel. Ask staff to send `%start` here.",
      );
      return;
    }

    if (interaction.customId.startsWith("clean-channel:")) {
      return;
    }

    const handled =
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
    if (await isInteractionChannelPaused(interaction)) {
      await safeEphemeralReply(
        interaction,
        "Arenzyra bot is paused in this channel. Ask staff to send `%start` here.",
      );
      return;
    }

    const handled =
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
    if (await isInteractionChannelPaused(interaction)) {
      await safeEphemeralReply(
        interaction,
        "Arenzyra bot is paused in this channel. Ask staff to send `%start` here.",
      );
      return;
    }

    const handled =
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

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Discord bot ready as ${readyClient.user.tag}`);
    sessionService.startConfirmationWindowRefresh(readyClient);
    sessionService.startActiveDiscordSessionReconciler(readyClient);
    sessionService.startExpiredBanRoleCleanup(readyClient);
    officialPricingPromoService.start(readyClient);
    onboardingService.start(readyClient);
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

bootstrap().catch((error) => {
  console.error("Failed to start Discord bot:", error);
  process.exit(1);
});
