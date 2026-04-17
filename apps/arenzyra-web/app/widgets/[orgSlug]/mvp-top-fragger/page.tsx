import { MvpTopFraggerOrgWidget } from "@/components/widgets/organizer-widgets";
import { WidgetRouteShell } from "@/components/widgets/widget-route-shell";

type MvpTopFraggerWidgetPageProps = {
  params: Promise<{
    orgSlug: string;
  }>;
};

export default async function MvpTopFraggerWidgetPage({
  params,
}: MvpTopFraggerWidgetPageProps) {
  const { orgSlug } = await params;

  return (
    <WidgetRouteShell>
      <MvpTopFraggerOrgWidget orgSlug={orgSlug} />
    </WidgetRouteShell>
  );
}
