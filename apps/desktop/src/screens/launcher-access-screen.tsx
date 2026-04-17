import type {
  LauncherAccessState,
  LauncherSession,
} from "../types";

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

export function LauncherAccessScreen(props: LauncherAccessScreenProps) {
  const license = props.access?.license ?? null;

  return (
    <div className="login-shell">
      <section className="access-card">
        <div className="access-copy">
          <span className="eyebrow">Arenzyra Observer Launcher</span>
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
            <strong>Arenzyra License</strong>
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
                <span>Expires</span>
                <strong>{formatDate(license?.expiresAt)}</strong>
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
