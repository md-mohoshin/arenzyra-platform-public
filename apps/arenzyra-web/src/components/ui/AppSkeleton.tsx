"use client";

export function AppSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, idx) => (
        <div
          key={idx}
          className="h-4 w-full animate-pulse rounded bg-white/10"
        />
      ))}
    </div>
  );
}
