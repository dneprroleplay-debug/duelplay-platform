"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AuthFrame, { AuthField, authInputClass, authPrimaryClass, authSecondaryClass } from "./AuthFrame";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [referralCode, setReferralCode] = useState("");
  const router = useRouter();
  const steamPopupRef = useRef<Window | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const steamError = params.get("error");
    if (steamError) setError(steamError === "account_disabled" ? "Этот аккаунт временно отключён. Обратись в поддержку." : steamError === "steam_verify" ? "Не удалось проверить авторизацию Steam. Попробуй ещё раз." : steamError === "steam_state" ? "Сессия Steam устарела. Запусти вход ещё раз." : "Не удалось войти через Steam. Попробуй ещё раз.");
    const ref = params.get("ref");
    if (ref) setReferralCode(ref.toUpperCase());
  }, []);

  const steamHref = useMemo(() => referralCode ? `/api/auth/steam?ref=${encodeURIComponent(referralCode)}` : "/api/auth/steam", [referralCode]);

  useEffect(() => {
    const onSteamAuthMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!steamPopupRef.current || event.source !== steamPopupRef.current) return;
      if (!event.data || event.data.type !== "duelplay:steam-auth-complete") return;
      steamPopupRef.current = null;
      void (async () => {
        try {
          const response = await fetch("/api/auth/me", { cache: "no-store" });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data.user) {
            setError("Steam вернул управление, но сессию подтвердить не удалось. Попробуй войти ещё раз.");
            return;
          }
          window.dispatchEvent(new Event("duelplay:auth-changed"));
          router.replace("/");
        } catch {
          setError("Не удалось обновить состояние входа. Обнови страницу и проверь авторизацию.");
        }
      })();
    };
    window.addEventListener("message", onSteamAuthMessage);
    return () => window.removeEventListener("message", onSteamAuthMessage);
  }, [router]);

  function openSteamLogin(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    const popup = window.open(steamHref, "_blank", "popup,width=520,height=720,resizable=yes,scrollbars=yes");
    if (!popup) {
      // Preserve the original same-tab OAuth flow when popups are blocked.
      window.location.href = steamHref;
      return;
    }
    steamPopupRef.current = popup;
    try { popup.focus(); } catch {}
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError("");
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = await res.json();
      if (!res.ok) {
        const raw = String(data.error || "");
        setError(raw === "Invalid credentials" ? "Неверный email или пароль." : raw === "Email not verified" ? "Сначала подтверди email по коду из письма." : raw === "Account disabled" || raw === "account_disabled" ? "Этот аккаунт временно отключён. Обратись в поддержку." : raw === "Too many requests" ? "Слишком много попыток. Подожди немного и попробуй снова." : raw || "Не удалось войти. Проверь данные и попробуй ещё раз.");
        return;
      }
      window.location.href = "/";
    } catch { setError("Не удалось подключиться к серверу. Проверь интернет и повтори попытку."); }
    finally { setLoading(false); }
  }

  return <AuthFrame eyebrow="С возвращением" title="Войти в DuelPlay" description="Продолжай играть, находи соперников и возвращайся к своим дуэлям." footer={<>Впервые здесь? <Link href="/register" className="font-bold text-pink-300 transition hover:text-pink-200">Создать аккаунт</Link></>}>
    <a href={steamHref} target="_blank" rel="noopener noreferrer" onClick={openSteamLogin} className={authSecondaryClass + " border-white/15 bg-[#171d25] hover:border-white/25 hover:bg-[#202936]"}>
      <img src="/images/steam.svg" alt="" className="h-6 w-6" /> Продолжить через Steam <span className="ml-auto text-zinc-500">↗</span>
    </a>
    <div className="my-6 flex items-center gap-3 text-[10px] font-bold uppercase tracking-[.2em] text-zinc-600"><span className="h-px flex-1 bg-white/[.08]" />или по email<span className="h-px flex-1 bg-white/[.08]" /></div>
    <form onSubmit={submit} className="space-y-4">
      <AuthField label="EMAIL"><input className={authInputClass} type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required /></AuthField>
      <AuthField label="ПАРОЛЬ"><div className="relative"><input className={authInputClass + " pr-20"} type={showPw ? "text" : "password"} autoComplete="current-password" placeholder="Твой пароль" value={password} onChange={e => setPassword(e.target.value)} required /><button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-bold text-zinc-500 hover:text-pink-300" onClick={() => setShowPw(s => !s)}>{showPw ? "Скрыть" : "Показать"}</button></div></AuthField>
      <div className="-mt-1 flex justify-end"><Link href="/forgot-password" className="text-xs font-semibold text-pink-300 hover:text-pink-200">Забыли пароль?</Link></div>
      {error && <div role="alert" className="rounded-xl border border-red-400/20 bg-red-400/[.07] px-4 py-3 text-sm leading-5 text-red-300">{error}</div>}
      <button disabled={loading} className={authPrimaryClass}>{loading ? "Входим…" : "Войти в аккаунт"}<span aria-hidden>→</span></button>
    </form>
    <p className="mt-5 text-center text-[11px] leading-5 text-zinc-600">Защищённый вход · Мы никогда не просим пароль Steam на сторонних страницах.</p>
  </AuthFrame>;
}
