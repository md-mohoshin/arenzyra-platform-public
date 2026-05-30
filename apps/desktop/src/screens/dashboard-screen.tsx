import type { ButtonHTMLAttributes } from "react";
import {
  formatMatchLabel,
  formatSourceLabel,
  getWorkflowPresentation,
} from "../lib/launcher-ui";
import type {
  LauncherLiveMatch,
  LauncherWorkflowState,
  MatchSummary,
  NextMatchSuggestion,
  ObserverFeedStatus,
  ProductionModeStatus,
  StageSummary,
  StatusMessage,
  TournamentSummary,
  VisualCaptureSource,
  VisualGamePresetKey,
  VisualModeRegion,
  VisualModeRegionKey,
  VisualModeStatus,
  VisualReviewQueueState,
} from "../types";

type DashboardScreenProps = {
  organizationName: string | null;
  liveMatch: LauncherLiveMatch | null;
  workflowState: LauncherWorkflowState;
  productionStatus: ProductionModeStatus | null;
  tournaments: TournamentSummary[];
  stages: StageSummary[];
  matches: MatchSummary[];
  selectedTournamentId: string;
  selectedStageId: string;
  selectedMatchId: string;
  matchLifecycleStatus: string | null;
  matchLocked: boolean;
  matchFinalizing: boolean;
  nextMatchSuggestion: NextMatchSuggestion | null;
  nextMatchLoading: boolean;
  nextMatchError: string | null;
  preparingNextMatch: boolean;
  observerFeedStatus: ObserverFeedStatus;
  visualModeStatus: VisualModeStatus;
  visualGamePresetLabels: Record<VisualGamePresetKey, string>;
  visualSources: VisualCaptureSource[];
  selectedVisualSourceId: string;
  visualCaptureFps: number;
  visualActiveRegionKey: VisualModeRegionKey;
  visualRegionDraft: VisualModeRegion;
  visualRegionDirty: boolean;
  visualReviewQueue: VisualReviewQueueState;
  visualSourcesLoading: boolean;
  visualModeError: string | null;
  canStartObserverFeed: boolean;
  canStartVisualMode: boolean;
  status: StatusMessage;
  busyAction: string | null;
  loadingMatch: boolean;
  onTournamentChange: (tournamentId: string) => void;
  onStageChange: (stageId: string) => void;
  onMatchChange: (matchId: string) => void;
  onToggleLiveDesk: () => void;
  onVisualGamePresetChange: (gamePresetKey: VisualGamePresetKey) => void;
  onVisualSourceChange: (sourceId: string) => void;
  onVisualFpsChange: (captureFps: number) => void;
  onVisualRegionKeyChange: (regionKey: VisualModeRegionKey) => void;
  onVisualRegionDraftChange: (
    field: keyof VisualModeRegion,
    value: number,
  ) => void;
  onSaveVisualCalibration: () => void;
  onCaptureVisualReviewCandidate: () => void;
  onRunVisualReviewOcr: (id: string) => void;
  onClearVisualReviewQueue: () => void;
  onIgnoreVisualReviewItem: (id: string) => void;
  onMarkVisualReviewItemReviewed: (id: string) => void;
  onRefreshVisualSources: () => void;
  onToggleVisualMode: () => void;
  onPrepareNextMatch: () => void;
};

type DeskTone = "neutral" | "success" | "accent" | "danger";

const visualRegionOptions: Array<{
  key: VisualModeRegionKey;
  label: string;
}> = [
  { key: "killFeed", label: "Kill feed" },
  { key: "teamPanel", label: "Team panel" },
  { key: "scoreboard", label: "Scoreboard" },
];

const visualGameOptions: VisualGamePresetKey[] = [
  "pubgMobile",
  "freeFire",
  "valorant",
  "codMobile",
];

function formatVisualOcrStatus(item: {
  ocrStatus?: string;
  okCount?: number;
  unresolvedCount?: number;
  ambiguousCount?: number;
  ocrError?: string | null;
}) {
  if (item.ocrStatus === "processing") {
    return "OCR processing";
  }
  if (item.ocrStatus === "ready") {
    return `${item.okCount || 0} resolved`;
  }
  if (item.ocrStatus === "needs_review") {
    return `${item.okCount || 0} ok, ${item.unresolvedCount || 0} unresolved, ${item.ambiguousCount || 0} ambiguous`;
  }
  if (item.ocrStatus === "failed") {
    return item.ocrError || "OCR failed";
  }
  return "OCR not run";
}

