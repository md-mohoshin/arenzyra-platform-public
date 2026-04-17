"use client";

import React, { useMemo, useState } from "react";
import { OBSController } from "./OBSController";
import { OverlayController } from "./OverlayController";

type SceneControlPanelProps = {
  obs: OBSController | null;
  overlay: OverlayController | null;
  status: string;
  obsSourceMap?: Record<string, string>;
};

const SCENES = ["Gameplay", "Caster Desk", "Analytics", "Break", "Sponsor Stinger", "Winner"];
const TRANSITIONS = ["Cut", "Fade", "Stinger", "Slide"];

export function SceneControlPanel({ obs, overlay, status, obsSourceMap }: SceneControlPanelProps) {
  const [scene, setScene] = useState(SCENES[0]);
  const [transition, setTransition] = useState(TRANSITIONS[1]);
  const [duration, setDuration] = useState(600);
  const [sponsorUrl, setSponsorUrl] = useState("https://sponsor.example.com");
  const [browserSource, setBrowserSource] = useState("LiveOverlay");

  const disabled = !obs || status === "disconnected";

  const quickButtons = useMemo(
    () => [
      { label: "To Caster", scene: "Caster Desk", tone: "btn-secondary" },
      { label: "To Analytics", scene: "Analytics", tone: "btn-secondary" },
      { label: "To Gameplay", scene: "Gameplay", tone: "btn-primary" },
      { label: "To Winner", scene: "Winner", tone: "btn-primary" },
    ],
    [],
  );

  return (
    <div className="broadcast-panel">
      <div className="broadcast-panel__header">
        <div>
          <div className="broadcast-label">Scene Control</div>
          <div className="broadcast-subtitle">OBS WebSocket -&gt; Source toggles</div>
        </div>
        <div className={`pill ${disabled ? "pill-warning" : "pill-success"}`}>
          OBS: {disabled ? "Disconnected" : "Ready"}
        </div>
      </div>

      <div className="scene-grid">
        <div className="card">
          <h3>Primary Scene</h3>
          <div className="row">
            <label className="label">Scene</label>
            <select className="input" value={scene} onChange={(e) => setScene(e.target.value)}>
              {SCENES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <label className="label">Transition</label>
            <div className="grid" style={{ gridTemplateColumns: "1fr 140px" }}>
              <select className="input" value={transition} onChange={(e) => setTransition(e.target.value)}>
                {TRANSITIONS.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <input
                className="input"
                type="number"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value) || 600)}
                min={100}
              />
            </div>
          </div>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button
              className="btn btn-primary"
              disabled={disabled}
              onClick={() => obs?.switchScene(scene, transition, duration)}
            >
              Go Live
            </button>
            <button
              className="btn btn-secondary"
              disabled={disabled}
              onClick={() => obs?.triggerTransition(transition, duration)}
            >
              Transition Only
            </button>
          </div>
          <div className="btn-row wrap" style={{ marginTop: 12 }}>
            {quickButtons.map((btn) => (
              <button
                key={btn.label}
                className={`btn ${btn.tone}`}
                disabled={disabled}
                onClick={() => {
                  setScene(btn.scene);
                  obs?.switchScene(btn.scene, transition, duration);
                }}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <h3>Browser Sources</h3>
          <div className="row">
            <label className="label">Source name</label>
            <input className="input" value={browserSource} onChange={(e) => setBrowserSource(e.target.value)} />
          </div>
          <div className="row">
            <label className="label">Sponsor / Overlay URL</label>
            <input className="input" value={sponsorUrl} onChange={(e) => setSponsorUrl(e.target.value)} />
          </div>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button
              className="btn btn-primary"
              disabled={disabled}
              onClick={() => obs?.setBrowserSourceUrl(browserSource, sponsorUrl)}
            >
              Push URL
            </button>
            <button
              className="btn btn-secondary"
              disabled={disabled}
              onClick={() => obs?.setSourceVisibility(browserSource, true)}
            >
              Show Source
            </button>
            <button
              className="btn btn-ghost"
              disabled={disabled}
              onClick={() => obs?.setSourceVisibility(browserSource, false)}
            >
              Hide Source
            </button>
          </div>
        </div>

        <div className="card">
          <h3>Overlay Bridge</h3>
          <div className="context">
            Control overlays via WebSocket. Use this to trigger lower-thirds or rankings before switching the scene.
          </div>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button
              className="btn btn-primary"
              disabled={!overlay}
              onClick={() => overlay?.showWidget("lower:caster", { headline: "Caster Desk" }, "fade-in", "pmgc")}
            >
              Bump Caster Lower Third
            </button>
            <button
              className="btn btn-secondary"
              disabled={!overlay}
              onClick={() =>
                overlay?.showWidget("overall:day", { headline: "Day Ranking", updatedAt: Date.now() }, "slide-left", "pmgc")
              }
            >
              Push Day Ranking
            </button>
            <button className="btn btn-ghost" disabled={!overlay} onClick={() => overlay?.hideWidget("lower:caster")}>
              Clear
            </button>
          </div>
          {obs && obsSourceMap && Object.keys(obsSourceMap).length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="label">Mapped overlay sources</div>
              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 8 }}>
                {Object.entries(obsSourceMap).map(([widgetId, sourceName]) => (
                  <div key={widgetId} className="list-row two">
                    <div>
                      <div className="value">{widgetId}</div>
                      <div className="muted">OBS: {sourceName}</div>
                    </div>
                    <div className="btn-row wrap">
                      <button
                        className="btn btn-secondary"
                        disabled={disabled}
                        onClick={() => obs.setBrowserSourceUrl(sourceName, sponsorUrl)}
                      >
                        URL
                      </button>
                      <button
                        className="btn btn-primary"
                        disabled={disabled}
                        onClick={() => obs.setSourceVisibility(sourceName, true)}
                      >
                        Show
                      </button>
                      <button
                        className="btn btn-ghost"
                        disabled={disabled}
                        onClick={() => obs.setSourceVisibility(sourceName, false)}
                      >
                        Hide
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SceneControlPanel;
