import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import type { DiscordSessionService } from '../services/session.service';

export const createScrimCommand = {
  data: new SlashCommandBuilder()
    .setName('create-scrim')
    .setDescription('Create a new scrim session')
    .addStringOption((option) =>
      option.setName('name').setDescription('Scrim name').setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('slots')
        .setDescription('Lobby slot count')
        .setMinValue(1)
        .setMaxValue(100),
    ),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { sessionService: DiscordSessionService },
  ) {
    await interaction.deferReply();
    const name = interaction.options.getString('name', true);
    const slots = interaction.options.getInteger('slots') ?? undefined;
    const content = await services.sessionService.createScrim(
      interaction.user.id,
      name,
      slots,
      interaction.guild,
    );
    await interaction.editReply(content);
  },
};
