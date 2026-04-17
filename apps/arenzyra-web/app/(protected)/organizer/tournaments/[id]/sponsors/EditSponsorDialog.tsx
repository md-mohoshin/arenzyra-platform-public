"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

type Sponsor = {
  id: string;
  name: string;
  logoUrl: string | null;
  websiteUrl?: string | null;
  displayOrder?: number | null;
  isActive?: boolean | null;
};

type Props = {
  open: boolean;
  sponsor: Sponsor | null;
  tournamentId?: string;
  onOpenChange: (v: boolean) => void;
  onUpdated: () => Promise<void> | void;
};

export function EditSponsorDialog({
  open,
  sponsor,
  tournamentId,
  onOpenChange,
  onUpdated,
}: Props) {
  const [name, setName] = useState("");
  const [order, setOrder] = useState<string>("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [active, setActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sponsor) return;
    setName(sponsor.name ?? "");
    setOrder(
      sponsor.displayOrder === null || sponsor.displayOrder === undefined
        ? ""
        : sponsor.displayOrder.toString(),
    );
    setActive(sponsor.isActive ?? true);
    setLogoFile(null);
    setError(null);
  }, [sponsor]);

  const close = () => {
    onOpenChange(false);
    setLogoFile(null);
    setError(null);
  };

  if (!open || !sponsor) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tournamentId) return;
    if (!name.trim()) {
      setError("Sponsor name is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("name", name.trim());
      if (order) form.append("displayOrder", Number(order).toString());
      form.append("isActive", active ? "true" : "false");
      if (logoFile) form.append("file", logoFile);
      if (sponsor.websiteUrl) form.append("websiteUrl", sponsor.websiteUrl);

      await apiFetch(
        `/organizer/tournaments/${tournamentId}/sponsors/${sponsor.id}`,
        {
          method: "PATCH",
          body: form,
          headers: {},
        },
      );
      await onUpdated();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update sponsor");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Edit Sponsor</h2>
            <p className="text-sm text-white/60">Update sponsor details.</p>
          </div>
          <button
            className="text-white/60 hover:text-white"
            onClick={close}
            type="button"
          >
            ✕
          </button>
        </div>

        {error ? (
          <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
            {error}
          </div>
        ) : null}

        <form className="space-y-3" onSubmit={submit}>
          <label className="block space-y-1 text-sm text-white/80">
            <span>Sponsor Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none transition focus:border-indigo-400"
              placeholder="Sponsor name"
              required
            />
          </label>

          <label className="block space-y-1 text-sm text-white/80">
            <span>Logo</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
              className="w-full text-white"
            />
            <p className="text-xs text-white/50">
              Leave empty to keep the current logo.
            </p>
          </label>

          <label className="block space-y-1 text-sm text-white/80">
            <span>Display Order</span>
            <input
              type="number"
              value={order}
              onChange={(e) => setOrder(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none transition focus:border-indigo-400"
              placeholder="0"
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4"
            />
            <span>Active</span>
          </label>

          <div className="mt-4 flex justify-end gap-3">
            <button
              type="button"
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white/70 hover:text-white"
              onClick={close}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-500 disabled:opacity-50"
              disabled={submitting}
            >
              {submitting ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
