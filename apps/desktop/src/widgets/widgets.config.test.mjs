import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  buildWidgetUrl,
  buildWidgetUrlTemplate,
  widgets,
} from "./widgets.config.ts";

const GOLD_LOCAL_WIDGET_KEYS = new Map([
  ["gold_broadcast_roster", "gold-broadcast-focused-roster"],
  ["next_zone_update_gold_ring", "next-zone-update-gold-ring"],
  ["gold_broadcast_player_stats", "gold-broadcast-player-stats"],
]);
const GOLD_WIDGET_KEYS = new Map([
  ...GOLD_LOCAL_WIDGET_KEYS,
  ["gold_broadcast_final_five", "final-five-alive"],
]);

const REMOVED_GOLD_WIDGET_IDS = [
  "gold_broadcast_zone",
  "gold_broadcast_leaderboard",
  "gold_broadcast_overall_leaderboard",
  "gold_broadcast_overall_final_five",
  "gold_broadcast_elimination",
  "gold_broadcast_domination",
  "gold_broadcast_lower_third",
  "gold_broadcast_pre_match",
  "gold_broadcast_post_match",
];

test("Gold Broadcast exposes four independent permanent widgets", () => {
  const goldWidgets = widgets.filter((widget) =>
    GOLD_WIDGET_KEYS.has(widget.id),
  );

  assert.equal(goldWidgets.length, 4);
  assert.equal(
    widgets.filter((widget) => widget.name.startsWith("Gold Broadcast -")).length,
    4,
  );
  assert.deepEqual(
    new Set(goldWidgets.map((widget) => widget.widgetKey)),
    new Set(GOLD_WIDGET_KEYS.values()),
  );
  assert.equal(
    widgets.filter(
      (widget) => widget.widgetKey === "next-zone-update-gold-ring",
    ).length,
    1,
  );

  for (const widget of goldWidgets) {
    assert.equal(widget.routeKind, "permanent", widget.id);
    assert.equal(widget.path, "/w/:widgetInstanceKey", widget.id);
    assert.equal(widget.requiresWidgetInstanceKey, true, widget.id);
    assert.equal(widget.widgetKey, GOLD_WIDGET_KEYS.get(widget.id));
    assert.equal(widget.query, undefined, widget.id);
  }
});

test("remote Gold panel aliases and the duplicate zone entry are absent", () => {
  for (const widgetId of REMOVED_GOLD_WIDGET_IDS) {
    assert.equal(
      widgets.some((widget) => widget.id === widgetId),
      false,
      widgetId,
    );
  }
});

test("each Gold widget builds its own permanent capability URL", () => {
  for (const [widgetId, widgetKey] of GOLD_WIDGET_KEYS) {
    const widget = widgets.find((candidate) => candidate.id === widgetId);
    assert.ok(widget, widgetId);

    const capability = `${widgetKey}-secret`;
    const url = new URL(
      buildWidgetUrl("http://127.0.0.1:3000?token=local", widget, {
        widgetInstanceKey: capability,
      }),
    );
    assert.equal(url.pathname, `/w/${capability}`);
    assert.equal(url.searchParams.get("token"), "local");
    assert.equal(url.searchParams.has("style"), false);
    assert.equal(url.searchParams.has("panel"), false);

    const template = buildWidgetUrlTemplate(
      "http://127.0.0.1:3000?token=local",
      widget,
    );
    assert.match(template, /<widget-instance-key>/);
    assert.match(template, /token=local/);
  }
});

test("Final Five uses its own approval filter inside the Gold Broadcast group", () => {
  const source = fs.readFileSync(
    new URL("../screens/widgets-screen.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /const GOLD_FINAL_FIVE_WIDGET_ID = "gold_broadcast_final_five";/,
  );
  assert.match(
    source,
    /const GOLD_FINAL_FIVE_WIDGET_KEY = "final-five-alive";/,
  );
  assert.match(
    source,
    /const goldFinalFiveCatalogState =\s*widgetCatalog\?\.items\?\.\[GOLD_FINAL_FIVE_WIDGET_KEY\] \?\? null;/,
  );
  assert.match(
    source,
    /if \(widget\.id === GOLD_FINAL_FIVE_WIDGET_ID\) \{\s*return goldFinalFiveApproved;\s*\}/,
  );
  assert.match(
    source,
    /const GOLD_BROADCAST_WIDGET_IDS = new Set\(\[[\s\S]*?GOLD_FINAL_FIVE_WIDGET_ID,[\s\S]*?\]\);/,
  );
});

test("retired remote-live widgets are not exposed by hotkey controls", () => {
  const source = fs.readFileSync(
    new URL("../screens/widgets-screen.tsx", import.meta.url),
    "utf8",
  );
  const hotkeyStart = source.indexOf("const HOTKEY_WIDGET_OPTIONS:");
  const hotkeyEnd = source.indexOf("const DEFAULT_HOTKEY_CONFIG", hotkeyStart);
  assert.ok(
    hotkeyStart >= 0 && hotkeyEnd > hotkeyStart,
    "hotkey option block must remain explicit",
  );
  const hotkeyOptions = source.slice(hotkeyStart, hotkeyEnd);
  for (const retiredWidgetKey of [
    "teams-alive",
    "kill-feed",
    "player-card",
    "map-overlay",
    "winner",
  ]) {
    assert.doesNotMatch(
      hotkeyOptions,
      new RegExp(`widgetKey: "${retiredWidgetKey}"`),
    );
  }
  assert.match(hotkeyOptions, /widgetKey: "leaderboard"/);
  assert.match(hotkeyOptions, /widgetKey: "match-start-notification"/);
});
