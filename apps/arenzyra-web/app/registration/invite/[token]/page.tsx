"use client";

import { type Dispatch, type FormEvent, type SetStateAction, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, getApiErrorMessage } from "@/lib/api";

const MAIN_PLAYER_SLOTS = 4;
const SUB_PLAYER_SLOTS = 2;

const trimValues = (values: string[]) => values.map((value) => value.trim());

type InviteInfo = {
  tournament?: {
    id: string;
    name: string;
    status?: string | null;
    liveState?: string | null;
  } | null;
  contactEmail: string;
  status: "PENDING" | "ACCEPTED" | "EXPIRED";
  stage?: {
    id: string;
    name: string;
  } | null;
  group?: {
    id: string;
    name: string;
  } | null;
  team?: {
    id: string;
    name: string;
  } | null;
};

type ValidationResult =
  | { error: string }
  | {
      teamName: string;
      main: string[];
      subs: string[];
    };

export default function InviteRegistrationPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [teamName, setTeamName] = useState("");
  const [mainPlayers, setMainPlayers] = useState<string[]>(
    Array.from({ length: MAIN_PLAYER_SLOTS }, () => ""),
  );
  const [subPlayers, setSubPlayers] = useState<string[]>(
    Array.from({ length: SUB_PLAYER_SLOTS }, () => ""),
  );
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const invitePath = useMemo(() => `/registration/invite/${token}`, [token]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError("Invite token is missing.");
      return;
    }

    let cancelled = false;
    const loadInvite = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await apiFetch(`/registration/invite/${token}`, {
          omitAuth: true,
          skipAuthRetry: true,
          cache: "no-store",
        });
        const payload = (await response.json()) as InviteInfo;
        if (!cancelled) {
          setInvite(payload);
        }
      } catch (inviteError) {
        if (!cancelled) {
          setError(getApiErrorMessage(inviteError, "Failed to load invite"));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadInvite();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const updateSlot = (
    setter: Dispatch<SetStateAction<string[]>>,
    index: number,
    value: string,
  ) => {
    setter((current) => current.map((item, itemIndex) => (itemIndex === index ? value : item)));
  };

  const validate = (): ValidationResult => {
    const trimmedTeamName = teamName.trim();
    const normalizedMain = trimValues(mainPlayers);
    const normalizedSubs = trimValues(subPlayers).filter(Boolean);

    if (!trimmedTeamName) {
      return { error: "Team name is required." };
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
      main: normalizedMain,
      subs: normalizedSubs,
    };
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || invite?.status !== "PENDING") {
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
      await apiFetch(`/registration/invite/${token}`, {
        method: "POST",
        omitAuth: true,
        skipAuthRetry: true,
        body: JSON.stringify({
          teamName: validated.teamName,
          players: {
            main: validated.main.map((name) => ({ name })),
            subs: validated.subs.map((name) => ({ name })),
          },
        }),
      });
      setSuccess("Invite accepted. Your team has been registered.");
      setMainPlayers(Array.from({ length: MAIN_PLAYER_SLOTS }, () => ""));
      setSubPlayers(Array.from({ length: SUB_PLAYER_SLOTS }, () => ""));
      const refreshed = await apiFetch(`/registration/invite/${token}`, {
        omitAuth: true,
        skipAuthRetry: true,
        cache: "no-store",
      });
      setInvite((await refreshed.json()) as InviteInfo);
    } catch (submissionError) {
      setError(getApiErrorMessage(submissionError, "Failed to accept invite"));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,#12314a_0%,#09111d_38%,#04070d_100%)] px-4 py-12 text-white">
        <div className="mx-auto max-w-3xl rounded-[28px] border border-white/10 bg-slate-950/80 p-8 text-center text-sm text-slate-300 shadow-[0_32px_100px_rgba(0,0,0,0.45)] backdrop-blur">
          Loading invite...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#12314a_0%,#09111d_38%,#04070d_100%)] px-4 py-12 text-white">
      <div className="mx-auto max-w-3xl rounded-[28px] border border-white/10 bg-slate-950/80 p-8 shadow-[0_32px_100px_rgba(0,0,0,0.45)] backdrop-blur">
        <div className="mb-8 space-y-3">
          <span className="inline-flex rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">
            Arenzyra Invite Registration
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            {invite?.tournament?.name ? `Join ${invite.tournament.name}` : "Tournament invite"}
          </h1>
          <p className="text-sm text-slate-300">
            This invite registers your team directly into the assigned stage. No extra organizer approval is required.
          </p>
          <code className="inline-flex rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-slate-300">
            {invitePath}
          </code>
        </div>

        {invite ? (
          <div className="mb-8 grid gap-4 rounded-3xl border border-white/10 bg-black/20 p-5 text-sm text-slate-200 sm:grid-cols-2">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Contact Email</div>
              <div className="mt-2 font-medium text-white">{invite.contactEmail}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Status</div>
              <div className="mt-2 font-medium text-white">{invite.status}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Stage</div>
              <div className="mt-2 font-medium text-white">{invite.stage?.name ?? "--"}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Group</div>
              <div className="mt-2 font-medium text-white">{invite.group?.name ?? "None"}</div>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="mb-6 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="mb-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {success}
          </div>
        ) : null}

        {invite?.status === "ACCEPTED" ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-100">
            This invite has already been used{invite.team?.name ? ` by ${invite.team.name}` : ""}.
          </div>
        ) : invite?.status === "EXPIRED" ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-4 text-sm text-red-100">
            This invite is no longer valid.
          </div>
        ) : (
          <form className="space-y-8" onSubmit={onSubmit}>
            <section>
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-200">Team Name</span>
                <input
                  value={teamName}
                  onChange={(event) => setTeamName(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/50"
                  placeholder="Team name"
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
                      onChange={(event) => updateSlot(setMainPlayers, index, event.target.value)}
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
                      onChange={(event) => updateSlot(setSubPlayers, index, event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/50"
                      placeholder={`Substitute ${index + 1}`}
                    />
                  </label>
                ))}
              </div>
            </section>

            <button
              type="submit"
              disabled={submitting || !token}
              className="inline-flex rounded-full bg-cyan-400 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-500"
            >
              {submitting ? "Submitting..." : "Accept Invite"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
