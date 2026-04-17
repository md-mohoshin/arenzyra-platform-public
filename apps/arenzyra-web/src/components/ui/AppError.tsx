"use client";

type Props = {
  message: string;
  statusCode?: number;
  onRetry?: () => void;
};

export function AppError({ message, statusCode, onRetry }: Props) {
  return (
    <div className="rounded border border-red-500/30 bg-red-500/5 p-4 text-red-300">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-semibold">
            {statusCode ? `Error ${statusCode}: ` : "Error: "}
            {message}
          </p>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded bg-red-500 px-3 py-1 text-sm font-medium text-white hover:bg-red-600"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
