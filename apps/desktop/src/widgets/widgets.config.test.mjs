import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  buildWidgetUrl,
  buildWidgetUrlTemplate,
  widgets,
} from "./widgets.config.ts";

test("Final Five is the single reviewed Gold Broadcast launcher entry", () => {
  const goldWidgets = widgets.filter((widget) =>
    widget.name.startsWith("Gold Broadcast -"),
  );
  assert.equal(goldWidgets.length, 1);
  const widget = goldWidgets[0];
  assert.equal(widget.id, "gold_broadcast_final_five");
  assert.equal(widget.widgetKey, "final-five-alive");
  assert.equal(widget.routeKind, "permanent");
  assert.equal(widget.path, "/w/:widgetInstanceKey");
  assert.equal(widget.requiresWidgetInstanceKey, true);

  const capability = `wgt_${Buffer.alloc(32, 29).toString("base64url")}`;
  const url = new URL(
    buildWidgetUrl("http://127.0.0.1:5510?launcher=1", widget, {
      widgetInstanceKey: capability,
    }),
  );
  assert.equal(url.pathname, `/w/${capability}`);
  assert.equal(url.searchParams.get("launcher"), "1");
  assert.match(
    buildWidgetUrlTemplate("http://127.0.0.1:5510", widget),
    /\/w\/<widget-instance-key>/,
  );
});

test("Final Five uses its own catalog approval in the widgets screen", () => {
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
