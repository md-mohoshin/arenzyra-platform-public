"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import ConfirmDeleteModal from "@/components/common/ConfirmDeleteModal";
import {
  Building2,
  Eye,
  PencilLine,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { AppError } from "@/components/ui/AppError";
import { AppSkeleton } from "@/components/ui/AppSkeleton";

type Organization = {
  id: string;
  name: string;
  slug: string;
  status: string;
  kycStatus: string;
  createdAt: string;
  ownerEmail?: string | null;
  ownerName?: string | null;
  usersCount?: number | null;
};

type UserLookup = {
  id: string;
  email?: string | null;
};

type FilterKey = "ALL" | "APPROVED" | "PENDING" | "REJECTED";

const filterTabs: Array<{ key: FilterKey; label: string }> = [
  { key: "ALL", label: "All" },
  { key: "APPROVED", label: "Approved" },
  { key: "PENDING", label: "Pending" },
  { key: "REJECTED", label: "Rejected" },
];

function StatusBadge({ value }: { value: string }) {
  const normalized = value.toUpperCase();
  const base =
    "inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]";

  if (normalized === "APPROVED") {
    return (
      <span className={`${base} border-emerald-500/20 bg-emerald-500/10 text-emerald-300`}>
        {value}
      </span>
    );
  }

  if (normalized === "PENDING") {
    return (
      <span className={`${base} border-amber-500/20 bg-amber-500/10 text-amber-300`}>
        {value}
      </span>
    );
  }

  if (normalized === "REJECTED") {
    return (
      <span className={`${base} border-red-500/20 bg-red-500/10 text-red-300`}>
        {value}
      </span>
    );
  }

  return (
    <span className={`${base} border-white/10 bg-white/5 text-white/70`}>
      {value}
    </span>
  );
}

export default function OrganizationsPage() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createSlug, setCreateSlug] = useState("");
  const [createOwnerEmail, setCreateOwnerEmail] = useState("");
  const [createStatus, setCreateStatus] = useState("APPROVED");
  const [createKycStatus, setCreateKycStatus] = useState("PENDING");
  const [slugTouched, setSlugTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterKey>("ALL");
  const [pendingDeleteOrg, setPendingDeleteOrg] = useState<Organization | null>(null);
  const [deletingOrgId, setDeletingOrgId] = useState<string | null>(null);

  async function load() {
    try {
      const res = await apiFetch("/super/organizations", {
        cache: "no-store",
      });
      const json = (await res.json()) as { data: Organization[] };
      setOrgs(json.data ?? []);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to load organizations");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function resetCreateForm() {
    setCreateName("");
    setCreateSlug("");
    setCreateOwnerEmail("");
    setCreateStatus("APPROVED");
    setCreateKycStatus("PENDING");
    setCreateError(null);
    setSlugTouched(false);
  }

  async function resolveOwnerUserId() {
    const normalizedEmail = createOwnerEmail.trim().toLowerCase();
    if (!normalizedEmail) return undefined;

    const res = await apiFetch("/super/managed-users", { cache: "no-store" });
    const json = await res.json();
    const users: UserLookup[] = (Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json)
        ? json
        : json?.users ?? []) as UserLookup[];

    const match = users.find(
      (user) => user.email?.trim().toLowerCase() === normalizedEmail,
    );

    if (!match?.id) {
      throw new Error("Owner email does not match an existing user.");
    }

    return match.id;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const ownerUserId = await resolveOwnerUserId();
      await apiFetch("/super/organizations", {
        method: "POST",
        body: JSON.stringify({
          name: createName,
          slug: createSlug || undefined,
          ownerUserId,
        }),
      });
      resetCreateForm();
      setCreateOpen(false);
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create organization");
    } finally {
      setCreating(false);
    }
  }

  async function confirmDeleteOrganization() {
    if (!pendingDeleteOrg) return;

    setError(null);
    setDeletingOrgId(pendingDeleteOrg.id);
    try {
      await apiFetch(`/super/organizers/${pendingDeleteOrg.id}`, {
        method: "DELETE",
        body: JSON.stringify({
          reason: "Super admin deleted organization from Organizations page",
        }),
      });
      setPendingDeleteOrg(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete organization");
    } finally {
      setDeletingOrgId(null);
    }
  }

  const counts = useMemo(
    () => ({
      ALL: orgs.length,
      APPROVED: orgs.filter((org) => org.status?.toUpperCase() === "APPROVED").length,
      PENDING: orgs.filter((org) => org.status?.toUpperCase() === "PENDING").length,
      REJECTED: orgs.filter((org) => org.status?.toUpperCase() === "REJECTED").length,
    }),
    [orgs],
  );

  const filteredOrgs = useMemo(() => {
    const query = search.trim().toLowerCase();

    return orgs.filter((org) => {
      const matchesFilter =
        activeFilter === "ALL" ? true : org.status?.toUpperCase() === activeFilter;

      const matchesSearch =
        query.length === 0
          ? true
          : [org.name, org.slug, org.ownerEmail ?? "", org.ownerName ?? ""]
              .join(" ")
              .toLowerCase()
              .includes(query);

      return matchesFilter && matchesSearch;
    });
  }, [activeFilter, orgs, search]);

  if (loading) {
    return <AppSkeleton lines={8} />;
  }

  if (error) {
    return <AppError message={error} onRetry={() => void load()} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm text-white/60">Super Admin</p>
          <h1 className="text-3xl font-bold">Organizations</h1>
          <p className="mt-1 text-sm text-white/60">
            Review onboarding status, KYC progress, and organization access from
            a single admin workspace.
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-950/40 transition hover:brightness-110"
        >
          <Plus className="h-4 w-4" />
          Create Organization
        </button>
      </div>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/20 py-3 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-cyan-400/40"
              placeholder="Search organizations..."
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
                  {tab.label}{" "}
                  <span className="ml-1 text-white/45">{counts[tab.key]}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border border-white/10">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-[0.22em] text-white/40">
                <tr>
                  <th className="px-5 py-4 font-medium">Organization</th>
                  <th className="px-5 py-4 font-medium">Owner Email</th>
                  <th className="px-5 py-4 font-medium">Status</th>
                  <th className="px-5 py-4 font-medium">KYC</th>
                  <th className="px-5 py-4 font-medium">Users Count</th>
                  <th className="px-5 py-4 font-medium">Created At</th>
                  <th className="px-5 py-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrgs.map((org) => (
                  <tr
                    key={org.id}
                    className="border-t border-white/10 transition hover:bg-white/[0.03]"
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-cyan-300">
                          {getInitials(org.name)}
                        </div>
                        <div>
                          <div className="font-medium text-white">{org.name}</div>
                          <div className="mt-1 text-xs uppercase tracking-[0.18em] text-white/40">
                            {org.slug}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-white/65">
                      {org.ownerEmail ?? "Not assigned"}
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge value={org.status} />
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge value={org.kycStatus} />
                    </td>
                    <td className="px-5 py-4 text-white/65">
                      {typeof org.usersCount === "number" ? org.usersCount : "-"}
                    </td>
                    <td className="px-5 py-4 text-white/60">
                      {org.createdAt
                        ? new Date(org.createdAt).toLocaleDateString()
                        : "N/A"}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <Link
                          href={`/super-admin/organizations/${org.id}`}
                          className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:border-white/20 hover:bg-white/10"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          View
                        </Link>
                        <Link
                          href={`/super-admin/organizations/${org.id}`}
                          className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:border-cyan-400/35 hover:bg-cyan-400/15"
                        >
                          <PencilLine className="h-3.5 w-3.5" />
                          Edit
                        </Link>
                        <button
                          type="button"
                          onClick={() => setPendingDeleteOrg(org)}
                          disabled={deletingOrgId === org.id}
                          className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-200 transition hover:border-rose-500/35 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {deletingOrgId === org.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredOrgs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <Building2 className="h-5 w-5 text-white/45" />
              </div>
              <div>
                <div className="font-medium text-white">No organizations found</div>
                <div className="mt-1 text-sm text-white/55">
                  Adjust your search or filter selection to see more results.
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {createOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-xl border border-white/10 bg-[#111827] p-6 shadow-2xl shadow-black/40">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Create Organization</h2>
                <p className="mt-1 text-sm text-white/55">
                  Configure the organization profile and review default onboarding
                  states before creation.
                </p>
              </div>
              <button
                onClick={() => {
                  resetCreateForm();
                  setCreateOpen(false);
                }}
                className="text-sm text-white/70 hover:text-white"
              >
                Close
              </button>
            </div>

            <form className="mt-6 space-y-5" onSubmit={handleCreate}>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="text-white/70">Organization Name</span>
                  <input
                    required
                    value={createName}
                    onChange={(e) => {
                      const nextName = e.target.value;
                      setCreateName(nextName);
                      if (!slugTouched) {
                        setCreateSlug(toSlug(nextName));
                      }
                    }}
                    className="w-full rounded-lg border border-white/15 bg-black px-3 py-2.5"
                    placeholder="Organization name"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-white/70">Slug</span>
                  <input
                    value={createSlug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setCreateSlug(toSlug(e.target.value));
                    }}
                    className="w-full rounded-lg border border-white/15 bg-black px-3 py-2.5"
                    placeholder="friendly-url"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-white/70">Owner Email</span>
                  <input
                    type="email"
                    value={createOwnerEmail}
                    onChange={(e) => setCreateOwnerEmail(e.target.value)}
                    className="w-full rounded-lg border border-white/15 bg-black px-3 py-2.5"
                    placeholder="owner@organization.gg"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-white/70">Status</span>
                  <select
                    value={createStatus}
                    onChange={(e) => setCreateStatus(e.target.value)}
                    className="w-full rounded-lg border border-white/15 bg-black px-3 py-2.5"
                  >
                    <option value="APPROVED">Approved</option>
                    <option value="PENDING">Pending</option>
                    <option value="SUSPENDED">Suspended</option>
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-white/70">KYC Status</span>
                  <select
                    value={createKycStatus}
                    onChange={(e) => setCreateKycStatus(e.target.value)}
                    className="w-full rounded-lg border border-white/15 bg-black px-3 py-2.5"
                  >
                    <option value="PENDING">Pending</option>
                    <option value="VERIFIED">Verified</option>
                    <option value="REJECTED">Rejected</option>
                  </select>
                </label>
                <div className="rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/55">
                  Current create flow keeps backend defaults unchanged. New
                  organizations are created with platform-defined status and KYC
                  values, while owner email is resolved to an existing user on the
                  client.
                </div>
              </div>

              {createError ? (
                <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {createError}
                </div>
              ) : null}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    resetCreateForm();
                    setCreateOpen(false);
                  }}
                  className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/70 hover:text-white"
                  disabled={creating}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                >
                  {creating ? "Creating..." : "Create Organization"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <ConfirmDeleteModal
        open={pendingDeleteOrg !== null}
        title="Delete organization?"
        description={
          pendingDeleteOrg
            ? `This will soft-delete ${pendingDeleteOrg.name} and suspend its access.`
            : ""
        }
        loading={pendingDeleteOrg ? deletingOrgId === pendingDeleteOrg.id : false}
        onClose={() => {
          if (!deletingOrgId) {
            setPendingDeleteOrg(null);
          }
        }}
        onConfirm={confirmDeleteOrganization}
        confirmLabel="Delete Organization"
        loadingLabel="Deleting..."
      />
    </div>
  );
}

function getInitials(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) return "VX";
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function toSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}
