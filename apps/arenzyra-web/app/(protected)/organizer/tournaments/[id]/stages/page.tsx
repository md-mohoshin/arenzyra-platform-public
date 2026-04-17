"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowUpDown,
  CalendarDays,
  LayoutGrid,
  Plus,
  Search,
  Swords,
  Trophy,
  Users,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import {
  fetchMatchControlSnapshotMap,
  isControlFinalized,
  isControlFinalizing,
  isControlLive,
  type MatchRuntimeControlSnapshot,
} from "@/features/matches/match-control-runtime";

type Stage = {
  id: string;
  name: string;
  order?: number | null;
  createdAt?: string | null;
  maxTeams?: number | null;
  groupCount?: number | null;
  matchCount?: number | null;
  groups?:
    | {
        id: string;
        name?: string | null;
        matchCount?: number | null;
        matches?: { id: string }[] | null;
        _count?: {
          matches?: number | null;
        } | null;
      }[]
    | null;
  teamsCount?: number;
};

type StageTeam = {
  id: string;
  tournamentTeamId?: string | null;
};

type TournamentSummary = {
  id: string;
  name: string;
  status?: string | null;
  liveState?: string | null;
};

type TournamentMatch = {
  id: string;
};

type StageSort = "order" | "name" | "created" | "matches";

const SORT_OPTIONS: Array<{ key: StageSort; label: string }> = [
  { key: "order", label: "Order" },
  { key: "name", label: "Name" },
  { key: "created", label: "Newest" },
  { key: "matches", label: "Matches" },
];

