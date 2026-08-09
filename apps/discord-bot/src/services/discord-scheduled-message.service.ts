import type { Client, Guild, GuildTextBasedChannel } from "discord.js";
import { ArenzyraApiClient } from "../api/api-client";

export class DiscordScheduledMessageService {
  private readonly apiClient = new ArenzyraApiClient();
  private schedulerTimer: NodeJS.Timeout | null = null;
  private schedulerRunning = false;

  private isTextChannel(channel: unknown): channel is GuildTextBasedChannel {
    return Boolean(
      channel &&
        typeof (channel as { isTextBased?: () => boolean }).isTextBased ===
          "function" &&
        (channel as { isTextBased: () => boolean }).isTextBased() &&
        typeof (channel as { send?: unknown }).send === "function",
    );
  }

  private allowedMentions(content: string) {
    const roleIds = Array.from(content.matchAll(/<@&(\d{17,22})>/g)).map(
      (match) => match[1],
    );
    return {
      parse: [] as [],
      ...(roleIds.length ? { roles: roleIds } : {}),
    };
  }

  private async deliverGuild(guild: Guild) {
    const linked = await this.apiClient.resolveDiscordGuild(guild.id);
    const due = await this.apiClient.withOrganization(linked.organizationId, () =>
      this.apiClient.listDueDiscordScheduledMessages(guild.id),
    );
    for (const pending of due.messages) {
      let claimed: Awaited<ReturnType<typeof this.apiClient.claimDiscordScheduledMessage>>;
      try {
        claimed = await this.apiClient.withOrganization(linked.organizationId, () =>
          this.apiClient.claimDiscordScheduledMessage(pending.id),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : "";
        if (!message.includes("no longer due")) {
          console.warn(`[ScheduledMessages] claim failed message=${pending.id}: ${String(error)}`);
        }
        continue;
      }

      const claimToken = claimed.claimToken?.trim();
      if (!claimToken) {
        console.warn(`[ScheduledMessages] missing claim token message=${claimed.id}`);
        continue;
      }

      try {
        const channel = await guild.channels.fetch(claimed.channelId).catch(() => null);
        if (!this.isTextChannel(channel)) {
          throw new Error("Configured channel is unavailable or not a text channel");
        }
        await channel.send({
          content: claimed.content,
          allowedMentions: this.allowedMentions(claimed.content),
        });
        await this.apiClient.withOrganization(linked.organizationId, () =>
          this.apiClient.markDiscordScheduledMessageSent(claimed.id, claimToken),
        );
      } catch (error) {
        const failure = error instanceof Error ? error.message : String(error);
        await this.apiClient
          .withOrganization(linked.organizationId, () =>
            this.apiClient.releaseDiscordScheduledMessage(
              claimed.id,
              claimToken,
              failure.slice(0, 500),
            ),
          )
          .catch((releaseError) => {
            console.warn(
              `[ScheduledMessages] failed to release message=${claimed.id}: ${String(releaseError)}`,
            );
          });
        console.warn(
          `[ScheduledMessages] delivery failed message=${claimed.id}: ${failure}`,
        );
      }
    }
  }

  private async runScheduler(client: Client) {
    if (this.schedulerRunning) return;
    this.schedulerRunning = true;
    try {
      for (const guild of client.guilds.cache.values()) {
        await this.deliverGuild(guild).catch((error) => {
          const message = error instanceof Error ? error.message.toLowerCase() : "";
          if (
            !message.includes("not linked") &&
            !message.includes("limited to discord management")
          ) {
            console.warn(
              `[ScheduledMessages] scheduler skipped guild=${guild.id}: ${String(error)}`,
            );
          }
        });
      }
    } finally {
      this.schedulerRunning = false;
    }
  }

  start(client: Client) {
    if (this.schedulerTimer) return;
    void this.runScheduler(client);
    this.schedulerTimer = setInterval(() => {
      void this.runScheduler(client);
    }, 30_000);
    this.schedulerTimer.unref?.();
  }

  stop() {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }
}
