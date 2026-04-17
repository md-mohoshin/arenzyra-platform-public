"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  ArrowRight,
  Building2,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { applyForOrganization } from "@/lib/auth";
import { getApiErrorMessage } from "@/lib/api";

const DUPLICATE_APPLICATION_ERROR =
  "Application already exists or account already registered";
const DUPLICATE_APPLICATION_FEEDBACK =
  "You already applied or account exists";

export default function ApplyPage() {
  const [organizationName, setOrganizationName] = useState("");
  const [applicantName, setApplicantName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const submitLockRef = useRef(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLockRef.current || submitting) {
      return;
    }

    submitLockRef.current = true;
    setError("");
    setSubmitting(true);

    try {
      await applyForOrganization({
        name: organizationName,
        applicantName,
        email,
        password,
      });
      setSuccess(true);
      setPassword("");
    } catch (err) {
      setError(getApplyErrorMessage(err));
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#04070d] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.2),transparent_30%),radial-gradient(circle_at_80%_10%,rgba(59,130,246,0.18),transparent_24%),radial-gradient(circle_at_50%_80%,rgba(245,158,11,0.08),transparent_26%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[size:108px_108px] opacity-[0.14]" />
      <div className="absolute left-1/2 top-0 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-cyan-500/10 blur-[150px]" />

      <div className="relative mx-auto flex min-h-screen max-w-[1480px] items-start px-6 py-12 sm:py-14 lg:px-10 lg:py-16">
        <div className="grid w-full items-start gap-10 lg:grid-cols-[1.05fr_0.95fr] xl:gap-16">
          <section className="flex flex-col gap-8 xl:gap-10">
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
                  Organizer onboarding
                </div>

                <div className="space-y-4">
                  <h1 className="max-w-3xl text-4xl font-semibold tracking-[0.08em] text-white sm:text-5xl xl:text-6xl">
                    Apply for a new organization workspace.
                  </h1>
                  <p className="max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                    Submit your organization details for review. Once a super admin
                    approves the request, you can sign in and manage tournaments,
                    branding, widgets, and match operations.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
              <div className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.94),rgba(4,7,13,0.94))] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.42)]">
                <div className="space-y-5">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.3em] text-white/45">
                      Review flow
                    </div>
                    <div className="mt-2 text-xl font-semibold text-white">
                      Manual approval before access
                    </div>
                  </div>

                  <div className="space-y-3">
                    {[
                      "Application enters the super admin review queue",
                      "Your account stays inactive until the request is approved",
                      "Login behavior remains unchanged after submission",
                    ].map((item) => (
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

              <div className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(7,10,16,0.96),rgba(10,14,22,0.92))] p-6 shadow-[0_18px_48px_rgba(0,0,0,0.34)]">
                <div className="space-y-4">
                  <div className="text-[11px] uppercase tracking-[0.28em] text-white/45">
                    Included after approval
                  </div>
                  <div className="grid gap-3">
                    {[
                      "Organization owner account linked on approval",
                      "Default organization assets and features seeded",
                      "Clean separation from the existing auth session flow",
                    ].map((item) => (
                      <div
                        key={item}
                        className="rounded-2xl border border-white/8 bg-black/20 px-4 py-4 text-sm leading-6 text-slate-300"
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="relative mx-auto flex w-full max-w-[500px] items-start lg:pt-6">
            <div className="absolute -inset-4 rounded-[36px] bg-cyan-500/10 blur-3xl" />

            <div className="relative w-full overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,17,26,0.97),rgba(4,7,13,0.98))] p-7 shadow-[0_32px_90px_rgba(0,0,0,0.55)] sm:p-8">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent" />

              <div className="space-y-6">
                <div className="space-y-4">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] uppercase tracking-[0.3em] text-white/55">
                    <ShieldCheck className="h-3.5 w-3.5 text-cyan-300" />
                    Application form
                  </div>

                  <div>
                    <h2 className="text-3xl font-semibold text-white sm:text-4xl">
                      Request access
                    </h2>
                    <p className="mt-3 text-sm leading-6 text-slate-400">
                      Share your organization and owner details. Approval is handled
                      by a super admin before sign-in becomes available.
                    </p>
                  </div>
                </div>

                {success ? (
                  <div className="space-y-5 rounded-[28px] border border-emerald-400/25 bg-emerald-400/10 p-6">
                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-[11px] uppercase tracking-[0.22em] text-emerald-200">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Submitted
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-2xl font-semibold text-white">
                        Application submitted.
                      </h3>
                      <p className="text-sm leading-6 text-emerald-100/90">
                        Application submitted. Waiting for approval.
                      </p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <Link
                        href="/login"
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-100"
                      >
                        Go to login
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          setSuccess(false);
                          setOrganizationName("");
                          setApplicantName("");
                          setEmail("");
                          setPassword("");
                          setError("");
                        }}
                        className="rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                      >
                        Submit another application
                      </button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <Field
                      id="organization"
                      label="Organization name"
                      value={organizationName}
                      onChange={setOrganizationName}
                      placeholder="Apex Broadcast"
                      icon={Building2}
                      autoComplete="organization"
                    />

                    <Field
                      id="name"
                      label="Your name"
                      value={applicantName}
                      onChange={setApplicantName}
                      placeholder="Jane Operator"
                      icon={UserRound}
                      autoComplete="name"
                    />

                    <Field
                      id="email"
                      label="Email"
                      value={email}
                      onChange={setEmail}
                      placeholder="jane@organization.gg"
                      icon={Mail}
                      autoComplete="email"
                      type="email"
                    />

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
                          id="password"
                          type={showPassword ? "text" : "password"}
                          required
                          autoComplete="new-password"
                          className="w-full rounded-2xl border border-white/10 bg-white/[0.05] py-3 pl-11 pr-12 text-white outline-none transition placeholder:text-white/25 focus:border-cyan-300/55 focus:bg-white/[0.08]"
                          placeholder="Create a password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((value) => !value)}
                          className="absolute inset-y-0 right-0 flex items-center pr-4 text-white/35 transition hover:text-white"
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

                    {error ? (
                      <p
                        role="alert"
                        className="rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-200"
                      >
                        {error}
                      </p>
                    ) : null}

                    <button
                      type="submit"
                      disabled={submitting}
                      aria-disabled={submitting}
                      aria-busy={submitting}
                      className="group inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-3.5 font-semibold text-white shadow-[0_18px_34px_rgba(8,145,178,0.28)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {submitting ? "Submitting..." : "Submit application"}
                      {!submitting ? (
                        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                      ) : null}
                    </button>
                  </form>
                )}

                <div className="space-y-4 border-t border-white/10 pt-5">
                  <div className="flex items-center gap-3 text-sm text-slate-400">
                    <ShieldCheck className="h-4 w-4 text-cyan-300" />
                    Approval is required before you can use the organization account.
                  </div>

                  <p className="text-xs leading-6 text-white/45">
                    Already approved?{" "}
                    <Link
                      href="/login"
                      className="text-white/75 underline underline-offset-4 transition hover:text-white"
                    >
                      Login here
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

function getApplyErrorMessage(error: unknown) {
  const message = getApiErrorMessage(error, "");
  const normalized = message.trim().toLowerCase();

  if (
    normalized === DUPLICATE_APPLICATION_ERROR.toLowerCase() ||
    normalized.includes("account already registered") ||
    normalized.includes("application already exists")
  ) {
    return DUPLICATE_APPLICATION_FEEDBACK;
  }

  if (message.trim()) {
    return message.trim();
  }

  return "Unable to submit your application right now. Please try again.";
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  icon: Icon,
  autoComplete,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  icon: typeof Building2;
  autoComplete?: string;
  type?: React.HTMLInputTypeAttribute;
}) {
  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className="text-xs font-semibold uppercase tracking-[0.24em] text-white/55"
      >
        {label}
      </label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
        <input
          id={id}
          type={type}
          required
          autoComplete={autoComplete}
          className="w-full rounded-2xl border border-white/10 bg-white/[0.05] py-3 pl-11 pr-4 text-white outline-none transition placeholder:text-white/25 focus:border-cyan-300/55 focus:bg-white/[0.08]"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}