function normalize(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase();
}

function formatNextMatch(match: NonNullable<NextMatchSuggestion["nextMatch"]>) {
  const parts = [
    typeof match.matchNumber === "number" ? `Match ${match.matchNumber}` : null,
    match.name,
  ]
    .map((part) => String(part || "").trim())
    .filter((part, index, all) => {
      if (!part) {
        return false;
      }
      const normalized = part.toLowerCase();
      return all.findIndex((candidate) => candidate.trim().toLowerCase() === normalized) === index;
    });
  return parts.join(" / ") || match.id;
}

function lifecycleLabel(
  value: string | null | undefined,
  locked: boolean,
  finalizing: boolean,
) {
  if (locked) {
    return "FINISHED";
  }
  if (finalizing) {
    return "FINALIZING";
  }
  return normalize(value) || "READY";
}

function statusTone(tone: StatusMessage["tone"]): DeskTone {
  return tone === "error" ? "danger" : tone === "success" ? "success" : "neutral";
}

function workflowTone(status: ProductionModeStatus | null): DeskTone {
  if (status === "BLOCKED") {
    return "danger";
  }
  if (status === "READY" || status === "READY_WITH_WARNINGS") {
    return "success";
  }
  return "neutral";
}

function workflowLabel(status: ProductionModeStatus | null) {
  if (!status) {
    return "NOT CHECKED";
  }
  if (status === "READY_WITH_WARNINGS") {
    return "READY+WARN";
  }
  return status;
}

function deskBadgeClass(tone: DeskTone) {
  return `desk-badge desk-badge--${tone}`;
}

function deckNoteClass(tone: DeskTone) {
  return `deck-note deck-note--${tone}`;
}

