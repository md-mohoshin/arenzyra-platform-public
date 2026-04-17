import { NextMatchBreakOrgWidget } from "@/components/widgets/organizer-widgets";
import { WidgetRouteShell } from "@/components/widgets/widget-route-shell";

type NextMatchBreakWidgetPageProps = {
  params: Promise<{
    orgSlug: string;
  }>;
};

export default async function NextMatchBreakWidgetPage({
  params,
}: NextMatchBreakWidgetPageProps) {
  const { orgSlug } = await params;

  return (
    <WidgetRouteShell>
      <NextMatchBreakOrgWidget orgSlug={orgSlug} />
    </WidgetRouteShell>
  );
}
