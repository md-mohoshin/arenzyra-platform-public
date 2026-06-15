import assert from "node:assert/strict";
import test from "node:test";
import {
  autoRegistrationWindow,
  parseAutoRegistrationConfig,
  registrationWindow,
  registrationWindowForSession,
  registrationMessageText,
  registrationMessageTitle,
  playConfirmationWindow,
  registrationWindowStatusText,
  registrationWindowStatusTextForSession,
  slotListMarker,
  slotListMessageMode,
  waitlistMessageMode,
  waitlistPromotionWindow,
  waitlistPromotionWindowForSession,
} from "./discord-emojis";

const weeklySchedule = JSON.stringify({
  monday: {
    enabled: true,
    open: "10:00",
    close: "12:00",
  },
});

const statusConfig = {
  registrationWeeklySchedule: weeklySchedule,
  registrationTimeZone: "UTC",
  registrationClosedDetailsHours: "2",
  registrationOpeningSoonHours: "2",
  registrationStatusAlwaysOpenText: "ALWAYS",
  registrationStatusOpenText: "OPEN",
  registrationStatusOpeningSoonText: "SOON",
  registrationStatusClosedRecentText: "RECENT",
  registrationStatusClosedText: "CLOSED",
};

test("registration status uses the always-open template without a schedule", () => {
  assert.equal(
    registrationWindowStatusText({
      registrationStatusAlwaysOpenText: "ALWAYS",
    }),
    "ALWAYS",
  );
});

test("registration status uses the open template during the window", () => {
  assert.equal(
    registrationWindowStatusText(
      statusConfig,
      new Date("2026-05-04T10:30:00.000Z"),
    ),
    "OPEN",
  );
});

test("registration status uses the recent-closed template just after closing", () => {
  assert.equal(
    registrationWindowStatusText(
      statusConfig,
      new Date("2026-05-04T12:30:00.000Z"),
    ),
    "RECENT",
  );
});

test("registration status uses the simple closed template between configured edges", () => {
  assert.equal(
    registrationWindowStatusText(
      statusConfig,
      new Date("2026-05-04T15:00:00.000Z"),
    ),
    "CLOSED",
  );
});

test("registration status uses the opening-soon template before opening", () => {
  assert.equal(
    registrationWindowStatusText(
      statusConfig,
      new Date("2026-05-04T08:30:00.000Z"),
    ),
    "SOON",
  );
});

test("weekly registration schedule overrides manual registration state", () => {
  assert.equal(
    registrationWindow(
      {
        registrationWeeklySchedule: weeklySchedule,
        registrationManualState: "open",
      },
      new Date("2026-05-04T15:00:00.000Z"),
    ).allowsAction,
    false,
  );
  assert.equal(
    registrationWindow(
      {
        registrationWeeklySchedule: weeklySchedule,
        registrationManualState: "closed",
      },
      new Date("2026-05-04T10:30:00.000Z"),
    ).allowsAction,
    true,
  );
  assert.equal(
    registrationWindow(
      {
        registrationManualState: "closed",
      },
      new Date("2026-05-04T10:30:00.000Z"),
    ).allowsAction,
    false,
  );
});

test("staff registration schedule override takes priority over weekly schedule", () => {
  assert.equal(
    registrationWindow(
      {
        registrationWeeklySchedule: weeklySchedule,
        registrationScheduleOverrideState: "open",
      },
      new Date("2026-05-04T15:00:00.000Z"),
    ).allowsAction,
    true,
  );
  assert.equal(
    registrationWindow(
      {
        registrationWeeklySchedule: weeklySchedule,
        registrationScheduleOverrideState: "closed",
      },
      new Date("2026-05-04T10:30:00.000Z"),
    ).allowsAction,
    false,
  );
});

test("waitlist promotion is closed by default and opens only during its schedule", () => {
  assert.equal(
    waitlistPromotionWindow({}, new Date("2026-05-04T10:30:00.000Z"))
      .allowsAction,
    false,
  );
  assert.equal(
    waitlistPromotionWindow(
      {
        waitlistPromotionWeeklySchedule: weeklySchedule,
        waitlistPromotionTimeZone: "UTC",
      },
      new Date("2026-05-04T10:30:00.000Z"),
    ).allowsAction,
    true,
  );
  assert.equal(
    waitlistPromotionWindowForSession(
      { status: "ENDED" },
      {
        waitlistPromotionWeeklySchedule: weeklySchedule,
        waitlistPromotionTimeZone: "UTC",
      },
      new Date("2026-05-04T10:30:00.000Z"),
    ).allowsAction,
    false,
  );
});

