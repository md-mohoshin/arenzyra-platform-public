import { MatchResultsOrgWidget } from "@/components/widgets/organizer-widgets";
import { WidgetRouteShell } from "@/components/widgets/widget-route-shell";

type MatchResultsWidgetPageProps = {
  params: Promise<{
    orgSlug: string;
  }>;
};

export default async function MatchResultsWidgetPage({
  params,
}: MatchResultsWidgetPageProps) {
  const { orgSlug } = await params;

  return (
    <WidgetRouteShell>
      <MatchResultsOrgWidget orgSlug={orgSlug} />
    </WidgetRouteShell>
  );
}
