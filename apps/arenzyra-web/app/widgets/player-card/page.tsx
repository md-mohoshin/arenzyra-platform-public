import { PlayerCardWidget } from "@/components/widgets/live-widgets";
import { WidgetRouteShell } from "@/components/widgets/widget-route-shell";

export default function PlayerCardWidgetPage() {
  return (
    <WidgetRouteShell>
      <PlayerCardWidget />
    </WidgetRouteShell>
  );
}
