import websocket
import json

urls = [
    "ws://localhost:3000",
    "ws://localhost:3000/live",
    "ws://localhost:3000/ws",
    "ws://localhost:3000/socket",
    "ws://localhost:3000/telemetry"
]


def on_message(ws, message):
    try:
        data = json.loads(message)
        print("DATA:", data)
    except:
        print("RAW:", message[:300])

def on_error(ws, error):
    print("ERROR:", error)

def on_open(ws):
    print("CONNECTED")

for url in urls:
    print("\nTesting:", url)

    ws = websocket.WebSocketApp(
        url,
        on_open=on_open,
        on_message=on_message,
        on_error=on_error
    )

    ws.run_forever()
