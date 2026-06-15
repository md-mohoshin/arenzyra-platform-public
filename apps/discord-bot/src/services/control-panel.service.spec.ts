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

function makeSessionContext(overrides: Record<string, unknown> = {}) {
  return {
    session: {
      id: "session-1",
      name: "Test Scrim",
      status: "OPEN",
      startsAt: null,
      registrationOpenAt: null,
      registrationCloseAt: null,
      maxTeams: 20,
      slotCount: 20,
      counts: {
        confirmedCount: 12,
        waitlistCount: 3,
        totalRegisteredCount: 15,
      },
    },
    config: {
      organizationId: "org-1",
      disableSlotAndVipRegistration: false,
      registrationChannelId: "registration-channel",
      slotListChannelId: "slots-channel",
      waitlistChannelId: "waitlist-channel",
      resultsChannelId: "results-channel",
      screenshotsChannelId: "screenshots-channel",
      emojis: {},
    },
    ...overrides,
  };
}

test("ban controls accept match-name aliases for match numbers", () => {
  const service = new ControlPanelService(
    {} as any,
  ) as unknown as ControlPanelInternals;

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
    withOrganization: async (
      _organizationId: string,
      fn: () => Promise<string>,
    ) => fn(),
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
  assert.equal(shownModal.components[0].components[0].custom_id, "days");
  assert.equal(shownModal.components[0].components[0].value, "5");
});

test("manage card permanent ban asks for reason before previewing exact team-id ban", async () => {
  let capturedCommand: DiscordTeamBanCommand | null = null;
  let shownModal: any = null;
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
  const { interaction } = makeStaffInteraction({
    customId: "cardban:p:session-1:team-1",
    showModal: async (modal: any) => {
      shownModal = modal.toJSON();
    },
  });

  const service = new ControlPanelService(sessionService as any);
  const handled = await service.handleButton(interaction as any);

  assert.equal(handled, true);
  assert.equal(
    shownModal.custom_id,
    "cardban-permanent-modal:session-1:team-1",
  );
  assert.equal(shownModal.title, "Permanent Ban Reason");
  assert.equal(shownModal.components[0].components[0].custom_id, "reason");
  assert.equal(capturedCommand, null);

  const { interaction: modalInteraction, edits } = makeStaffInteraction({
    customId: shownModal.custom_id,
    fields: {
      getTextInputValue: () => "Permanent rule break",
    },
    deferReply: async (payload: unknown) => {
      defers.push(payload);
    },
  });

  const modalHandled = await service.handleModalSubmit(modalInteraction as any);

  assert.equal(modalHandled, true);
  assert.deepEqual(defers[0], { ephemeral: true });
  const command = capturedCommand as unknown as DiscordTeamBanCommand;
  assert.deepEqual(command.target, {
    kind: "team-id",
    teamId: "team-1",
  });
  assert.equal(command.scope, "SESSION");
  assert.equal(command.sessionId, "session-1");
  assert.equal(command.days, null);
  assert.equal(command.reason, "Permanent rule break");
  assert.equal((edits[0] as any).content, "preview");
});

test("session manage panel exposes Discord-first session controls", async () => {
  const sessionService = {
    listSessionMatchesForDiscord: async () => [
      { id: "match-1", matchNumber: 1 },
    ],
  };
  const service = new ControlPanelService(sessionService as any) as any;

  const panel = await service.buildSessionManagePanelMessage(
    makeSessionContext(),
    { name: "Test Guild" },
  );

  assert.equal(panel.components.length, 4);
  const customIds = panel.components.flatMap((row: any) =>
    row.components.map((component: any) => component.data.custom_id),
  );
  assert.ok(customIds.includes("sessctl:refresh:session-1"));
  assert.ok(customIds.includes("sessctl:open-registration:session-1"));
  assert.ok(customIds.includes("sessctl:close-registration:session-1"));
  assert.ok(customIds.includes("sessctl:sync-discord:session-1"));
  assert.ok(customIds.includes("sessctl:waitlist:session-1"));
  assert.ok(customIds.includes("sessctl:apply-results:session-1"));
  assert.ok(customIds.includes("sessctl:sync-logos:session-1"));
  assert.ok(customIds.includes("sessctl:no-show:session-1"));
});

