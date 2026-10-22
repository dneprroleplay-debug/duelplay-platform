"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useLanguage } from "@/components/Common/LanguageContext";
import { getDuelMap } from "@/lib/duel-maps";
import { DUEL_MODES } from "@/lib/duel-modes";
import { formatMatchAmount } from "@/lib/match-currency";

type HistoryMatch = {
  id: string;
  economyMode: "REAL" | "DEMO";
  status: string;
  mapName: string | null;
  mode: string;
  betAmount: string | number;
  playerOneId: string;
  playerTwoId: string | null;
  playerOne: { id: string; nickname: string; avatarUrl: string | null };
  playerTwo: { id: string; nickname: string; avatarUrl: string | null } | null;
  winner: { id: string; nickname: string } | null;
  createdAt: string;
};

type HistoryFilter = "all" | "finished" | "cancelled" | "disputed";
type HistoryResponse = { matches: HistoryMatch[]; nextCursor: string | null; hasMore: boolean; restricted: boolean; hidden: boolean; userId?: string };

const FILTERS: Array<{ id: HistoryFilter; labelKey: string }> = [
  { id: "all", labelKey: "all" },
  { id: "finished", labelKey: "finished" },
  { id: "cancelled", labelKey: "cancelled" },
  { id: "disputed", labelKey: "disputed" },
];

const COPY = {
  RU: {
    recentTitle: "Последние матчи", recentSubtitle: "Пять последних записей вашей истории.",
    title: "История матчей", subtitle: "Все завершённые, отменённые и спорные дуэли.",
    all: "Все", finished: "Завершённые", cancelled: "Отменённые", disputed: "Споры",
    win: "Победа", loss: "Поражение", draw: "Ничья", cancelledStatus: "Отменён", disputedStatus: "Спор",
    empty: "История матчей пока пуста.", login: "Войдите, чтобы увидеть историю матчей.",
    loading: "Загрузка…", more: "Загрузить ещё", noMore: "Это все матчи", opponent: "Соперник",
    stake: "Ставка", open: "Открыть матч", allMatches: "Все матчи", recentEmpty: "Пока нет сыгранных матчей.",
    privateHistory: "История матчей скрыта настройками приватности.", hiddenHistory: "Игрок скрыл публичную статистику.",
  },
  UA: {
    recentTitle: "Останні матчі", recentSubtitle: "П’ять останніх записів вашої історії.",
    title: "Історія матчів", subtitle: "Усі завершені, скасовані та спірні дуелі.",
    all: "Усі", finished: "Завершені", cancelled: "Скасовані", disputed: "Спори",
    win: "Перемога", loss: "Поразка", draw: "Нічия", cancelledStatus: "Скасовано", disputedStatus: "Спір",
    empty: "Історія матчів поки порожня.", login: "Увійдіть, щоб побачити історію матчів.",
    loading: "Завантаження…", more: "Завантажити ще", noMore: "Це всі матчі", opponent: "Суперник",
    stake: "Ставка", open: "Відкрити матч", allMatches: "Усі матчі", recentEmpty: "Поки немає зіграних матчів.",
    privateHistory: "Історія матчів прихована налаштуваннями приватності.", hiddenHistory: "Гравець приховав публічну статистику.",
  },
  PL: {
    recentTitle: "Ostatnie mecze", recentSubtitle: "Pięć ostatnich wpisów Twojej historii.",
    title: "Historia meczów", subtitle: "Wszystkie zakończone, anulowane i sporne pojedynki.",
    all: "Wszystkie", finished: "Zakończone", cancelled: "Anulowane", disputed: "Spory",
    win: "Zwycięstwo", loss: "Porażka", draw: "Remis", cancelledStatus: "Anulowany", disputedStatus: "Spór",
    empty: "Historia meczów jest jeszcze pusta.", login: "Zaloguj się, aby zobaczyć historię meczów.",
    loading: "Ładowanie…", more: "Załaduj więcej", noMore: "To wszystkie mecze", opponent: "Przeciwnik",
    stake: "Stawka", open: "Otwórz mecz", allMatches: "Wszystkie mecze", recentEmpty: "Brak rozegranych meczów.",
    privateHistory: "Historia meczów jest ukryta przez ustawienia prywatności.", hiddenHistory: "Gracz ukrył publiczne statystyki.",
  },
  EN: {
    recentTitle: "Recent matches", recentSubtitle: "The five latest entries of your history.",
    title: "Match history", subtitle: "Every finished, cancelled and disputed duel.",
    all: "All", finished: "Finished", cancelled: "Cancelled", disputed: "Disputes",
    win: "Victory", loss: "Loss", draw: "Draw", cancelledStatus: "Cancelled", disputedStatus: "Dispute",
    empty: "No match history yet.", login: "Log in to see your match history.",
    loading: "Loading…", more: "Load more", noMore: "That is every match", opponent: "Opponent",
    stake: "Stake", open: "Open match", allMatches: "All matches", recentEmpty: "No played matches yet.",
    privateHistory: "Match history is hidden by privacy settings.", hiddenHistory: "This player hides public statistics.",
  },
} as const;

