import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { DiscordSessionService } from "../services/session.service";
import {
  interactionAudit,
  requireConfiguredTextChannel,
  resolveCommandSession,
} from "./sessionCommandContext";

export const teamManagerCommand = {
  data: new SlashCommandBuilder()
    .setName("team-manager")
    .setDescription("Add or remove a manager from a registered team")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Add a manager to a registered team")
        .addStringOption((option) =>
          option
            .setName("team")
            .setDescription("Registered team name or tag")
            .setRequired(true)
            .setMaxLength(120),
        )
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("Manager to add")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("session-id")
            .setDescription("Optional session ID; otherwise use this channel"),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Remove a manager from a registered team")
        .addStringOption((option) =>
          option
            .setName("team")
            .setDescription("Registered team name or tag")
            .setRequired(true)
            .setMaxLength(120),
        )
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("Manager to remove")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("session-id")
            .setDescription("Optional session ID; otherwise use this channel"),
        ),
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
    services: { sessionService: DiscordSessionService },
  ) {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        content: "Use this command inside a Discord server.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const { sessionService } = services;
    const context = await resolveCommandSession(interaction, sessionService, {
      sessionId:
        interaction.options.getString("session-id")?.trim() || null,
    });
    const transferChannel = await requireConfiguredTextChannel(
      interaction.guild,
      context.config.transferChannelId,
      "Transfer roles channel",
    );
    if (interaction.channelId !== transferChannel.id) {
      throw new Error(
        `Use this command inside the configured transfer roles channel <#${transferChannel.id}>.`,
      );
    }

    const targetUser = interaction.options.getUser("user", true);
    if (targetUser.bot) {
      throw new Error("A bot account cannot be a team manager.");
    }
    const targetMember = await interaction.guild.members
      .fetch({ user: targetUser.id, force: true })
      .catch(() => null);
    if (!targetMember) {
      throw new Error("That user is not an active member of this server.");
    }

    const teamQuery = interaction.options.getString("team", true).trim();
    if (!teamQuery) {
      throw new Error("Team name or tag is required.");
    }
    const staffBypass = await sessionService.withOrganization(
      context.config.organizationId,
      () => sessionService.userHasStaffAccess(
        interaction.user.id,
        interaction.guild,
        context.session.id,
      ),
    );
    const audit = interactionAudit(interaction, context.session.name);
    const options = {
      ...audit,
      requesterDiscordId: interaction.user.id,
      staffBypass,
    };
    const action = interaction.options.getSubcommand(true);

    const content = await sessionService.withOrganization(
      context.config.organizationId,
      () =>
        action === "add"
          ? sessionService.addSessionTeamManager(
              interaction.guild!,
              context.session.id,
              teamQuery,
              {
                discordUserId: targetUser.id,
                discordUsername: targetUser.username,
                displayName:
                  targetMember.displayName || targetUser.globalName || null,
                role: "LEADER",
              },
              options,
            )
          : sessionService.removeSessionTeamManager(
              interaction.guild!,
              context.session.id,
              teamQuery,
              targetUser.id,
              options,
            ),
    );
    await interaction.editReply({
      content,
      allowedMentions: { parse: [] },
    });
  },
};
