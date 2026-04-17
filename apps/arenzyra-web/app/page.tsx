"use client";

import type { CSSProperties } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { CTA } from "@/components/landing/CTA";
import { Features } from "@/components/landing/Features";
import { Footer } from "@/components/landing/Footer";
import { Hero } from "@/components/landing/Hero";
import { Navbar } from "@/components/landing/Navbar";
import { Preview } from "@/components/landing/Preview";
import { ProductionTools } from "@/components/landing/ProductionTools";
import { useAuth } from "@/context/AuthContext";
import { buildBrandingCssVars, DEFAULT_BRANDING_STATE } from "@/lib/branding";
import type { AuthUser } from "@/types/arenzyra";

const landingStyles = {
  ...buildBrandingCssVars(DEFAULT_BRANDING_STATE),
  background: "#05070a",
  color: "var(--vx-text)",
} as CSSProperties;

export default function LandingPage() {
  const { user } = useAuth();
  const router = useRouter();
  const effectiveRole =
    user && "actingRole" in user
      ? (user as AuthUser).actingRole ?? user.role
      : user?.role;

  useEffect(() => {
    if (!effectiveRole) return;
    const canAccessOrganizer =
      effectiveRole === "ORGANIZER" || effectiveRole === "ADMIN";

    if (effectiveRole === "SUPER_ADMIN") {
      router.replace("/super-admin");
      return;
    }

    if (canAccessOrganizer) {
      router.replace("/organizer");
    }
  }, [effectiveRole, router]);

  return (
    <div style={landingStyles} className="min-h-screen font-sans text-white">
      <Navbar />
      <main>
        <Hero />
        <Features />
        <Preview />
        <ProductionTools />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
