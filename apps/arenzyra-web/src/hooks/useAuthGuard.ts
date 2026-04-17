"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

export function useAuthGuard() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await apiFetch("/auth/me", { cache: "no-store" });
        if (!res.ok && !cancelled) {
          router.replace("/login");
        }
      } catch {
        if (!cancelled) router.replace("/login");
      }
    }

    void check();

    return () => {
      cancelled = true;
    };
  }, [router]);
}
