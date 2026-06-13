import { DesktopBrandLockup } from "./desktop-brand-lockup";
import { getWorkflowPresentation } from "../lib/launcher-ui";
import type {
  LauncherSession,
  LauncherWorkflowState,
} from "../types";

type DesktopSidebarProps = {
  session: LauncherSession;
  workflowState: LauncherWorkflowState;
  observerRunning: boolean;
  currentRoute: "desk" | "widgets";
  onNavigate: (route: "desk" | "widgets") => void;
  onLogout: () => void;
};

type IconProps = {
  className?: string;
};

function LogoutIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path
        d="M10 6.75H7.75A1.75 1.75 0 0 0 6 8.5v7A1.75 1.75 0 0 0 7.75 17.25H10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 8.5 18 12l-4 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18 12H9.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DeskIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path
        d="M4.75 6.75A2 2 0 0 1 6.75 4.75h10.5a2 2 0 0 1 2 2v10.5a2 2 0 0 1-2 2H6.75a2 2 0 0 1-2-2V6.75Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M4.75 10.25h14.5M10.25 4.75v14.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function WidgetsIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <rect x="4.75" y="4.75" width="5.5" height="5.5" rx="1.25" stroke="currentColor" strokeWidth="1.5" />
      <rect x="13.75" y="4.75" width="5.5" height="5.5" rx="1.25" stroke="currentColor" strokeWidth="1.5" />
      <rect x="4.75" y="13.75" width="5.5" height="5.5" rx="1.25" stroke="currentColor" strokeWidth="1.5" />
      <rect x="13.75" y="13.75" width="5.5" height="5.5" rx="1.25" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

const getUserDisplayName = (session: LauncherSession) => {
  const name = String(session.user.name || "").trim();
  if (name) {
    return name;
  }

  const email = String(session.user.email || "").trim();
  if (email) {
    const localPart = email.split("@")[0]?.trim();
    return localPart ? localPart.replace(/[._-]+/g, " ") : email;
  }

  return session.user.id;
};

const getInitials = (value: string | null | undefined, fallback: string) => {
  const parts = String(value || "")
    .trim()
    .split(/[\s._-]+/g)
    .filter(Boolean);

  if (!parts.length) {
    return fallback;
  }

  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
};

export function DesktopSidebar({
  session,
  workflowState,
  observerRunning,
  currentRoute,
  onNavigate,
  onLogout,
}: DesktopSidebarProps) {
  const workflow = getWorkflowPresentation(workflowState);
  const organizationLabel =
    session.organization?.name ||
    session.user.organizationId ||
    "Arenzyra";
  const userDisplayName = getUserDisplayName(session);

  return (
    <aside className="desktop-sidebar desktop-sidebar--rail">
      <div className="desktop-sidebar__rail-top">
        <DesktopBrandLockup
          size="sm"
          mode="mark"
          className="desktop-sidebar__rail-brand"
        />

        <div className="desktop-sidebar__status-stack" aria-label="Desk status">
          <span
            className={`desktop-sidebar__status-dot desktop-sidebar__status-dot--${workflow.tone}`}
            title={`Workflow: ${workflow.label}`}
          />
          <span
            className={`desktop-sidebar__status-dot desktop-sidebar__status-dot--${
              observerRunning ? "success" : "neutral"
            }`}
            title={`Observer: ${observerRunning ? "Running" : "Idle"}`}
          />
        </div>
      </div>

      <div className="desktop-sidebar__rail-nav" aria-label="Launcher pages">
        <button
          className={`desktop-sidebar__rail-nav-button${
            currentRoute === "desk" ? " is-active" : ""
          }`}
          onClick={() => onNavigate("desk")}
          type="button"
          aria-label="Open main desk"
          title="Main Desk"
        >
          <DeskIcon className="desktop-sidebar__icon-svg" />
        </button>
        <button
          className={`desktop-sidebar__rail-nav-button${
            currentRoute === "widgets" ? " is-active" : ""
          }`}
          onClick={() => onNavigate("widgets")}
          type="button"
          aria-label="Open widgets desk"
          title="Widgets Desk"
        >
          <WidgetsIcon className="desktop-sidebar__icon-svg" />
        </button>
      </div>

      <div className="desktop-sidebar__rail-meta">
        <span
          className="desktop-sidebar__rail-badge"
          title={organizationLabel}
        >
          {getInitials(organizationLabel, "AR")}
        </span>
        <span
          className="desktop-sidebar__rail-badge desktop-sidebar__rail-badge--user"
          title={userDisplayName}
        >
          {getInitials(userDisplayName, "OP")}
        </span>
      </div>

      <button
        className="desktop-sidebar__icon-button"
        onClick={onLogout}
        type="button"
        aria-label={`Logout ${userDisplayName}`}
        title={`Logout ${userDisplayName}`}
      >
        <LogoutIcon className="desktop-sidebar__icon-svg" />
      </button>
    </aside>
  );
}
