"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { AuthUser } from "@/types/arenzyra";
import { AppError } from "@/components/ui/AppError";
import { AppSkeleton } from "@/components/ui/AppSkeleton";
import { apiFetch, ApiError } from "@/lib/api";
import {
  applyMinimalBrandingRules,
  buildBrandingCssVars,
  buildBrandingState,
  DEFAULT_BRANDING_STATE,
  generateGradientPalette,
  gradientDirectionToAngle,
  isHexColor,
  normalizeHexColor,
  toHexInputValue,
  type BrandingMode,
  type BrandingState,
  type GradientDirection,
} from "@/lib/branding";

type MeUser = AuthUser & {
  actingOrgId?: string | null;
  actingOrgName?: string | null;
};

type MeResponse = {
  user: MeUser | null;
  organization?: {
    id: string | null;
    name: string | null;
  } | null;
};

type TabKey = "minimal" | "advanced";
type MinimalPanelMode = "auto" | "custom";
type MinimalBrandingDraft = Pick<
  BrandingState,
  | "mode"
  | "primaryColor"
  | "accent"
  | "backgroundSolid"
  | "gradientStart"
  | "gradientEnd"
  | "gradientDirection"
> & {
  panelMode: MinimalPanelMode;
  panelColor: string;
};
type BrandingPayload = Partial<BrandingState> & {
  authoringMode?: TabKey | null;
  minimalConfig?: Partial<MinimalBrandingDraft> | null;
  advancedConfig?: Partial<BrandingState> | null;
};
type BrandingResponse = {
  data?: BrandingPayload;
};

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "minimal", label: "Minimal" },
  { key: "advanced", label: "Advanced" },
];

const backgroundModeOptions: Array<{ value: BrandingMode; label: string }> = [
  { value: "solid", label: "Solid" },
  { value: "gradient", label: "Gradient" },
];

const panelModeOptions: Array<{ value: MinimalPanelMode; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "custom", label: "Custom" },
];

