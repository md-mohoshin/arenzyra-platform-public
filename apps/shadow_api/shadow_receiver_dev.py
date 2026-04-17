from pathlib import Path
import os
import sys
import time

CURRENT_DIR = Path(__file__).resolve().parent
for site_packages in (
    CURRENT_DIR / "Lib" / "site-packages",
    CURRENT_DIR / "venv" / "Lib" / "site-packages",
):
    if site_packages.exists():
        sys.path.insert(0, str(site_packages))

from flask import Flask, jsonify, request
from telemetry_simulator import TelemetrySimulator

os.environ.setdefault("SHADOW_SIMULATOR", "true")

app = Flask(__name__)
SIMULATOR = TelemetrySimulator()
LATEST = {}
HISTORY = {}
MAX_HISTORY = 200

GET_ENDPOINTS = [
    "/getallinfo",
    "/getteaminfo",
    "/gettotalplayerlist",
    "/getteaminfolist",
    "/getkillinfo",
    "/getcircleinfo",
    "/getteambackpackinfo",
    "/getobservingplayer",
]


def save(path, data, ts=None):
    ts = ts or int(time.time())
    item = {"ts": ts, "data": data}
    LATEST[path] = item
    HISTORY.setdefault(path, [])
    HISTORY[path].insert(0, item)
    if len(HISTORY[path]) > MAX_HISTORY:
        HISTORY[path] = HISTORY[path][:MAX_HISTORY]


def sync_simulated_cache():
    ts, bundle = SIMULATOR.snapshot_bundle()
    for path, data in bundle.items():
        save(path, data, ts=ts)


def cached(path):
    return LATEST.get(path, {"ts": None, "data": None})


def register_get_route(path):
    def _getter():
        sync_simulated_cache()
        return jsonify(cached(path).get("data"))

    app.add_url_rule(
        path,
        endpoint=f"get_{path.strip('/').replace('/', '_')}",
        view_func=_getter,
        methods=["GET"],
    )


@app.route("/", defaults={"path": ""}, methods=["POST"])
@app.route("/<path:path>", methods=["POST"])
def catch_all(path):
    print(f"[TelemetrySimulator] ignored POST /{path}", flush=True)
    return jsonify({"ok": True, "simulated": True})


for endpoint in GET_ENDPOINTS:
    register_get_route(endpoint)


@app.route("/latest", methods=["GET"])
def latest():
    sync_simulated_cache()
    return jsonify(LATEST)


@app.route("/latest/<path:path>", methods=["GET"])
def latest_one(path):
    sync_simulated_cache()
    return jsonify(LATEST.get("/" + path, {}))


@app.route("/history/<path:path>", methods=["GET"])
def history(path):
    sync_simulated_cache()
    return jsonify(HISTORY.get("/" + path, []))


@app.route("/health", methods=["GET"])
def health():
    sync_simulated_cache()
    last_update = None
    if LATEST:
        last_update = max(item.get("ts") or 0 for item in LATEST.values())
    return jsonify(
        {
            "status": "ok",
            "simulation": True,
            "lastUpdate": last_update,
            "cachedKeys": list(LATEST.keys()),
        }
    )


if __name__ == "__main__":
    print(
        "Listening on http://127.0.0.1:5000 with SHADOW_SIMULATOR=true (dev receiver)",
        flush=True,
    )
    app.run(host="0.0.0.0", port=5000)
