import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { botConfig } from './config';
import { createScrimCommand } from './commands/createScrim';
import { registerTeamCommand } from './commands/registerTeam';
import { joinScrimCommand } from './commands/joinScrim';
import { leaveScrimCommand } from './commands/leaveScrim';
import { listSlotsCommand } from './commands/listSlots';
import { startScrimCommand } from './commands/startScrim';
import { standingsCommand } from './commands/standings';
import { previewResultsCommand } from './commands/previewResults';
import { applyResultsCommand } from './commands/applyResults';
import { DiscordSessionService } from './services/session.service';

type SlashCommand = {
  data: {
    name: string;
    toJSON(): object;
  };
  execute(
    interaction: ChatInputCommandInteraction,
    services: { sessionService: DiscordSessionService },
  ): Promise<void>;
};

const commands: SlashCommand[] = [
  createScrimCommand,
  registerTeamCommand,
  joinScrimCommand,
  leaveScrimCommand,
  listSlotsCommand,
  startScrimCommand,
  standingsCommand,
  previewResultsCommand,
  applyResultsCommand,
];

const commandsByName = new Map(commands.map((command) => [command.data.name, command]));
const sessionService = new DiscordSessionService();

async function registerSlashCommands() {
  const rest = new REST({ version: '10' }).setToken(botConfig.discordToken);
  const body = commands.map((command) => command.data.toJSON());

  if (botConfig.discordGuildId) {
    await rest.put(
      Routes.applicationGuildCommands(
        botConfig.discordClientId,
        botConfig.discordGuildId,
      ),
      { body },
    );
    console.log(
      `Registered ${commands.length} guild slash commands for guild ${botConfig.discordGuildId}.`,
    );
    return;
  }

  await rest.put(Routes.applicationCommands(botConfig.discordClientId), {
    body,
  });
  console.log(`Registered ${commands.length} global slash commands.`);
}

async function handleCommand(interaction: ChatInputCommandInteraction) {
  const command = commandsByName.get(interaction.commandName);
  if (!command) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'Unknown command',
        ephemeral: true,
      });
    }
    return;
  }

  try {
    await command.execute(interaction, { sessionService });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unexpected Discord bot error';
    console.error(`Command ${interaction.commandName} failed:`, error);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message);
      return;
    }

    await interaction.reply({
      content: message,
      ephemeral: true,
    });
  }
}

async function bootstrap() {
  await registerSlashCommands();

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Discord bot ready as ${readyClient.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }
    await handleCommand(interaction);
  });

  await client.login(botConfig.discordToken);
}

bootstrap().catch((error) => {
  console.error('Failed to start Discord bot:', error);
  process.exit(1);
});