const directionOptions: Array<{
  value: GradientDirection;
  label: string;
  icon: string;
}> = [
  { value: "horizontal", label: "Horizontal", icon: "->" },
  { value: "vertical", label: "Vertical", icon: "v" },
  { value: "diagonal", label: "Diagonal", icon: "â†˜" },
  { value: "reverse-diagonal", label: "Reverse", icon: "â†—" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractBrandingPayload(json: BrandingResponse | BrandingPayload): BrandingPayload {
  return (("data" in json ? json.data : json) ?? {}) as BrandingPayload;
}

function normalizeAuthoringMode(value: unknown): TabKey {
  return value === "advanced" ? "advanced" : "minimal";
}

function createMinimalDraft(
  source: Partial<BrandingState> = DEFAULT_BRANDING_STATE,
): MinimalBrandingDraft {
  const resolved = buildBrandingState(source);
  const autoResolved = applyMinimalBrandingRules({
    mode: resolved.mode,
    primaryColor: resolved.primaryColor,
    accent: resolved.accent,
    backgroundSolid: resolved.backgroundSolid,
    gradientStart: resolved.gradientStart,
    gradientEnd: resolved.gradientEnd,
    gradientDirection: resolved.gradientDirection,
  });
  const panelMode: MinimalPanelMode =
    autoResolved.panel.toLowerCase() === resolved.panel.toLowerCase()
      ? "auto"
      : "custom";

  return {
    mode: resolved.mode,
    primaryColor: resolved.primaryColor,
    accent: resolved.accent,
    backgroundSolid: resolved.backgroundSolid,
    gradientStart: resolved.gradientStart,
    gradientEnd: resolved.gradientEnd,
    gradientDirection: resolved.gradientDirection,
    panelMode,
    panelColor: resolved.panel,
  };
}

function resolveMinimalBrandingDraft(draft: MinimalBrandingDraft): BrandingState {
  return applyMinimalBrandingRules({
    mode: draft.mode,
    primaryColor: draft.primaryColor,
    accent: draft.accent,
    backgroundSolid: draft.backgroundSolid,
    gradientStart: draft.gradientStart,
    gradientEnd: draft.gradientEnd,
    gradientDirection: draft.gradientDirection,
    panel: draft.panelMode === "custom" ? draft.panelColor : undefined,
  });
}

function restoreMinimalDraft(
  config: unknown,
  fallback: Partial<BrandingState> = DEFAULT_BRANDING_STATE,
): MinimalBrandingDraft {
  const base = createMinimalDraft(fallback);
  if (!isRecord(config)) {
    return base;
  }

  return {
    mode:
      config.mode === "gradient" || config.mode === "solid" ? config.mode : base.mode,
    primaryColor:
      typeof config.primaryColor === "string" ? config.primaryColor : base.primaryColor,
    accent: typeof config.accent === "string" ? config.accent : base.accent,
    backgroundSolid:
      typeof config.backgroundSolid === "string"
        ? config.backgroundSolid
        : base.backgroundSolid,
    gradientStart:
      typeof config.gradientStart === "string"
        ? config.gradientStart
        : base.gradientStart,
    gradientEnd:
      typeof config.gradientEnd === "string" ? config.gradientEnd : base.gradientEnd,
    gradientDirection:
      config.gradientDirection === "horizontal" ||
      config.gradientDirection === "vertical" ||
      config.gradientDirection === "diagonal" ||
      config.gradientDirection === "reverse-diagonal"
        ? config.gradientDirection
        : base.gradientDirection,
    panelMode:
      config.panelMode === "custom" || config.panelMode === "auto"
        ? config.panelMode
        : base.panelMode,
    panelColor:
      typeof config.panelColor === "string" ? config.panelColor : base.panelColor,
  };
}

function restoreAdvancedDraft(
  config: unknown,
  fallback: Partial<BrandingState> = DEFAULT_BRANDING_STATE,
): BrandingState {
  if (!isRecord(config)) {
    return buildBrandingState(fallback);
  }

  return buildBrandingState({
    ...fallback,
    ...config,
  });
}

function FieldShell({
  label,
  helper,
  children,
}: {
  label: string;
  helper?: string;
  children: ReactNode;
}) {
  return (
    <label className="space-y-2">
      <span className="text-[11px] uppercase tracking-[0.22em] text-white/45">
        {label}
      </span>
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
        {children}
        <p className="mt-2 text-xs text-white/45">{helper ?? " "}</p>
      </div>
    </label>
  );
}

function ColorField({
  label,
  value,
  fallback,
  onChange,
  helper,
}: {
  label: string;
  value: string;
  fallback: string;
  onChange: (value: string) => void;
  helper?: string;
}) {
  const invalid = value.trim().length > 0 && !isHexColor(value);

  return (
    <label className="space-y-2">
      <span className="text-[11px] uppercase tracking-[0.22em] text-white/45">
        {label}
      </span>
      <div
        className={`rounded-xl border bg-white/[0.03] p-3 ${
          invalid ? "border-red-400/50" : "border-white/10"
        }`}
      >
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={toHexInputValue(value, fallback)}
            onChange={(event) => onChange(event.target.value)}
            className="h-10 w-10 cursor-pointer rounded-lg border border-white/10 bg-transparent p-0"
          />
          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={fallback}
            className="h-10 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/35"
          />
        </div>
        <p className={`mt-2 text-xs ${invalid ? "text-red-200" : "text-white/45"}`}>
          {invalid ? "Use a valid hex color such as #0b1220." : helper ?? " "}
        </p>
      </div>
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  helper,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  helper?: string;
  placeholder?: string;
}) {
  return (
    <FieldShell label={label} helper={helper}>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full bg-transparent text-sm text-white outline-none placeholder:text-white/35"
      />
    </FieldShell>
  );
}

function SegmentedField<T extends string>({
  label,
  value,
  options,
  onChange,
  helper,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  helper?: string;
}) {
  return (
    <FieldShell label={label} helper={helper}>
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
              value === option.value
                ? "border-cyan-300/60 bg-cyan-500/15 text-white"
                : "border-white/10 bg-white/[0.03] text-white/65 hover:bg-white/[0.06] hover:text-white"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </FieldShell>
  );
}

function DirectionPicker({
  value,
  onChange,
  helper,
}: {
  value: GradientDirection;
  onChange: (value: GradientDirection) => void;
  helper?: string;
}) {
  return (
    <FieldShell label="Gradient Direction" helper={helper}>
      <div className="grid grid-cols-2 gap-2">
        {directionOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-lg border px-3 py-3 text-left transition ${
              value === option.value
                ? "border-cyan-300/60 bg-cyan-500/15 text-white"
                : "border-white/10 bg-white/[0.03] text-white/65 hover:bg-white/[0.06] hover:text-white"
            }`}
          >
            <div className="text-lg font-semibold">{option.icon}</div>
            <div className="mt-1 text-sm font-medium">{option.label}</div>
          </button>
        ))}
      </div>
    </FieldShell>
  );
}

function PreviewToken({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      className="rounded-xl border px-3 py-3"
      style={{
        background: "var(--vx-panel)",
        borderColor: "var(--vx-border)",
      }}
    >
      <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--vx-muted)]">
        {label}
      </div>
      <div className="mt-2 font-mono text-sm text-[var(--vx-text)]">{value}</div>
    </div>
  );
}

export default function OrganizerBrandingPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("minimal");
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [minimalDraft, setMinimalDraft] = useState<MinimalBrandingDraft>(
    createMinimalDraft(DEFAULT_BRANDING_STATE),
  );
  const [savedMinimalDraft, setSavedMinimalDraft] = useState<MinimalBrandingDraft | null>(
    null,
  );
  const [advancedDraft, setAdvancedDraft] = useState<BrandingState>(DEFAULT_BRANDING_STATE);
  const [savedAdvancedDraft, setSavedAdvancedDraft] = useState<BrandingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const sessionRes = await apiFetch("/auth/me", { cache: "no-store" });
      const session = (await sessionRes.json()) as MeResponse;
      const effectiveOrgId =
        session.user?.actingOrgId ??
        session.user?.organizationId ??
        session.organization?.id ??
        null;

      if (!effectiveOrgId) {
        throw new Error("No organization is available in this session.");
      }

      const brandingRes = await apiFetch(`/branding/${effectiveOrgId}`, {
        cache: "no-store",
      });
      const brandingJson = (await brandingRes.json()) as BrandingResponse | BrandingPayload;
      const brandingPayload = extractBrandingPayload(brandingJson);
      const nextBranding = buildBrandingState({
        ...brandingPayload,
        organizationId: effectiveOrgId,
      });
      const nextAdvancedDraft = restoreAdvancedDraft(
        brandingPayload.advancedConfig,
        nextBranding,
      );
      const nextMinimalDraft = restoreMinimalDraft(
        brandingPayload.minimalConfig,
        nextBranding,
      );

      setOrganizationId(effectiveOrgId);
      setOrganizationName(session.user?.actingOrgName ?? session.organization?.name ?? null);
      setActiveTab(normalizeAuthoringMode(brandingPayload.authoringMode));
      setSavedAdvancedDraft(nextAdvancedDraft);
      setAdvancedDraft(nextAdvancedDraft);
      setSavedMinimalDraft(nextMinimalDraft);
      setMinimalDraft(nextMinimalDraft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load branding.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const minimalPreview = useMemo(
    () => resolveMinimalBrandingDraft(minimalDraft),
    [minimalDraft],
  );
  const advancedPreview = useMemo(
    () => buildBrandingState(advancedDraft),
    [advancedDraft],
  );
  const preview = activeTab === "minimal" ? minimalPreview : advancedPreview;
  const cssVars = useMemo(() => buildBrandingCssVars(preview), [preview]);

  const hasChanges =
    activeTab === "minimal"
      ? savedMinimalDraft === null ||
        JSON.stringify(minimalDraft) !== JSON.stringify(savedMinimalDraft)
      : savedAdvancedDraft === null ||
        JSON.stringify(advancedDraft) !== JSON.stringify(savedAdvancedDraft);

  const handleBack = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/organizer");
  }, [router]);

  const updateAdvancedDraft = useCallback(
    <K extends keyof BrandingState>(key: K, value: BrandingState[K]) => {
      setAdvancedDraft((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const applyMinimalDraft = useCallback((patch: Partial<MinimalBrandingDraft>) => {
    setMinimalDraft((current) => ({ ...current, ...patch }));
  }, []);

  const generateGradient = useCallback(() => {
    if (activeTab === "minimal") {
      setMinimalDraft((current) => ({
        ...current,
        mode: "gradient",
        ...generateGradientPalette(current.primaryColor, current.accent),
      }));
      return;
    }

    setAdvancedDraft((current) => ({
      ...current,
      mode: "gradient",
      ...generateGradientPalette(current.primaryColor, current.accent),
    }));
  }, [activeTab]);

  async function saveBranding() {
    if (!organizationId) return;

    const resolved =
      activeTab === "minimal" ? minimalPreview : buildBrandingState(advancedDraft);
    const minimalConfigToPersist =
      activeTab === "minimal" ? minimalDraft : savedMinimalDraft ?? minimalDraft;
    const advancedConfigToPersist =
      activeTab === "advanced" ? advancedDraft : savedAdvancedDraft ?? advancedDraft;

    try {
      const payload = {
        authoringMode: activeTab,
        minimalConfig: minimalConfigToPersist,
        advancedConfig: advancedConfigToPersist,
        mode: resolved.mode,
        primaryColor: normalizeHexColor(resolved.primaryColor),
        secondaryColor: normalizeHexColor(resolved.secondaryColor),
        accent: normalizeHexColor(resolved.accent),
        backgroundSolid: normalizeHexColor(resolved.backgroundSolid),
        widgetBackground: normalizeHexColor(resolved.backgroundSolid),
        gradientStart: normalizeHexColor(resolved.gradientStart),
        gradientEnd: normalizeHexColor(resolved.gradientEnd),
        gradientDirection: resolved.gradientDirection,
        textPrimary: normalizeHexColor(resolved.textPrimary),
        textMuted: normalizeHexColor(resolved.textMuted),
        panel: normalizeHexColor(resolved.panel),
        border: resolved.border.trim(),
        shadow: resolved.shadow.trim(),
        glowAccent: resolved.glowAccent.trim(),
        badgeBg: normalizeHexColor(resolved.badgeBg),
        badgeText: normalizeHexColor(resolved.badgeText),
        liveColor: normalizeHexColor(resolved.liveColor),
      };

      setSaving(true);
      setError(null);
      const res = await apiFetch(`/branding/${organizationId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as BrandingResponse | BrandingPayload;
      const brandingPayload = extractBrandingPayload(json);
      const nextBranding = buildBrandingState({
        ...brandingPayload,
        organizationId,
      });
      const nextAdvancedDraft = restoreAdvancedDraft(
        brandingPayload.advancedConfig,
        nextBranding,
      );
      const nextMinimalDraft = restoreMinimalDraft(
        brandingPayload.minimalConfig,
        nextBranding,
      );
      setActiveTab(normalizeAuthoringMode(brandingPayload.authoringMode ?? activeTab));
      setAdvancedDraft(nextAdvancedDraft);
      setSavedAdvancedDraft(nextAdvancedDraft);
      setMinimalDraft(nextMinimalDraft);
      setSavedMinimalDraft(nextMinimalDraft);
      setToast("Branding updated.");
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Invalid hex color")) {
        setError("One or more color fields are invalid. Use hex colors such as #0b1220.");
        return;
      }
      const message =
        err instanceof ApiError
          ? err.body || err.message
          : err instanceof Error
            ? err.message
            : "Failed to save branding.";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <AppSkeleton lines={8} />;
  }

  if (error && !organizationId) {
    return <AppError message={error} onRetry={load} />;
  }

  if (!organizationId) {
    return <AppError message="Organization context missing." onRetry={load} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm text-white/45">Organizer</p>
          <h1 className="text-3xl font-bold text-white">Branding</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/60">
            Build broadcast-ready widget themes for {organizationName ?? "your organization"}{" "}
            with a fast minimal mode and a full production panel.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="rounded-lg border border-cyan-400/20 bg-slate-950/65 px-4 py-2 text-sm font-medium text-cyan-50/90 transition hover:border-cyan-300/40 hover:bg-cyan-500/10 hover:text-white"
          >
            &larr; Back
          </button>
          <button
            type="button"
            onClick={() => {
              if (activeTab === "minimal") {
                if (savedMinimalDraft) {
                  setMinimalDraft(savedMinimalDraft);
                  setError(null);
                }
                return;
              }

              if (savedAdvancedDraft) {
                setAdvancedDraft(savedAdvancedDraft);
                setError(null);
              }
            }}
            disabled={
              (activeTab === "minimal" ? !savedMinimalDraft : !savedAdvancedDraft) ||
              !hasChanges ||
              saving
            }
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={saveBranding}
            disabled={saving}
            className="rounded-lg border border-cyan-400/40 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:border-cyan-300/60 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Branding"}
          </button>
        </div>
      </div>

      {error ? <AppError message={error} onRetry={load} /> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-white/10 bg-slate-950/70 p-5 shadow-2xl shadow-black/20">
          <div className="flex flex-wrap gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  activeTab === tab.key
                    ? "bg-white/10 text-white"
                    : "text-white/60 hover:bg-white/5 hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "minimal" ? (
            <div className="mt-5 space-y-4">
              <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/10 p-4 text-sm text-cyan-50">
                <div className="font-semibold">Quick Setup</div>
                <p className="mt-1 text-cyan-100/80">
                  Minimal mode auto-generates and auto-balances secondary, panel, text,
                  and border tokens so dark and light backgrounds stay readable.
                </p>
              </div>

              <ColorField
                label="Primary Color"
                value={minimalDraft.primaryColor}
                fallback={DEFAULT_BRANDING_STATE.primaryColor}
                helper="Drives highlights, active states, and branded emphasis."
                onChange={(value) => applyMinimalDraft({ primaryColor: value })}
              />

              <ColorField
                label="Accent Color"
                value={minimalDraft.accent}
                fallback={DEFAULT_BRANDING_STATE.accent}
                helper="Used for highlights, badges, and emphasis."
                onChange={(value) => applyMinimalDraft({ accent: value })}
              />

              <SegmentedField<BrandingMode>
                label="Background Style"
                value={minimalDraft.mode}
                helper="Solid uses one surface. Gradient adds a stage-ready backdrop. Supporting tokens auto-adjust either way."
                options={backgroundModeOptions}
                onChange={(value) => applyMinimalDraft({ mode: value })}
              />

              <SegmentedField<MinimalPanelMode>
                label="Panel Surface"
                value={minimalDraft.panelMode}
                helper="Auto derives the text panels from the background. Custom lets you tune that surface without switching to advanced mode."
                options={panelModeOptions}
                onChange={(value) => applyMinimalDraft({ panelMode: value })}
              />

              {minimalDraft.panelMode === "custom" ? (
                <ColorField
                  label="Panel Color"
                  value={minimalDraft.panelColor}
                  fallback={minimalPreview.panel}
                  helper="Overrides the surface behind text while the rest of minimal mode stays automatic."
                  onChange={(value) => applyMinimalDraft({ panelColor: value })}
                />
              ) : null}

              {minimalDraft.mode === "gradient" ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <ColorField
                      label="Gradient Start"
                      value={minimalDraft.gradientStart}
                      fallback={DEFAULT_BRANDING_STATE.gradientStart}
                      helper="First gradient stop."
                      onChange={(value) => applyMinimalDraft({ gradientStart: value })}
                    />
                    <ColorField
                      label="Gradient End"
                      value={minimalDraft.gradientEnd}
                      fallback={DEFAULT_BRANDING_STATE.gradientEnd}
                      helper="Second gradient stop."
                      onChange={(value) => applyMinimalDraft({ gradientEnd: value })}
                    />
                  </div>
                  <DirectionPicker
                    value={minimalDraft.gradientDirection}
                    helper={`Generated angle: ${gradientDirectionToAngle(preview.gradientDirection)}.`}
                    onChange={(value) => applyMinimalDraft({ gradientDirection: value })}
                  />
                  <button
                    type="button"
                    onClick={generateGradient}
                    className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.06]"
                  >
                    Generate Gradient
                  </button>
                </>
              ) : (
                <ColorField
                  label="Background Color"
                  value={minimalDraft.backgroundSolid}
                  fallback={DEFAULT_BRANDING_STATE.backgroundSolid}
                  helper="Controls the base surface when solid mode is active."
                  onChange={(value) => applyMinimalDraft({ backgroundSolid: value })}
                />
              )}

              <div className="grid gap-3 md:grid-cols-2">
                <PreviewToken label="Secondary" value={preview.secondaryColor} />
                <PreviewToken label="Panel" value={preview.panel} />
                <PreviewToken label="Text" value={preview.textPrimary} />
                <PreviewToken label="Border" value={preview.border} />
              </div>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm text-emerald-50">
                <div className="font-semibold">Manual Token Edit</div>
                <p className="mt-1 text-emerald-100/80">
                  Advanced mode keeps each token manual. Use it when you want direct
                  control instead of the automatic balancing from minimal mode.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <SegmentedField<BrandingMode>
                  label="Background Style"
                  value={advancedDraft.mode}
                  helper="Choose solid or gradient widget backgrounds."
                  options={backgroundModeOptions}
                  onChange={(value) => updateAdvancedDraft("mode", value)}
                />

                <div className="md:col-span-2">
                  <DirectionPicker
                    value={advancedDraft.gradientDirection}
                    helper={`Generated CSS: linear-gradient(${gradientDirectionToAngle(preview.gradientDirection)}, ${preview.gradientStart}, ${preview.gradientEnd})`}
                    onChange={(value) => updateAdvancedDraft("gradientDirection", value)}
                  />
                </div>

                <ColorField
                  label="Background Solid"
                  value={advancedDraft.backgroundSolid}
                  fallback={DEFAULT_BRANDING_STATE.backgroundSolid}
                  helper="Used whenever the background style is solid."
                  onChange={(value) => updateAdvancedDraft("backgroundSolid", value)}
                />
                <ColorField
                  label="Primary Color"
                  value={advancedDraft.primaryColor}
                  fallback={DEFAULT_BRANDING_STATE.primaryColor}
                  onChange={(value) => updateAdvancedDraft("primaryColor", value)}
                />
                <ColorField
                  label="Secondary Color"
                  value={advancedDraft.secondaryColor}
                  fallback={preview.secondaryColor}
                  onChange={(value) => updateAdvancedDraft("secondaryColor", value)}
                />
                <ColorField
                  label="Accent Color"
                  value={advancedDraft.accent}
                  fallback={DEFAULT_BRANDING_STATE.accent}
                  onChange={(value) => updateAdvancedDraft("accent", value)}
                />
                <ColorField
                  label="Live Color"
                  value={advancedDraft.liveColor}
                  fallback={preview.liveColor}
                  onChange={(value) => updateAdvancedDraft("liveColor", value)}
                />
                <ColorField
                  label="Panel Color"
                  value={advancedDraft.panel}
                  fallback={preview.panel}
                  onChange={(value) => updateAdvancedDraft("panel", value)}
                />
                <ColorField
                  label="Text Primary"
                  value={advancedDraft.textPrimary}
                  fallback={preview.textPrimary}
                  onChange={(value) => updateAdvancedDraft("textPrimary", value)}
                />
                <ColorField
                  label="Text Muted"
                  value={advancedDraft.textMuted}
                  fallback={preview.textMuted}
                  onChange={(value) => updateAdvancedDraft("textMuted", value)}
                />
                <ColorField
                  label="Badge Background"
                  value={advancedDraft.badgeBg}
                  fallback={preview.badgeBg}
                  onChange={(value) => updateAdvancedDraft("badgeBg", value)}
                />
                <ColorField
                  label="Badge Text"
                  value={advancedDraft.badgeText}
                  fallback={preview.badgeText}
                  onChange={(value) => updateAdvancedDraft("badgeText", value)}
                />
                <ColorField
                  label="Gradient Start"
                  value={advancedDraft.gradientStart}
                  fallback={preview.gradientStart}
                  onChange={(value) => updateAdvancedDraft("gradientStart", value)}
                />
                <ColorField
                  label="Gradient End"
                  value={advancedDraft.gradientEnd}
                  fallback={preview.gradientEnd}
                  onChange={(value) => updateAdvancedDraft("gradientEnd", value)}
                />

                <div className="md:col-span-2">
                  <TextField
                    label="Border Color"
                    value={advancedDraft.border}
                    placeholder="rgba(255,255,255,0.12)"
                    helper="Accepts hex or rgba values."
                    onChange={(value) => updateAdvancedDraft("border", value)}
                  />
                </div>

                <div className="md:col-span-2">
                  <TextField
                    label="Glow Accent"
                    value={advancedDraft.glowAccent}
                    placeholder="rgba(245,165,36,0.38)"
                    helper="Used for glow and highlight bloom."
                    onChange={(value) => updateAdvancedDraft("glowAccent", value)}
                  />
                </div>

                <div className="md:col-span-2">
                  <TextField
                    label="Shadow"
                    value={advancedDraft.shadow}
                    placeholder="0 22px 64px rgba(0,0,0,0.45)"
                    helper="Controls the main widget drop shadow."
                    onChange={(value) => updateAdvancedDraft("shadow", value)}
                  />
                </div>

                <div className="md:col-span-2">
                  <button
                    type="button"
                    onClick={generateGradient}
                    className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.06]"
                  >
                    Generate Gradient
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="space-y-4" style={cssVars as CSSProperties}>
          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-5 shadow-2xl shadow-black/20">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">Live Preview</h2>
                <p className="text-sm text-white/55">
                  Tokens update immediately across the widget examples.
                </p>
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/60">
                {preview.backgroundCss}
              </div>
            </div>

            <div
              className="mt-5 overflow-hidden rounded-[28px] border p-5"
              style={{
                background: "var(--vx-bg)",
                borderColor: "var(--vx-border)",
                color: "var(--vx-text)",
                boxShadow: "0 0 48px var(--vx-glow)",
              }}
            >
              <div className="flex flex-col gap-4">
                <div
                  className="rounded-2xl border p-4"
                  style={{
                    background: "var(--vx-panel)",
                    borderColor:
                      "color-mix(in srgb, var(--vx-primary) 24%, var(--vx-border))",
                  }}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.32em] text-[var(--vx-muted)]">
                        Tournament Header
                      </p>
                      <h3 className="mt-2 text-2xl font-semibold text-[var(--vx-text)]">
                        Arenzyra Masters
                      </h3>
                      <p className="mt-1 text-sm text-[var(--vx-muted)]">
                        Group A - Match 3 - Erangel
                      </p>
                    </div>
                    <div
                      className="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em]"
                      style={{
                        background: "var(--vx-badge-bg)",
                        color: "var(--vx-badge-text)",
                      }}
                    >
                      Live
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                  <div
                    className="rounded-2xl border p-4"
                    style={{
                      background: "transparent",
                      borderColor: "var(--vx-border)",
                    }}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.24em] text-[var(--vx-muted)]">
                          Match Leaderboard
                        </p>
                        <h4 className="mt-2 text-lg font-semibold text-[var(--vx-text)]">
                          Top 3 Teams
                        </h4>
                      </div>
                      <div className="text-right text-xs text-[var(--vx-muted)]">
                        <div>Accent</div>
                        <div className="mt-1 font-semibold text-[var(--vx-accent)]">
                          {preview.accent}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 space-y-3">
                      {[
                        { team: "Alpha Seven", placement: "P1", kills: 9, accent: "var(--vx-accent)" },
                        { team: "Nova Core", placement: "P2", kills: 7, accent: "var(--vx-secondary)" },
                        { team: "Rift Unit", placement: "P3", kills: 5, accent: "var(--vx-primary)" },
                      ].map((row) => (
                        <div
                          key={row.team}
                          className="flex items-center justify-between rounded-xl border px-3 py-3"
                          style={{
                            background:
                              "linear-gradient(90deg, color-mix(in srgb, var(--vx-primary) 10%, transparent), color-mix(in srgb, var(--vx-bg-base) 26%, transparent) 56%, transparent)",
                            borderColor: "var(--vx-border)",
                          }}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold"
                              style={{
                                background: row.accent,
                                color: "var(--vx-text)",
                                boxShadow: "0 0 18px var(--vx-glow)",
                              }}
                            >
                              {row.placement}
                            </div>
                            <div>
                              <div className="font-semibold text-[var(--vx-text)]">{row.team}</div>
                              <div className="text-xs text-[var(--vx-muted)]">
                                Placement locked
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-semibold text-[var(--vx-text)]">
                              {row.kills}
                            </div>
                            <div className="text-xs text-[var(--vx-muted)]">Kills</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div
                      className="rounded-2xl border p-4"
                      style={{
                        background: "transparent",
                        borderColor: "var(--vx-border)",
                      }}
                    >
                      <p className="text-xs uppercase tracking-[0.24em] text-[var(--vx-muted)]">
                        Alive Teams
                      </p>
                      <div className="mt-4 flex items-center justify-between gap-4">
                        <div>
                          <div className="text-lg font-semibold text-[var(--vx-text)]">12 Teams</div>
                          <div className="text-sm text-[var(--vx-muted)]">
                            Built only with design tokens
                          </div>
                        </div>
                        <div
                          className="rounded-2xl px-4 py-3 text-right"
                          style={{
                            background:
                              "linear-gradient(135deg, var(--vx-primary), var(--vx-secondary))",
                            color: "var(--vx-text)",
                            boxShadow: "0 0 24px var(--vx-glow)",
                          }}
                        >
                          <div className="text-3xl font-bold">12</div>
                          <div className="text-xs uppercase tracking-[0.2em]">Alive</div>
                        </div>
                      </div>
                    </div>

                    <div
                      className="rounded-2xl border p-4"
                      style={{
                        background: "transparent",
                        borderColor: "var(--vx-border)",
                      }}
                    >
                      <p className="text-xs uppercase tracking-[0.24em] text-[var(--vx-muted)]">
                        Lower Third
                      </p>
                      <div className="mt-4">
                        <div className="text-lg font-semibold text-[var(--vx-text)]">
                          Player Spotlight
                        </div>
                        <div className="mt-1 text-sm text-[var(--vx-muted)]">
                          Lower thirds, labels, and accents inherit from the active token set.
                        </div>
                      </div>
                      <div
                        className="mt-4 rounded-xl border px-3 py-3"
                        style={{
                          borderColor: "var(--vx-border)",
                          background:
                            "linear-gradient(90deg, color-mix(in srgb, var(--vx-accent) 24%, transparent), color-mix(in srgb, var(--vx-bg-base) 24%, transparent) 54%, transparent)",
                        }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="font-semibold text-[var(--vx-text)]">Mohu Official</div>
                            <div className="text-xs text-[var(--vx-muted)]">
                              4 eliminations - 1 revive
                            </div>
                          </div>
                          <div className="text-sm font-semibold text-[var(--vx-accent)]">
                            MVP Watch
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <PreviewToken label="--vx-primary" value={preview.primaryColor} />
                  <PreviewToken label="--vx-secondary" value={preview.secondaryColor} />
                  <PreviewToken label="--vx-panel" value={preview.panel} />
                  <PreviewToken label="--vx-border" value={preview.border} />
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {toast ? (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-emerald-400/40 bg-emerald-500/15 px-4 py-3 text-sm font-medium text-emerald-50 shadow-2xl shadow-emerald-950/40">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

