import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  type Attachment,
} from "discord.js";
import type { DiscordIdpBroadcastService } from "../services/idp-broadcast.service";

function optionalAttachment(
  interaction: ChatInputCommandInteraction,
  name: string,
) {
  return interaction.options.getAttachment(name);
}

export const idpBroadcastCommand = {
  data: new SlashCommandBuilder()
    .setName("idp-broadcast")
    .setDescription("Send an IDP update to registered slot managers")
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("IDP update text")
        .setMaxLength(1700),
    )
    .addAttachmentOption((option) =>
      option.setName("attachment-1").setDescription("Optional attachment"),
    )
    .addAttachmentOption((option) =>
      option.setName("attachment-2").setDescription("Optional attachment"),
    )
    .addAttachmentOption((option) =>
      option.setName("attachment-3").setDescription("Optional attachment"),
    )
    .addAttachmentOption((option) =>
      option.setName("attachment-4").setDescription("Optional attachment"),
    )
    .addAttachmentOption((option) =>
      option.setName("attachment-5").setDescription("Optional attachment"),
    ),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { idpBroadcastService: DiscordIdpBroadcastService },
  ) {
    await interaction.deferReply({ ephemeral: true });
    const attachments = [
      optionalAttachment(interaction, "attachment-1"),
      optionalAttachment(interaction, "attachment-2"),
      optionalAttachment(interaction, "attachment-3"),
      optionalAttachment(interaction, "attachment-4"),
      optionalAttachment(interaction, "attachment-5"),
    ].filter((attachment): attachment is Attachment => Boolean(attachment));
    const result = await services.idpBroadcastService.broadcast(interaction, {
      content: interaction.options.getString("message"),
      attachments,
    });
    await interaction.editReply(result);
  },
};
