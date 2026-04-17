import { TeamsLineupOrgWidget } from "@/components/widgets/organizer-widgets";
import { WidgetRouteShell } from "@/components/widgets/widget-route-shell";

type TeamsLineupWidgetPageProps = {
  params: Promise<{
    orgSlug: string;
  }>;
};

export default async function TeamsLineupWidgetPage({
  params,
}: TeamsLineupWidgetPageProps) {
  const { orgSlug } = await params;

  return (
    <WidgetRouteShell>
      <TeamsLineupOrgWidget orgSlug={orgSlug} />
    </WidgetRouteShell>
  );
}
