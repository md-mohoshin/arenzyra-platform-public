"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, API_URL } from "@/lib/api";
import { EditSponsorDialog } from "./EditSponsorDialog";

type Sponsor = {
  id: string;
  name: string;
  logoUrl: string | null;
  websiteUrl?: string | null;
  displayOrder?: number | null;
  isActive?: boolean | null;
};

const resolveLogoUrl = (url: string | null | undefined) => {
  if (!url) return "/assets/defaults/default-team.png";
  if (url.startsWith("http")) return url;
  return `${API_URL}${url}`;
};

export default function SponsorsPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = params?.id;

  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Sponsor | null>(null);

  const loadSponsors = async () => {
    if (!tournamentId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/organizer/tournaments/${tournamentId}/sponsors`, {
        cache: "no-store",
      });
      const json = await res.json();
      const list: Sponsor[] = Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json)
          ? json
          : json?.sponsors ?? [];
      setSponsors(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sponsors");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSponsors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  const sortedSponsors = useMemo(
    () =>
      [...sponsors].sort((a, b) => {
        const aOrder = a.displayOrder ?? 0;
        const bOrder = b.displayOrder ?? 0;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.name.localeCompare(b.name);
      }),
    [sponsors],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">Sponsors</h2>
        <button
          className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-cyan-400 transition"
          onClick={() => setOpen(true)}
        >
          + Add Sponsor
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-100">
          {error}
        </div>
      ) : loading ? (
        <div className="rounded-xl bg-[#111827] p-6 text-center text-gray-400 border border-white/10">
          Loading sponsors...
        </div>
      ) : sponsors.length === 0 ? (
        <div className="rounded-xl bg-[#111827] p-6 text-center text-gray-400 border border-white/10">
          No sponsors yet
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-4">
          {sortedSponsors.map((s) => (
            <div
              key={s.id}
              className="rounded-2xl border border-white/10 bg-[#0f172a] p-5 shadow-lg shadow-black/20"
            >
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={resolveLogoUrl(s.logoUrl)}
                  alt={s.name}
                  className="h-24 w-full rounded-xl object-contain"
                />
              </div>

              <div className="mt-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-white">{s.name}</h3>
                  <p className="mt-1 text-sm text-white/55">
                    Order {s.displayOrder ?? 0}
                  </p>
                </div>
                <span
                  className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                    s.isActive ?? true
                      ? "bg-green-500/20 text-green-400"
                      : "bg-white/10 text-white/60"
                  }`}
                >
                  {s.isActive ?? true ? "Active" : "Disabled"}
                </span>
              </div>

              <div className="mt-5 flex items-center gap-2 text-sm">
                <button
                  type="button"
                  className="rounded-lg px-3 py-2 text-white ring-1 ring-white/20 transition hover:bg-white/10"
                  onClick={() => {
                    setEditing(s);
                    setEditOpen(true);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="rounded-lg px-3 py-2 text-red-100 ring-1 ring-red-500/40 transition hover:bg-red-500/20"
                  onClick={async () => {
                    if (!tournamentId) return;
                    const ok = window.confirm(`Delete sponsor "${s.name}"?`);
                    if (!ok) return;
                    try {
                      await apiFetch(
                        `/organizer/tournaments/${tournamentId}/sponsors/${s.id}`,
                        { method: "DELETE" },
                      );
                      await loadSponsors();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Failed to delete sponsor");
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AddSponsorDialog
        open={open}
        onOpenChange={setOpen}
        tournamentId={tournamentId}
        onCreated={loadSponsors}
      />
      <EditSponsorDialog
        open={editOpen}
        sponsor={editing}
        onOpenChange={(v) => {
          setEditOpen(v);
          if (!v) setEditing(null);
        }}
        tournamentId={tournamentId}
        onUpdated={loadSponsors}
      />
    </div>
  );
}

type AddSponsorDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tournamentId?: string;
  onCreated: () => Promise<void> | void;
};

function AddSponsorDialog({
  open,
  onOpenChange,
  tournamentId,
  onCreated,
}: AddSponsorDialogProps) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [order, setOrder] = useState<string>("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(true);
  const defaultTier = "TITLE";

  const close = () => {
    onOpenChange(false);
    setName("");
    setWebsite("");
    setOrder("");
    setLogoFile(null);
    setError(null);
    setActive(true);
  };

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tournamentId) return;
    if (!name.trim()) {
      setError("Sponsor name is required");
      return;
    }
    if (!logoFile) {
      setError("Logo is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("name", name.trim());
      form.append("tier", defaultTier);
      form.append("displayOrder", order ? Number(order).toString() : "0");
      if (website.trim()) form.append("websiteUrl", website.trim());
      form.append("isActive", active ? "true" : "false");
      form.append("file", logoFile);

      await apiFetch(`/organizer/tournaments/${tournamentId}/sponsors`, {
        method: "POST",
        body: form,
        // apiFetch sets JSON header; avoid it for FormData
        headers: {},
      });
      await onCreated();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create sponsor");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Add Sponsor</h2>
            <p className="text-sm text-white/60">Provide sponsor details.</p>
          </div>
          <button
            className="text-white/60 hover:text-white"
            onClick={close}
            type="button"
          >
            X
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
          </label>

          <label className="block space-y-1 text-sm text-white/80">
            <span>Website</span>
            <input
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white outline-none transition focus:border-indigo-400"
              placeholder="https://example.com"
            />
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
