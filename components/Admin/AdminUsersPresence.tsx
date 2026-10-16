"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type PresenceUser = {
  id: string;
  nickname: string;
  avatarUrl: string;
  role: string;
  status: string;
  online: boolean;
  lastActiveAt: string | null;
};

type PresenceResponse = {
  totalUsers: number;
  onlineCount: number;
  offlineCount: number;
  page: number;
  limit: number;
  totalPages: number;
  totalFiltered: number;
  users: PresenceUser[];
};

function formatLastActive(iso: string | null): string {
  if (!iso) return "Никогда";
  try {
    const date = new Date(iso);
    const diff = Date.now() - date.getTime();
    if (diff < 60_000) return "Только что";
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)} мин. назад`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} ч. назад`;
    return date.toLocaleString();
  } catch {
    return iso;
  }
}

export default function AdminUsersPresence({ isFullPage = false }: { isFullPage?: boolean }) {
  const [data, setData] = useState<PresenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "online" | "offline">("all");
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        filter,
        search,
        page: String(page),
        limit: isFullPage ? "20" : "12",
      });
      const r = await fetch(`/api/admin/access/users?${params}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j.error || "Не удалось загрузить статус пользователей");
        return;
      }
      setData(j);
    } catch {
      setError("Ошибка сети при загрузке пользователей");
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, [filter, search, page, isFullPage]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void load(true);
      }
    }, 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchDraft.trim());
  };

  const handleFilterChange = (nextFilter: "all" | "online" | "offline") => {
    setFilter(nextFilter);
    setPage(1);
  };

  return (
    <section className="rounded-3xl border border-white/8 bg-black/20 p-5 sm:p-7 backdrop-blur-xl">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-[10px] font-black uppercase tracking-[.22em] text-[var(--theme-accent)]">
              PRESENCE · ОНЛАЙН / ОФЛАЙН
            </span>
          </div>
          <h2 className="mt-1 text-2xl font-black">Пользователи</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Реальный статус нахождения на сайте на основе активности сессий (порог: 120 сек).
          </p>
        </div>

        {/* Counter Pills */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-2xl border border-white/8 bg-white/[.025] px-3.5 py-2 text-center">
            <div className="text-[9px] font-black uppercase tracking-widest text-zinc-600">Всего</div>
            <div className="mt-0.5 text-base font-black text-white">{data?.totalUsers ?? "—"}</div>
          </div>
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[.05] px-3.5 py-2 text-center">
            <div className="flex items-center justify-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Онлайн
            </div>
            <div className="mt-0.5 text-base font-black text-emerald-300">{data?.onlineCount ?? "—"}</div>
          </div>
          <div className="rounded-2xl border border-white/8 bg-white/[.025] px-3.5 py-2 text-center">
            <div className="flex items-center justify-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-zinc-500">
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
              Офлайн
            </div>
            <div className="mt-0.5 text-base font-black text-zinc-400">{data?.offlineCount ?? "—"}</div>
          </div>
        </div>
      </div>

      {/* Controls: Search & Filter */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-xl border border-white/10 bg-black/40 p-1" role="group" aria-label="Фильтр статуса">
          <button
            type="button"
            onClick={() => handleFilterChange("all")}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${filter === "all" ? "bg-white/15 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            Все {data?.totalUsers !== undefined ? `(${data.totalUsers})` : ""}
          </button>
          <button
            type="button"
            onClick={() => handleFilterChange("online")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${filter === "online" ? "bg-emerald-400/20 text-emerald-300" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Онлайн {data?.onlineCount !== undefined ? `(${data.onlineCount})` : ""}
          </button>
          <button
            type="button"
            onClick={() => handleFilterChange("offline")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${filter === "offline" ? "bg-white/15 text-zinc-300" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
            Офлайн {data?.offlineCount !== undefined ? `(${data.offlineCount})` : ""}
          </button>
        </div>

        <form onSubmit={handleSearchSubmit} className="flex gap-2">
          <input
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Поиск по никнейму…"
            className="input h-9 w-full min-w-44 text-xs sm:w-60"
          />
          <button
            type="submit"
            className="rounded-xl bg-pink-400 px-3.5 py-1.5 text-xs font-black text-black transition hover:bg-pink-300"
          >
            Найти
          </button>
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setSearchDraft("");
                setPage(1);
              }}
              className="rounded-xl border border-white/10 px-2.5 py-1.5 text-xs text-zinc-400 hover:text-white"
            >
              ✕
            </button>
          )}
        </form>
      </div>

      {/* Content Area */}
      {error && (
        <div className="mt-5 rounded-2xl border border-red-400/25 bg-red-400/[.05] p-4 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl border border-white/5 bg-white/[.02]" />
          ))}
        </div>
      ) : !data?.users.length ? (
        <div className="mt-5 rounded-2xl border border-dashed border-white/8 p-10 text-center text-xs text-zinc-500">
          {search ? `Пользователи по запросу «${search}» не найдены.` : "В этой категории нет пользователей."}
        </div>
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {data.users.map((u) => (
            <div
              key={u.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-white/6 bg-white/[.02] p-3 transition hover:border-white/15 hover:bg-white/[.035]"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="relative shrink-0">
                  <img
                    data-player-name
                    src={u.avatarUrl}
                    alt={u.nickname}
                    className="h-10 w-10 rounded-xl object-cover"
                    onError={(e) => {
                      e.currentTarget.src = "/avatars/premium/01-cyan.svg";
                    }}
                  />
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#09090c] ${
                      u.online ? "bg-emerald-400" : "bg-zinc-600"
                    }`}
                  />
                </div>
                <div className="min-w-0">
                  <Link
                    href={`/profile/${encodeURIComponent(u.nickname)}`}
                    className="block truncate text-sm font-bold text-white hover:text-pink-300"
                  >
                    <span data-player-name>{u.nickname}</span>
                  </Link>
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span
                      className={`font-semibold ${
                        u.online ? "text-emerald-300" : "text-zinc-500"
                      }`}
                    >
                      {u.online ? "Онлайн" : "Офлайн"}
                    </span>
                    <span className="text-zinc-700">·</span>
                    <span className="truncate text-zinc-500" title={u.lastActiveAt || undefined}>
                      {formatLastActive(u.lastActiveAt)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="shrink-0 text-right">
                <span className="rounded-md border border-white/8 bg-white/[.04] px-1.5 py-0.5 text-[9px] font-black uppercase text-zinc-400">
                  {u.role}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between border-t border-white/5 pt-4 text-xs text-zinc-500">
          <div>
            Страница <span className="font-bold text-white">{data.page}</span> из{" "}
            <span className="font-bold text-white">{data.totalPages}</span> (найдено {data.totalFiltered})
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={data.page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-xl border border-white/10 px-3 py-1.5 font-bold transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
            >
              ← Назад
            </button>
            <button
              type="button"
              disabled={data.page >= data.totalPages || loading}
              onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
              className="rounded-xl border border-white/10 px-3 py-1.5 font-bold transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
            >
              Вперёд →
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
