import {
  Collection,
  EmbedBuilder,
  type Client,
  type GuildTextBasedChannel,
  type Message,
} from "discord.js";

const PROMO_MARKER = "Arenzyra streaming pricing promo";
const PRICING_PLAN_MARKER = "Arenzyra Official pricing plan";
const DEFAULT_TIME_ZONE = "Europe/Bucharest";
const SCHEDULED_TIMES = [
  { hour: 11, minute: 0, label: "11:00" },
  { hour: 19, minute: 0, label: "19:00" },
] as const;

type ScheduledTime = (typeof SCHEDULED_TIMES)[number];

type DueSchedule = {
  key: string;
  dateKey: string;
  timeLabel: string;
};

type OfficialPricingPromoOptions = {
  enabled: boolean;
  guildId: string;
  channelId: string;
  pricingMessageId: string;
  timeZone: string;
  pollMs: number;
};

type FetchedMessages = Collection<string, Message>;

function optionalEnv(name: string, fallback: string) {
  return process.env[name]?.trim() || fallback;
}

function optionalBooleanEnv(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }
  return value === "1" || value === "true" || value === "yes";
}

function defaultOptions(): OfficialPricingPromoOptions {
  return {
    enabled: optionalBooleanEnv(
      "ARENZYRA_OFFICIAL_PRICING_PROMO_ENABLED",
      false,
    ),
    guildId: optionalEnv("ARENZYRA_OFFICIAL_GUILD_ID", ""),
    channelId: optionalEnv("ARENZYRA_OFFICIAL_PRICING_CHANNEL_ID", ""),
    pricingMessageId: optionalEnv("ARENZYRA_OFFICIAL_PRICING_MESSAGE_ID", ""),
    timeZone: optionalEnv(
      "ARENZYRA_OFFICIAL_PRICING_TIME_ZONE",
      DEFAULT_TIME_ZONE,
    ),
    pollMs: 15_000,
  };
}

