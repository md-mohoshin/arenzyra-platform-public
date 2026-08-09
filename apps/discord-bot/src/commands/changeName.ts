import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import type { DiscordSessionService } from "../services/session.service";

export const changeNameCommand = {
  data: new SlashCommandBuilder()
    .setName("changename")
    .setDescription("Change the team name or tag for an assigned slot.")
    .addIntegerOption((option) =>
      option
        .setName("slot")
        .setDescription("Assigned slot number")
        .setMinValue(1)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("name")
        .setDescription("New team name, or Team Name (TAG)")
        .setMaxLength(80)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("tag")
        .setDescription("Optional new team tag")
        .setMaxLength(15),
    ),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { sessionService: DiscordSessionService },
  ) {
    await interaction.deferReply({ ephemeral: true });
    const channelTopic =
      interaction.channel && "topic" in interaction.channel
        ? (interaction.channel.topic ?? null)
        : null;
    const content = await services.sessionService.changeSlotTeamNameFromDiscord(
      {
        slotNumber: interaction.options.getInteger("slot", true),
        name: interaction.options.getString("name", true),
        tag: interaction.options.getString("tag"),
        channelId: interaction.channelId,
        channelTopic,
        requesterDiscordId: interaction.user.id,
        requesterLabel:
          interaction.user.tag || interaction.user.username || interaction.user.id,
      },
      interaction.guild,
    );
    await interaction.editReply(content);
  },
};
