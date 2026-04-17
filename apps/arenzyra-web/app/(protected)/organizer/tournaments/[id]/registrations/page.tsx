"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Check, Copy, Link2, Mail, UserRound, X } from "lucide-react";
import { ApiError, apiFetch, getApiErrorMessage } from "@/lib/api";

type RegistrationPlayer = {
  name: string;
};

type StageOption = {
  id: string;
  name: string;
  groups?: Array<{
    id: string;
    name: string;
  }> | null;
};

type TournamentDetail = {
  id: string;
  name: string;
  defaultRegistrationStageId?: string | null;
  defaultRegistrationStage?: {
    id: string;
    name: string;
  } | null;
};

type TournamentRegistration = {
  id: string;
  tournamentId: string;
  stageId: string;
  groupId: string | null;
  teamId: string | null;
  teamName: string;
  contactEmail: string;
  players: {
    main: RegistrationPlayer[];
    subs: RegistrationPlayer[];
  };
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectionReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  stage?: {
    id: string;
    name: string;
  } | null;
  group?: {
    id: string;
    name: string;
  } | null;
  reviewedBy?: {
    id: string;
    email: string;
    name: string;
  } | null;
  team?: {
    id: string;
    name: string;
    tag: string | null;
    logoUrl: string | null;
  } | null;
};

type TournamentInvite = {
  id: string;
  tournamentId: string;
  stageId: string;
  groupId: string | null;
  contactEmail: string;
  inviteToken: string;
  status: "PENDING" | "ACCEPTED" | "EXPIRED";
  teamId: string | null;
  createdAt: string;
  acceptedAt: string | null;
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
    tag: string | null;
    logoUrl: string | null;
  } | null;
};

const queryClient = new QueryClient();

