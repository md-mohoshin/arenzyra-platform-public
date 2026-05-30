import type { LauncherAccessState, LauncherSession } from "../types";
import { LauncherAccessScreen } from "./launcher-access-screen";

type ObserverLimitScreenProps = {
  session: LauncherSession;
  access: LauncherAccessState | null;
  busy: boolean;
  onRetry: () => void;
  onLogout: () => void;
};

export function ObserverLimitScreen(props: ObserverLimitScreenProps) {
  return (
    <LauncherAccessScreen
      title="Observer limit reached for this license."
      detail="This machine cannot start another observer session until one of the active launcher sessions ends."
      session={props.session}
      access={props.access}
      busy={props.busy}
      retryLabel="Retry observer slot"
      onRetry={props.onRetry}
      onLogout={props.onLogout}
    />
  );
}
