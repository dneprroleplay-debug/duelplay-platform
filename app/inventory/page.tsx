"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/Common/LanguageContext";

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
  const { t } = useLanguage();
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

  useEffect(() => { void load(); }, [load]);

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
