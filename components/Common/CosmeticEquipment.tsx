"use client";
import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/components/Common/LanguageContext";
import { useTheme } from "@/components/Common/ThemeProvider";
import ProfileBanner from "@/components/Common/ProfileBanner";
import { deferEffectTask } from "@/lib/effect-defer";

type Item = { id: string; slug: string; name: string; type: "BANNER" | "TITLE"; imageUrl: string | null; equipped: boolean; ownedAt: string };
type Data = { items: Item[] };
const COPY = {
 RU: { title: "Баннеры и титулы", banner: "Баннеры", titleType: "Титулы", emptyBanner: "У тебя пока нет баннеров.", emptyTitle: "У тебя пока нет титулов.", equip: "Надеть", remove: "Снять", equipped: "Надето", owned: "Уже получено", failed: "Не удалось изменить экипировку." },
 UA: { title: "Банери й титули", banner: "Банери", titleType: "Титули", emptyBanner: "У тебе поки немає банерів.", emptyTitle: "У тебе поки немає титулів.", equip: "Одягнути", remove: "Зняти", equipped: "Одягнено", owned: "Уже отримано", failed: "Не вдалося змінити екіпірування." },
 EN: { title: "Banners & Titles", banner: "Banners", titleType: "Titles", emptyBanner: "You do not own any banners yet.", emptyTitle: "You do not own any titles yet.", equip: "Equip", remove: "Remove", equipped: "Equipped", owned: "Owned", failed: "Could not update equipment." },
 PL: { title: "Banery i tytuły", banner: "Banery", titleType: "Tytuły", emptyBanner: "Nie masz jeszcze żadnych banerów.", emptyTitle: "Nie masz jeszcze żadnych tytułów.", equip: "Załóż", remove: "Zdejmij", equipped: "Założono", owned: "Posiadane", failed: "Nie udało się zmienić wyposażenia." },
} as const;
export default function CosmeticEquipment() {
 const { language } = useLanguage();
 const { themePreference } = useTheme();
 const copy = COPY[(String(language).toUpperCase() in COPY ? String(language).toUpperCase() : "EN") as keyof typeof COPY];
 const [items, setItems] = useState<Item[]>([]); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
 const load = useCallback(async () => { try { const r = await fetch("/api/profile/cosmetics", { cache: "no-store" }); const d = await r.json(); if (!r.ok) throw new Error("load"); setItems(Array.isArray(d.items) ? d.items : []); } catch { setError(copy.failed); } finally { setLoading(false); } }, [copy.failed]);
 useEffect(() => { deferEffectTask(() => { void load(); }); }, [load]);
 const change = async (item: Item, equip: boolean) => { if (busy) return; setBusy(true); setError(""); try { const r = await fetch("/api/profile/cosmetics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: item.type, itemId: equip ? item.id : null }) }); if (!r.ok) throw new Error("save"); await load(); window.dispatchEvent(new Event("duelplay:profile-updated")); } catch { setError(copy.failed); } finally { setBusy(false); } };
 const groups: Array<{ type: Item["type"]; label: string; empty: string }> = [{ type: "BANNER", label: copy.banner, empty: copy.emptyBanner }, { type: "TITLE", label: copy.titleType, empty: copy.emptyTitle }];
 return <section className="mt-7 rounded-2xl border border-white/10 bg-white/[.025] p-4 sm:p-5"><h2 className="text-lg font-black">{copy.title}</h2>{error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}{loading ? <p className="mt-3 text-sm text-zinc-500">Loading…</p> : <div className="mt-4 grid gap-5 lg:grid-cols-2">{groups.map(group => { const list = items.filter(x => x.type === group.type); return <div key={group.type}><h3 className="mb-3 text-sm font-bold text-zinc-300">{group.label}</h3>{list.length === 0 ? <p className="rounded-xl bg-black/20 p-3 text-sm text-zinc-500">{group.empty}</p> : <div className="space-y-3">{list.map(item => <article key={item.id} className={`overflow-hidden rounded-xl border ${item.equipped ? "border-pink-400/40 bg-pink-400/[.05]" : "border-white/10 bg-black/10"}`}>{item.type === "BANNER" && item.imageUrl && <ProfileBanner imageUrl={item.imageUrl} name={item.name} themeId={themePreference} compact /> }<div className="flex items-center gap-3 p-3"><div className="min-w-0 flex-1"><b className="block truncate text-sm">{item.name}</b><span className={`text-xs ${item.equipped ? "text-pink-300" : "text-emerald-300"}`}>{item.equipped ? copy.equipped : copy.owned}</span></div><button type="button" disabled={busy} onClick={() => void change(item, !item.equipped)} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold hover:border-pink-400/40 disabled:opacity-50">{item.equipped ? copy.remove : copy.equip}</button></div></article>)}</div>}</div>; })}</div>}</section>;
}
