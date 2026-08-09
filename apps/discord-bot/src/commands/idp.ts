import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { DiscordIdpScheduleService } from "../services/idp-schedule.service";

export const idpCommand = {
  data: new SlashCommandBuilder()
    .setName("idp")
    .setDescription("Post configured game room information and schedule IDP reminders")
    .addStringOption((option) =>
      option
        .setName("game")
        .setDescription("Game number; its configured session name is used automatically")
        .setRequired(true)
        .addChoices(
          { name: "G1", value: "G1" },
          { name: "G2", value: "G2" },
          { name: "G3", value: "G3" },
          { name: "G4", value: "G4" },
          { name: "G5", value: "G5" },
          { name: "G6", value: "G6" },
          { name: "G7", value: "G7" },
          { name: "G8", value: "G8" },
          { name: "G9", value: "G9" },
          { name: "G10", value: "G10" },
        ),
    )
    .addStringOption((option) =>
      option
        .setName("room-id")
        .setDescription("Room ID")
        .setRequired(true)
        .setMaxLength(160),
    )
    .addStringOption((option) =>
      option
        .setName("password")
        .setDescription("Room password")
        .setRequired(true)
        .setMaxLength(160),
    )
    .addStringOption((option) =>
      option
        .setName("starts-at")
        .setDescription("Local time only, HH:MM (for example 21:30)")
        .setRequired(true)
        .setMinLength(5)
        .setMaxLength(5),
    ),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { idpScheduleService: DiscordIdpScheduleService },
  ) {
    await services.idpScheduleService.handleCommand(interaction);
  },
};
