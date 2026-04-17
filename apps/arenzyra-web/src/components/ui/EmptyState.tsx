"use client";

import Link from "next/link";

type EmptyStateProps = {
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  secondary?: React.ReactNode;
};

export function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  secondary,
}: EmptyStateProps) {
  return (
    <div className="border border-dashed border-white/20 rounded-lg p-6 text-center space-y-2 bg-black/40">
      <h3 className="text-lg font-semibold">{title}</h3>
      {description && <p className="text-white/60 text-sm">{description}</p>}
      <div className="flex justify-center gap-3 pt-2">
        {actionLabel ? (
          actionHref ? (
            <Link
              href={actionHref}
              className="inline-flex items-center gap-2 rounded bg-white/10 px-4 py-2 text-sm hover:bg-white/15"
            >
              {actionLabel}
            </Link>
          ) : (
            <button
              className="inline-flex items-center gap-2 rounded bg-white/10 px-4 py-2 text-sm hover:bg-white/15"
              onClick={onAction}
            >
              {actionLabel}
            </button>
          )
        ) : null}
        {secondary}
      </div>
    </div>
  );
}
