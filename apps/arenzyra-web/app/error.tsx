"use client";

import { AppError } from "@/components/ui/AppError";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-black text-white p-6">
      <AppError message={error.message || "Something went wrong"} onRetry={reset} />
    </div>
  );
}
