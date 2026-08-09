import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { botConfig } from "../config";

type OwnershipFile = {
  version: 1;
  owners: Record<string, string>;
};

export interface SessionOwnershipStoreLike {
  get(sessionId: string): string | null;
  set(sessionId: string, creatorDiscordId: string): void;
}

function normalizedIdentifier(value: string, label: string) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > 128) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

export class MemorySessionOwnershipStore implements SessionOwnershipStoreLike {
  private readonly owners = new Map<string, string>();

  get(sessionId: string) {
    return this.owners.get(String(sessionId || "").trim()) ?? null;
  }

  set(sessionId: string, creatorDiscordId: string) {
    this.owners.set(
      normalizedIdentifier(sessionId, "sessionId"),
      normalizedIdentifier(creatorDiscordId, "creatorDiscordId"),
    );
  }
}

export class FileSessionOwnershipStore implements SessionOwnershipStoreLike {
  private readonly owners = new Map<string, string>();

  constructor(private readonly filePath: string) {
    this.load();
  }

  get(sessionId: string) {
    return this.owners.get(String(sessionId || "").trim()) ?? null;
  }

  set(sessionId: string, creatorDiscordId: string) {
    this.owners.set(
      normalizedIdentifier(sessionId, "sessionId"),
      normalizedIdentifier(creatorDiscordId, "creatorDiscordId"),
    );
    this.persist();
  }

  private load() {
    if (!existsSync(this.filePath)) {
      return;
    }

    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<OwnershipFile>;
      if (parsed.version !== 1 || !parsed.owners || typeof parsed.owners !== "object") {
        throw new Error("unsupported ownership state format");
      }
      for (const [sessionId, creatorDiscordId] of Object.entries(parsed.owners)) {
        if (typeof creatorDiscordId !== "string") {
          continue;
        }
        this.owners.set(
          normalizedIdentifier(sessionId, "sessionId"),
          normalizedIdentifier(creatorDiscordId, "creatorDiscordId"),
        );
      }
    } catch (error) {
      console.warn(
        `[DiscordState] ignored unreadable session ownership state: ${String(error)}`,
      );
    }
  }

  private persist() {
    const directory = path.dirname(this.filePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const payload: OwnershipFile = {
      version: 1,
      owners: Object.fromEntries(this.owners),
    };

    try {
      writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      renameSync(temporaryPath, this.filePath);
      chmodSync(this.filePath, 0o600);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  }
}

export function createSessionOwnershipStore(): SessionOwnershipStoreLike {
  if (botConfig.nodeEnv === "test") {
    return new MemorySessionOwnershipStore();
  }
  const stateDirectory =
    botConfig.stateDir || path.join(process.cwd(), ".arenzyra-state");
  return new FileSessionOwnershipStore(
    path.join(stateDirectory, "session-ownership.json"),
  );
}
