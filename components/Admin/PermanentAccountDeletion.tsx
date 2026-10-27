"use client";

import { useEffect, useState } from "react";

type Preview = {
  user: { id: string; nickname: string; email: string | null; hasSteam: boolean; isTestAccount: boolean; role: string; status: string };
  balances: { real: string; realLocked: string; realBonus: string; demo: string; demoLocked: string; demoDebt: string };
  holdAmounts: { real: string; demo: string };
  operations: { activeMatches: number; activeDisputes: number; pendingTransactions: number; pendingDeposits: number; pendingWithdrawals: number; pendingCreatorPayouts: number; pendingMatchReservations: number; activeRealHolds: number; activeDemoHolds: number };
  allowed: boolean;
  blockedReasons: string[];
  demoAnnulmentAmount: string;
  realBalanceToSecure: string;
};

const REASON_LABELS: Record<string, string> = {
  ALREADY_DELETED: "Аккаунт уже удалён.", ADMIN_ACCOUNT_PROTECTED: "Административные аккаунты нельзя удалять.", BONUS_BALANCE_UNRESOLVED: "Бонусный баланс нужно обработать отдельно по правилам платформы.", REAL_RECOVERY_IDENTITY_REQUIRED: "Для защиты REAL-баланса нужны подтверждённый email и привязанный Steam.", ACCOUNT_RECOVERY_SECRET_REQUIRED: "Не настроен постоянный секрет восстановления HMAC.", REAL_LEDGER_UNVERIFIED: "REAL-баланс не подтверждён ledger.", ACTIVE_MATCH: "Есть активный матч.", ACTIVE_DISPUTE: "Есть активный спор.", LOCKED_FUNDS: "Есть заблокированные средства или активные резервы.", FINANCIAL_OPERATION_PENDING: "Есть незавершённая финансовая операция.", DEMO_BALANCE_UNRESOLVED: "DEMO-баланс имеет долг или некорректное значение.", DEMO_FUNDS_NOT_CONFIRMED_TEST_ACCOUNT: "DEMO-средства не подтверждены как принадлежащие тестовому аккаунту.",
};

