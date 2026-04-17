"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Link2, Trash2, Users } from "lucide-react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import ConfirmDeleteModal from "@/components/common/ConfirmDeleteModal";
import { apiFetch, ensureApiUrl } from "@/lib/api";

type Team = {
  id: string;
  name: string;
  tag: string | null;
  logoUrl: string | null;
  _count?: {
    players?: number | null;
  } | null;
};

const FALLBACK_LOGO = "/assets/defaults/default-team.png";

const resolveLogo = (url?: string | null) =>
  ensureApiUrl(url) ?? FALLBACK_LOGO;
const isLiveMappingTeam = (team: Team) => team.name.startsWith("[LIVE] ");

const extractSlotLabel = (name: string) => {
  const match = /Slot\s+(\d+)/i.exec(name);
  return match ? `Slot ${match[1]}` : "--";
};

const extractMatchLabel = (name: string) => {
  const match = /^\[LIVE\]\s+([^\s]+)\s+Slot\s+\d+/i.exec(name);
  return match?.[1] ?? "--";
};

const extractSlotTag = (name: string) => {
  const match = /Slot\s+(\d+)/i.exec(name);
  if (!match) return null;
  const slotNumber = Number(match[1]);
  if (!Number.isFinite(slotNumber) || slotNumber <= 0) return null;
  return `S${String(Math.trunc(slotNumber)).padStart(2, "0")}`;
};

function SkeletonTable({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
      <div className="mb-3 text-sm text-white/60">{message}</div>
      <div className="space-y-2">
        {[1, 2, 3].map((row) => (
          <div
            key={row}
            className="flex items-center gap-4 rounded-lg bg-white/5 px-3 py-3.5"
          >
            <div className="h-10 w-10 animate-pulse rounded-full bg-white/10" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-40 animate-pulse rounded bg-white/10" />
              <div className="h-3 w-20 animate-pulse rounded bg-white/10" />
            </div>
            <div className="h-3 w-16 animate-pulse rounded bg-white/10" />
            <div className="h-3 w-12 animate-pulse rounded bg-white/10" />
            <div className="h-8 w-24 animate-pulse rounded bg-white/10" />
          </div>
        ))}
      </div>
    </div>
  );
}

function LiveMappingPageInner() {
  const router = useRouter();
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState<Team | null>(null);

  const { data: teams = [], isLoading, isError, error } = useQuery({
    queryKey: ["teams", "live-mapping"],
    queryFn: async () => {
      const res = await apiFetch("/organizer/teams?scope=live-mapping", {
        cache: "no-store",
      });
      const json = (await res.json()) as Team[] | { data?: Team[]; teams?: Team[] };
      if (Array.isArray(json)) return json;
      if (Array.isArray(json?.teams)) return json.teams;
      if (Array.isArray(json?.data)) return json.data;
      return [];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/organizer/teams/${id}`, { method: "DELETE" });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["teams", "live-mapping"] });
      setDeleting(null);
    },
  });

  const liveMappingTeams = useMemo(
    () => teams.filter((team) => isLiveMappingTeam(team)),
    [teams],
  );

  const headerStatus = useMemo(() => {
    if (isLoading) return "Loading live mapping teams...";
    if (isError) return (error as Error)?.message ?? "Failed to load live mapping teams";
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-white">Live Mapping</h1>
          <p className="text-sm text-white/60">
            Auto-created live placeholder teams are stored here and excluded from normal Teams.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-slate-950/65 px-4 py-2 text-sm font-medium text-cyan-50/90 transition hover:border-cyan-300/40 hover:bg-cyan-500/10 hover:text-white"
          >
            &larr; Back
          </button>
          <div className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
            <Link2 className="h-4 w-4" />
            Auto Assign
          </div>
        </div>
      </div>

      {headerStatus ? (
        <SkeletonTable message={headerStatus} />
      ) : liveMappingTeams.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/5 px-6 py-10 text-center text-white/70">
          No live mapping teams yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-slate-900/70 shadow-lg">
          <table className="min-w-full divide-y divide-white/10">
            <thead className="bg-white/[0.06] text-left text-xs uppercase tracking-wider text-white/55">
              <tr>
                <th className="px-4 py-3.5 font-semibold">Team</th>
                <th className="px-4 py-3.5 font-semibold">Tag</th>
                <th className="px-4 py-3.5 font-semibold">Match</th>
                <th className="px-4 py-3.5 font-semibold">Slot</th>
                <th className="px-4 py-3.5 font-semibold">Players</th>
                <th className="px-4 py-3.5 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10 text-sm text-white/90">
              {liveMappingTeams.map((team) => {
                const playerCount =
                  typeof team._count?.players === "number" ? team._count.players : 0;
                return (
                  <tr key={team.id} className="transition hover:bg-white/5">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={resolveLogo(team.logoUrl)}
                          alt={team.name}
                          className="h-10 w-10 rounded-full object-cover ring-1 ring-white/10"
                        />
                        <div className="space-y-1">
                          <div className="font-semibold text-white">{team.name}</div>
                          <div className="text-[11px] uppercase tracking-[0.16em] text-cyan-300/80">
                            Placeholder
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-white/80">
                      <span className="inline-flex min-w-[54px] items-center justify-center rounded-md border border-cyan-400/20 bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
                        {team.tag ?? extractSlotTag(team.name) ?? "--"}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-white/70">{extractMatchLabel(team.name)}</td>
                    <td className="px-4 py-3.5 text-white/70">{extractSlotLabel(team.name)}</td>
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

      <ConfirmDeleteModal
        open={!!deleting}
        title="Delete live mapping team?"
        description={`This will remove ${deleting?.name ?? "the placeholder team"}.`}
        loading={deleteMutation.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleting ? deleteMutation.mutateAsync(deleting.id) : Promise.resolve()
        }
      />
    </div>
  );
}

export default function LiveMappingPage() {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <LiveMappingPageInner />
    </QueryClientProvider>
  );
}
