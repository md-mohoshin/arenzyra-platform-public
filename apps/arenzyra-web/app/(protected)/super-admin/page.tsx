"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Building2,
  Database,
  FileText,
  Radio,
  Server,
  ShieldAlert,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { AppSkeleton } from "@/components/ui/AppSkeleton";
import { AppError } from "@/components/ui/AppError";

type OrgRow = {
  id: string;
  status?: string | null;
  kycStatus?: string | null;
};

type SummaryStats = {
  tournaments?: number | null;
};

type StatusTone = "online" | "warning" | "offline";

const systemStatuses: Array<{
  label: string;
  state: StatusTone;
  detail: string;
  icon: typeof Server;
}> = [
  { label: "API Server", state: "online", detail: "Operational", icon: Server },
  { label: "WebSocket", state: "online", detail: "Connected", icon: Radio },
  { label: "Database", state: "online", detail: "Healthy", icon: Database },
  { label: "Telemetry Feed", state: "online", detail: "Receiving", icon: Activity },
];

const recentOrganizations = [
  {
    organization: "Nova Circuit",
    ownerEmail: "ops@novacircuit.gg",
    status: "Approved",
    createdAt: "Mar 04, 2026",
  },
  {
    organization: "Apex Broadcast",
    ownerEmail: "admin@apexbroadcast.gg",
    status: "Pending",
    createdAt: "Mar 03, 2026",
  },
  {
    organization: "Storm Arena",
    ownerEmail: "owner@stormarena.gg",
    status: "Approved",
    createdAt: "Mar 01, 2026",
  },
  {
    organization: "Rift Masters",
    ownerEmail: "hello@riftmasters.gg",
    status: "Review",
    createdAt: "Feb 27, 2026",
  },
];

const activityItems = [
  {
    title: "Organization created",
    detail: "Nova Circuit was added to the platform workspace.",
    time: "8 minutes ago",
  },
  {
    title: "User created",
    detail: "A new admin account was provisioned for Apex Broadcast.",
    time: "21 minutes ago",
  },
  {
    title: "Tournament created",
    detail: "Spring Invitational was initialized for operations setup.",
    time: "48 minutes ago",
  },
  {
    title: "KYC approved",
    detail: "Storm Arena verification moved to approved status.",
    time: "1 hour ago",
  },
  {
    title: "Organization created",
    detail: "Rift Masters entered the onboarding review queue.",
    time: "2 hours ago",
  },
];

