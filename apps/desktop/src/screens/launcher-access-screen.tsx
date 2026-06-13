import type {
  LauncherAccessState,
  LauncherSession,
} from "../types";
import { DesktopBrandLockup } from "../components/desktop-brand-lockup";

type LauncherAccessScreenProps = {
  title: string;
  detail: string;
  session: LauncherSession;
  access: LauncherAccessState | null;
  busy: boolean;
  retryLabel?: string;
  onRetry: () => void;
  onLogout: () => void;
};

export function LauncherAccessScreen(props: LauncherAccessScreenProps) {
  const license = props.access?.license ?? null;

  return (
    <div className="login-shell">
      <section className="access-card">
        <div className="access-copy">
          <DesktopBrandLockup
            size="sm"
            subtitle="Observer launcher access is verified before live production can start."
          />
          <h1>{props.title}</h1>
          <p>{props.detail}</p>

          <div className="status-card status-card--error">
            <strong>Organizer session</strong>
            <p>
              Signed in as {props.session.user.email || props.session.user.id}
              {props.session.organization?.name
                ? ` for ${props.session.organization.name}.`
                : "."}
            </p>
          </div>

          <div className="access-actions">
            <button
              className="primary-button"
              onClick={props.onRetry}
              disabled={props.busy}
            >
              {props.busy ? "Checking access..." : props.retryLabel || "Retry access"}
            </button>
            <button
              className="secondary-button"
              onClick={props.onLogout}
              disabled={props.busy}
            >
              Logout
            </button>
          </div>
        </div>

        <div className="access-meta">
          <div className="status-card status-card--neutral">
            <strong>Arenzyra Access</strong>
            <div className="license-stats">
              <div className="license-stat">
                <span>Type</span>
                <strong>{license?.type || "--"}</strong>
              </div>
              <div className="license-stat">
                <span>Status</span>
                <strong>{license?.status || props.access?.reason || "--"}</strong>
              </div>
              <div className="license-stat">
                <span>Observers Allowed</span>
                <strong>{license?.maxObservers ?? props.access?.maxObservers ?? "--"}</strong>
              </div>
            </div>
          </div>

          {props.access?.reason === "OBSERVER_LIMIT_REACHED" ? (
            <div className="status-card status-card--error">
              <strong>Observer limit reached</strong>
              <p>
                Active observers: {props.access.activeSessions ?? "--"} /{" "}
                {props.access.maxObservers ?? license?.maxObservers ?? "--"}
              </p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
