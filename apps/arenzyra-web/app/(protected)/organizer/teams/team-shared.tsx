"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ensureApiUrl } from "@/lib/api";

export type Team = {
  id: string;
  name: string;
  tag: string | null;
  logoUrl: string | null;
  isLiveMapping?: boolean;
  players?: { id: string }[] | null;
  _count?: {
    players?: number | null;
  } | null;
};

export type Player = {
  id: string;
  ign: string;
  realName: string | null;
  photoUrl: string | null;
  inGameId: string | null;
  pubgPlayerId?: string | null;
  playerOpenId?: string | null;
  externalPlayerId?: string | null;
  source?: string | null;
  externalSource?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  role: string | null;
  country: string | null;
};

export const FALLBACK_LOGO = "/assets/defaults/default-team.png";
export const FALLBACK_PLAYER = "/assets/defaults/default-player.png";

export const resolveLogo = (url?: string | null) => ensureApiUrl(url) ?? FALLBACK_LOGO;

const UID_PATTERN = /^\d+$/;

const toRealPubgUid = (value?: string | null) => {
  const normalized = value?.trim() ?? "";
  return UID_PATTERN.test(normalized) ? normalized : null;
};

export const resolvePlayerUid = (player: Player) =>
  toRealPubgUid(player.inGameId) ??
  toRealPubgUid(player.pubgPlayerId) ??
  toRealPubgUid(player.playerOpenId) ??
  toRealPubgUid(player.externalPlayerId) ??
  null;

export const isLiveMappingTeam = (team: Team) => team.name.startsWith("[LIVE] ");

export const dedupePlayers = (players: Player[]) => {
  const rankPlayer = (player: Player) => {
    const hasRealUid = resolvePlayerUid(player) !== null;
    const isTelemetryPlayer =
      player.source === "API" && player.externalSource === "PUBG_TELEMETRY";
    const updatedAt = player.updatedAt ? Date.parse(player.updatedAt) : Number.NaN;
    return {
      hasRealUid,
      isTelemetryPlayer,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Number.NEGATIVE_INFINITY,
    };
  };

  const comparePlayers = (left: Player, right: Player) => {
    const leftRank = rankPlayer(left);
    const rightRank = rankPlayer(right);

    if (leftRank.hasRealUid !== rightRank.hasRealUid) {
      return leftRank.hasRealUid ? 1 : -1;
    }
    if (leftRank.isTelemetryPlayer !== rightRank.isTelemetryPlayer) {
      return leftRank.isTelemetryPlayer ? 1 : -1;
    }
    if (leftRank.updatedAt !== rightRank.updatedAt) {
      return leftRank.updatedAt - rightRank.updatedAt;
    }
    return right.ign.localeCompare(left.ign);
  };

  const deduped = new Map<string, Player>();
  for (const player of players) {
    const key = player.ign.trim().toLowerCase();
    const current = deduped.get(key);
    if (!current || comparePlayers(player, current) > 0) {
      deduped.set(key, player);
    }
  }
  return Array.from(deduped.values());
};

export type TeamFormValues = {
  name: string;
  tag?: string | null;
  logoUrl?: string | null;
  logoFile?: File | null;
};

type TeamFormModalProps = {
  title: string;
  open: boolean;
  defaultValues: TeamFormValues;
  loading?: boolean;
  error?: Error | null;
  onSubmit: (values: TeamFormValues) => Promise<unknown>;
  onClose: () => void;
};

