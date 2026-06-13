# Match State Service

Legacy NestJS service that polls the Flask `shadow_receiver.py` for live PUBG observer data and exposes a normalized REST + WebSocket API for old snapshot-driven workflows.

This service is disabled by default in the launcher and health tooling. Enable it only for explicit legacy workflows with `ALLOW_LEGACY_SHADOW_API=1`.

## Environment

Copy `.env.example` to `.env` and adjust as needed:

```
PORT=4000                   # HTTP/WebSocket port
FLASK_BASE_URL=http://127.0.0.1:5000
POLL_INTERVAL_MS=300        # how often to poll Flask
POLL_TIMEOUT_MS=1000        # per-request timeout to Flask
```

## Install & run

```powershell
cd match-state-service
npm install
npm run build
npm start
```

## API

- `GET /api/health` – status, last update timestamp, and config.
- `GET /api/state` – latest normalized snapshot.
- `GET /api/state/history` – last 200 snapshots (newest first).

WebSocket namespace `/ws` emits `state:update` with the latest snapshot on each poll tick (or when a new snapshot arrives). Clients connecting mid-stream immediately receive the most recent snapshot if one exists.

## Notes

- The service is resilient to Flask outages; failures are logged and the last good snapshot is kept until polling succeeds again.
- Normalization is best-effort and tolerant to varying payload shapes coming from ObTools/Flask.
