"use client";

import type { ReactNode } from "react";
import TournamentTabs from "@/components/tournament/tournament-tabs";

export default function TournamentLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-8">
      <TournamentTabs />
      {children}
    </div>
  );
}
