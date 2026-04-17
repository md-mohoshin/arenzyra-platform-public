import { WinnerWidget } from "@/components/widgets/live-widgets";
import { WidgetRouteShell } from "@/components/widgets/widget-route-shell";

export default function WinnerWidgetPage() {
  return (
    <WidgetRouteShell>
      <WinnerWidget />
    </WidgetRouteShell>
  );
}
