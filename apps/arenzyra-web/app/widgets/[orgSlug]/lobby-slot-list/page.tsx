import { LobbySlotListOrgWidget } from "@/components/widgets/organizer-widgets";
import { WidgetRouteShell } from "@/components/widgets/widget-route-shell";

type LobbySlotListWidgetPageProps = {
  params: Promise<{
    orgSlug: string;
  }>;
};

export default async function LobbySlotListWidgetPage({
  params,
}: LobbySlotListWidgetPageProps) {
  const { orgSlug } = await params;

  return (
    <WidgetRouteShell>
      <LobbySlotListOrgWidget orgSlug={orgSlug} />
    </WidgetRouteShell>
  );
}
