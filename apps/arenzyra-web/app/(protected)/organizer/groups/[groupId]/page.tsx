"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import TeamAssignmentModal, {
  type TeamAssignmentOption,
} from "@/components/common/TeamAssignmentModal";
import { EmptyState } from "@/components/ui/EmptyState";
import { getTelemetrySourceLabel } from "@/features/matches/match-form-payload";
import {
  fetchMatchControlSnapshotMap,
  getControlRuntimeBadge,
  type MatchRuntimeControlSnapshot,
} from "@/features/matches/match-control-runtime";
import { MatchUpsertModal } from "./MatchUpsertModal";
import ConfirmDeleteModal from "@/components/common/ConfirmDeleteModal";
import { MultiMatchModal } from "./MultiMatchModal";

const normalizeMatchStatus = (match: MatchStub) => {
  return getControlRuntimeBadge(match.control);
};

const badgeColor = (status: string | null | undefined) => {
  const key = (status ?? "").toUpperCase();
  switch (key) {
    case "DRAFT":
      return "bg-gray-500/15 text-gray-300";
    case "LIVE":
      return "bg-green-500/20 text-green-400";
    case "FINALIZING":
      return "bg-amber-500/20 text-amber-300";
    case "FINALIZED":
      return "bg-blue-500/20 text-blue-400";
    default:
      return "bg-white/10 text-white/80";
  }
};

const sourceBadgeColor = (source: string | null | undefined) => {
  return getTelemetrySourceLabel(source) === "Automatic"
    ? "bg-cyan-500/20 text-cyan-400"
    : "bg-gray-500/15 text-gray-300";
};

const firstSourceValue = (...values: Array<string | null | undefined>) => {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }

  return null;
};

const matchSourceValue = (match: MatchStub) =>
  firstSourceValue(
    match.control?.binding?.telemetryProvider,
    match.control?.binding?.sourceMode,
    match.control?.binding?.dataSource,
    match.control?.binding?.dataMode,
    match.dataSource,
  );

const matchLabel = (match: MatchStub, idx: number) => {
  if (match.name) {
    const normalized = match.name.match(/^Match\s+(\d+)$/i);
    if (normalized) return `Match #${normalized[1]}`;
    return match.name;
  }

  return `Match #${match.matchNumber ?? idx + 1}`;
};

const pad = (value: number) => value.toString().padStart(2, "0");

const toScheduleDateValue = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

const formatScheduleDate = (value?: string | null) => {
  const normalized = toScheduleDateValue(value);
  if (!normalized) return "--";
  const [year, month, day] = normalized.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
};

type MatchStub = {
  id: string;
  name?: string | null;
  status?: string | null;
  liveState?: string | null;
  scheduledAt?: string | null;
  createdAt?: string | null;
  map?: string | null;
  matchNumber?: number | null;
  dataSource?: string | null;
  loadTeamsFromGroup?: boolean | null;
  controlState?: { state?: string | null } | null;
  control?: MatchRuntimeControlSnapshot | null;
};

type GroupDetail = {
  id: string;
  name?: string | null;
  stage?: { id: string; name?: string | null; tournamentId: string };
};

type GroupTeam = {
  id: string;
  tournamentTeamId: string;
  team?: { id: string; name?: string | null; tag?: string | null; logoUrl?: string | null } | null;
};

type StageTeam = {
  id: string;
  tournamentTeamId: string;
  team?: { id: string; name?: string | null; tag?: string | null; logoUrl?: string | null } | null;
};

const buildSelectionSet = (items: Iterable<string>) => new Set(items);

const hasSelectionChanged = (current: ReadonlySet<string>, baseline: ReadonlySet<string>) => {
  if (current.size !== baseline.size) return true;

  for (const value of current) {
    if (!baseline.has(value)) return true;
  }

  return false;
};

