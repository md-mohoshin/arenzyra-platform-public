"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { getApiErrorMessage } from "@/lib/api";
import type { AuthUser } from "@/types/arenzyra";

export default function LoginPage() {
  const router = useRouter();
  const { login, user } = useAuth();
  const effectiveRole =
    user && "actingRole" in user
      ? (user as AuthUser).actingRole ?? user.role
      : user?.role;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loginSucceeded, setLoginSucceeded] = useState(false);

  useEffect(() => {
    if (!loginSucceeded || !effectiveRole) return;
    const canAccessOrganizer =
      effectiveRole === "ORGANIZER" || effectiveRole === "ADMIN";

    if (effectiveRole === "SUPER_ADMIN") {
      router.push("/super-admin");
      return;
    }

    if (canAccessOrganizer) {
      router.push("/organizer");
    }
  }, [effectiveRole, loginSucceeded, router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(email, password);
      setLoginSucceeded(true);
    } catch (err) {
      setError(getApiErrorMessage(err, "Login failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-black text-white">
      <form
        suppressHydrationWarning
        onSubmit={handleLogin}
        className="w-[400px] space-y-4 rounded-xl bg-neutral-900 p-6"
      >
        <h1 className="text-2xl font-bold">Login</h1>

        {error && <p className="text-red-500">{error}</p>}

        <input
          suppressHydrationWarning
          type="email"
          placeholder="Email"
          className="w-full rounded bg-neutral-800 p-2"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          suppressHydrationWarning
          type="password"
          placeholder="Password"
          className="w-full rounded bg-neutral-800 p-2"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-cyan-500 p-2 font-semibold text-black"
        >
          {submitting ? "Logging in..." : "Login"}
        </button>
      </form>
    </div>
  );
}
