"use client";

import type { ChangeEvent, ReactNode } from "react";
import type { DiscordConfigDraft, DiscordConfigView } from "./types";

type TextFieldKey = Exclude<
  keyof DiscordConfigDraft,
  "enabled" | "autoCreateSessionCategories" | "autoCreateSessionChannels" | "autoSyncRoles"
>;

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <p className="mt-1 text-sm text-white/55">{description}</p>
      </div>
      {children}
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="space-y-2">
      <span className="text-[11px] uppercase tracking-[0.22em] text-white/45">
        {label}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none placeholder:text-white/30"
      />
    </label>
  );
}

function ToggleField({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 p-4">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-white/20 bg-transparent text-cyan-400"
      />
      <div>
        <div className="font-medium text-white">{label}</div>
        <div className="mt-1 text-sm text-white/55">{description}</div>
      </div>
    </label>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "default" | "good";
}) {
  return (
    <div
      className={`rounded-2xl border px-4 py-4 ${
        tone === "good"
          ? "border-emerald-400/25 bg-emerald-500/10"
          : "border-white/10 bg-black/20"
      }`}
    >
      <div className="text-[11px] uppercase tracking-[0.22em] text-white/45">
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

export function DiscordConfigForm({
  config,
  draft,
  saving,
  onDraftChange,
  onBack,
  onSave,
  saveLabel = "Save Discord Config",
}: {
  config: DiscordConfigView;
  draft: DiscordConfigDraft;
  saving: boolean;
  onDraftChange: (
    patch: Partial<DiscordConfigDraft> | ((current: DiscordConfigDraft) => DiscordConfigDraft),
  ) => void;
  onBack?: () => void;
  onSave: () => void;
  saveLabel?: string;
}) {
  const lastUpdated = config.updatedAt
    ? new Date(config.updatedAt).toLocaleString()
    : "Not saved yet";
  const updatedBy = config.updatedBy
    ? `${config.updatedBy.name} (${config.updatedBy.email})`
    : "Not available";

  function handleTextChange(key: TextFieldKey) {
    return (value: string) => onDraftChange({ [key]: value } as Partial<DiscordConfigDraft>);
  }

  function handleToggleChange(
    key: "enabled" | "autoCreateSessionCategories" | "autoCreateSessionChannels" | "autoSyncRoles",
  ) {
    return (value: boolean) =>
      onDraftChange({ [key]: value } as Partial<DiscordConfigDraft>);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-slate-950/80 p-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm text-white/45">{config.organization.name}</p>
          <h1 className="text-3xl font-bold text-white">Discord Control Plane</h1>
          <p className="mt-2 max-w-3xl text-sm text-white/60">
            Store the Discord guild, category, channel, and role mappings that Arenzyra
            will use for session-first operations. This page prepares the backend source
            of truth; live Discord sync can layer on top later.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="rounded-xl border border-cyan-400/20 bg-slate-950/65 px-4 py-2 text-sm font-medium text-cyan-50/90 transition hover:border-cyan-300/40 hover:bg-cyan-500/10 hover:text-white"
            >
              &larr; Back
            </button>
          ) : null}
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:border-cyan-300/60 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : saveLabel}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <StatCard
          label="Guild Linked"
          value={config.summary.hasGuildConnection ? "Yes" : "No"}
          tone={config.summary.hasGuildConnection ? "good" : "default"}
        />
        <StatCard
          label="Mapped Channels"
          value={`${config.summary.configuredChannelCount}`}
        />
        <StatCard
          label="Mapped Roles"
          value={`${config.summary.configuredRoleCount}`}
        />
        <StatCard
          label="Last Updated"
          value={lastUpdated}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Section
            title="Server Mapping"
            description="Define which Discord server and top-level category Arenzyra should treat as the operational home for this organization."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                label="Guild ID"
                value={draft.guildId}
                onChange={handleTextChange("guildId")}
                placeholder="Discord server ID"
              />
              <TextField
                label="Guild Name"
                value={draft.guildName}
                onChange={handleTextChange("guildName")}
                placeholder="Fix Esports"
              />
              <TextField
                label="Hub Category ID"
                value={draft.hubCategoryId}
                onChange={handleTextChange("hubCategoryId")}
                placeholder="Discord category ID"
              />
              <TextField
                label="Hub Category Name"
                value={draft.hubCategoryName}
                onChange={handleTextChange("hubCategoryName")}
                placeholder="Arenzyra Scrims"
              />
            </div>
          </Section>

          <Section
            title="Channel Mapping"
            description="Map the channels Arenzyra should use for registrations, slot visibility, results, standings, and organizer support."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                label="Registrations Channel ID"
                value={draft.registrationsChannelId}
                onChange={handleTextChange("registrationsChannelId")}
              />
              <TextField
                label="Registrations Channel Name"
                value={draft.registrationsChannelName}
                onChange={handleTextChange("registrationsChannelName")}
                placeholder="#scrim-register"
              />
              <TextField
                label="Slots Channel ID"
                value={draft.slotsChannelId}
                onChange={handleTextChange("slotsChannelId")}
              />
              <TextField
                label="Slots Channel Name"
                value={draft.slotsChannelName}
                onChange={handleTextChange("slotsChannelName")}
                placeholder="#scrim-slots"
              />
              <TextField
                label="Results Channel ID"
                value={draft.resultsChannelId}
                onChange={handleTextChange("resultsChannelId")}
              />
              <TextField
                label="Results Channel Name"
                value={draft.resultsChannelName}
                onChange={handleTextChange("resultsChannelName")}
                placeholder="#results"
              />
              <TextField
                label="Standings Channel ID"
                value={draft.standingsChannelId}
                onChange={handleTextChange("standingsChannelId")}
              />
              <TextField
                label="Standings Channel Name"
                value={draft.standingsChannelName}
                onChange={handleTextChange("standingsChannelName")}
                placeholder="#standings"
              />
              <TextField
                label="Support Channel ID"
                value={draft.supportChannelId}
                onChange={handleTextChange("supportChannelId")}
              />
              <TextField
                label="Support Channel Name"
                value={draft.supportChannelName}
                onChange={handleTextChange("supportChannelName")}
                placeholder="#support"
              />
            </div>
          </Section>

          <Section
            title="Role Mapping"
            description="Store the Discord roles Arenzyra should later use for organizer actions, captain-only flows, and registered participants."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                label="Organizer Role ID"
                value={draft.organizerRoleId}
                onChange={handleTextChange("organizerRoleId")}
              />
              <TextField
                label="Organizer Role Name"
                value={draft.organizerRoleName}
                onChange={handleTextChange("organizerRoleName")}
                placeholder="@Scrim Admin"
              />
              <TextField
                label="Captain Role ID"
                value={draft.captainRoleId}
                onChange={handleTextChange("captainRoleId")}
              />
              <TextField
                label="Captain Role Name"
                value={draft.captainRoleName}
                onChange={handleTextChange("captainRoleName")}
                placeholder="@Captain"
              />
              <TextField
                label="Participant Role ID"
                value={draft.participantRoleId}
                onChange={handleTextChange("participantRoleId")}
              />
              <TextField
                label="Participant Role Name"
                value={draft.participantRoleName}
                onChange={handleTextChange("participantRoleName")}
                placeholder="@Registered Team"
              />
            </div>
          </Section>

          <Section
            title="Session Automation Defaults"
            description="These toggles do not create channels yet. They define how the backend should think about future Discord session automation."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                label="Session Category Prefix"
                value={draft.sessionCategoryPrefix}
                onChange={handleTextChange("sessionCategoryPrefix")}
                placeholder="SCRIM"
              />
              <TextField
                label="Session Channel Prefix"
                value={draft.sessionChannelPrefix}
                onChange={handleTextChange("sessionChannelPrefix")}
                placeholder="scrim"
              />
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <ToggleField
                label="Enable Discord Control"
                description="Marks this org as Discord-ready for the session workflow."
                checked={draft.enabled}
                onChange={handleToggleChange("enabled")}
              />
              <ToggleField
                label="Session Categories"
                description="Future sessions may create a dedicated category instead of using a shared one."
                checked={draft.autoCreateSessionCategories}
                onChange={handleToggleChange("autoCreateSessionCategories")}
              />
              <ToggleField
                label="Session Channels"
                description="Future sessions may create or sync dedicated channels under the mapped Discord structure."
                checked={draft.autoCreateSessionChannels}
                onChange={handleToggleChange("autoCreateSessionChannels")}
              />
              <ToggleField
                label="Role Sync"
                description="Future Discord role sync should read from backend membership and session state."
                checked={draft.autoSyncRoles}
                onChange={handleToggleChange("autoSyncRoles")}
              />
            </div>
          </Section>

          <Section
            title="Internal Notes"
            description="Document caveats about permissions, channel structure, or guild setup until live sync is introduced."
          >
            <textarea
              value={draft.notes}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                onDraftChange({ notes: event.target.value })
              }
              rows={5}
              className="w-full rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white outline-none placeholder:text-white/30"
              placeholder="Example: use the shared Arenzyra category for daily scrims and keep results posting in #results."
            />
          </Section>
        </div>

        <aside className="space-y-4">
          <Section
            title="Config Status"
            description="A quick operational readout of what is already mapped."
          >
            <div className="space-y-3 text-sm text-white/65">
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="text-[11px] uppercase tracking-[0.22em] text-white/40">
                  Setup Record
                </div>
                <div className="mt-2 font-medium text-white">
                  {config.exists ? "Saved in backend" : "Draft only"}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="text-[11px] uppercase tracking-[0.22em] text-white/40">
                  Hub Category
                </div>
                <div className="mt-2 font-medium text-white">
                  {config.summary.hasHubCategory ? "Mapped" : "Not mapped"}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="text-[11px] uppercase tracking-[0.22em] text-white/40">
                  Automation Defaults
                </div>
                <div className="mt-2 font-medium text-white">
                  {config.summary.automationEnabled ? "Enabled" : "Disabled"}
                </div>
              </div>
            </div>
          </Section>

          <Section
            title="Audit Snapshot"
            description="Useful for organizers and super-admins when Discord settings drift."
          >
            <div className="space-y-3 text-sm text-white/65">
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-white/40">
                  Updated By
                </div>
                <div className="mt-1 text-white">{updatedBy}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-white/40">
                  Last Validation
                </div>
                <div className="mt-1 text-white">
                  {config.lastValidatedAt
                    ? new Date(config.lastValidatedAt).toLocaleString()
                    : "Not validated yet"}
                </div>
              </div>
            </div>
          </Section>
        </aside>
      </div>
    </div>
  );
}