test("result control panel exposes text and ban rule settings", async () => {
  const sessionService = {
    withOrganization: async (
      _organizationId: string,
      fn: () => Promise<unknown>,
    ) => fn(),
    getResultControlStateForDiscord: async () => ({
      matchCount: 2,
      latestMatchLabel: "G2",
      bannedTeamCount: 1,
      activeTeamBanCount: 1,
      activeManagerBanCount: 1,
      targets: [],
    }),
  };
  const service = new ControlPanelService(sessionService as any) as any;

  const panel = await service.buildResultControlPanelMessage(
    makeSessionContext({
      config: {
        ...makeSessionContext().config,
        bansChannelId: "bans-channel",
        emojis: {
          finalResultWinnerCount: "3",
          finalResultPostTemplate: "{message}",
          noShowBanRules: JSON.stringify([
            {
              enabled: true,
              misses: 1,
              durationDays: 3,
              scope: "SESSION",
              reason: "Missed match",
            },
          ]),
        },
      },
    }),
    { name: "Test Guild" },
  );

  assert.equal(panel.components.length, 3);
  const customIds = panel.components.flatMap((row: any) =>
    row.components.map((component: any) => component.data.custom_id),
  );
  assert.ok(customIds.includes("resultctl:text:session-1"));
  assert.ok(customIds.includes("resultctl:edit-results:session-1"));
  assert.ok(customIds.includes("resultctl:final-refresh:session-1"));
  assert.ok(customIds.includes("resultctl:final-repost:session-1"));
  assert.ok(customIds.includes("resultctl:defaults:session-1"));
  assert.ok(customIds.includes("resultctl:rules:session-1"));
  const fieldNames = panel.embeds[0].data.fields.map(
    (field: any) => field.name,
  );
  assert.ok(fieldNames.includes("Text Settings"));
  assert.ok(fieldNames.includes("Ban Defaults"));
  assert.ok(fieldNames.includes("No-Show Rule Format"));
  assert.match(
    panel.embeds[0].data.fields.find(
      (field: any) => field.name === "Results",
    ).value,
    /Final post: not saved yet/,
  );
  assert.match(
    panel.embeds[0].data.fields.find(
      (field: any) => field.name === "Ban Defaults",
    ).value,
    /No-show: 1 miss=3d/,
  );
  assert.match(
    panel.embeds[0].data.fields.find(
      (field: any) => field.name === "No-Show Rule Format",
    ).value,
    /match 2=permanent all-sessions/,
  );
});

test("result control command outside synced channels shows active session picker", async () => {
  const context = makeSessionContext();
  const sessionService = {
    findScrimForDiscordChannel: async () => null,
    listActiveGuildScrims: async () => [context],
  };
  const { interaction, edits } = makeStaffInteraction({
    channelId: "general-channel",
    options: { getString: () => null },
    deferReply: async () => undefined,
  });

  const service = new ControlPanelService(sessionService as any);
  await service.postControlPanel(interaction as any, "result");

  const edit = edits[0] as any;
  assert.equal(edit.content, "Choose the result-control session.");
  assert.equal(edit.components.length, 1);
  const menu = edit.components[0].components[0].toJSON();
  assert.equal(menu.custom_id, "resultctl-session-select");
  assert.equal(menu.options[0].value, "session-1");
  assert.match(menu.options[0].label, /Test Scrim/);
});

test("result control falls back to synced channel when submitted session is invalid", async () => {
  const context = makeSessionContext({
    session: {
      ...makeSessionContext().session,
      id: "session-16",
      name: "FIX ESPORTS | 16:00",
    },
  });
  const sentPanels: unknown[] = [];
  let remembered: unknown[] | null = null;
  const sessionService = {
    findScrimForDiscordChannel: async () => context,
    resolveOrganizationIdForGuild: async () => "org-1",
    withOrganization: async (
      _organizationId: string,
      fn: () => Promise<unknown>,
    ) => fn(),
    getSessionContext: async () => {
      throw new Error("Session not found");
    },
    listActiveGuildScrims: async () => [context],
    getResultControlStateForDiscord: async () => ({
      matchCount: 0,
      latestMatchLabel: null,
      bannedTeamCount: 0,
      activeTeamBanCount: 0,
      activeManagerBanCount: 0,
      targets: [],
    }),
    rememberResultControlPanelMessage: async (...args: unknown[]) => {
      remembered = args;
    },
  };
  const { interaction, edits } = makeStaffInteraction({
    channelId: "manager-channel",
    options: { getString: () => "not-a-session-id" },
    deferReply: async () => undefined,
    channel: {
      id: "manager-channel",
      isTextBased: () => true,
      isDMBased: () => false,
      send: async (payload: unknown) => {
        sentPanels.push(payload);
        return { id: "panel-message", pin: async () => undefined };
      },
    },
  });

  const service = new ControlPanelService(sessionService as any);
  await service.postControlPanel(interaction as any, "result");

  assert.equal(sentPanels.length, 1);
  assert.deepEqual(remembered, [
    "session-16",
    "manager-channel",
    "panel-message",
  ]);
  assert.equal(
    edits[0],
    "Result control panel posted in <#manager-channel> for **FIX ESPORTS | 16:00**.",
  );
});

test("result control resolves selected session using guild organization context", async () => {
  const context = makeSessionContext({
    session: {
      ...makeSessionContext().session,
      id: "session-16",
      name: "FIX ESPORTS | 16:00",
    },
  });
  let currentOrganizationId: string | null = null;
  const usedOrganizations: Array<string | null> = [];
  const sentPanels: unknown[] = [];
  const sessionService = {
    findScrimForDiscordChannel: async () => null,
    resolveOrganizationIdForGuild: async () => "org-1",
    listActiveGuildScrims: async () => [context],
    withOrganization: async (
      organizationId: string | null,
      fn: () => Promise<unknown>,
    ) => {
      usedOrganizations.push(organizationId);
      currentOrganizationId = organizationId;
      try {
        return await fn();
      } finally {
        currentOrganizationId = null;
      }
    },
    getSessionContext: async () => {
      if (currentOrganizationId !== "org-1") {
        throw new Error("Session not found");
      }
      return context;
    },
    getResultControlStateForDiscord: async () => ({
      matchCount: 0,
      latestMatchLabel: null,
      bannedTeamCount: 0,
      activeTeamBanCount: 0,
      activeManagerBanCount: 0,
      targets: [],
    }),
    rememberResultControlPanelMessage: async () => undefined,
  };
  const { interaction, edits } = makeStaffInteraction({
    channelId: "general-channel",
    options: { getString: () => "session-16" },
    deferReply: async () => undefined,
    channel: {
      id: "general-channel",
      isTextBased: () => true,
      isDMBased: () => false,
      send: async (payload: unknown) => {
        sentPanels.push(payload);
        return { id: "panel-message", pin: async () => undefined };
      },
    },
  });

  const service = new ControlPanelService(sessionService as any);
  await service.postControlPanel(interaction as any, "result");

  assert.ok(usedOrganizations.includes("org-1"));
  assert.equal(sentPanels.length, 1);
  assert.equal(
    edits[0],
    "Result control panel posted in <#general-channel> for **FIX ESPORTS | 16:00**.",
  );
});

