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
  const isMissing = props.access?.reason === "LICENSE_MISSING";

  return (
    <LauncherAccessScreen
      title={
        isMissing
          ? "No production license assigned."
          : "Your Arenzyra production license has expired."
      }
      detail={
        isMissing
          ? "This organizer account does not have an active Arenzyra production license. Please contact Arenzyra support."
          : "Please contact Arenzyra support to renew the license before starting production."
      }
      session={props.session}
      access={props.access}
      busy={props.busy}
      onRetry={props.onRetry}
      onLogout={props.onLogout}
    />
  );
}
