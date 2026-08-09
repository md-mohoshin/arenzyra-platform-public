(function () {
  const bootstrap = window.__ARENZYRA_LOCAL_WIDGET_BOOTSTRAP__ || {};
  const root = document.getElementById("team-eliminated-root");
  const banner = root?.querySelector(".team-eliminated-banner");
  const logo = document.getElementById("team-eliminated-logo");
  const eyebrow = document.getElementById("team-eliminated-eyebrow");
  const name = document.getElementById("team-eliminated-name");
  const placement = document.getElementById("team-eliminated-placement");

  if (!root || !banner || !logo || !eyebrow || !name || !placement) {
    return;
  }

  function asString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function toFiniteNumber(value, fallback = null) {
    const numeric =
      typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function normalizeBaseUrl(value) {
    const raw = asString(value);
    if (!raw) {
      return window.location.origin;
    }

    try {
      const parsed = new URL(raw.includes("://") ? raw : `http://${raw}`);
      return parsed.toString().replace(/\/$/, "");
    } catch (_) {
      return window.location.origin;
    }
  }

  function ordinal(value) {
    const numeric = toFiniteNumber(value, null);
    if (numeric === null) {
      return null;
    }

    const rounded = Math.max(0, Math.round(numeric));
    const mod100 = rounded % 100;
    if (mod100 >= 11 && mod100 <= 13) {
      return `${rounded}th`;
    }

    switch (rounded % 10) {
      case 1:
        return `${rounded}st`;
      case 2:
        return `${rounded}nd`;
      case 3:
        return `${rounded}rd`;
      default:
        return `${rounded}th`;
    }
  }

  function toTimestampMs(value) {
    const raw = asString(value);
    if (!raw) {
      return null;
    }

    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizeEvent(event) {
    if (!event || typeof event !== "object") {
      return null;
    }

    const matchId = asString(event.matchId);
    const eventId = asString(event.eventId);
    const teamId = asString(event.teamId);
    const teamName = asString(event.teamName);
    const eliminatedAt = asString(event.eliminatedAt);
    if (!matchId || !eventId || !teamId || !teamName || !eliminatedAt) {
      return null;
    }

    return {
      matchId,
      eventId,
      teamId,
      teamName,
      placement: toFiniteNumber(event.placement, null),
      kills: Math.max(0, toFiniteNumber(event.kills, 0) || 0),
      eliminatedAt,
    };
  }

  const apiBase = normalizeBaseUrl(bootstrap.apiBase);
  const matchId = asString(bootstrap.matchId);
  const fadeInMs = Math.max(150, toFiniteNumber(bootstrap.fadeInMs, 420));
  const holdMs = Math.max(1200, toFiniteNumber(bootstrap.holdMs, 4600));
  const fadeOutMs = Math.max(250, toFiniteNumber(bootstrap.fadeOutMs, 640));
  const simultaneousWindowMs = Math.min(
    1000,
    Math.max(100, toFiniteNumber(bootstrap.simultaneousWindowMs, 300)),
  );
  const teamLogoBasePath = asString(bootstrap.teamLogoBasePath) || "/assets/teams";
  const defaultLogoPath = asString(bootstrap.defaultLogoPath) || "/assets/default-team.png";

  root.style.setProperty("--fade-in-ms", `${fadeInMs}ms`);
  root.style.setProperty("--fade-out-ms", `${fadeOutMs}ms`);

  if (!matchId) {
    return;
  }

  let activeBanner = null;
  const queuedBanners = [];
  const pendingSimultaneousEvents = [];
  let simultaneousTimer = null;
  let hideStartTimer = null;
  let completeTimer = null;
  let socket = null;
  const processedEventIds = new Set();
  let hadSocketConnection = false;
  let needsReplay = false;
  let replayLoaded = false;
  let replayInFlight = false;

  function buildTeamLogoUrl(teamId) {
    const normalizedTeamId = asString(teamId);
    if (!normalizedTeamId) {
      return defaultLogoPath;
    }
    return `${teamLogoBasePath}/${encodeURIComponent(normalizedTeamId)}.png`;
  }

  function applyLogo(teamId, teamName) {
    logo.dataset.fallbackApplied = "";
    logo.alt = teamName ? `${teamName} logo` : "";
    logo.src = buildTeamLogoUrl(teamId);
  }

  function resetBannerClasses() {
    root.classList.remove("is-visible");
    root.classList.remove("is-hiding");
  }

  function clearBannerTimers() {
    if (hideStartTimer) {
      window.clearTimeout(hideStartTimer);
      hideStartTimer = null;
    }
    if (completeTimer) {
      window.clearTimeout(completeTimer);
      completeTimer = null;
    }
  }

  function renderBanner(items) {
    const events = Array.isArray(items) ? items : [];
    const firstEvent = events[0] || null;
    if (!firstEvent) {
      return;
    }

    const isGroup = events.length > 1;
    banner.classList.toggle("is-grouped", isGroup);
    if (!isGroup) {
      eyebrow.textContent = "TEAM ELIMINATED";
      name.textContent = firstEvent.teamName;
      placement.textContent =
        firstEvent.placement !== null
          ? `${ordinal(firstEvent.placement).toUpperCase()} PLACE`
          : "PLACE PENDING";
      applyLogo(firstEvent.teamId, firstEvent.teamName);
      return;
    }

    const visibleNames = events.slice(0, 3).map((event) => event.teamName);
    const remainingCount = events.length - visibleNames.length;
    eyebrow.textContent = `${events.length} TEAMS ELIMINATED`;
    name.textContent = [
      visibleNames.join(" • "),
      remainingCount > 0 ? `+${remainingCount} MORE` : "",
    ]
      .filter(Boolean)
      .join(" • ");
    placement.textContent = "SIMULTANEOUS ELIMINATION";
    applyLogo(firstEvent.teamId, firstEvent.teamName);
  }

  function showNextBanner() {
    clearBannerTimers();

    if (queuedBanners.length === 0) {
      activeBanner = null;
      resetBannerClasses();
      return;
    }

    activeBanner = queuedBanners.shift() || null;
    if (!activeBanner) {
      resetBannerClasses();
      return;
    }

    renderBanner(activeBanner.events);
    resetBannerClasses();
    void root.offsetWidth;
    root.classList.add("is-visible");

    hideStartTimer = window.setTimeout(() => {
      root.classList.remove("is-visible");
      root.classList.add("is-hiding");
    }, fadeInMs + holdMs);

    completeTimer = window.setTimeout(() => {
      root.classList.remove("is-hiding");
      activeBanner = null;
      showNextBanner();
    }, fadeInMs + holdMs + fadeOutMs);
  }

  function queueBanner(events) {
    const normalizedEvents = (Array.isArray(events) ? events : []).filter(Boolean);
    if (normalizedEvents.length === 0) {
      return;
    }

    queuedBanners.push({
      events: normalizedEvents,
      eliminatedAt: normalizedEvents[0].eliminatedAt,
      eventId: normalizedEvents[0].eventId,
    });

    queuedBanners.sort((left, right) => {
      const leftTimestamp = toTimestampMs(left.eliminatedAt) || 0;
      const rightTimestamp = toTimestampMs(right.eliminatedAt) || 0;
      if (leftTimestamp !== rightTimestamp) {
        return leftTimestamp - rightTimestamp;
      }
      return left.eventId.localeCompare(right.eventId);
    });

    if (!activeBanner) {
      showNextBanner();
    }
  }

  function flushSimultaneousEvents() {
    simultaneousTimer = null;
    if (pendingSimultaneousEvents.length === 0) {
      return;
    }

    const events = pendingSimultaneousEvents.splice(0, pendingSimultaneousEvents.length);
    queueBanner(events);
  }

  function enqueueSimultaneousEvent(event) {
    pendingSimultaneousEvents.push(event);
    if (simultaneousTimer) {
      return;
    }
    simultaneousTimer = window.setTimeout(
      flushSimultaneousEvents,
      simultaneousWindowMs,
    );
  }

  function mergeEvents(events) {
    const sortedEvents = (Array.isArray(events) ? events : [])
      .map(normalizeEvent)
      .filter(Boolean)
      .sort((left, right) => {
        const leftTimestamp = toTimestampMs(left.eliminatedAt) || 0;
        const rightTimestamp = toTimestampMs(right.eliminatedAt) || 0;
        if (leftTimestamp !== rightTimestamp) {
          return leftTimestamp - rightTimestamp;
        }
        return left.eventId.localeCompare(right.eventId);
      });

    sortedEvents.forEach((event) => {
      if (processedEventIds.has(event.eventId)) {
        console.info("[Widget] Team eliminated duplicate ignored");
        return;
      }

      processedEventIds.add(event.eventId);
      enqueueSimultaneousEvent(event);
    });
  }

  async function loadReplay() {
    if (replayInFlight) {
      return;
    }

    replayInFlight = true;
    try {
      const response = await fetch(
        `${apiBase}/api/observer/match/${encodeURIComponent(matchId)}/team-eliminations`,
        {
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
        },
      );
      if (!response.ok) {
        return;
      }

      const replayEvents = await response.json();
      mergeEvents(Array.isArray(replayEvents) ? replayEvents : []);
      needsReplay = false;
      replayLoaded = true;
      console.info("[Widget] Team eliminated replay loaded");
    } catch (_) {
      // Ignore transient replay failures; reconnect will try again.
    } finally {
      replayInFlight = false;
    }
  }

  function connectRealtime() {
    if (typeof window.io !== "function") {
      return;
    }

    socket = window.io(`${apiBase}/realtime`, {
      transports: ["websocket"],
      query: {
        matchId,
      },
      forceNew: true,
    });

    socket.on("connect", () => {
      const shouldReplay = !replayLoaded || hadSocketConnection || needsReplay;
      hadSocketConnection = true;
      if (shouldReplay) {
        void loadReplay();
      }
    });

    socket.on("match:team-eliminated", (payload) => {
      const event = normalizeEvent(payload);
      if (!event || event.matchId !== matchId) {
        return;
      }

      console.info("[Widget] Authoritative team eliminated event received");
      mergeEvents([event]);
    });

    socket.on("disconnect", () => {
      if (hadSocketConnection) {
        needsReplay = true;
      }
    });

    socket.on("connect_error", () => {
      needsReplay = true;
    });
  }

  logo.addEventListener("error", () => {
    if (logo.dataset.fallbackApplied === "1") {
      return;
    }
    logo.dataset.fallbackApplied = "1";
    logo.src = defaultLogoPath;
  });

  void loadReplay();
  connectRealtime();

  window.addEventListener("beforeunload", () => {
    clearBannerTimers();
    if (simultaneousTimer) {
      window.clearTimeout(simultaneousTimer);
    }
    if (socket && typeof socket.disconnect === "function") {
      socket.disconnect();
    }
  });
})();
