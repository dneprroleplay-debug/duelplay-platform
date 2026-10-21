"use client";

import { useCallback, useEffect, useState } from "react";
import { useDuelDialog } from "@/components/Common/DuelDialogProvider";

type Row = Record<string, unknown>;

export default function ServerTechnicalConsole({ canLogs, canIncidents, canManageIncidents }: { canLogs: boolean; canIncidents: boolean; canManageIncidents: boolean }) {
  const dialog = useDuelDialog();
  const [tab, setTab] = useState<"events" | "incidents">(canLogs ? "events" : "incidents");
  const [items, setItems] = useState<Row[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [server, setServer] = useState("");
  const [severity, setSeverity] = useState("");
  const [component, setComponent] = useState("");
  const [incidentStatus, setIncidentStatus] = useState("");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [incidentFilter, setIncidentFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (nextPage = 1) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(nextPage), pageSize: "50" });
      if (server) params.set("server", server);
      if (severity) params.set("severity", severity);
      if (tab === "events" && component) params.set("component", component);
      if (tab === "events" && query) params.set("q", query);
      if (tab === "events" && from) params.set("from", new Date(`${from}T00:00:00`).toISOString());
      if (tab === "events" && to) params.set("to", new Date(`${to}T23:59:59`).toISOString());
      if (tab === "incidents" && incidentFilter) params.set("id", incidentFilter);
      if (tab === "incidents" && incidentStatus) params.set("status", incidentStatus);
      const response = await fetch(`/api/admin/${tab === "events" ? "server-events" : "server-incidents"}?${params}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось загрузить данные");
      setItems(data.items || []);
      setPage(nextPage);
      setHasMore(Boolean(data.hasMore));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить данные");
      setItems([]);
    } finally { setLoading(false); }
  }, [component, from, incidentFilter, incidentStatus, query, server, severity, tab, to]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(page); }, 0); const poll = window.setInterval(() => { void load(page); }, 15_000); return () => { window.clearTimeout(timer); window.clearInterval(poll); }; }, [load, page]);
  const timestamp = (value: unknown) => value ? new Date(String(value)).toLocaleString() : "—";
  const updateIncident = async (item: Row, action: "acknowledge" | "resolve") => {
    const confirmed = await dialog.confirm({ title: action === "acknowledge" ? "Принять инцидент" : "Закрыть инцидент", message: action === "acknowledge" ? "Подтвердить, что инцидент принят в работу?" : "Закрыть инцидент с указанием результата?", confirmText: action === "acknowledge" ? "Принять" : "Закрыть", cancelText: "Отмена" });
    if (!confirmed) return;
    const reason = action === "resolve" ? (await dialog.prompt({ title: "Результат устранения", message: "Укажите результат устранения:", placeholder: "Что было сделано", confirmText: "Закрыть инцидент", cancelText: "Отмена", multiline: true }))?.trim() : undefined;
    if (action === "resolve" && !reason) return;
    try {
      const response = await fetch("/api/admin/server-incidents", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, action, reason }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось обновить инцидент");
      await load(page);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось обновить инцидент"); }
  };

  return <main className="mx-auto min-h-screen max-w-7xl px-4 pb-20 pt-24 sm:px-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><a href="/admin/access" className="text-sm text-zinc-500 hover:text-white">← Центр управления</a><h1 className="mt-3 text-3xl font-black">Технические события и инциденты</h1><p className="mt-2 text-sm text-zinc-500">Технические события VPS хранятся отдельно от аудита действий администраторов.</p></div>
      <button onClick={() => void load(page)} disabled={loading} className="rounded-xl border border-white/10 px-4 py-2 text-sm">Обновить</button>
    </div>
    <div className="mt-6 flex flex-wrap gap-2">
      {canLogs && <button onClick={() => setTab("events")} className={`rounded-xl px-4 py-2 text-sm ${tab === "events" ? "bg-[var(--theme-accent)] font-bold text-black" : "border border-white/10"}`}>Технические логи</button>}
      {canIncidents && <button onClick={() => setTab("incidents")} className={`rounded-xl px-4 py-2 text-sm ${tab === "incidents" ? "bg-[var(--theme-accent)] font-bold text-black" : "border border-white/10"}`}>Инциденты</button>}
    </div>
    <div className="mt-4 flex flex-wrap gap-2">
      <input className="input max-w-56" value={server} onChange={e => setServer(e.target.value)} placeholder="Сервер, например cs2-1" />
      <select className="input max-w-48" value={severity} onChange={e => setSeverity(e.target.value)}><option value="">Любая важность</option>{["DEBUG", "INFO", "NOTICE", "WARNING", "ERROR", "CRITICAL", "FATAL"].map(x => <option key={x}>{x}</option>)}</select>
      {tab === "events" && <input className="input max-w-72" value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск по сообщению/компоненту" />}
      {tab === "events" && <input className="input max-w-48" value={component} onChange={e => setComponent(e.target.value)} placeholder="Компонент" />}
      {tab === "events" && <><input aria-label="Дата начала" type="date" className="input max-w-44" value={from} onChange={e => setFrom(e.target.value)} /><input aria-label="Дата окончания" type="date" className="input max-w-44" value={to} onChange={e => setTo(e.target.value)} /></>}
      {tab === "incidents" && <select className="input max-w-48" value={incidentStatus} onChange={e => setIncidentStatus(e.target.value)}><option value="">Все состояния</option>{["OPEN", "ACKNOWLEDGED", "RESOLVED"].map(x => <option key={x}>{x}</option>)}</select>}
      {tab === "incidents" && incidentFilter && <button onClick={() => setIncidentFilter("")} className="rounded-xl border border-white/10 px-4 py-2 text-sm">Сбросить фильтр по инциденту</button>}
      <button onClick={() => void load(1)} className="rounded-xl border border-white/10 px-4 py-2 text-sm">Применить</button>
    </div>
    {error && <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-300">{error}</p>}
    <div className="mt-5 space-y-3">{items.map((item, index) => <article key={String(item.id || index)} className="rounded-2xl border border-white/8 bg-white/[.025] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-2"><b>{String(item.serverName || "—")}</b><span className="rounded-full border border-white/10 px-2 py-1 text-[10px] font-bold">{String(item.severity || "—")}</span><span className="text-xs text-zinc-500">{String(item.source || item.category || "—")}</span></div><time className="text-xs text-zinc-600">{timestamp(item.occurredAt || item.lastSeenAt)}</time></div>
      <p className="mt-3 text-sm leading-6 text-zinc-300">{String(item.message || item.title || "—")}</p>
      {tab === "incidents" && <div className="mt-2 flex flex-wrap items-center justify-between gap-3"><div className="text-xs text-zinc-500">{String(item.status)} · повторов: {String(item.occurrences)} · событий: {String((item._count as Row | undefined)?.events ?? 0)} · первое появление: {timestamp(item.firstSeenAt)}</div>{canManageIncidents && item.status !== "RESOLVED" && <div className="flex gap-2"><button onClick={() => void updateIncident(item, "acknowledge")} className="rounded-lg border border-amber-300/20 px-3 py-1.5 text-xs text-amber-200">Принять</button><button onClick={() => void updateIncident(item, "resolve")} className="rounded-lg border border-emerald-300/20 px-3 py-1.5 text-xs text-emerald-200">Закрыть</button></div>}</div>}
      {tab === "events" && <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600"><span>Категория: {String(item.category || "—")}</span><span>Получено: {timestamp(item.receivedAt)}</span>{item.incidentId ? <button onClick={() => { setIncidentFilter(String(item.incidentId)); setTab("incidents"); }} className="text-[var(--theme-accent)]">Перейти к инциденту</button> : null}</div>}
      {tab === "events" && Boolean(item.details) && <details className="mt-3"><summary className="cursor-pointer text-xs text-zinc-500">Детали события</summary><pre className="mt-2 overflow-x-auto rounded-lg bg-black/30 p-3 text-xs text-zinc-400">{JSON.stringify(item.details, null, 2)}</pre></details>}
    </article>)}{!items.length && !loading && !error && <p className="rounded-2xl border border-white/8 p-8 text-center text-sm text-zinc-500">Записей пока нет.</p>}</div>
    <div className="mt-5 flex items-center justify-between text-sm text-zinc-500"><button disabled={page <= 1 || loading} onClick={() => void load(page - 1)} className="rounded-lg border border-white/10 px-3 py-2 disabled:opacity-40">Назад</button><span>{loading ? "Загрузка…" : `Страница ${page}`}</span><button disabled={!hasMore || loading} onClick={() => void load(page + 1)} className="rounded-lg border border-white/10 px-3 py-2 disabled:opacity-40">Дальше</button></div>
  </main>;
}
