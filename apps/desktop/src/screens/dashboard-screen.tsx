import { useState } from "react";
import type {
  LauncherAccessState,
  LauncherLicense,
  LauncherSession,
  LauncherSlot,
  MatchControlSnapshot,
  MatchPhase,
  MatchSummary,
  NextMatchSuggestion,
  ObserverFeedStatus,
  ProductionModeResult,
  StageSummary,
  StatusMessage,
  TelemetryBridgeStatus,
  TournamentSummary,
} from "../types";
import { ObserverCommandCenter } from "./observer-command-center";

const SUPPORT_MODE_TOGGLE_VISIBLE = false;

type DashboardScreenProps = {
  apiBase: string;
  session: LauncherSession;
  access: LauncherAccessState;
  license: LauncherLicense | null;
  tournaments: TournamentSummary[];
  stages: StageSummary[];
  matches: MatchSummary[];
  selectedTournamentId: string;
  selectedStageId: string;
  selectedMatchId: string;
  teamAssetsDir: string;
  brandingConfigPath: string;
  shadowTrackerPath: string;
  telemetryBridgeAvailable: boolean;
  telemetryStatus: TelemetryBridgeStatus;
  matchControl: MatchControlSnapshot | null;
  matchLifecycleStatus: string | null;
  matchLocked: boolean;
  matchFinalizing: boolean;
  nextMatchSuggestion: NextMatchSuggestion["nextMatch"] | null;
  nextMatchLoading: boolean;
  nextMatchError: string | null;
  preparingNextMatch: boolean;
  productionModeResult: ProductionModeResult | null;
  enteringProductionMode: boolean;
  canStartTelemetry: boolean;
  observerFeedStatus: ObserverFeedStatus;
  canStartObserverFeed: boolean;
  status: StatusMessage;
  slots: LauncherSlot[];
  lastSyncTime: string | null;
  busyAction: string | null;
  loadingMatch: boolean;
  onTournamentChange: (value: string) => void;
  onStageChange: (value: string) => void;
  onMatchChange: (value: string) => void;
  onShadowTrackerPathChange: (value: string) => void;
  onBrowseShadowTracker: () => void;
  onSyncTeams: () => void;
  onGenerateBranding: () => void;
  onLaunchShadowTracker: () => void;
  onEnterProductionMode: () => void;
  onToggleTelemetry: () => void;
  onToggleObserverFeed: () => void;
  onPrepareNextMatch: () => void;
  onLogout: () => void;
};

const MATCH_PHASE_META: Record<
  Exclude<MatchPhase, null>,
  { label: string; icon: string }
> = {
  plane: { label: "Plane Phase", icon: "\u2708" },
  parachuting: { label: "Parachuting", icon: "\uD83E\uDE82" },
  combat: { label: "Combat", icon: "\u2694" },
  endgame: { label: "Endgame", icon: "\uD83D\uDD25" },
  finished: { label: "Finished", icon: "\uD83C\uDFC1" },
};

const formatTeamName = (slot: LauncherSlot) =>
  slot.team?.tag || slot.team?.name || slot.teamId || "Arenzyra";

