import { io, Socket } from "socket.io-client";
import type { BackendSnapshot } from "./backend";

export type LiveWsStatus = "disconnected" | "connecting" | "connected" | "error";

const toWsUrl = (httpUrl: string) => {
  if (httpUrl.startsWith("https://")) return httpUrl.replace("https://", "wss://");
  if (httpUrl.startsWith("http://")) return httpUrl.replace("http://", "ws://");
  return httpUrl;
};

export function createLiveSocket(
  baseUrl: string | undefined | null,
  opts: {
    onSnapshot: (snap: BackendSnapshot) => void;
    onUpdate: (snap: BackendSnapshot) => void;
    onStatus: (status: LiveWsStatus) => void;
  },
) {
  let socket: Socket | null = null;

  const connect = () => {
    if (!baseUrl) {
      opts.onStatus("error");
      return;
    }
    const wsBase = toWsUrl(baseUrl.replace(/\/$/, ""));
      opts.onStatus("connecting");
      socket = io(`${wsBase}/ws/live`, {
        transports: ["websocket"],
      });

    socket.on("connect", () => opts.onStatus("connected"));
    socket.on("disconnect", () => opts.onStatus("disconnected"));
    socket.on("connect_error", () => opts.onStatus("error"));
    socket.on("error", () => opts.onStatus("error"));

    socket.on("message", (msg: { type: string; data: BackendSnapshot }) => {
      if (!msg || !msg.type) return;
      if (msg.type === "snapshot") opts.onSnapshot(msg.data);
      if (msg.type === "update") opts.onUpdate(msg.data);
    });
  };

  const disconnect = () => {
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
  };

  return { connect, disconnect };
}
