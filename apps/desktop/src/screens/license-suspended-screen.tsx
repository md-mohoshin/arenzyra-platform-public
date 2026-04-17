import type { LauncherAccessState, LauncherSession } from "../types";
import { LauncherAccessScreen } from "./launcher-access-screen";

type LicenseSuspendedScreenProps = {
  session: LauncherSession;
  access: LauncherAccessState | null;
  busy: boolean;
  onRetry: () => void;
  onLogout: () => void;
};

export function LicenseSuspendedScreen(props: LicenseSuspendedScreenProps) {
  return (
    <LauncherAccessScreen
      title="Your Arenzyra production license is suspended."
      detail="Launcher access is blocked for this organization. Contact Arenzyra support before starting production."
      session={props.session}
      access={props.access}
      busy={props.busy}
      onRetry={props.onRetry}
      onLogout={props.onLogout}
    />
  );
}
