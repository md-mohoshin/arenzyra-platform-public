import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FileSessionOwnershipStore,
  MemorySessionOwnershipStore,
} from "./session-ownership.store";

test("memory ownership store keeps normalized durable identifiers", () => {
  const store = new MemorySessionOwnershipStore();
  store.set(" session-1 ", " user-1 ");
  assert.equal(store.get("session-1"), "user-1");
});

test("file ownership store survives a new process-level instance", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "arenzyra-ownership-"));
  const filePath = path.join(directory, "session-ownership.json");
  try {
    new FileSessionOwnershipStore(filePath).set("session-1", "user-1");
    assert.equal(new FileSessionOwnershipStore(filePath).get("session-1"), "user-1");
    assert.equal(JSON.parse(readFileSync(filePath, "utf8")).version, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
