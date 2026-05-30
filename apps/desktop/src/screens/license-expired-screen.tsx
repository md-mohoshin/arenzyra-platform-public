import type { LauncherAccessState, LauncherSession } from "../types";
import { LauncherAccessScreen } from "./launcher-access-screen";

type LicenseExpiredScreenProps = {
  session: LauncherSession;
  access: LauncherAccessState | null;
  busy: boolean;
  onRetry: () => void;
  onLogout: () => void;
};

export function LicenseExpiredScreen(props: LicenseExpiredScreenProps) {
  const reason = props.access?.reason;
  const copy =
    reason === "LAUNCHER_PLAN_REQUIRED"
      ? {
          title: "Launcher plan required.",
          detail:
            "This organization is not on the launcher plan. Contact Arenzyra support before starting production.",
        }
      : reason === "SUBSCRIPTION_EXPIRED"
        ? {
            title: "Subscription expired.",
            detail:
              "Launcher access is blocked until this organization's subscription or trial is active again.",
          }
        : reason === "LICENSE_MISSING"
          ? {
              title: "Launcher access blocked.",
              detail:
                "Launcher access is not available for this organization. Please contact Arenzyra support.",
            }
          : {
              title: "Launcher access blocked.",
              detail:
                "Please contact Arenzyra support before starting production.",
            };

  return (
    <LauncherAccessScreen
      title={copy.title}
      detail={copy.detail}
      session={props.session}
      access={props.access}
      busy={props.busy}
      onRetry={props.onRetry}
      onLogout={props.onLogout}
    />
  );
}