export default function SuperAdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({
    totalOrgs: 0,
    approvedOrgs: 0,
    pendingKyc: 0,
    totalUsers: 0,
    totalTournaments: 0,
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [orgRes, userRes, summaryRes] = await Promise.all([
        apiFetch("/super/organizations", { cache: "no-store" }),
        apiFetch("/super/users", { cache: "no-store" }),
        apiFetch("/super/metrics/summary", { cache: "no-store" }),
      ]);

      const orgJson = await orgRes.json();
      const userJson = await userRes.json();
      const summaryJson = (await summaryRes.json()) as SummaryStats;

      const orgs: OrgRow[] = Array.isArray(orgJson?.data)
        ? orgJson.data
        : Array.isArray(orgJson)
          ? orgJson
          : [];

      const users = Array.isArray(userJson?.data)
        ? userJson.data
        : Array.isArray(userJson?.users)
          ? userJson.users
          : Array.isArray(userJson)
            ? userJson
            : [];

      const totalOrgs = orgs.length;
      const approvedOrgs = orgs.filter(
        (organization) => (organization.status ?? "").toUpperCase() === "APPROVED",
      ).length;
      const pendingKyc = orgs.filter(
        (organization) => (organization.kycStatus ?? "").toUpperCase() === "PENDING",
      ).length;

      setStats({
        totalOrgs,
        approvedOrgs,
        pendingKyc,
        totalUsers: users.length,
        totalTournaments:
          typeof summaryJson?.tournaments === "number" ? summaryJson.tournaments : 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const statCards = [
    {
      label: "Organizations",
      value: stats.totalOrgs,
      icon: Building2,
      accent: "from-cyan-500/20 to-cyan-500/5",
    },
    {
      label: "Approved Organizations",
      value: stats.approvedOrgs,
      icon: BadgeCheck,
      accent: "from-emerald-500/20 to-emerald-500/5",
    },
    {
      label: "Pending Verification",
      value: stats.pendingKyc,
      icon: ShieldAlert,
      accent: "from-amber-500/20 to-amber-500/5",
    },
    {
      label: "Total Users",
      value: stats.totalUsers,
      icon: Users,
      accent: "from-blue-500/20 to-blue-500/5",
    },
    {
      label: "Active Tournaments",
      value: stats.totalTournaments,
      icon: Trophy,
      accent: "from-fuchsia-500/20 to-fuchsia-500/5",
    },
  ];

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <p className="text-sm text-white/60">Super Admin</p>
          <h1 className="text-3xl font-bold">Platform Command Center</h1>
          <p className="max-w-3xl text-sm text-white/60">
            Monitor organization growth, onboarding health, and platform
            operations from a single control surface.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:border-white/20 hover:bg-white/10"
        >
          Refresh Overview
        </button>
      </header>

      {loading ? (
        <AppSkeleton lines={10} />
      ) : error ? (
        <AppError message={error} onRetry={load} />
      ) : (
        <>
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

          <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">System Status</h2>
                  <p className="mt-1 text-sm text-white/55">
                    Core service health across the platform.
                  </p>
                </div>
                <div className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300">
                  All Online
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {systemStatuses.map((item) => (
                  <StatusRow
                    key={item.label}
                    label={item.label}
                    state={item.state}
                    detail={item.detail}
                    icon={item.icon}
                  />
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <div>
                <h2 className="text-lg font-semibold text-white">Quick Actions</h2>
                <p className="mt-1 text-sm text-white/55">
                  Jump into the most common platform administration tasks.
                </p>
              </div>

              <div className="mt-6 grid gap-4">
                <ActionLink
                  href="/super-admin/organizations"
                  label="Create Organization"
                  description="Open the organization management workspace."
                  icon={Building2}
                />
                <ActionLink
                  href="/super-admin/users"
                  label="Create User"
                  description="Provision admins and operators across organizations."
                  icon={UserPlus}
                />
                <ActionLink
                  href="/super-admin/applications"
                  label="Review Applications"
                  description="Approve or reject organizer workspace requests."
                  icon={FileText}
                />
                <ActionLink
                  href="#recent-activity"
                  label="View Audit Logs"
                  description="Review the latest administrative changes and events."
                  icon={FileText}
                />
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    Recent Organizations
                  </h2>
                  <p className="mt-1 text-sm text-white/55">
                    Recently onboarded organizations entering the platform.
                  </p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/45">
                  Preview Data
                </span>
              </div>

              <div className="mt-6 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-[0.24em] text-white/40">
                    <tr>
                      <th className="pb-3 pr-4 font-medium">Organization</th>
                      <th className="pb-3 pr-4 font-medium">Owner Email</th>
                      <th className="pb-3 pr-4 font-medium">Status</th>
                      <th className="pb-3 font-medium">Created At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentOrganizations.map((organization) => (
                      <tr
                        key={`${organization.organization}-${organization.ownerEmail}`}
                        className="border-t border-white/10"
                      >
                        <td className="py-4 pr-4 font-medium text-white">
                          {organization.organization}
                        </td>
                        <td className="py-4 pr-4 text-white/65">
                          {organization.ownerEmail}
                        </td>
                        <td className="py-4 pr-4">
                          <StatusBadge status={organization.status} />
                        </td>
                        <td className="py-4 text-white/65">{organization.createdAt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div
              id="recent-activity"
              className="rounded-2xl border border-white/10 bg-white/5 p-6"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Recent Activity</h2>
                  <p className="mt-1 text-sm text-white/55">
                    Example operational events across the admin surface.
                  </p>
                </div>
                <div className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-cyan-300">
                  Live Feed
                </div>
              </div>

              <div className="mt-6 space-y-4">
                {activityItems.map((item) => (
                  <div
                    key={`${item.title}-${item.time}`}
                    className="flex items-start gap-4 rounded-2xl border border-white/10 bg-black/20 p-4"
                  >
                    <div className="mt-1 rounded-full bg-cyan-500/15 p-2">
                      <Activity className="h-4 w-4 text-cyan-300" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-white">{item.title}</p>
                        <span className="text-xs uppercase tracking-[0.2em] text-white/35">
                          {item.time}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-white/60">{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}
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
  icon: typeof Building2;
  accent: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#10151d]">
      <div className={`h-1 bg-gradient-to-r ${accent}`} />
      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-white/45">
              {label}
            </p>
            <p className="mt-3 text-3xl font-bold text-white">{value}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <Icon className="h-5 w-5 text-cyan-300" />
          </div>
        </div>
        <p className="text-sm text-white/50">Live command center summary.</p>
      </div>
    </div>
  );
}

function StatusRow({
  label,
  state,
  detail,
  icon: Icon,
}: {
  label: string;
  state: StatusTone;
  detail: string;
  icon: typeof Server;
}) {
  const stateClass =
    state === "online"
      ? "bg-emerald-400"
      : state === "warning"
        ? "bg-amber-400"
        : "bg-red-400";

  const stateText =
    state === "online" ? "Online" : state === "warning" ? "Warning" : "Offline";

  return (
    <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="rounded-xl border border-white/10 bg-white/5 p-2">
          <Icon className="h-4 w-4 text-cyan-300" />
        </div>
        <div>
          <div className="font-medium text-white">{label}</div>
          <div className="text-sm text-white/55">{detail}</div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm font-medium text-white/75">
        <span className={`h-2.5 w-2.5 rounded-full ${stateClass}`} />
        {stateText}
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
  icon: typeof Building2;
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
    normalized === "APPROVED"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
      : normalized === "PENDING"
        ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
        : "border-blue-500/20 bg-blue-500/10 text-blue-300";

  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${className}`}
    >
      {status}
    </span>
  );
}
