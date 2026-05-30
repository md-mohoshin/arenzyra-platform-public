import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import type { ControlPanelService } from "../services/control-panel.service";

export const liveCenterCommand = {
  data: new SlashCommandBuilder()
    .setName("live-center")
    .setDescription("Post a premium live scrim command center")
    .addStringOption((option) =>
      option
        .setName("session-id")
        .setDescription("Optional session ID; current synced scrim is used first"),
    ),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { controlPanelService: ControlPanelService },
  ) {
    await services.controlPanelService.postLiveCenter(interaction);
  },
};
