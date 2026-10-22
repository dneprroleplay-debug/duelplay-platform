"use client";
import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/components/Common/LanguageContext";
import { deferEffectTask } from "@/lib/effect-defer";

type Reward = { day: number; reward: any; active: boolean };
type Claim = { id: string; cycle: number; day: number; claimDate: string; claimedAt: string; reward: any };

const FRAME_NAMES: Record<string, string> = {
  "frame-neon-pulse": "Неоновый импульс",
  "frame-electric-storm": "Электрический шторм",
  "frame-inferno-crown": "Inferno Crown",
};

function rewardLabel(reward: any, language: string) {
  if (!reward || typeof reward !== "object") return "Reward";
  const balance = reward.balance ?? reward.coins ?? reward.amount;
  const frame = reward.cosmeticSlug ? FRAME_NAMES[String(reward.cosmeticSlug)] ?? String(reward.cosmeticSlug) : null;
  if (balance && frame) return `+${balance} DEMO credits + ${frame}`;
  if (balance) return `+${balance} DEMO credits`;
  if (reward.cosmeticItemId) return `Frame: ${String(reward.cosmeticItemId)}`;
  if (reward.case || reward.caseId || reward.caseSlug) return "Case";
  return "Reward";
}

export default function LoginRewards() {
  const { language } = useLanguage();
  const L = {
    RU: { title: "30 дней наград", cycle: "Цикл", day: "День", balance: "DEMO-баланс", claim: "Забрать награду", claiming: "Получение…", claimedToday: "Награда за сегодня получена", loading: "Загрузка…", error: "Не удалось загрузить награды", empty: "Награды не настроены", success: "Награда получена", noData: "Нет данных" },
    UA: { title: "30 днів нагород", cycle: "Цикл", day: "День", balance: "DEMO-баланс", claim: "Забрати нагороду", claiming: "Отримання…", claimedToday: "Нагороду за сьогодні отримано", loading: "Завантаження…", error: "Не вдалося завантажити нагороди", empty: "Нагороди не налаштовані", success: "Нагороду отримано", noData: "Немає даних" },
    EN: { title: "30 Day Rewards", cycle: "Cycle", day: "Day", balance: "DEMO balance", claim: "Claim reward", claiming: "Claiming…", claimedToday: "Today's reward claimed", loading: "Loading…", error: "Failed to load rewards", empty: "Rewards are not configured", success: "Reward claimed", noData: "No data" },
    PL: { title: "30 dni nagród", cycle: "Cykl", day: "Dzień", balance: "Saldo DEMO", claim: "Odbierz nagrodę", claiming: "Odbieranie…", claimedToday: "Nagroda za dziś odebrana", loading: "Ładowanie…", error: "Nie udało się załadować nagród", empty: "Nagrody nie są skonfigurowane", success: "Nagroda odebrana", noData: "Brak danych" },
  }[language as "RU" | "UA" | "EN" | "PL"] ?? { title: "30 Day Rewards", cycle: "Cycle", day: "Day", balance: "DEMO balance", claim: "Claim reward", claiming: "Claiming…", claimedToday: "Today's reward claimed", loading: "Loading…", error: "Failed to load rewards", empty: "Rewards are not configured", success: "Reward claimed", noData: "No data" };

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [claimError, setClaimError] = useState("");
  const [claimNotice, setClaimNotice] = useState("");

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const r = await fetch("/api/login-rewards", { cache: "no-store" });
      const x = await r.json();
      if (!r.ok) throw new Error(x.error || L.error);
      setData(x);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : L.error);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  async function claim() {
    if (busy || !data?.canClaim) return;
    setBusy(true);
    setClaimError("");
    setClaimNotice("");
    try {
      const r = await fetch("/api/login-rewards", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const x = await r.json();
      if (!r.ok) { setClaimError(x.error || "Could not claim reward"); return; }
      const granted = x?.granted?.balance ?? 0;
      const frame = x?.row?.reward?.cosmeticSlug ? FRAME_NAMES[String(x.row.reward.cosmeticSlug)] : null;
      setClaimNotice(`${L.success}: ${granted > 0 ? `+${granted} DEMO credits` : ""}${frame ? ` + ${frame}` : ""}`.trim());
      await load();
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : "Could not claim reward");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { deferEffectTask(() => { void load(); }); }, []);

  const rewards: Reward[] = Array.isArray(data?.rewards) ? data.rewards : [];
  const claimed: Claim[] = Array.isArray(data?.claimed) ? data.claimed : [];
  const claimedKeys = useMemo(() => new Set(claimed.map((x) => `${x.cycle}:${x.day}`)), [claimed]);
  const nextDay = data?.nextDay ?? 1;
  const cycle = data?.currentCycle ?? 1;
  const balance = data?.todayClaim?.reward?.balance;

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 pb-20 pt-28">
      <section className="panel rounded-3xl p-7 sm:p-10">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <span className="pill">LOGIN REWARDS</span>
            <h1 className="mt-4 text-4xl font-black">{L.title}</h1>
            <p className="mt-2 text-sm text-zinc-500">{L.cycle} {cycle} · {L.day} {nextDay}</p>
            {balance !== undefined && balance !== null && <p className="mt-1 text-sm text-zinc-500">{L.balance}: {balance}</p>}
          </div>
          <button disabled={!data?.canClaim || busy || loading} onClick={claim} className="rounded-xl bg-pink-400 px-5 py-3 font-black text-black disabled:cursor-not-allowed disabled:opacity-40">
            {busy ? L.claiming : data?.canClaim ? `${L.claim} ${L.day} ${nextDay}` : L.claimedToday}
          </button>
        </div>
        {loadError && <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300">{loadError}</p>}
        {claimError && <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300">{claimError}</p>}
        {claimNotice && <p className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-300">{claimNotice}</p>}
        {loading ? (
          <div className="mt-8 p-10 text-center text-zinc-500">{L.loading}</div>
        ) : rewards.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-white/5 p-10 text-center text-zinc-500">{L.empty}</div>
        ) : (
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rewards.map((reward) => {
              const isFrameDay = reward.day === 7 || reward.day === 15 || reward.day === 30;
              const claimedDay = claimedKeys.has(`${cycle}:${reward.day}`);
              return (
                <div key={reward.day} className={`rounded-2xl border p-4 ${reward.day === nextDay ? "border-pink-400/50" : "border-white/5"} ${isFrameDay ? "bg-pink-400/[.04]" : ""}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-500">{L.day} {reward.day}</span>
                    <span className="text-xs">{claimedDay ? "✓" : reward.day === nextDay ? "Next" : ""}</span>
                  </div>
                  <div className="mt-3 text-lg font-black">{rewardLabel(reward.reward, language)}</div>
                  {reward.reward?.cosmeticSlug && <div className="mt-2 text-xs text-zinc-500">{FRAME_NAMES[String(reward.reward.cosmeticSlug)]}</div>}
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-8 rounded-2xl bg-black/20 p-5">
          <h2 className="font-bold">Recent claims</h2>
          <div className="mt-3 space-y-2">{claimed.length ? claimed.slice(0, 10).map((x) => <div key={x.id} className="flex justify-between text-sm"><span>{L.cycle} {x.cycle} · {L.day} {x.day}</span><span className="text-zinc-500">{x.claimDate}</span></div>) : <p className="text-sm text-zinc-500">{L.noData}</p>}</div>
        </div>
      </section>
    </main>
  );
}