"use strict";

const { WebSocketServer, WebSocket } = require("ws");

function createLocalWidgetBroadcast({
  path = "/ws",
  heartbeatIntervalMs = 5000,
  log = () => {},
} = {}) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set();
  let snapshotProvider = null;
  let lastBroadcastAt = null;

  function send(client, type, payload, timestamp = Date.now()) {
    if (!client || client.readyState !== WebSocket.OPEN) {
      return false;
    }

    client.send(
      JSON.stringify({
        type,
        timestamp,
        payload,
      }),
    );
    lastBroadcastAt = timestamp;
    return true;
  }

  function broadcast(type, payload, timestamp = Date.now()) {
    for (const client of clients) {
      send(client, type, payload, timestamp);
    }
  }

  function getRequestedMapKey(request) {
    try {
      const parsed = new URL(request.url || path, "ws://127.0.0.1");
      return parsed.searchParams.get("map");
    } catch {
      return null;
    }
  }

  function sendSnapshot(client, request) {
    if (typeof snapshotProvider !== "function") {
      return;
    }

    try {
      const snapshot = snapshotProvider({
        requestedMapKey: getRequestedMapKey(request),
      });

      if (snapshot?.mapContext) {
        send(
          client,
          "map_context",
          snapshot.mapContext,
          snapshot.mapContext.timestamp ?? Date.now(),
        );
      }
      if (snapshot?.zone) {
        send(client, "zone_update", snapshot.zone, snapshot.zone.timestamp ?? Date.now());
      }
      if (snapshot?.players) {
        send(
          client,
          "player_positions",
          snapshot.players,
          snapshot.players.timestamp ?? Date.now(),
        );
      }
      if (snapshot?.observerAssist) {
        send(
          client,
          "observer_assist",
          snapshot.observerAssist,
          snapshot.observerAssist.updatedAt ?? Date.now(),
        );
      }
      if (snapshot?.productionSupport) {
        send(
          client,
          "production_support",
          snapshot.productionSupport,
          snapshot.productionSupport.updatedAt ?? Date.now(),
        );
      }
      if (snapshot?.teamBranding) {
        send(
          client,
          "team_branding",
          snapshot.teamBranding,
          snapshot.teamBranding.timestamp ?? Date.now(),
        );
      }

      send(
        client,
        "heartbeat",
        {
          serverTime: Date.now(),
          connectedClients: clients.size,
        },
        Date.now(),
      );
    } catch (error) {
      log(
        "[widget-ws] failed to send initial snapshot",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  wss.on("connection", (client, request) => {
    clients.add(client);

    client.on("close", () => {
      clients.delete(client);
    });

    client.on("error", (error) => {
      log(
        "[widget-ws] client error",
        error instanceof Error ? error.message : String(error),
      );
    });

    sendSnapshot(client, request);
  });

  const heartbeatTimer = setInterval(() => {
    broadcast(
      "heartbeat",
      {
        serverTime: Date.now(),
        connectedClients: clients.size,
      },
      Date.now(),
    );
  }, heartbeatIntervalMs);

  function handleUpgrade(request, socket, head) {
    const url = request.url || "";
    if (!url.startsWith(path)) {
      return false;
    }

    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit("connection", client, request);
    });
    return true;
  }

  function close() {
    clearInterval(heartbeatTimer);
    for (const client of clients) {
      try {
        client.close();
      } catch (_) {
        // ignore close failures
      }
    }
    clients.clear();
    wss.close();
  }

  return {
    broadcast,
    close,
    getClientCount: () => clients.size,
    getPath: () => path,
    getStatus: () => ({
      clientCount: clients.size,
      lastBroadcastAt,
      path,
    }),
    handleUpgrade,
    send,
    setSnapshotProvider(provider) {
      snapshotProvider = provider;
    },
  };
}

module.exports = {
  createLocalWidgetBroadcast,
};
