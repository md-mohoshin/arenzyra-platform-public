import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Guild,
  GuildMember,
  PermissionFlagsBits,
  type Role,
  SlashCommandStringOption,
  TextChannel,
} from 'discord.js';

export const TICKET_CATEGORY_NAME = 'SUPPORT TICKETS';
export const TICKET_PANEL_CHANNEL_NAME = 'create-ticket';
const TICKET_DELETE_DELAY_MS = 60_000;

export const TICKET_KINDS = [
  {
    id: 'launcher',
    label: 'Launcher / setup',
    description: 'Launcher install, setup, login, or production mode access.',
  },
  {
    id: 'telemetry',
    label: 'Telemetry / observer',
    description: 'Observer ingest, live state, map overlay, or telemetry issues.',
  },
  {
    id: 'tournament',
    label: 'Tournament ops',
    description: 'Tournament setup, match schedule, slots, or organizer workflow.',
  },
  {
    id: 'team',
    label: 'Team registration',
    description: 'Team, player, PUBG UID, roster, or slot registration help.',
  },
  {
    id: 'bug',
    label: 'Private bug report',
    description: 'Bug report that includes logs, private screenshots, or match IDs.',
  },
  {
    id: 'other',
    label: 'Other support',
    description: 'Anything that does not fit the other ticket types.',
  },
] as const;

type TicketKindId = (typeof TICKET_KINDS)[number]['id'];

type TicketInteraction = ChatInputCommandInteraction | ButtonInteraction;

const SUPPORT_ROLE_NAMES = [
  '[OWNER]',
  'Arenzyra Admin',
  'Arenzyra Staff',
  'Production Lead',
  'Tournament Organizer',
  'Observer Crew',
  'Broadcast Crew',
];

const TICKET_TOPIC_PREFIX = 'Arenzyra support ticket';

export function addTicketTypeChoices(option: SlashCommandStringOption) {
  return TICKET_KINDS.reduce(
    (builder, kind) =>
      builder.addChoices({
        name: kind.label,
        value: kind.id,
      }),
    option,
  );
}

function sanitizeChannelName(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return normalized || 'user';
}

function ticketKindFromId(value: string | null | undefined) {
  return TICKET_KINDS.find((kind) => kind.id === value) ?? TICKET_KINDS.at(-1)!;
}

function ticketTopic(params: {
  ownerId: string;
  kindId: string;
  status: 'open' | 'closed';
}) {
  return `${TICKET_TOPIC_PREFIX} | ticketOwner=${params.ownerId} | kind=${params.kindId} | status=${params.status}`;
}

function extractTopicField(topic: string | null | undefined, field: string) {
  const pattern = new RegExp(`${field}=([^|]+)`);
  const match = pattern.exec(topic ?? '');
  return match?.[1]?.trim() ?? null;
}

function isTicketChannel(channel: unknown): channel is TextChannel {
  const candidate = channel as TextChannel | null;
  return Boolean(
    candidate?.type === ChannelType.GuildText &&
      candidate.topic?.startsWith(TICKET_TOPIC_PREFIX),
  );
}

export class TicketService {
  buildTicketPanelMessage() {
    const embed = new EmbedBuilder()
      .setColor(0x16a34a)
      .setTitle('Open An Arenzyra Support Ticket')
      .setDescription(
        'Use tickets for private or actionable support: launcher setup, observer telemetry, tournament operations, team registration, or bug reports with logs/screenshots.',
      )
      .addFields(
        {
          name: 'Before opening',
          value:
            'Use public channels for general questions. Open a ticket when staff need private details, match IDs, logs, or screenshots.',
        },
        {
          name: 'What to include',
          value:
            'Issue type, tournament/match ID if available, screenshots, logs, expected behavior, and actual behavior.',
        },
      )
      .setFooter({ text: 'Arenzyra PUBG Production Support' })
      .setTimestamp(new Date());

    const rows = [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket:create:launcher')
          .setLabel('Launcher / setup')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('ticket:create:telemetry')
          .setLabel('Telemetry / observer')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('ticket:create:tournament')
          .setLabel('Tournament ops')
          .setStyle(ButtonStyle.Secondary),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket:create:team')
          .setLabel('Team registration')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('ticket:create:bug')
          .setLabel('Private bug report')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('ticket:create:other')
          .setLabel('Other support')
          .setStyle(ButtonStyle.Secondary),
      ),
    ];

