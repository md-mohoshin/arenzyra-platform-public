const { io } = require("socket.io-client");

const socket = io("ws://127.0.0.1:4000/ws");

socket.on("connect", () => {
    console.log("✅ Connected to Match State WebSocket");
});

socket.on("state:update", (data) => {
    console.log("🔥 LIVE MATCH UPDATE:");
    console.log(JSON.stringify(data, null, 2));
});

socket.on("disconnect", () => {
    console.log("❌ Disconnected");
});

socket.on("connect_error", (err) => {
    console.error("Connection error:", err.message);
});
