import { GameKey } from '@prisma/client';

export interface AdapterDefinition {
  key: string;
  gameKey: GameKey | 'GENERIC';
  name: string;
  modes: string[];
  isEnabledByDefault: boolean;
  usesSlots: boolean;
  maxSlots?: number | null;
}
