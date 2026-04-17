"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowUpDown,
  CalendarDays,
  FileStack,
  Plus,
  Radio,
  RotateCcw,
  Search,
  Trophy,
  Users,
} from "lucide-react";
import { apiFetch, ensureApiUrl } from "@/lib/api";
import ConfirmDeleteModal from "@/components/common/ConfirmDeleteModal";

type Tournament = {
  id: string;
  name: string;
  status: string;
  liveState?: string | null;
  createdAt?: string;
  deletedAt?: string | null;
  stagesCount?: number | null;
  groupsCount?: number | null;
  matchesCount?: number | null;
  teamsCount?: number | null;
  logoUrl?: string | null;
};

type TournamentStatusKey = "live" | "finished" | "draft";
type TournamentFilter = "all" | TournamentStatusKey;
type TournamentSort = "live-first" | "newest" | "name" | "teams" | "matches";
type TournamentView = "current" | "deleted";
type PendingTournamentAction =
  | { type: "delete"; tournament: Tournament }
  | { type: "restore"; tournament: Tournament }
  | null;

const FALLBACK_LOGO = "/assets/defaults/default-team.png";
const TOURNAMENT_VIEW_OPTIONS: Array<{ key: TournamentView; label: string }> = [
  { key: "current", label: "Current" },
  { key: "deleted", label: "Deleted" },
];

function getTournamentStatus(tournament: Tournament) {
  const liveState = tournament.liveState?.toUpperCase?.() ?? "";
  const status = tournament.status?.toUpperCase?.() ?? "";
  const value = liveState || status;

  if (["LIVE", "ONGOING", "ACTIVE"].includes(value)) {
    return {
      key: "live" as const,
      label: "Live",
      className: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
      surfaceClassName:
        "border-emerald-400/20 bg-emerald-500/[0.05] shadow-[0_0_0_1px_rgba(16,185,129,0.06)]",
      sortRank: 0,
    };
  }

  if (["FINISHED", "COMPLETED", "ENDED", "ARCHIVED"].includes(value)) {
    return {
      key: "finished" as const,
      label: "Finished",
      className: "border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-200",
      surfaceClassName:
        "border-fuchsia-400/15 bg-fuchsia-500/[0.04] shadow-[0_0_0_1px_rgba(217,70,239,0.04)]",
      sortRank: 2,
    };
  }

  return {
    key: "draft" as const,
    label: "Draft",
    className: "border-white/15 bg-white/10 text-white/75",
    surfaceClassName:
      "border-white/10 bg-white/[0.03] shadow-[0_0_0_1px_rgba(255,255,255,0.03)]",
    sortRank: 1,
  };
}

