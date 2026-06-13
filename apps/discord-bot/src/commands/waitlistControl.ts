import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import type { ControlPanelService } from '../services/control-panel.service';

export const waitlistControlCommand = {
  data: new SlashCommandBuilder()
    .setName('waitlist-control')
    .setDescription('Open the staff waitlist control panel for this scrim'),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { controlPanelService: ControlPanelService },
  ) {
    await services.controlPanelService.showWaitlistControlPanel(interaction);
  },
};
