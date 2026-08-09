import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Collection, Status } from "discord.js";
import {
  GatewayHealthMarker,
  isDiscordGatewayReady,
} from "./gateway-health";

function fakeClient({
  ready = true,
  statuses = [Status.Ready],
}: {
  ready?: boolean;
  statuses?: Status[];
} = {}) {
  return {
    isReady: () => ready,
    ws: {
      shards: new Collection(
        statuses.map((status, index) => [index, { status }]),
      ),
    },
  } as any;
}

test("gateway health is ready only when the client and every shard are ready", () => {
  assert.equal(isDiscordGatewayReady(fakeClient()), true);
  assert.equal(isDiscordGatewayReady(fakeClient({ ready: false })), false);
  assert.equal(
    isDiscordGatewayReady(
      fakeClient({ statuses: [Status.Ready, Status.Reconnecting] }),
    ),
    false,
  );
  assert.equal(isDiscordGatewayReady(fakeClient({ statuses: [] })), false);
});

test("gateway health marker is fresh only while the gateway is ready", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "arenzyra-health-"));
  const filePath = path.join(tempDir, "gateway.ready");
  const marker = new GatewayHealthMarker(filePath, 60_000);

  try {
    assert.equal(await marker.refresh(fakeClient()), true);
    const stat = await fs.stat(filePath);
    assert.ok(
      Math.abs(stat.mtimeMs - Date.now()) < 5_000,
      "gateway health marker should have a current filesystem timestamp",
    );

    assert.equal(
      await marker.refresh(
        fakeClient({ statuses: [Status.Reconnecting] }),
      ),
      false,
    );
    await assert.rejects(fs.stat(filePath), { code: "ENOENT" });
  } finally {
    await marker.stop();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
