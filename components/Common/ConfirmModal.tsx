"use client";

export default function ConfirmModal({
  open,
  title,
  message,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  busy = false,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[160] grid place-items-center bg-black/75 p-4 backdrop-blur-md" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
      <button aria-label={cancelText} className="absolute inset-0 cursor-default" onClick={onCancel} disabled={busy} />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-red-400/20 bg-[#0b0b10] shadow-[0_30px_100px_rgba(0,0,0,.75)]">
        <div className="border-b border-white/5 px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-red-400/20 bg-red-400/10 text-lg text-red-300">!</span>
            <div>
              <h2 id="confirm-title" className="text-lg font-black text-white">{title}</h2>
              <p className="mt-1 text-xs text-zinc-500">DuelPlay · {confirmText}</p>
            </div>
          </div>
        </div>
        <div className="px-6 py-6">
          <p className="text-sm leading-6 text-zinc-300">{message}</p>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button type="button" disabled={busy} onClick={onCancel} className="rounded-xl border border-white/10 bg-white/[.03] px-4 py-3 text-sm font-bold text-zinc-300 transition hover:border-white/20 hover:text-white disabled:opacity-50">{cancelText}</button>
            <button type="button" disabled={busy} onClick={onConfirm} className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-black text-red-300 transition hover:bg-red-500/20 disabled:opacity-50">{busy ? "…" : confirmText}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
