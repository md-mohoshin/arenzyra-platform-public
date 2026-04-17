import { Injectable, Logger } from '@nestjs/common';
import { GameKey } from '@prisma/client';
import { ADAPTER_REGISTRY } from './adapters.registry';
import { AdapterDefinition } from './adapters.types';

@Injectable()
export class AdaptersService {
  private readonly logger = new Logger('AdaptersService');

  constructor() {
    const pubgAdapters = ADAPTER_REGISTRY.filter(
      (a) => a.gameKey === GameKey.PUBG_MOBILE,
    );
    const missingSlots = pubgAdapters.filter(
      (a) => !a.usesSlots || a.maxSlots !== 25,
    );
    if (missingSlots.length > 0) {
      throw new Error(
        `PUBG adapters must declare usesSlots=true and maxSlots=25. Offenders: ${missingSlots
          .map((a) => a.key)
          .join(', ')}`,
      );
    }
  }

  getRegisteredAdapters(): ReadonlyArray<AdapterDefinition> {
    return ADAPTER_REGISTRY;
  }

  getEnabledAdapters(): ReadonlyArray<AdapterDefinition> {
    return ADAPTER_REGISTRY.filter((a) => a.isEnabledByDefault);
  }

  getAdaptersByGame(gameKey: GameKey): ReadonlyArray<AdapterDefinition> {
    return ADAPTER_REGISTRY.filter((a) => a.gameKey === gameKey);
  }

  getAdapterByKey(key: string | null | undefined): AdapterDefinition | null {
    const normalized = key?.trim().toLowerCase();
    if (!normalized) return null;
    return (
      ADAPTER_REGISTRY.find(
        (adapter) => adapter.key.toLowerCase() === normalized,
      ) ?? null
    );
  }

  parseGameKey(input: string | null | undefined): GameKey | null {
    if (!input) return null;
    const normalized = `${input}`.toUpperCase();
    const allowed = Object.values(GameKey);
    return allowed.includes(normalized as GameKey)
      ? (normalized as GameKey)
      : null;
  }

  isKnownAdapter(key: string | null | undefined): boolean {
    if (!key) return false;
    const normalized = key.trim();
    if (!normalized) return false;
    return ADAPTER_REGISTRY.some(
      (adapter) => adapter.key.toLowerCase() === normalized.toLowerCase(),
    );
  }

  warnUnknownAdapter(key: string | null | undefined) {
    if (!key) return;
    this.logger.warn(`Unknown adapterKey received: ${key}`);
  }
}