const formatDate = (value?: string) => {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const toTimestamp = (value?: string) => {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const formatCount = (value?: number | null) => {
  if (value === null || value === undefined) return "--";
  return String(value);
};

const STATUS_FILTERS: Array<{ key: TournamentFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "live", label: "Live" },
  { key: "draft", label: "Draft" },
  { key: "finished", label: "Finished" },
];

const SORT_OPTIONS: Array<{ key: TournamentSort; label: string }> = [
  { key: "live-first", label: "Live first" },
  { key: "newest", label: "Newest" },
  { key: "name", label: "Name" },
  { key: "teams", label: "Teams" },
  { key: "matches", label: "Matches" },
];

async function fetchTournaments(view: TournamentView): Promise<Tournament[]> {
  const query = view === "deleted" ? "?deleted=true" : "";
  const res = await apiFetch(`/organizer/tournaments${query}`, { cache: "no-store" });
  const json = await res.json();
  if (Array.isArray(json?.tournaments)) return json.tournaments as Tournament[];
  if (Array.isArray(json?.data)) return json.data as Tournament[];
  if (Array.isArray(json)) return json as Tournament[];
  return [];
}

function useTournaments(view: TournamentView) {
  return useQuery({
    queryKey: ["tournaments", view],
    queryFn: () => fetchTournaments(view),
  });
}

function TournamentsList() {
  const router = useRouter();
  const qc = useQueryClient();
  const [view, setView] = useState<TournamentView>("current");
  const { data: tournaments = [], isLoading } = useTournaments(view);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<TournamentFilter>("all");
  const [sort, setSort] = useState<TournamentSort>("live-first");
  const [pendingAction, setPendingAction] = useState<PendingTournamentAction>(null);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/me/tournaments/${id}`, {
        method: "DELETE",
        body: JSON.stringify({ confirm: "DELETE TOURNAMENT" }),
      });
    },
    onSuccess: async () => {
      setPendingAction(null);
      await qc.invalidateQueries({ queryKey: ["tournaments"] });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/organizer/tournaments/${id}/restore`, {
        method: "POST",
      });
    },
    onSuccess: async () => {
      setPendingAction(null);
      await qc.invalidateQueries({ queryKey: ["tournaments"] });
    },
  });

  const tournamentsWithMeta = useMemo(
    () =>
      tournaments.map((tournament) => ({
        tournament,
        status: getTournamentStatus(tournament),
        searchValue: [
          tournament.name,
          tournament.status,
          tournament.liveState,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      })),
    [tournaments],
  );

  const summary = useMemo(
    () =>
      tournamentsWithMeta.reduce(
        (acc, item) => {
          acc.all += 1;
          acc[item.status.key] += 1;
          acc.totalTeams += item.tournament.teamsCount ?? 0;
          acc.totalMatches += item.tournament.matchesCount ?? 0;
          return acc;
        },
        {
          all: 0,
          live: 0,
          draft: 0,
          finished: 0,
          totalTeams: 0,
          totalMatches: 0,
        },
      ),
    [tournamentsWithMeta],
  );

  const visibleTournaments = useMemo(() => {
    const query = search.trim().toLowerCase();

    return tournamentsWithMeta
      .filter((item) => {
        if (filter !== "all" && item.status.key !== filter) {
          return false;
        }
        if (query && !item.searchValue.includes(query)) {
          return false;
        }
        return true;
      })
      .slice()
      .sort((left, right) => {
        const leftCreatedAt = toTimestamp(
          view === "deleted"
            ? left.tournament.deletedAt ?? left.tournament.createdAt
            : left.tournament.createdAt,
        );
        const rightCreatedAt = toTimestamp(
          view === "deleted"
            ? right.tournament.deletedAt ?? right.tournament.createdAt
            : right.tournament.createdAt,
        );
        const leftTeams = left.tournament.teamsCount ?? 0;
        const rightTeams = right.tournament.teamsCount ?? 0;
        const leftMatches = left.tournament.matchesCount ?? 0;
        const rightMatches = right.tournament.matchesCount ?? 0;

        switch (sort) {
          case "name":
            return left.tournament.name.localeCompare(right.tournament.name);
          case "teams":
            if (rightTeams !== leftTeams) return rightTeams - leftTeams;
            break;
          case "matches":
            if (rightMatches !== leftMatches) return rightMatches - leftMatches;
            break;
          case "newest":
            if (rightCreatedAt !== leftCreatedAt) return rightCreatedAt - leftCreatedAt;
            break;
          case "live-first":
          default:
            if (left.status.sortRank !== right.status.sortRank) {
              return left.status.sortRank - right.status.sortRank;
            }
            if (rightCreatedAt !== leftCreatedAt) return rightCreatedAt - leftCreatedAt;
            break;
        }

        return left.tournament.name.localeCompare(right.tournament.name);
      });
  }, [filter, search, sort, tournamentsWithMeta, view]);

  const defaultSort = view === "deleted" ? "newest" : "live-first";
  const hasActiveFilters = filter !== "all" || search.trim().length > 0 || sort !== defaultSort;

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/organizer");
  };

  const confirmTournamentAction = async () => {
    if (!pendingAction) return;
    if (pendingAction.type === "restore") {
      await restoreMutation.mutateAsync(pendingAction.tournament.id);
      return;
    }
    await deleteMutation.mutateAsync(pendingAction.tournament.id);
  };

  return (
    <div className="mx-auto max-w-[1440px] px-8 py-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200">
            Operations View
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">Tournaments</h1>
            <p className="mt-1 text-sm text-white/60">
              Manage tournaments, monitor structure, and jump into active operations.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-slate-950/65 px-5 py-3 text-sm font-medium text-cyan-50/90 transition hover:border-cyan-300/40 hover:bg-cyan-500/10 hover:text-white"
          >
            &larr; Back
          </button>
          <Link
            href="/organizer/tournaments/create"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-950/40 transition hover:brightness-110"
          >
            <Plus className="h-4 w-4" />
            Create Tournament
          </Link>
        </div>
      </div>

      <div className="space-y-6">
        <section className="rounded-2xl border border-white/10 bg-[#10151d] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.24)]">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <SummaryCard
              label="All"
              value={String(summary.all)}
              note="total tournaments"
              accent="text-white"
              icon={Trophy}
              active={filter === "all"}
              onClick={() => setFilter("all")}
            />
            <SummaryCard
              label="Live"
              value={String(summary.live)}
              note="active now"
              accent="text-emerald-200"
              icon={Radio}
              active={filter === "live"}
              onClick={() => setFilter("live")}
            />
            <SummaryCard
              label="Draft"
              value={String(summary.draft)}
              note="not started"
              accent="text-white/80"
              icon={FileStack}
              active={filter === "draft"}
              onClick={() => setFilter("draft")}
            />
            <SummaryCard
              label="Finished"
              value={String(summary.finished)}
              note="completed"
              accent="text-fuchsia-200"
              icon={CalendarDays}
              active={filter === "finished"}
              onClick={() => setFilter("finished")}
            />
            <SummaryCard
              label="Teams"
              value={String(summary.totalTeams)}
              note="tracked across all"
              accent="text-cyan-200"
              icon={Users}
            />
            <SummaryCard
              label="Matches"
              value={String(summary.totalMatches)}
              note="scheduled total"
              accent="text-blue-200"
              icon={ArrowUpDown}
            />
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#10151d] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.24)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-1 flex-col gap-4 lg:flex-row">
              <div className="inline-flex w-fit rounded-xl border border-white/10 bg-slate-950/60 p-1">
                {TOURNAMENT_VIEW_OPTIONS.map((option) => {
                  const active = view === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => {
                        setView(option.key);
                        setFilter("all");
                        setSort(option.key === "deleted" ? "newest" : "live-first");
                      }}
                      className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                        active
                          ? "bg-white/10 text-white"
                          : "text-white/55 hover:text-white"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>

              <label className="relative flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search tournaments by name or state"
                  className="w-full rounded-xl border border-white/10 bg-slate-950/70 py-3 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-cyan-300/35"
                />
              </label>

              <div className="flex flex-wrap gap-2">
                {STATUS_FILTERS.map((statusOption) => {
                  const active = filter === statusOption.key;

                  return (
                    <button
                      key={statusOption.key}
                      type="button"
                      onClick={() => setFilter(statusOption.key)}
                      className={`rounded-full border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] transition ${
                        active
                          ? "border-cyan-300/24 bg-cyan-500/12 text-cyan-200"
                          : "border-white/10 bg-white/[0.03] text-white/60 hover:border-white/16 hover:text-white"
                      }`}
                    >
                      {statusOption.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2.5 text-sm text-white/70">
                <ArrowUpDown className="h-4 w-4 text-white/40" />
                <span className="text-white/45">Sort</span>
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as TournamentSort)}
                  className="bg-transparent text-sm font-medium text-white outline-none"
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key} className="bg-slate-950">
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setFilter("all");
                    setSort(defaultSort);
                  }}
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-white/70 transition hover:border-white/16 hover:text-white"
                >
                  Reset
                </button>
              ) : null}
            </div>
          </div>
        </section>

        {isLoading ? (
          <LoadingState />
        ) : visibleTournaments.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 px-6 py-16 text-center">
            <div className="text-xl font-semibold text-white">
              {tournaments.length === 0
                ? view === "deleted"
                  ? "No deleted tournaments"
                  : "No tournaments created"
                : "No tournaments match this view"}
            </div>
            <p className="mt-2 text-sm text-white/55">
              {tournaments.length === 0
                ? view === "deleted"
                  ? "Deleted tournaments will appear here until they are restored."
                  : "Create your first tournament to start organizing stages, groups, matches, and team operations from one place."
                : "Try a different search, filter, or sort."}
            </p>
            {tournaments.length === 0 && view === "current" ? (
              <Link
                href="/organizer/tournaments/create"
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-950/25 transition hover:brightness-110"
              >
                <Plus className="h-4 w-4" />
                Create Tournament
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setFilter("all");
                  setSort(defaultSort);
                }}
                className="mt-5 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white/75 transition hover:border-white/16 hover:text-white"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="hidden xl:block">
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#10151d] shadow-[0_18px_50px_rgba(0,0,0,0.24)]">
                <div className="grid grid-cols-[minmax(0,2.2fr)_120px_92px_92px_92px_92px_132px_250px] gap-4 border-b border-white/8 px-5 py-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">
                  <div>Tournament</div>
                  <div>Status</div>
                  <div>Teams</div>
                  <div>Matches</div>
                  <div>Stages</div>
                  <div>Groups</div>
                  <div>{view === "deleted" ? "Deleted" : "Created"}</div>
                  <div className="text-right">Actions</div>
                </div>

                <div className="divide-y divide-white/6">
                  {visibleTournaments.map(({ tournament, status }) => {
                    const logo = ensureApiUrl(tournament.logoUrl) ?? FALLBACK_LOGO;

                    return (
                      <div
                        key={tournament.id}
                        className={`grid grid-cols-[minmax(0,2.2fr)_120px_92px_92px_92px_92px_132px_250px] items-center gap-4 px-5 py-4 transition hover:bg-white/[0.03] ${status.surfaceClassName}`}
                      >
                        <div className="flex min-w-0 items-center gap-4">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={logo}
                            alt={tournament.name || "Tournament logo"}
                            className="h-11 w-11 rounded-xl border border-white/10 bg-white/5 object-cover"
                          />
                          <div className="min-w-0">
                            <div className="truncate text-base font-semibold text-white">
                              {tournament.name}
                            </div>
                            <div className="mt-1 truncate text-xs uppercase tracking-[0.2em] text-white/42">
                              {tournament.liveState || tournament.status || "No state"}
                            </div>
                          </div>
                        </div>

                        <div>
                          <div className="flex flex-wrap gap-2">
                            <span
                              className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${status.className}`}
                            >
                              {status.label}
                            </span>
                            {view === "deleted" ? <DeletedBadge /> : null}
                          </div>
                        </div>
                        <DataCell value={formatCount(tournament.teamsCount)} />
                        <DataCell value={formatCount(tournament.matchesCount)} />
                        <DataCell value={formatCount(tournament.stagesCount)} />
                        <DataCell value={formatCount(tournament.groupsCount)} />
                        <div className="text-sm text-white/70">
                          <div className="font-medium text-white">
                            {formatDate(
                              view === "deleted"
                                ? tournament.deletedAt ?? tournament.createdAt
                                : tournament.createdAt,
                            )}
                          </div>
                          <div className="mt-1 text-xs uppercase tracking-[0.2em] text-white/40">
                            {view === "deleted" ? "Deleted" : "Created"}
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2">
                          {view === "deleted" ? (
                            <button
                              type="button"
                              onClick={() => setPendingAction({ type: "restore", tournament })}
                              disabled={
                                restoreMutation.isPending &&
                                pendingAction?.type === "restore" &&
                                pendingAction.tournament.id === tournament.id
                              }
                              className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3.5 py-2 text-sm font-semibold text-emerald-100 transition hover:border-emerald-500/30 hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <RotateCcw className="h-4 w-4" />
                              {restoreMutation.isPending &&
                              pendingAction?.type === "restore" &&
                              pendingAction.tournament.id === tournament.id
                                ? "Restoring..."
                                : "Restore"}
                            </button>
                          ) : (
                            <>
                              <Link
                                href={`/organizer/tournaments/${tournament.id}`}
                                className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-950/25 transition hover:brightness-110"
                              >
                                Open
                              </Link>
                              <Link
                                href={`/organizer/tournaments/${tournament.id}/edit`}
                                className="inline-flex items-center justify-center rounded-lg border border-white/12 bg-white/[0.05] px-3.5 py-2 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                              >
                                Edit
                              </Link>
                              <button
                                type="button"
                                onClick={() => setPendingAction({ type: "delete", tournament })}
                                disabled={
                                  deleteMutation.isPending &&
                                  pendingAction?.type === "delete" &&
                                  pendingAction.tournament.id === tournament.id
                                }
                                className="inline-flex items-center justify-center rounded-lg border border-rose-500/20 bg-rose-500/10 px-3.5 py-2 text-sm font-semibold text-rose-100 transition hover:border-rose-500/30 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {deleteMutation.isPending &&
                                pendingAction?.type === "delete" &&
                                pendingAction.tournament.id === tournament.id
                                  ? "Deleting..."
                                  : "Delete"}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:hidden">
              {visibleTournaments.map(({ tournament, status }) => {
                const logo = ensureApiUrl(tournament.logoUrl) ?? FALLBACK_LOGO;

                return (
                  <article
                    key={tournament.id}
                    className={`rounded-2xl border p-5 shadow-[0_18px_50px_rgba(0,0,0,0.24)] ${status.surfaceClassName}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex min-w-0 items-start gap-4">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={logo}
                          alt={tournament.name || "Tournament logo"}
                          className="h-12 w-12 rounded-xl border border-white/10 bg-white/5 object-cover"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-lg font-semibold text-white">
                            {tournament.name}
                          </div>
                          <div className="mt-1 text-xs uppercase tracking-[0.2em] text-white/42">
                            {tournament.liveState || tournament.status || "No state"}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap justify-end gap-2">
                        <span
                          className={`inline-flex shrink-0 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${status.className}`}
                        >
                          {status.label}
                        </span>
                        {view === "deleted" ? <DeletedBadge /> : null}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                      <StatBadge label="Teams" value={formatCount(tournament.teamsCount)} />
                      <StatBadge label="Matches" value={formatCount(tournament.matchesCount)} />
                      <StatBadge label="Stages" value={formatCount(tournament.stagesCount)} />
                      <StatBadge label="Groups" value={formatCount(tournament.groupsCount)} />
                      <StatBadge
                        label={view === "deleted" ? "Deleted" : "Created"}
                        value={formatDate(
                          view === "deleted"
                            ? tournament.deletedAt ?? tournament.createdAt
                            : tournament.createdAt,
                        )}
                      />
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2 border-t border-white/10 pt-4">
                      {view === "deleted" ? (
                        <button
                          type="button"
                          onClick={() => setPendingAction({ type: "restore", tournament })}
                          disabled={
                            restoreMutation.isPending &&
                            pendingAction?.type === "restore" &&
                            pendingAction.tournament.id === tournament.id
                          }
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-100 transition hover:border-emerald-500/30 hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <RotateCcw className="h-4 w-4" />
                          {restoreMutation.isPending &&
                          pendingAction?.type === "restore" &&
                          pendingAction.tournament.id === tournament.id
                            ? "Restoring..."
                            : "Restore Tournament"}
                        </button>
                      ) : (
                        <>
                          <Link
                            href={`/organizer/tournaments/${tournament.id}`}
                            className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-950/25 transition hover:brightness-110"
                          >
                            Open Tournament
                          </Link>
                          <Link
                            href={`/organizer/tournaments/${tournament.id}/edit`}
                            className="inline-flex items-center justify-center rounded-xl border border-white/12 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                          >
                            Edit
                          </Link>
                          <button
                            type="button"
                            onClick={() => setPendingAction({ type: "delete", tournament })}
                            disabled={
                              deleteMutation.isPending &&
                              pendingAction?.type === "delete" &&
                              pendingAction.tournament.id === tournament.id
                            }
                            className="inline-flex items-center justify-center rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-100 transition hover:border-rose-500/30 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {deleteMutation.isPending &&
                            pendingAction?.type === "delete" &&
                            pendingAction.tournament.id === tournament.id
                              ? "Deleting..."
                              : "Delete"}
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </div>

      <ConfirmDeleteModal
        open={pendingAction !== null}
        title={
          pendingAction?.type === "restore"
            ? "Restore tournament?"
            : "Delete tournament?"
        }
        description={
          pendingAction
            ? pendingAction.type === "restore"
              ? `This will restore ${pendingAction.tournament.name} back to your active tournaments list.`
              : `This will soft-delete ${pendingAction.tournament.name} from your organizer workspace.`
            : ""
        }
        loading={deleteMutation.isPending || restoreMutation.isPending}
        onClose={() => {
          if (!deleteMutation.isPending && !restoreMutation.isPending) {
            setPendingAction(null);
          }
        }}
        onConfirm={confirmTournamentAction}
        confirmLabel={
          pendingAction?.type === "restore" ? "Restore Tournament" : "Delete Tournament"
        }
        loadingLabel={
          pendingAction?.type === "restore" ? "Restoring..." : "Deleting..."
        }
        tone={pendingAction?.type === "restore" ? "success" : "danger"}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  note,
  icon: Icon,
  accent,
  active = false,
  onClick,
}: {
  label: string;
  value: string;
  note: string;
  icon: typeof Trophy;
  accent: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/40">
          {label}
        </div>
        <Icon className={`h-4 w-4 ${accent}`} />
      </div>
      <div className={`mt-3 text-3xl font-semibold ${accent}`}>{value}</div>
      <div className="mt-1 text-xs text-white/50">{note}</div>
    </>
  );

  if (!onClick) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-4 py-4 text-left transition ${
        active
          ? "border-cyan-300/24 bg-cyan-500/10"
          : "border-white/10 bg-white/[0.04] hover:border-white/16 hover:bg-white/[0.06]"
      }`}
    >
      {content}
    </button>
  );
}

function DataCell({ value }: { value: string }) {
  return <div className="text-sm font-medium text-white/80">{value}</div>;
}

function StatBadge({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/75">
      {label}: {value}
    </span>
  );
}

function DeletedBadge() {
  return (
    <span className="inline-flex rounded-full border border-rose-500/20 bg-rose-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-rose-100">
      Deleted
    </span>
  );
}

function LoadingState() {
  return (
    <>
      <div className="hidden xl:block">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#10151d]">
          <div className="grid grid-cols-[minmax(0,2.2fr)_120px_92px_92px_92px_92px_132px_250px] gap-4 border-b border-white/8 px-5 py-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">
            <div>Tournament</div>
            <div>Status</div>
            <div>Teams</div>
            <div>Matches</div>
            <div>Stages</div>
            <div>Groups</div>
            <div>Created</div>
            <div className="text-right">Actions</div>
          </div>
          <div className="divide-y divide-white/6">
            {[1, 2, 3, 4].map((item) => (
              <div
                key={item}
                className="grid grid-cols-[minmax(0,2.2fr)_120px_92px_92px_92px_92px_132px_250px] items-center gap-4 px-5 py-4"
              >
                <div className="flex items-center gap-4">
                  <div className="h-11 w-11 rounded-xl bg-white/10" />
                  <div className="space-y-2">
                    <div className="h-4 w-40 rounded bg-white/10" />
                    <div className="h-3 w-24 rounded bg-white/10" />
                  </div>
                </div>
                <div className="h-8 w-20 rounded-full bg-white/10" />
                <div className="h-4 w-8 rounded bg-white/10" />
                <div className="h-4 w-8 rounded bg-white/10" />
                <div className="h-4 w-8 rounded bg-white/10" />
                <div className="h-4 w-8 rounded bg-white/10" />
                <div className="h-4 w-24 rounded bg-white/10" />
                <div className="ml-auto flex gap-2">
                  <div className="h-9 w-16 rounded-lg bg-white/10" />
                  <div className="h-9 w-16 rounded-lg bg-white/10" />
                  <div className="h-9 w-20 rounded-lg bg-white/10" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:hidden">
        {[1, 2, 3].map((item) => (
          <div key={item} className="rounded-2xl border border-white/10 bg-[#10151d] p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="h-12 w-12 rounded-xl bg-white/10" />
                <div className="space-y-2">
                  <div className="h-5 w-40 rounded bg-white/10" />
                  <div className="h-3 w-24 rounded bg-white/10" />
                </div>
              </div>
              <div className="h-8 w-20 rounded-full bg-white/10" />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5].map((badge) => (
                <div key={badge} className="h-8 w-24 rounded-full bg-white/10" />
              ))}
            </div>
            <div className="mt-5 flex gap-2 border-t border-white/10 pt-4">
              <div className="h-10 w-36 rounded-xl bg-white/10" />
              <div className="h-10 w-20 rounded-xl bg-white/10" />
              <div className="h-10 w-24 rounded-xl bg-white/10" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export default function OrganizerTournamentsPage() {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <TournamentsList />
    </QueryClientProvider>
  );
}
