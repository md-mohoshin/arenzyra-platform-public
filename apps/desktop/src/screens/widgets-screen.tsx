import { useEffect, useMemo, useRef, useState } from "react";
import {
  getErrorMessage,
  launcherApi,
  launcherConfig,
} from "../api/api-client";
import type {
  AiCasterAccessState,
  AiCasterSettings,
  LauncherConfig,
  PinnedCommentatorDeskWindowStatus,
  PinnedMapControlWindowStatus,
  PcobMapControlStatus,
  WidgetCatalogState,
  WidgetHotkeyControlConfig,
  WidgetHotkeyControlSelection,
  WidgetHotkeyControlStatus,
  WidgetHotkeyDirection,
  WidgetServerStatus,
} from "../types";
import {
  buildWidgetUrl,
  buildWidgetUrlTemplate,
  canBuildWidgetUrl,
  type ObsWidgetDefinition,
  widgets,
} from "../widgets/widgets.config";

const DEFAULT_WIDGET_SERVER_BASE_URL = "http://localhost:5510";
const WIDGET_SERVER_REFRESH_MS = 5_000;
const WIDGET_CATALOG_REFRESH_MS = 30_000;
const BASE_WIDGETS = widgets;
const LIVE_MAP_WIDGET_ID = "map";
const LIVE_MAP_WIDGET_KEY = "map";
const AI_CASTER_WIDGET_ID = "ai_caster";
const COMMENTATOR_DESK_WIDGET_ID = "commentator_desk";
const COMMENTATOR_DESK_WIDGET_KEY = "commentator-desk";
const NEXT_ZONE_PRO_WIDGET_ID = "next_zone_update_pro_sidebar";
const NEXT_ZONE_PRO_WIDGET_KEY = "next-zone-update-pro-sidebar";
const NEXT_ZONE_KINETIC_WIDGET_ID = "next_zone_update_kinetic_hud";
const NEXT_ZONE_KINETIC_WIDGET_KEY = "next-zone-update-kinetic-hud";
const NEXT_ZONE_BLADE_WIDGET_ID = "next_zone_update_blade";
const NEXT_ZONE_BLADE_WIDGET_KEY = "next-zone-update-blade";
const NEXT_ZONE_RADAR_SWEEP_WIDGET_ID = "next_zone_update_radar_sweep";
const NEXT_ZONE_RADAR_SWEEP_WIDGET_KEY = "next-zone-update-radar-sweep";
const NEXT_ZONE_FOLD_DOWN_WIDGET_ID = "next_zone_update_fold_down";
const NEXT_ZONE_FOLD_DOWN_WIDGET_KEY = "next-zone-update-fold-down";
const NEXT_ZONE_WIDGET_IDS = new Set([
  "next_zone_update",
  NEXT_ZONE_PRO_WIDGET_ID,
  NEXT_ZONE_KINETIC_WIDGET_ID,
  NEXT_ZONE_BLADE_WIDGET_ID,
  NEXT_ZONE_RADAR_SWEEP_WIDGET_ID,
  NEXT_ZONE_FOLD_DOWN_WIDGET_ID,
]);
const HOTKEY_CONTROL_APPROVAL_KEY = "feature.widget-hotkey-control";
const APPROVAL_ONLY_WIDGET_KEYS = [
  LIVE_MAP_WIDGET_KEY,
  COMMENTATOR_DESK_WIDGET_KEY,
  HOTKEY_CONTROL_APPROVAL_KEY,
];
const HOTKEY_WIDGET_OPTIONS: WidgetHotkeyControlSelection[] = [
  {
    id: "teams-alive",
    widgetKey: "teams-alive",
    label: "Teams Alive",
    enabled: false,
    direction: "right",
  },
  {
    id: "leaderboard",
    widgetKey: "leaderboard",
    label: "Leaderboard",
    enabled: false,
    direction: "right",
  },
  {
    id: "overall-live-ranking",
    widgetKey: "overall-live-ranking",
    label: "Overall Live Ranking",
    enabled: false,
    direction: "right",
  },
  {
    id: "match-lower-third",
    widgetKey: "match-lower-third",
    label: "Match Lower Third",
    enabled: false,
    direction: "left",
  },
  {
    id: "match-start-notification",
    widgetKey: "match-start-notification",
    label: "Match Start Notification",
    enabled: false,
    direction: "up",
  },
  {
    id: "kill-feed",
    widgetKey: "kill-feed",
    label: "Kill Feed",
    enabled: false,
    direction: "right",
  },
  {
    id: "map-overlay",
    widgetKey: "map-overlay",
    label: "Map Overlay",
    enabled: false,
    direction: "left",
  },
  {
    id: "player-photo",
    widgetKey: "player-photo",
    label: "Player Photo",
    enabled: false,
    direction: "right",
  },
  {
    id: "wwcd",
    widgetKey: "wwcd",
    label: "WWCD",
    enabled: false,
    direction: "up",
  },
  {
    id: "winner",
    widgetKey: "winner",
    label: "Winner",
    enabled: false,
    direction: "up",
  },
  {
    id: "map",
    widgetKey: "map",
    label: "Live Map",
    enabled: false,
    direction: "left",
  },
  {
    id: "ai-caster",
    widgetKey: "ai-caster",
    label: "AI Caster",
    enabled: false,
    direction: "up",
  },
  {
    id: "commentator-desk",
    widgetKey: "commentator-desk",
    label: "Commentator Desk",
    enabled: false,
    direction: "right",
  },
  {
    id: "next-zone-update",
    widgetKey: "next-zone-update",
    label: "Next Zone Update",
    enabled: false,
    direction: "up",
  },
  {
    id: "next-zone-update-pro-sidebar",
    widgetKey: "next-zone-update-pro-sidebar",
    label: "Next Zone Pro Sidebar",
    enabled: false,
    direction: "right",
  },
  {
    id: "next-zone-update-kinetic-hud",
    widgetKey: "next-zone-update-kinetic-hud",
    label: "Next Zone Kinetic HUD",
    enabled: false,
    direction: "up",
  },
  {
    id: "next-zone-update-blade",
    widgetKey: "next-zone-update-blade",
    label: "Next Zone Blade Countdown",
    enabled: false,
    direction: "up",
  },
  {
    id: "next-zone-update-radar-sweep",
    widgetKey: "next-zone-update-radar-sweep",
    label: "Next Zone Radar Sweep",
    enabled: false,
    direction: "up",
  },
  {
    id: "next-zone-update-fold-down",
    widgetKey: "next-zone-update-fold-down",
    label: "Next Zone Fold Down",
    enabled: false,
    direction: "up",
  },
  {
    id: "match-results",
    widgetKey: "match-results",
    label: "Match Results",
    enabled: false,
    direction: "up",
  },
  {
    id: "overall-standings",
    widgetKey: "overall-standings",
    label: "Overall Standings",
    enabled: false,
    direction: "right",
  },
  {
    id: "match-summary",
    widgetKey: "match-summary",
    label: "Match Summary",
    enabled: false,
    direction: "up",
  },
  {
    id: "fight-alert",
    widgetKey: "fight-alert",
    label: "Fight Alert",
    enabled: false,
    direction: "up",
  },
  {
    id: "achievement-alert",
    widgetKey: "achievement-alert",
    label: "Achievement Alert",
    enabled: false,
    direction: "up",
  },
  {
    id: "team-eliminated-alert",
    widgetKey: "team-eliminated-alert",
    label: "Team Eliminated Alert",
    enabled: false,
    direction: "up",
  },
];
const DEFAULT_HOTKEY_CONFIG: WidgetHotkeyControlConfig = {
  enabled: false,
  key: "F9",
  transitionMs: 260,
  widgets: HOTKEY_WIDGET_OPTIONS,
};
const HOTKEY_DIRECTION_OPTIONS: Array<{
  value: WidgetHotkeyDirection;
  label: string;
}> = [
  { value: "auto", label: "Auto" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
];
type WidgetCatalogEntry =
  | {
      type: "widget";
      widget: ObsWidgetDefinition;
    }
  | {
      type: "next-zone-group";
      widgets: ObsWidgetDefinition[];
    };
const DEFAULT_SELECTED_WIDGET_ID =
  BASE_WIDGETS.find(
    (widget) =>
      widget.id !== LIVE_MAP_WIDGET_ID &&
      widget.id !== AI_CASTER_WIDGET_ID &&
      widget.id !== COMMENTATOR_DESK_WIDGET_ID,
  )?.id ??
  BASE_WIDGETS[0]?.id ??
  "";
const PERMANENT_WIDGET_KEYS = Array.from(
  new Set(
    BASE_WIDGETS.filter(
      (widget) => widget.routeKind === "permanent" && widget.widgetKey,
    ).map((widget) => widget.widgetKey as string),
  ),
);
const AI_CASTER_VOICE_OPTIONS = [
  { value: "play-by-play", label: "Default play-by-play" },
  { value: "analyst", label: "Default analyst" },
  { value: "coral", label: "Coral" },
  { value: "onyx", label: "Onyx" },
  { value: "nova", label: "Nova" },
  { value: "shimmer", label: "Shimmer" },
  { value: "echo", label: "Echo" },
  { value: "alloy", label: "Alloy" },
  { value: "sage", label: "Sage" },
  { value: "fable", label: "Fable" },
  { value: "ash", label: "Ash" },
  { value: "ballad", label: "Ballad" },
  { value: "verse", label: "Verse" },
  { value: "marin", label: "Marin" },
  { value: "cedar", label: "Cedar" },
] as const;

const getWidgetPreviewBaseUrl = (widgetServer: WidgetServerStatus | null) =>
  widgetServer?.authorizedLocalBaseUrl ||
  widgetServer?.authorizedBaseUrl ||
  widgetServer?.localBaseUrl ||
  widgetServer?.baseUrl ||
  DEFAULT_WIDGET_SERVER_BASE_URL;

const getAiCasterVoiceOptions = (current?: string | null) => {
  const value = String(current || "").trim();
  if (
    !value ||
    AI_CASTER_VOICE_OPTIONS.some((option) => option.value === value)
  ) {
    return AI_CASTER_VOICE_OPTIONS;
  }
  return [{ value, label: value }, ...AI_CASTER_VOICE_OPTIONS];
};

const normalizeHotkeyDraft = (
  config?: WidgetHotkeyControlConfig | null,
): WidgetHotkeyControlConfig => {
  const source = config ?? DEFAULT_HOTKEY_CONFIG;
  const configured = new Map(
    (Array.isArray(source.widgets) ? source.widgets : []).map((widget) => [
      widget.widgetKey,
      widget,
    ]),
  );

  return {
    enabled: source.enabled === true,
    key: String(source.key || DEFAULT_HOTKEY_CONFIG.key).trim() || "F9",
    transitionMs:
      Number.isFinite(Number(source.transitionMs)) &&
      Number(source.transitionMs) >= 80 &&
      Number(source.transitionMs) <= 1000
        ? Math.round(Number(source.transitionMs))
        : DEFAULT_HOTKEY_CONFIG.transitionMs,
    widgets: HOTKEY_WIDGET_OPTIONS.map((option) => {
      const existing = configured.get(option.widgetKey);
      return {
        ...option,
        enabled: existing?.enabled === true,
        direction: existing?.direction ?? option.direction,
      };
    }),
  };
};

type WidgetsScreenProps = {
  organizationId: string | null;
};

export function WidgetsScreen({ organizationId }: WidgetsScreenProps) {
  const [widgetServer, setWidgetServer] = useState<WidgetServerStatus | null>(
    null,
  );
  const [launcherConfigView, setLauncherConfigView] =
    useState<LauncherConfig | null>(null);
  const [widgetCatalog, setWidgetCatalog] = useState<WidgetCatalogState | null>(
    null,
  );
  const [, setServerLoading] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);
  const [lanToggleError, setLanToggleError] = useState<string | null>(null);
  const [lanToggleSaving, setLanToggleSaving] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [capabilityBusy, setCapabilityBusy] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [aiCasterAccess, setAiCasterAccess] =
    useState<AiCasterAccessState | null>(null);
  const [aiCasterDraftSettings, setAiCasterDraftSettings] =
    useState<AiCasterSettings | null>(null);
  const [aiCasterError, setAiCasterError] = useState<string | null>(null);
  const [aiCasterSaving, setAiCasterSaving] = useState(false);
  const [aiCasterPreviewing, setAiCasterPreviewing] = useState<
    "play-by-play" | "analyst" | null
  >(null);
  const [pinnedDeskStatus, setPinnedDeskStatus] =
    useState<PinnedCommentatorDeskWindowStatus | null>(null);
  const [pinnedDeskError, setPinnedDeskError] = useState<string | null>(null);
  const [pinnedDeskBusy, setPinnedDeskBusy] = useState<
    "open" | "close" | "click-through" | null
  >(null);
  const [pinnedMapStatus, setPinnedMapStatus] =
    useState<PinnedMapControlWindowStatus | null>(null);
  const [pinnedMapError, setPinnedMapError] = useState<string | null>(null);
  const [pcobMapControlStatus, setPcobMapControlStatus] =
    useState<PcobMapControlStatus | null>(null);
  const [pcobMapControlError, setPcobMapControlError] = useState<string | null>(
    null,
  );
  const [pinnedMapBusy, setPinnedMapBusy] = useState<
    "open" | "close" | "always-on-top" | null
  >(null);
  const [hotkeyControl, setHotkeyControl] =
    useState<WidgetHotkeyControlStatus | null>(null);
  const [hotkeyDraft, setHotkeyDraft] = useState<WidgetHotkeyControlConfig>(
    DEFAULT_HOTKEY_CONFIG,
  );
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [hotkeySaving, setHotkeySaving] = useState(false);
  const [hotkeyTesting, setHotkeyTesting] = useState<"hide" | "show" | null>(
    null,
  );
  const hotkeyUnsavedRef = useRef(false);
  const aiCasterPreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const aiCasterUnsavedRef = useRef(false);
  const [selectedWidgetId, setSelectedWidgetId] = useState(
    DEFAULT_SELECTED_WIDGET_ID,
  );
  const [nextZoneGroupOpen, setNextZoneGroupOpen] = useState(true);
  const liveMapCatalogState =
    widgetCatalog?.items?.[LIVE_MAP_WIDGET_KEY] ?? null;
  const commentatorDeskCatalogState =
    widgetCatalog?.items?.[COMMENTATOR_DESK_WIDGET_KEY] ?? null;
  const nextZoneProCatalogState =
    widgetCatalog?.items?.[NEXT_ZONE_PRO_WIDGET_KEY] ?? null;
  const nextZoneKineticCatalogState =
    widgetCatalog?.items?.[NEXT_ZONE_KINETIC_WIDGET_KEY] ?? null;
  const nextZoneBladeCatalogState =
    widgetCatalog?.items?.[NEXT_ZONE_BLADE_WIDGET_KEY] ?? null;
  const nextZoneRadarSweepCatalogState =
    widgetCatalog?.items?.[NEXT_ZONE_RADAR_SWEEP_WIDGET_KEY] ?? null;
  const nextZoneFoldDownCatalogState =
    widgetCatalog?.items?.[NEXT_ZONE_FOLD_DOWN_WIDGET_KEY] ?? null;
  const hotkeyControlCatalogState =
    widgetCatalog?.items?.[HOTKEY_CONTROL_APPROVAL_KEY] ?? null;
  const liveMapApproved = liveMapCatalogState?.approved === true;
  const commentatorDeskApproved =
    commentatorDeskCatalogState?.approved === true;
  const nextZoneProApproved = nextZoneProCatalogState?.approved === true;
  const nextZoneKineticApproved =
    nextZoneKineticCatalogState?.approved === true;
  const nextZoneBladeApproved = nextZoneBladeCatalogState?.approved === true;
  const nextZoneRadarSweepApproved =
    nextZoneRadarSweepCatalogState?.approved === true;
  const nextZoneFoldDownApproved =
    nextZoneFoldDownCatalogState?.approved === true;
  const hotkeyControlApproved = hotkeyControlCatalogState?.approved === true;
  const aiCasterApproved = aiCasterAccess?.approved === true;
  const availableWidgets = useMemo(
    () =>
      BASE_WIDGETS.filter((widget) => {
        if (widget.id === LIVE_MAP_WIDGET_ID) {
          return liveMapApproved;
        }
        if (widget.id === AI_CASTER_WIDGET_ID) {
          return aiCasterApproved;
        }
        if (widget.id === COMMENTATOR_DESK_WIDGET_ID) {
          return commentatorDeskApproved;
        }
        if (widget.id === NEXT_ZONE_PRO_WIDGET_ID) {
          return nextZoneProApproved;
        }
        if (widget.id === NEXT_ZONE_KINETIC_WIDGET_ID) {
          return nextZoneKineticApproved;
        }
        if (widget.id === NEXT_ZONE_BLADE_WIDGET_ID) {
          return nextZoneBladeApproved;
        }
        if (widget.id === NEXT_ZONE_RADAR_SWEEP_WIDGET_ID) {
          return nextZoneRadarSweepApproved;
        }
        if (widget.id === NEXT_ZONE_FOLD_DOWN_WIDGET_ID) {
          return nextZoneFoldDownApproved;
        }
        return true;
      }),
    [
      aiCasterApproved,
      commentatorDeskApproved,
      liveMapApproved,
      nextZoneBladeApproved,
      nextZoneFoldDownApproved,
      nextZoneKineticApproved,
      nextZoneProApproved,
      nextZoneRadarSweepApproved,
    ],
  );
  const catalogEntries = useMemo<WidgetCatalogEntry[]>(() => {
    const entries: WidgetCatalogEntry[] = [];
    let nextZoneGroupAdded = false;
    const nextZoneWidgets = availableWidgets.filter((widget) =>
      NEXT_ZONE_WIDGET_IDS.has(widget.id),
    );

    for (const widget of availableWidgets) {
      if (NEXT_ZONE_WIDGET_IDS.has(widget.id)) {
        if (!nextZoneGroupAdded && nextZoneWidgets.length > 0) {
          entries.push({
            type: "next-zone-group",
            widgets: nextZoneWidgets,
          });
          nextZoneGroupAdded = true;
        }
        continue;
      }

      entries.push({
        type: "widget",
        widget,
      });
    }

    return entries;
  }, [availableWidgets]);

  useEffect(() => {
    if (!availableWidgets.some((widget) => widget.id === selectedWidgetId)) {
      setSelectedWidgetId(availableWidgets[0]?.id ?? "");
    }
  }, [availableWidgets, selectedWidgetId]);

  useEffect(() => {
    if (NEXT_ZONE_WIDGET_IDS.has(selectedWidgetId)) {
      setNextZoneGroupOpen(true);
    }
  }, [selectedWidgetId]);

  useEffect(() => {
    let cancelled = false;

    const applyConfig = (config: LauncherConfig) => {
      if (cancelled) {
        return;
      }
      setLauncherConfigView(config);
      setLanToggleError(null);
    };

    void launcherConfig
      .getConfig()
      .then(applyConfig)
      .catch((error) => {
        if (!cancelled) {
          setLanToggleError(getErrorMessage(error));
        }
      });

    const unsubscribe = launcherConfig.subscribeConfig(applyConfig);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (selectedWidgetId !== LIVE_MAP_WIDGET_ID) {
      return;
    }

    let cancelled = false;

    const loadPcobMapControlStatus = async () => {
      try {
        const status = await launcherApi.getPcobMapControlStatus();
        if (cancelled) {
          return;
        }
        setPcobMapControlStatus(status);
        setPcobMapControlError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setPcobMapControlError(getErrorMessage(error));
      }
    };

    void loadPcobMapControlStatus();
    const timer = window.setInterval(() => {
      void loadPcobMapControlStatus();
    }, WIDGET_SERVER_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedWidgetId]);

  useEffect(() => {
    let cancelled = false;

    const loadPinnedMap = async () => {
      try {
        const status = await launcherApi.getPinnedMapControlWindow();
        if (cancelled) {
          return;
        }
        setPinnedMapStatus(status);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setPinnedMapError(getErrorMessage(error));
      }
    };

    void loadPinnedMap();
    const timer = window.setInterval(() => {
      void loadPinnedMap();
    }, WIDGET_SERVER_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadCatalog = async () => {
      if (
        !organizationId ||
        (PERMANENT_WIDGET_KEYS.length === 0 &&
          APPROVAL_ONLY_WIDGET_KEYS.length === 0)
      ) {
        setWidgetCatalog(null);
        setCatalogError(
          organizationId
            ? null
            : "Organization unavailable for branded widget resolution.",
        );
        return;
      }

      try {
        const result = await launcherApi.getWidgetCatalogState(
          organizationId,
          PERMANENT_WIDGET_KEYS,
          APPROVAL_ONLY_WIDGET_KEYS,
        );
        if (cancelled) {
          return;
        }
        setWidgetCatalog(result);
        setCatalogError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setCatalogError(getErrorMessage(error));
      }
    };

    void loadCatalog();
    const timer = window.setInterval(() => {
      void loadCatalog();
    }, WIDGET_CATALOG_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [organizationId]);

  useEffect(() => {
    let cancelled = false;

    const loadAccess = async () => {
      if (!organizationId) {
        setAiCasterAccess(null);
        setAiCasterError("Organization unavailable for AI caster access.");
        return;
      }

      try {
        const access = await launcherApi.getAiCasterAccess(organizationId);
        if (cancelled) {
          return;
        }
        setAiCasterAccess(access);
        if (!aiCasterUnsavedRef.current) {
          setAiCasterDraftSettings(access.settings);
        }
        setAiCasterError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setAiCasterError(getErrorMessage(error));
      }
    };

    void loadAccess();
    const timer = window.setInterval(() => {
      void loadAccess();
    }, WIDGET_CATALOG_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [organizationId]);

  useEffect(() => {
    let cancelled = false;

    const loadHotkeyControl = async () => {
      if (!organizationId || !hotkeyControlApproved) {
        setHotkeyControl(null);
        setHotkeyDraft(DEFAULT_HOTKEY_CONFIG);
        setHotkeyError(null);
        return;
      }

      try {
        const status = await launcherApi.getWidgetHotkeyControl(organizationId);
        if (cancelled) {
          return;
        }
        setHotkeyControl(status);
        if (!hotkeyUnsavedRef.current) {
          setHotkeyDraft(normalizeHotkeyDraft(status.config));
        }
        setHotkeyError(status.error);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setHotkeyError(getErrorMessage(error));
      }
    };

    void loadHotkeyControl();
    const timer = window.setInterval(() => {
      void loadHotkeyControl();
    }, WIDGET_CATALOG_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hotkeyControlApproved, organizationId]);

  useEffect(() => {
    let cancelled = false;

    const loadPinnedDesk = async () => {
      try {
        const status = await launcherApi.getPinnedCommentatorDeskWindow();
        if (cancelled) {
          return;
        }
        setPinnedDeskStatus(status);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setPinnedDeskError(getErrorMessage(error));
      }
    };

    void loadPinnedDesk();
    const timer = window.setInterval(() => {
      void loadPinnedDesk();
    }, WIDGET_SERVER_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadServer = async (showLoading: boolean) => {
      if (showLoading) {
        setServerLoading(true);
      }

      try {
        const result = await launcherApi.getWidgetServerStatus();
        if (cancelled) {
          return;
        }
        setWidgetServer(result);
        setServerError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setServerError(getErrorMessage(error));
      } finally {
        if (!cancelled && showLoading) {
          setServerLoading(false);
        }
      }
    };

    void loadServer(true);
    const timer = window.setInterval(() => {
      void loadServer(false);
    }, WIDGET_SERVER_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    return () => {
      aiCasterPreviewAudioRef.current?.pause();
      aiCasterPreviewAudioRef.current = null;
    };
  }, []);

  const selectedWidget =
    availableWidgets.find((widget) => widget.id === selectedWidgetId) ??
    availableWidgets[0] ??
    null;
  const previewBaseUrl = getWidgetPreviewBaseUrl(widgetServer);
  const selectedPermanentState =
    selectedWidget?.routeKind === "permanent" && selectedWidget.widgetKey
      ? (widgetCatalog?.items?.[selectedWidget.widgetKey] ?? null)
      : null;
  const selectedWidgetInstanceKey =
    selectedPermanentState?.widgetInstanceKey ?? null;
  const selectedCanBuildUrl = selectedWidget
    ? canBuildWidgetUrl(selectedWidget, {
        widgetInstanceKey: selectedWidgetInstanceKey,
      })
    : false;
  const localTemplateUrl = selectedWidget
    ? buildWidgetUrlTemplate(previewBaseUrl, selectedWidget)
    : "";
  const localUrl = selectedWidget
    ? selectedCanBuildUrl
      ? buildWidgetUrl(previewBaseUrl, selectedWidget, {
          widgetInstanceKey: selectedWidgetInstanceKey,
        })
      : localTemplateUrl
    : "";
  const lanUrl =
    selectedWidget &&
    selectedCanBuildUrl &&
    (widgetServer?.authorizedNetworkBaseUrl || widgetServer?.networkBaseUrl)
      ? buildWidgetUrl(
          widgetServer.authorizedNetworkBaseUrl || widgetServer.networkBaseUrl!,
          selectedWidget,
          {
            widgetInstanceKey: selectedWidgetInstanceKey,
          },
        )
      : "";
  const lanEnabled = launcherConfigView?.settings?.widgetLanEnabled === true;
  const lanStatusLabel = lanToggleSaving
    ? "Updating..."
    : lanEnabled
      ? "Enabled"
      : "Disabled";
  const note =
    copyError ||
    lanToggleError ||
    serverError ||
    (selectedWidget?.id === "ai_caster" ? aiCasterError : null) ||
    (selectedWidget?.id === COMMENTATOR_DESK_WIDGET_ID
      ? pinnedDeskError
      : null) ||
    (selectedWidget?.id === LIVE_MAP_WIDGET_ID ? pinnedMapError : null) ||
    (selectedWidget?.routeKind === "permanent" &&
    selectedPermanentState?.message
      ? selectedPermanentState.message
      : null) ||
    (!selectedCanBuildUrl && selectedWidget?.routeKind === "permanent"
      ? catalogError
      : null);
  const noteTone =
    copyError ||
    lanToggleError ||
    serverError ||
    catalogError ||
    aiCasterError ||
    pinnedDeskError ||
    pinnedMapError
      ? "danger"
      : "neutral";

  const handleCopyValue = async (value: string) => {
    if (!value) {
      return;
    }

    try {
      await launcherApi.copyText(value);
      setCopyError(null);
    } catch (error) {
      setCopyError(getErrorMessage(error));
    }
  };

  const handleRotateCapability = async () => {
    if (
      !organizationId ||
      !selectedWidget?.widgetKey ||
      !selectedPermanentState?.widgetInstanceId ||
      !selectedPermanentState.capabilityGeneration
    ) {
      return;
    }
    const confirmed = window.confirm(
      "Rotate this widget credential? Existing OBS URLs for this widget will stop working and must be replaced with the newly copied URL.",
    );
    if (!confirmed) return;

    setCapabilityBusy(true);
    setCatalogError(null);
    try {
      const result = await launcherApi.rotateWidgetCapability(
        organizationId,
        selectedWidget.widgetKey,
        selectedPermanentState.widgetInstanceId,
        selectedPermanentState.capabilityGeneration,
        PERMANENT_WIDGET_KEYS,
        APPROVAL_ONLY_WIDGET_KEYS,
      );
      setWidgetCatalog(result);
    } catch (error) {
      setCatalogError(getErrorMessage(error));
    } finally {
      setCapabilityBusy(false);
    }
  };

  const handleLanToggleChange = async (enabled: boolean) => {
    setLanToggleSaving(true);
    setLanToggleError(null);

    try {
      const nextConfig = await launcherConfig.setConfig("settings", {
        widgetLanEnabled: enabled,
      });
      setLauncherConfigView(nextConfig);
      const nextStatus = await launcherApi.getWidgetServerStatus();
      setWidgetServer(nextStatus);
      setServerError(null);
    } catch (error) {
      setLanToggleError(getErrorMessage(error));
    } finally {
      setLanToggleSaving(false);
    }
  };

  const openPinnedCommentatorDesk = async () => {
    setPinnedDeskBusy("open");
    try {
      const status = await launcherApi.openPinnedCommentatorDeskWindow({
        clickThrough: pinnedDeskStatus?.clickThrough === true,
      });
      setPinnedDeskStatus(status);
      setPinnedDeskError(null);
    } catch (error) {
      setPinnedDeskError(getErrorMessage(error));
    } finally {
      setPinnedDeskBusy(null);
    }
  };

  const closePinnedCommentatorDesk = async () => {
    setPinnedDeskBusy("close");
    try {
      const status = await launcherApi.closePinnedCommentatorDeskWindow();
      setPinnedDeskStatus(status);
      setPinnedDeskError(null);
    } catch (error) {
      setPinnedDeskError(getErrorMessage(error));
    } finally {
      setPinnedDeskBusy(null);
    }
  };

  const setPinnedCommentatorDeskClickThrough = async (
    clickThrough: boolean,
  ) => {
    setPinnedDeskBusy("click-through");
    try {
      const status =
        await launcherApi.setPinnedCommentatorDeskClickThrough(clickThrough);
      setPinnedDeskStatus(status);
      setPinnedDeskError(null);
    } catch (error) {
      setPinnedDeskError(getErrorMessage(error));
    } finally {
      setPinnedDeskBusy(null);
    }
  };

  const openPinnedMapControl = async () => {
    setPinnedMapBusy("open");
    try {
      const status = await launcherApi.openPinnedMapControlWindow();
      setPinnedMapStatus(status);
      setPinnedMapError(null);
    } catch (error) {
      setPinnedMapError(getErrorMessage(error));
    } finally {
      setPinnedMapBusy(null);
    }
  };

  const closePinnedMapControl = async () => {
    setPinnedMapBusy("close");
    try {
      const status = await launcherApi.closePinnedMapControlWindow();
      setPinnedMapStatus(status);
      setPinnedMapError(null);
    } catch (error) {
      setPinnedMapError(getErrorMessage(error));
    } finally {
      setPinnedMapBusy(null);
    }
  };

  const setPinnedMapControlAlwaysOnTop = async (alwaysOnTop: boolean) => {
    setPinnedMapBusy("always-on-top");
    try {
      const status =
        await launcherApi.setPinnedMapControlAlwaysOnTop(alwaysOnTop);
      setPinnedMapStatus(status);
      setPinnedMapError(null);
    } catch (error) {
      setPinnedMapError(getErrorMessage(error));
    } finally {
      setPinnedMapBusy(null);
    }
  };

  const editAiCaster = (settings: Partial<AiCasterSettings>) => {
    const currentSettings = aiCasterDraftSettings ?? aiCasterAccess?.settings;
    if (!currentSettings) {
      return;
    }

    aiCasterUnsavedRef.current = true;
    setAiCasterDraftSettings({
      ...currentSettings,
      ...settings,
    });
    setAiCasterError(null);
  };

  const saveAiCaster = async () => {
    if (!organizationId) {
      setAiCasterError("Organization unavailable for AI caster settings.");
      return;
    }
    if (!aiCasterDraftSettings) {
      setAiCasterError("AI caster settings are not loaded yet.");
      return;
    }

    setAiCasterSaving(true);
    try {
      const access = await launcherApi.updateAiCasterSettings(
        aiCasterDraftSettings,
        organizationId,
      );
      setAiCasterAccess(access);
      setAiCasterDraftSettings(access.settings);
      aiCasterUnsavedRef.current = false;
      setAiCasterError(null);
    } catch (error) {
      setAiCasterError(getErrorMessage(error));
    } finally {
      setAiCasterSaving(false);
    }
  };

  const aiCasterSettings =
    aiCasterDraftSettings ?? aiCasterAccess?.settings ?? null;
  const aiCasterDirty =
    Boolean(aiCasterAccess?.settings && aiCasterSettings) &&
    JSON.stringify(aiCasterSettings) !==
      JSON.stringify(aiCasterAccess?.settings);

  const resetAiCasterDraft = () => {
    if (!aiCasterAccess?.settings) {
      return;
    }
    aiCasterUnsavedRef.current = false;
    setAiCasterDraftSettings(aiCasterAccess.settings);
    setAiCasterError(null);
  };

  const editHotkeyDraft = (changes: Partial<WidgetHotkeyControlConfig>) => {
    hotkeyUnsavedRef.current = true;
    setHotkeyDraft((current) => ({
      ...normalizeHotkeyDraft(current),
      ...changes,
    }));
    setHotkeyError(null);
  };

  const editHotkeyWidget = (
    widgetKey: string,
    changes: Partial<WidgetHotkeyControlSelection>,
  ) => {
    hotkeyUnsavedRef.current = true;
    setHotkeyDraft((current) => {
      const normalized = normalizeHotkeyDraft(current);
      return {
        ...normalized,
        widgets: normalized.widgets.map((widget) =>
          widget.widgetKey === widgetKey
            ? {
                ...widget,
                ...changes,
              }
            : widget,
        ),
      };
    });
    setHotkeyError(null);
  };

  const saveHotkeyControl = async () => {
    if (!organizationId) {
      setHotkeyError("Organization unavailable for widget hotkey control.");
      return;
    }

    setHotkeySaving(true);
    try {
      const status = await launcherApi.updateWidgetHotkeyControl(
        normalizeHotkeyDraft(hotkeyDraft),
        organizationId,
      );
      setHotkeyControl(status);
      setHotkeyDraft(normalizeHotkeyDraft(status.config));
      hotkeyUnsavedRef.current = false;
      setHotkeyError(status.error);
    } catch (error) {
      setHotkeyError(getErrorMessage(error));
    } finally {
      setHotkeySaving(false);
    }
  };

  const resetHotkeyDraft = () => {
    hotkeyUnsavedRef.current = false;
    setHotkeyDraft(normalizeHotkeyDraft(hotkeyControl?.config));
    setHotkeyError(hotkeyControl?.error ?? null);
  };

  const previewHotkeyControl = async (active: boolean) => {
    if (!organizationId) {
      setHotkeyError("Organization unavailable for widget hotkey control.");
      return;
    }

    setHotkeyTesting(active ? "hide" : "show");
    try {
      const status = await launcherApi.triggerWidgetHotkeyControl(
        active,
        organizationId,
      );
      setHotkeyControl(status);
      setHotkeyError(status.error);
    } catch (error) {
      setHotkeyError(getErrorMessage(error));
    } finally {
      setHotkeyTesting(null);
    }
  };

  const hotkeyDirty =
    Boolean(hotkeyControl?.config) &&
    JSON.stringify(normalizeHotkeyDraft(hotkeyDraft)) !==
      JSON.stringify(normalizeHotkeyDraft(hotkeyControl?.config));
  const hotkeyEnabledCount = hotkeyDraft.widgets.filter(
    (widget) => widget.enabled,
  ).length;
  const pinnedDeskOpen = pinnedDeskStatus?.open === true;
  const pinnedDeskClickThrough = pinnedDeskStatus?.clickThrough === true;
  const pinnedDeskCanOpen =
    selectedWidget?.id === COMMENTATOR_DESK_WIDGET_ID &&
    widgetServer?.running === true &&
    selectedCanBuildUrl;
  const pinnedMapOpen = pinnedMapStatus?.open === true;
  const pinnedMapAlwaysOnTop = pinnedMapStatus?.alwaysOnTop === true;
  const pcobSwitchingEnabled = pcobMapControlStatus?.enabled === true;
  const pcobSwitchingHasError = Boolean(
    pcobMapControlError ||
    pcobMapControlStatus?.telemetryError ||
    pcobMapControlStatus?.inputError ||
    (!pcobMapControlStatus?.telemetrySourceReady &&
      pcobMapControlStatus?.sourceError) ||
    (pcobMapControlStatus?.matchLive &&
      pcobMapControlStatus?.telemetrySourceReady &&
      !pcobMapControlStatus?.available) ||
    pcobMapControlStatus?.lastSelection?.status === "failed",
  );
  const pcobTelemetrySourceLabel =
    pcobMapControlStatus?.telemetrySource === "telemetry-bridge"
      ? "Telemetry Bridge"
      : pcobMapControlStatus?.telemetrySource === "observer-feed"
        ? "Observer Feed"
        : "Not ready";
  const pinnedMapCanOpen =
    selectedWidget?.id === LIVE_MAP_WIDGET_ID &&
    widgetServer?.running === true &&
    selectedCanBuildUrl;

  const previewAiCasterVoice = async (
    role: "play-by-play" | "analyst",
    voice: string,
  ) => {
    if (!organizationId) {
      setAiCasterError("Organization unavailable for AI caster voice preview.");
      return;
    }
    if (!aiCasterSettings) {
      setAiCasterError("AI caster settings are not loaded yet.");
      return;
    }

    setAiCasterPreviewing(role);
    try {
      const preview = await launcherApi.previewAiCasterVoice({
        organizationId,
        role,
        voice,
        mode: aiCasterSettings.mode,
        speakingSpeed: aiCasterSettings.speakingSpeed,
        expression: aiCasterSettings.expression,
      });
      const audio = new Audio(
        `data:${preview.mimeType};base64,${preview.audioBase64}`,
      );
      aiCasterPreviewAudioRef.current?.pause();
      aiCasterPreviewAudioRef.current = audio;
      audio.onended = () => {
        if (aiCasterPreviewAudioRef.current === audio) {
          aiCasterPreviewAudioRef.current = null;
        }
      };
      await audio.play();
      setAiCasterError(null);
    } catch (error) {
      setAiCasterError(getErrorMessage(error));
    } finally {
      setAiCasterPreviewing(null);
    }
  };

  return (
    <div className="app-shell widgets-minimal">
      <div className="widgets-minimal__frame">
        <aside className="widgets-minimal__catalog">
          <span className="widgets-minimal__kicker">Widgets</span>
          <h1>Widget URLs</h1>

          {availableWidgets.length ? (
            <div className="widgets-minimal__list">
              {catalogEntries.map((entry) => {
                if (entry.type === "next-zone-group") {
                  const nextZoneSelected = entry.widgets.some(
                    (widget) => widget.id === selectedWidget?.id,
                  );
                  return (
                    <div
                      className={`widgets-minimal__group${
                        nextZoneSelected ? " is-active" : ""
                      }${nextZoneGroupOpen ? " is-open" : ""}`}
                      key="next-zone-group"
                    >
                      <button
                        className="widgets-minimal__group-trigger"
                        onClick={() =>
                          setNextZoneGroupOpen((current) => !current)
                        }
                        type="button"
                        aria-expanded={nextZoneGroupOpen}
                      >
                        <span>Next Zone Widgets</span>
                        <span>{nextZoneGroupOpen ? "Hide" : "Show"}</span>
                      </button>
                      {nextZoneGroupOpen ? (
                        <div className="widgets-minimal__group-list">
                          {entry.widgets.map((widget) => {
                            const isSelected = widget.id === selectedWidget?.id;
                            const styleName = widget.name.replace(
                              /^Next Zone Update(?: - )?/,
                              "",
                            );
                            return (
                              <button
                                key={widget.id}
                                className={`widgets-minimal__item widgets-minimal__item--nested${
                                  isSelected ? " is-active" : ""
                                }`}
                                onClick={() => setSelectedWidgetId(widget.id)}
                                type="button"
                              >
                                <span>{styleName || widget.name}</span>
                                {widget.widgetKey === "next-zone-update" ? (
                                  <small>Default</small>
                                ) : (
                                  <small>Approved style</small>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                }

                const isSelected = entry.widget.id === selectedWidget?.id;
                return (
                  <button
                    key={entry.widget.id}
                    className={`widgets-minimal__item${
                      isSelected ? " is-active" : ""
                    }`}
                    onClick={() => setSelectedWidgetId(entry.widget.id)}
                    type="button"
                  >
                    {entry.widget.name}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">No widget entries are configured.</div>
          )}
        </aside>

        <section className="widgets-minimal__panel">
          <div className="widgets-minimal__panel-header">
            <span className="widgets-minimal__kicker">Selected Widget</span>
            <h2>{selectedWidget?.name || "Select a widget"}</h2>
          </div>

          <div className="widgets-minimal__urls">
            <div className="widgets-minimal__url-card">
              <span>Local URL</span>
              <code>{localUrl || "--"}</code>
              <button
                className="secondary-button"
                onClick={() => {
                  void handleCopyValue(selectedCanBuildUrl ? localUrl : "");
                }}
                type="button"
                disabled={!selectedCanBuildUrl || !localUrl}
              >
                Copy Local URL
              </button>
            </div>

            <div className="widgets-minimal__url-card">
              <span>LAN URL</span>
              <code>{lanUrl || "--"}</code>
              <button
                className="secondary-button"
                onClick={() => {
                  void handleCopyValue(lanUrl);
                }}
                type="button"
                disabled={!lanUrl}
              >
                Copy LAN URL
              </button>
            </div>
          </div>

          {selectedWidget?.routeKind === "permanent" &&
          selectedPermanentState?.widgetInstanceId ? (
            <div className="widgets-minimal__settings">
              <div className="widgets-minimal__settings-row">
                <div>
                  <span className="widgets-minimal__kicker">
                    Widget credential
                  </span>
                  <strong>
                    {selectedPermanentState.capabilityStatus}
                    {selectedPermanentState.capabilityPrefix
                      ? ` · ${selectedPermanentState.capabilityPrefix}…`
                      : ""}
                  </strong>
                </div>
                <div className="widgets-minimal__settings-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={
                      capabilityBusy || !selectedPermanentState.canRotate
                    }
                    onClick={() => void handleRotateCapability()}
                  >
                    {capabilityBusy ? "Rotating..." : "Rotate credential"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {selectedCanBuildUrl && localUrl ? (
            <section
              className="widgets-minimal__preview"
              aria-label="OBS preview"
            >
              <div className="widgets-minimal__preview-header">
                <div>
                  <span className="widgets-minimal__kicker">
                    OBS-faithful preview
                  </span>
                  <strong>Same local URL and canvas used by OBS</strong>
                </div>
                <span>16:9</span>
              </div>
              <div className="widgets-minimal__preview-stage">
                <iframe
                  key={localUrl}
                  className="widgets-minimal__preview-frame"
                  src={localUrl}
                  title={`${selectedWidget?.name || "Widget"} OBS preview`}
                />
              </div>
            </section>
          ) : null}

          <div className="widgets-minimal__settings widgets-minimal__lan">
            <div className="widgets-minimal__settings-row">
              <div>
                <span className="widgets-minimal__kicker">LAN Widget URLs</span>
                <strong>{lanStatusLabel}</strong>
              </div>
              <div className="widgets-minimal__settings-actions">
                <label className="widgets-minimal__switch">
                  <input
                    aria-label="Enable LAN widget URLs"
                    type="checkbox"
                    checked={lanEnabled}
                    disabled={!launcherConfigView || lanToggleSaving}
                    onChange={(event) => {
                      void handleLanToggleChange(event.target.checked);
                    }}
                  />
                  <span
                    className="widgets-minimal__switch-track"
                    aria-hidden="true"
                  >
                    <span className="widgets-minimal__switch-thumb" />
                  </span>
                </label>
              </div>
            </div>

            {lanEnabled && !widgetServer?.networkBaseUrl ? (
              <div className="widgets-minimal__note">
                LAN is enabled, but no LAN address is available.
              </div>
            ) : null}
          </div>

          {note ? (
            <div
              className={`widgets-minimal__note${
                noteTone === "danger" ? " widgets-minimal__note--danger" : ""
              }`}
            >
              {note}
            </div>
          ) : null}

          {hotkeyControlApproved ? (
            <div className="widgets-minimal__settings widgets-minimal__hotkey">
              <div className="widgets-minimal__settings-row">
                <div>
                  <span className="widgets-minimal__kicker">
                    Launcher Hotkey
                  </span>
                  <strong>
                    {hotkeyControl?.registered
                      ? `Registered on ${hotkeyControl.key}`
                      : hotkeyDraft.enabled
                        ? "Waiting for a valid setup"
                        : "Disabled"}
                  </strong>
                </div>
                <div className="widgets-minimal__settings-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={hotkeySaving}
                    onClick={() => {
                      editHotkeyDraft({
                        enabled: !hotkeyDraft.enabled,
                      });
                    }}
                  >
                    {hotkeyDraft.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!hotkeyControl?.canUse || hotkeyTesting !== null}
                    onClick={() => {
                      void previewHotkeyControl(true);
                    }}
                  >
                    {hotkeyTesting === "hide" ? "Hiding..." : "Hide Preview"}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!hotkeyControl?.canUse || hotkeyTesting !== null}
                    onClick={() => {
                      void previewHotkeyControl(false);
                    }}
                  >
                    {hotkeyTesting === "show" ? "Showing..." : "Show Preview"}
                  </button>
                </div>
              </div>

              <div className="widgets-minimal__settings-grid">
                <label className="field">
                  <span>Hold key</span>
                  <input
                    value={hotkeyDraft.key}
                    disabled={hotkeySaving}
                    onChange={(event) => {
                      editHotkeyDraft({
                        key: event.target.value,
                      });
                    }}
                    placeholder="F9"
                  />
                </label>

                <label className="field">
                  <span>Slide speed</span>
                  <input
                    type="number"
                    min={80}
                    max={1000}
                    step={20}
                    value={hotkeyDraft.transitionMs}
                    disabled={hotkeySaving}
                    onChange={(event) => {
                      editHotkeyDraft({
                        transitionMs: Number(event.target.value),
                      });
                    }}
                  />
                </label>
              </div>

              <div className="widgets-minimal__hotkey-summary">
                <span>{hotkeyEnabledCount} selected</span>
                <span>
                  {hotkeyControl?.active
                    ? "Widgets hidden"
                    : hotkeyControl?.registered
                      ? "Listening"
                      : (hotkeyControl?.reason ?? "Not registered")}
                </span>
              </div>

              <div className="widgets-minimal__hotkey-list">
                {hotkeyDraft.widgets.map((widget) => (
                  <div
                    className="widgets-minimal__hotkey-item"
                    key={widget.widgetKey}
                  >
                    <label>
                      <input
                        type="checkbox"
                        checked={widget.enabled}
                        disabled={hotkeySaving}
                        onChange={(event) => {
                          editHotkeyWidget(widget.widgetKey, {
                            enabled: event.target.checked,
                          });
                        }}
                      />
                      <span>{widget.label}</span>
                    </label>
                    <select
                      value={widget.direction}
                      disabled={hotkeySaving || !widget.enabled}
                      onChange={(event) => {
                        editHotkeyWidget(widget.widgetKey, {
                          direction: event.target
                            .value as WidgetHotkeyDirection,
                        });
                      }}
                    >
                      {HOTKEY_DIRECTION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {hotkeyError ? (
                <div className="widgets-minimal__note widgets-minimal__note--danger">
                  {hotkeyError}
                </div>
              ) : null}

              <div className="widgets-minimal__settings-actions widgets-minimal__settings-actions--footer">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!hotkeyDirty || hotkeySaving}
                  onClick={() => {
                    void saveHotkeyControl();
                  }}
                >
                  {hotkeySaving ? "Saving..." : "Save hotkey"}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!hotkeyDirty || hotkeySaving}
                  onClick={resetHotkeyDraft}
                >
                  Reset
                </button>
              </div>
            </div>
          ) : null}

          {selectedWidget?.id === LIVE_MAP_WIDGET_ID ? (
            <div className="widgets-minimal__settings">
              <div className="widgets-minimal__settings-row">
                <div>
                  <span className="widgets-minimal__kicker">
                    Separate PCOB Control Map
                  </span>
                  <strong>
                    {pinnedMapOpen
                      ? pinnedMapAlwaysOnTop
                        ? "Open - Always on top is On"
                        : "Open - Always on top is Off"
                      : "Closed"}
                  </strong>
                </div>
                <div className="widgets-minimal__settings-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!pinnedMapCanOpen || pinnedMapBusy !== null}
                    onClick={() => {
                      void openPinnedMapControl();
                    }}
                  >
                    {pinnedMapBusy === "open"
                      ? "Opening..."
                      : "Open PCOB Control Map"}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!pinnedMapOpen || pinnedMapBusy !== null}
                    onClick={() => {
                      void closePinnedMapControl();
                    }}
                  >
                    {pinnedMapBusy === "close" ? "Closing..." : "Close"}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    aria-pressed={pinnedMapAlwaysOnTop}
                    disabled={
                      pinnedMapStatus === null || pinnedMapBusy !== null
                    }
                    onClick={() => {
                      void setPinnedMapControlAlwaysOnTop(
                        !pinnedMapAlwaysOnTop,
                      );
                    }}
                  >
                    {pinnedMapBusy === "always-on-top"
                      ? "Updating..."
                      : pinnedMapAlwaysOnTop
                        ? "Always on top: On"
                        : "Always on top: Off"}
                  </button>
                </div>
              </div>

              <div className="widgets-minimal__settings-row">
                <div>
                  <span className="widgets-minimal__kicker">
                    Automatic PCOB Switching
                  </span>
                  <strong>
                    {pcobMapControlStatus
                      ? pcobSwitchingEnabled
                        ? "Enabled"
                        : "Disabled"
                      : "Checking..."}
                  </strong>
                </div>
                <div className="widgets-minimal__settings-actions widgets-minimal__status-meta">
                  <span>
                    Match: {pcobMapControlStatus?.matchStatus || "Not live"}
                  </span>
                  <span>Source: {pcobTelemetrySourceLabel}</span>
                  <span>
                    PCOB:{" "}
                    {pcobMapControlStatus?.available ? "Ready" : "Not ready"}
                  </span>
                </div>
              </div>

              <div
                className={`widgets-minimal__note${
                  pcobSwitchingHasError ? " widgets-minimal__note--danger" : ""
                }`}
              >
                {pcobMapControlError ||
                  pcobMapControlStatus?.message ||
                  "Checking automatic player-switching status..."}
              </div>

              <div className="widgets-minimal__note">
                This is a separate operator window; the OBS Live Map remains
                unchanged. Always on top is optional and changes without
                reopening the map. Player switching enables automatically only
                for a LIVE web-app match with a ready telemetry source and PCOB.
                It disables automatically when the match finishes or telemetry
                becomes unavailable.
              </div>
            </div>
          ) : null}

          {selectedWidget?.id === COMMENTATOR_DESK_WIDGET_ID ? (
            <div className="widgets-minimal__settings">
              <div className="widgets-minimal__settings-row">
                <div>
                  <span className="widgets-minimal__kicker">Pinned Window</span>
                  <strong>
                    {pinnedDeskOpen
                      ? pinnedDeskClickThrough
                        ? "Transparent and click-through"
                        : "Transparent and movable"
                      : "Closed"}
                  </strong>
                </div>
                <div className="widgets-minimal__settings-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!pinnedDeskCanOpen || pinnedDeskBusy !== null}
                    onClick={() => {
                      void openPinnedCommentatorDesk();
                    }}
                  >
                    {pinnedDeskBusy === "open"
                      ? "Opening..."
                      : "Open Pinned Desk"}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!pinnedDeskOpen || pinnedDeskBusy !== null}
                    onClick={() => {
                      void closePinnedCommentatorDesk();
                    }}
                  >
                    {pinnedDeskBusy === "close" ? "Closing..." : "Close"}
                  </button>
                </div>
              </div>

              <div className="widgets-minimal__settings-actions widgets-minimal__settings-actions--footer">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!pinnedDeskOpen || pinnedDeskBusy !== null}
                  onClick={() => {
                    void setPinnedCommentatorDeskClickThrough(
                      !pinnedDeskClickThrough,
                    );
                  }}
                >
                  {pinnedDeskBusy === "click-through"
                    ? "Updating..."
                    : pinnedDeskClickThrough
                      ? "Disable click-through"
                      : "Enable click-through"}
                </button>
              </div>
            </div>
          ) : null}

          {selectedWidget?.id === "ai_caster" ? (
            <div className="widgets-minimal__settings">
              <div className="widgets-minimal__settings-row">
                <div>
                  <span className="widgets-minimal__kicker">Access</span>
                  <strong>
                    {aiCasterAccess?.canUse
                      ? "Approved and live"
                      : aiCasterAccess?.approved
                        ? "Approved"
                        : "Needs SuperAdmin approval"}
                  </strong>
                </div>
                <div className="widgets-minimal__settings-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!aiCasterAccess?.canConfigure || aiCasterSaving}
                    onClick={() => {
                      editAiCaster({
                        enabled: !(aiCasterSettings?.enabled ?? false),
                      });
                    }}
                  >
                    {aiCasterSettings?.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!aiCasterAccess?.canConfigure || aiCasterSaving}
                    onClick={() => {
                      editAiCaster({
                        muted: !(aiCasterSettings?.muted ?? false),
                      });
                    }}
                  >
                    {aiCasterSettings?.muted ? "Unmute" : "Mute"}
                  </button>
                </div>
              </div>

              <div className="widgets-minimal__settings-grid">
                <label className="field">
                  <span>Mode</span>
                  <select
                    value={aiCasterSettings?.mode ?? "professional"}
                    disabled={!aiCasterAccess?.canConfigure || aiCasterSaving}
                    onChange={(event) => {
                      editAiCaster({
                        mode: event.target.value as AiCasterSettings["mode"],
                      });
                    }}
                  >
                    <option value="professional">Professional</option>
                    <option value="hype">Hype</option>
                  </select>
                </label>

                <label className="field">
                  <span>Voices</span>
                  <select
                    value={aiCasterSettings?.voiceMode ?? "single"}
                    disabled={!aiCasterAccess?.canConfigure || aiCasterSaving}
                    onChange={(event) => {
                      editAiCaster({
                        voiceMode: event.target
                          .value as AiCasterSettings["voiceMode"],
                      });
                    }}
                  >
                    <option value="single">Single voice</option>
                    <option value="dual">Two voices</option>
                  </select>
                </label>

                <div className="widgets-minimal__voice-control">
                  <label className="field">
                    <span>Primary voice</span>
                    <select
                      value={aiCasterSettings?.primaryVoice ?? "play-by-play"}
                      disabled={!aiCasterAccess?.canConfigure || aiCasterSaving}
                      onChange={(event) => {
                        editAiCaster({
                          primaryVoice: event.target.value,
                        });
                      }}
                    >
                      {getAiCasterVoiceOptions(
                        aiCasterSettings?.primaryVoice,
                      ).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={
                      !aiCasterAccess?.canConfigure ||
                      aiCasterSaving ||
                      aiCasterPreviewing !== null
                    }
                    onClick={() => {
                      void previewAiCasterVoice(
                        "play-by-play",
                        aiCasterSettings?.primaryVoice ?? "play-by-play",
                      );
                    }}
                  >
                    {aiCasterPreviewing === "play-by-play"
                      ? "Playing..."
                      : "Preview"}
                  </button>
                </div>

                <div className="widgets-minimal__voice-control">
                  <label className="field">
                    <span>Secondary voice</span>
                    <select
                      value={aiCasterSettings?.secondaryVoice ?? "analyst"}
                      disabled={
                        !aiCasterAccess?.canConfigure ||
                        aiCasterSaving ||
                        aiCasterSettings?.voiceMode !== "dual"
                      }
                      onChange={(event) => {
                        editAiCaster({
                          secondaryVoice: event.target.value,
                        });
                      }}
                    >
                      {getAiCasterVoiceOptions(
                        aiCasterSettings?.secondaryVoice,
                      ).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={
                      !aiCasterAccess?.canConfigure ||
                      aiCasterSettings?.voiceMode !== "dual" ||
                      aiCasterSaving ||
                      aiCasterPreviewing !== null
                    }
                    onClick={() => {
                      void previewAiCasterVoice(
                        "analyst",
                        aiCasterSettings?.secondaryVoice ?? "analyst",
                      );
                    }}
                  >
                    {aiCasterPreviewing === "analyst"
                      ? "Playing..."
                      : "Preview"}
                  </button>
                </div>

                <label className="field">
                  <span>Talk frequency</span>
                  <select
                    value={aiCasterSettings?.talkFrequency ?? "balanced"}
                    disabled={!aiCasterAccess?.canConfigure || aiCasterSaving}
                    onChange={(event) => {
                      editAiCaster({
                        talkFrequency: event.target
                          .value as AiCasterSettings["talkFrequency"],
                      });
                    }}
                  >
                    <option value="low">Low</option>
                    <option value="balanced">Balanced</option>
                    <option value="high">High</option>
                  </select>
                </label>

                <label className="field">
                  <span>Speaking speed</span>
                  <select
                    value={aiCasterSettings?.speakingSpeed ?? "normal"}
                    disabled={!aiCasterAccess?.canConfigure || aiCasterSaving}
                    onChange={(event) => {
                      editAiCaster({
                        speakingSpeed: event.target
                          .value as AiCasterSettings["speakingSpeed"],
                      });
                    }}
                  >
                    <option value="slow">Slow</option>
                    <option value="normal">Normal</option>
                    <option value="fast">Fast</option>
                  </select>
                </label>

                <label className="field">
                  <span>Expression</span>
                  <select
                    value={aiCasterSettings?.expression ?? "professional"}
                    disabled={!aiCasterAccess?.canConfigure || aiCasterSaving}
                    onChange={(event) => {
                      editAiCaster({
                        expression: event.target
                          .value as AiCasterSettings["expression"],
                      });
                    }}
                  >
                    <option value="neutral">Neutral</option>
                    <option value="professional">Professional</option>
                    <option value="energetic">Energetic</option>
                    <option value="dramatic">Dramatic</option>
                  </select>
                </label>
              </div>
              <div className="widgets-minimal__settings-actions widgets-minimal__settings-actions--footer">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={
                    !aiCasterAccess?.canConfigure ||
                    !aiCasterDirty ||
                    aiCasterSaving
                  }
                  onClick={() => {
                    void saveAiCaster();
                  }}
                >
                  {aiCasterSaving ? "Saving..." : "Save changes"}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!aiCasterDirty || aiCasterSaving}
                  onClick={resetAiCasterDraft}
                >
                  Reset
                </button>
              </div>
              <span className="widgets-minimal__fine-print">
                Voice previews use the current local selection. Changes apply
                after saving.
              </span>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
