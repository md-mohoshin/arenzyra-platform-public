"use client";

import { ReactNode, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { AppSkeleton } from "@/components/ui/AppSkeleton";
import type { AuthUser } from "@/types/arenzyra";

export default function SuperAdminLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const effectiveRole =
    user && "actingRole" in user
      ? (user as AuthUser).actingRole ?? user.role
      : user?.role;

  useEffect(() => {
    if (!loading && effectiveRole && effectiveRole !== "SUPER_ADMIN") {
      router.replace("/");
    }
  }, [effectiveRole, loading, router]);

  if (loading) {
    return (
      <div className="p-8">
        <AppSkeleton lines={4} />
      </div>
    );
  }

  if (effectiveRole && effectiveRole !== "SUPER_ADMIN") {
    return null;
  }

  return <>{children}</>;
}
