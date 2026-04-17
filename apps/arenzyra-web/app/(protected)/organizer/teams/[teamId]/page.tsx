"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import ConfirmDeleteModal from "@/components/common/ConfirmDeleteModal";
import { apiFetch } from "@/lib/api";
import {
  Alert,
  type Player,
  PlayerFormModal,
  type Team,
  dedupePlayers,
  resolveLogo,
  resolvePlayerUid,
  FALLBACK_PLAYER,
} from "../team-shared";

function TeamPlayersPageInner() {
  const params = useParams<{ teamId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const teamId = typeof params.teamId === "string" ? params.teamId : "";

  const [addPlayerOpen, setAddPlayerOpen] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [deletingPlayer, setDeletingPlayer] = useState<Player | null>(null);

  const {
    data: team,
    isLoading: teamLoading,
    isError: teamError,
    error: teamErrorValue,
  } = useQuery({
    queryKey: ["team", teamId],
    queryFn: async () => {
      const res = await apiFetch("/organizer/teams?scope=manual", {
        cache: "no-store",
      });
      const json = (await res.json()) as Team[] | { data?: Team[]; teams?: Team[] };
      const teams = Array.isArray(json)
        ? json
        : Array.isArray(json?.teams)
          ? json.teams
          : Array.isArray(json?.data)
            ? json.data
            : [];
      return teams.find((entry) => entry.id === teamId) ?? null;
    },
    enabled: teamId.length > 0,
  });

  const {
    data: players = [],
    isFetching: playersLoading,
    isError: playersError,
    error: playersErrorValue,
  } = useQuery({
    queryKey: ["teamPlayers", teamId],
    queryFn: async () => {
      const res = await apiFetch(`/organizer/teams/${teamId}/players`, {
        cache: "no-store",
      });
      const json = (await res.json()) as Player[] | { data?: Player[]; players?: Player[] };
      if (Array.isArray(json)) return json;
      if (Array.isArray(json?.players)) return json.players;
      if (Array.isArray(json?.data)) return json.data;
      return [];
    },
    enabled: teamId.length > 0,
  });

  const visiblePlayers = useMemo(() => dedupePlayers(players), [players]);
  const rosterFull = players.length >= 5;

  const uploadPlayerPhoto = async (playerId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    await apiFetch(`/organizer/players/${playerId}/photo`, {
      method: "POST",
      body: form,
    });
  };

  const addPlayerMutation = useMutation({
    mutationFn: async (payload: {
      teamId: string;
      ign: string;
      inGameId: string;
      realName?: string | null;
      role?: string | null;
      country?: string | null;
      photoFile?: File | null;
    }) => {
      const res = await apiFetch("/players", {
        method: "POST",
        body: JSON.stringify({
          teamId: payload.teamId,
          ign: payload.ign,
          inGameId: payload.inGameId,
          realName: payload.realName ?? null,
          role: payload.role ?? null,
          country: payload.country ?? null,
        }),
      });
      const created = (await res.json()) as { id: string };
      if (payload.photoFile) {
        await uploadPlayerPhoto(created.id, payload.photoFile);
      }
      return created;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["teamPlayers", teamId] });
      await qc.invalidateQueries({ queryKey: ["teams", "manual"] });
      setAddPlayerOpen(false);
    },
  });

  const editPlayerMutation = useMutation({
    mutationFn: async (payload: {
      playerId: string;
      ign: string;
      inGameId: string;
      realName?: string | null;
      role?: string | null;
      country?: string | null;
      photoFile?: File | null;
    }) => {
      await apiFetch(`/players/${payload.playerId}`, {
        method: "PATCH",
        body: JSON.stringify({
          ign: payload.ign,
          inGameId: payload.inGameId,
          realName: payload.realName ?? null,
          role: payload.role ?? null,
          country: payload.country ?? null,
        }),
      });
      if (payload.photoFile) {
        await uploadPlayerPhoto(payload.playerId, payload.photoFile);
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["teamPlayers", teamId] });
      await qc.invalidateQueries({ queryKey: ["teams", "manual"] });
      setEditingPlayer(null);
    },
  });

  const deletePlayerMutation = useMutation({
    mutationFn: async (playerId: string) => {
      await apiFetch(`/players/${playerId}`, { method: "DELETE" });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["teamPlayers", teamId] });
      await qc.invalidateQueries({ queryKey: ["teams", "manual"] });
      setDeletingPlayer(null);
    },
  });

  const handleBack = () => {
    router.push("/organizer/teams");
  };

  if (teamLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="h-8 w-48 rounded bg-white/10" />
            <div className="h-4 w-64 rounded bg-white/10" />
          </div>
          <div className="h-11 w-40 rounded-xl bg-white/10" />
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
          <div className="mb-3 text-sm text-white/60">Loading team roster...</div>
          <div className="space-y-3">
            {[1, 2, 3].map((row) => (
              <div
                key={row}
                className="flex items-center gap-4 rounded-lg bg-white/5 px-3 py-3.5"
              >
                <div className="h-16 w-12 animate-pulse bg-white/10" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-32 animate-pulse rounded bg-white/10" />
                  <div className="h-3 w-24 animate-pulse rounded bg-white/10" />
                </div>
                <div className="h-8 w-28 animate-pulse rounded bg-white/10" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (teamError || !team) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-white">Team Roster</h1>
            <p className="text-sm text-white/60">Open a team from the teams list to manage players.</p>
          </div>
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-slate-950/65 px-5 py-3 text-sm font-medium text-cyan-50/90 transition hover:border-cyan-300/40 hover:bg-cyan-500/10 hover:text-white"
          >
            &larr; Back
          </button>
        </div>
        <Alert
          message={
            teamError
              ? (teamErrorValue as Error)?.message ?? "Failed to load team."
              : "That team no longer exists or is not available in this organization."
          }
        />
      </div>
    );
  }

  const playerCount =
    typeof team._count?.players === "number"
      ? team._count.players
      : Array.isArray(team.players)
        ? team.players.length
        : players.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={resolveLogo(team.logoUrl)}
            alt={team.name}
            className="h-20 w-20 rounded-2xl object-cover ring-1 ring-white/10"
          />
          <div>
            <p className="text-sm text-white/45">Team Roster</p>
            <h1 className="text-3xl font-semibold text-white">{team.name}</h1>
            <p className="mt-1 text-sm text-white/60">
              {team.tag ? `[${team.tag}]` : "No tag"} · {playerCount}{" "}
              {playerCount === 1 ? "player" : "players"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-slate-950/65 px-5 py-3 text-sm font-medium text-cyan-50/90 transition hover:border-cyan-300/40 hover:bg-cyan-500/10 hover:text-white"
          >
            &larr; Back
          </button>
          <button
            type="button"
            onClick={() => {
              if (rosterFull) return;
              setAddPlayerOpen(true);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-950/30 transition hover:opacity-95 disabled:opacity-50"
            disabled={rosterFull}
          >
            <Plus className="h-4 w-4" />
            {rosterFull ? "Roster Full (5)" : "Add Player"}
          </button>
        </div>
      </div>

      {playersError ? <Alert message={(playersErrorValue as Error).message} /> : null}

      {playersLoading ? (
        <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
          <div className="mb-3 text-sm text-white/60">Loading roster...</div>
          <div className="space-y-3">
            {[1, 2, 3].map((row) => (
              <div
                key={row}
                className="flex items-center gap-4 rounded-lg bg-white/5 px-3 py-3.5"
              >
                <div className="h-12 w-12 animate-pulse rounded-lg bg-white/10" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-32 animate-pulse rounded bg-white/10" />
                  <div className="h-3 w-24 animate-pulse rounded bg-white/10" />
                </div>
                <div className="h-8 w-28 animate-pulse rounded bg-white/10" />
              </div>
            ))}
          </div>
        </div>
      ) : visiblePlayers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/5 px-6 py-10 text-center text-white/70">
          No players yet. Add the first player to this team.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-slate-900/70 shadow-lg">
          <table className="min-w-full divide-y divide-white/10">
            <thead className="bg-white/[0.06] text-left text-xs uppercase tracking-wider text-white/55">
              <tr>
                <th className="px-4 py-3.5 font-semibold">Player</th>
                <th className="px-4 py-3.5 font-semibold">PUBG UID</th>
                <th className="px-4 py-3.5 font-semibold">Role</th>
                <th className="px-4 py-3.5 font-semibold">Country</th>
                <th className="px-4 py-3.5 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10 text-sm text-white/90">
              {visiblePlayers.map((player) => (
                <tr key={player.id} className="transition hover:bg-white/5">
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={player.photoUrl ?? FALLBACK_PLAYER}
                        alt={player.ign}
                        className="h-16 w-12 object-contain drop-shadow-[0_8px_16px_rgba(0,0,0,0.35)]"
                      />
                      <div>
                        <div className="font-semibold text-white">{player.ign}</div>
                        <div className="text-xs text-white/55">
                          {player.realName?.trim() || "No real name set"}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-white/70">{resolvePlayerUid(player) ?? "—"}</td>
                  <td className="px-4 py-3.5 text-white/70">{player.role ?? "—"}</td>
                  <td className="px-4 py-3.5 text-white/70">{player.country ?? "—"}</td>
                  <td className="px-4 py-3.5">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingPlayer(player)}
                        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white/90 ring-1 ring-white/15 transition hover:bg-white/10"
                        disabled={editPlayerMutation.isPending}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingPlayer(player)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-red-600/80 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500 disabled:opacity-60"
                        disabled={deletePlayerMutation.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PlayerFormModal
        title="Add Player"
        open={addPlayerOpen}
        loading={addPlayerMutation.isPending}
        defaultValues={{
          ign: "",
          inGameId: "",
          realName: "",
          role: "",
          country: "",
          photoFile: null,
        }}
        error={addPlayerMutation.error as Error | null}
        onClose={() => setAddPlayerOpen(false)}
        onSubmit={(values) =>
          rosterFull
            ? Promise.reject(new Error("This team already has 5 players"))
            : addPlayerMutation.mutateAsync({
                teamId,
                ign: values.ign,
                inGameId: values.inGameId,
                realName: values.realName ?? null,
                role: values.role || null,
                country: values.country || null,
                photoFile: values.photoFile ?? null,
              })
        }
      />

      <PlayerFormModal
        title="Edit Player"
        open={!!editingPlayer}
        loading={editPlayerMutation.isPending}
        defaultValues={{
          ign: editingPlayer?.ign ?? "",
          inGameId: editingPlayer ? resolvePlayerUid(editingPlayer) ?? editingPlayer.inGameId ?? "" : "",
          realName: editingPlayer?.realName ?? "",
          role: editingPlayer?.role ?? "",
          country: editingPlayer?.country ?? "",
          photoUrl: editingPlayer?.photoUrl ?? null,
          photoFile: null,
        }}
        error={editPlayerMutation.error as Error | null}
        onClose={() => setEditingPlayer(null)}
        onSubmit={(values) =>
          editingPlayer
            ? editPlayerMutation.mutateAsync({
                playerId: editingPlayer.id,
                ign: values.ign,
                inGameId: values.inGameId,
                realName: values.realName ?? null,
                role: values.role || null,
                country: values.country || null,
                photoFile: values.photoFile ?? null,
              })
            : Promise.resolve()
        }
      />

      <ConfirmDeleteModal
        open={!!deletingPlayer}
        title="Delete player?"
        description={`This will remove ${deletingPlayer?.ign ?? "the player"}.`}
        loading={deletePlayerMutation.isPending}
        onClose={() => setDeletingPlayer(null)}
        onConfirm={() =>
          deletingPlayer
            ? deletePlayerMutation.mutateAsync(deletingPlayer.id)
            : Promise.resolve()
        }
      />
    </div>
  );
}

export default function TeamPlayersPage() {
  const [client] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={client}>
      <TeamPlayersPageInner />
    </QueryClientProvider>
  );
}
