export type MapConfig = {
  mapName: string;
  imageUrl: string;
  worldSize: number;
  coordinateSystem: 'WORLD' | 'WORLD_BOTTOM_LEFT';
  notes?: string;
};

export const MAP_CONFIGS: Record<string, MapConfig> = {
  ERANGEL: {
    mapName: 'ERANGEL',
    imageUrl: '/maps/erangel.png',
    worldSize: 8000,
    coordinateSystem: 'WORLD_BOTTOM_LEFT',
  },
  MIRAMAR: {
    mapName: 'MIRAMAR',
    imageUrl: '/maps/miramar.png',
    worldSize: 8000,
    coordinateSystem: 'WORLD_BOTTOM_LEFT',
  },
  SANHOK: {
    mapName: 'SANHOK',
    imageUrl: '/maps/sanhok.jpg',
    worldSize: 4000,
    coordinateSystem: 'WORLD_BOTTOM_LEFT',
  },
  VIKENDI: {
    mapName: 'VIKENDI',
    imageUrl: '/maps/vikendi.jpg',
    worldSize: 6000,
    coordinateSystem: 'WORLD_BOTTOM_LEFT',
  },
  LIVIK: {
    mapName: 'LIVIK',
    imageUrl: '/maps/livik.jpg',
    worldSize: 4000,
    coordinateSystem: 'WORLD_BOTTOM_LEFT',
  },
  LIVIK_AFTERMATH: {
    mapName: 'LIVIK AFTERMATH',
    imageUrl: '/maps/livik-aftermath.png',
    worldSize: 4000,
    coordinateSystem: 'WORLD_BOTTOM_LEFT',
  },
  KARAKIN: {
    mapName: 'KARAKIN',
    imageUrl: '/maps/karakin.jpg',
    worldSize: 2000,
    coordinateSystem: 'WORLD_BOTTOM_LEFT',
  },
  NUSA: {
    mapName: 'NUSA',
    imageUrl: '/maps/nusa.png',
    worldSize: 1000,
    coordinateSystem: 'WORLD_BOTTOM_LEFT',
  },
  RONDO: {
    mapName: 'RONDO',
    imageUrl: '/maps/rondo.webp',
    worldSize: 8000,
    coordinateSystem: 'WORLD_BOTTOM_LEFT',
  },
};

const MAP_ALIASES: Record<string, string> = {
  ERANGEL8X8: 'ERANGEL',
  MIRAMAR8X8: 'MIRAMAR',
  SANHOK4X4: 'SANHOK',
  VIKENDI6X6: 'VIKENDI',
  LIVIKAFTERMATH: 'LIVIK_AFTERMATH',
  AFTERMATH: 'LIVIK_AFTERMATH',
  KARAKIN2X2: 'KARAKIN',
  NUSA1X1: 'NUSA',
  RONDO8X8: 'RONDO',
};

function normalizeMapKey(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

export function getMapConfig(key: string): MapConfig | null {
  if (!key) return null;
  const normalized = normalizeMapKey(key);

  if (MAP_CONFIGS[normalized]) {
    return MAP_CONFIGS[normalized];
  }

  const alias = MAP_ALIASES[normalized];
  if (alias && MAP_CONFIGS[alias]) {
    return MAP_CONFIGS[alias];
  }

  const directMatch = Object.entries(MAP_CONFIGS).find(([configKey]) =>
    normalized.includes(configKey),
  );
  if (directMatch) {
    return directMatch[1];
  }

  const aliasMatch = Object.entries(MAP_ALIASES).find(([aliasKey]) =>
    normalized.includes(aliasKey),
  );
  if (aliasMatch) {
    return MAP_CONFIGS[aliasMatch[1]] ?? null;
  }

  return null;
}
