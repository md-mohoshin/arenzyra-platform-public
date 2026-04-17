import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import type { DiscordSessionService } from '../services/session.service';

export const startScrimCommand = {
  data: new SlashCommandBuilder()
    .setName('start-scrim')
    .setDescription('Create a session-owned scrim match')
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
    const content = await services.sessionService.startScrim(
      interaction.user.id,
      sessionId,
    );
    await interaction.editReply(content);
  },
};
