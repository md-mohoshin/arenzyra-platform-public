"use client";

import { PlayerPhotoWidget } from "@/components/widgets/live-widgets";
import { WidgetRouteShell } from "@/components/widgets/widget-route-shell";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export default function PlayerPhotoWidgetPage() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: Number.POSITIVE_INFINITY,
            refetchOnMount: false,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <WidgetRouteShell>
        <PlayerPhotoWidget />
      </WidgetRouteShell>
    </QueryClientProvider>
  );
}
