"use client";

import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";

export function Header() {
  const { user, logout } = useAuth();
  const router = useRouter();

  return (
    <header className="h-14 border-b border-white/10 bg-black flex items-center justify-between px-6 text-sm text-white">
      <div className="font-medium">Dashboard</div>
      <div className="flex items-center gap-3">
        <span className="text-white/70">{user?.email}</span>
        <button
          className="rounded border border-white/20 px-3 py-1 hover:border-white/40"
          onClick={async () => {
            await logout();
            router.replace("/login");
          }}
        >
          Logout
        </button>
      </div>
    </header>
  );
}

