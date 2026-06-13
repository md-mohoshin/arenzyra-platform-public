import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import type { ControlPanelService } from "../services/control-panel.service";

export const sessionAuditCommand = {
  data: new SlashCommandBuilder()
    .setName("session-audit")
    .setDescription("Show the latest Arenzyra Discord audit timeline")
    .addStringOption((option) =>
      option
        .setName("session-id")
        .setDescription("Optional session ID; current synced scrim is used first"),
    ),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { controlPanelService: ControlPanelService },
  ) {
    await services.controlPanelService.showAuditTimeline(interaction);
  },
};
