import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  MessageContextMenuCommandInteraction,
} from "discord.js";
import type { ControlPanelService } from "../services/control-panel.service";

export const contextBanManagerCommand = {
  data: new ContextMenuCommandBuilder()
    .setName("Arenzyra Ban Manager")
    .setType(ApplicationCommandType.Message),
  async execute(
    interaction: MessageContextMenuCommandInteraction,
    services: { controlPanelService: ControlPanelService },
  ) {
    await services.controlPanelService.previewMessageAuthorBan(interaction);
  },
};
