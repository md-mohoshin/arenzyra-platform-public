import {
  ChannelType,
  PermissionFlagsBits,
  type CategoryChannel,
  type Client,
  type Guild,
  type Role,
  type TextChannel,
} from "discord.js";

const CATEGORY_NAME = "ARENZYRA BOT";
const TOPIC_PREFIX = "arenzyra-onboarding";
const MESSAGE_MARKER_PREFIX = "arenzyra-onboarding-message";
const DISCORD_MESSAGE_LIMIT = 2000;

type OnboardingVisibility = "public-readonly" | "staff";

type OnboardingChannelDefinition = {
  key: string;
  name: string;
  visibility: OnboardingVisibility;
  messages: string[];
};

type OnboardingOptions = {
  enabled: boolean;
  syncExistingGuilds: boolean;
};

function optionalBooleanEnv(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }
  return value === "1" || value === "true" || value === "yes";
}

function defaultOptions(): OnboardingOptions {
  return {
    enabled: optionalBooleanEnv("ARENZYRA_DISCORD_ONBOARDING_ENABLED", true),
    syncExistingGuilds: optionalBooleanEnv(
      "ARENZYRA_DISCORD_ONBOARDING_SYNC_EXISTING",
      true,
    ),
  };
}

function markerFor(key: string, index: number) {
  return `${MESSAGE_MARKER_PREFIX}:${key}:v1:${index}`;
}

function topicFor(key: string) {
  return `${TOPIC_PREFIX}:${key};managed=true;v=1`;
}

function withMarker(content: string, marker: string) {
  const suffix = `\n\n-# ${marker}`;
  const trimmed = content.trim();
  if (trimmed.length + suffix.length <= DISCORD_MESSAGE_LIMIT) {
    return `${trimmed}${suffix}`;
  }
  return `${trimmed
    .slice(0, DISCORD_MESSAGE_LIMIT - suffix.length - 3)
    .trimEnd()}...${suffix}`;
}

const ONBOARDING_CHANNELS: OnboardingChannelDefinition[] = [
  {
    key: "info",
    name: "arenzyra-info",
    visibility: "public-readonly",
    messages: [
      [
        "**Arenzyra**",
        "Discord tournament and scrim operations for registrations, slot lists, IDP access, results, bans, and staff controls.",
        "",
        "Website: https://arenzyra.com",
        "Contact: mailto:contact@arenzyra.com",
      ].join("\n"),
    ],
  },
  {
    key: "start",
    name: "arenzyra-start-here",
    visibility: "staff",
    messages: [
      [
        "**Arenzyra Discord Setup**",
        "",
        "1. Connect the Discord server from the Arenzyra web app.",
        "2. Create or open a scrim/session in the web app, then use the Discord setup/sync action for that session.",
        "3. Keep registration, slot-list, waitlist, IDP, bans, logs, and manage channels bot-controlled unless you intentionally customize them.",
        "4. Configure registration times, weekly schedules, slots, ban rules, no-show rules, and result format from the web app.",
        "5. Use `!open` and `!closed` in the registration channel when staff must override the schedule.",
        "6. Use `%stop` before manual emergency edits in a synced channel, then `%start` when the bot should resume.",
        "7. Use the bans channel and ban controls for team bans; the bot applies configured ban roles from Arenzyra.",
        "8. Use the web app as the source of truth for active sessions, roles, channels, bans, results, and subscription state.",
      ].join("\n"),
    ],
  },
  {
    key: "commands",
    name: "arenzyra-commands",
    visibility: "staff",
    messages: [
      [
        "**Slash Commands**",
        "",
        "`/production-setup` - Create approved production channels.",
        "`/production-pins` - Refresh pinned production-channel instructions.",
        "`/arenzyra-doctor` - Check one session's Discord setup.",
        "`/session-audit` - Audit a session and its Discord links.",
        "`/control-panel` - Post team, staff, or session manage controls.",
        "`/ban-control` - Post team ban controls for the current scrim.",
        "`/play-buttons` - Configure play-confirmation buttons.",
        "`/waitlist-control` - Post waitlist controls.",
        "`/schedule-event` - Publish a Discord event for a session.",
        "`/captain-panel` - Post captain controls for a session.",
        "`/live-center` - Post live-center controls for a session.",
        "`/register-team` - Register a team manually.",
        "`/join-scrim`, `/leave-scrim`, `/list-slots`, `/start-scrim`, `/standings` - Legacy scrim controls.",
        "`/map-slots`, `/preview-results`, `/apply-results` - Result and slot mapping from screenshots.",
        "`/ticket-panel`, `/ticket-open`, `/ticket-close` - Ticket workflow.",
        "`Arenzyra Ban Manager` - Message context menu for ban actions.",
      ].join("\n"),
      [
        "**Channel Text Commands**",
        "",
        "`%start` - Resume Arenzyra bot activity in the channel.",
        "`%stop` - Pause Arenzyra bot activity in the channel.",
        "`!open` - Force registration open, overriding schedule.",
        "`!closed` or `!close` - Force registration closed, overriding schedule.",
        "`!open waitlist`, `%open-waitlist` - Open waitlist.",
        "`!closed waitlist`, `%closed-waitlist` - Close waitlist.",
        "`%register ...` - Register a team from the registration channel.",
        "`%manager ...` - Add a manager.",
        "`%remove ...` - Remove a manager/registration target.",
        "`%logo ...` - Attach or update a team logo.",
        "`%photo ...` - Attach or update player photos.",
        "`%sync-old-logos [limit]`, `%sync-old-photos [limit]` - Import older media from channel history.",
        "`%clean slot <number>` - Clean one slot and related access.",
        "`%clean all slots` - Clean all slots and related access.",
        "`%clean waitlist` - Clean waitlist.",
        "`%clean scrim roles [all|strip]` - Clean scrim roles.",
        "`%clean-channel` - Clean managed bot messages in the channel.",
        "`%ban`, `%ban-team`, `%team-ban` - Ban team flow.",
        "`%ban-list`, `%team-bans` - Show active team bans.",
        "`%unban`, `%unban-team`, `%team-unban` - Remove team bans.",
        "`%ban-missing`, `%ban-no-shows` - Apply no-show bans.",
        "`%result-summary ...` - Configure result summary text.",
        "`%confirm slot <number>` - Confirm a slot.",
        "`%slot status on|off` - Toggle slot status replies.",
        "`free slots` - Ask the bot for open slots.",
      ].join("\n"),
    ],
  },
  {
    key: "control",
    name: "arenzyra-control",
    visibility: "staff",
    messages: [
      [
        "**Admin Control Rules**",
        "",
        "Only server admins, Manage Server roles, Manage Channels roles, and the bot can view or write here.",
        "",
        "Use this channel for staff notes and for posting control panels. Keep public registration commands inside the synced registration channel so the bot can resolve the correct session.",
        "",
        "Recommended emergency flow:",
        "1. Send `%stop` in the affected synced channel.",
        "2. Fix the session, team, role, schedule, or ban rule in the web app.",
        "3. Re-sync or refresh from the web app when needed.",
        "4. Send `%start` in the affected synced channel.",
        "5. Run `/arenzyra-doctor` or `/session-audit` if anything still looks out of sync.",
      ].join("\n"),
    ],
  },
];

