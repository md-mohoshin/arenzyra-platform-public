import { NextMatchOrgWidget } from "@/components/widgets/organizer-widgets";
import { WidgetRouteShell } from "@/components/widgets/widget-route-shell";

type NextMatchWidgetPageProps = {
  params: Promise<{
    orgSlug: string;
  }>;
};

export default async function NextMatchWidgetPage({
  params,
}: NextMatchWidgetPageProps) {
  const { orgSlug } = await params;

  return (
    <WidgetRouteShell>
      <NextMatchOrgWidget orgSlug={orgSlug} />
    </WidgetRouteShell>
  );
}
