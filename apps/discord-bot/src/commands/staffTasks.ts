import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { StaffTaskService } from "../services/staff-task.service";

export const staffTasksCommand = {
  data: new SlashCommandBuilder()
    .setName("staff-tasks")
    .setDescription("Configure staff work schedules and view activity")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("configure")
        .setDescription("Create a manual staff task schedule")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Example: Friday evening scrim staff")
            .setRequired(true)
            .setMaxLength(120),
        )
        .addStringOption((option) =>
          option
            .setName("frequency")
            .setDescription("When to create this task board")
            .setRequired(true)
            .addChoices(
              { name: "One time", value: "ONCE" },
              { name: "Daily", value: "DAILY" },
              { name: "Weekly", value: "WEEKLY" },
            ),
        )
        .addStringOption((option) =>
          option
            .setName("tasks")
            .setDescription("One per line: title | points | description | optional @staff | optional review")
            .setRequired(true)
            .setMaxLength(4000),
        )
        .addStringOption((option) =>
          option
            .setName("time")
            .setDescription("Romania time HH:MM; default 18:00"),
        )
        .addStringOption((option) =>
          option
            .setName("date")
            .setDescription("Required for one time: YYYY-MM-DD"),
        )
        .addStringOption((option) =>
          option
            .setName("weekdays")
            .setDescription("Required weekly: mon,wed,fri"),
        )
        .addIntegerOption((option) =>
          option
            .setName("duration-hours")
            .setDescription("How long the board remains active; default 24")
            .setMinValue(1)
            .setMaxValue(168),
        )
        .addChannelOption((option) =>
          option
            .setName("board-channel")
            .setDescription("Where the daily staff task board is posted"),
        )
        .addChannelOption((option) =>
          option
            .setName("log-channel")
            .setDescription("Where every staff task action is logged"),
        )
        .addRoleOption((option) =>
          option
            .setName("staff-role")
            .setDescription("Only this role may claim these tasks"),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("templates")
        .setDescription("Post, enable, or disable staff task templates"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("leaderboard")
        .setDescription("See monthly staff task points")
        .addStringOption((option) =>
          option
            .setName("month")
            .setDescription("Optional month in YYYY-MM; current month by default"),
        ),
    ),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { staffTaskService: StaffTaskService },
  ) {
    await services.staffTaskService.handleCommand(interaction);
  },
};
