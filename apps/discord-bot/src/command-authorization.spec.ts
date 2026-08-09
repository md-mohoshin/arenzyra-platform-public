import assert from "node:assert/strict";
import test from "node:test";
import {
  applicationCommandRegistry,
  messageContextCommandRegistry,
  slashCommandRegistry,
} from "./command-registry";
import {
  componentAuthorizationPolicy,
  componentAuthorizationSessionId,
  componentRequiresStaff,
  commandAuthorizationPolicy,
  commandAuthorizationSessionId,
  commandRequiresStaff,
  interactionIsPausedFailClosed,
  resolveCommandAuthorizationSession,
} from "./command-authorization";

test("application command registry preserves the exact classified manifest", () => {
  const expectedSlashManifest = [
    ["create-scrim", "staff", null],
    ["register", "contextual", null],
    ["register-team", "contextual", "session-id"],
    ["join-scrim", "contextual", "session-id"],
    ["leave-scrim", "contextual", "session-id"],
    ["list-slots", "self-service", "session-id"],
    ["changename", "staff", null],
    ["start-scrim", "staff", "session-id"],
    ["standings", "self-service", "session-id"],
    ["map-slots", "staff", null],
    ["preview-results", "staff", null],
    ["apply-results", "staff", null],
    ["ticket-open", "self-service", null],
    ["ticket-close", "contextual", null],
    ["ticket-panel", "staff", null],
    ["control-panel", "staff", "session-id"],
    ["ban-control", "staff", null],
    ["result-control", "staff", "session-id"],
    ["play-buttons", "staff", null],
    ["waitlist-control", "staff", null],
    ["arenzyra-doctor", "staff", "session-id"],
    ["schedule-event", "staff", "session-id"],
    ["captain-panel", "staff", "session-id"],
    ["live-center", "staff", "session-id"],
    ["session-audit", "staff", "session-id"],
    ["session-admin", "staff", "session-id"],
    ["team-manager", "contextual", "session-id"],
    ["slot", "self-service", null],
    ["team-media", "contextual", null],
    ["idp-broadcast", "staff", null],
    ["production-setup", "staff", null],
    ["production-pins", "staff", null],
    ["staff-tasks", "staff", null],
    ["idp", "staff", null],
  ];
  assert.deepEqual(
    slashCommandRegistry.map((registration) => [
      registration.command.data.name,
      registration.authorization.policy,
      registration.authorization.sessionIdOption ?? null,
    ]),
    expectedSlashManifest,
  );
  assert.deepEqual(
    messageContextCommandRegistry.map((registration) => [
      registration.command.data.name,
      registration.authorization.policy,
    ]),
    [["Arenzyra Ban Manager", "staff"]],
  );
  assert.equal(slashCommandRegistry.length, 34);
  assert.equal(messageContextCommandRegistry.length, 1);
  assert.equal(applicationCommandRegistry.length, 35);

  const identities = applicationCommandRegistry.map(
    (registration) =>
      `${registration.kind}:${registration.command.data.name.toLowerCase()}`,
  );
  assert.equal(new Set(identities).size, identities.length);

  for (const registration of applicationCommandRegistry) {
    const data = registration.command.data.toJSON() as { name?: string };
    assert.equal(data.name, registration.command.data.name);
    assert.ok(
      ["staff", "self-service", "contextual"].includes(
        registration.authorization.policy,
      ),
    );
    assert.equal(
      typeof registration.authorization.allowedWhilePaused,
      "function",
    );
    assert.equal(
      registration.authorization.allowedWhilePaused({} as never),
      false,
    );
  }

  const sessionAdmin = slashCommandRegistry.find(
    (registration) => registration.command.data.name === "session-admin",
  );
  assert.ok(sessionAdmin);
  assert.equal(
    sessionAdmin.authorization.inferSessionFromConfiguredChannel,
    true,
  );
  assert.equal(sessionAdmin.authorization.channelOption, "channel");
  const pausedInteraction = {
    channelId: "channel-1",
    options: {
      getSubcommand: () => "channel-state",
      getString: () => "active",
      getChannel: () => null,
    },
  } as never;
  assert.equal(
    sessionAdmin.authorization.allowedWhilePaused(pausedInteraction),
    true,
  );
  assert.equal(
    sessionAdmin.authorization.allowedWhilePaused({
      channelId: "channel-1",
      options: {
        getSubcommand: () => "channel-state",
        getString: () => "paused",
        getChannel: () => null,
      },
    } as never),
    false,
  );
  assert.equal(
    sessionAdmin.authorization.allowedWhilePaused({
      channelId: "channel-1",
      options: {
        getSubcommand: () => "channel-state",
        getString: () => "active",
        getChannel: () => ({ id: "channel-2" }),
      },
    } as never),
    false,
  );
});