test("result control buttons resolve submitted session through guild organization context", async () => {
  const context = makeSessionContext({
    session: {
      ...makeSessionContext().session,
      id: "session-20",
      name: "FIX ESPORTS | 20:00",
    },
  });
  let currentOrganizationId: string | null = null;
  const usedOrganizations: Array<string | null> = [];
  const modals: unknown[] = [];
  const sessionService = {
    findScrimForDiscordChannel: async () => null,
    resolveOrganizationIdForGuild: async () => "org-1",
    withOrganization: async (
      organizationId: string | null,
      fn: () => Promise<unknown>,
    ) => {
      usedOrganizations.push(organizationId);
      currentOrganizationId = organizationId;
      try {
        return await fn();
      } finally {
        currentOrganizationId = null;
      }
    },
    userHasStaffAccess: async () => currentOrganizationId === "org-1",
    getSessionContext: async () => {
      if (currentOrganizationId !== "org-1") {
        throw new Error("Session not found");
      }
      return context;
    },
  };
  const { interaction } = makeStaffInteraction({
    customId: "resultctl:rules:session-20",
    channelId: "manage-channel",
    guild: {
      id: "guild-1",
      members: {
        fetch: async () => ({
          permissions: { has: () => false },
          roles: { cache: { some: () => false } },
        }),
      },
    },
    showModal: async (modal: unknown) => {
      modals.push(modal);
    },
  });

  const service = new ControlPanelService(sessionService as any);
  const handled = await service.handleButton(interaction as any);

  assert.equal(handled, true);
  assert.ok(usedOrganizations.includes("org-1"));
  assert.equal(modals.length, 1);
  assert.equal(
    (modals[0] as { toJSON: () => { custom_id: string } }).toJSON().custom_id,
    "resultctl-modal:rules:session-20",
  );
});

test("result control refresh edits the stored final result post", async () => {
  const context = makeSessionContext({
    config: {
      ...makeSessionContext().config,
      organizationId: "org-1",
      emojis: {
        finalResultPostChannelId: "final-channel",
        finalResultPostMessageId: "final-message",
      },
    },
  });
  let editedFinalPost: any = null;
  let remembered: unknown[] | null = null;
  const sessionService = {
    resolveOrganizationIdForGuild: async () => "org-1",
    findScrimForDiscordChannel: async () => null,
    userHasStaffAccess: async () => true,
    withOrganization: async (
      _organizationId: string | null,
      fn: () => Promise<unknown>,
    ) => fn(),
    getSessionContext: async () => context,
    buildFinalResultBackupPost: async () => ({
      content: "Internal final content",
      publicContent: "Corrected final content",
      backupId: "backup-overall",
      imageFiles: [{ name: "overall-ranking.png", buffer: Buffer.from([1]) }],
    }),
    rememberFinalResultPost: async (...args: unknown[]) => {
      remembered = args;
    },
  };
  const defers: unknown[] = [];
  const { interaction, edits } = makeStaffInteraction({
    customId: "resultctl:final-refresh:session-1",
    deferReply: async (payload: unknown) => {
      defers.push(payload);
    },
    guild: {
      id: "guild-1",
      members: {
        fetch: async () => ({
          permissions: { has: () => true },
          roles: { cache: { some: () => false } },
        }),
      },
      channels: {
        fetch: async (channelId: string) => ({
          id: channelId,
          send: async () => {
            throw new Error("Refresh should edit the stored post.");
          },
          messages: {
            fetch: async (messageId: string) => ({
              id: messageId,
              editable: true,
              edit: async (payload: unknown) => {
                editedFinalPost = payload;
                return payload;
              },
            }),
          },
        }),
      },
    },
  });

  const service = new ControlPanelService(sessionService as any);
  const handled = await service.handleButton(interaction as any);

  assert.equal(handled, true);
  assert.deepEqual(defers[0], { ephemeral: true });
  assert.equal(editedFinalPost.content, "Corrected final content");
  assert.equal(editedFinalPost.attachments.length, 0);
  assert.equal(editedFinalPost.files[0].name, "overall-ranking.png");
  assert.deepEqual(remembered, [
    "session-1",
    "final-channel",
    "final-message",
    "backup-overall",
  ]);
  assert.equal(
    (edits[0] as any).content,
    "Final result post refreshed in <#final-channel>.",
  );
});

