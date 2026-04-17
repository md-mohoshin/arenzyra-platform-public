"use client";

import type { OverlayStatus } from "./OverlayController";

type Message = { event: string; payload: any };
type StatusHandler = (status: OverlayStatus) => void;

export class WidgetOverlayServer {
  private url: string;
  private socket: WebSocket | null = null;
  private status: OverlayStatus = "idle";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: Message[] = [];
  public onStatusChange: StatusHandler | null = null;

  constructor(url: string) {
    this.url = url;
  }

  private setStatus(status: OverlayStatus) {
    this.status = status;
    this.onStatusChange?.(status);
  }

  connect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.setStatus("connecting");
    try {
      this.socket = new WebSocket(this.url);
    } catch (err) {
      console.error("[overlay] failed to connect", err);
      this.setStatus("disconnected");
      this.scheduleReconnect();
      return;
    }
    this.socket.onopen = () => {
      this.setStatus("connected");
      this.flushQueue();
    };
    this.socket.onclose = () => {
      this.setStatus("disconnected");
      this.scheduleReconnect();
    };
    this.socket.onerror = (err) => {
      console.error("[overlay] ws error", err);
      this.setStatus("disconnected");
      this.scheduleReconnect();
    };
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
    this.setStatus("disconnected");
  }

  send(event: string, payload: any) {
    const message: Message = { event, payload };
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    } else {
      // queue and try on next open
      this.queue.push(message);
      if (this.queue.length > 50) {
        this.queue.shift();
      }
      if (!this.socket && !this.reconnectTimer) {
        this.scheduleReconnect();
      }
    }
  }

  private flushQueue() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    while (this.queue.length) {
      const next = this.queue.shift()!;
      this.socket.send(JSON.stringify(next));
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }
}

export default WidgetOverlayServer;
