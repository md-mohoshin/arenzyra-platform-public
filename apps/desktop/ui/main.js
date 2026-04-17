const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
require("ts-node/register");

const { fetchPcobEvents } = require("../sources/pcobSource");
const { runOnce } = require("../core/runtime");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry(fn, label, max = 3) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt >= max) {
        throw err;
      }
      const delay = Math.min(30000, 1000 * 2 ** (attempt - 1));
      console.warn(`${label} failed (attempt ${attempt}/${max}), retrying in ${delay}ms`, err);
      await sleep(delay);
    }
  }
}

let poller = null;

function startPoller(params, sendStatus) {
  let stopped = false;

  const loop = async () => {
    sendStatus(`Running (every ${params.pollMs}ms)`);
    while (!stopped) {
      try {
        const events = await withRetry(
          () => fetchPcobEvents(params.pcobBaseUrl, params.pcobToken, params.matchId),
          "pcob-fetch"
        );

        if (events.length) {
          await withRetry(
            () => runOnce({ apiBaseUrl: params.apiBaseUrl, token: params.apiToken, events }),
            "ingest-send"
          );
          sendStatus(`Sent ${events.length} events at ${new Date().toISOString()}`);
        } else {
          sendStatus(`No events to send at ${new Date().toISOString()}`);
        }
      } catch (err) {
        sendStatus(`Error: ${err?.message || err}`);
      }

      await sleep(params.pollMs);
    }
    sendStatus("Stopped");
  };

  loop();

  return {
    stop() {
      stopped = true;
    },
  };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 520,
    height: 520,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("start-poller", (event, params) => {
  poller?.stop?.();
  poller = startPoller(params, (msg) => event.sender.send("status", msg));
});

ipcMain.handle("stop-poller", () => {
  poller?.stop?.();
  poller = null;
});