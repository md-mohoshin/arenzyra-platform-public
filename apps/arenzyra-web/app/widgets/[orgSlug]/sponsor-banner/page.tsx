import { SponsorBannerOrgWidget } from "@/components/widgets/organizer-widgets";
import { WidgetRouteShell } from "@/components/widgets/widget-route-shell";

type SponsorBannerWidgetPageProps = {
  params: Promise<{
    orgSlug: string;
  }>;
};

export default async function SponsorBannerWidgetPage({
  params,
}: SponsorBannerWidgetPageProps) {
  const { orgSlug } = await params;

  return (
    <WidgetRouteShell>
      <SponsorBannerOrgWidget orgSlug={orgSlug} />
    </WidgetRouteShell>
  );
}
