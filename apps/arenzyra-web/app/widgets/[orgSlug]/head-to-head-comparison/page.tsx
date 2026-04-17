import { HeadToHeadComparisonOrgWidget } from "@/components/widgets/organizer-widgets";
import { WidgetRouteShell } from "@/components/widgets/widget-route-shell";

type HeadToHeadComparisonWidgetPageProps = {
  params: Promise<{
    orgSlug: string;
  }>;
};

export default async function HeadToHeadComparisonWidgetPage({
  params,
}: HeadToHeadComparisonWidgetPageProps) {
  const { orgSlug } = await params;

  return (
    <WidgetRouteShell>
      <HeadToHeadComparisonOrgWidget orgSlug={orgSlug} />
    </WidgetRouteShell>
  );
}
