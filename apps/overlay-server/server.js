/* eslint-disable no-console */
if (
  process.env.NODE_ENV === "production" ||
  process.env.ARENZYRA_ENABLE_LEGACY_OVERLAY_SERVER !==
    "I_UNDERSTAND_DEV_ONLY"
) {
  throw new Error(
    "Legacy overlay server is quarantined; use the authenticated widget runtime.",
  );
}

const express = require("express");
const http = require("http");
const path = require("path");
const cors = require("cors");
const { Server } = require("socket.io");

// Use PORT env; default to 3100 to avoid clashing with backend (3000)
const PORT = process.env.PORT ? Number(process.env.PORT) : 3100;
const HOST = "127.0.0.1";
const allowedOrigins = [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`];
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ["GET", "POST"] },
  path: "/ws/overlay",
});

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const overlayState = new Map();

function broadcast(type, overlay, data) {
  const payload = { type, overlay, data };
  io.of("/").emit("overlay", payload);
  io.of("/").emit(type, payload);
}

io.of("/").on("connection", (socket) => {
  console.log(`[overlay] client connected id=${socket.id}`);
  // push latest state
  overlayState.forEach((value, key) => {
    socket.emit("overlay", value);
  });
  socket.on("disconnect", () => {
    console.log(`[overlay] client disconnected id=${socket.id}`);
  });
});

app.post("/overlay/show", (req, res) => {
  const overlay = req.body?.overlay;
  const data = req.body?.data ?? {};
  if (!overlay) return res.status(400).json({ ok: false, error: "overlay is required" });
  const payload = { type: "overlay:show", overlay, data };
  overlayState.set(overlay, payload);
  broadcast("overlay:show", overlay, data);
  res.json({ ok: true });
});

app.post("/overlay/hide", (req, res) => {
  const overlay = req.body?.overlay;
  if (!overlay) return res.status(400).json({ ok: false, error: "overlay is required" });
  overlayState.delete(overlay);
  broadcast("overlay:hide", overlay, null);
  res.json({ ok: true });
});

app.post("/overlay/update", (req, res) => {
  const overlay = req.body?.overlay;
  const data = req.body?.data ?? {};
  if (!overlay) return res.status(400).json({ ok: false, error: "overlay is required" });
  const payload = { type: "overlay:update", overlay, data };
  overlayState.set(overlay, payload);
  broadcast("overlay:update", overlay, data);
  res.json({ ok: true });
});

server.listen(PORT, HOST, () => {
  console.log(`Legacy development overlay server running on http://${HOST}:${PORT}`);
  console.log(`WebSocket namespace: ws://${HOST}:${PORT}/ws/overlay`);
});
