(function () {
  "use strict";

  const bootstrap = window.__ARENZYRA_COMMENTATOR_DESK_BOOTSTRAP__ || {};
  const root = document.getElementById("commentator-desk");
  const mapFrame = document.getElementById("map-frame");
  const lockedCopy = document.getElementById("locked-copy");
  const statusPill = document.getElementById("status-pill");
  const deskTitle = document.getElementById("desk-title");
  const primaryCue = document.getElementById("primary-cue");
  const cueList = document.getElementById("cue-list");
  const splitList = document.getElementById("split-list");
  const distanceList = document.getElementById("distance-list");
  const productionList = document.getElementById("production-list");
  const metricTeams = document.getElementById("metric-teams");
  const metricPlayers = document.getElementById("metric-players");
  const metricKnocked = document.getElementById("metric-knocked");
  const metricFiring = document.getElementById("metric-firing");
  const zoneTimer = document.getElementById("zone-timer");
  const zoneStatus = document.getElementById("zone-status");

  const POLL_MS = 750;
  let mapFrameStarted = false;
  let pollTimer = null;
  let lastStateSignature = "";

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function attr(value) {
    return escapeHtml(value).replace(/'/g, "&#39;");
  }

  function emptyMarkup(message) {
    return `<div class="empty">${escapeHtml(message)}</div>`;
  }

  function formatUpdatedAt(value) {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) {
      return "Standby";
    }
    try {
      return new Date(numeric).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch (_) {
      return "Standby";
    }
  }

  function ensureMapFrame(state) {
    if (!mapFrame || mapFrameStarted || !state || state.ok !== true) {
      return;
    }
    const src = mapFrame.getAttribute("data-src") || bootstrap.mapFrameUrl || "/obs/map";
    mapFrame.src = src;
    mapFrameStarted = true;
  }

  function setText(element, value) {
    if (element && element.textContent !== String(value)) {
      element.textContent = String(value);
    }
  }

  function renderPrimaryCue(cues) {
    const cue = Array.isArray(cues) && cues.length > 0 ? cues[0] : null;
    const label = cue?.label || "Standby";
    const line = cue?.line || "Waiting for local telemetry.";
    const meta = cue?.meta || "Launcher data only";
    primaryCue.dataset.tone = cue?.tone || "idle";
    primaryCue.innerHTML = `
      <div>
        <div class="cue-label">${escapeHtml(label)}</div>
        <div class="cue-line">${escapeHtml(line)}</div>
      </div>
      <div class="cue-meta">${escapeHtml(meta)}</div>
    `;
  }

  function renderCues(cues) {
    const rows = Array.isArray(cues) ? cues.slice(1, 7) : [];
    cueList.innerHTML = rows.length
      ? rows
          .map(
            (cue) => `
              <div class="cue-item">
                <div class="cue-tag">${escapeHtml(cue.label || "Cue")}</div>
                <div class="cue-copy">
                  <div class="cue-text">${escapeHtml(cue.line || "")}</div>
                  <div class="cue-sub">${escapeHtml(cue.meta || "")}</div>
                </div>
              </div>
            `,
          )
          .join("")
      : emptyMarkup("No secondary cues yet.");
  }

  function renderSplits(splits) {
    const rows = Array.isArray(splits) ? splits : [];
    splitList.innerHTML = rows.length
      ? rows
          .map(
            (split) => `
              <div class="compact-row">
                <div class="compact-copy">
                  <div class="compact-main">${escapeHtml(split.label || "Team")} spread ${escapeHtml(
                    split.spreadMeters,
                  )}m</div>
                  <div class="compact-sub">${escapeHtml(split.activePlayers || 0)} active players</div>
                </div>
              </div>
            `,
          )
          .join("")
      : emptyMarkup("No major team splits.");
  }

  function renderDistances(distancePairs) {
    const rows = Array.isArray(distancePairs) ? distancePairs : [];
    distanceList.innerHTML = rows.length
      ? rows
          .slice(0, 8)
          .map((row) => {
            const players =
              row.leftPlayerName && row.rightPlayerName
                ? `${row.leftPlayerName} / ${row.rightPlayerName}`
                : `${row.leftActive || 0} alive / ${row.rightActive || 0} alive`;
            const status =
              row.knockedCount > 0
                ? `${row.knockedCount} knocked`
                : row.firingCount > 0
                  ? `${row.firingCount} firing`
                  : players;
            return `
              <div class="distance-row" data-tone="${attr(row.tone || "wide")}">
                <div class="distance-copy">
                  <div class="distance-main">${escapeHtml(row.slotMatchup || "Slot ? vs Slot ?")}</div>
                  <div class="distance-sub">${escapeHtml(status)}</div>
                </div>
                <div class="distance-value">${escapeHtml(row.distanceMeters || 0)}m</div>
              </div>
            `;
          })
          .join("")
      : emptyMarkup("Waiting for team distance data.");
  }

  function renderProduction(state) {
    const camera = state.camera || {};
    const rows = [
      {
        label: "Camera",
        value: camera.recommendation || "No recommendation",
        sub: "Observer assist",
      },
      {
        label: "Watch",
        value: `${camera.watchTargets || 0} targets`,
        sub: `${camera.alerts || 0} alerts, ${camera.replayCandidates || 0} replay candidates`,
      },
      {
        label: "Updated",
        value: formatUpdatedAt(state.telemetry?.updatedAt),
        sub: `${state.telemetry?.distancePairs || 0} distance pairs`,
      },
    ];

    productionList.innerHTML = rows
      .map(
        (row) => `
          <div class="compact-row">
            <div class="compact-copy">
              <div class="compact-main">${escapeHtml(row.label)}: ${escapeHtml(row.value)}</div>
              <div class="compact-sub">${escapeHtml(row.sub)}</div>
            </div>
          </div>
        `,
      )
      .join("");
  }

  function renderLocked(state) {
    root.dataset.status = "locked";
    setText(statusPill, "Locked");
    setText(lockedCopy, state?.message || "Waiting for Super Admin approval.");
    renderPrimaryCue([
      {
        tone: "idle",
        label: "Locked",
        line: "Commentator Desk requires approval.",
        meta: state?.reason || "SUPER_ADMIN_APPROVAL_REQUIRED",
      },
    ]);
    cueList.innerHTML = emptyMarkup("Approve Commentator Desk in Super Admin widget access.");
    splitList.innerHTML = emptyMarkup("Locked.");
    distanceList.innerHTML = emptyMarkup("Locked.");
    productionList.innerHTML = emptyMarkup("Locked.");
    setText(metricTeams, "0");
    setText(metricPlayers, "0");
    setText(metricKnocked, "0");
    setText(metricFiring, "0");
    setText(zoneTimer, "--:--");
    setText(zoneStatus, "Locked");
  }

  function renderState(state) {
    if (!root || !state) {
      return;
    }

    const signature = JSON.stringify(state);
    if (signature === lastStateSignature) {
      return;
    }
    lastStateSignature = signature;

    if (state.ok !== true) {
      renderLocked(state);
      return;
    }

    root.dataset.status = "live";
    ensureMapFrame(state);
    setText(statusPill, "Live");
    setText(deskTitle, state.map?.label || state.map?.key || "Live Map Desk");

    const telemetry = state.telemetry || {};
    setText(metricTeams, telemetry.activeTeams || 0);
    setText(metricPlayers, telemetry.activePlayers || 0);
    setText(metricKnocked, telemetry.knockedPlayers || 0);
    setText(metricFiring, telemetry.firingPlayers || 0);
    setText(zoneTimer, state.zone?.remainingLabel || "--:--");
    setText(
      zoneStatus,
      [state.zone?.phase ? `Phase ${state.zone.phase}` : null, state.zone?.status]
        .filter(Boolean)
        .join(" / ") || "Standby",
    );

    renderPrimaryCue(state.cues);
    renderCues(state.cues);
    renderSplits(state.splits);
    renderDistances(state.distancePairs);
    renderProduction(state);
  }

  async function pollState() {
    const params = new URLSearchParams();
    if (bootstrap.requestedMapKey) {
      params.set("map", bootstrap.requestedMapKey);
    }
    const url = `/obs/commentator-desk/state${params.toString() ? `?${params}` : ""}`;
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
      });
      const state = await response.json();
      renderState(state);
    } catch (_) {
      renderState({
        ok: false,
        status: "error",
        reason: "LOCAL_STATE_UNAVAILABLE",
        message: "Local commentator desk state is unavailable.",
      });
    }
  }

  renderState(bootstrap.state);
  pollTimer = window.setInterval(() => {
    void pollState();
  }, POLL_MS);
  window.addEventListener("beforeunload", () => {
    if (pollTimer) {
      window.clearInterval(pollTimer);
    }
  });
})();
