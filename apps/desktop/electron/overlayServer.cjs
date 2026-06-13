const express = require("express");
const axios = require("axios");

function renderTemplate(template) {
  const safe = ["scoreboard", "killfeed", "roster"].includes(template) ? template : "scoreboard";
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Arenzyra Overlay - ${safe}</title>
    <style>
      body { margin:0; font-family: Arial, sans-serif; color:#fff; background: transparent; }
      .bar { display:flex; gap:8px; padding:8px 12px; background: rgba(0,0,0,0.55); }
      .team { display:flex; align-items:center; gap:6px; padding:4px 8px; border-radius:6px; background: rgba(255,255,255,0.08); }
      .killfeed { position:fixed; right:12px; top:12px; width:320px; }
      .kill { margin-bottom:6px; padding:8px; border-radius:6px; background: rgba(0,0,0,0.6); }
      .roster { position:fixed; bottom:12px; left:12px; padding:12px; border-radius:8px; background: rgba(0,0,0,0.6); width:360px; }
      .player { display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.08); }
      .player:last-child { border-bottom:none; }
      .hp { height:6px; background: #16a34a; border-radius:3px; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>
      const template = "${safe}";
      async function fetchState() {
        try {
          const res = await fetch("/state");
          return await res.json();
        } catch (err) { return { teams: [], players: [], killfeed: [], ts: Date.now() }; }
      }
      function render(state) {
        const root = document.getElementById("root");
        if (!root) return;
        if (template === "scoreboard") {
          root.innerHTML = '<div class="bar">' + state.teams.slice(0,10).map(t => '<div class="team"><span>' + (t.tag || t.name || 'Team') + '</span><strong>' + (t.kills || 0) + '</strong></div>').join('') + '</div>';
        } else if (template === "killfeed") {
          root.innerHTML = '<div class="killfeed">' + (state.killfeed || []).slice(-5).reverse().map(k => '<div class="kill">' + (k.killerName || 'Unknown') + ' â†’ ' + (k.victimName || 'Unknown') + '</div>').join('') + '</div>';
        } else {
          const team = state.teams[0];
          const players = state.players.filter(p => p.teamId === (team?.teamId || team?.id || null));
          root.innerHTML = '<div class="roster"><div style="font-weight:bold;margin-bottom:8px;">' + (team?.tag || team?.name || 'Team') + '</div>' + players.map(p => '<div class="player"><span>' + (p.name || p.ign || 'Player') + '</span><span style="flex:1;margin:0 8px;"><div class="hp" style="width:' + (p.hp || 0) + '%"></div></span><span>' + (p.aliveState || '') + '</span></div>').join('') + '</div>';
        }
      }
      async function loop() { const state = await fetchState(); render(state); requestAnimationFrame(loop); }
      loop();
    </script>
  </body>
</html>`;
}

function normalize(raw) {
  const teams = (raw?.teams ?? raw?.state?.teams ?? []).map((t) => ({
    teamId: t.teamId ?? t.liveId ?? t.id ?? "",
    id: t.teamId ?? t.liveId ?? t.id ?? "",
    name: t.name ?? t.tag ?? null,
    tag: t.tag ?? null,
    slot: t.slot ?? null,
    kills: t.kills ?? 0,
  }));
  const players = (raw?.players ?? raw?.state?.players ?? []).map((p) => ({
    playerId: p.playerKey ?? p.playerId ?? p.liveId ?? p.id ?? "",
    teamId: p.teamId ?? p.teamLiveId ?? null,
    name: p.name ?? p.ign ?? null,
    ign: p.ign ?? p.name ?? null,
    hp: p.hp ?? null,
    aliveState: p.aliveState ?? null,
  }));
  const killfeed = (raw?.killfeed ?? raw?.kills ?? raw?.state?.killfeed ?? []).map((k) => ({
    ts: k.ts ?? Date.now(),
    killerName: k.killerName ?? k.killer ?? null,
    victimName: k.victimName ?? k.victim ?? null,
    weapon: k.weapon ?? null,
  }));
  return {
    ts: raw?.ts ?? Date.now(),
    matchId: raw?.matchId ?? raw?.state?.matchId ?? null,
    teams,
    players,
    killfeed,
    circle: raw?.circle ?? raw?.state?.circle ?? null,
    observingPlayer: raw?.observingPlayer ?? null,
    raw,
  };
}

function startOverlayServer(options) {
  const port = options.port || 7000;
  let baseUrl = options.baseUrl || "http://127.0.0.1:4000";
  let matchId = options.matchId || null;
  let timer = null;
  let state = { ts: Date.now(), teams: [], players: [], killfeed: [] };

  const app = express();

  app.get("/health", (_req, res) => res.json({ status: "ok", matchId, baseUrl }));
  app.get("/state", (_req, res) => res.json(state));
  app.get("/state/stream", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "Cache-Control": "no-cache",
    });
    const iv = setInterval(() => res.write(`data: ${JSON.stringify(state)}\n\n`), 500);
    req.on("close", () => clearInterval(iv));
  });
  app.get("/overlay/:template", (req, res) => {
    res.type("html").send(renderTemplate(req.params.template));
  });

  const server = app.listen(port, "127.0.0.1", () => {
    console.log(`Overlay server listening on http://127.0.0.1:${port}`);
  });

  const poll = async () => {
    try {
      const url = matchId ? `/api/matches/${matchId}/overlay/state` : "/api/state";
      const res = await axios.get(`${baseUrl.replace(/\/$/, "")}${url}`, {
        timeout: 1500,
      });
      const data = res.data?.state ?? res.data ?? {};
      state = normalize(data);
    } catch (_err) {
      // keep last state
    }
  };

  timer = setInterval(poll, 800);
  poll();

  return {
    update(config) {
      baseUrl = config.baseUrl || baseUrl;
      matchId = config.matchId || matchId;
    },
    stop() {
      if (timer) clearInterval(timer);
      server.close();
    },
  };
}

module.exports = { startOverlayServer };