function StatusBadge({
  status,
}: {
  status: TournamentRegistration["status"] | TournamentInvite["status"];
}) {
  const classes =
    status === "APPROVED" || status === "ACCEPTED"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
      : status === "REJECTED" || status === "EXPIRED"
        ? "border-red-500/30 bg-red-500/10 text-red-200"
        : "border-amber-500/30 bg-amber-500/10 text-amber-100";

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide ${classes}`}
    >
      {status}
    </span>
  );
}

function RegistrationsPageInner() {
  const params = useParams<{ id: string }>();
  const tournamentId = params?.id ?? "";
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState<TournamentRegistration | null>(
    null,
  );
  const [rejectionReason, setRejectionReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [defaultStageIdDraft, setDefaultStageIdDraft] = useState<string | null>(
    null,
  );
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteStageId, setInviteStageId] = useState("");
  const [inviteGroupId, setInviteGroupId] = useState("");
  const [generatedInviteLink, setGeneratedInviteLink] = useState<string | null>(
    null,
  );

  const publicLink = useMemo(() => {
    if (typeof window === "undefined") {
      return `/registration/${tournamentId}`;
    }
    return `${window.location.origin}/registration/${tournamentId}`;
  }, [tournamentId]);

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(value);
      window.setTimeout(
        () => setCopiedValue((current) => (current === value ? null : current)),
        1500,
      );
    } catch {
      setCopiedValue(null);
    }
  };

  const tournamentQuery = useQuery({
    queryKey: ["organizerTournamentRegistrationSettings", tournamentId],
    enabled: !!tournamentId,
    queryFn: async () => {
      const response = await apiFetch(
        `/organizer/tournaments/${tournamentId}`,
        {
          cache: "no-store",
        },
      );
      return (await response.json()) as TournamentDetail;
    },
  });

  const stagesQuery = useQuery({
    queryKey: ["organizerTournamentStages", tournamentId],
    enabled: !!tournamentId,
    queryFn: async () => {
      const response = await apiFetch(
        `/organizer/tournaments/${tournamentId}/stages`,
        {
          cache: "no-store",
        },
      );
      const payload = (await response.json()) as
        | StageOption[]
        | { data?: StageOption[] };
      if (Array.isArray(payload)) return payload;
      return Array.isArray(payload.data) ? payload.data : [];
    },
  });

  const registrationsQuery = useQuery({
    queryKey: ["tournamentRegistrations", tournamentId],
    enabled: !!tournamentId,
    retry: (failureCount, queryError) => {
      if (
        queryError instanceof ApiError &&
        [401, 403, 404].includes(queryError.status)
      ) {
        return false;
      }
      return failureCount < 1;
    },
    queryFn: async () => {
      const response = await apiFetch(
        `/organizer/tournaments/${tournamentId}/registrations`,
        {
          cache: "no-store",
        },
      );
      const payload = (await response.json()) as
        | TournamentRegistration[]
        | { data?: TournamentRegistration[] };
      if (Array.isArray(payload)) return payload;
      return Array.isArray(payload.data) ? payload.data : [];
    },
  });

  const invitesQuery = useQuery({
    queryKey: ["tournamentInvites", tournamentId],
    enabled: !!tournamentId,
    queryFn: async () => {
      const response = await apiFetch(
        `/organizer/tournaments/${tournamentId}/invites`,
        {
          cache: "no-store",
        },
      );
      const payload = (await response.json()) as
        | TournamentInvite[]
        | { data?: TournamentInvite[] };
      if (Array.isArray(payload)) return payload;
      return Array.isArray(payload.data) ? payload.data : [];
    },
  });

  const registrations = registrationsQuery.data ?? [];
  const invites = invitesQuery.data ?? [];
  const stages = stagesQuery.data ?? [];
  const defaultStageId =
    defaultStageIdDraft ??
    tournamentQuery.data?.defaultRegistrationStageId ??
    "";
  const selectedInviteStageId =
    inviteStageId || defaultStageId || stages[0]?.id || "";
  const selectedInviteStage =
    stages.find((stage) => stage.id === selectedInviteStageId) ?? null;
  const selectedInviteGroupId = selectedInviteStage?.groups?.some(
    (group) => group.id === inviteGroupId,
  )
    ? inviteGroupId
    : "";

  const refreshAll = async () => {
    await Promise.all([
      qc.invalidateQueries({
        queryKey: ["organizerTournamentRegistrationSettings", tournamentId],
      }),
      qc.invalidateQueries({
        queryKey: ["tournamentRegistrations", tournamentId],
      }),
      qc.invalidateQueries({ queryKey: ["tournamentInvites", tournamentId] }),
    ]);
  };

  const approveMutation = useMutation({
    mutationFn: async (registrationId: string) => {
      await apiFetch(`/organizer/registrations/${registrationId}/approve`, {
        method: "POST",
      });
    },
    onSuccess: async () => {
      setActionError(null);
      await refreshAll();
    },
    onError: (error) => {
      setActionError(
        getApiErrorMessage(error, "Failed to approve registration"),
      );
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({
      registrationId,
      reason,
    }: {
      registrationId: string;
      reason: string;
    }) => {
      await apiFetch(`/organizer/registrations/${registrationId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
    },
    onSuccess: async () => {
      setActionError(null);
      setRejecting(null);
      setRejectionReason("");
      await refreshAll();
    },
    onError: (error) => {
      setActionError(
        getApiErrorMessage(error, "Failed to reject registration"),
      );
    },
  });

  const settingsMutation = useMutation({
    mutationFn: async () => {
      await apiFetch(`/organizer/tournaments/${tournamentId}`, {
        method: "PATCH",
        body: JSON.stringify({
          defaultRegistrationStageId: defaultStageId || null,
        }),
      });
    },
    onSuccess: async () => {
      setActionError(null);
      await qc.invalidateQueries({
        queryKey: ["organizerTournamentRegistrationSettings", tournamentId],
      });
    },
    onError: (error) => {
      setActionError(
        getApiErrorMessage(error, "Failed to update registration settings"),
      );
    },
  });

  const createInviteMutation = useMutation({
    mutationFn: async () => {
      const response = await apiFetch(
        `/organizer/tournaments/${tournamentId}/invites`,
        {
          method: "POST",
          body: JSON.stringify({
            contactEmail: inviteEmail,
            stageId: selectedInviteStageId,
            groupId: selectedInviteGroupId || null,
          }),
        },
      );
      return (await response.json()) as TournamentInvite;
    },
    onSuccess: async (invite) => {
      setActionError(null);
      setInviteEmail("");
      setInviteGroupId("");
      if (typeof window !== "undefined") {
        setGeneratedInviteLink(
          `${window.location.origin}/registration/invite/${invite.inviteToken}`,
        );
      } else {
        setGeneratedInviteLink(`/registration/invite/${invite.inviteToken}`);
      }
      await qc.invalidateQueries({
        queryKey: ["tournamentInvites", tournamentId],
      });
    },
    onError: (error) => {
      setActionError(getApiErrorMessage(error, "Failed to create invite"));
    },
  });

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-lg">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-white">Registrations</h1>
            <p className="mt-2 max-w-3xl text-sm text-white/60">
              Public registrations are stored against a stage first. Approval or
              invite acceptance creates the actual team, tournament team link,
              and roster snapshot.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/70">
            <div className="mb-2 font-medium text-white">
              Public registration link
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <code className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/75">
                {publicLink}
              </code>
              <button
                type="button"
                onClick={() => void copyText(publicLink)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/20"
              >
                {copiedValue === publicLink ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copiedValue === publicLink ? "Copied" : "Copy link"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {actionError ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {actionError}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-lg">
          <div className="mb-4">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
              Tournament Settings
            </div>
            <h2 className="mt-2 text-xl font-semibold text-white">
              Default registration stage
            </h2>
          </div>
          <div className="space-y-4">
            <select
              value={defaultStageId}
              onChange={(event) => setDefaultStageIdDraft(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/50"
            >
              <option value="" className="bg-slate-950">
                Select default stage
              </option>
              {stages.map((stage) => (
                <option
                  key={stage.id}
                  value={stage.id}
                  className="bg-slate-950"
                >
                  {stage.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => settingsMutation.mutate()}
              disabled={settingsMutation.isPending || !tournamentId}
              className="inline-flex rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-500"
            >
              {settingsMutation.isPending ? "Saving..." : "Save setting"}
            </button>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-lg">
          <div className="mb-4">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
              Invite Teams
            </div>
            <h2 className="mt-2 text-xl font-semibold text-white">
              Create single-use invite
            </h2>
          </div>
          <div className="space-y-4">
            <input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="team@example.com"
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/50"
            />
            <select
              value={selectedInviteStageId}
              onChange={(event) => setInviteStageId(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/50"
            >
              <option value="" className="bg-slate-950">
                Select stage
              </option>
              {stages.map((stage) => (
                <option
                  key={stage.id}
                  value={stage.id}
                  className="bg-slate-950"
                >
                  {stage.name}
                </option>
              ))}
            </select>
            <select
              value={selectedInviteGroupId}
              onChange={(event) => setInviteGroupId(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/50"
            >
              <option value="" className="bg-slate-950">
                No group
              </option>
              {(selectedInviteStage?.groups ?? []).map((group) => (
                <option
                  key={group.id}
                  value={group.id}
                  className="bg-slate-950"
                >
                  {group.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => createInviteMutation.mutate()}
              disabled={
                createInviteMutation.isPending ||
                !inviteEmail ||
                !selectedInviteStageId
              }
              className="inline-flex rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-500"
            >
              {createInviteMutation.isPending
                ? "Generating..."
                : "Generate invite"}
            </button>
            {generatedInviteLink ? (
              <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                <div className="mb-2 font-medium">Invite link</div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <code className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/85">
                    {generatedInviteLink}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copyText(generatedInviteLink)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/20"
                  >
                    {copiedValue === generatedInviteLink ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    {copiedValue === generatedInviteLink ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Link2 className="h-5 w-5 text-cyan-300" />
          <h2 className="text-xl font-semibold text-white">Invites</h2>
        </div>
        {invites.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 px-6 py-12 text-center text-white/70">
            No invites generated yet.
          </div>
        ) : (
          <div className="space-y-4">
            {invites.map((invite) => {
              const inviteLink =
                typeof window === "undefined"
                  ? `/registration/invite/${invite.inviteToken}`
                  : `${window.location.origin}/registration/invite/${invite.inviteToken}`;
              return (
                <article
                  key={invite.id}
                  className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-lg"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-base font-semibold text-white">
                          {invite.contactEmail}
                        </span>
                        <StatusBadge status={invite.status} />
                      </div>
                      <div className="flex flex-wrap gap-3 text-sm text-white/65">
                        <span>
                          Stage: {invite.stage?.name ?? invite.stageId}
                        </span>
                        <span>Group: {invite.group?.name ?? "None"}</span>
                        <span>
                          Created {new Date(invite.createdAt).toLocaleString()}
                        </span>
                      </div>
                      {invite.status === "ACCEPTED" && invite.team ? (
                        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                          Accepted by{" "}
                          <span className="font-semibold">
                            {invite.team.name}
                          </span>
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyText(inviteLink)}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-500/20"
                    >
                      {copiedValue === inviteLink ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                      {copiedValue === inviteLink ? "Copied" : "Copy link"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Mail className="h-5 w-5 text-cyan-300" />
          <h2 className="text-xl font-semibold text-white">Registrations</h2>
        </div>
        {registrationsQuery.isLoading ? (
          <div className="rounded-2xl border border-white/10 bg-slate-900/60 px-6 py-12 text-center text-white/70">
            Loading registrations...
          </div>
        ) : registrationsQuery.isError ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-6 py-12 text-center text-red-200">
            {getApiErrorMessage(
              registrationsQuery.error,
              "Failed to load registrations",
            )}
          </div>
        ) : registrations.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 px-6 py-12 text-center text-white/70">
            No registrations submitted yet.
          </div>
        ) : (
          <div className="space-y-4">
            {registrations.map((registration) => (
              <article
                key={registration.id}
                className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-lg"
              >
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-xl font-semibold text-white">
                        {registration.teamName}
                      </h3>
                      <StatusBadge status={registration.status} />
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm text-white/65">
                      <span className="inline-flex items-center gap-2">
                        <Mail className="h-4 w-4 text-cyan-300" />
                        {registration.contactEmail}
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <UserRound className="h-4 w-4 text-cyan-300" />
                        Submitted{" "}
                        {new Date(registration.createdAt).toLocaleString()}
                      </span>
                      <span>
                        Stage:{" "}
                        {registration.stage?.name ?? registration.stageId}
                      </span>
                      <span>Group: {registration.group?.name ?? "None"}</span>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
                          Main Players
                        </div>
                        <div className="space-y-2 text-sm text-white/85">
                          {registration.players.main.map((player, index) => (
                            <div
                              key={`${registration.id}-main-${index}`}
                              className="rounded-xl border border-white/8 bg-white/5 px-3 py-2"
                            >
                              {player.name}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
                          Substitutes
                        </div>
                        {registration.players.subs.length > 0 ? (
                          <div className="space-y-2 text-sm text-white/85">
                            {registration.players.subs.map((player, index) => (
                              <div
                                key={`${registration.id}-sub-${index}`}
                                className="rounded-xl border border-white/8 bg-white/5 px-3 py-2"
                              >
                                {player.name}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-sm text-white/45">
                            No substitutes submitted.
                          </div>
                        )}
                      </div>
                    </div>
                    {registration.status === "APPROVED" && registration.team ? (
                      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                        Approved team created:{" "}
                        <span className="font-semibold">
                          {registration.team.name}
                        </span>
                      </div>
                    ) : null}
                    {registration.status === "REJECTED" &&
                    registration.rejectionReason ? (
                      <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                        Rejection reason: {registration.rejectionReason}
                      </div>
                    ) : null}
                  </div>
                  {registration.status === "PENDING" ? (
                    <div className="flex shrink-0 flex-col gap-3">
                      <button
                        type="button"
                        onClick={() => approveMutation.mutate(registration.id)}
                        disabled={
                          approveMutation.isPending || rejectMutation.isPending
                        }
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-500"
                      >
                        <Check className="h-4 w-4" />
                        {approveMutation.isPending ? "Approving..." : "Approve"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRejecting(registration);
                          setRejectionReason("");
                        }}
                        disabled={
                          approveMutation.isPending || rejectMutation.isPending
                        }
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/40"
                      >
                        <X className="h-4 w-4" />
                        Reject
                      </button>
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {rejecting ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-950 p-6 shadow-2xl">
            <h2 className="text-xl font-semibold text-white">
              Reject registration
            </h2>
            <p className="mt-2 text-sm text-white/60">
              Provide a reason for rejecting{" "}
              <span className="font-semibold text-white">
                {rejecting.teamName}
              </span>
              .
            </p>
            <textarea
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              className="mt-4 min-h-32 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-red-400/50"
              placeholder="Explain why this application was rejected..."
            />
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setRejecting(null);
                  setRejectionReason("");
                }}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-white/70 transition hover:bg-white/5 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  rejectMutation.mutate({
                    registrationId: rejecting.id,
                    reason: rejectionReason,
                  })
                }
                disabled={
                  rejectMutation.isPending ||
                  rejectionReason.trim().length === 0
                }
                className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:bg-slate-500"
              >
                {rejectMutation.isPending
                  ? "Rejecting..."
                  : "Reject registration"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function TournamentRegistrationsPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <RegistrationsPageInner />
    </QueryClientProvider>
  );
}
