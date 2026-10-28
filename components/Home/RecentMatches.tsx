"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/components/Common/LanguageContext";

type RecentMatch = {
  id: string;
  status: string;
  mode: string;
  mapName: string | null;
  betAmount: string | number;
  createdAt: string;
  playerOne: { nickname: string; avatarUrl: string | null };
  playerTwo: { nickname: string; avatarUrl: string | null } | null;
  winner: { nickname: string } | null;
  game?: { title: string; slug: string };
};

export default function RecentMatches() {
  const { language, t } = useLanguage();
  const [rows, setRows] = useState<RecentMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const labels = language === "RU"
    ? { title: "Последние матчи", all: "Все матчи", empty: "Пока нет завершённых матчей.", error: "Не удалось загрузить матчи", won: "Победитель", finished: "Завершён", live: "В игре", waiting: "Ожидание", ready: "Готов", cancelled: "Отменён", disputed: "Спор" }
    : language === "UA"
    ? { title: "Останні матчі", all: "Усі матчі", empty: "Поки немає завершених матчів.", error: "Не вдалося завантажити матчі", won: "Переможець", finished: "Завершено", live: "У грі", waiting: "Очікування", ready: "Готовий", cancelled: "Скасовано", disputed: "Спір" }
    : language === "PL"
    ? { title: "Ostatnie mecze", all: "Wszystkie mecze", empty: "Brak zakończonych meczów.", error: "Nie udało się wczytać meczów", won: "Zwycięzca", finished: "Zakończony", live: "W grze", waiting: "Oczekiwanie", ready: "Gotowy", cancelled: "Anulowany", disputed: "Spór" }
    : { title: "Latest matches", all: "All matches", empty: "No completed matches yet.", error: "Could not load matches", won: "Winner", finished: "Finished", live: "Live", waiting: "Waiting", ready: "Ready", cancelled: "Cancelled", disputed: "Dispute" };

  useEffect(() => {
    let active = true;
    fetch("/api/matches?recent=1", { cache: "no-store" })
      .then(async (r) => { if (!r.ok) throw new Error("RECENT_MATCHES_FAILED"); return r.json(); })
      .then((data) => { if (active) setRows(Array.isArray(data) ? data.slice(0, 5) : []); })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const statusLabel = (status: string) => status === "CANCELLED" ? labels.cancelled : status === "DISPUTED" ? labels.disputed : status === "LIVE" || status === "STARTING" ? labels.live : status === "WAITING_FOR_PLAYERS" ? labels.waiting : status === "READY" ? labels.ready : labels.finished;
  return (
    <section className="mx-auto max-w-7xl px-4 pb-8 sm:px-6" aria-labelledby="recent-matches-title">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div><span className="pill">DUELPLAY</span><h2 id="recent-matches-title" className="mt-3 text-3xl font-black">{labels.title}</h2></div>
        <Link href="/matches" className="inline-flex items-center rounded-xl border border-pink-400/25 bg-pink-400/[.06] px-4 py-2.5 text-sm font-bold text-pink-200 transition hover:border-pink-400/50 hover:bg-pink-400/[.12]">{labels.all} →</Link>
      </div>
      {loading ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{Array.from({length:5},(_,i)=><div key={i} className="h-32 animate-pulse rounded-2xl border border-white/5 bg-white/[.025]"/>)}</div>
      : failed ? <div className="panel rounded-2xl p-6 text-sm text-zinc-500">{labels.error}</div>
      : rows.length === 0 ? <div className="panel rounded-2xl p-6 text-sm text-zinc-500">{labels.empty}</div>
      : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{rows.map((m)=><Link key={m.id} href={`/matches/${m.id}`} className="panel rounded-2xl border border-white/5 p-4 transition hover:border-pink-400/25 hover:bg-pink-400/[.025]">
          <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-black uppercase tracking-wider text-zinc-500">{statusLabel(m.status)}</span><span className="text-[10px] text-zinc-600">{new Date(m.createdAt).toLocaleDateString()}</span></div>
          <div className="mt-3 truncate text-sm font-bold text-white">{m.playerOne?.nickname || "—"} <span className="text-zinc-600">vs</span> {m.playerTwo?.nickname || "—"}</div>
          <div className="mt-2 truncate text-xs text-zinc-500">{m.mapName || m.game?.title || "CS2"} · <span data-no-i18n>1v1</span></div>
          {m.winner?.nickname && <div className="mt-3 truncate text-xs text-emerald-300">{labels.won}: {m.winner.nickname}</div>}
        </Link>)}</div>}
    </section>
  );
}
