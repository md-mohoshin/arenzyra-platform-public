"use client";

import { ReactNode, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppSkeleton } from "@/components/ui/AppSkeleton";
import { useAuth } from "@/context/AuthContext";
import type { AuthUser } from "@/types/arenzyra";

export default function OrganizerLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const effectiveRole =
    user && "actingRole" in user
      ? (user as AuthUser).actingRole ?? user.role
      : user?.role;
  const canAccessOrganizer =
    effectiveRole === "ORGANIZER" || effectiveRole === "ADMIN";

  useEffect(() => {
    if (!loading && effectiveRole && !canAccessOrganizer) {
      router.replace("/");
    }
  }, [canAccessOrganizer, effectiveRole, loading, router]);

  if (loading) {
    return (
      <div className="p-8">
        <AppSkeleton lines={4} />
      </div>
    );
  }

  if (effectiveRole && !canAccessOrganizer) {
    return null;
  }

  return <>{children}</>;
}
