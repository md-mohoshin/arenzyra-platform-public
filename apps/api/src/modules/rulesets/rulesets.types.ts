import type { GameKey, Prisma } from '@prisma/client';

export type RulesetInput = {
  name: string;
  description?: string | null;
  gameKey: GameKey;
  config: Prisma.InputJsonValue;
  isDefault?: boolean;
  orgId?: string | null;
};
