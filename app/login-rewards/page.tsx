"use client";
import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/components/Common/LanguageContext";
import { deferEffectTask } from "@/lib/effect-defer";

type Language = "RU" | "UA" | "EN" | "PL";
type RewardFrame = { slug: string; name: string; imageUrl: string; rarity: string; unlockDay: number } | null;
type Reward = { day: number; reward: any; active: boolean; frame?: RewardFrame };
type Claim = { id: string; cycle: number; day: number; claimDate: string; claimedAt: string; reward: any };

const FRAME_PRESENTATION: Record<string, Record<Language, { name: string; description: string; rarity: string }>> = {
  "frame-neon-pulse": {
    RU: { name: "Неоновый импульс", description: "Розовая неоновая окантовка с чистыми линиями.", rarity: "Редкая" },
    UA: { name: "Неоновий імпульс", description: "Рожева неонова окантовка з чіткими лініями.", rarity: "Рідкісна" },
    EN: { name: "Neon Pulse", description: "A bright pink neon outline with clean edges.", rarity: "Rare" },
    PL: { name: "Neonowy impuls", description: "Różowa neonowa obwódka o czystych liniach.", rarity: "Rzadka" },
  },
  "frame-electric-storm": {
    RU: { name: "Электрический шторм", description: "Угловая фиолетовая рамка с электрическими акцентами.", rarity: "Эпическая" },
    UA: { name: "Електричний шторм", description: "Кутова фіолетова рамка з електричними акцентами.", rarity: "Епічна" },
    EN: { name: "Electric Storm", description: "An angular violet frame with electric accents.", rarity: "Epic" },
    PL: { name: "Elektryczna burza", description: "Kanciasta fioletowa ramka z elektrycznymi akcentami.", rarity: "Epicka" },
  },
  "frame-inferno-crown": {
    RU: { name: "Inferno Crown", description: "Корона с огненными линиями и сдержанными золотыми деталями.", rarity: "Мифическая" },
    UA: { name: "Inferno Crown", description: "Корона з вогняними лініями та стриманими золотими деталями.", rarity: "Міфічна" },
    EN: { name: "Inferno Crown", description: "A crown silhouette with ember lines and restrained gold.", rarity: "Mythic" },
    PL: { name: "Inferno Crown", description: "Korona z ognistymi liniami i stonowanymi złotymi detalami.", rarity: "Mityczna" },
  },
};

const FRAME_IMAGE_FALLBACK: Record<string, string> = {
  "frame-neon-pulse": "/images/frames/frame-neon-pulse.svg",
  "frame-electric-storm": "/images/frames/frame-electric-storm.svg",
  "frame-inferno-crown": "/images/frames/frame-inferno-crown.svg",
};

function framePresentation(slug: string, language: string) {
  const locale = (language in { RU: 1, UA: 1, EN: 1, PL: 1 } ? language : "EN") as Language;
  const fallback = FRAME_PRESENTATION[slug]?.EN ?? { name: slug, description: "Profile frame reward.", rarity: "Frame" };
  return FRAME_PRESENTATION[slug]?.[locale] ?? fallback;
}

function rewardLabel(reward: any, language: string, includeFrame = true) {
  if (!reward || typeof reward !== "object") return ({ RU: "Награда", UA: "Нагорода", EN: "Reward", PL: "Nagroda" } as Record<string, string>)[language] ?? "Reward";
  const balance = reward.balance ?? reward.coins ?? reward.amount;
  const credits = ({ RU: "DEMO-кредитов", UA: "кредитів DEMO", EN: "DEMO credits", PL: "kredytów DEMO" } as Record<string, string>)[language] ?? "DEMO credits";
  const frame = reward.cosmeticSlug ? framePresentation(String(reward.cosmeticSlug), language).name : null;
  if (balance && frame && includeFrame) return `+${balance} ${credits} + ${frame}`;
  if (balance) return `+${balance} ${credits}`;
  if (frame && includeFrame) return frame;
  if (reward.cosmeticItemId) return `${({ RU: "Рамка", UA: "Рамка", EN: "Frame", PL: "Ramka" } as Record<string, string>)[language] ?? "Frame"}: ${String(reward.cosmeticItemId)}`;
  if (reward.case || reward.caseId || reward.caseSlug) return ({ RU: "Кейс", UA: "Кейс", EN: "Case", PL: "Skrzynka" } as Record<string, string>)[language] ?? "Case";
  return ({ RU: "Награда", UA: "Нагорода", EN: "Reward", PL: "Nagroda" } as Record<string, string>)[language] ?? "Reward";
}

