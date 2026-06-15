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
          { name: 'Session Manage', value: 'manage' },
          { name: 'Result Control', value: 'result' },
        ),
    )
    .addStringOption((option) =>
      option
        .setName('session-id')
        .setDescription('Optional session ID for the session manage panel'),
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
