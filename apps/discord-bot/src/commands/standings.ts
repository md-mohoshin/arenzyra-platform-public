import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import type { DiscordSessionService } from '../services/session.service';

export const standingsCommand = {
  data: new SlashCommandBuilder()
    .setName('standings')
    .setDescription('Show session standings')
    .addStringOption((option) =>
      option
        .setName('session-id')
        .setDescription('Session ID')
        .setRequired(true),
    ),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { sessionService: DiscordSessionService },
  ) {
    await interaction.deferReply();
    const sessionId = interaction.options.getString('session-id', true);
    const content = await services.sessionService.standings(sessionId);
    await interaction.editReply(content);
  },
};
