"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAiCasterEngine } = require("./ai-caster-engine.cjs");

function buildFightSnapshot() {
  return {
    productionSupport: {
      fightAlertCandidate: {
        id: "fight-1",
        teamIds: ["7", "12"],
        matchup: "Team 7 versus Team 12",
      },
      activeAlerts: [],
      teamSplitRisks: [],
    },
    players: {
      players: [
        {
          teamSlot: 7,
          alive: true,
          kills: 3,
          x: 100,
          y: 100,
        },
        {
          teamSlot: 12,
          alive: true,
          kills: 1,
          x: 120,
          y: 120,
        },
      ],
    },
    zone: null,
  };
}

function approveCaster(caster, overrides = {}) {
  caster.setAccess({
    approved: true,
    canConfigure: true,
    canUse: true,
    settings: {
      enabled: true,
      muted: false,
      voiceMode: "dual",
      primaryVoice: "pbp",
      secondaryVoice: "analyst",
      minGapMs: 4000,
      maxLineWords: 22,
      mode: "professional",
      talkFrequency: "high",
      speakingSpeed: "normal",
      expression: "professional",
      priority: "balanced",
      language: "en",
      profanityFilter: true,
      logLines: true,
      allowedRoles: ["ADMIN", "ORGANIZER"],
      ...overrides,
    },
  });
}

test("AI caster stays locked until approved access is provided", () => {
  const caster = createAiCasterEngine();

  const state = caster.evaluate(buildFightSnapshot(), 1000);

  assert.equal(state.ok, false);
  assert.equal(state.status, "locked");
  assert.match(state.currentLine.text, /SuperAdmin approval/);
});

test("AI caster emits a controlled fight cue when approved and enabled", () => {
  const caster = createAiCasterEngine();
  approveCaster(caster, { maxLineWords: 14 });

  const state = caster.evaluate(buildFightSnapshot(), 1000);

  assert.equal(state.ok, true);
  assert.equal(state.currentLine.voice, "pbp");
  assert.equal(state.currentLine.role, "play-by-play");
  assert.equal(state.currentLine.style, "fight");
  assert.match(state.currentLine.text, /Team 7|Team 12/);
  assert.doesNotMatch(state.currentLine.text, /Hold the camera for the commit/);
  assert.ok(state.currentLine.text.split(/\s+/).length <= 14);
});

test("AI caster rotates wording when the same fight remains active", () => {
  const caster = createAiCasterEngine();
  approveCaster(caster);

  const first = caster.evaluate(buildFightSnapshot(), 1000);
  const second = caster.evaluate(buildFightSnapshot(), 31000);

  assert.equal(second.history.length, 2);
  assert.equal(second.history[0].style, "fight");
  assert.notEqual(second.history[0].text, first.history[0].text);
});

test("AI caster does not keep repeating idle no-telemetry standby", () => {
  const caster = createAiCasterEngine();
  approveCaster(caster, { priority: "all" });
  const emptySnapshot = {
    productionSupport: {
      fightAlertCandidate: null,
      activeAlerts: [],
      teamSplitRisks: [],
    },
    players: { players: [] },
    zone: null,
  };

  const first = caster.evaluate(emptySnapshot, 1000);
  const second = caster.evaluate(emptySnapshot, 70000);

  assert.equal(first.currentLine.style, "standby");
  assert.equal(second.history.length, 1);
  assert.equal(second.currentLine.id, first.currentLine.id);
});
