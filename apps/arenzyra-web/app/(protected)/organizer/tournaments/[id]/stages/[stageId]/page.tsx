"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowUpDown,
  CalendarDays,
  Check,
  LayoutGrid,
  Plus,
  Search,
  Swords,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import { apiFetch, ensureApiUrl } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";

type Group = {
  id: string;
  name?: string | null;
  matchCount?: number;
  teamCount?: number;
  createdAt?: string | null;
};
type Stage = { id: string; name: string; order?: number; groups?: Group[] };

type StageResponse = Stage & { tournamentId?: string };
type StageTeam = {
  id: string;
  tournamentTeamId: string;
  team?: { id: string; name?: string | null; tag?: string | null; logoUrl?: string | null } | null;
};
type GroupTeam = {
  id: string;
  tournamentTeamId: string;
  team?: { id: string; name?: string | null; tag?: string | null; logoUrl?: string | null } | null;
};
type TournamentTeam = {
  id: string;
  name?: string | null;
  tag?: string | null;
  logoUrl?: string | null;
};

type TeamAssignmentOption = {
  id: string;
  name: string;
  tag: string | null;
  logoUrl: string | null;
};

type TournamentSummary = {
  id: string;
  name: string;
  status?: string | null;
  liveState?: string | null;
};

type GroupSort = "name" | "matches" | "teams" | "created";

