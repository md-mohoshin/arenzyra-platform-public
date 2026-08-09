const { ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");

const bindBtn = document.getElementById("bindBtn");
const unbindBtn = document.getElementById("unbindBtn");
const sendBtn = document.getElementById("sendBtn");
const statusLine = document.getElementById("statusLine");
const connStatus = document.getElementById("connStatus");
const matchBadge = document.getElementById("matchBadge");
const logoutBtn = document.getElementById("logoutBtn");

let running = false;

const configPath = path.join(os.homedir(), ".arenzyra-desktop.json");

function setStatus(text, connected = false) {
  statusLine.textContent = `Status: ${text}`;
  connStatus.textContent = connected ? "Connected" : "Disconnected";
  connStatus.classList.remove("green", "red");
  connStatus.classList.add(connected ? "green" : "red");
}

function updateButtons() {
  bindBtn.disabled = running;
  unbindBtn.disabled = !running;
  sendBtn.disabled = !running;
}

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf8");
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error("Failed to load config", err);
  }
  return {};
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to save config", err);
  }
}

function applyConfig(cfg) {
  if (cfg.apiBaseUrl) document.getElementById("apiBaseUrl").value = cfg.apiBaseUrl;
  if (cfg.apiToken) document.getElementById("apiToken").value = cfg.apiToken;
  if (cfg.matchId) document.getElementById("matchId").value = cfg.matchId;
}

function getPayloadFromInputs() {
  return {
    apiBaseUrl: document.getElementById("apiBaseUrl").value || "http://localhost:3000",
    apiToken: document.getElementById("apiToken").value || "",
    matchId: document.getElementById("matchId").value,
  };
}

function isComplete(payload) {
  return !!payload.apiBaseUrl && !!payload.apiToken && !!payload.matchId;
}

function shortId(id) {
  if (!id) return "—";
  return id.length > 8 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}

function connectMatch() {
  const payload = getPayloadFromInputs();
  if (!payload.matchId) {
    setStatus("Match ID required", false);
    return;
  }
  ipcRenderer.invoke("start-poller", payload);
  saveConfig(payload);
  running = true;
  matchBadge.textContent = `Match: ${shortId(payload.matchId)}`;
  setStatus(`Bound to match ${shortId(payload.matchId)}`, true);
  updateButtons();
}

function disconnectMatch() {
  ipcRenderer.invoke("stop-poller");
  running = false;
  setStatus("Not Bound", false);
  updateButtons();
}

function sendLiveData() {
  if (!running) return;
  try {
    ipcRenderer.invoke("send-telemetry");
    setStatus("Sending telemetry", true);
  } catch {
    setStatus("Error sending telemetry", false);
  }
}

bindBtn.addEventListener("click", connectMatch);
unbindBtn.addEventListener("click", disconnectMatch);
sendBtn.addEventListener("click", sendLiveData);
logoutBtn.addEventListener("click", () => window.close());

ipcRenderer.on("status", (_evt, msg) => {
  if (typeof msg === "string" && msg.toLowerCase().includes("stopped")) {
    running = false;
    setStatus("Not Bound", false);
    updateButtons();
    return;
  }
  if (typeof msg === "string" && msg.toLowerCase().includes("started")) {
    running = true;
    setStatus("Sending telemetry", true);
    updateButtons();
  }
});

const cfg = loadConfig();
if (cfg && Object.keys(cfg).length) {
  applyConfig(cfg);
  matchBadge.textContent = `Match: ${shortId(cfg.matchId)}`;
}
updateButtons();
setStatus("Not Bound", false);

const initial = getPayloadFromInputs();
if (isComplete(initial)) {
  connectMatch();
}
