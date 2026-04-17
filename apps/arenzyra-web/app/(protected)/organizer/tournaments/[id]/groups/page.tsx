"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";

type Group = {
  id: string;
  name?: string | null;
  createdAt?: string | null;
  stageId?: string;
  stageName?: string;
  order?: number | null;
};

type StageWithGroups = {
  id: string;
  name: string;
  order?: number | null;
  groups?: Array<{ id: string; name?: string | null; createdAt?: string | null }>;
};

export default function TournamentGroupsPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = params?.id;

  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tournamentId) return;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/organizer/tournaments/${tournamentId}/stages`, {
          cache: "no-store",
        });
        const json = await res.json();
        const stages: StageWithGroups[] = Array.isArray(json?.data)
          ? json.data
          : Array.isArray(json)
            ? json
            : json?.stages ?? [];

        const flat = stages.flatMap((s) =>
          (s.groups ?? []).map((g, idx) => ({
            id: g.id,
            name: g.name,
            createdAt: g.createdAt,
            stageId: s.id,
            stageName: s.name,
            order: idx + 1,
          })),
        );
        setGroups(flat);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load groups");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [tournamentId]);

  const sorted = useMemo(
    () =>
      [...groups].sort((a, b) => {
        const sa = a.stageName ?? "";
        const sb = b.stageName ?? "";
        if (sa !== sb) return sa.localeCompare(sb);
        const ao = a.order ?? 0;
        const bo = b.order ?? 0;
        if (ao !== bo) return ao - bo;
        return (a.name ?? "").localeCompare(b.name ?? "");
      }),
    [groups],
  );

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Groups</h1>
          <p className="text-sm text-white/60">All groups across stages.</p>
        </div>
        <Link
          href="#"
          className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-500"
        >
          + Create Group
        </Link>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white/70">Loading groups...</div>
      ) : error ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-100">{error}</div>
      ) : sorted.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-10 text-center text-white/60">
          No groups yet.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sorted.map((g) => (
            <Link
              key={g.id}
              href={`/organizer/tournaments/${tournamentId}/groups/${g.id}`}
              className="group block rounded-2xl border border-white/10 bg-white/5 p-5 shadow-sm transition hover:border-indigo-400/60 hover:shadow-lg hover:shadow-indigo-500/10"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-lg font-semibold text-white">{g.name ?? "Group"}</div>
                  <div className="text-sm text-white/60">Stage: {g.stageName ?? "—"}</div>
                </div>
                <span className="text-xs text-white/50">Order: {g.order ?? 0}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
