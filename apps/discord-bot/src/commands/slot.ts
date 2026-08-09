import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import type { DiscordSessionService } from "../services/session.service";

function channelTopic(interaction: ChatInputCommandInteraction) {
  const topic = (interaction.channel as { topic?: unknown } | null)?.topic;
  return typeof topic === "string" ? topic : null;
}

export const slotCommand = {
  data: new SlashCommandBuilder()
    .setName("slot")
    .setDescription("Check or confirm a slot in the current Arenzyra session")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("confirm")
        .setDescription("Confirm that your team owns an assigned slot")
        .addIntegerOption((option) =>
          option
            .setName("number")
            .setDescription("Slot number shown in the slot list")
            .setMinValue(1)
            .setMaxValue(999)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("free")
        .setDescription("Show free normal and VIP slots"),
    ),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { sessionService: DiscordSessionService },
  ) {
    if (!interaction.guild || !interaction.guildId || !interaction.channelId) {
      await interaction.reply({
        content: "Use this command inside a configured Arenzyra server channel.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const resolved = await services.sessionService.findConfiguredScrimForDiscordChannel(
      interaction.guildId,
      interaction.channelId,
      channelTopic(interaction),
    );
    if (!resolved) {
      await interaction.editReply(
        "Use this command inside a configured Arenzyra session channel.",
      );
      return;
    }

    const subcommand = interaction.options.getSubcommand(true);
    const content = await services.sessionService.withOrganization(
      resolved.config.organizationId,
      () => {
        if (subcommand === "free") {
          return services.sessionService.freeSlotStatusMessage(
            resolved.session.id,
          );
        }

        const slotNumber = interaction.options.getInteger("number", true);
        return services.sessionService.confirmSlotFromDiscord(
          interaction.user.id,
          interaction.user.tag || interaction.user.username,
          slotNumber,
          interaction.guild,
          resolved.session.id,
          {
            actorDiscordId: interaction.user.id,
            actorLabel: interaction.user.tag || interaction.user.username,
            sourceChannelId: interaction.channelId,
            sessionName: resolved.session.name,
          },
        );
      },
    );

    await interaction.editReply(content);
  },
};
