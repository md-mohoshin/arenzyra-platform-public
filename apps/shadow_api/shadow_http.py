import time
import requests

BASE = "http://localhost:3000"

# Try these paths; keep the one that returns JSON in your browser
ENDPOINTS = [
    "/telemetry",
    "/match",
    "/status",
    "/api",
    "/players",
    "/kills",
]

def try_endpoints():
    for p in ENDPOINTS:
        try:
            r = requests.get(BASE + p, timeout=2)
            if r.status_code == 200 and r.text.strip():
                print(f"OK: {p}")
                print(r.text[:300])
                return p
        except Exception as e:
            print(f"FAIL: {p} -> {e}")
    return None

path = try_endpoints()
if not path:
    print("No endpoint responded with JSON. Check logs for the exact path.")
    exit(1)

print("\nPolling live data from:", BASE + path)
while True:
    r = requests.get(BASE + path, timeout=5)
    print("DATA:", r.text[:500])
    time.sleep(1)
