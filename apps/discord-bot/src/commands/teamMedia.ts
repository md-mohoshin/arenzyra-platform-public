import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import type { DiscordMediaInteractionService } from "../services/media-interaction.service";

export const teamMediaCommand = {
  data: new SlashCommandBuilder()
    .setName("team-media")
    .setDescription("Upload media in synced scrim/event channels (not production)")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("logo")
        .setDescription("Upload a scrim/event team logo")
        .addStringOption((option) =>
          option
            .setName("team-name")
            .setDescription("Exact team name")
            .setRequired(true),
        )
        .addAttachmentOption((option) =>
          option
            .setName("image")
            .setDescription("PNG, JPEG, or WebP image up to 8 MB")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option.setName("tag").setDescription("Team tag, if needed"),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("photo")
        .setDescription("Upload a scrim/event player photo")
        .addStringOption((option) =>
          option
            .setName("uid")
            .setDescription("Player game UID")
            .setRequired(true),
        )
        .addAttachmentOption((option) =>
          option
            .setName("image")
            .setDescription("PNG, JPEG, or WebP image up to 8 MB")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("team-name")
            .setDescription("Required outside tournament mode"),
        )
        .addStringOption((option) =>
          option
            .setName("player-name")
            .setDescription("Required outside tournament mode"),
        ),
    ),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { mediaInteractionService: DiscordMediaInteractionService },
  ) {
    await interaction.deferReply({ ephemeral: true });
    const subcommand = interaction.options.getSubcommand(true);
    const image = interaction.options.getAttachment("image", true);
    const result =
      subcommand === "logo"
        ? await services.mediaInteractionService.uploadLogo(interaction, {
            teamName: interaction.options.getString("team-name", true),
            tag: interaction.options.getString("tag"),
            image,
          })
        : await services.mediaInteractionService.uploadPlayerPhoto(
            interaction,
            {
              uid: interaction.options.getString("uid", true),
              teamName: interaction.options.getString("team-name"),
              playerName: interaction.options.getString("player-name"),
              image,
            },
          );
    await interaction.editReply(result);
  },
};
