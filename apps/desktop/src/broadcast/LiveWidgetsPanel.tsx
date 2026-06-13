"use client";

import React, { useMemo, useState } from "react";
import { OverlayController, type WidgetTheme, type WidgetAnimation } from "./OverlayController";

type WidgetRow = {
  id: string;
  label: string;
  group: string;
  description?: string;
};

const widgetCatalog: WidgetRow[] = [
  { id: "lower:player", label: "Player Lower Third", group: "LOWER THIRDS" },
  { id: "lower:team", label: "Team Lower Third", group: "LOWER THIRDS" },
  { id: "lower:caster", label: "Caster Lower Third", group: "LOWER THIRDS" },
  { id: "lower:sponsor", label: "Sponsor Lower Third", group: "LOWER THIRDS" },
  { id: "ranking:top8", label: "Top 8 Live Ranking", group: "LIVE RANKINGS" },
  { id: "ranking:kills", label: "Kill Leaderboard", group: "LIVE RANKINGS" },
  { id: "ranking:mvp", label: "MVP Board", group: "LIVE RANKINGS" },
  { id: "notify:start", label: "Match Starting", group: "MATCH NOTIFICATIONS" },
  { id: "notify:plane", label: "Plane Entered", group: "MATCH NOTIFICATIONS" },
  { id: "notify:final", label: "Final Circle", group: "MATCH NOTIFICATIONS" },
  { id: "notify:wwcd", label: "Winner Winner Chicken Dinner", group: "MATCH NOTIFICATIONS" },
  { id: "achieve:wipe", label: "Team Wipe", group: "TEAM ACHIEVEMENTS" },
  { id: "achieve:10kills", label: "10+ Kills", group: "TEAM ACHIEVEMENTS" },
  { id: "achieve:clutch", label: "Clutch Moment", group: "TEAM ACHIEVEMENTS" },
  { id: "achieve:longshot", label: "Longest Kill", group: "TEAM ACHIEVEMENTS" },
  { id: "overall:day", label: "Day Ranking", group: "OVERALL RANKING" },
  { id: "overall:group", label: "Group Ranking", group: "OVERALL RANKING" },
  { id: "overall:grand", label: "Grand Finals Ranking", group: "OVERALL RANKING" },
  { id: "killfeed:pmgc", label: "PMGC Style Kill Feed", group: "KILL FEED OVERLAY" },
  { id: "killfeed:sponsor", label: "Sponsor Theme", group: "KILL FEED OVERLAY" },
  { id: "stats:alive", label: "Alive Teams / Players", group: "MATCH STATS PANEL" },
  { id: "stats:zone", label: "Zone Info", group: "MATCH STATS PANEL" },
  { id: "stats:damage", label: "Damage Stats", group: "MATCH STATS PANEL" },
];

type Props = {
  overlayController: OverlayController | null;
  matchId: string;
  overlayStatus: "connected" | "connecting" | "disconnected";
};

export function LiveWidgetsPanel({ overlayController, matchId, overlayStatus }: Props) {
  const [themes, setThemes] = useState<Record<string, WidgetTheme>>({});
  const [animations, setAnimations] = useState<Record<string, WidgetAnimation>>({});

  const grouped = useMemo(() => {
    const groups = new Map<string, WidgetRow[]>();
    widgetCatalog.forEach((w) => {
      if (!groups.has(w.group)) groups.set(w.group, []);
      groups.get(w.group)!.push(w);
    });
    return Array.from(groups.entries());
  }, []);

  const statusLabel =
    overlayStatus === "connected"
      ? "Overlay bridge online"
      : overlayStatus === "connecting"
        ? "Connecting to overlay..."
        : "Overlay bridge offline";

  const actionDisabled = !overlayController || overlayStatus !== "connected";

  return (
    <div className="broadcast-panel">
      <div className="broadcast-panel__header">
        <div>
          <div className="broadcast-label">Live Widgets</div>
          <div className="broadcast-subtitle">
            OBS graphics control for Match: {matchId || "not set"}
          </div>
        </div>
        <div className={`pill ${overlayStatus === "connected" ? "pill-success" : "pill-warning"}`}>{statusLabel}</div>
      </div>

      <div className="widget-groups">
        {grouped.map(([groupName, items]) => (
          <div key={groupName} className="widget-group">
            <div className="widget-group__title">{groupName}</div>
            <div className="widget-grid">
              {items.map((item) => {
                const theme = themes[item.id] ?? "pmgc";
                const animation = animations[item.id] ?? "slide-up";
                return (
                  <div key={item.id} className="widget-card">
                    <div className="widget-card__header">
                      <div>
                        <div className="widget-card__title">{item.label}</div>
                        <div className="widget-card__desc">{item.description || "Ready for live push"}</div>
                      </div>
                      <div className="widget-preview">Preview</div>
                    </div>
                    <div className="widget-card__controls">
                      <div className="widget-selectors">
                        <label className="label">Animation</label>
                        <select
                          className="input"
                          value={animation}
                          onChange={(e) =>
                            setAnimations((s) => ({ ...s, [item.id]: e.target.value as WidgetAnimation }))
                          }
                        >
                          <option value="slide-up">Slide Up</option>
                          <option value="slide-left">Slide Left</option>
                          <option value="fade-in">Fade In</option>
                          <option value="pop">Pop</option>
                        </select>
                      </div>
                      <div className="widget-selectors">
                        <label className="label">Theme</label>
                        <select
                          className="input"
                          value={theme}
                          onChange={(e) =>
                            setThemes((s) => ({ ...s, [item.id]: e.target.value as WidgetTheme }))
                          }
                        >
                          <option value="pmgc">PMGC Dark</option>
                          <option value="sponsor">Sponsor</option>
                          <option value="minimal">Minimal</option>
                          <option value="gold">Golden</option>
                        </select>
                      </div>
                    </div>
                    <div className="widget-actions">
                      <button
                        className="btn btn-secondary"
                        disabled={actionDisabled}
                        onClick={() => overlayController?.showWidget(item.id, { matchId }, animation, theme)}
                      >
                        Show
                      </button>
                      <button
                        className="btn btn-primary"
                        disabled={actionDisabled}
                        onClick={() =>
                          overlayController?.updateWidget(item.id, { matchId, refreshedAt: Date.now() }, animation, theme)
                        }
                      >
                        Update
                      </button>
                      <button
                        className="btn btn-ghost"
                        disabled={actionDisabled}
                        onClick={() => overlayController?.hideWidget(item.id)}
                      >
                        Hide
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default LiveWidgetsPanel;
