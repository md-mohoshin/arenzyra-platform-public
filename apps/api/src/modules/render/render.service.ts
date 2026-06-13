import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { MatchStatus, Prisma, Role } from '@prisma/client';
import { readFile } from 'fs/promises';
import { join } from 'path';
import puppeteer from 'puppeteer';
import type { AuthUser } from '../../common/auth/auth.types';
import { effectiveOrganizationId } from '../../common/org/org.util';
import { compareRankingRows } from '../../common/ranking-tiebreakers.util';
import { isPresentInMatch } from '../../common/results-presence.util';
import { PrismaService } from '../../db/prisma.service';
import { OrganizationBrandingService } from '../organization-branding/organization-branding.service';
import { ResultsService } from '../results/results.service';
import { SessionsStandingsService } from '../sessions/sessions-standings.service';
import {
  resolvePlayerPhotoUrl,
  resolveTeamLogoUrl,
} from '../widgets/widgets.snapshot';

const DEFAULT_RENDER_BACKGROUND = '#0b0f14';
const DEFAULT_RENDER_PRIMARY = '#00e5ff';
const DEFAULT_RENDER_TEXT = '#f5f7fb';
const DEFAULT_RENDER_MUTED = '#94a3b8';
const DEFAULT_RENDER_PANEL = 'rgba(11, 15, 20, 0.74)';
const DEFAULT_RENDER_BORDER = 'rgba(255, 255, 255, 0.12)';
const DEFAULT_RENDER_SHADOW = '0 24px 64px rgba(0, 0, 0, 0.45)';
const MATCH_VIEWPORT = { width: 1200, height: 630, deviceScaleFactor: 2 };
const STANDINGS_LIMIT = 10;
const DISCORD_RANKING_LIMIT = 25;
const DISCORD_PLAYER_LIMIT = 5;
const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DISCORD_CDN_BASE_URL = 'https://cdn.discordapp.com';
const DISCORD_SERVER_ICON_SIZE = 128;
const DISCORD_GUILD_ICON_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_DISCORD_WIDGET_OVERLAY = 0.58;
const DEFAULT_DISCORD_WIDGET_SAFE_PADDING = 32;
const DEFAULT_DISCORD_WIDGET_FONT_FAMILY = 'system';
const DISCORD_WIDGET_FONT_STACKS: Record<string, string> = {
  system: '"Segoe UI", Arial, "Liberation Sans", sans-serif',
  inter: 'Inter, "Noto Sans", Arial, sans-serif',
  roboto: 'Roboto, Arial, "Liberation Sans", sans-serif',
  'open-sans': '"Open Sans", Arial, "Liberation Sans", sans-serif',
  'noto-sans': '"Noto Sans", Arial, "Liberation Sans", sans-serif',
  'liberation-sans': '"Liberation Sans", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", "Liberation Serif", serif',
  mono: '"Fira Code", "Courier New", "Liberation Mono", monospace',
};
const RANKING_TABLE_CELL_GAP = 8;
const RANKING_TABLE_HORIZONTAL_PADDING = 28;
const RANKING_TABLE_FOOTER_RESERVE = 24;
const RANKING_TABLE_MIN_HEADER_HEIGHT = 22;
const RANKING_TABLE_MIN_ROW_HEIGHT = 18;
const RANKING_TABLE_MIN_ROW_GAP = 1;
const CUSTOM_ROWS_BOTTOM_PADDING = 8;
const CUSTOM_ROWS_MIN_ROW_HEIGHT = 18;
const CUSTOM_ROWS_MIN_ROW_GAP = 1;
const CUSTOM_ROWS_MAX_GROUPS = 4;
const DEFAULT_TEAM_LOGO_PATH = '/assets/defaults/default-team.png';
const DEFAULT_PLAYER_PHOTO_PATH = '/assets/defaults/default-player.png';
const DEFAULT_DISCORD_RESULT_CARD_TEXT = {
  discordMatchResultEyebrow: 'Arenzyra Results',
  discordMatchResultTitle: '{matchName}',
  discordMatchResultSubtitle: '',
  discordOverallRankingEyebrow: 'Overall Ranking',
  discordOverallRankingTitle: '{sessionOrMatchName}',
  discordOverallRankingSubtitle: '{overallRankingSubtitle}',
  discordTopMvpEyebrow: 'Top MVP',
  discordTopMvpTitle: '{matchName}',
  discordTopMvpSubtitle: 'Player impact leader',
  discordTopFraggersEyebrow: 'Top Fraggers',
  discordTopFraggersTitle: '{matchName}',
  discordTopFraggersSubtitle: 'Player elimination leaders',
  discordMatchScheduleEyebrow: "Today's",
  discordMatchScheduleTitle: 'Match Schedule',
  discordMatchScheduleSubtitle: '{matchScheduleScope}',
} as const;

export const DISCORD_MATCH_RENDER_KINDS = [
  'match-result',
  'overall-ranking',
  'top-mvp',
  'top-fraggers',
  'overall-top-mvp',
  'overall-top-fraggers',
  'match-schedule',
] as const;
const DISCORD_OVERLAY_WIDGET_TARGETS = [
  'all',
  ...DISCORD_MATCH_RENDER_KINDS,
] as const;
const DISCORD_CUSTOM_TEXT_FIELDS = [
  'eyebrow',
  'title',
  'subtitle',
  'footer',
  'custom',
] as const;
const DISCORD_CUSTOM_ROW_FIELDS = [
  'rank',
  'logo',
  'teamLogo',
  'team',
  'subtitle',
  'metric',
  'kills',
  'placementPoints',
  'totalPoints',
  'wwcd',
] as const;
const DISCORD_CUSTOM_MEDIA_SOURCES = ['rows', 'players'] as const;
const DISCORD_CUSTOM_IMAGE_SOURCES = [
  'url',
  'row-logo',
  'team-logo',
  'dynamic-code',
] as const;
const DISCORD_CUSTOM_TEXT_TRANSFORMS = [
  'none',
  'uppercase',
  'lowercase',
  'capitalize',
] as const;
const DISCORD_RANKING_TABLE_KINDS = [
  'match-result',
  'overall-ranking',
] as const;
const MATCH_SCHEDULE_SCENE_BASE = '/assets/match-schedule-scenes';
const MATCH_SCHEDULE_SCENES_BY_MAP: Record<string, string[]> = {
  deston: [`${MATCH_SCHEDULE_SCENE_BASE}/deston.png`],
  erangel: [
    `${MATCH_SCHEDULE_SCENE_BASE}/erangel-1.png`,
    `${MATCH_SCHEDULE_SCENE_BASE}/erangel-3.png`,
    `${MATCH_SCHEDULE_SCENE_BASE}/erangel-4.png`,
  ],
  haven: [`${MATCH_SCHEDULE_SCENE_BASE}/haven.png`],
  karakin: [`${MATCH_SCHEDULE_SCENE_BASE}/karakin.png`],
  livik: [`${MATCH_SCHEDULE_SCENE_BASE}/livik.png`],
  miramar: [
    `${MATCH_SCHEDULE_SCENE_BASE}/miramar-1.png`,
    `${MATCH_SCHEDULE_SCENE_BASE}/miramar-2.png`,
    `${MATCH_SCHEDULE_SCENE_BASE}/miramar-3.png`,
    `${MATCH_SCHEDULE_SCENE_BASE}/miramar-4.png`,
  ],
  nusa: [`${MATCH_SCHEDULE_SCENE_BASE}/nusa.png`],
  rondo: [
    `${MATCH_SCHEDULE_SCENE_BASE}/rondo-1.webp`,
    `${MATCH_SCHEDULE_SCENE_BASE}/rondo-2.webp`,
    `${MATCH_SCHEDULE_SCENE_BASE}/rondo-3.webp`,
    `${MATCH_SCHEDULE_SCENE_BASE}/rondo-4.webp`,
    `${MATCH_SCHEDULE_SCENE_BASE}/rondo-5.webp`,
    `${MATCH_SCHEDULE_SCENE_BASE}/rondo-6.webp`,
    `${MATCH_SCHEDULE_SCENE_BASE}/rondo-7.webp`,
    `${MATCH_SCHEDULE_SCENE_BASE}/rondo-8.webp`,
    `${MATCH_SCHEDULE_SCENE_BASE}/rondo-9.webp`,
    `${MATCH_SCHEDULE_SCENE_BASE}/rondo-10.webp`,
    `${MATCH_SCHEDULE_SCENE_BASE}/rondo-11.webp`,
    `${MATCH_SCHEDULE_SCENE_BASE}/rondo-12.webp`,
    `${MATCH_SCHEDULE_SCENE_BASE}/rondo-13.webp`,
    `${MATCH_SCHEDULE_SCENE_BASE}/rondo-14.webp`,
    `${MATCH_SCHEDULE_SCENE_BASE}/rondo-15.webp`,
  ],
  sanhok: [
    `${MATCH_SCHEDULE_SCENE_BASE}/sanhok-1.png`,
    `${MATCH_SCHEDULE_SCENE_BASE}/sanhok-2.png`,
    `${MATCH_SCHEDULE_SCENE_BASE}/sanhok-3.png`,
    `${MATCH_SCHEDULE_SCENE_BASE}/sanhok-4.png`,
  ],
  taego: [`${MATCH_SCHEDULE_SCENE_BASE}/taego.png`],
  vikendi: [
    `${MATCH_SCHEDULE_SCENE_BASE}/vikendi-1.png`,
    `${MATCH_SCHEDULE_SCENE_BASE}/vikendi-2.png`,
    `${MATCH_SCHEDULE_SCENE_BASE}/vikendi-3.png`,
    `${MATCH_SCHEDULE_SCENE_BASE}/vikendi-4.png`,
  ],
};
const MATCH_SCHEDULE_RENDER_LIMIT = 24;
const MATCH_SCHEDULE_STATUSES: MatchStatus[] = [
  MatchStatus.DRAFT,
  MatchStatus.LIVE,
  MatchStatus.FINISH_PENDING,
  MatchStatus.FINISHED,
  MatchStatus.ENDED,
];

export type DiscordMatchRenderKind =
  (typeof DISCORD_MATCH_RENDER_KINDS)[number];

type MatchTemplateInput = {
  matchName: string;
  eyebrow?: string;
  subtitle?: string;
  teams: Array<{
    position: number;
    placement?: number | null;
    team: string;
    logoUrl: string | null;
    kills: number;
    placementPoints: number;
    totalPoints: number;
  }>;
  branding: TemplateBranding;
  footer?: string;
  overlayLayersHtml?: string;
};

type StandingsTemplateInput = {
  sessionName: string;
  teams: Array<{
    rank: number;
    tag: string;
    totalPoints: number;
  }>;
  branding: TemplateBranding;
  footer?: string;
};

type LeaderboardTemplateRow = {
  rank: string;
  title: string;
  subtitle: string;
  metric: string;
  detail?: string;
  hero?: boolean;
  logoUrl?: string | null;
  photoUrl?: string | null;
  teamLogoUrl?: string | null;
  wwcd?: number;
  kills?: number;
  placementPoints?: number;
  totalPoints?: number;
};

type LeaderboardTemplateInput = {
  eyebrow: string;
  title: string;
  subtitle: string;
  rows: LeaderboardTemplateRow[];
  branding: TemplateBranding;
  footer?: string;
  emptyText?: string;
  mode?: 'summary' | 'overall-ranking' | 'player-mvp' | 'player-ranking';
  overlayLayersHtml?: string;
};

type RankingTableRow = {
  rank: string;
  teamName: string;
  logoUrl?: string | null;
  wwcd: number;
  placementPoints: number;
  kills: number;
  totalPoints: number;
};

type RankingTableTemplateInput = {
  kind: DiscordRankingTableKind;
  eyebrow: string;
  title: string;
  subtitle: string;
  rows: RankingTableRow[];
  branding: TemplateBranding;
  footer?: string;
  emptyText?: string;
  overlayLayersHtml?: string;
  layout?: DiscordRankingTableLayout;
};

type MatchScheduleRenderRow = {
  matchId: string;
  matchLabel: string;
  matchNumber: number;
  map: string | null;
  status: string | null;
  winnerTeamId: string | null;
  winnerTeamName: string | null;
  winnerTeamTag: string | null;
  winnerTeamLogoUrl: string | null;
  winnerKills: number;
  winnerTotalPoints: number;
};

type MatchScheduleRenderData = {
  scopeLabel: string;
  tournamentLabel: string | null;
  anchorMatchLabel: string;
  rows: MatchScheduleRenderRow[];
  footer: string;
};

type MatchScheduleTemplateInput = {
  eyebrow: string;
  title: string;
  subtitle: string;
  data: MatchScheduleRenderData;
  branding: TemplateBranding;
  overlayLayersHtml?: string;
};

type DiscordRankingTableKind = (typeof DISCORD_RANKING_TABLE_KINDS)[number];
type DiscordRankingTableField =
  | 'rank'
  | 'team'
  | 'wwcd'
  | 'placementPoints'
  | 'kills'
  | 'totalPoints';

type DiscordRankingTableColumn = {
  id: string;
  field: DiscordRankingTableField;
  label: string;
  width: number;
  align: 'left' | 'center' | 'right';
  enabled: boolean;
};

type DiscordRankingTableLayout = {
  tableX: number;
  tableY: number;
  tableWidth: number;
  tableHeight: number;
  titleHeight: number;
  titleSize: number;
  groupColumns: number;
  groupGap: number;
  maxRows: number;
  rowHeight: number;
  rowGap: number;
  rowRadius: number;
  headerHeight: number;
  headerFontSize: number;
  logoSize: number;
  teamFontSize: number;
  metricFontSize: number;
  columns: DiscordRankingTableColumn[];
};

type DiscordRankingTableLayouts = Partial<
  Record<DiscordRankingTableKind, DiscordRankingTableLayout>
>;

type DiscordWidgetOverlayTarget =
  (typeof DISCORD_OVERLAY_WIDGET_TARGETS)[number];

type DiscordWidgetOverlayLayer = {
  id: string;
  url: string;
  targets: DiscordWidgetOverlayTarget[];
  x: number;
  y: number;
  width: number;
  opacity: number;
  zIndex: number;
  enabled: boolean;
};

type DiscordWidgetCustomTextField = (typeof DISCORD_CUSTOM_TEXT_FIELDS)[number];

type DiscordWidgetCustomRowField =
  | 'rank'
  | 'logo'
  | 'teamLogo'
  | 'team'
  | 'subtitle'
  | 'metric'
  | 'kills'
  | 'placementPoints'
  | 'totalPoints'
  | 'wwcd';
type DiscordWidgetCustomMediaSource =
  (typeof DISCORD_CUSTOM_MEDIA_SOURCES)[number];
type DiscordWidgetCustomImageSource =
  (typeof DISCORD_CUSTOM_IMAGE_SOURCES)[number];
type DiscordWidgetCustomTextTransform =
  (typeof DISCORD_CUSTOM_TEXT_TRANSFORMS)[number];
type DiscordWidgetCustomRowsRankDisplayMode = 'global' | 'restart';
type DiscordWidgetCustomRowsCardDirection = 'auto' | 'horizontal' | 'vertical';
type DiscordWidgetCustomCardShape =
  | 'rounded'
  | 'angled'
  | 'cut-left'
  | 'cut-right';

type DiscordWidgetTextStyle = {
  id: string;
  name: string;
  fontSize: number;
  fontWeight: number;
  color: string | null;
  textTransform: DiscordWidgetCustomTextTransform;
  letterSpacing: number;
  shadowColor: string | null;
  shadowBlur: number;
  shadowX: number;
  shadowY: number;
};

type DiscordWidgetRowStyle = {
  id: string;
  name: string;
  backgroundColor: string | null;
  alternateBackgroundColor: string | null;
  rankOneBackgroundColor: string | null;
  rankTwoBackgroundColor: string | null;
  rankThreeBackgroundColor: string | null;
  borderColor: string | null;
  borderWidth: number;
  radius: number;
  paddingX: number;
  paddingY: number;
  opacity: number;
  shadowColor: string | null;
  shadowBlur: number;
  shadowY: number;
};

type DiscordWidgetCardStyle = {
  id: string;
  name: string;
  layout: 'horizontal' | 'vertical' | 'compact';
  shape: DiscordWidgetCustomCardShape;
  backgroundColor: string | null;
  borderColor: string | null;
  borderWidth: number;
  radius: number;
  paddingX: number;
  paddingY: number;
  opacity: number;
  shadowColor: string | null;
  shadowBlur: number;
  shadowY: number;
  logoBackgroundColor: string | null;
  logoRadius: number;
  statBackgroundColor: string | null;
  statColor: string | null;
};

type DiscordWidgetBackgroundStyle = {
  id: string;
  name: string;
  backgroundColor: string | null;
  gradientFrom: string | null;
  gradientTo: string | null;
  overlayColor: string | null;
  overlayOpacity: number;
};

type DiscordWidgetStyleLibrary = {
  version: 1;
  selectedTextStyleId: string;
  selectedRowStyleId: string;
  selectedCardStyleId: string;
  selectedBackgroundStyleId: string;
  textStyles: DiscordWidgetTextStyle[];
  rowStyles: DiscordWidgetRowStyle[];
  cardStyles: DiscordWidgetCardStyle[];
  backgroundStyles: DiscordWidgetBackgroundStyle[];
};

type DiscordWidgetCustomColumn = {
  id: string;
  field: DiscordWidgetCustomRowField;
  label: string;
  width: number;
  align: 'left' | 'center' | 'right';
  fontSize: number;
  fontWeight: number;
  color: string | null;
  backgroundColor: string | null;
  textTransform: DiscordWidgetCustomTextTransform;
  enabled: boolean;
};

type DiscordWidgetCustomRowsGroupOffset = {
  x: number;
  y: number;
};

type DiscordWidgetCustomTextElement = {
  id: string;
  type: 'text';
  field: DiscordWidgetCustomTextField;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontWeight: number;
  color: string | null;
  align: 'left' | 'center' | 'right';
  text: string;
  textTransform: DiscordWidgetCustomTextTransform;
  textStyleId: string;
  background: boolean;
  backgroundColor: string | null;
  zIndex: number;
  enabled: boolean;
};

type DiscordWidgetCustomImageElement = {
  id: string;
  type: 'image';
  source: DiscordWidgetCustomImageSource;
  url: string | null;
  dynamicCode: string;
  rowRank: number;
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  opacity: number;
  zIndex: number;
  enabled: boolean;
};

type DiscordWidgetCustomRowsElement = {
  id: string;
  type: 'rows';
  x: number;
  y: number;
  width: number;
  startRank: number;
  rankDisplayMode: DiscordWidgetCustomRowsRankDisplayMode;
  cardDirection: DiscordWidgetCustomRowsCardDirection;
  autoFitRows: boolean;
  rowHeight: number;
  rowGap: number;
  groupColumns: number;
  groupGap: number;
  maxRows: number;
  groupOffsets?: DiscordWidgetCustomRowsGroupOffset[];
  fontSize: number;
  headerFontSize: number;
  rowRadius: number;
  showHeader: boolean;
  rowStyleId: string;
  headerTextStyleId: string;
  bodyTextStyleId: string;
  cardStyleId: string;
  zIndex: number;
  enabled: boolean;
  columns: DiscordWidgetCustomColumn[];
};

type DiscordWidgetCustomFeaturedElement = {
  id: string;
  type: 'featured';
  x: number;
  y: number;
  width: number;
  teamCount: number;
  groupColumns: number;
  cardHeight: number;
  cardGap: number;
  logoSize: number;
  fontSize: number;
  rowRadius: number;
  showStats: boolean;
  cardStyleId: string;
  textStyleId: string;
  statTextStyleId: string;
  zIndex: number;
  enabled: boolean;
};

type DiscordWidgetCustomMediaElement = {
  id: string;
  type: 'media';
  source: DiscordWidgetCustomMediaSource;
  x: number;
  y: number;
  width: number;
  height: number;
  itemCount: number;
  cardGap: number;
  imageSize: number;
  fontSize: number;
  rowRadius: number;
  showStats: boolean;
  cardStyleId: string;
  textStyleId: string;
  statTextStyleId: string;
  zIndex: number;
  enabled: boolean;
};

type DiscordWidgetCustomElement =
  | DiscordWidgetCustomTextElement
  | DiscordWidgetCustomImageElement
  | DiscordWidgetCustomRowsElement
  | DiscordWidgetCustomFeaturedElement
  | DiscordWidgetCustomMediaElement;

type DiscordWidgetCustomLayout = {
  enabled: boolean;
  elements: DiscordWidgetCustomElement[];
};

type DiscordWidgetCustomLayouts = Partial<
  Record<DiscordMatchRenderKind, DiscordWidgetCustomLayout>
>;

type DiscordCustomWidgetRow = {
  rank: string;
  title: string;
  subtitle: string;
  metric: string;
  matchLabel?: string | null;
  map?: string | null;
  logoUrl?: string | null;
  teamLogoUrl?: string | null;
  kills?: number;
  placementPoints?: number;
  totalPoints?: number;
  wwcd?: number;
};

type DiscordCustomWidgetInput = {
  kind: DiscordMatchRenderKind;
  eyebrow: string;
  title: string;
  subtitle: string;
  rows: DiscordCustomWidgetRow[];
  branding: TemplateBranding;
  styleLibrary: DiscordWidgetStyleLibrary;
  footer: string;
  mediaRows?: DiscordCustomWidgetRow[];
  overlayLayersHtml?: string;
  layout: DiscordWidgetCustomLayout;
};

type RenderMatchMeta = {
  id: string;
  name: string | null;
  organizationId: string;
  tournamentId: string | null;
  stageId: string | null;
  groupId: string | null;
  sessionId: string | null;
  matchNumber: number | null;
  session: { id: string; name: string } | null;
};

type PlayerStatRow = {
  playerId: string;
  ign: string;
  teamName: string;
  teamTag: string | null;
  photoUrl: string | null;
  teamLogoUrl: string | null;
  kills: number;
  knocks: number;
  assists: number;
  placement: number | null;
  alive: boolean | null;
  score: number;
};

type TemplateBranding = {
  primaryColor: string;
  secondaryColor?: string;
  accent?: string;
  primarySurface?: string;
  background: string;
  backgroundSurface?: string;
  textPrimary: string;
  textMuted: string;
  panel: string;
  panelSurface?: string;
  border: string;
  shadow: string;
  logoUrl: string | null;
  defaultTeamLogoUrl: string | null;
  safeArea: DiscordWidgetSafeArea;
  fontFamily?: string;
  fontCssImport?: string;
};

type DiscordGuildDetails = {
  id?: string | null;
  icon?: string | null;
};

type CurrentMatchTeam = {
  teamId: string;
  slotNumber: number | null;
  tag: string | null;
  name: string | null;
  logoUrl: string | null;
};

type TemplateLayout = {
  boardColumns: string;
  boardGap: string;
  rowMinHeight: string;
  rowPadding: string;
  rowRadius: string;
  rowRankSize: string;
  rowTitleSize: string;
  rowMetaSize: string;
  rowMetricSize: string;
  headerMargin: string;
  titleSize: string;
};

type RankingTableLayout = {
  groupColumns: number;
  rowHeight: number;
  rowGap: number;
  groupGap: number;
  headerHeight: number;
  headerFontSize: number;
  titleSize: number;
  headingHeight: number;
  shellGap: number;
  logoSize: number;
  teamFontSize: number;
  metricFontSize: number;
  rowRadius: number;
};

function hasAppliedResultRow(row: {
  placement?: number | null;
  totalKills?: number | null;
  totalPoints?: number | null;
  points?: number | null;
  placementPoints?: number | null;
}): boolean {
  return (
    (row.placement !== null && row.placement !== undefined) ||
    Math.max(0, row.totalKills ?? 0) > 0 ||
    Math.max(0, row.totalPoints ?? row.points ?? 0) > 0 ||
    Math.max(0, row.placementPoints ?? 0) > 0
  );
}

type DiscordWidgetTemplateSettings = {
  enabled: boolean;
  guildId: string | null;
  backgroundUrl: string | null;
  primaryColor: string | null;
  textColor: string | null;
  mutedColor: string | null;
  rowColor: string | null;
  panelOpacity: number;
  fontFamily: string;
  fontCssImport: string;
  overlayStrength: number;
  safeArea: DiscordWidgetSafeArea;
  texts: Record<keyof typeof DEFAULT_DISCORD_RESULT_CARD_TEXT, string>;
  overlayLayers: DiscordWidgetOverlayLayer[];
  styleLibrary: DiscordWidgetStyleLibrary;
  customLayouts: DiscordWidgetCustomLayouts;
  rankingTables: DiscordRankingTableLayouts;
  studio: DiscordStudioRendererSettings | null;
  matchSchedule: DiscordResultMatchScheduleEntry[];
};

type DiscordResultMatchScheduleEntry = {
  matchNumber: number;
  label: string | null;
  map: string | null;
  enabled: boolean;
};

type DiscordWidgetSafeArea = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

type DiscordStudioRendererSettings = {
  enabled: boolean;
  design: StudioDesign;
  pageId: string | null;
};

type StudioDesign = {
  schemaVersion: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  pages: StudioPage[];
  activePageId: string;
  dataFields?: StudioDataField[];
  dataMappings?: StudioDataMappingProfile[];
  activeDataMappingId?: string;
};

type StudioPage = {
  id: string;
  name: string;
  background: {
    transparent: boolean;
    color: string;
  };
  elements: StudioElement[];
};

type StudioDataField = {
  id: string;
  key: string;
  label?: string;
  type?: string;
  sampleValue?: string;
  aliases?: string[];
};

type StudioDataMappingProfile = {
  id: string;
  source?: string;
  mappings?: Array<{
    sourceKey?: string;
    targetKey?: string;
    fallbackValue?: string;
    enabled?: boolean;
  }>;
};

type StudioElementBinding = {
  fieldId: string;
  key: string;
  role: 'text' | 'image' | 'fill' | 'stroke';
};

type StudioElementBase = {
  id: string;
  kind: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  visible?: boolean;
  shadow?: {
    enabled?: boolean;
    color?: string;
    opacity?: number;
    blur?: number;
    offsetX?: number;
    offsetY?: number;
  };
  dataBinding?: StudioElementBinding;
};

type StudioElement = StudioElementBase &
  Record<string, unknown> & {
    kind: 'text' | 'rect' | 'ellipse' | 'line' | 'image' | 'shape';
  };

type StudioRenderInput = {
  kind: DiscordMatchRenderKind;
  template: DiscordWidgetTemplateSettings | null;
  branding: TemplateBranding;
  header: { eyebrow: string; title: string; subtitle: string };
  textValues: {
    matchName: string;
    sessionName: string | null;
    sessionOrMatchName: string;
    overallRankingSubtitle: string;
    matchScheduleScope?: string;
    matchScheduleCount?: string;
  };
  rows: DiscordCustomWidgetRow[];
  footer: string;
};

