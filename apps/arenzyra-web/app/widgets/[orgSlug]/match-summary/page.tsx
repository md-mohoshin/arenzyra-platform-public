import { MatchSummaryOrgWidget } from "@/components/widgets/organizer-widgets";
import { WidgetRouteShell } from "@/components/widgets/widget-route-shell";

type MatchSummaryWidgetPageProps = {
  params: Promise<{
    orgSlug: string;
  }>;
};

export default async function MatchSummaryWidgetPage({
  params,
}: MatchSummaryWidgetPageProps) {
  const { orgSlug } = await params;

  return (
    <WidgetRouteShell>
      <MatchSummaryOrgWidget orgSlug={orgSlug} />
    </WidgetRouteShell>
  );
}
