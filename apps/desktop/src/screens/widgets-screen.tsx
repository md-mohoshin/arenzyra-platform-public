import { useEffect, useState } from "react";
import { getErrorMessage, launcherApi } from "../api/api-client";
import type {
  StatusMessage,
  WidgetCatalogState,
  WidgetServerStatus,
} from "../types";
import {
  buildWidgetUrl,
  buildWidgetUrlTemplate,
  canBuildWidgetUrl,
  widgetCategoryOrder,
  widgets,
} from "../widgets/widgets.config";

const DEFAULT_WIDGET_SERVER_BASE_URL = "http://localhost:5510";
const WIDGET_SERVER_REFRESH_MS = 5_000;
const WIDGET_CATALOG_REFRESH_MS = 30_000;
const AVAILABLE_WIDGETS = widgets;
const PERMANENT_WIDGET_KEYS = Array.from(
  new Set(
    widgets
      .filter((widget) => widget.routeKind === "permanent" && widget.widgetKey)
      .map((widget) => widget.widgetKey as string),
  ),
);

const DEFAULT_WIDGET_STATUS: StatusMessage = {
  tone: "neutral",
  title: "Widget preview ready",
  detail: "Select a local or branded widget to preview and copy OBS browser source URLs.",
};

const formatLastUpdate = (value: number | null | undefined) => {
  if (!value || !Number.isFinite(value)) {
    return "--";
  }

  return new Date(value).toLocaleTimeString();
};

const buildCategoryGroups = () => {
  const groups = new Map<string, typeof widgets>();

  AVAILABLE_WIDGETS.forEach((widget) => {
    const current = groups.get(widget.category) ?? [];
    current.push(widget);
    groups.set(widget.category, current);
  });

  const knownCategories = widgetCategoryOrder.filter((category) =>
    groups.has(category),
  );
  const dynamicCategories = Array.from(groups.keys())
    .filter((category) => !widgetCategoryOrder.includes(category))
    .sort((left, right) => left.localeCompare(right));

  return [...knownCategories, ...dynamicCategories].map((category) => ({
    category,
    items: groups.get(category) ?? [],
  }));
};

const getWidgetPreviewBaseUrl = (widgetServer: WidgetServerStatus | null) =>
  widgetServer?.localBaseUrl ||
  widgetServer?.baseUrl ||
  DEFAULT_WIDGET_SERVER_BASE_URL;

const getResolvedRouteLabel = (widget: (typeof widgets)[number]) =>
  widget.routeKind === "permanent" && widget.widgetKey
    ? `${widget.widgetKey} | ${widget.path}`
    : widget.path;

type WidgetsScreenProps = {
  organizationId: string | null;
};