export class DiscordOnboardingService {
  private existingGuildSyncStarted = false;

  constructor(private readonly options = defaultOptions()) {}

  start(client: Client<true>) {
    if (!this.options.enabled || !this.options.syncExistingGuilds) {
      return;
    }
    if (this.existingGuildSyncStarted) {
      return;
    }
    this.existingGuildSyncStarted = true;
    void this.syncExistingGuilds(client).catch((error) => {
      console.warn(`[DiscordOnboarding] existing guild sync failed: ${String(error)}`);
    });
  }

  async ensureGuildOnboarding(guild: Guild) {
    if (!this.options.enabled) {
      return false;
    }

    const canManageChannels = await this.botCanManageChannels(guild);
    if (!canManageChannels) {
      console.warn(
        `[DiscordOnboarding] skipped guild=${guild.id} name="${guild.name}" because the bot lacks Manage Channels`,
      );
      return false;
    }

    await guild.channels.fetch().catch((error) => {
      console.warn(
        `[DiscordOnboarding] channel fetch failed guild=${guild.id}: ${String(error)}`,
      );
      return undefined;
    });
    await guild.roles.fetch().catch((error) => {
      console.warn(
        `[DiscordOnboarding] role fetch failed guild=${guild.id}: ${String(error)}`,
      );
      return undefined;
    });

    const category = await this.ensureCategory(guild);
    const staffRoles = this.staffRoles(guild);
    for (const definition of ONBOARDING_CHANNELS) {
      const channel = await this.ensureTextChannel(
        guild,
        category,
        definition,
        staffRoles,
      );
      await this.syncMessages(channel, definition);
    }

    console.log(
      `[DiscordOnboarding] synced guild=${guild.id} name="${guild.name}" channels=${ONBOARDING_CHANNELS.length}`,
    );
    return true;
  }

  private async syncExistingGuilds(client: Client<true>) {
    for (const guild of client.guilds.cache.values()) {
      await this.ensureGuildOnboarding(guild).catch((error) => {
        console.warn(
          `[DiscordOnboarding] failed guild=${guild.id} name="${guild.name}": ${String(
            error,
          )}`,
        );
      });
    }
  }

  private async botCanManageChannels(guild: Guild) {
    const member =
      guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
    return Boolean(member?.permissions.has(PermissionFlagsBits.ManageChannels));
  }

  private async ensureCategory(guild: Guild) {
    const existing = guild.channels.cache.find(
      (channel): channel is CategoryChannel =>
        channel.type === ChannelType.GuildCategory &&
        channel.name.toLowerCase() === CATEGORY_NAME.toLowerCase(),
    );
    if (existing) {
      return existing;
    }

    const created = await guild.channels.create({
      name: CATEGORY_NAME,
      type: ChannelType.GuildCategory,
      reason: "Create Arenzyra Discord onboarding category",
    });
    return created as CategoryChannel;
  }

