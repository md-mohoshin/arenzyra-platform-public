import { IoAdapter } from '@nestjs/platform-socket.io';
import { WsAdapter } from '@nestjs/platform-ws';
import type { INestApplicationContext } from '@nestjs/common';
import type { MessageMappingProperties } from '@nestjs/websockets';
import {
  REALTIME_TELEMETRY_PATH,
  REALTIME_WIDGET_PATH,
} from '../../modules/realtime/realtime-types';
import type { Observable } from 'rxjs';
import type { Server, Socket } from 'socket.io';

type AdapterOptions = {
  namespace?: string;
  path?: string;
  server?: unknown;
};

type RawWsData = string | Buffer | ArrayBuffer | Buffer[];
type MessageHandlerTransform = (data: any) => Observable<any>;

export class ArenzyraWsAdapter {
  private readonly ioAdapter: IoAdapter;

  private readonly wsAdapter: WsAdapter;

  private readonly nativeWsPaths = new Set<string>([
    REALTIME_TELEMETRY_PATH,
    REALTIME_WIDGET_PATH,
  ]);

  constructor(appOrHttpServer?: INestApplicationContext | object) {
    this.ioAdapter = new IoAdapter(appOrHttpServer);
    this.wsAdapter = new WsAdapter(appOrHttpServer, {
      messageParser: (data: RawWsData) => this.parseEnvelope(data),
    });
  }

  create(port: number, options?: AdapterOptions): unknown {
    if (this.shouldUseNativeWs(options)) {
      return this.wsAdapter.create(
        port,
        options as Record<string, any>,
      ) as unknown;
    }
    return this.ioAdapter.create(
      port,
      options as Parameters<IoAdapter['create']>[1],
    ) as unknown;
  }

  bindClientConnect(
    server: unknown,
    callback: (...args: unknown[]) => void,
  ): void {
    if (this.isSocketIoServer(server)) {
      return this.ioAdapter.bindClientConnect(server, callback);
    }
    return this.wsAdapter.bindClientConnect(server, callback);
  }

  bindClientDisconnect(
    client: unknown,
    callback: (...args: unknown[]) => void,
  ): void {
    if (this.isSocketIoClient(client)) {
      return this.ioAdapter.bindClientDisconnect(client, callback);
    }
    return this.wsAdapter.bindClientDisconnect(client, callback);
  }

  bindMessageHandlers(
    client: unknown,
    handlers: MessageMappingProperties[],
    transform: MessageHandlerTransform,
  ): void {
    if (this.isSocketIoClient(client)) {
      return this.ioAdapter.bindMessageHandlers(
        client as Socket,
        handlers,
        transform,
      );
    }
    return this.wsAdapter.bindMessageHandlers(client, handlers, transform);
  }

  async close(server: unknown): Promise<void> {
    if (this.isSocketIoServer(server)) {
      await this.ioAdapter.close(server as Server);
      return;
    }
    await this.wsAdapter.close(server);
  }

  async dispose() {
    await this.ioAdapter.dispose();
    await this.wsAdapter.dispose();
  }

  private shouldUseNativeWs(options?: AdapterOptions): boolean {
    const normalizedPath = this.normalizePath(options?.path);
    return this.nativeWsPaths.has(normalizedPath);
  }

  private isSocketIoServer(server: unknown): boolean {
    if (!server || typeof server !== 'object') return false;
    return typeof (server as { of?: unknown }).of === 'function';
  }

  private isSocketIoClient(client: unknown): boolean {
    if (!client || typeof client !== 'object') return false;
    return 'handshake' in client;
  }

  private normalizePath(path?: string): string {
    if (!path) return '';
    if (path === '/') return path;
    return path.endsWith('/') ? path.slice(0, -1) : path;
  }

  private parseEnvelope(data: RawWsData) {
    try {
      const payload = JSON.parse(this.toText(data)) as {
        type?: unknown;
        event?: unknown;
        data?: unknown;
      };

      if (!payload || typeof payload !== 'object') {
        return;
      }

      if (typeof payload.type === 'string' && payload.type.length > 0) {
        return { event: payload.type, data: payload };
      }

      if (typeof payload.event === 'string' && payload.event.length > 0) {
        return { event: payload.event, data: payload.data };
      }
    } catch {
      return;
    }

    return;
  }

  private toText(data: RawWsData): string {
    if (typeof data === 'string') {
      return data;
    }

    if (Array.isArray(data)) {
      return Buffer.concat(data).toString('utf8');
    }

    if (data instanceof ArrayBuffer) {
      return Buffer.from(data).toString('utf8');
    }

    return data.toString('utf8');
  }
}