export function TeamFormModal({
  title,
  open,
  defaultValues,
  loading = false,
  error,
  onSubmit,
  onClose,
}: TeamFormModalProps) {
  const [form, setForm] = useState<TeamFormValues>(defaultValues);
  const [formError, setFormError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    defaultValues.logoUrl ? ensureApiUrl(defaultValues.logoUrl) : FALLBACK_LOGO,
  );

  useEffect(() => {
    if (!open) return;
    // Reset modal fields when it opens; safe because it only runs on open toggle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(defaultValues);
    setFormError(null);
    setPreviewUrl(
      defaultValues.logoUrl
        ? ensureApiUrl(defaultValues.logoUrl) ?? FALLBACK_LOGO
        : FALLBACK_LOGO,
    );
  }, [defaultValues, open]);

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const handleFile = (file: File | null) => {
    setForm((current) => ({ ...current, logoFile: file }));
    if (previewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(
      file
        ? URL.createObjectURL(file)
        : defaultValues.logoUrl
          ? ensureApiUrl(defaultValues.logoUrl) ?? FALLBACK_LOGO
          : FALLBACK_LOGO,
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = form.name?.trim();
    if (!name) {
      setFormError("Name is required");
      return;
    }
    try {
      await onSubmit({
        name,
        tag: form.tag?.trim() || null,
        logoFile: form.logoFile ?? null,
      });
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save team. Try again.";
      setFormError(message);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(event) => {
        if (loading) return;
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-white/10 bg-slate-900/95 p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            <p className="text-sm text-white/60">Set the basic team details.</p>
          </div>
        </div>

        {formError ? <Alert message={formError} /> : null}
        {error ? <Alert message={error.message} /> : null}

        <form className="mt-4 space-y-4" onSubmit={submit}>
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl ?? FALLBACK_LOGO}
              alt="Logo preview"
              className="h-16 w-16 rounded-full object-cover ring-1 ring-white/10"
            />
            <label className="flex flex-1 cursor-pointer flex-col gap-2 rounded-lg border border-dashed border-white/15 bg-black/30 px-3 py-3 text-xs text-white/70 transition hover:border-white/30">
              <span className="text-sm font-medium text-white/80">Logo (optional)</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => handleFile(event.target.files?.[0] ?? null)}
                disabled={loading}
              />
              <span className="text-white/60">
                Upload PNG/JPEG/WebP up to 2MB. Preview shown on the left.
              </span>
            </label>
          </div>

          <label className="block space-y-2 text-sm text-white/80">
            <span>Name *</span>
            <input
              type="text"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none transition focus:border-indigo-400 disabled:opacity-60"
              placeholder="Team name"
              disabled={loading}
              required
            />
          </label>

          <label className="block space-y-2 text-sm text-white/80">
            <span>Tag</span>
            <input
              type="text"
              value={form.tag ?? ""}
              onChange={(event) => setForm((current) => ({ ...current, tag: event.target.value }))}
              className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none transition focus:border-indigo-400 disabled:opacity-60"
              placeholder="Optional short tag"
              disabled={loading}
            />
          </label>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function Alert({ message }: { message: string }) {
  return (
    <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
      {message}
    </div>
  );
}

export function SkeletonTable({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
      <div className="mb-3 text-sm text-white/60">{message}</div>
      <div className="space-y-2">
        {[1, 2, 3].map((row) => (
          <div
            key={row}
            className="flex items-center gap-4 rounded-lg bg-white/5 px-3 py-3.5"
          >
            <div className="h-10 w-10 animate-pulse rounded-full bg-white/10" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-32 animate-pulse rounded bg-white/10" />
              <div className="h-3 w-20 animate-pulse rounded bg-white/10" />
            </div>
            <div className="h-7 w-14 animate-pulse rounded border border-white/10 bg-white/10" />
            <div className="h-3 w-12 animate-pulse rounded bg-white/10" />
            <div className="h-8 w-28 animate-pulse rounded bg-white/10" />
          </div>
        ))}
      </div>
    </div>
  );
}

export type PlayerFormValues = {
  ign: string;
  inGameId: string;
  realName?: string | null;
  role?: string | null;
  country?: string | null;
  photoUrl?: string | null;
  photoFile?: File | null;
};

type PlayerFormModalProps = {
  title: string;
  open: boolean;
  defaultValues: PlayerFormValues;
  loading?: boolean;
  error?: Error | null;
  onSubmit: (values: PlayerFormValues) => Promise<unknown>;
  onClose: () => void;
};

export function PlayerFormModal({
  title,
  open,
  defaultValues,
  loading = false,
  error,
  onSubmit,
  onClose,
}: PlayerFormModalProps) {
  const [form, setForm] = useState<PlayerFormValues>(defaultValues);
  const [formError, setFormError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(defaultValues.photoUrl ?? null);

  useEffect(() => {
    if (!open) return;
    // Reset modal fields when it opens; safe because it only runs on open toggle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(defaultValues);
    setFormError(null);
    setPreviewUrl(defaultValues.photoUrl ?? null);
  }, [defaultValues, open]);

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const handleFile = (file: File | null) => {
    setForm((current) => ({ ...current, photoFile: file }));
    if (previewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(file ? URL.createObjectURL(file) : defaultValues.photoUrl ?? null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ign = form.ign?.trim();
    const inGameId = form.inGameId?.trim();

    if (!ign) {
      setFormError("IGN is required");
      return;
    }
    if (!inGameId) {
      setFormError("PUBG UID is required");
      return;
    }

    try {
      await onSubmit({
        ign,
        inGameId,
        realName: form.realName?.trim() || null,
        role: form.role || null,
        country: form.country?.trim() || null,
        photoFile: form.photoFile ?? null,
      });
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save player. Try again.";
      setFormError(message);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(event) => {
        if (loading) return;
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-white/10 bg-slate-900/95 p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            <p className="text-sm text-white/60">Manage player details.</p>
          </div>
        </div>

        {formError ? <Alert message={formError} /> : null}
        {error ? <Alert message={error.message} /> : null}

        <form className="mt-4 space-y-4" onSubmit={submit}>
          <div className="flex items-start gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl ?? FALLBACK_PLAYER}
              alt="Photo preview"
              className="h-24 w-16 object-contain drop-shadow-[0_10px_20px_rgba(0,0,0,0.35)]"
            />
            <label className="flex flex-1 cursor-pointer flex-col gap-2 rounded-lg border border-dashed border-white/15 bg-black/30 px-3 py-3 text-xs text-white/70 transition hover:border-white/30">
              <span className="text-sm font-medium text-white/80">Photo (optional)</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => handleFile(event.target.files?.[0] ?? null)}
                disabled={loading}
              />
              <span className="text-white/60">
                Upload PNG/JPEG/WebP up to 2MB. Preview shown on the left.
              </span>
            </label>
          </div>

          <label className="block space-y-2 text-sm text-white/80">
            <span>IGN *</span>
            <input
              type="text"
              value={form.ign}
              onChange={(event) => setForm((current) => ({ ...current, ign: event.target.value }))}
              className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none transition focus:border-indigo-400 disabled:opacity-60"
              placeholder="In-game name"
              disabled={loading}
              required
            />
          </label>

          <label className="block space-y-2 text-sm text-white/80">
            <span>PUBG UID *</span>
            <input
              type="text"
              value={form.inGameId}
              onChange={(event) =>
                setForm((current) => ({ ...current, inGameId: event.target.value }))
              }
              className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none transition focus:border-indigo-400 disabled:opacity-60"
              placeholder="In-game UID"
              disabled={loading}
              required
            />
          </label>

          <label className="block space-y-2 text-sm text-white/80">
            <span>Real Name</span>
            <input
              type="text"
              value={form.realName ?? ""}
              onChange={(event) =>
                setForm((current) => ({ ...current, realName: event.target.value }))
              }
              className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none transition focus:border-indigo-400 disabled:opacity-60"
              placeholder="Optional real name"
              disabled={loading}
            />
          </label>

          <label className="block space-y-2 text-sm text-white/80">
            <span>Role</span>
            <select
              value={form.role ?? ""}
              onChange={(event) =>
                setForm((current) => ({ ...current, role: event.target.value || null }))
              }
              className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none transition focus:border-indigo-400 disabled:opacity-60"
              disabled={loading}
            >
              <option value="">Select role (optional)</option>
              <option value="IGL">IGL</option>
              <option value="Entry">Entry</option>
              <option value="Support">Support</option>
              <option value="Sniper">Sniper</option>
            </select>
          </label>

          <label className="block space-y-2 text-sm text-white/80">
            <span>Country</span>
            <input
              type="text"
              value={form.country ?? ""}
              onChange={(event) =>
                setForm((current) => ({ ...current, country: event.target.value }))
              }
              className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none transition focus:border-indigo-400 disabled:opacity-60"
              placeholder="Optional country"
              disabled={loading}
            />
          </label>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