test("result control edit results button shows match picker", async () => {
  const context = makeSessionContext();
  const sessionService = {
    findScrimForDiscordChannel: async () => context,
    withOrganization: async (
      _organizationId: string | null,
      fn: () => Promise<unknown>,
    ) => fn(),
    getSessionContext: async () => context,
    listSessionMatchesForDiscord: async () => [
      {
        id: "match-1",
        sessionId: "session-1",
        name: "Scrim Match 1",
        matchNumber: 1,
        map: "Erangel",
        status: "FINISHED",
        teamCount: 16,
      },
    ],
  };
  const defers: unknown[] = [];
  const { interaction, edits } = makeStaffInteraction({
    customId: "resultctl:edit-results:session-1",
    deferReply: async (payload: unknown) => {
      defers.push(payload);
    },
  });

  const service = new ControlPanelService(sessionService as any);
  const handled = await service.handleButton(interaction as any);

  assert.equal(handled, true);
  assert.deepEqual(defers[0], { ephemeral: true });
  const edit = edits[0] as any;
  assert.match(edit.content, /Choose the match first/);
  const menu = edit.components[0].components[0].toJSON();
  assert.equal(menu.custom_id, "resultedit:match:session-1");
  assert.equal(menu.options[0].value, "match-1");
  assert.match(menu.options[0].label, /G1 - Erangel/);
});

test("result control edit results falls back to latest saved match backups", async () => {
  const context = makeSessionContext();
  const sessionService = {
    findScrimForDiscordChannel: async () => context,
    withOrganization: async (
      _organizationId: string | null,
      fn: () => Promise<unknown>,
    ) => fn(),
    getSessionContext: async () => context,
    listSessionMatchesForDiscord: async () => [],
    listEditableResultBackupsForDiscord: async () => [
      {
        id: "backup-g1-new",
        organizationId: "org-1",
        sessionId: "session-1",
        sourceMatchId: "missing-match-new",
        kind: "MATCH",
        source: "Final result posted",
        matchNumber: 1,
        matchName: "Game 1",
        sessionName: "Test Scrim",
        title: "Game 1",
        postedChannelId: null,
        postedMessageId: null,
        repostedAt: null,
        expiresAt: "2026-06-20T00:00:00.000Z",
        createdAt: "2026-06-11T16:28:52.000Z",
        updatedAt: "2026-06-11T16:28:52.000Z",
        rowCount: 18,
      },
    ],
  };
  const defers: unknown[] = [];
  const { interaction, edits } = makeStaffInteraction({
    customId: "resultctl:edit-results:session-1",
    deferReply: async (payload: unknown) => {
      defers.push(payload);
    },
  });

  const service = new ControlPanelService(sessionService as any);
  const handled = await service.handleButton(interaction as any);

  assert.equal(handled, true);
  assert.deepEqual(defers[0], { ephemeral: true });
  const edit = edits[0] as any;
  assert.match(edit.content, /Using saved result backups/);
  const menu = edit.components[0].components[0].toJSON();
  assert.equal(menu.options[0].value, "b_backup-g1-new");
  assert.match(menu.options[0].label, /G1 - Game 1/);
  assert.match(menu.options[0].description, /18 rows/);
});

