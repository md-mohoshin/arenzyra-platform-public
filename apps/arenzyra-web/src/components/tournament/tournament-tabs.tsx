"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";

export default function TournamentTabs() {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();

  const tabs = [
    { label: "Overview", path: "" },
    { label: "Teams", path: "/teams" },
    { label: "Registrations", path: "/registrations" },
    { label: "Stages", path: "/stages" },
    { label: "Matches", path: "/matches" },
    { label: "Sponsors", path: "/sponsors" },
    { label: "Settings", path: "/settings" },
  ];

  return (
    <div className="mb-6 flex flex-wrap gap-3 border-b border-white/10 pb-4">
      {tabs.map((tab) => {
        const href = `/organizer/tournaments/${id}${tab.path}`;
        const active =
          tab.path === ""
            ? pathname === href
            : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={tab.label}
            href={href}
            className={`rounded-xl px-4 py-2.5 text-sm font-medium transition ${
              active
                ? "border border-cyan-400/20 bg-cyan-500/15 text-cyan-300"
                : "border border-transparent text-gray-400 hover:border-white/10 hover:bg-white/5 hover:text-white"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
