"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppError } from "@/components/ui/AppError";
import { AppSkeleton } from "@/components/ui/AppSkeleton";
import { ApiError, apiFetch } from "@/lib/api";
import { DiscordConfigForm } from "@/features/discord/DiscordConfigForm";
import {
  createDiscordConfigDraft,
  type DiscordConfigDraft,
  type DiscordConfigView,
} from "@/features/discord/types";

export default function OrganizerDiscordPage() {
  const router = useRouter();
  const [config, setConfig] = useState<DiscordConfigView | null>(null);
  const [draft, setDraft] = useState<DiscordConfigDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiFetch("/organizer/discord-config", {
        cache: "no-store",
      });
      const payload = (await response.json()) as DiscordConfigView;
      setConfig(payload);
      setDraft(createDiscordConfigDraft(payload));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Discord config.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);

    try {
      const response = await apiFetch("/organizer/discord-config", {
        method: "PATCH",
        body: JSON.stringify(draft),
      });
      const payload = (await response.json()) as DiscordConfigView;
      setConfig(payload);
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

  const handleBack = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/organizer");
  }, [router]);

  if (loading) {
    return <AppSkeleton lines={10} />;
  }

  if (error && !config) {
    return <AppError message={error} onRetry={load} />;
  }

  if (!config || !draft) {
    return <AppError message="Discord config unavailable." onRetry={load} />;
  }

  return (
    <div className="space-y-6">
      {error ? <AppError message={error} onRetry={load} /> : null}
      <DiscordConfigForm
        config={config}
        draft={draft}
        saving={saving}
        onDraftChange={(patch) => {
          setDraft((current) => {
            if (!current) return current;
            if (typeof patch === "function") {
              return patch(current);
            }
            return { ...current, ...patch };
          });
        }}
        onBack={handleBack}
        onSave={save}
      />
    </div>
  );
}
