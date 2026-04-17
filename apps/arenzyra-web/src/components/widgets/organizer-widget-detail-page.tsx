"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Clock3,
  Copy,
  ExternalLink,
  Radar,
  Trophy,
} from "lucide-react";
import { type LiveWidgetCatalogItem } from "@/components/widgets/live-widgets";
import {
  buildLegacyWidgetPath,
  buildLiveWidgetPath,
  findOrganizerWidgetCatalogItem,
} from "@/components/widgets/organizer-widget-catalog";
import { useOrganizerWidgetLibrary } from "@/components/widgets/use-organizer-widget-library";
import { useState } from "react";

const SECTION_CHROME = {
  "pre-match": {
    icon: Clock3,
    badgeClassName: "border-cyan-400/20 bg-cyan-500/10 text-cyan-200",
    cardClassName:
      "border-cyan-300/16 bg-slate-950/80 shadow-[0_24px_90px_rgba(0,0,0,0.42)]",
  },
  "in-match": {
    icon: Radar,
    badgeClassName: "border-emerald-400/20 bg-emerald-500/10 text-emerald-200",
    cardClassName:
      "border-emerald-300/16 bg-slate-950/80 shadow-[0_24px_90px_rgba(0,0,0,0.42)]",
  },
  "post-match": {
    icon: Trophy,
    badgeClassName: "border-amber-400/20 bg-amber-500/10 text-amber-200",
    cardClassName:
      "border-amber-300/16 bg-slate-950/80 shadow-[0_24px_90px_rgba(0,0,0,0.42)]",
  },
} as const;

const LIVE_PREVIEW_VIEWPORTS: Partial<
  Record<LiveWidgetCatalogItem["key"], { scale: number; transformOrigin: string }>
> = {
  leaderboard: {
    scale: 1.55,
    transformOrigin: "100% 50%",
  },
  "overall-live-ranking": {
    scale: 1.42,
    transformOrigin: "100% 50%",
  },
  "match-lower-third": {
    scale: 1.16,
    transformOrigin: "0% 100%",
  },
  "teams-alive": {
    scale: 1.18,
    transformOrigin: "50% 50%",
  },
};

type CopyTarget = "obs" | "preview";

