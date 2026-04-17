"use client";

import React from "react";

export type BroadcastSection =
  | "Live Widgets"
  | "Scene Control"
  | "Overlays"
  | "Animations"
  | "Alerts";

type Props = {
  active: BroadcastSection;
  onSelect: (section: BroadcastSection) => void;
};

const sections: Array<{ label: BroadcastSection; description: string }> = [
  { label: "Live Widgets", description: "Lower thirds, rankings, alerts" },
  { label: "Scene Control", description: "Switch OBS scenes + transitions" },
  { label: "Overlays", description: "Browser overlays and data bridge" },
  { label: "Animations", description: "Lottie / GSAP presets" },
  { label: "Alerts", description: "Safety + sponsor stingers" },
];

export function BroadcastSidebar({ active, onSelect }: Props) {
  return (
    <aside className="broadcast-sidebar">
      <div className="broadcast-sidebar__header">
        <div className="broadcast-label">BROADCAST</div>
        <div className="broadcast-subtitle">PMGC-style control</div>
      </div>
      <div className="broadcast-nav">
        {sections.map((item) => {
          const selected = item.label === active;
          return (
            <button
              key={item.label}
              className={`broadcast-nav__item ${selected ? "is-active" : ""}`}
              onClick={() => onSelect(item.label)}
            >
              <div className="broadcast-nav__title">{item.label}</div>
              <div className="broadcast-nav__desc">{item.description}</div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

export default BroadcastSidebar;
