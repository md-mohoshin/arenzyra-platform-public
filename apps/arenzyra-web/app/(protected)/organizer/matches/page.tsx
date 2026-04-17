"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Clock3, SquarePlay } from "lucide-react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import {
  fetchMatchControlSnapshotMap,
  getControlRuntimeBadge,
  type MatchRuntimeControlSnapshot,
} from "@/features/matches/match-control-runtime";

type MatchRow = {
  id: string;
  matchNumber: number | null;
  map?: string | null;
  status: string | null;
  liveState?: string | null;
  stageName?: string | null;
  groupName?: string | null;
  control?: MatchRuntimeControlSnapshot | null;
};

type MatchSection = {
  stageName: string;
  groupName: string;
  rows: MatchRow[];
};

const statusTone = (state?: string | null) => {
  const key = state?.toUpperCase?.() ?? "";
  if (key === "LIVE") return "border-emerald-400/40 bg-emerald-500/20 text-emerald-100";
  if (key === "FINALIZING") return "border-amber-400/40 bg-amber-500/20 text-amber-100";
  if (key === "FINALIZED") return "border-blue-400/40 bg-blue-500/20 text-blue-100";
  if (key === "PAUSED" || key === "COUNTDOWN") {
    return "border-violet-400/40 bg-violet-500/20 text-violet-100";
  }
  if (key === "UPCOMING" || key === "DRAFT") {
    return "border-white/15 bg-white/10 text-white/70";
  }
  return "border-amber-400/40 bg-amber-500/15 text-amber-100";
};

const displayMatchStatus = (control?: MatchRuntimeControlSnapshot | null) => {
  return getControlRuntimeBadge(control);
};

const mapTone = (map?: string | null) => {
  const key = (map ?? "").toUpperCase();
  switch (key) {
    case "ERANGEL":
      return "border-emerald-400/30 bg-emerald-500/15 text-emerald-100";
    case "MIRAMAR":
      return "border-amber-400/30 bg-amber-500/15 text-amber-100";
    case "DESTON":
      return "border-cyan-400/30 bg-cyan-500/15 text-cyan-100";
    case "RONDO":
      return "border-violet-400/30 bg-violet-500/15 text-violet-100";
    case "SANHOK":
      return "border-lime-400/30 bg-lime-500/15 text-lime-100";
    case "VIKENDI":
      return "border-sky-400/30 bg-sky-500/15 text-sky-100";
    case "TAEGO":
      return "border-rose-400/30 bg-rose-500/15 text-rose-100";
    default:
      return "border-white/15 bg-white/10 text-white/75";
  }
};

const statusMeta = (control?: MatchRuntimeControlSnapshot | null) => {
  const normalized = displayMatchStatus(control);

  if (normalized === "LIVE") {
    return { label: "LIVE", className: statusTone(normalized), Icon: null };
  }

  if (normalized === "FINALIZED") {
    return { label: "FINALIZED", className: statusTone(normalized), Icon: Check };
  }

  if (normalized === "FINALIZING") {
    return { label: "FINALIZING", className: statusTone(normalized), Icon: null };
  }

  return {
    label: normalized,
    className: statusTone(normalized),
    Icon: Clock3,
  };
};

function flattenSections(matches: MatchRow[]): MatchSection[] {
  const grouped = new Map<string, Map<string, MatchRow[]>>();

  matches.forEach((match) => {
    const stageKey = match.stageName ?? "Unassigned Stage";
    const groupKey = match.groupName ?? "Ungrouped";

    if (!grouped.has(stageKey)) grouped.set(stageKey, new Map());
    const stageGroups = grouped.get(stageKey)!;
    if (!stageGroups.has(groupKey)) stageGroups.set(groupKey, []);
    stageGroups.get(groupKey)!.push(match);
  });

  return [...grouped.entries()].flatMap(([stageName, groups]) =>
    [...groups.entries()].map(([groupName, rows]) => ({
      stageName,
      groupName,
      rows: [...rows].sort((left, right) => {
        const leftNumber = left.matchNumber ?? Number.MAX_SAFE_INTEGER;
        const rightNumber = right.matchNumber ?? Number.MAX_SAFE_INTEGER;
        if (leftNumber !== rightNumber) return leftNumber - rightNumber;
        return left.id.localeCompare(right.id);
      }),
    })),
  );
}

