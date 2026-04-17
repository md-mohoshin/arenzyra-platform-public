"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  LayoutGrid,
  Plus,
  Swords,
  Trophy,
  UserRound,
  Users,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { AuthUser } from "@/types/arenzyra";

type MeUser = AuthUser & {
  actingOrgId?: string | null;
  actingOrgName?: string | null;
  organizationName?: string | null;
  actorRole?: AuthUser["role"] | null;
  isImpersonating?: boolean | null;
};

type MeResponse = {
  user: MeUser | null;
  organization?: {
    id: string | null;
    name: string | null;
  } | null;
};

type Tournament = {
  id: string;
  name: string;
  status?: string | null;
  liveState?: string | null;
  createdAt?: string | null;
  stagesCount?: number | null;
  teamsCount?: number | null;
};

type Team = {
  id: string;
  players?: { id: string }[] | null;
  _count?: {
    players?: number | null;
  } | null;
};

type MatchRow = {
  id: string;
  status?: string | null;
  liveState?: string | null;
};

export default function OrganizerLanding() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [meResult, tournamentsResult, teamsResult, matchesResult] =
      await Promise.allSettled([
        apiFetch("/auth/me", { cache: "no-store" }),
        apiFetch("/organizer/tournaments", { cache: "no-store" }),
        apiFetch("/organizer/teams", { cache: "no-store" }),
        apiFetch("/organizer/matches", { cache: "no-store" }),
      ]);

    let nextError: string | null = null;

    if (meResult.status === "fulfilled") {
      const payload = (await meResult.value.json()) as MeResponse;
      setMe(payload);
    } else {
      setMe(null);
      nextError = "Unable to load your current organizer session.";
    }

    if (tournamentsResult.status === "fulfilled") {
      const payload = await tournamentsResult.value.json();
      setTournaments(extractList<Tournament>(payload));
    } else {
      setTournaments([]);
      nextError = nextError ?? "Some dashboard data could not be loaded.";
    }

    if (teamsResult.status === "fulfilled") {
      const payload = await teamsResult.value.json();
      setTeams(extractList<Team>(payload));
    } else {
      setTeams([]);
      nextError = nextError ?? "Some dashboard data could not be loaded.";
    }

    if (matchesResult.status === "fulfilled") {
      const payload = await matchesResult.value.json();
      setMatches(extractList<MatchRow>(payload));
    } else {
      setMatches([]);
      nextError = nextError ?? "Some dashboard data could not be loaded.";
    }

    setError(nextError);
    setLoading(false);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void loadDashboard();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loadDashboard]);

  const effectiveOrgName =
    me?.user?.actingOrgName ??
    me?.organization?.name ??
    me?.user?.organizationName ??
    "Your organization";

  const playerCount = useMemo(
    () =>
      teams.reduce((total, team) => {
        if (typeof team._count?.players === "number") {
          return total + team._count.players;
        }
        if (!Array.isArray(team.players)) return total;
        return total + team.players.length;
      }, 0),
    [teams],
  );

  const statCards = [
    {
      label: "Tournaments",
      value: tournaments.length,
      icon: Trophy,
      accent: "from-cyan-500/20 to-cyan-500/5",
      description: "Production events under management.",
    },
    {
      label: "Teams",
      value: teams.length,
      icon: Users,
      accent: "from-blue-500/20 to-blue-500/5",
      description: "Registered rosters in the workspace.",
    },
    {
      label: "Matches",
      value: matches.length,
      icon: Swords,
      accent: "from-emerald-500/20 to-emerald-500/5",
      description: "Prepared or live match entries.",
    },
    {
      label: "Players",
      value: playerCount,
      icon: UserRound,
      accent: "from-fuchsia-500/20 to-fuchsia-500/5",
      description: "Players connected through teams.",
    },
  ];

  const controlPanelHref =
    matches.length > 0 ? `/organizer/matches/${matches[0].id}/control` : "/organizer/matches";

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/");
  };

  const recentTournaments = useMemo(() => {
    return tournaments.slice(0, 5).map((tournament) => ({
      name: tournament.name,
      stage:
        tournament.stagesCount && tournament.stagesCount > 0
          ? `${tournament.stagesCount} stage${tournament.stagesCount === 1 ? "" : "s"}`
          : "Setup pending",
      teams: tournament.teamsCount ?? 0,
      status: tournament.liveState ?? tournament.status ?? "DRAFT",
      created: formatDate(tournament.createdAt),
    }));
  }, [tournaments]);

  if (loading) {
    return <OverviewSkeleton />;
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <p className="text-sm text-white/60">Organizer</p>
          <h1 className="text-3xl font-bold text-white">Operations Dashboard</h1>
          <p className="max-w-3xl text-sm text-white/60">
            Monitor tournaments, teams, matches, and player activity for{" "}
            {effectiveOrgName}.
          </p>
          {me?.user?.actingOrgId ? (
            <div className="inline-flex rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
              Acting as {me.user.actingOrgName ?? me.user.actingOrgId}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-slate-950/65 px-5 py-3 text-sm font-medium text-cyan-50/90 transition hover:border-cyan-300/40 hover:bg-cyan-500/10 hover:text-white"
          >
            &larr; Back
          </button>
          <button
            type="button"
            onClick={() => void loadDashboard()}
            className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:border-white/20 hover:bg-white/10"
          >
            Refresh Overview
          </button>
        </div>
      </header>

      {error ? (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {error}
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((card) => (
          <MetricCard
            key={card.label}
            label={card.label}
            value={card.value}
            description={card.description}
            icon={card.icon}
            accent={card.accent}
          />
        ))}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Quick Actions</h2>
            <p className="mt-1 text-sm text-white/55">
              Jump into the core workflows used for tournament operations.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ActionLink
            href="/organizer/tournaments/create"
            label="Create Tournament"
            description="Set up a new competition structure."
            icon={Plus}
          />
          <ActionLink
            href="/organizer/teams"
            label="Manage Teams"
            description="Review rosters and team assets."
            icon={Users}
          />
          <ActionLink
            href="/organizer/matches"
            label="Manage Matches"
            description="Organize scheduled and live matches."
            icon={Swords}
          />
          <ActionLink
            href={controlPanelHref}
            label="Open Control Panel"
            description="Jump directly into match operations."
            icon={LayoutGrid}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Recent Tournaments</h2>
            <p className="mt-1 text-sm text-white/55">
              Recent production runs and tournament setups.
            </p>
          </div>
          <Link
            href="/organizer/tournaments"
            className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-300 transition hover:text-cyan-200"
          >
            View all
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {recentTournaments.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-6 py-12 text-center">
            <div className="text-lg font-semibold text-white">No tournaments created</div>
            <p className="mt-2 text-sm text-white/55">
              Create your first tournament to start managing operations from the
              dashboard.
            </p>
            <Link
              href="/organizer/tournaments/create"
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-950/25 transition hover:brightness-110"
            >
              <Plus className="h-4 w-4" />
              Create Tournament
            </Link>
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.24em] text-white/40">
                <tr>
                  <th className="pb-3 pr-4 font-medium">Name</th>
                  <th className="pb-3 pr-4 font-medium">Stage</th>
                  <th className="pb-3 pr-4 font-medium">Teams</th>
                  <th className="pb-3 pr-4 font-medium">Status</th>
                  <th className="pb-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {recentTournaments.map((tournament) => (
                  <tr
                    key={`${tournament.name}-${tournament.created}`}
                    className="border-t border-white/10"
                  >
                    <td className="py-4 pr-4 font-medium text-white">{tournament.name}</td>
                    <td className="py-4 pr-4 text-white/65">{tournament.stage}</td>
                    <td className="py-4 pr-4 text-white/65">{tournament.teams}</td>
                    <td className="py-4 pr-4">
                      <StatusBadge status={tournament.status} />
                    </td>
                    <td className="py-4 text-white/65">{tournament.created}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  description,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  description: string;
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
        <p className="text-sm text-white/50">{description}</p>
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

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toUpperCase();
  const className =
    normalized === "LIVE" || normalized === "ACTIVE" || normalized === "ONGOING"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
      : normalized === "COMPLETED" || normalized === "ENDED"
        ? "border-blue-500/20 bg-blue-500/10 text-blue-300"
        : "border-white/10 bg-white/5 text-white/70";

  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${className}`}
    >
      {status}
    </span>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="h-4 w-24 rounded bg-white/10" />
        <div className="h-10 w-72 rounded bg-white/10" />
        <div className="h-4 w-[28rem] max-w-full rounded bg-white/10" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <div
            key={item}
            className="rounded-2xl border border-white/10 bg-[#10151d] p-5"
          >
            <div className="h-3 w-24 rounded bg-white/10" />
            <div className="mt-4 h-10 w-16 rounded bg-white/10" />
            <div className="mt-4 h-3 w-36 rounded bg-white/10" />
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <div className="h-4 w-28 rounded bg-white/10" />
              <div className="mt-3 h-3 w-40 rounded bg-white/10" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function extractList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (!payload || typeof payload !== "object") return [];

  const record = payload as Record<string, unknown>;
  for (const key of ["data", "tournaments", "teams", "matches", "items"]) {
    if (Array.isArray(record[key])) {
      return record[key] as T[];
    }
  }

  return [];
}

function formatDate(value?: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