test("temporary waitlist promotion auto-open expires at the stored timestamp", () => {
  const openWindow = waitlistPromotionWindow(
    {
      waitlistPromotionAutoOpenUntil: "2026-05-04T10:45:00.000Z",
    },
    new Date("2026-05-04T10:30:00.000Z"),
  );
  assert.equal(openWindow.allowsAction, true);
  assert.equal(openWindow.closesAt?.toISOString(), "2026-05-04T10:45:00.000Z");

  assert.equal(
    waitlistPromotionWindow(
      {
        waitlistPromotionAutoOpenUntil: "2026-05-04T10:45:00.000Z",
      },
      new Date("2026-05-04T10:46:00.000Z"),
    ).allowsAction,
    false,
  );
});

test("confirmation waitlist grace reopens a closed confirmation window until expiry", () => {
  const schedule = JSON.stringify({
    monday: {
      enabled: true,
      open: "09:00",
      close: "10:00",
      waitlistStart: "",
    },
  });
  const openWindow = playConfirmationWindow(
    {
      playConfirmationWeeklySchedule: schedule,
      playConfirmationTimeZone: "UTC",
      playConfirmationWaitlistGraceUntil: "2026-05-04T10:45:00.000Z",
    },
    new Date("2026-05-04T10:30:00.000Z"),
  );
  assert.equal(openWindow.allowsAction, true);
  assert.equal(openWindow.state, "open");
  assert.equal(openWindow.closesAt?.toISOString(), "2026-05-04T10:45:00.000Z");

  const expiredWindow = playConfirmationWindow(
    {
      playConfirmationWeeklySchedule: schedule,
      playConfirmationTimeZone: "UTC",
      playConfirmationWaitlistGraceUntil: "2026-05-04T10:45:00.000Z",
    },
    new Date("2026-05-04T10:46:00.000Z"),
  );
  assert.equal(expiredWindow.allowsAction, false);
  assert.equal(expiredWindow.state, "closed");
});

test("weekly waitlist promotion schedule overrides manual state", () => {
  assert.equal(
    waitlistPromotionWindow(
      {
        waitlistPromotionWeeklySchedule: weeklySchedule,
        waitlistPromotionTimeZone: "UTC",
        waitlistPromotionManualState: "open",
      },
      new Date("2026-05-04T15:00:00.000Z"),
    ).allowsAction,
    false,
  );
  assert.equal(
    waitlistPromotionWindow(
      {
        waitlistPromotionWeeklySchedule: weeklySchedule,
        waitlistPromotionTimeZone: "UTC",
        waitlistPromotionManualState: "closed",
      },
      new Date("2026-05-04T10:30:00.000Z"),
    ).allowsAction,
    true,
  );
});

test("staff waitlist promotion schedule override takes priority", () => {
  assert.equal(
    waitlistPromotionWindow(
      {
        waitlistPromotionWeeklySchedule: weeklySchedule,
        waitlistPromotionTimeZone: "UTC",
        waitlistPromotionScheduleOverrideState: "open",
      },
      new Date("2026-05-04T15:00:00.000Z"),
    ).allowsAction,
    true,
  );
  assert.equal(
    waitlistPromotionWindow(
      {
        waitlistPromotionWeeklySchedule: weeklySchedule,
        waitlistPromotionTimeZone: "UTC",
        waitlistPromotionScheduleOverrideState: "closed",
      },
      new Date("2026-05-04T10:30:00.000Z"),
    ).allowsAction,
    false,
  );
});

test("registration status renders manual open as open", () => {
  assert.equal(
    registrationWindowStatusText({
      registrationManualState: "open",
      registrationStatusAlwaysOpenText: "OPEN MANUAL",
    }),
    "OPEN MANUAL",
  );
});

test("event registration message does not duplicate the format after command", () => {
  const text = registrationMessageText(
    {
      registrationMode: "EVENT",
      emojis: {
        registrationMessageText:
          "Register for {session} with this message format:\n\n{command} Team Name | Team Tag | @manager",
      },
    } as any,
    { name: "Daily Scrim", registrationCommand: "%register" },
  );

  assert.equal(
    text,
    "Register for Daily Scrim with this message format:\n\nTeam Name | Team Tag | @manager",
  );
});

test("tournament registration message uses roster format by default", () => {
  const text = registrationMessageText(
    {
      registrationMode: "TOURNAMENT",
      emojis: {
        registrationMessageText: "Register for {session} with this message format:\n\n{command}",
      },
    } as any,
    { name: "Daily Tournament", registrationCommand: "%register" },
  );

  assert.match(text, /team name: Team Name/);
  assert.match(text, /team tag: TEAMTAG/);
  assert.match(text, /team manager: @manager/);
});

test("tournament registration panel uses tournament title by default", () => {
  assert.equal(
    registrationMessageTitle({
      registrationMode: "TOURNAMENT",
      emojis: {
        registrationMessageTitle: "Arenzyra Scrim Registration",
      },
    } as any),
    "Arenzyra Tournament Registration",
  );
});

