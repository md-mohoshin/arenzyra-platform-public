import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationCommandOptionType } from "discord.js";
import { registerCommand } from "./register";

test("register command exposes additive team and tournament subcommands", () => {
  const command = registerCommand.data.toJSON();
  assert.equal(command.name, "register");
  const subcommands = command.options ?? [];
  assert.deepEqual(
    subcommands.map((option) => option.name),
    ["team", "tournament"],
  );
  assert.ok(
    subcommands.every(
      (option) => option.type === ApplicationCommandOptionType.Subcommand,
    ),
  );

  const team = subcommands.find((option) => option.name === "team");
  const teamOptions = "options" in (team ?? {}) ? (team?.options ?? []) : [];
  assert.equal(
    teamOptions.find((option) => option.name === "manager-1")?.required,
    true,
  );
  assert.equal(
    teamOptions.find((option) => option.name === "logo")?.type,
    ApplicationCommandOptionType.Attachment,
  );
  assert.equal(
    teamOptions.filter((option) => option.name.startsWith("manager-")).length,
    10,
  );

  const tournament = subcommands.find(
    (option) => option.name === "tournament",
  );
  const tournamentOptions =
    "options" in (tournament ?? {}) ? (tournament?.options ?? []) : [];
  assert.ok(tournamentOptions.length <= 25);
  assert.equal(
    tournamentOptions.find((option) => option.name === "player-1")?.type,
    ApplicationCommandOptionType.User,
  );
  assert.equal(
    tournamentOptions.find((option) => option.name === "player-1-uid")
      ?.required,
    true,
  );
  assert.equal(
    tournamentOptions.find((option) => option.name === "substitute-2-uid")
      ?.required,
    false,
  );
});