function DeskStatusChip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: DeskTone;
}) {
  return (
    <div className={`desk-status-chip desk-status-chip--${tone}`}>
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function DeskActionButton({
  eyebrow,
  label,
  detail,
  className = "",
  ...props
}: {
  eyebrow: string;
  label: string;
  detail: string;
  className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className={`desk-action ${className}`.trim()}>
      <span className="desk-action__eyebrow">{eyebrow}</span>
      <span className="desk-action__label">{label}</span>
      <span className="desk-action__detail">{detail}</span>
    </button>
  );
}

function formatVisualTimestamp(value: string | null | undefined) {
  if (!value) {
    return "Never";
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "Never";
  }

  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function DashboardScreen(props: DashboardScreenProps) {
  const selectedTournament =
    props.tournaments.find((item) => item.id === props.selectedTournamentId) ||
    null;
  const selectedStage =
    props.stages.find((item) => item.id === props.selectedStageId) || null;
  const selectedMatch =
    props.matches.find((item) => item.id === props.selectedMatchId) || null;
  const nextMatch = props.nextMatchSuggestion?.nextMatch ?? null;
  const lifecycle = lifecycleLabel(
    props.matchLifecycleStatus,
    props.matchLocked,
    props.matchFinalizing,
  );
  const workflow = getWorkflowPresentation(props.workflowState);
  const observerRunning =
    props.observerFeedStatus.running &&
    props.observerFeedStatus.matchId === props.selectedMatchId;
  const visualRunning =
    props.visualModeStatus.running &&
    props.visualModeStatus.matchId === props.selectedMatchId;
  const nextMatchLabel = nextMatch
    ? formatNextMatch(nextMatch)
    : props.nextMatchLoading
      ? "Checking..."
      : "Unavailable";
  const runtimeLabel = observerRunning
    ? "OBSERVER"
    : visualRunning
      ? "VISUAL"
    : "IDLE";
  const runtimeTone: DeskTone = observerRunning || visualRunning
    ? "success"
    : "neutral";
  const headerTitle = selectedMatch
    ? formatMatchLabel(selectedMatch)
    : "Observer Desk";
  const compactHeaderMeta = [
    selectedTournament?.name || props.organizationName || null,
    selectedStage?.name || null,
    selectedMatch?.map ? String(selectedMatch.map) : null,
  ]
    .filter(Boolean)
    .join(" / ");
  const deskNote = props.nextMatchError
    ? props.nextMatchError
    : props.loadingMatch
      ? "Refreshing match assets..."
      : props.status.tone === "error"
        ? props.status.detail
        : null;
  const deskNoteTone: DeskTone =
    props.nextMatchError || props.status.tone === "error" ? "danger" : "neutral";
  const controlSummary = props.busyAction
    ? "A launcher action is already running. Wait for it to finish before triggering the next step."
    : observerRunning
      ? "Observer desk is live for this round."
      : workflow.detail;
  const liveDeskBusy =
    props.busyAction === "start-live-desk" ||
    props.busyAction === "start-observer-feed" ||
    props.busyAction === "stop-observer-feed";
  const liveDeskActionLabel = liveDeskBusy
    ? observerRunning || props.busyAction === "stop-observer-feed"
      ? "Stopping..."
      : "Starting..."
    : observerRunning
      ? "Stop Observer"
      : "Start Live Desk";
  const liveDeskActionDetail = observerRunning
    ? "End the live observer session."
    : "Validate production and launch live desk.";
  const visualActionLabel = props.visualModeStatus.running ? "Stop" : "Start";
  const visualStatusLabel = props.visualModeStatus.running
    ? "Monitoring"
    : props.visualModeStatus.available
      ? "Ready"
      : "Unavailable";
  const visualStatusTone: DeskTone = props.visualModeStatus.running
    ? "success"
    : props.visualModeStatus.lastError || !props.visualModeStatus.available
      ? "danger"
      : "neutral";

  return (
    <main className="desktop-main desktop-main--launcher">
      <div className="app-shell app-shell--desk">
        <header className="desk-topbar">
          <div className="desk-topbar__title">
            <h1 title={headerTitle}>{headerTitle}</h1>
            <span title={compactHeaderMeta || "No context"}>
              {compactHeaderMeta || "No context"}
            </span>
          </div>

          <div className="desk-badge-row">
            <span className={deskBadgeClass(workflow.tone)}>{workflow.label}</span>
            <span className={deskBadgeClass(runtimeTone)}>{runtimeLabel}</span>
            <span className={deskBadgeClass(workflowTone(props.productionStatus))}>
              {workflowLabel(props.productionStatus)}
            </span>
            <span className={deskBadgeClass(statusTone(props.status.tone))}>
              {props.status.title}
            </span>
          </div>
        </header>

        <section className="desk-console">
          <section className="desk-card desk-card--selection">
            <div className="desk-card__header">
              <strong>Select</strong>
              <span>{props.selectedMatchId ? "Pinned to round" : "Choose round"}</span>
            </div>

            <div className="desk-select-grid">
              <label className="field field--compact">
                <span>Tournament</span>
                <select
                  value={props.selectedTournamentId}
                  onChange={(event) =>
                    props.onTournamentChange(event.target.value)
                  }
                >
                  <option value="">Tournament</option>
                  {props.tournaments.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name || item.id}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field field--compact">
                <span>Stage</span>
                <select
                  value={props.selectedStageId}
                  onChange={(event) => props.onStageChange(event.target.value)}
                  disabled={!props.stages.length}
                >
                  <option value="">Stage</option>
                  {props.stages.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name || item.id}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field field--compact field--full">
                <span>Match</span>
                <select
                  value={props.selectedMatchId}
                  onChange={(event) => props.onMatchChange(event.target.value)}
                  disabled={!props.matches.length}
                >
                  <option value="">Match</option>
                  {props.matches.map((item) => (
                    <option key={item.id} value={item.id}>
                      {formatMatchLabel(item)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="desk-inline-strip">
              <div className="desk-inline">
                <span>Source</span>
                <strong>
                  {props.liveMatch?.matchId
                    ? formatSourceLabel(props.liveMatch.source)
                    : "No live match"}
                </strong>
              </div>
              <div className="desk-inline">
                <span>Next</span>
                <strong>{nextMatchLabel}</strong>
              </div>
            </div>
          </section>

          <section className="desk-card desk-card--actions">
            <div className="desk-card__header">
              <strong>Control</strong>
              <span>{props.busyAction ? "Working" : "Ready"}</span>
            </div>

            <div className="desk-action-bar">
              <DeskActionButton
                className="desk-action--primary desk-action--wide"
                disabled={
                  Boolean(props.busyAction) ||
                  (!observerRunning && !props.canStartObserverFeed)
                }
                onClick={props.onToggleLiveDesk}
                type="button"
                eyebrow="Live desk"
                label={liveDeskActionLabel}
                detail={liveDeskActionDetail}
              />
              <DeskActionButton
                disabled={
                  Boolean(props.busyAction) ||
                  props.preparingNextMatch ||
                  props.nextMatchLoading ||
                  !nextMatch
                }
                onClick={props.onPrepareNextMatch}
                type="button"
                eyebrow="Round flow"
                label={props.preparingNextMatch ? "Preparing..." : "Next"}
                detail="Switch to the next round."
              />
            </div>

            <p className="desk-action-note">{controlSummary}</p>
          </section>
        </section>

        <section className="desk-card desk-card--visual">
          <div className="desk-card__header">
            <strong>Visual Mode</strong>
            <span>Review-only screen monitor</span>
          </div>

          <div className="desk-visual-grid">
            <label className="field field--compact">
              <span>Game</span>
              <select
                value={props.visualModeStatus.gamePresetKey}
                onChange={(event) =>
                  props.onVisualGamePresetChange(
                    event.target.value as VisualGamePresetKey,
                  )
                }
                disabled={props.visualModeStatus.running}
              >
                {visualGameOptions.map((key) => (
                  <option key={key} value={key}>
                    {props.visualGamePresetLabels[key]}
                  </option>
                ))}
              </select>
            </label>

            <label className="field field--compact field--visual-source">
              <span>Screen / Window</span>
              <select
                value={props.selectedVisualSourceId}
                onChange={(event) =>
                  props.onVisualSourceChange(event.target.value)
                }
                disabled={props.visualModeStatus.running}
              >
                <option value="">Select source</option>
                {props.visualSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field field--compact">
              <span>Capture rate</span>
              <select
                value={String(props.visualCaptureFps)}
                onChange={(event) =>
                  props.onVisualFpsChange(Number(event.target.value))
                }
                disabled={props.visualModeStatus.running}
              >
                {[1, 2, 3, 4, 5, 6].map((fps) => (
                  <option key={fps} value={fps}>
                    {fps} FPS
                  </option>
                ))}
              </select>
            </label>

            <div className="desk-visual-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={props.onRefreshVisualSources}
                disabled={
                  props.visualSourcesLoading || props.visualModeStatus.running
                }
              >
                {props.visualSourcesLoading ? "Refreshing" : "Refresh"}
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={props.onToggleVisualMode}
                disabled={
                  Boolean(props.busyAction) ||
                  (!props.visualModeStatus.running && !props.canStartVisualMode)
                }
              >
                {visualActionLabel}
              </button>
            </div>
          </div>

          <div className="desk-visual-calibration">
            <div className="desk-visual-calibration__header">
              <strong>OCR Region</strong>
              <span>{props.visualRegionDirty ? "Unsaved" : "Saved"}</span>
            </div>

            <label className="field field--compact">
              <span>Region</span>
              <select
                value={props.visualActiveRegionKey}
                onChange={(event) =>
                  props.onVisualRegionKeyChange(
                    event.target.value as VisualModeRegionKey,
                  )
                }
                disabled={props.visualModeStatus.running}
              >
                {visualRegionOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="desk-region-grid">
              {(["x", "y", "width", "height"] as const).map((field) => (
                <label
                  className="field field--compact field--mini"
                  key={field}
                >
                  <span>{field === "width" ? "W" : field === "height" ? "H" : field.toUpperCase()}</span>
                  <input
                    type="number"
                    min={field === "x" || field === "y" ? 0 : 1}
                    max={100}
                    step={0.5}
                    value={props.visualRegionDraft[field]}
                    onChange={(event) =>
                      props.onVisualRegionDraftChange(
                        field,
                        Number(event.target.value),
                      )
                    }
                    disabled={props.visualModeStatus.running}
                  />
                </label>
              ))}
            </div>

            <button
              className="secondary-button"
              type="button"
              onClick={props.onSaveVisualCalibration}
              disabled={Boolean(props.busyAction) || props.visualModeStatus.running}
            >
              Save
            </button>
          </div>

          <div className="desk-status-strip desk-status-strip--visual">
            <DeskStatusChip
              label="Mode"
              value={visualStatusLabel}
              tone={visualStatusTone}
            />
            <DeskStatusChip
              label="Frames"
              value={String(props.visualModeStatus.framesSeen)}
              tone={props.visualModeStatus.framesSeen > 0 ? "accent" : "neutral"}
            />
            <DeskStatusChip
              label="Changes"
              value={String(props.visualModeStatus.changesDetected)}
              tone={
                props.visualModeStatus.changesDetected > 0
                  ? "success"
                  : "neutral"
              }
            />
            <DeskStatusChip
              label="Last frame"
              value={formatVisualTimestamp(props.visualModeStatus.lastFrameAt)}
              tone={props.visualModeStatus.lastFrameAt ? "success" : "neutral"}
            />
            <DeskStatusChip
              label="Queue"
              value={String(props.visualReviewQueue.pendingCount)}
              tone={props.visualReviewQueue.pendingCount > 0 ? "accent" : "neutral"}
            />
          </div>

          <div className="desk-review-queue">
            <div className="desk-review-queue__header">
              <strong>Review Queue</strong>
              <div className="desk-review-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={props.onCaptureVisualReviewCandidate}
                  disabled={
                    Boolean(props.busyAction) ||
                    !props.visualModeStatus.running ||
                    !props.visualModeStatus.calibrationReady
                  }
                >
                  Capture
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={props.onClearVisualReviewQueue}
                  disabled={
                    Boolean(props.busyAction) ||
                    props.visualReviewQueue.items.length === 0
                  }
                >
                  Clear
                </button>
              </div>
            </div>

            {props.visualReviewQueue.items.length ? (
              <div className="desk-review-list">
                {props.visualReviewQueue.items.slice(0, 3).map((item) => (
                  <div className="desk-review-row" key={item.id}>
                    <div>
                      <span>{item.status}</span>
                      <strong>
                        {visualRegionOptions.find((option) => option.key === item.regionKey)?.label ||
                          item.regionKey}
                      </strong>
                      <small>{formatVisualTimestamp(item.capturedAt)}</small>
                      <small>{formatVisualOcrStatus(item)}</small>
                    </div>
                    <div className="desk-review-row__actions">
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => props.onRunVisualReviewOcr(item.id)}
                        disabled={
                          item.status !== "pending" ||
                          item.ocrStatus === "processing" ||
                          !item.imagePath
                        }
                      >
                        OCR
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => props.onIgnoreVisualReviewItem(item.id)}
                        disabled={item.status !== "pending"}
                      >
                        Ignore
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() =>
                          props.onMarkVisualReviewItemReviewed(item.id)
                        }
                        disabled={
                          item.status !== "pending" ||
                          item.ocrStatus === "not_started" ||
                          item.ocrStatus === "processing" ||
                          item.ocrStatus === "failed"
                        }
                      >
                        Reviewed
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="desk-action-note">No visual captures queued.</p>
            )}
          </div>

          <p className="desk-action-note">
            {props.visualModeError ||
              "Visual Mode watches the selected source and keeps publishing blocked until a reviewed OCR/AI step exists."}
          </p>
        </section>

        <section className="desk-status-panel">
          <div className="desk-status-strip">
            <DeskStatusChip
              label="State"
              value={lifecycle}
              tone={
                props.matchLocked || props.matchFinalizing ? "danger" : "neutral"
              }
            />
            <DeskStatusChip
              label="Production"
              value={workflowLabel(props.productionStatus)}
              tone={workflowTone(props.productionStatus)}
            />
            <DeskStatusChip
              label="Observer"
              value={observerRunning ? "Running" : "Stopped"}
              tone={observerRunning ? "success" : "neutral"}
            />
            <DeskStatusChip
              label="Desk"
              value={props.status.title}
              tone={statusTone(props.status.tone)}
            />
          </div>

          {deskNote ? (
            <div className={deckNoteClass(deskNoteTone)}>{deskNote}</div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