test("result edit modal saves saved backup rows when live match is gone", async () => {
  const context = makeSessionContext();
  const backup = {
    id: "backup-g1",
    organizationId: "org-1",
    sessionId: "session-1",
    sourceMatchId: "missing-match",
    kind: "MATCH",
    source: "Final result posted",
    matchNumber: 1,
    matchName: "Game 1",
    sessionName: "Test Scrim",
    title: "Game 1",
    postedChannelId: null,
    postedMessageId: null,
    repostedAt: null,
    expiresAt: "2026-06-20T00:00:00.000Z",
    createdAt: "2026-06-11T16:28:52.000Z",
    updatedAt: "2026-06-11T16:28:52.000Z",
    rowCount: 2,
    session: { id: "session-1", name: "Test Scrim" },
    rows: [
      {
        id: "backup-row-1",
        rank: 1,
        teamId: "team-1",
        teamName: "Delta X",
        teamTag: "DXB",
        logoUrl: null,
        slotNumber: 4,
        placement: 1,
        wwcd: 1,
        placementPoints: 10,
        kills: 9,
        totalPoints: 19,
        players: [
          {
            id: "backup-player-alpha",
            playerId: "player-alpha",
            name: "Alpha",
            kills: 5,
            alive: false,
            isAlive: false,
            isKnocked: false,
          },
          {
            id: "backup-player-bravo",
            playerId: "player-bravo",
            name: "Bravo",
            kills: 4,
            alive: false,
            isAlive: false,
            isKnocked: false,
          },
        ],
        createdAt: "2026-06-11T16:28:52.000Z",
        updatedAt: "2026-06-11T16:28:52.000Z",
      },
      {
        id: "backup-row-2",
        rank: 2,
        teamId: "team-2",
        teamName: "Next",
        teamTag: "NXT",
        logoUrl: null,
        slotNumber: 8,
        placement: 2,
        wwcd: 0,
        placementPoints: 6,
        kills: 8,
        totalPoints: 14,
        createdAt: "2026-06-11T16:28:52.000Z",
        updatedAt: "2026-06-11T16:28:52.000Z",
      },
    ],
  };
  let updateArgs: unknown[] | null = null;
  const sessionService = {
    findScrimForDiscordChannel: async () => context,
    withOrganization: async (
      _organizationId: string | null,
      fn: () => Promise<unknown>,
    ) => fn(),
    getSessionContext: async () => context,
    getResultBackupForDiscord: async () => backup,
    updateResultBackupRowsFromDiscord: async (...args: unknown[]) => {
      updateArgs = args;
      const rows = args[1] as Array<Record<string, unknown>>;
      return {
        ...backup,
        rows: rows.map((row) => ({
          id: row.teamId === "team-1" ? "backup-row-1" : "backup-row-2",
          createdAt: "2026-06-11T16:28:52.000Z",
          updatedAt: "2026-06-11T16:30:00.000Z",
          ...row,
        })),
      };
    },
  };
  const service = new ControlPanelService(sessionService as any);
  let shownModal: any = null;
  const { interaction: selectInteraction } = makeStaffInteraction({
    customId: "resultedit:rows:session-1:b_backup-g1:0",
    values: ["backup-row-1"],
    showModal: async (modal: any) => {
      shownModal = modal.toJSON();
    },
  });

  const selectHandled = await service.handleStringSelectMenu(
    selectInteraction as any,
  );

  assert.equal(selectHandled, true);
  assert.ok(shownModal);
  assert.equal(shownModal.components[0].components[0].value, "1");
  assert.equal(shownModal.components[1].components[0].value, "9");
  assert.equal(shownModal.components[2].components[0].custom_id, "player-kills");
  assert.match(shownModal.components[2].components[0].value, /Alpha=5/);
  assert.equal(shownModal.components[3].components[0].custom_id, "placement-points");
  assert.equal(shownModal.components[4].components[0].custom_id, "total-points");

  const values = new Map<string, string>([
    ["placement", "2"],
    ["kills", "11"],
    ["player-kills", "Alpha=6\nBravo=5"],
  ]);
  const defers: unknown[] = [];
  const { interaction: modalInteraction, edits } = makeStaffInteraction({
    customId: shownModal.custom_id,
    fields: {
      getTextInputValue: (customId: string) => {
        const value = values.get(customId);
        if (value === undefined) {
          throw new Error(`Missing input ${customId}`);
        }
        return value;
      },
    },
    deferReply: async (payload: unknown) => {
      defers.push(payload);
    },
  });

  const modalHandled = await service.handleModalSubmit(modalInteraction as any);

  assert.equal(modalHandled, true);
  assert.deepEqual(defers[0], { ephemeral: true });
  assert.equal(updateArgs?.[0], "backup-g1");
  const updatedRows = updateArgs?.[1] as Array<Record<string, unknown>>;
  const editedRow = updatedRows.find((row) => row.teamId === "team-1");
  const swappedRow = updatedRows.find((row) => row.teamId === "team-2");
  assert.equal(editedRow?.placement, 2);
  assert.equal(editedRow?.kills, 11);
  assert.equal(editedRow?.placementPoints, 6);
  assert.equal(editedRow?.totalPoints, 17);
  assert.deepEqual(editedRow?.players, [
    {
      id: "backup-player-alpha",
      playerId: "player-alpha",
      externalPlayerId: null,
      name: "Alpha",
      kills: 6,
      knocks: null,
      assists: null,
      alive: false,
      isAlive: false,
      isKnocked: false,
      avatar: null,
    },
    {
      id: "backup-player-bravo",
      playerId: "player-bravo",
      externalPlayerId: null,
      name: "Bravo",
      kills: 5,
      knocks: null,
      assists: null,
      alive: false,
      isAlive: false,
      isKnocked: false,
      avatar: null,
    },
  ]);
  assert.equal(swappedRow?.placement, 1);
  assert.match((edits[0] as any).content, /Result row saved/);
  assert.match((edits[0] as any).content, /Player kills updated: 2/);
  assert.match((edits[0] as any).content, /Final post: not saved yet/);
});