export default function PermanentAccountDeletion({ userId, onClose, onSuccess }: { userId: string; onClose: () => void; onSuccess: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState("");
  const [confirmNickname, setConfirmNickname] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/access/permanent-delete?userId=${encodeURIComponent(userId)}`, { cache: "no-store", credentials: "same-origin" })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || "Не удалось загрузить сведения"); return j as Preview; })
      .then(v => { if (!cancelled) setPreview(v); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось загрузить сведения"); });
    return () => { cancelled = true; };
  }, [userId]);

  async function submit() {
    if (!preview) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/access/permanent-delete", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, reason: reason.trim(), confirmNickname }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Удаление отклонено");
      onSuccess();
    } catch (e) { setError(e instanceof Error ? e.message : "Удаление не выполнено"); }
    finally { setBusy(false); }
  }

  return <div className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-black/80 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="permanent-delete-title">
    <div className="my-6 w-full max-w-3xl rounded-3xl border border-red-400/30 bg-[#0b0b0e] p-5 text-white shadow-2xl sm:p-7">
      <div className="flex items-start justify-between gap-4"><div><div className="text-xs font-black uppercase tracking-[.22em] text-red-300">Необратимая операция</div><h2 id="permanent-delete-title" className="mt-2 text-2xl font-black">Удалить аккаунт навсегда</h2><p className="mt-2 text-sm text-zinc-500">Проверяются актуальные данные базы. REAL-средства администратору не переводятся.</p></div><button onClick={onClose} type="button" className="rounded-xl border border-white/10 px-3 py-2 text-sm">Закрыть</button></div>
      {!preview && !error && <p className="mt-6 text-sm text-zinc-400">Загружаем профиль, кошельки и незавершённые операции…</p>}
      {preview && <>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[.03] p-4"><div className="text-xs text-zinc-500">Пользователь</div><div className="mt-1 break-all text-lg font-black">{preview.user.nickname}</div><div className="mt-1 break-all font-mono text-xs text-zinc-500">{preview.user.id}</div><div className="mt-3 text-sm text-zinc-300">Email: {preview.user.email || "не указан"}</div><div className="text-sm text-zinc-300">Steam: {preview.user.hasSteam ? "привязан" : "не привязан"}</div><div className="mt-1 text-xs text-zinc-500">Тестовый аккаунт: {preview.user.isTestAccount ? "да" : "нет"}</div></div>
          <div className="rounded-2xl border border-white/10 bg-white/[.03] p-4"><div className="text-xs text-zinc-500">Балансы на момент проверки</div><div className="mt-2 flex justify-between gap-3 text-sm"><span>REAL</span><b>{preview.balances.real}</b></div><div className="flex justify-between gap-3 text-sm"><span>REAL · бонусы</span><b>{preview.balances.realBonus}</b></div><div className="flex justify-between gap-3 text-sm"><span>REAL · заблокировано</span><b>{preview.balances.realLocked}</b></div><div className="flex justify-between gap-3 text-sm"><span>REAL · активные holds</span><b>{preview.holdAmounts.real}</b></div><div className="my-2 border-t border-white/10"/><div className="flex justify-between gap-3 text-sm"><span>DEMO</span><b>{preview.balances.demo} DC</b></div><div className="flex justify-between gap-3 text-sm"><span>DEMO · заблокировано</span><b>{preview.balances.demoLocked} DC</b></div><div className="flex justify-between gap-3 text-sm"><span>DEMO · активные holds</span><b>{preview.holdAmounts.demo} DC</b></div><div className="flex justify-between gap-3 text-sm"><span>DEMO · долг</span><b>{preview.balances.demoDebt} DC</b></div></div>
        </div>
        <div className="mt-3 rounded-2xl border border-white/10 p-4"><div className="text-xs font-black uppercase tracking-wider text-zinc-500">Блокирующие операции</div><div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">{[["Активные матчи",preview.operations.activeMatches],["Активные споры",preview.operations.activeDisputes],["Ожидающие транзакции",preview.operations.pendingTransactions],["Депозиты в обработке",preview.operations.pendingDeposits],["Выводы в обработке",preview.operations.pendingWithdrawals],["Выплаты создателю",preview.operations.pendingCreatorPayouts],["DEMO-резервации",preview.operations.pendingMatchReservations],["REAL holds",preview.operations.activeRealHolds],["DEMO holds",preview.operations.activeDemoHolds]].map(([label,value])=><div key={String(label)} className="rounded-xl bg-white/[.03] p-2"><div className="text-xs text-zinc-500">{label}</div><b>{value}</b></div>)}</div></div>
        <div className="mt-3 rounded-2xl border border-white/10 p-4 text-sm"><div className="text-xs font-black uppercase tracking-wider text-zinc-500">Финансовая обработка</div><p className="mt-1 text-zinc-300">REAL к безопасному сохранению: <b>{preview.realBalanceToSecure} USD</b>. DEMO к аннулированию через ledger: <b>{preview.demoAnnulmentAmount} DC</b>. DEMO не переводится администратору. Бонусный баланс не смешивается с REAL и должен быть разрешён отдельно.</p></div>
        {!preview.allowed && <div className="mt-3 rounded-xl border border-red-400/30 bg-red-500/5 p-3 text-sm text-red-200"><b>Удаление сейчас запрещено:</b><ul className="mt-2 list-disc space-y-1 pl-5">{preview.blockedReasons.map(code=><li key={code}>{REASON_LABELS[code] || code}</li>)}</ul></div>}
        <label className="mt-4 block text-sm font-bold">Причина удаления (обязательно)<textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={1000} rows={3} className="mt-2 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-white outline-none focus:border-red-300" placeholder="Укажи основание и контекст операции"/></label>
        <label className="mt-4 block text-sm font-bold">Для подтверждения повторно введи никнейм: <span className="text-red-200">{preview.user.nickname}</span><input value={confirmNickname} onChange={e=>setConfirmNickname(e.target.value)} autoComplete="off" className="mt-2 w-full rounded-xl border border-white/10 bg-black px-3 py-3 font-mono text-white outline-none focus:border-red-300" placeholder="Никнейм без изменений"/></label>
      </>}
      {error && <div className="mt-4 rounded-xl border border-red-400/30 bg-red-500/5 p-3 text-sm text-red-200">{error}</div>}
      <div className="mt-6 flex flex-col-reverse justify-end gap-2 sm:flex-row"><button type="button" onClick={onClose} className="rounded-xl border border-white/10 px-4 py-3 text-sm font-bold">Отмена</button><button type="button" disabled={!preview?.allowed || busy || !reason.trim() || confirmNickname !== preview.user.nickname} onClick={()=>void submit()} className="rounded-xl bg-red-500 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-30">{busy ? "Выполняется…" : "Удалить аккаунт навсегда"}</button></div>
    </div>
  </div>;
}
