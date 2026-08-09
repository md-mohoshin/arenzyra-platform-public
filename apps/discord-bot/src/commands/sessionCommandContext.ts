import type {
  ChatInputCommandInteraction,
  Guild,
  GuildBasedChannel,
} from "discord.js";
import type { DiscordSessionService } from "../services/session.service";

type ConfiguredSessionContext = NonNullable<
  Awaited<
    ReturnType<DiscordSessionService["findConfiguredScrimForDiscordChannel"]>
  >
>;

export type CommandSessionContext = {
  session: ConfiguredSessionContext["session"];
  config: ConfiguredSessionContext["config"];
  channelKind: string | null;
};

export function channelTopic(channel: unknown): string | null {
  if (!channel || typeof channel !== "object" || !("topic" in channel)) {
    return null;
  }
  const topic = (channel as { topic?: unknown }).topic;
  return typeof topic === "string" ? topic : null;
}

function requireGuild(interaction: ChatInputCommandInteraction): Guild {
  if (!interaction.guild) {
    throw new Error("Use this command inside a Discord server.");
  }
  return interaction.guild;
}

export async function resolveCommandSession(
  interaction: ChatInputCommandInteraction,
  sessionService: DiscordSessionService,
  options: {
    sessionId?: string | null;
    channel?: Pick<GuildBasedChannel, "id"> | null;
  } = {},
): Promise<CommandSessionContext> {
  const guild = requireGuild(interaction);
  const sessionId = options.sessionId?.trim() || null;

  if (sessionId) {
    const organizationId = await sessionService.resolveOrganizationIdForGuild(
      guild.id,
    );
    if (!organizationId) {
      throw new Error(
        "This Discord server is not linked to an Arenzyra organization.",
      );
    }
    const context = await sessionService.withOrganization(organizationId, () =>
      sessionService.getSessionContext(sessionId),
    );
    if (
      context.session.type !== "SCRIM" ||
      context.config.enabled === false ||
      context.config.guildId !== guild.id ||
      context.config.organizationId !== organizationId
    ) {
      throw new Error(
        "That session is not a configured Arenzyra scrim for this Discord server.",
      );
    }
    return { ...context, channelKind: null };
  }

  const targetChannel = options.channel ?? interaction.channel;
  const channelId = targetChannel?.id ?? interaction.channelId;
  if (!channelId) {
    throw new Error(
      "Choose a configured Arenzyra channel or provide a session ID.",
    );
  }

  const resolved = await sessionService.findConfiguredScrimForDiscordChannel(
    guild.id,
    channelId,
    channelTopic(targetChannel),
  );
  if (!resolved) {
    throw new Error(
      "Use this command in a configured Arenzyra session channel or provide a session ID.",
    );
  }
  return resolved;
}

export async function requireConfiguredTextChannel(
  guild: Guild,
  channelId: string | null | undefined,
  label: string,
) {
  const cleanChannelId = channelId?.trim();
  if (!cleanChannelId) {
    throw new Error(`${label} is not configured for this session.`);
  }
  const channel = await guild.channels.fetch(cleanChannelId).catch(() => null);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    throw new Error(`${label} is configured but is not available in this server.`);
  }
  return channel;
}

export function interactionAudit(
  interaction: ChatInputCommandInteraction,
  sessionName: string | null | undefined,
) {
  return {
    actorDiscordId: interaction.user.id,
    actorLabel:
      interaction.user.tag || interaction.user.username || interaction.user.id,
    sourceChannelId: interaction.channelId ?? null,
    sessionName: sessionName ?? null,
  };
}
