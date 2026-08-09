import {
  PermissionFlagsBits,
  type Attachment,
  type ChatInputCommandInteraction,
} from "discord.js";
import type {
  PlayerPhotoUpload,
  TeamLogoUpload,
} from "../api/api-client";
import { fetchRemoteRasterImage } from "../security/remote-image";
import type { DiscordSessionService } from "./session.service";

const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

type RasterFetcher = typeof fetchRemoteRasterImage;

function channelTopic(interaction: ChatInputCommandInteraction) {
  const topic = (interaction.channel as { topic?: unknown } | null)?.topic;
  return typeof topic === "string" ? topic : null;
}

function requireGuildInteraction(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild || !interaction.guildId || !interaction.channelId) {
    throw new Error("Use this command inside its configured Arenzyra channel.");
  }
  return interaction.guild;
}

function requireLegacyMediaChannelPermissions(
  interaction: ChatInputCommandInteraction,
) {
  if (
    !interaction.memberPermissions?.has(PermissionFlagsBits.SendMessages) ||
    !interaction.memberPermissions.has(PermissionFlagsBits.AttachFiles)
  ) {
    throw new Error(
      "You need permission to send messages and attach files in this media channel.",
    );
  }
}

function rejectProductionMediaChannel(
  interaction: ChatInputCommandInteraction,
  legacyCommand: "%logo" | "%photo",
) {
  if (!channelTopic(interaction)?.toLowerCase().includes("arenzyra-production=")) {
    return;
  }
  throw new Error(
    `/team-media supports synced scrim/event media channels only. Keep using \`${legacyCommand}\` in production media channels.`,
  );
}

function isTeamNotFoundError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /team\s+not\s+found/i.test(message);
}

export class DiscordMediaInteractionService {
  constructor(
    private readonly sessionService: DiscordSessionService,
    private readonly rasterFetcher: RasterFetcher = fetchRemoteRasterImage,
  ) {}

  private async loadImage(
    attachment: Attachment,
    filename: string,
  ): Promise<TeamLogoUpload | PlayerPhotoUpload> {
    if (attachment.size > MAX_MEDIA_BYTES) {
      throw new Error("Image must be 8 MB or smaller.");
    }
    const { buffer, contentType } = await this.rasterFetcher(attachment.url, {
      maxBytes: MAX_MEDIA_BYTES,
    });
    return { buffer, filename, contentType };
  }

  async uploadLogo(
    interaction: ChatInputCommandInteraction,
    input: { teamName: string; tag: string | null; image: Attachment },
  ) {
    const guild = requireGuildInteraction(interaction);
    requireLegacyMediaChannelPermissions(interaction);
    rejectProductionMediaChannel(interaction, "%logo");
    const resolved = await this.sessionService.findScrimForLogoChannel(
      interaction.guildId!,
      interaction.channelId!,
      channelTopic(interaction),
    );
    if (!resolved) {
      throw new Error(
        "Use `/team-media logo` inside a synced scrim/event logo channel. Production logo channels continue using `%logo`.",
      );
    }

    const teamName = input.teamName.trim();
    const tag = input.tag?.trim() || null;
    if (!teamName) {
      throw new Error("Team name is required.");
    }
    const upload = (await this.loadImage(
      input.image,
      "team-logo.png",
    )) as TeamLogoUpload;
    const query = tag ? `${teamName} (${tag})` : teamName;
    let result: string;
    try {
      result = await this.sessionService.withOrganization(
        resolved.config.organizationId,
        () =>
          this.sessionService.updateTeamLogoFromDiscord(
            query,
            upload,
            resolved.config,
            null,
          ),
      );
    } catch (error) {
      if (isTeamNotFoundError(error)) {
        throw new Error(
          "Team not found. Register the team first, or use legacy `%logo` so Discord keeps a durable source message for a future registration.",
        );
      }
      throw error;
    }

    await this.sessionService.queueVisibleDiscordScrimRefreshForActiveGuildSessions(
      guild,
      resolved.config,
    );
    await this.sessionService
      .sendDiscordActionLog(guild, resolved.config, {
        action: "Team logo saved by interaction",
        actorDiscordId: interaction.user.id,
        actorLabel: interaction.user.tag || interaction.user.username,
        sourceChannelId: interaction.channelId!,
        sessionId: resolved.session.id,
        sessionName: resolved.session.name,
        team: { name: teamName, tag },
        status: "saved",
        details: result,
        color: 0x22c55e,
      })
      .catch((error) => {
        console.warn(`Team logo interaction log failed: ${String(error)}`);
      });
    return result;
  }

  async uploadPlayerPhoto(
    interaction: ChatInputCommandInteraction,
    input: {
      uid: string;
      teamName: string | null;
      playerName: string | null;
      image: Attachment;
    },
  ) {
    const guild = requireGuildInteraction(interaction);
    requireLegacyMediaChannelPermissions(interaction);
    rejectProductionMediaChannel(interaction, "%photo");
    const resolved = await this.sessionService.findScrimForPlayerPhotoChannel(
      interaction.guildId!,
      interaction.channelId!,
      channelTopic(interaction),
    );
    if (!resolved) {
      throw new Error(
        "Use `/team-media photo` inside a synced scrim/event player-photo channel. Production player-photo channels continue using `%photo`.",
      );
    }

    const uid = input.uid.trim().replace(/\s+/g, "");
    const teamName = input.teamName?.trim() || null;
    const playerName = input.playerName?.trim() || null;
    if (!uid) {
      throw new Error("Player UID is required.");
    }
    if (
      String(resolved.config.registrationMode ?? "SCRIM").toUpperCase() !==
        "TOURNAMENT" &&
      (!teamName || !playerName)
    ) {
      throw new Error(
        "Team name and player name are required outside tournament mode.",
      );
    }
    const upload = (await this.loadImage(
      input.image,
      "player-photo.png",
    )) as PlayerPhotoUpload;
    const result = await this.sessionService.withOrganization(
      resolved.config.organizationId,
      () =>
        this.sessionService.updatePlayerPhotoFromDiscord(
          { uid, teamName, playerName },
          upload,
          resolved.config,
        ),
    );

    this.sessionService.queueVisibleDiscordScrimRefresh(
      guild,
      resolved.session.id,
      resolved.config,
    );
    await this.sessionService
      .sendDiscordActionLog(guild, resolved.config, {
        action: "Player photo saved by interaction",
        actorDiscordId: interaction.user.id,
        actorLabel: interaction.user.tag || interaction.user.username,
        sourceChannelId: interaction.channelId!,
        sessionId: resolved.session.id,
        sessionName: resolved.session.name,
        team: teamName ? { name: teamName } : undefined,
        status: uid,
        details: result,
        color: 0x22c55e,
      })
      .catch((error) => {
        console.warn(`Player photo interaction log failed: ${String(error)}`);
      });
    return result;
  }
}
