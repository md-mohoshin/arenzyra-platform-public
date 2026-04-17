import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import type { DiscordSessionService } from '../services/session.service';

export const joinScrimCommand = {
  data: new SlashCommandBuilder()
    .setName('join-scrim')
    .setDescription('Join a scrim session')
    .addStringOption((option) =>
      option
        .setName('session-id')
        .setDescription('Session ID')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('tag')
        .setDescription('Managed team tag')
        .setRequired(true),
    ),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { sessionService: DiscordSessionService },
  ) {
    await interaction.deferReply();
    const sessionId = interaction.options.getString('session-id', true);
    const tag = interaction.options.getString('tag', true);
    const content = await services.sessionService.joinScrim(
      interaction.user.id,
      sessionId,
      tag,
    );
    await interaction.editReply(content);
  },
};
