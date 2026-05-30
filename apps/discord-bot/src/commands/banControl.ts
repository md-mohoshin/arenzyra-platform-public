import { SlashCommandBuilder } from "discord.js";
import type { ControlPanelService } from "../services/control-panel.service";

export const banControlCommand = {
  data: new SlashCommandBuilder()
    .setName("ban-control")
    .setDescription("Post Arenzyra team ban controls for the current scrim."),
  async execute(
    interaction: import("discord.js").ChatInputCommandInteraction,
    services: { controlPanelService: ControlPanelService },
  ) {
    await services.controlPanelService.postBanControlPanel(interaction);
  },
};