test("result edit modal saves placement kills player kills and refreshes final post", async () => {
  const context = makeSessionContext({
    config: {
      ...makeSessionContext().config,
      organizationId: "org-1",
      emojis: {
        finalResultPostChannelId: "final-channel",
        finalResultPostMessageId: "final-message",
      },
    },
  });
  const beforeRow = {
    id: "row-1",
    matchId: "match-1",
    teamId: "team-1",
    slot: 4,
    kills: 9,
    teamKills: 9,
    placement: 3,
    placementPoints: 8,
    totalPoints: 17,
    team: { id: "team-1", name: "Delta X", tag: "DXB", logoUrl: null },
    players: [
      {
        id: "player-result-1",
        playerId: "player-1",
        name: "Alpha",
        kills: 5,
        isAlive: true,
        isKnocked: false,
      },
      {
        id: "player-result-2",
        playerId: "player-2",
        name: "Bravo",
        kills: 4,
        isAlive: false,
        isKnocked: false,
      },
    ],
  };
  const afterRow = {
    ...beforeRow,
    kills: 11,
    teamKills: 11,
    placement: 2,
    placementPoints: 12,
    totalPoints: 23,
  };
  let updateArgs: unknown[] | null = null;
  let editedFinalPost: any = null;
  const sessionService = {
    findScrimForDiscordChannel: async () => context,
    withOrganization: async (
      _organizationId: string | null,
      fn: () => Promise<unknown>,
    ) => fn(),
    getSessionContext: async () => context,
    listSessionMatchesForDiscord: async () => [
      {
        id: "match-1",
        sessionId: "session-1",
        name: "Scrim Match 1",
        matchNumber: 1,
        map: "Erangel",
        status: "FINISHED",
        teamCount: 1,
      },
    ],
    getMatchResultsForDiscord: async () => ({
      results: [beforeRow],
      locked: false,
      lockState: "OPEN",
    }),
    updateMatchResultFromDiscord: async (...args: unknown[]) => {
      updateArgs = args;
      return { results: [afterRow], locked: false, lockState: "OPEN" };
    },
    buildFinalResultPost: async () => ({
      content: "Internal updated final",
      publicContent: "Updated final",
      imageFiles: [{ name: "overall-ranking.png", buffer: Buffer.from([1]) }],
    }),
  };
  const service = new ControlPanelService(sessionService as any);
  let shownModal: any = null;
  const { interaction: selectInteraction } = makeStaffInteraction({
    customId: "resultedit:rows:session-1:match-1:0",
    values: ["team-1"],
    showModal: async (modal: any) => {
      shownModal = modal.toJSON();
    },
  });

  const selectHandled = await service.handleStringSelectMenu(
    selectInteraction as any,
  );

  assert.equal(selectHandled, true);
  assert.ok(shownModal);
  assert.match(shownModal.custom_id, /^resultedit-modal:/);
  assert.equal(shownModal.components[0].components[0].value, "3");
  assert.equal(shownModal.components[1].components[0].value, "9");
  assert.match(shownModal.components[2].components[0].value, /Alpha=5/);

  const values = new Map<string, string>([
    ["placement", "2"],
    ["kills", "11"],
    ["player-kills", "Alpha=6\nBravo=5"],
  ]);
  const defers: unknown[] = [];
  const { interaction: modalInteraction, edits } = makeStaffInteraction({
    customId: shownModal.custom_id,
    fields: {
      getTextInputValue: (customId: string) => {
        const value = values.get(customId);
        if (value === undefined) {
          throw new Error(`Missing input ${customId}`);
        }
        return value;
      },
    },
    deferReply: async (payload: unknown) => {
      defers.push(payload);
    },
    guild: {
      id: "guild-1",
      members: {
        fetch: async () => ({
          permissions: { has: () => true },
          roles: { cache: { some: () => false } },
        }),
      },
      channels: {
        fetch: async (channelId: string) => ({
          id: channelId,
          send: async () => {
            throw new Error("Result edit should refresh the stored final post.");
          },
          messages: {
            fetch: async (messageId: string) => ({
              id: messageId,
              editable: true,
              edit: async (payload: unknown) => {
                editedFinalPost = payload;
                return payload;
              },
            }),
          },
        }),
      },
    },
  });

  const modalHandled = await service.handleModalSubmit(modalInteraction as any);

  assert.equal(modalHandled, true);
  assert.deepEqual(defers[0], { ephemeral: true });
  assert.deepEqual(updateArgs, [
    "match-1",
    "team-1",
    {
      placement: 2,
      kills: 11,
      teamKills: 11,
      playerKills: [
        {
          playerResultId: "player-result-1",
          playerId: "player-1",
          kills: 6,
          isAlive: true,
          isKnocked: false,
        },
        {
          playerResultId: "player-result-2",
          playerId: "player-2",
          kills: 5,
          isAlive: false,
          isKnocked: false,
        },
      ],
    },
  ]);
  assert.equal(editedFinalPost.content, "Updated final");
  assert.equal(editedFinalPost.files[0].name, "overall-ranking.png");
  assert.match((edits[0] as any).content, /Result row saved/);
  assert.match((edits[0] as any).content, /Final post refreshed/);
});

test("manual full result modal saves every active slot team", async () => {
  const context = makeSessionContext();
  const rowOne = {
    id: "row-4",
    matchId: "match-1",
    teamId: "team-4q",
    slot: 4,
    kills: 0,
    teamKills: 0,
    placement: null,
    placementPoints: 0,
    totalPoints: 0,
    wasPresentInMatch: null,
    team: { id: "team-4q", name: "Four Quest", tag: "4Q", logoUrl: null },
    players: [],
  };
  const rowTwo = {
    id: "row-5",
    matchId: "match-1",
    teamId: "team-abc",
    slot: 5,
    kills: 0,
    teamKills: 0,
    placement: null,
    placementPoints: 0,
    totalPoints: 0,
    wasPresentInMatch: null,
    team: { id: "team-abc", name: "Alpha Beta", tag: "ABC", logoUrl: null },
    players: [],
  };
  let manualUpdateArgs: unknown[] | null = null;
  const sessionService = {
    userHasStaffAccess: async () => true,
    findScrimForDiscordChannel: async () => context,
    withOrganization: async (
      _organizationId: string | null,
      fn: () => Promise<unknown>,
    ) => fn(),
    getSessionContext: async () => context,
    listSessionMatchesForDiscord: async () => [
      {
        id: "match-1",
        sessionId: "session-1",
        name: "Match 1",
        matchNumber: 1,
        map: "Erangel",
        status: "READY",
        teamCount: 2,
      },
    ],
    getMatchResultsForDiscord: async () => ({
      results: [rowOne, rowTwo],
      locked: false,
      lockState: "OPEN",
      version: 12,
    }),
    updateManualMatchResultsFromDiscord: async (...args: unknown[]) => {
      manualUpdateArgs = args;
      return { ok: true, version: 13 };
    },
  };
  const service = new ControlPanelService(sessionService as any);
  let shownModal: any = null;
  const { interaction: buttonInteraction } = makeStaffInteraction({
    customId: "resultmanual:open:session-1:match-1",
    showModal: async (modal: any) => {
      shownModal = modal.toJSON();
    },
  });

  const buttonHandled = await service.handleButton(buttonInteraction as any);

  assert.equal(buttonHandled, true);
  assert.ok(shownModal);
  assert.match(shownModal.custom_id, /^resultmanual-modal:/);
  assert.match(shownModal.components[0].components[0].value, /slot 4 4Q/);

  const values = new Map<string, string>([
    ["rows", "slot 4 4Q = 1 8\nslot 5 ABC = 2 3"],
  ]);
  const defers: unknown[] = [];
  const { interaction: modalInteraction, edits } = makeStaffInteraction({
    customId: shownModal.custom_id,
    fields: {
      getTextInputValue: (customId: string) => {
        const value = values.get(customId);
        if (value === undefined) {
          throw new Error(`Missing input ${customId}`);
        }
        return value;
      },
    },
    deferReply: async (payload: unknown) => {
      defers.push(payload);
    },
  });

  const modalHandled = await service.handleModalSubmit(modalInteraction as any);

  assert.equal(modalHandled, true);
  assert.deepEqual(defers[0], { ephemeral: true });
  assert.deepEqual(manualUpdateArgs, [
    "match-1",
    [
      { teamId: "team-4q", placement: 1, kills: 8 },
      { teamId: "team-abc", placement: 2, kills: 3 },
    ],
    12,
  ]);
  assert.match((edits[0] as any).content, /Manual full result saved/);
  assert.match((edits[0] as any).content, /Winner: 4Q - Four Quest/);
  assert.match((edits[0] as any).content, /Final post: not saved yet/);
});

