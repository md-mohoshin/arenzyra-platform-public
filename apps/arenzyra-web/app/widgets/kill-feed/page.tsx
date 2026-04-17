import { KillFeedWidget } from "@/components/widgets/live-widgets";
import { WidgetRouteShell } from "@/components/widgets/widget-route-shell";

export default function KillFeedWidgetPage() {
  return (
    <WidgetRouteShell>
      <KillFeedWidget />
    </WidgetRouteShell>
  );
}
