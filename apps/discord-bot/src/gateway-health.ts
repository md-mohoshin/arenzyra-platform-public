import fs from "node:fs/promises";
import path from "node:path";
import { Status, type Client } from "discord.js";

export const DEFAULT_GATEWAY_HEALTH_FILE =
  "/tmp/arenzyra-discord-gateway.ready";
const DEFAULT_GATEWAY_HEALTH_INTERVAL_MS = 10_000;

type GatewayHealthClient = Pick<Client, "isReady" | "ws">;

export function isDiscordGatewayReady(client: GatewayHealthClient) {
  const shards = [...client.ws.shards.values()];
  return (
    client.isReady() &&
    shards.length > 0 &&
    shards.every((shard) => shard.status === Status.Ready)
  );
}

export class GatewayHealthMarker {
  private timer: NodeJS.Timeout | null = null;
  private reportedWriteFailure = false;

  constructor(
    private readonly filePath =
      process.env.ARENZYRA_DISCORD_GATEWAY_HEALTH_FILE?.trim() ||
      DEFAULT_GATEWAY_HEALTH_FILE,
    private readonly intervalMs = DEFAULT_GATEWAY_HEALTH_INTERVAL_MS,
  ) {}

  async clear() {
    await fs.rm(this.filePath, { force: true }).catch(() => undefined);
  }

  async refresh(client: GatewayHealthClient) {
    if (!isDiscordGatewayReady(client)) {
      await this.clear();
      return false;
    }

    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, `${Date.now()}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      this.reportedWriteFailure = false;
      return true;
    } catch (error) {
      if (!this.reportedWriteFailure) {
        this.reportedWriteFailure = true;
        console.warn(
          `Discord gateway health marker refresh failed: ${String(error)}`,
        );
      }
      return false;
    }
  }

  start(client: GatewayHealthClient) {
    this.stopTimer();
    void this.refresh(client);
    this.timer = setInterval(() => {
      void this.refresh(client);
    }, this.intervalMs);
    this.timer.unref?.();
  }

  async stop() {
    this.stopTimer();
    await this.clear();
  }

  private stopTimer() {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }
}
