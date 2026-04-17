"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  LayoutGrid,
  Swords,
  Trophy,
  UserRound,
  Users,
} from "lucide-react";
import { ApiError, apiFetch, ensureApiUrl } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { CopyButton } from "@/components/ui/CopyButton";
import {
  fetchMatchControlSnapshotMap,
  isControlFinalized,
  isControlFinalizing,
  isControlLive,
  type MatchRuntimeControlSnapshot,
} from "@/features/matches/match-control-runtime";

type TournamentGroup = {
  id: string;
  name: string;
};

type TournamentStage = {
  id: string;
  name: string;
  groups: TournamentGroup[];
};

type TournamentDetail = {
  id: string;
  name: string;
  status?: string | null;
  liveState?: string | null;
  logoUrl?: string | null;
  stages?: TournamentStage[];
  matches?: Array<{ id: string }>;
};

type MatchRow = {
  id: string;
};

type TournamentTeamLink = {
  id?: string;
  teamId?: string;
  team?: {
    id?: string;
    name?: string | null;
  } | null;
};

type OrganizerTeam = {
  id: string;
  players?: { id: string }[] | null;
  _count?: {
    players?: number | null;
  } | null;
};

type OrganizerStageGroup = {
  id: string;
  matchCount?: number | null;
  matches?: { id: string }[] | null;
  _count?: {
    matches?: number | null;
  } | null;
};

type OrganizerStage = {
  id: string;
  matchCount?: number | null;
  groups?: OrganizerStageGroup[] | null;
};

type TournamentResult =
  | { status: 200; data: TournamentDetail }
  | { status: number; message?: string };

const FALLBACK_LOGO = "/assets/defaults/default-team.png";

function statusBadge(matchControls: Record<string, MatchRuntimeControlSnapshot>) {
  const controls = Object.values(matchControls);

  if (controls.some((control) => isControlLive(control))) {
    return {
      label: "Live",
      className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    };
  }

  if (controls.some((control) => isControlFinalizing(control))) {
    return {
      label: "Finalizing",
      className: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    };
  }

  if (controls.some((control) => isControlFinalized(control))) {
    return {
      label: "Finalized",
      className: "border-fuchsia-500/20 bg-fuchsia-500/10 text-fuchsia-300",
    };
  }

  return {
    label: "Draft",
    className: "border-white/10 bg-white/5 text-white/70",
  };
}

async function fetchTournament(tournamentId: string): Promise<TournamentResult> {
  try {
    const res = await apiFetch(`/organizer/tournaments/${tournamentId}`, {
      cache: "no-store",
    });
    const data = (await res.json()) as TournamentDetail;
    return { status: 200, data };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 404) return { status: 404 };
      if (err.status === 403) return { status: 403 };
      return { status: err.status, message: err.body || err.message };
    }

    return {
      status: 500,
      message: err instanceof Error ? err.message : "Failed to load tournament",
    };
  }
}

async function fetchList<T>(path: string, keys: string[]): Promise<T[]> {
  try {
    const res = await apiFetch(path, { cache: "no-store" });
    const json = await res.json();
    return extractList<T>(json, keys);
  } catch {
    return [];
  }
}