export function OrganizerWidgetDetailPage({ widgetKey }: { widgetKey: string }) {
  const widget = findOrganizerWidgetCatalogItem(widgetKey);
  const activeWidget = widget ?? {
    key: widgetKey,
    title: "Unknown Widget",
    description: "This widget key does not exist in the organizer widget catalog.",
    sectionKey: "in-match" as const,
    sectionTitle: "In-Match Widgets",
    family: "live" as const,
    implemented: false,
    liveKey: null,
  };
  const { resolvedOrganizationSlug, widgetAccess, isWidgetApproved } =
    useOrganizerWidgetLibrary();
  const [previewMatchId, setPreviewMatchId] = useState("");
  const [copyState, setCopyState] = useState<Record<CopyTarget, boolean>>({
    obs: false,
    preview: false,
  });

  const hasResolvedOrganizationSlug = Boolean(resolvedOrganizationSlug);
  const chrome = SECTION_CHROME[activeWidget.sectionKey];
  const SectionIcon = chrome.icon;
  const approved = widget ? isWidgetApproved(activeWidget.key) : false;
  const canOpenRoutes =
    activeWidget.implemented && approved && hasResolvedOrganizationSlug;
  const trimmedMatchId = previewMatchId.trim();
  const previewSrc =
    !resolvedOrganizationSlug
      ? ""
      : activeWidget.liveKey !== null
      ? buildLiveWidgetPath(resolvedOrganizationSlug, activeWidget.liveKey, {
          matchId: trimmedMatchId,
          preview: true,
        })
      : `${buildLegacyWidgetPath(resolvedOrganizationSlug, activeWidget.key)}?preview=true`;
  const obsRoute =
    !resolvedOrganizationSlug
      ? ""
      : activeWidget.liveKey !== null
      ? buildLiveWidgetPath(resolvedOrganizationSlug, activeWidget.liveKey, {
          matchId: trimmedMatchId,
          clean: true,
        })
      : buildLegacyWidgetPath(resolvedOrganizationSlug, activeWidget.key);
  const previewViewport =
    (activeWidget.liveKey !== null ? LIVE_PREVIEW_VIEWPORTS[activeWidget.liveKey] : null) ?? {
      scale: 1,
      transformOrigin: "50% 50%",
    };
  const approvalStateLabel = widgetAccess?.enforced
    ? approved
      ? "Approved"
      : "Approval required"
    : "Open by default";
  const routeKindLabel =
    activeWidget.liveKey !== null ? "Live route" : "Organizer route";
  const previewHint =
    activeWidget.liveKey !== null
      ? "Leave match id blank to auto-resolve the current live match for this organization."
      : "Organizer widgets resolve their own context from the organizer widget endpoints.";
  const transportLabel =
    activeWidget.liveKey !== null ? "Socket.IO realtime" : "Organizer widget API";

  const handleOpenPreview = () => {
    if (typeof window === "undefined" || !canOpenRoutes) return;
    window.open(previewSrc, "_blank", "noopener,noreferrer");
  };

  const handleCopy = async (target: CopyTarget, value: string) => {
    if (typeof window === "undefined" || !canOpenRoutes || !value) return;
    await navigator.clipboard.writeText(`${window.location.origin}${value}`);
    setCopyState((prev) => ({ ...prev, [target]: true }));
    window.setTimeout(() => {
      setCopyState((prev) => ({ ...prev, [target]: false }));
    }, 1600);
  };

  if (!widget) {
    return (
      <div className="space-y-6">
        <div className="flex justify-end">
          <Link
            href="/organizer/widgets"
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-slate-950/65 px-5 py-3 text-sm font-medium text-cyan-50/90 transition hover:border-cyan-300/40 hover:bg-cyan-500/10 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </div>
        <section className="rounded-2xl border border-white/10 bg-slate-950/80 p-8 text-center shadow-[0_24px_90px_rgba(0,0,0,0.42)]">
          <div className="text-2xl font-semibold text-white">Widget not found</div>
          <p className="mt-3 text-sm leading-6 text-white/55">
            This widget key does not exist in the organizer widget catalog.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className={`rounded-2xl border p-6 ${chrome.cardClassName}`}>
        <div className="flex flex-col gap-6 border-b border-white/8 pb-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-start gap-4">
            <div className={`rounded-2xl border p-3 ${chrome.badgeClassName}`}>
              <SectionIcon className="h-5 w-5" />
            </div>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${chrome.badgeClassName}`}
                >
                  {widget.sectionTitle}
                </span>
                <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/65">
                  {routeKindLabel}
                </span>
                <span
                  className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${
                    approved
                      ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
                      : "border-amber-400/20 bg-amber-500/10 text-amber-200"
                  }`}
                >
                  {approvalStateLabel}
                </span>
              </div>
              <div>
                <h1 className="text-3xl font-bold text-white">{widget.title}</h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-white/60">
                  {widget.description}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 xl:w-[420px]">
            <div className="flex justify-end">
              <Link
                href="/organizer/widgets"
                className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-slate-950/65 px-5 py-3 text-sm font-medium text-cyan-50/90 transition hover:border-cyan-300/40 hover:bg-cyan-500/10 hover:text-white"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.24em] text-white/40">
                  Organization
                </div>
                <div className="mt-2 text-sm font-semibold text-white">
                  {resolvedOrganizationSlug ?? "Resolving..."}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.24em] text-white/40">
                  Family
                </div>
                <div className="mt-2 text-sm font-semibold text-white">
                  {widget.family === "live" ? "Live widget" : "Organizer widget"}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.24em] text-white/40">
                  Status
                </div>
                <div className="mt-2 text-sm font-semibold text-white">
                  {widget.implemented ? "Available" : "Roadmap"}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4 xl:min-w-0">
            {widget.liveKey !== null ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <label
                  htmlFor="preview-match-id"
                  className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45"
                >
                  Preview Match Id
                </label>
                <input
                  id="preview-match-id"
                  type="text"
                  value={previewMatchId}
                  onChange={(event) => setPreviewMatchId(event.target.value)}
                  placeholder="Uses current live match when blank"
                  className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-950/75 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-cyan-300/35"
                />
                <p className="mt-3 text-xs leading-5 text-white/50">{previewHint}</p>
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">
                  Preview Route
                </div>
                <div className="mt-2 break-all font-mono text-[11px] text-white/68">
                  {previewSrc || "Waiting for organization slug..."}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">
                  OBS Route
                </div>
                <div className="mt-2 break-all font-mono text-[11px] text-white/68">
                  {obsRoute || "Waiting for organization slug..."}
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-[30px] border border-white/10 bg-slate-950 shadow-[0_30px_100px_rgba(0,0,0,0.5)]">
              <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.24em] text-white/40">
                    Dashboard Preview
                  </div>
                  <div className="mt-2 text-lg font-semibold text-white">{widget.title}</div>
                </div>
                <div className="text-right text-xs text-white/45">
                  {widget.liveKey !== null ? trimmedMatchId || "Live auto-resolve" : "Preview mode"}
                </div>
              </div>

              {canOpenRoutes ? (
                <div className="aspect-video min-h-[420px] bg-[#07131b]">
                  <div className="h-full w-full overflow-hidden">
                    <iframe
                      key={previewSrc}
                      title={`${widget.title} preview`}
                      src={previewSrc}
                      className="border-0"
                      style={{
                        width: "100%",
                        height: "100%",
                        transform: `scale(${previewViewport.scale})`,
                        transformOrigin: previewViewport.transformOrigin,
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex min-h-[420px] items-center justify-center px-8 text-center">
                  <div className="max-w-md space-y-3">
                    <div className="text-lg font-semibold text-white">
                      {widget.implemented
                        ? hasResolvedOrganizationSlug
                          ? "Preview unavailable"
                          : "Organization unresolved"
                        : "Widget not implemented"}
                    </div>
                    <p className="text-sm leading-6 text-white/55">
                      {!widget.implemented
                        ? "This widget is still marked as roadmap-only and does not expose a preview route yet."
                        : !hasResolvedOrganizationSlug
                          ? "The current organizer slug has not resolved yet, so route generation is paused to avoid broken widget URLs."
                          : widget.implemented
                        ? "This widget requires approval for the current organization before the preview and OBS routes can be opened."
                        : ""}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="text-[10px] uppercase tracking-[0.24em] text-white/40">
                Actions
              </div>
              <div className="mt-4 grid gap-2">
                <button
                  type="button"
                  onClick={handleOpenPreview}
                  disabled={!canOpenRoutes}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-500/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200 transition hover:bg-cyan-500/18 hover:text-white disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-white/30"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open preview
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopy("obs", obsRoute)}
                  disabled={!canOpenRoutes}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/72 transition hover:border-white/20 hover:bg-white/[0.09] hover:text-white disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-white/30"
                >
                  {copyState.obs ? (
                    <Check className="h-3.5 w-3.5 text-emerald-300" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copyState.obs ? "OBS copied" : "Copy OBS URL"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopy("preview", previewSrc)}
                  disabled={!canOpenRoutes}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/72 transition hover:border-white/20 hover:bg-white/[0.09] hover:text-white disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-white/30"
                >
                  {copyState.preview ? (
                    <Check className="h-3.5 w-3.5 text-emerald-300" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copyState.preview ? "Preview copied" : "Copy preview URL"}
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
              <div className="text-[10px] uppercase tracking-[0.24em] text-white/40">
                Transport
              </div>
              <div className="mt-2 text-lg font-semibold text-white">{transportLabel}</div>
              <div className="mt-1 text-xs leading-5 text-white/50">
                {widget.liveKey !== null
                  ? "Live widgets listen to realtime packets and can auto-resolve the current active match."
                  : "Organizer widgets render from organizer match context and post-match data endpoints."}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
              <div className="text-[10px] uppercase tracking-[0.24em] text-white/40">
                Match Source
              </div>
              <div className="mt-2 text-lg font-semibold text-white">
                {widget.liveKey !== null ? trimmedMatchId || "Live match auto-resolve" : "Organizer context"}
              </div>
              <div className="mt-1 text-xs leading-5 text-white/50">{previewHint}</div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
              <div className="text-[10px] uppercase tracking-[0.24em] text-white/40">
                Route Type
              </div>
              <div className="mt-2 text-lg font-semibold text-white">{routeKindLabel}</div>
              <div className="mt-1 text-xs leading-5 text-white/50">
                {widget.liveKey !== null
                  ? "Use the clean OBS route for browser sources and the preview route for staging and QA."
                  : "Legacy organizer widgets use a single OBS route plus preview mode for rehearsal."}
              </div>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
