import React from "react";

type Props = {
  open: boolean;
  title: string;
  description: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
  loading?: boolean;
  confirmLabel?: string;
  loadingLabel?: string;
  tone?: "danger" | "success";
};

const ConfirmDeleteModal: React.FC<Props> = ({
  open,
  title,
  description,
  onConfirm,
  onClose,
  loading = false,
  confirmLabel = "Delete",
  loadingLabel = "Deleting...",
  tone = "danger",
}) => {
  if (!open) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (loading) return;
    if (e.target === e.currentTarget) onClose();
  };

  const confirmButtonClass =
    tone === "success"
      ? "rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
      : "rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity duration-200"
      onClick={handleBackdropClick}
    >
      <div className="mx-4 w-full max-w-md transform rounded-xl bg-slate-900/95 p-6 shadow-2xl ring-1 ring-white/10 transition-all duration-200">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <p className="text-sm text-slate-200/80">{description}</p>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={confirmButtonClass}
          >
            {loading ? loadingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDeleteModal;
