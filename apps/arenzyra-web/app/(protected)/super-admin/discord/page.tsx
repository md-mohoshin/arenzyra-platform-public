"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppError } from "@/components/ui/AppError";
import { AppSkeleton } from "@/components/ui/AppSkeleton";
import { ApiError, apiFetch } from "@/lib/api";
import { DiscordConfigForm } from "@/features/discord/DiscordConfigForm";
import {
  createDiscordConfigDraft,
  type DiscordConfigDraft,
  type DiscordConfigView,
} from "@/features/discord/types";

export default function SuperAdminDiscordPage() {
  const [configs, setConfigs] = useState<DiscordConfigView[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DiscordConfigDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedConfig = useMemo(
    () => configs.find((config) => config.organization.id === selectedOrgId) ?? null,
    [configs, selectedOrgId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiFetch("/super/discord-configs", {
        cache: "no-store",
      });
      const payload = (await response.json()) as DiscordConfigView[];
      setConfigs(payload);
      const nextSelectedId = payload[0]?.organization.id ?? null;
      setSelectedOrgId((current) =>
        current && payload.some((item) => item.organization.id === current)
          ? current
          : nextSelectedId,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Discord configs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (selectedConfig) {
      setDraft(createDiscordConfigDraft(selectedConfig));
    }
  }, [selectedConfig]);

  async function save() {
    if (!draft || !selectedConfig) return;
    setSaving(true);
    setError(null);

    try {
      const response = await apiFetch(
        `/super/discord-configs/${selectedConfig.organization.id}`,
        {
          method: "PATCH",
          body: JSON.stringify(draft),
        },
      );
      const payload = (await response.json()) as DiscordConfigView;
      setConfigs((current) =>
        current.map((item) =>
          item.organization.id === payload.organization.id ? payload : item,
        ),
      );
      setDraft(createDiscordConfigDraft(payload));
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to save Discord config.";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <AppSkeleton lines={12} />;
  }

  if (error && configs.length === 0) {
    return <AppError message={error} onRetry={load} />;
  }

  if (!selectedConfig || !draft) {
    return <AppError message="No organizations available." onRetry={load} />;
  }

  return (
    <div className="space-y-6">
      {error ? <AppError message={error} onRetry={load} /> : null}

      <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm text-white/45">Super Admin</p>
            <h1 className="text-3xl font-bold text-white">Discord Organizations</h1>
            <p className="mt-2 max-w-3xl text-sm text-white/60">
              Review and manage Discord configuration across every organization from one
              control surface.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            Refresh
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {configs.map((config) => {
            const isActive = config.organization.id === selectedOrgId;
            return (
              <button
                key={config.organization.id}
                type="button"
                onClick={() => setSelectedOrgId(config.organization.id)}
                className={`rounded-2xl border p-4 text-left transition ${
                  isActive
                    ? "border-cyan-400/40 bg-cyan-500/10"
                    : "border-white/10 bg-black/20 hover:bg-white/5"
                }`}
              >
                <div className="text-xs uppercase tracking-[0.2em] text-white/40">
                  {config.organization.status}
                </div>
                <div className="mt-2 text-lg font-semibold text-white">
                  {config.organization.name}
                </div>
                <div className="mt-1 text-sm text-white/55">{config.guildName ?? "No guild mapped"}</div>
                <div className="mt-4 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-white/45">
                  <span>{config.summary.configuredChannelCount} channels</span>
                  <span>{config.summary.configuredRoleCount} roles</span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <DiscordConfigForm
        config={selectedConfig}
        draft={draft}
        saving={saving}
        saveLabel={`Save ${selectedConfig.organization.name}`}
        onDraftChange={(patch) => {
          setDraft((current) => {
            if (!current) return current;
            if (typeof patch === "function") {
              return patch(current);
            }
            return { ...current, ...patch };
          });
        }}
        onSave={save}
      />
    </div>
  );
}