export default function LoginRewards() {
  const { language } = useLanguage();
  const L = {
    RU: { title: "30 дней наград", cycle: "Цикл", day: "День", balance: "DEMO-баланс", claim: "Забрать награду", claiming: "Получение…", claimedToday: "Награда за сегодня получена", loading: "Загрузка…", error: "Не удалось загрузить награды", empty: "Награды не настроены", success: "Награда получена", noData: "Нет данных", recent: "Последние награды", next: "Следующая", earned: "Награда за вход", preview: "Превью рамки", source: "Источник: DuelPlay Hub" },
    UA: { title: "30 днів нагород", cycle: "Цикл", day: "День", balance: "DEMO-баланс", claim: "Забрати нагороду", claiming: "Отримання…", claimedToday: "Нагороду за сьогодні отримано", loading: "Завантаження…", error: "Не вдалося завантажити нагороди", empty: "Нагороди не налаштовані", success: "Нагороду отримано", noData: "Немає даних", recent: "Останні нагороди", next: "Наступна", earned: "Нагорода за вхід", preview: "Попередній перегляд рамки", source: "Джерело: DuelPlay Hub" },
    EN: { title: "30 Day Rewards", cycle: "Cycle", day: "Day", balance: "DEMO balance", claim: "Claim reward", claiming: "Claiming…", claimedToday: "Today's reward claimed", loading: "Loading…", error: "Failed to load rewards", empty: "Rewards are not configured", success: "Reward claimed", noData: "No data", recent: "Recent claims", next: "Next", earned: "Login reward", preview: "Frame preview", source: "Source: DuelPlay Hub" },
    PL: { title: "30 dni nagród", cycle: "Cykl", day: "Dzień", balance: "Saldo DEMO", claim: "Odbierz nagrodę", claiming: "Odbieranie…", claimedToday: "Nagroda za dziś odebrana", loading: "Ładowanie…", error: "Nie udało się załadować nagród", empty: "Nagrody nie są skonfigurowane", success: "Nagroda odebrana", noData: "Brak danych", recent: "Ostatnie odbiory", next: "Następna", earned: "Nagroda za logowanie", preview: "Podgląd ramki", source: "Źródło: DuelPlay Hub" },
  }[language as "RU" | "UA" | "EN" | "PL"] ?? { title: "30 Day Rewards", cycle: "Cycle", day: "Day", balance: "DEMO balance", claim: "Claim reward", claiming: "Claiming…", claimedToday: "Today's reward claimed", loading: "Loading…", error: "Failed to load rewards", empty: "Rewards are not configured", success: "Reward claimed", noData: "No data", recent: "Recent claims", next: "Next", earned: "Login reward", preview: "Frame preview", source: "Source: DuelPlay Hub" };

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
      const frame = x?.row?.reward?.cosmeticSlug ? framePresentation(String(x.row.reward.cosmeticSlug), language).name : null;
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
                    <span className={`text-xs ${claimedDay ? "text-emerald-300" : reward.day === nextDay ? "text-pink-300" : "text-zinc-500"}`}>{claimedDay ? "✓" : reward.day === nextDay ? L.next : ""}</span>
                  </div>
                  <div className="mt-3 text-lg font-black">{rewardLabel(reward.reward, language, !reward.frame)}</div>
                  {reward.reward?.cosmeticSlug && (() => {
                    const slug = String(reward.reward.cosmeticSlug);
                    const presentation = framePresentation(slug, language);
                    const imageUrl = reward.frame?.imageUrl || FRAME_IMAGE_FALLBACK[slug];
                    return <div className={`mt-4 flex items-center gap-3 rounded-xl border p-3 ${reward.day === 30 ? "border-amber-300/25 bg-amber-300/[.055]" : reward.day === 15 ? "border-violet-400/25 bg-violet-400/[.05]" : "border-pink-400/25 bg-pink-400/[.045]"}`}>
                      <div className={`grid h-16 w-16 shrink-0 place-items-center rounded-xl ${reward.day === 30 ? "bg-amber-300/[.08]" : reward.day === 15 ? "bg-violet-400/[.08]" : "bg-pink-400/[.08]"}`}>
                        <img src={imageUrl} alt={`${presentation.name} — ${L.preview}`} className={`h-14 w-14 object-contain frame-glow frame-glow--${slug}`} loading="lazy" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-bold">{presentation.name}</div>
                        <div className={`mt-1 text-[10px] font-black uppercase tracking-[.16em] ${reward.day === 30 ? "text-amber-200" : reward.day === 15 ? "text-violet-300" : "text-pink-300"}`}>{presentation.rarity} · {L.earned}</div>
                        <p className="mt-1 text-xs leading-relaxed text-zinc-500">{presentation.description}</p>
                        <p className="mt-1 text-[10px] text-zinc-600">{L.source}</p>
                      </div>
                    </div>;
                  })()}
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-8 rounded-2xl bg-black/20 p-5">
          <h2 className="font-bold">{L.recent}</h2>
          <div className="mt-3 space-y-2">{claimed.length ? claimed.slice(0, 10).map((x) => <div key={x.id} className="flex justify-between text-sm"><span>{L.cycle} {x.cycle} · {L.day} {x.day}</span><span className="text-zinc-500">{x.claimDate}</span></div>) : <p className="text-sm text-zinc-500">{L.noData}</p>}</div>
        </div>
      </section>
    </main>
  );
}