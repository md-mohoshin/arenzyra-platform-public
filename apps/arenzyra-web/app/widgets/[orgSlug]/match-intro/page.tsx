import { MatchIntroOrgWidget } from "@/components/widgets/organizer-widgets";
import { WidgetRouteShell } from "@/components/widgets/widget-route-shell";

type MatchIntroWidgetPageProps = {
  params: Promise<{
    orgSlug: string;
  }>;
};

export default async function MatchIntroWidgetPage({
  params,
}: MatchIntroWidgetPageProps) {
  const { orgSlug } = await params;

  return (
    <WidgetRouteShell>
      <MatchIntroOrgWidget orgSlug={orgSlug} />
    </WidgetRouteShell>
  );
}
