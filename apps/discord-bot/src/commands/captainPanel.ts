import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import type { ControlPanelService } from "../services/control-panel.service";

export const captainPanelCommand = {
  data: new SlashCommandBuilder()
    .setName("captain-panel")
    .setDescription("Post the manager/captain self-service panel")
    .addStringOption((option) =>
      option
        .setName("session-id")
        .setDescription("Optional session ID; current synced scrim is used first"),
    ),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { controlPanelService: ControlPanelService },
  ) {
    await services.controlPanelService.postCaptainPanel(interaction);
  },
};
