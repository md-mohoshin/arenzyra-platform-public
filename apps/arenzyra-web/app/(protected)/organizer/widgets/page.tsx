"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Clock3, Radar, Trophy } from "lucide-react";
import {
  buildOrganizerWidgetDetailPath,
  organizerWidgetCatalog,
  type WidgetSectionKey,
} from "@/components/widgets/organizer-widget-catalog";
import { useOrganizerWidgetLibrary } from "@/components/widgets/use-organizer-widget-library";
import { useMemo, useState } from "react";

type CatalogFilter = "all" | WidgetSectionKey;

const FILTERS: Array<{ key: CatalogFilter; label: string }> = [
  { key: "in-match", label: "Live" },
  { key: "pre-match", label: "Pre-Match" },
  { key: "post-match", label: "Post-Match" },
  { key: "all", label: "All" },
];

const SECTION_META = {
  "pre-match": {
    icon: Clock3,
    badgeClassName: "border-cyan-400/20 bg-cyan-500/10 text-cyan-200",
    cardGlowClassName: "group-hover:border-cyan-300/22 group-hover:bg-cyan-500/[0.07]",
  },
  "in-match": {
    icon: Radar,
    badgeClassName: "border-emerald-400/20 bg-emerald-500/10 text-emerald-200",
    cardGlowClassName:
      "group-hover:border-emerald-300/22 group-hover:bg-emerald-500/[0.07]",
  },
  "post-match": {
    icon: Trophy,
    badgeClassName: "border-amber-400/20 bg-amber-500/10 text-amber-200",
    cardGlowClassName: "group-hover:border-amber-300/22 group-hover:bg-amber-500/[0.07]",
  },
} as const;

