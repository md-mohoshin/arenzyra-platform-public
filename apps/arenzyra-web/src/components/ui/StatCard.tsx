"use client";

type StatCardProps = {
  label: string;
  value: string | number;
  subtext?: string;
};

export function StatCard({ label, value, subtext }: StatCardProps) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-white/60">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {subtext ? <div className="text-white/60 text-xs mt-1">{subtext}</div> : null}
    </div>
  );
}
