import assert from "node:assert/strict";
import test from "node:test";
import { ControlPanelService } from "./control-panel.service";
import type { DiscordTeamBanCommand } from "./session.service";

type ControlPanelInternals = {
  parseBanMatchNumbers(value: string): {
    matchNumbers: number[];
    allMatches: boolean;
  };
  parseOptionalMatchNumber(value: string): number | null;
};

function makeStaffInteraction(overrides: Record<string, unknown> = {}) {
  const replies: unknown[] = [];
  const updates: unknown[] = [];
  const edits: unknown[] = [];
  const interaction = {
    customId: "",
    user: { id: "staff-1", tag: "staff#0001" },
    guildId: "guild-1",
    channelId: "waitlist-channel",
    guild: {
      id: "guild-1",
      members: {
        fetch: async () => ({
          permissions: { has: () => true },
          roles: { cache: { some: () => false } },
        }),
      },
    },
    inGuild: () => true,
    reply: async (payload: unknown) => {
      replies.push(payload);
    },
    update: async (payload: unknown) => {
      updates.push(payload);
    },
    editReply: async (payload: unknown) => {
      edits.push(payload);
    },
    ...overrides,
  };
  return { interaction, replies, updates, edits };
}

test("ban controls accept match-name aliases for match numbers", () => {
  const service = new ControlPanelService({} as any) as unknown as
    ControlPanelInternals;

  assert.deepEqual(service.parseBanMatchNumbers("match 1, M2, game no 3"), {
    matchNumbers: [1, 2, 3],
    allMatches: false,
  });
  assert.deepEqual(service.parseBanMatchNumbers("all"), {
    matchNumbers: [],
    allMatches: true,
  });
  assert.equal(service.parseOptionalMatchNumber("Match #4 final"), 4);
  assert.equal(service.parseOptionalMatchNumber("m5"), 5);
});

test("waitlist remove button posts stable confirmation button ids", async () => {
  let updated = false;
  const sessionService = {
    userHasStaffAccess: async () => true,
    updateRegistrationPlacement: async () => {
      updated = true;
      return "removed";
    },
  };
  const { interaction, replies } = makeStaffInteraction({
    customId: "regctl:r:session-1:registration-1",
  });

  const service = new ControlPanelService(sessionService as any);
  const handled = await service.handleButton(interaction as any);

  assert.equal(handled, true);
  assert.equal(updated, false);
  const reply = replies[0] as {
    components: Array<{ components: Array<{ data: { custom_id: string } }> }>;
  };
  const customIds = reply.components[0].components.map(
    (component) => component.data.custom_id,
  );
  assert.deepEqual(customIds, [
    "regctl:rm:confirm:session-1:registration-1",
    "regctl:rm:cancel:session-1:registration-1",
  ]);
});

test("waitlist remove confirmation is handled by the main button router", async () => {
  let placementArgs: unknown[] | null = null;
  const sessionService = {
    userHasStaffAccess: async () => true,
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1" },
      config: { organizationId: "org-1" },
    }),
    withOrganization: async (_organizationId: string, fn: () => Promise<string>) =>
      fn(),
    updateRegistrationPlacement: async (...args: unknown[]) => {
      placementArgs = args;
      return "Team removed.";
    },
  };
  const { interaction, updates, edits } = makeStaffInteraction({
    customId: "regctl:rm:confirm:session-1:registration-1",
  });

  const service = new ControlPanelService(sessionService as any);
  const handled = await service.handleButton(interaction as any);

  assert.equal(handled, true);
  assert.deepEqual(updates[0], {
    content: "Removing team...",
    components: [],
  });
  assert.equal(edits[0], "Team removed.");
  assert.ok(placementArgs);
  assert.equal(placementArgs[0], "session-1");
  assert.equal(placementArgs[1], "registration-1");
  assert.deepEqual(placementArgs[2], { action: "REMOVE" });
});

test("manage card ban button opens a duration modal for the exact team", async () => {
  let shownModal: any = null;
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1" },
      config: {
        organizationId: "org-1",
        emojis: { banDefaultDurationDays: "5" },
      },
    }),
  };
  const { interaction } = makeStaffInteraction({
    customId: "cardban:d:session-1:team-1",
    showModal: async (modal: any) => {
      shownModal = modal.toJSON();
    },
  });

  const service = new ControlPanelService(sessionService as any);
  const handled = await service.handleButton(interaction as any);

  assert.equal(handled, true);
  assert.equal(shownModal.custom_id, "cardban-modal:session-1:team-1");
  assert.equal(shownModal.title, "Ban Manager");
  assert.equal(
    shownModal.components[0].components[0].custom_id,
    "days",
  );
  assert.equal(shownModal.components[0].components[0].value, "5");
});

