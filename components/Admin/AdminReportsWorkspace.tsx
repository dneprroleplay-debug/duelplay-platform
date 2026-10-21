"use client";
import { useCallback, useEffect, useState } from "react";
import { useDuelDialog } from "@/components/Common/DuelDialogProvider";

const STATUSES = ["OPEN", "REVIEWED", "RESOLVED", "DISMISSED"] as const;
type ReportRow = {
  id: string;
  type: string;
  status: string;
  reason: string;
  evidence: unknown;
  createdAt: string;
  reporter?: { nickname: string } | null;
  target?: { nickname: string } | null;
  match?: { id: string; status: string } | null;
};

export default function AdminReportsWorkspace({ canReview }: { canReview: boolean }) {
  const dialog = useDuelDialog();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/reports${status ? `?status=${encodeURIComponent(status)}` : ""}`, { cache: "no-store" });
    const body = await response.json().catch(() => ([]));
    if (!response.ok) { setError(body?.error || "Не удалось загрузить жалобы"); return; }
    setRows(Array.isArray(body) ? body : []);
  }, [status]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function update(id: string, next: typeof STATUSES[number]) {
    const notes = await dialog.prompt({ title: `Статус жалобы: ${next}`, message: "Комментарий к статусу (необязательно)", placeholder: "Комментарий", confirmText: "Сохранить", cancelText: "Отмена", multiline: true });
    if (notes === null) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/reports", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: next, notes }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body.error || "Жалоба не обновлена"); return; }
      setNotice("Статус жалобы обновлён");
      await load();
    } catch { setError("Жалоба не обновлена"); }
    finally { setBusy(false); }
  }

  return <div className="panel rounded-3xl p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-2xl font-black">Жалобы игроков</h2><p className="mt-2 text-sm text-zinc-500">Читы, токсичность, эксплойты и подозрительное поведение. Просмотр доступен с reports.view; менять статус может только risk.cases.review.</p></div>
      <select className="input max-w-[220px]" value={status} onChange={event => setStatus(event.target.value)}><option value="">Все статусы</option>{STATUSES.map(value => <option key={value} value={value}>{value}</option>)}</select>
    </div>
    {error && <div className="mt-4 rounded-xl border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-300">{error}</div>}
    {notice && <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 text-sm text-emerald-300">{notice}</div>}
    {rows.length ? <div className="mt-5 space-y-2">{rows.map(row => <div key={row.id} className="rounded-2xl border border-white/5 bg-white/[.025] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2"><b>{row.type}</b><span className="rounded-full bg-white/5 px-2 py-1 text-[10px] font-black">{row.status}</span></div>
          <div className="mt-1 text-xs text-zinc-500">От: <span data-player-name>{row.reporter?.nickname || "—"}</span>{row.target?.nickname ? <> · На: <span data-player-name>{row.target.nickname}</span></> : null}{row.match ? ` · Матч #${String(row.match.id).slice(0, 8)} (${row.match.status})` : ""}</div>
          <div className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">{row.reason}</div>
          {row.evidence != null && <div className="mt-2 max-h-24 overflow-auto rounded-xl bg-black/30 p-2 text-[11px] text-zinc-500">{typeof row.evidence === "string" ? row.evidence : JSON.stringify(row.evidence)}</div>}
          <div className="mt-1 text-[11px] text-zinc-600">{new Date(row.createdAt).toLocaleString()}</div>
        </div>
        {canReview && ["OPEN", "REVIEWED"].includes(row.status) && <div className="flex flex-wrap gap-2">{STATUSES.filter(value => value !== "OPEN" && value !== row.status && (row.status === "OPEN" || (value !== "REVIEWED" && value !== row.status))).map(value => <button key={value} disabled={busy} onClick={() => void update(row.id, value)} className="rounded-lg border border-white/10 px-3 py-2 text-xs">{value}</button>)}</div>}
      </div>
    </div>)}</div> : <div className="mt-5 rounded-2xl border border-white/5 p-8 text-center text-sm text-zinc-600">Жалоб нет</div>}
  </div>;
}
