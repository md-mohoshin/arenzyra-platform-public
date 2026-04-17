"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  getMatchSourceSelection,
  MATCH_SOURCE_OPTIONS,
  sanitizeMatchFormPayload,
  type MatchSourceSelection,
} from "@/features/matches/match-form-payload";

export type MatchUpsertInitial = {
  id?: string;
  name?: string | null;
  map?: string | null;
  matchNumber?: number | null;
  scheduledAt?: string | null;
  loadTeamsFromGroup?: boolean | null;
  dataSource?: string | null;
  telemetryProvider?: string | null;
  status?: string | null;
};

type Props = {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  matches?: { matchNumber?: number | null }[];
  initial?: MatchUpsertInitial | null;
  onSuccess: () => Promise<void> | void;
};

const toUiStatus = (backend?: string | null) => {
  const key = (backend ?? "").toUpperCase();
  if (key === "DRAFT") return "SCHEDULED";
  if (key === "ENDED") return "COMPLETED";
  if (key === "LIVE") return "LIVE";
  return "SCHEDULED";
};

const toBackendStatus = (ui?: string | null) => {
  const key = (ui ?? "").toUpperCase();
  if (key === "SCHEDULED") return "DRAFT";
  if (key === "COMPLETED") return "ENDED";
  if (key === "LIVE") return "LIVE";
  return "DRAFT";
};

const pad = (value: number) => value.toString().padStart(2, "0");

const toDateInputValue = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

export function MatchUpsertModal({
  mode,
  open,
  onOpenChange,
  groupId,
  matches = [],
  initial,
  onSuccess,
}: Props) {
  const [matchName, setMatchName] = useState("");
  const [matchMap, setMatchMap] = useState<string>("ERANGEL");
  const [matchNumber, setMatchNumber] = useState<string>("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [loadTeams, setLoadTeams] = useState(true);
  const [sourceSelection, setSourceSelection] =
    useState<MatchSourceSelection>("API");
  const [status, setStatus] = useState("SCHEDULED");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = mode === "edit" ? "Edit Match" : "Create Match";
  const cta = mode === "edit" ? "Save" : "Create";

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && initial) {
      setMatchName(initial.name ?? "Match");
      setMatchMap(initial.map ?? "ERANGEL");
      setMatchNumber(
        initial.matchNumber !== undefined && initial.matchNumber !== null
          ? String(initial.matchNumber)
          : "",
      );
      setScheduledAt(toDateInputValue(initial.scheduledAt));
      setLoadTeams(initial.loadTeamsFromGroup ?? true);
      setSourceSelection(
        getMatchSourceSelection({
          telemetryProvider: initial.telemetryProvider ?? null,
          dataSource: initial.dataSource ?? null,
        }),
      );
      setStatus(toUiStatus(initial.status));
      setShowAdvanced(false);
      setError(null);
    } else {
      setMatchName("");
      setMatchMap("ERANGEL");
      const nextMatchNumber =
        matches.length > 0
          ? Math.max(...matches.map((m) => m.matchNumber ?? 0)) + 1
          : 1;
      setMatchNumber(String(nextMatchNumber));
      setScheduledAt("");
      setLoadTeams(true);
      setSourceSelection("API");
      setStatus("SCHEDULED");
      setShowAdvanced(false);
      setError(null);
    }
  }, [open, mode, initial, matches]);

  const bodyPayload = useMemo(
    () => ({
      name: matchName.trim() || undefined,
      groupId,
      map: matchMap?.trim() || undefined,
      matchNumber: matchNumber ? Number(matchNumber) : undefined,
      scheduledAt: scheduledAt || undefined,
      loadTeamsFromGroup: loadTeams,
      status: toBackendStatus(status),
    }),
    [matchName, groupId, matchMap, matchNumber, scheduledAt, loadTeams, status],
  );

  const submit = async () => {
    if (!groupId) return;
    if (!bodyPayload.map) {
      setError("Select a map for the match.");
      return;
    }
    const sanitized = sanitizeMatchFormPayload(bodyPayload, {
      sourceSelection,
    });
    if (sanitized.error) {
      setError(sanitized.error);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "edit" && initial?.id) {
        await apiFetch(`/me/matches/${initial.id}`, {
          method: "PATCH",
          body: JSON.stringify(sanitized.payload),
        });
      } else {
        await apiFetch(`/me/groups/${groupId}/matches`, {
          method: "POST",
          body: JSON.stringify(sanitized.payload),
        });
      }
      onOpenChange(false);
      await onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save match");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            <p className="text-sm text-white/60">
              {mode === "edit" ? "Update match details." : "Add a match to this group."}
            </p>
          </div>
          <button
            className="text-white/60 hover:text-white"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {error ? (
          <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
            {error}
          </div>
        ) : null}

        <div className="space-y-3">
          <label className="block space-y-1 text-sm text-white/80">
            <span>Match Name</span>
            <input
              type="text"
              value={matchName}
              onChange={(e) => setMatchName(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none transition focus:border-indigo-400"
              placeholder="Match name"
            />
          </label>

          <label className="block space-y-1 text-sm text-white/80">
            <span>Map</span>
            <select
              className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none transition focus:border-indigo-400"
              value={matchMap}
              onChange={(e) => setMatchMap(e.target.value)}
            >
              <option value="ERANGEL">Erangel</option>
              <option value="MIRAMAR">Miramar</option>
              <option value="SANHOK">Sanhok</option>
              <option value="VIKENDI">Vikendi</option>
              <option value="LIVIK">Livik</option>
              <option value="KARAKIN">Karakin</option>
              <option value="DESTON">Deston</option>
              <option value="RONDO">Rondo</option>
              <option value="NUSA">Nusa</option>
            </select>
          </label>

          <label className="block space-y-1 text-sm text-white/80">
            <span>Match Number</span>
            <input
              type="number"
              value={matchNumber}
              onChange={(e) => setMatchNumber(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none transition focus:border-indigo-400"
              placeholder="1"
              min={1}
            />
          </label>

          <label className="block space-y-1 text-sm text-white/80">
            <span>Match Date</span>
            <input
              type="date"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none transition focus:border-indigo-400"
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              checked={loadTeams}
              onChange={(e) => setLoadTeams(e.target.checked)}
              className="h-4 w-4"
            />
            <span>Load teams from group</span>
          </label>

          <button
            type="button"
            className="text-sm text-indigo-300 hover:text-indigo-200"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? "Hide Advanced Settings" : "Show Advanced Settings"}
          </button>

          {showAdvanced ? (
            <div className="space-y-3 rounded-lg border border-white/10 bg-black/30 p-3">
              <label className="block space-y-1 text-sm text-white/80">
                <span>Telemetry Source</span>
                <select
                  className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none transition focus:border-indigo-400"
                  value={sourceSelection}
                  onChange={(e) =>
                    setSourceSelection(e.target.value as MatchSourceSelection)
                  }
                >
                  {MATCH_SOURCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-white/45">
                  Automatic submits the canonical `API` telemetry provider.
                </p>
              </label>

              <label className="block space-y-1 text-sm text-white/80">
                <span>Status</span>
                <select
                  className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none transition focus:border-indigo-400"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="SCHEDULED">Scheduled</option>
                  <option value="LIVE">Live</option>
                  <option value="COMPLETED">Completed</option>
                </select>
              </label>
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex justify-end gap-3">
          <button
            type="button"
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white/70 hover:text-white"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-500 disabled:opacity-50"
            disabled={submitting || !matchMap.trim()}
            onClick={submit}
          >
            {submitting ? "Saving..." : cta}
          </button>
        </div>
      </div>
    </div>
  );
}
