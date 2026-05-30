import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import type { DiscordSessionService } from '../services/session.service';

function screenshotInput(interaction: ChatInputCommandInteraction) {
  const attachment = interaction.options.getAttachment('screenshot');
  return interaction.options.getString('image-url')?.trim() || attachment?.url;
}

export const mapSlotsCommand = {
  data: new SlashCommandBuilder()
    .setName('map-slots')
    .setDescription('Read a slot/player screenshot for OCR result mapping')
    .addStringOption((option) =>
      option
        .setName('match-id')
        .setDescription('Match ID')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('image-url')
        .setDescription('Public slot/player screenshot URL')
        .setRequired(false),
    )
    .addAttachmentOption((option) =>
      option
        .setName('screenshot')
        .setDescription('Slot/player screenshot image attachment')
        .setRequired(false),
    ),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { sessionService: DiscordSessionService },
  ) {
    await interaction.deferReply();
    const matchId = interaction.options.getString('match-id', true);
    const imageUrl = screenshotInput(interaction);
    if (!imageUrl) {
      await interaction.editReply(
        'Attach a slot/player screenshot or provide a public image-url.',
      );
      return;
    }
    const content = await services.sessionService.mapSlotsForResults(
      matchId,
      imageUrl,
    );
    await interaction.editReply(content);
  },
};
