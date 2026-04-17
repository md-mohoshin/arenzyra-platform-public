"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
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
  type Team,
  TeamFormModal,
  resolveLogo,
  isLiveMappingTeam,
  SkeletonTable,
} from "./team-shared";

function TeamsPageInner() {
  const router = useRouter();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);
  const [deleting, setDeleting] = useState<Team | null>(null);

  const { data: teams = [], isLoading, isError, error } = useQuery({
    queryKey: ["teams", "manual"],
    queryFn: async () => {
      const res = await apiFetch("/organizer/teams?scope=manual", {
        cache: "no-store",
      });
      const json = (await res.json()) as Team[] | { data?: Team[]; teams?: Team[] };
      if (Array.isArray(json)) return json;
      if (Array.isArray(json?.teams)) return json.teams;
      if (Array.isArray(json?.data)) return json.data;
      return [];
    },
  });

  const manualTeams = useMemo(
    () => teams.filter((team) => !isLiveMappingTeam(team)),
    [teams],
  );

  const uploadLogo = async (teamId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    await apiFetch(`/organizer/teams/${teamId}/logo`, {
      method: "POST",
      body: form,
    });
  };

  const createMutation = useMutation({
    mutationFn: async (payload: { name: string; tag?: string | null; logoFile?: File | null }) => {
      const res = await apiFetch("/organizer/teams", {
        method: "POST",
        body: JSON.stringify({ name: payload.name, tag: payload.tag ?? null }),
      });
      const created = (await res.json()) as Team;
      if (payload.logoFile) {
        await uploadLogo(created.id, payload.logoFile);
      }
      return created;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["teams", "manual"] });
      setCreateOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: {
      id: string;
      name: string;
      tag?: string | null;
      logoFile?: File | null;
    }) => {
      const res = await apiFetch(`/organizer/teams/${payload.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: payload.name, tag: payload.tag ?? null }),
      });
      const updated = (await res.json()) as Team;
      if (payload.logoFile) {
        await uploadLogo(payload.id, payload.logoFile);
      }
      return updated;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["teams", "manual"] });
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/organizer/teams/${id}`, { method: "DELETE" });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["teams", "manual"] });
      setDeleting(null);
    },
  });

  const headerStatus = useMemo(() => {
    if (isLoading) return "Loading teams...";
    if (isError) return (error as Error)?.message ?? "Failed to load teams";
    return null;
  }, [error, isError, isLoading]);

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
          <h1 className="text-3xl font-semibold text-white">Teams</h1>
          <p className="text-sm text-white/60">Manage teams for your organization.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/20 bg-slate-950/65 px-4 py-2 text-sm font-medium text-cyan-50/90 transition hover:border-cyan-300/40 hover:bg-cyan-500/10 hover:text-white"
          >
            &larr; Back
          </button>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-950/30 transition hover:opacity-95 disabled:opacity-50"
            disabled={createMutation.isPending}
          >
            <Plus className="h-4 w-4" />
            Create Team
          </button>
        </div>
      </div>

      {headerStatus ? (
        <SkeletonTable message={headerStatus} />
      ) : manualTeams.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/5 px-6 py-10 text-center text-white/70">
          No teams yet. Create your first team.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-slate-900/70 shadow-lg">
          <table className="min-w-full divide-y divide-white/10">
            <thead className="bg-white/[0.06] text-left text-xs uppercase tracking-wider text-white/55">
              <tr>
                <th className="px-4 py-3.5 font-semibold">Team</th>
                <th className="px-4 py-3.5 font-semibold">Tag</th>
                <th className="px-4 py-3.5 font-semibold">Players</th>
                <th className="px-4 py-3.5 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10 text-sm text-white/90">
              {manualTeams.map((team) => {
                const playerCount =
                  typeof team._count?.players === "number"
                    ? team._count.players
                    : Array.isArray(team.players)
                      ? team.players.length
                      : 0;
                const logo = resolveLogo(team.logoUrl);

                return (
                  <tr key={team.id} className="transition hover:bg-white/5">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={logo}
                          alt={team.name}
                          className="h-10 w-10 rounded-full object-cover ring-1 ring-white/10"
                        />
                        <span className="font-semibold text-white">{team.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-white/70">
                      {team.tag ? (
                        <span className="inline-flex rounded border border-white/15 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-white/80">
                          [{team.tag}]
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-white/70">
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <Users className="h-3.5 w-3.5 text-white/45" />
                        <span>
                          {playerCount} {playerCount === 1 ? "Player" : "Players"}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex justify-end gap-2">
                        <Link
                          href={`/organizer/teams/${team.id}`}
                          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-cyan-100 ring-1 ring-cyan-400/20 transition hover:bg-cyan-500/10"
                        >
                          <Users className="h-3.5 w-3.5" />
                          Players
                        </Link>
                        <button
                          type="button"
                          onClick={() => setEditing(team)}
                          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white/90 ring-1 ring-white/15 transition hover:bg-white/10"
                          disabled={updateMutation.isPending}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleting(team)}
                          className="inline-flex items-center gap-1.5 rounded-md bg-red-600/80 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500 disabled:opacity-60"
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <TeamFormModal
        title="Create Team"
        open={createOpen}
        loading={createMutation.isPending}
        defaultValues={{ name: "", tag: "", logoFile: null }}
        error={createMutation.error as Error | null}
        onClose={() => setCreateOpen(false)}
        onSubmit={(values) =>
          createMutation.mutateAsync({
            name: values.name,
            tag: values.tag ?? null,
            logoFile: values.logoFile ?? null,
          })
        }
      />

      <TeamFormModal
        title="Edit Team"
        open={!!editing}
        loading={updateMutation.isPending}
        defaultValues={{
          name: editing?.name ?? "",
          tag: editing?.tag ?? "",
          logoUrl: editing?.logoUrl ?? null,
          logoFile: null,
        }}
        error={updateMutation.error as Error | null}
        onClose={() => setEditing(null)}
        onSubmit={(values) =>
          editing
            ? updateMutation.mutateAsync({
                id: editing.id,
                name: values.name,
                tag: values.tag ?? null,
                logoFile: values.logoFile ?? null,
              })
            : Promise.resolve()
        }
      />

      <ConfirmDeleteModal
        open={!!deleting}
        title="Delete team?"
        description={`This will remove ${deleting?.name ?? "the team"} and its roster links.`}
        loading={deleteMutation.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleting ? deleteMutation.mutateAsync(deleting.id) : Promise.resolve()
        }
      />
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