function MatchesPageInner() {
  const router = useRouter();
  const {
    data: matches = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["organizerMatches"],
    queryFn: async () => {
      const res = await apiFetch("/organizer/matches", { cache: "no-store" });
      const json = (await res.json()) as MatchRow[] | { data?: MatchRow[]; matches?: MatchRow[] };
      const rows = Array.isArray(json)
        ? json
        : Array.isArray(json?.matches)
          ? json.matches
          : Array.isArray(json?.data)
            ? json.data
            : [];
      const controls = await fetchMatchControlSnapshotMap(
        rows.map((match) => match.id),
      );
      return rows.map((match) => ({
        ...match,
        control: controls[match.id] ?? null,
      }));
    },
  });

  const sections = useMemo(() => flattenSections(matches), [matches]);

  const headline = isLoading
    ? "Loading matches..."
    : isError
      ? (error as Error)?.message ?? "Failed to load matches"
      : null;

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/organizer");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">Matches</h1>
          <p className="text-sm text-white/60">
            Production-facing match list for operators and live control.
          </p>
        </div>
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-slate-950/65 px-5 py-3 text-sm font-medium text-cyan-50/90 transition hover:border-cyan-300/40 hover:bg-cyan-500/10 hover:text-white"
        >
          &larr; Back
        </button>
      </div>

      {headline ? (
        <SkeletonList message={headline} />
      ) : matches.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/5 px-6 py-10 text-center text-white/70">
          No matches found. Create matches from stages / groups, then manage them here.
        </div>
      ) : (
        <div className="space-y-4">
          {sections.map(({ stageName, groupName, rows }) => (
            <div
              key={`${stageName}-${groupName}`}
              className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent p-4 shadow-lg shadow-black/20"
            >
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight text-white">
                    {stageName}
                  </h2>
                  <p className="mt-1 text-sm font-medium text-white/60">
                    {groupName} • {rows.length} {rows.length === 1 ? "Match" : "Matches"}
                  </p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">
                  Control Queue
                </span>
              </div>

              <div className="overflow-hidden rounded-xl border border-white/10 bg-black/35">
                {rows.map((match) => {
                  const normalizedStatus = displayMatchStatus(match.control);
                  const meta = statusMeta(match.control);
                  const isLive = normalizedStatus === "LIVE";
                  const mapName = (match.map ?? "Unknown").toUpperCase();

                  return (
                    <div
                      key={match.id}
                      className={`group grid grid-cols-1 gap-2 border-t border-white/10 px-4 py-2.5 text-sm text-white first:border-t-0 transition duration-200 ease-out sm:grid-cols-[minmax(0,1fr)_120px_120px_120px] sm:items-center sm:gap-3 ${
                        isLive
                          ? "border-l-2 border-l-emerald-400 bg-emerald-500/[0.08] shadow-[0_0_20px_rgba(16,185,129,0.08)] hover:bg-emerald-500/[0.12] hover:shadow-[0_0_24px_rgba(16,185,129,0.14)]"
                          : "border-l-2 border-l-transparent hover:bg-white/5 hover:shadow-[0_0_18px_rgba(14,165,233,0.08)]"
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="shrink-0 rounded-lg border border-cyan-400/25 bg-cyan-500/[0.12] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                          [M{match.matchNumber ?? "--"}]
                        </span>
                        <div className="min-w-0">
                          <div className="font-bold text-white">
                            Match {match.matchNumber ?? "--"}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center sm:justify-start">
                        <span
                          className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${mapTone(
                            mapName,
                          )}`}
                        >
                          {mapName}
                        </span>
                      </div>

                      <div className="flex items-center sm:justify-start">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${meta.className}`}
                        >
                          {isLive ? (
                            <span className="relative flex h-2.5 w-2.5">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
                              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-200" />
                            </span>
                          ) : meta.Icon ? (
                            <meta.Icon className="h-3.5 w-3.5" />
                          ) : null}
                          {meta.label}
                        </span>
                      </div>

                      <div className="flex items-center sm:justify-end">
                        <Link
                          href={`/organizer/matches/${match.id}/control`}
                          className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 transition duration-200 hover:border-cyan-400/40 hover:bg-cyan-500/10 hover:text-cyan-100 group-hover:shadow-sm"
                        >
                          <SquarePlay className="h-3.5 w-3.5" />
                          Control
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SkeletonList({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
      <div className="text-sm text-white/60">{message}</div>
      {[1, 2].map((section) => (
        <div key={section} className="space-y-3 rounded-xl border border-white/10 bg-black/30 p-3">
          <div className="space-y-2">
            <div className="h-5 w-28 rounded bg-white/10" />
            <div className="h-3 w-40 rounded bg-white/10" />
          </div>
          {[1, 2, 3].map((row) => (
            <div
              key={row}
              className="grid grid-cols-1 gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_120px_120px_120px] sm:items-center sm:gap-3"
            >
              <div className="h-7 w-24 rounded bg-white/10" />
              <div className="h-7 w-20 rounded-full bg-white/10" />
              <div className="h-7 w-24 rounded-full bg-white/10" />
              <div className="h-7 w-20 rounded justify-self-start sm:justify-self-end bg-white/10" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function OrganizerMatchesPage() {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <MatchesPageInner />
    </QueryClientProvider>
  );
}