export default function OrganizerWidgetsPage() {
  const router = useRouter();
  const [selectedFilter, setSelectedFilter] = useState<CatalogFilter>("in-match");
  const { resolvedOrganizationSlug, widgetAccess, isWidgetApproved, approvedLiveWidgets } =
    useOrganizerWidgetLibrary();

  const filteredWidgets = useMemo(() => {
    if (selectedFilter === "all") {
      return organizerWidgetCatalog;
    }

    return organizerWidgetCatalog.filter((widget) => widget.sectionKey === selectedFilter);
  }, [selectedFilter]);

  const widgetCounts = useMemo(
    () => ({
      all: organizerWidgetCatalog.length,
      "pre-match": organizerWidgetCatalog.filter((widget) => widget.sectionKey === "pre-match")
        .length,
      "in-match": organizerWidgetCatalog.filter((widget) => widget.sectionKey === "in-match")
        .length,
      "post-match": organizerWidgetCatalog.filter((widget) => widget.sectionKey === "post-match")
        .length,
    }),
    [],
  );

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/organizer");
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-white">Widgets</h1>
          <p className="max-w-3xl text-sm leading-6 text-white/60">
            The widgets screen is now a compact library. Pick a widget, open its dedicated setup
            page, and work there with preview, OBS routes, and per-widget details.
          </p>
        </div>
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-2 self-start rounded-xl border border-cyan-400/20 bg-slate-950/65 px-5 py-3 text-sm font-medium text-cyan-50/90 transition hover:border-cyan-300/40 hover:bg-cyan-500/10 hover:text-white"
        >
          &larr; Back
        </button>
      </div>

      <section className="rounded-2xl border border-white/10 bg-slate-950/80 p-6 shadow-[0_24px_90px_rgba(0,0,0,0.42)]">
        <div className="flex flex-col gap-5 border-b border-white/8 pb-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/65">
                Widget Library
              </span>
              <span className="inline-flex items-center rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200">
                Catalog first
              </span>
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-white">Keep the index short</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">
                The main page only shows widget entries. Each widget now gets its own setup view,
                so you do not need to scroll past a large preview frame and route panel just to
                find the next item.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:w-[420px]">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
              <div className="text-[10px] uppercase tracking-[0.24em] text-white/40">
                Organization
              </div>
              <div className="mt-2 text-sm font-semibold text-white">{resolvedOrganizationSlug}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
              <div className="text-[10px] uppercase tracking-[0.24em] text-white/40">
                Access
              </div>
              <div className="mt-2 text-sm font-semibold text-white">
                {widgetAccess?.enforced ? "Approval enforced" : "Open by default"}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
            <div className="text-[10px] uppercase tracking-[0.24em] text-white/40">
              Total Widgets
            </div>
            <div className="mt-2 text-2xl font-semibold text-white">{widgetCounts.all}</div>
            <div className="mt-1 text-xs text-white/50">Full broadcast catalog</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
            <div className="text-[10px] uppercase tracking-[0.24em] text-white/40">
              Live Widgets
            </div>
            <div className="mt-2 text-2xl font-semibold text-white">
              {approvedLiveWidgets.length}/{widgetCounts["in-match"]}
            </div>
            <div className="mt-1 text-xs text-white/50">Approved live routes</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
            <div className="text-[10px] uppercase tracking-[0.24em] text-white/40">
              Pre-Match
            </div>
            <div className="mt-2 text-2xl font-semibold text-white">
              {widgetCounts["pre-match"]}
            </div>
            <div className="mt-1 text-xs text-white/50">Lobby and intro surfaces</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
            <div className="text-[10px] uppercase tracking-[0.24em] text-white/40">
              Post-Match
            </div>
            <div className="mt-2 text-2xl font-semibold text-white">
              {widgetCounts["post-match"]}
            </div>
            <div className="mt-1 text-xs text-white/50">Results and wrap-up views</div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {FILTERS.map((filter) => {
            const active = filter.key === selectedFilter;
            const count =
              filter.key === "all" ? widgetCounts.all : widgetCounts[filter.key];

            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => setSelectedFilter(filter.key)}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] transition ${
                  active
                    ? "border-cyan-300/20 bg-cyan-500/10 text-cyan-200"
                    : "border-white/10 bg-white/[0.03] text-white/60 hover:border-white/16 hover:text-white"
                }`}
              >
                {filter.label}
                <span className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] text-inherit">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {filteredWidgets.map((widget) => {
          const sectionMeta = SECTION_META[widget.sectionKey];
          const Icon = sectionMeta.icon;
          const approved = isWidgetApproved(widget.key);
          const statusLabel = !widget.implemented
            ? "Roadmap"
            : !approved
              ? "Approval"
              : widget.liveKey !== null
                ? "Live"
                : "Ready";

          return (
            <Link
              key={widget.key}
              href={buildOrganizerWidgetDetailPath(widget.key)}
              className={`group rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_0_24px_rgba(15,23,42,0.35)] transition ${sectionMeta.cardGlowClassName}`}
            >
              <div className="flex h-full flex-col justify-between gap-6">
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className={`rounded-2xl border p-3 ${sectionMeta.badgeClassName}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <span
                      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] ${
                        !widget.implemented
                          ? "border-white/10 bg-white/[0.03] text-white/45"
                          : !approved
                            ? "border-amber-400/20 bg-amber-500/10 text-amber-200"
                            : widget.liveKey !== null
                              ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
                              : "border-cyan-400/20 bg-cyan-500/10 text-cyan-200"
                      }`}
                    >
                      {statusLabel}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${sectionMeta.badgeClassName}`}
                      >
                        {widget.sectionTitle}
                      </span>
                      <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/55">
                        {widget.liveKey !== null ? "Live route" : "Organizer route"}
                      </span>
                    </div>
                    <h3 className="text-lg font-semibold text-white">{widget.title}</h3>
                    <p className="text-sm leading-6 text-white/55">{widget.description}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-white/8 pt-4 text-sm text-white/70">
                  <span>{widget.implemented ? "Open setup" : "View details"}</span>
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </div>
              </div>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
