"use client";

import { API_URL } from "@/lib/api";
import { useEffect, useMemo, useRef, useState } from "react";

const WIDGET_REALTIME_URL = toWebSocketUrl(API_URL, "/ws/widgets");

export type WidgetRealtimeConnectionState =
  | "idle"
  | "connecting"
  | "open"
  | "closed"
  | "error";

export type WidgetRealtimeMessage = {
  type: string;
  topic?: string;
  matchId?: string | null;
  payload?: unknown;
  timestamp?: number;
  [key: string]: unknown;
};

type UseWidgetRealtimeOptions = {
  orgSlug: string;
  widgetKey: string;
  matchId?: string | null;
  enabled?: boolean;
  heartbeatMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
};

type UseWidgetRealtimeResult = {
  connectionState: WidgetRealtimeConnectionState;
  isConnected: boolean;
  reconnectAttempt: number;
  lastMessage: WidgetRealtimeMessage | null;
  lastMessageAt: number | null;
  send: (message: unknown) => boolean;
};

export function useWidgetRealtime({
  orgSlug,
  widgetKey,
  matchId,
  enabled = true,
  heartbeatMs = 15_000,
  reconnectBaseMs = 1_000,
  reconnectMaxMs = 10_000,
}: UseWidgetRealtimeOptions): UseWidgetRealtimeResult {
  const socketRef = useRef<WebSocket | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);

  const [connectionState, setConnectionState] =
    useState<WidgetRealtimeConnectionState>("idle");
  const [lastMessage, setLastMessage] = useState<WidgetRealtimeMessage | null>(
    null,
  );
  const [lastMessageAt, setLastMessageAt] = useState<number | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || !orgSlug || !widgetKey) {
      stopHeartbeat(heartbeatTimerRef);
      stopReconnect(reconnectTimerRef);
      closeSocket(socketRef);
      reconnectAttemptRef.current = 0;
      return;
    }

    let disposed = false;

    const connect = () => {
      if (disposed) {
        return;
      }

      stopReconnect(reconnectTimerRef);
      stopHeartbeat(heartbeatTimerRef);
      closeSocket(socketRef);

      setConnectionState("connecting");

      const socket = new WebSocket(WIDGET_REALTIME_URL);
      socketRef.current = socket;

      socket.onopen = () => {
        if (disposed) {
          socket.close();
          return;
        }

        reconnectAttemptRef.current = 0;
        setReconnectAttempt(0);
        setConnectionState("open");

        sendJson(socket, {
          type: "subscribe_widget",
          timestamp: Date.now(),
          payload: {
            orgSlug,
            widgetKey,
            matchId: matchId ?? undefined,
          },
        });

        heartbeatTimerRef.current = window.setInterval(() => {
          if (socket.readyState !== WebSocket.OPEN) {
            return;
          }

          sendJson(socket, {
            type: "heartbeat",
            timestamp: Date.now(),
            payload: {
              orgSlug,
              widgetKey,
              matchId: matchId ?? undefined,
            },
          });
        }, heartbeatMs);
      };

      socket.onmessage = (event) => {
        if (typeof event.data !== "string") {
          return;
        }

        try {
          const message = JSON.parse(event.data) as WidgetRealtimeMessage;
          setLastMessage(message);
          setLastMessageAt(Date.now());
        } catch {
          return;
        }
      };

      socket.onerror = () => {
        setConnectionState("error");
      };

      socket.onclose = () => {
        stopHeartbeat(heartbeatTimerRef);
        socketRef.current = null;

        if (disposed) {
          setConnectionState("closed");
          return;
        }

        setConnectionState("closed");

        const nextAttempt = reconnectAttemptRef.current + 1;
        reconnectAttemptRef.current = nextAttempt;
        setReconnectAttempt(nextAttempt);

        const delay = Math.min(
          reconnectBaseMs * 2 ** Math.max(0, nextAttempt - 1),
          reconnectMaxMs,
        );

        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      stopHeartbeat(heartbeatTimerRef);
      stopReconnect(reconnectTimerRef);
      closeSocket(socketRef);
    };
  }, [
    enabled,
    heartbeatMs,
    matchId,
    orgSlug,
    reconnectBaseMs,
    reconnectMaxMs,
    widgetKey,
  ]);

  return useMemo(
    () => ({
      connectionState:
        enabled && orgSlug && widgetKey ? connectionState : "idle",
      isConnected:
        enabled &&
        Boolean(orgSlug) &&
        Boolean(widgetKey) &&
        connectionState === "open",
      reconnectAttempt:
        enabled && orgSlug && widgetKey ? reconnectAttempt : 0,
      lastMessage,
      lastMessageAt,
      send: (message: unknown) => {
        const socket = socketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          return false;
        }

        sendJson(socket, message);
        return true;
      },
    }),
    [
      connectionState,
      enabled,
      lastMessage,
      lastMessageAt,
      orgSlug,
      reconnectAttempt,
      widgetKey,
    ],
  );
}

function toWebSocketUrl(baseUrl: string, path: string): string {
  const url = new URL(path, baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function sendJson(socket: WebSocket, message: unknown) {
  socket.send(JSON.stringify(message));
}

function closeSocket(socketRef: { current: WebSocket | null }) {
  const socket = socketRef.current;
  socketRef.current = null;

  if (
    socket &&
    (socket.readyState === WebSocket.CONNECTING ||
      socket.readyState === WebSocket.OPEN)
  ) {
    socket.close();
  }
}

function stopHeartbeat(timerRef: { current: number | null }) {
  if (timerRef.current === null) {
    return;
  }

  window.clearInterval(timerRef.current);
  timerRef.current = null;
}

function stopReconnect(timerRef: { current: number | null }) {
  if (timerRef.current === null) {
    return;
  }

  window.clearTimeout(timerRef.current);
  timerRef.current = null;
}