    return {
      embeds: [embed],
      components: rows,
      allowedMentions: { parse: [] },
    };
  }

  async postTicketPanel(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: 'Ticket panels can only be posted inside a server.',
        ephemeral: true,
      });
      return;
    }

    const member = await interaction.guild!.members.fetch(interaction.user.id);
    if (!this.canManageTickets(member)) {
      await interaction.reply({
        content: 'Only Arenzyra staff can post the ticket panel.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const channel = interaction.channel;
    if (!channel?.isTextBased()) {
      await interaction.editReply('Run this command in a text channel.');
      return;
    }

    const panel = await channel.send(this.buildTicketPanelMessage());
    try {
      await panel.pin('Pin Arenzyra ticket panel');
    } catch {
      // Pinning is helpful but not required for ticket operation.
    }
    await interaction.editReply(`Ticket panel posted in <#${channel.id}>.`);
  }

  async openTicketFromCommand(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: 'Tickets can only be opened inside a server.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const kind = ticketKindFromId(interaction.options.getString('type'));
    const summary = interaction.options.getString('summary') ?? undefined;
    const channel = await this.createTicketChannel(interaction, kind.id, summary);
    await interaction.editReply(`Ticket created: <#${channel.id}>`);
  }

  async openTicketFromButton(interaction: ButtonInteraction, kindId: string) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: 'Tickets can only be opened inside a server.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const kind = ticketKindFromId(kindId);
    const channel = await this.createTicketChannel(interaction, kind.id);
    await interaction.editReply(`Ticket created: <#${channel.id}>`);
  }

  async closeTicket(interaction: TicketInteraction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: 'Tickets can only be closed inside a server.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const channel = interaction.channel;
    if (!isTicketChannel(channel)) {
      await interaction.editReply('This command can only be used inside a ticket channel.');
      return;
    }

    const guild = interaction.guild!;
    const member = await guild.members.fetch(interaction.user.id);
    const ownerId = extractTopicField(channel.topic, 'ticketOwner');
    const canClose = ownerId === interaction.user.id || this.canManageTickets(member);
    if (!canClose) {
      await interaction.editReply('Only the ticket owner or Arenzyra staff can close this ticket.');
      return;
    }

    if (ownerId) {
      await channel.permissionOverwrites
        .edit(ownerId, {
          ViewChannel: false,
          SendMessages: false,
          ReadMessageHistory: false,
        })
        .catch(() => undefined);
    }

    const kindId = extractTopicField(channel.topic, 'kind') ?? 'other';
    await channel
      .edit({
        name: channel.name.startsWith('closed-')
          ? channel.name
          : `closed-${channel.name}`.slice(0, 100),
        topic: ticketTopic({ ownerId: ownerId ?? interaction.user.id, kindId, status: 'closed' }),
      })
      .catch(() => undefined);

    const embed = new EmbedBuilder()
      .setColor(0x64748b)
      .setTitle('Ticket Closed')
      .setDescription(
        `Closed by <@${interaction.user.id}>. This channel will be deleted in 1 minute.`,
      )
      .setTimestamp(new Date());
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    this.scheduleTicketDeletion(channel);
    await interaction.editReply('Ticket closed. This channel will be deleted in 1 minute.');
  }

  async handleButton(interaction: ButtonInteraction) {
    if (interaction.customId.startsWith('ticket:create:')) {
      const kindId = interaction.customId.split(':').at(2) as TicketKindId | undefined;
      await this.openTicketFromButton(interaction, kindId ?? 'other');
      return true;
    }

    if (interaction.customId === 'ticket:close') {
      await this.closeTicket(interaction);
      return true;
    }

    return false;
  }

  private async createTicketChannel(
    interaction: TicketInteraction,
    kindId: TicketKindId,
    summary?: string,
  ) {
    const guild = interaction.guild!;
    await guild.channels.fetch();
    await guild.roles.fetch();

    const existing = guild.channels.cache.find(
      (channel) =>
        isTicketChannel(channel) &&
        extractTopicField(channel.topic, 'ticketOwner') === interaction.user.id &&
        extractTopicField(channel.topic, 'status') !== 'closed',
    );
    if (isTicketChannel(existing)) {
      return existing;
    }

    const category = await this.ensureTicketCategory(guild);
    const supportRoles = this.supportRoles(guild);
    const ticketKind = ticketKindFromId(kindId);
    const username = sanitizeChannelName(interaction.user.username);

    const channel = await guild.channels.create({
      name: `ticket-${username}`,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: ticketTopic({
        ownerId: interaction.user.id,
        kindId,
        status: 'open',
      }),
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
          ],
        },
        ...supportRoles.map((role) => ({
          id: role.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ManageMessages,
          ],
        })),
      ],
      reason: `Arenzyra support ticket opened by ${interaction.user.tag}`,
    });

    const closeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket:close')
        .setLabel('Close ticket')
        .setStyle(ButtonStyle.Danger),
    );

    const embed = new EmbedBuilder()
      .setColor(0x16a34a)
      .setTitle(`${ticketKind.label} Ticket`)
      .setDescription(
        'Arenzyra staff will respond here. Add the details below so the issue can be reproduced or routed correctly.',
      )
      .addFields(
        { name: 'Opened by', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Type', value: ticketKind.label, inline: true },
        {
          name: 'Required details',
          value:
            'Tournament/match ID if available, screenshot or video, logs, expected behavior, actual behavior, and what you already tried.',
        },
      )
      .setFooter({ text: 'Arenzyra PUBG Production Support' })
      .setTimestamp(new Date());

    if (summary?.trim()) {
      embed.addFields({ name: 'Summary', value: summary.trim().slice(0, 1024) });
    }

    await channel.send({
      content: `<@${interaction.user.id}>`,
      embeds: [embed],
      components: [closeRow],
      allowedMentions: { users: [interaction.user.id], roles: [] },
    });

    return channel;
  }

  private async ensureTicketCategory(guild: Guild) {
    const existing = guild.channels.cache.find(
      (channel) =>
        channel.type === ChannelType.GuildCategory &&
        channel.name === TICKET_CATEGORY_NAME,
    );
    if (existing?.type === ChannelType.GuildCategory) {
      return existing;
    }

    const supportRoles = this.supportRoles(guild);
    return guild.channels.create({
      name: TICKET_CATEGORY_NAME,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.Connect,
          ],
        },
        ...supportRoles.map((role) => ({
          id: role.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        })),
      ],
      reason: 'Arenzyra support ticket category setup',
    });
  }

  private supportRoles(guild: Guild): Role[] {
    return SUPPORT_ROLE_NAMES.map((name) =>
      guild.roles.cache.find((role) => role.name === name),
    ).filter((role): role is Role => Boolean(role));
  }

  private canManageTickets(member: GuildMember) {
    if (member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return true;
    }
    return SUPPORT_ROLE_NAMES.some((roleName) =>
      member.roles.cache.some((role) => role.name === roleName),
    );
  }

  private scheduleTicketDeletion(channel: TextChannel) {
    setTimeout(() => {
      channel.delete('Arenzyra ticket closed; deleting after 1 minute').catch(() => undefined);
    }, TICKET_DELETE_DELAY_MS);
  }
}
