import express from "express";
import cors from "cors";

let serverStarted = false;

export function startWidgetsServer(port = 3456) {
  if (serverStarted) return;
  const app = express();
  app.use(cors());

  // Placeholder widget endpoints
  app.get("/widgets/player", (_req, res) => {
    res.json({ ign: "N/A", team: "N/A", kills: 0 });
  });

  app.get("/widgets/circle", (_req, res) => {
    res.json({ phase: 0, timeRemaining: 0, center: { x: 0, y: 0 }, radius: 0 });
  });

  app.get("/widgets/map", (_req, res) => {
    res.json({ map: "Unknown", safeZone: null });
  });

  app.listen(port, () => {
    serverStarted = true;
    console.log(`Widgets server running on http://localhost:${port}`);
  });
}
