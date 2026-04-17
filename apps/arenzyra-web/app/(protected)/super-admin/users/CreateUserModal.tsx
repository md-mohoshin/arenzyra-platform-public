"use client";

import { Eye, EyeOff } from "lucide-react";

type Props = {
  open: boolean;
  name: string;
  email: string;
  password: string;
  showPassword: boolean;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: () => void;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onTogglePassword: () => void;
};

export function CreateUserModal({
  open,
  name,
  email,
  password,
  showPassword,
  loading,
  error,
  onClose,
  onSubmit,
  onNameChange,
  onEmailChange,
  onPasswordChange,
  onTogglePassword,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget && !loading) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#111827] p-6 shadow-2xl shadow-black/40">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Create User</h2>
            <p className="mt-1 text-sm text-white/55">
              Provision a managed account. Role and organization can be updated after creation.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-sm text-white/70 transition hover:text-white"
            disabled={loading}
          >
            Close
          </button>
        </div>

        <form
          className="mt-6 space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit();
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="text-white/70">Name</span>
              <input
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white outline-none transition focus:border-cyan-400/40"
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
                placeholder="Display name"
              />
            </label>

            <label className="space-y-1.5 text-sm">
              <span className="text-white/70">Email</span>
              <input
                type="email"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white outline-none transition focus:border-cyan-400/40"
                value={email}
                onChange={(event) => onEmailChange(event.target.value)}
                placeholder="user@arenzyra.com"
              />
            </label>

            <label className="space-y-1.5 text-sm">
              <span className="text-white/70">Password</span>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 pr-11 text-white outline-none transition focus:border-cyan-400/40"
                  value={password}
                  onChange={(event) => onPasswordChange(event.target.value)}
                  placeholder="Enter password"
                />
                <button
                  type="button"
                  onClick={onTogglePassword}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-white/45 transition hover:text-white"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
              <p className="text-xs text-white/45">Minimum 8 characters</p>
            </label>
          </div>

          {error ? (
            <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/70 hover:text-white"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
              disabled={loading}
            >
              {loading ? "Creating..." : "Create User"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
