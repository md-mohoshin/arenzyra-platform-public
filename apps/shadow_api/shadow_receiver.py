from pathlib import Path
import logging
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

from flask import Flask, request, jsonify
from telemetry_simulator import TelemetrySimulator
from werkzeug.serving import WSGIRequestHandler

app = Flask(__name__)

LATEST = {}  # latest payload per endpoint
HISTORY = {}  # history per endpoint (last N)
MAX_HISTORY = 200  # keep last 200 messages per endpoint
SHADOW_SIMULATOR = os.getenv("SHADOW_SIMULATOR", "").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
SIMULATOR = TelemetrySimulator() if SHADOW_SIMULATOR else None

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


class QuietPollingRequestHandler(WSGIRequestHandler):
    def log_request(self, code="-", size="-"):
        path = str(getattr(self, "path", "") or "").split("?", 1)[0]
        status_code = 0

        try:
            status_code = int(code)
        except (TypeError, ValueError):
            status_code = 0

        if self.command == "GET" and status_code < 400 and path in GET_ENDPOINTS:
            return

        super().log_request(code, size)


def save(path, data, ts=None, log_entry=True):
    ts = ts or int(time.time())
    item = {"ts": ts, "data": data}
    LATEST[path] = item
    HISTORY.setdefault(path, [])
    HISTORY[path].insert(0, item)
    if len(HISTORY[path]) > MAX_HISTORY:
        HISTORY[path] = HISTORY[path][:MAX_HISTORY]
    if log_entry:
        print(f"[{ts}] CACHED {path} -> {str(data)[:200]}")


def cached(path):
    return LATEST.get(path, {"ts": None, "data": None})


def sync_simulated_cache():
    if not SHADOW_SIMULATOR or SIMULATOR is None:
        return

    ts, bundle = SIMULATOR.snapshot_bundle()
    for path, data in bundle.items():
        save(path, data, ts=ts, log_entry=False)


def parse_payload():
    # Do not rely on content-type; try JSON first, then raw text
    data = request.get_json(force=True, silent=True)
    raw_text = request.get_data(cache=False, as_text=True, parse_form_data=False) or ""
    if data is None:
        if raw_text.strip() == "":
            return {}, raw_text
        return {"raw": raw_text}, raw_text
    return data, raw_text


def is_empty_payload(data, raw_text):
    if data in (None, {}):
        return True
    if isinstance(data, dict) and data.get("raw", "").strip() == "" and raw_text.strip() == "":
        return True
    return False


def register_get_route(path):
    def _getter():
        if SHADOW_SIMULATOR:
            sync_simulated_cache()
        data = cached(path).get("data")

        # Fallback: derive from last /totalmessage if this endpoint is empty/raw
        total = cached("/totalmessage").get("data") or {}
        is_empty = data is None or data == {} or (isinstance(data, dict) and data.get("raw", "") == "")
        if is_empty and isinstance(total, dict):
            if path == "/getteaminfolist":
                data = {"teamInfoList": total.get("TeamInfoList", [])}
            elif path == "/getteaminfo":
                data = total
            elif path == "/gettotalplayerlist":
                data = {"playerInfoList": total.get("TotalPlayerList", [])}
            elif path == "/getcircleinfo":
                data = total.get("CircleInfo", {})
            elif path == "/getkillinfo":
                data = total.get("KillInfo", {})
            elif path == "/getteambackpackinfo":
                data = total.get("TeamBackpackInfo", {})
            elif path == "/getobservingplayer":
                data = total.get("ObservingPlayer", {})
            elif path == "/getallinfo":
                data = total

        return jsonify(data)

    app.add_url_rule(
        path,
        endpoint=f"get_{path.strip('/').replace('/', '_')}",
        view_func=_getter,
        methods=["GET"],
    )


def handle_totalmessage(data, raw_text):
    if is_empty_payload(data, raw_text):
        # Ignore empty/placeholder totalmessage so we don't wipe good caches
        print("IGNORED empty /totalmessage payload; keeping previous cache")
        return

    ts = int(time.time())
    save("/totalmessage", data, ts=ts)
    save("/getallinfo", data, ts=ts)
    save("/getteaminfo", data, ts=ts)
    save("/getteaminfolist", {"teamInfoList": data.get("TeamInfoList", [])}, ts=ts)
    save("/gettotalplayerlist", {"playerInfoList": data.get("TotalPlayerList", [])}, ts=ts)
    if "CircleInfo" in data:
        save("/getcircleinfo", data.get("CircleInfo"), ts=ts)
    if "KillInfo" in data:
        save("/getkillinfo", data.get("KillInfo"), ts=ts)
    if "TeamBackpackInfo" in data:
        save("/getteambackpackinfo", data.get("TeamBackpackInfo"), ts=ts)
    if "ObservingPlayer" in data:
        save("/getobservingplayer", data.get("ObservingPlayer"), ts=ts)


# POST catcher (ingest from ob.js)
@app.route("/", defaults={"path": ""}, methods=["POST"])
@app.route("/<path:path>", methods=["POST"])
def catch_all(path):
    if SHADOW_SIMULATOR:
        print(f"[TelemetrySimulator] ignored POST /{path}", flush=True)
        return jsonify({"ok": True, "simulated": True})

    data, raw_text = parse_payload()
    normalized_path = "/" + path

    # Special handling for ObTools "totalmessage" which carries the full snapshot
    if normalized_path == "/totalmessage" and isinstance(data, dict):
        handle_totalmessage(data, raw_text)
    else:
        save(normalized_path, data)

    print("RECV", "/" + path)
    return jsonify({"ok": True})


# Specific GET endpoints for backend polling
for endpoint in GET_ENDPOINTS:
    register_get_route(endpoint)


@app.route("/latest", methods=["GET"])
def latest():
    if SHADOW_SIMULATOR:
        sync_simulated_cache()
    return jsonify(LATEST)


@app.route("/latest/<path:path>", methods=["GET"])
def latest_one(path):
    if SHADOW_SIMULATOR:
        sync_simulated_cache()
    return jsonify(LATEST.get("/" + path, {}))


@app.route("/history/<path:path>", methods=["GET"])
def history(path):
    if SHADOW_SIMULATOR:
        sync_simulated_cache()
    return jsonify(HISTORY.get("/" + path, []))


@app.route("/health", methods=["GET"])
def health():
    if SHADOW_SIMULATOR:
        sync_simulated_cache()
    last_update = None
    if LATEST:
        last_update = max(item.get("ts") or 0 for item in LATEST.values())
    return jsonify(
        {
            "status": "ok",
            "simulation": SHADOW_SIMULATOR,
            "lastUpdate": last_update,
            "cachedKeys": list(LATEST.keys()),
        }
    )


if __name__ == "__main__":
    logging.getLogger("werkzeug").setLevel(logging.INFO)

    legacy_flag = os.getenv("DEV_TELEMETRY_SIM")
    if legacy_flag and not SHADOW_SIMULATOR:
        print(
            "DEV_TELEMETRY_SIM is ignored. Use SHADOW_SIMULATOR=true to enable the simulator.",
            flush=True,
        )

    if SHADOW_SIMULATOR:
        print(
            "Listening on http://127.0.0.1:5000 with SHADOW_SIMULATOR=true",
            flush=True,
        )
    else:
        print("Listening on http://127.0.0.1:5000 with SHADOW_SIMULATOR=false")
    app.run(host="0.0.0.0", port=5000, request_handler=QuietPollingRequestHandler)
