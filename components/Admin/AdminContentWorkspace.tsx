"use client";
import { useCallback, useEffect, useState } from "react";
import { useDuelDialog } from "@/components/Common/DuelDialogProvider";

type ContentRow = { id: string; name: string; description?: string | null; slug?: string | null; active?: boolean; price?: number; target?: number; type?: string; xpReward?: number };
type ContentData = { items: ContentRow[]; collections: ContentRow[]; missions: ContentRow[]; achievements: ContentRow[] };
const EMPTY: ContentData = { items: [], collections: [], missions: [], achievements: [] };
const TYPES = ["ITEM", "COLLECTION", "MISSION", "ACHIEVEMENT"] as const;
const ITEM_TYPES = ["COSMETIC", "AVATAR", "FRAME", "BADGE", "BANNER", "TITLE", "PROFILE_THEME", "EMOTE", "SPRAY"] as const;

type Draft = { type: typeof TYPES[number]; slug: string; name: string; description: string; price: string; itemType: string; missionType: string; target: string; xpReward: string };

export default function AdminContentWorkspace() {
  const dialog = useDuelDialog();
  const [data, setData] = useState<ContentData>(EMPTY);
  const [draft, setDraft] = useState<Draft>({ type: "ITEM", slug: "", name: "", description: "", price: "1", itemType: "COSMETIC", missionType: "DAILY", target: "1", xpReward: "0" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/content", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setError(body.error || "Не удалось загрузить контент"); return; }
    setData({
      items: Array.isArray(body.items) ? body.items : [],
      collections: Array.isArray(body.collections) ? body.collections : [],
      missions: Array.isArray(body.missions) ? body.missions : [],
      achievements: Array.isArray(body.achievements) ? body.achievements : [],
    });
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function request(method: "POST" | "PATCH" | "DELETE", payload: Record<string, unknown>) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/content", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body.error || "Операция не выполнена"); return false; }
      setNotice(method === "DELETE" ? "Предмет удалён" : method === "POST" ? "Контент создан" : "Изменения сохранены");
      await load();
      return true;
    } catch { setError("Операция не выполнена"); return false; }
    finally { setBusy(false); }
  }

  async function create() {
    const payload: Record<string, unknown> = { type: draft.type, name: draft.name.trim(), description: draft.description.trim() };
    if (draft.type === "ITEM") {
      payload.slug = draft.slug.trim();
      payload.price = Number(draft.price);
      payload.itemType = draft.itemType;
    }
    if (draft.type === "COLLECTION" || draft.type === "MISSION") payload.slug = draft.slug.trim();
    if (draft.type === "MISSION") {
      payload.missionType = draft.missionType;
      payload.target = Number(draft.target);
    }
    if (draft.type === "ACHIEVEMENT") payload.xpReward = Number(draft.xpReward);
    const ok = await request("POST", payload);
    if (ok) setDraft({ ...draft, slug: "", name: "", description: "" });
  }

  async function toggle(type: string, row: ContentRow) {
    await request("PATCH", { type, id: row.id, active: !row.active });
  }

  async function remove(row: ContentRow) {
    const confirmed = await dialog.confirm({ title: "Удаление предмета", message: `Удалить предмет «${row.name}»?`, confirmText: "Удалить", cancelText: "Отмена", tone: "danger" });
    if (!confirmed) return;
    await request("DELETE", { type: "ITEM", id: row.id });
  }

  const sections = [
    { type: "ITEM", title: "Предметы магазина", rows: data.items },
    { type: "COLLECTION", title: "Коллекции", rows: data.collections },
    { type: "MISSION", title: "Миссии", rows: data.missions },
    { type: "ACHIEVEMENT", title: "Достижения", rows: data.achievements },
  ];

  return <div className="space-y-6">
    <div className="panel rounded-3xl p-6">
      <h2 className="text-2xl font-black">Контент-магазин</h2>
      <p className="mt-2 text-sm leading-6 text-zinc-500">Управление предметами, коллекциями, миссиями и достижениями. Все изменения фиксируются в аудите.</p>
      {error && <div className="mt-4 rounded-xl border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-300">{error}</div>}
      {notice && <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 text-sm text-emerald-300">{notice}</div>}
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label><span className="mb-2 block text-xs text-zinc-500">Тип</span><select className="input" value={draft.type} onChange={event => setDraft({ ...draft, type: event.target.value as Draft["type"] })}>{TYPES.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
        <label><span className="mb-2 block text-xs text-zinc-500">Название</span><input className="input" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })}/></label>
        <label><span className="mb-2 block text-xs text-zinc-500">Slug</span><input className="input" value={draft.slug} onChange={event => setDraft({ ...draft, slug: event.target.value })} disabled={draft.type === "ACHIEVEMENT"}/></label>
        {draft.type === "ITEM" && <label><span className="mb-2 block text-xs text-zinc-500">Цена, USD</span><input className="input" type="number" min="0.01" step="0.01" value={draft.price} onChange={event => setDraft({ ...draft, price: event.target.value })}/></label>}
        {draft.type === "ITEM" && <label><span className="mb-2 block text-xs text-zinc-500">Категория</span><select className="input" value={draft.itemType} onChange={event => setDraft({ ...draft, itemType: event.target.value })}>{ITEM_TYPES.map(type => <option key={type} value={type}>{type}</option>)}</select></label>}
        {draft.type === "MISSION" && <label><span className="mb-2 block text-xs text-zinc-500">Тип миссии</span><input className="input" value={draft.missionType} onChange={event => setDraft({ ...draft, missionType: event.target.value })}/></label>}
        {draft.type === "MISSION" && <label><span className="mb-2 block text-xs text-zinc-500">Цель</span><input className="input" type="number" min="1" step="1" value={draft.target} onChange={event => setDraft({ ...draft, target: event.target.value })}/></label>}
        {draft.type === "ACHIEVEMENT" && <label><span className="mb-2 block text-xs text-zinc-500">XP</span><input className="input" type="number" min="0" step="1" value={draft.xpReward} onChange={event => setDraft({ ...draft, xpReward: event.target.value })}/></label>}
        <label className="md:col-span-2 xl:col-span-3"><span className="mb-2 block text-xs text-zinc-500">Описание</span><input className="input" value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })}/></label>
        <button disabled={busy || !draft.name.trim() || (draft.type !== "ACHIEVEMENT" && !draft.slug.trim())} onClick={create} className="rounded-xl bg-[var(--theme-accent)] px-5 py-3 font-black text-black disabled:opacity-40">Создать</button>
      </div>
    </div>
    {sections.map(section => <div key={section.type} className="panel rounded-3xl p-6">
      <div className="flex items-center justify-between gap-3"><h3 className="text-xl font-black">{section.title}</h3><span className="text-xs text-zinc-500">{section.rows.length}</span></div>
      {section.rows.length ? <div className="mt-4 grid gap-2 md:grid-cols-2">
        {section.rows.map(row => <div key={row.id} className="rounded-2xl border border-white/5 bg-white/[.025] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><b>{row.name}</b><div className="mt-1 text-xs text-zinc-500">{row.slug || "—"}{section.type === "ITEM" ? ` · $${Number(row.price).toFixed(2)}` : ""}{section.type === "MISSION" ? ` · ${row.target} · ${row.type}` : ""}{section.type === "ACHIEVEMENT" ? ` · ${row.xpReward} XP` : ""}</div>{row.description && <div className="mt-1 text-xs text-zinc-600">{row.description}</div>}</div>
            <div className="flex items-center gap-2">
              {section.type !== "ACHIEVEMENT" && <>
                <span className={`rounded-full px-2 py-1 text-[10px] font-black ${row.active === false ? "bg-zinc-500/15 text-zinc-400" : "bg-emerald-400/15 text-emerald-300"}`}>{row.active === false ? "OFF" : "ON"}</span>
                <button disabled={busy} onClick={() => void toggle(section.type, row)} className="rounded-lg border border-white/10 px-3 py-2 text-xs">{row.active === false ? "Включить" : "Выключить"}</button>
              </>}
              {section.type === "ITEM" && <button disabled={busy} onClick={() => void remove(row)} className="rounded-lg border border-red-400/20 px-3 py-2 text-xs text-red-300">Удалить</button>}
            </div>
          </div>
        </div>)}
      </div> : <div className="mt-4 rounded-2xl border border-white/5 p-8 text-center text-sm text-zinc-600">Записей нет</div>}
    </div>)}
  </div>;
}
