import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import type { ControlPanelService } from "../services/control-panel.service";

export const scheduleEventCommand = {
  data: new SlashCommandBuilder()
    .setName("schedule-event")
    .setDescription("Create a Discord scheduled event for a scrim")
    .addStringOption((option) =>
      option
        .setName("session-id")
        .setDescription("Optional session ID; current synced scrim is used first"),
    )
    .addStringOption((option) =>
      option
        .setName("starts-at")
        .setDescription("Start time, preferably ISO format"),
    )
    .addIntegerOption((option) =>
      option
        .setName("duration-minutes")
        .setDescription("Event duration in minutes")
        .setMinValue(15)
        .setMaxValue(720),
    )
    .addStringOption((option) =>
      option.setName("title").setDescription("Optional event title"),
    )
    .addStringOption((option) =>
      option
        .setName("description")
        .setDescription("Optional Discord event description"),
    ),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { controlPanelService: ControlPanelService },
  ) {
    await services.controlPanelService.createScheduledEvent(interaction);
  },
};
