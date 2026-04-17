"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowRight,
  Eye,
  EyeOff,
  LayoutTemplate,
  LockKeyhole,
  Mail,
  Radio,
  ShieldCheck,
  Trophy,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { getApiErrorMessage } from "@/lib/api";

const platformSignals = [
  {
    title: "Realtime telemetry",
    detail: "Live packets, winner locks, and team-state sync for on-air scenes.",
    icon: Radio,
  },
  {
    title: "OBS-ready widgets",
    detail: "Preview and clean routes stay aligned for production operators.",
    icon: LayoutTemplate,
  },
  {
    title: "Tournament control",
    detail: "Stages, groups, matches, sponsors, and branding from one console.",
    icon: Trophy,
  },
];

const operationsChecklist = [
  "Broadcast overlays mirrored to clean output routes",
  "Match control, leaderboards, and map states update in one flow",
  "Operator access stays separated across organizations and roles",
];

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberDevice, setRememberDevice] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(email, password, rememberDevice);
      router.push("/");
    } catch (err) {
      setError(getApiErrorMessage(err, "Login failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#04070d] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.2),transparent_30%),radial-gradient(circle_at_80%_10%,rgba(59,130,246,0.18),transparent_24%),radial-gradient(circle_at_50%_80%,rgba(245,158,11,0.08),transparent_26%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[size:108px_108px] opacity-[0.14]" />
      <div className="absolute left-1/2 top-0 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-cyan-500/10 blur-[150px]" />

      <div className="relative mx-auto flex min-h-screen max-w-[1480px] items-start px-6 py-12 sm:py-14 lg:px-10 lg:py-16">
        <div className="grid w-full items-start gap-10 lg:grid-cols-[1.08fr_0.92fr] xl:gap-16">
          <section className="flex flex-col gap-10 xl:gap-12">
            <div className="space-y-8">
              <Link
                href="/"
                className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.03] px-5 py-2 text-xs font-semibold uppercase tracking-[0.34em] text-white/75 transition hover:border-white/20 hover:bg-white/[0.06]"
              >
                <span className="h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_18px_rgba(34,211,238,0.85)]" />
                Arenzyra
              </Link>

              <div className="max-w-2xl space-y-6">
                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs uppercase tracking-[0.28em] text-cyan-200">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Tournament production system
                </div>

                <div className="space-y-4">
                  <h1 className="max-w-3xl text-4xl font-semibold tracking-[0.08em] text-white sm:text-5xl xl:text-6xl">
                    Run live tournaments with broadcast-grade control.
                  </h1>
                  <p className="max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                    Arenzyra keeps tournament operations, match telemetry, sponsor
                    scenes, and on-air widgets inside one operator workflow.
                  </p>
                </div>

                <div className="flex flex-wrap gap-3 text-sm text-white/75">
                  {["Realtime control", "OBS clean routes", "Sponsor-safe output"].map(
                    (label) => (
                      <div
                        key={label}
                        className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2"
                      >
                        {label}
                      </div>
                    ),
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
              <div className="overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.94),rgba(4,7,13,0.94))] shadow-[0_24px_70px_rgba(0,0,0,0.42)]">
                <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
                  </div>
                  <div className="text-[11px] uppercase tracking-[0.32em] text-white/45">
                    Control room status
                  </div>
                </div>

                <div className="space-y-5 p-6">
                  <div className="grid gap-3 sm:grid-cols-3">
                    {platformSignals.map((item) => {
                      const Icon = item.icon;

                      return (
                        <div
                          key={item.title}
                          className="rounded-2xl border border-white/8 bg-white/[0.04] p-4"
                        >
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400/12 text-cyan-300">
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="mt-4 text-sm font-semibold text-white">
                            {item.title}
                          </div>
                          <div className="mt-2 text-sm leading-6 text-slate-400">
                            {item.detail}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="rounded-2xl border border-white/8 bg-black/20 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.28em] text-white/45">
                          Live operations
                        </div>
                        <div className="mt-2 text-xl font-semibold text-white">
                          Organizer control synced
                        </div>
                      </div>
                      <div className="rounded-full border border-emerald-400/25 bg-emerald-400/12 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200">
                        Stable
                      </div>
                    </div>

                    <div className="mt-5 rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-4">
                      <div className="grid gap-4 sm:grid-cols-3">
                        {[
                          { label: "Matches", value: "24 live states" },
                          { label: "Widgets", value: "14 clean routes" },
                          { label: "Access", value: "Role-scoped" },
                        ].map((item, index) => (
                          <div
                            key={item.label}
                            className={`space-y-2 sm:px-1 ${
                              index > 0 ? "sm:border-l sm:border-white/10 sm:pl-5" : ""
                            }`}
                          >
                            <div className="text-[11px] uppercase tracking-[0.24em] text-white/45">
                              {item.label}
                            </div>
                            <div className="text-base font-semibold text-white">
                              {item.value}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(7,10,16,0.96),rgba(10,14,22,0.92))] p-6 shadow-[0_18px_48px_rgba(0,0,0,0.34)]">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-400/12 text-cyan-300">
                    <Activity className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.28em] text-white/45">
                      Operator lane
                    </div>
                    <div className="mt-1 text-lg font-semibold text-white">
                      Broadcast-safe access
                    </div>
                  </div>
                </div>

                <div className="mt-6 space-y-3">
                  {operationsChecklist.map((item) => (
                    <div
                      key={item}
                      className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-4 text-sm leading-6 text-slate-300"
                    >
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="relative mx-auto flex w-full max-w-[470px] items-start lg:pt-6">
            <div className="absolute -inset-4 rounded-[36px] bg-cyan-500/10 blur-3xl" />

            <div className="relative w-full overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,17,26,0.97),rgba(4,7,13,0.98))] p-7 shadow-[0_32px_90px_rgba(0,0,0,0.55)] sm:p-8">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent" />

              <div className="space-y-6">
                <div className="space-y-4">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] uppercase tracking-[0.3em] text-white/55">
                    <ShieldCheck className="h-3.5 w-3.5 text-cyan-300" />
                    Secure access
                  </div>

                  <div className="space-y-3">
                    <div className="text-sm font-semibold uppercase tracking-[0.34em] text-white/75">
                      Arenzyra
                    </div>
                    <div>
                      <h2 className="text-3xl font-semibold text-white sm:text-4xl">
                        Sign in to the control room
                      </h2>
                      <p className="mt-3 max-w-md text-sm leading-6 text-slate-400">
                        Access match operations, live telemetry, branding
                        controls, and production widgets from one operator
                        console.
                      </p>
                    </div>
                  </div>
                </div>

                <form
                  suppressHydrationWarning
                  onSubmit={handleSubmit}
                  className="space-y-5"
                >
                  <div className="space-y-2">
                    <label
                      htmlFor="email"
                      className="text-xs font-semibold uppercase tracking-[0.24em] text-white/55"
                    >
                      Email
                    </label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                      <input
                        suppressHydrationWarning
                        id="email"
                        type="email"
                        required
                        autoComplete="email"
                        className="w-full rounded-2xl border border-white/10 bg-white/[0.05] py-3 pl-11 pr-4 text-white outline-none transition placeholder:text-white/25 focus:border-cyan-300/55 focus:bg-white/[0.08]"
                        placeholder="name@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor="password"
                      className="text-xs font-semibold uppercase tracking-[0.24em] text-white/55"
                    >
                      Password
                    </label>
                    <div className="relative">
                      <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                      <input
                        suppressHydrationWarning
                        id="password"
                        type={showPassword ? "text" : "password"}
                        required
                        autoComplete="current-password"
                        className="w-full rounded-2xl border border-white/10 bg-white/[0.05] py-3 pl-11 pr-12 text-white outline-none transition placeholder:text-white/25 focus:border-cyan-300/55 focus:bg-white/[0.08]"
                        placeholder="Enter your password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((value) => !value)}
                        className="absolute inset-y-0 right-0 flex cursor-pointer items-center pr-4 text-white/35 transition hover:text-white"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? (
                          <EyeOff className="h-5 w-5" />
                        ) : (
                          <Eye className="h-5 w-5" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 text-sm text-white/70 sm:flex-row sm:items-center sm:justify-between">
                    <label className="flex cursor-pointer items-center gap-3 text-white/65 transition hover:text-white">
                      <input
                        suppressHydrationWarning
                        type="checkbox"
                        checked={rememberDevice}
                        onChange={(event) =>
                          setRememberDevice(event.target.checked)
                        }
                        className="h-4 w-4 cursor-pointer rounded border border-white/20 bg-transparent accent-cyan-400"
                      />
                      Remember this device
                    </label>

                    <Link
                      href="/forgot-password"
                      className="text-white/55 transition hover:text-cyan-200"
                    >
                      Forgot password?
                    </Link>
                  </div>

                  {error && (
                    <p
                      role="alert"
                      className="rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-200"
                    >
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="group inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-3.5 font-semibold text-white shadow-[0_18px_34px_rgba(8,145,178,0.28)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {submitting ? "Logging in..." : "Login to Arenzyra"}
                    {!submitting && (
                      <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                    )}
                  </button>
                </form>

                <div className="space-y-4 border-t border-white/10 pt-5">
                  <div className="flex items-center gap-3 text-sm text-slate-400">
                    <ShieldCheck className="h-4 w-4 text-cyan-300" />
                    Encrypted session for production operators and organization admins.
                  </div>

                  <p className="text-sm leading-6 text-white/55">
                    Need a new organization workspace?{" "}
                    <Link
                      href="/apply"
                      className="text-white/80 underline underline-offset-4 transition hover:text-cyan-200"
                    >
                      Apply here
                    </Link>
                    .
                  </p>

                  <p className="text-xs leading-6 text-white/45">
                    By continuing you agree to{" "}
                    <Link
                      href="/terms"
                      className="text-white/75 underline underline-offset-4 transition hover:text-white"
                    >
                      Terms &amp; Conditions
                    </Link>
                    .
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
