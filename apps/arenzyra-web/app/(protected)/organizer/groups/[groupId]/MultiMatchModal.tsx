"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  MATCH_SOURCE_OPTIONS,
  sanitizeMatchFormPayload,
  type MatchSourceSelection,
} from "@/features/matches/match-form-payload";

type MatchDraft = {
  name: string;
  map: string;
  matchNumber: number;
  scheduledAt: string;
  sourceSelection: MatchSourceSelection;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  matches: { matchNumber?: number | null }[];
  onSuccess: () => Promise<void> | void;
};

const MAP_OPTIONS = [
  "ERANGEL",
  "MIRAMAR",
  "SANHOK",
  "VIKENDI",
  "LIVIK",
  "KARAKIN",
  "DESTON",
  "RONDO",
  "NUSA",
];

const pad = (value: number) => value.toString().padStart(2, "0");

const addDaysToDateInput = (value: string, days: number) => {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

export function MultiMatchModal({
  open,
  onOpenChange,
  groupId,
  matches,
  onSuccess,
}: Props) {
  const [count, setCount] = useState<number>(3);
  const [startDate, setStartDate] = useState<string>("");
  const [matchesPerDay, setMatchesPerDay] = useState<number>(4);
  const [rotationText, setRotationText] = useState<string>("");
  const [sourceSelection, setSourceSelection] =
    useState<MatchSourceSelection>("API");
  const [drafts, setDrafts] = useState<MatchDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextBase = useMemo(() => {
    if (!matches?.length) return 1;
    return Math.max(...matches.map((m) => m.matchNumber ?? 0)) + 1;
  }, [matches]);

  const rotationList = useMemo(() => {
    const parts = rotationText
      .split(",")
      .map((p) => p.trim().toUpperCase())
      .filter(Boolean);
    return parts.length ? parts : [];
  }, [rotationText]);

  const generateDrafts = () => {
    const list: MatchDraft[] = [];
    const maps = rotationList.length ? rotationList : ["ERANGEL"];
    const perDay = Math.max(1, matchesPerDay || 1);
    for (let i = 0; i < Math.max(1, count); i += 1) {
      const matchNumber = nextBase + i;
      const map = maps[i % maps.length] ?? "ERANGEL";
      list.push({
        name: `Match ${matchNumber}`,
        map,
        matchNumber,
        scheduledAt: startDate ? addDaysToDateInput(startDate, Math.floor(i / perDay)) : "",
        sourceSelection,
      });
    }
    setDrafts(list);
  };

  useEffect(() => {
    if (open) {
      setError(null);
      generateDrafts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nextBase]);

  const updateDraft = (idx: number, patch: Partial<MatchDraft>) => {
    setDrafts((prev) =>
      prev.map((d, i) => {
        if (i !== idx) {
          return d;
        }

        return { ...d, ...patch };
      }),
    );
  };

  const buildBulkMatchPayload = (draft: MatchDraft, index: number) => {
    const rawMatchPayload = {
      name: draft.name?.trim() || undefined,
      groupId,
      map: draft.map?.trim().toUpperCase(),
      matchNumber: draft.matchNumber ?? undefined,
      scheduledAt: draft.scheduledAt || undefined,
      loadTeamsFromGroup: true,
      status: "DRAFT",
    };

    const sanitized = sanitizeMatchFormPayload(rawMatchPayload, {
      sourceSelection: draft.sourceSelection,
    });

    if (sanitized.error) {
      throw new Error(
        `Match ${draft.matchNumber ?? index + 1}: ${sanitized.error}`,
      );
    }

    return sanitized.payload;
  };

  const createAll = async () => {
    if (!groupId || drafts.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const payload = drafts.map((draft, index) =>
        buildBulkMatchPayload(draft, index),
      );
      console.log("FINAL BULK PAYLOAD", payload);
      await apiFetch(`/me/groups/${groupId}/matches/bulk`, {
        method: "POST",
        body: JSON.stringify({ matches: payload }),
      });
      onOpenChange(false);
      await onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create matches");
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-3xl rounded-xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Create Multiple Matches</h2>
            <p className="text-sm text-white/60">
              Generate matches in bulk, then edit before creating.
            </p>
          </div>
          <button
            className="text-white/60 hover:text-white"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {error ? (
          <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-4">
          <label className="space-y-1 text-sm text-white/80">
            <span>Number of Matches</span>
            <input
              type="number"
              min={1}
              max={50}
              value={count}
              onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
              className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none transition focus:border-indigo-400"
            />
          </label>

          <label className="space-y-1 text-sm text-white/80">
            <span>Start Date</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none transition focus:border-indigo-400"
            />
          </label>

          <label className="space-y-1 text-sm text-white/80">
            <span>Matches Per Day</span>
            <input
              type="number"
              min={1}
              max={50}
              value={matchesPerDay}
              onChange={(e) => setMatchesPerDay(Math.max(1, Number(e.target.value) || 1))}
              className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none transition focus:border-indigo-400"
            />
          </label>

          <label className="space-y-1 text-sm text-white/80">
            <span>Telemetry Source *</span>
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
          </label>

          <label className="space-y-1 text-sm text-white/80 md:col-span-3">
            <span>Map Rotation (comma-separated, optional)</span>
            <input
              type="text"
              placeholder="ERANGEL, MIRAMAR, SANHOK"
              value={rotationText}
              onChange={(e) => setRotationText(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none transition focus:border-indigo-400"
            />
          </label>

          <div className="flex items-end">
            <button
              type="button"
              className="rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-white/15"
              onClick={generateDrafts}
            >
              Generate Preview
            </button>
          </div>
        </div>

        <div className="mt-6 overflow-x-auto rounded-lg border border-white/10">
          <table className="min-w-full text-sm">
            <thead className="bg-white/5 text-left text-xs uppercase tracking-wide text-white/60">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Map</th>
                <th className="px-3 py-2">Match #</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Telemetry Source</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d, idx) => (
                <tr key={idx} className="border-t border-white/10">
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={d.name}
                      onChange={(e) => updateDraft(idx, { name: e.target.value })}
                      className="w-full rounded border border-white/15 bg-black/30 px-2 py-1 text-white outline-none"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={d.map}
                      onChange={(e) => updateDraft(idx, { map: e.target.value })}
                      className="w-full rounded border border-white/15 bg-black/30 px-2 py-1 text-white outline-none"
                    >
                      {MAP_OPTIONS.map((m) => (
                        <option key={m} value={m}>
                          {m.charAt(0) + m.slice(1).toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={d.matchNumber}
                      onChange={(e) =>
                        updateDraft(idx, { matchNumber: Number(e.target.value) || 0 })
                      }
                      className="w-24 rounded border border-white/15 bg-black/30 px-2 py-1 text-white outline-none"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="date"
                      value={d.scheduledAt}
                      onChange={(e) => updateDraft(idx, { scheduledAt: e.target.value })}
                      className="rounded border border-white/15 bg-black/30 px-2 py-1 text-white outline-none"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={d.sourceSelection}
                      onChange={(e) =>
                        updateDraft(idx, {
                          sourceSelection: e.target.value as MatchSourceSelection,
                        })
                      }
                      className="w-full rounded border border-white/15 bg-black/30 px-2 py-1 text-white outline-none"
                    >
                      {MATCH_SOURCE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
              {drafts.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-center text-white/60" colSpan={5}>
                    No matches generated yet. Adjust inputs and click Generate Preview.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex justify-end gap-3">
          <button
            type="button"
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white/70 hover:text-white"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-500 disabled:opacity-50"
            disabled={loading || drafts.length === 0}
            onClick={createAll}
          >
            {loading ? "Creating..." : "Create All Matches"}
          </button>
        </div>
      </div>
    </div>
  );
}