@Injectable()
export class RenderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly results: ResultsService,
    private readonly sessionStandings: SessionsStandingsService,
    private readonly organizationBranding: OrganizationBrandingService,
  ) {}

  private readonly discordGuildIconCache = new Map<
    string,
    { url: string | null; expiresAt: number }
  >();

  private discordBotToken(): string | null {
    return (
      process.env.DISCORD_BOT_TOKEN?.trim() ||
      process.env.DISCORD_TOKEN?.trim() ||
      null
    );
  }

  private discordGuildIconUrl(guild: DiscordGuildDetails): string | null {
    const guildId = this.stringValue(guild.id);
    const iconHash = this.stringValue(guild.icon);
    if (!guildId || !iconHash) return null;
    return `${DISCORD_CDN_BASE_URL}/icons/${guildId}/${iconHash}.png?size=${DISCORD_SERVER_ICON_SIZE}`;
  }

  private async fetchDiscordGuildIconUrl(
    guildId: string | null | undefined,
  ): Promise<string | null> {
    const cleanGuildId = this.stringValue(guildId);
    if (!cleanGuildId) return null;
    const cached = this.discordGuildIconCache.get(cleanGuildId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.url;
    }

    const token = this.discordBotToken();
    if (!token) {
      return null;
    }

    try {
      const response = await fetch(
        `${DISCORD_API_BASE_URL}/guilds/${encodeURIComponent(cleanGuildId)}`,
        { headers: { Authorization: `Bot ${token}` } },
      );
      if (!response.ok) {
        return null;
      }
      const guild = (await response.json()) as DiscordGuildDetails;
      const iconUrl = this.discordGuildIconUrl(guild);
      this.discordGuildIconCache.set(cleanGuildId, {
        url: iconUrl,
        expiresAt: Date.now() + DISCORD_GUILD_ICON_CACHE_TTL_MS,
      });
      return iconUrl;
    } catch {
      return null;
    }
  }

  private async withDiscordDefaultTeamLogo(
    branding: TemplateBranding,
    template: DiscordWidgetTemplateSettings,
  ): Promise<TemplateBranding> {
    if (this.normalizeAssetUrl(branding.defaultTeamLogoUrl)) return branding;
    const defaultTeamLogoUrl = await this.fetchDiscordGuildIconUrl(
      template.guildId,
    );
    return defaultTeamLogoUrl ? { ...branding, defaultTeamLogoUrl } : branding;
  }

  private templatePath(fileName: string) {
    return [
      join(__dirname, 'templates', fileName),
      join(process.cwd(), 'dist', 'modules', 'render', 'templates', fileName),
      join(process.cwd(), 'src', 'modules', 'render', 'templates', fileName),
    ];
  }

  private async loadTemplate(fileName: string): Promise<string> {
    let lastError: unknown = null;
    for (const candidate of this.templatePath(fileName)) {
      try {
        return await readFile(candidate, 'utf8');
      } catch (error) {
        lastError = error;
      }
    }
    throw new InternalServerErrorException(
      `Failed to load render template "${fileName}": ${String(lastError)}`,
    );
  }

  private escapeHtml(value: string | number | null | undefined): string {
    return `${value ?? ''}`
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private renderTemplate(
    template: string,
    variables: Record<string, string>,
  ): string {
    let html = template;
    for (const [key, value] of Object.entries(variables)) {
      html = html.replaceAll(`{{${key}}}`, value);
    }
    return html;
  }

  private discordWidgetCustomFontFamilyName(value: unknown): string | null {
    const name = this.stringValue(value)?.trim().replace(/["\\]/g, '');
    return name && name.length <= 80 ? name : null;
  }

  private discordWidgetFontFamily(
    value: unknown,
    customName?: unknown,
  ): string {
    const key =
      this.stringValue(value)?.trim() || DEFAULT_DISCORD_WIDGET_FONT_FAMILY;
    if (key === 'custom') {
      const name = this.discordWidgetCustomFontFamilyName(customName);
      if (name) return `"${name}", "Segoe UI", Arial, sans-serif`;
    }
    return (
      DISCORD_WIDGET_FONT_STACKS[key] ??
      DISCORD_WIDGET_FONT_STACKS[DEFAULT_DISCORD_WIDGET_FONT_FAMILY]
    );
  }

  private brandingFontFamily(branding: TemplateBranding): string {
    return (
      branding.fontFamily ??
      DISCORD_WIDGET_FONT_STACKS[DEFAULT_DISCORD_WIDGET_FONT_FAMILY]
    );
  }

  private brandingFontCssImport(branding: TemplateBranding): string {
    return branding.fontCssImport ?? '';
  }

  private async resolveBranding(params: {
    actor: AuthUser;
    organizationId?: string | null;
    sessionId?: string | null;
    matchId?: string | null;
  }): Promise<TemplateBranding> {
    const branding = await this.organizationBranding.getEffectiveBranding({
      actor: params.actor,
      organizationId: params.organizationId ?? null,
      sessionId: params.sessionId ?? null,
      matchId: params.matchId ?? null,
    });

    const primaryColor = branding.primaryColor || DEFAULT_RENDER_PRIMARY;
    const secondaryColor =
      branding.secondaryColor || branding.accent || primaryColor;
    const background =
      branding.backgroundCss ||
      branding.backgroundSolid ||
      DEFAULT_RENDER_BACKGROUND;
    const panel = branding.panel || DEFAULT_RENDER_PANEL;

    return {
      primaryColor,
      secondaryColor,
      accent: branding.accent || secondaryColor,
      primarySurface: this.primarySurface(primaryColor, secondaryColor),
      background,
      backgroundSurface: background,
      textPrimary: branding.textPrimary || DEFAULT_RENDER_TEXT,
      textMuted: branding.textMuted || DEFAULT_RENDER_MUTED,
      panel,
      panelSurface: this.panelSurface(panel, primaryColor),
      border: branding.border || DEFAULT_RENDER_BORDER,
      shadow: branding.shadow || DEFAULT_RENDER_SHADOW,
      logoUrl: null,
      defaultTeamLogoUrl: this.normalizeAssetUrl(branding.defaultTeamLogoUrl),
      safeArea: this.defaultDiscordWidgetSafeArea(),
      fontFamily:
        DISCORD_WIDGET_FONT_STACKS[DEFAULT_DISCORD_WIDGET_FONT_FAMILY],
    };
  }

  private primarySurface(primaryColor: string, secondaryColor?: string | null) {
    const primary = primaryColor || DEFAULT_RENDER_PRIMARY;
    const secondary = secondaryColor || primary;
    if (/gradient\(/i.test(primary)) return primary;
    if (primary.toLowerCase() === secondary.toLowerCase()) return primary;
    return `linear-gradient(90deg, ${primary} 0%, ${secondary} 100%)`;
  }

  private panelSurface(panel: string, primaryColor: string) {
    const base = panel || DEFAULT_RENDER_PANEL;
    if (/gradient\(/i.test(base)) return base;
    return `linear-gradient(135deg, ${base} 0%, ${base} 58%, ${
      primaryColor || DEFAULT_RENDER_PRIMARY
    } 220%)`;
  }

  private clampNumber(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  ) {
    const parsed =
      typeof value === 'number'
        ? value
        : Number.parseFloat(this.primitiveString(value).trim());
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  private primitiveString(value: unknown): string {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return String(value);
    }
    return '';
  }

  private stringValue(value: unknown): string | null {
    const trimmed = this.primitiveString(value).trim();
    return trimmed ? trimmed : null;
  }

  private hexColorValue(value: unknown): string | null {
    const color = this.primitiveString(value).trim();
    const match = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color);
    if (!match) return null;
    const raw = match[1];
    if (raw.length === 3) {
      return `#${raw
        .split('')
        .map((part) => `${part}${part}`)
        .join('')
        .toLowerCase()}`;
    }
    return `#${raw.slice(0, 6).toLowerCase()}`;
  }

  private rgbaFromHexColor(color: string, alpha: number): string | null {
    const normalized = this.hexColorValue(color);
    if (!normalized) return null;
    const value = normalized.slice(1);
    const red = Number.parseInt(value.slice(0, 2), 16);
    const green = Number.parseInt(value.slice(2, 4), 16);
    const blue = Number.parseInt(value.slice(4, 6), 16);
    if (![red, green, blue].every(Number.isFinite)) return null;
    return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(2)})`;
  }

  private defaultDiscordResultCardText(): Record<
    keyof typeof DEFAULT_DISCORD_RESULT_CARD_TEXT,
    string
  > {
    return { ...DEFAULT_DISCORD_RESULT_CARD_TEXT };
  }

  private resolveDiscordResultCardText(
    emojis: Record<string, unknown>,
  ): Record<keyof typeof DEFAULT_DISCORD_RESULT_CARD_TEXT, string> {
    const texts = this.defaultDiscordResultCardText();
    for (const key of Object.keys(texts) as Array<keyof typeof texts>) {
      if (Object.prototype.hasOwnProperty.call(emojis, key)) {
        texts[key] = this.primitiveString(emojis[key]).trim();
      }
    }
    return texts;
  }

  private renderDiscordTextTemplate(
    template: string,
    values: Record<string, string | null | undefined>,
  ): string {
    return template
      .replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => {
        const value = values[key];
        return value === null || value === undefined ? '' : String(value);
      })
      .replace(/\s+/g, ' ')
      .trim();
  }

  private resolveDiscordHeaderText(
    texts: Record<keyof typeof DEFAULT_DISCORD_RESULT_CARD_TEXT, string>,
    prefix:
      | 'discordMatchResult'
      | 'discordOverallRanking'
      | 'discordTopMvp'
      | 'discordTopFraggers'
      | 'discordMatchSchedule',
    values: Record<string, string | null | undefined>,
    fallback: { eyebrow: string; title: string; subtitle: string },
  ) {
    const eyebrowKey =
      `${prefix}Eyebrow` as keyof typeof DEFAULT_DISCORD_RESULT_CARD_TEXT;
    const titleKey =
      `${prefix}Title` as keyof typeof DEFAULT_DISCORD_RESULT_CARD_TEXT;
    const subtitleKey =
      `${prefix}Subtitle` as keyof typeof DEFAULT_DISCORD_RESULT_CARD_TEXT;
    return {
      eyebrow: Object.prototype.hasOwnProperty.call(texts, eyebrowKey)
        ? this.renderDiscordTextTemplate(texts[eyebrowKey], values)
        : fallback.eyebrow,
      title: Object.prototype.hasOwnProperty.call(texts, titleKey)
        ? this.renderDiscordTextTemplate(texts[titleKey], values)
        : fallback.title,
      subtitle: Object.prototype.hasOwnProperty.call(texts, subtitleKey)
        ? this.renderDiscordTextTemplate(texts[subtitleKey], values)
        : fallback.subtitle,
    };
  }

  private parseDiscordResultMatchSchedule(
    value: unknown,
  ): DiscordResultMatchScheduleEntry[] {
    let source: unknown = value;
    if (typeof value === 'string') {
      const text = value.trim();
      if (!text) return [];
      try {
        source = JSON.parse(text) as unknown;
      } catch {
        return [];
      }
    }

    const entries = Array.isArray(source)
      ? source
      : source && typeof source === 'object' && !Array.isArray(source)
        ? Array.isArray((source as Record<string, unknown>).matches)
          ? ((source as Record<string, unknown>).matches as unknown[])
          : []
        : [];

    const seen = new Set<number>();
    return entries
      .slice(0, 64)
      .map((entry, index): DiscordResultMatchScheduleEntry | null => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return null;
        }
        const record = entry as Record<string, unknown>;
        const rawMatchNumber =
          record.matchNumber ?? record.number ?? record.match ?? index + 1;
        const matchNumber = Math.round(
          this.clampNumber(rawMatchNumber, index + 1, 1, 64),
        );
        if (seen.has(matchNumber)) return null;
        seen.add(matchNumber);
        return {
          matchNumber,
          label:
            this.stringValue(record.label) ??
            this.stringValue(record.title) ??
            this.stringValue(record.name),
          map: this.stringValue(record.map),
          enabled: record.enabled !== false && record.enabled !== 'false',
        };
      })
      .filter(
        (entry): entry is DiscordResultMatchScheduleEntry =>
          entry !== null && entry.enabled,
      )
      .sort((left, right) => left.matchNumber - right.matchNumber);
  }

  private parseDiscordWidgetOverlayLayers(
    value: unknown,
  ): DiscordWidgetOverlayLayer[] {
    let source: unknown = value;
    if (typeof value === 'string') {
      const text = value.trim();
      if (!text) return [];
      try {
        source = JSON.parse(text) as unknown;
      } catch {
        return [];
      }
    }

    if (!Array.isArray(source)) return [];

    return source
      .slice(0, 20)
      .map((entry, index): DiscordWidgetOverlayLayer | null => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return null;
        }
        const record = entry as Record<string, unknown>;
        const url = this.normalizeAssetUrl(record.url);
        if (!url) return null;

        const rawTargets = Array.isArray(record.targets)
          ? record.targets
          : [record.target ?? 'all'];
        const targets = rawTargets
          .map((target) => String(target ?? '').trim())
          .filter((target): target is DiscordWidgetOverlayTarget =>
            DISCORD_OVERLAY_WIDGET_TARGETS.includes(
              target as DiscordWidgetOverlayTarget,
            ),
          );

        return {
          id: this.stringValue(record.id) ?? `overlay-${index + 1}`,
          url,
          targets: targets.length ? targets : ['all'],
          x: Math.round(this.clampNumber(record.x, 32, -200, 1200)),
          y: Math.round(this.clampNumber(record.y, 32, -200, 630)),
          width: Math.round(this.clampNumber(record.width, 120, 8, 1200)),
          opacity: this.clampNumber(record.opacity, 1, 0, 1),
          zIndex: Math.round(this.clampNumber(record.zIndex, 20, 0, 40)),
          enabled: record.enabled !== false && record.enabled !== 'false',
        };
      })
      .filter((layer): layer is DiscordWidgetOverlayLayer => Boolean(layer));
  }

  private safeWidgetStyleId(value: unknown, fallback: string) {
    const raw = this.stringValue(value)?.trim() ?? '';
    return raw.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64) || fallback;
  }

  private defaultDiscordWidgetStyleLibrary(
    fallbacks: {
      primaryColor?: string | null;
      textColor?: string | null;
      mutedColor?: string | null;
      rowColor?: string | null;
    } = {},
  ): DiscordWidgetStyleLibrary {
    const primary = this.safeColor(fallbacks.primaryColor) ?? '#00e5ff';
    const text = this.safeColor(fallbacks.textColor) ?? '#ffffff';
    const muted = this.safeColor(fallbacks.mutedColor) ?? '#cbd5e1';
    const row = this.safeColor(fallbacks.rowColor) ?? '#172033';
    return {
      version: 1,
      selectedTextStyleId: 'text-body',
      selectedRowStyleId: 'row-default',
      selectedCardStyleId: 'card-default',
      selectedBackgroundStyleId: 'background-default',
      textStyles: [
        {
          id: 'text-header',
          name: 'Header',
          fontSize: 38,
          fontWeight: 900,
          color: text,
          textTransform: 'uppercase',
          letterSpacing: 0,
          shadowColor: '#000000',
          shadowBlur: 0,
          shadowX: 0,
          shadowY: 0,
        },
        {
          id: 'text-body',
          name: 'Rows',
          fontSize: 12,
          fontWeight: 800,
          color: text,
          textTransform: 'uppercase',
          letterSpacing: 0,
          shadowColor: null,
          shadowBlur: 0,
          shadowX: 0,
          shadowY: 0,
        },
        {
          id: 'text-muted',
          name: 'Muted',
          fontSize: 10,
          fontWeight: 800,
          color: muted,
          textTransform: 'uppercase',
          letterSpacing: 0,
          shadowColor: null,
          shadowBlur: 0,
          shadowX: 0,
          shadowY: 0,
        },
        {
          id: 'text-accent',
          name: 'Accent',
          fontSize: 13,
          fontWeight: 900,
          color: primary,
          textTransform: 'uppercase',
          letterSpacing: 0,
          shadowColor: null,
          shadowBlur: 0,
          shadowX: 0,
          shadowY: 0,
        },
      ],
      rowStyles: [
        {
          id: 'row-default',
          name: 'Default Rows',
          backgroundColor: null,
          alternateBackgroundColor: null,
          rankOneBackgroundColor: null,
          rankTwoBackgroundColor: null,
          rankThreeBackgroundColor: null,
          borderColor: '#ffffff1a',
          borderWidth: 1,
          radius: 9,
          paddingX: 8,
          paddingY: 4,
          opacity: 1,
          shadowColor: '#000000',
          shadowBlur: 10,
          shadowY: 10,
        },
        {
          id: 'row-accent',
          name: 'Accent Rows',
          backgroundColor: null,
          alternateBackgroundColor: null,
          rankOneBackgroundColor: primary,
          rankTwoBackgroundColor: null,
          rankThreeBackgroundColor: null,
          borderColor: primary,
          borderWidth: 1,
          radius: 10,
          paddingX: 8,
          paddingY: 4,
          opacity: 1,
          shadowColor: '#000000',
          shadowBlur: 16,
          shadowY: 12,
        },
      ],
      cardStyles: [
        {
          id: 'card-default',
          name: 'Horizontal Card',
          layout: 'horizontal',
          shape: 'rounded',
          backgroundColor: null,
          borderColor: '#ffffff1a',
          borderWidth: 1,
          radius: 10,
          paddingX: 10,
          paddingY: 8,
          opacity: 1,
          shadowColor: '#000000',
          shadowBlur: 18,
          shadowY: 12,
          logoBackgroundColor: '#ffffff14',
          logoRadius: 10,
          statBackgroundColor: null,
          statColor: muted,
        },
        {
          id: 'card-vertical',
          name: 'Vertical Card',
          layout: 'vertical',
          shape: 'rounded',
          backgroundColor: null,
          borderColor: '#ffffff1a',
          borderWidth: 1,
          radius: 14,
          paddingX: 10,
          paddingY: 10,
          opacity: 1,
          shadowColor: '#000000',
          shadowBlur: 22,
          shadowY: 14,
          logoBackgroundColor: '#ffffff14',
          logoRadius: 12,
          statBackgroundColor: '#00000040',
          statColor: muted,
        },
        {
          id: 'card-angled',
          name: 'Angled Card',
          layout: 'horizontal',
          shape: 'angled',
          backgroundColor: null,
          borderColor: primary,
          borderWidth: 1,
          radius: 8,
          paddingX: 12,
          paddingY: 8,
          opacity: 1,
          shadowColor: '#000000',
          shadowBlur: 20,
          shadowY: 14,
          logoBackgroundColor: '#ffffff14',
          logoRadius: 8,
          statBackgroundColor: '#00000040',
          statColor: primary,
        },
      ],
      backgroundStyles: [
        {
          id: 'background-default',
          name: 'Brand Background',
          backgroundColor: '#050814',
          gradientFrom: null,
          gradientTo: null,
          overlayColor: '#000000',
          overlayOpacity: 0.1,
        },
        {
          id: 'background-accent',
          name: 'Accent Gradient',
          backgroundColor: '#050814',
          gradientFrom: primary,
          gradientTo: row,
          overlayColor: '#000000',
          overlayOpacity: 0.12,
        },
      ],
    };
  }

  private sanitizeDiscordWidgetTextStyle(
    value: unknown,
    fallback: DiscordWidgetTextStyle,
  ): DiscordWidgetTextStyle {
    const record = this.isRecord(value) ? value : {};
    return {
      id: this.safeWidgetStyleId(record.id, fallback.id),
      name: (this.stringValue(record.name) ?? fallback.name).slice(0, 48),
      fontSize: Math.round(
        this.clampNumber(record.fontSize, fallback.fontSize, 6, 96),
      ),
      fontWeight: Math.round(
        this.clampNumber(record.fontWeight, fallback.fontWeight, 100, 1000),
      ),
      color: this.safeColor(record.color) ?? fallback.color,
      textTransform: this.safeTextTransform(
        record.textTransform,
        fallback.textTransform,
      ),
      letterSpacing: this.clampNumber(
        record.letterSpacing,
        fallback.letterSpacing,
        -4,
        12,
      ),
      shadowColor: this.safeColor(record.shadowColor) ?? fallback.shadowColor,
      shadowBlur: Math.round(
        this.clampNumber(record.shadowBlur, fallback.shadowBlur, 0, 40),
      ),
      shadowX: Math.round(
        this.clampNumber(record.shadowX, fallback.shadowX, -30, 30),
      ),
      shadowY: Math.round(
        this.clampNumber(record.shadowY, fallback.shadowY, -30, 30),
      ),
    };
  }

  private sanitizeDiscordWidgetRowStyle(
    value: unknown,
    fallback: DiscordWidgetRowStyle,
  ): DiscordWidgetRowStyle {
    const record = this.isRecord(value) ? value : {};
    return {
      id: this.safeWidgetStyleId(record.id, fallback.id),
      name: (this.stringValue(record.name) ?? fallback.name).slice(0, 48),
      backgroundColor:
        this.safeColor(record.backgroundColor) ?? fallback.backgroundColor,
      alternateBackgroundColor: this.safeColor(record.alternateBackgroundColor),
      rankOneBackgroundColor: this.safeColor(record.rankOneBackgroundColor),
      rankTwoBackgroundColor: this.safeColor(record.rankTwoBackgroundColor),
      rankThreeBackgroundColor: this.safeColor(record.rankThreeBackgroundColor),
      borderColor: this.safeColor(record.borderColor) ?? fallback.borderColor,
      borderWidth: Math.round(
        this.clampNumber(record.borderWidth, fallback.borderWidth, 0, 8),
      ),
      radius: Math.round(
        this.clampNumber(record.radius, fallback.radius, 0, 40),
      ),
      paddingX: Math.round(
        this.clampNumber(record.paddingX, fallback.paddingX, 0, 32),
      ),
      paddingY: Math.round(
        this.clampNumber(record.paddingY, fallback.paddingY, 0, 24),
      ),
      opacity: this.clampNumber(record.opacity, fallback.opacity, 0, 1),
      shadowColor: this.safeColor(record.shadowColor) ?? fallback.shadowColor,
      shadowBlur: Math.round(
        this.clampNumber(record.shadowBlur, fallback.shadowBlur, 0, 50),
      ),
      shadowY: Math.round(
        this.clampNumber(record.shadowY, fallback.shadowY, -40, 40),
      ),
    };
  }

  private safeCardStyleLayout(
    value: unknown,
  ): DiscordWidgetCardStyle['layout'] {
    const layout = this.stringValue(value);
    return layout === 'vertical' || layout === 'compact'
      ? layout
      : 'horizontal';
  }

  private safeCardShape(value: unknown): DiscordWidgetCustomCardShape {
    const shape = this.stringValue(value);
    return shape === 'angled' || shape === 'cut-left' || shape === 'cut-right'
      ? shape
      : 'rounded';
  }

  private sanitizeDiscordWidgetCardStyle(
    value: unknown,
    fallback: DiscordWidgetCardStyle,
  ): DiscordWidgetCardStyle {
    const record = this.isRecord(value) ? value : {};
    return {
      id: this.safeWidgetStyleId(record.id, fallback.id),
      name: (this.stringValue(record.name) ?? fallback.name).slice(0, 48),
      layout: this.safeCardStyleLayout(record.layout ?? fallback.layout),
      shape: this.safeCardShape(record.shape ?? fallback.shape),
      backgroundColor:
        this.safeColor(record.backgroundColor) ?? fallback.backgroundColor,
      borderColor: this.safeColor(record.borderColor) ?? fallback.borderColor,
      borderWidth: Math.round(
        this.clampNumber(record.borderWidth, fallback.borderWidth, 0, 8),
      ),
      radius: Math.round(
        this.clampNumber(record.radius, fallback.radius, 0, 48),
      ),
      paddingX: Math.round(
        this.clampNumber(record.paddingX, fallback.paddingX, 0, 40),
      ),
      paddingY: Math.round(
        this.clampNumber(record.paddingY, fallback.paddingY, 0, 40),
      ),
      opacity: this.clampNumber(record.opacity, fallback.opacity, 0, 1),
      shadowColor: this.safeColor(record.shadowColor) ?? fallback.shadowColor,
      shadowBlur: Math.round(
        this.clampNumber(record.shadowBlur, fallback.shadowBlur, 0, 60),
      ),
      shadowY: Math.round(
        this.clampNumber(record.shadowY, fallback.shadowY, -50, 50),
      ),
      logoBackgroundColor:
        this.safeColor(record.logoBackgroundColor) ??
        fallback.logoBackgroundColor,
      logoRadius: Math.round(
        this.clampNumber(record.logoRadius, fallback.logoRadius, 0, 48),
      ),
      statBackgroundColor: this.safeColor(record.statBackgroundColor),
      statColor: this.safeColor(record.statColor) ?? fallback.statColor,
    };
  }

  private sanitizeDiscordWidgetBackgroundStyle(
    value: unknown,
    fallback: DiscordWidgetBackgroundStyle,
  ): DiscordWidgetBackgroundStyle {
    const record = this.isRecord(value) ? value : {};
    return {
      id: this.safeWidgetStyleId(record.id, fallback.id),
      name: (this.stringValue(record.name) ?? fallback.name).slice(0, 48),
      backgroundColor:
        this.safeColor(record.backgroundColor) ?? fallback.backgroundColor,
      gradientFrom: this.safeColor(record.gradientFrom),
      gradientTo: this.safeColor(record.gradientTo),
      overlayColor:
        this.safeColor(record.overlayColor) ?? fallback.overlayColor,
      overlayOpacity: this.clampNumber(
        record.overlayOpacity,
        fallback.overlayOpacity,
        0,
        1,
      ),
    };
  }

  private mergeDefaultDiscordWidgetStyles<T extends { id: string }>(
    defaults: T[],
    parsed: T[],
  ) {
    const seen = new Set(parsed.map((entry) => entry.id));
    return [...parsed, ...defaults.filter((entry) => !seen.has(entry.id))];
  }

  private parseDiscordWidgetStyleLibrary(
    value: unknown,
    fallbacks: {
      primaryColor?: string | null;
      textColor?: string | null;
      mutedColor?: string | null;
      rowColor?: string | null;
    } = {},
  ): DiscordWidgetStyleLibrary {
    const defaults = this.defaultDiscordWidgetStyleLibrary(fallbacks);
    let source: unknown = value;
    if (typeof value === 'string') {
      const text = value.trim();
      if (!text) return defaults;
      try {
        source = JSON.parse(text) as unknown;
      } catch {
        return defaults;
      }
    }
    if (!this.isRecord(source)) return defaults;

    const textStyles = Array.isArray(source.textStyles)
      ? source.textStyles
          .slice(0, 20)
          .map((entry, index) =>
            this.sanitizeDiscordWidgetTextStyle(
              entry,
              defaults.textStyles[index] ?? defaults.textStyles[1],
            ),
          )
      : [];
    const rowStyles = Array.isArray(source.rowStyles)
      ? source.rowStyles
          .slice(0, 20)
          .map((entry, index) =>
            this.sanitizeDiscordWidgetRowStyle(
              entry,
              defaults.rowStyles[index] ?? defaults.rowStyles[0],
            ),
          )
      : [];
    const cardStyles = Array.isArray(source.cardStyles)
      ? source.cardStyles
          .slice(0, 20)
          .map((entry, index) =>
            this.sanitizeDiscordWidgetCardStyle(
              entry,
              defaults.cardStyles[index] ?? defaults.cardStyles[0],
            ),
          )
      : [];
    const backgroundStyles = Array.isArray(source.backgroundStyles)
      ? source.backgroundStyles
          .slice(0, 20)
          .map((entry, index) =>
            this.sanitizeDiscordWidgetBackgroundStyle(
              entry,
              defaults.backgroundStyles[index] ?? defaults.backgroundStyles[0],
            ),
          )
      : [];

    return {
      version: 1,
      selectedTextStyleId: this.safeWidgetStyleId(
        source.selectedTextStyleId,
        defaults.selectedTextStyleId,
      ),
      selectedRowStyleId: this.safeWidgetStyleId(
        source.selectedRowStyleId,
        defaults.selectedRowStyleId,
      ),
      selectedCardStyleId: this.safeWidgetStyleId(
        source.selectedCardStyleId,
        defaults.selectedCardStyleId,
      ),
      selectedBackgroundStyleId: this.safeWidgetStyleId(
        source.selectedBackgroundStyleId,
        defaults.selectedBackgroundStyleId,
      ),
      textStyles: this.mergeDefaultDiscordWidgetStyles(
        defaults.textStyles,
        textStyles,
      ),
      rowStyles: this.mergeDefaultDiscordWidgetStyles(
        defaults.rowStyles,
        rowStyles,
      ),
      cardStyles: this.mergeDefaultDiscordWidgetStyles(
        defaults.cardStyles,
        cardStyles,
      ),
      backgroundStyles: this.mergeDefaultDiscordWidgetStyles(
        defaults.backgroundStyles,
        backgroundStyles,
      ),
    };
  }

  private parseDiscordWidgetCustomLayouts(
    value: unknown,
  ): DiscordWidgetCustomLayouts {
    let source: unknown = value;
    if (typeof value === 'string') {
      const text = value.trim();
      if (!text) return {};
      try {
        source = JSON.parse(text) as unknown;
      } catch {
        return {};
      }
    }

    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return {};
    }

    const record = source as Record<string, unknown>;
    const layoutsSource =
      record.layouts && typeof record.layouts === 'object'
        ? (record.layouts as Record<string, unknown>)
        : record;
    const layouts: DiscordWidgetCustomLayouts = {};

    for (const kind of DISCORD_MATCH_RENDER_KINDS) {
      const rawLayout = layoutsSource[kind];
      if (
        !rawLayout ||
        typeof rawLayout !== 'object' ||
        Array.isArray(rawLayout)
      ) {
        continue;
      }
      const layout = this.sanitizeDiscordWidgetCustomLayout(
        rawLayout as Record<string, unknown>,
      );
      if (layout) {
        layouts[kind] = layout;
      }
    }

    return layouts;
  }

  private parseDiscordRankingTableLayouts(
    value: unknown,
  ): DiscordRankingTableLayouts {
    let source: unknown = value;
    if (typeof value === 'string') {
      const text = value.trim();
      if (!text) return {};
      try {
        source = JSON.parse(text) as unknown;
      } catch {
        return {};
      }
    }

    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return {};
    }

    const record = source as Record<string, unknown>;
    const layoutsSource =
      record.layouts && typeof record.layouts === 'object'
        ? (record.layouts as Record<string, unknown>)
        : record;
    const layouts: DiscordRankingTableLayouts = {};

    for (const kind of DISCORD_RANKING_TABLE_KINDS) {
      const rawLayout = layoutsSource[kind];
      if (
        !rawLayout ||
        typeof rawLayout !== 'object' ||
        Array.isArray(rawLayout)
      ) {
        continue;
      }
      layouts[kind] = this.sanitizeDiscordRankingTableLayout(
        kind,
        rawLayout as Record<string, unknown>,
      );
    }

    return layouts;
  }

  private sanitizeDiscordRankingTableLayout(
    kind: DiscordRankingTableKind,
    record: Record<string, unknown>,
  ): DiscordRankingTableLayout {
    const fallback = this.defaultDiscordRankingTableLayout(
      kind,
      DISCORD_RANKING_LIMIT,
      null,
    );
    const groupColumns = Math.round(
      this.clampNumber(record.groupColumns, fallback.groupColumns, 1, 2),
    );
    const rawColumns = Array.isArray(record.columns) ? record.columns : [];
    const columns = this.defaultRankingTableColumns(groupColumns).map(
      (fallbackColumn) => {
        const matching = rawColumns.find(
          (entry) =>
            entry &&
            typeof entry === 'object' &&
            !Array.isArray(entry) &&
            (entry as Record<string, unknown>).field === fallbackColumn.field,
        ) as Record<string, unknown> | undefined;
        if (!matching) return fallbackColumn;
        return {
          ...fallbackColumn,
          label: this.stringValue(matching.label) ?? fallbackColumn.label,
          width: Math.round(
            this.clampNumber(matching.width, fallbackColumn.width, 24, 900),
          ),
          align: this.resolveTextAlign(matching.align),
          enabled:
            matching.enabled === undefined
              ? fallbackColumn.enabled
              : matching.enabled !== false && matching.enabled !== 'false',
        };
      },
    );

    return {
      tableX: Math.round(
        this.clampNumber(record.tableX, fallback.tableX, 0, 1200),
      ),
      tableY: Math.round(
        this.clampNumber(record.tableY, fallback.tableY, 0, 630),
      ),
      tableWidth: Math.round(
        this.clampNumber(record.tableWidth, fallback.tableWidth, 160, 1200),
      ),
      tableHeight: Math.round(
        this.clampNumber(record.tableHeight, fallback.tableHeight, 80, 630),
      ),
      titleHeight: Math.round(
        this.clampNumber(record.titleHeight, fallback.titleHeight, 0, 220),
      ),
      titleSize: Math.round(
        this.clampNumber(record.titleSize, fallback.titleSize, 18, 92),
      ),
      groupColumns,
      groupGap: Math.round(
        this.clampNumber(record.groupGap, fallback.groupGap, 0, 80),
      ),
      maxRows: Math.round(
        this.clampNumber(record.maxRows, fallback.maxRows, 1, 40),
      ),
      rowHeight: Math.round(
        this.clampNumber(record.rowHeight, fallback.rowHeight, 18, 80),
      ),
      rowGap: Math.round(
        this.clampNumber(record.rowGap, fallback.rowGap, 0, 24),
      ),
      rowRadius: Math.round(
        this.clampNumber(record.rowRadius, fallback.rowRadius, 0, 24),
      ),
      headerHeight: Math.round(
        this.clampNumber(record.headerHeight, fallback.headerHeight, 18, 60),
      ),
      headerFontSize: Math.round(
        this.clampNumber(record.headerFontSize, fallback.headerFontSize, 8, 28),
      ),
      logoSize: Math.round(
        this.clampNumber(record.logoSize, fallback.logoSize, 12, 72),
      ),
      teamFontSize: Math.round(
        this.clampNumber(record.teamFontSize, fallback.teamFontSize, 9, 34),
      ),
      metricFontSize: Math.round(
        this.clampNumber(record.metricFontSize, fallback.metricFontSize, 9, 34),
      ),
      columns,
    };
  }

  private sanitizeDiscordWidgetCustomLayout(
    layout: Record<string, unknown>,
  ): DiscordWidgetCustomLayout | null {
    const rawElements = Array.isArray(layout.elements) ? layout.elements : [];
    const elements = rawElements
      .slice(0, 30)
      .map((entry): DiscordWidgetCustomElement | null => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return null;
        }
        const record = entry as Record<string, unknown>;
        if (record.type === 'featured') {
          return this.sanitizeDiscordWidgetFeaturedElement(record);
        }
        if (record.type === 'media') {
          return this.sanitizeDiscordWidgetMediaElement(record);
        }
        if (record.type === 'rows') {
          return this.sanitizeDiscordWidgetRowsElement(record);
        }
        if (record.type === 'image') {
          return this.sanitizeDiscordWidgetImageElement(record);
        }
        return this.sanitizeDiscordWidgetTextElement(record);
      })
      .filter((entry): entry is DiscordWidgetCustomElement => Boolean(entry));

    if (!elements.length) return null;

    return {
      enabled:
        layout.enabled === true || this.stringValue(layout.enabled) === 'true',
      elements,
    };
  }

  private sanitizeDiscordWidgetTextElement(
    record: Record<string, unknown>,
  ): DiscordWidgetCustomTextElement | null {
    const field = this.stringValue(record.field);
    if (
      !field ||
      !DISCORD_CUSTOM_TEXT_FIELDS.includes(
        field as DiscordWidgetCustomTextField,
      )
    ) {
      return null;
    }

    return {
      id: this.stringValue(record.id) ?? `text-${field}`,
      type: 'text',
      field: field as DiscordWidgetCustomTextField,
      x: Math.round(this.clampNumber(record.x, 48, -200, 1200)),
      y: Math.round(this.clampNumber(record.y, 48, -200, 630)),
      width: Math.round(this.clampNumber(record.width, 360, 24, 1200)),
      height: Math.round(this.clampNumber(record.height, 48, 16, 630)),
      fontSize: Math.round(this.clampNumber(record.fontSize, 28, 8, 96)),
      fontWeight: Math.round(
        this.clampNumber(record.fontWeight, 800, 300, 900),
      ),
      color: this.safeColor(record.color),
      align: this.resolveTextAlign(record.align),
      text: (this.stringValue(record.text) ?? '').slice(0, 160),
      textTransform: this.safeTextTransform(
        record.textTransform,
        field === 'subtitle' || field === 'footer' ? 'none' : 'uppercase',
      ),
      textStyleId: this.safeWidgetStyleId(record.textStyleId, 'text-body'),
      background:
        record.background === true ||
        this.stringValue(record.background) === 'true',
      backgroundColor: this.safeColor(record.backgroundColor),
      zIndex: Math.round(this.clampNumber(record.zIndex, 10, 0, 50)),
      enabled: record.enabled !== false && record.enabled !== 'false',
    };
  }

  private sanitizeDiscordWidgetImageElement(
    record: Record<string, unknown>,
  ): DiscordWidgetCustomImageElement | null {
    const source = this.stringValue(record.source);
    return {
      id: this.stringValue(record.id) ?? 'image',
      type: 'image',
      source: DISCORD_CUSTOM_IMAGE_SOURCES.includes(
        source as DiscordWidgetCustomImageSource,
      )
        ? (source as DiscordWidgetCustomImageSource)
        : 'url',
      url: this.normalizeAssetUrl(record.url),
      dynamicCode: (this.stringValue(record.dynamicCode) ?? 'M-1-1')
        .trim()
        .slice(0, 24),
      rowRank: Math.round(this.clampNumber(record.rowRank, 1, 1, 40)),
      x: Math.round(this.clampNumber(record.x, 48, -200, 1200)),
      y: Math.round(this.clampNumber(record.y, 420, -200, 630)),
      width: Math.round(this.clampNumber(record.width, 120, 12, 1200)),
      height: Math.round(this.clampNumber(record.height, 120, 12, 630)),
      radius: Math.round(this.clampNumber(record.radius, 10, 0, 120)),
      opacity: this.clampNumber(record.opacity, 1, 0, 1),
      zIndex: Math.round(this.clampNumber(record.zIndex, 18, 0, 50)),
      enabled: record.enabled !== false && record.enabled !== 'false',
    };
  }

  private sanitizeDiscordWidgetMediaElement(
    record: Record<string, unknown>,
  ): DiscordWidgetCustomMediaElement | null {
    const source = this.stringValue(record.source);
    return {
      id: this.stringValue(record.id) ?? 'media',
      type: 'media',
      source: DISCORD_CUSTOM_MEDIA_SOURCES.includes(
        source as DiscordWidgetCustomMediaSource,
      )
        ? (source as DiscordWidgetCustomMediaSource)
        : 'players',
      x: Math.round(this.clampNumber(record.x, 48, -200, 1200)),
      y: Math.round(this.clampNumber(record.y, 516, -200, 630)),
      width: Math.round(this.clampNumber(record.width, 1104, 120, 1200)),
      height: Math.round(this.clampNumber(record.height, 88, 34, 240)),
      itemCount: Math.round(this.clampNumber(record.itemCount, 4, 1, 8)),
      cardGap: Math.round(this.clampNumber(record.cardGap, 10, 0, 40)),
      imageSize: Math.round(this.clampNumber(record.imageSize, 58, 18, 160)),
      fontSize: Math.round(this.clampNumber(record.fontSize, 11, 8, 34)),
      rowRadius: Math.round(this.clampNumber(record.rowRadius, 10, 0, 30)),
      showStats: record.showStats !== false && record.showStats !== 'false',
      cardStyleId: this.safeWidgetStyleId(record.cardStyleId, 'card-default'),
      textStyleId: this.safeWidgetStyleId(record.textStyleId, 'text-body'),
      statTextStyleId: this.safeWidgetStyleId(
        record.statTextStyleId,
        'text-muted',
      ),
      zIndex: Math.round(this.clampNumber(record.zIndex, 11, 0, 50)),
      enabled: record.enabled !== false && record.enabled !== 'false',
    };
  }

  private sanitizeDiscordWidgetRowsElement(
    record: Record<string, unknown>,
  ): DiscordWidgetCustomRowsElement | null {
    const rawColumns = Array.isArray(record.columns) ? record.columns : [];
    const columns = rawColumns
      .slice(0, 10)
      .map((entry, index): DiscordWidgetCustomColumn | null => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return null;
        }
        const column = entry as Record<string, unknown>;
        const field = this.stringValue(column.field);
        if (
          !field ||
          !DISCORD_CUSTOM_ROW_FIELDS.includes(
            field as DiscordWidgetCustomRowField,
          )
        ) {
          return null;
        }
        return {
          id: this.stringValue(column.id) ?? `column-${index + 1}`,
          field: field as DiscordWidgetCustomRowField,
          label: this.stringValue(column.label) ?? field,
          width: Math.round(this.clampNumber(column.width, 80, 16, 520)),
          align: this.resolveTextAlign(column.align),
          fontSize: Math.round(this.clampNumber(column.fontSize, 0, 0, 72)),
          fontWeight: Math.round(
            this.clampNumber(column.fontWeight, 0, 0, 900),
          ),
          color: this.safeColor(column.color),
          backgroundColor: this.safeColor(column.backgroundColor),
          textTransform: this.safeTextTransform(
            column.textTransform,
            'uppercase',
          ),
          enabled: column.enabled !== false && column.enabled !== 'false',
        };
      })
      .filter((column): column is DiscordWidgetCustomColumn => Boolean(column));

    if (!columns.length) return null;

    const rawGroupOffsets = Array.isArray(record.groupOffsets)
      ? record.groupOffsets
      : [];
    const groupOffsets = rawGroupOffsets
      .slice(0, 4)
      .map((entry): DiscordWidgetCustomRowsGroupOffset => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return { x: 0, y: 0 };
        }
        const offset = entry as Record<string, unknown>;
        return {
          x: Math.round(this.clampNumber(offset.x, 0, -400, 400)),
          y: Math.round(this.clampNumber(offset.y, 0, -400, 400)),
        };
      });

    return {
      id: this.stringValue(record.id) ?? 'rows',
      type: 'rows',
      x: Math.round(this.clampNumber(record.x, 48, -200, 1200)),
      y: Math.round(this.clampNumber(record.y, 188, -200, 630)),
      width: Math.round(this.clampNumber(record.width, 1104, 120, 1200)),
      startRank: Math.round(this.clampNumber(record.startRank, 1, 1, 40)),
      rankDisplayMode: this.safeRowsRankDisplayMode(record.rankDisplayMode),
      cardDirection: this.safeRowsCardDirection(record.cardDirection),
      autoFitRows: record.autoFitRows === true || record.autoFitRows === 'true',
      rowHeight: Math.round(this.clampNumber(record.rowHeight, 32, 18, 260)),
      rowGap: Math.round(this.clampNumber(record.rowGap, 6, 0, 32)),
      groupColumns: Math.round(this.clampNumber(record.groupColumns, 2, 1, 4)),
      groupGap: Math.round(this.clampNumber(record.groupGap, 16, 0, 60)),
      maxRows: Math.round(this.clampNumber(record.maxRows, 25, 1, 40)),
      groupOffsets,
      fontSize: Math.round(this.clampNumber(record.fontSize, 14, 8, 44)),
      headerFontSize: Math.round(
        this.clampNumber(record.headerFontSize, 10, 8, 28),
      ),
      rowRadius: Math.round(this.clampNumber(record.rowRadius, 10, 0, 30)),
      showHeader: record.showHeader !== false && record.showHeader !== 'false',
      rowStyleId: this.safeWidgetStyleId(record.rowStyleId, 'row-default'),
      headerTextStyleId: this.safeWidgetStyleId(
        record.headerTextStyleId,
        'text-muted',
      ),
      bodyTextStyleId: this.safeWidgetStyleId(
        record.bodyTextStyleId,
        'text-body',
      ),
      cardStyleId: this.safeWidgetStyleId(record.cardStyleId, 'card-default'),
      zIndex: Math.round(this.clampNumber(record.zIndex, 10, 0, 50)),
      enabled: record.enabled !== false && record.enabled !== 'false',
      columns,
    };
  }

  private sanitizeDiscordWidgetFeaturedElement(
    record: Record<string, unknown>,
  ): DiscordWidgetCustomFeaturedElement | null {
    return {
      id: this.stringValue(record.id) ?? 'featured',
      type: 'featured',
      x: Math.round(this.clampNumber(record.x, 48, -200, 1200)),
      y: Math.round(this.clampNumber(record.y, 142, -200, 630)),
      width: Math.round(this.clampNumber(record.width, 720, 120, 1200)),
      teamCount: Math.round(this.clampNumber(record.teamCount, 3, 1, 12)),
      groupColumns: Math.round(this.clampNumber(record.groupColumns, 3, 1, 6)),
      cardHeight: Math.round(this.clampNumber(record.cardHeight, 88, 34, 180)),
      cardGap: Math.round(this.clampNumber(record.cardGap, 10, 0, 40)),
      logoSize: Math.round(this.clampNumber(record.logoSize, 42, 18, 120)),
      fontSize: Math.round(this.clampNumber(record.fontSize, 14, 8, 44)),
      rowRadius: Math.round(this.clampNumber(record.rowRadius, 10, 0, 30)),
      showStats: record.showStats !== false && record.showStats !== 'false',
      cardStyleId: this.safeWidgetStyleId(record.cardStyleId, 'card-default'),
      textStyleId: this.safeWidgetStyleId(record.textStyleId, 'text-body'),
      statTextStyleId: this.safeWidgetStyleId(
        record.statTextStyleId,
        'text-muted',
      ),
      zIndex: Math.round(this.clampNumber(record.zIndex, 12, 0, 50)),
      enabled: record.enabled !== false && record.enabled !== 'false',
    };
  }

  private resolveTextAlign(value: unknown): 'left' | 'center' | 'right' {
    const align = this.stringValue(value);
    return align === 'center' || align === 'right' ? align : 'left';
  }

  private safeRowsRankDisplayMode(
    value: unknown,
  ): DiscordWidgetCustomRowsRankDisplayMode {
    return this.stringValue(value) === 'restart' ? 'restart' : 'global';
  }

  private safeRowsCardDirection(
    value: unknown,
  ): DiscordWidgetCustomRowsCardDirection {
    const direction = this.stringValue(value);
    return direction === 'horizontal' || direction === 'vertical'
      ? direction
      : 'auto';
  }

  private buildDiscordOverlayLayersHtml(
    layers: DiscordWidgetOverlayLayer[],
    kind: DiscordMatchRenderKind,
  ): string {
    return layers
      .filter(
        (layer) =>
          layer.enabled &&
          (layer.targets.includes('all') || layer.targets.includes(kind)),
      )
      .sort((left, right) => left.zIndex - right.zIndex)
      .map(
        (layer) =>
          `<img class="overlay-layer" src="${this.escapeHtml(
            layer.url,
          )}" alt="" style="left:${layer.x}px; top:${
            layer.y
          }px; width:${layer.width}px; opacity:${layer.opacity.toFixed(
            2,
          )}; z-index:${layer.zIndex};" />`,
      )
      .join('');
  }

  private safeTextTransform(
    value: unknown,
    fallback: DiscordWidgetCustomTextTransform = 'none',
  ): DiscordWidgetCustomTextTransform {
    const transform = this.stringValue(value);
    return DISCORD_CUSTOM_TEXT_TRANSFORMS.includes(
      transform as DiscordWidgetCustomTextTransform,
    )
      ? (transform as DiscordWidgetCustomTextTransform)
      : fallback;
  }

  private safeColor(value: unknown): string | null {
    const color = this.stringValue(value);
    if (!color) return null;
    if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
    if (/^rgba?\([0-9\s,%.]+\)$/i.test(color)) return color;
    if (/^hsla?\([0-9\s,%.degturnrad+-]+\)$/i.test(color)) return color;
    return null;
  }

  private defaultDiscordWidgetSafeArea(): DiscordWidgetSafeArea {
    return {
      top: DEFAULT_DISCORD_WIDGET_SAFE_PADDING,
      right: DEFAULT_DISCORD_WIDGET_SAFE_PADDING,
      bottom: DEFAULT_DISCORD_WIDGET_SAFE_PADDING,
      left: DEFAULT_DISCORD_WIDGET_SAFE_PADDING,
    };
  }

  private resolveDiscordWidgetSafeArea(
    emojis: Record<string, unknown>,
  ): DiscordWidgetSafeArea {
    const fallback = this.defaultDiscordWidgetSafeArea();
    return {
      top: this.clampNumber(emojis.discordWidgetSafeTop, fallback.top, 0, 220),
      right: this.clampNumber(
        emojis.discordWidgetSafeRight,
        fallback.right,
        0,
        220,
      ),
      bottom: this.clampNumber(
        emojis.discordWidgetSafeBottom,
        fallback.bottom,
        0,
        220,
      ),
      left: this.clampNumber(
        emojis.discordWidgetSafeLeft,
        fallback.left,
        0,
        220,
      ),
    };
  }

  private assetBaseUrl(): string {
    return (
      process.env.RENDER_ASSET_BASE_URL?.trim() ||
      process.env.API_INTERNAL_URL?.trim() ||
      process.env.API_PUBLIC_URL?.trim() ||
      process.env.API_BASE_URL?.trim() ||
      `http://127.0.0.1:${process.env.PORT || 3000}`
    ).replace(/\/$/, '');
  }

  private webAssetBaseUrl(): string {
    return (
      process.env.WEB_APP_ORIGIN?.trim() ||
      process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
      process.env.APP_URL?.trim() ||
      'https://arenzyra.com'
    ).replace(/\/$/, '');
  }

  private normalizeAssetUrl(value: unknown): string | null {
    const raw = this.stringValue(value);
    if (!raw) return null;
    if (raw.startsWith('data:') || raw.startsWith('blob:')) return null;

    if (
      raw.startsWith('/uploads/') ||
      raw.startsWith('/assets/') ||
      raw.startsWith('/media/')
    ) {
      return `${this.assetBaseUrl()}${raw}`;
    }

    try {
      const parsed = new URL(raw);
      if (!['http:', 'https:'].includes(parsed.protocol)) return null;
      return parsed.toString();
    } catch {
      return null;
    }
  }

  private normalizeWebAssetUrl(value: unknown): string | null {
    const raw = this.stringValue(value);
    if (!raw) return null;
    if (raw.startsWith('/assets/')) return `${this.webAssetBaseUrl()}${raw}`;
    return this.normalizeAssetUrl(raw);
  }

  private cssUrl(value: string): string {
    return encodeURI(value)
      .replace(/&/g, '%26')
      .replace(
        /[)"'\\]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      );
  }

  private normalizeGoogleFontCssUrl(value: unknown): string | null {
    const raw = this.stringValue(value)?.trim();
    if (!raw) return null;
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'https:') return null;
      if (parsed.hostname !== 'fonts.googleapis.com') return null;
      if (!parsed.pathname.startsWith('/css')) return null;
      return parsed.toString();
    } catch {
      return null;
    }
  }

  private googleFontCssImport(value: unknown): string {
    const url = this.normalizeGoogleFontCssUrl(value);
    const escapedUrl = url?.replace(
      /[)"'\\]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return escapedUrl ? `@import url("${escapedUrl}");` : '';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private normalizeStudioFieldKey(value: string, fallback = 'field') {
    const normalized = value
      .trim()
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return normalized || fallback;
  }

  private parseDiscordStudioRenderer(
    emojis: Record<string, unknown>,
  ): StudioDesign | null {
    const raw = this.stringValue(emojis.discordStudioDesignJson);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!this.isRecord(parsed)) return null;
      if (
        parsed.schemaVersion !== 1 ||
        typeof parsed.id !== 'string' ||
        typeof parsed.name !== 'string' ||
        typeof parsed.width !== 'number' ||
        typeof parsed.height !== 'number' ||
        !Array.isArray(parsed.pages) ||
        !parsed.pages.length ||
        typeof parsed.activePageId !== 'string'
      ) {
        return null;
      }
      const pages = parsed.pages.filter((page): page is StudioPage => {
        if (!this.isRecord(page)) return false;
        const background = this.isRecord(page.background)
          ? page.background
          : null;
        return (
          typeof page.id === 'string' &&
          typeof page.name === 'string' &&
          Boolean(background) &&
          typeof background?.transparent === 'boolean' &&
          typeof background?.color === 'string' &&
          Array.isArray(page.elements)
        );
      });
      if (!pages.length) return null;
      return {
        ...(parsed as StudioDesign),
        width: Math.max(1, Math.round(parsed.width)),
        height: Math.max(1, Math.round(parsed.height)),
        pages,
      };
    } catch {
      return null;
    }
  }

  private resolveDiscordStudioRenderer(
    emojis: Record<string, unknown>,
  ): DiscordStudioRendererSettings | null {
    const enabled =
      emojis.discordStudioRendererEnabled === true ||
      this.stringValue(emojis.discordStudioRendererEnabled) === 'true';
    if (!enabled) return null;
    const design = this.parseDiscordStudioRenderer(emojis);
    if (!design) return null;
    return {
      enabled,
      design,
      pageId: this.stringValue(emojis.discordStudioPageId),
    };
  }

  private studioDataValuesFromRecord(
    record: Record<string, unknown>,
    prefix = '',
    output: Record<string, string> = {},
  ) {
    for (const [key, value] of Object.entries(record)) {
      const path = prefix ? `${prefix}_${key}` : key;
      if (Array.isArray(value)) {
        output[this.normalizeStudioFieldKey(path)] = JSON.stringify(value);
        value.forEach((entry, index) => {
          if (this.isRecord(entry)) {
            this.studioDataValuesFromRecord(
              entry,
              `${path}_${index + 1}`,
              output,
            );
          } else {
            output[this.normalizeStudioFieldKey(`${path}_${index + 1}`)] =
              this.primitiveString(entry);
          }
        });
      } else if (this.isRecord(value)) {
        this.studioDataValuesFromRecord(value, path, output);
      } else {
        output[this.normalizeStudioFieldKey(path)] =
          this.primitiveString(value);
      }
    }
    return output;
  }

  private applyStudioDataMappings(
    design: StudioDesign,
    values: Record<string, string>,
  ) {
    const activeProfile = (design.dataMappings ?? []).find(
      (profile) => profile.id === design.activeDataMappingId,
    );
    if (!activeProfile?.mappings?.length) return values;
    const next = { ...values };
    for (const mapping of activeProfile.mappings) {
      if (mapping.enabled === false) continue;
      const sourceKey = mapping.sourceKey
        ? this.normalizeStudioFieldKey(mapping.sourceKey)
        : '';
      const targetKey = mapping.targetKey
        ? this.normalizeStudioFieldKey(mapping.targetKey)
        : '';
      if (!sourceKey || !targetKey) continue;
      const sourceValue = next[sourceKey];
      if (sourceValue !== undefined) {
        next[targetKey] = sourceValue;
      } else if (mapping.fallbackValue && next[targetKey] === undefined) {
        next[targetKey] = mapping.fallbackValue;
      }
    }
    return next;
  }

  private studioPage(design: StudioDesign, pageId?: string | null) {
    return (
      design.pages.find((page) => page.id === pageId) ??
      design.pages.find((page) => page.id === design.activePageId) ??
      design.pages[0]
    );
  }

  private assignStudioValue(
    values: Record<string, unknown>,
    key: string,
    value: unknown,
  ) {
    values[this.normalizeStudioFieldKey(key)] = value ?? '';
  }

  private discordRankNumber(value: string, fallback: number) {
    const parsed = Number.parseInt(value.replace(/[^0-9-]+/g, ''), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private isDiscordPlayerWidgetKind(kind: DiscordMatchRenderKind): boolean {
    return (
      kind === 'top-mvp' ||
      kind === 'top-fraggers' ||
      kind === 'overall-top-mvp' ||
      kind === 'overall-top-fraggers'
    );
  }

  private studioValuesForDiscordWidget(input: StudioRenderInput) {
    const values: Record<string, unknown> = {
      kind: input.kind,
      matchName: input.textValues.matchName,
      sessionName: input.textValues.sessionName ?? '',
      sessionOrMatchName: input.textValues.sessionOrMatchName,
      overallRankingSubtitle: input.textValues.overallRankingSubtitle,
      matchScheduleScope: input.textValues.matchScheduleScope ?? '',
      matchScheduleCount: input.textValues.matchScheduleCount ?? '',
      eyebrow: input.header.eyebrow,
      title: input.header.title,
      subtitle: input.header.subtitle,
      footer: input.footer,
      rowCount: input.rows.length,
    };

    input.rows.forEach((row, index) => {
      const rank = this.discordRankNumber(row.rank, index + 1);
      const isPlayerKind =
        input.kind === 'top-mvp' ||
        input.kind === 'top-fraggers' ||
        input.kind === 'overall-top-mvp' ||
        input.kind === 'overall-top-fraggers';
      const teamLogoUrl =
        this.normalizeAssetUrl(
          row.teamLogoUrl ?? (isPlayerKind ? null : row.logoUrl),
        ) ?? this.defaultTeamLogoUrl(input.branding);
      const primaryLogoUrl = isPlayerKind
        ? (this.normalizeAssetUrl(row.logoUrl) ?? this.defaultPlayerPhotoUrl())
        : (this.normalizeAssetUrl(row.logoUrl ?? row.teamLogoUrl) ??
          this.defaultTeamLogoUrl(input.branding));
      const genericPrefix = `row_${index + 1}`;
      const teamPrefix = `team_${index + 1}`;
      const resultPrefix =
        input.kind === 'overall-ranking'
          ? `overall_${index + 1}`
          : `result_${index + 1}`;
      for (const prefix of [genericPrefix, teamPrefix, resultPrefix]) {
        this.assignStudioValue(values, `${prefix}_rank`, rank);
        this.assignStudioValue(values, `${prefix}_team_name`, row.title);
        this.assignStudioValue(values, `${prefix}_team_tag`, row.title);
        this.assignStudioValue(values, `${prefix}_team_logo_url`, teamLogoUrl);
        this.assignStudioValue(values, `${prefix}_logo_url`, primaryLogoUrl);
        this.assignStudioValue(values, `${prefix}_kills`, row.kills ?? 0);
        this.assignStudioValue(
          values,
          `${prefix}_placement_points`,
          row.placementPoints ?? 0,
        );
        this.assignStudioValue(
          values,
          `${prefix}_points`,
          row.totalPoints ?? row.metric,
        );
        this.assignStudioValue(
          values,
          `${prefix}_total_points`,
          row.totalPoints ?? row.metric,
        );
        this.assignStudioValue(values, `${prefix}_wwcd`, row.wwcd ?? 0);
        this.assignStudioValue(values, `${prefix}_subtitle`, row.subtitle);
        this.assignStudioValue(values, `${prefix}_metric`, row.metric);
      }

      if (
        index === 0 &&
        (input.kind === 'match-result' || input.kind === 'overall-ranking')
      ) {
        this.assignStudioValue(values, 'winner_rank', rank);
        this.assignStudioValue(values, 'winner_team_name', row.title);
        this.assignStudioValue(values, 'winner_team_tag', row.title);
        this.assignStudioValue(values, 'winner_team_logo_url', teamLogoUrl);
        this.assignStudioValue(values, 'winner_kills', row.kills ?? 0);
        this.assignStudioValue(
          values,
          'winner_points',
          row.totalPoints ?? row.metric,
        );
      }

      if (isPlayerKind) {
        const playerPrefix = `top_player_${index + 1}`;
        this.assignStudioValue(values, `${playerPrefix}_rank`, rank);
        this.assignStudioValue(values, `${playerPrefix}_name`, row.title);
        this.assignStudioValue(
          values,
          `${playerPrefix}_kills`,
          row.kills ?? row.metric,
        );
        this.assignStudioValue(
          values,
          `${playerPrefix}_team_name`,
          row.subtitle,
        );
        this.assignStudioValue(
          values,
          `${playerPrefix}_avatar_url`,
          primaryLogoUrl,
        );
        this.assignStudioValue(
          values,
          `${playerPrefix}_team_logo_url`,
          teamLogoUrl,
        );
        if (index === 0) {
          this.assignStudioValue(values, 'mvp_player_name', row.title);
          this.assignStudioValue(
            values,
            'mvp_player_kills',
            row.kills ?? row.metric,
          );
          this.assignStudioValue(values, 'mvp_player_team_name', row.subtitle);
          this.assignStudioValue(
            values,
            'mvp_player_avatar_url',
            primaryLogoUrl,
          );
          this.assignStudioValue(
            values,
            'mvp_player_team_logo_url',
            teamLogoUrl,
          );
        }
      }
    });

    return this.studioDataValuesFromRecord(values);
  }

  private async resolveDiscordWidgetTemplate(params: {
    organizationId: string;
    sessionId?: string | null;
  }): Promise<DiscordWidgetTemplateSettings> {
    if (!params.sessionId) {
      return {
        enabled: false,
        guildId: null,
        backgroundUrl: null,
        primaryColor: null,
        textColor: null,
        mutedColor: null,
        rowColor: null,
        panelOpacity: 0.74,
        fontFamily:
          DISCORD_WIDGET_FONT_STACKS[DEFAULT_DISCORD_WIDGET_FONT_FAMILY],
        fontCssImport: '',
        overlayStrength: DEFAULT_DISCORD_WIDGET_OVERLAY,
        safeArea: this.defaultDiscordWidgetSafeArea(),
        texts: this.defaultDiscordResultCardText(),
        overlayLayers: [],
        styleLibrary: this.defaultDiscordWidgetStyleLibrary(),
        customLayouts: {},
        rankingTables: {},
        studio: null,
        matchSchedule: [],
      };
    }

    const config = await this.prisma.sessionDiscordConfig.findFirst({
      where: {
        organizationId: params.organizationId,
        sessionId: params.sessionId,
      },
      select: { emojis: true, guildId: true },
    });
    const emojis =
      config?.emojis &&
      typeof config.emojis === 'object' &&
      !Array.isArray(config.emojis)
        ? (config.emojis as Record<string, unknown>)
        : {};

    const enabled =
      emojis.discordWidgetTemplateEnabled === true ||
      this.stringValue(emojis.discordWidgetTemplateEnabled) === 'true';

    return {
      enabled,
      guildId: this.stringValue(config?.guildId),
      backgroundUrl: this.normalizeAssetUrl(
        emojis.discordWidgetTemplateBackgroundUrl,
      ),
      primaryColor: this.hexColorValue(emojis.discordWidgetPrimaryColor),
      textColor: this.hexColorValue(emojis.discordWidgetTextColor),
      mutedColor: this.hexColorValue(emojis.discordWidgetMutedColor),
      rowColor: this.hexColorValue(emojis.discordWidgetRowColor),
      panelOpacity: this.clampNumber(
        emojis.discordWidgetPanelOpacity,
        0.74,
        0,
        1,
      ),
      fontFamily: this.discordWidgetFontFamily(
        emojis.discordWidgetFontFamily,
        emojis.discordWidgetCustomFontName,
      ),
      fontCssImport: this.googleFontCssImport(
        emojis.discordWidgetCustomFontCssUrl,
      ),
      overlayStrength: this.clampNumber(
        emojis.discordWidgetOverlayStrength,
        DEFAULT_DISCORD_WIDGET_OVERLAY,
        0,
        0.88,
      ),
      safeArea: this.resolveDiscordWidgetSafeArea(emojis),
      texts: this.resolveDiscordResultCardText(emojis),
      overlayLayers: this.parseDiscordWidgetOverlayLayers(
        emojis.discordWidgetOverlayLayers,
      ),
      styleLibrary: this.parseDiscordWidgetStyleLibrary(
        emojis.discordWidgetStyleLibrary,
        {
          primaryColor: this.stringValue(emojis.discordWidgetPrimaryColor),
          textColor: this.stringValue(emojis.discordWidgetTextColor),
          mutedColor: this.stringValue(emojis.discordWidgetMutedColor),
          rowColor: this.stringValue(emojis.discordWidgetRowColor),
        },
      ),
      customLayouts: this.parseDiscordWidgetCustomLayouts(
        emojis.discordWidgetCustomLayouts,
      ),
      rankingTables: this.parseDiscordRankingTableLayouts(
        emojis.discordRankingTableLayouts,
      ),
      studio: this.resolveDiscordStudioRenderer(emojis),
      matchSchedule: this.parseDiscordResultMatchSchedule(
        emojis.discordResultMatchSchedule,
      ),
    };
  }

  private applyDiscordWidgetTemplate(
    branding: TemplateBranding,
    template: DiscordWidgetTemplateSettings,
  ): TemplateBranding {
    const fontFamily = template.fontFamily || this.brandingFontFamily(branding);
    const fontCssImport = template.fontCssImport || '';
    const primaryColor = template.primaryColor ?? branding.primaryColor;
    const secondaryColor = template.primaryColor
      ? primaryColor
      : branding.secondaryColor;
    const panel =
      template.rowColor && template.panelOpacity < 1
        ? (this.rgbaFromHexColor(template.rowColor, template.panelOpacity) ??
          template.rowColor)
        : (template.rowColor ?? branding.panel);
    const themedBranding: TemplateBranding = {
      ...branding,
      primaryColor,
      secondaryColor,
      accent: template.primaryColor ?? branding.accent,
      primarySurface: this.primarySurface(
        primaryColor,
        secondaryColor ?? branding.accent,
      ),
      textPrimary: template.textColor ?? branding.textPrimary,
      textMuted: template.mutedColor ?? branding.textMuted,
      panel,
      panelSurface: this.panelSurface(panel, primaryColor),
      fontFamily,
      fontCssImport,
    };
    if (!template.enabled) {
      return themedBranding;
    }

    const backgroundImage = template.backgroundUrl
      ? `url(${this.cssUrl(template.backgroundUrl)}) center / cover no-repeat, ${
          themedBranding.background
        }`
      : themedBranding.background;

    return {
      ...themedBranding,
      background: backgroundImage,
      backgroundSurface:
        themedBranding.backgroundSurface ?? themedBranding.background,
      safeArea: template.safeArea,
    };
  }

  private matchLayout(rowCount: number): TemplateLayout {
    if (rowCount <= 6) {
      return {
        boardColumns: '2',
        boardGap: '12px 16px',
        rowMinHeight: '48px',
        rowPadding: '9px 12px',
        rowRadius: '16px',
        rowRankSize: '23px',
        rowTitleSize: '17px',
        rowMetaSize: '15px',
        rowMetricSize: '18px',
        headerMargin: '22px',
        titleSize: '42px',
      };
    }
    if (rowCount <= 14) {
      return {
        boardColumns: '2',
        boardGap: '8px 12px',
        rowMinHeight: '38px',
        rowPadding: '6px 9px',
        rowRadius: '13px',
        rowRankSize: '20px',
        rowTitleSize: '15px',
        rowMetaSize: '13px',
        rowMetricSize: '16px',
        headerMargin: '18px',
        titleSize: '38px',
      };
    }
    if (rowCount <= 24) {
      return {
        boardColumns: '2',
        boardGap: '6px 10px',
        rowMinHeight: '30px',
        rowPadding: '4px 7px',
        rowRadius: '10px',
        rowRankSize: '16px',
        rowTitleSize: '12px',
        rowMetaSize: '11px',
        rowMetricSize: '13px',
        headerMargin: '10px',
        titleSize: '30px',
      };
    }
    return {
      boardColumns: '2',
      boardGap: '5px 8px',
      rowMinHeight: '27px',
      rowPadding: '3px 6px',
      rowRadius: '9px',
      rowRankSize: '14px',
      rowTitleSize: '11px',
      rowMetaSize: '10px',
      rowMetricSize: '12px',
      headerMargin: '8px',
      titleSize: '28px',
    };
  }

  private leaderboardLayout(
    rowCount: number,
    mode: LeaderboardTemplateInput['mode'] = 'summary',
  ): TemplateLayout {
    if (mode === 'player-mvp') {
      return {
        boardColumns: '1',
        boardGap: '0',
        rowMinHeight: '326px',
        rowPadding: '24px 28px',
        rowRadius: '24px',
        rowRankSize: '42px',
        rowTitleSize: '46px',
        rowMetaSize: '20px',
        rowMetricSize: '54px',
        headerMargin: '18px',
        titleSize: '42px',
      };
    }

    if (mode === 'player-ranking') {
      return {
        boardColumns: '1',
        boardGap: '10px',
        rowMinHeight: '72px',
        rowPadding: '7px 14px',
        rowRadius: '14px',
        rowRankSize: '22px',
        rowTitleSize: '20px',
        rowMetaSize: '13px',
        rowMetricSize: '22px',
        headerMargin: '10px',
        titleSize: '36px',
      };
    }

    if (mode === 'overall-ranking') {
      if (rowCount <= 14) {
        return {
          boardColumns: '2',
          boardGap: '8px 12px',
          rowMinHeight: '38px',
          rowPadding: '6px 9px',
          rowRadius: '13px',
          rowRankSize: '20px',
          rowTitleSize: '15px',
          rowMetaSize: '13px',
          rowMetricSize: '16px',
          headerMargin: '18px',
          titleSize: '38px',
        };
      }
      return {
        boardColumns: '2',
        boardGap: '5px 8px',
        rowMinHeight: '27px',
        rowPadding: '3px 6px',
        rowRadius: '9px',
        rowRankSize: '14px',
        rowTitleSize: '11px',
        rowMetaSize: '10px',
        rowMetricSize: '12px',
        headerMargin: '8px',
        titleSize: '28px',
      };
    }

    if (rowCount <= 5) {
      return {
        boardColumns: '1',
        boardGap: '12px',
        rowMinHeight: '58px',
        rowPadding: '13px 18px',
        rowRadius: '18px',
        rowRankSize: '28px',
        rowTitleSize: '24px',
        rowMetaSize: '14px',
        rowMetricSize: '24px',
        headerMargin: '20px',
        titleSize: '42px',
      };
    }
    return {
      boardColumns: '1',
      boardGap: '7px',
      rowMinHeight: '38px',
      rowPadding: '7px 12px',
      rowRadius: '13px',
      rowRankSize: '20px',
      rowTitleSize: '18px',
      rowMetaSize: '11px',
      rowMetricSize: '18px',
      headerMargin: '14px',
      titleSize: '34px',
    };
  }

  private buildMatchRows(
    teams: MatchTemplateInput['teams'],
    branding?: TemplateBranding | null,
  ): {
    rowsHtml: string;
    footer: string;
  } {
    const rowsHtml = teams
      .map((team) =>
        `
            <div class="row row--match-ranking">
            <div class="row-rank">#${this.escapeHtml(team.position)}</div>
            ${this.buildTeamLogoHtml(team.logoUrl, team.team, branding)}
            <div class="row-team">${this.escapeHtml(team.team)}</div>
            <div class="row-stat">${this.escapeHtml(team.kills)}</div>
            <div class="row-stat">${this.escapeHtml(team.placementPoints)}</div>
            <div class="row-total">${this.escapeHtml(team.totalPoints)}</div>
          </div>
        `.trim(),
      )
      .join('\n');

    return {
      rowsHtml,
      footer: teams.length
        ? `Showing ${teams.length} teams`
        : 'No result rows yet',
    };
  }

  private buildStandingsRows(teams: StandingsTemplateInput['teams']): {
    rowsHtml: string;
    footer: string;
  } {
    const rowsHtml = teams
      .map((team) =>
        `
          <div class="row">
            <div class="row-rank">#${this.escapeHtml(team.rank)}</div>
            <div class="row-main">
              <div class="row-tag">${this.escapeHtml(team.tag)}</div>
              <div class="row-meta">Standing</div>
            </div>
            <div class="row-points">${this.escapeHtml(team.totalPoints)} pts</div>
          </div>
        `.trim(),
      )
      .join('\n');

    return {
      rowsHtml,
      footer: teams.length ? `Showing top ${teams.length}` : 'No standings yet',
    };
  }

  private buildLogoHtml(branding: TemplateBranding): string {
    return branding.logoUrl
      ? `<img class="brand-logo" src="${this.escapeHtml(branding.logoUrl)}" alt="Brand logo" />`
      : `<div class="brand-logo brand-logo--empty"></div>`;
  }

  private defaultTeamLogoUrl(branding?: TemplateBranding | null): string {
    return (
      this.normalizeAssetUrl(branding?.defaultTeamLogoUrl) ??
      this.normalizeAssetUrl(DEFAULT_TEAM_LOGO_PATH) ??
      `${this.assetBaseUrl()}${DEFAULT_TEAM_LOGO_PATH}`
    );
  }

  private defaultPlayerPhotoUrl(): string {
    return (
      this.normalizeAssetUrl(DEFAULT_PLAYER_PHOTO_PATH) ??
      `${this.assetBaseUrl()}${DEFAULT_PLAYER_PHOTO_PATH}`
    );
  }

  private buildTeamLogoHtml(
    logoUrl: string | null | undefined,
    teamName: string,
    branding?: TemplateBranding | null,
  ): string {
    const src =
      this.normalizeAssetUrl(logoUrl) ?? this.defaultTeamLogoUrl(branding);
    return `<img class="row-logo" src="${this.escapeHtml(
      src,
    )}" alt="${this.escapeHtml(teamName)} logo" />`;
  }

  private buildRankingTeamLogoHtml(
    logoUrl: string | null | undefined,
    teamName: string,
    branding?: TemplateBranding | null,
  ): string {
    const src =
      this.normalizeAssetUrl(logoUrl) ?? this.defaultTeamLogoUrl(branding);
    return `<img class="ranking-team-logo" src="${this.escapeHtml(
      src,
    )}" alt="${this.escapeHtml(teamName)} logo" />`;
  }

  private formatScheduleMapLabel(map?: string | null): string | null {
    if (!map) return null;
    const cleaned = String(map).replace(/_/g, ' ').trim();
    if (!cleaned) return null;
    return cleaned
      .split(/\s+/)
      .map((word) =>
        word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : '',
      )
      .join(' ');
  }

  private normalizeScheduleMatchLabel(match?: {
    matchNumber?: number | null;
    name?: string | null;
  }): string | null {
    if (!match) return null;
    const name =
      typeof match.name === 'string' && match.name.trim()
        ? match.name.trim()
        : null;
    const matchNumber =
      typeof match.matchNumber === 'number' &&
      Number.isFinite(match.matchNumber)
        ? match.matchNumber
        : null;

    if (name && matchNumber !== null) {
      const pattern = new RegExp(`\\bmatch\\s*0*${matchNumber}\\b`, 'i');
      if (pattern.test(name)) return name;
    }

    if (matchNumber !== null) {
      return `Match ${matchNumber.toString().padStart(2, '0')}`;
    }

    return name;
  }

  private firstUsableTeamLogoUrl(
    ...candidates: Array<string | null | undefined>
  ): string | null {
    for (const candidate of candidates) {
      const value = candidate?.trim();
      if (value) return value;
    }
    return null;
  }

  private normalizeMatchScheduleMapKey(map?: string | null): string {
    const raw = (map ?? '')
      .toString()
      .toLowerCase()
      .replace(/[_\s-]+/g, '');
    if (raw.includes('deston')) return 'deston';
    if (raw.includes('erangel')) return 'erangel';
    if (raw.includes('haven')) return 'haven';
    if (raw.includes('karakin')) return 'karakin';
    if (raw.includes('livik')) return 'livik';
    if (raw.includes('miramar')) return 'miramar';
    if (raw.includes('nusa')) return 'nusa';
    if (raw.includes('rondo')) return 'rondo';
    if (raw.includes('sanhok')) return 'sanhok';
    if (raw.includes('taego')) return 'taego';
    if (raw.includes('vikendi')) return 'vikendi';
    return 'erangel';
  }

  private matchScheduleSceneUrl(
    map?: string | null,
    occurrenceIndex = 0,
  ): string | null {
    const key = this.normalizeMatchScheduleMapKey(map);
    const scenes = MATCH_SCHEDULE_SCENES_BY_MAP[key] ?? null;
    if (!scenes?.length) return null;
    return this.normalizeWebAssetUrl(
      scenes[Math.abs(occurrenceIndex) % scenes.length],
    );
  }

  private matchScheduleScopeLabel(anchor: {
    tournament?: { name?: string | null; shortName?: string | null } | null;
    session?: { name?: string | null } | null;
    stage?: { name?: string | null } | null;
    group?: { name?: string | null } | null;
  }): string {
    return (
      anchor.group?.name?.trim() ||
      anchor.stage?.name?.trim() ||
      anchor.tournament?.shortName?.trim() ||
      anchor.tournament?.name?.trim() ||
      anchor.session?.name?.trim() ||
      'Match Schedule'
    );
  }

  private matchScheduleHasResult(status?: string | null): boolean {
    return status === MatchStatus.FINISHED || status === MatchStatus.ENDED;
  }

  private matchScheduleStatusLabel(status?: string | null): string {
    if (status === MatchStatus.LIVE) return 'Live';
    if (status === MatchStatus.FINISH_PENDING) return 'Pending Result';
    if (this.matchScheduleHasResult(status)) return 'Finished';
    return 'Scheduled';
  }

  private pickMatchScheduleDate(match?: {
    scheduledAt?: Date | null;
    startedAt?: Date | null;
    endedAt?: Date | null;
    createdAt?: Date | null;
  }): Date | null {
    return (
      match?.scheduledAt ??
      match?.startedAt ??
      match?.endedAt ??
      match?.createdAt ??
      null
    );
  }

  private buildMatchScheduleDayRange(
    value?: Date | null,
  ): { start: Date; end: Date } | null {
    if (!value || Number.isNaN(value.getTime())) return null;
    const start = new Date(value);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end };
  }

  private buildMatchScheduleDayWhere(
    range: { start: Date; end: Date } | null,
  ): Prisma.MatchWhereInput {
    if (!range) return {};
    return {
      OR: [
        { scheduledAt: { gte: range.start, lt: range.end } },
        {
          scheduledAt: null,
          startedAt: { gte: range.start, lt: range.end },
        },
        {
          scheduledAt: null,
          startedAt: null,
          endedAt: { gte: range.start, lt: range.end },
        },
        {
          scheduledAt: null,
          startedAt: null,
          endedAt: null,
          createdAt: { gte: range.start, lt: range.end },
        },
      ],
    };
  }

  private matchScheduleGridLayout(count: number) {
    const safeCount = Math.max(1, count);
    const rowCount = safeCount <= 6 ? 1 : safeCount <= 12 ? 2 : 3;
    const columnCount = Math.max(1, Math.ceil(safeCount / rowCount));
    return {
      rowCount,
      columnCount,
      gap: safeCount <= 6 ? 14 : 10,
      logoSize: safeCount <= 6 ? 70 : safeCount <= 12 ? 54 : 42,
      teamSize: safeCount <= 6 ? 22 : safeCount <= 12 ? 17 : 14,
      metaSize: safeCount <= 6 ? 12 : safeCount <= 12 ? 10 : 9,
      statSize: safeCount <= 6 ? 16 : safeCount <= 12 ? 13 : 11,
      cardPadding: safeCount <= 6 ? 16 : safeCount <= 12 ? 12 : 10,
      cardRadius: safeCount <= 12 ? 18 : 14,
    };
  }

  private configuredScheduleByNumber(
    entries: DiscordResultMatchScheduleEntry[],
  ) {
    return new Map(entries.map((entry) => [entry.matchNumber, entry]));
  }

  private applyConfiguredScheduleEntry(
    row: MatchScheduleRenderRow,
    entry: DiscordResultMatchScheduleEntry | undefined,
  ): MatchScheduleRenderRow {
    if (!entry) return row;
    return {
      ...row,
      matchLabel: entry.label?.trim() || row.matchLabel,
      map: entry.map?.trim() || row.map,
    };
  }

  private mergeConfiguredScheduleRows(
    rows: MatchScheduleRenderRow[],
    entries: DiscordResultMatchScheduleEntry[],
  ): MatchScheduleRenderRow[] {
    if (!entries.length) return rows;
    const byNumber = this.configuredScheduleByNumber(entries);
    const usedNumbers = new Set<number>();
    const merged = rows.map((row) => {
      usedNumbers.add(row.matchNumber);
      return this.applyConfiguredScheduleEntry(
        row,
        byNumber.get(row.matchNumber),
      );
    });

    for (const entry of entries) {
      if (usedNumbers.has(entry.matchNumber)) continue;
      usedNumbers.add(entry.matchNumber);
      merged.push({
        matchId: `configured-${entry.matchNumber}`,
        matchLabel: entry.label?.trim() || `Match ${entry.matchNumber}`,
        matchNumber: entry.matchNumber,
        map: entry.map?.trim() || null,
        status: MatchStatus.DRAFT,
        winnerTeamId: null,
        winnerTeamName: null,
        winnerTeamTag: null,
        winnerTeamLogoUrl: null,
        winnerKills: 0,
        winnerTotalPoints: 0,
      });
    }

    return merged.sort((left, right) => left.matchNumber - right.matchNumber);
  }

  private async buildMatchScheduleRowsFromBackups(
    anchorMatch: {
      organizationId: string;
      sessionId?: string | null;
    },
    scheduleEntries: DiscordResultMatchScheduleEntry[],
  ): Promise<MatchScheduleRenderRow[]> {
    if (!anchorMatch.sessionId) return [];
    const backups = await this.prisma.resultBackup.findMany({
      where: {
        organizationId: anchorMatch.organizationId,
        sessionId: anchorMatch.sessionId,
        kind: 'MATCH',
        expiresAt: { gt: new Date() },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 120,
      select: {
        id: true,
        sourceMatchId: true,
        matchNumber: true,
        matchName: true,
        title: true,
        createdAt: true,
        rows: {
          orderBy: [{ rank: 'asc' }],
          select: {
            rank: true,
            teamId: true,
            teamName: true,
            teamTag: true,
            logoUrl: true,
            placement: true,
            kills: true,
            totalPoints: true,
            placementPoints: true,
          },
        },
      },
    });
    const latestBackups = new Map<string, (typeof backups)[number]>();
    for (const backup of backups) {
      const key =
        backup.sourceMatchId?.trim() ||
        (typeof backup.matchNumber === 'number'
          ? `match-number:${backup.matchNumber}`
          : `backup:${backup.id}`);
      if (!latestBackups.has(key)) {
        latestBackups.set(key, backup);
      }
    }

    const scheduleByNumber = this.configuredScheduleByNumber(scheduleEntries);
    return Array.from(latestBackups.values())
      .sort((left, right) => {
        const leftNumber = left.matchNumber ?? Number.MAX_SAFE_INTEGER;
        const rightNumber = right.matchNumber ?? Number.MAX_SAFE_INTEGER;
        if (leftNumber !== rightNumber) return leftNumber - rightNumber;
        return left.createdAt.getTime() - right.createdAt.getTime();
      })
      .map((backup, index) => {
        const matchNumber =
          typeof backup.matchNumber === 'number' &&
          Number.isFinite(backup.matchNumber)
            ? backup.matchNumber
            : index + 1;
        const entry = scheduleByNumber.get(matchNumber);
        const winner =
          backup.rows.find((row) => row.placement === 1) ??
          backup.rows.find((row) => row.rank === 1) ??
          backup.rows[0] ??
          null;
        const label =
          entry?.label?.trim() ||
          backup.matchName?.trim() ||
          backup.title?.trim() ||
          `Match ${matchNumber}`;
        const winnerKills = Math.max(0, winner?.kills ?? 0);
        const winnerTotalPoints = Math.max(
          0,
          winner?.totalPoints ?? (winner?.placementPoints ?? 0) + winnerKills,
        );
        return {
          matchId: backup.sourceMatchId ?? backup.id,
          matchLabel: label,
          matchNumber,
          map: entry?.map?.trim() || null,
          status: MatchStatus.FINISHED,
          winnerTeamId: winner?.teamId ?? null,
          winnerTeamName: winner?.teamName ?? null,
          winnerTeamTag: winner?.teamTag ?? null,
          winnerTeamLogoUrl: winner?.logoUrl ?? null,
          winnerKills,
          winnerTotalPoints,
        };
      });
  }

  private async buildMatchScheduleRenderData(
    match: RenderMatchMeta,
    scheduleEntries: DiscordResultMatchScheduleEntry[] = [],
  ): Promise<MatchScheduleRenderData> {
    const anchorMatch = await this.prisma.match.findFirst({
      where: { id: match.id, deletedAt: null },
      select: {
        id: true,
        status: true,
        tournamentId: true,
        sessionId: true,
        organizationId: true,
        stageId: true,
        groupId: true,
        name: true,
        matchNumber: true,
        scheduledAt: true,
        startedAt: true,
        endedAt: true,
        createdAt: true,
        updatedAt: true,
        tournament: {
          select: { name: true, shortName: true, organizationId: true },
        },
        session: { select: { name: true, organizationId: true } },
        stage: { select: { name: true } },
        group: { select: { name: true } },
      },
    });

    if (!anchorMatch) {
      throw new NotFoundException('Match not found');
    }

    const scopeId =
      anchorMatch.groupId ??
      anchorMatch.stageId ??
      anchorMatch.tournamentId ??
      anchorMatch.sessionId ??
      anchorMatch.id;
    const scopeWhere: Prisma.MatchWhereInput = anchorMatch.groupId
      ? { groupId: scopeId }
      : anchorMatch.stageId
        ? { stageId: scopeId }
        : anchorMatch.tournamentId
          ? { tournamentId: scopeId }
          : anchorMatch.sessionId
            ? { sessionId: scopeId }
            : { id: scopeId };
    const scheduleDayWhere = this.buildMatchScheduleDayWhere(
      this.buildMatchScheduleDayRange(this.pickMatchScheduleDate(anchorMatch)),
    );

    const matches = await this.prisma.match.findMany({
      where: {
        ...scopeWhere,
        ...scheduleDayWhere,
        organizationId: anchorMatch.organizationId,
        deletedAt: null,
        status: { in: MATCH_SCHEDULE_STATUSES },
      },
      orderBy: [
        { matchNumber: 'asc' },
        { scheduledAt: 'asc' },
        { startedAt: 'asc' },
        { createdAt: 'asc' },
      ],
      select: {
        id: true,
        status: true,
        name: true,
        matchNumber: true,
        map: true,
        scheduledAt: true,
        startedAt: true,
        updatedAt: true,
        endedAt: true,
        createdAt: true,
        controlState: { select: { metaJson: true } },
        slotResults: {
          where: { teamId: { not: null }, wasPresentInMatch: true },
          orderBy: [
            { placement: 'asc' },
            { finalPlacement: 'asc' },
            { totalPoints: 'desc' },
            { totalKills: 'desc' },
            { slotNumber: 'asc' },
          ],
          select: {
            slotNumber: true,
            teamId: true,
            wasPresentInMatch: true,
            placement: true,
            finalPlacement: true,
            totalKills: true,
            totalPoints: true,
            points: true,
            placementPoints: true,
            team: {
              select: {
                id: true,
                name: true,
                tag: true,
                logoUrl: true,
                logoLightUrl: true,
                logoDarkUrl: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    });

    const scheduleByNumber = this.configuredScheduleByNumber(scheduleEntries);
    let rows: MatchScheduleRenderRow[] = matches.map((scheduleMatch, index) => {
      const controlMeta =
        (scheduleMatch.controlState?.metaJson as {
          winnerTeamId?: string | null;
        } | null) ?? null;
      const appliedSlotResults = scheduleMatch.slotResults.filter(
        (slotResult) =>
          isPresentInMatch(slotResult.wasPresentInMatch) &&
          hasAppliedResultRow(slotResult),
      );
      const matchHasResult =
        this.matchScheduleHasResult(scheduleMatch.status) ||
        appliedSlotResults.length > 0;
      const winner = matchHasResult
        ? ((controlMeta?.winnerTeamId
            ? appliedSlotResults.find(
                (slotResult) => slotResult.teamId === controlMeta.winnerTeamId,
              )
            : null) ??
          appliedSlotResults.find(
            (slotResult) =>
              slotResult.placement === 1 || slotResult.finalPlacement === 1,
          ) ??
          appliedSlotResults[0] ??
          null)
        : null;
      const winnerLogoUrl = winner?.team
        ? resolveTeamLogoUrl({
            logoUrl: this.firstUsableTeamLogoUrl(
              winner.team.logoUrl,
              winner.team.logoLightUrl,
              winner.team.logoDarkUrl,
            ),
            logoUpdatedAt: winner.team.updatedAt,
            updatedAt: winner.team.updatedAt,
          })
        : null;
      const winnerKills = Math.max(0, winner?.totalKills ?? 0);
      const winnerTotalPoints = Math.max(
        0,
        winner?.totalPoints ??
          winner?.points ??
          (winner?.placementPoints ?? 0) + winnerKills,
      );
      const matchNumber =
        typeof scheduleMatch.matchNumber === 'number' &&
        Number.isFinite(scheduleMatch.matchNumber)
          ? scheduleMatch.matchNumber
          : index + 1;
      const scheduleEntry = scheduleByNumber.get(matchNumber);

      return {
        matchId: scheduleMatch.id,
        matchLabel:
          scheduleEntry?.label?.trim() ||
          (this.normalizeScheduleMatchLabel(scheduleMatch) ??
            `Match ${matchNumber.toString().padStart(2, '0')}`),
        matchNumber,
        map:
          scheduleEntry?.map?.trim() ||
          this.formatScheduleMapLabel(scheduleMatch.map),
        status: matchHasResult ? MatchStatus.FINISHED : scheduleMatch.status,
        winnerTeamId: winner?.teamId ?? null,
        winnerTeamName: winner?.team?.name ?? null,
        winnerTeamTag: winner?.team?.tag ?? null,
        winnerTeamLogoUrl: winnerLogoUrl,
        winnerKills,
        winnerTotalPoints,
      };
    });
    if (!rows.length) {
      rows = await this.buildMatchScheduleRowsFromBackups(
        anchorMatch,
        scheduleEntries,
      );
    }
    rows = this.mergeConfiguredScheduleRows(rows, scheduleEntries);

    const anchorMatchLabel =
      this.normalizeScheduleMatchLabel(anchorMatch) ?? `Match ${match.id}`;
    const tournamentLabel =
      anchorMatch.tournament?.shortName?.trim() ||
      anchorMatch.tournament?.name?.trim() ||
      anchorMatch.session?.name?.trim() ||
      null;
    const completedCount = rows.filter(
      (row) =>
        Boolean(row.winnerTeamId) ||
        Boolean(row.winnerTeamName?.trim()) ||
        Boolean(row.winnerTeamTag?.trim()),
    ).length;
    const footer = rows.length
      ? completedCount === rows.length
        ? `${completedCount} completed match${completedCount === 1 ? '' : 'es'}`
        : completedCount > 0
          ? `${completedCount} completed of ${rows.length} scheduled matches`
          : `${rows.length} scheduled match${rows.length === 1 ? '' : 'es'}`
      : 'Waiting for scheduled matches';

    return {
      scopeLabel: this.matchScheduleScopeLabel(anchorMatch),
      tournamentLabel,
      anchorMatchLabel,
      rows,
      footer,
    };
  }

  buildDiscordMatchScheduleHtml(
    input: MatchScheduleTemplateInput,
  ): Promise<string> {
    const visibleRows = input.data.rows.slice(0, MATCH_SCHEDULE_RENDER_LIMIT);
    const layout = this.matchScheduleGridLayout(visibleRows.length || 1);
    const logoHtml = this.buildLogoHtml(input.branding);
    const primary =
      this.hexColorValue(input.branding.primaryColor) ?? '#00e5ff';
    const accent =
      this.hexColorValue(input.branding.accent ?? '') ??
      this.hexColorValue(input.branding.secondaryColor ?? '') ??
      primary;
    const primarySoft = this.rgbaFromHexColor(primary, 0.32) ?? primary;
    const accentSoft = this.rgbaFromHexColor(accent, 0.28) ?? accent;
    const panelSurface = this.brandingPanelSurface(input.branding);
    const sceneOccurrences = new Map<string, number>();

    const rowsHtml = visibleRows
      .map((row, index) => {
        const mapKey = this.normalizeMatchScheduleMapKey(row.map);
        const occurrence = sceneOccurrences.get(mapKey) ?? 0;
        sceneOccurrences.set(mapKey, occurrence + 1);
        const sceneUrl = this.matchScheduleSceneUrl(row.map, occurrence);
        const tone = index % 2 === 0 ? primary : accent;
        const toneSoft =
          this.rgbaFromHexColor(tone, index % 2 === 0 ? 0.34 : 0.3) ??
          primarySoft;
        const hasResult = this.matchScheduleHasResult(row.status);
        const statusLabel = this.matchScheduleStatusLabel(row.status);
        const winnerTitle = hasResult
          ? row.winnerTeamTag?.trim() ||
            row.winnerTeamName?.trim() ||
            'Winner pending'
          : statusLabel;
        const winnerDetail = hasResult
          ? row.winnerTeamTag?.trim() && row.winnerTeamName?.trim()
            ? row.winnerTeamName.trim()
            : row.winnerTeamId
              ? 'Winner'
              : 'Winner pending'
          : row.matchLabel?.trim() || 'Match not finished';
        const logoUrl =
          this.normalizeAssetUrl(row.winnerTeamLogoUrl) ??
          this.defaultTeamLogoUrl(input.branding);
        const matchNumber = row.matchNumber ?? index + 1;
        const matchBadge = row.matchLabel?.trim() || `M${matchNumber}`;
        const sceneStyle = sceneUrl
          ? ` style="background-image:url('${this.cssUrl(sceneUrl)}')"`
          : '';

        return `
          <article class="schedule-card" style="--tone:${this.escapeHtml(
            tone,
          )};--tone-soft:${this.escapeHtml(toneSoft)}">
            <div class="scene"${sceneStyle}></div>
            <div class="scene-tint"></div>
            <div class="match-meta">
              <span>${this.escapeHtml(matchBadge)}</span>
              <strong>${this.escapeHtml(row.map ?? 'Map TBA')}</strong>
            </div>
            <div class="winner">
              <img class="winner-logo" src="${this.escapeHtml(
                logoUrl,
              )}" alt="${this.escapeHtml(winnerTitle)} logo" />
              <div class="winner-copy">
                <div class="winner-label">${this.escapeHtml(
                  hasResult ? 'Winner' : 'Status',
                )}</div>
                <div class="winner-name">${this.escapeHtml(winnerTitle)}</div>
                <div class="winner-detail">${this.escapeHtml(
                  winnerDetail,
                )}</div>
              </div>
            </div>
            <div class="stats">
              <span>${this.escapeHtml(
                hasResult ? `${row.winnerKills} K` : statusLabel,
              )}</span>
              <span>${this.escapeHtml(
                hasResult ? `${row.winnerTotalPoints} PTS` : 'PTS TBD',
              )}</span>
            </div>
          </article>
        `.trim();
      })
      .join('\n');
    const emptyHtml = !visibleRows.length
      ? `<div class="empty">No scheduled matches yet</div>`
      : '';
    const footer =
      input.data.rows.length > visibleRows.length
        ? `Showing ${visibleRows.length} of ${input.data.rows.length} scheduled matches`
        : input.data.footer;

    return Promise.resolve(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      ${this.brandingFontCssImport(input.branding)}
      * { box-sizing: border-box; }
      html, body {
        width: ${MATCH_VIEWPORT.width}px;
        height: ${MATCH_VIEWPORT.height}px;
        margin: 0;
        overflow: hidden;
        background: transparent;
      }
      body {
        font-family: ${this.brandingFontFamily(input.branding)};
        color: ${this.escapeHtml(input.branding.textPrimary)};
      }
      .frame {
        position: relative;
        width: ${MATCH_VIEWPORT.width}px;
        height: ${MATCH_VIEWPORT.height}px;
        padding: ${input.branding.safeArea.top}px ${input.branding.safeArea.right}px ${input.branding.safeArea.bottom}px ${input.branding.safeArea.left}px;
        overflow: hidden;
        background: ${this.escapeHtml(input.branding.background)};
      }
      .frame::before {
        content: "";
        position: absolute;
        inset: 0;
        background:
          radial-gradient(circle at 16% 20%, ${this.escapeHtml(
            primarySoft,
          )} 0, transparent 30%),
          radial-gradient(circle at 82% 18%, ${this.escapeHtml(
            accentSoft,
          )} 0, transparent 28%),
          linear-gradient(135deg, rgba(0,0,0,0.32), rgba(0,0,0,0.64));
        pointer-events: none;
      }
      .sheet {
        position: relative;
        z-index: 2;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .header {
        min-height: 104px;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto;
        align-items: start;
        gap: 18px;
      }
      .eyebrow {
        display: inline-flex;
        width: max-content;
        max-width: 100%;
        padding: 8px 13px;
        border-radius: 999px;
        background: linear-gradient(90deg, ${this.escapeHtml(
          primary,
        )}, ${this.escapeHtml(accent)});
        color: #020617;
        font-size: 13px;
        font-weight: 900;
        line-height: 1;
        text-transform: uppercase;
        letter-spacing: 0;
      }
      .title {
        margin-top: 10px;
        font-size: 52px;
        line-height: 0.92;
        font-weight: 950;
        text-transform: uppercase;
        letter-spacing: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-shadow: 0 10px 28px rgba(0,0,0,0.45);
      }
      .subtitle {
        margin-top: 8px;
        color: ${this.escapeHtml(input.branding.textMuted)};
        font-size: 16px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0;
      }
      .summary {
        min-width: 148px;
        padding: 14px 18px;
        border: 1px solid ${this.escapeHtml(input.branding.border)};
        border-radius: 18px;
        background: ${this.escapeHtml(panelSurface)};
        text-align: right;
        box-shadow: ${this.escapeHtml(input.branding.shadow)};
      }
      .summary strong {
        display: block;
        color: ${this.escapeHtml(primary)};
        font-size: 34px;
        line-height: 0.9;
      }
      .summary span {
        display: block;
        margin-top: 7px;
        color: ${this.escapeHtml(input.branding.textMuted)};
        font-size: 10px;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 0;
      }
      .brand-logo {
        width: 76px;
        height: 76px;
        object-fit: contain;
        border-radius: 18px;
        padding: 8px;
        border: 1px solid ${this.escapeHtml(input.branding.border)};
        background: ${this.escapeHtml(input.branding.panel)};
      }
      .brand-logo--empty { display: none; }
      .grid {
        flex: 1;
        min-height: 0;
        display: grid;
        grid-template-columns: repeat(${layout.columnCount}, minmax(0, 1fr));
        grid-template-rows: repeat(${layout.rowCount}, minmax(0, 1fr));
        gap: ${layout.gap}px;
      }
      .schedule-card {
        position: relative;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
        border-radius: ${layout.cardRadius}px;
        border: 1px solid color-mix(in srgb, var(--tone) 54%, rgba(255,255,255,0.18));
        background: ${this.escapeHtml(panelSurface)};
        box-shadow: 0 16px 40px rgba(0,0,0,0.36);
        padding: ${layout.cardPadding}px;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        gap: ${Math.max(7, layout.gap - 2)}px;
      }
      .scene,
      .scene-tint {
        position: absolute;
        inset: 0;
      }
      .scene {
        background-size: cover;
        background-position: center;
        transform: scale(1.04);
        filter: saturate(1.1) contrast(1.05);
      }
      .scene-tint {
        background:
          linear-gradient(180deg, rgba(2,6,23,0.18), rgba(2,6,23,0.84)),
          linear-gradient(135deg, var(--tone-soft), rgba(2,6,23,0.26) 48%, rgba(2,6,23,0.72));
      }
      .match-meta,
      .winner,
      .stats {
        position: relative;
        z-index: 1;
      }
      .match-meta {
        position: absolute;
        top: ${layout.cardPadding}px;
        left: ${layout.cardPadding}px;
        right: ${layout.cardPadding}px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-size: ${layout.metaSize}px;
        font-weight: 950;
        text-transform: uppercase;
        color: ${this.escapeHtml(input.branding.textMuted)};
      }
      .match-meta span {
        padding: 5px 8px;
        border-radius: 999px;
        background: rgba(2,6,23,0.66);
        color: ${this.escapeHtml(primary)};
      }
      .match-meta strong {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: ${this.escapeHtml(input.branding.textPrimary)};
      }
      .winner {
        display: flex;
        align-items: center;
        gap: ${Math.max(9, layout.cardPadding - 2)}px;
      }
      .winner-logo {
        width: ${layout.logoSize}px;
        height: ${layout.logoSize}px;
        flex: 0 0 ${layout.logoSize}px;
        object-fit: contain;
        border-radius: ${Math.max(10, Math.round(layout.logoSize * 0.22))}px;
        padding: ${visibleRows.length <= 12 ? 7 : 5}px;
        border: 1px solid rgba(255,255,255,0.18);
        background: rgba(15,23,42,0.78);
      }
      .winner-copy {
        min-width: 0;
      }
      .winner-label {
        color: ${this.escapeHtml(primary)};
        font-size: ${layout.metaSize}px;
        font-weight: 950;
        text-transform: uppercase;
      }
      .winner-name {
        margin-top: 3px;
        color: ${this.escapeHtml(input.branding.textPrimary)};
        font-size: ${layout.teamSize}px;
        font-weight: 950;
        line-height: 1;
        text-transform: uppercase;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .winner-detail {
        margin-top: 4px;
        color: ${this.escapeHtml(input.branding.textMuted)};
        font-size: ${layout.metaSize}px;
        font-weight: 800;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .stats {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .stats span {
        min-width: 0;
        padding: 6px 9px;
        border-radius: 999px;
        background: rgba(2,6,23,0.66);
        color: ${this.escapeHtml(input.branding.textPrimary)};
        font-size: ${layout.statSize}px;
        font-weight: 950;
        line-height: 1;
      }
      .empty {
        grid-column: 1 / -1;
        min-height: 260px;
        display: grid;
        place-items: center;
        border-radius: 18px;
        border: 1px solid ${this.escapeHtml(input.branding.border)};
        background: ${this.escapeHtml(input.branding.panel)};
        color: ${this.escapeHtml(input.branding.textMuted)};
        font-size: 22px;
        font-weight: 900;
        text-transform: uppercase;
      }
      .footer {
        height: 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        color: ${this.escapeHtml(input.branding.textMuted)};
        font-size: 12px;
        font-weight: 900;
        text-transform: uppercase;
      }
      .footer strong {
        color: ${this.escapeHtml(accent)};
      }
    </style>
  </head>
  <body>
    <main class="frame">
      <section class="sheet">
        <header class="header">
          <div class="headline">
            <div class="eyebrow">${this.escapeHtml(input.eyebrow)}</div>
            <div class="title">${this.escapeHtml(input.title)}</div>
            <div class="subtitle">${this.escapeHtml(input.subtitle)}</div>
          </div>
          <div class="summary">
            <strong>${visibleRows.length}</strong>
            <span>Completed</span>
          </div>
          ${logoHtml}
        </header>
        <section class="grid">
          ${rowsHtml}
          ${emptyHtml}
        </section>
        <footer class="footer">
          <span>${this.escapeHtml(
            input.data.tournamentLabel ?? input.data.anchorMatchLabel,
          )}</span>
          <strong>${this.escapeHtml(footer)}</strong>
        </footer>
      </section>
      ${input.overlayLayersHtml ?? ''}
    </main>
  </body>
</html>`);
  }

  private rankingDisplayRank(rank: string | number): string {
    const value = String(rank).trim();
    return value.startsWith('#') ? value.slice(1) : value;
  }

  private rankingTableLayout(rowCount: number): RankingTableLayout {
    const groupColumns = rowCount > 1 ? 2 : 1;
    const rowsPerGroup = Math.max(1, Math.ceil(rowCount / groupColumns));

    if (rowsPerGroup <= 7) {
      return {
        groupColumns,
        rowHeight: 48,
        rowGap: 7,
        groupGap: 28,
        headerHeight: 38,
        headerFontSize: 14,
        titleSize: 58,
        headingHeight: 118,
        shellGap: 18,
        logoSize: 34,
        teamFontSize: 20,
        metricFontSize: 18,
        rowRadius: 8,
      };
    }

    if (rowsPerGroup <= 10) {
      return {
        groupColumns,
        rowHeight: 39,
        rowGap: 5,
        groupGap: 24,
        headerHeight: 36,
        headerFontSize: 13,
        titleSize: 54,
        headingHeight: 112,
        shellGap: 15,
        logoSize: 30,
        teamFontSize: 18,
        metricFontSize: 17,
        rowRadius: 7,
      };
    }

    return {
      groupColumns,
      rowHeight: 28,
      rowGap: 3,
      groupGap: 20,
      headerHeight: 32,
      headerFontSize: 11,
      titleSize: 48,
      headingHeight: 96,
      shellGap: 12,
      logoSize: 23,
      teamFontSize: 15,
      metricFontSize: 14,
      rowRadius: 5,
    };
  }

  private defaultRankingTableColumns(
    groupColumns: number,
  ): DiscordRankingTableColumn[] {
    const twoColumn = groupColumns > 1;
    return [
      {
        id: 'rank',
        field: 'rank',
        label: 'Rank',
        width: twoColumn ? 46 : 70,
        align: 'center',
        enabled: true,
      },
      {
        id: 'team',
        field: 'team',
        label: 'Team Name',
        width: twoColumn ? 260 : 710,
        align: 'left',
        enabled: true,
      },
      {
        id: 'wwcd',
        field: 'wwcd',
        label: 'WWCD',
        width: twoColumn ? 40 : 64,
        align: 'center',
        enabled: true,
      },
      {
        id: 'placementPoints',
        field: 'placementPoints',
        label: 'PP',
        width: twoColumn ? 42 : 64,
        align: 'center',
        enabled: true,
      },
      {
        id: 'kills',
        field: 'kills',
        label: 'KP',
        width: twoColumn ? 42 : 64,
        align: 'center',
        enabled: true,
      },
      {
        id: 'totalPoints',
        field: 'totalPoints',
        label: 'TP',
        width: twoColumn ? 44 : 64,
        align: 'center',
        enabled: true,
      },
    ];
  }

  private defaultDiscordRankingTableLayout(
    kind: DiscordRankingTableKind,
    rowCount: number,
    branding: TemplateBranding | null,
  ): DiscordRankingTableLayout {
    const base = this.rankingTableLayout(rowCount);
    const safeArea = branding?.safeArea ?? this.defaultDiscordWidgetSafeArea();
    const contentWidth = MATCH_VIEWPORT.width - safeArea.left - safeArea.right;
    const contentHeight =
      MATCH_VIEWPORT.height - safeArea.top - safeArea.bottom;
    const tableY = base.headingHeight + base.shellGap;
    const tableHeight = Math.max(80, contentHeight - tableY);
    const maxRows = kind === 'overall-ranking' ? 25 : 25;

    return {
      tableX: 0,
      tableY,
      tableWidth: contentWidth,
      tableHeight,
      titleHeight: base.headingHeight,
      titleSize: base.titleSize,
      groupColumns: base.groupColumns,
      groupGap: base.groupGap,
      maxRows,
      rowHeight: base.rowHeight,
      rowGap: base.rowGap,
      rowRadius: base.rowRadius,
      headerHeight: base.headerHeight,
      headerFontSize: base.headerFontSize,
      logoSize: base.logoSize,
      teamFontSize: base.teamFontSize,
      metricFontSize: base.metricFontSize,
      columns: this.defaultRankingTableColumns(base.groupColumns),
    };
  }

  private resolveRankingTableLayout(
    template: DiscordWidgetTemplateSettings | null,
    kind: DiscordRankingTableKind,
    rowCount: number,
    branding: TemplateBranding,
  ): DiscordRankingTableLayout {
    const fallback = this.defaultDiscordRankingTableLayout(
      kind,
      rowCount,
      branding,
    );
    const saved = template?.rankingTables[kind];
    if (!saved) return fallback;

    return {
      ...fallback,
      ...saved,
      columns: saved.columns.length ? saved.columns : fallback.columns,
    };
  }

  private rankingTableColumnTemplate(
    columns: DiscordRankingTableColumn[],
  ): string {
    return columns.map((column) => `${column.width}px`).join(' ');
  }

  private rankingTableRowsHeight(
    rowsPerGroup: number,
    layout: Pick<
      DiscordRankingTableLayout,
      'headerHeight' | 'rowHeight' | 'rowGap'
    >,
  ) {
    return (
      layout.headerHeight +
      rowsPerGroup * layout.rowHeight +
      rowsPerGroup * layout.rowGap
    );
  }

  private rankingColumnMinWidth(field: DiscordRankingTableField) {
    if (field === 'team') return 128;
    if (field === 'rank') return 28;
    return 30;
  }

  private fitRankingTableColumns(
    layout: DiscordRankingTableLayout,
  ): DiscordRankingTableLayout {
    const columns = layout.columns.map((column) => ({ ...column }));
    const enabledIndexes = columns
      .map((column, index) => (column.enabled ? index : -1))
      .filter((index) => index >= 0);
    if (enabledIndexes.length <= 1) {
      return { ...layout, columns };
    }

    const groupWidth =
      (layout.tableWidth - layout.groupGap * (layout.groupColumns - 1)) /
      layout.groupColumns;
    const fixedWidth =
      RANKING_TABLE_HORIZONTAL_PADDING +
      RANKING_TABLE_CELL_GAP * (enabledIndexes.length - 1);
    const availableColumnsWidth = Math.floor(groupWidth - fixedWidth);
    const currentColumnsWidth = enabledIndexes.reduce(
      (sum, index) => sum + columns[index].width,
      0,
    );

    if (
      availableColumnsWidth <= 0 ||
      currentColumnsWidth <= availableColumnsWidth
    ) {
      return { ...layout, columns };
    }

    const scale = availableColumnsWidth / currentColumnsWidth;
    for (const index of enabledIndexes) {
      const column = columns[index];
      columns[index] = {
        ...column,
        width: Math.max(
          this.rankingColumnMinWidth(column.field),
          Math.floor(column.width * scale),
        ),
      };
    }

    let overflow =
      enabledIndexes.reduce((sum, index) => sum + columns[index].width, 0) -
      availableColumnsWidth;
    while (overflow > 0) {
      const shrinkIndex = enabledIndexes
        .map((index) => ({
          index,
          extra:
            columns[index].width -
            this.rankingColumnMinWidth(columns[index].field),
        }))
        .filter((entry) => entry.extra > 0)
        .sort((left, right) => right.extra - left.extra)[0]?.index;
      if (shrinkIndex === undefined) break;
      columns[shrinkIndex] = {
        ...columns[shrinkIndex],
        width: columns[shrinkIndex].width - 1,
      };
      overflow -= 1;
    }

    return { ...layout, columns };
  }

  private fitRankingTableLayout(
    layout: DiscordRankingTableLayout,
    rowCount: number,
    branding: TemplateBranding,
  ): DiscordRankingTableLayout {
    const next: DiscordRankingTableLayout = {
      ...layout,
      columns: layout.columns.map((column) => ({ ...column })),
    };
    const visibleRows = Math.min(rowCount, next.maxRows);
    next.groupColumns = Math.max(
      1,
      Math.min(next.groupColumns, visibleRows || 1),
    );

    const contentHeight =
      MATCH_VIEWPORT.height - branding.safeArea.top - branding.safeArea.bottom;
    const maxTableHeight = Math.max(
      80,
      contentHeight - next.tableY - RANKING_TABLE_FOOTER_RESERVE,
    );
    next.tableHeight = Math.min(maxTableHeight, Math.max(80, next.tableHeight));

    if (!visibleRows) {
      return this.fitRankingTableColumns(next);
    }

    const rowsPerGroup = Math.max(
      1,
      Math.ceil(visibleRows / next.groupColumns),
    );
    let requiredHeight = this.rankingTableRowsHeight(rowsPerGroup, next);
    if (
      requiredHeight > next.tableHeight &&
      next.tableHeight < maxTableHeight
    ) {
      next.tableHeight = Math.min(maxTableHeight, requiredHeight);
    }

    requiredHeight = this.rankingTableRowsHeight(rowsPerGroup, next);
    if (requiredHeight > next.tableHeight) {
      next.rowGap = Math.max(
        RANKING_TABLE_MIN_ROW_GAP,
        Math.min(next.rowGap, rowsPerGroup >= 12 ? 2 : 3),
      );
      next.headerHeight = Math.max(
        RANKING_TABLE_MIN_HEADER_HEIGHT,
        Math.min(next.headerHeight, rowsPerGroup >= 12 ? 28 : 32),
      );

      const rowHeight = Math.floor(
        (next.tableHeight - next.headerHeight - rowsPerGroup * next.rowGap) /
          rowsPerGroup,
      );
      next.rowHeight = Math.max(
        RANKING_TABLE_MIN_ROW_HEIGHT,
        Math.min(next.rowHeight, rowHeight),
      );
      next.logoSize = Math.min(next.logoSize, Math.max(12, next.rowHeight - 6));
      next.teamFontSize = Math.min(
        next.teamFontSize,
        Math.max(9, Math.floor(next.rowHeight * 0.56)),
      );
      next.metricFontSize = Math.min(
        next.metricFontSize,
        Math.max(9, Math.floor(next.rowHeight * 0.54)),
      );
      next.headerFontSize = Math.min(
        next.headerFontSize,
        Math.max(8, Math.floor(next.headerHeight * 0.36)),
      );
    }

    requiredHeight = this.rankingTableRowsHeight(rowsPerGroup, next);
    if (requiredHeight > next.tableHeight) {
      const perRowHeight = next.rowHeight + next.rowGap;
      const capacityPerGroup = Math.max(
        1,
        Math.floor((next.tableHeight - next.headerHeight) / perRowHeight),
      );
      next.maxRows = Math.max(
        1,
        Math.min(next.maxRows, capacityPerGroup * next.groupColumns),
      );
    }

    return this.fitRankingTableColumns(next);
  }

  private rankingCellAlignClass(align: 'left' | 'center' | 'right'): string {
    if (align === 'right') return 'ranking-cell--right';
    if (align === 'center') return 'ranking-cell--center';
    return 'ranking-cell--left';
  }

  private buildRankingTableHeaderHtml(
    columns: DiscordRankingTableColumn[],
  ): string {
    return `
      <div class="ranking-table-header">
        ${columns
          .map(
            (column) =>
              `<div class="ranking-cell ranking-header-cell ${this.rankingCellAlignClass(
                column.align,
              )}">${this.escapeHtml(column.label)}</div>`,
          )
          .join('')}
      </div>
    `.trim();
  }

  private rankingTableValue(
    row: RankingTableRow,
    field: DiscordRankingTableField,
  ): string | number {
    if (field === 'rank') return this.rankingDisplayRank(row.rank);
    if (field === 'team') return row.teamName;
    if (field === 'wwcd') return row.wwcd;
    if (field === 'placementPoints') return row.placementPoints;
    if (field === 'kills') return row.kills;
    return row.totalPoints;
  }

  private buildRankingTableCellHtml(
    row: RankingTableRow,
    column: DiscordRankingTableColumn,
    branding: TemplateBranding,
  ): string {
    const alignClass = this.rankingCellAlignClass(column.align);
    if (column.field === 'team') {
      return `
        <div class="ranking-cell ranking-cell--team ${alignClass}">
          <div class="ranking-team">
            ${this.buildRankingTeamLogoHtml(row.logoUrl, row.teamName, branding)}
            <div class="ranking-team-name">${this.escapeHtml(row.teamName)}</div>
          </div>
        </div>
      `.trim();
    }

    const value = this.rankingTableValue(row, column.field);
    const totalClass =
      column.field === 'totalPoints' ? ' ranking-cell--total' : '';
    return `<div class="ranking-cell ${alignClass}${totalClass}">${this.escapeHtml(
      value,
    )}</div>`;
  }

  private buildRankingTableRowHtml(
    row: RankingTableRow,
    columns: DiscordRankingTableColumn[],
    branding: TemplateBranding,
  ): string {
    return `
      <div class="ranking-table-row">
        ${columns
          .map((column) =>
            this.buildRankingTableCellHtml(row, column, branding),
          )
          .join('')}
      </div>
    `.trim();
  }

  private buildRankingTableGroupsHtml(
    rows: RankingTableRow[],
    layout: DiscordRankingTableLayout,
    emptyText: string,
    branding: TemplateBranding,
  ): string {
    const columns = layout.columns.filter((column) => column.enabled);
    if (!columns.length) {
      return `<div class="ranking-empty">${this.escapeHtml(emptyText)}</div>`;
    }
    const visibleRows = rows.slice(0, layout.maxRows);
    if (!rows.length) {
      return `<div class="ranking-empty">${this.escapeHtml(emptyText)}</div>`;
    }

    const rowsPerGroup = Math.ceil(visibleRows.length / layout.groupColumns);
    const headerHtml = this.buildRankingTableHeaderHtml(columns);
    return Array.from({ length: layout.groupColumns })
      .map((_, groupIndex) => {
        const groupRows = visibleRows.slice(
          groupIndex * rowsPerGroup,
          groupIndex * rowsPerGroup + rowsPerGroup,
        );
        const groupRowsHtml = groupRows
          .map((row) => this.buildRankingTableRowHtml(row, columns, branding))
          .join('\n');
        return `
          <div class="ranking-table-group">
            ${headerHtml}
            ${groupRowsHtml}
          </div>
        `.trim();
      })
      .join('\n');
  }

  private rankingTableBranding(branding: TemplateBranding): TemplateBranding {
    return {
      ...branding,
      background: branding.background,
      logoUrl: null,
      defaultTeamLogoUrl: branding.defaultTeamLogoUrl,
    };
  }

  private brandingPrimarySurface(branding: TemplateBranding): string {
    return (
      branding.primarySurface ??
      this.primarySurface(
        branding.primaryColor,
        branding.secondaryColor ?? branding.accent,
      )
    );
  }

  private brandingPanelSurface(branding: TemplateBranding): string {
    return (
      branding.panelSurface ??
      this.panelSurface(branding.panel, branding.primaryColor)
    );
  }

  private buildPlayerPhotoHtml(
    photoUrl: string | null | undefined,
    playerName: string,
  ): string {
    const src =
      this.normalizeAssetUrl(photoUrl) ?? this.defaultPlayerPhotoUrl();
    return `<img class="player-photo" src="${this.escapeHtml(
      src,
    )}" alt="${this.escapeHtml(playerName)} photo" />`;
  }

  private buildPlayerTeamLogoHtml(
    logoUrl: string | null | undefined,
    label: string,
    branding?: TemplateBranding | null,
  ): string {
    const src =
      this.normalizeAssetUrl(logoUrl) ?? this.defaultTeamLogoUrl(branding);
    return `<img class="player-team-logo" src="${this.escapeHtml(
      src,
    )}" alt="${this.escapeHtml(label)} logo" />`;
  }

  private buildLeaderboardRows(input: LeaderboardTemplateInput): {
    rowsHtml: string;
    footer: string;
  } {
    if (!input.rows.length) {
      return {
        rowsHtml: `<div class="empty">${this.escapeHtml(
          input.emptyText ?? 'No result data yet',
        )}</div>`,
        footer: input.footer ?? 'No rows available',
      };
    }

    if (input.mode === 'overall-ranking') {
      const rowsHtml = input.rows
        .map((row) =>
          `
            <div class="row row--ranking row--overall-ranking">
              <div class="row-rank">${this.escapeHtml(row.rank)}</div>
              ${this.buildTeamLogoHtml(row.logoUrl, row.title, input.branding)}
              <div class="row-title">${this.escapeHtml(row.title)}</div>
              <div class="row-stat">${this.escapeHtml(row.wwcd ?? 0)}</div>
              <div class="row-stat">${this.escapeHtml(row.kills ?? 0)}</div>
              <div class="row-stat">${this.escapeHtml(row.placementPoints ?? 0)}</div>
              <div class="row-total">${this.escapeHtml(row.totalPoints ?? 0)}</div>
            </div>
          `.trim(),
        )
        .join('\n');

      return {
        rowsHtml,
        footer: input.footer ?? `Showing ${input.rows.length} rows`,
      };
    }

    const rowsHtml = input.rows
      .map((row) => {
        const detail = row.detail
          ? `<div class="row-detail">${this.escapeHtml(row.detail)}</div>`
          : '';
        const isPlayerRow = row.photoUrl !== undefined;
        const playerPhoto = isPlayerRow
          ? this.buildPlayerPhotoHtml(row.photoUrl, row.title)
          : '';
        const teamLogo = isPlayerRow
          ? this.buildPlayerTeamLogoHtml(
              row.teamLogoUrl,
              row.subtitle,
              input.branding,
            )
          : '';
        const playerClass =
          input.mode === 'player-mvp'
            ? ' row--mvp'
            : input.mode === 'player-ranking'
              ? ' row--fragger'
              : '';
        return `
          <div class="row${row.hero ? ' row--hero' : ''}${
            isPlayerRow ? ' row--player' : ''
          }${playerClass}">
            <div class="row-rank">${this.escapeHtml(row.rank)}</div>
            ${playerPhoto}
            <div class="row-main">
              <div class="row-title">${this.escapeHtml(row.title)}</div>
              <div class="row-subtitle">${teamLogo}<span>${this.escapeHtml(
                row.subtitle,
              )}</span></div>
            </div>
            <div>
              <div class="row-metric">${this.escapeHtml(row.metric)}</div>
              ${detail}
            </div>
          </div>
        `.trim();
      })
      .join('\n');

    return {
      rowsHtml,
      footer: input.footer ?? `Showing ${input.rows.length} rows`,
    };
  }

  private normalizeDiscordRenderKind(kind: string): DiscordMatchRenderKind {
    if ((DISCORD_MATCH_RENDER_KINDS as readonly string[]).includes(kind)) {
      return kind as DiscordMatchRenderKind;
    }
    throw new BadRequestException(`Unsupported Discord render kind "${kind}"`);
  }

  private async getAuthorizedMatchMeta(
    actor: AuthUser,
    matchId: string,
  ): Promise<RenderMatchMeta> {
    const accessibleMatch = (await this.results.ensureMatch(
      actor,
      matchId,
    )) as { organizationId?: string | null };
    const match = await this.prisma.match.findFirst({
      where: {
        id: matchId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        organizationId: true,
        tournamentId: true,
        stageId: true,
        groupId: true,
        sessionId: true,
        matchNumber: true,
        session: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!match) {
      throw new NotFoundException('Match not found');
    }

    return {
      ...match,
      organizationId: accessibleMatch.organizationId ?? match.organizationId,
    };
  }

  private async currentMatchTeamScope(
    matchId: string,
  ): Promise<Map<string, CurrentMatchTeam> | null> {
    const slots = await this.prisma.matchSlot.findMany({
      where: {
        matchId,
        deletedAt: null,
        teamId: { not: null },
      },
      orderBy: [{ slotNumber: 'asc' }],
      select: {
        teamId: true,
        slotNumber: true,
        team: {
          select: {
            tag: true,
            name: true,
            logoUrl: true,
          },
        },
      },
    });

    const teams = new Map<string, CurrentMatchTeam>();
    for (const slot of slots) {
      if (!slot.teamId || teams.has(slot.teamId)) continue;
      teams.set(slot.teamId, {
        teamId: slot.teamId,
        slotNumber: slot.slotNumber ?? null,
        tag: slot.team?.tag ?? null,
        name: slot.team?.name ?? null,
        logoUrl: slot.team?.logoUrl ?? null,
      });
    }

    return teams.size > 0 ? teams : null;
  }

  private discordCustomLayoutFor(
    template: DiscordWidgetTemplateSettings | null,
    kind: DiscordMatchRenderKind,
  ): DiscordWidgetCustomLayout | null {
    if (!template?.enabled) return null;
    const layout = template.customLayouts[kind];
    return layout?.enabled ? layout : null;
  }

  private discordCustomTextValue(
    input: DiscordCustomWidgetInput,
    element: DiscordWidgetCustomTextElement,
  ): string {
    const field = element.field;
    if (field === 'custom') return element.text;
    if (field === 'eyebrow') return input.eyebrow;
    if (field === 'title') return input.title;
    if (field === 'subtitle') return input.subtitle;
    return input.footer;
  }

  private discordCustomRowText(
    row: DiscordCustomWidgetRow,
    field: DiscordWidgetCustomRowField,
    displayRank?: string,
  ): string {
    if (field === 'rank') return displayRank ?? row.rank;
    if (field === 'team') return row.title;
    if (field === 'subtitle') return row.subtitle;
    if (field === 'metric') return row.metric;
    if (field === 'kills') return String(row.kills ?? 0);
    if (field === 'placementPoints') return String(row.placementPoints ?? 0);
    if (field === 'totalPoints') return String(row.totalPoints ?? 0);
    if (field === 'wwcd') return String(row.wwcd ?? 0);
    return '';
  }

  private discordWidgetTextStyle(
    library: DiscordWidgetStyleLibrary,
    id: string | null | undefined,
  ): DiscordWidgetTextStyle | null {
    return (
      library.textStyles.find((style) => style.id === id) ??
      library.textStyles.find((style) => style.id === 'text-body') ??
      library.textStyles[0] ??
      null
    );
  }

  private discordWidgetRowStyle(
    library: DiscordWidgetStyleLibrary,
    id: string | null | undefined,
  ): DiscordWidgetRowStyle | null {
    return (
      library.rowStyles.find((style) => style.id === id) ??
      library.rowStyles.find((style) => style.id === 'row-default') ??
      library.rowStyles[0] ??
      null
    );
  }

  private discordWidgetCardStyle(
    library: DiscordWidgetStyleLibrary,
    id: string | null | undefined,
  ): DiscordWidgetCardStyle | null {
    return (
      library.cardStyles.find((style) => style.id === id) ??
      library.cardStyles.find((style) => style.id === 'card-default') ??
      library.cardStyles[0] ??
      null
    );
  }

  private discordWidgetBackgroundStyle(
    library: DiscordWidgetStyleLibrary,
    id: string | null | undefined,
  ): DiscordWidgetBackgroundStyle | null {
    return (
      library.backgroundStyles.find((style) => style.id === id) ??
      library.backgroundStyles.find(
        (style) => style.id === 'background-default',
      ) ??
      library.backgroundStyles[0] ??
      null
    );
  }

  private discordWidgetTextStyleCss(
    style: DiscordWidgetTextStyle | null,
    fallbackColor?: string,
  ) {
    if (!style) return '';
    const declarations = [
      `color:${this.escapeHtml(style.color ?? fallbackColor ?? '#ffffff')}`,
      `font-size:${style.fontSize}px`,
      `font-weight:${style.fontWeight}`,
      `text-transform:${style.textTransform}`,
      `letter-spacing:${style.letterSpacing}px`,
    ];
    if (style.shadowColor && style.shadowBlur > 0) {
      declarations.push(
        `text-shadow:${style.shadowX}px ${style.shadowY}px ${style.shadowBlur}px ${this.escapeHtml(
          style.shadowColor,
        )}`,
      );
    }
    return declarations.join(';');
  }

  private discordWidgetBoxShadow(
    color: string | null,
    blur: number,
    y: number,
  ) {
    if (!color || blur <= 0) return '';
    const shadowColor = this.rgbaFromHexColor(color, 0.24) ?? color;
    return `box-shadow:0 ${y}px ${blur}px ${this.escapeHtml(shadowColor)}`;
  }

  private discordWidgetCardClipPath(shape: DiscordWidgetCustomCardShape) {
    if (shape === 'angled')
      return 'clip-path:polygon(7% 0,100% 0,93% 100%,0 100%)';
    if (shape === 'cut-left') {
      return 'clip-path:polygon(9% 0,100% 0,100% 100%,0 100%,0 18%)';
    }
    if (shape === 'cut-right') {
      return 'clip-path:polygon(0 0,100% 0,100% 82%,91% 100%,0 100%)';
    }
    return '';
  }

  private discordWidgetCardStyleCss(style: DiscordWidgetCardStyle | null) {
    if (!style) return '';
    return [
      `background:${this.escapeHtml(style.backgroundColor ?? 'var(--panel)')}`,
      `border:${style.borderWidth}px solid ${this.escapeHtml(
        style.borderColor ?? 'transparent',
      )}`,
      `border-radius:${style.radius}px`,
      `padding:${style.paddingY}px ${style.paddingX}px`,
      `opacity:${style.opacity}`,
      this.discordWidgetBoxShadow(
        style.shadowColor,
        style.shadowBlur,
        style.shadowY,
      ),
      this.discordWidgetCardClipPath(style.shape),
    ]
      .filter(Boolean)
      .join(';');
  }

  private discordWidgetRowBackground(
    style: DiscordWidgetRowStyle | null,
    rowIndex: number,
    rankText: string,
  ) {
    if (!style) return 'var(--panel)';
    const rank = Number.parseInt(rankText.replace(/[^0-9-]/g, ''), 10);
    if (rank === 1 && style.rankOneBackgroundColor) {
      return style.rankOneBackgroundColor;
    }
    if (rank === 2 && style.rankTwoBackgroundColor) {
      return style.rankTwoBackgroundColor;
    }
    if (rank === 3 && style.rankThreeBackgroundColor) {
      return style.rankThreeBackgroundColor;
    }
    if (rowIndex % 2 === 1 && style.alternateBackgroundColor) {
      return style.alternateBackgroundColor;
    }
    return style.backgroundColor ?? 'var(--panel)';
  }

  private discordWidgetRowStyleCss(
    style: DiscordWidgetRowStyle | null,
    rowIndex: number,
    rankText: string,
  ) {
    if (!style) return '';
    return [
      `background:${this.escapeHtml(
        this.discordWidgetRowBackground(style, rowIndex, rankText),
      )}`,
      `border:${style.borderWidth}px solid ${this.escapeHtml(
        style.borderColor ?? 'transparent',
      )}`,
      `border-radius:${style.radius}px`,
      `padding:${style.paddingY}px ${style.paddingX}px`,
      `opacity:${style.opacity}`,
      this.discordWidgetBoxShadow(
        style.shadowColor,
        style.shadowBlur,
        style.shadowY,
      ),
    ]
      .filter(Boolean)
      .join(';');
  }

  private customColumnStyle(
    column: DiscordWidgetCustomColumn,
    fallbackColor: string,
  ): string {
    const declarations = [
      `color:${this.escapeHtml(column.color ?? fallbackColor)}`,
      `text-transform:${column.textTransform}`,
    ];
    if (column.fontSize > 0)
      declarations.push(`font-size:${column.fontSize}px`);
    if (column.fontWeight > 0) {
      declarations.push(`font-weight:${column.fontWeight}`);
    }
    if (column.backgroundColor) {
      declarations.push(
        `background:${this.escapeHtml(column.backgroundColor)}`,
        'border-radius:6px',
        'padding:2px 4px',
      );
    }
    return declarations.join(';');
  }

  private discordCustomImageRank(element: DiscordWidgetCustomImageElement) {
    if (element.source === 'dynamic-code') {
      const match = /^M-(\d+)-(\d+)$/i.exec(element.dynamicCode);
      if (match) return Math.max(1, Number.parseInt(match[2], 10) || 1);
    }
    return Math.max(1, Math.round(element.rowRank || 1));
  }

  private discordCustomImageUrl(
    input: DiscordCustomWidgetInput,
    element: DiscordWidgetCustomImageElement,
  ): { src: string | null; label: string } {
    if (element.source === 'url') {
      return { src: element.url, label: 'Custom image' };
    }

    const rank = this.discordCustomImageRank(element);
    const row = input.rows[rank - 1];
    if (!row) {
      return { src: null, label: `Rank ${rank}` };
    }

    const isPlayerKind = this.isDiscordPlayerWidgetKind(input.kind);
    const isTeamLogo = element.source === 'team-logo';
    const src = isTeamLogo
      ? (row.teamLogoUrl ?? (isPlayerKind ? null : row.logoUrl))
      : isPlayerKind
        ? row.logoUrl
        : (row.logoUrl ?? row.teamLogoUrl);
    const fallback =
      isPlayerKind && !isTeamLogo
        ? this.defaultPlayerPhotoUrl()
        : this.defaultTeamLogoUrl(input.branding);
    return {
      src: this.normalizeAssetUrl(src) ?? fallback,
      label: row.title,
    };
  }

  private buildDiscordCustomImageHtml(
    input: DiscordCustomWidgetInput,
    element: DiscordWidgetCustomImageElement,
  ): string {
    const image = this.discordCustomImageUrl(input, element);
    if (!image.src) return '';
    return `<img class="custom-image" src="${this.escapeHtml(
      image.src,
    )}" alt="${this.escapeHtml(image.label)}" style="left:${element.x}px; top:${
      element.y
    }px; width:${element.width}px; height:${element.height}px; border-radius:${
      element.radius
    }px; opacity:${element.opacity.toFixed(2)}; z-index:${element.zIndex};" />`;
  }

  private buildDiscordCustomImageCell(
    row: DiscordCustomWidgetRow,
    field: DiscordWidgetCustomRowField,
    branding: TemplateBranding,
    kind: DiscordMatchRenderKind,
  ): string {
    const isPlayerKind = this.isDiscordPlayerWidgetKind(kind);
    const isTeamLogo = field === 'teamLogo';
    const raw = isTeamLogo
      ? (row.teamLogoUrl ?? (isPlayerKind ? null : row.logoUrl))
      : isPlayerKind
        ? row.logoUrl
        : (row.logoUrl ?? row.teamLogoUrl);
    const fallback =
      isPlayerKind && !isTeamLogo
        ? this.defaultPlayerPhotoUrl()
        : this.defaultTeamLogoUrl(branding);
    const src = this.normalizeAssetUrl(raw) ?? fallback;
    const label = isTeamLogo ? row.subtitle || row.title : row.title;
    return `<img class="custom-row-image" src="${this.escapeHtml(
      src,
    )}" alt="${this.escapeHtml(label)} logo" />`;
  }

  private customRowsHeaderHeight(element: DiscordWidgetCustomRowsElement) {
    return element.showHeader
      ? Math.max(18, Math.round(element.rowHeight * 0.68))
      : 0;
  }

  private customRowsBoxStyle(height: number) {
    const safeHeight = Math.max(1, Math.round(height));
    return `height:${safeHeight}px; min-height:${safeHeight}px; max-height:${safeHeight}px`;
  }

  private customRowsImageSize(
    element: DiscordWidgetCustomRowsElement,
    rowStyle: DiscordWidgetRowStyle | null,
  ) {
    const verticalPadding = Math.max(0, rowStyle?.paddingY ?? 4) * 2;
    const verticalBorder = Math.max(0, rowStyle?.borderWidth ?? 1) * 2;
    const availableHeight =
      element.rowHeight - verticalPadding - verticalBorder;
    return Math.max(8, Math.min(32, Math.floor(availableHeight)));
  }

  private customRowsVisualHeight(
    rowCount: number,
    element: DiscordWidgetCustomRowsElement,
  ) {
    if (rowCount <= 0) return 0;
    const headerHeight = this.customRowsHeaderHeight(element);
    const gapCount = element.showHeader ? rowCount : Math.max(0, rowCount - 1);
    return (
      headerHeight + rowCount * element.rowHeight + gapCount * element.rowGap
    );
  }

  private customRowsGroupCapacity(
    element: DiscordWidgetCustomRowsElement,
    groupIndex: number,
  ) {
    const groupOffset = element.groupOffsets?.[groupIndex] ?? { x: 0, y: 0 };
    const availableHeight = Math.max(
      0,
      MATCH_VIEWPORT.height -
        element.y -
        groupOffset.y -
        CUSTOM_ROWS_BOTTOM_PADDING,
    );
    const headerHeight = this.customRowsHeaderHeight(element);
    const rowSlot = element.rowHeight + element.rowGap;
    const capacity = element.showHeader
      ? Math.floor((availableHeight - headerHeight) / rowSlot)
      : Math.floor((availableHeight + element.rowGap) / rowSlot);
    return Math.max(1, capacity);
  }

  private customRowsAvailableHeight(element: DiscordWidgetCustomRowsElement) {
    return Math.max(
      0,
      MATCH_VIEWPORT.height - element.y - CUSTOM_ROWS_BOTTOM_PADDING,
    );
  }

  private customRowsLayoutBottom(
    rowGroups: DiscordCustomWidgetRow[][],
    element: DiscordWidgetCustomRowsElement,
  ) {
    return rowGroups.reduce((maxBottom, groupRows, groupIndex) => {
      if (!groupRows.length) return maxBottom;
      const groupOffset = element.groupOffsets?.[groupIndex] ?? { x: 0, y: 0 };
      return Math.max(
        maxBottom,
        groupOffset.y + this.customRowsVisualHeight(groupRows.length, element),
      );
    }, 0);
  }

  private customRowsPositiveGroupOffset(
    rowGroups: DiscordCustomWidgetRow[][],
    element: DiscordWidgetCustomRowsElement,
  ) {
    return rowGroups.reduce((maxOffset, groupRows, groupIndex) => {
      if (!groupRows.length) return maxOffset;
      const groupOffset = element.groupOffsets?.[groupIndex] ?? { x: 0, y: 0 };
      return Math.max(maxOffset, groupOffset.y, 0);
    }, 0);
  }

  private customRowsDistributedLayout(
    rows: DiscordCustomWidgetRow[],
    element: DiscordWidgetCustomRowsElement,
    groupColumns: number,
  ) {
    const safeGroupColumns = Math.max(
      1,
      Math.min(groupColumns, rows.length || 1),
    );
    const layoutElement = { ...element, groupColumns: safeGroupColumns };
    const rowGroups = this.distributeDiscordCustomRowsIntoGroups(
      rows,
      layoutElement,
      safeGroupColumns,
    );
    return {
      rowGroups,
      bottom: this.customRowsLayoutBottom(rowGroups, layoutElement),
      groupColumns: safeGroupColumns,
    };
  }

  private customRowsFittableRowCount(
    rows: DiscordCustomWidgetRow[],
    element: DiscordWidgetCustomRowsElement,
    groupColumns: number,
    availableHeight: number,
  ) {
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const candidate = Math.ceil((low + high + 1) / 2);
      const layout = this.customRowsDistributedLayout(
        rows.slice(0, candidate),
        element,
        groupColumns,
      );
      if (layout.bottom <= availableHeight) {
        low = candidate;
      } else {
        high = candidate - 1;
      }
    }
    return low;
  }

  private distributeDiscordCustomRowsIntoGroups(
    rows: DiscordCustomWidgetRow[],
    element: DiscordWidgetCustomRowsElement,
    groupColumns: number,
  ) {
    if (groupColumns <= 1 || rows.length <= 1) return [rows];
    const groupCount = Math.min(groupColumns, rows.length);
    const capacities = Array.from({ length: groupCount }, (_, groupIndex) =>
      this.customRowsGroupCapacity(element, groupIndex),
    );
    const counts = Array.from({ length: groupCount }, () => 0);
    const seededGroups = Math.min(groupCount, rows.length);
    for (let index = 0; index < seededGroups; index += 1) {
      counts[index] = 1;
    }

    let remainingRows = rows.length - seededGroups;
    while (remainingRows > 0) {
      const candidates = counts.some(
        (count, index) => count < capacities[index],
      )
        ? counts
            .map((count, index) => ({ count, index }))
            .filter((entry) => entry.count < capacities[entry.index])
        : counts.map((count, index) => ({ count, index }));
      const target = candidates.sort((left, right) => {
        const leftOffset = element.groupOffsets?.[left.index] ?? { x: 0, y: 0 };
        const rightOffset = element.groupOffsets?.[right.index] ?? {
          x: 0,
          y: 0,
        };
        const leftBottom =
          leftOffset.y +
          this.customRowsVisualHeight(counts[left.index], element);
        const rightBottom =
          rightOffset.y +
          this.customRowsVisualHeight(counts[right.index], element);
        if (leftBottom !== rightBottom) return leftBottom - rightBottom;
        if (counts[left.index] !== counts[right.index]) {
          return counts[left.index] - counts[right.index];
        }
        return left.index - right.index;
      })[0];
      counts[target.index] += 1;
      remainingRows -= 1;
    }

    let cursor = 0;
    return counts.map((count) => {
      const groupRows = rows.slice(cursor, cursor + count);
      cursor += count;
      return groupRows;
    });
  }

  private customRowsColumnMinWidth(field: DiscordWidgetCustomRowField) {
    if (field === 'team' || field === 'subtitle') return 92;
    if (field === 'logo' || field === 'teamLogo') return 20;
    if (field === 'rank') return 24;
    return 28;
  }

  private customRowsStartIndex(
    input: DiscordCustomWidgetInput,
    element: DiscordWidgetCustomRowsElement,
  ) {
    const requestedStartRank = Math.max(1, Math.round(element.startRank || 1));
    return Math.min(input.rows.length, requestedStartRank - 1);
  }

  private discordResultRowsAlwaysAutoFit(kind: DiscordMatchRenderKind) {
    return kind === 'match-result' || kind === 'overall-ranking';
  }

  private fitDiscordCustomRowsColumns(
    element: DiscordWidgetCustomRowsElement,
  ): DiscordWidgetCustomRowsElement {
    const columns = element.columns.map((column) => ({ ...column }));
    const enabledIndexes = columns
      .map((column, index) => (column.enabled ? index : -1))
      .filter((index) => index >= 0);
    if (enabledIndexes.length <= 1) {
      return { ...element, columns };
    }

    const groupWidth =
      (element.width - element.groupGap * (element.groupColumns - 1)) /
      element.groupColumns;
    const fixedWidth = 16 + 8 * (enabledIndexes.length - 1);
    const availableColumnsWidth = Math.floor(groupWidth - fixedWidth);
    const currentColumnsWidth = enabledIndexes.reduce(
      (sum, index) => sum + columns[index].width,
      0,
    );

    if (
      availableColumnsWidth <= 0 ||
      currentColumnsWidth <= availableColumnsWidth
    ) {
      return { ...element, columns };
    }

    const scale = availableColumnsWidth / currentColumnsWidth;
    for (const index of enabledIndexes) {
      const column = columns[index];
      columns[index] = {
        ...column,
        width: Math.max(
          this.customRowsColumnMinWidth(column.field),
          Math.floor(column.width * scale),
        ),
      };
    }

    let overflow =
      enabledIndexes.reduce((sum, index) => sum + columns[index].width, 0) -
      availableColumnsWidth;
    while (overflow > 0) {
      const shrinkIndex = enabledIndexes
        .map((index) => ({
          index,
          extra:
            columns[index].width -
            this.customRowsColumnMinWidth(columns[index].field),
        }))
        .filter((entry) => entry.extra > 0)
        .sort((left, right) => right.extra - left.extra)[0]?.index;
      if (shrinkIndex === undefined) break;
      columns[shrinkIndex] = {
        ...columns[shrinkIndex],
        width: columns[shrinkIndex].width - 1,
      };
      overflow -= 1;
    }

    return { ...element, columns };
  }

  private fitDiscordCustomRowsElement(
    input: DiscordCustomWidgetInput,
    element: DiscordWidgetCustomRowsElement,
  ): DiscordWidgetCustomRowsElement {
    const startIndex = this.customRowsStartIndex(input, element);
    const availableRows = Math.max(0, input.rows.length - startIndex);
    const forceAutoFitRows = this.discordResultRowsAlwaysAutoFit(input.kind);
    const autoFitRows = forceAutoFitRows || element.autoFitRows === true;
    const configuredMaxRows = Math.max(1, element.maxRows);
    const requestedRows = forceAutoFitRows
      ? Math.min(availableRows, configuredMaxRows)
      : autoFitRows
        ? availableRows
        : Math.min(availableRows, configuredMaxRows);
    const next: DiscordWidgetCustomRowsElement = {
      ...element,
      maxRows: requestedRows > 0 ? requestedRows : configuredMaxRows,
      columns: element.columns.map((column) => ({ ...column })),
    };
    const visibleRows = requestedRows;
    const visibleRowData = input.rows.slice(
      startIndex,
      startIndex + visibleRows,
    );
    const availableHeight = this.customRowsAvailableHeight(next);
    next.groupColumns = Math.max(
      1,
      Math.min(next.groupColumns, visibleRows || 1),
    );

    if (autoFitRows && visibleRows > 0) {
      const maxAutoGroups = Math.min(CUSTOM_ROWS_MAX_GROUPS, visibleRows);
      const minimumHeaderHeight = next.showHeader
        ? Math.max(18, Math.round(CUSTOM_ROWS_MIN_ROW_HEIGHT * 0.68))
        : 0;
      const configuredGroups = next.groupColumns;
      next.groupColumns = maxAutoGroups;
      for (
        let candidate = Math.max(1, configuredGroups);
        candidate <= maxAutoGroups;
        candidate += 1
      ) {
        const candidateRowsPerGroup = Math.max(
          1,
          Math.ceil(visibleRows / candidate),
        );
        const gapCount = next.showHeader
          ? candidateRowsPerGroup
          : Math.max(0, candidateRowsPerGroup - 1);
        const minimumRequiredHeight =
          minimumHeaderHeight +
          candidateRowsPerGroup * CUSTOM_ROWS_MIN_ROW_HEIGHT +
          gapCount * CUSTOM_ROWS_MIN_ROW_GAP;
        const candidateElement = {
          ...next,
          groupColumns: candidate,
          rowHeight: CUSTOM_ROWS_MIN_ROW_HEIGHT,
          rowGap: CUSTOM_ROWS_MIN_ROW_GAP,
        };
        const candidateLayout = this.customRowsDistributedLayout(
          visibleRowData,
          candidateElement,
          candidate,
        );
        if (
          minimumRequiredHeight <= availableHeight &&
          candidateLayout.bottom <= availableHeight
        ) {
          next.groupColumns = candidate;
          break;
        }
      }
    }

    if (!visibleRows) {
      return this.fitDiscordCustomRowsColumns(next);
    }

    let layout = this.customRowsDistributedLayout(
      visibleRowData,
      next,
      next.groupColumns,
    );
    next.groupColumns = layout.groupColumns;

    if (layout.bottom > availableHeight) {
      const rowsPerGroup = Math.max(
        1,
        ...layout.rowGroups.map((groupRows) => groupRows.length),
      );
      next.rowGap = Math.max(
        CUSTOM_ROWS_MIN_ROW_GAP,
        Math.min(next.rowGap, rowsPerGroup >= 10 ? 2 : 4),
      );
      const offsetReserve = this.customRowsPositiveGroupOffset(
        layout.rowGroups,
        next,
      );
      const usableHeight = Math.max(0, availableHeight - offsetReserve);
      const headerHeight = this.customRowsHeaderHeight(next);
      const gapCount = next.showHeader
        ? rowsPerGroup
        : Math.max(0, rowsPerGroup - 1);
      const rowHeight = Math.floor(
        (usableHeight - headerHeight - gapCount * next.rowGap) / rowsPerGroup,
      );
      next.rowHeight = Math.max(
        CUSTOM_ROWS_MIN_ROW_HEIGHT,
        Math.min(next.rowHeight, rowHeight),
      );
      next.fontSize = Math.min(
        next.fontSize,
        Math.max(8, Math.floor(next.rowHeight * 0.48)),
      );
      next.headerFontSize = Math.min(
        next.headerFontSize,
        Math.max(8, Math.floor(this.customRowsHeaderHeight(next) * 0.5)),
      );
    }

    layout = this.customRowsDistributedLayout(
      visibleRowData,
      next,
      next.groupColumns,
    );
    if (layout.bottom > availableHeight) {
      next.maxRows = this.customRowsFittableRowCount(
        visibleRowData,
        next,
        next.groupColumns,
        availableHeight,
      );
    }

    return this.fitDiscordCustomRowsColumns(next);
  }

  private discordScheduleCustomRowMeta(
    row: DiscordCustomWidgetRow,
    index: number,
  ): { matchLabel: string; map: string } {
    const [subtitleMatchLabel, subtitleMap] = row.subtitle
      .split(/\s+-\s+/, 2)
      .map((part) => part.trim());
    const matchLabel =
      row.matchLabel?.trim() ||
      subtitleMatchLabel ||
      `Match ${String(index + 1).padStart(2, '0')}`;
    const map = row.map?.trim() || subtitleMap || 'Map TBA';
    return { matchLabel, map };
  }

  private fitDiscordCustomScheduleCardsElement(
    element: DiscordWidgetCustomRowsElement,
    visibleRows: number,
  ) {
    let groupColumns = Math.max(
      1,
      Math.min(element.groupColumns, visibleRows || 1),
    );
    const maxAutoGroups = Math.min(CUSTOM_ROWS_MAX_GROUPS, visibleRows || 1);
    const rowGap = Math.max(0, element.rowGap);
    const minCardHeight = 92;
    const configuredCardHeight = Math.max(minCardHeight, element.rowHeight);
    const availableHeight = Math.max(
      minCardHeight,
      MATCH_VIEWPORT.height - element.y - CUSTOM_ROWS_BOTTOM_PADDING,
    );

    if (element.autoFitRows && visibleRows > 0) {
      for (
        let candidate = groupColumns;
        candidate <= maxAutoGroups;
        candidate += 1
      ) {
        const rowsPerGroup = Math.max(1, Math.ceil(visibleRows / candidate));
        const requiredHeight =
          rowsPerGroup * minCardHeight + Math.max(0, rowsPerGroup - 1) * rowGap;
        if (requiredHeight <= availableHeight) {
          groupColumns = candidate;
          break;
        }
      }
    }

    const rowsPerGroup = Math.max(
      1,
      Math.ceil((visibleRows || 1) / groupColumns),
    );
    const fittedCardHeight = Math.floor(
      (availableHeight - Math.max(0, rowsPerGroup - 1) * rowGap) / rowsPerGroup,
    );

    return {
      groupColumns,
      cardHeight: Math.max(
        minCardHeight,
        Math.min(configuredCardHeight, fittedCardHeight),
      ),
    };
  }

  private buildDiscordCustomScheduleCardsHtml(
    input: DiscordCustomWidgetInput,
    element: DiscordWidgetCustomRowsElement,
  ): string {
    const cardStyle = this.discordWidgetCardStyle(
      input.styleLibrary,
      element.cardStyleId,
    );
    const bodyTextStyle = this.discordWidgetTextStyle(
      input.styleLibrary,
      element.bodyTextStyleId,
    );
    const headerTextStyle = this.discordWidgetTextStyle(
      input.styleLibrary,
      element.headerTextStyleId,
    );
    const startIndex = this.customRowsStartIndex(input, element);
    const availableRows = Math.max(0, input.rows.length - startIndex);
    const visibleCount = element.autoFitRows
      ? availableRows
      : Math.min(availableRows, Math.max(1, element.maxRows));
    const rows = input.rows.slice(startIndex, startIndex + visibleCount);
    const { groupColumns, cardHeight } =
      this.fitDiscordCustomScheduleCardsElement(element, rows.length);
    const cardDirection =
      element.cardDirection === 'vertical' || cardStyle?.layout === 'vertical'
        ? 'vertical'
        : 'horizontal';
    const rowsPerColumn = Math.max(
      1,
      Math.ceil((rows.length || 1) / groupColumns),
    );
    const logoSize = Math.max(34, Math.min(74, Math.round(cardHeight * 0.34)));
    const fontSize = Math.max(
      10,
      Math.min(element.fontSize, Math.round(cardHeight * 0.13)),
    );
    const sceneOccurrences = new Map<string, number>();

    const cardsHtml = rows.length
      ? rows
          .map((row, index) => {
            const { matchLabel, map } = this.discordScheduleCustomRowMeta(
              row,
              startIndex + index,
            );
            const mapKey = this.normalizeMatchScheduleMapKey(map);
            const occurrence = sceneOccurrences.get(mapKey) ?? 0;
            sceneOccurrences.set(mapKey, occurrence + 1);
            const sceneUrl = this.matchScheduleSceneUrl(map, occurrence);
            const logoUrl =
              this.normalizeAssetUrl(row.logoUrl ?? row.teamLogoUrl) ??
              this.defaultTeamLogoUrl(input.branding);
            const kills = Math.max(0, row.kills ?? 0);
            const totalPoints = Math.max(0, row.totalPoints ?? 0);
            const sceneStyle = sceneUrl
              ? ` style="background-image:url('${this.cssUrl(sceneUrl)}')"`
              : '';

            return `
              <article class="custom-schedule-card" style="${this.discordWidgetCardStyleCss(
                cardStyle,
              )}">
                <div class="custom-schedule-scene"${sceneStyle}></div>
                <div class="custom-schedule-tint"></div>
                <div class="custom-schedule-match" style="${this.discordWidgetTextStyleCss(
                  headerTextStyle,
                  input.branding.textPrimary,
                )}">${this.escapeHtml(matchLabel)}</div>
                <div class="custom-schedule-map" style="${this.discordWidgetTextStyleCss(
                  headerTextStyle,
                  input.branding.primaryColor,
                )}; color:${this.escapeHtml(
                  input.branding.primaryColor,
                )};">${this.escapeHtml(map)}</div>
                <div class="custom-schedule-content">
                  <div class="custom-schedule-logo-shell" style="background:${this.escapeHtml(
                    cardStyle?.logoBackgroundColor ?? 'rgba(2,6,23,0.38)',
                  )}; border-radius:${cardStyle?.logoRadius ?? 14}px;">
                    <img class="custom-schedule-logo" src="${this.escapeHtml(
                      logoUrl,
                    )}" alt="${this.escapeHtml(row.title)} logo" />
                  </div>
                  <div class="custom-schedule-winner" style="${this.discordWidgetTextStyleCss(
                    bodyTextStyle,
                    input.branding.textPrimary,
                  )}">${this.escapeHtml(row.title)}</div>
                  <div class="custom-schedule-stats" style="${this.discordWidgetTextStyleCss(
                    bodyTextStyle,
                    input.branding.textPrimary,
                  )}">
                    <span>${this.escapeHtml(`${kills} K`)}</span>
                    <span>${this.escapeHtml(`${totalPoints} PTS`)}</span>
                  </div>
                </div>
              </article>
            `.trim();
          })
          .join('')
      : `<div class="custom-empty">No scheduled matches yet</div>`;

    const flowStyle =
      cardDirection === 'vertical'
        ? `grid-template-rows:repeat(${rowsPerColumn}, ${cardHeight}px); grid-auto-flow:column;`
        : '';

    return `<div class="custom-schedule-cards" data-direction="${cardDirection}" style="left:${
      element.x
    }px; top:${element.y}px; width:${element.width}px; z-index:${
      element.zIndex
    }; grid-template-columns:repeat(${groupColumns}, minmax(0, 1fr)); ${flowStyle} gap:${
      element.rowGap
    }px ${element.groupGap}px; --custom-schedule-height:${cardHeight}px; --custom-schedule-radius:${
      cardStyle?.radius ?? element.rowRadius
    }px; --custom-schedule-logo:${logoSize}px; --custom-schedule-font:${fontSize}px;">${cardsHtml}</div>`;
  }

  private customLayoutUsesPlayerMedia(
    layout: DiscordWidgetCustomLayout | null,
  ): boolean {
    return Boolean(
      layout?.elements.some(
        (element): element is DiscordWidgetCustomMediaElement =>
          element.type === 'media' &&
          element.enabled &&
          element.source === 'players',
      ),
    );
  }

  private playerStatsToCustomRows(
    players: PlayerStatRow[],
    limit = 8,
  ): DiscordCustomWidgetRow[] {
    return players
      .slice()
      .sort((left, right) => this.sortPlayersByKills(left, right))
      .slice(0, limit)
      .map((player, index) => ({
        rank: `#${index + 1}`,
        title: player.ign,
        subtitle: player.teamName || player.teamTag || 'Team',
        metric: `${player.kills} kills`,
        logoUrl: player.photoUrl,
        teamLogoUrl: player.teamLogoUrl,
        kills: player.kills,
      }));
  }

  private normalizePlayerExternalId(value: string | null | undefined) {
    const normalized = (value ?? '').trim().replace(/\s+/g, '');
    return normalized.length > 0 ? normalized : null;
  }

  private buildDiscordCustomFeaturedHtml(
    input: DiscordCustomWidgetInput,
    element: DiscordWidgetCustomFeaturedElement,
  ): string {
    const teams = input.rows.slice(0, element.teamCount);
    const cardStyle = this.discordWidgetCardStyle(
      input.styleLibrary,
      element.cardStyleId,
    );
    const textStyle = this.discordWidgetTextStyle(
      input.styleLibrary,
      element.textStyleId,
    );
    const statTextStyle = this.discordWidgetTextStyle(
      input.styleLibrary,
      element.statTextStyleId,
    );
    const groupColumns = Math.max(
      1,
      Math.min(element.groupColumns, teams.length || 1),
    );
    const rowsHtml = teams.length
      ? teams
          .map((team) => {
            const logo =
              this.normalizeAssetUrl(team.logoUrl ?? team.teamLogoUrl) ??
              this.defaultTeamLogoUrl(input.branding);
            const statsHtml = element.showStats
              ? `<div class="custom-featured-stats" style="${this.discordWidgetTextStyleCss(
                  statTextStyle,
                  input.branding.textMuted,
                )}; color:${this.escapeHtml(
                  cardStyle?.statColor ??
                    statTextStyle?.color ??
                    input.branding.textMuted,
                )};">
                  <span>K ${this.escapeHtml(team.kills ?? 0)}</span>
                  <span>PP ${this.escapeHtml(team.placementPoints ?? 0)}</span>
                  <span>TP ${this.escapeHtml(team.totalPoints ?? team.metric)}</span>
                </div>`
              : '';
            const vertical = cardStyle?.layout === 'vertical';
            const compact = cardStyle?.layout === 'compact';
            return `
              <div class="custom-featured-card" data-layout="${this.escapeHtml(
                cardStyle?.layout ?? 'horizontal',
              )}" style="${this.discordWidgetCardStyleCss(cardStyle)}">
                ${
                  vertical || compact
                    ? ''
                    : `<div class="custom-featured-rank">${this.escapeHtml(
                        team.rank,
                      )}</div>`
                }
                <img class="custom-featured-logo" src="${this.escapeHtml(
                  logo,
                )}" alt="${this.escapeHtml(team.title)} logo" />
                <div class="custom-featured-main">
                  ${
                    vertical || compact
                      ? `<div class="custom-featured-rank custom-featured-rank--inline">${this.escapeHtml(
                          team.rank,
                        )}</div>`
                      : ''
                  }
                  <div class="custom-featured-name" style="${this.discordWidgetTextStyleCss(
                    textStyle,
                    input.branding.textPrimary,
                  )}">${this.escapeHtml(team.title)}</div>
                  ${statsHtml}
                </div>
              </div>
            `.trim();
          })
          .join('')
      : `<div class="custom-empty">No featured teams yet</div>`;

    return `<div class="custom-featured" style="left:${element.x}px; top:${
      element.y
    }px; width:${element.width}px; z-index:${
      element.zIndex
    }; grid-template-columns:repeat(${groupColumns}, minmax(0, 1fr)); gap:${
      element.cardGap
    }px; --custom-featured-height:${
      element.cardHeight
    }px; --custom-featured-logo:${element.logoSize}px; --custom-featured-font:${
      element.fontSize
    }px; --custom-featured-radius:${
      cardStyle?.radius ?? element.rowRadius
    }px; --custom-featured-logo-bg:${this.escapeHtml(
      cardStyle?.logoBackgroundColor ?? 'rgba(255,255,255,0.06)',
    )}; --custom-featured-logo-radius:${
      cardStyle?.logoRadius ?? 10
    }px; --custom-featured-stat-color:${this.escapeHtml(
      cardStyle?.statColor ?? statTextStyle?.color ?? input.branding.textMuted,
    )};">${rowsHtml}</div>`;
  }

  private buildDiscordCustomMediaHtml(
    input: DiscordCustomWidgetInput,
    element: DiscordWidgetCustomMediaElement,
  ): string {
    const cardStyle = this.discordWidgetCardStyle(
      input.styleLibrary,
      element.cardStyleId,
    );
    const textStyle = this.discordWidgetTextStyle(
      input.styleLibrary,
      element.textStyleId,
    );
    const statTextStyle = this.discordWidgetTextStyle(
      input.styleLibrary,
      element.statTextStyleId,
    );
    const sourceRows =
      element.source === 'players'
        ? (input.mediaRows ?? input.rows)
        : input.rows;
    const rows = sourceRows.slice(0, element.itemCount);
    const groupColumns = Math.max(1, rows.length || element.itemCount);
    const rowsHtml = rows.length
      ? rows
          .map((row) => {
            const image =
              this.normalizeAssetUrl(
                element.source === 'players'
                  ? row.logoUrl
                  : (row.logoUrl ?? row.teamLogoUrl),
              ) ??
              (element.source === 'players'
                ? this.defaultPlayerPhotoUrl()
                : this.defaultTeamLogoUrl(input.branding));
            const statsHtml = element.showStats
              ? `<div class="custom-media-stat" style="${this.discordWidgetTextStyleCss(
                  statTextStyle,
                  input.branding.textMuted,
                )}; color:${this.escapeHtml(
                  cardStyle?.statColor ??
                    statTextStyle?.color ??
                    input.branding.textMuted,
                )};">${this.escapeHtml(row.metric || row.subtitle)}</div>`
              : '';
            return `
              <div class="custom-media-card" data-layout="${this.escapeHtml(
                cardStyle?.layout ?? 'horizontal',
              )}" style="${this.discordWidgetCardStyleCss(cardStyle)}">
                <img class="custom-media-image" src="${this.escapeHtml(
                  image,
                )}" alt="${this.escapeHtml(row.title)} image" />
                <div class="custom-media-copy">
                  <div class="custom-media-name" style="${this.discordWidgetTextStyleCss(
                    textStyle,
                    input.branding.textPrimary,
                  )}">${this.escapeHtml(row.title)}</div>
                  ${statsHtml}
                </div>
              </div>
            `.trim();
          })
          .join('')
      : `<div class="custom-empty">No media rows yet</div>`;

    return `<div class="custom-media" style="left:${element.x}px; top:${
      element.y
    }px; width:${element.width}px; height:${element.height}px; z-index:${
      element.zIndex
    }; grid-template-columns:repeat(${groupColumns}, minmax(0, 1fr)); gap:${
      element.cardGap
    }px; --custom-media-image:${element.imageSize}px; --custom-media-font:${
      element.fontSize
    }px; --custom-media-radius:${
      cardStyle?.radius ?? element.rowRadius
    }px; --custom-media-logo-bg:${this.escapeHtml(
      cardStyle?.logoBackgroundColor ?? 'rgba(255,255,255,0.06)',
    )}; --custom-media-logo-radius:${
      cardStyle?.logoRadius ?? 12
    }px;">${rowsHtml}</div>`;
  }

  private buildDiscordCustomRowsHtml(
    input: DiscordCustomWidgetInput,
    element: DiscordWidgetCustomRowsElement,
  ): string {
    const fittedElement = this.fitDiscordCustomRowsElement(input, element);
    const columns = fittedElement.columns.filter((column) => column.enabled);
    if (!columns.length) return '';
    const rowStyle = this.discordWidgetRowStyle(
      input.styleLibrary,
      fittedElement.rowStyleId,
    );
    const headerTextStyle = this.discordWidgetTextStyle(
      input.styleLibrary,
      fittedElement.headerTextStyleId,
    );
    const bodyTextStyle = this.discordWidgetTextStyle(
      input.styleLibrary,
      fittedElement.bodyTextStyleId,
    );

    const startIndex = this.customRowsStartIndex(input, fittedElement);
    const rows = input.rows.slice(
      startIndex,
      startIndex + fittedElement.maxRows,
    );
    const displayRankByRow =
      fittedElement.rankDisplayMode === 'restart'
        ? new Map(
            rows.map((row, index) => [
              row,
              row.rank.startsWith('#') ? `#${index + 1}` : String(index + 1),
            ]),
          )
        : new Map<DiscordCustomWidgetRow, string>();
    const groupColumns = Math.max(
      1,
      Math.min(fittedElement.groupColumns, rows.length || 1),
    );
    const columnTemplate = columns
      .map((column) => `${column.width}px`)
      .join(' ');
    const headerHeight = this.customRowsHeaderHeight(fittedElement);
    const rowImageSize = this.customRowsImageSize(fittedElement, rowStyle);
    const headerHtml = fittedElement.showHeader
      ? `<div class="custom-data-row custom-header-row" style="grid-template-columns:${columnTemplate}; ${this.customRowsBoxStyle(
          headerHeight,
        )}; font-size:${fittedElement.headerFontSize}px; ${this.discordWidgetTextStyleCss(
          headerTextStyle,
          input.branding.textMuted,
        )};">${columns
          .map(
            (column) =>
              `<div class="custom-cell custom-cell--${column.align}" style="${this.customColumnStyle(
                column,
                headerTextStyle?.color ?? input.branding.textMuted,
              )}">${this.escapeHtml(column.label)}</div>`,
          )
          .join('')}</div>`
      : '';

    const distributedRowGroups = this.distributeDiscordCustomRowsIntoGroups(
      rows,
      fittedElement,
      groupColumns,
    );
    const rowGroups = distributedRowGroups
      .map((groupRows, groupIndex) => {
        const groupOffset = fittedElement.groupOffsets?.[groupIndex] ?? {
          x: 0,
          y: 0,
        };
        const rowsBeforeGroup = distributedRowGroups
          .slice(0, groupIndex)
          .reduce((sum, group) => sum + group.length, 0);
        const bodyHtml = groupRows.length
          ? groupRows
              .map((row, rowIndex) => {
                const displayRank = displayRankByRow.get(row);
                const rankText = displayRank ?? row.rank;
                const rowStyleCss = this.discordWidgetRowStyleCss(
                  rowStyle,
                  rowsBeforeGroup + rowIndex,
                  rankText,
                );
                return `<div class="custom-data-row" style="grid-template-columns:${columnTemplate}; ${rowStyleCss}; ${this.customRowsBoxStyle(
                  fittedElement.rowHeight,
                )}; --custom-row-image-size:${rowImageSize}px; ${this.discordWidgetTextStyleCss(
                  bodyTextStyle,
                  input.branding.textPrimary,
                )};">${columns
                  .map((column) => {
                    const isImage =
                      column.field === 'logo' || column.field === 'teamLogo';
                    const content = isImage
                      ? this.buildDiscordCustomImageCell(
                          row,
                          column.field,
                          input.branding,
                          input.kind,
                        )
                      : this.escapeHtml(
                          this.discordCustomRowText(
                            row,
                            column.field,
                            displayRank,
                          ),
                        );
                    const fallbackColor =
                      column.field === 'rank' ||
                      column.field === 'totalPoints' ||
                      column.field === 'metric'
                        ? input.branding.primaryColor
                        : (bodyTextStyle?.color ?? input.branding.textPrimary);
                    return `<div class="custom-cell custom-cell--${column.align} custom-cell--${column.field}" style="${this.customColumnStyle(
                      column,
                      fallbackColor,
                    )}">${content}</div>`;
                  })
                  .join('')}</div>`;
              })
              .join('')
          : `<div class="custom-empty">No result rows yet</div>`;
        return `<div class="custom-row-group" style="transform:translate(${groupOffset.x}px, ${groupOffset.y}px);">${headerHtml}${bodyHtml}</div>`;
      })
      .join('');

    return `<div class="custom-rows" style="left:${fittedElement.x}px; top:${
      fittedElement.y
    }px; width:${fittedElement.width}px; z-index:${fittedElement.zIndex}; grid-template-columns:repeat(${groupColumns}, minmax(0, 1fr)); gap:${
      fittedElement.groupGap
    }px; --custom-row-gap:${fittedElement.rowGap}px; --custom-row-radius:${
      fittedElement.rowRadius
    }px; --custom-row-font-size:${fittedElement.fontSize}px;">${rowGroups}</div>`;
  }

  private buildDiscordCustomTextHtml(
    input: DiscordCustomWidgetInput,
    element: DiscordWidgetCustomTextElement,
  ): string {
    const value = this.discordCustomTextValue(input, element);
    if (!value && element.field !== 'subtitle') return '';
    const textStyle = this.discordWidgetTextStyle(
      input.styleLibrary,
      element.textStyleId,
    );
    const panelSurface = this.escapeHtml(
      element.backgroundColor ?? this.brandingPanelSurface(input.branding),
    );
    const color =
      element.color ??
      textStyle?.color ??
      (element.field === 'eyebrow'
        ? input.branding.primaryColor
        : element.field === 'subtitle' || element.field === 'footer'
          ? input.branding.textMuted
          : input.branding.textPrimary);
    const background = element.background
      ? `background:${panelSurface}; border:1px solid ${input.branding.border}; padding:6px 10px; border-radius:12px;`
      : '';
    return `<div class="custom-text custom-text--${element.field}" style="left:${
      element.x
    }px; top:${element.y}px; width:${element.width}px; height:${
      element.height
    }px; ${this.discordWidgetTextStyleCss(
      textStyle,
      color,
    )}; font-size:${textStyle?.fontSize ?? element.fontSize}px; font-weight:${
      textStyle?.fontWeight ?? element.fontWeight
    }; color:${this.escapeHtml(color)}; text-align:${
      element.align
    }; text-transform:${textStyle?.textTransform ?? element.textTransform}; z-index:${
      element.zIndex
    }; ${background}">${this.escapeHtml(value)}</div>`;
  }

  private buildDiscordCustomWidgetHtml(
    input: DiscordCustomWidgetInput,
  ): Promise<string> {
    const styleLibrary =
      input.styleLibrary ?? this.defaultDiscordWidgetStyleLibrary();
    const resolvedInput = { ...input, styleLibrary };
    const panelSurface = this.escapeHtml(
      this.brandingPanelSurface(input.branding),
    );
    const backgroundStyle = this.discordWidgetBackgroundStyle(
      styleLibrary,
      styleLibrary.selectedBackgroundStyleId,
    );
    const hasBrandingBackgroundImage = /\burl\s*\(/i.test(
      input.branding.background,
    );
    const styleBackgroundFill =
      backgroundStyle?.gradientFrom && backgroundStyle.gradientTo
        ? `linear-gradient(135deg, ${this.escapeHtml(
            backgroundStyle.gradientFrom,
          )}, ${this.escapeHtml(backgroundStyle.gradientTo)})`
        : this.escapeHtml(
            backgroundStyle?.backgroundColor ?? input.branding.background,
          );
    const backgroundFill = hasBrandingBackgroundImage
      ? this.escapeHtml(input.branding.background)
      : styleBackgroundFill;
    const backgroundOverlay =
      backgroundStyle?.overlayColor && backgroundStyle.overlayOpacity > 0
        ? `${this.escapeHtml(
            this.rgbaFromHexColor(
              backgroundStyle.overlayColor,
              backgroundStyle.overlayOpacity,
            ) ?? backgroundStyle.overlayColor,
          )}`
        : 'rgba(0, 0, 0, 0.10)';
    const elementsHtml = input.layout.elements
      .filter((element) => element.enabled)
      .sort((left, right) => left.zIndex - right.zIndex)
      .map((element) =>
        element.type === 'featured'
          ? this.buildDiscordCustomFeaturedHtml(resolvedInput, element)
          : element.type === 'media'
            ? this.buildDiscordCustomMediaHtml(resolvedInput, element)
            : element.type === 'rows'
              ? input.kind === 'match-schedule'
                ? this.buildDiscordCustomScheduleCardsHtml(
                    resolvedInput,
                    element,
                  )
                : this.buildDiscordCustomRowsHtml(resolvedInput, element)
              : element.type === 'image'
                ? this.buildDiscordCustomImageHtml(resolvedInput, element)
                : this.buildDiscordCustomTextHtml(resolvedInput, element),
      )
      .join('\n');

    return Promise.resolve(
      `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Arenzyra Discord Custom Widget</title>
    <style>
      ${this.brandingFontCssImport(input.branding)}
      * { box-sizing: border-box; }
      body {
        margin: 0;
        width: 1200px;
        height: 630px;
        font-family: ${this.brandingFontFamily(input.branding)};
        background: ${backgroundFill};
        color: ${this.escapeHtml(input.branding.textPrimary)};
      }
      .frame {
        position: relative;
        width: 1200px;
        height: 630px;
        overflow: hidden;
      }
      .frame::before {
        content: "";
        position: absolute;
        inset: 0;
        background: ${backgroundOverlay};
        pointer-events: none;
      }
      .overlay-layer,
      .custom-text,
      .custom-rows,
      .custom-image,
      .custom-media,
      .custom-featured,
      .custom-schedule-cards {
        position: absolute;
      }
      .custom-image {
        display: block;
        object-fit: contain;
        max-width: none;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid ${this.escapeHtml(input.branding.border)};
        padding: 2px;
      }
      .overlay-layer {
        height: auto;
        max-width: none;
        object-fit: contain;
        pointer-events: none;
      }
      .custom-text {
        display: flex;
        align-items: center;
        overflow: hidden;
        line-height: 1.04;
        letter-spacing: 0;
        text-transform: uppercase;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .custom-text--subtitle,
      .custom-text--footer {
        text-transform: none;
      }
      .custom-rows {
        display: grid;
        overflow: visible;
      }
      .custom-featured {
        display: grid;
        overflow: visible;
      }
      .custom-media {
        display: grid;
        overflow: hidden;
      }
      .custom-featured-card {
        min-width: 0;
        min-height: var(--custom-featured-height);
        display: grid;
        grid-template-columns: 38px var(--custom-featured-logo) minmax(0, 1fr);
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border-radius: var(--custom-featured-radius);
        background: ${panelSurface};
        border: 1px solid ${this.escapeHtml(input.branding.border)};
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.20);
        overflow: hidden;
      }
      .custom-featured-card[data-layout="vertical"] {
        grid-template-columns: minmax(0, 1fr);
        justify-items: center;
        text-align: center;
      }
      .custom-featured-card[data-layout="compact"] {
        grid-template-columns: var(--custom-featured-logo) minmax(0, 1fr);
      }
      .custom-featured-rank {
        color: ${this.escapeHtml(input.branding.primaryColor)};
        font-size: calc(var(--custom-featured-font) * 1.25);
        font-weight: 900;
        text-align: center;
      }
      .custom-featured-rank--inline {
        margin-bottom: 4px;
      }
      .custom-featured-logo {
        width: var(--custom-featured-logo);
        height: var(--custom-featured-logo);
        object-fit: contain;
        border-radius: var(--custom-featured-logo-radius);
        background: var(--custom-featured-logo-bg);
        border: 1px solid ${this.escapeHtml(input.branding.border)};
        padding: 4px;
      }
      .custom-featured-main {
        min-width: 0;
      }
      .custom-featured-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: ${this.escapeHtml(input.branding.textPrimary)};
        font-size: var(--custom-featured-font);
        font-weight: 900;
        text-transform: uppercase;
        line-height: 1.05;
      }
      .custom-featured-stats {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 6px;
        color: ${this.escapeHtml(input.branding.textMuted)};
        font-size: calc(var(--custom-featured-font) * 0.78);
        font-weight: 800;
        line-height: 1;
      }
      .custom-media-card {
        min-width: 0;
        display: grid;
        grid-template-columns: var(--custom-media-image) minmax(0, 1fr);
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border-radius: var(--custom-media-radius);
        background: ${panelSurface};
        border: 1px solid ${this.escapeHtml(input.branding.border)};
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.22);
        overflow: hidden;
      }
      .custom-media-card[data-layout="vertical"] {
        grid-template-columns: minmax(0, 1fr);
        justify-items: center;
        text-align: center;
      }
      .custom-media-image {
        width: var(--custom-media-image);
        height: var(--custom-media-image);
        object-fit: cover;
        display: block;
        border-radius: var(--custom-media-logo-radius);
        background: var(--custom-media-logo-bg);
        border: 1px solid ${this.escapeHtml(input.branding.border)};
      }
      .custom-media-copy {
        min-width: 0;
      }
      .custom-media-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: ${this.escapeHtml(input.branding.textPrimary)};
        font-size: var(--custom-media-font);
        font-weight: 900;
        text-transform: uppercase;
        line-height: 1.05;
      }
      .custom-media-stat {
        margin-top: 6px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: ${this.escapeHtml(input.branding.textMuted)};
        font-size: calc(var(--custom-media-font) * 0.82);
        font-weight: 800;
      }
      .custom-row-group {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--custom-row-gap);
      }
      .custom-data-row {
        display: grid;
        align-items: center;
        box-sizing: border-box;
        gap: 8px;
        padding: 4px 8px;
        border-radius: var(--custom-row-radius);
        background: ${panelSurface};
        border: 1px solid ${this.escapeHtml(input.branding.border)};
        box-shadow: 0 10px 26px rgba(0, 0, 0, 0.16);
        overflow: hidden;
        font-size: var(--custom-row-font-size);
        font-weight: 800;
      }
      .custom-header-row {
        background: transparent;
        border-color: transparent;
        box-shadow: none;
        color: ${this.escapeHtml(input.branding.textMuted)};
        text-transform: uppercase;
        letter-spacing: 0;
        font-weight: 800;
        line-height: 1;
      }
      .custom-cell {
        min-width: 0;
        max-height: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .custom-cell--center { text-align: center; }
      .custom-cell--right { text-align: right; }
      .custom-cell--logo,
      .custom-cell--teamLogo {
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 0;
      }
      .custom-cell--rank,
      .custom-cell--totalPoints,
      .custom-cell--metric {
        color: ${this.escapeHtml(input.branding.primaryColor)};
      }
      .custom-row-image {
        display: block;
        box-sizing: border-box;
        width: var(--custom-row-image-size, 24px);
        height: var(--custom-row-image-size, 24px);
        max-width: 100%;
        max-height: 100%;
        flex: 0 0 auto;
        object-fit: contain;
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid ${this.escapeHtml(input.branding.border)};
        padding: 3px;
      }
      .custom-schedule-cards {
        display: grid;
        overflow: visible;
      }
      .custom-schedule-card {
        position: relative;
        min-width: 0;
        height: var(--custom-schedule-height);
        overflow: hidden;
        border-radius: var(--custom-schedule-radius);
        border: 1px solid ${this.escapeHtml(input.branding.border)};
        background: ${panelSurface};
        box-shadow: 0 18px 34px rgba(0, 0, 0, 0.34);
        color: ${this.escapeHtml(input.branding.textPrimary)};
        text-align: center;
        text-transform: uppercase;
      }
      .custom-schedule-scene,
      .custom-schedule-tint {
        position: absolute;
        inset: 0;
      }
      .custom-schedule-scene {
        background-size: cover;
        background-position: center;
        transform: scale(1.04);
        filter: saturate(1.08) contrast(1.05);
      }
      .custom-schedule-tint {
        background:
          linear-gradient(180deg, rgba(2,6,23,0.18), rgba(2,6,23,0.12) 42%, rgba(2,6,23,0.88)),
          linear-gradient(135deg, ${this.escapeHtml(
            this.rgbaFromHexColor(input.branding.primaryColor, 0.28) ??
              input.branding.primaryColor,
          )}, transparent 54%);
      }
      .custom-schedule-match,
      .custom-schedule-map {
        position: absolute;
        top: 8px;
        z-index: 2;
        max-width: 46%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        border: 1px solid ${this.escapeHtml(input.branding.border)};
        border-radius: 8px;
        background: rgba(2, 6, 23, 0.58);
        padding: 5px 8px;
        font-size: max(9px, calc(var(--custom-schedule-font) * 0.78));
        font-weight: 950;
        line-height: 1;
      }
      .custom-schedule-match {
        left: 8px;
        text-align: left;
      }
      .custom-schedule-map {
        right: 8px;
        color: ${this.escapeHtml(input.branding.primaryColor)};
        text-align: right;
      }
      .custom-schedule-content {
        position: relative;
        z-index: 1;
        height: 100%;
        min-height: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-end;
        padding: 40px 12px 12px;
      }
      .custom-schedule-logo-shell {
        width: calc(var(--custom-schedule-logo) + 18px);
        height: calc(var(--custom-schedule-logo) + 18px);
        margin: auto 0;
        display: grid;
        place-items: center;
        border: 1px solid ${this.escapeHtml(input.branding.border)};
        border-radius: 14px;
        background: rgba(2, 6, 23, 0.38);
        padding: 5px;
      }
      .custom-schedule-logo {
        width: var(--custom-schedule-logo);
        height: var(--custom-schedule-logo);
        object-fit: contain;
        display: block;
      }
      .custom-schedule-winner {
        width: 100%;
        margin-top: 8px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--custom-schedule-font);
        font-weight: 950;
        line-height: 1;
      }
      .custom-schedule-stats {
        width: 100%;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        margin-top: 8px;
        font-size: max(9px, calc(var(--custom-schedule-font) * 0.78));
        font-weight: 950;
        line-height: 1;
      }
      .custom-schedule-stats span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        border: 1px solid ${this.escapeHtml(input.branding.border)};
        border-radius: 7px;
        background: rgba(2, 6, 23, 0.48);
        padding: 5px 7px;
      }
      .custom-schedule-stats span:last-child {
        color: ${this.escapeHtml(input.branding.primaryColor)};
      }
      .custom-empty {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 120px;
        border: 1px dashed ${this.escapeHtml(input.branding.border)};
        border-radius: 16px;
        color: ${this.escapeHtml(input.branding.textMuted)};
        background: ${panelSurface};
        font-size: 22px;
        font-weight: 800;
      }
    </style>
  </head>
  <body>
    <div class="frame">
      ${input.overlayLayersHtml ?? ''}
      ${elementsHtml}
    </div>
  </body>
</html>
    `.trim(),
    );
  }

  private studioRuntimeId(prefix: string, id: string) {
    return `${prefix}-${id}`.replace(/[^a-zA-Z0-9_-]/g, '-');
  }

  private studioElementTransform(element: StudioElement) {
    const rotation =
      typeof element.rotation === 'number' && Number.isFinite(element.rotation)
        ? element.rotation
        : 0;
    if (!rotation) return '';
    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;
    return `translate(${centerX} ${centerY}) rotate(${rotation}) translate(${-centerX} ${-centerY})`;
  }

  private studioGradientFill(element: StudioElement, prefix: string) {
    const gradient = this.isRecord(element.gradient) ? element.gradient : null;
    if (!gradient || gradient.enabled !== true) return null;
    return `url(#${this.studioRuntimeId(prefix, `${element.id}-gradient`)})`;
  }

  private studioElementFill(element: StudioElement, prefix: string) {
    return (
      this.studioGradientFill(element, prefix) ??
      this.primitiveString(element.fill) ??
      'transparent'
    );
  }

  private studioShadowFilter(element: StudioElement, prefix: string) {
    const shadow = this.isRecord(element.shadow) ? element.shadow : null;
    if (!shadow || shadow.enabled !== true) return '';
    return `url(#${this.studioRuntimeId(prefix, `${element.id}-shadow`)})`;
  }

  private studioDataFieldValue(
    design: StudioDesign,
    element: StudioElement,
    values: Record<string, string>,
  ) {
    const binding = element.dataBinding;
    if (!binding) return null;
    const fields = design.dataFields ?? [];
    const field = fields.find((entry) => entry.id === binding.fieldId);
    const candidateKeys = [
      binding.key,
      field?.key,
      ...(field?.aliases ?? []),
      field?.id,
    ].filter((value): value is string => Boolean(value));
    for (const key of candidateKeys) {
      const value = values[this.normalizeStudioFieldKey(key)];
      if (value !== undefined) return value;
    }
    return field?.sampleValue ?? null;
  }

  private studioElementWithData(
    design: StudioDesign,
    element: StudioElement,
    values: Record<string, string>,
  ): StudioElement {
    const binding = element.dataBinding;
    if (!binding) return element;
    const value = this.studioDataFieldValue(design, element, values);
    if (value === null || value === undefined) return element;
    if (binding.role === 'text' && element.kind === 'text') {
      return { ...element, text: value };
    }
    if (binding.role === 'image' && element.kind === 'image' && value.trim()) {
      return { ...element, src: value };
    }
    if (binding.role === 'fill') {
      return { ...element, fill: value };
    }
    if (binding.role === 'stroke') {
      return { ...element, stroke: value };
    }
    return element;
  }

  private studioImageClipPath(element: StudioElement, prefix: string) {
    const mask = this.primitiveString(element.mask) || 'none';
    const radius = this.clampNumber(element.maskRadius, 0, 0, 240);
    const clipId = this.studioRuntimeId(prefix, `${element.id}-clip`);
    if (mask === 'circle') {
      return `<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><ellipse cx="${
        element.x + element.width / 2
      }" cy="${element.y + element.height / 2}" rx="${Math.abs(
        element.width / 2,
      )}" ry="${Math.abs(element.height / 2)}" /></clipPath>`;
    }
    if (mask === 'diamond') {
      const points = [
        `${element.x + element.width / 2},${element.y}`,
        `${element.x + element.width},${element.y + element.height / 2}`,
        `${element.x + element.width / 2},${element.y + element.height}`,
        `${element.x},${element.y + element.height / 2}`,
      ].join(' ');
      return `<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><polygon points="${points}" /></clipPath>`;
    }
    if (mask === 'hexagon') {
      const left = element.x;
      const right = element.x + element.width;
      const top = element.y;
      const bottom = element.y + element.height;
      const inset = element.width * 0.18;
      const points = [
        `${left + inset},${top}`,
        `${right - inset},${top}`,
        `${right},${top + element.height / 2}`,
        `${right - inset},${bottom}`,
        `${left + inset},${bottom}`,
        `${left},${top + element.height / 2}`,
      ].join(' ');
      return `<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><polygon points="${points}" /></clipPath>`;
    }
    return `<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" rx="${
      mask === 'rounded' ? radius : 0
    }" /></clipPath>`;
  }

  private studioDefsForElement(element: StudioElement, prefix: string) {
    const defs: string[] = [];
    if (element.kind === 'image') {
      defs.push(this.studioImageClipPath(element, prefix));
    }
    const shadow = this.isRecord(element.shadow) ? element.shadow : null;
    if (shadow?.enabled === true) {
      defs.push(
        `<filter id="${this.studioRuntimeId(
          prefix,
          `${element.id}-shadow`,
        )}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${this.clampNumber(
          shadow.offsetX,
          0,
          -200,
          200,
        )}" dy="${this.clampNumber(shadow.offsetY, 0, -200, 200)}" stdDeviation="${Math.max(
          0,
          this.clampNumber(shadow.blur, 0, 0, 200) / 2,
        )}" flood-color="${this.escapeHtml(this.primitiveString(shadow.color) || '#000000')}" flood-opacity="${this.clampNumber(
          shadow.opacity,
          0.35,
          0,
          1,
        )}" /></filter>`,
      );
    }
    const gradient = this.isRecord(element.gradient) ? element.gradient : null;
    if (gradient?.enabled === true) {
      defs.push(
        `<linearGradient id="${this.studioRuntimeId(
          prefix,
          `${element.id}-gradient`,
        )}" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="${this.escapeHtml(
          this.primitiveString(gradient.from) || '#ffffff',
        )}" /><stop offset="100%" stop-color="${this.escapeHtml(
          this.primitiveString(gradient.to) || '#ffffff',
        )}" /></linearGradient>`,
      );
    }
    return defs;
  }

  private studioTextTransform(value: unknown) {
    const transform = this.primitiveString(value);
    return ['uppercase', 'lowercase', 'capitalize'].includes(transform)
      ? transform
      : 'none';
  }

  private studioTextValue(element: StudioElement) {
    const value = this.primitiveString(element.text);
    const transform = this.studioTextTransform(element.textTransform);
    if (transform === 'uppercase') return value.toUpperCase();
    if (transform === 'lowercase') return value.toLowerCase();
    if (transform === 'capitalize') {
      return value.replace(/\b\w/g, (character) => character.toUpperCase());
    }
    return value;
  }

  private studioElementToSvg(element: StudioElement, prefix: string) {
    if (element.visible === false) return '';
    const transform = this.studioElementTransform(element);
    const filter = this.studioShadowFilter(element, prefix);
    const groupAttrs = [
      `opacity="${this.clampNumber(element.opacity, 1, 0, 1)}"`,
      transform ? `transform="${this.escapeHtml(transform)}"` : '',
      filter ? `filter="${this.escapeHtml(filter)}"` : '',
    ]
      .filter(Boolean)
      .join(' ');

    if (element.kind === 'text') {
      const align = ['left', 'center', 'right'].includes(
        this.primitiveString(element.textAlign),
      )
        ? this.primitiveString(element.textAlign)
        : 'left';
      const fontSize = this.clampNumber(element.fontSize, 32, 1, 300);
      const fontWeight = Math.round(
        this.clampNumber(element.fontWeight, 700, 100, 1000),
      );
      const strokeWidth = this.clampNumber(element.textStrokeWidth, 0, 0, 20);
      const strokeCss =
        strokeWidth > 0
          ? `-webkit-text-stroke:${strokeWidth}px ${this.escapeHtml(
              this.primitiveString(element.textStrokeColor) || '#000000',
            )};`
          : '';
      return `<g ${groupAttrs}><foreignObject x="${element.x}" y="${
        element.y
      }" width="${element.width}" height="${element.height}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;overflow:hidden;white-space:pre-wrap;overflow-wrap:break-word;color:${this.escapeHtml(
        this.primitiveString(element.fill) || '#ffffff',
      )};font-family:${this.escapeHtml(
        this.primitiveString(element.fontFamily) || 'Inter, Arial, sans-serif',
      )};font-size:${fontSize}px;font-weight:${fontWeight};font-style:${this.escapeHtml(
        this.primitiveString(element.fontStyle) || 'normal',
      )};text-decoration:${this.escapeHtml(
        this.primitiveString(element.textDecoration) || 'none',
      )};text-align:${align};line-height:${this.clampNumber(
        element.lineHeight,
        1.05,
        0.5,
        3,
      )};letter-spacing:${this.clampNumber(
        element.letterSpacing,
        0,
        -20,
        80,
      )}px;${strokeCss}">${this.escapeHtml(
        this.studioTextValue(element),
      )}</div></foreignObject></g>`;
    }

    if (element.kind === 'rect') {
      return `<g ${groupAttrs}><rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" rx="${this.clampNumber(
        element.radius,
        0,
        0,
        300,
      )}" fill="${this.escapeHtml(
        this.studioElementFill(element, prefix),
      )}" stroke="${this.escapeHtml(
        this.primitiveString(element.stroke) || 'transparent',
      )}" stroke-width="${this.clampNumber(element.strokeWidth, 0, 0, 80)}" /></g>`;
    }

    if (element.kind === 'ellipse') {
      return `<g ${groupAttrs}><ellipse cx="${element.x + element.width / 2}" cy="${
        element.y + element.height / 2
      }" rx="${Math.abs(element.width / 2)}" ry="${Math.abs(
        element.height / 2,
      )}" fill="${this.escapeHtml(
        this.studioElementFill(element, prefix),
      )}" stroke="${this.escapeHtml(
        this.primitiveString(element.stroke) || 'transparent',
      )}" stroke-width="${this.clampNumber(element.strokeWidth, 0, 0, 80)}" /></g>`;
    }

    if (element.kind === 'line') {
      const linecap = ['butt', 'round', 'square'].includes(
        this.primitiveString(element.strokeLinecap),
      )
        ? this.primitiveString(element.strokeLinecap)
        : 'butt';
      return `<g ${groupAttrs}><line x1="${element.x}" y1="${element.y}" x2="${
        element.x + element.width
      }" y2="${element.y + element.height}" stroke="${this.escapeHtml(
        this.primitiveString(element.stroke) || '#ffffff',
      )}" stroke-width="${this.clampNumber(
        element.strokeWidth,
        1,
        0,
        80,
      )}" stroke-linecap="${linecap}" /></g>`;
    }

    if (element.kind === 'shape') {
      const fillRule =
        this.primitiveString(element.fillRule) === 'evenodd'
          ? 'evenodd'
          : 'nonzero';
      return `<g ${groupAttrs}><svg x="${element.x}" y="${element.y}" width="${
        element.width
      }" height="${element.height}" viewBox="${this.escapeHtml(
        this.primitiveString(element.viewBox) || '0 0 100 100',
      )}" preserveAspectRatio="none" overflow="visible"><path d="${this.escapeHtml(
        this.primitiveString(element.path) || '',
      )}" fill="${this.escapeHtml(
        this.studioElementFill(element, prefix),
      )}" stroke="${this.escapeHtml(
        this.primitiveString(element.stroke) || 'transparent',
      )}" stroke-width="${this.clampNumber(
        element.strokeWidth,
        0,
        0,
        80,
      )}" fill-rule="${fillRule}" vector-effect="non-scaling-stroke" /></svg></g>`;
    }

    const src = this.normalizeAssetUrl(element.src);
    if (!src) return '';
    const fit = this.primitiveString(element.fit);
    const preserveAspectRatio =
      fit === 'stretch'
        ? 'none'
        : fit === 'contain'
          ? 'xMidYMid meet'
          : 'xMidYMid slice';
    const filters = this.isRecord(element.filters) ? element.filters : {};
    const filterCss = [
      `brightness(${this.clampNumber(filters.brightness, 100, 0, 300)}%)`,
      `contrast(${this.clampNumber(filters.contrast, 100, 0, 300)}%)`,
      `saturate(${this.clampNumber(filters.saturation, 100, 0, 300)}%)`,
      `blur(${this.clampNumber(filters.blur, 0, 0, 80)}px)`,
      `grayscale(${this.clampNumber(filters.grayscale, 0, 0, 100)}%)`,
    ].join(' ');
    return `<g ${groupAttrs} clip-path="url(#${this.studioRuntimeId(
      prefix,
      `${element.id}-clip`,
    )})"><image href="${this.escapeHtml(src)}" x="${element.x}" y="${
      element.y
    }" width="${element.width}" height="${
      element.height
    }" preserveAspectRatio="${preserveAspectRatio}" style="filter:${this.escapeHtml(
      filterCss,
    )}" /></g>`;
  }

  private buildStudioRuntimeHtml(
    design: StudioDesign,
    page: StudioPage,
    values: Record<string, string>,
  ) {
    const prefix = this.studioRuntimeId(
      'discord-studio',
      `${design.id}-${page.id}`,
    );
    const mappedValues = this.applyStudioDataMappings(design, values);
    const elements = page.elements
      .filter((element): element is StudioElement => this.isRecord(element))
      .map((element) =>
        this.studioElementWithData(design, element, mappedValues),
      );
    const defs = elements
      .flatMap((element) => this.studioDefsForElement(element, prefix))
      .join('\n');
    const pageBackground = page.background.transparent
      ? ''
      : `<rect x="0" y="0" width="${design.width}" height="${design.height}" fill="${this.escapeHtml(
          page.background.color,
        )}" />`;
    const elementHtml = elements
      .map((element) => this.studioElementToSvg(element, prefix))
      .join('\n');

    return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Arenzyra Studio Discord Widget</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        width: 1200px;
        height: 630px;
        background: transparent;
      }
      .frame {
        width: 1200px;
        height: 630px;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }
      svg {
        width: 100%;
        height: 100%;
        display: block;
      }
    </style>
  </head>
  <body>
    <main class="frame">
      <svg xmlns="http://www.w3.org/2000/svg" width="${design.width}" height="${
        design.height
      }" viewBox="0 0 ${design.width} ${design.height}" preserveAspectRatio="xMidYMid meet">
        ${defs ? `<defs>${defs}</defs>` : ''}
        ${pageBackground}
        ${elementHtml}
      </svg>
    </main>
  </body>
</html>`;
  }

  private async renderDiscordStudioWidgetImage(
    input: StudioRenderInput,
  ): Promise<Buffer | null> {
    const studio = input.template?.studio;
    if (!studio?.enabled) return null;
    const page = this.studioPage(studio.design, studio.pageId);
    if (!page) return null;
    const values = this.studioValuesForDiscordWidget(input);
    const html = this.buildStudioRuntimeHtml(studio.design, page, values);
    return this.renderHtmlToImage(html);
  }

  async buildMatchResultHtml(input: MatchTemplateInput): Promise<string> {
    const template = await this.loadTemplate('match-result.template.html');
    const logoHtml = this.buildLogoHtml(input.branding);
    const { rowsHtml, footer } = this.buildMatchRows(
      input.teams,
      input.branding,
    );
    const layout = this.matchLayout(input.teams.length);

    return this.renderTemplate(template, {
      eyebrow: this.escapeHtml(input.eyebrow ?? 'Arenzyra Results'),
      matchName: this.escapeHtml(input.matchName),
      subtitleHtml: input.subtitle
        ? `<div class="subtitle">${this.escapeHtml(input.subtitle)}</div>`
        : '',
      rowsHtml,
      boardColumns: layout.boardColumns,
      boardGap: layout.boardGap,
      rowMinHeight: layout.rowMinHeight,
      rowPadding: layout.rowPadding,
      rowRadius: layout.rowRadius,
      rowRankSize: layout.rowRankSize,
      rowTitleSize: layout.rowTitleSize,
      rowMetaSize: layout.rowMetaSize,
      rowMetricSize: layout.rowMetricSize,
      headerMargin: layout.headerMargin,
      titleSize: layout.titleSize,
      framePaddingTop: `${input.branding.safeArea.top}px`,
      framePaddingRight: `${input.branding.safeArea.right}px`,
      framePaddingBottom: `${input.branding.safeArea.bottom}px`,
      framePaddingLeft: `${input.branding.safeArea.left}px`,
      fontCssImport: this.brandingFontCssImport(input.branding),
      fontFamily: this.brandingFontFamily(input.branding),
      primaryColor: this.escapeHtml(input.branding.primaryColor),
      primarySurface: this.escapeHtml(
        this.brandingPrimarySurface(input.branding),
      ),
      background: this.escapeHtml(input.branding.background),
      textPrimary: this.escapeHtml(input.branding.textPrimary),
      textMuted: this.escapeHtml(input.branding.textMuted),
      panel: this.escapeHtml(input.branding.panel),
      panelSurface: this.escapeHtml(this.brandingPanelSurface(input.branding)),
      border: this.escapeHtml(input.branding.border),
      shadow: this.escapeHtml(input.branding.shadow),
      logoHtml,
      footer: this.escapeHtml(input.footer ?? footer),
      overlayLayersHtml: input.overlayLayersHtml ?? '',
    });
  }

  async buildStandingsHtml(input: StandingsTemplateInput): Promise<string> {
    const template = await this.loadTemplate('standings.template.html');
    const logoHtml = this.buildLogoHtml(input.branding);
    const { rowsHtml, footer } = this.buildStandingsRows(input.teams);

    return this.renderTemplate(template, {
      sessionName: this.escapeHtml(input.sessionName),
      rowsHtml,
      fontCssImport: this.brandingFontCssImport(input.branding),
      fontFamily: this.brandingFontFamily(input.branding),
      primaryColor: this.escapeHtml(input.branding.primaryColor),
      background: this.escapeHtml(input.branding.background),
      textPrimary: this.escapeHtml(input.branding.textPrimary),
      textMuted: this.escapeHtml(input.branding.textMuted),
      panel: this.escapeHtml(input.branding.panel),
      border: this.escapeHtml(input.branding.border),
      shadow: this.escapeHtml(input.branding.shadow),
      logoHtml,
      footer: this.escapeHtml(input.footer ?? footer),
    });
  }

  async buildLeaderboardHtml(input: LeaderboardTemplateInput): Promise<string> {
    const template = await this.loadTemplate(
      'discord-leaderboard.template.html',
    );
    const logoHtml = this.buildLogoHtml(input.branding);
    const { rowsHtml, footer } = this.buildLeaderboardRows(input);
    const layout = this.leaderboardLayout(input.rows.length, input.mode);

    return this.renderTemplate(template, {
      eyebrow: this.escapeHtml(input.eyebrow),
      title: this.escapeHtml(input.title),
      subtitle: this.escapeHtml(input.subtitle),
      rowsHtml,
      boardColumns: layout.boardColumns,
      boardGap: layout.boardGap,
      rowMinHeight: layout.rowMinHeight,
      rowPadding: layout.rowPadding,
      rowRadius: layout.rowRadius,
      rowRankSize: layout.rowRankSize,
      rowTitleSize: layout.rowTitleSize,
      rowMetaSize: layout.rowMetaSize,
      rowMetricSize: layout.rowMetricSize,
      headerMargin: layout.headerMargin,
      titleSize: layout.titleSize,
      framePaddingTop: `${input.branding.safeArea.top}px`,
      framePaddingRight: `${input.branding.safeArea.right}px`,
      framePaddingBottom: `${input.branding.safeArea.bottom}px`,
      framePaddingLeft: `${input.branding.safeArea.left}px`,
      fontCssImport: this.brandingFontCssImport(input.branding),
      fontFamily: this.brandingFontFamily(input.branding),
      primaryColor: this.escapeHtml(input.branding.primaryColor),
      primarySurface: this.escapeHtml(
        this.brandingPrimarySurface(input.branding),
      ),
      background: this.escapeHtml(input.branding.background),
      textPrimary: this.escapeHtml(input.branding.textPrimary),
      textMuted: this.escapeHtml(input.branding.textMuted),
      panel: this.escapeHtml(input.branding.panel),
      panelSurface: this.escapeHtml(this.brandingPanelSurface(input.branding)),
      border: this.escapeHtml(input.branding.border),
      shadow: this.escapeHtml(input.branding.shadow),
      logoHtml,
      footer: this.escapeHtml(footer),
      overlayLayersHtml: input.overlayLayersHtml ?? '',
    });
  }

  async buildDiscordRankingTableHtml(
    input: RankingTableTemplateInput,
  ): Promise<string> {
    const template = await this.loadTemplate(
      'discord-ranking-table.template.html',
    );
    const layout = this.fitRankingTableLayout(
      input.layout ??
        this.defaultDiscordRankingTableLayout(
          input.kind,
          input.rows.length,
          input.branding,
        ),
      input.rows.length,
      input.branding,
    );
    const columns = layout.columns.filter((column) => column.enabled);
    const groupsHtml = this.buildRankingTableGroupsHtml(
      input.rows,
      layout,
      input.emptyText ?? 'No result data yet',
      input.branding,
    );
    const eyebrowHtml = input.eyebrow
      ? `<div class="ranking-eyebrow">${this.escapeHtml(input.eyebrow)}</div>`
      : '';
    const subtitleHtml = input.subtitle
      ? `<div class="ranking-subtitle">${this.escapeHtml(input.subtitle)}</div>`
      : '';
    const visibleRows = Math.min(input.rows.length, layout.maxRows);
    const footerText =
      visibleRows > 0 && visibleRows < input.rows.length
        ? `Showing top ${visibleRows} of ${input.rows.length}`
        : (input.footer ?? '');
    const footerHtml = footerText
      ? `<div class="ranking-footer">${this.escapeHtml(footerText)}</div>`
      : '';

    return this.renderTemplate(template, {
      title: this.escapeHtml(input.title),
      eyebrowHtml,
      subtitleHtml,
      groupsHtml,
      footerHtml,
      groupColumns: String(layout.groupColumns),
      columnTemplate: this.rankingTableColumnTemplate(columns),
      tableX: `${layout.tableX}px`,
      tableY: `${layout.tableY}px`,
      tableWidth: `${layout.tableWidth}px`,
      tableHeight: `${layout.tableHeight}px`,
      groupGap: `${layout.groupGap}px`,
      rowGap: `${layout.rowGap}px`,
      rowHeight: `${layout.rowHeight}px`,
      rowRadius: `${layout.rowRadius}px`,
      headerHeight: `${layout.headerHeight}px`,
      headerFontSize: `${layout.headerFontSize}px`,
      titleHeight: `${layout.titleHeight}px`,
      titleSize: `${layout.titleSize}px`,
      logoSize: `${layout.logoSize}px`,
      teamFontSize: `${layout.teamFontSize}px`,
      metricFontSize: `${layout.metricFontSize}px`,
      framePaddingTop: `${input.branding.safeArea.top}px`,
      framePaddingRight: `${input.branding.safeArea.right}px`,
      framePaddingBottom: `${input.branding.safeArea.bottom}px`,
      framePaddingLeft: `${input.branding.safeArea.left}px`,
      fontCssImport: this.brandingFontCssImport(input.branding),
      fontFamily: this.brandingFontFamily(input.branding),
      primaryColor: this.escapeHtml(input.branding.primaryColor),
      primarySurface: this.escapeHtml(
        this.brandingPrimarySurface(input.branding),
      ),
      background: this.escapeHtml(input.branding.background),
      textPrimary: this.escapeHtml(input.branding.textPrimary),
      textMuted: this.escapeHtml(input.branding.textMuted),
      panel: this.escapeHtml(input.branding.panel),
      panelSurface: this.escapeHtml(this.brandingPanelSurface(input.branding)),
      border: this.escapeHtml(input.branding.border),
      overlayLayersHtml: input.overlayLayersHtml ?? '',
    });
  }

  async renderHtmlToImage(html: string): Promise<Buffer> {
    const executablePath =
      process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined;
    const browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setViewport(MATCH_VIEWPORT);
      await page.setContent(html, {
        waitUntil: 'domcontentloaded',
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const screenshot = await page.screenshot({
        type: 'png',
        omitBackground: true,
      });
      return Buffer.isBuffer(screenshot) ? screenshot : Buffer.from(screenshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(
        `Failed to render image: ${message}`,
      );
    } finally {
      await browser.close();
    }
  }

  async renderMatchResultImage(
    actor: AuthUser,
    matchId: string,
    options?: { useDiscordWidgetTemplate?: boolean },
  ): Promise<Buffer> {
    const accessibleMatch = await this.results.ensureMatch(actor, matchId);
    const match = await this.prisma.match.findFirst({
      where: {
        id: matchId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        organizationId: true,
        sessionId: true,
        matchNumber: true,
        session: {
          select: {
            id: true,
            name: true,
          },
        },
        status: true,
        slotResults: {
          where: { teamId: { not: null } },
          select: {
            teamId: true,
            wasPresentInMatch: true,
            placement: true,
            totalKills: true,
            totalPoints: true,
            points: true,
            slotNumber: true,
            placementPoints: true,
            team: {
              select: {
                tag: true,
                name: true,
                logoUrl: true,
              },
            },
          },
        },
      },
    });

    if (!match) {
      throw new NotFoundException('Match not found');
    }

    const currentTeamScope = await this.currentMatchTeamScope(match.id);
    const currentTeamIds = currentTeamScope
      ? new Set(currentTeamScope.keys())
      : null;
    const activeTeams = match.slotResults
      .filter(
        (slot) =>
          (!currentTeamIds ||
            (slot.teamId !== null && currentTeamIds.has(slot.teamId))) &&
          isPresentInMatch(slot.wasPresentInMatch) &&
          hasAppliedResultRow(slot),
      )
      .map((slot) => ({
        position: slot.placement ?? slot.slotNumber,
        placement: slot.placement,
        team:
          slot.team?.name?.trim() ||
          slot.team?.tag?.trim() ||
          `SLOT ${slot.slotNumber}`,
        logoUrl: slot.team?.logoUrl ?? null,
        kills: slot.totalKills ?? 0,
        placementPoints: slot.placementPoints ?? 0,
        totalPoints: slot.totalPoints ?? slot.points ?? 0,
      }))
      .sort((left, right) => {
        if (left.position !== right.position) {
          return left.position - right.position;
        }
        if (right.totalPoints !== left.totalPoints) {
          return right.totalPoints - left.totalPoints;
        }
        return right.kills - left.kills;
      });
    let branding = await this.resolveBranding({
      actor,
      organizationId: accessibleMatch.organizationId,
      sessionId: match.sessionId,
      matchId,
    });
    let template: DiscordWidgetTemplateSettings | null = null;
    if (options?.useDiscordWidgetTemplate) {
      const resolvedTemplate = await this.resolveDiscordWidgetTemplate({
        organizationId: accessibleMatch.organizationId ?? match.organizationId,
        sessionId: match.sessionId,
      });
      branding = await this.withDiscordDefaultTeamLogo(
        branding,
        resolvedTemplate,
      );
      branding = this.applyDiscordWidgetTemplate(branding, resolvedTemplate);
      template = resolvedTemplate;
    }
    const matchName = match.name?.trim() || `Match ${match.id}`;
    const sessionName = match.session?.name?.trim() || null;
    const textValues = {
      matchName,
      sessionName,
      sessionOrMatchName: sessionName || matchName,
      overallRankingSubtitle: match.sessionId
        ? `Session table including ${matchName}`
        : `Ranking from ${matchName}`,
    };
    const header = this.resolveDiscordHeaderText(
      template?.texts ?? this.defaultDiscordResultCardText(),
      'discordMatchResult',
      textValues,
      { eyebrow: 'Arenzyra Results', title: matchName, subtitle: '' },
    );
    const footerBase =
      match.status === MatchStatus.FINISHED ||
      match.status === MatchStatus.ENDED
        ? 'Final results'
        : 'Live results snapshot';
    const footer = footerBase;
    const studioRows = activeTeams.map((team) => ({
      rank: `#${team.position}`,
      title: team.team,
      subtitle: `${team.kills} kills`,
      metric: `${team.totalPoints}`,
      logoUrl: team.logoUrl,
      teamLogoUrl: team.logoUrl,
      kills: team.kills,
      placementPoints: team.placementPoints,
      totalPoints: team.totalPoints,
      wwcd: team.placement === 1 ? 1 : 0,
    }));
    const studioImage = await this.renderDiscordStudioWidgetImage({
      kind: 'match-result',
      template,
      branding,
      header,
      textValues,
      rows: studioRows,
      footer,
    });
    if (studioImage) return studioImage;
    const customLayout = this.discordCustomLayoutFor(template, 'match-result');
    if (customLayout) {
      const mediaRows = this.customLayoutUsesPlayerMedia(customLayout)
        ? this.playerStatsToCustomRows(
            await this.loadPlayerStats({
              id: match.id,
              name: match.name,
              organizationId:
                accessibleMatch.organizationId ?? match.organizationId,
              tournamentId: null,
              stageId: null,
              groupId: null,
              sessionId: match.sessionId,
              matchNumber: match.matchNumber ?? null,
              session: match.session,
            }),
          )
        : undefined;
      const html = await this.buildDiscordCustomWidgetHtml({
        kind: 'match-result',
        eyebrow: header.eyebrow,
        title: header.title,
        subtitle: header.subtitle,
        rows: activeTeams.map((team) => ({
          rank: `#${team.position}`,
          title: team.team,
          subtitle: `${team.kills} kills`,
          metric: `${team.totalPoints}`,
          logoUrl: team.logoUrl,
          teamLogoUrl: team.logoUrl,
          kills: team.kills,
          placementPoints: team.placementPoints,
          totalPoints: team.totalPoints,
        })),
        branding,
        styleLibrary:
          template?.styleLibrary ?? this.defaultDiscordWidgetStyleLibrary(),
        footer,
        mediaRows,
        overlayLayersHtml: this.buildDiscordOverlayLayersHtml(
          template?.overlayLayers ?? [],
          'match-result',
        ),
        layout: customLayout,
      });
      return this.renderHtmlToImage(html);
    }
    if (options?.useDiscordWidgetTemplate) {
      const tableBranding = this.rankingTableBranding(branding);
      const html = await this.buildDiscordRankingTableHtml({
        kind: 'match-result',
        eyebrow: header.eyebrow,
        title: header.title,
        subtitle: header.subtitle,
        rows: activeTeams.map((team) => ({
          rank: String(team.position),
          teamName: team.team,
          logoUrl: team.logoUrl,
          wwcd: team.placement === 1 ? 1 : 0,
          kills: team.kills,
          placementPoints: team.placementPoints,
          totalPoints: team.totalPoints,
        })),
        branding: tableBranding,
        layout: this.resolveRankingTableLayout(
          template,
          'match-result',
          activeTeams.length,
          tableBranding,
        ),
        footer,
        emptyText: 'No completed result rows yet',
        overlayLayersHtml: template
          ? this.buildDiscordOverlayLayersHtml(
              template.overlayLayers,
              'match-result',
            )
          : '',
      });
      return this.renderHtmlToImage(html);
    }
    const html = await this.buildMatchResultHtml({
      matchName: header.title,
      eyebrow: header.eyebrow,
      subtitle: header.subtitle,
      teams: activeTeams,
      branding,
      footer,
      overlayLayersHtml: template
        ? this.buildDiscordOverlayLayersHtml(
            template.overlayLayers,
            'match-result',
          )
        : '',
    });
    return this.renderHtmlToImage(html);
  }

  async renderResultBackupImage(
    actor: AuthUser,
    backupId: string,
    kind: string,
  ): Promise<Buffer> {
    const normalizedKind =
      kind === 'overall-ranking' || kind === 'match-result' ? kind : null;
    if (!normalizedKind) {
      throw new BadRequestException(
        `Unsupported result backup render kind "${kind}"`,
      );
    }

    const backup = await this.prisma.resultBackup.findUnique({
      where: { id: backupId },
      select: {
        id: true,
        organizationId: true,
        sessionId: true,
        kind: true,
        matchName: true,
        sessionName: true,
        title: true,
        createdAt: true,
        expiresAt: true,
        session: { select: { id: true, name: true } },
        rows: {
          orderBy: [{ rank: 'asc' }],
          select: {
            rank: true,
            teamName: true,
            teamTag: true,
            logoUrl: true,
            placement: true,
            wwcd: true,
            placementPoints: true,
            kills: true,
            totalPoints: true,
          },
        },
      },
    });

    if (!backup || backup.expiresAt <= new Date()) {
      throw new NotFoundException('Result backup not found');
    }
    const actorOrg = effectiveOrganizationId(actor);
    const isUnscopedSuperAdmin =
      (actor.role === Role.SUPER_ADMIN ||
        actor.actorRole === Role.SUPER_ADMIN) &&
      !actor.actingOrgId;
    if (!isUnscopedSuperAdmin && actorOrg !== backup.organizationId) {
      throw new ForbiddenException('Not allowed to access this result backup');
    }

    const targetKind =
      backup.kind.toUpperCase() === 'OVERALL'
        ? 'overall-ranking'
        : 'match-result';
    if (normalizedKind !== targetKind) {
      throw new BadRequestException(
        `Backup ${backup.id} must be rendered as ${targetKind}`,
      );
    }

    let branding = await this.resolveBranding({
      actor,
      organizationId: backup.organizationId,
      sessionId: backup.sessionId,
    });
    const template = await this.resolveDiscordWidgetTemplate({
      organizationId: backup.organizationId,
      sessionId: backup.sessionId,
    });
    branding = await this.withDiscordDefaultTeamLogo(branding, template);
    branding = this.applyDiscordWidgetTemplate(branding, template);

    const sessionName =
      backup.sessionName?.trim() || backup.session?.name?.trim() || null;
    const matchName =
      backup.matchName?.trim() ||
      backup.title?.trim() ||
      sessionName ||
      'Result backup';
    const textValues = {
      matchName,
      sessionName,
      sessionOrMatchName: sessionName || matchName,
      overallRankingSubtitle: sessionName
        ? `Corrected backup for ${sessionName}`
        : 'Corrected result backup',
    };
    const prefix =
      targetKind === 'overall-ranking'
        ? 'discordOverallRanking'
        : 'discordMatchResult';
    const header = this.resolveDiscordHeaderText(
      template.texts,
      prefix,
      textValues,
      targetKind === 'overall-ranking'
        ? {
            eyebrow: 'Overall Ranking',
            title: sessionName || matchName,
            subtitle: textValues.overallRankingSubtitle,
          }
        : { eyebrow: 'Arenzyra Results', title: matchName, subtitle: '' },
    );
    const footer = `Corrected backup - ${backup.createdAt
      .toISOString()
      .slice(0, 10)}`;
    const rows = backup.rows.map((row) => {
      const title =
        row.teamName?.trim() || row.teamTag?.trim() || `Team ${row.rank}`;
      const rank =
        targetKind === 'match-result' ? (row.placement ?? row.rank) : row.rank;
      return {
        rank: String(rank),
        title,
        subtitle: `${row.kills ?? 0} kills`,
        metric: `${row.totalPoints ?? 0}`,
        logoUrl: row.logoUrl,
        teamLogoUrl: row.logoUrl,
        wwcd: row.wwcd ?? (row.placement === 1 ? 1 : 0),
        kills: row.kills ?? 0,
        placementPoints: row.placementPoints ?? 0,
        totalPoints: row.totalPoints ?? 0,
      };
    });
    const overlayLayersHtml = this.buildDiscordOverlayLayersHtml(
      template.overlayLayers,
      targetKind,
    );
    const studioImage = await this.renderDiscordStudioWidgetImage({
      kind: targetKind,
      template,
      branding,
      header,
      textValues,
      rows: rows.map((row) => ({
        rank: `#${row.rank}`,
        title: row.title,
        subtitle: `${row.kills} kills`,
        metric: `${row.totalPoints}`,
        logoUrl: row.logoUrl,
        teamLogoUrl: row.logoUrl,
        wwcd: row.wwcd,
        kills: row.kills,
        placementPoints: row.placementPoints,
        totalPoints: row.totalPoints,
      })),
      footer,
    });
    if (studioImage) return studioImage;
    const customLayout = this.discordCustomLayoutFor(template, targetKind);
    if (customLayout) {
      const html = await this.buildDiscordCustomWidgetHtml({
        kind: targetKind,
        eyebrow: header.eyebrow,
        title: header.title,
        subtitle: header.subtitle,
        rows: rows.map((row) => ({ ...row, rank: `#${row.rank}` })),
        branding,
        styleLibrary:
          template?.styleLibrary ?? this.defaultDiscordWidgetStyleLibrary(),
        footer,
        overlayLayersHtml,
        layout: customLayout,
      });
      return this.renderHtmlToImage(html);
    }

    const tableBranding = this.rankingTableBranding(branding);
    const html = await this.buildDiscordRankingTableHtml({
      kind: targetKind,
      eyebrow: header.eyebrow,
      title: header.title,
      subtitle: header.subtitle,
      rows: rows.map((row) => ({
        rank: row.rank,
        teamName: row.title,
        logoUrl: row.logoUrl,
        wwcd: row.wwcd,
        placementPoints: row.placementPoints,
        kills: row.kills,
        totalPoints: row.totalPoints,
      })),
      branding: tableBranding,
      layout: this.resolveRankingTableLayout(
        template,
        targetKind,
        rows.length,
        tableBranding,
      ),
      footer,
      emptyText: 'No backup rows yet',
      overlayLayersHtml,
    });
    return this.renderHtmlToImage(html);
  }

  async renderSessionStandingsImage(
    actor: AuthUser,
    sessionId: string,
  ): Promise<Buffer> {
    const [standings, session] = await Promise.all([
      this.sessionStandings.getStandings(sessionId, actor),
      this.prisma.session.findFirst({
        where: {
          id: sessionId,
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          organizationId: true,
        },
      }),
    ]);

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    let branding = await this.resolveBranding({
      actor,
      organizationId: session.organizationId,
      sessionId,
    });
    const template = await this.resolveDiscordWidgetTemplate({
      organizationId: session.organizationId,
      sessionId,
    });
    branding = { ...branding, fontFamily: template.fontFamily };
    const html = await this.buildStandingsHtml({
      sessionName: session.name,
      teams: standings.teams.slice(0, STANDINGS_LIMIT).map((team) => ({
        rank: team.rank,
        tag: team.tag?.trim() || team.teamId,
        totalPoints: team.totalPoints,
      })),
      branding,
      footer:
        standings.teams.length > STANDINGS_LIMIT
          ? `Showing top ${STANDINGS_LIMIT} of ${standings.teams.length}`
          : `Showing ${standings.teams.length} teams`,
    });

    return this.renderHtmlToImage(html);
  }

  private async buildOverallRankingRows(match: RenderMatchMeta): Promise<{
    rows: LeaderboardTemplateRow[];
    footer: string;
  }> {
    const matchIds = await this.resolveRankingMatchIds(match);
    const currentTeamScope = match.sessionId
      ? await this.currentMatchTeamScope(match.id)
      : null;
    const currentTeamIds = currentTeamScope
      ? Array.from(currentTeamScope.keys())
      : null;

    const slotResults = await this.prisma.matchSlotResult.findMany({
      where: {
        matchId: { in: matchIds },
        organizationId: match.organizationId,
        teamId: currentTeamIds ? { in: currentTeamIds } : { not: null },
      },
      select: {
        matchId: true,
        teamId: true,
        wasPresentInMatch: true,
        placement: true,
        placementPoints: true,
        totalKills: true,
        totalPoints: true,
        points: true,
        team: {
          select: {
            id: true,
            name: true,
            tag: true,
            logoUrl: true,
          },
        },
      },
    });

    const aggregates = new Map<
      string,
      {
        teamId: string;
        tag: string | null;
        name: string | null;
        logoUrl: string | null;
        wwcd: number;
        totalPoints: number;
        totalKills: number;
        placementPoints: number;
        matchesPlayed: number;
        slotNumber: number | null;
      }
    >();

    for (const team of currentTeamScope?.values() ?? []) {
      aggregates.set(team.teamId, {
        teamId: team.teamId,
        tag: team.tag,
        name: team.name,
        logoUrl: team.logoUrl,
        wwcd: 0,
        totalPoints: 0,
        totalKills: 0,
        placementPoints: 0,
        matchesPlayed: 0,
        slotNumber: team.slotNumber,
      });
    }

    for (const result of slotResults) {
      if (
        !result.teamId ||
        (currentTeamScope !== null && !currentTeamScope.has(result.teamId)) ||
        !isPresentInMatch(result.wasPresentInMatch) ||
        !hasAppliedResultRow(result)
      ) {
        continue;
      }
      const scopedTeam = currentTeamScope?.get(result.teamId) ?? null;
      const current = aggregates.get(result.teamId) ?? {
        teamId: result.teamId,
        tag: scopedTeam?.tag ?? result.team?.tag ?? null,
        name: scopedTeam?.name ?? result.team?.name ?? null,
        logoUrl: scopedTeam?.logoUrl ?? result.team?.logoUrl ?? null,
        wwcd: 0,
        totalPoints: 0,
        totalKills: 0,
        placementPoints: 0,
        matchesPlayed: 0,
        slotNumber: scopedTeam?.slotNumber ?? null,
      };
      current.totalPoints += result.totalPoints ?? result.points ?? 0;
      current.totalKills += result.totalKills ?? 0;
      current.placementPoints += result.placementPoints ?? 0;
      if (result.placement === 1) {
        current.wwcd += 1;
      }
      current.matchesPlayed += 1;
      if (!current.tag && result.team?.tag) {
        current.tag = result.team.tag;
      }
      if (!current.name && result.team?.name) {
        current.name = result.team.name;
      }
      if (!current.logoUrl && result.team?.logoUrl) {
        current.logoUrl = result.team.logoUrl;
      }
      aggregates.set(result.teamId, current);
    }

    const ranked = Array.from(aggregates.values()).sort((left, right) => {
      const rankingOrder = compareRankingRows(left, right);
      if (rankingOrder !== 0) return rankingOrder;
      const leftSlot = left.slotNumber ?? Number.MAX_SAFE_INTEGER;
      const rightSlot = right.slotNumber ?? Number.MAX_SAFE_INTEGER;
      if (leftSlot !== rightSlot) return leftSlot - rightSlot;
      return left.teamId.localeCompare(right.teamId);
    });

    return {
      rows: ranked.slice(0, DISCORD_RANKING_LIMIT).map((team, index) => ({
        rank: `#${index + 1}`,
        title: team.name?.trim() || team.tag?.trim() || team.teamId,
        subtitle: `${team.matchesPlayed} match${
          team.matchesPlayed === 1 ? '' : 'es'
        } - ${team.totalKills} kills`,
        metric: `${team.totalPoints} pts`,
        logoUrl: team.logoUrl,
        wwcd: team.wwcd,
        kills: team.totalKills,
        placementPoints: team.placementPoints,
        totalPoints: team.totalPoints,
      })),
      footer:
        ranked.length > DISCORD_RANKING_LIMIT
          ? `Showing top ${DISCORD_RANKING_LIMIT} of ${ranked.length}`
          : `Showing ${ranked.length} teams`,
    };
  }

  private async resolveRankingMatchIds(
    match: RenderMatchMeta,
  ): Promise<string[]> {
    const matchIds = new Set<string>([match.id]);

    if (match.sessionId) {
      const sessionMatches = await this.prisma.match.findMany({
        where: {
          sessionId: match.sessionId,
          organizationId: match.organizationId,
          deletedAt: null,
          ...(typeof match.matchNumber === 'number'
            ? {
                OR: [
                  { id: match.id },
                  { matchNumber: { lte: match.matchNumber } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
        },
      });
      sessionMatches.forEach((sessionMatch) => matchIds.add(sessionMatch.id));
    } else if (match.groupId) {
      const groupMatches = await this.prisma.match.findMany({
        where: {
          groupId: match.groupId,
          organizationId: match.organizationId,
          deletedAt: null,
        },
        select: {
          id: true,
        },
      });
      groupMatches.forEach((groupMatch) => matchIds.add(groupMatch.id));
    } else if (match.stageId) {
      const stageMatches = await this.prisma.match.findMany({
        where: {
          stageId: match.stageId,
          organizationId: match.organizationId,
          deletedAt: null,
        },
        select: {
          id: true,
        },
      });
      stageMatches.forEach((stageMatch) => matchIds.add(stageMatch.id));
    } else if (match.tournamentId) {
      const tournamentMatches = await this.prisma.match.findMany({
        where: {
          tournamentId: match.tournamentId,
          organizationId: match.organizationId,
          deletedAt: null,
        },
        select: {
          id: true,
        },
      });
      tournamentMatches.forEach((tournamentMatch) =>
        matchIds.add(tournamentMatch.id),
      );
    }

    return Array.from(matchIds);
  }

  private async loadPlayerStats(
    match: RenderMatchMeta,
    opts: { scope?: 'match' | 'ranking' } = {},
  ): Promise<PlayerStatRow[]> {
    const matchIds =
      opts.scope === 'ranking'
        ? await this.resolveRankingMatchIds(match)
        : [match.id];
    const currentTeamScope =
      opts.scope === 'ranking' && match.sessionId
        ? await this.currentMatchTeamScope(match.id)
        : null;
    const currentTeamIds = currentTeamScope
      ? Array.from(currentTeamScope.keys())
      : null;
    const playerRows = await this.prisma.matchSlotPlayerResult.findMany({
      where: {
        slotResult: {
          matchId: { in: matchIds },
          organizationId: match.organizationId,
          teamId: currentTeamIds ? { in: currentTeamIds } : { not: null },
        },
      },
      select: {
        id: true,
        playerId: true,
        pubgAccountId: true,
        externalPlayerId: true,
        playerName: true,
        kills: true,
        knocks: true,
        assists: true,
        isAlive: true,
        alive: true,
        player: {
          select: {
            id: true,
            ign: true,
            realName: true,
            photoUrl: true,
            updatedAt: true,
          },
        },
        slotResult: {
          select: {
            wasPresentInMatch: true,
            placement: true,
            placementPoints: true,
            totalKills: true,
            totalPoints: true,
            points: true,
            team: {
              select: {
                id: true,
                name: true,
                tag: true,
                logoUrl: true,
                logoLightUrl: true,
                logoDarkUrl: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    });
    const playerUidCandidates = [
      ...new Set(
        playerRows
          .flatMap((row) => [row.externalPlayerId, row.pubgAccountId])
          .map((value) => this.normalizePlayerExternalId(value))
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const playersByExternalId = new Map<
      string,
      {
        id: string;
        ign: string;
        realName: string | null;
        photoUrl: string | null;
        updatedAt: Date;
      }
    >();
    if (playerUidCandidates.length > 0) {
      const linkedPlayers = await this.prisma.player.findMany({
        where: {
          organizationId: match.organizationId,
          deletedAt: null,
          OR: [
            { externalPlayerId: { in: playerUidCandidates } },
            { pubgPlayerId: { in: playerUidCandidates } },
            { inGameId: { in: playerUidCandidates } },
            { playerOpenId: { in: playerUidCandidates } },
          ],
        },
        select: {
          id: true,
          ign: true,
          realName: true,
          photoUrl: true,
          updatedAt: true,
          externalPlayerId: true,
          pubgPlayerId: true,
          inGameId: true,
          playerOpenId: true,
        },
      });
      for (const player of linkedPlayers) {
        for (const uid of [
          player.externalPlayerId,
          player.pubgPlayerId,
          player.inGameId,
          player.playerOpenId,
        ]) {
          const key = this.normalizePlayerExternalId(uid);
          if (key && !playersByExternalId.has(key)) {
            playersByExternalId.set(key, player);
          }
        }
      }
    }

    const aggregates = new Map<string, PlayerStatRow>();

    for (const row of playerRows) {
      const slotResult = row.slotResult;
      if (
        !slotResult ||
        !isPresentInMatch(slotResult.wasPresentInMatch) ||
        !hasAppliedResultRow(slotResult)
      ) {
        continue;
      }

      const kills = Math.max(0, row.kills ?? 0);
      const knocks = Math.max(0, row.knocks ?? 0);
      const assists = Math.max(0, row.assists ?? 0);
      if (kills <= 0 && knocks <= 0 && assists <= 0) {
        continue;
      }

      const team = slotResult.team ?? null;
      let matchedPlayer: {
        id: string;
        ign: string;
        realName: string | null;
        photoUrl: string | null;
        updatedAt: Date;
      } | null = row.player;
      if (!matchedPlayer) {
        for (const uid of [row.externalPlayerId, row.pubgAccountId]) {
          const key = this.normalizePlayerExternalId(uid);
          const player = key ? playersByExternalId.get(key) : null;
          if (player) {
            matchedPlayer = player;
            break;
          }
        }
      }
      const linkedPlayerId = row.playerId ?? matchedPlayer?.id ?? null;
      const ign =
        matchedPlayer?.ign ??
        row.playerName ??
        matchedPlayer?.realName ??
        'Unknown';
      const normalizedIgn = ign.trim().toLowerCase().replace(/\s+/g, ' ');
      const normalizedTeam =
        team?.id ??
        team?.tag?.trim().toLowerCase() ??
        team?.name?.trim().toLowerCase() ??
        'team';
      const key = linkedPlayerId
        ? `player:${linkedPlayerId}`
        : normalizedIgn && normalizedIgn !== 'unknown'
          ? `name:${normalizedIgn}:team:${normalizedTeam}`
          : `row:${row.id}`;
      const playerId = linkedPlayerId ?? key;
      const placement = slotResult.placement ?? null;
      const alive = row.isAlive ?? row.alive ?? null;
      const placementBonus = placement ? Math.max(0, 21 - placement) : 0;
      const aliveBonus = alive === true ? 2 : 0;
      const score = kills * 6 + assists * 4 + placementBonus + aliveBonus;
      const current = aggregates.get(key) ?? {
        playerId,
        ign,
        teamName: team?.name ?? team?.tag ?? 'Team',
        teamTag: team?.tag ?? null,
        photoUrl:
          resolvePlayerPhotoUrl({
            photoUrl: matchedPlayer?.photoUrl ?? null,
            photoUpdatedAt: matchedPlayer?.updatedAt ?? null,
            updatedAt: matchedPlayer?.updatedAt ?? null,
          }) ?? null,
        teamLogoUrl: team?.logoUrl ? resolveTeamLogoUrl(team) : null,
        kills: 0,
        knocks: 0,
        assists: 0,
        placement,
        alive,
        score: 0,
      };

      current.kills += kills;
      current.knocks += knocks;
      current.assists += assists;
      current.score += score;
      if (!current.photoUrl && matchedPlayer?.photoUrl) {
        current.photoUrl =
          resolvePlayerPhotoUrl({
            photoUrl: matchedPlayer.photoUrl,
            photoUpdatedAt: matchedPlayer.updatedAt ?? null,
            updatedAt: matchedPlayer.updatedAt ?? null,
          }) ?? null;
      }
      if (!current.teamLogoUrl && team?.logoUrl) {
        current.teamLogoUrl = resolveTeamLogoUrl(team);
      }
      if (!current.teamTag && team?.tag) {
        current.teamTag = team.tag;
      }
      if (current.teamName === 'Team' && (team?.name || team?.tag)) {
        current.teamName = team.name ?? team.tag ?? 'Team';
      }
      if (
        placement !== null &&
        (current.placement === null ||
          current.placement === undefined ||
          placement < current.placement)
      ) {
        current.placement = placement;
      }
      if (alive === true) {
        current.alive = true;
      }
      aggregates.set(key, current);
    }

    return Array.from(aggregates.values()).filter(
      (row) => row.kills > 0 || row.knocks > 0 || row.assists > 0,
    );
  }

  private sortPlayersByMvp(left: PlayerStatRow, right: PlayerStatRow): number {
    if (right.score !== left.score) return right.score - left.score;
    if (right.kills !== left.kills) return right.kills - left.kills;
    if (right.assists !== left.assists) return right.assists - left.assists;
    const leftPlacement = left.placement ?? Number.MAX_SAFE_INTEGER;
    const rightPlacement = right.placement ?? Number.MAX_SAFE_INTEGER;
    if (leftPlacement !== rightPlacement) {
      return leftPlacement - rightPlacement;
    }
    return left.ign.localeCompare(right.ign);
  }

  private sortPlayersByKills(
    left: PlayerStatRow,
    right: PlayerStatRow,
  ): number {
    if (right.kills !== left.kills) return right.kills - left.kills;
    if (right.assists !== left.assists) return right.assists - left.assists;
    if (right.knocks !== left.knocks) return right.knocks - left.knocks;
    return left.ign.localeCompare(right.ign);
  }

  async renderDiscordMatchImage(
    actor: AuthUser,
    matchId: string,
    kind: string,
  ): Promise<Buffer> {
    const normalizedKind = this.normalizeDiscordRenderKind(kind);
    if (normalizedKind === 'match-result') {
      return this.renderMatchResultImage(actor, matchId, {
        useDiscordWidgetTemplate: true,
      });
    }

    const match = await this.getAuthorizedMatchMeta(actor, matchId);
    let branding = await this.resolveBranding({
      actor,
      organizationId: match.organizationId,
      sessionId: match.sessionId,
      matchId,
    });
    const template = await this.resolveDiscordWidgetTemplate({
      organizationId: match.organizationId,
      sessionId: match.sessionId,
    });
    branding = await this.withDiscordDefaultTeamLogo(branding, template);
    branding = this.applyDiscordWidgetTemplate(branding, template);
    const matchName = match.name?.trim() || `Match ${match.id}`;
    const sessionName = match.session?.name?.trim() || null;
    const textValues = {
      matchName,
      sessionName,
      sessionOrMatchName: sessionName || matchName,
      overallRankingSubtitle: match.sessionId
        ? `Session table including ${matchName}`
        : `Ranking from ${matchName}`,
    };

    if (normalizedKind === 'match-schedule') {
      const schedule = await this.buildMatchScheduleRenderData(
        match,
        template.matchSchedule,
      );
      const scheduleTextValues = {
        ...textValues,
        matchScheduleScope: schedule.scopeLabel,
        matchScheduleCount: String(schedule.rows.length),
      };
      const header = this.resolveDiscordHeaderText(
        template.texts,
        'discordMatchSchedule',
        scheduleTextValues,
        {
          eyebrow: "Today's",
          title: 'Match Schedule',
          subtitle: schedule.scopeLabel,
        },
      );
      const overlayLayersHtml = this.buildDiscordOverlayLayersHtml(
        template.overlayLayers,
        'match-schedule',
      );
      const customRows = schedule.rows.map((row, index) => ({
        rank: `#${row.matchNumber ?? index + 1}`,
        title: this.matchScheduleHasResult(row.status)
          ? row.winnerTeamTag?.trim() ||
            row.winnerTeamName?.trim() ||
            'Winner pending'
          : this.matchScheduleStatusLabel(row.status),
        subtitle: `${row.matchLabel} - ${row.map ?? 'Map TBA'}`,
        metric: this.matchScheduleHasResult(row.status)
          ? `${row.winnerTotalPoints} pts`
          : this.matchScheduleStatusLabel(row.status),
        matchLabel: row.matchLabel,
        map: row.map ?? 'Map TBA',
        logoUrl: row.winnerTeamLogoUrl,
        teamLogoUrl: row.winnerTeamLogoUrl,
        kills: row.winnerKills,
        placementPoints: 0,
        totalPoints: row.winnerTotalPoints,
        wwcd:
          this.matchScheduleHasResult(row.status) && row.winnerTeamId ? 1 : 0,
      }));
      const studioImage = await this.renderDiscordStudioWidgetImage({
        kind: 'match-schedule',
        template,
        branding,
        header,
        textValues: scheduleTextValues,
        rows: customRows,
        footer: schedule.footer,
      });
      if (studioImage) return studioImage;
      const customLayout = this.discordCustomLayoutFor(
        template,
        'match-schedule',
      );
      if (customLayout) {
        const html = await this.buildDiscordCustomWidgetHtml({
          kind: 'match-schedule',
          eyebrow: header.eyebrow,
          title: header.title,
          subtitle: header.subtitle,
          rows: customRows,
          branding,
          styleLibrary:
            template?.styleLibrary ?? this.defaultDiscordWidgetStyleLibrary(),
          footer: schedule.footer,
          overlayLayersHtml,
          layout: customLayout,
        });
        return this.renderHtmlToImage(html);
      }
      const html = await this.buildDiscordMatchScheduleHtml({
        ...header,
        data: schedule,
        branding,
        overlayLayersHtml,
      });
      return this.renderHtmlToImage(html);
    }

    if (normalizedKind === 'overall-ranking') {
      const ranking = await this.buildOverallRankingRows(match);
      const header = this.resolveDiscordHeaderText(
        template.texts,
        'discordOverallRanking',
        textValues,
        {
          eyebrow: 'Overall Ranking',
          title: sessionName || matchName,
          subtitle: textValues.overallRankingSubtitle,
        },
      );
      const overlayLayersHtml = this.buildDiscordOverlayLayersHtml(
        template.overlayLayers,
        'overall-ranking',
      );
      const studioImage = await this.renderDiscordStudioWidgetImage({
        kind: 'overall-ranking',
        template,
        branding,
        header,
        textValues,
        rows: ranking.rows.map((row) => ({
          rank: row.rank,
          title: row.title,
          subtitle: row.subtitle,
          metric: row.metric,
          logoUrl: row.logoUrl,
          teamLogoUrl: row.logoUrl,
          wwcd: row.wwcd,
          kills: row.kills,
          placementPoints: row.placementPoints,
          totalPoints: row.totalPoints,
        })),
        footer: ranking.footer,
      });
      if (studioImage) return studioImage;
      const customLayout = this.discordCustomLayoutFor(
        template,
        'overall-ranking',
      );
      if (customLayout) {
        const mediaRows = this.customLayoutUsesPlayerMedia(customLayout)
          ? this.playerStatsToCustomRows(
              await this.loadPlayerStats(match, { scope: 'ranking' }),
            )
          : undefined;
        const html = await this.buildDiscordCustomWidgetHtml({
          kind: 'overall-ranking',
          eyebrow: header.eyebrow,
          title: header.title,
          subtitle: header.subtitle,
          rows: ranking.rows.map((row) => ({
            rank: row.rank,
            title: row.title,
            subtitle: row.subtitle,
            metric: row.metric,
            logoUrl: row.logoUrl,
            teamLogoUrl: row.logoUrl,
            wwcd: row.wwcd,
            kills: row.kills,
            placementPoints: row.placementPoints,
            totalPoints: row.totalPoints,
          })),
          branding,
          styleLibrary:
            template?.styleLibrary ?? this.defaultDiscordWidgetStyleLibrary(),
          footer: ranking.footer,
          mediaRows,
          overlayLayersHtml,
          layout: customLayout,
        });
        return this.renderHtmlToImage(html);
      }
      const tableBranding = this.rankingTableBranding(branding);
      const html = await this.buildDiscordRankingTableHtml({
        kind: 'overall-ranking',
        eyebrow: header.eyebrow,
        title: header.title,
        subtitle: header.subtitle,
        rows: ranking.rows.map((row) => ({
          rank: row.rank,
          teamName: row.title,
          logoUrl: row.logoUrl,
          wwcd: row.wwcd ?? 0,
          kills: row.kills ?? 0,
          placementPoints: row.placementPoints ?? 0,
          totalPoints: row.totalPoints ?? 0,
        })),
        branding: tableBranding,
        layout: this.resolveRankingTableLayout(
          template,
          'overall-ranking',
          ranking.rows.length,
          tableBranding,
        ),
        footer: ranking.footer,
        emptyText: 'No completed result rows yet',
        overlayLayersHtml,
      });
      return this.renderHtmlToImage(html);
    }

    const playerStatsScope: 'match' | 'ranking' =
      normalizedKind === 'overall-top-mvp' ||
      normalizedKind === 'overall-top-fraggers'
        ? 'ranking'
        : 'match';
    const players = await this.loadPlayerStats(match, {
      scope: playerStatsScope,
    });

    if (normalizedKind === 'top-mvp' || normalizedKind === 'overall-top-mvp') {
      const [topPlayer] = players.sort((left, right) =>
        this.sortPlayersByMvp(left, right),
      );
      const widgetTarget = 'top-mvp';
      const rows = topPlayer
        ? [
            {
              rank: '#1',
              title: topPlayer.ign,
              subtitle: topPlayer.teamName || topPlayer.teamTag || 'Team',
              metric: `${topPlayer.kills} kills`,
              hero: true,
              photoUrl: topPlayer.photoUrl,
              teamLogoUrl: topPlayer.teamLogoUrl,
            },
          ]
        : [];
      const header = this.resolveDiscordHeaderText(
        template.texts,
        'discordTopMvp',
        textValues,
        {
          eyebrow: 'Top MVP',
          title:
            normalizedKind === 'overall-top-mvp'
              ? sessionName || matchName
              : matchName,
          subtitle:
            normalizedKind === 'overall-top-mvp'
              ? 'Overall player impact leader'
              : 'Player impact leader',
        },
      );
      const overlayLayersHtml = this.buildDiscordOverlayLayersHtml(
        template.overlayLayers,
        widgetTarget,
      );
      const studioImage = await this.renderDiscordStudioWidgetImage({
        kind: normalizedKind,
        template,
        branding,
        header,
        textValues,
        rows: rows.map((row) => ({
          rank: row.rank,
          title: row.title,
          subtitle: row.subtitle,
          metric: row.metric,
          logoUrl: row.photoUrl,
          teamLogoUrl: row.teamLogoUrl,
          kills: topPlayer?.kills ?? 0,
        })),
        footer: rows.length ? 'MVP from player result rows' : 'No player rows',
      });
      if (studioImage) return studioImage;
      const customLayout = this.discordCustomLayoutFor(template, widgetTarget);
      if (customLayout) {
        const html = await this.buildDiscordCustomWidgetHtml({
          kind: widgetTarget,
          eyebrow: header.eyebrow,
          title: header.title,
          subtitle: header.subtitle,
          rows: rows.map((row) => ({
            rank: row.rank,
            title: row.title,
            subtitle: row.subtitle,
            metric: row.metric,
            logoUrl: row.photoUrl,
            teamLogoUrl: row.teamLogoUrl,
            kills: topPlayer?.kills ?? 0,
          })),
          branding,
          styleLibrary:
            template?.styleLibrary ?? this.defaultDiscordWidgetStyleLibrary(),
          footer: rows.length
            ? 'MVP from player result rows'
            : 'No player rows',
          overlayLayersHtml,
          layout: customLayout,
        });
        return this.renderHtmlToImage(html);
      }
      const html = await this.buildLeaderboardHtml({
        ...header,
        rows,
        branding,
        footer: rows.length ? 'MVP from player result rows' : 'No player rows',
        emptyText: 'No player stats yet',
        mode: 'player-mvp',
        overlayLayersHtml,
      });
      return this.renderHtmlToImage(html);
    }

    const widgetTarget = 'top-fraggers';
    const rows = players
      .sort((left, right) => this.sortPlayersByKills(left, right))
      .slice(0, DISCORD_PLAYER_LIMIT)
      .map((player, index) => ({
        rank: `#${index + 1}`,
        title: player.ign,
        subtitle: player.teamName || player.teamTag || 'Team',
        metric: `${player.kills} kills`,
        photoUrl: player.photoUrl,
        teamLogoUrl: player.teamLogoUrl,
        kills: player.kills,
      }));
    const header = this.resolveDiscordHeaderText(
      template.texts,
      'discordTopFraggers',
      textValues,
      {
        eyebrow: 'Top Fraggers',
        title:
          normalizedKind === 'overall-top-fraggers'
            ? sessionName || matchName
            : matchName,
        subtitle:
          normalizedKind === 'overall-top-fraggers'
            ? 'Overall player elimination leaders'
            : 'Player elimination leaders',
      },
    );
    const overlayLayersHtml = this.buildDiscordOverlayLayersHtml(
      template.overlayLayers,
      widgetTarget,
    );
    const studioImage = await this.renderDiscordStudioWidgetImage({
      kind: normalizedKind,
      template,
      branding,
      header,
      textValues,
      rows: rows.map((row) => ({
        rank: row.rank,
        title: row.title,
        subtitle: row.subtitle,
        metric: row.metric,
        logoUrl: row.photoUrl,
        teamLogoUrl: row.teamLogoUrl,
        kills: row.kills,
      })),
      footer: rows.length ? `Showing top ${rows.length}` : 'No player rows',
    });
    if (studioImage) return studioImage;
    const customLayout = this.discordCustomLayoutFor(template, widgetTarget);
    if (customLayout) {
      const html = await this.buildDiscordCustomWidgetHtml({
        kind: widgetTarget,
        eyebrow: header.eyebrow,
        title: header.title,
        subtitle: header.subtitle,
        rows: rows.map((row) => ({
          rank: row.rank,
          title: row.title,
          subtitle: row.subtitle,
          metric: row.metric,
          logoUrl: row.photoUrl,
          teamLogoUrl: row.teamLogoUrl,
          kills: row.kills,
        })),
        branding,
        styleLibrary:
          template?.styleLibrary ?? this.defaultDiscordWidgetStyleLibrary(),
        footer: rows.length ? `Showing top ${rows.length}` : 'No player rows',
        overlayLayersHtml,
        layout: customLayout,
      });
      return this.renderHtmlToImage(html);
    }
    const html = await this.buildLeaderboardHtml({
      ...header,
      rows,
      branding,
      footer: rows.length ? `Showing top ${rows.length}` : 'No player rows',
      emptyText: 'No player kill stats yet',
      mode: 'player-ranking',
      overlayLayersHtml,
    });
    return this.renderHtmlToImage(html);
  }
}
