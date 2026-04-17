"use client";

import { OrganizerWidgetDetailPage } from "@/components/widgets/organizer-widget-detail-page";
import { useParams } from "next/navigation";

export default function OrganizerWidgetDetailRoute() {
  const params = useParams<{ widgetKey: string }>();

  return <OrganizerWidgetDetailPage widgetKey={params.widgetKey} />;
}