test("manage card permanent ban previews an exact team-id ban", async () => {
  let capturedCommand: DiscordTeamBanCommand | null = null;
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1" },
      config: {
        organizationId: "org-1",
        emojis: { banDefaultReason: "Manage card ban" },
      },
    }),
    withOrganization: async (
      _organizationId: string,
      fn: () => Promise<unknown>,
    ) => fn(),
    previewTeamBanFromDiscord: async (command: DiscordTeamBanCommand) => {
      capturedCommand = command;
      return {
        team: null,
        managers: [],
        command,
        content: "preview",
        activeBanCount: 0,
      };
    },
  };
  const defers: unknown[] = [];
  const { interaction, edits } = makeStaffInteraction({
    customId: "cardban:p:session-1:team-1",
    deferReply: async (payload: unknown) => {
      defers.push(payload);
    },
  });

  const service = new ControlPanelService(sessionService as any);
  const handled = await service.handleButton(interaction as any);

  assert.equal(handled, true);
  assert.deepEqual(defers[0], { ephemeral: true });
  const command = capturedCommand as unknown as DiscordTeamBanCommand;
  assert.deepEqual(command.target, {
    kind: "team-id",
    teamId: "team-1",
  });
  assert.equal(command.scope, "SESSION");
  assert.equal(command.sessionId, "session-1");
  assert.equal(command.days, null);
  assert.equal(command.reason, "Manage card ban");
  assert.equal((edits[0] as any).content, "preview");
});

test("play status button shows private team picker for multi-team manager", async () => {
  const edits: any[] = [];
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1" },
      config: { organizationId: "org-1" },
    }),
    withOrganization: async (_organizationId: string, fn: () => Promise<unknown>) =>
      fn(),
    resolveRegistrationPlayStatusTargets: async () => ({
      kind: "multiple",
      content: "Choose team",
      targets: [
        {
          registrationId: "registration-a",
          teamId: "team-a",
          teamLabel: "Alpha Team (ALP)",
          slotNumber: 5,
          optionLabel: "Slot #5 - Alpha Team (ALP)",
          optionDescription: "Apply only Alpha Team (ALP)",
        },
        {
          registrationId: "registration-b",
          teamId: "team-b",
          teamLabel: "Bravo Team (BRV)",
          slotNumber: 9,
          optionLabel: "Slot #9 - Bravo Team (BRV)",
          optionDescription: "Apply only Bravo Team (BRV)",
        },
      ],
    }),
    updateRegistrationPlayStatus: async () => {
      throw new Error("Should not update before picker selection");
    },
  };
  const { interaction } = makeStaffInteraction({
    customId: "play:confirm:session-1",
    user: { id: "manager-1", username: "manager", tag: "manager#0001" },
    deferReply: async () => undefined,
    editReply: async (payload: any) => {
      edits.push(payload);
      return payload;
    },
    deleteReply: async () => undefined,
  });

  const service = new ControlPanelService(sessionService as any);
  const handled = await service.handleButton(interaction as any);

  assert.equal(handled, true);
  assert.equal(edits[0].content, "Choose team");
  const row = edits[0].components[0].toJSON();
  const menu = row.components[0];
  assert.equal(menu.custom_id, "playpick:c:session-1");
  assert.deepEqual(
    menu.options.map((option: any) => option.value),
    ["registration-a", "registration-b", "all"],
  );
});

test("play status team picker applies selected team", async () => {
  let updateArgs: unknown[] | null = null;
  let deferred = false;
  const edits: any[] = [];
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1" },
      config: { organizationId: "org-1" },
    }),
    withOrganization: async (_organizationId: string, fn: () => Promise<string>) =>
      fn(),
    updateRegistrationPlayStatus: async (...args: unknown[]) => {
      assert.equal(deferred, true);
      updateArgs = args;
      return "Confirmed slot #9 for Bravo Team (BRV).";
    },
  };
  const { interaction } = makeStaffInteraction({
    customId: "playpick:c:session-1",
    values: ["registration-b"],
    user: { id: "manager-1", username: "manager", tag: "manager#0001" },
    deferUpdate: async () => {
      deferred = true;
    },
    editReply: async (payload: any) => {
      edits.push(payload);
      return payload;
    },
    deleteReply: async () => undefined,
  });

  const service = new ControlPanelService(sessionService as any);
  const handled = await service.handleStringSelectMenu(interaction as any);

  assert.equal(handled, true);
  assert.equal(deferred, true);
  assert.equal(edits[0].content, "Confirmed slot #9 for Bravo Team (BRV).");
  assert.deepEqual(edits[0].components, []);
  assert.ok(updateArgs);
  assert.equal(updateArgs[0], "session-1");
  assert.equal(updateArgs[1], "manager-1");
  assert.equal(updateArgs[3], "CONFIRM");
  assert.deepEqual(updateArgs[6], { registrationId: "registration-b" });
});

test("play status team picker can apply all teams", async () => {
  let updateArgs: unknown[] | null = null;
  let deferred = false;
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1" },
      config: { organizationId: "org-1" },
    }),
    withOrganization: async (_organizationId: string, fn: () => Promise<string>) =>
      fn(),
    updateRegistrationPlayStatus: async (...args: unknown[]) => {
      updateArgs = args;
      return "Marked not playing 2 teams.";
    },
  };
  const { interaction } = makeStaffInteraction({
    customId: "playpick:n:session-1",
    values: ["all"],
    user: { id: "manager-1", username: "manager", tag: "manager#0001" },
    deferUpdate: async () => {
      deferred = true;
    },
    editReply: async () => undefined,
    deleteReply: async () => undefined,
  });

  const service = new ControlPanelService(sessionService as any);
  const handled = await service.handleStringSelectMenu(interaction as any);

  assert.equal(handled, true);
  assert.equal(deferred, true);
  assert.ok(updateArgs);
  assert.equal(updateArgs[3], "NOT_PLAYING");
  assert.deepEqual(updateArgs[6], { applyAll: true });
});
