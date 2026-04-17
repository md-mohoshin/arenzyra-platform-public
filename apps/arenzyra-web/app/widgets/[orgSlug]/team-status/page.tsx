import { TeamStatusOrgWidget } from "@/components/widgets/organizer-widgets";
import { WidgetRouteShell } from "@/components/widgets/widget-route-shell";

type TeamStatusWidgetPageProps = {
  params: Promise<{
    orgSlug: string;
  }>;
};

export default async function TeamStatusWidgetPage({
  params,
}: TeamStatusWidgetPageProps) {
  const { orgSlug } = await params;

  return (
    <WidgetRouteShell>
      <TeamStatusOrgWidget orgSlug={orgSlug} />
    </WidgetRouteShell>
  );
}
