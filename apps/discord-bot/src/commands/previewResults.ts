import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import type { DiscordSessionService } from '../services/session.service';

export const previewResultsCommand = {
  data: new SlashCommandBuilder()
    .setName('preview-results')
    .setDescription('Preview OCR-parsed screenshot results for a match')
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
        .setRequired(false),
    )
    .addAttachmentOption((option) =>
      option
        .setName('screenshot')
        .setDescription('Screenshot image attachment')
        .setRequired(false),
    ),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { sessionService: DiscordSessionService },
  ) {
    await interaction.deferReply();
    const matchId = interaction.options.getString('match-id', true);
    const attachment = interaction.options.getAttachment('screenshot');
    const imageUrl =
      interaction.options.getString('image-url')?.trim() || attachment?.url;
    if (!imageUrl) {
      await interaction.editReply(
        'Attach a screenshot or provide a public image-url.',
      );
      return;
    }
    const content = await services.sessionService.previewResults(
      matchId,
      imageUrl,
    );
    await interaction.editReply(content);
  },
};