export function WidgetsScreen(_props: WidgetsScreenProps) {
  const [widgetServer, setWidgetServer] = useState<WidgetServerStatus | null>(null);
  const [widgetCatalog, setWidgetCatalog] = useState<WidgetCatalogState | null>(null);
  const [serverLoading, setServerLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectedWidgetId, setSelectedWidgetId] = useState(
    AVAILABLE_WIDGETS[0]?.id ?? "",
  );
  const [status, setStatus] = useState<StatusMessage>(DEFAULT_WIDGET_STATUS);
  const { organizationId } = _props;

  useEffect(() => {
    if (!AVAILABLE_WIDGETS.some((widget) => widget.id === selectedWidgetId)) {
      setSelectedWidgetId(AVAILABLE_WIDGETS[0]?.id ?? "");
    }
  }, [selectedWidgetId]);

  const refreshWidgetCatalog = async (showLoading: boolean) => {
    if (!organizationId || PERMANENT_WIDGET_KEYS.length === 0) {
      setWidgetCatalog(null);
      setCatalogError(
        organizationId ? null : "Organization unavailable for branded widget resolution.",
      );
      setCatalogLoading(false);
      return;
    }

    if (showLoading) {
      setCatalogLoading(true);
    }

    try {
      const catalog = await launcherApi.getWidgetCatalogState(
        organizationId,
        PERMANENT_WIDGET_KEYS,
      );
      setWidgetCatalog(catalog);
      setCatalogError(null);
    } catch (error) {
      setCatalogError(getErrorMessage(error));
    } finally {
      if (showLoading) {
        setCatalogLoading(false);
      }
    }
  };

  useEffect(() => {
    let cancelled = false;

    const load = async (showLoading: boolean) => {
      if (cancelled) {
        return;
      }
      await refreshWidgetCatalog(showLoading);
    };

    void load(true);
    const timer = window.setInterval(() => {
      void load(false);
    }, WIDGET_CATALOG_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [organizationId]);

  useEffect(() => {
    let cancelled = false;

    const loadWidgetsState = async (showLoading: boolean) => {
      if (showLoading) {
        setServerLoading(true);
      }

      const serverResult = await launcherApi
        .getWidgetServerStatus()
        .then((value) => ({ status: "fulfilled" as const, value }))
        .catch((reason) => ({ status: "rejected" as const, reason }));

      if (cancelled) {
        return;
      }

      if (serverResult.status === "fulfilled") {
        setWidgetServer(serverResult.value);
        setServerError(null);
      } else {
        setServerError(getErrorMessage(serverResult.reason));
      }

      if (showLoading) {
        setServerLoading(false);
      }
    };

    void loadWidgetsState(true);
    const timer = window.setInterval(() => {
      void loadWidgetsState(false);
    }, WIDGET_SERVER_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const selectedWidget =
    AVAILABLE_WIDGETS.find((widget) => widget.id === selectedWidgetId) ||
    AVAILABLE_WIDGETS[0] ||
    null;
  const groupedWidgets = buildCategoryGroups();
  const previewBaseUrl = getWidgetPreviewBaseUrl(widgetServer);
  const previewHeight = selectedWidget?.previewHeight ?? 520;
  const selectedPermanentState =
    selectedWidget?.routeKind === "permanent" && selectedWidget.widgetKey
      ? widgetCatalog?.items?.[selectedWidget.widgetKey] ?? null
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

  const localDevUrl =
    selectedWidget && selectedCanBuildUrl
      ? buildWidgetUrl(previewBaseUrl, selectedWidget, {
          widgetInstanceKey: selectedWidgetInstanceKey,
        })
      : "";
  const lanDevUrl =
    selectedWidget && selectedCanBuildUrl && widgetServer?.networkBaseUrl
      ? buildWidgetUrl(widgetServer.networkBaseUrl, selectedWidget, {
          widgetInstanceKey: selectedWidgetInstanceKey,
        })
      : "";
  const previewWidgetUrl = selectedWidget ? localDevUrl : "";
  const previewReady = Boolean(previewWidgetUrl);
  const selectedRouteKind =
    selectedWidget?.routeKind === "permanent" ? "Branded" : "Raw";

  const refreshWidgetsView = async () => {
    setServerLoading(true);

    const serverResult = await launcherApi
      .getWidgetServerStatus()
      .then((value) => ({ status: "fulfilled" as const, value }))
      .catch((reason) => ({ status: "rejected" as const, reason }));

    if (serverResult.status === "fulfilled") {
      const nextStatus = serverResult.value;
      setWidgetServer(nextStatus);
      setServerError(null);
      await refreshWidgetCatalog(false);
      const localUrl =
        nextStatus.localBaseUrl || nextStatus.baseUrl || DEFAULT_WIDGET_SERVER_BASE_URL;
      setStatus({
        tone: "success",
        title: "Widget URLs refreshed",
        detail: nextStatus.networkBaseUrl
          ? `Local: ${localUrl} | Network: ${nextStatus.networkBaseUrl}`
          : `Local: ${localUrl}`,
      });
    } else {
      const detail = getErrorMessage(serverResult.reason);
      setServerError(detail);
      setStatus({
        tone: "error",
        title: "Widget server unavailable",
        detail,
      });
    }

    setServerLoading(false);
  };

  const handleCopyValue = async (value: string, detail: string) => {
    if (!value) {
      return;
    }

    try {
      await launcherApi.copyText(value);
      setStatus({
        tone: "success",
        title: "URL copied",
        detail,
      });
    } catch (error) {
      setStatus({
        tone: "error",
        title: "Copy failed",
        detail: getErrorMessage(error),
      });
    }
  };

  const handleOpenInBrowser = async () => {
    if (!previewWidgetUrl || !selectedWidget) {
      return;
    }

    try {
      await launcherApi.openExternal(previewWidgetUrl);
      setStatus({
        tone: "neutral",
        title: "Opened in browser",
        detail: `${selectedWidget.name} was opened in your default browser.`,
      });
    } catch (error) {
      setStatus({
        tone: "error",
        title: "Open failed",
        detail: getErrorMessage(error),
      });
    }
  };

  return (
    <div className="app-shell widgets-screen">
      <div className="hero-card widgets-hero widgets-hero--simple">
        <div className="hero-copy">
          <span className="eyebrow">OBS Widgets</span>
          <h1>Local and branded OBS widgets.</h1>
          <p>
            Select a widget, preview it locally, and copy the URL for OBS
            browser sources.
          </p>
          <div className="hero-actions">
            <button
              className="secondary-button"
              onClick={() => {
                void refreshWidgetsView();
              }}
              disabled={serverLoading}
              type="button"
            >
              {serverLoading ? "Refreshing..." : "Refresh Widget URLs"}
            </button>
          </div>
        </div>

        <div className="hero-meta">
          <div className="meta-pill">
            <span>Widget Server</span>
            <strong>
              {serverLoading
                ? "Checking..."
                : widgetServer?.running
                  ? "Running"
                : "Stopped"}
            </strong>
          </div>
              <div className="meta-pill">
                <span>Browser Clients</span>
                <strong>{widgetServer?.clientCount ?? 0}</strong>
              </div>
              <div className="meta-pill">
                <span>Branded Widgets</span>
                <strong>
                  {catalogLoading
                    ? "Resolving..."
                    : widgetCatalog?.organizationSlug
                      ? "Resolved"
                      : "Pending"}
                </strong>
              </div>
              <div className="meta-pill">
                <span>Last Broadcast</span>
                <strong>{formatLastUpdate(widgetServer?.lastBroadcastAt)}</strong>
          </div>
        </div>
      </div>

      <div className="widgets-layout">
        <section className="panel widgets-catalog">
          <div className="panel-heading">
            <span className="panel-kicker">Widget Catalog</span>
            <h2>Available OBS Widgets</h2>
          </div>

          {groupedWidgets.length ? (
            <div className="widgets-category-list">
              {groupedWidgets.map((group) => (
                <div key={group.category} className="widgets-category">
                  <div className="widgets-category__title">{group.category}</div>
                  <div className="widgets-category__items">
                    {group.items.map((widget) => {
                      const isSelected = widget.id === selectedWidget?.id;
                      return (
                        <button
                          key={widget.id}
                          className={`widgets-category__item${isSelected ? " is-active" : ""}`}
                          onClick={() => setSelectedWidgetId(widget.id)}
                          type="button"
                        >
                          <span>{widget.name}</span>
                          <small>{getResolvedRouteLabel(widget)}</small>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              No widget entries are configured yet. Add new entries in
              <code> src/widgets/widgets.config.ts</code>.
            </div>
          )}
        </section>

        <section className="panel widgets-preview-panel">
          <div className="panel-heading">
            <span className="panel-kicker">Preview</span>
            <h2>{selectedWidget?.name || "Select a widget"}</h2>
          </div>

          {selectedWidget ? (
            <>
              <p className="widgets-preview-panel__description">
                {selectedWidget.description}
              </p>

              {serverError ? (
                <div className="status-card status-card--error">
                  <strong>Widget server check failed</strong>
                  <p>{serverError}</p>
                </div>
              ) : null}

              <div className={`status-card status-card--${status.tone}`}>
                <strong>{status.title}</strong>
                <p>{status.detail}</p>
              </div>

              {catalogError && selectedWidget.routeKind === "permanent" ? (
                <div className="status-card status-card--error">
                  <strong>Branded widget resolution failed</strong>
                  <p>{catalogError}</p>
                </div>
              ) : null}

              {selectedWidget.routeKind === "permanent" &&
              selectedPermanentState?.message ? (
                <div className="status-card status-card--neutral">
                  <strong>Widget instance pending</strong>
                  <p>{selectedPermanentState.message}</p>
                </div>
              ) : null}

              <div className="widgets-url-grid">
                <div className="path-card">
                  <span className="path-label">
                    Local {selectedRouteKind} OBS URL
                  </span>
                  {!localDevUrl && localTemplateUrl ? (
                    <p className="path-card__note">{localTemplateUrl}</p>
                  ) : null}
                  <div className="path-card__actions">
                    <button
                      className="secondary-button"
                      onClick={() =>
                        void handleCopyValue(
                          localDevUrl,
                          `${selectedWidget.name} local ${selectedRouteKind.toLowerCase()} OBS URL copied to the clipboard.`,
                        )
                      }
                      type="button"
                      disabled={!localDevUrl}
                    >
                      Copy Local OBS URL
                    </button>
                  </div>
                </div>

                <div className="path-card">
                  <span className="path-label">
                    LAN {selectedRouteKind} OBS URL
                  </span>
                  {lanDevUrl ? (
                    <p className="path-card__note">
                      Use this when OBS is on another PC in the same network.
                    </p>
                  ) : (
                    <p className="path-card__note">
                      LAN URL unavailable until the widget server exposes a network address.
                    </p>
                  )}
                  <div className="path-card__actions">
                    <button
                      className="secondary-button"
                      onClick={() =>
                        void handleCopyValue(
                          lanDevUrl,
                          `${selectedWidget.name} LAN ${selectedRouteKind.toLowerCase()} OBS URL copied to the clipboard.`,
                        )
                      }
                      type="button"
                      disabled={!lanDevUrl}
                    >
                      Copy LAN OBS URL
                    </button>
                  </div>
                </div>
              </div>

              {previewReady ? (
                <div className="widgets-preview-frame" style={{ minHeight: `${previewHeight}px` }}>
                  <iframe
                    key={previewWidgetUrl}
                    className="widgets-preview-frame__iframe"
                    src={previewWidgetUrl}
                    style={{ minHeight: `${previewHeight}px` }}
                    title={selectedWidget.name}
                  />
                </div>
              ) : (
                <div className="status-card">
                  <strong>Widget preview unavailable</strong>
                  <p>
                    The local OBS route for this widget is not available.
                  </p>
                </div>
              )}

              <div className="widgets-actions">
                <button
                  className="primary-button"
                  onClick={() => void handleOpenInBrowser()}
                  type="button"
                  disabled={!previewWidgetUrl}
                >
                  Open Preview in Browser
                </button>
              </div>
            </>
          ) : (
            <div className="empty-state">
              Select a widget from the left panel to preview its OBS source URL.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
