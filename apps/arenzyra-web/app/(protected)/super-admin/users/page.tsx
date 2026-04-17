"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import ConfirmDeleteModal from "@/components/common/ConfirmDeleteModal";
import type { AuthUser } from "@/types/arenzyra";
import {
  ChevronDown,
  Copy,
  KeyRound,
  Plus,
  RotateCcw,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { CreateUserModal } from "./CreateUserModal";

type Role = AuthUser["role"];
type UserView = "current" | "deleted";

type UserRow = {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: Role | null;
  status?: string | null;
  organizationId?: string | null;
  organization?: { id?: string | null; name?: string | null } | null;
  createdAt?: string | null;
  deletedAt?: string | null;
};

type Organization = { id: string; name: string | null };
type PendingUserAction =
  | { type: "delete"; user: UserRow }
  | { type: "restore"; user: UserRow }
  | null;
type ResetPasswordResult = {
  user: UserRow;
  password: string | null;
  generated: boolean;
};

// Backend DTO for managed users only allows ADMIN | ORGANIZER.
const ROLE_OPTIONS: Role[] = ["ADMIN", "ORGANIZER"];
const USER_VIEW_OPTIONS: Array<{ value: UserView; label: string }> = [
  { value: "current", label: "Current" },
  { value: "deleted", label: "Deleted" },
];

export default function SuperAdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [userView, setUserView] = useState<UserView>("current");

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [, setOrgsLoading] = useState(false);
  const [, setOrgsError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string | null>>({});
  const [pendingUserAction, setPendingUserAction] = useState<PendingUserAction>(null);
  const [resetPasswordTarget, setResetPasswordTarget] = useState<UserRow | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetPasswordLoading, setResetPasswordLoading] = useState(false);
  const [resetPasswordError, setResetPasswordError] = useState<string | null>(null);
  const [resetPasswordResult, setResetPasswordResult] =
    useState<ResetPasswordResult | null>(null);
  const [passwordCopied, setPasswordCopied] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (userView === "deleted") {
        params.set("status", "DELETED");
      }
      const query = params.toString();

      const res = await apiFetch(
        query ? `/super/users?${query}` : "/super/users",
        { cache: "no-store" },
      );
      const json = await res.json();
      const list: UserRow[] = (Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json)
          ? json
          : json?.users ?? []) as UserRow[];

      const normalized = list.map((user) => {
        const orgId = (user as unknown as { organizationId?: string }).organizationId;
        const orgName = (user as unknown as { organizationName?: string }).organizationName;
        return {
          ...user,
          organization:
            user.organization ??
            (orgId
              ? {
                  id: orgId,
                  name: orgName ?? null,
                }
              : null),
        };
      });

      setUsers(normalized);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load users.");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [userView]);

  const loadOrgs = useCallback(async () => {
    setOrgsLoading(true);
    setOrgsError(null);
    try {
      const res = await apiFetch("/super/organizations", { cache: "no-store" });
      const json = await res.json();
      const list: Organization[] = Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json?.organizations)
          ? json.organizations
          : Array.isArray(json)
            ? json
            : [];
      setOrgs(list);
    } catch (err) {
      setOrgsError(err instanceof Error ? err.message : "Unable to load organizations.");
      setOrgs([]);
    } finally {
      setOrgsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
    void loadOrgs();
  }, [loadUsers, loadOrgs]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter((user) => {
      const haystack =
        `${user.name ?? ""} ${user.email ?? ""} ${user.role ?? ""} ${user.organization?.name ?? ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [search, users]);

  const userStats = useMemo(
    () => [
      {
        label: "Total Users",
        value: users.length,
        icon: Users,
        accent: "from-cyan-500/20 to-cyan-500/5",
      },
      {
        label: "Admins",
        value: users.filter((user) => user.role === "ADMIN").length,
        icon: ShieldCheck,
        accent: "from-blue-500/20 to-blue-500/5",
      },
      {
        label: "Organizers",
        value: users.filter((user) => user.role === "ORGANIZER").length,
        icon: UserRound,
        accent: "from-emerald-500/20 to-emerald-500/5",
      },
      {
        label: "Super Admins",
        value: users.filter((user) => user.role === "SUPER_ADMIN").length,
        icon: Shield,
        accent: "from-fuchsia-500/20 to-fuchsia-500/5",
      },
    ],
    [users],
  );

  const setBusy = (id: string, busy: boolean) =>
    setRowBusy((prev) => ({ ...prev, [id]: busy }));

  const setRowErr = (id: string, message: string | null) =>
    setRowError((prev) => ({ ...prev, [id]: message }));

  function resetCreateForm() {
    setCreateOpen(false);
    setCreateName("");
    setCreateEmail("");
    setCreatePassword("");
    setShowPassword(false);
    setCreateError(null);
  }

  const handleCreate = async () => {
    setCreateLoading(true);
    setCreateError(null);
    try {
      const res = await apiFetch("/super/users", {
        method: "POST",
        body: JSON.stringify({
          email: createEmail,
          password: createPassword,
          role: "ORGANIZER",
        }),
      });
      const json = await res.json();
      const newUserId: string | undefined =
        json?.id ?? json?.user?.id ?? json?.data?.id;

      if (!newUserId) {
        throw new Error("User created but id missing in response.");
      }

      resetCreateForm();
      if (userView === "deleted") {
        setUserView("current");
      } else {
        await loadUsers();
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setCreateError(err.body || `Request failed (${err.status})`);
      } else {
        setCreateError(err instanceof Error ? err.message : "Failed to create user.");
      }
    } finally {
      setCreateLoading(false);
    }
  };

  const handleRoleChange = async (id: string, role: Role) => {
    setBusy(id, true);
    setRowErr(id, null);
    try {
      await apiFetch(`/super/users/${id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      await loadUsers();
    } catch (err) {
      setRowErr(
        id,
        err instanceof ApiError
          ? err.body || `Failed to update role (${err.status})`
          : err instanceof Error
            ? err.message
            : "Failed to update role.",
      );
    } finally {
      setBusy(id, false);
    }
  };

  const handleOrgChange = async (id: string, organizationId: string) => {
    setBusy(id, true);
    setRowErr(id, null);
    try {
      await apiFetch(`/super/users/${id}/org`, {
        method: "PATCH",
        body: JSON.stringify({
          orgId: organizationId || null,
          reason: "Super admin reassigned organization",
        }),
      });
      await loadUsers();
    } catch (err) {
      setRowErr(
        id,
        err instanceof ApiError
          ? err.body || `Failed to update organization (${err.status})`
          : err instanceof Error
            ? err.message
            : "Failed to update organization.",
      );
    } finally {
      setBusy(id, false);
    }
  };

  const openResetPassword = (user: UserRow) => {
    setRowErr(user.id, null);
    setResetPasswordTarget(user);
    setResetPasswordValue("");
    setResetPasswordError(null);
    setPasswordCopied(false);
  };

  const closeResetPassword = () => {
    if (resetPasswordLoading) return;
    setResetPasswordTarget(null);
    setResetPasswordValue("");
    setResetPasswordError(null);
  };

  const handleResetPassword = async () => {
    if (!resetPasswordTarget) return;
    const user = resetPasswordTarget;
    const providedPassword = resetPasswordValue.trim();
    setBusy(user.id, true);
    setRowErr(user.id, null);
    setResetPasswordLoading(true);
    setResetPasswordError(null);
    try {
      const res = await apiFetch(`/super/users/${user.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({
          reason: "Super admin reset password from Users page",
          ...(providedPassword ? { newPassword: providedPassword } : {}),
        }),
      });
      const json = await res.json();
      const generatedPassword =
        typeof json?.tempPassword === "string"
          ? json.tempPassword
          : typeof json?.data?.tempPassword === "string"
            ? json.data.tempPassword
            : null;
      setResetPasswordTarget(null);
      setResetPasswordValue("");
      setPasswordCopied(false);
      setResetPasswordResult({
        user,
        password: providedPassword || generatedPassword,
        generated: !providedPassword,
      });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.body || `Failed to reset password (${err.status})`
          : err instanceof Error
            ? err.message
            : "Failed to reset password.";
      setResetPasswordError(message);
      setRowErr(user.id, message);
    } finally {
      setBusy(user.id, false);
      setResetPasswordLoading(false);
    }
  };

  const handleCopyTempPassword = async () => {
    if (!resetPasswordResult?.password) return;
    const copied = await writeClipboardText(resetPasswordResult.password);
    setPasswordCopied(copied);
  };

  const handleDeleteUser = (user: UserRow) => {
    setRowErr(user.id, null);
    setPendingUserAction({ type: "delete", user });
  };

  const handleRestoreUser = (user: UserRow) => {
    setRowErr(user.id, null);
    setPendingUserAction({ type: "restore", user });
  };

  const confirmPendingUserAction = async () => {
    if (!pendingUserAction) return;

    const { type, user } = pendingUserAction;
    setBusy(user.id, true);
    setRowErr(user.id, null);
    try {
      if (type === "delete") {
        await apiFetch(`/super/users/${user.id}`, {
          method: "DELETE",
          body: JSON.stringify({
            reason: "Super admin deleted user from Users page",
          }),
        });
      } else {
        await apiFetch(`/super/users/${user.id}/restore`, {
          method: "POST",
          body: JSON.stringify({
            reason: "Super admin restored user from Users page",
          }),
        });
      }

      setPendingUserAction(null);
      await loadUsers();
    } catch (err) {
      setRowErr(
        user.id,
        err instanceof ApiError
          ? err.body ||
              `Failed to ${type === "delete" ? "delete" : "restore"} user (${err.status})`
          : err instanceof Error
            ? err.message
            : `Failed to ${type === "delete" ? "delete" : "restore"} user.`,
      );
    } finally {
      setBusy(user.id, false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm text-white/60">Super Admin</p>
          <h1 className="text-3xl font-bold">Users</h1>
          <p className="mt-1 text-sm text-white/60">
            Manage admins and organizers across organizations with a cleaner
            operational overview.
          </p>
        </div>

        <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto lg:min-w-[460px] lg:justify-end">
          <div className="inline-flex rounded-xl border border-white/10 bg-black/20 p-1">
            {USER_VIEW_OPTIONS.map((option) => {
              const active = userView === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setUserView(option.value)}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                    active
                      ? "bg-white/10 text-white"
                      : "text-white/55 hover:text-white"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <div className="relative w-full sm:flex-1 lg:w-80 lg:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <input
              className="w-full rounded-xl border border-white/10 bg-black/20 py-3 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-cyan-400/40"
              placeholder="Search users"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-950/40 transition hover:brightness-110"
          >
            <Plus className="h-4 w-4" />
            Create User
          </button>
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {userStats.map((card) => (
          <MetricCard
            key={card.label}
            label={card.label}
            value={card.value}
            icon={card.icon}
            accent={card.accent}
          />
        ))}
      </section>

      {loading ? (
        <div className="text-white/60">Loading users...</div>
      ) : error ? (
        <EmptyState
          title="Unable to load users"
          description={error}
          actionLabel="Retry"
          onAction={loadUsers}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No users found"
          description={
            userView === "deleted"
              ? "There are no deleted users matching this filter."
              : "Try adjusting your search."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
          <table className="min-w-full text-sm">
            <thead className="bg-white/5 text-left text-xs uppercase tracking-[0.22em] text-white/40">
              <tr>
                <th className="px-5 py-4 font-medium">User</th>
                <th className="px-5 py-4 font-medium">Email</th>
                <th className="px-5 py-4 font-medium">Role</th>
                <th className="px-5 py-4 font-medium">Organization</th>
                <th className="px-5 py-4 font-medium">Created</th>
                <th className="px-5 py-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => {
                const busy = rowBusy[user.id] ?? false;
                const deleted = isDeletedUser(user);
                const canEditRole = !deleted && isManagedRole(user.role);
                return (
                  <tr
                    key={user.id}
                    className={`border-t border-white/10 align-middle transition hover:bg-white/[0.03] ${
                      deleted ? "bg-red-500/[0.02]" : ""
                    }`}
                  >
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 ${
                            deleted ? "text-red-200" : "text-cyan-300"
                          }`}
                        >
                          <UserRound className="h-4 w-4" />
                        </div>
                        <div>
                          <div className={`font-medium ${deleted ? "text-white/80" : "text-white"}`}>
                            {getDisplayName(user)}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">
                              {user.id.slice(0, 8)}
                            </div>
                            {deleted ? (
                              <span className="rounded-full border border-red-400/20 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-red-200">
                                Deleted
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className={`px-5 py-2.5 ${deleted ? "text-white/50" : "text-white/80"}`}>
                      {user.email ?? "-"}
                    </td>
                    <td className="px-5 py-2.5">
                      {canEditRole ? (
                        <div className="w-36">
                          <SelectField
                            value={user.role ?? ""}
                            onChange={(value) => handleRoleChange(user.id, value as Role)}
                            options={[
                              { value: "", label: "Select", disabled: true },
                              ...ROLE_OPTIONS.map((role) => ({
                                value: role,
                                label: role,
                              })),
                            ]}
                            disabled={busy}
                            compact
                          />
                        </div>
                      ) : (
                        <span className="inline-flex rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">
                          {formatRoleLabel(user.role)}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-white/80">
                      {deleted ? (
                        <span className="inline-flex rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] font-semibold text-white/55">
                          {user.organization?.name ?? user.organization?.id ?? "Unassigned"}
                        </span>
                      ) : (
                        <div className="w-44">
                          <SelectField
                            value={user.organization?.id ?? ""}
                            onChange={(value) => handleOrgChange(user.id, value)}
                            options={[
                              { value: "", label: "Unassigned" },
                              ...orgs.map((organization) => ({
                                value: organization.id,
                                label: organization.name ?? organization.id,
                              })),
                            ]}
                            disabled={busy}
                            compact
                          />
                        </div>
                      )}
                    </td>
                    <td className={`px-5 py-2.5 ${deleted ? "text-white/45" : "text-white/60"}`}>
                      {user.createdAt
                        ? new Date(user.createdAt).toLocaleString()
                        : "-"}
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          {deleted ? (
                            <button
                              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-100 transition hover:border-emerald-300/30 hover:bg-emerald-500/15 disabled:opacity-60"
                              onClick={() => handleRestoreUser(user)}
                              disabled={busy}
                            >
                              <RotateCcw className="h-3 w-3" />
                              Restore User
                            </button>
                          ) : (
                            <>
                              <button
                                className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-black/20 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:border-white/25 hover:bg-white/5 disabled:opacity-60"
                                onClick={() => openResetPassword(user)}
                                disabled={busy}
                              >
                                <KeyRound className="h-3 w-3" />
                                Reset Password
                              </button>
                              <button
                                className="inline-flex items-center gap-1.5 rounded-md border border-red-400/20 bg-red-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-red-100 transition hover:border-red-300/30 hover:bg-red-500/15 disabled:opacity-60"
                                onClick={() => handleDeleteUser(user)}
                                disabled={busy}
                              >
                                <Trash2 className="h-3 w-3" />
                                Delete User
                              </button>
                            </>
                          )}
                        </div>
                        {rowError[user.id] ? (
                          <p className="text-xs text-red-300">{rowError[user.id]}</p>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <CreateUserModal
        open={createOpen}
        name={createName}
        email={createEmail}
        password={createPassword}
        showPassword={showPassword}
        loading={createLoading}
        error={createError}
        onClose={resetCreateForm}
        onSubmit={handleCreate}
        onNameChange={setCreateName}
        onEmailChange={setCreateEmail}
        onPasswordChange={setCreatePassword}
        onTogglePassword={() => setShowPassword((value) => !value)}
      />

      {resetPasswordTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeResetPassword();
          }}
        >
          <div className="w-full max-w-md rounded-lg border border-white/10 bg-[#10151d] p-5 shadow-2xl shadow-black/50">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-500/10 text-cyan-200">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">
                  Reset Password
                </h2>
                <p className="mt-1 text-sm text-white/60">
                  Set a new password for {getDisplayName(resetPasswordTarget)}.
                </p>
              </div>
            </div>

            <form
              className="mt-5 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void handleResetPassword();
              }}
            >
              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.18em] text-white/40">
                  New Password
                </span>
                <input
                  className="w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 font-mono text-sm text-white outline-none transition placeholder:text-white/30 focus:border-cyan-400/40"
                  value={resetPasswordValue}
                  onChange={(event) => setResetPasswordValue(event.target.value)}
                  placeholder="Type or paste password"
                  autoFocus
                />
              </label>
              <p className="text-xs text-white/45">
                Leave it blank to generate a temporary password automatically.
              </p>
              {resetPasswordError ? (
                <p className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                  {resetPasswordError}
                </p>
              ) : null}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeResetPassword}
                  disabled={resetPasswordLoading}
                  className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white/70 transition hover:text-white disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetPasswordLoading}
                  className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-400 disabled:opacity-60"
                >
                  {resetPasswordLoading ? "Resetting..." : "Reset Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {resetPasswordResult ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-lg border border-white/10 bg-[#10151d] p-5 shadow-2xl shadow-black/50">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-500/10 text-cyan-200">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">
                  Password Reset Complete
                </h2>
                <p className="mt-1 text-sm text-white/60">
                  {getDisplayName(resetPasswordResult.user)} can sign in with
                  this {resetPasswordResult.generated ? "temporary" : "new"} password.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-2">
              <label className="text-xs uppercase tracking-[0.18em] text-white/40">
                {resetPasswordResult.generated ? "Temporary Password" : "New Password"}
              </label>
              {resetPasswordResult.password ? (
                <div className="flex gap-2">
                  <input
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-3 py-2 font-mono text-sm text-white outline-none"
                    readOnly
                    value={resetPasswordResult.password}
                  />
                  <button
                    type="button"
                    onClick={handleCopyTempPassword}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/15"
                  >
                    <Copy className="h-4 w-4" />
                    {passwordCopied ? "Copied" : "Copy"}
                  </button>
                </div>
              ) : (
                <p className="rounded-lg border border-amber-300/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                  Password was reset, but the server did not return a temporary
                  password.
                </p>
              )}
              <p className="text-xs text-white/45">
                Share this once and ask the user to change it after signing in.
              </p>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setResetPasswordResult(null)}
                className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-400"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDeleteModal
        open={pendingUserAction !== null}
        title={
          pendingUserAction?.type === "restore" ? "Restore user?" : "Delete user?"
        }
        description={
          pendingUserAction
            ? pendingUserAction.type === "restore"
              ? `This will reactivate ${getDisplayName(pendingUserAction.user)}.`
              : `This will soft-delete ${getDisplayName(pendingUserAction.user)}.`
            : ""
        }
        confirmLabel={
          pendingUserAction?.type === "restore" ? "Restore User" : "Delete User"
        }
        loadingLabel={
          pendingUserAction?.type === "restore" ? "Restoring..." : "Deleting..."
        }
        tone={pendingUserAction?.type === "restore" ? "success" : "danger"}
        loading={
          pendingUserAction
            ? (rowBusy[pendingUserAction.user.id] ?? false)
            : false
        }
        onClose={() => setPendingUserAction(null)}
        onConfirm={confirmPendingUserAction}
      />
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
  icon: typeof Users;
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
        <p className="text-sm text-white/50">Managed account overview.</p>
      </div>
    </div>
  );
}

function SelectField({
  value,
  onChange,
  options,
  disabled,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <div className="relative">
      <select
        className={`w-full appearance-none rounded-xl border border-white/10 bg-black/20 pr-10 text-white outline-none transition focus:border-cyan-400/40 disabled:opacity-60 ${
          compact ? "px-3 py-1.5 text-[11px]" : "px-3 py-3 text-sm"
        }`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {options.map((option) => (
          <option key={`${option.value}-${option.label}`} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
    </div>
  );
}

function getDisplayName(user: UserRow) {
  if (user.name?.trim()) return user.name.trim();
  if (user.email?.trim()) return user.email.trim().split("@")[0];
  return "Unnamed user";
}

function isDeletedUser(user: UserRow) {
  return user.status === "DELETED" || !!user.deletedAt;
}

function isManagedRole(role: Role | null | undefined): role is "ADMIN" | "ORGANIZER" {
  return role === "ADMIN" || role === "ORGANIZER";
}

function formatRoleLabel(role: Role | null | undefined) {
  if (!role) return "Unknown";
  return role.replaceAll("_", " ");
}

async function writeClipboardText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);
      return copied;
    } catch {
      return false;
    }
  }
}
