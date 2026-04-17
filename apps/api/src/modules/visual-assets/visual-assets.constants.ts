import { ObsTemplateKind, WidgetKind } from '@prisma/client';

export const DEFAULT_WIDGETS: Array<{
  key: string;
  name: string;
  description?: string;
  kind: WidgetKind;
  category?: string;
  config?: Record<string, unknown>;
}> = [
  {
    key: 'live-ranking',
    name: 'Live Ranking',
    description: 'Live match ranking overlay',
    kind: WidgetKind.LIVE_RANKING,
    category: 'live',
    config: { variant: 'standard' },
  },
  {
    key: 'live-group-overall',
    name: 'Live Group Overall',
    description: 'Live group overall standings overlay',
    kind: WidgetKind.OVERALL_RANKING,
    category: 'live',
    config: { variant: 'group-overall' },
  },
  {
    key: 'lower-third',
    name: 'Lower Third',
    description: 'Lower third alert banner',
    kind: WidgetKind.LOWER_THIRD,
    category: 'lower',
    config: { style: 'basic' },
  },
  {
    key: 'match-lower-third',
    name: 'Match Lower Third',
    description: 'Match context lower-third banner',
    kind: WidgetKind.LOWER_THIRD_MATCH,
    category: 'lower',
    config: { style: 'match' },
  },
];

export const DEFAULT_OBS_TEMPLATES: Array<{
  key: string;
  name: string;
  description?: string;
  kind: ObsTemplateKind;
  config?: Record<string, unknown>;
  scene?: { name: string; layout?: Record<string, unknown> };
}> = [
  {
    key: 'fullscreen-result',
    name: 'Fullscreen Result',
    description: 'Post-match fullscreen results template',
    kind: ObsTemplateKind.FULLSCREEN_RESULT,
    config: { layout: 'fullscreen' },
    scene: { name: 'Main', layout: { type: 'fullscreen', widgets: [] } },
  },
  {
    key: 'match-intro',
    name: 'Match Intro',
    description: 'Intro slate with tournament + match info',
    kind: ObsTemplateKind.MATCH_INTRO,
    config: { layout: 'intro' },
    scene: { name: 'Intro', layout: { type: 'slate', widgets: [] } },
  },
];
