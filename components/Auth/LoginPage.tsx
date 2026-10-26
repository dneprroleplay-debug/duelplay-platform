"use client";
import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "../Common/LanguageContext";

export default function LoginPage() {
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [referralCode, setReferralCode] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const steamError = params.get("error");
    if (steamError) setError(steamError);
    const ref = params.get("ref");
    if (ref) setReferralCode(ref.toUpperCase());
  }, []);

  const steamHref = useMemo(() => referralCode ? `/api/auth/steam?ref=${encodeURIComponent(referralCode)}` : "/api/auth/steam", [referralCode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Login failed"); return; }
      window.location.href = "/";
    } catch { setError("Network error"); }
    finally { setLoading(false); }
  }

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-4 pt-24">
      <div className="w-full max-w-md panel rounded-3xl p-8">
        <h1 className="text-3xl font-black mb-6">Войти в DuelPlay</h1>
        <a href={steamHref} className="flex items-center justify-center gap-3 rounded-2xl bg-[#171d25] border border-white/10 px-5 py-4 font-black hover:bg-[#1d2530]">
          <img src="/images/steam.svg" alt="Steam" className="h-7 w-7" /> Продолжить через Steam
        </a>
        <div className="my-6 text-center text-zinc-500">или</div>
        <form onSubmit={submit} className="space-y-4">
          <input className="input w-full" type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required />
          <div className="relative">
            <input className="input w-full pr-12" type={showPw?"text":"password"} placeholder="Пароль" value={password} onChange={e=>setPassword(e.target.value)} required />
            <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" onClick={()=>setShowPw(s=>!s)}>{showPw?"Скрыть":"Показать"}</button>
          </div>
          <a href="/forgot-password" className="text-sm text-purple-400">Забыли пароль?</a>
          <button disabled={loading} className="w-full rounded-2xl bg-purple-600 py-3 font-black">{loading?"...":"Войти"}</button>
        </form>
        {error && <div className="mt-4 text-red-400 text-sm">{error}</div>}
        <div className="mt-6 text-center text-sm text-zinc-500">Нет аккаунта? <a href="/register" className="text-purple-400">Создать аккаунт</a></div>
        <div className="mt-4 text-center"><a href="/" className="text-xs text-zinc-600">На главную</a></div>
      </div>
    </main>
  );
}
