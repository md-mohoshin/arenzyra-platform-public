import {
  AttachmentBuilder,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import type { DiscordSessionService } from '../services/session.service';

export const applyResultsCommand = {
  data: new SlashCommandBuilder()
    .setName('apply-results')
    .setDescription('Re-preview and apply screenshot results for a match')
    .addStringOption((option) =>
      option
        .setName('match-id')
        .setDescription('Match ID')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('image-url')
        .setDescription('Public screenshot URL')
        .setRequired(true),
    ),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { sessionService: DiscordSessionService },
  ) {
    await interaction.deferReply();
    const matchId = interaction.options.getString('match-id', true);
    const imageUrl = interaction.options.getString('image-url', true);
    const result = await services.sessionService.applyResults(
      matchId,
      imageUrl,
    );
    const files = result.imageBuffer
      ? [new AttachmentBuilder(result.imageBuffer, { name: 'result.png' })]
      : [];
    await interaction.editReply({
      content: result.content,
      files,
    });
  },
};
