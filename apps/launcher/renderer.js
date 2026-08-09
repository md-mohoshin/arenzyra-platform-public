function createServiceCard(service, busy) {
  const card = document.createElement("article");
  card.className = "service-card";

  const header = document.createElement("div");
  header.className = "service-card__header";

  const titleWrap = document.createElement("div");
  titleWrap.className = "service-card__title-wrap";

  const title = document.createElement("h2");
  title.className = "service-card__title";
  title.textContent = service.name;

  const meta = document.createElement("p");
  meta.className = "service-card__meta";
  meta.textContent = `${service.kind === "required" ? "Required" : "Optional"} | ${service.targetLabel || (service.port ? `Port ${service.port}` : "Worker")}`;

  const status = document.createElement("span");
  status.className = `status-pill is-${service.status || "unknown"}`;
  status.textContent = service.status || "unknown";

  titleWrap.append(title, meta);
  header.append(titleWrap, status);

  const detail = document.createElement("p");
  detail.className = "service-card__detail";
  detail.textContent = service.detail || "No status available.";

  const command = document.createElement("p");
  command.className = "service-card__command";
  command.textContent = service.commandPreview || "";

  const pathLine = document.createElement("p");
  pathLine.className = "service-card__path";
  pathLine.textContent = service.cwd || "";

  const actions = document.createElement("div");
  actions.className = "service-card__actions";

  const startButton = document.createElement("button");
  startButton.type = "button";
  startButton.className = "secondary-button";
  startButton.textContent = "Start";
  startButton.disabled = busy || service.status === "running" || service.status === "starting";
  startButton.addEventListener("click", () => {
    void window.launcherAPI.serviceAction(service.id, "start");
  });

  const stopButton = document.createElement("button");
  stopButton.type = "button";
  stopButton.className = "secondary-button";
  stopButton.textContent = "Stop";
  stopButton.disabled = busy || service.status === "stopped" || service.status === "stopping";
  stopButton.addEventListener("click", () => {
    void window.launcherAPI.serviceAction(service.id, "stop");
  });

  const restartButton = document.createElement("button");
  restartButton.type = "button";
  restartButton.className = "secondary-button";
  restartButton.textContent = "Restart";
  restartButton.disabled = busy;
  restartButton.addEventListener("click", () => {
    void window.launcherAPI.serviceAction(service.id, "restart");
  });

  actions.append(startButton, stopButton, restartButton);
  card.append(header, detail, command, pathLine, actions);
  return card;
}

function renderState(state) {
  const servicesRoot = document.getElementById("services");
  const logsRoot = document.getElementById("logs");
  const repoRoot = document.getElementById("repo-root");
  const healthSummary = document.getElementById("health-summary");
  const healthStamp = document.getElementById("health-stamp");
  const startAllButton = document.getElementById("start-all");
  const stopAllButton = document.getElementById("stop-all");
  const restartAllButton = document.getElementById("restart-all");
  const healthButton = document.getElementById("run-health");

  if (!servicesRoot || !logsRoot || !repoRoot || !healthSummary || !healthStamp) {
    return;
  }

  const busy = Boolean(state?.systemBusy || state?.healthRunning);

  repoRoot.textContent = state?.projectRoot || "";
  healthSummary.textContent = state?.lastHealth?.summary || "Health check has not run yet.";
  healthStamp.textContent = state?.lastHealth?.finishedAt
    ? `Last finished: ${new Date(state.lastHealth.finishedAt).toLocaleString()}`
    : state?.healthRunning
      ? "Health check is running..."
      : "No completed health check yet.";

  if (startAllButton) {
    startAllButton.disabled = busy;
  }
  if (stopAllButton) {
    stopAllButton.disabled = busy;
  }
  if (restartAllButton) {
    restartAllButton.disabled = busy;
  }
  if (healthButton) {
    healthButton.disabled = busy;
    healthButton.textContent = state?.healthRunning ? "Checking Readiness..." : "Check Readiness";
  }

  servicesRoot.replaceChildren(
    ...(state?.services || []).map((service) => createServiceCard(service, busy))
  );

  logsRoot.textContent = (state?.logs || []).join("\n");
  logsRoot.scrollTop = logsRoot.scrollHeight;
}

document.addEventListener("DOMContentLoaded", async () => {
  const startAllButton = document.getElementById("start-all");
  const stopAllButton = document.getElementById("stop-all");
  const restartAllButton = document.getElementById("restart-all");
  const healthButton = document.getElementById("run-health");

  if (!window.launcherAPI) {
    return;
  }

  const unsubscribe = window.launcherAPI.onState((state) => {
    renderState(state);
  });

  window.addEventListener("beforeunload", () => {
    unsubscribe();
  });

  if (startAllButton) {
    startAllButton.addEventListener("click", () => {
      void window.launcherAPI.startAll();
    });
  }

  if (stopAllButton) {
    stopAllButton.addEventListener("click", () => {
      void window.launcherAPI.stopAll();
    });
  }

  if (restartAllButton) {
    restartAllButton.addEventListener("click", () => {
      void window.launcherAPI.restartAll();
    });
  }

  if (healthButton) {
    healthButton.addEventListener("click", () => {
      void window.launcherAPI.runHealthCheck();
    });
  }

  const initialState = await window.launcherAPI.getState();
  renderState(initialState);
});
