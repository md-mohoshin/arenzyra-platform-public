import { useState, type ReactNode } from "react";
import { useObserverCommandCenter } from "../hooks/use-observer-command-center";
import { observerCommandRoutes } from "../services/observer-command-center";
import type {
  ObserverCommandCenterSnapshot,
  ProductionAlert,
  WatchTarget,
} from "../types";

function formatRelativeTime(timestamp?: number | null) {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return "--";
  }

  const deltaMs = Math.max(0, Date.now() - timestamp);
  if (deltaMs < 1_000) {
    return "just now";
  }

  const seconds = Math.round(deltaMs / 1_000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${Math.round(hours / 24)}d ago`;
}

function formatCountdown(timestamp?: number | null) {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return "--";
  }

  const deltaMs = Math.max(0, timestamp - Date.now());
  const seconds = Math.round(deltaMs / 1_000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function formatConfidence(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  return `${Math.round(value * 100)}%`;
}

function formatScore(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? String(Math.round(value))
    : "--";
}

function hasCoordinates(value: { centerX?: number; centerY?: number } | null | undefined) {
  return Boolean(
    value &&
      typeof value.centerX === "number" &&
      Number.isFinite(value.centerX) &&
      typeof value.centerY === "number" &&
      Number.isFinite(value.centerY),
  );
}

function buildTargetLookup(snapshot: ObserverCommandCenterSnapshot) {
  const lookup = new Map<string, WatchTarget>();
  const collections = [
    snapshot.watchTargets,
    snapshot.pinState?.pinnedTargets ?? [],
    snapshot.operatorDetails?.suppressedTargets ?? [],
    snapshot.operatorDetails?.watchingNowTarget
      ? [snapshot.operatorDetails.watchingNowTarget]
      : [],
    snapshot.cameraAssistPayload?.topWatchTargets ?? [],
  ];

  collections.forEach((collection) => {
    collection.forEach((target) => {
      if (target?.id && !lookup.has(target.id)) {
        lookup.set(target.id, target);
      }
    });
  });

  return lookup;
}

function buildAlertLookup(snapshot: ObserverCommandCenterSnapshot) {
  const lookup = new Map<string, ProductionAlert>();
  const collections = [
    snapshot.alerts,
    snapshot.operatorDetails?.dismissedAlerts ?? [],
    snapshot.cameraAssistPayload?.activeAlerts ?? [],
  ];

  collections.forEach((collection) => {
    collection.forEach((alert) => {
      if (alert?.id && !lookup.has(alert.id)) {
        lookup.set(alert.id, alert);
      }
    });
  });

  return lookup;
}

function StatusChip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
}) {
  return (
    <div className={`command-center-chip command-center-chip--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "warning" | "danger" | "success";
}) {
  return <span className={`command-center-badge command-center-badge--${tone}`}>{children}</span>;
}

function InlineAction({
  label,
  onClick,
  disabled = false,
  tone = "neutral",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "neutral" | "accent" | "danger";
}) {
  return (
    <button
      className={`command-center-action command-center-action--${tone}`}
      onClick={onClick}
      disabled={disabled}
      type="button"
    >
      {label}
    </button>
  );
}

type ObserverCommandCenterProps = {
  interactionsLocked?: boolean;
  lockMessage?: string | null;
};

