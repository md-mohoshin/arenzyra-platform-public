# Arenzyra CS2 GSI proof

This isolated proof receives Counter-Strike 2 Game State Integration snapshots
without a Steam Web API key. It intentionally does not connect to Arenzyra's
existing battle-royale telemetry engine.

Safety properties:

- listens only on `127.0.0.1`;
- authenticates every GSI POST with a random token generated on first install
  and reused locally by later proof runs;
- accepts only JSON payloads with `provider.appid = 730`;
- limits request bodies to 1 MiB;
- validates the loopback peer and Host header, rejects encoded bodies, and
  rate-limits requests;
- subscribes only to map/round state by default; detailed player and bomb data
  requires the explicit `--observer-roster` option;
- does not expose or log the token or raw payload;
- refuses to overwrite an existing GSI configuration;
- keeps administrator confirmation as the future authoritative result path.

Run the mock proof:

```powershell
node apps/desktop/electron/cs2-gsi/run-proof.cjs
```

After CS2 is installed and Windows has been restarted, run a live proof:

```powershell
node apps/desktop/electron/cs2-gsi/run-proof.cjs --live --cs2-install "C:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Global Offensive"
```

To explicitly validate observer roster, player-stat, weapon, and bomb data,
add `--observer-roster` on the first live run. This does not subscribe to
positions or grenade trajectories. The proof passes this mode only after it
receives at least one `allplayers` roster snapshot.

The live command creates
`game\csgo\cfg\gamestate_integration_arenzyra.cfg` only when `game\csgo`
exists. If that file already exists with different content, the command stops
instead of overwriting it. Later proof runs safely reuse the token, port, and
privacy scope from a valid Arenzyra-managed file without printing the token.
Restart CS2 after the file is created.

The proof will not silently expand an existing minimal configuration to
player-level data. To change that scope intentionally, close CS2 and the proof,
rename `gamestate_integration_arenzyra.cfg` to
`gamestate_integration_arenzyra.cfg.disabled` so it remains recoverable, and
then rerun the live command with `--observer-roster`.

The included observer fixture is synthetic test data, not evidence from a live
CS2 client.

GSI is suitable for live display state, not authoritative event history.
Server logs or demos plus an administrator confirmation should verify final
results. Full `allplayers` data must be validated from an observer/spectator
client before any production integration.
