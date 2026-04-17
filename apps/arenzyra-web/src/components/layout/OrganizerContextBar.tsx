"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { AuthUser } from "@/types/arenzyra";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { restoreImpersonationTokens } from "@/lib/auth-storage";

type ImpersonatingUser = AuthUser & {
  actorRole?: AuthUser["role"] | null;
  realRole?: AuthUser["role"] | null;
  actingOrgName?: string | null;
  actingOrgId?: string | null;
  isImpersonating?: boolean | null;
};

export function OrganizerContextBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, refresh } = useAuth();
  const [exiting, setExiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOrganizerRoute = pathname?.startsWith("/organizer") ?? false;
  if (!isOrganizerRoute) return null;

  const currentUser = user as ImpersonatingUser | null;
  const showImpersonationBanner =
    currentUser?.isImpersonating === true &&
    (currentUser?.actorRole === "SUPER_ADMIN" ||
      currentUser?.realRole === "SUPER_ADMIN" ||
      currentUser?.role === "SUPER_ADMIN");
  const hideStandaloneBack =
    pathname === "/organizer" ||
    pathname === "/organizer/teams" ||
    (pathname?.startsWith("/organizer/teams/") ?? false) ||
    pathname === "/organizer/tournaments" ||
    pathname === "/organizer/matches" ||
    pathname === "/organizer/branding" ||
    pathname === "/organizer/widgets" ||
    (pathname?.startsWith("/organizer/widgets/") ?? false) ||
    pathname === "/organizer/settings" ||
    pathname === "/organizer/live-mapping" ||
    pathname === "/organizer/discord";

  const actingOrgName =
    currentUser?.actingOrgName ?? currentUser?.actingOrgId ?? "Unknown organization";

  async function handleExitImpersonation() {
    setExiting(true);
    setError(null);
    try {
      await apiFetch("/admin/impersonate-exit", { method: "POST" });
      if (!restoreImpersonationTokens()) {
        throw new Error("Original session is no longer available.");
      }
      await refresh();
      router.replace("/super-admin");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to exit impersonation.",
      );
    } finally {
      setExiting(false);
    }
  }

  function handleBack() {
    const fallback = pathname === "/organizer" ? "/" : "/organizer";
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallback);
  }

  return (
    <div className="mb-6 space-y-4">
      {showImpersonationBanner ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="text-sm text-cyan-50">
            <span className="font-semibold">You are impersonating:</span>{" "}
            {actingOrgName}
          </div>
          <button
            type="button"
            onClick={handleExitImpersonation}
            disabled={exiting}
            className="inline-flex items-center justify-center rounded-xl border border-cyan-300/30 bg-black/20 px-4 py-2 text-sm font-semibold text-white transition hover:border-cyan-300/50 hover:bg-black/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exiting ? "Exiting..." : "Exit impersonation"}
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      {!hideStandaloneBack ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-slate-950/65 px-4 py-2 text-sm font-medium text-cyan-50/90 transition hover:border-cyan-300/40 hover:bg-cyan-500/10 hover:text-white"
          >
            &larr; Back
          </button>
        </div>
      ) : null}
    </div>
  );
}
