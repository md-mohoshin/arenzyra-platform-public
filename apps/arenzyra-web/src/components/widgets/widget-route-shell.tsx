"use client";

import type { ReactNode } from "react";
import { Suspense, useEffect } from "react";

function WidgetRouteFallback() {
  return <main className="h-[100dvh] w-screen overflow-hidden bg-transparent" />;
}

function WidgetViewport({ children }: { children: ReactNode }) {
  useEffect(() => {
    const previousHtmlBackground = document.documentElement.style.background;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyBackground = document.body.style.background;
    const previousBodyOverflow = document.body.style.overflow;

    document.documentElement.style.background = "transparent";
    document.documentElement.style.overflow = "hidden";
    document.body.style.background = "transparent";
    document.body.style.overflow = "hidden";

    return () => {
      document.documentElement.style.background = previousHtmlBackground;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.background = previousBodyBackground;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);

  return (
    <div className="relative h-[100dvh] w-screen overflow-hidden bg-transparent">
      {children}
    </div>
  );
}

export function WidgetRouteShell({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<WidgetRouteFallback />}>
      <WidgetViewport>{children}</WidgetViewport>
    </Suspense>
  );
}
