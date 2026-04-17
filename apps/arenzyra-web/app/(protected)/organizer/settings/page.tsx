"use client";

import { useRouter } from "next/navigation";

export default function OrganizerSettingsPage() {
  const router = useRouter();

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/organizer");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-white">Settings</h1>
          <p className="text-sm text-white/60">Coming soon.</p>
        </div>
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-slate-950/65 px-5 py-3 text-sm font-medium text-cyan-50/90 transition hover:border-cyan-300/40 hover:bg-cyan-500/10 hover:text-white"
        >
          &larr; Back
        </button>
      </div>
    </div>
  );
}
