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
import { apiFetch } from "@/lib/api";
import { useEffect } from "react";

type TournamentTeam = {
  id: string;
  teamId: string;
  name: string;
  tag?: string | null;
  logoUrl?: string | null;
  players?: { id: string }[] | null;
};

type OrgTeam = {
  id: string;
  name: string;
  tag?: string | null;
  logoUrl?: string | null;
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
      const res = await apiFetch(`/tournaments/${tournamentId}/teams`, {
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
      const res = await apiFetch(`/teams`, { cache: "no-store" });
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

  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
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
      const res = await apiFetch(`/teams?search=${q}`, { cache: "no-store" });
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

    return filtered.filter((t) => !existing.has(t.id));
  }, [orgTeams, searchedTeams, tournamentTeams, debouncedSearch, useServerSearch]);

  const addMutation = useMutation({
    mutationFn: async (teamIds: string[]) => {
      for (const teamId of teamIds) {
        await apiFetch(`/tournaments/${tournamentId}/teams`, {
          method: "POST",
          body: JSON.stringify({ teamId }),
        });
      }
    },
    onSuccess: async () => {
      setOpen(false);
      setSelectedIds([]);
      await qc.invalidateQueries({ queryKey: ["tournamentTeams", tournamentId] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (teamId: string) => {
      await apiFetch(`/tournaments/${tournamentId}/teams/${teamId}`, {
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
          onClick={() => setOpen(true)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-indigo-500 disabled:opacity-50"
          disabled={availableTeams.length === 0}
        >
          + Add Existing Teams
        </button>
      </div>

      {headerStatus ? (
        <SkeletonTable message={headerStatus} />
      ) : tournamentTeams.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/5 px-6 py-10 text-center text-white/70">
          No teams linked yet. Add existing teams from your organization.
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
              {tournamentTeams.map((t) => (
                <tr key={t.id} className="hover:bg-white/5">
                  <td className="px-4 py-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={t.logoUrl ?? "/assets/defaults/default-team.png"}
                      alt={t.name}
                      className="h-10 w-10 rounded-full object-cover ring-1 ring-white/10"
                    />
                  </td>
                  <td className="px-4 py-3 font-semibold text-white">{t.name}</td>
                  <td className="px-4 py-3 text-white/70">{t.tag ?? "—"}</td>
                  <td className="px-4 py-3 text-white/70">
                    {(t.players ?? []).length}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="rounded-md bg-red-600/80 px-3 py-1 text-xs font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
                      disabled={removeMutation.isPending}
                      onClick={() => removeMutation.mutate(t.teamId)}
                    >
                      {removeMutation.isPending ? "Removing..." : "Remove"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-2xl rounded-xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-white">Add Existing Teams</h2>
                  <p className="text-sm text-white/60">
                    Select one or more organization teams to link.
                </p>
              </div>
              <button
                className="text-white/60 hover:text-white"
                onClick={() => {
                  setOpen(false);
                  setSelectedIds([]);
                  setSearch("");
                }}
              >
                ✕
              </button>
            </div>

            <div className="mb-3">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search teams..."
                className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400"
              />
              {searching && useServerSearch ? (
                <div className="mt-1 text-xs text-white/60">Searching…</div>
              ) : null}
            </div>

            {availableTeams.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/15 bg-white/5 px-4 py-6 text-center text-white/70">
                All organization teams are already linked.
              </div>
            ) : (
              <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border border-white/10 bg-white/5 p-3">
                {availableTeams.map((team) => {
                  const checked = selectedIds.includes(team.id);
                  return (
                    <label
                      key={team.id}
                      className={`flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 transition hover:bg-white/5 ${
                        checked ? "bg-indigo-600/20 border border-indigo-500/40" : "border border-transparent"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={checked}
                          onChange={() => toggle(team.id)}
                        />
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={team.logoUrl ?? "/assets/defaults/default-team.png"}
                          alt={team.name}
                          className="h-8 w-8 rounded-full object-cover ring-1 ring-white/10"
                        />
                        <div className="text-white">
                          <div className="font-semibold">{team.name}</div>
                          <div className="text-xs text-white/60">{team.tag ?? "—"}</div>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white/70 hover:text-white"
                onClick={() => {
                  setOpen(false);
                  setSelectedIds([]);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={addMutation.isPending || selectedIds.length === 0}
                onClick={() => addMutation.mutate(selectedIds)}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-500 disabled:opacity-50"
              >
                {addMutation.isPending ? "Linking..." : "Link Teams"}
              </button>
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
