import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  type User,
} from 'discord.js';
import type { DiscordSessionService } from '../services/session.service';

function optionalUser(
  interaction: ChatInputCommandInteraction,
  name: string,
): User | null {
  return interaction.options.getUser(name);
}

export const registerTeamCommand = {
  data: new SlashCommandBuilder()
    .setName('register-team')
    .setDescription('Register a Discord-managed team for Arenzyra scrims')
    .addStringOption((option) =>
      option.setName('tag').setDescription('Team tag').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('team-name')
        .setDescription('Team name')
        .setRequired(true),
    )
    .addUserOption((option) =>
      option
        .setName('member-1')
        .setDescription('Optional player mention'),
    )
    .addUserOption((option) =>
      option
        .setName('member-2')
        .setDescription('Optional player mention'),
    )
    .addUserOption((option) =>
      option
        .setName('member-3')
        .setDescription('Optional player mention'),
    )
    .addUserOption((option) =>
      option
        .setName('member-4')
        .setDescription('Optional player mention'),
    )
    .addUserOption((option) =>
      option
        .setName('member-5')
        .setDescription('Optional player mention'),
    ),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { sessionService: DiscordSessionService },
  ) {
    await interaction.deferReply();

    const tag = interaction.options.getString('tag', true);
    const teamName = interaction.options.getString('team-name', true);
    const members = [
      optionalUser(interaction, 'member-1'),
      optionalUser(interaction, 'member-2'),
      optionalUser(interaction, 'member-3'),
      optionalUser(interaction, 'member-4'),
      optionalUser(interaction, 'member-5'),
    ]
      .filter((user): user is User => Boolean(user))
      .map((user) => ({
        discordUserId: user.id,
        discordUsername: user.username,
        displayName: user.globalName ?? null,
      }));

    const content = await services.sessionService.registerTeam(
      interaction.user.id,
      interaction.user.username,
      interaction.user.globalName ?? null,
      tag,
      teamName,
      members,
      interaction.guild,
    );

    await interaction.editReply(content);
  },
};
