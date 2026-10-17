"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/components/Common/LanguageContext";
import { DUEL_MAPS } from "@/lib/duel-maps";
import { DUEL_MODES, type DuelModeId } from "@/lib/duel-modes";
import { formatMatchAmount } from "@/lib/match-currency";

type DemoWalletView = { balance: string; lockedBalance: string; debtBalance: string };

export default function DemoCreateMatch() {
  const { language } = useLanguage();
  const [wallet, setWallet] = useState<DemoWalletView | null>(null);
  const [mapName, setMapName] = useState(DUEL_MAPS[0].serverMapName);
  const [mode, setMode] = useState<DuelModeId>("SOLO_1V1");
  const [stake, setStake] = useState("100");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [activeMatch, setActiveMatch] = useState<{ id: string; mapName?: string | null; economyMode?: string; betAmount?: string | number } | null>(null);
  const copy = language === "RU"
    ? { title: "ДЕМО-практика", subtitle: "Виртуальные кредиты без денежной стоимости и вывода.", balance: "Баланс DC", stake: "Ставка DC", map: "Карта", mode: "Режим", create: "Создать DEMO-матч", loading: "Загружаем DEMO-кошелёк…", back: "К REAL-матчам", error: "Не удалось создать DEMO-матч.", insufficient: "Недостаточно виртуальных кредитов DC для этой ставки.", disabled: "DEMO-режим временно отключён.", activeTitle: "У вас уже есть активная дуэль.", activeOpen: "Открыть матч →" }
    : language === "UA"
      ? { title: "DEMO-практика", subtitle: "Віртуальні кредити без грошової вартості та виведення.", balance: "Баланс DC", stake: "Ставка DC", map: "Мапа", mode: "Режим", create: "Створити DEMO-матч", loading: "Завантажуємо DEMO-гаманець…", back: "До REAL-матчів", error: "Не вдалося створити DEMO-матч.", insufficient: "Недостатньо віртуальних кредитів DC для цієї ставки.", disabled: "DEMO-режим тимчасово вимкнено.", activeTitle: "У вас уже є активна дуель.", activeOpen: "Відкрити матч →" }
      : language === "PL"
        ? { title: "Praktyka DEMO", subtitle: "Wirtualne kredyty bez wartości pieniężnej i wypłaty.", balance: "Saldo DC", stake: "Stawka DC", map: "Mapa", mode: "Tryb", create: "Utwórz mecz DEMO", loading: "Ładowanie portfela DEMO…", back: "Mecze REAL", error: "Nie udało się utworzyć meczu DEMO.", insufficient: "Za mało wirtualnych kredytów DC na tę stawkę.", disabled: "Tryb DEMO jest tymczasowo wyłączony.", activeTitle: "Masz już aktywny pojedynek.", activeOpen: "Otwórz mecz →" }
        : { title: "DEMO practice", subtitle: "Virtual credits have no monetary value and cannot be withdrawn.", balance: "DC balance", stake: "DC stake", map: "Map", mode: "Mode", create: "Create DEMO match", loading: "Loading DEMO wallet…", back: "REAL matches", error: "Could not create the DEMO match.", insufficient: "Not enough virtual DC credits for this stake.", disabled: "DEMO mode is temporarily disabled.", activeTitle: "You already have an active duel.", activeOpen: "Open match →" };

  // The initialisation effect below is intentionally mount-only (unchanged
  // behaviour). The localized fallback message is read through a ref instead of
  // being added to the dependency list, which would re-run the whole
  // initialisation on a language switch.
  const copyErrorRef = useRef(copy.error);
  useEffect(() => { copyErrorRef.current = copy.error; }, [copy.error]);

  useEffect(() => {
    async function loadWallet() {
      const claim = await fetch("/api/demo-wallet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "claim-starter" }) });
      const claimData = await claim.json().catch(() => ({}));
      if (!claim.ok) throw new Error(claimData.errorCode === "AUTH_REQUIRED" ? "AUTH_REQUIRED" : claimData.error || copyErrorRef.current);
      setWallet({ balance: String(claimData.balance), lockedBalance: String(claimData.lockedBalance), debtBalance: String(claimData.debtBalance) });
    }
    void (async () => {
      // Respect the global server-side DEMO kill switch before offering anything.
      let on = true;
      try {
        const status = await fetch("/api/demo-mode", { cache: "no-store" }).then(r => r.ok ? r.json() : null);
        if (status && status.enabled === false) on = false;
      } catch {}
      setEnabled(on);
      if (!on) return;
      try {
        // A player with any active duel (REAL or DEMO) must be offered a way
        // back into it instead of triggering a duplicate-create rejection.
        const active = await fetch("/api/matches?mine=active", { cache: "no-store" }).then(r => r.ok ? r.json() : null).catch(() => null);
        if (active?.active && active.match?.id) setActiveMatch(active.match);
      } catch {}
      try { await loadWallet(); } catch (error) { setMessage(error instanceof Error ? error.message : copyErrorRef.current); }
    })();
  }, []);

  async function create() {
    const amount = Number(stake);
    if (!Number.isFinite(amount) || amount < 3 || amount > 10000 || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ economyMode: "DEMO", mode, mapName, betAmount: amount, format: "1v1" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.errorCode === "INSUFFICIENT_DEMO_BALANCE" ? copy.insufficient : data.error || copy.error);
      window.location.assign(`/matches/${data.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : copy.error);
    } finally {
      setBusy(false);
    }
  }

  return <main className="mx-auto min-h-screen max-w-3xl px-4 pb-20 pt-28 sm:px-6">
    <section className="panel rounded-3xl border border-pink-400/20 p-6 sm:p-9">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><span className="pill">DEMO · VIRTUAL ONLY</span><h1 className="mt-4 text-3xl font-black">{copy.title}</h1><p className="mt-2 text-sm text-zinc-400">{copy.subtitle}</p></div>
        <Link href="/matches" className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-zinc-300">{copy.back}</Link>
      </div>
      {enabled===false?<p className="mt-6 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm font-bold text-amber-300">{copy.disabled}</p>:<>
      {activeMatch&&<div className="mt-6 flex flex-col gap-3 rounded-2xl border border-pink-400/30 bg-pink-400/[.07] p-4 sm:flex-row sm:items-center sm:justify-between"><div><b className="text-sm text-pink-200">{copy.activeTitle}</b><p className="mt-0.5 text-xs text-zinc-400">{activeMatch.mapName||"CS2"} · {activeMatch.economyMode==="DEMO"?"DEMO":"REAL"} · <span data-no-i18n>{formatMatchAmount(activeMatch.economyMode==="DEMO"?"DEMO":"REAL",activeMatch.betAmount ?? 0)}</span></p></div><Link href={`/matches/${activeMatch.id}`} className="inline-flex items-center justify-center rounded-xl bg-pink-400 px-5 py-2.5 text-xs font-black text-black shadow-lg shadow-pink-500/20 transition hover:bg-pink-300">{copy.activeOpen}</Link></div>}
      {wallet ? <div className="mt-6 rounded-2xl border border-pink-400/15 bg-pink-400/[.04] p-4 text-sm">{copy.balance}: <b data-no-i18n className="text-pink-200">{formatMatchAmount("DEMO",wallet.balance)}</b>{Number(wallet.debtBalance) > 0 && <div className="mt-1 text-xs text-amber-300">DEMO recovery balance: <span data-no-i18n>{formatMatchAmount("DEMO",wallet.debtBalance)}</span></div>}</div> : <p className="mt-6 text-sm text-zinc-500">{message || copy.loading}</p>}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-bold text-zinc-500">{copy.stake}<input className="input mt-2" type="number" min="3" max="10000" step="0.01" value={stake} onChange={event => setStake(event.target.value)} /></label>
        <label className="text-xs font-bold text-zinc-500">{copy.map}<select className="input mt-2" value={mapName} onChange={event => setMapName(event.target.value)}>{DUEL_MAPS.map(item => <option key={item.id} value={item.serverMapName}>{item.displayName}</option>)}</select></label>
        <label className="text-xs font-bold text-zinc-500 sm:col-span-2">{copy.mode}<select className="input mt-2" value={mode} onChange={event => setMode(event.target.value as DuelModeId)}>{DUEL_MODES.map(item => <option data-no-i18n key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      </div>
      {message && <p data-no-i18n role="alert" className="mt-4 text-sm text-red-300">{message}</p>}
      <button disabled={!wallet || busy || Boolean(activeMatch) || Number(stake) > Number(wallet.balance)} onClick={create} className="mt-6 w-full rounded-xl bg-pink-400 py-4 font-black text-black disabled:cursor-not-allowed disabled:opacity-40">{busy ? "…" : copy.create}</button>
      </>}
    </section>
  </main>;
}
