from __future__ import annotations

import argparse
import hashlib
import json
import os
import socket
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

CURRENT_DIR = Path(__file__).resolve().parent
for site_packages in (
    CURRENT_DIR / "Lib" / "site-packages",
    CURRENT_DIR / "venv" / "Lib" / "site-packages",
):
    if site_packages.exists():
        sys.path.insert(0, str(site_packages))

import requests
import socketio

PCOB_NAMESPACE = "/pcob"


@dataclass(frozen=True)
class TelemetryEndpoint:
    logical_name: str
    path: str
    event_type: str
    cycle: str
    fallback_paths: tuple[str, ...] = ()


@dataclass(frozen=True)
class CollectorConfig:
    match_id: str
    jwt_token: str
    shadow_base_url: str
    backend_url: str
    socketio_path: str
    node_id: str
    priority: int
    fast_interval_sec: float
    heartbeat_interval_sec: float
    request_timeout_sec: float
    capabilities: tuple[str, ...]


FAST_ENDPOINTS = (
    TelemetryEndpoint(
        logical_name="killinfo",
        path="/getkillinfo",
        event_type="KILL_INFO_SNAPSHOT",
        cycle="FAST",
    ),
    TelemetryEndpoint(
        logical_name="teaminfo",
        path="/getteaminfo",
        event_type="TEAM_INFO_SNAPSHOT",
        cycle="FAST",
        fallback_paths=("/getallinfo",),
    ),
    TelemetryEndpoint(
        logical_name="observingplayer",
        path="/getobservingplayer",
        event_type="OBSERVING_PLAYER_SNAPSHOT",
        cycle="FAST",
    ),
)

SLOW_ENDPOINTS = (
    TelemetryEndpoint(
        logical_name="circleinfo",
        path="/getcircleinfo",
        event_type="CIRCLE_INFO_SNAPSHOT",
        cycle="SLOW",
    ),
    TelemetryEndpoint(
        logical_name="totalplayerlist",
        path="/gettotalplayerlist",
        event_type="TOTAL_PLAYER_LIST_SNAPSHOT",
        cycle="SLOW",
    ),
    TelemetryEndpoint(
        logical_name="teaminfolist",
        path="/getteaminfolist",
        event_type="TEAM_INFO_LIST_SNAPSHOT",
        cycle="SLOW",
    ),
    TelemetryEndpoint(
        logical_name="teambackpackinfo",
        path="/getteambackpackinfo",
        event_type="TEAM_BACKPACK_INFO_SNAPSHOT",
        cycle="SLOW",
    ),
)


def _trim_url(value: str) -> str:
    return (value or "").rstrip("/")


def _now_ms() -> int:
    return int(time.time() * 1000)


def _is_empty_payload(payload: Any) -> bool:
    if payload is None:
        return True
    if payload in ({}, [], ""):
        return True
    if isinstance(payload, dict):
        raw = payload.get("raw")
        if len(payload) == 1 and isinstance(raw, str) and raw.strip() == "":
            return True
    return False


