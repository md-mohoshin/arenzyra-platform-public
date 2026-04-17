"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building,
  Bot,
  FileText,
  Home,
  LayoutGrid,
  Link2,
  type LucideIcon,
  Settings,
  Shield,
  Swords,
  Trophy,
  Users,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import type { AuthUser } from "@/types/arenzyra";

type NavItem = {
  href: string;
  label: string;
  icon?: LucideIcon;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const superAdminSections: NavSection[] = [
  {
    title: "MAIN",
    items: [{ href: "/super-admin", label: "Dashboard", icon: Home }],
  },
  {
    title: "MANAGEMENT",
    items: [
      { href: "/super-admin/applications", label: "Applications", icon: FileText },
      { href: "/super-admin/discord", label: "Discord", icon: Bot },
      { href: "/super-admin/organizations", label: "Organizations", icon: Building },
      { href: "/super-admin/users", label: "Users", icon: Users },
    ],
  },
];

const organizerSections: NavSection[] = [
  {
    title: "OPERATIONS",
    items: [
      { href: "/organizer", label: "Dashboard", icon: Home },
      { href: "/organizer/tournaments", label: "Tournaments", icon: Trophy },
      { href: "/organizer/matches", label: "Matches", icon: Swords },
      { href: "/organizer/teams", label: "Teams", icon: Users },
      { href: "/organizer/branding", label: "Branding", icon: Shield },
      { href: "/organizer/widgets", label: "Widgets", icon: LayoutGrid },
      { href: "/organizer/live-mapping", label: "Live Mapping", icon: Link2 },
      { href: "/organizer/discord", label: "Discord", icon: Bot },
      { href: "/organizer/settings", label: "Settings", icon: Settings },
    ],
  },
];

type ActingUser = AuthUser & { actingRole?: AuthUser["role"] | null };

export function Sidebar() {
  const { user } = useAuth();
  const pathname = usePathname();
  const effectiveRole =
    user && "actingRole" in user
      ? (user as ActingUser).actingRole ?? user?.role
      : user?.role;
  const sections =
    effectiveRole === "SUPER_ADMIN" ? superAdminSections : organizerSections;

  return (
    <aside className="min-h-screen w-64 border-r border-white/10 bg-black">
      <div className="border-b border-white/10 px-6 py-6">
        <div className="text-xl font-bold tracking-[0.24em] text-white">Arenzyra</div>
        <div className="mt-2 text-xs uppercase tracking-[0.22em] text-white/40">
          {effectiveRole === "SUPER_ADMIN" ? "Admin Control" : "Organizer Space"}
        </div>
      </div>

      <nav className="space-y-8 px-4 py-6 text-sm">
        {sections.map((section) => (
          <div key={section.title} className="space-y-3">
            <div className="px-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-white/35">
              {section.title}
            </div>

            <div className="space-y-1">
              {section.items.map((item) => {
                const isActive =
                  item.href === "/super-admin" || item.href === "/organizer"
                    ? pathname === item.href
                    : pathname?.startsWith(item.href);
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 border-l-2 px-4 py-3 transition ${
                      isActive
                        ? "border-cyan-400 bg-white/5 font-semibold text-white"
                        : "border-transparent text-white/65 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
