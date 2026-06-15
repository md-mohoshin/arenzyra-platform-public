import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { DiscordSessionService } from "../services/session.service";

export const productionPinsCommand = {
  data: new SlashCommandBuilder()
    .setName("production-pins")
    .setDescription("Refresh pinned instructions in existing production channels")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild | PermissionFlagsBits.ManageChannels,
    ),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { sessionService: DiscordSessionService },
  ) {
    await interaction.deferReply({ ephemeral: true });
    if (!interaction.guild) {
      await interaction.editReply("Use this command inside a Discord server.");
      return;
    }
    const permissions = interaction.memberPermissions;
    if (
      !permissions?.has(PermissionFlagsBits.Administrator) &&
      !permissions?.has(PermissionFlagsBits.ManageGuild) &&
      !permissions?.has(PermissionFlagsBits.ManageChannels)
    ) {
      await interaction.editReply(
        "You need Manage Server or Manage Channels permission to refresh production pins.",
      );
      return;
    }

    const content =
      await services.sessionService.refreshProductionDiscordChannelPins(
        interaction.guild,
      );
    await interaction.editReply(content);
  },
};
