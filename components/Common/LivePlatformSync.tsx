"use client";

import { useEffect, useRef, useState } from "react";

export default function LivePlatformSync() {
  const versionRef = useRef("");
  const initializedRef = useRef(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    let disposed = false;
    let loading = false;

    const check = async () => {
      if (disposed || loading || document.visibilityState === "hidden") return;
      loading = true;

      try {
        const response = await fetch(`/api/platform-version?ts=${Date.now()}`, {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });
        if (!response.ok) return;

        const data = await response.json();
        const nextVersion = String(data.version || "");
        if (!nextVersion) return;

        if (!initializedRef.current) {
          versionRef.current = nextVersion;
          initializedRef.current = true;
          return;
        }

        if (versionRef.current && nextVersion !== versionRef.current) {
          versionRef.current = nextVersion;
          setUpdateAvailable(true);
        }
      } catch {
        // Temporary network failure: keep checking.
      } finally {
        loading = false;
      }
    };

    void check();
    const timer = window.setInterval(() => { void check(); }, 15000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  if (!updateAvailable) return null;

  return (
    <div role="status" aria-live="polite" className="fixed bottom-4 right-4 z-[200] w-[min(420px,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-[#09090c]/95 p-4 text-white shadow-2xl backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black">{"\u0414\u043E\u0441\u0442\u0443\u043F\u043D\u043E \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435 DuelPlay"}</div>
          <p className="mt-1 text-sm leading-5 text-zinc-400">{"\u041D\u043E\u0432\u0430\u044F \u0432\u0435\u0440\u0441\u0438\u044F \u0433\u043E\u0442\u043E\u0432\u0430. \u0421\u0442\u0440\u0430\u043D\u0438\u0446\u0430 \u043D\u0435 \u0431\u0443\u0434\u0435\u0442 \u043F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0436\u0430\u0442\u044C\u0441\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u2014 \u043E\u0431\u043D\u043E\u0432\u0438\u0441\u044C, \u043A\u043E\u0433\u0434\u0430 \u0431\u0443\u0434\u0435\u0442 \u0443\u0434\u043E\u0431\u043D\u043E."}</p>
        </div>
        <button type="button" aria-label={"\u0421\u043A\u0440\u044B\u0442\u044C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u043E\u0431 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0438"} onClick={() => setUpdateAvailable(false)} className="rounded-lg px-2 py-1 text-zinc-500 hover:bg-white/10 hover:text-white">{"\u00D7"}</button>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={() => setUpdateAvailable(false)} className="rounded-xl border border-white/10 px-3 py-2 text-sm font-bold text-zinc-300 hover:bg-white/5">{"\u041F\u043E\u0437\u0436\u0435"}</button>
        <button type="button" onClick={() => window.location.reload()} className="rounded-xl bg-[var(--theme-accent)] px-4 py-2 text-sm font-black text-black">{"\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443"}</button>
      </div>
    </div>
  );
}