  private async ensureTextChannel(
    guild: Guild,
    category: CategoryChannel,
    definition: OnboardingChannelDefinition,
    staffRoles: Map<string, Role>,
  ) {
    const topic = topicFor(definition.key);
    const existing = guild.channels.cache.find(
      (channel): channel is TextChannel =>
        channel.type === ChannelType.GuildText &&
        ((channel.topic ?? "").includes(`${TOPIC_PREFIX}:${definition.key}`) ||
          (channel.parentId === category.id && channel.name === definition.name)),
    );
    const permissionOverwrites = this.permissionOverwrites(
      guild,
      definition.visibility,
      staffRoles,
    );

    if (!existing) {
      const created = await guild.channels.create({
        name: definition.name,
        type: ChannelType.GuildText,
        parent: category.id,
        topic,
        permissionOverwrites,
        reason: "Create Arenzyra Discord onboarding channel",
      });
      return created as TextChannel;
    }

    if (existing.parentId !== category.id) {
      await existing
        .setParent(category.id, {
          lockPermissions: false,
          reason: "Move Arenzyra onboarding channel into managed category",
        })
        .catch((error) => {
          console.warn(
            `[DiscordOnboarding] failed to move channel=${existing.id}: ${String(
              error,
            )}`,
          );
        });
    }
    if (existing.topic !== topic) {
      await existing.setTopic(topic, "Refresh Arenzyra onboarding topic").catch(
        (error) => {
          console.warn(
            `[DiscordOnboarding] failed to refresh topic channel=${existing.id}: ${String(
              error,
            )}`,
          );
        },
      );
    }
    await existing.permissionOverwrites
      .set(permissionOverwrites, "Refresh Arenzyra onboarding permissions")
      .catch((error) => {
        console.warn(
          `[DiscordOnboarding] failed to refresh permissions channel=${existing.id}: ${String(
            error,
          )}`,
        );
      });
    return existing;
  }

  private permissionOverwrites(
    guild: Guild,
    visibility: OnboardingVisibility,
    staffRoles: Map<string, Role>,
  ) {
    const botUserId = guild.client.user?.id ?? guild.members.me?.id ?? null;
    const staffAllow = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.CreatePrivateThreads,
      PermissionFlagsBits.SendMessagesInThreads,
    ];
    const botAllow = [
      ...staffAllow,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.ManageChannels,
    ];
    const memberDeny = [
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.CreatePrivateThreads,
      PermissionFlagsBits.SendMessagesInThreads,
    ];
    const overwrites = [
      visibility === "staff"
        ? {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel],
          }
        : {
            id: guild.roles.everyone.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.ReadMessageHistory,
            ],
            deny: memberDeny,
          },
      ...[...staffRoles.values()].map((role) => ({
        id: role.id,
        allow: staffAllow,
      })),
    ];
    if (botUserId) {
      overwrites.push({
        id: botUserId,
        allow: botAllow,
      });
    }
    return overwrites;
  }

  private staffRoles(guild: Guild) {
    const roles = new Map<string, Role>();
    for (const role of guild.roles.cache.values()) {
      if (role.id === guild.roles.everyone.id) {
        continue;
      }
      if (
        role.permissions.has(PermissionFlagsBits.Administrator) ||
        role.permissions.has(PermissionFlagsBits.ManageGuild) ||
        role.permissions.has(PermissionFlagsBits.ManageChannels)
      ) {
        roles.set(role.id, role);
      }
    }
    return roles;
  }

  private async syncMessages(
    channel: TextChannel,
    definition: OnboardingChannelDefinition,
  ) {
    const messages = await channel.messages.fetch({ limit: 50 }).catch(
      (error) => {
        console.warn(
          `[DiscordOnboarding] failed to fetch messages channel=${channel.id}: ${String(
            error,
          )}`,
        );
        return null;
      },
    );
    const botUserId = channel.client.user?.id;
    const managedMessages = messages
      ? [...messages.values()].filter(
          (message) =>
            message.author.id === botUserId &&
            message.content.includes(`${MESSAGE_MARKER_PREFIX}:${definition.key}:`),
        )
      : [];

    const expectedMarkers = new Set<string>();
    for (const [index, body] of definition.messages.entries()) {
      const marker = markerFor(definition.key, index + 1);
      expectedMarkers.add(marker);
      const content = withMarker(body, marker);
      const existing = managedMessages.find((message) =>
        message.content.includes(marker),
      );
      if (existing) {
        if (existing.content !== content) {
          await existing.edit({
            content,
            allowedMentions: { parse: [] },
          });
        }
      } else {
        await channel.send({
          content,
          allowedMentions: { parse: [] },
        });
      }
    }

    for (const message of managedMessages) {
      const isExpected = [...expectedMarkers].some((marker) =>
        message.content.includes(marker),
      );
      if (!isExpected) {
        await message.delete().catch(() => undefined);
      }
    }
  }
}