test("result control session autocomplete returns active guild sessions", async () => {
  const responses: unknown[] = [];
  const sessionService = {
    listActiveGuildScrims: async () => [
      makeSessionContext({
        session: {
          ...makeSessionContext().session,
          id: "session-20",
          name: "Training 20:00",
        },
      }),
      makeSessionContext({
        session: {
          ...makeSessionContext().session,
          id: "session-23",
          name: "Training 23:00",
        },
      }),
    ],
  };
  const service = new ControlPanelService(sessionService as any);

  await service.autocompleteResultControlSession({
    guildId: "guild-1",
    options: { getFocused: () => "20" },
    respond: async (choices: unknown) => {
      responses.push(choices);
    },
  } as any);

  assert.deepEqual(responses[0], [
    {
      name: "Training 20:00 | OPEN | 12/20",
      value: "session-20",
    },
  ]);
});

test("result text settings modal updates only result text config", async () => {
  let capturedPatch: Record<string, string> | null = null;
  const context = makeSessionContext({
    config: {
      ...makeSessionContext().config,
      emojis: { banDefaultReason: "Keep me" },
    },
  });
  const sessionService = {
    userHasStaffAccess: async () => true,
    findScrimForDiscordChannel: async () => null,
    getSessionContext: async () => context,
    withOrganization: async (
      _organizationId: string,
      fn: () => Promise<unknown>,
    ) => fn(),
    updateResultControlSettings: async (
      _sessionId: string,
      patch: Record<string, string>,
    ) => {
      capturedPatch = patch;
      return {
        ...context.config,
        emojis: { ...context.config.emojis, ...patch },
      };
    },
  };
  const values = new Map<string, string>([
    ["post-template", "{message}\n\nPosted by Arenzyra"],
    ["message-template", "{trophy} Final\n{winners}"],
    ["winner-row-template", "{rank}. {teamTag} {points}/{kills}"],
    ["winner-count", "4"],
    ["rank-emojis", "1=<:first:123>\n2=<:second:456>"],
  ]);
  const defers: unknown[] = [];
  const { interaction, edits } = makeStaffInteraction({
    customId: "resultctl-modal:text:session-1",
    fields: {
      getTextInputValue: (customId: string) => {
        const value = values.get(customId);
        if (value === undefined) {
          throw new Error(`Missing input ${customId}`);
        }
        return value;
      },
    },
    deferReply: async (payload: unknown) => {
      defers.push(payload);
    },
  });

  const service = new ControlPanelService(sessionService as any);
  const handled = await service.handleModalSubmit(interaction as any);

  assert.equal(handled, true);
  assert.deepEqual(defers[0], { ephemeral: true });
  assert.deepEqual(capturedPatch, {
    finalResultPostTemplate: "{message}\n\nPosted by Arenzyra",
    finalResultMessageTemplate: "{trophy} Final\n{winners}",
    finalResultWinnerRowTemplate: "{rank}. {teamTag} {points}/{kills}",
    finalResultWinnerCount: "4",
    finalResultRankEmojis: "1=<:first:123>\n2=<:second:456>",
  });
  assert.equal((edits[0] as any).content, "Result text settings saved.");
});

