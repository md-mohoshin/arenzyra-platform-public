import { WinnerCelebrationOrgWidget } from "@/components/widgets/organizer-widgets";
import { WidgetRouteShell } from "@/components/widgets/widget-route-shell";

type WinnerCelebrationWidgetPageProps = {
  params: Promise<{
    orgSlug: string;
  }>;
};

export default async function WinnerCelebrationWidgetPage({
  params,
}: WinnerCelebrationWidgetPageProps) {
  const { orgSlug } = await params;

  return (
    <WidgetRouteShell>
      <WinnerCelebrationOrgWidget orgSlug={orgSlug} />
    </WidgetRouteShell>
  );
}
