"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Header } from "@/components/layout/Header";
import { OrganizerContextBar } from "@/components/layout/OrganizerContextBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { useAuth } from "@/context/AuthContext";
import type { AuthUser } from "@/types/arenzyra";

type ImpersonatingUser = AuthUser & {
  actingRole?: AuthUser["role"] | null;
  isImpersonating?: boolean | null;
};

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const actingRole =
    user && "actingRole" in user
      ? (user as ImpersonatingUser).actingRole ?? null
      : null;
  const effectiveRole = actingRole ?? user?.role ?? null;
  const isImpersonating =
    user && "isImpersonating" in user
      ? (user as ImpersonatingUser).isImpersonating === true
      : false;
  const shouldBlockSuperAdminShell =
    !loading &&
    pathname.startsWith("/super-admin") &&
    effectiveRole !== "SUPER_ADMIN";

  useEffect(() => {
    if (!shouldBlockSuperAdminShell) return;
    router.replace("/");
  }, [router, shouldBlockSuperAdminShell]);

  useEffect(() => {
    if (!pathname || !user) return;
    if (
      pathname.startsWith("/super-admin") &&
      isImpersonating &&
      actingRole !== "SUPER_ADMIN"
    ) {
      router.replace("/organizer");
    }
  }, [actingRole, isImpersonating, pathname, router, user]);

  if (shouldBlockSuperAdminShell) {
    return null;
  }

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-black text-white flex">
        <Sidebar />
        <div className="flex-1 flex flex-col bg-[#0b0f14]">
          <Header />
          <main className="flex-1 p-8">
            <OrganizerContextBar />
            {children}
          </main>
        </div>
      </div>
    </ProtectedRoute>
  );
}
