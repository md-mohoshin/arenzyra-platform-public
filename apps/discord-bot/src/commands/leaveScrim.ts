import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import type { DiscordSessionService } from '../services/session.service';

export const leaveScrimCommand = {
  data: new SlashCommandBuilder()
    .setName('leave-scrim')
    .setDescription('Leave a scrim session')
    .addStringOption((option) =>
      option
        .setName('session-id')
        .setDescription('Session ID')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('tag').setDescription('Managed team tag').setRequired(true),
    ),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { sessionService: DiscordSessionService },
  ) {
    await interaction.deferReply();
    const sessionId = interaction.options.getString('session-id', true);
    const tag = interaction.options.getString('tag', true);
    const content = await services.sessionService.leaveScrim(
      interaction.user.id,
      sessionId,
      tag,
    );
    await interaction.editReply(content);
  },
};
