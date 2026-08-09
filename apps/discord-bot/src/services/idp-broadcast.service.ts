import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Attachment,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { DiscordSessionService } from "./session.service";

const IDP_DM_REPLY_BUTTON_PREFIX = "idpdm:reply:";
const IDP_DM_FORWARD_MAX_CONTENT_LENGTH = 1700;
const IDP_DM_FORWARD_SEND_DELAY_MS = 250;

export type IdpBroadcastPayload = {
  content: string | null;
  attachments: Attachment[];
};

function channelTopic(interaction: ChatInputCommandInteraction) {
  const topic = (interaction.channel as { topic?: unknown } | null)?.topic;
  return typeof topic === "string" ? topic : null;
}

function truncateIdpBody(body: string) {
  if (body.length <= IDP_DM_FORWARD_MAX_CONTENT_LENGTH) {
    return body;
  }
  return `${body
    .slice(0, IDP_DM_FORWARD_MAX_CONTENT_LENGTH - 38)
    .trimEnd()}\n\nMessage truncated. Check the IDP channel.`;
}

export class DiscordIdpBroadcastService {
  constructor(
    private readonly sessionService: DiscordSessionService,
    private readonly sendDelayMs = IDP_DM_FORWARD_SEND_DELAY_MS,
  ) {}

  private body(
    sessionName: string,
    content: string | null,
    attachments: Attachment[],
  ) {
    const lines = [`**IDP update: ${sessionName}**`];
    const cleanContent = content?.trim();
    if (cleanContent) {
      lines.push("", cleanContent);
    }

    if (attachments.length > 0) {
      lines.push("", "**Attachments**");
      for (const attachment of attachments.slice(0, 5)) {
        const name = attachment.name?.trim() || attachment.id || "attachment";
        const url = attachment.url?.trim();
        lines.push(url ? `- ${name}: ${url}` : `- ${name}`);
      }
    }

    return truncateIdpBody(lines.join("\n").trim());
  }

  private replyComponents(
    sessionId: string,
    sourceInteractionId: string,
    managerDiscordUserId: string,
  ) {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            `${IDP_DM_REPLY_BUTTON_PREFIX}${sessionId}:${sourceInteractionId}:${managerDiscordUserId}`,
          )
          .setLabel("Reply")
          .setStyle(ButtonStyle.Primary),
      ),
    ];
  }

  async broadcast(
    interaction: ChatInputCommandInteraction,
    payload: IdpBroadcastPayload,
  ) {
    if (!interaction.guild || !interaction.guildId || !interaction.channelId) {
      throw new Error(
        "Use this command inside the configured IDP channel for a session.",
      );
    }
    if (!payload.content?.trim() && payload.attachments.length === 0) {
      throw new Error("Add a message or at least one attachment to broadcast.");
    }

    const resolved = await this.sessionService.findConfiguredScrimForDiscordChannel(
      interaction.guildId,
      interaction.channelId,
      channelTopic(interaction),
    );
    if (!resolved || resolved.channelKind !== "idp") {
      throw new Error(
        "Use this command inside the configured IDP channel for a session.",
      );
    }
    if (resolved.config.emojis?.idpDmForwardingEnabled !== "true") {
      throw new Error(
        "IDP DM forwarding is disabled for this session. Staff can enable it with `/session-admin idp-forwarding`.",
      );
    }

    const hasStaffAccess = await this.sessionService.userHasStaffAccess(
      interaction.user.id,
      interaction.guild,
      resolved.session.id,
    );
    if (!hasStaffAccess) {
      throw new Error("Only Arenzyra staff can broadcast IDP messages.");
    }

    const recipients = await this.sessionService.withOrganization(
      resolved.config.organizationId,
      () =>
        this.sessionService.listRegisteredSlotManagerDiscordIds(
          resolved.session.id,
        ),
    );
    const body = this.body(
      resolved.session.name,
      payload.content,
      payload.attachments,
    );
    let sent = 0;
    const failed: string[] = [];

    for (const managerDiscordUserId of recipients) {
      const user = await interaction.client.users
        .fetch(managerDiscordUserId)
        .catch(() => null);
      if (!user) {
        failed.push(managerDiscordUserId);
        continue;
      }
      const delivered = await user
        .send({
          content: body,
          components: this.replyComponents(
            resolved.session.id,
            interaction.id,
            managerDiscordUserId,
          ),
          allowedMentions: { parse: [] },
        })
        .then(() => true)
        .catch(() => false);
      if (delivered) {
        sent += 1;
      } else {
        failed.push(managerDiscordUserId);
      }

      if (this.sendDelayMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.sendDelayMs),
        );
      }
    }

    await this.sessionService
      .sendDiscordActionLog(interaction.guild, resolved.config, {
        action: "IDP message broadcast by interaction",
        actorDiscordId: interaction.user.id,
        actorLabel: interaction.user.tag || interaction.user.username,
        sourceChannelId: interaction.channelId,
        sessionId: resolved.session.id,
        sessionName: resolved.session.name,
        status: `${sent}/${recipients.length} delivered`,
        details: [
          `Source interaction ID: ${interaction.id}`,
          failed.length ? `Failed manager IDs: ${failed.join(", ")}` : "",
        ],
        color: failed.length ? 0xf59e0b : 0x22c55e,
      })
      .catch((error) => {
        console.warn(`IDP interaction broadcast log failed: ${String(error)}`);
      });

    return failed.length > 0
      ? `IDP broadcast delivered to ${sent}/${recipients.length} managers. ${failed.length} delivery attempt${failed.length === 1 ? "" : "s"} failed.`
      : `IDP broadcast delivered to ${sent}/${recipients.length} managers.`;
  }
}
