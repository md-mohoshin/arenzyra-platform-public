import type { LauncherSession } from "../types";

export type DesktopPage = "launcher" | "widgets";

type DesktopSidebarProps = {
  activePage: DesktopPage;
  session: LauncherSession;
  onPageChange: (page: DesktopPage) => void;
  onLogout: () => void;
};

const navigationItems: Array<{
  id: DesktopPage;
  label: string;
  description: string;
}> = [
  {
    id: "launcher",
    label: "Launcher",
    description: "Match setup, branding, telemetry, and operator tools.",
  },
  {
    id: "widgets",
    label: "Widgets",
    description: "Preview OBS browser sources and copy widget URLs.",
  },
];

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

export function DesktopSidebar({
  activePage,
  session,
  onPageChange,
  onLogout,
}: DesktopSidebarProps) {
  const userDisplayName = getUserDisplayName(session);
  const userTitle = session.user.email || session.user.id;
  const organizationLabel =
    session.organization?.name ||
    session.user.organizationId ||
    "Organization unavailable";

  return (
    <aside className="desktop-sidebar">
      <div className="desktop-sidebar__brand">
        <span className="desktop-sidebar__eyebrow">Arenzyra Desktop</span>
        <strong>Observer Operations</strong>
        <p>Authenticated production tools for launcher and local OBS widgets.</p>
      </div>

      <nav className="desktop-sidebar__nav" aria-label="Desktop navigation">
        {navigationItems.map((item) => {
          const isActive = item.id === activePage;
          return (
            <button
              key={item.id}
              className={`desktop-sidebar__nav-item${isActive ? " is-active" : ""}`}
              onClick={() => onPageChange(item.id)}
              type="button"
            >
              <span>{item.label}</span>
              <small>{item.description}</small>
            </button>
          );
        })}
      </nav>

      <div className="desktop-sidebar__footer">
        <div className="desktop-sidebar__session">
          <span>Signed in as</span>
          <strong title={userTitle}>{userDisplayName}</strong>
          <small title={organizationLabel}>{organizationLabel}</small>
        </div>
        <button className="secondary-button desktop-sidebar__logout" onClick={onLogout} type="button">
          Logout
        </button>
      </div>
    </aside>
  );
}