export default function TournamentOverviewClient({
  tournamentId,
}: {
  tournamentId: string;
}) {
  const [loading, setLoading] = useState(true);
  const [tournamentResult, setTournamentResult] = useState<TournamentResult>({
    status: 500,
  });
  const [tournamentTeams, setTournamentTeams] = useState<TournamentTeamLink[]>([]);
  const [organizerTeams, setOrganizerTeams] = useState<OrganizerTeam[]>([]);
  const [tournamentMatches, setTournamentMatches] = useState<MatchRow[]>([]);
  const [organizerStages, setOrganizerStages] = useState<OrganizerStage[]>([]);
  const [matchControls, setMatchControls] = useState<
    Record<string, MatchRuntimeControlSnapshot>
  >({});

  useEffect(() => {
    let cancelled = false;

    async function loadTournament() {
      setLoading(true);

      const [
        nextTournamentResult,
        nextTournamentTeams,
        nextOrganizerTeams,
        nextTournamentMatches,
        nextOrganizerStages,
      ] = await Promise.all([
        fetchTournament(tournamentId),
        fetchList<TournamentTeamLink>(`/org/me/tournaments/${tournamentId}/teams`, [
          "teams",
          "data",
          "items",
        ]),
        fetchList<OrganizerTeam>("/organizer/teams", ["teams", "data", "items"]),
        fetchList<MatchRow>(`/me/tournaments/${tournamentId}/matches`, [
          "matches",
          "data",
          "items",
        ]),
        fetchList<OrganizerStage>(`/organizer/tournaments/${tournamentId}/stages`, [
          "data",
          "stages",
          "items",
        ]),
      ]);

      if (cancelled) return;

      const nextMatchControls = await fetchMatchControlSnapshotMap(
        nextTournamentMatches.map((match) => match.id),
      );
      if (cancelled) return;

      setTournamentResult(nextTournamentResult);
      setTournamentTeams(nextTournamentTeams);
      setOrganizerTeams(nextOrganizerTeams);
      setTournamentMatches(nextTournamentMatches);
      setOrganizerStages(nextOrganizerStages);
      setMatchControls(nextMatchControls);
      setLoading(false);
    }

    void loadTournament();

    return () => {
      cancelled = true;
    };
  }, [tournamentId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-10 w-48 rounded-2xl bg-white/5" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="h-32 rounded-2xl border border-white/10 bg-white/5"
            />
          ))}
        </div>
      </div>
    );
  }

  if (tournamentResult.status === 404) {
    return (
      <EmptyState
        title="Tournament not found"
        description="This tournament does not exist or was removed."
        actionLabel="Back to list"
        actionHref="/organizer/tournaments"
      />
    );
  }

  if (tournamentResult.status === 403) {
    return (
      <EmptyState
        title="Access denied"
        description="You do not have permission to view this tournament."
        actionLabel="Back to list"
        actionHref="/organizer/tournaments"
      />
    );
  }

  if (!("data" in tournamentResult)) {
    return (
      <EmptyState
        title="Unable to load tournament"
        description={tournamentResult.message ?? "Unexpected error occurred."}
        actionLabel="Back to list"
        actionHref="/organizer/tournaments"
      />
    );
  }

  const tournament = tournamentResult.data;
  const stages = Array.isArray(tournament.stages) ? tournament.stages : [];
  const stageCount = stages.length;
  const groupCount = stages.reduce(
    (total, stage) =>
      total + (Array.isArray(stage.groups) ? stage.groups.length : 0),
    0,
  );
  const stagedMatchCount = organizerStages.reduce((total, stage) => {
    if (typeof stage.matchCount === "number") return total + stage.matchCount;
    if (!Array.isArray(stage.groups)) return total;

    return (
      total +
      stage.groups.reduce(
        (sum, group) =>
          sum +
          (group.matchCount ??
            group._count?.matches ??
            group.matches?.length ??
            0),
        0,
      )
    );
  }, 0);
  const recentMatches =
    tournamentMatches.length > 0
      ? tournamentMatches
      : Array.isArray(tournament.matches)
        ? tournament.matches
        : [];
  const matchCount = Math.max(
    tournamentMatches.length,
    stagedMatchCount,
    Array.isArray(tournament.matches) ? tournament.matches.length : 0,
  );

  const teamIds = new Set(
    tournamentTeams
      .map((entry) => entry.teamId ?? entry.team?.id ?? null)
      .filter((value): value is string => Boolean(value)),
  );

  const teamCount = teamIds.size;
  const playerCount = organizerTeams.reduce((total, team) => {
    if (!teamIds.has(team.id)) return total;
    if (typeof team._count?.players === "number") {
      return total + team._count.players;
    }
    return total + (Array.isArray(team.players) ? team.players.length : 0);
  }, 0);

  const status = statusBadge(matchControls);
  const controlHref =
    recentMatches.length > 0
      ? `/organizer/matches/${recentMatches[0].id}/control`
      : `/organizer/tournaments/${tournamentId}/matches`;

  const statCards = [
    {
      label: "Teams",
      value: teamCount,
      icon: Users,
      accent: "from-cyan-500/20 to-cyan-500/5",
    },
    {
      label: "Matches",
      value: matchCount,
      icon: Swords,
      accent: "from-blue-500/20 to-blue-500/5",
    },
    {
      label: "Stages",
      value: stageCount,
      icon: Trophy,
      accent: "from-emerald-500/20 to-emerald-500/5",
    },
    {
      label: "Groups",
      value: groupCount,
      icon: LayoutGrid,
      accent: "from-amber-500/20 to-amber-500/5",
    },
    {
      label: "Players",
      value: playerCount,
      icon: UserRound,
      accent: "from-fuchsia-500/20 to-fuchsia-500/5",
    },
  ];

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-3">
          <p className="text-sm text-white/55">Tournament Overview</p>
          <div className="flex flex-wrap items-center gap-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={ensureApiUrl(tournament.logoUrl) ?? FALLBACK_LOGO}
                alt={tournament.name || "Tournament logo"}
                className="h-14 w-14 rounded-xl object-cover"
              />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">{tournament.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${status.className}`}
                >
                  {status.label}
                </span>
              </div>
            </div>
          </div>
          <p className="max-w-3xl text-sm text-white/60">
            Command center for tournament structure, teams, match flow, and live
            production access.
          </p>
        </div>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-5 xl:min-w-[360px]">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/40">
            Tournament ID
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <code className="break-all rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-amber-200">
              {tournament.id}
            </code>
            <CopyButton text={tournament.id} label="Copy ID" />
          </div>
        </section>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {statCards.map((card) => (
          <MetricCard
            key={card.label}
            label={card.label}
            value={card.value}
            icon={card.icon}
            accent={card.accent}
          />
        ))}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Quick Actions</h2>
              <p className="mt-1 text-sm text-white/55">
                Launch the next operational task for this tournament.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <ActionLink
              href={`/organizer/tournaments/${tournamentId}/teams`}
              label="Add Team"
              description="Assign teams into the tournament pool."
              icon={Users}
            />
            <ActionLink
              href={`/organizer/tournaments/${tournamentId}/stages`}
              label="Create Stage"
              description="Build stages and tournament structure."
              icon={Trophy}
            />
            <ActionLink
              href={`/organizer/tournaments/${tournamentId}/matches`}
              label="Create Match"
              description="Manage or create tournament matches."
              icon={Swords}
            />
            <ActionLink
              href={controlHref}
              label="Open Control Panel"
              description="Jump directly into live control tools."
              icon={LayoutGrid}
            />
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-semibold text-white">Tournament Snapshot</h2>
          <p className="mt-1 text-sm text-white/55">
            High-level structure and access summary for this event.
          </p>

          <div className="mt-6 space-y-3">
            <SnapshotRow label="Teams assigned" value={String(teamCount)} />
            <SnapshotRow label="Matches scheduled" value={String(matchCount)} />
            <SnapshotRow label="Stage count" value={String(stageCount)} />
            <SnapshotRow label="Group count" value={String(groupCount)} />
            <SnapshotRow label="Players linked" value={String(playerCount)} />
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: typeof Trophy;
  accent: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#10151d]">
      <div className={`h-1 bg-gradient-to-r ${accent}`} />
      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-white/45">
              {label}
            </p>
            <p className="mt-3 text-3xl font-bold text-white">{value}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <Icon className="h-5 w-5 text-cyan-300" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionLink({
  href,
  label,
  description,
  icon: Icon,
}: {
  href: string;
  label: string;
  description: string;
  icon: typeof Trophy;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/20 px-5 py-4 transition hover:border-cyan-400/30 hover:bg-white/5"
    >
      <div className="flex items-center gap-4">
        <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/10 p-3">
          <Icon className="h-5 w-5 text-cyan-300" />
        </div>
        <div>
          <div className="font-semibold text-white">{label}</div>
          <div className="mt-1 text-sm text-white/55">{description}</div>
        </div>
      </div>
      <ArrowRight className="h-5 w-5 shrink-0 text-white/35" />
    </Link>
  );
}

function SnapshotRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <span className="text-sm text-white/60">{label}</span>
      <span className="text-sm font-semibold text-white">{value}</span>
    </div>
  );
}

function extractList<T>(payload: unknown, keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (!payload || typeof payload !== "object") return [];

  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    if (Array.isArray(record[key])) {
      return record[key] as T[];
    }
  }

  return [];
}
