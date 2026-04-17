import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import type { DiscordSessionService } from '../services/session.service';

export const listSlotsCommand = {
  data: new SlashCommandBuilder()
    .setName('list-slots')
    .setDescription('List confirmed slots and waitlist for a scrim')
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
    const content = await services.sessionService.listSlots(sessionId);
    await interaction.editReply(content);
  },
};
