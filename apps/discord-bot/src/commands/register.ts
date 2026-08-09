import {
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
  type SlashCommandSubcommandBuilder,
  type User,
} from "discord.js";
import type {
  InteractionRegistrationInput,
  MessageRegistrationService,
} from "../services/message-registration.service";

function addTournamentPlayerOptions(
  command: SlashCommandSubcommandBuilder,
  prefix: string,
  label: string,
  required: boolean,
) {
  command
    .addStringOption((option) =>
      option
        .setName(`${prefix}-name`)
        .setDescription(`${label} in-game name`)
        .setMaxLength(80)
        .setRequired(required),
    )
    .addUserOption((option) =>
      option
        .setName(prefix)
        .setDescription(`${label} Discord member`)
        .setRequired(required),
    )
    .addStringOption((option) =>
      option
        .setName(`${prefix}-uid`)
        .setDescription(`${label} game UID`)
        .setMaxLength(80)
        .setRequired(required),
    );
}

function optionalUser(
  interaction: ChatInputCommandInteraction,
  name: string,
): User | null {
  return interaction.options.getUser(name);
}

function tournamentPlayer(
  interaction: ChatInputCommandInteraction,
  prefix: string,
  label: string,
  slot: number,
  required: boolean,
) {
  const name = interaction.options.getString(`${prefix}-name`);
  const user = interaction.options.getUser(prefix);
  const uid = interaction.options.getString(`${prefix}-uid`);
  if (!name && !user && !uid && !required) {
    return null;
  }
  if (!name?.trim() || !user || !uid?.trim()) {
    throw new Error(`${label} needs a name, Discord member, and game UID.`);
  }
  return { slot, name: name.trim(), uid: uid.trim(), user };
}

function teamInput(
  interaction: ChatInputCommandInteraction,
): InteractionRegistrationInput {
  const managers = Array.from({ length: 10 }, (_, index) =>
    optionalUser(interaction, `manager-${index + 1}`),
  ).filter((user): user is User => Boolean(user));
  return {
    kind: "team",
    teamName: interaction.options.getString("team-name", true),
    tag: interaction.options.getString("tag", true),
    placement:
      (interaction.options.getString("placement") as
        | "NORMAL"
        | "VIP"
        | null) ?? "NORMAL",
    managers,
    logo: interaction.options.getAttachment("logo"),
  };
}

function tournamentInput(
  interaction: ChatInputCommandInteraction,
): InteractionRegistrationInput {
  const mainPlayers = [
    tournamentPlayer(interaction, "player-1", "Player 1", 1, true),
    tournamentPlayer(interaction, "player-2", "Player 2", 2, true),
    tournamentPlayer(interaction, "player-3", "Player 3", 3, false),
    tournamentPlayer(interaction, "player-4", "Player 4", 4, false),
  ].filter((player): player is NonNullable<typeof player> => Boolean(player));
  const substitutes = [
    tournamentPlayer(interaction, "substitute-1", "Substitute 1", 1, false),
    tournamentPlayer(interaction, "substitute-2", "Substitute 2", 2, false),
  ].filter((player): player is NonNullable<typeof player> => Boolean(player));
  return {
    kind: "tournament",
    teamName: interaction.options.getString("team-name", true),
    tag: interaction.options.getString("tag", true),
    manager: interaction.options.getUser("manager", true),
    mainPlayers,
    substitutes,
    logo: interaction.options.getAttachment("logo"),
  };
}

export const registerCommand = {
  data: new SlashCommandBuilder()
    .setName("register")
    .setDescription("Register a team through the configured Arenzyra channel")
    .addSubcommand((command) => {
      command
        .setName("team")
        .setDescription("Register for a scrim or event")
        .addStringOption((option) =>
          option
            .setName("team-name")
            .setDescription("Team name")
            .setMaxLength(80)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("tag")
            .setDescription("Team tag")
            .setMaxLength(24)
            .setRequired(true),
        )
        .addUserOption((option) =>
          option
            .setName("manager-1")
            .setDescription("Primary team manager")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("placement")
            .setDescription("Normal or VIP scrim placement")
            .addChoices(
              { name: "Normal", value: "NORMAL" },
              { name: "VIP", value: "VIP" },
            ),
        )
        .addAttachmentOption((option) =>
          option
            .setName("logo")
            .setDescription("Optional PNG, JPEG, or WEBP team logo"),
        );
      for (let index = 2; index <= 10; index += 1) {
        command.addUserOption((option) =>
          option
            .setName(`manager-${index}`)
            .setDescription(`Optional team manager ${index}`),
        );
      }
      return command;
    })
    .addSubcommand((command) => {
      command
        .setName("tournament")
        .setDescription("Register a structured tournament roster")
        .addStringOption((option) =>
          option
            .setName("team-name")
            .setDescription("Team name")
            .setMaxLength(80)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("tag")
            .setDescription("Team tag")
            .setMaxLength(15)
            .setRequired(true),
        )
        .addUserOption((option) =>
          option
            .setName("manager")
            .setDescription("Team manager")
            .setRequired(true),
        );
      addTournamentPlayerOptions(command, "player-1", "Player 1", true);
      addTournamentPlayerOptions(command, "player-2", "Player 2", true);
      command.addAttachmentOption((option) =>
        option
          .setName("logo")
          .setDescription("PNG, JPEG, or WEBP team logo"),
      );
      addTournamentPlayerOptions(command, "player-3", "Player 3", false);
      addTournamentPlayerOptions(command, "player-4", "Player 4", false);
      addTournamentPlayerOptions(
        command,
        "substitute-1",
        "Substitute 1",
        false,
      );
      addTournamentPlayerOptions(
        command,
        "substitute-2",
        "Substitute 2",
        false,
      );
      return command;
    }),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: {
      messageRegistrationService: Pick<
        MessageRegistrationService,
        "registerFromInteraction"
      >;
    },
  ) {
    await interaction.deferReply({ ephemeral: true });
    const subcommand = interaction.options.getSubcommand(true);
    const input =
      subcommand === "tournament"
        ? tournamentInput(interaction)
        : teamInput(interaction);
    const content =
      await services.messageRegistrationService.registerFromInteraction(
        interaction,
        input,
      );
    await interaction.editReply(content);
  },
};