export class OfficialPricingPromoService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastRunKey: string | null = null;

  constructor(private readonly options = defaultOptions()) {}

  start(client: Client) {
    if (!this.options.enabled || this.timer) {
      return;
    }
    if (!this.options.guildId || !this.options.channelId) {
      console.warn(
        "[OfficialPricingPromo] disabled: explicit guild and channel IDs are required",
      );
      return;
    }
    void this.runOnce(client).catch((error) => {
      console.warn(
        `[OfficialPricingPromo] startup check failed: ${String(error)}`,
      );
    });
    this.timer = setInterval(() => {
      void this.runOnce(client).catch((error) => {
        console.warn(
          `[OfficialPricingPromo] scheduled send failed: ${String(error)}`,
        );
      });
    }, this.options.pollMs);
    this.timer.unref?.();
    console.log(
      `[OfficialPricingPromo] scheduled for 11:00 and 19:00 ${this.options.timeZone} channel=${this.options.channelId}`,
    );
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(client: Client, now = new Date()) {
    const due = this.dueSchedule(now);
    if (!due || this.running || this.lastRunKey === due.key) {
      return false;
    }
    this.running = true;
    try {
      await this.publish(client, due);
      this.lastRunKey = due.key;
      return true;
    } finally {
      this.running = false;
    }
  }

  dueSchedule(now: Date): DueSchedule | null {
    const parts = this.localParts(now);
    const due = SCHEDULED_TIMES.find(
      (time) => time.hour === parts.hour && time.minute === parts.minute,
    );
    if (!due) {
      return null;
    }
    const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
    return {
      key: `${dateKey}-${this.scheduleKey(due)}`,
      dateKey,
      timeLabel: due.label,
    };
  }

  private localParts(date: Date) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: this.options.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    return {
      year: values.year,
      month: values.month,
      day: values.day,
      hour: Number(values.hour),
      minute: Number(values.minute),
    };
  }

  private scheduleKey(time: ScheduledTime) {
    return `${String(time.hour).padStart(2, "0")}${String(time.minute).padStart(2, "0")}`;
  }

  private async publish(client: Client, due: DueSchedule) {
    const guild = await client.guilds.fetch(this.options.guildId);
    const channel = await guild.channels.fetch(this.options.channelId);
    if (!channel || !channel.isTextBased()) {
      throw new Error(
        `Pricing channel ${this.options.channelId} is not a text channel`,
      );
    }
    const textChannel = channel as GuildTextBasedChannel;
    const existing = await textChannel.messages.fetch({ limit: 50 });
    await this.refreshPinnedPricingMessage(
      textChannel,
      existing,
      client.user?.id ?? null,
    );

    const promoMessages = existing.filter((message) =>
      this.isPromoMessage(message, client.user?.id ?? null),
    );
    const currentMessage = promoMessages.find((message) =>
      message.embeds.some((embed) => embed.footer?.text?.includes(due.key)),
    );

    await Promise.all(
      promoMessages
        .filter((message) => message.id !== currentMessage?.id)
        .map((message) => message.delete().catch(() => null)),
    );

    if (currentMessage) {
      return;
    }

    await textChannel.send(this.promoPayload(due));
    console.log(
      `[OfficialPricingPromo] sent schedule=${due.key} channel=${this.options.channelId}`,
    );
  }

  private async refreshPinnedPricingMessage(
    channel: GuildTextBasedChannel,
    existing: FetchedMessages,
    botUserId: string | null,
  ) {
    let message =
      this.findPinnedPricingMessage(existing, botUserId) ??
      (await this.fetchConfiguredPricingMessage(channel).catch(() => null));

    if (message) {
      await message.edit(this.pricingPlanPayload());
      if (!message.pinned) {
        await message
          .pin("Refresh Arenzyra official pricing")
          .catch(() => null);
      }
      return message;
    }

    message = await channel.send(this.pricingPlanPayload());
    await message.pin("Pin Arenzyra official pricing").catch(() => null);
    return message;
  }

  private findPinnedPricingMessage(
    messages: FetchedMessages,
    botUserId: string | null,
  ) {
    if (!botUserId) {
      return null;
    }
    return (
      messages.find(
        (message) =>
          message.author.id === botUserId &&
          (message.id === this.options.pricingMessageId ||
            message.embeds.some(
              (embed) =>
                embed.title === "Arenzyra Pricing Plans" ||
                embed.footer?.text?.includes(PRICING_PLAN_MARKER),
            )),
      ) ?? null
    );
  }

  private async fetchConfiguredPricingMessage(channel: GuildTextBasedChannel) {
    if (!this.options.pricingMessageId) {
      return null;
    }
    return channel.messages.fetch(this.options.pricingMessageId);
  }

  private isPromoMessage(message: Message, botUserId: string | null) {
    if (!botUserId || message.author.id !== botUserId) {
      return false;
    }
    return message.embeds.some((embed) =>
      embed.footer?.text?.includes(PROMO_MARKER),
    );
  }

  promoPayload(due: DueSchedule) {
    const embed = new EmbedBuilder()
      .setColor(0x10bcd1)
      .setTitle("Arenzyra Assisted Streaming Review")
      .setDescription(
        "Live-event operations are not included in a monthly software plan and are not generally available. Request a reviewed scope and written quote before relying on Arenzyra for an event.",
      )
      .addFields(
        {
          name: "Availability",
          value:
            "Arenzyra confirms operator capacity, event scope, supported workflow, and production readiness before quoting live support.",
          inline: false,
        },
        {
          name: "Publisher and telemetry boundary",
          value:
            "Arenzyra does not grant tournament, room, API, telemetry, or broadcast authorization. The organizer must hold every approval required for the event.",
          inline: false,
        },
        {
          name: "Booking",
          value:
            "Open a ticket in this server or contact Arenzyra staff before your event starts.",
          inline: false,
        },
      )
      .setFooter({
        text: `${PROMO_MARKER} | ${due.key} | ${this.options.timeZone}`,
      })
      .setTimestamp(new Date());

    return {
      content: "",
      embeds: [embed],
      allowedMentions: { parse: [] as [] },
    };
  }

  pricingPlanPayload() {
    const embed = new EmbedBuilder()
      .setColor(0x10bcd1)
      .setTitle("Arenzyra Pricing Plans")
      .setDescription(
        "Applications are reviewed manually. After setup approval, the 7-day trial starts only when the approved owner completes secure account setup for the prepared workspace. Auto Launcher is a request-only private pilot, not a generally available integration.",
      )
      .addFields(
        {
          name: "Discord Bot Pro",
          value:
            "$18.99/month - PUBG Mobile Discord registration, slots, OCR-assisted review, result posts, and manager workflows.",
          inline: false,
        },
        {
          name: "PUBG Production - Recommended",
          value:
            "$29.99/month - Web event and match control, Discord workflow, reviewed results, standings, and OBS-ready widgets.",
          inline: false,
        },
        {
          name: "Auto Launcher - Private Pilot",
          value:
            "$59.99/month when approved - Software access for a supported telemetry source. Custom integration, installer work, and live-event operations are quoted separately.",
          inline: false,
        },
      )
      .setFooter({ text: PRICING_PLAN_MARKER })
      .setTimestamp(new Date());

    return {
      content: "",
      embeds: [embed],
      allowedMentions: { parse: [] as [] },
    };
  }
}