const formatTime = (value: string | null) => {
  if (!value) {
    return "--";
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleTimeString();
};

const formatConnectionStatus = (value: string | null | undefined) => {
  const normalized = String(value || "").trim();
  return normalized ? normalized.replace(/[-_]/g, " ").toUpperCase() : "--";
};

const formatLifecycleStatus = (value: string | null | undefined) => {
  const normalized = String(value || "").trim();
  return normalized ? normalized.replace(/_/g, " ").toUpperCase() : "--";
};

const formatTelemetryContractStatus = (
  control: MatchControlSnapshot | null | undefined,
) => {
  if (!control) {
    return "--";
  }
  if (control.resultFinalized === true) {
    return "FINALIZED";
  }
  if (control.isFinalizing === true || control.lifecycleStatus === "ENDED") {
    return "FINALIZING";
  }
  if (control.telemetry?.telemetryActive === true) {
    return "ACTIVE";
  }
  if (control.telemetry?.telemetryAccepted === true) {
    return "ACCEPTED";
  }
  if (control.telemetry?.packetsReceiving === true) {
    return "RECEIVING";
  }
  if (control.telemetry?.transportConnected === true) {
    return "CONNECTED";
  }
  return "WAITING";
};

const formatContractFlag = (value: boolean | null | undefined) =>
  value === true ? "YES" : "NO";

const formatBindingStatus = (
  binding: MatchControlSnapshot["binding"] | null | undefined,
) => {
  if (!binding) {
    return "--";
  }
  if (binding.isReady) {
    return "READY";
  }
  if (binding.isBound) {
    return "BOUND";
  }
  if (binding.isConfigured) {
    return "CONFIGURED";
  }
  return "NOT CONFIGURED";
};

const formatObserverFeedRuntimeStatus = (
  feed: ObserverFeedStatus | null | undefined,
) => {
  if (!feed || !feed.running) {
    return "OFF";
  }
  if (feed.lastError) {
    return "ERROR";
  }
  if (feed.ready) {
    return "DIRECT READY";
  }
  return "DIRECT STARTING";
};

const isLiveState = (value: string | null | undefined) =>
  String(value || "")
    .trim()
    .toUpperCase() === "LIVE";

const formatDate = (value: string | null | undefined) => {
  if (!value) {
    return "--";
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(parsed));
};

const formatPhaseDisplay = (phase: MatchPhase) => {
  if (!phase) {
    return "--";
  }

  const meta = MATCH_PHASE_META[phase];
  return `${meta.icon} ${meta.label}`;
};

const formatStageLabel = (stage: StageSummary) =>
  `#${stage.order} ${stage.name}${isLiveState(stage.liveState) ? " [LIVE]" : ""}`;

const formatMatchLabel = (match: MatchSummary) => {
  const numberLabel =
    typeof match.matchNumber === "number" ? `Match ${match.matchNumber}` : "Match";
  const nameLabel = match.name ? ` - ${match.name}` : "";
  const groupLabel = match.group?.name ? ` (${match.group.name})` : "";
  return `${numberLabel}${nameLabel}${groupLabel}`;
};

const formatTournamentLabel = (tournament: TournamentSummary) =>
  `${tournament.name || tournament.id}${
    isLiveState(tournament.liveState) || isLiveState(tournament.status)
      ? " [LIVE]"
      : ""
  }`;

const formatSuggestedNextMatch = (
  match: NonNullable<NextMatchSuggestion["nextMatch"]>,
) => {
  const label =
    typeof match.matchNumber === "number"
      ? `Match ${match.matchNumber}`
      : "Next Match";
  const name = match.name ? ` - ${match.name}` : "";
  return `${label}${name}`;
};

const formatProductionStatus = (value: ProductionModeResult["status"]) => {
  if (value === "READY_WITH_WARNINGS") {
    return "Production Ready With Warnings";
  }
  if (value === "BLOCKED") {
    return "Production Blocked";
  }
  return "Production Ready";
};

export function DashboardScreen(props: DashboardScreenProps) {
  const [supportMode, setSupportMode] = useState(false);
  const phaseDisplay = formatPhaseDisplay(props.telemetryStatus.phase);
  const bridgeStatusDisplay = formatConnectionStatus(
    props.telemetryStatus.connectionStatus,
  );
  const telemetryContractStatusDisplay = formatTelemetryContractStatus(
    props.matchControl,
  );
  const lifecycleStatusDisplay = formatLifecycleStatus(
    props.matchControl?.lifecycleStatus ?? props.matchLifecycleStatus,
  );
  const bindingStatusDisplay = formatBindingStatus(props.matchControl?.binding);
  const telemetryContract = props.matchControl?.telemetry ?? null;
  const observerFeedDisplay = formatObserverFeedRuntimeStatus(
    props.observerFeedStatus,
  );
  const selectedTournament =
    props.tournaments.find((item) => item.id === props.selectedTournamentId) ||
    null;
  const selectedStage =
    props.stages.find((item) => item.id === props.selectedStageId) || null;
  const selectedMatch =
    props.matches.find((item) => item.id === props.selectedMatchId) || null;
  const actionsDisabled =
    Boolean(props.busyAction) ||
    props.loadingMatch ||
    !props.selectedMatchId ||
    props.matchLocked ||
    props.matchFinalizing;
  const productionTone = !props.productionModeResult
    ? "neutral"
    : props.productionModeResult.status === "BLOCKED"
      ? "error"
      : props.productionModeResult.status === "READY_WITH_WARNINGS"
        ? "neutral"
        : "success";
  const lifecycleMessage = props.matchFinalizing
    ? {
        title: "Finalizing match...",
        detail:
          "Backend detected match end and is confirming the final state. Observer actions are temporarily disabled.",
      }
    : props.matchLocked
      ? {
          title: "Match Locked",
          detail:
            "Backend locked this match. Telemetry and observer controls stay locked until an admin unlocks it.",
        }
      : null;
  const productionStatusDisplay = props.productionModeResult
    ? formatProductionStatus(props.productionModeResult.status)
    : props.selectedMatchId
      ? "Production Not Checked"
      : "No Match Selected";
  const productionSummary = !props.selectedMatchId
    ? "Select a match before running the production preflight."
    : props.matchLocked
      ? "This match is locked."
      : props.matchFinalizing
        ? "Backend is finalizing the result."
        : props.productionModeResult
          ? `Checked ${formatTime(props.productionModeResult.checkedAt)}.`
          : "Run production mode before starting either telemetry transport.";
  const telemetrySignalTone = props.telemetryStatus.lastError
    ? "danger"
    : telemetryContract?.telemetryActive
      ? "success"
      : telemetryContract?.telemetryAccepted || telemetryContract?.packetsReceiving
        ? "accent"
        : "neutral";
  const bridgeSignalTone = props.telemetryStatus.lastError
    ? "danger"
    : props.telemetryStatus.running
      ? "success"
      : props.telemetryBridgeAvailable
        ? "neutral"
        : "danger";
  const observerSignalTone = props.observerFeedStatus.lastError
    ? "danger"
    : props.observerFeedStatus.running
      ? props.observerFeedStatus.ready
        ? "success"
        : "accent"
      : "neutral";
  const contextItems = [
    {
      label: "Organizer",
      value: props.session.user.email || props.session.user.id,
    },
    {
      label: "Organization",
      value:
        props.session.organization?.name ||
        props.session.user.organizationId ||
        "--",
    },
    {
      label: "License",
      value: props.license?.type
        ? `${props.license.type} / ${formatDate(props.license.expiresAt)}`
        : "--",
    },
    {
      label: "Observer Capacity",
      value: `${props.access.activeSessions ?? "--"} active / ${
        props.license?.maxObservers ?? props.access.maxObservers ?? "--"
      } allowed`,
    },
  ];
  const setupStats = [
    {
      label: "Observers allowed",
      value: props.license?.maxObservers ?? props.access.maxObservers ?? "--",
    },
    {
      label: "Active sessions",
      value: props.access.activeSessions ?? "--",
    },
    {
      label: "Loaded slots",
      value: props.slots.length,
    },
    {
      label: "Last sync",
      value: props.loadingMatch ? "Loading..." : formatTime(props.lastSyncTime),
    },
  ];
  const runtimeSignals = [
    {
      label: "Production Mode",
      value: productionStatusDisplay,
      detail: productionSummary,
      tone: productionTone,
    },
    {
      label: "Telemetry Contract",
      value: telemetryContractStatusDisplay,
      detail: `Lifecycle ${lifecycleStatusDisplay}`,
      tone: telemetrySignalTone,
    },
    {
      label: "Bridge Transport",
      value: bridgeStatusDisplay,
      detail: props.telemetryBridgeAvailable
        ? props.telemetryStatus.running
          ? "Bridge transport is running."
          : "Bridge transport is idle."
        : "Bridge IPC is unavailable.",
      tone: bridgeSignalTone,
    },
    {
      label: "Observer Feed",
      value: observerFeedDisplay,
      detail: props.observerFeedStatus.matchId
        ? `Bound to ${props.observerFeedStatus.matchId}`
        : "Direct feed is idle.",
      tone: observerSignalTone,
    },
  ];
  const visibleRuntimeSignals = supportMode
    ? runtimeSignals
    : runtimeSignals.filter((item) =>
        ["Production Mode", "Observer Feed"].includes(item.label),
      );
  const telemetryMetrics = [
    {
      label: "Transport Connected",
      value: formatContractFlag(telemetryContract?.transportConnected),
    },
    {
      label: "Packets Receiving",
      value: formatContractFlag(telemetryContract?.packetsReceiving),
    },
    {
      label: "Telemetry Accepted",
      value: formatContractFlag(telemetryContract?.telemetryAccepted),
    },
    {
      label: "Telemetry Active",
      value: formatContractFlag(telemetryContract?.telemetryActive),
    },
  ];
  const runtimeMetrics = [
    { label: "Match Phase", value: phaseDisplay },
    { label: "Binding", value: bindingStatusDisplay },
    {
      label: "Binding Source",
      value:
        props.matchControl?.binding?.telemetryProvider ||
        props.matchControl?.binding?.sourceMode ||
        props.matchControl?.binding?.dataSource ||
        props.matchControl?.binding?.dataMode ||
        "--",
    },
    { label: "Packets/sec", value: props.telemetryStatus.packetsPerSecond },
    {
      label: "Last Packet",
      value: formatTime(props.telemetryStatus.lastPacketTime),
    },
    {
      label: "Feed Match",
      value: props.observerFeedStatus.matchId || "--",
    },
  ];

  return (
    <div className="app-shell">
      <section className="launcher-overview">
        <div className="launcher-overview__intro">
          <div className="launcher-overview__copy">
            <span className="eyebrow">Arenzyra Observer Launcher</span>
            <h1>Observer workflow</h1>
            <p>
              Select the match, prepare production, then start the live observer
              feed.
            </p>
          </div>

          <div className="launcher-focus-card">
            <span className="launcher-focus-card__label">Current match</span>
            <strong>
              {selectedMatch ? formatMatchLabel(selectedMatch) : "No match selected"}
            </strong>
            <p>
              {selectedTournament?.name || "Select a tournament"}
              {selectedStage ? ` / ${formatStageLabel(selectedStage)}` : ""}
            </p>
            <div className="launcher-badge-row">
              <span className={`launcher-badge launcher-badge--${productionTone}`}>
                {productionStatusDisplay}
              </span>
              {supportMode ? (
                <span
                  className={`launcher-badge launcher-badge--${telemetrySignalTone}`}
                >
                  {telemetryContractStatusDisplay}
                </span>
              ) : null}
              <span className="launcher-badge launcher-badge--neutral">
                {observerFeedDisplay}
              </span>
            </div>
            {SUPPORT_MODE_TOGGLE_VISIBLE ? (
              <button
                className={`support-mode-toggle${supportMode ? " is-active" : ""}`}
                onClick={() => setSupportMode((current) => !current)}
                type="button"
              >
                {supportMode ? "Hide Support Mode" : "Support Mode"}
              </button>
            ) : null}
          </div>
        </div>

        {supportMode ? (
          <div className="launcher-context-grid">
            {contextItems.map((item) => (
              <div key={item.label} className="launcher-context-card">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <div className="launcher-main-grid">
        <div className="launcher-column launcher-column--primary">
          <section className="panel panel--section">
          <div className="panel-heading panel-heading--rich">
            <div>
              <span className="panel-kicker">Production Scope</span>
              <h2>Match Setup</h2>
              <p>
                Choose the tournament, stage, and match for this observer.
              </p>
            </div>
          </div>

          {supportMode ? (
            <div className="panel-inline-note">
              <span>API Base</span>
              <code>{props.apiBase}</code>
            </div>
          ) : null}

          <label className="field">
            <span>Tournament</span>
            <select
              value={props.selectedTournamentId}
              onChange={(event) => props.onTournamentChange(event.target.value)}
              disabled={Boolean(props.busyAction) || props.loadingMatch}
            >
              <option value="">Select a tournament</option>
              {props.tournaments.map((tournament) => (
                <option key={tournament.id} value={tournament.id}>
                  {formatTournamentLabel(tournament)}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Stage</span>
            <select
              value={props.selectedStageId}
              onChange={(event) => props.onStageChange(event.target.value)}
              disabled={
                !props.selectedTournamentId ||
                Boolean(props.busyAction) ||
                props.loadingMatch
              }
            >
              <option value="">Select a stage</option>
              {props.stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {formatStageLabel(stage)}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Match</span>
            <select
              value={props.selectedMatchId}
              onChange={(event) => props.onMatchChange(event.target.value)}
              disabled={
                !props.selectedTournamentId ||
                Boolean(props.busyAction) ||
                props.loadingMatch
              }
            >
              <option value="">Select a match</option>
              {props.matches.map((match) => (
                <option key={match.id} value={match.id}>
                  {formatMatchLabel(match)}
                </option>
              ))}
            </select>
          </label>

          {supportMode ? (
            <>
              <div className="note-grid">
                <div className="note-card">
                  <span className="path-label">Team logos folder</span>
                  <code>{props.teamAssetsDir}</code>
                </div>
                <div className="note-card">
                  <span className="path-label">Branding config file</span>
                  <code>{props.brandingConfigPath}</code>
                </div>
              </div>

              <div className="mini-stat-grid">
                {setupStats.map((item) => (
                  <div key={item.label} className="mini-stat">
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          </section>

          <section className="panel workflow-panel">
            <div className="panel-heading panel-heading--rich">
              <div>
                <span className="panel-kicker">Workflow</span>
                <h2>Production Steps</h2>
                <p>
                  Open ShadowTracker manually, then run Production Mode and
                  start the live observer feed.
                </p>
              </div>
            </div>

            {!supportMode ? (
              <div className="status-card status-card--neutral">
                <strong>Before you start</strong>
                <p>
                  Open ShadowTracker on this PC. Production Mode will verify
                  that ShadowTracker telemetry is reachable before live feed can
                  start.
                </p>
              </div>
            ) : null}

            <div
              className={`workflow-grid${
                supportMode ? "" : " workflow-grid--simple"
              }`}
            >
              {supportMode ? (
                <button
                  className="workflow-card workflow-card--support"
                  onClick={props.onSyncTeams}
                  disabled={actionsDisabled}
                  type="button"
                >
                  <span className="workflow-card__step">Support</span>
                  <strong>Sync Teams</strong>
                  <p>Fetch slots, player data, and team logos for the selected match.</p>
                </button>
              ) : null}

              {supportMode ? (
                <button
                  className="workflow-card workflow-card--support"
                  onClick={props.onGenerateBranding}
                  disabled={actionsDisabled}
                  type="button"
                >
                  <span className="workflow-card__step">Support</span>
                  <strong>Generate Branding</strong>
                  <p>Write TeamLogoAndColor for the selected production match.</p>
                </button>
              ) : null}

              {supportMode ? (
                <button
                  className="workflow-card workflow-card--support"
                  onClick={props.onLaunchShadowTracker}
                  disabled={actionsDisabled}
                  type="button"
                >
                  <span className="workflow-card__step">Support</span>
                  <strong>Launch ShadowTracker</strong>
                  <p>Warm up the client and keep telemetry stopped until you go live.</p>
                </button>
              ) : null}

              <button
                className="workflow-card workflow-card--primary"
                onClick={props.onEnterProductionMode}
                disabled={
                  actionsDisabled ||
                  props.telemetryStatus.running ||
                  props.observerFeedStatus.running
                }
                type="button"
              >
                <span className="workflow-card__step">Step 1</span>
                <strong>
                  {props.enteringProductionMode
                    ? "Checking Production Mode"
                    : "Enter Production Mode"}
                </strong>
                <p>
                  {supportMode
                    ? "Run the guided preflight and unlock transport start only when readiness checks pass."
                    : "Run final readiness checks before going live."}
                </p>
              </button>

              {supportMode ? (
                <button
                  className="workflow-card workflow-card--transport"
                  onClick={props.onToggleTelemetry}
                  disabled={
                    !props.telemetryStatus.running &&
                    (!props.canStartTelemetry ||
                      actionsDisabled ||
                      !props.telemetryBridgeAvailable)
                  }
                  type="button"
                >
                  <span className="workflow-card__step">Support</span>
                  <strong>
                    {props.telemetryStatus.running
                      ? "Stop Telemetry Bridge"
                      : "Start Telemetry Bridge"}
                  </strong>
                  <p>
                    Use the managed bridge when direct observer feed is not the
                    selected transport.
                  </p>
                </button>
              ) : null}

              <button
                className="workflow-card workflow-card--transport-alt"
                onClick={props.onToggleObserverFeed}
                disabled={
                  !props.observerFeedStatus.running &&
                  (!props.canStartObserverFeed ||
                    actionsDisabled ||
                    !props.telemetryBridgeAvailable)
                }
                type="button"
              >
                <span className="workflow-card__step">Step 2</span>
                <strong>
                  {props.observerFeedStatus.running
                    ? "Stop Direct Observer Feed"
                    : "Start Observer Feed"}
                </strong>
                {supportMode ? (
                  <p>
                    Use the direct `ob.js` sender when production mode is ready
                    and the bridge is stopped.
                  </p>
                ) : null}
              </button>
            </div>
          </section>
        </div>

        <div className="launcher-column launcher-column--secondary">
          <section className="panel panel--section">
          <div className="panel-heading panel-heading--rich">
            <div>
              <span className="panel-kicker">Match Control</span>
              <h2>Live Status</h2>
              <p>
                Review live readiness and only show technical diagnostics in
                Support Mode.
              </p>
            </div>
          </div>

          <div className="signal-grid">
            {visibleRuntimeSignals.map((item) => (
              <div
                key={item.label}
                className={`signal-card signal-card--${item.tone}`}
              >
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <p>{item.detail}</p>
              </div>
            ))}
          </div>

          {supportMode ? (
            <label className="field">
              <span>ShadowTrackerExtra.exe</span>
              <div className="input-row">
                <input
                  value={props.shadowTrackerPath}
                  onChange={(event) =>
                    props.onShadowTrackerPathChange(event.target.value)
                  }
                  placeholder="C:\\PCOB\\Win64_Release4.3.0_No14_4.3.0.20920_Shipping_OB_Shelled\\WindowsNoEditor\\ShadowTrackerExtra\\Binaries\\Win64\\ShadowTrackerExtra.exe"
                  disabled={Boolean(props.busyAction) || props.loadingMatch}
                />
                <button
                  className="secondary-button"
                  onClick={props.onBrowseShadowTracker}
                  disabled={Boolean(props.busyAction) || props.loadingMatch}
                  type="button"
                >
                  Browse
                </button>
              </div>
            </label>
          ) : null}

          {supportMode ? (
            <div className="runtime-grid">
              <div className="status-card status-card--neutral">
                <strong>Telemetry Contract</strong>
                <div className="runtime-metrics">
                  {telemetryMetrics.map((item) => (
                    <div key={item.label} className="runtime-metric">
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                </div>
              </div>

              <div className="status-card status-card--neutral">
                <strong>Runtime Details</strong>
                <div className="runtime-metrics">
                  {runtimeMetrics.map((item) => (
                    <div key={item.label} className="runtime-metric">
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {!props.telemetryBridgeAvailable ? (
            <div className="status-card status-card--error">
              <strong>Telemetry bridge unavailable</strong>
              <p>Restart the Electron launcher to load the telemetry bridge.</p>
            </div>
          ) : null}

          {props.telemetryStatus.lastError ? (
            <div className="status-card status-card--error">
              <strong>Telemetry error</strong>
              <p>{props.telemetryStatus.lastError}</p>
            </div>
          ) : null}

          {props.observerFeedStatus.lastError ? (
            <div className="status-card status-card--error">
              <strong>Observer feed error</strong>
              <p>{props.observerFeedStatus.lastError}</p>
            </div>
          ) : null}

          {lifecycleMessage ? (
            <div className="status-card status-card--neutral">
              <strong>{lifecycleMessage.title}</strong>
              <p>{lifecycleMessage.detail}</p>
            </div>
          ) : null}

          <div className={`status-card status-card--${productionTone}`}>
            <strong>{productionStatusDisplay}</strong>
            <p>{productionSummary}</p>

            {props.productionModeResult?.blockingIssues.length ? (
              <div className="production-checklist-group">
                <span className="path-label">Blocking issues</span>
                <ul className="production-checklist">
                  {props.productionModeResult.blockingIssues.map((issue) => (
                    <li key={issue}>
                      <strong>BLOCK</strong>
                      <span>{issue}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {props.productionModeResult?.warnings.length ? (
              <div className="production-checklist-group">
                <span className="path-label">Warnings</span>
                <ul className="production-checklist">
                  {props.productionModeResult.warnings.map((issue) => (
                    <li key={issue}>
                      <strong>WARN</strong>
                      <span>{issue}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {supportMode && props.productionModeResult?.checks.length ? (
              <div className="production-checklist-group">
                <span className="path-label">Checklist</span>
                <ul className="production-checklist">
                  {props.productionModeResult.checks.map((check) => (
                    <li key={`${check.key}-${check.message}`}>
                      <strong>{check.status.toUpperCase()}</strong>
                      <span>
                        {check.label}: {check.message}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          {props.matchLocked ? (
            <div
              className={`status-card status-card--${
                props.nextMatchError ? "error" : "neutral"
              }`}
            >
              <strong>Suggested Next Match</strong>
              {props.nextMatchLoading ? (
                <p>Finding the next eligible match...</p>
              ) : props.nextMatchError ? (
                <p>{props.nextMatchError}</p>
              ) : props.nextMatchSuggestion ? (
                <>
                  <p>
                    {formatSuggestedNextMatch(props.nextMatchSuggestion)} is available
                    in {` ${formatLifecycleStatus(props.nextMatchSuggestion.status)}`}{" "}
                    state.
                  </p>
                  <code>{props.nextMatchSuggestion.id}</code>
                  <div className="status-card__actions">
                    <button
                      className="secondary-button"
                      onClick={props.onPrepareNextMatch}
                      disabled={
                        props.preparingNextMatch ||
                        props.nextMatchLoading ||
                        Boolean(props.busyAction)
                      }
                      type="button"
                    >
                      {props.preparingNextMatch
                        ? "Preparing Next Match..."
                        : "Prepare Next Match"}
                    </button>
                  </div>
                </>
              ) : (
                <p>No next match available.</p>
              )}
            </div>
          ) : null}

          <div className={`status-card status-card--${props.status.tone}`}>
            <strong>{props.status.title}</strong>
            <p>{props.status.detail}</p>
          </div>
          </section>
        </div>
      </div>

      {supportMode ? (
        <ObserverCommandCenter
          interactionsLocked={props.matchLocked || props.matchFinalizing}
          lockMessage={
            props.matchFinalizing
              ? "Finalizing match..."
              : props.matchLocked
                ? "Match Locked"
                : null
          }
        />
      ) : null}

      {supportMode ? (
        <section className="panel table-panel">
        <div className="panel-heading panel-heading--split">
          <div>
            <span className="panel-kicker">Assigned Slots</span>
            <h2>Loaded Match Teams</h2>
            <p>
              Review the synced slot list and confirm logos, player counts, and
              local asset output before going live.
            </p>
          </div>
          <span className="table-count">{props.slots.length} loaded</span>
        </div>

        {props.slots.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Slot</th>
                  <th>Team</th>
                  <th>Lobby</th>
                  <th>Players</th>
                  <th>Color</th>
                  <th>Logo Path</th>
                </tr>
              </thead>
              <tbody>
                {props.slots.map((slot) => (
                  <tr key={slot.id}>
                    <td>{slot.slotNumber}</td>
                    <td>
                      <div className="team-cell">
                        <strong>{formatTeamName(slot)}</strong>
                        <span>{slot.teamId || "--"}</span>
                      </div>
                    </td>
                    <td>{slot.attendanceStatus || slot.lobbyStatus || "--"}</td>
                    <td>{slot.playersInLobby ?? "--"}</td>
                    <td>
                      <div className="color-chip-row">
                        <span
                          className="color-chip"
                          style={{
                            background:
                              slot.resolvedColor ||
                              slot.team?.accentLight ||
                              slot.team?.accentDark ||
                              "#FFFFFF",
                          }}
                        />
                        <code>
                          {slot.resolvedColor ||
                            slot.team?.accentLight ||
                            slot.team?.accentDark ||
                            "#FFFFFF"}
                        </code>
                      </div>
                    </td>
                    <td>
                      <code className="logo-path">
                        {slot.localLogoPath || "--"}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            {props.selectedMatchId
              ? "No team slots loaded yet. The launcher will populate this table when the selected match is synced."
              : "Select a match to load team slots, player data, and team logos."}
          </div>
        )}
        </section>
      ) : null}
    </div>
  );
}
