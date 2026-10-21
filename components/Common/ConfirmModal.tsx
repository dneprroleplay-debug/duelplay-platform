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
  tone = "danger",
}: {
  open: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  tone?: "danger" | "default";
}) {
  if (!open) return null;
  const danger = tone === "danger";
  return (
    <div className="fixed inset-0 z-[160] grid place-items-center bg-black/75 p-4 backdrop-blur-md" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-busy={busy}>
      <button aria-label={cancelText} className="absolute inset-0 cursor-default" onClick={onCancel} disabled={busy} />
      <div className={`relative z-10 w-full max-w-md overflow-hidden rounded-3xl border bg-[#0b0b10] shadow-[0_30px_100px_rgba(0,0,0,.75)] ${danger ? "border-red-400/20" : "border-[var(--theme-accent)]/25"}`}>
        <div className="border-b border-white/5 px-6 py-5">
          <div className="flex items-center gap-3">
            <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl border text-lg ${danger ? "border-red-400/20 bg-red-400/10 text-red-300" : "border-[var(--theme-accent)]/25 bg-[var(--theme-accent-bg)] text-[var(--theme-accent)]"}`}>{danger ? "!" : "?"}</span>
            <div>
              <h2 id="confirm-title" className="text-lg font-black text-white">{title}</h2>
              <p className="mt-1 text-xs text-zinc-500">DuelPlay · {confirmText}</p>
            </div>
          </div>
        </div>
        <div className="max-h-[70dvh] overflow-y-auto px-6 py-6">
          <p className="text-sm leading-6 text-zinc-300">{message}</p>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button type="button" autoFocus={danger} disabled={busy} onClick={onCancel} className="rounded-xl border border-white/10 bg-white/[.03] px-4 py-3 text-sm font-bold text-zinc-300 transition hover:border-white/20 hover:text-white disabled:opacity-50">{cancelText}</button>
            <button type="button" autoFocus={!danger} disabled={busy} onClick={onConfirm} className={`rounded-xl border px-4 py-3 text-sm font-black transition disabled:opacity-50 ${danger ? "border-red-400/30 bg-red-500/10 text-red-300 hover:bg-red-500/20" : "border-[var(--theme-accent)]/30 bg-[var(--theme-accent-bg)] text-[var(--theme-accent)] hover:brightness-110"}`}>{busy ? "…" : confirmText}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
