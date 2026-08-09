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
  const isPinnedLayout =
    root?.dataset?.layout === "pinned" || bootstrap.layout === "pinned";
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

  function toNumber(value, fallback = 0) {
    const numeric =
      typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function inferDistanceEngagement(row) {
    const distance = Math.max(0, Math.round(toNumber(row?.distanceMeters, 0)));
    const firing = Math.max(0, Math.round(toNumber(row?.firingCount, 0)));
    const knocked = Math.max(0, Math.round(toNumber(row?.knockedCount, 0)));

    if (row?.engagementState) {
      return {
        distance,
        state: row.engagementState,
        label: row.engagementLabel || null,
        priority: toNumber(row.engagementPriority, 0),
        summary: row.engagementSummary || null,
      };
    }

    if (knocked > 0 && firing > 0) {
      return {
        distance,
        state: "trade",
        label: "Trade",
        priority: 5,
        summary: `${knocked} knocked / ${firing} firing`,
      };
    }
    if (knocked > 0) {
      return {
        distance,
        state: "knock",
        label: "Knock",
        priority: 4,
        summary: `${knocked} knocked`,
      };
    }
    if ((firing >= 2 && distance <= 280) || (firing > 0 && distance <= 160)) {
      return {
        distance,
        state: "fight",
        label: "Fight",
        priority: 3,
        summary: `${firing} firing`,
      };
    }
    if (firing > 0 && distance <= 450) {
      return {
        distance,
        state: "shots",
        label: "Shots",
        priority: 2,
        summary: `${firing} firing`,
      };
    }
    if (distance <= 80) {
      return {
        distance,
        state: "contact",
        label: "Close",
        priority: 1,
        summary: "Contact range",
      };
    }
    return {
      distance,
      state: "none",
      label: null,
      priority: 0,
      summary: null,
    };
  }

  function compareDistanceEntries(left, right) {
    if (right.engagement.priority !== left.engagement.priority) {
      return right.engagement.priority - left.engagement.priority;
    }
    return left.engagement.distance - right.engagement.distance;
  }

  function buildDistanceStatus(row, engagement, players) {
    if (engagement.summary) {
      return `${engagement.summary} - ${players}`;
    }
    if (row.knockedCount > 0) {
      return `${row.knockedCount} knocked`;
    }
    if (row.firingCount > 0) {
      return `${row.firingCount} firing`;
    }
    return players;
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

  function isPinnedCue(cue) {
    const tone = String(cue?.tone || "").toLowerCase();
    return tone === "fight" || tone === "distance" || tone === "alert" || tone === "focus";
  }

  function getPinnedCueRows(cues) {
    return Array.isArray(cues) ? cues.filter(isPinnedCue) : [];
  }

  function getPrimaryCues(state) {
    if (!isPinnedLayout) {
      return state?.cues;
    }

    const rows = getPinnedCueRows(state?.cues);
    if (rows.length > 0) {
      return rows;
    }

    return [
      {
        tone: "idle",
        label: "Scanning",
        line: "No active fights",
        meta: "Closest teams update live below.",
      },
    ];
  }

  function renderPrimaryCue(cues) {
    if (!primaryCue) {
      return;
    }
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
    if (!cueList) {
      return;
    }
    const rows = Array.isArray(cues)
      ? isPinnedLayout
        ? getPinnedCueRows(cues).slice(1, 5)
        : cues.slice(1, 7)
      : [];
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
      : emptyMarkup(isPinnedLayout ? "No active fight cues yet." : "No secondary cues yet.");
  }

  function renderSplits(splits) {
    if (!splitList) {
      return;
    }
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
    if (!distanceList) {
      return;
    }
    const rows = Array.isArray(distancePairs) ? distancePairs : [];
    distanceList.innerHTML = rows.length
      ? rows
          .map((row) => ({
            row,
            engagement: inferDistanceEngagement(row),
          }))
          .sort(compareDistanceEntries)
          .slice(0, isPinnedLayout ? 6 : 8)
          .map(({ row, engagement }) => {
            const players =
              row.leftPlayerName && row.rightPlayerName
                ? `${row.leftPlayerName} / ${row.rightPlayerName}`
                : `${row.leftActive || 0} alive / ${row.rightActive || 0} alive`;
            const status = buildDistanceStatus(row, engagement, players);
            return `
              <div class="distance-row" data-tone="${attr(
                row.tone || "wide",
              )}" data-alert="${attr(engagement.state)}">
                <div class="distance-copy">
                  <div class="distance-main">${escapeHtml(row.slotMatchup || "Slot ? vs Slot ?")}</div>
                  <div class="distance-sub">${escapeHtml(status)}</div>
                </div>
                ${
                  engagement.label
                    ? `<div class="distance-alert">${escapeHtml(engagement.label)}</div>`
                    : ""
                }
                <div class="distance-value">${escapeHtml(row.distanceMeters || 0)}m</div>
              </div>
            `;
          })
          .join("")
      : emptyMarkup(isPinnedLayout ? "Waiting for close team data." : "Waiting for team distance data.");
  }

  function renderProduction(state) {
    if (!productionList) {
      return;
    }
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
    if (cueList) {
      cueList.innerHTML = emptyMarkup("Approve Commentator Desk in Super Admin widget access.");
    }
    if (splitList) {
      splitList.innerHTML = emptyMarkup("Locked.");
    }
    if (distanceList) {
      distanceList.innerHTML = emptyMarkup("Locked.");
    }
    if (productionList) {
      productionList.innerHTML = emptyMarkup("Locked.");
    }
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
    if (!isPinnedLayout) {
      ensureMapFrame(state);
    }
    setText(statusPill, "Live");
    setText(
      deskTitle,
      isPinnedLayout ? "Close Teams" : state.map?.label || state.map?.key || "Live Map Desk",
    );

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

    renderPrimaryCue(getPrimaryCues(state));
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