test("configured-channel staff authorization resolves the selected target session", async () => {
  const registration = slashCommandRegistry.find(
    (candidate) => candidate.command.data.name === "session-admin",
  );
  assert.ok(registration);
  const calls: unknown[][] = [];
  const interaction = {
    guildId: "guild-1",
    channelId: "current-channel",
    channel: { id: "current-channel", topic: null },
    options: {
      getString: () => null,
      getChannel: () => ({
        id: "selected-channel",
        topic: "arenzyra-session=session-1;kind=registration",
      }),
    },
  } as never;

  const resolved = await resolveCommandAuthorizationSession(
    registration,
    interaction,
    async (...args) => {
      calls.push(args);
      return { session: { id: "session-1" } };
    },
  );

  assert.deepEqual(resolved, { allowed: true, sessionId: "session-1" });
  assert.deepEqual(calls, [
    [
      "guild-1",
      "selected-channel",
      "arenzyra-session=session-1;kind=registration",
    ],
  ]);
});

test("configured-channel staff authorization fails closed when no session resolves", async () => {
  const registration = slashCommandRegistry.find(
    (candidate) => candidate.command.data.name === "session-admin",
  );
  assert.ok(registration);
  const interaction = {
    guildId: "guild-1",
    channelId: "unknown-channel",
    channel: { id: "unknown-channel", topic: null },
    options: {
      getString: () => null,
      getChannel: () => null,
    },
  } as never;

  const resolved = await resolveCommandAuthorizationSession(
    registration,
    interaction,
    async () => null,
  );

  assert.equal(resolved.allowed, false);
  assert.match(
    resolved.allowed ? "" : resolved.reason,
    /configured Arenzyra session channel/i,
  );
});

test("configured-channel staff authorization fails closed when lookup errors", async () => {
  const registration = slashCommandRegistry.find(
    (candidate) => candidate.command.data.name === "idp-broadcast",
  );
  assert.ok(registration);
  const interaction = {
    guildId: "guild-1",
    channelId: "idp-channel",
    channel: { id: "idp-channel", topic: null },
    options: { getString: () => null },
  } as never;
  const lookupError = new Error("lookup unavailable");

  const resolved = await resolveCommandAuthorizationSession(
    registration,
    interaction,
    async () => {
      throw lookupError;
    },
  );

  assert.equal(resolved.allowed, false);
  assert.equal(resolved.allowed ? null : resolved.error, lookupError);
});

test("staff commands without configured-channel inference retain guild-level authorization", async () => {
  const registration = slashCommandRegistry.find(
    (candidate) => candidate.command.data.name === "create-scrim",
  );
  assert.ok(registration);
  let lookupCalls = 0;

  const resolved = await resolveCommandAuthorizationSession(
    registration,
    {
      guildId: "guild-1",
      channelId: "channel-1",
      channel: { id: "channel-1" },
      options: { getString: () => null },
    } as never,
    async () => {
      lookupCalls += 1;
      return null;
    },
  );

  assert.deepEqual(resolved, { allowed: true, sessionId: null });
  assert.equal(lookupCalls, 0);
});

test("pause lookup failures fail closed", async () => {
  const lookupError = new Error("pause service unavailable");
  let observedError: unknown = null;

  assert.equal(
    await interactionIsPausedFailClosed(
      async () => {
        throw lookupError;
      },
      (error) => {
        observedError = error;
      },
    ),
    true,
  );
  assert.equal(observedError, lookupError);
  assert.equal(
    await interactionIsPausedFailClosed(async () => false),
    false,
  );
});

