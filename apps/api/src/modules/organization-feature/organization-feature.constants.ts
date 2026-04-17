export type FeatureDefinition = {
  key: string;
  description: string;
  defaultEnabled: boolean;
};

export const FEATURE_REGISTRY: FeatureDefinition[] = [
  {
    key: 'widgets.liveRanking.enabled',
    description: 'Allow live ranking widget',
    defaultEnabled: true,
  },
  {
    key: 'widgets.liveRanking.showKills',
    description: 'Show kills column in live ranking/scoreboard widgets',
    defaultEnabled: true,
  },
  {
    key: 'widgets.liveRanking.showAlive',
    description: 'Show alive player count',
    defaultEnabled: true,
  },
  {
    key: 'widgets.killfeed.enabled',
    description: 'Enable killfeed widget',
    defaultEnabled: true,
  },
  {
    key: 'widgets.sponsors.enabled',
    description: 'Enable sponsors carousel',
    defaultEnabled: false,
  },
  {
    key: 'widgets.teamLogos.enabled',
    description: 'Display team logos where available',
    defaultEnabled: true,
  },
  {
    key: 'widgets.animations.enabled',
    description: 'Enable widget animations',
    defaultEnabled: true,
  },
];