const formatDate = (value?: string | null) => {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const toTimestamp = (value?: string | null) => {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const getGroupsCount = (stage: Stage) =>
  stage.groupCount ?? (Array.isArray(stage.groups) ? stage.groups.length : 0);

const getMatchesCount = (stage: Stage) =>
  stage.matchCount ??
  (Array.isArray(stage.groups)
    ? stage.groups.reduce(
        (sum, group) =>
          sum +
          (group.matchCount ??
            group._count?.matches ??
            group.matches?.length ??
            0),
        0,
      )
    : 0);

const getTeamsCount = (stage: Stage) => stage.teamsCount ?? stage.maxTeams ?? 0;

function getTournamentStatus(
  matchControls: Record<string, MatchRuntimeControlSnapshot>,
) {
  const controls = Object.values(matchControls);

  if (controls.some((control) => isControlLive(control))) {
    return {
      label: "Live",
      className: "border-emerald-400/25 bg-emerald-500/10 text-emerald-200",
    };
  }

  if (controls.some((control) => isControlFinalizing(control))) {
    return {
      label: "Finalizing",
      className: "border-amber-400/25 bg-amber-500/10 text-amber-200",
    };
  }

  if (controls.some((control) => isControlFinalized(control))) {
    return {
      label: "Finalized",
      className: "border-fuchsia-400/25 bg-fuchsia-500/10 text-fuchsia-200",
    };
  }

  return {
    label: "Draft",
    className: "border-white/10 bg-white/5 text-white/70",
  };
}

function SummaryCard({
  label,
  value,
  note,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  note: string;
  icon: typeof Trophy;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#10151d] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.24)]">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/40">
          {label}
        </div>
        <Icon className={`h-4 w-4 ${accent}`} />
      </div>
      <div className={`mt-3 text-3xl font-semibold ${accent}`}>{value}</div>
      <div className="mt-1 text-xs text-white/50">{note}</div>
    </div>
  );
}

function DataCell({ value }: { value: string }) {
  return <div className="text-sm font-medium text-white/80">{value}</div>;
}

function LoadingState() {
  return (
    <>
      <div className="hidden xl:block">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#10151d]">
          <div className="grid grid-cols-[minmax(0,2fr)_88px_88px_88px_88px_132px_240px] gap-4 border-b border-white/8 px-5 py-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">
            <div>Stage</div>
            <div>Order</div>
            <div>Groups</div>
            <div>Matches</div>
            <div>Teams</div>
            <div>Created</div>
            <div className="text-right">Actions</div>
          </div>
          <div className="divide-y divide-white/6">
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className="grid grid-cols-[minmax(0,2fr)_88px_88px_88px_88px_132px_240px] items-center gap-4 px-5 py-4"
              >
                <div className="space-y-2">
                  <div className="h-4 w-40 rounded bg-white/10" />
                  <div className="h-3 w-28 rounded bg-white/10" />
                </div>
                <div className="h-8 w-14 rounded-full bg-white/10" />
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
        {[1, 2].map((item) => (
          <div key={item} className="rounded-2xl border border-white/10 bg-[#10151d] p-5">
            <div className="space-y-2">
              <div className="h-5 w-40 rounded bg-white/10" />
              <div className="h-3 w-28 rounded bg-white/10" />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {[1, 2, 3, 4].map((badge) => (
                <div key={badge} className="h-8 w-24 rounded-full bg-white/10" />
              ))}
            </div>
            <div className="mt-5 flex gap-2 border-t border-white/10 pt-4">
              <div className="h-10 w-32 rounded-xl bg-white/10" />
              <div className="h-10 w-20 rounded-xl bg-white/10" />
              <div className="h-10 w-24 rounded-xl bg-white/10" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function StageModal({
  title,
  description,
  name,
  setName,
  order,
  setOrder,
  busy,
  submitLabel,
  onClose,
  onSubmit,
}: {
  title: string;
  description: string;
  name: string;
  setName: (value: string) => void;
  order: string;
  setOrder: (value: string) => void;
  busy: boolean;
  submitLabel: string;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#10151d] p-6 shadow-2xl shadow-black/50">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            <p className="mt-1 text-sm text-white/55">{description}</p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-white/70 transition hover:border-white/20 hover:text-white"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>
        </div>

        <div className="space-y-4">
          <label className="block space-y-2 text-sm text-white/80">
            <span>Stage Name</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition placeholder:text-white/30 focus:border-cyan-300/35"
              placeholder="e.g. Grand Final"
            />
          </label>

          <label className="block space-y-2 text-sm text-white/80">
            <span>Order</span>
            <input
              type="number"
              value={order}
              onChange={(event) => setOrder(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition placeholder:text-white/30 focus:border-cyan-300/35"
              placeholder="1"
              min={0}
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-white/75 transition hover:border-white/16 hover:text-white"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-950/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy || !name.trim()}
            onClick={onSubmit}
          >
            {busy ? `${submitLabel}...` : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TournamentStagesPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = params?.id;

  const [tournament, setTournament] = useState<TournamentSummary | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [matchControls, setMatchControls] = useState<
    Record<string, MatchRuntimeControlSnapshot>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<StageSort>("order");

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createOrder, setCreateOrder] = useState<string>("");
  const [creating, setCreating] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editingStage, setEditingStage] = useState<Stage | null>(null);
  const [editName, setEditName] = useState("");
  const [editOrder, setEditOrder] = useState<string>("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingStageId, setDeletingStageId] = useState<string | null>(null);

  const refreshStages = useCallback(async () => {
    if (!tournamentId) return;

    setLoading(true);
    setError(null);

    try {
      const [tournamentRes, stagesRes, matchesRes] = await Promise.all([
        apiFetch(`/organizer/tournaments/${tournamentId}`, {
          cache: "no-store",
        }),
        apiFetch(`/organizer/tournaments/${tournamentId}/stages`, {
          cache: "no-store",
        }),
        apiFetch(`/me/tournaments/${tournamentId}/matches`, {
          cache: "no-store",
        }),
      ]);

      if (tournamentRes.ok) {
        const tournamentJson = (await tournamentRes.json()) as TournamentSummary;
        setTournament(tournamentJson);
      }

      const stagesJson = await stagesRes.json();
      const list: Stage[] = Array.isArray(stagesJson?.data)
        ? stagesJson.data
        : Array.isArray(stagesJson)
          ? stagesJson
          : stagesJson?.stages ?? [];
      const matchesJson = await matchesRes.json();
      const matches: TournamentMatch[] = Array.isArray(matchesJson)
        ? matchesJson
        : Array.isArray(matchesJson?.matches)
          ? matchesJson.matches
          : Array.isArray(matchesJson?.data)
            ? matchesJson.data
            : [];
      const nextMatchControls = await fetchMatchControlSnapshotMap(
        matches.map((match) => match.id),
      );

      const teamCounts = Object.fromEntries(
        await Promise.all(
          list.map(async (stage) => {
            try {
              const stageTeamsRes = await apiFetch(`/org/me/stages/${stage.id}/teams`, {
                cache: "no-store",
              });
              const stageTeamsJson = await stageTeamsRes.json();
              const stageTeams: StageTeam[] =
                (stageTeamsJson?.stageTeams as StageTeam[]) ??
                (stageTeamsJson?.data as StageTeam[]) ??
                (Array.isArray(stageTeamsJson) ? (stageTeamsJson as StageTeam[]) : []);
              return [stage.id, stageTeams.length] as const;
            } catch {
              return [stage.id, stage.maxTeams ?? 0] as const;
            }
          }),
        ),
      );

      setMatchControls(nextMatchControls);
      setStages(
        list.map((stage) => ({
          ...stage,
          teamsCount: teamCounts[stage.id] ?? stage.maxTeams ?? 0,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stages");
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    void refreshStages();
  }, [refreshStages]);

  const stageRows = useMemo(
    () =>
      stages.map((stage) => {
        const groupsCount = getGroupsCount(stage);
        const matchesCount = getMatchesCount(stage);
        const teamsCount = getTeamsCount(stage);
        const orderValue = stage.order ?? Number.MAX_SAFE_INTEGER;

        return {
          ...stage,
          groupsCount,
          matchesCount,
          teamsCount,
          orderValue,
          createdTimestamp: toTimestamp(stage.createdAt),
          searchValue: [
            stage.name,
            stage.order?.toString(),
            groupsCount.toString(),
            matchesCount.toString(),
            teamsCount.toString(),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase(),
        };
      }),
    [stages],
  );

  const summary = useMemo(
    () =>
      stageRows.reduce(
        (acc, stage) => {
          acc.stageCount += 1;
          acc.groupCount += stage.groupsCount;
          acc.matchCount += stage.matchesCount;
          acc.teamCount += stage.teamsCount;
          acc.nextOrder = Math.max(acc.nextOrder, (stage.order ?? 0) + 1);
          return acc;
        },
        {
          stageCount: 0,
          groupCount: 0,
          matchCount: 0,
          teamCount: 0,
          nextOrder: 1,
        },
      ),
    [stageRows],
  );

  const visibleStages = useMemo(() => {
    const query = search.trim().toLowerCase();

    return stageRows
      .filter((stage) => !query || stage.searchValue.includes(query))
      .slice()
      .sort((left, right) => {
        switch (sort) {
          case "name":
            return left.name.localeCompare(right.name);
          case "created":
            if (right.createdTimestamp !== left.createdTimestamp) {
              return right.createdTimestamp - left.createdTimestamp;
            }
            break;
          case "matches":
            if (right.matchesCount !== left.matchesCount) {
              return right.matchesCount - left.matchesCount;
            }
            break;
          case "order":
          default:
            if (left.orderValue !== right.orderValue) {
              return left.orderValue - right.orderValue;
            }
            break;
        }

        return left.name.localeCompare(right.name);
      });
  }, [search, sort, stageRows]);

  const hasActiveFilters = search.trim().length > 0 || sort !== "order";
  const tournamentStatus = getTournamentStatus(matchControls);

  const resetCreate = () => {
    setCreateOpen(false);
    setCreateName("");
    setCreateOrder("");
  };

  const resetEdit = () => {
    setEditOpen(false);
    setEditingStage(null);
    setEditName("");
    setEditOrder("");
  };

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-2 sm:px-8">
      <div className="space-y-6">
        <header className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200">
              Tournament Structure
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">Stages</h1>
              <p className="mt-1 max-w-3xl text-sm text-white/60">
                Manage stage order, group structure, and match flow
                {tournament?.name ? ` for ${tournament.name}.` : "."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {tournament?.name ? (
                <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/75">
                  {tournament.name}
                </span>
              ) : null}
              <span
                className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${tournamentStatus.className}`}
              >
                {tournamentStatus.label}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/70">
              Next order: {summary.nextOrder}
            </div>
            <button
              type="button"
              onClick={() => {
                setCreateOrder(String(summary.nextOrder));
                setCreateOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-950/40 transition hover:brightness-110"
            >
              <Plus className="h-4 w-4" />
              Create Stage
            </button>
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="Stages"
            value={String(summary.stageCount)}
            note="tournament structure"
            icon={Trophy}
            accent="text-white"
          />
          <SummaryCard
            label="Groups"
            value={String(summary.groupCount)}
            note="assigned across stages"
            icon={LayoutGrid}
            accent="text-cyan-200"
          />
          <SummaryCard
            label="Matches"
            value={String(summary.matchCount)}
            note="scheduled inside stages"
            icon={Swords}
            accent="text-blue-200"
          />
          <SummaryCard
            label="Teams"
            value={String(summary.teamCount)}
            note="linked to stage pools"
            icon={Users}
            accent="text-emerald-200"
          />
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#10151d] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.24)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-1 flex-col gap-4 lg:flex-row">
              <label className="relative flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search stages by name, order, or counts"
                  className="w-full rounded-xl border border-white/10 bg-slate-950/70 py-3 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-cyan-300/35"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2.5 text-sm text-white/70">
                <ArrowUpDown className="h-4 w-4 text-white/40" />
                <span className="text-white/45">Sort</span>
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as StageSort)}
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
                    setSort("order");
                  }}
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-white/70 transition hover:border-white/16 hover:text-white"
                >
                  Reset
                </button>
              ) : null}
            </div>
          </div>
        </section>

        {loading ? (
          <LoadingState />
        ) : stageRows.length === 0 ? (
          <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/5 px-6 text-center">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <Plus className="h-6 w-6 text-cyan-300" />
            </div>
            <h2 className="mt-5 text-xl font-semibold text-white">No stages created</h2>
            <p className="mt-2 max-w-md text-sm text-white/60">
              Create the first stage to define the tournament structure and start
              organizing groups and matches.
            </p>
            <button
              type="button"
              onClick={() => {
                setCreateOrder("1");
                setCreateOpen(true);
              }}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-950/40 transition hover:brightness-110"
            >
              <Plus className="h-4 w-4" />
              Create Stage
            </button>
          </div>
        ) : visibleStages.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 px-6 py-16 text-center">
            <div className="text-xl font-semibold text-white">No stages match this view</div>
            <p className="mt-2 text-sm text-white/55">
              Try a different search or reset the current sort.
            </p>
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setSort("order");
              }}
              className="mt-5 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white/75 transition hover:border-white/16 hover:text-white"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <>
            <div className="hidden xl:block">
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#10151d] shadow-[0_18px_50px_rgba(0,0,0,0.24)]">
                <div className="grid grid-cols-[minmax(0,2fr)_88px_88px_88px_88px_132px_240px] gap-4 border-b border-white/8 px-5 py-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">
                  <div>Stage</div>
                  <div>Order</div>
                  <div>Groups</div>
                  <div>Matches</div>
                  <div>Teams</div>
                  <div>Created</div>
                  <div className="text-right">Actions</div>
                </div>

                <div className="divide-y divide-white/6">
                  {visibleStages.map((stage) => (
                    <div
                      key={stage.id}
                      className="grid grid-cols-[minmax(0,2fr)_88px_88px_88px_88px_132px_240px] items-center gap-4 px-5 py-4 transition hover:bg-white/[0.03]"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-base font-semibold text-white">
                          {stage.name}
                        </div>
                        <div className="mt-1 truncate text-xs uppercase tracking-[0.2em] text-white/42">
                          {stage.id}
                        </div>
                      </div>

                      <div>
                        <span className="inline-flex rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200">
                          {stage.order ?? "--"}
                        </span>
                      </div>
                      <DataCell value={String(stage.groupsCount)} />
                      <DataCell value={String(stage.matchesCount)} />
                      <DataCell value={String(stage.teamsCount)} />
                      <div className="text-sm text-white/70">
                        <div className="font-medium text-white">{formatDate(stage.createdAt)}</div>
                        <div className="mt-1 text-xs uppercase tracking-[0.2em] text-white/40">
                          <CalendarDays className="mr-1 inline h-3.5 w-3.5" />
                          Created
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/organizer/tournaments/${tournamentId}/stages/${stage.id}`}
                          className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-950/25 transition hover:brightness-110"
                        >
                          Open
                        </Link>
                        <button
                          type="button"
                          className="inline-flex items-center justify-center rounded-lg border border-white/12 bg-white/[0.05] px-3.5 py-2 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                          onClick={() => {
                            setEditingStage(stage);
                            setEditName(stage.name ?? "");
                            setEditOrder(stage.order?.toString() ?? "");
                            setEditOpen(true);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center justify-center rounded-lg border border-rose-500/20 bg-rose-500/10 px-3.5 py-2 text-sm font-semibold text-rose-100 transition hover:border-rose-500/30 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={async () => {
                            if (!tournamentId) return;

                            const confirmed = window.confirm(
                              `Delete stage "${stage.name}"?`,
                            );
                            if (!confirmed) return;

                            setDeletingStageId(stage.id);
                            try {
                              await apiFetch(`/tournaments/${tournamentId}/stages/${stage.id}`, {
                                method: "DELETE",
                              });
                              await refreshStages();
                            } catch (err) {
                              setError(
                                err instanceof Error
                                  ? err.message
                                  : "Failed to delete stage",
                              );
                            } finally {
                              setDeletingStageId(null);
                            }
                          }}
                          disabled={deletingStageId === stage.id}
                        >
                          {deletingStageId === stage.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:hidden">
              {visibleStages.map((stage) => (
                <article
                  key={stage.id}
                  className="rounded-2xl border border-white/10 bg-[#10151d] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.24)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="truncate text-lg font-semibold text-white">
                        {stage.name}
                      </div>
                      <div className="mt-1 truncate text-xs uppercase tracking-[0.2em] text-white/42">
                        {stage.id}
                      </div>
                    </div>
                    <span className="inline-flex shrink-0 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200">
                      Order {stage.order ?? "--"}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/75">
                      Groups: {stage.groupsCount}
                    </span>
                    <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/75">
                      Matches: {stage.matchesCount}
                    </span>
                    <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/75">
                      Teams: {stage.teamsCount}
                    </span>
                    <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/75">
                      Created: {formatDate(stage.createdAt)}
                    </span>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2 border-t border-white/10 pt-4">
                    <Link
                      href={`/organizer/tournaments/${tournamentId}/stages/${stage.id}`}
                      className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-950/25 transition hover:brightness-110"
                    >
                      Open Stage
                    </Link>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center rounded-xl border border-white/12 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                      onClick={() => {
                        setEditingStage(stage);
                        setEditName(stage.name ?? "");
                        setEditOrder(stage.order?.toString() ?? "");
                        setEditOpen(true);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-100 transition hover:border-rose-500/30 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={async () => {
                        if (!tournamentId) return;

                        const confirmed = window.confirm(`Delete stage "${stage.name}"?`);
                        if (!confirmed) return;

                        setDeletingStageId(stage.id);
                        try {
                          await apiFetch(`/tournaments/${tournamentId}/stages/${stage.id}`, {
                            method: "DELETE",
                          });
                          await refreshStages();
                        } catch (err) {
                          setError(
                            err instanceof Error ? err.message : "Failed to delete stage",
                          );
                        } finally {
                          setDeletingStageId(null);
                        }
                      }}
                      disabled={deletingStageId === stage.id}
                    >
                      {deletingStageId === stage.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </div>

      {createOpen ? (
        <StageModal
          title="Create Stage"
          description="Add a stage to this tournament structure."
          name={createName}
          setName={setCreateName}
          order={createOrder}
          setOrder={setCreateOrder}
          busy={creating}
          submitLabel="Create"
          onClose={resetCreate}
          onSubmit={async () => {
            if (!tournamentId) return;

            setCreating(true);
            try {
              await apiFetch(`/tournaments/${tournamentId}/stages`, {
                method: "POST",
                body: JSON.stringify({
                  name: createName.trim(),
                  order: createOrder ? Number(createOrder) : undefined,
                }),
              });
              resetCreate();
              await refreshStages();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to create stage");
            } finally {
              setCreating(false);
            }
          }}
        />
      ) : null}

      {editOpen ? (
        <StageModal
          title="Edit Stage"
          description="Update the stage name or order."
          name={editName}
          setName={setEditName}
          order={editOrder}
          setOrder={setEditOrder}
          busy={savingEdit}
          submitLabel="Save"
          onClose={resetEdit}
          onSubmit={async () => {
            if (!tournamentId || !editingStage) return;

            setSavingEdit(true);
            try {
              await apiFetch(`/tournaments/${tournamentId}/stages/${editingStage.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                  name: editName.trim(),
                  order: editOrder ? Number(editOrder) : undefined,
                }),
              });
              await refreshStages();
              resetEdit();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to update stage");
            } finally {
              setSavingEdit(false);
            }
          }}
        />
      ) : null}
    </div>
  );
}