function emptyResponse(): HistoryResponse {
  return { matches: [], nextCursor: null, hasMore: false, restricted: false, hidden: false };
}

export default function MatchHistory({variant="both", nickname, embedded=false}:{variant?:"recent"|"full"|"both"; nickname?:string; embedded?:boolean}) {
  const { language } = useLanguage();
  const copy = COPY[language as keyof typeof COPY] || COPY.EN;
  const [recent, setRecent] = useState<HistoryMatch[]>([]);
  const [matches, setMatches] = useState<HistoryMatch[]>([]);
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [restricted, setRestricted] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadHistory = useCallback(async (nextFilter: HistoryFilter, nextCursor: string | null, append: boolean) => {
    const query = new URLSearchParams({ status: nextFilter, economyMode: "ALL", limit: "20" });
    if (nextCursor) query.set("cursor", nextCursor);
    const endpoint = nickname
      ? `/api/profile/${encodeURIComponent(nickname)}/history?${query.toString()}`
      : `/api/matches?mine=history&${query.toString()}`;
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) return emptyResponse();
    const data = (await response.json().catch(() => emptyResponse())) as HistoryResponse;
    return {
      matches: Array.isArray(data.matches) ? data.matches : [],
      nextCursor: data.nextCursor ?? null,
      hasMore: Boolean(data.hasMore),
      restricted: Boolean(data.restricted),
      hidden: Boolean(data.hidden),
      userId: typeof data.userId === "string" ? data.userId : null,
    };
  }, [nickname]);

  useEffect(() => {
    let disposed = false;
    async function load() {
      const [meResponse, recentResponse] = await Promise.all([
        fetch("/api/auth/me", { cache: "no-store" }),
        loadHistory("all", null, false),
      ]);
      const me = await meResponse.json().catch(() => ({}));
      if (disposed) return;
      const viewerId = me.user?.id ?? null;
      setUserId(viewerId);
      setSubjectId(nickname ? recentResponse.userId : viewerId);
      setLoggedIn(nickname ? true : Boolean(me.user));
      setRestricted(recentResponse.restricted);
      setHidden(recentResponse.hidden);
      setRecent(recentResponse.matches.slice(0, 5));
      setMatches(recentResponse.matches);
      setCursor(recentResponse.nextCursor);
      setHasMore(recentResponse.hasMore);
      setLoading(false);
    }
    void load();
    return () => { disposed = true; };
  }, [loadHistory, nickname]);

  useEffect(() => {
    if (loggedIn !== true) return;
    let disposed = false;
    async function applyFilter() {
      const result = await loadHistory(filter, null, false);
      if (disposed) return;
      setRestricted(result.restricted);
      setHidden(result.hidden);
      if (result.userId) setSubjectId(result.userId);
      setMatches(result.matches);
      setCursor(result.nextCursor);
      setHasMore(result.hasMore);
    }
    void applyFilter();
    return () => { disposed = true; };
  }, [filter, loggedIn, loadHistory]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await loadHistory(filter, cursor, true);
      setMatches(current => {
        const seen = new Set(current.map(match => match.id));
        return [...current, ...result.matches.filter(match => !seen.has(match.id))];
      });
      setCursor(result.nextCursor);
      setHasMore(result.hasMore);
      if (result.userId) setSubjectId(result.userId);
    } finally {
      setLoadingMore(false);
    }
  }

  function resultLabel(match: HistoryMatch) {
    if (match.status === "DISPUTED") return copy.disputedStatus;
    if (match.status === "CANCELLED") return copy.cancelledStatus;
    if (!match.winner) return copy.draw;
    return match.winner.id === (subjectId ?? userId) ? copy.win : copy.loss;
  }

  function tone(match: HistoryMatch) {
    const label = resultLabel(match);
    if (label === copy.win) return "text-emerald-300";
    if (label === copy.loss) return "text-red-300";
    return "text-amber-300";
  }

  function renderCard(match: HistoryMatch) {
    const map = getDuelMap(match.mapName);
    const mode = DUEL_MODES.find(item => item.id === match.mode);
    const opponent = match.playerOneId === (subjectId ?? userId) ? match.playerTwo : match.playerOne;
    return <Link href={`/matches/${match.id}`} className="group flex items-center gap-4 rounded-2xl border border-white/5 bg-white/[.025] p-3 transition hover:border-[var(--theme-accent)]/25 hover:bg-white/[.045]">
      <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-xl bg-black">
        <Image src={map?.image || "/images/maps/aim_redline.png"} alt={map?.displayName || match.mapName || ""} fill sizes="(max-width:640px) 100vw, 112px" className="object-cover transition duration-300 group-hover:scale-105"/>
        {match.economyMode === "DEMO" && <span className="absolute left-1.5 top-1.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[9px] font-black text-pink-200">DEMO</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><b data-no-i18n className="truncate">{map?.displayName || match.mapName || "CS2"}</b><span className={`text-[10px] font-black uppercase tracking-wider ${tone(match)}`}>{resultLabel(match)}</span></div>
        <div className="mt-1 truncate text-xs text-zinc-500">{mode?.label || match.mode} · {copy.opponent}: <span data-no-i18n>{opponent?.nickname || "—"}</span></div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400"><span>{copy.stake}: <b data-no-i18n>{formatMatchAmount(match.economyMode, match.betAmount)}</b></span><span>·</span><span>{new Date(match.createdAt).toLocaleDateString()}</span></div>
      </div>
      <span className="shrink-0 text-xs font-bold text-[var(--theme-accent)]">{copy.open} →</span>
    </Link>;
  }

  const allHref = nickname ? `/profile/${encodeURIComponent(nickname)}/history` : "/matches";

  return <>
    {variant!=="full"&&<section className={embedded ? "" : "mx-auto max-w-7xl px-4 pt-10 sm:px-6"}>
      <div className={`panel rounded-3xl ${embedded ? "p-5 sm:p-6" : "p-6 sm:p-7"}`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><span className="pill">RECENT</span><h2 className="mt-3 text-2xl font-black">{copy.recentTitle}</h2><p className="mt-2 text-sm text-zinc-500">{copy.recentSubtitle}</p></div>
          <div className="flex items-center gap-3">{loggedIn && <span className="text-xs font-bold text-zinc-500">{recent.length}/5</span>}<Link href={allHref} className="rounded-xl border border-pink-400/30 px-4 py-2 text-xs font-black text-pink-200 transition hover:bg-pink-400/10">{copy.allMatches} →</Link></div>
        </div>
        {loading ? <p className="mt-5 text-sm text-zinc-500">{copy.loading}</p>
          : restricted ? <p className="mt-5 rounded-2xl border border-white/5 p-6 text-sm text-zinc-500">{copy.privateHistory}</p>
          : hidden ? <p className="mt-5 rounded-2xl border border-white/5 p-6 text-sm text-zinc-500">{copy.hiddenHistory}</p>
          : loggedIn === false ? <p className="mt-5 rounded-2xl border border-white/5 p-6 text-sm text-zinc-500">{copy.login}</p>
          : recent.length ? <div className="mt-5 space-y-3">{recent.map(match => renderCard(match))}</div>
          : <p className="mt-5 rounded-2xl border border-white/5 p-6 text-sm text-zinc-500">{copy.recentEmpty}</p>}
      </div>
    </section>}
    {variant!=="recent"&&<section className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
      <div className="panel rounded-3xl p-6 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><span className="pill">HISTORY</span><h2 className="mt-3 text-2xl font-black">{copy.title}</h2><p className="mt-2 text-sm text-zinc-500">{copy.subtitle}</p></div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label={copy.title}>
          {FILTERS.map(option => <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={filter === option.id}
            onClick={() => setFilter(option.id)}
            className={`rounded-full border px-4 py-2 text-xs font-black transition ${filter === option.id ? "border-[var(--theme-accent)]/40 bg-[var(--theme-accent-bg)] text-[var(--theme-accent)]" : "border-white/10 text-zinc-400 hover:border-white/20"}`}
          >{copy[option.labelKey as keyof typeof copy]}</button>)}
        </div>
        {loading ? <p className="mt-5 text-sm text-zinc-500">{copy.loading}</p>
          : restricted ? <p className="mt-5 rounded-2xl border border-white/5 p-6 text-sm text-zinc-500">{copy.privateHistory}</p>
          : hidden ? <p className="mt-5 rounded-2xl border border-white/5 p-6 text-sm text-zinc-500">{copy.hiddenHistory}</p>
          : loggedIn === false ? <p className="mt-5 rounded-2xl border border-white/5 p-6 text-sm text-zinc-500">{copy.login}</p>
          : matches.length ? <>
            <div className="mt-5 space-y-3">{matches.map(match => renderCard(match))}</div>
            {hasMore ? <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="mt-5 w-full rounded-2xl border border-white/10 py-3 text-sm font-black transition hover:border-[var(--theme-accent)]/35 disabled:opacity-50">{loadingMore ? copy.loading : copy.more}</button>
              : <p className="mt-5 text-center text-xs text-zinc-600">{copy.noMore}</p>}
          </> : <p className="mt-5 rounded-2xl border border-white/5 p-6 text-sm text-zinc-500">{copy.empty}</p>}
      </div>
    </section>}
  </>;
}