test("registered command payloads stay within Discord command limits", () => {
  assert.ok(slashCommandRegistry.length <= 100);
  assert.ok(messageContextCommandRegistry.length <= 15);

  const visitOptions = (options: unknown[], path: string) => {
    assert.ok(options.length <= 25, `${path} has too many options`);
    let optionalSeen = false;
    for (const option of options as Array<{
      name?: string;
      description?: string;
      required?: boolean;
      choices?: unknown[];
      options?: unknown[];
    }>) {
      assert.match(option.name ?? "", /^[a-z0-9_-]{1,32}$/, `${path} option`);
      assert.ok(
        (option.description?.length ?? 0) >= 1 &&
          (option.description?.length ?? 0) <= 100,
        `${path}/${option.name} has an invalid description`,
      );
      if (option.required === false || option.required === undefined) {
        optionalSeen = true;
      } else {
        assert.equal(
          optionalSeen,
          false,
          `${path}/${option.name} places a required option after an optional option`,
        );
      }
      assert.ok(
        (option.choices?.length ?? 0) <= 25,
        `${path}/${option.name} has too many choices`,
      );
      if (option.options) {
        visitOptions(option.options, `${path}/${option.name}`);
      }
    }
  };

  for (const registration of applicationCommandRegistry) {
    const json = registration.command.data.toJSON() as {
      name?: string;
      description?: string;
      options?: unknown[];
    };
    if (registration.kind === "chat-input") {
      assert.match(json.name ?? "", /^[a-z0-9_-]{1,32}$/);
      assert.ok(
        (json.description?.length ?? 0) >= 1 &&
          (json.description?.length ?? 0) <= 100,
      );
      visitOptions(json.options ?? [], json.name ?? "unknown");
    }
    const metadataCharacters = JSON.stringify(json).match(/[\p{L}\p{N}\p{P}\p{S}\s]/gu)?.length ?? 0;
    assert.ok(
      metadataCharacters <= 8_000,
      `${json.name} exceeds Discord's command metadata budget`,
    );
  }
});

test("destructive and costly slash commands require central staff authorization", () => {
  for (const commandName of [
    "create-scrim",
    "start-scrim",
    "preview-results",
    "map-slots",
    "apply-results",
    "production-setup",
  ]) {
    assert.equal(commandRequiresStaff(commandName), true, commandName);
  }
  assert.equal(commandRequiresStaff("join-scrim"), false);
  assert.equal(commandRequiresStaff("standings"), false);
  assert.equal(commandRequiresStaff("Arenzyra Ban Manager"), true);
  assert.equal(commandAuthorizationPolicy("register-team"), "contextual");
  assert.equal(commandAuthorizationPolicy("register"), "contextual");
  assert.equal(commandAuthorizationPolicy("session-admin"), "staff");
  assert.equal(commandAuthorizationPolicy("idp-broadcast"), "staff");
  assert.equal(commandAuthorizationPolicy("standings"), "self-service");
  assert.equal(commandAuthorizationPolicy("future-command"), "unclassified");
});

test("sensitive buttons, selects, and modals reuse central staff policy", () => {
  for (const customId of [
    "destructive:remove:confirm:message-1",
    "autoclean:full:confirm:session-1:2026-08-04:1800",
    "regctl:r:session-1:registration-1",
    "banctl-modal:create:session-1",
    "result:auto:apply:message-1",
    "resultedit:rows:session-1:match-1:0",
    "resultctl-modal:rules:session-1",
    "sessctl:apply-results:session-1",
    "banflow:duration:token-1",
    "autoreggrant:days:token-1",
    "stafftask:approve:task-1",
  ]) {
    assert.equal(componentRequiresStaff(customId), true, customId);
  }

  assert.equal(componentRequiresStaff("control:apply-results:session-1"), true);
  assert.equal(componentRequiresStaff("control:join-scrim:session-1"), false);
  assert.equal(componentRequiresStaff("play:confirm:session-1"), false);
  assert.equal(componentRequiresStaff("ticket:create:launcher"), false);
  assert.equal(componentRequiresStaff("captain:logo-help:session-1"), false);
  assert.equal(componentAuthorizationPolicy("play:confirm:session-1"), "self-service");
  assert.equal(componentAuthorizationPolicy("future:danger:session-1"), "unclassified");

  assert.equal(
    componentAuthorizationSessionId("autoclean:full:confirm:session-1:2026-08-04:1800"),
    "session-1",
  );
  assert.equal(
    componentAuthorizationSessionId("sessctl:apply-results:session-1"),
    "session-1",
  );
  assert.equal(
    componentAuthorizationSessionId("result:auto:apply:message-1"),
    null,
  );
});

test("session authorization context is derived from registry option metadata", () => {
  const getString = (name: string) => (name === "session-id" ? " session-1 " : null);
  assert.equal(commandAuthorizationSessionId("start-scrim", getString), "session-1");
  assert.equal(commandAuthorizationSessionId("join-scrim", getString), "session-1");
  assert.equal(commandAuthorizationSessionId("apply-results", getString), null);
  assert.equal(commandAuthorizationSessionId("future-command", getString), null);
});
