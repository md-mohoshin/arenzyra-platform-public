"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

type MatchRow = {
  id: string;
  matchNumber?: number | null;
  map?: string | null;
  status?: string | null;
  liveState?: string | null;
  group?: {
    id?: string;
    name?: string | null;
  } | null;
  groupName?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  createdAt?: string | null;
  controlState?: {
    state?: string | null;
  } | null;
};

type StatusFilter = "all" | "draft" | "live" | "ended";

const FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "live", label: "Live" },
  { key: "ended", label: "Ended" },
];

function normalizeStatus(match: MatchRow) {
  const controlKey = (match.controlState?.state ?? "").toUpperCase();
  const liveKey = (match.liveState ?? "").toUpperCase();
  const statusKey = (match.status ?? "").toUpperCase();

  if (controlKey === "LOCKED" || statusKey === "LOCKED") {
    return "LOCKED";
  }

  if (
    ["LIVE", "ACTIVE", "ONGOING"].includes(liveKey) ||
    ["LIVE", "ACTIVE", "ONGOING"].includes(statusKey)
  ) {
    return "LIVE";
  }

  if (
    ["ENDED", "FINISHED", "COMPLETED", "ARCHIVED"].includes(liveKey) ||
    ["ENDED", "FINISHED", "COMPLETED", "ARCHIVED"].includes(statusKey)
  ) {
    return "ENDED";
  }

  if (statusKey === "DRAFT") {
    return "DRAFT";
  }

  return statusKey || "DRAFT";
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "LIVE":
      return "border-green-500/20 bg-green-500/20 text-green-400";
    case "ENDED":
      return "border-blue-500/20 bg-blue-500/20 text-blue-400";
    case "LOCKED":
      return "border-red-500/20 bg-red-500/20 text-red-400";
    case "DRAFT":
    default:
      return "border-gray-500/15 bg-gray-500/15 text-gray-300";
  }
}

function formatMatchTime(match: MatchRow) {
  const value = match.startedAt ?? match.endedAt ?? match.createdAt ?? null;
  if (!value) return "--";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function groupLabel(match: MatchRow) {
  return match.group?.name ?? match.groupName ?? "--";
}

function MatchesPageInner() {
  const params = useParams<{ id: string }>();
  const tournamentId = params?.id;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const {
    data: matches = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["tournamentMatches", tournamentId],
    enabled: !!tournamentId,
    queryFn: async () => {
      const res = await apiFetch(`/me/tournaments/${tournamentId}/matches`, {
        cache: "no-store",
      });
      const json = (await res.json()) as
        | MatchRow[]
        | { matches?: MatchRow[]; data?: MatchRow[] };
      if (Array.isArray(json)) return json;
      if (Array.isArray(json?.matches)) return json.matches;
      if (Array.isArray(json?.data)) return json.data;
      return [];
    },
  });

  const visibleMatches = useMemo(() => {
    const sorted = [...matches].sort((a, b) => {
      const aNumber = a.matchNumber ?? Number.MAX_SAFE_INTEGER;
      const bNumber = b.matchNumber ?? Number.MAX_SAFE_INTEGER;

      if (aNumber !== bNumber) return aNumber - bNumber;

      return groupLabel(a).localeCompare(groupLabel(b));
    });

    if (statusFilter === "all") return sorted;

    return sorted.filter(
      (match) => normalizeStatus(match).toLowerCase() === statusFilter,
    );
  }, [matches, statusFilter]);

  const headerStatus = isLoading
    ? "Loading matches..."
    : isError
      ? (error as Error)?.message ?? "Failed to load matches"
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-white">Matches</h1>
          <p className="text-sm text-white/60">
            View and operate tournament matches. New matches are still created from a
            specific group.
          </p>
        </div>
        {tournamentId ? (
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/organizer/tournaments/${tournamentId}/stages`}
              className="rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-950/30 transition hover:opacity-95"
            >
              Create Match
            </Link>
            <Link
              href={`/organizer/tournaments/${tournamentId}/stages`}
              className="rounded-lg border border-white/20 px-4 py-2.5 text-sm font-semibold text-white shadow hover:border-white/40 hover:text-white"
            >
              Go to Stages &amp; Groups
            </Link>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-3 rounded-xl border border-white/10 bg-slate-900/50 p-3">
        {FILTERS.map((filter) => {
          const active = statusFilter === filter.key;
          return (
            <button
              key={filter.key}
              type="button"
              onClick={() => setStatusFilter(filter.key)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                active
                  ? "bg-white/10 text-white ring-1 ring-cyan-400/40"
                  : "text-white/65 ring-1 ring-white/10 hover:bg-white/5 hover:text-white"
              }`}
            >
              {filter.label}
            </button>
          );
        })}
      </div>

      {headerStatus ? (
        <SkeletonTable message={headerStatus} />
      ) : matches.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/5 px-6 py-10 text-center text-white/70">
          No matches yet. Create matches from the Stages &amp; Groups pages.
        </div>
      ) : visibleMatches.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/5 px-6 py-10 text-center text-white/70">
          No matches in this filter.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-slate-900/70 shadow-lg">
          <table className="min-w-full divide-y divide-white/10">
            <thead className="bg-white/5 text-left text-xs uppercase tracking-[0.2em] text-white/55">
              <tr>
                <th className="px-5 py-3.5">Match #</th>
                <th className="px-5 py-3.5">Group</th>
                <th className="px-5 py-3.5">Map</th>
                <th className="px-5 py-3.5">Time</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10 text-sm text-white/90">
              {visibleMatches.map((match) => {
                const status = normalizeStatus(match);

                return (
                  <tr key={match.id} className="hover:bg-white/5">
                    <td className="px-5 py-3.5 font-semibold text-white">
                      {match.matchNumber ?? "--"}
                    </td>
                    <td className="px-5 py-3.5 text-white/80">{groupLabel(match)}</td>
                    <td className="px-5 py-3.5 text-white/65">{match.map ?? "--"}</td>
                    <td className="px-5 py-3.5 text-white/65">
                      {formatMatchTime(match)}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${statusBadgeClass(
                          status,
                        )}`}
                      >
                        {status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex justify-end">
                        <Link
                          href={`/organizer/matches/${match.id}/control`}
                          className="rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-2 text-xs font-medium text-white shadow-lg shadow-cyan-500/20 transition hover:from-cyan-400 hover:to-blue-400"
                        >
                          Open Match Control
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SkeletonTable({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
      <div className="mb-3 text-sm text-white/60">{message}</div>
      <div className="space-y-2">
        {[1, 2, 3].map((row) => (
          <div
            key={row}
            className="grid grid-cols-[0.8fr_1.1fr_0.8fr_1fr_0.8fr_1fr] items-center gap-4 rounded-lg bg-white/5 px-5 py-3.5"
          >
            <div className="h-3 w-16 animate-pulse rounded bg-white/10" />
            <div className="h-3 w-24 animate-pulse rounded bg-white/10" />
            <div className="h-3 w-20 animate-pulse rounded bg-white/10" />
            <div className="h-3 w-28 animate-pulse rounded bg-white/10" />
            <div className="h-8 w-20 animate-pulse rounded bg-white/10" />
            <div className="h-8 w-32 animate-pulse rounded bg-white/10 justify-self-end" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MatchesPage() {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <MatchesPageInner />
    </QueryClientProvider>
  );
}