def _canonical_json(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


class TelemetryCollector:
    def __init__(self, config: CollectorConfig):
        self.config = config
        self.session = requests.Session()
        self.session.headers.update({"Accept": "application/json"})
        self.sio = socketio.Client(
            reconnection=True,
            reconnection_attempts=0,
            logger=False,
            engineio_logger=False,
        )
        self._register_socket_handlers()

        self.fast_tick = 0
        self.fastTick = 0
        self.last_telemetry_update = time.time()
        self.lastTelemetryUpdate = self.last_telemetry_update
        self.last_processed_event_id: str | None = None
        self.lastProcessedEventId: str | None = None
        self.last_processed_event_ids: dict[str, str] = {}
        self.last_error_log_at: dict[str, float] = {}
        self.last_heartbeat_at = 0.0
        self.is_bound = False

    def _register_socket_handlers(self) -> None:
        def connect() -> None:
            self.is_bound = False
            print(
                f"[Telemetry] websocket connected | matchId={self.config.match_id}",
                flush=True,
            )

        def disconnect() -> None:
            self.is_bound = False
            print(
                f"[Telemetry] websocket disconnected | matchId={self.config.match_id}",
                flush=True,
            )

        def connect_error(data: Any) -> None:
            self.is_bound = False
            print(
                f"[Telemetry] websocket connect error | matchId={self.config.match_id} | detail={data}",
                flush=True,
            )

        self.sio.on("connect", handler=connect, namespace=PCOB_NAMESPACE)
        self.sio.on("disconnect", handler=disconnect, namespace=PCOB_NAMESPACE)
        self.sio.on("connect_error", handler=connect_error, namespace=PCOB_NAMESPACE)

    def run(self) -> None:
        while True:
            loop_started = time.monotonic()
            self.poll_fast_endpoints()
            self.fast_tick += 1
            self.fastTick = self.fast_tick

            if self.fast_tick % 4 == 0:
                self.poll_slow_endpoints()

            self._heartbeat_if_needed()

            elapsed = time.monotonic() - loop_started
            sleep_for = max(0.0, self.config.fast_interval_sec - elapsed)
            time.sleep(sleep_for)

    def poll_fast_endpoints(self) -> None:
        for endpoint in FAST_ENDPOINTS:
            self._poll_endpoint(endpoint)

    def poll_slow_endpoints(self) -> None:
        for endpoint in SLOW_ENDPOINTS:
            self._poll_endpoint(endpoint)

    def _poll_endpoint(self, endpoint: TelemetryEndpoint) -> None:
        payload = self._fetch_endpoint(endpoint)
        if _is_empty_payload(payload):
            return

        event_id = self._build_event_id(endpoint, payload)
        if self.last_processed_event_ids.get(endpoint.logical_name) == event_id:
            return

        try:
            self._emit_snapshot(endpoint, payload, event_id)
        except Exception as exc:  # pragma: no cover - network/runtime handling
            self._log_request_error(f"emit:{endpoint.logical_name}", exc)

    def _fetch_endpoint(self, endpoint: TelemetryEndpoint) -> Any:
        paths = (endpoint.path, *endpoint.fallback_paths)
        last_error: Exception | None = None

        for path in paths:
            url = f"{self.config.shadow_base_url}{path}"
            try:
                response = self.session.get(url, timeout=self.config.request_timeout_sec)
                if response.status_code == 404 and path != paths[-1]:
                    continue
                response.raise_for_status()

                try:
                    payload = response.json()
                except ValueError:
                    raw = response.text.strip()
                    if raw == "":
                        return None
                    payload = {"raw": raw}

                if path != endpoint.path:
                    print(
                        f"[Telemetry] endpoint fallback | requested={endpoint.path} using={path}",
                        flush=True,
                    )
                return payload
            except requests.RequestException as exc:
                last_error = exc
                if getattr(getattr(exc, "response", None), "status_code", None) == 404 and path != paths[-1]:
                    continue

        if last_error is not None:
            self._log_request_error(endpoint.logical_name, last_error)
        return None

    def _emit_snapshot(
        self,
        endpoint: TelemetryEndpoint,
        payload: Any,
        event_id: str,
    ) -> None:
        self._ensure_socket_ready()
        message = {
            "type": endpoint.event_type,
            "matchId": self.config.match_id,
            "ts": _now_ms(),
            "payload": {
                "endpoint": endpoint.path,
                "cycle": endpoint.cycle,
                "eventId": event_id,
                "data": payload,
            },
            "meta": {
                "nodeId": self.config.node_id,
                "priority": self.config.priority,
                "endpoint": endpoint.logical_name,
                "cycle": endpoint.cycle,
            },
        }
        self.sio.emit("pcob:telemetry", message, namespace=PCOB_NAMESPACE)
        self._mark_processed(endpoint.logical_name, event_id)

    def _heartbeat_if_needed(self) -> None:
        now = time.monotonic()
        if now - self.last_heartbeat_at < self.config.heartbeat_interval_sec:
            return

        self.last_heartbeat_at = now
        print(
            f"[Telemetry] heartbeat tick={self.fast_tick}",
            flush=True,
        )

        try:
            self._ensure_socket_ready()
            self.sio.emit(
                "pcob:telemetry",
                {
                    "type": "NODE_HEARTBEAT",
                    "matchId": self.config.match_id,
                    "ts": _now_ms(),
                    "payload": {
                        "status": "alive",
                        "tick": self.fast_tick,
                        "matchId": self.config.match_id,
                        "lastTelemetryUpdate": self.lastTelemetryUpdate,
                        "capabilities": list(self.config.capabilities),
                    },
                    "meta": {
                        "nodeId": self.config.node_id,
                        "priority": self.config.priority,
                        "capabilities": list(self.config.capabilities),
                    },
                },
                namespace=PCOB_NAMESPACE,
            )
        except Exception as exc:  # pragma: no cover - network/runtime handling
            self._log_request_error("heartbeat", exc)

    def _mark_processed(self, logical_name: str, event_id: str) -> None:
        self.last_processed_event_ids[logical_name] = event_id
        self.last_processed_event_id = event_id
        self.lastProcessedEventId = event_id
        self.last_telemetry_update = time.time()
        self.lastTelemetryUpdate = self.last_telemetry_update

    def _build_event_id(self, endpoint: TelemetryEndpoint, payload: Any) -> str:
        digest = hashlib.sha1(
            f"{endpoint.logical_name}:{_canonical_json(payload)}".encode("utf-8")
        ).hexdigest()
        return digest

    def _ensure_socket_ready(self) -> None:
        if PCOB_NAMESPACE not in self.sio.namespaces:
            self.sio.connect(
                self.config.backend_url,
                transports=["websocket", "polling"],
                namespaces=[PCOB_NAMESPACE],
                socketio_path=self.config.socketio_path,
                auth={"token": self.config.jwt_token},
                wait_timeout=5,
            )

        if self.is_bound:
            return

        ack_event = threading.Event()
        bind_response: dict[str, Any] = {}

        def _ack(response: Any) -> None:
            bind_response["value"] = response
            ack_event.set()

        self.sio.emit(
            "pcob:bind",
            {
                "matchId": self.config.match_id,
                "source": "SHADOW",
                "nodeId": self.config.node_id,
                "priority": self.config.priority,
                "capabilities": {
                    "fastPolling": True,
                    "slowPolling": True,
                    "collector": "shadow_api",
                },
            },
            callback=_ack,
            namespace=PCOB_NAMESPACE,
        )

        if not ack_event.wait(timeout=5):
            raise RuntimeError("pcob:bind timed out")

        response = bind_response.get("value")
        if not isinstance(response, dict) or not response.get("ok"):
            raise RuntimeError(f"pcob:bind rejected: {response}")

        self.is_bound = True

    def _log_request_error(self, key: str, exc: Exception) -> None:
        now = time.monotonic()
        last_logged = self.last_error_log_at.get(key, 0.0)
        if now - last_logged < 5.0:
            return
        self.last_error_log_at[key] = now
        print(f"[Telemetry] warning | target={key} | detail={exc}", flush=True)


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def parse_args() -> CollectorConfig:
    parser = argparse.ArgumentParser(
        description="Arenzyra Shadow telemetry collector with fast/slow polling cycles."
    )
    parser.add_argument(
        "--match-id",
        default=os.getenv("ARENZYRA_MATCH_ID"),
        help="Target Arenzyra match ID.",
    )
    parser.add_argument(
        "--token",
        default=(
            os.getenv("ARENZYRA_JWT")
            or os.getenv("ARENZYRA_JWT_TOKEN")
            or os.getenv("JWT_TOKEN")
        ),
        help="JWT used to authenticate against the Arenzyra /pcob Socket.IO gateway.",
    )
    parser.add_argument(
        "--shadow-base-url",
        default=(
            os.getenv("SHADOW_API_BASE")
            or os.getenv("SHADOW_API_URL")
            or "http://127.0.0.1:5000"
        ),
        help="Base URL for the local Shadow telemetry bridge.",
    )
    parser.add_argument(
        "--backend-url",
        default=(
            os.getenv("ARENZYRA_BACKEND_URL")
            or os.getenv("ARENZYRA_WS_URL")
            or "http://127.0.0.1:3000"
        ),
        help="Arenzyra backend base URL used for Socket.IO.",
    )
    parser.add_argument(
        "--socketio-path",
        default=os.getenv("ARENZYRA_SOCKETIO_PATH") or "/pcob/socket.io",
        help="Socket.IO path for the Arenzyra PCOB gateway.",
    )
    parser.add_argument(
        "--node-id",
        default=os.getenv("ARENZYRA_NODE_ID") or f"shadow-{socket.gethostname()}",
        help="Node identifier sent with telemetry messages.",
    )
    parser.add_argument(
        "--priority",
        type=int,
        default=_env_int("ARENZYRA_NODE_PRIORITY", 100),
        help="Collector node priority for websocket scale coordination.",
    )
    parser.add_argument(
        "--fast-interval-sec",
        type=float,
        default=_env_float("ARENZYRA_FAST_POLL_SEC", 0.5),
        help="Fast polling interval in seconds.",
    )
    parser.add_argument(
        "--heartbeat-interval-sec",
        type=float,
        default=_env_float("ARENZYRA_HEARTBEAT_SEC", 5.0),
        help="Heartbeat log and websocket interval in seconds.",
    )
    parser.add_argument(
        "--request-timeout-sec",
        type=float,
        default=_env_float("ARENZYRA_REQUEST_TIMEOUT_SEC", 2.0),
        help="HTTP timeout for Shadow endpoint polling.",
    )
    args = parser.parse_args()

    if not args.match_id:
        parser.error("match id is required via --match-id or ARENZYRA_MATCH_ID")
    if not args.token:
        parser.error("JWT token is required via --token or ARENZYRA_JWT")

    return CollectorConfig(
        match_id=args.match_id,
        jwt_token=args.token,
        shadow_base_url=_trim_url(args.shadow_base_url),
        backend_url=_trim_url(args.backend_url),
        socketio_path=args.socketio_path.lstrip("/"),
        node_id=args.node_id,
        priority=args.priority,
        fast_interval_sec=max(0.1, float(args.fast_interval_sec)),
        heartbeat_interval_sec=max(1.0, float(args.heartbeat_interval_sec)),
        request_timeout_sec=max(0.5, float(args.request_timeout_sec)),
        capabilities=("TELEMETRY",),
    )


def main() -> int:
    config = parse_args()
    collector = TelemetryCollector(config)
    try:
        collector.run()
    except KeyboardInterrupt:
        print("[Telemetry] stopped", flush=True)
    finally:
        if PCOB_NAMESPACE in collector.sio.namespaces:
            collector.sio.disconnect()
        collector.session.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
