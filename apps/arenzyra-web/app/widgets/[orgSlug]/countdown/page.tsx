import { CountdownOrgWidget } from "@/components/widgets/organizer-widgets";
import { WidgetRouteShell } from "@/components/widgets/widget-route-shell";

type CountdownWidgetPageProps = {
  params: Promise<{
    orgSlug: string;
  }>;
};

export default async function CountdownWidgetPage({
  params,
}: CountdownWidgetPageProps) {
  const { orgSlug } = await params;

  return (
    <WidgetRouteShell>
      <CountdownOrgWidget orgSlug={orgSlug} />
    </WidgetRouteShell>
  );
}
