import { GameKey } from '@prisma/client';

const GK = GameKey as unknown as Record<string, GameKey>;

export const DEFAULT_GAMES: ReadonlyArray<{ key: GameKey; name: string }> = [
  { key: GK.PUBG_MOBILE, name: 'PUBG Mobile' },
  { key: GK.VALORANT, name: 'VALORANT' },
  { key: GK.CS2, name: 'Counter-Strike 2' },
  { key: GK.DOTA2, name: 'Dota 2' },
  { key: GK.LOL, name: 'League of Legends' },
  { key: GK.FORTNITE, name: 'Fortnite' },
  { key: GK.FREE_FIRE, name: 'Free Fire' },
  { key: GK.MLBB, name: 'Mobile Legends' },
];
