"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Clock3,
  FileText,
  RefreshCcw,
  Search,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { AppError } from "@/components/ui/AppError";
import { AppSkeleton } from "@/components/ui/AppSkeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { apiFetch, getApiErrorMessage } from "@/lib/api";
import type { OrganizationApplication } from "@/lib/auth";

type FilterKey = "ALL" | "PENDING" | "APPROVED" | "REJECTED";

const filterTabs: Array<{ key: FilterKey; label: string }> = [
  { key: "ALL", label: "All" },
  { key: "PENDING", label: "Pending" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
];

export default function SuperAdminApplicationsPage() {
  const [applications, setApplications] = useState<OrganizationApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterKey>("ALL");
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<OrganizationApplication | null>(
    null,
  );
  const [rejectReason, setRejectReason] = useState("");

  const loadApplications = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent) {
        setLoading(true);
      }

      setError(null);

      try {
        const res = await apiFetch("/super/applications", { cache: "no-store" });
        const json = (await res.json()) as
          | { data?: OrganizationApplication[] }
          | OrganizationApplication[];

        const list = Array.isArray(json)
          ? json
          : Array.isArray(json?.data)
            ? json.data
            : [];

        setApplications(list);
      } catch (err) {
        setError(getApiErrorMessage(err, "Failed to load applications"));
        setApplications([]);
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    void loadApplications();
  }, [loadApplications]);

  const counts = useMemo(
    () => ({
      ALL: applications.length,
      PENDING: applications.filter((item) => item.status === "PENDING").length,
      APPROVED: applications.filter((item) => item.status === "APPROVED").length,
      REJECTED: applications.filter((item) => item.status === "REJECTED").length,
    }),
    [applications],
  );

  const filteredApplications = useMemo(() => {
    const query = search.trim().toLowerCase();

    return applications.filter((application) => {
      const matchesFilter =
        activeFilter === "ALL" ? true : application.status === activeFilter;

      const matchesSearch =
        query.length === 0
          ? true
          : [
              application.name,
              application.applicantName,
              application.email,
              application.rejectionReason ?? "",
            ]
              .join(" ")
              .toLowerCase()
              .includes(query);

      return matchesFilter && matchesSearch;
    });
  }, [activeFilter, applications, search]);

  async function handleApprove(application: OrganizationApplication) {
    setActionBusyId(application.id);
    setActionError(null);
    setActionMessage(null);

    try {
      await apiFetch(`/super/applications/${application.id}/approve`, {
        method: "POST",
      });
      setActionMessage(`Approved ${application.name}.`);
      await loadApplications({ silent: true });
    } catch (err) {
      setActionError(getApiErrorMessage(err, "Failed to approve application"));
    } finally {
      setActionBusyId(null);
    }
  }

  async function handleRejectSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!rejectTarget) {
      return;
    }

    setActionBusyId(rejectTarget.id);
    setActionError(null);
    setActionMessage(null);

    try {
      const reason = rejectReason.trim();
      await apiFetch(`/super/applications/${rejectTarget.id}/reject`, {
        method: "POST",
        body: JSON.stringify(reason ? { reason } : {}),
      });
      setActionMessage(`Rejected ${rejectTarget.name}.`);
      setRejectTarget(null);
      setRejectReason("");
      await loadApplications({ silent: true });
    } catch (err) {
      setActionError(getApiErrorMessage(err, "Failed to reject application"));
    } finally {
      setActionBusyId(null);
    }
  }

  const statCards = [
    {
      label: "Total Applications",
      value: counts.ALL,
      icon: FileText,
      accent: "from-cyan-500/20 to-cyan-500/5",
    },
    {
      label: "Pending Review",
      value: counts.PENDING,
      icon: Clock3,
      accent: "from-amber-500/20 to-amber-500/5",
    },
    {
      label: "Approved",
      value: counts.APPROVED,
      icon: BadgeCheck,
      accent: "from-emerald-500/20 to-emerald-500/5",
    },
    {
      label: "Rejected",
      value: counts.REJECTED,
      icon: XCircle,
      accent: "from-rose-500/20 to-rose-500/5",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm text-white/60">Super Admin</p>
          <h1 className="text-3xl font-bold">Applications</h1>
          <p className="mt-1 max-w-3xl text-sm text-white/60">
            Review organization creation requests before provisioning owner
            accounts and organization workspaces.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadApplications()}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:border-white/20 hover:bg-white/10"
        >
          <RefreshCcw className="h-4 w-4" />
          Refresh Applications
        </button>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

      {actionMessage ? (
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {actionMessage}
        </div>
      ) : null}

      {actionError ? <AppError message={actionError} /> : null}

      <section className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/20 py-3 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-cyan-400/40"
              placeholder="Search applications..."
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {filterTabs.map((tab) => {
              const isActive = activeFilter === tab.key;

              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveFilter(tab.key)}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                    isActive
                      ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-300"
                      : "border-white/10 bg-white/5 text-white/65 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {tab.label}
                  <span className="ml-1 text-white/45">{counts[tab.key]}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border border-white/10">
          {loading ? (
            <div className="p-6">
              <AppSkeleton lines={10} />
            </div>
          ) : error ? (
            <div className="p-6">
              <AppError message={error} onRetry={() => void loadApplications()} />
            </div>
          ) : filteredApplications.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No applications found"
                description="Adjust your search or filters to review more requests."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-white/5 text-xs uppercase tracking-[0.22em] text-white/40">
                  <tr>
                    <th className="px-5 py-4 font-medium">Organization</th>
                    <th className="px-5 py-4 font-medium">Applicant</th>
                    <th className="px-5 py-4 font-medium">Email</th>
                    <th className="px-5 py-4 font-medium">Status</th>
                    <th className="px-5 py-4 font-medium">Timeline</th>
                    <th className="px-5 py-4 font-medium">Review Note</th>
                    <th className="px-5 py-4 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredApplications.map((application) => {
                    const isPending = application.status === "PENDING";
                    const isBusy = actionBusyId === application.id;

                    return (
                      <tr
                        key={application.id}
                        className="border-t border-white/10 align-top transition hover:bg-white/[0.03]"
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-cyan-300">
                              {getInitials(application.name)}
                            </div>
                            <div>
                              <div className="font-medium text-white">
                                {application.name}
                              </div>
                              <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-white/35">
                                {application.id.slice(0, 8)}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="font-medium text-white">
                            {application.applicantName}
                          </div>
                          <div className="mt-1 text-sm text-white/50">
                            Requested owner account
                          </div>
                        </td>
                        <td className="px-5 py-4 text-white/70">
                          {application.email}
                        </td>
                        <td className="px-5 py-4">
                          <StatusBadge status={application.status} />
                        </td>
                        <td className="px-5 py-4 text-white/65">
                          <div>{formatDate(application.createdAt)}</div>
                          <div className="mt-1 text-xs text-white/40">
                            Updated {formatDate(application.updatedAt)}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          {application.rejectionReason ? (
                            <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                              {application.rejectionReason}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-sm text-white/45">
                              <ShieldAlert className="h-4 w-4 text-white/30" />
                              {isPending
                                ? "Waiting for review"
                                : application.status === "APPROVED"
                                  ? "Provisioned successfully"
                                  : "No rejection reason provided"}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          {isPending ? (
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void handleApprove(application)}
                                disabled={isBusy}
                                className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {isBusy ? "Working..." : "Approve"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setActionError(null);
                                  setActionMessage(null);
                                  setRejectTarget(application);
                                  setRejectReason("");
                                }}
                                disabled={isBusy}
                                className="inline-flex items-center justify-center rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Reject
                              </button>
                            </div>
                          ) : (
                            <div className="text-xs uppercase tracking-[0.18em] text-white/35">
                              Finalized
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {rejectTarget ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#111827] p-6 shadow-2xl shadow-black/40">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm text-white/60">Reject application</div>
                <h2 className="mt-1 text-xl font-semibold text-white">
                  {rejectTarget.name}
                </h2>
                <p className="mt-2 text-sm text-white/55">
                  Add a reason so the rejection is clearly documented for admin
                  review history.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setRejectTarget(null);
                  setRejectReason("");
                }}
                className="text-sm text-white/70 transition hover:text-white"
              >
                Close
              </button>
            </div>

            <form className="mt-6 space-y-5" onSubmit={handleRejectSubmit}>
              <label className="block space-y-2 text-sm">
                <span className="font-medium text-white/75">Rejection reason</span>
                <textarea
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none transition placeholder:text-white/30 focus:border-rose-400/45"
                  placeholder="Missing verification details or approval criteria."
                />
              </label>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setRejectTarget(null);
                    setRejectReason("");
                  }}
                  className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/70 transition hover:text-white"
                  disabled={actionBusyId === rejectTarget.id}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionBusyId === rejectTarget.id}
                  className="rounded-lg bg-rose-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-400 disabled:opacity-60"
                >
                  {actionBusyId === rejectTarget.id ? "Rejecting..." : "Reject"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
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
  icon: typeof FileText;
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
        <p className="text-sm text-white/50">Application review queue summary.</p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const className =
    status === "APPROVED"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
      : status === "PENDING"
        ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
        : "border-rose-500/20 bg-rose-500/10 text-rose-300";

  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${className}`}
    >
      {status}
    </span>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function getInitials(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) {
    return "VX";
  }

  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}
