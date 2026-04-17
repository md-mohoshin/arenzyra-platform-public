import { GameKey } from '@prisma/client';
import { AdapterDefinition } from './adapters.types';

const GK = GameKey as unknown as Record<string, GameKey>;

export const ADAPTER_REGISTRY: ReadonlyArray<AdapterDefinition> = [
  {
    key: 'pubgm-manual',
    gameKey: GK.PUBG_MOBILE,
    name: 'PUBGM Manual',
    modes: ['MANUAL'],
    isEnabledByDefault: true,
    usesSlots: true,
    maxSlots: 25,
  },
  {
    key: 'pubgm-pcob',
    gameKey: GK.PUBG_MOBILE,
    name: 'PUBGM PCOB',
    modes: ['PCOB', 'TELEMETRY'],
    isEnabledByDefault: false,
    usesSlots: true,
    maxSlots: 25,
  },
  {
    key: 'null-adapter',
    gameKey: 'GENERIC',
    name: 'Null Adapter',
    modes: ['FALLBACK'],
    isEnabledByDefault: false,
    usesSlots: false,
    maxSlots: null,
  },
];
