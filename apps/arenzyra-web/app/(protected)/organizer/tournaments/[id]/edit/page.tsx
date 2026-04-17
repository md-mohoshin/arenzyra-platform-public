"use client";

import { useEffect, useMemo, useState, ChangeEvent, FormEvent } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { apiFetch, ensureApiUrl } from "@/lib/api";

type FormState = {
  name: string;
  startDate: string;
  endDate: string;
  description: string;
};

type TournamentResponse = Partial<FormState> & {
  id: string;
  logoUrl?: string | null;
  bannerUrl?: string | null;
};

export default function TournamentEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const tournamentId = params?.id;

  const [form, setForm] = useState<FormState>({
    name: "",
    startDate: "",
    endDate: "",
    description: "",
  });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof FormState, string>>
  >({});

  const update =
    (key: keyof FormState) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleFile =
    (
      setFile: (f: File | null) => void,
      setUrl: (url: string | null) => void,
    ) =>
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      setFile(file);
      if (file) {
        const url = URL.createObjectURL(file);
        setUrl(url);
      } else {
        setUrl(null);
      }
    };

  const uploadImage = async (
    file: File | null,
    kind: "logo" | "banner",
  ) => {
    if (!file) return undefined;
    const formData = new FormData();
    formData.append("file", file);
    const endpoint =
      kind === "logo" ? "/uploads/tournament-logo" : "/uploads/tournament-banner";
    const res = await apiFetch(endpoint, {
      method: "POST",
      body: formData,
    });
    const json = await res.json();
    return ensureApiUrl(json?.url as string | undefined) ?? undefined;
  };

  const toDateInput = (value?: string | null) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  };

  useEffect(() => {
    const load = async () => {
      if (!tournamentId) return;
      try {
        const res = await apiFetch(`/me/tournaments/${tournamentId}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as TournamentResponse;
        const resolvedLogo = ensureApiUrl(json.logoUrl);
        const resolvedBanner = ensureApiUrl(json.bannerUrl);
        setForm({
          name: json.name ?? "",
          startDate: toDateInput(json.startDate) ?? "",
          endDate: toDateInput(json.endDate) ?? "",
          description: json.description ?? "",
        });
        setLogoUrl(resolvedLogo);
        setBannerUrl(resolvedBanner);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load tournament";
        setError(msg);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [tournamentId]);

  const validate = () => {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) errs.name = "Name is required.";
    if (!form.startDate) errs.startDate = "Start date is required.";
    if (!form.endDate) errs.endDate = "End date is required.";
    if (form.startDate && form.endDate && new Date(form.endDate) < new Date(form.startDate)) {
      errs.endDate = "End date cannot be earlier than start date.";
    }
    setFieldErrors(errs);
    return errs;
  };

  const isValid = useMemo(
    () =>
      form.name.trim().length > 0 &&
      !!form.startDate &&
      !!form.endDate &&
      (!(form.startDate && form.endDate) ||
        new Date(form.endDate) >= new Date(form.startDate)),
    [form],
  );

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setError("Please fix the errors below.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const [logoUrlRaw, bannerUrlRaw] = await Promise.all([
        uploadImage(logoFile, "logo"),
        uploadImage(bannerFile, "banner"),
      ]);
      const nextLogoUrl = ensureApiUrl(logoUrlRaw ?? logoUrl);
      const nextBannerUrl = ensureApiUrl(bannerUrlRaw ?? bannerUrl);

      setLogoUrl(nextLogoUrl ?? null);
      setBannerUrl(nextBannerUrl ?? null);

      const payload = {
        name: form.name.trim(),
        startDate: form.startDate,
        endDate: form.endDate,
        description: form.description.trim() || undefined,
        logoUrl: nextLogoUrl ?? undefined,
        bannerUrl: nextBannerUrl ?? undefined,
      };

      await apiFetch(`/me/tournaments/${tournamentId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      router.push("/organizer/tournaments");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to update tournament";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="px-4 py-6 text-white/70">Loading tournament…</div>;
  }

  return (
    <div className="flex flex-col h-full px-4">
      <div className="space-y-6 py-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Edit Tournament</h1>
          <p className="text-sm text-white/65">Update tournament details.</p>
        </div>
        <div className="max-w-xl mx-auto w-full">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-xl space-y-4">
            {error ? (
              <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                {error}
              </div>
            ) : null}

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="grid grid-cols-2 gap-4">
                <label className="col-span-2 block space-y-1 text-sm text-white/80">
                  <span>Name *</span>
                  <input
                    type="text"
                    value={form.name}
                    onChange={update("name")}
                    className="h-9 w-full rounded-lg border border-white/15 bg-black/50 px-3 text-white outline-none transition focus:border-indigo-400"
                    placeholder="Tournament name"
                    required
                  />
                  {fieldErrors.name ? (
                    <div className="text-xs text-red-300">{fieldErrors.name}</div>
                  ) : null}
                </label>

                <label className="block space-y-1 text-sm text-white/80">
                  <span>Start date *</span>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={update("startDate")}
                    className="h-9 w-full rounded-lg border border-white/15 bg-black/50 px-3 text-white outline-none transition focus:border-indigo-400"
                    required
                  />
                  {fieldErrors.startDate ? (
                    <div className="text-xs text-red-300">{fieldErrors.startDate}</div>
                  ) : null}
                </label>
                <label className="block space-y-1 text-sm text-white/80">
                  <span>End date *</span>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={update("endDate")}
                    className="h-9 w-full rounded-lg border border-white/15 bg-black/50 px-3 text-white outline-none transition focus:border-indigo-400"
                    required
                    min={form.startDate || undefined}
                  />
                  {fieldErrors.endDate ? (
                    <div className="text-xs text-red-300">{fieldErrors.endDate}</div>
                  ) : null}
                </label>

                <label className="block space-y-1 text-sm text-white/80">
                  <span>Tournament Logo (optional)</span>
                  <div className="flex items-center gap-3">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/15 bg-black/50 px-3 py-1.5 text-xs font-semibold text-white/80 hover:border-indigo-400">
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFile(setLogoFile, setLogoUrl)}
                      />
                      Upload
                    </label>
                    {logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={logoUrl}
                        alt="Logo preview"
                        className="h-10 w-10 rounded-lg object-cover ring-1 ring-white/15"
                      />
                    ) : (
                      <span className="text-xs text-white/50">PNG/JPG/WebP up to 5MB</span>
                    )}
                  </div>
                </label>

                <label className="block space-y-1 text-sm text-white/80">
                  <span>Tournament Banner (optional)</span>
                  <div className="flex items-center gap-3">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/15 bg-black/50 px-3 py-1.5 text-xs font-semibold text-white/80 hover:border-indigo-400">
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFile(setBannerFile, setBannerUrl)}
                      />
                      Upload
                    </label>
                    {bannerUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={bannerUrl}
                        alt="Banner preview"
                        className="h-10 w-20 rounded-lg object-cover ring-1 ring-white/15"
                      />
                    ) : (
                      <span className="text-xs text-white/50">PNG/JPG/WebP up to 5MB</span>
                    )}
                  </div>
                </label>

                <label className="col-span-2 block space-y-1 text-sm text-white/80">
                  <span>Description (optional)</span>
                  <textarea
                    value={form.description}
                    onChange={update("description")}
                    rows={3}
                    className="w-full rounded-lg border border-white/15 bg-black/50 px-3 py-2 text-white outline-none transition focus:border-indigo-400"
                    placeholder="Brief summary or notes"
                  />
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-1">
                <Link
                  href="/organizer/tournaments"
                  className="rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white/80 transition hover:border-white/35 hover:text-white"
                >
                  Cancel
                </Link>
                <button
                  type="submit"
                  disabled={submitting || !isValid}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-500 disabled:opacity-60"
                >
                  {submitting ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
