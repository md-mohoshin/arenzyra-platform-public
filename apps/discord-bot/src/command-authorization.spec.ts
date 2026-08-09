import assert from "node:assert/strict";
import test from "node:test";
import {
  componentAuthorizationPolicy,
  componentAuthorizationSessionId,
  componentRequiresStaff,
  commandAuthorizationSessionId,
  commandRequiresStaff,
} from "./command-authorization";

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

test("session authorization context is forwarded only for session-scoped commands", () => {
  const getString = (name: string) => (name === "session-id" ? " session-1 " : null);
  assert.equal(commandAuthorizationSessionId("start-scrim", getString), "session-1");
  assert.equal(commandAuthorizationSessionId("apply-results", getString), null);
});
