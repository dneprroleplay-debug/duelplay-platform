"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/Common/LanguageContext";
import { deferEffectTask } from "@/lib/effect-defer";

type Item = {
  id: string;
  name: string;
  imageUrl: string;
  rarity: string;
  value: number;
  status: string;
  createdAt: string;
  canSell: boolean;
};

type InventoryResponse = { items: Item[]; counts: Record<string, number>; stats?: { total: number; page: number; limit: number; pageCount: number; availableValue: number } };

export default function InventoryPage() {
  const { t, language } = useLanguage();
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [selling, setSelling] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState("");
  const [rarity, setRarity] = useState("");
  const [query, setQuery] = useState("");
  const [stats, setStats] = useState<InventoryResponse["stats"]>();
  const [page, setPage] = useState(1);
  const [frames, setFrames] = useState<Array<{id:string;slug:string;name:string;imageUrl:string|null;equipped:boolean;owned:boolean;locked:boolean;unlockLevel:number|null;playerLevel:number;source:string}>>([]);
  const [frameBusy, setFrameBusy] = useState(false);
  const frameText = ({
    RU:{title:"Коллекция рамок профиля",empty:"Рамки появятся здесь по мере получения наград.",wear:"Надеть",remove:"Снять",active:"Надета",failed:"Не удалось изменить рамку.",locked:"Открывается на уровне",level:"Уровень",owned:"Получена",sourceProfile:"Заполнение профиля",sourceLevel:"Уровни",sourceHub:"DuelPlay Hub",sourceOther:"Рамка профиля",notOwned:"Не получена",names:{"frame-level-10":"Розовый сигнал","frame-level-20":"Розовая схема","frame-level-30":"Фиолетовый вектор","frame-level-40":"Глубинная призма","frame-level-50":"Титановая роза","frame-level-75":"Золотой суверен","frame-level-100":"Восходящее затмение","frame-profile-complete":"DuelPlay Complete"}},
    UA:{title:"Колекція рамок профілю",empty:"Рамки з’являтимуться тут у міру отримання нагород.",wear:"Одягнути",remove:"Зняти",active:"Одягнена",failed:"Не вдалося змінити рамку.",locked:"Відкривається на рівні",level:"Рівень",owned:"Отримано",sourceProfile:"Заповнення профілю",sourceLevel:"Рівні",sourceHub:"DuelPlay Hub",sourceOther:"Рамка профілю",notOwned:"Не отримано",names:{"frame-level-10":"Рожевий сигнал","frame-level-20":"Рожева схема","frame-level-30":"Фіолетовий вектор","frame-level-40":"Глибинна призма","frame-level-50":"Титанова троянда","frame-level-75":"Золотий суверен","frame-level-100":"Східне затемнення","frame-profile-complete":"DuelPlay Complete"}},
    EN:{title:"Profile frame collection",empty:"Frames will appear here as rewards are earned.",wear:"Equip",remove:"Remove",active:"Equipped",failed:"Could not change the frame.",locked:"Unlocks at level",level:"Level",owned:"Owned",sourceProfile:"Profile completion",sourceLevel:"Levels",sourceHub:"DuelPlay Hub",sourceOther:"Profile frame",notOwned:"Not yet earned",names:{"frame-level-10":"Rose Signal","frame-level-20":"Pink Circuit","frame-level-30":"Violet Vector","frame-level-40":"Abyssal Prism","frame-level-50":"Titanium Rose","frame-level-75":"Sovereign Gold","frame-level-100":"Eclipse Ascendant","frame-profile-complete":"DuelPlay Complete"}},
    PL:{title:"Kolekcja ramek profilu",empty:"Ramki pojawią się tutaj po zdobyciu nagród.",wear:"Załóż",remove:"Zdejmij",active:"Założona",failed:"Nie udało się zmienić ramki.",locked:"Odblokowanie na poziomie",level:"Poziom",owned:"Zdobyta",sourceProfile:"Uzupełnienie profilu",sourceLevel:"Poziomy",sourceHub:"DuelPlay Hub",sourceOther:"Ramka profilu",notOwned:"Jeszcze niezdobyta",names:{"frame-level-10":"Różowy sygnał","frame-level-20":"Różowy obwód","frame-level-30":"Fioletowy wektor","frame-level-40":"Otchłanna pryzma","frame-level-50":"Tytanowa róża","frame-level-75":"Złoty suweren","frame-level-100":"Wschodzące zaćmienie","frame-profile-complete":"DuelPlay Complete"}}
  } as Record<string,any>)[language] || ({title:"Profile frame collection",empty:"Frames will appear here as rewards are earned.",wear:"Equip",remove:"Remove",active:"Equipped",failed:"Could not change the frame.",locked:"Unlocks at level",level:"Level",owned:"Owned",sourceProfile:"Profile completion",sourceLevel:"Levels",sourceHub:"DuelPlay Hub",sourceOther:"Profile frame",notOwned:"Not yet earned",names:{}} as const);
  const frameSourceLabel = (source:string) => source==="LEVEL" ? frameText.sourceLevel : source==="PROFILE_COMPLETION" ? frameText.sourceProfile : source==="HUB" ? frameText.sourceHub : frameText.sourceOther;

  const load = useCallback(async () => {
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (status) params.set("status", status);
      if (rarity) params.set("rarity", rarity);
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(`/api/inventory?${params.toString()}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "ERROR");
      const payload = data as InventoryResponse;
      setItems(payload.items || []);
      setCounts(payload.counts || {});
      setStats(payload.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить инвентарь");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { deferEffectTask(() => { void load(); void fetch("/api/profile/frame", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(d => { if (d?.frames) setFrames(d.frames); }).catch(() => {}); }); }, [load]);

  async function changeFrame(frameId: string | null) {
    if (frameBusy) return; setFrameBusy(true); setError("");
    try { const r = await fetch("/api/profile/frame", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: frameId }) }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "FRAME_FAILED"); const refreshed = await fetch("/api/profile/frame", { cache: "no-store" }); const next = await refreshed.json(); setFrames(next.frames || []); window.dispatchEvent(new Event("duelplay:profile-updated")); } catch { setError(frameText.failed); } finally { setFrameBusy(false); }
  }

  async function sell(item: Item) {
    if (!item.canSell || selling) return;
    setSelling(item.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, action: "sell" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось продать предмет");
      setNotice(`Продано: ${item.name}. Баланс: $${Number(data.balance).toFixed(2)}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось продать предмет");
      await load();
    } finally {
      setSelling(null);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 pb-20 pt-28 sm:px-6">
      <div className="panel rounded-3xl p-7 sm:p-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="pill">INVENTORY</span>
            <h1 className="mt-3 text-4xl font-black">{t.inventoryTitle}</h1>
            <p className="mt-2 text-zinc-500">{t.inventoryText}</p>
          </div>
          <button type="button" onClick={() => router.push("/cases")} className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold transition hover:border-[var(--theme-accent)]/40 hover:text-[var(--theme-accent)]">{t.toCases}</button>
        </div>

        <section className="mt-7 rounded-2xl border border-white/10 bg-white/[.025] p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-black">{frameText.title}</h2><span className="text-xs text-zinc-500">{frameText.level}: {frames[0]?.playerLevel ?? 0}</span></div>{frames.length===0?<p className="mt-2 text-sm text-zinc-500">{frameText.empty}</p>:<div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{frames.map(frame=><article key={frame.id} className={`flex items-center gap-3 rounded-xl border p-3 ${frame.equipped?"border-pink-400/40 bg-pink-400/[.05]":frame.locked?"border-white/5 bg-black/20 opacity-80":"border-white/10 bg-black/10"}`}>{frame.imageUrl?<img src={frame.imageUrl} alt="" className={`h-12 w-12 shrink-0 rounded-lg object-contain frame-glow frame-glow--${frame.slug}`}/>:<span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-pink-400/30 text-pink-300">◇</span>}<div className="min-w-0 flex-1"><b className="block truncate text-sm">{frameText.names[frame.slug] || frame.name}</b><span className="block text-[11px] text-zinc-500">{frameSourceLabel(frame.source)}</span>{frame.unlockLevel!==null&&<span className="block text-[11px] text-zinc-500">{frame.locked?frameText.locked:frameText.level} {frame.unlockLevel}</span>}{frame.equipped&&<span className="text-xs text-pink-300">{frameText.active}</span>}{frame.owned&&!frame.equipped&&<span className="text-xs text-emerald-300">{frameText.owned}</span>}{!frame.owned&&<span className="text-xs text-zinc-500">{frameText.notOwned}</span>}</div>{frame.owned&&<button type="button" disabled={frameBusy} onClick={()=>void changeFrame(frame.equipped?null:frame.id)} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold hover:border-pink-400/40 disabled:opacity-50">{frame.equipped?frameText.remove:frameText.wear}</button>}</article>)}</div>}</section>

        <div className="mt-6 grid gap-2 sm:grid-cols-4">
          <input value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder="Search item…" className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none" />
          <select value={rarity} onChange={e => { setRarity(e.target.value); setPage(1); }} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none">
            <option value="">All rarities</option><option value="COMMON">Common</option><option value="UNCOMMON">Uncommon</option><option value="RARE">Rare</option><option value="EPIC">Epic</option><option value="LEGENDARY">Legendary</option>
          </select>
          <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none">
            <option value="">All active items</option>{Object.keys(counts).map(value => <option key={value} value={value}>{value}</option>)}
          </select>
          <div className="rounded-xl border border-white/10 px-3 py-2 text-sm text-zinc-400">Available value: <b className="text-[var(--theme-accent)]">${Number(stats?.availableValue || 0).toFixed(2)}</b></div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2 text-xs">
          {Object.entries(counts).map(([status, count]) => <span key={status} className="rounded-full border border-white/10 px-3 py-1.5 text-zinc-400">{status}: {count}</span>)}
        </div>

        {notice && <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-sm text-emerald-300">{notice}</div>}
        {error && <div className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-300">{error}</div>}

        {loading ? <div className="mt-8 p-10 text-center text-zinc-500">{t.loading}</div> : !items.length ? (
          <div className="mt-8 rounded-2xl border border-white/5 bg-white/[.025] p-10 text-center">
            <div className="text-xl font-black">{t.emptyInventory}</div>
            <p className="mt-2 text-sm text-zinc-500">{t.emptyInventoryText}</p>
            <button type="button" onClick={() => router.push("/cases")} className="mt-5 inline-flex rounded-xl bg-[var(--theme-accent)] px-5 py-3 font-black text-black">{t.openCases}</button>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {items.map(item => (
              <article key={item.id} className="overflow-hidden rounded-2xl border border-white/8 bg-white/[.025]">
                <img src={item.imageUrl} alt="" className="aspect-[4/3] w-full object-cover" />
                <div className="p-3">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-600">{item.rarity}</div>
                  <div className="mt-1 truncate font-bold">{item.name}</div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                    <span className="text-[var(--theme-accent)]">${item.value.toFixed(2)}</span>
                    <span className="text-zinc-600">{item.status}</span>
                  </div>
                  {item.canSell && <button type="button" disabled={selling !== null} onClick={() => void sell(item)} className="mt-3 w-full rounded-xl bg-[var(--theme-accent)] px-3 py-2 text-xs font-black text-black disabled:cursor-not-allowed disabled:opacity-50">{selling === item.id ? "Selling…" : "Sell for balance"}</button>}
                </div>
              </article>
            ))}
          </div>
        )}

        {stats && stats.pageCount > 1 && (
          <div className="mt-6 flex items-center justify-between gap-3 text-sm">
            <button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)} className="rounded-xl border border-white/10 px-4 py-2 disabled:opacity-40">Previous</button>
            <span className="text-zinc-500">Page {stats.page} / {stats.pageCount}</span>
            <button type="button" disabled={page >= stats.pageCount} onClick={() => setPage(value => value + 1)} className="rounded-xl border border-white/10 px-4 py-2 disabled:opacity-40">Next</button>
          </div>
        )}
      </div>
    </main>
  );
}
