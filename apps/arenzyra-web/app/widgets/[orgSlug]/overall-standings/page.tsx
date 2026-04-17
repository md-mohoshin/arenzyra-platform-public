import { OverallStandingsOrgWidget } from "@/components/widgets/organizer-widgets";
import { WidgetRouteShell } from "@/components/widgets/widget-route-shell";

type OverallStandingsWidgetPageProps = {
  params: Promise<{
    orgSlug: string;
  }>;
};

export default async function OverallStandingsWidgetPage({
  params,
}: OverallStandingsWidgetPageProps) {
  const { orgSlug } = await params;

  return (
    <WidgetRouteShell>
      <OverallStandingsOrgWidget orgSlug={orgSlug} />
    </WidgetRouteShell>
  );
}
