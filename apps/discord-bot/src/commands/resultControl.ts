import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import type { ControlPanelService } from "../services/control-panel.service";

export const resultControlCommand = {
  data: new SlashCommandBuilder()
    .setName("result-control")
    .setDescription("Post Arenzyra result controls for the current scrim.")
    .addStringOption((option) =>
      option
        .setName("session-id")
        .setDescription("Choose an active session for the result control panel")
        .setAutocomplete(true),
    ),
  async autocomplete(
    interaction: AutocompleteInteraction,
    services: { controlPanelService: ControlPanelService },
  ) {
    await services.controlPanelService.autocompleteResultControlSession(
      interaction,
    );
  },
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { controlPanelService: ControlPanelService },
  ) {
    await services.controlPanelService.postControlPanel(interaction, "result");
  },
};