export function ObserverCommandCenter({
  interactionsLocked = false,
  lockMessage = null,
}: ObserverCommandCenterProps) {
  const [expanded, setExpanded] = useState(false);
  const { snapshot, loading, error, busyActionPath, refresh, runAction } =
    useObserverCommandCenter();
  const mapKey = snapshot.mapKey ?? snapshot.telemetry.mapKey ?? null;
  const targetLookup = buildTargetLookup(snapshot);
  const alertLookup = buildAlertLookup(snapshot);
  const operatorState = snapshot.operatorState;
  const workflowState = snapshot.operatorWorkflowState;
  const actionStatusMs = snapshot.operatorWorkflowConfig?.operatorActionStatusMs ?? 3_800;
  const watchedTarget =
    snapshot.operatorDetails?.watchingNowTarget ??
    (operatorState?.watchingNowTargetId
      ? targetLookup.get(operatorState.watchingNowTargetId) ?? null
      : null);
  const selectedTarget = workflowState?.selectedTargetId
    ? targetLookup.get(workflowState.selectedTargetId) ?? null
    : null;
  const selectedAlert = workflowState?.selectedAlertId
    ? alertLookup.get(workflowState.selectedAlertId) ?? null
    : null;
  const recommendation = snapshot.recommendation;
  const recommendedTarget =
    recommendation?.recommendedTargetId
      ? targetLookup.get(recommendation.recommendedTargetId) ?? null
      : null;
  const selectedTargetReplay = selectedTarget
    ? snapshot.replayCandidates.some(
        (candidate) =>
          candidate.id === selectedTarget.id || candidate.sourceId === selectedTarget.id,
      )
    : false;
  const selectedTargetPinned = Boolean(
    selectedTarget &&
      (selectedTarget.operatorPinned ||
        snapshot.pinState?.pinnedTargetIds.includes(selectedTarget.id) ||
        operatorState?.primaryPinnedTargetIds.includes(selectedTarget.id)),
  );
  const selectedTargetSuppressed = Boolean(
    selectedTarget &&
      (selectedTarget.operatorSuppressed ||
        operatorState?.suppressedTargetIds.includes(selectedTarget.id)),
  );
  const selectedAlertReplay = selectedAlert
    ? snapshot.replayCandidates.some(
        (candidate) =>
          candidate.id === selectedAlert.id || candidate.sourceId === selectedAlert.id,
      )
    : false;
  const showRecentAction = Boolean(
    workflowState?.lastAction &&
      workflowState.updatedAt &&
      Date.now() - workflowState.updatedAt <= actionStatusMs,
  );
  const collapsedSummary = loading
    ? "Loading live observer automation snapshot..."
    : `Map ${snapshot.mapContext?.sourceMapName || snapshot.mapKey || "--"} / ${
        snapshot.watchTargets.length
      } watch targets / ${snapshot.alerts.length} alerts / ${
        snapshot.replayCandidates.length
      } replay candidates.`;

  const isBusy = (path: string | null) => Boolean(path && busyActionPath === path);
  const execute = async (path: string | null) => {
    if (!path || interactionsLocked) {
      return;
    }
    try {
      await runAction(path);
    } catch (_) {
      // Errors surface through the hook state.
    }
  };

  return (
    <section className="panel observer-command-center">
      <div className="panel-heading observer-command-center__heading">
        <div>
          <span className="panel-kicker">Observer Command Center</span>
          <h2>Live Production Console</h2>
        </div>
        <div className="observer-command-center__toolbar">
          {showRecentAction ? (
            <div className="observer-command-center__status">
              <span>Recent action</span>
              <strong>{workflowState?.lastAction}</strong>
            </div>
          ) : null}
          <button
            className="secondary-button observer-command-center__refresh"
            onClick={() => setExpanded((current) => !current)}
            type="button"
          >
            {expanded ? "Hide Console" : "Show Console"}
          </button>
          <button
            className="secondary-button observer-command-center__refresh"
            onClick={() => {
              void refresh().catch(() => undefined);
            }}
            type="button"
          >
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="status-card status-card--error observer-command-center__error">
          <strong>Command Center refresh failed</strong>
          <p>{error}</p>
        </div>
      ) : null}

      {interactionsLocked ? (
        <div className="status-card status-card--neutral observer-command-center__error">
          <strong>{lockMessage || "Observer actions locked"}</strong>
          <p>
            Backend owns the match lifecycle. Command center actions stay disabled
            until the match is unlocked or returns to LIVE.
          </p>
        </div>
      ) : null}

      {expanded ? (
        <>
          <div className="command-center-status-row">
            <StatusChip
              label="Telemetry"
              value={
                snapshot.telemetry.connected
                  ? "Connected"
                  : snapshot.telemetry.connectionStatus || "Offline"
              }
              tone={
                snapshot.telemetry.connected
                  ? "success"
                  : snapshot.telemetry.lastError
                    ? "danger"
                    : "warning"
              }
            />
            <StatusChip
              label="Widget Server"
              value={
                snapshot.widgetServer.running
                  ? `Running${snapshot.widgetServer.port ? ` :${snapshot.widgetServer.port}` : ""}`
                  : "Stopped"
              }
              tone={snapshot.widgetServer.running ? "success" : "danger"}
            />
            <StatusChip
              label="Current Map"
              value={snapshot.mapContext?.sourceMapName || snapshot.mapKey || "--"}
            />
            <StatusChip
              label="Players"
              value={snapshot.telemetry.playerCount ?? "--"}
              tone={snapshot.telemetry.playerCount ? "accent" : "neutral"}
            />
            <StatusChip label="Zone Phase" value={snapshot.telemetry.phase || "--"} />
            <StatusChip
              label="Last Telemetry"
              value={formatRelativeTime(snapshot.telemetry.lastUpdateAt)}
              tone={snapshot.telemetry.connected ? "success" : "warning"}
            />
            <StatusChip
              label="Last Broadcast"
              value={formatRelativeTime(snapshot.widgetServer.lastBroadcastAt)}
              tone={snapshot.widgetServer.lastBroadcastAt ? "success" : "warning"}
            />
          </div>

          <fieldset
            disabled={interactionsLocked}
            style={{ border: "none", margin: 0, minInlineSize: 0, padding: 0 }}
          >
            <div className="command-center-grid">
        <section className="observer-command-panel observer-command-panel--focus">
          <div className="observer-command-panel__heading">
            <div>
              <span className="observer-command-panel__kicker">Current Focus</span>
              <h3>Watching Now & Recommendation</h3>
            </div>
            {loading ? <Badge tone="warning">Loading</Badge> : <Badge tone="success">Live</Badge>}
          </div>

          <div className="command-center-focus-grid">
            <div className="command-center-focus-card">
              <span className="observer-command-label">Watching now</span>
              <strong>{watchedTarget?.label || operatorState?.watchingNowTargetId || "--"}</strong>
              <p>
                {watchedTarget
                  ? `${watchedTarget.category || "watch_target"} | ${formatScore(watchedTarget.score)} score`
                  : "No watched target selected."}
              </p>
              {watchedTarget?.reason?.length ? (
                <div className="command-center-reasons">
                  {watchedTarget.reason.slice(0, 3).map((reason) => (
                    <Badge key={reason}>{reason}</Badge>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="command-center-focus-card">
              <span className="observer-command-label">Recommendation</span>
              <strong>
                {recommendation
                  ? `${recommendation.action.toUpperCase()}${recommendation.recommendedTargetId ? ` -> ${recommendedTarget?.label || recommendation.recommendedTargetId}` : ""}`
                  : "--"}
              </strong>
              <p>
                Confidence {formatConfidence(recommendation?.confidence)} | Delta{" "}
                {formatScore(recommendation?.scoreDelta ?? null)}
              </p>
              <div className="command-center-reasons">
                {recommendation?.reasons?.length ? (
                  recommendation.reasons.slice(0, 3).map((reason) => (
                    <Badge key={reason} tone="accent">
                      {reason}
                    </Badge>
                  ))
                ) : (
                  <Badge>No active recommendation</Badge>
                )}
              </div>
              <p className="observer-command-muted">
                Backup targets:{" "}
                {recommendation?.backupTargetIds?.length
                  ? recommendation.backupTargetIds
                      .map((id) => targetLookup.get(id)?.label || id)
                      .join(", ")
                  : "--"}
              </p>
            </div>
          </div>

          <div className="command-center-inline-actions">
            {(() => {
              const acceptPath =
                recommendation &&
                recommendation.action !== "stay" &&
                recommendation.recommendedTargetId
                  ? observerCommandRoutes.acceptRecommendation(mapKey)
                  : null;
              const recommendedId = recommendation?.recommendedTargetId ?? null;
              const centerPath = recommendedId
                ? observerCommandRoutes.centerTarget(recommendedId, mapKey)
                : null;
              const watchPath = recommendedId
                ? observerCommandRoutes.watchNow(recommendedId, mapKey)
                : null;
              const pinPath = recommendedId
                ? observerCommandRoutes.pinTarget(recommendedId, mapKey)
                : null;
              const replayPath = recommendedId
                ? observerCommandRoutes.markReplay(recommendedId, mapKey)
                : null;

              return (
                <>
                  <InlineAction
                    label="Accept Recommendation"
                    tone="accent"
                    onClick={() => {
                      void execute(acceptPath);
                    }}
                    disabled={!acceptPath || isBusy(acceptPath)}
                  />
                  <InlineAction
                    label="Center Recommended"
                    onClick={() => {
                      void execute(centerPath);
                    }}
                    disabled={!centerPath || isBusy(centerPath)}
                  />
                  <InlineAction
                    label="Watch Recommended"
                    onClick={() => {
                      void execute(watchPath);
                    }}
                    disabled={!watchPath || isBusy(watchPath)}
                  />
                  <InlineAction
                    label="Pin Recommended"
                    onClick={() => {
                      void execute(pinPath);
                    }}
                    disabled={!pinPath || isBusy(pinPath)}
                  />
                  <InlineAction
                    label="Mark Recommended Replay"
                    onClick={() => {
                      void execute(replayPath);
                    }}
                    disabled={!replayPath || isBusy(replayPath)}
                  />
                </>
              );
            })()}
          </div>
        </section>

        <section className="observer-command-panel">
          <div className="observer-command-panel__heading">
            <div>
              <span className="observer-command-panel__kicker">Watch Queue</span>
              <h3>Top Targets</h3>
            </div>
            <Badge tone="accent">{snapshot.watchTargets.length} live</Badge>
          </div>

          {snapshot.watchTargets.length ? (
            <div className="command-center-list">
              {snapshot.watchTargets.map((target, index) => {
                const selectPath = observerCommandRoutes.selectTarget(target.id, mapKey);
                const watchPath = observerCommandRoutes.watchNow(target.id, mapKey);
                const pinPath = target.operatorPinned
                  ? observerCommandRoutes.unpinTarget(target.id, mapKey)
                  : observerCommandRoutes.pinTarget(target.id, mapKey);
                const replayPath = target.operatorReplayCandidate
                  ? observerCommandRoutes.removeReplay(target.id, mapKey)
                  : observerCommandRoutes.markReplay(target.id, mapKey);
                const suppressPath = target.operatorSuppressed
                  ? observerCommandRoutes.unsuppressTarget(target.id, mapKey)
                  : observerCommandRoutes.suppressTarget(target.id, mapKey);
                const centerPath = observerCommandRoutes.centerTarget(target.id, mapKey);
                const isSelected = workflowState?.selectedTargetId === target.id;

                return (
                  <article
                    key={target.id}
                    className={`command-center-item${isSelected ? " command-center-item--selected" : ""}`}
                  >
                    <div className="command-center-item__header">
                      <div>
                        <strong>
                          #{index + 1} {target.label}
                        </strong>
                        <p>
                          {target.category || "watch_target"} | {formatScore(target.score)} score |{" "}
                          {target.involvedTeamIds.join(", ") || "--"}
                        </p>
                      </div>
                      <div className="command-center-badges">
                        {target.operatorWatchingNow ? <Badge tone="success">Watched</Badge> : null}
                        {target.operatorPinned ? <Badge tone="accent">Pinned</Badge> : null}
                        {target.operatorSuppressed ? <Badge tone="warning">Suppressed</Badge> : null}
                        {target.operatorReplayCandidate ? <Badge tone="danger">Replay</Badge> : null}
                      </div>
                    </div>
                    <p className="observer-command-muted">
                      {target.reason.slice(0, 3).join(" | ") || "No scoring reasons."}
                    </p>
                    <div className="command-center-item__actions">
                      <InlineAction label="Select" onClick={() => void execute(selectPath)} disabled={isBusy(selectPath)} />
                      <InlineAction label="Watch" tone="accent" onClick={() => void execute(watchPath)} disabled={isBusy(watchPath)} />
                      <InlineAction
                        label={target.operatorPinned ? "Unpin" : "Pin"}
                        onClick={() => void execute(pinPath)}
                        disabled={isBusy(pinPath)}
                      />
                      <InlineAction
                        label={target.operatorReplayCandidate ? "Remove Replay" : "Replay"}
                        onClick={() => void execute(replayPath)}
                        disabled={isBusy(replayPath)}
                      />
                      <InlineAction
                        label={target.operatorSuppressed ? "Unsuppress" : "Suppress"}
                        onClick={() => void execute(suppressPath)}
                        disabled={isBusy(suppressPath)}
                      />
                      <InlineAction label="Center" onClick={() => void execute(centerPath)} disabled={isBusy(centerPath)} />
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">Watch targets will appear here when telemetry is live.</div>
          )}
        </section>

        <section className="observer-command-panel">
          <div className="observer-command-panel__heading">
            <div>
              <span className="observer-command-panel__kicker">Alerts</span>
              <h3>Active Alerts</h3>
            </div>
            <Badge tone={snapshot.alerts.length ? "warning" : "neutral"}>
              {snapshot.alerts.length} active
            </Badge>
          </div>

          {snapshot.alerts.length ? (
            <div className="command-center-list">
              {snapshot.alerts.map((alert) => {
                const selectPath = observerCommandRoutes.selectAlert(alert.id, mapKey);
                const dismissPath = observerCommandRoutes.dismissAlert(alert.id, mapKey);
                const replayPath = alert.operatorReplayCandidate
                  ? observerCommandRoutes.removeReplay(alert.id, mapKey)
                  : observerCommandRoutes.markReplay(alert.id, mapKey);
                const centerPath = hasCoordinates(alert)
                  ? observerCommandRoutes.centerAlert(alert.id, mapKey)
                  : null;
                const isSelected = workflowState?.selectedAlertId === alert.id;

                return (
                  <article
                    key={alert.id}
                    className={`command-center-item${isSelected ? " command-center-item--selected" : ""}`}
                  >
                    <div className="command-center-item__header">
                      <div>
                        <strong>{alert.label}</strong>
                        <p>
                          {alert.type} | {alert.severity} | {alert.involvedTeamIds.join(", ") || "--"}
                        </p>
                      </div>
                      <div className="command-center-badges">
                        <Badge
                          tone={
                            alert.severity === "critical"
                              ? "danger"
                              : alert.severity === "warning"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {alert.severity}
                        </Badge>
                        {alert.operatorReplayCandidate ? <Badge tone="accent">Replay</Badge> : null}
                      </div>
                    </div>
                    <p className="observer-command-muted">
                      Raised {formatRelativeTime(alert.createdAt)} | Expires in{" "}
                      {formatCountdown(alert.expiresAt)}
                    </p>
                    <div className="command-center-item__actions">
                      <InlineAction label="Select" onClick={() => void execute(selectPath)} disabled={isBusy(selectPath)} />
                      <InlineAction label="Dismiss" tone="danger" onClick={() => void execute(dismissPath)} disabled={isBusy(dismissPath)} />
                      <InlineAction
                        label={alert.operatorReplayCandidate ? "Remove Replay" : "Mark Replay"}
                        onClick={() => void execute(replayPath)}
                        disabled={isBusy(replayPath)}
                      />
                      <InlineAction
                        label="Center"
                        onClick={() => void execute(centerPath)}
                        disabled={!centerPath || isBusy(centerPath)}
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">No active production alerts.</div>
          )}
        </section>

        <section className="observer-command-panel">
          <div className="observer-command-panel__heading">
            <div>
              <span className="observer-command-panel__kicker">Replay Queue</span>
              <h3>Replay Candidates</h3>
            </div>
            <Badge tone="accent">{snapshot.replayCandidates.length} queued</Badge>
          </div>

          {snapshot.replayCandidates.length ? (
            <div className="command-center-list">
              {snapshot.replayCandidates.map((candidate) => {
                const removePath = observerCommandRoutes.removeReplay(candidate.id, mapKey);
                const centerPath = hasCoordinates(candidate)
                  ? observerCommandRoutes.centerReplay(candidate.id, mapKey)
                  : null;
                const promoteTarget = targetLookup.get(candidate.sourceId) ?? null;
                const watchPath = promoteTarget
                  ? observerCommandRoutes.watchNow(promoteTarget.id, mapKey)
                  : null;

                return (
                  <article key={candidate.id} className="command-center-item">
                    <div className="command-center-item__header">
                      <div>
                        <strong>{candidate.label}</strong>
                        <p>
                          {candidate.sourceType} | {candidate.involvedTeamIds.join(", ") || "--"}
                        </p>
                      </div>
                      <div className="command-center-badges">
                        <Badge tone="danger">Replay</Badge>
                      </div>
                    </div>
                    <p className="observer-command-muted">
                      Added {formatRelativeTime(candidate.createdAt)} | Expires in{" "}
                      {formatCountdown(candidate.expiresAt)}
                    </p>
                    <div className="command-center-item__actions">
                      <InlineAction label="Remove" tone="danger" onClick={() => void execute(removePath)} disabled={isBusy(removePath)} />
                      <InlineAction
                        label="Center"
                        onClick={() => void execute(centerPath)}
                        disabled={!centerPath || isBusy(centerPath)}
                      />
                      <InlineAction
                        label="Promote to Watch"
                        tone="accent"
                        onClick={() => void execute(watchPath)}
                        disabled={!watchPath || isBusy(watchPath)}
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">Replay-ready moments will accumulate here.</div>
          )}
        </section>

        <section className="observer-command-panel">
          <div className="observer-command-panel__heading">
            <div>
              <span className="observer-command-panel__kicker">Pins & Suppressions</span>
              <h3>Operator Overrides</h3>
            </div>
            <Badge>
              {(snapshot.pinState?.pinnedTeams.length || 0) +
                (snapshot.pinState?.pinnedTargets.length || 0)}{" "}
              pins
            </Badge>
          </div>

          <div className="command-center-stack">
            <div className="command-center-subsection">
              <span className="observer-command-label">Pinned teams</span>
              {(snapshot.pinState?.pinnedTeams.length ?? 0) ? (
                <div className="command-center-token-list">
                  {snapshot.pinState?.pinnedTeams.map((teamId) => {
                    const path = observerCommandRoutes.unpinTeam(teamId, mapKey);
                    return (
                      <div key={teamId} className="command-center-token">
                        <strong>{teamId}</strong>
                        <InlineAction label="Unpin" onClick={() => void execute(path)} disabled={isBusy(path)} />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="observer-command-muted">No pinned teams.</p>
              )}
            </div>

            <div className="command-center-subsection">
              <span className="observer-command-label">Pinned targets</span>
              {(snapshot.pinState?.pinnedTargets.length ?? 0) ? (
                <div className="command-center-token-list">
                  {snapshot.pinState?.pinnedTargets.map((target) => {
                    const path = observerCommandRoutes.unpinTarget(target.id, mapKey);
                    return (
                      <div key={target.id} className="command-center-token">
                        <strong>{target.label}</strong>
                        <InlineAction label="Unpin" onClick={() => void execute(path)} disabled={isBusy(path)} />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="observer-command-muted">No pinned targets.</p>
              )}
            </div>

            <div className="command-center-subsection">
              <span className="observer-command-label">Suppressed targets</span>
              {(snapshot.operatorDetails?.suppressedTargets.length ?? 0) ? (
                <div className="command-center-token-list">
                  {snapshot.operatorDetails?.suppressedTargets.map((target) => {
                    const path = observerCommandRoutes.unsuppressTarget(target.id, mapKey);
                    return (
                      <div key={target.id} className="command-center-token">
                        <strong>{target.label}</strong>
                        <InlineAction
                          label="Unsuppress"
                          onClick={() => void execute(path)}
                          disabled={isBusy(path)}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="observer-command-muted">No suppressed targets.</p>
              )}
            </div>

            <div className="command-center-subsection">
              <span className="observer-command-label">Dismissed alerts</span>
              {(snapshot.operatorDetails?.dismissedAlerts.length ?? 0) ? (
                <div className="command-center-token-list">
                  {snapshot.operatorDetails?.dismissedAlerts.map((alert) => {
                    const path = observerCommandRoutes.undismissAlert(alert.id, mapKey);
                    return (
                      <div key={alert.id} className="command-center-token">
                        <strong>{alert.label}</strong>
                        <InlineAction label="Restore" onClick={() => void execute(path)} disabled={isBusy(path)} />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="observer-command-muted">No dismissed alerts.</p>
              )}
            </div>
          </div>
        </section>

        <section className="observer-command-panel">
          <div className="observer-command-panel__heading">
            <div>
              <span className="observer-command-panel__kicker">Workflow Status</span>
              <h3>Selection & Quick Actions</h3>
            </div>
            <Badge tone={workflowState?.mapFocusUntil ? "accent" : "neutral"}>
              {workflowState?.mapFocusUntil ? "Focus active" : "Idle"}
            </Badge>
          </div>

          <div className="command-center-stack">
            <div className="command-center-focus-summary">
              <span className="observer-command-label">Selected target</span>
              <strong>{selectedTarget?.label || workflowState?.selectedTargetId || "--"}</strong>
              <div className="command-center-badges">
                {selectedTargetPinned ? <Badge tone="accent">Pinned</Badge> : null}
                {selectedTargetSuppressed ? <Badge tone="warning">Suppressed</Badge> : null}
                {selectedTargetReplay ? <Badge tone="danger">Replay</Badge> : null}
              </div>
            </div>

            <div className="command-center-inline-actions">
              {selectedTarget ? (
                <>
                  <InlineAction
                    label="Watch"
                    tone="accent"
                    onClick={() => void execute(observerCommandRoutes.watchNow(selectedTarget.id, mapKey))}
                  />
                  <InlineAction
                    label={selectedTargetPinned ? "Unpin" : "Pin"}
                    onClick={() =>
                      void execute(
                        selectedTargetPinned
                          ? observerCommandRoutes.unpinTarget(selectedTarget.id, mapKey)
                          : observerCommandRoutes.pinTarget(selectedTarget.id, mapKey),
                      )
                    }
                  />
                  <InlineAction
                    label={selectedTargetReplay ? "Remove Replay" : "Replay"}
                    onClick={() =>
                      void execute(
                        selectedTargetReplay
                          ? observerCommandRoutes.removeReplay(selectedTarget.id, mapKey)
                          : observerCommandRoutes.markReplay(selectedTarget.id, mapKey),
                      )
                    }
                  />
                  <InlineAction
                    label={selectedTargetSuppressed ? "Unsuppress" : "Suppress"}
                    onClick={() =>
                      void execute(
                        selectedTargetSuppressed
                          ? observerCommandRoutes.unsuppressTarget(selectedTarget.id, mapKey)
                          : observerCommandRoutes.suppressTarget(selectedTarget.id, mapKey),
                      )
                    }
                  />
                  <InlineAction
                    label="Center"
                    onClick={() => void execute(observerCommandRoutes.centerTarget(selectedTarget.id, mapKey))}
                  />
                </>
              ) : (
                <p className="observer-command-muted">Select a watch target to arm quick actions.</p>
              )}
            </div>

            <div className="command-center-focus-summary">
              <span className="observer-command-label">Selected alert</span>
              <strong>{selectedAlert?.label || workflowState?.selectedAlertId || "--"}</strong>
              <div className="command-center-badges">
                {selectedAlertReplay ? <Badge tone="danger">Replay</Badge> : null}
              </div>
            </div>

            <div className="command-center-inline-actions">
              {selectedAlert ? (
                <>
                  <InlineAction
                    label="Dismiss"
                    tone="danger"
                    onClick={() => void execute(observerCommandRoutes.dismissAlert(selectedAlert.id, mapKey))}
                  />
                  <InlineAction
                    label={selectedAlertReplay ? "Remove Replay" : "Mark Replay"}
                    onClick={() =>
                      void execute(
                        selectedAlertReplay
                          ? observerCommandRoutes.removeReplay(selectedAlert.id, mapKey)
                          : observerCommandRoutes.markReplay(selectedAlert.id, mapKey),
                      )
                    }
                  />
                  <InlineAction
                    label="Center"
                    onClick={() => void execute(observerCommandRoutes.centerAlert(selectedAlert.id, mapKey))}
                    disabled={!hasCoordinates(selectedAlert)}
                  />
                </>
              ) : (
                <p className="observer-command-muted">Select an alert to act on it directly.</p>
              )}
            </div>

            <div className="command-center-metadata">
              <div>
                <span>Highlighted target</span>
                <strong>{workflowState?.highlightedTargetId || "--"}</strong>
              </div>
              <div>
                <span>Map focus</span>
                <strong>
                  {workflowState?.mapFocusCenter
                    ? `${Math.round(workflowState.mapFocusCenter.x)}, ${Math.round(
                        workflowState.mapFocusCenter.y,
                      )}`
                    : "--"}
                </strong>
              </div>
              <div>
                <span>Focus expires</span>
                <strong>{formatCountdown(workflowState?.mapFocusUntil)}</strong>
              </div>
              <div>
                <span>Last action</span>
                <strong>{workflowState?.lastAction || "--"}</strong>
              </div>
            </div>
          </div>
        </section>
        </div>
      </fieldset>
        </>
      ) : (
        <div className="observer-command-center__collapsed">
          <div>
            <strong>Advanced operator console is hidden.</strong>
            <p>{collapsedSummary}</p>
          </div>
          <div className="observer-command-center__collapsed-badges">
            <Badge tone={snapshot.telemetry.connected ? "success" : "warning"}>
              {snapshot.telemetry.connected ? "Telemetry live" : "Telemetry idle"}
            </Badge>
            <Badge tone={snapshot.alerts.length ? "warning" : "neutral"}>
              {snapshot.alerts.length} alerts
            </Badge>
            <Badge tone="accent">{snapshot.watchTargets.length} watch targets</Badge>
          </div>
        </div>
      )}
    </section>
  );
}
