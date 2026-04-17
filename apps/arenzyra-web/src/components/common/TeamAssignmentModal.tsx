"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Check, Search, Users, X } from "lucide-react";
import { ensureApiUrl } from "@/lib/api";

export type TeamAssignmentOption = {
  id: string;
  name: string;
  tag: string | null;
  logoUrl: string | null;
};

const getTeamMonogram = (name: string, tag?: string | null) => {
  const source = tag?.trim() || name.trim();
  if (!source) return "TM";

  const words = source.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }

  return words
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
};

export default function TeamAssignmentModal({
  eyebrow,
  title,
  description,
  teams,
  selectedIds,
  setSelectedIds,
  helperText,
  emptyTitle,
  emptyDescription,
  saveLabel,
  savingLabel,
  saving,
  saveDisabled,
  onClose,
  onSave,
}: {
  eyebrow: string;
  title: string;
  description: string;
  teams: TeamAssignmentOption[];
  selectedIds: ReadonlySet<string>;
  setSelectedIds: (value: Set<string> | ((previous: Set<string>) => Set<string>)) => void;
  helperText: string;
  emptyTitle: string;
  emptyDescription: string;
  saveLabel: string;
  savingLabel: string;
  saving: boolean;
  saveDisabled: boolean;
  onClose: () => void;
  onSave: () => void | Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const filteredTeams = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();

    return teams
      .filter((team) => {
        if (!normalizedQuery) return true;

        return [team.name, team.tag]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .slice()
      .sort((left, right) => {
        const leftSelected = selectedIds.has(left.id) ? 1 : 0;
        const rightSelected = selectedIds.has(right.id) ? 1 : 0;
        if (rightSelected !== leftSelected) {
          return rightSelected - leftSelected;
        }

        return left.name.localeCompare(right.name, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });
  }, [deferredQuery, selectedIds, teams]);

  const visibleSelectedCount = filteredTeams.reduce(
    (count, team) => count + (selectedIds.has(team.id) ? 1 : 0),
    0,
  );
  const hiddenSelectedCount = selectedIds.size - visibleSelectedCount;
  const selectionScopeLabel = query.trim() ? "visible" : "all";
  const allVisibleSelected =
    filteredTeams.length > 0 && filteredTeams.every((team) => selectedIds.has(team.id));
  const footerNote =
    hiddenSelectedCount > 0
      ? `${hiddenSelectedCount} selected ${
          hiddenSelectedCount === 1 ? "team is" : "teams are"
        } hidden by the current search.`
      : helperText;

  const toggleTeam = (teamId: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
  };

  const updateVisibleSelection = (mode: "add" | "remove") => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      for (const team of filteredTeams) {
        if (mode === "add") {
          next.add(team.id);
        } else {
          next.delete(team.id);
        }
      }
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 px-4 py-6 backdrop-blur-sm">
      <div className="flex min-h-full items-center justify-center">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="relative w-full max-w-[1480px] overflow-hidden rounded-[24px] border border-white/10 bg-[#0c1320] shadow-[0_32px_120px_rgba(0,0,0,0.55)]"
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_44%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.12),transparent_34%)]" />

          <div className="relative border-b border-white/10 px-5 py-4 sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                    {eyebrow}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold text-white/75">
                    {selectedIds.size} / {teams.length} selected
                  </span>
                  {query.trim() ? (
                    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold text-white/55">
                      {filteredTeams.length} visible
                    </span>
                  ) : null}
                </div>
                <h2 className="mt-3 text-xl font-semibold text-white sm:text-2xl">{title}</h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-white/55">{description}</p>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-white/65 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                aria-label="Close dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
              <label className="relative block w-full xl:max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                <input
                  autoFocus
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search teams"
                  className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.05] pl-10 pr-10 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-cyan-400/40 focus:bg-white/[0.07]"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="absolute right-2.5 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white"
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => updateVisibleSelection("add")}
                  disabled={filteredTeams.length === 0 || allVisibleSelected}
                  className="inline-flex items-center rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2 text-sm font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Select {selectionScopeLabel}
                </button>
                <button
                  type="button"
                  onClick={() => updateVisibleSelection("remove")}
                  disabled={visibleSelectedCount === 0}
                  className="inline-flex items-center rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2 text-sm font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clear {selectionScopeLabel}
                </button>
              </div>
            </div>
          </div>

          <div className="relative px-5 py-4 sm:px-6">
            {teams.length === 0 ? (
              <div className="flex min-h-52 flex-col items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-6 text-center">
                <Users className="h-10 w-10 text-white/25" />
                <div className="mt-4 text-lg font-semibold text-white">{emptyTitle}</div>
                <p className="mt-2 max-w-md text-sm leading-6 text-white/55">{emptyDescription}</p>
              </div>
            ) : filteredTeams.length === 0 ? (
              <div className="flex min-h-52 flex-col items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-6 text-center">
                <Search className="h-10 w-10 text-white/25" />
                <div className="mt-4 text-lg font-semibold text-white">No matching teams</div>
                <p className="mt-2 max-w-md text-sm leading-6 text-white/55">
                  Adjust the search query or clear it to browse the full team list.
                </p>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {filteredTeams.map((team) => {
                  const checked = selectedIds.has(team.id);
                  const logoSrc = team.logoUrl ? ensureApiUrl(team.logoUrl) : null;

                  return (
                    <button
                      key={team.id}
                      type="button"
                      aria-pressed={checked}
                      onClick={() => toggleTeam(team.id)}
                      className={`group relative flex min-h-[76px] items-center gap-3 rounded-[18px] border px-3 py-3 text-left transition ${
                        checked
                          ? "border-cyan-400/35 bg-cyan-500/10 shadow-[0_10px_28px_rgba(8,145,178,0.12)]"
                          : "border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.07]"
                      }`}
                    >
                      <div
                        className={`flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border ${
                          checked
                            ? "border-cyan-300/40 bg-cyan-400/10"
                            : "border-white/10 bg-white/[0.06]"
                        }`}
                      >
                        {logoSrc ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={logoSrc}
                            alt={team.name}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-white/80">
                            {getTeamMonogram(team.name, team.tag)}
                          </span>
                        )}
                      </div>

                      <div className="min-w-0 flex-1 pr-8">
                        <div className="truncate text-sm font-semibold text-white sm:text-[15px]">
                          {team.name}
                        </div>
                        <div className="mt-1 flex min-h-5 flex-wrap items-center gap-2">
                          {team.tag ? (
                            <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70">
                              {team.tag}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div
                        className={`absolute right-3 top-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition ${
                          checked
                            ? "border-cyan-300/40 bg-cyan-300 text-slate-950"
                            : "border-white/12 bg-transparent text-transparent group-hover:border-white/25"
                        }`}
                      >
                        <Check className="h-4 w-4" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="relative flex flex-col gap-3 border-t border-white/10 bg-white/[0.02] px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="text-xs leading-5 text-white/50 sm:text-sm">{footerNote}</p>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/70 transition hover:border-white/20 hover:text-white"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-950/40 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
                disabled={saveDisabled}
                onClick={() => void onSave()}
              >
                {saving ? savingLabel : saveLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
