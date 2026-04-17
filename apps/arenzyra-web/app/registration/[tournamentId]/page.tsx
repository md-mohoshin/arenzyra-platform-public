"use client";

import { type Dispatch, type FormEvent, type SetStateAction, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, getApiErrorMessage } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const MAIN_PLAYER_SLOTS = 4;
const SUB_PLAYER_SLOTS = 2;

const trimValues = (values: string[]) => values.map((value) => value.trim());

type ValidationResult =
  | { error: string }
  | {
      teamName: string;
      contactEmail: string;
      main: string[];
      subs: string[];
    };

export default function TournamentRegistrationPage() {
  const params = useParams<{ tournamentId: string }>();
  const tournamentId = params?.tournamentId ?? "";
  const { user } = useAuth();
  const [teamName, setTeamName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [mainPlayers, setMainPlayers] = useState<string[]>(
    Array.from({ length: MAIN_PLAYER_SLOTS }, () => ""),
  );
  const [subPlayers, setSubPlayers] = useState<string[]>(
    Array.from({ length: SUB_PLAYER_SLOTS }, () => ""),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const registrationPath = useMemo(
    () => `/registration/${tournamentId}`,
    [tournamentId],
  );

  const updateSlot = (
    setter: Dispatch<SetStateAction<string[]>>,
    index: number,
    value: string,
  ) => {
    setter((current) => current.map((item, itemIndex) => (itemIndex === index ? value : item)));
  };

  const validate = (): ValidationResult => {
    const trimmedTeamName = teamName.trim();
    const trimmedEmail = contactEmail.trim();
    const normalizedMain = trimValues(mainPlayers);
    const normalizedSubs = trimValues(subPlayers).filter(Boolean);

    if (!trimmedTeamName) {
      return { error: "Team name is required." };
    }

    if (!trimmedEmail) {
      return { error: "Contact email is required." };
    }

    if (normalizedMain.some((value) => value.length === 0)) {
      return { error: "Exactly 4 main players are required." };
    }

    const uniqueNames = new Set<string>();
    for (const name of [...normalizedMain, ...normalizedSubs]) {
      const key = name.toLocaleLowerCase();
      if (uniqueNames.has(key)) {
        return { error: "Duplicate player names are not allowed." };
      }
      uniqueNames.add(key);
    }

    return {
      teamName: trimmedTeamName,
      contactEmail: trimmedEmail,
      main: normalizedMain,
      subs: normalizedSubs,
    };
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setError(null);
    setSuccess(null);

    const validated = validate();
    if ("error" in validated) {
      setError(validated.error);
      return;
    }

    try {
      setSubmitting(true);
      const response = await apiFetch(`/registration/${tournamentId}`, {
        method: "POST",
        omitAuth: true,
        skipAuthRetry: true,
        body: JSON.stringify({
          teamName: validated.teamName,
          contactEmail: validated.contactEmail,
          players: {
            main: validated.main.map((name) => ({ name })),
            subs: validated.subs.map((name) => ({ name })),
          },
        }),
      });
      const payload = (await response.json()) as { message?: string };
      setSuccess(payload.message ?? "Application submitted. Waiting for approval.");
      setTeamName("");
      setContactEmail("");
      setMainPlayers(Array.from({ length: MAIN_PLAYER_SLOTS }, () => ""));
      setSubPlayers(Array.from({ length: SUB_PLAYER_SLOTS }, () => ""));
    } catch (submissionError) {
      setError(getApiErrorMessage(submissionError, "Failed to submit application"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#12314a_0%,#09111d_38%,#04070d_100%)] px-4 py-12 text-white">
      <div className="mx-auto max-w-3xl rounded-[28px] border border-white/10 bg-slate-950/80 p-8 shadow-[0_32px_100px_rgba(0,0,0,0.45)] backdrop-blur">
        <div className="mb-8 space-y-3">
          <span className="inline-flex rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">
            Arenzyra Tournament Registration
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            Register your team for this tournament
          </h1>
          <p className="text-sm text-slate-300">
            Submit one application per team. The organizer will review it and create the
            real team entry only after approval.
          </p>
          <code className="inline-flex rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-slate-300">
            {registrationPath}
          </code>
        </div>

        {user ? (
          <div className="mb-8 rounded-2xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            You are logged in. Registration will be submitted as a public team.
          </div>
        ) : null}

        <form className="space-y-8" onSubmit={onSubmit}>
          <section className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-200">Team Name</span>
              <input
                value={teamName}
                onChange={(event) => setTeamName(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/50"
                placeholder="Team name"
                autoComplete="organization"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-200">Contact Email</span>
              <input
                type="email"
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/50"
                placeholder="team@example.com"
                autoComplete="email"
              />
            </label>
          </section>

          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Main Players</h2>
              <p className="text-sm text-slate-400">Exactly 4 main players are required.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {mainPlayers.map((value, index) => (
                <label key={`main-${index}`} className="space-y-2">
                  <span className="text-sm text-slate-300">Main Player {index + 1}</span>
                  <input
                    value={value}
                    onChange={(event) =>
                      updateSlot(setMainPlayers, index, event.target.value)
                    }
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/50"
                    placeholder={`Player ${index + 1}`}
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Substitutes</h2>
              <p className="text-sm text-slate-400">Up to 2 substitutes are optional.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {subPlayers.map((value, index) => (
                <label key={`sub-${index}`} className="space-y-2">
                  <span className="text-sm text-slate-300">Substitute {index + 1}</span>
                  <input
                    value={value}
                    onChange={(event) =>
                      updateSlot(setSubPlayers, index, event.target.value)
                    }
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/50"
                    placeholder={`Substitute ${index + 1}`}
                  />
                </label>
              ))}
            </div>
          </section>

          {error ? (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          {success ? (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              {success}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitting || !tournamentId}
            className="inline-flex rounded-full bg-cyan-400 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-500"
          >
            {submitting ? "Submitting..." : "Submit Application"}
          </button>
        </form>
      </div>
    </main>
  );
}
