import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type {
  ConfigurePlayButtonsOptions,
  DiscordSessionService,
  PlayButtonStyleName,
  PlayControlMode,
} from '../services/session.service';

const STAFF_ROLE_NAMES = [
  '[OWNER]',
  'Arenzyra Admin',
  'Arenzyra Staff',
  'Production Lead',
  'Tournament Organizer',
];

const STYLE_CHOICES = [
  { name: 'Green', value: 'success' },
  { name: 'Red', value: 'danger' },
  { name: 'Blue', value: 'primary' },
  { name: 'Gray', value: 'secondary' },
] as const;

const CONTROL_MODE_CHOICES = [
  { name: 'Buttons', value: 'buttons' },
  { name: 'Reactions', value: 'reactions' },
  { name: 'Both', value: 'both' },
  { name: 'Off', value: 'off' },
] as const;
const ACTION_CONFIRMATION_DELETE_DELAY_MS = 2000;

async function canUsePlayButtonsCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.inGuild()) {
    return false;
  }

  const member = await interaction.guild!.members.fetch(interaction.user.id);
  if (
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    member.permissions.has(PermissionFlagsBits.ManageChannels)
  ) {
    return true;
  }

  return STAFF_ROLE_NAMES.some((roleName) =>
    member.roles.cache.some((role) => role.name === roleName),
  );
}

export const playButtonsCommand = {
  data: new SlashCommandBuilder()
    .setName('play-buttons')
    .setDescription('Customize play-status controls for this slot list')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('Use buttons, reactions, both, or turn controls off')
        .addChoices(...CONTROL_MODE_CHOICES),
    )
    .addStringOption((option) =>
      option
        .setName('confirm_emoji')
        .setDescription('Emoji for Confirm, e.g. ✅ or <:yes:123>'),
    )
    .addStringOption((option) =>
      option
        .setName('not_playing_emoji')
        .setDescription('Emoji for Not Playing, e.g. ❌ or <:no:123>'),
    )
    .addBooleanOption((option) =>
      option
        .setName('emoji_only')
        .setDescription('Remove button labels and show only emojis'),
    )
    .addStringOption((option) =>
      option
        .setName('confirm_label')
        .setDescription('Confirm button text; use none to clear'),
    )
    .addStringOption((option) =>
      option
        .setName('not_playing_label')
        .setDescription('Not Playing button text; use none to clear'),
    )
    .addStringOption((option) =>
      option
        .setName('confirm_style')
        .setDescription('Confirm button color')
        .addChoices(...STYLE_CHOICES),
    )
    .addStringOption((option) =>
      option
        .setName('not_playing_style')
        .setDescription('Not Playing button color')
        .addChoices(...STYLE_CHOICES),
    )
    .addBooleanOption((option) =>
      option
        .setName('show_buttons')
        .setDescription('Show or hide the play-status buttons'),
    ),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { sessionService: DiscordSessionService },
  ) {
    if (!(await canUsePlayButtonsCommand(interaction))) {
      await interaction.reply({
        content: 'Only Arenzyra staff can customize play buttons.',
        ephemeral: true,
      });
      return;
    }

    if (!interaction.guild || !interaction.channelId) {
      await interaction.reply({
        content: 'Use this command inside the Discord server slot-list channel.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const options: ConfigurePlayButtonsOptions = {
      controlMode: interaction.options.getString('mode') as PlayControlMode | null,
      confirmEmoji: interaction.options.getString('confirm_emoji'),
      notPlayingEmoji: interaction.options.getString('not_playing_emoji'),
      confirmLabel: interaction.options.getString('confirm_label'),
      notPlayingLabel: interaction.options.getString('not_playing_label'),
      confirmStyle: interaction.options.getString(
        'confirm_style',
      ) as PlayButtonStyleName | null,
      notPlayingStyle: interaction.options.getString(
        'not_playing_style',
      ) as PlayButtonStyleName | null,
      showButtons: interaction.options.getBoolean('show_buttons'),
      emojiOnly: interaction.options.getBoolean('emoji_only'),
    };
    const content =
      await services.sessionService.configurePlayButtonsForSlotListChannel(
        interaction.guild,
        interaction.channelId,
        options,
      );
    await interaction.editReply(content);
    setTimeout(() => {
      void interaction.deleteReply().catch(() => undefined);
    }, ACTION_CONFIRMATION_DELETE_DELAY_MS).unref?.();
  },
};
