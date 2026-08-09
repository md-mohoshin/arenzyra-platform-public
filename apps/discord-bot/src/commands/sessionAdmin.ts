import {
  ChannelType,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type {
  DiscordSessionService,
  ResultSummaryConfigPatch,
} from "../services/session.service";
import type { MessageRegistrationService } from "../services/message-registration.service";
import {
  interactionAudit,
  requireConfiguredTextChannel,
  resolveCommandSession,
} from "./sessionCommandContext";

const ENABLED_CHOICES = [
  { name: "Enabled", value: "enabled" },
  { name: "Disabled", value: "disabled" },
] as const;

function optionalSessionId(interaction: ChatInputCommandInteraction) {
  return interaction.options.getString("session-id")?.trim() || null;
}

function enabledOption(interaction: ChatInputCommandInteraction) {
  return interaction.options.getString("state", true) === "enabled";
}

function resultSummaryPatch(
  interaction: ChatInputCommandInteraction,
): ResultSummaryConfigPatch {
  const action = interaction.options.getString("action", true);
  if (action === "reset") {
    return { action: "reset" };
  }
  if (action === "count") {
    const count = interaction.options.getInteger("count");
    if (count === null) {
      throw new Error("Choose a result summary count from 0 to 20.");
    }
    return { action: "count", value: count };
  }

  const text = interaction.options.getString("text")?.trim() || "";
  if (!text) {
    throw new Error(
      action === "title"
        ? "Result summary title text is required."
        : "Result summary row template is required.",
    );
  }
  return {
    action: action === "title" ? "title" : "row",
    value: text,
  };
}

export const sessionAdminCommand = {
  data: new SlashCommandBuilder()
    .setName("session-admin")
    .setDescription("Safely manage an Arenzyra Discord session")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("channel-state")
        .setDescription("Pause or resume Arenzyra activity in a channel")
        .addStringOption((option) =>
          option
            .setName("state")
            .setDescription("Whether Arenzyra is active or paused")
            .setRequired(true)
            .addChoices(
              { name: "Active", value: "active" },
              { name: "Paused", value: "paused" },
            ),
        )
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Configured channel; defaults to this channel")
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
            ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("registration-state")
        .setDescription("Open or close registration")
        .addStringOption((option) =>
          option
            .setName("state")
            .setDescription("New registration state")
            .setRequired(true)
            .addChoices(
              { name: "Open", value: "open" },
              { name: "Closed", value: "closed" },
            ),
        )
        .addStringOption((option) =>
          option
            .setName("session-id")
            .setDescription("Optional session ID; otherwise use this channel"),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("waitlist-state")
        .setDescription("Open or close waitlist promotion")
        .addStringOption((option) =>
          option
            .setName("state")
            .setDescription("New waitlist promotion state")
            .setRequired(true)
            .addChoices(
              { name: "Open", value: "open" },
              { name: "Closed", value: "closed" },
            ),
        )
        .addStringOption((option) =>
          option
            .setName("session-id")
            .setDescription("Optional session ID; otherwise use this channel"),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("idp-forwarding")
        .setDescription("Enable or disable IDP forwarding to manager DMs")
        .addStringOption((option) =>
          option
            .setName("state")
            .setDescription("New IDP forwarding state")
            .setRequired(true)
            .addChoices(...ENABLED_CHOICES),
        )
        .addStringOption((option) =>
          option
            .setName("session-id")
            .setDescription("Optional session ID; otherwise use this channel"),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("slot-responses")
        .setDescription("Enable or disable free-slot status replies")
        .addStringOption((option) =>
          option
            .setName("state")
            .setDescription("New free-slot response state")
            .setRequired(true)
            .addChoices(...ENABLED_CHOICES),
        )
        .addStringOption((option) =>
          option
            .setName("session-id")
            .setDescription("Optional session ID; otherwise use this channel"),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("result-summary")
        .setDescription("Configure the compact match result summary")
        .addStringOption((option) =>
          option
            .setName("action")
            .setDescription("Summary setting to update")
            .setRequired(true)
            .addChoices(
              { name: "Count", value: "count" },
              { name: "Title", value: "title" },
              { name: "Row template", value: "row-template" },
              { name: "Reset defaults", value: "reset" },
            ),
        )
        .addIntegerOption((option) =>
          option
            .setName("count")
            .setDescription("Number of summary rows, from 0 to 20")
            .setMinValue(0)
            .setMaxValue(20),
        )
        .addStringOption((option) =>
          option
            .setName("text")
            .setDescription("Title or row-template text")
            .setMaxLength(180),
        )
        .addStringOption((option) =>
          option
            .setName("session-id")
            .setDescription("Optional session ID; otherwise use this channel"),
        ),
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
    services: {
      sessionService: DiscordSessionService;
      messageRegistrationService: Pick<
        MessageRegistrationService,
        "invalidateIdpDmChannelCache"
      >;
    },
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
    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === "channel-state") {
      const targetChannel = interaction.options.getChannel("channel");
      const context = await resolveCommandSession(interaction, sessionService, {
        channel: targetChannel,
      });
      const channelId = targetChannel?.id ?? interaction.channelId;
      const paused =
        interaction.options.getString("state", true) === "paused";
      await sessionService.withOrganization(
        context.config.organizationId,
        () => sessionService.setDiscordChannelPaused(
          interaction.guild!.id,
          channelId,
          paused,
        ),
      );
      await interaction.editReply({
        content: `Arenzyra is now ${paused ? "paused" : "active"} in <#${channelId}> for ${context.session.name}.`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    const context = await resolveCommandSession(interaction, sessionService, {
      sessionId: optionalSessionId(interaction),
    });
    const audit = interactionAudit(interaction, context.session.name);

    if (subcommand === "registration-state") {
      await requireConfiguredTextChannel(
        interaction.guild,
        context.config.registrationChannelId,
        "Registration channel",
      );
      const state = interaction.options.getString("state", true) as
        | "open"
        | "closed";
      const content = await sessionService.withOrganization(
        context.config.organizationId,
        () => sessionService.setRegistrationChannelState(
          interaction.guild!,
          context.session.id,
          state,
          audit,
        ),
      );
      await interaction.editReply({ content, allowedMentions: { parse: [] } });
      return;
    }

    if (subcommand === "waitlist-state") {
      await requireConfiguredTextChannel(
        interaction.guild,
        context.config.waitlistChannelId,
        "Waitlist channel",
      );
      const state = interaction.options.getString("state", true) as
        | "open"
        | "closed";
      const content = await sessionService.withOrganization(
        context.config.organizationId,
        () => sessionService.setWaitlistPromotionChannelState(
          interaction.guild!,
          context.session.id,
          state,
          audit,
        ),
      );
      await interaction.editReply({ content, allowedMentions: { parse: [] } });
      return;
    }

    if (subcommand === "idp-forwarding") {
      const idpChannel = await requireConfiguredTextChannel(
        interaction.guild,
        context.config.idpChannelId,
        "IDP channel",
      );
      const enabled = enabledOption(interaction);
      await sessionService.withOrganization(
        context.config.organizationId,
        () => sessionService.setIdpDmForwardingEnabled(
          context.session.id,
          enabled,
        ),
      );
      services.messageRegistrationService.invalidateIdpDmChannelCache(
        interaction.guild.id,
        idpChannel.id,
      );
      await interaction.editReply({
        content: `IDP manager-DM forwarding is now ${enabled ? "enabled" : "disabled"} for ${context.session.name}.`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (subcommand === "slot-responses") {
      await requireConfiguredTextChannel(
        interaction.guild,
        context.config.slotListChannelId,
        "Slot-list channel",
      );
      const enabled = enabledOption(interaction);
      await sessionService.withOrganization(
        context.config.organizationId,
        () => sessionService.setSlotStatusResponseEnabled(
          context.session.id,
          enabled,
        ),
      );
      await interaction.editReply({
        content: `Free-slot status replies are now ${enabled ? "enabled" : "disabled"} for ${context.session.name}.`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (subcommand === "result-summary") {
      await requireConfiguredTextChannel(
        interaction.guild,
        context.config.resultsChannelId,
        "Results channel",
      );
      const content = await sessionService.withOrganization(
        context.config.organizationId,
        () => sessionService.updateResultSummaryConfig(
          context.session.id,
          resultSummaryPatch(interaction),
        ),
      );
      await interaction.editReply({ content, allowedMentions: { parse: [] } });
      return;
    }

    throw new Error("Unknown session administration action.");
  },
};