const GROUP_SORT_OPTIONS: Array<{ key: GroupSort; label: string }> = [
  { key: "name", label: "Name" },
  { key: "matches", label: "Matches" },
  { key: "teams", label: "Teams" },
  { key: "created", label: "Newest" },
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

function getGroupStatus(group: Group) {
  const matchCount = group.matchCount ?? 0;
  const teamCount = group.teamCount ?? 0;

  if (teamCount === 0) {
    return {
      label: "Needs Teams",
      className: "border-amber-400/20 bg-amber-500/10 text-amber-200",
    };
  }

  if (matchCount === 0) {
    return {
      label: "Ready",
      className: "border-cyan-400/20 bg-cyan-500/10 text-cyan-200",
    };
  }

  return {
    label: "Active",
    className: "border-emerald-400/20 bg-emerald-500/10 text-emerald-200",
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
  icon: typeof Users;
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

const buildSelectionSet = (items: Iterable<string>) => new Set(items);

const hasSelectionChanged = (current: ReadonlySet<string>, baseline: ReadonlySet<string>) => {
  if (current.size !== baseline.size) return true;

  for (const value of current) {
    if (!baseline.has(value)) return true;
  }

  return false;
};

const getTeamMonogram = (name: string, tag?: string | null) => {
  const source = tag?.trim() || name.trim();
  if (!source) return "TM";

  const words = source.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }

  return words
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
};

function TeamAssignmentModal({
  eyebrow,
  title,
  description,
  teams,
  selectedIds,
  setSelectedIds,
  helperText,
  emptyTitle,
  emptyDescription,
  saveLabel,
  savingLabel,
  saving,
  saveDisabled,
  onClose,
  onSave,
}: {
  eyebrow: string;
  title: string;
  description: string;
  teams: TeamAssignmentOption[];
  selectedIds: ReadonlySet<string>;
  setSelectedIds: (value: Set<string> | ((previous: Set<string>) => Set<string>)) => void;
  helperText: string;
  emptyTitle: string;
  emptyDescription: string;
  saveLabel: string;
  savingLabel: string;
  saving: boolean;
  saveDisabled: boolean;
  onClose: () => void;
  onSave: () => void | Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const filteredTeams = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();

    return teams
      .filter((team) => {
        if (!normalizedQuery) return true;

        return [team.name, team.tag]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .slice()
      .sort((left, right) => {
        const leftSelected = selectedIds.has(left.id) ? 1 : 0;
        const rightSelected = selectedIds.has(right.id) ? 1 : 0;
        if (rightSelected !== leftSelected) {
          return rightSelected - leftSelected;
        }

        return left.name.localeCompare(right.name, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });
  }, [deferredQuery, selectedIds, teams]);

  const visibleSelectedCount = filteredTeams.reduce(
    (count, team) => count + (selectedIds.has(team.id) ? 1 : 0),
    0,
  );
  const hiddenSelectedCount = selectedIds.size - visibleSelectedCount;
  const selectionScopeLabel = query.trim() ? "visible" : "all";
  const allVisibleSelected =
    filteredTeams.length > 0 && filteredTeams.every((team) => selectedIds.has(team.id));
  const footerNote =
    hiddenSelectedCount > 0
      ? `${hiddenSelectedCount} selected ${
          hiddenSelectedCount === 1 ? "team is" : "teams are"
        } hidden by the current search.`
      : helperText;

  const toggleTeam = (teamId: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
  };

  const updateVisibleSelection = (mode: "add" | "remove") => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      for (const team of filteredTeams) {
        if (mode === "add") {
          next.add(team.id);
        } else {
          next.delete(team.id);
        }
      }
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 px-4 py-6 backdrop-blur-sm">
      <div className="flex min-h-full items-center justify-center">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="relative w-full max-w-[1480px] overflow-hidden rounded-[24px] border border-white/10 bg-[#0c1320] shadow-[0_32px_120px_rgba(0,0,0,0.55)]"
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_44%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.12),transparent_34%)]" />

          <div className="relative border-b border-white/10 px-5 py-4 sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                    {eyebrow}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold text-white/75">
                    {selectedIds.size} / {teams.length} selected
                  </span>
                  {query.trim() ? (
                    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold text-white/55">
                      {filteredTeams.length} visible
                    </span>
                  ) : null}
                </div>
                <h2 className="mt-3 text-xl font-semibold text-white sm:text-2xl">{title}</h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-white/55">{description}</p>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-white/65 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                aria-label="Close dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
              <label className="relative block w-full xl:max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                <input
                  autoFocus
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search teams"
                  className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.05] pl-10 pr-10 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-cyan-400/40 focus:bg-white/[0.07]"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="absolute right-2.5 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white"
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => updateVisibleSelection("add")}
                  disabled={filteredTeams.length === 0 || allVisibleSelected}
                  className="inline-flex items-center rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2 text-sm font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Select {selectionScopeLabel}
                </button>
                <button
                  type="button"
                  onClick={() => updateVisibleSelection("remove")}
                  disabled={visibleSelectedCount === 0}
                  className="inline-flex items-center rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2 text-sm font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clear {selectionScopeLabel}
                </button>
              </div>
            </div>
          </div>

          <div className="relative px-5 py-4 sm:px-6">
          {teams.length === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-6 text-center">
              <Users className="h-10 w-10 text-white/25" />
              <div className="mt-4 text-lg font-semibold text-white">{emptyTitle}</div>
              <p className="mt-2 max-w-md text-sm leading-6 text-white/55">{emptyDescription}</p>
            </div>
          ) : filteredTeams.length === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-6 text-center">
              <Search className="h-10 w-10 text-white/25" />
              <div className="mt-4 text-lg font-semibold text-white">No matching teams</div>
              <p className="mt-2 max-w-md text-sm leading-6 text-white/55">
                Adjust the search query or clear it to browse the full team list.
              </p>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {filteredTeams.map((team) => {
                const checked = selectedIds.has(team.id);
                const logoSrc = team.logoUrl ? ensureApiUrl(team.logoUrl) : null;

                return (
                  <button
                    key={team.id}
                    type="button"
                    aria-pressed={checked}
                    onClick={() => toggleTeam(team.id)}
                    className={`group relative flex min-h-[76px] items-center gap-3 rounded-[18px] border px-3 py-3 text-left transition ${
                      checked
                        ? "border-cyan-400/35 bg-cyan-500/10 shadow-[0_10px_28px_rgba(8,145,178,0.12)]"
                        : "border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.07]"
                    }`}
                  >
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border ${
                        checked
                          ? "border-cyan-300/40 bg-cyan-400/10"
                          : "border-white/10 bg-white/[0.06]"
                      }`}
                    >
                      {logoSrc ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={logoSrc}
                          alt={team.name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                        ) : (
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-white/80">
                          {getTeamMonogram(team.name, team.tag)}
                        </span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1 pr-8">
                      <div className="truncate text-sm font-semibold text-white sm:text-[15px]">
                        {team.name}
                      </div>
                      <div className="mt-1 flex min-h-5 flex-wrap items-center gap-2">
                        {team.tag ? (
                          <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70">
                            {team.tag}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div
                      className={`absolute right-3 top-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition ${
                        checked
                          ? "border-cyan-300/40 bg-cyan-300 text-slate-950"
                          : "border-white/12 bg-transparent text-transparent group-hover:border-white/25"
                      }`}
                    >
                      <Check className="h-4 w-4" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          </div>

          <div className="relative flex flex-col gap-3 border-t border-white/10 bg-white/[0.02] px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="text-xs leading-5 text-white/50 sm:text-sm">{footerNote}</p>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/70 transition hover:border-white/20 hover:text-white"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-950/40 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
                disabled={saveDisabled}
                onClick={() => void onSave()}
              >
                {saving ? savingLabel : saveLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StageDetailPage() {
  const params = useParams<{ id: string; stageId: string }>();
  const tournamentId = params?.id;
  const stageId = params?.stageId;

  const [tournament, setTournament] = useState<TournamentSummary | null>(null);
  const [stage, setStage] = useState<StageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupSearch, setGroupSearch] = useState("");
  const [groupSort, setGroupSort] = useState<GroupSort>("name");
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [addingGroup, setAddingGroup] = useState(false);
  const [editGroupId, setEditGroupId] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  const [editing, setEditing] = useState(false);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [stageTeams, setStageTeams] = useState<StageTeam[]>([]);
  const [allTeams, setAllTeams] = useState<TournamentTeam[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [savingAssign, setSavingAssign] = useState(false);
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<string>>(new Set());
  const [groupAssignOpen, setGroupAssignOpen] = useState<{ groupId: string; groupName: string } | null>(null);
  const [groupSelected, setGroupSelected] = useState<Set<string>>(new Set());
  const [groupAssignedIds, setGroupAssignedIds] = useState<Set<string>>(new Set());
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupAssignLoading, setGroupAssignLoading] = useState(false);
  const [groupList, setGroupList] = useState<Group[]>([]);

  const load = useCallback(async () => {
    if (!tournamentId) return;
    setLoading(true);
    setError(null);
    try {
      const [tournamentRes, stagesRes] = await Promise.all([
        apiFetch(`/organizer/tournaments/${tournamentId}`, {
          cache: "no-store",
        }),
        apiFetch(`/tournaments/${tournamentId}/stages`, {
          cache: "no-store",
        }),
      ]);

      if (tournamentRes.ok) {
        const tournamentJson = (await tournamentRes.json()) as TournamentSummary;
        setTournament(tournamentJson);
      }

      const json = await stagesRes.json();
      const list: StageResponse[] = Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json)
          ? json
          : json?.stages ?? [];
      const found = list.find((s) => s.id === stageId) ?? null;
      setStage(found);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stage");
    } finally {
      setLoading(false);
    }
  }, [stageId, tournamentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadStageTeams = useCallback(async () => {
    if (!stageId) return;
    try {
      const res = await apiFetch(`/org/me/stages/${stageId}/teams`, { cache: "no-store" });
      const json = await res.json();
      const stageTeamsData: StageTeam[] =
        (json?.stageTeams as StageTeam[]) ??
        (json?.data as StageTeam[]) ??
        (Array.isArray(json) ? (json as StageTeam[]) : []);
      setStageTeams(stageTeamsData);
      setSelectedTeamIds(new Set(stageTeamsData.map((t) => t.tournamentTeamId)));
    } catch (err) {
      console.warn("Failed to load stage teams", err);
    }
  }, [stageId]);

  const loadAllTeams = useCallback(async () => {
    if (!tournamentId) return;
    try {
      const res = await apiFetch(`/org/me/tournaments/${tournamentId}/teams`, {
        cache: "no-store",
      });
      const json = await res.json();
      const teamsRaw: unknown[] =
        (json?.teams as unknown[]) ?? (json?.data as unknown[]) ?? (Array.isArray(json) ? json : []);
      const teams: TournamentTeam[] = teamsRaw.map((t) => {
        const item = t as { id: string; name?: string | null; tag?: string | null; logoUrl?: string | null; team?: { name?: string | null; tag?: string | null; logoUrl?: string | null } };
        return {
          id: item.id,
          name: item.name ?? item.team?.name ?? null,
          tag: item.tag ?? item.team?.tag ?? null,
          logoUrl: item.logoUrl ?? item.team?.logoUrl ?? null,
        };
      });
      setAllTeams(teams);
    } catch (err) {
      console.warn("Failed to load tournament teams", err);
    }
  }, [tournamentId]);

  useEffect(() => {
    void loadStageTeams();
  }, [loadStageTeams]);

  const loadGroups = useCallback(async () => {
    if (!stageId) return;
    try {
      const res = await apiFetch(`/org/me/stages/${stageId}/groups`, { cache: "no-store" });
      const json = await res.json();
      const list: Group[] =
        (json?.groups as Group[]) ??
        (json?.data as Group[]) ??
        (Array.isArray(json) ? (json as Group[]) : []);
      setGroupList(list);
    } catch (err) {
      console.warn("Failed to load groups", err);
    }
  }, [stageId]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const groups = useMemo(() => stage?.groups ?? [], [stage]);
  const groupRows = useMemo(
    () =>
      (groupList.length ? groupList : groups).map((group) => ({
        ...group,
        matchesCount: group.matchCount ?? 0,
        teamsCount: group.teamCount ?? 0,
        createdTimestamp: toTimestamp(group.createdAt),
        searchValue: [group.name, group.matchCount, group.teamCount]
          .filter((value) => value !== null && value !== undefined)
          .join(" ")
          .toLowerCase(),
      })),
    [groupList, groups],
  );
  const visibleGroups = useMemo(() => {
    const query = groupSearch.trim().toLowerCase();

    return groupRows
      .filter((group) => !query || group.searchValue.includes(query))
      .slice()
      .sort((left, right) => {
        switch (groupSort) {
          case "matches":
            if (right.matchesCount !== left.matchesCount) {
              return right.matchesCount - left.matchesCount;
            }
            break;
          case "teams":
            if (right.teamsCount !== left.teamsCount) {
              return right.teamsCount - left.teamsCount;
            }
            break;
          case "created":
            if (right.createdTimestamp !== left.createdTimestamp) {
              return right.createdTimestamp - left.createdTimestamp;
            }
            break;
          case "name":
          default:
            break;
        }

        return (left.name ?? "Untitled group").localeCompare(
          right.name ?? "Untitled group",
          undefined,
          { numeric: true, sensitivity: "base" },
        );
      });
  }, [groupRows, groupSearch, groupSort]);
  const groupsCount = groupRows.length;
  const matchesCount = groupRows.reduce((sum, g) => sum + g.matchesCount, 0);
  const teamsCount = stageTeams.length;
  const emptyGroupsCount = groupRows.filter((group) => group.teamsCount === 0).length;
  const activeGroupsCount = groupRows.filter((group) => group.matchesCount > 0).length;
  const hasActiveFilters = groupSearch.trim().length > 0 || groupSort !== "name";
  const stageAssignedIds = useMemo(
    () => buildSelectionSet(stageTeams.map((team) => team.tournamentTeamId)),
    [stageTeams],
  );
  const hasStageAssignChanges = useMemo(
    () => hasSelectionChanged(selectedTeamIds, stageAssignedIds),
    [selectedTeamIds, stageAssignedIds],
  );
  const hasGroupAssignChanges = useMemo(
    () => hasSelectionChanged(groupSelected, groupAssignedIds),
    [groupAssignedIds, groupSelected],
  );
  const stageAssignableTeams = useMemo<TeamAssignmentOption[]>(
    () =>
      allTeams.map((team) => ({
        id: team.id,
        name: team.name ?? "Unnamed Team",
        tag: team.tag ?? null,
        logoUrl: team.logoUrl ?? null,
      })),
    [allTeams],
  );
  const groupAssignableTeams = useMemo<TeamAssignmentOption[]>(
    () =>
      stageTeams.map((team) => ({
        id: team.tournamentTeamId,
        name: team.team?.name ?? "Unnamed Team",
        tag: team.team?.tag ?? null,
        logoUrl: team.team?.logoUrl ?? null,
      })),
    [stageTeams],
  );

  const addGroup = async () => {
    if (!stageId) return;
    const name = groupName.trim() || `Group ${groups.length + 1}`;
    setAddingGroup(true);
    setError(null);
    try {
      await apiFetch(`/org/me/stages/${stageId}/groups`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setGroupName("");
      setCreatingOpen(false);
      await loadGroups();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add group");
    } finally {
      setAddingGroup(false);
    }
  };

  const openEditGroup = (group: Group) => {
    setEditGroupId(group.id);
    setEditGroupName(group.name ?? "");
    setError(null);
  };

  const saveGroup = async () => {
    if (!editGroupId || !stageId) return;
    const name = editGroupName.trim();
    if (!name) {
      setError("Group name is required");
      return;
    }
    setEditing(true);
    setError(null);
    try {
      await apiFetch(`/org/me/stages/${stageId}/groups/${editGroupId}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      setEditGroupId(null);
      setEditGroupName("");
      await loadGroups();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update group");
    } finally {
      setEditing(false);
    }
  };

  const deleteGroup = async (group: Group) => {
    if (!stageId || !group.id) return;
    if ((group.matchCount ?? 0) > 0) {
      setError("Cannot delete a group that has matches");
      return;
    }
    const ok = window.confirm(`Delete group "${group.name ?? "Untitled"}"?`);
    if (!ok) return;
    setDeletingGroupId(group.id);
    setError(null);
    try {
      await apiFetch(`/org/me/stages/${stageId}/groups/${group.id}`, { method: "DELETE" });
      await loadGroups();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete group");
    } finally {
      setDeletingGroupId(null);
    }
  };

  const openGroupAssign = async (group: Group) => {
    if (!group.id) return;

    setError(null);
    setGroupAssignLoading(true);

    try {
      if (stageTeams.length === 0) {
        await loadStageTeams();
      }

      const res = await apiFetch(`/org/me/groups/${group.id}/teams`, {
        cache: "no-store",
      });
      const json = await res.json();
      const existing: GroupTeam[] =
        (json?.groupTeams as GroupTeam[]) ??
        (json?.data as GroupTeam[]) ??
        (Array.isArray(json) ? (json as GroupTeam[]) : []);

      const selectedIds = buildSelectionSet(existing.map((team) => team.tournamentTeamId));
      setGroupSelected(selectedIds);
      setGroupAssignedIds(buildSelectionSet(selectedIds));
      setGroupAssignOpen({
        groupId: group.id,
        groupName: group.name ?? "Untitled group",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load group teams");
    } finally {
      setGroupAssignLoading(false);
    }
  };

  const openStageAssign = async () => {
    setError(null);
    setSelectedTeamIds(buildSelectionSet(stageAssignedIds));
    await loadAllTeams();
    setAssignOpen(true);
  };

  const closeStageAssign = () => {
    setSelectedTeamIds(buildSelectionSet(stageAssignedIds));
    setAssignOpen(false);
  };

  const closeGroupAssign = () => {
    setGroupSelected(buildSelectionSet(groupAssignedIds));
    setGroupAssignOpen(null);
  };

  if (!tournamentId || !stageId) {
    return <div className="text-red-300">Stage path is missing.</div>;
  }

  if (loading) return <div className="text-white/70">Loading stage...</div>;

  if (!stage) {
    return (
      <EmptyState
        title="Unable to load stage"
        description={error ?? "Stage not found."}
        actionLabel="Retry"
        onAction={load}
      />
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-2 sm:px-8">
      <div className="space-y-6">
        <header className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200">
              Stage Operations
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">{stage.name}</h1>
              <p className="mt-1 max-w-3xl text-sm text-white/60">
                Manage group structure, team assignment, and match distribution
                {tournament?.name ? ` for ${tournament.name}.` : "."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {tournament?.name ? (
                <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/75">
                  {tournament.name}
                </span>
              ) : null}
              <span className="inline-flex rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
                Order {stage.order ?? "--"}
              </span>
              <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/65">
                {groupsCount} groups
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void openStageAssign()}
              className="rounded-xl border border-white/12 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
            >
              Assign Stage Teams
            </button>
            <button
              type="button"
              onClick={() => setCreatingOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-950/40 transition hover:brightness-110"
            >
              <Plus className="h-4 w-4" />
              Create Group
            </button>
            <Link
              className="rounded-xl border border-white/12 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
              href={`/organizer/tournaments/${tournamentId}/stages`}
            >
              Back to Stages
            </Link>
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="Groups"
            value={String(groupsCount)}
            note="stage structure"
            icon={LayoutGrid}
            accent="text-white"
          />
          <SummaryCard
            label="Matches"
            value={String(matchesCount)}
            note="scheduled inside groups"
            icon={Swords}
            accent="text-blue-200"
          />
          <SummaryCard
            label="Teams"
            value={String(teamsCount)}
            note="assigned to stage pool"
            icon={Users}
            accent="text-emerald-200"
          />
          <SummaryCard
            label="Needs Teams"
            value={String(emptyGroupsCount)}
            note="groups without assigned teams"
            icon={TriangleAlert}
            accent="text-amber-200"
          />
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#10151d] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.24)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-1 flex-col gap-4 lg:flex-row">
              <label className="relative flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                <input
                  type="search"
                  value={groupSearch}
                  onChange={(event) => setGroupSearch(event.target.value)}
                  placeholder="Search groups by name or counts"
                  className="w-full rounded-xl border border-white/10 bg-slate-950/70 py-3 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-cyan-300/35"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white/65">
                Active groups: {activeGroupsCount}
              </div>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2.5 text-sm text-white/70">
                <ArrowUpDown className="h-4 w-4 text-white/40" />
                <span className="text-white/45">Sort</span>
                <select
                  value={groupSort}
                  onChange={(event) => setGroupSort(event.target.value as GroupSort)}
                  className="bg-transparent text-sm font-medium text-white outline-none"
                >
                  {GROUP_SORT_OPTIONS.map((option) => (
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
                    setGroupSearch("");
                    setGroupSort("name");
                  }}
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-white/70 transition hover:border-white/16 hover:text-white"
                >
                  Reset
                </button>
              ) : null}
            </div>
          </div>
        </section>

        {visibleGroups.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 px-6 py-16 text-center">
            <div className="text-xl font-semibold text-white">
              {groupsCount === 0 ? "No groups created" : "No groups match this view"}
            </div>
            <p className="mt-2 text-sm text-white/55">
              {groupsCount === 0
                ? "Create the first group to start organizing matches."
                : "Try a different search or reset the current sort."}
            </p>
            <button
              type="button"
              onClick={() => {
                if (groupsCount === 0) {
                  setCreatingOpen(true);
                  return;
                }
                setGroupSearch("");
                setGroupSort("name");
              }}
              className="mt-5 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white/75 transition hover:border-white/16 hover:text-white"
            >
              {groupsCount === 0 ? "Create Group" : "Clear filters"}
            </button>
          </div>
        ) : (
          <>
            <div className="hidden xl:block">
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#10151d] shadow-[0_18px_50px_rgba(0,0,0,0.24)]">
                <div className="grid grid-cols-[minmax(0,1.8fr)_100px_100px_120px_132px_300px] gap-4 border-b border-white/8 px-5 py-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">
                  <div>Group</div>
                  <div>Matches</div>
                  <div>Teams</div>
                  <div>Status</div>
                  <div>Created</div>
                  <div className="text-right">Actions</div>
                </div>

                <div className="divide-y divide-white/6">
                  {visibleGroups.map((group) => {
                    const status = getGroupStatus(group);
                    return (
                      <div
                        key={group.id}
                        className="grid grid-cols-[minmax(0,1.8fr)_100px_100px_120px_132px_300px] items-center gap-4 px-5 py-4 transition hover:bg-white/[0.03]"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-base font-semibold text-white">
                            {group.name ?? "Untitled group"}
                          </div>
                          <div className="mt-1 truncate text-xs uppercase tracking-[0.2em] text-white/42">
                            {group.id}
                          </div>
                        </div>

                        <div className="text-sm font-medium text-white/80">
                          {group.matchesCount}
                        </div>
                        <div className="text-sm font-medium text-white/80">
                          {group.teamsCount}
                        </div>
                        <div>
                          <span
                            className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${status.className}`}
                          >
                            {status.label}
                          </span>
                        </div>
                        <div className="text-sm text-white/70">
                          <div className="font-medium text-white">{formatDate(group.createdAt)}</div>
                          <div className="mt-1 text-xs uppercase tracking-[0.2em] text-white/40">
                            <CalendarDays className="mr-1 inline h-3.5 w-3.5" />
                            Created
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2">
                          <Link
                            className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-950/25 transition hover:brightness-110"
                            href={`/organizer/groups/${group.id}`}
                          >
                            Open
                          </Link>
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded-lg border border-white/12 bg-white/[0.05] px-3.5 py-2 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                            onClick={() => void openGroupAssign(group)}
                            disabled={groupAssignLoading}
                          >
                            Teams
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded-lg border border-white/12 bg-white/[0.05] px-3.5 py-2 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                            onClick={() => openEditGroup(group)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded-lg border border-rose-500/20 bg-rose-500/10 px-3.5 py-2 text-sm font-semibold text-rose-100 transition hover:border-rose-500/30 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={group.matchesCount > 0 || deletingGroupId === group.id}
                            onClick={() => void deleteGroup(group)}
                          >
                            {deletingGroupId === group.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:hidden">
              {visibleGroups.map((group) => {
                const status = getGroupStatus(group);
                return (
                  <article
                    key={group.id}
                    className="rounded-2xl border border-white/10 bg-[#10151d] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.24)]"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="truncate text-lg font-semibold text-white">
                          {group.name ?? "Untitled group"}
                        </div>
                        <div className="mt-1 truncate text-xs uppercase tracking-[0.2em] text-white/42">
                          {group.id}
                        </div>
                      </div>
                      <span
                        className={`inline-flex shrink-0 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${status.className}`}
                      >
                        {status.label}
                      </span>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/75">
                        Matches: {group.matchesCount}
                      </span>
                      <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/75">
                        Teams: {group.teamsCount}
                      </span>
                      <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/75">
                        Created: {formatDate(group.createdAt)}
                      </span>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2 border-t border-white/10 pt-4">
                      <Link
                        className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-950/25 transition hover:brightness-110"
                        href={`/organizer/groups/${group.id}`}
                      >
                        Open
                      </Link>
                      <button
                        type="button"
                        className="inline-flex items-center justify-center rounded-xl border border-white/12 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                        onClick={() => void openGroupAssign(group)}
                        disabled={groupAssignLoading}
                      >
                        Teams
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center justify-center rounded-xl border border-white/12 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                        onClick={() => openEditGroup(group)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center justify-center rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-100 transition hover:border-rose-500/30 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={group.matchesCount > 0 || deletingGroupId === group.id}
                        onClick={() => void deleteGroup(group)}
                      >
                        {deletingGroupId === group.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </div>

      {assignOpen ? (
        <TeamAssignmentModal
          eyebrow="Stage Team Pool"
          title="Assign stage teams"
          description="Choose which tournament teams belong in this stage. Selected teams become available when building and balancing groups."
          teams={stageAssignableTeams}
          selectedIds={selectedTeamIds}
          setSelectedIds={setSelectedTeamIds}
          helperText="Stage assignment controls which teams can be distributed across groups in this stage."
          emptyTitle="No teams available"
          emptyDescription="This tournament does not have any registered teams yet."
          saveLabel="Save changes"
          savingLabel="Saving..."
          saving={savingAssign}
          saveDisabled={savingAssign || !hasStageAssignChanges}
          onClose={closeStageAssign}
          onSave={async () => {
            if (!stageId) return;
            setSavingAssign(true);
            try {
              const res = await apiFetch(`/org/me/stages/${stageId}/teams`, {
                method: "PUT",
                body: JSON.stringify({
                  tournamentTeamIds: Array.from(selectedTeamIds),
                }),
              });
              const json = await res.json();
              const updated: StageTeam[] =
                (json?.stageTeams as StageTeam[]) ??
                (json?.data as StageTeam[]) ??
                (Array.isArray(json) ? (json as StageTeam[]) : []);
              setStageTeams(updated);
              setSelectedTeamIds(buildSelectionSet(updated.map((team) => team.tournamentTeamId)));
              setAssignOpen(false);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to assign teams");
            } finally {
              setSavingAssign(false);
            }
          }}
        />
      ) : null}

      {groupAssignOpen ? (
        <TeamAssignmentModal
          eyebrow="Group Assignment"
          title={`Assign teams to ${groupAssignOpen.groupName}`}
          description="Pick from the teams already assigned to this stage. Only selected teams will appear inside this group."
          teams={groupAssignableTeams}
          selectedIds={groupSelected}
          setSelectedIds={setGroupSelected}
          helperText="Groups can only use teams that are already part of the current stage."
          emptyTitle="No stage teams available"
          emptyDescription="Assign teams at the stage level first, then add them to individual groups."
          saveLabel="Save changes"
          savingLabel="Saving..."
          saving={groupSaving}
          saveDisabled={groupSaving || groupAssignableTeams.length === 0 || !hasGroupAssignChanges}
          onClose={closeGroupAssign}
          onSave={async () => {
            const target = groupAssignOpen?.groupId;
            if (!target) return;
            setGroupSaving(true);
            try {
              const res = await apiFetch(`/org/me/groups/${target}/teams`, {
                cache: "no-store",
              });
              const json = await res.json();
              const existing: GroupTeam[] =
                (json?.groupTeams as GroupTeam[]) ??
                (json?.data as GroupTeam[]) ??
                (Array.isArray(json) ? (json as GroupTeam[]) : []);

              const existingIds = buildSelectionSet(existing.map((team) => team.tournamentTeamId));
              const nextSelectedIds = buildSelectionSet(groupSelected);
              const toAdd = Array.from(nextSelectedIds).filter((id) => !existingIds.has(id));
              const toRemove = existing.filter((team) => !nextSelectedIds.has(team.tournamentTeamId));

              for (const addId of toAdd) {
                await apiFetch(`/org/me/groups/${target}/teams`, {
                  method: "POST",
                  body: JSON.stringify({ tournamentTeamId: addId }),
                });
              }

              for (const team of toRemove) {
                await apiFetch(`/org/me/groups/${target}/teams/${team.id}`, {
                  method: "DELETE",
                });
              }

              setGroupAssignedIds(buildSelectionSet(nextSelectedIds));
              setGroupSelected(nextSelectedIds);
              await loadGroups();
              setGroupAssignOpen(null);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to assign teams");
            } finally {
              setGroupSaving(false);
            }
          }}
        />
      ) : null}

      {creatingOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Create Group</h2>
                <p className="text-sm text-white/60">Add a new group to this stage.</p>
              </div>
              <button
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-white/70 transition hover:border-white/20 hover:text-white"
                onClick={() => {
                  setCreatingOpen(false);
                  setGroupName("");
                }}
              >
                Close
              </button>
            </div>

            {error ? (
              <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                {error}
              </div>
            ) : null}

            <div className="space-y-3">
              <label className="block space-y-1 text-sm text-white/80">
                <span>Group Name</span>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none transition focus:border-indigo-400"
                  placeholder="Group name"
                />
              </label>
            </div>

            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white/70 hover:text-white"
                onClick={() => {
                  setCreatingOpen(false);
                  setGroupName("");
                  setError(null);
                }}
                disabled={addingGroup}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition hover:from-cyan-400 hover:to-blue-400 disabled:opacity-50"
                disabled={addingGroup || !groupName.trim()}
                onClick={addGroup}
              >
                {addingGroup ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editGroupId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Edit Group</h2>
                <p className="text-sm text-white/60">Rename this group.</p>
              </div>
              <button
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-white/70 transition hover:border-white/20 hover:text-white"
                onClick={() => {
                  setEditGroupId(null);
                  setEditGroupName("");
                  setError(null);
                }}
              >
                Close
              </button>
            </div>

            {error ? (
              <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                {error}
              </div>
            ) : null}

            <div className="space-y-3">
              <label className="block space-y-1 text-sm text-white/80">
                <span>Group Name</span>
                <input
                  type="text"
                  value={editGroupName}
                  onChange={(e) => setEditGroupName(e.target.value)}
                  className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none transition focus:border-indigo-400"
                  placeholder="Group name"
                />
              </label>
            </div>

            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white/70 hover:text-white"
                onClick={() => {
                  setEditGroupId(null);
                  setEditGroupName("");
                  setError(null);
                }}
                disabled={editing}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-500 disabled:opacity-50"
                disabled={editing || !editGroupName.trim()}
                onClick={saveGroup}
              >
                {editing ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