test("result no-show rules modal saves custom total and match rules", async () => {
  const capturedPatches: Record<string, string>[] = [];
  const context = makeSessionContext();
  const sessionService = {
    userHasStaffAccess: async () => true,
    findScrimForDiscordChannel: async () => null,
    getSessionContext: async () => context,
    withOrganization: async (
      _organizationId: string,
      fn: () => Promise<unknown>,
    ) => fn(),
    updateResultControlSettings: async (
      _sessionId: string,
      patch: Record<string, string>,
    ) => {
      capturedPatches.push(patch);
      return context.config;
    },
  };
  const values = new Map<string, string>([
    ["total-rules", "1=3d\n2=7d all-sessions"],
    ["match-rules", "match 2=permanent all-sessions | Missed {match}"],
    ["default-scope", "session"],
    ["default-reason", "Missed {misses} match(es) in {session}"],
  ]);
  const { interaction, edits } = makeStaffInteraction({
    customId: "resultctl-modal:rules:session-1",
    fields: {
      getTextInputValue: (customId: string) => {
        const value = values.get(customId);
        if (value === undefined) {
          throw new Error(`Missing input ${customId}`);
        }
        return value;
      },
    },
    deferReply: async () => undefined,
  });

  const service = new ControlPanelService(sessionService as any);
  const handled = await service.handleModalSubmit(interaction as any);

  assert.equal(handled, true);
  const serializedRules = capturedPatches[0]?.noShowBanRules;
  assert.ok(serializedRules);
  assert.deepEqual(JSON.parse(serializedRules), [
    {
      enabled: true,
      type: "TOTAL_MISSES",
      misses: 1,
      matchNumber: null,
      durationDays: 3,
      scope: "SESSION",
      reason: "Missed {misses} match(es) in {session}",
    },
    {
      enabled: true,
      type: "TOTAL_MISSES",
      misses: 2,
      matchNumber: null,
      durationDays: 7,
      scope: "TEAM",
      reason: "Missed {misses} match(es) in {session}",
    },
    {
      enabled: true,
      type: "MATCH_MISSED",
      misses: null,
      matchNumber: 2,
      durationDays: null,
      scope: "TEAM",
      reason: "Missed {match}",
    },
  ]);
  assert.equal((edits[0] as any).content, "Result no-show ban rules saved.");
});

test("result no-show rules keep total misses when matchNumber is null", () => {
  const service = new ControlPanelService({} as any) as any;
  const noShowBanRules = JSON.stringify([
    {
      enabled: true,
      type: "TOTAL_MISSES",
      misses: 2,
      matchNumber: null,
      durationDays: null,
      scope: "SESSION",
      reason: "Missed {misses} match(es) in {session}",
    },
  ]);
  const config = { emojis: { noShowBanRules } };

  assert.equal(
    service.noShowRuleLines(config, "TOTAL_MISSES"),
    "2=permanent session | Missed {misses} match(es) in {session}",
  );
  assert.equal(service.noShowRuleLines(config, "MATCH_MISSED"), "");
  assert.equal(service.noShowBanRuleSummary(config), "2 misses=permanent");
});

test("result no-show rules accept days suffix for total misses", () => {
  const service = new ControlPanelService({} as any) as any;
  const noShowBanRules = service.normalizeNoShowCustomRules(
    {
      totalRules: "2=12days",
      matchRules: "",
      defaultScope: "session",
      defaultReason: "Missed {misses} match(es) in {session}",
    },
    { emojis: {} },
  );

  assert.deepEqual(JSON.parse(noShowBanRules), [
    {
      enabled: true,
      type: "TOTAL_MISSES",
      misses: 2,
      matchNumber: null,
      durationDays: 12,
      scope: "SESSION",
      reason: "Missed {misses} match(es) in {session}",
    },
  ]);
  assert.equal(
    service.noShowRuleLines(
      { emojis: { noShowBanRules } },
      "TOTAL_MISSES",
    ),
    "2=12d session | Missed {misses} match(es) in {session}",
  );
});

test("session manage open-registration button updates state and refreshes panel", async () => {
  const calls: unknown[] = [];
  const context = makeSessionContext();
  const sessionService = {
    userHasStaffAccess: async () => true,
    findScrimForDiscordChannel: async () => null,
    getSessionContext: async () => context,
    listSessionMatchesForDiscord: async () => [],
    withOrganization: async (
      _organizationId: string,
      fn: () => Promise<string>,
    ) => fn(),
    setRegistrationChannelState: async (...args: unknown[]) => {
      calls.push(args);
      return "Registration is open.";
    },
  };
  const defers: unknown[] = [];
  const messageEdits: unknown[] = [];
  const { interaction, edits } = makeStaffInteraction({
    customId: "sessctl:open-registration:session-1",
    guild: {
      id: "guild-1",
      name: "Test Guild",
      members: {
        fetch: async () => ({
          permissions: { has: () => true },
          roles: { cache: { some: () => false } },
        }),
      },
    },
    user: { id: "staff-1", tag: "staff#0001" },
    deferReply: async (payload: unknown) => {
      defers.push(payload);
    },
    message: {
      editable: true,
      edit: async (payload: unknown) => {
        messageEdits.push(payload);
      },
    },
  });

  const service = new ControlPanelService(sessionService as any);
  const handled = await service.handleButton(interaction as any);

  assert.equal(handled, true);
  assert.deepEqual(defers[0], { ephemeral: true });
  assert.equal(edits[0], "Registration is open.");
  assert.equal(calls.length, 1);
  assert.equal((calls[0] as unknown[])[1], "session-1");
  assert.equal((calls[0] as unknown[])[2], "open");
  assert.equal(messageEdits.length, 1);
});

test("play status button shows private team picker for multi-team manager", async () => {
  const edits: any[] = [];
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1" },
      config: { organizationId: "org-1" },
    }),
    withOrganization: async (
      _organizationId: string,
      fn: () => Promise<unknown>,
    ) => fn(),
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
    withOrganization: async (
      _organizationId: string,
      fn: () => Promise<string>,
    ) => fn(),
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
    withOrganization: async (
      _organizationId: string,
      fn: () => Promise<string>,
    ) => fn(),
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
