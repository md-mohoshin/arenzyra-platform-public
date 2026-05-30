import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import type {
  ControlPanelAudience,
  ControlPanelService,
} from '../services/control-panel.service';

export const controlPanelCommand = {
  data: new SlashCommandBuilder()
    .setName('control-panel')
    .setDescription('Post an Arenzyra scrim or tournament control panel')
    .addStringOption((option) =>
      option
        .setName('audience')
        .setDescription('Panel type')
        .addChoices(
          { name: 'Teams', value: 'teams' },
          { name: 'Staff', value: 'staff' },
        ),
    ),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { controlPanelService: ControlPanelService },
  ) {
    const audience =
      (interaction.options.getString('audience') as ControlPanelAudience | null) ??
      'staff';
    await services.controlPanelService.postControlPanel(interaction, audience);
  },
};
