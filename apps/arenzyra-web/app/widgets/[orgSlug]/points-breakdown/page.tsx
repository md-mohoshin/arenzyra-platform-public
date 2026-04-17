import { PointsBreakdownOrgWidget } from "@/components/widgets/organizer-widgets";
import { WidgetRouteShell } from "@/components/widgets/widget-route-shell";

type PointsBreakdownWidgetPageProps = {
  params: Promise<{
    orgSlug: string;
  }>;
};

export default async function PointsBreakdownWidgetPage({
  params,
}: PointsBreakdownWidgetPageProps) {
  const { orgSlug } = await params;

  return (
    <WidgetRouteShell>
      <PointsBreakdownOrgWidget orgSlug={orgSlug} />
    </WidgetRouteShell>
  );
}