export default function GroupDetailPage() {
  const params = useParams<{ groupId: string }>();
  const groupId = params?.groupId;

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMatch, setEditingMatch] = useState<MatchStub | null>(null);
  const [deletingMatch, setDeletingMatch] = useState<MatchStub | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [matches, setMatches] = useState<MatchStub[]>([]);
  const [multiModalOpen, setMultiModalOpen] = useState(false);
  const [stageTeams, setStageTeams] = useState<StageTeam[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [savingAssign, setSavingAssign] = useState(false);
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<string>>(new Set());
  const [assignedTeamIds, setAssignedTeamIds] = useState<Set<string>>(new Set());
  const [dateFilter, setDateFilter] = useState("all");

  const load = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    setError(null);
    try {
      const [groupRes, matchesRes] = await Promise.all([
        apiFetch(`/me/groups/${groupId}`, { cache: "no-store" }),
        apiFetch(`/me/groups/${groupId}/matches`, { cache: "no-store" }),
      ]);

      const groupJson = await groupRes.json();
      const matchesJson = await matchesRes.json();

      setGroup(groupJson?.data ?? groupJson ?? null);

      const matchList = Array.isArray(matchesJson)
        ? matchesJson
        : Array.isArray(matchesJson?.matches)
          ? matchesJson.matches
          : Array.isArray(matchesJson?.data)
            ? matchesJson.data
            : [];
      const controls = await fetchMatchControlSnapshotMap(
        (matchList as MatchStub[]).map((match) => match.id),
      );
      setMatches(
        (matchList as MatchStub[]).map((match) => ({
          ...match,
          control: controls[match.id] ?? null,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load group");
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadGroupTeams = useCallback(async () => {
    if (!groupId) return;
    try {
      const res = await apiFetch(`/org/me/groups/${groupId}/teams`, { cache: "no-store" });
      const json = await res.json();
      const list: GroupTeam[] =
        (json?.groupTeams as GroupTeam[]) ??
        (json?.data as GroupTeam[]) ??
        (Array.isArray(json) ? (json as GroupTeam[]) : []);
      const nextAssignedIds = buildSelectionSet(list.map((team) => team.tournamentTeamId));
      setSelectedTeamIds(nextAssignedIds);
      setAssignedTeamIds(buildSelectionSet(nextAssignedIds));
    } catch (err) {
      console.warn("Failed to load group teams", err);
    }
  }, [groupId]);

  useEffect(() => {
    void loadGroupTeams();
  }, [loadGroupTeams]);

  const matchesCount = matches.length;
  const scheduleDateOptions = useMemo(
    () =>
      Array.from(
        new Set(
          matches
            .map((match) => toScheduleDateValue(match.scheduledAt))
            .filter(Boolean),
        ),
      ).sort(),
    [matches],
  );
  const activeDateFilter =
    dateFilter === "all" || scheduleDateOptions.includes(dateFilter)
      ? dateFilter
      : "all";

  const openCreateModal = () => {
    setEditingMatch(null);
    setModalOpen(true);
  };

  const openEditModal = (m: MatchStub) => {
    setEditingMatch(m);
    setModalOpen(true);
  };

  const loadStageTeams = useCallback(async () => {
    const stageId = group?.stage?.id;
    if (!stageId) return;
    try {
      const res = await apiFetch(`/org/me/stages/${stageId}/teams`, { cache: "no-store" });
      const json = await res.json();
      const list: StageTeam[] =
        (json?.stageTeams as StageTeam[]) ??
        (json?.data as StageTeam[]) ??
        (Array.isArray(json) ? (json as StageTeam[]) : []);
      setStageTeams(list);
    } catch (err) {
      console.warn("Failed to load stage teams", err);
    }
  }, [group?.stage?.id]);

  useEffect(() => {
    void loadStageTeams();
  }, [loadStageTeams]);

  const visibleMatches = useMemo(() => {
    const filtered =
      activeDateFilter === "all"
        ? matches
        : matches.filter(
            (match) => toScheduleDateValue(match.scheduledAt) === activeDateFilter,
          );

    return [...filtered].sort((a, b) => {
      const aDate = toScheduleDateValue(a.scheduledAt);
      const bDate = toScheduleDateValue(b.scheduledAt);

      if (aDate && bDate && aDate !== bDate) return aDate.localeCompare(bDate);
      if (aDate && !bDate) return -1;
      if (!aDate && bDate) return 1;

      const aNumber = a.matchNumber ?? Number.MAX_SAFE_INTEGER;
      const bNumber = b.matchNumber ?? Number.MAX_SAFE_INTEGER;
      if (aNumber !== bNumber) return aNumber - bNumber;

      return (a.name ?? "").localeCompare(b.name ?? "");
    });
  }, [activeDateFilter, matches]);

  const assignableTeams = useMemo<TeamAssignmentOption[]>(
    () =>
      stageTeams.map((team) => ({
        id: team.tournamentTeamId,
        name: team.team?.name ?? "Unnamed Team",
        tag: team.team?.tag ?? null,
        logoUrl: team.team?.logoUrl ?? null,
      })),
    [stageTeams],
  );
  const hasAssignChanges = useMemo(
    () => hasSelectionChanged(selectedTeamIds, assignedTeamIds),
    [assignedTeamIds, selectedTeamIds],
  );

  const openAssign = async () => {
    setError(null);
    setSelectedTeamIds(buildSelectionSet(assignedTeamIds));
    if (stageTeams.length === 0) {
      await loadStageTeams();
    }
    setAssignOpen(true);
  };

  const closeAssign = () => {
    setSelectedTeamIds(buildSelectionSet(assignedTeamIds));
    setAssignOpen(false);
  };

  if (!groupId) return <div className="text-red-300">Group id missing.</div>;
  if (loading) return <div className="text-white/70">Loading group...</div>;

  if (error || !group) {
    return (
      <EmptyState
        title="Unable to load group"
        description={error ?? "Group not found."}
        actionLabel="Retry"
        onAction={load}
      />
    );
  }

  const tournamentId = group.stage?.tournamentId;
  const stageId = group.stage?.id;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3">
        <div>
          <h1 className="text-xl font-semibold text-white">{group.name ?? "Group"}</h1>
          <div className="mt-1 flex items-center gap-4 text-sm text-white/70">
            {group.stage?.name ? <span>Stage: {group.stage.name}</span> : null}
            <span>Matches: {matchesCount}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void openAssign()}
            className="rounded border border-white/20 px-4 py-2 text-sm font-semibold text-white/80 hover:text-white hover:border-white/40"
          >
            Assign Teams
          </button>
          <button
            onClick={openCreateModal}
            className="rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition hover:from-cyan-400 hover:to-blue-400"
          >
            + Create Match
          </button>
          <button
            onClick={() => setMultiModalOpen(true)}
            className="rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition hover:from-cyan-400 hover:to-blue-400"
          >
            + Create Multiple Matches
          </button>
          {stageId && tournamentId ? (
            <Link
              className="rounded border border-white/15 px-4 py-2 text-sm font-semibold text-white/80 hover:text-white hover:border-white/30"
              href={`/organizer/tournaments/${tournamentId}/stages/${stageId}`}
            >
              Back to Stage
            </Link>
          ) : null}
        </div>
      </div>

      {matches.length === 0 ? (
        <EmptyState
          title="No matches yet"
          description="Create a match to start scheduling games for this group."
          actionLabel="Create Match"
          onAction={openCreateModal}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3">
            <div className="text-sm text-white/65">
              {activeDateFilter === "all"
                ? "Showing all matches"
                : `Showing matches for ${formatScheduleDate(activeDateFilter)}`}
            </div>
            <label className="flex items-center gap-3 text-sm text-white/80">
              <span>Schedule Day</span>
              <select
                value={activeDateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none transition focus:border-indigo-400"
              >
                <option value="all">All dates</option>
                {scheduleDateOptions.map((dateValue) => (
                  <option key={dateValue} value={dateValue}>
                    {formatScheduleDate(dateValue)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {visibleMatches.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/15 bg-white/5 px-6 py-10 text-center text-white/70">
              No matches scheduled for this date.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-white/10">
              <table className="table-fixed w-full text-sm">
                <thead className="bg-white/5 text-left uppercase text-xs tracking-wide">
                  <tr>
                    <th className="w-[220px] px-4 py-3">Name</th>
                    <th className="w-[140px] px-4 py-3">Map</th>
                    <th className="w-[160px] px-4 py-3">Date</th>
                    <th className="w-[140px] px-4 py-3">Telemetry Source</th>
                    <th className="w-[120px] px-4 py-3">Status</th>
                    <th className="w-[200px] px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMatches.map((match, idx) => {
                    const source = matchSourceValue(match);

                    return (
                      <tr key={match.id} className="border-t border-white/5">
                        <td className="px-4 py-2.5">{matchLabel(match, idx)}</td>
                        <td className="px-4 py-2.5 text-white/70">{match.map ?? "--"}</td>
                        <td className="px-4 py-2.5 text-white/70">
                          {formatScheduleDate(match.scheduledAt)}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide ${sourceBadgeColor(
                              source,
                            )}`}
                          >
                            {getTelemetrySourceLabel(source)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${badgeColor(
                              normalizeMatchStatus(match),
                            )}`}
                          >
                            {normalizeMatchStatus(match)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end gap-2 whitespace-nowrap">
                            <Link
                              className="rounded-md px-3 py-1.5 text-sm font-semibold text-indigo-200 ring-1 ring-indigo-400/40 hover:bg-indigo-500/20"
                              href={`/organizer/matches/${match.id}/control`}
                            >
                              Open
                            </Link>
                            <button
                              className="rounded-md px-3 py-1.5 text-sm font-semibold text-white ring-1 ring-white/20 hover:bg-white/10"
                              onClick={() => openEditModal(match)}
                              type="button"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="rounded-md px-3 py-1.5 text-sm font-semibold text-red-100 ring-1 ring-red-500/40 hover:bg-red-500/20 disabled:opacity-50"
                              disabled={["LIVE", "FINALIZING", "FINALIZED"].includes(
                                normalizeMatchStatus(match),
                              )}
                              onClick={() => {
                                setDeletingMatch(match);
                                setError(null);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <MatchUpsertModal
        mode={editingMatch ? "edit" : "create"}
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) setEditingMatch(null);
        }}
        groupId={groupId}
        matches={matches}
        initial={editingMatch ?? undefined}
        onSuccess={async () => {
          setEditingMatch(null);
          await load();
        }}
      />

      <ConfirmDeleteModal
        open={!!deletingMatch}
        title="Delete match?"
        description={`This will remove ${deletingMatch?.name ?? "the match"} and its assignments.`}
        loading={deleteLoading}
        onClose={() => {
          if (deleteLoading) return;
          setDeletingMatch(null);
        }}
        onConfirm={async () => {
          if (!deletingMatch?.id) return;
          setDeleteLoading(true);
          setError(null);
          try {
            await apiFetch(`/me/matches/${deletingMatch.id}`, { method: "DELETE" });
            setDeletingMatch(null);
            await load();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to delete match");
          } finally {
            setDeleteLoading(false);
          }
        }}
      />

      <MultiMatchModal
        open={multiModalOpen}
        onOpenChange={(open) => setMultiModalOpen(open)}
        groupId={groupId}
        matches={matches}
        onSuccess={async () => {
          await load();
        }}
      />

      {assignOpen ? (
        <TeamAssignmentModal
          eyebrow="Group Assignment"
          title="Assign teams to group"
          description="Choose which stage teams belong in this group. Only selected teams will be used when scheduling matches here."
          teams={assignableTeams}
          selectedIds={selectedTeamIds}
          setSelectedIds={setSelectedTeamIds}
          helperText="Groups can only use teams that are already assigned to the stage."
          emptyTitle="No stage teams available"
          emptyDescription="Assign teams at the stage level first, then return here to place them into this group."
          saveLabel="Save changes"
          savingLabel="Saving..."
          saving={savingAssign}
          saveDisabled={savingAssign || stageTeams.length === 0 || !hasAssignChanges}
          onClose={closeAssign}
          onSave={async () => {
            if (!groupId) return;
            setSavingAssign(true);
            try {
              const res = await apiFetch(`/org/me/groups/${groupId}/teams`, {
                cache: "no-store",
              });
              const json = await res.json();
              const existing: GroupTeam[] =
                (json?.groupTeams as GroupTeam[]) ??
                (json?.data as GroupTeam[]) ??
                (Array.isArray(json) ? (json as GroupTeam[]) : []);

              const existingIds = buildSelectionSet(existing.map((team) => team.tournamentTeamId));
              const nextSelectedIds = buildSelectionSet(selectedTeamIds);
              const toAdd = Array.from(nextSelectedIds).filter((id) => !existingIds.has(id));
              const toRemove = existing.filter((team) => !nextSelectedIds.has(team.tournamentTeamId));

              for (const addId of toAdd) {
                await apiFetch(`/org/me/groups/${groupId}/teams`, {
                  method: "POST",
                  body: JSON.stringify({ tournamentTeamId: addId }),
                });
              }

              for (const team of toRemove) {
                await apiFetch(`/org/me/groups/${groupId}/teams/${team.id}`, {
                  method: "DELETE",
                });
              }

              setAssignedTeamIds(buildSelectionSet(nextSelectedIds));
              setSelectedTeamIds(nextSelectedIds);
              await loadGroupTeams();
              setAssignOpen(false);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to assign teams");
            } finally {
              setSavingAssign(false);
            }
          }}
        />
      ) : null}

    </div>
  );
}
