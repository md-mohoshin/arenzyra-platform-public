"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Search, Trash2, Users, X } from "lucide-react";
import { apiFetch, ensureApiUrl } from "@/lib/api";
import { useEffect } from "react";

const TOURNAMENT_TEAM_TARGET = 16;
const TEAM_MAX_PLAYERS = 4;
const LARGE_TEAM_PICKER_LIMIT = 80;

type TournamentTeam = {
  id: string;
  teamId: string;
  slot?: number | null;
  name: string;
  tag?: string | null;
  logoUrl?: string | null;
  players?: { id: string }[] | null;
};

type OrgTeam = {
  id: string;
  name: string;
  tag: string | null;
  logoUrl: string | null;
};

type RosterTeam = {
  id: string;
  players?: { id: string }[] | null;
  _count?: {
    players?: number | null;
  } | null;
};

function useDebounced<T>(value: T, delay = 200) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);
  return debounced;
}

function TeamsPageInner() {
  const params = useParams<{ id: string }>();
  const tournamentId = params?.id;
  const qc = useQueryClient();

  const {
    data: tournamentTeams = [],
    isLoading: teamsLoading,
    isError: teamsError,
  } = useQuery({
    queryKey: ["tournamentTeams", tournamentId],
    enabled: !!tournamentId,
    queryFn: async () => {
      const res = await apiFetch(`/org/me/tournaments/${tournamentId}/teams`, {
        cache: "no-store",
      });
      const json = (await res.json()) as unknown;
      const list =
        (json as { teams?: unknown })?.teams ??
        (json as { data?: unknown })?.data ??
        (Array.isArray(json)
          ? json
          : Array.isArray((json as { items?: unknown })?.items)
            ? (json as { items: unknown[] }).items
            : []);

      if (!Array.isArray(list)) return [];

      return list.map((t) => {
        const item = t as Partial<TournamentTeam> & {
          tournamentId?: string | null;
          slot?: number | null;
          team?: {
            name?: string | null;
            tag?: string | null;
            logoUrl?: string | null;
            players?: { id: string }[] | null;
          };
        };
        return {
          id: item.id ?? `${item.teamId ?? item.id}-${item.tournamentId ?? tournamentId}`,
          teamId: item.teamId ?? item.id ?? "",
          slot: item.slot ?? null,
          name: item.team?.name ?? item.name ?? "Unnamed",
          tag: item.team?.tag ?? item.tag ?? null,
          logoUrl: item.team?.logoUrl ?? item.logoUrl ?? null,
          players: item.team?.players ?? null,
        };
      });
    },
  });

  const {
    data: orgTeams = [],
    isLoading: orgLoading,
    isError: orgError,
  } = useQuery({
    queryKey: ["organizationTeams"],
    queryFn: async () => {
      const res = await apiFetch("/organizer/teams", { cache: "no-store" });
      const json = (await res.json()) as unknown;
      const list =
        (json as { teams?: unknown })?.teams ??
        (json as { data?: unknown })?.data ??
        (Array.isArray(json) ? json : []);
      if (!Array.isArray(list)) return [];
      return list.map((t) => {
        const item = t as Partial<OrgTeam>;
        return {
          id: item.id ?? "",
          name: item.name ?? "Unnamed",
          tag: item.tag ?? null,
          logoUrl: item.logoUrl ?? null,
        };
      });
    },
  });

  const { data: rosterTeams = [] } = useQuery({
    queryKey: ["organizationRosterTeams"],
    queryFn: async () => {
      const res = await apiFetch("/organizer/teams", { cache: "no-store" });
      const json = (await res.json()) as
        | RosterTeam[]
        | { data?: RosterTeam[]; teams?: RosterTeam[] };
      if (Array.isArray(json)) return json;
      if (Array.isArray(json?.teams)) return json.teams;
      if (Array.isArray(json?.data)) return json.data;
      return [];
    },
  });

  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [tableSearch, setTableSearch] = useState("");
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const debouncedSearch = useDebounced(search, 200);

  const useServerSearch = orgTeams.length > 200;

  const {
    data: searchedTeams = [],
    isFetching: searching,
  } = useQuery({
    queryKey: ["organizationTeamsSearch", debouncedSearch],
    enabled: useServerSearch && debouncedSearch.trim().length > 0,
    queryFn: async () => {
      const q = encodeURIComponent(debouncedSearch.trim());
      const res = await apiFetch(`/organizer/teams?search=${q}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as unknown;
      const list =
        (json as { teams?: unknown })?.teams ??
        (json as { data?: unknown })?.data ??
        (Array.isArray(json) ? json : []);
      if (!Array.isArray(list)) return [];
      return list.map((t) => {
        const item = t as Partial<OrgTeam>;
        return {
          id: item.id ?? "",
          name: item.name ?? "Unnamed",
          tag: item.tag ?? null,
          logoUrl: item.logoUrl ?? null,
        };
      });
    },
  });

  const availableTeams = useMemo(() => {
    const existing = new Set(tournamentTeams.map((t) => t.teamId));
    const baseList =
      useServerSearch && debouncedSearch.trim().length > 0
        ? searchedTeams
        : orgTeams;

    const filtered =
      !useServerSearch && debouncedSearch.trim().length > 0
        ? baseList.filter((t) => {
            const q = debouncedSearch.toLowerCase();
            return (
              t.name.toLowerCase().includes(q) ||
              (t.tag ?? "").toLowerCase().includes(q)
            );
          })
        : baseList;

    return filtered
      .filter((t) => !existing.has(t.id))
      .slice()
      .sort((left, right) =>
        left.name.localeCompare(right.name, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      );
  }, [orgTeams, searchedTeams, tournamentTeams, debouncedSearch, useServerSearch]);

  const playerCountByTeamId = useMemo(
    () =>
      Object.fromEntries(
        rosterTeams.map((team) => [
          team.id,
          typeof team._count?.players === "number"
            ? team._count.players
            : Array.isArray(team.players)
              ? team.players.length
              : 0,
        ]),
      ),
    [rosterTeams],
  );

  const filteredTournamentTeams = useMemo(() => {
    const query = tableSearch.trim().toLowerCase();
    if (!query) return tournamentTeams;
    return tournamentTeams.filter((team) => {
      return (
        team.name.toLowerCase().includes(query) ||
        (team.tag ?? "").toLowerCase().includes(query)
      );
    });
  }, [tableSearch, tournamentTeams]);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedTeamMap = useMemo(
    () => new Map(orgTeams.map((team) => [team.id, team])),
    [orgTeams],
  );
  const selectedTeams = useMemo(
    () =>
      selectedIds.flatMap((id) => {
        const team = selectedTeamMap.get(id);
        return team ? [team] : [];
      }),
    [selectedIds, selectedTeamMap],
  );
  const visibleAvailableTeams = useMemo(() => {
    const filtered = showSelectedOnly
      ? availableTeams.filter((team) => selectedIdSet.has(team.id))
      : availableTeams;

    if (
      !showSelectedOnly &&
      useServerSearch &&
      debouncedSearch.trim().length === 0 &&
      filtered.length > LARGE_TEAM_PICKER_LIMIT
    ) {
      return filtered.slice(0, LARGE_TEAM_PICKER_LIMIT);
    }

    return filtered;
  }, [availableTeams, debouncedSearch, selectedIdSet, showSelectedOnly, useServerSearch]);
  const resultsAreLimited =
    !showSelectedOnly &&
    useServerSearch &&
    debouncedSearch.trim().length === 0 &&
    availableTeams.length > LARGE_TEAM_PICKER_LIMIT;
  const visibleSelectedCount = visibleAvailableTeams.reduce(
    (count, team) => count + (selectedIdSet.has(team.id) ? 1 : 0),
    0,
  );
  const allVisibleSelected =
    visibleAvailableTeams.length > 0 &&
    visibleAvailableTeams.every((team) => selectedIdSet.has(team.id));

  const addMutation = useMutation({
    mutationFn: async (teamIds: string[]) => {
      for (const teamId of teamIds) {
        await apiFetch(`/org/me/tournaments/${tournamentId}/teams/${teamId}`, {
          method: "POST",
        });
      }
    },
    onSuccess: async () => {
      setOpen(false);
      setSelectedIds([]);
      setSearch("");
      setShowSelectedOnly(false);
      await qc.invalidateQueries({ queryKey: ["tournamentTeams", tournamentId] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (teamId: string) => {
      await apiFetch(`/org/me/tournaments/${tournamentId}/teams/${teamId}`, {
        method: "DELETE",
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["tournamentTeams", tournamentId] });
    },
  });

  const toggle = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
  };

  const openPicker = () => {
    setSelectedIds([]);
    setSearch("");
    setShowSelectedOnly(false);
    setOpen(true);
  };

  const closePicker = () => {
    setOpen(false);
    setSelectedIds([]);
    setSearch("");
    setShowSelectedOnly(false);
  };

  const selectVisibleTeams = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const team of visibleAvailableTeams) {
        next.add(team.id);
      }
      return Array.from(next);
    });
  };

  const clearVisibleTeams = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const team of visibleAvailableTeams) {
        next.delete(team.id);
      }
      return Array.from(next);
    });
  };

  const headerStatus =
    teamsLoading || orgLoading
      ? "Loading teams..."
      : teamsError
        ? "Failed to load tournament teams"
        : orgError
          ? "Failed to load organization teams"
          : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-white">Tournament Teams</h1>
          <p className="text-sm text-white/60">
            Link existing organization teams to this tournament.
          </p>
        </div>
        <button
          type="button"
          onClick={openPicker}
          className="rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition hover:from-cyan-400 hover:to-blue-400 disabled:opacity-50 disabled:shadow-none"
          disabled={availableTeams.length === 0}
        >
          + Add Existing Teams
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-slate-900/50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm font-medium text-white/80">
          Teams: {tournamentTeams.length} / {Math.max(TOURNAMENT_TEAM_TARGET, tournamentTeams.length)}
        </div>
        <label className="relative block w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
            placeholder="Search teams..."
            className="w-full rounded-lg border border-white/10 bg-black/20 py-2 pl-9 pr-3 text-sm text-white outline-none transition focus:border-cyan-400/50"
          />
        </label>
      </div>

      {headerStatus ? (
        <SkeletonTable message={headerStatus} />
      ) : tournamentTeams.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/5 px-6 py-10 text-center text-white/70">
          No teams linked yet. Add existing teams from your organization.
        </div>
      ) : filteredTournamentTeams.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/5 px-6 py-10 text-center text-white/70">
          No teams match your search.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-slate-900/70 shadow-lg">
          <table className="min-w-full divide-y divide-white/10">
            <thead className="bg-white/5 text-left text-sm text-white/60">
              <tr>
                <th className="px-4 py-3">Logo</th>
                <th className="px-4 py-3">Team</th>
                <th className="px-4 py-3">Tag</th>
                <th className="px-4 py-3">Players</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10 text-sm text-white/90">
              {filteredTournamentTeams.map((t) => {
                const currentPlayers =
                  playerCountByTeamId[t.teamId] ??
                  (Array.isArray(t.players) ? t.players.length : 0);

                return (
                  <tr key={t.id} className="hover:bg-white/5">
                    <td className="px-4 py-2.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={ensureApiUrl(t.logoUrl) ?? "/assets/defaults/default-team.png"}
                        alt={t.name}
                        className="h-10 w-10 rounded-full object-cover ring-1 ring-white/10"
                      />
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-white">{t.name}</td>
                    <td className="px-4 py-2.5 text-white/70">{t.tag ?? "--"}</td>
                    <td className="px-4 py-2.5 text-white/70">
                      {currentPlayers} / {TEAM_MAX_PLAYERS}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-md bg-red-600/80 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
                        disabled={removeMutation.isPending}
                        onClick={() => removeMutation.mutate(t.teamId)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {removeMutation.isPending ? "Removing..." : "Remove"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 px-4 py-6 backdrop-blur-sm">
          <div className="flex min-h-full items-center justify-center">
            <div className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-[26px] border border-white/10 bg-[#0d1420] shadow-[0_32px_120px_rgba(0,0,0,0.55)]">
              <div className="px-5 pb-3 pt-5 sm:px-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                        Team Linker
                      </span>
                      <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold text-white/75">
                        {availableTeams.length} available
                      </span>
                      <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold text-white/75">
                        {selectedIds.length} selected
                      </span>
                      {searching && useServerSearch ? (
                        <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold text-white/55">
                          Searching...
                        </span>
                      ) : null}
                    </div>
                    <h2 className="mt-3 text-[30px] font-semibold leading-tight text-white">
                      Add existing teams
                    </h2>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-white/50">
                      Search organization teams, bulk-select visible results, and link them to this tournament.
                    </p>
                  </div>

                  <button
                    type="button"
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-white/55 transition hover:border-white/20 hover:bg-white/[0.07] hover:text-white"
                    onClick={closePicker}
                    aria-label="Close dialog"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 px-5 pb-4 sm:px-6">
                {availableTeams.length === 0 ? (
                  <div className="flex h-full min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-white/12 bg-white/[0.03] px-6 text-center text-white/70">
                    <Users className="h-10 w-10 text-white/25" />
                    <div className="mt-4 text-lg font-semibold text-white">
                      All organization teams are already linked
                    </div>
                    <p className="mt-2 max-w-md text-sm leading-6 text-white/55">
                      There are no remaining organization teams available to add to this tournament.
                    </p>
                  </div>
                ) : (
                  <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/8 bg-white/[0.035]">
                    <div className="px-4 pt-4 sm:px-5">
                      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <label className="relative block w-full xl:max-w-md">
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                          <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search by team name or tag"
                            className="h-11 w-full rounded-xl border border-white/10 bg-black/20 pl-10 pr-10 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-cyan-400/35"
                          />
                          {search ? (
                            <button
                              type="button"
                              onClick={() => setSearch("")}
                              className="absolute right-2.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white"
                              aria-label="Clear search"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </label>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setShowSelectedOnly((prev) => !prev)}
                            className={`rounded-xl border px-3.5 py-2 text-sm font-semibold transition ${
                              showSelectedOnly
                                ? "border-cyan-400/25 bg-cyan-500/10 text-cyan-100"
                                : "border-white/10 bg-white/[0.05] text-white/65 hover:border-white/16 hover:text-white"
                            }`}
                          >
                            {showSelectedOnly ? "Showing selected" : "Selected only"}
                          </button>
                          <button
                            type="button"
                            onClick={selectVisibleTeams}
                            disabled={visibleAvailableTeams.length === 0 || allVisibleSelected}
                            className="rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2 text-sm font-semibold text-white/65 transition hover:border-white/16 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Select visible
                          </button>
                          <button
                            type="button"
                            onClick={clearVisibleTeams}
                            disabled={visibleSelectedCount === 0}
                            className="rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2 text-sm font-semibold text-white/65 transition hover:border-white/16 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Clear selection
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-y border-white/[0.05] bg-white/[0.02] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35 sm:grid-cols-[auto_minmax(0,1fr)_100px_120px] sm:px-5">
                      <div className="col-span-2 flex items-center gap-3">
                        <span>Available Teams</span>
                        {resultsAreLimited ? (
                          <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-1 text-[10px] tracking-[0.14em] text-amber-100">
                            Showing first {LARGE_TEAM_PICKER_LIMIT}
                          </span>
                        ) : null}
                      </div>
                      <span className="hidden sm:block">Tag</span>
                      <span className="hidden sm:block">Players</span>
                    </div>

                    {resultsAreLimited ? (
                      <div className="border-b border-white/[0.05] bg-amber-500/10 px-4 py-2 text-xs text-amber-100 sm:px-5">
                        Too many teams to browse at once. Search to narrow results beyond the first{" "}
                        {LARGE_TEAM_PICKER_LIMIT}.
                      </div>
                    ) : null}

                    <div className="min-h-0 flex-1 overflow-y-auto">
                      {visibleAvailableTeams.length === 0 ? (
                        <div className="flex h-full min-h-52 flex-col items-center justify-center px-6 text-center text-white/70">
                          <Search className="h-10 w-10 text-white/25" />
                          <div className="mt-4 text-lg font-semibold text-white">
                            {showSelectedOnly && selectedIds.length === 0
                              ? "No selected teams yet"
                              : "No matching teams"}
                          </div>
                          <p className="mt-2 max-w-md text-sm leading-6 text-white/55">
                            {showSelectedOnly && selectedIds.length === 0
                              ? "Turn off the selected-only filter or choose teams from the full list."
                              : showSelectedOnly
                                ? "Adjust the search or clear the selected-only filter to see more teams."
                                : "Try a different search term to find teams."}
                          </p>
                        </div>
                      ) : (
                        visibleAvailableTeams.map((team, index) => {
                          const checked = selectedIdSet.has(team.id);
                          const playerCount = playerCountByTeamId[team.id] ?? 0;
                          const isLast = index === visibleAvailableTeams.length - 1;

                          return (
                            <label
                              key={team.id}
                              className={`grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-3 px-4 py-3 transition sm:grid-cols-[auto_minmax(0,1fr)_100px_120px] sm:px-5 ${
                                checked ? "bg-cyan-500/[0.12]" : "hover:bg-white/[0.03]"
                              } ${isLast ? "" : "border-b border-white/[0.05]"}`}
                            >
                              <input
                                type="checkbox"
                                className="mt-1 h-4 w-4 rounded border-white/20 bg-transparent accent-cyan-400"
                                checked={checked}
                                onChange={() => toggle(team.id)}
                              />

                              <div className="flex min-w-0 items-center gap-3">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={ensureApiUrl(team.logoUrl) ?? "/assets/defaults/default-team.png"}
                                  alt={team.name}
                                  className="h-10 w-10 rounded-full object-cover ring-1 ring-white/10"
                                />
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-white">
                                    {team.name}
                                  </div>
                                  <div className="mt-0.5 text-xs text-white/40">
                                    Team ID: {team.id}
                                  </div>
                                </div>
                              </div>

                              <div className="hidden self-center text-sm text-white/60 sm:block">
                                {team.tag ?? "--"}
                              </div>

                              <div className="hidden self-center text-sm text-white/60 sm:block">
                                {playerCount} / {TEAM_MAX_PLAYERS}
                              </div>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-white/[0.06] px-5 pb-5 pt-4 sm:px-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white">
                      {selectedIds.length} {selectedIds.length === 1 ? "team" : "teams"} selected
                    </div>
                    {selectedTeams.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {selectedTeams.slice(0, 6).map((team) => (
                          <span
                            key={team.id}
                            className="rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-xs text-white/65"
                          >
                            {team.tag || team.name}
                          </span>
                        ))}
                        {selectedTeams.length > 6 ? (
                          <span className="rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-xs text-white/45">
                            +{selectedTeams.length - 6} more
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mt-1 text-sm text-white/42">
                        Select one or more teams to link them to this tournament.
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-3">
                    <button
                      type="button"
                      className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/70 transition hover:border-white/20 hover:text-white"
                      onClick={closePicker}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={addMutation.isPending || selectedIds.length === 0}
                      onClick={() => addMutation.mutate(selectedIds)}
                      className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition hover:from-cyan-400 hover:to-blue-400 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
                    >
                      {addMutation.isPending ? "Linking..." : `Link Teams${selectedIds.length ? ` (${selectedIds.length})` : ""}`}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
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
            className="flex items-center gap-4 rounded-lg bg-white/5 px-3 py-3"
          >
            <div className="h-3 w-32 animate-pulse rounded bg-white/10" />
            <div className="h-3 w-16 animate-pulse rounded bg-white/10" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TeamsPage() {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <TeamsPageInner />
    </QueryClientProvider>
  );
}
