import socketio

sio = socketio.Client(logger=True, engineio_logger=True)

@sio.event
def connect():
    print("CONNECTED to Obtools API")

@sio.event
def disconnect():
    print("DISCONNECTED")

# These are the common event names used by Obtools / ShadowTracker
@sio.on("telemetry")
def on_telemetry(data):
    print("TELEMETRY:", data)

@sio.on("match")
def on_match(data):
    print("MATCH:", data)

@sio.on("players")
def on_players(data):
    print("PLAYERS:", data)

@sio.on("kills")
def on_kills(data):
    print("KILLS:", data)

print("Connecting to Obtools Socket.IO API...")
sio.connect("http://localhost:10086", transports=["websocket"])
sio.wait()