test("registration session status keeps scheduled draft scrims visible", () => {
  const session = {
    status: "DRAFT",
    registrationOpenAt: null,
    registrationCloseAt: null,
  };

  assert.equal(
    registrationWindowForSession(
      session,
      statusConfig,
      new Date("2026-05-04T08:30:00.000Z"),
    ).state,
    "not_open",
  );
  assert.equal(
    registrationWindowStatusTextForSession(
      session,
      statusConfig,
      new Date("2026-05-04T08:30:00.000Z"),
    ),
    "SOON",
  );
});

test("registration session status uses absolute session windows without a schedule", () => {
  const config = {
    registrationStatusAlwaysOpenText: "ALWAYS",
    registrationStatusOpenText: "OPEN UNTIL {closesRelative}",
    registrationStatusClosedText: "CLOSED",
  };

  assert.match(
    registrationWindowStatusTextForSession(
      {
        status: "OPEN",
        registrationOpenAt: null,
        registrationCloseAt: "2026-05-04T12:00:00.000Z",
      },
      config,
      new Date("2026-05-04T10:30:00.000Z"),
    ),
    /^OPEN UNTIL <t:\d+:R>$/,
  );
  assert.equal(
    registrationWindowStatusTextForSession(
      {
        status: "ENDED",
        registrationOpenAt: null,
        registrationCloseAt: null,
      },
      config,
      new Date("2026-05-04T10:30:00.000Z"),
    ),
    "CLOSED",
  );
});

test("registration session status respects disabled registration flag", () => {
  const session = {
    status: "OPEN",
    registrationOpenAt: null,
    registrationCloseAt: null,
  };
  const config = {
    disableSlotAndVipRegistration: true,
    emojis: {
      registrationStatusAlwaysOpenText: "OPEN",
      registrationStatusClosedText: "CLOSED",
    },
  };

  const window = registrationWindowForSession(
    session,
    config,
    new Date("2026-05-04T10:30:00.000Z"),
  );

  assert.equal(window.state, "closed");
  assert.equal(window.allowsAction, false);
  assert.equal(
    registrationWindowStatusTextForSession(
      session,
      config,
      new Date("2026-05-04T10:30:00.000Z"),
    ),
    "CLOSED",
  );
});

test("slot list message mode defaults to embed and supports plain text", () => {
  assert.equal(slotListMessageMode({}), "embed");
  assert.equal(slotListMessageMode({ slotListMessageMode: "plain" }), "plain");
  assert.equal(
    slotListMessageMode({ slotListMessageMode: "unknown" }),
    "embed",
  );
});

test("waitlist message mode defaults to embed and supports plain text", () => {
  assert.equal(waitlistMessageMode({}), "embed");
  assert.equal(waitlistMessageMode({ waitlistMessageMode: "plain" }), "plain");
  assert.equal(
    waitlistMessageMode({ waitlistMessageMode: "unknown" }),
    "embed",
  );
});

test("auto registration config normalizes placement, fallback, and limits", () => {
  const config = parseAutoRegistrationConfig({
    autoRegistrationEnabled: "true",
    autoRegistrationRoleId: "123456789012345678",
    autoRegistrationRoleName: "Auto Teams",
    autoRegistrationPlacement: "vip",
    autoRegistrationWaitlistFallback: "false",
    autoRegistrationMaxTeams: "250",
    autoRegistrationLastRunKey: "run-1",
  });

  assert.equal(config.enabled, true);
  assert.equal(config.roleId, "123456789012345678");
  assert.equal(config.roleName, "Auto Teams");
  assert.equal(config.placement, "vip");
  assert.equal(config.waitlistFallback, false);
  assert.equal(config.maxTeams, 100);
  assert.equal(config.lastRunKey, "run-1");
});

test("auto registration opens only during an enabled role schedule", () => {
  const schedule = JSON.stringify({
    monday: { enabled: true, open: "10:00", close: "12:00" },
  });
  const config = {
    autoRegistrationEnabled: "true",
    autoRegistrationRoleId: "123456789012345678",
    autoRegistrationWeeklySchedule: schedule,
    autoRegistrationTimeZone: "UTC",
  };

  const openWindow = autoRegistrationWindow(
    config,
    new Date("2026-05-04T10:30:00.000Z"),
  );
  assert.equal(openWindow.allowsAction, true);
  assert.equal(openWindow.opensAt?.toISOString(), "2026-05-04T10:00:00.000Z");

  assert.equal(
    autoRegistrationWindow(config, new Date("2026-05-04T12:30:00.000Z"))
      .allowsAction,
    false,
  );
  assert.equal(
    autoRegistrationWindow(
      { ...config, autoRegistrationEnabled: "false" },
      new Date("2026-05-04T10:30:00.000Z"),
    ).allowsAction,
    false,
  );
});

test("numbered slot list markers are bold and punctuated", () => {
  assert.equal(
    slotListMarker({
      slotNumber: 3,
      config: { emojis: { slotListMode: "number" } },
    }),
    "**3.**",
  );
  assert.equal(
    slotListMarker({
      slotNumber: 22,
      vipIndex: 1,
      config: { emojis: { slotListMode: "number" } },
    }),
    "**VIP 1.**",
  );
});
