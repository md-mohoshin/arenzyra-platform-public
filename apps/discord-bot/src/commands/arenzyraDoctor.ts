import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import type { ControlPanelService } from "../services/control-panel.service";

export const arenzyraDoctorCommand = {
  data: new SlashCommandBuilder()
    .setName("arenzyra-doctor")
    .setDescription("Check Arenzyra bot permissions and synced scrim setup")
    .addStringOption((option) =>
      option
        .setName("session-id")
        .setDescription("Optional session ID to inspect"),
    ),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { controlPanelService: ControlPanelService },
  ) {
    await services.controlPanelService.runDoctor(interaction);
  },
};
