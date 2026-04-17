import { MapCardOrgWidget } from "@/components/widgets/organizer-widgets";
import { WidgetRouteShell } from "@/components/widgets/widget-route-shell";

type MapCardWidgetPageProps = {
  params: Promise<{
    orgSlug: string;
  }>;
};

export default async function MapCardWidgetPage({
  params,
}: MapCardWidgetPageProps) {
  const { orgSlug } = await params;

  return (
    <WidgetRouteShell>
      <MapCardOrgWidget orgSlug={orgSlug} />
    </WidgetRouteShell>
  );
}
