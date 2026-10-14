"use client";
import { useState } from "react";

export default function AdminLoginPage() {
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function login() {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/admin/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname, password }) });
      const x = await r.json().catch(() => ({}));
      if (!r.ok) { setError(x.error || "Не удалось войти."); return; }
      window.location.href = "/admin";
    } catch { setError("Не удалось войти."); } finally { setBusy(false); }
  }
  return <main className="mx-auto min-h-screen max-w-md px-4 pb-20 pt-28"><div className="panel rounded-3xl p-6 sm:p-8"><div className="pill">DUELPLAY ADMIN</div><h1 className="mt-4 text-3xl font-black">Вход администратора</h1><p className="mt-3 text-sm leading-6 text-zinc-400">Используй никнейм существующего аккаунта и свой административный пароль. Доступ определяется назначенной ролью.</p><div className="mt-4 rounded-2xl border border-white/8 bg-white/[.025] p-4 text-sm leading-6 text-zinc-400"><b className="text-white">Первый вход?</b><br/>Если тебе недавно назначили административную роль и пароль ещё не создан, попроси того, кто назначил роль, выдать персональную ссылку для первого входа. По ней ты сам создашь пароль, затем вернёшься сюда для входа.</div>{error&&<div className="mt-5 rounded-xl border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-300">{error}</div>}<label className="mt-6 block"><span className="mb-2 block text-xs font-black uppercase tracking-widest text-zinc-500">Никнейм</span><input className="input" autoComplete="username" value={nickname} onChange={e=>setNickname(e.target.value)} /></label><label className="mt-4 block"><span className="mb-2 block text-xs font-black uppercase tracking-widest text-zinc-500">Пароль</span><div className="relative"><input className="input pr-14" type={showPassword?"text":"password"} autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")void login();}} /><button type="button" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword?"Скрыть пароль":"Показать пароль"} title={showPassword?"Скрыть пароль":"Показать пароль"} className="absolute inset-y-0 right-3 grid place-items-center px-2 text-zinc-400 hover:text-white">{showPassword?"Скрыть":"Показать"}</button></div></label><button disabled={busy||!nickname||!password} onClick={()=>void login()} className="mt-6 w-full rounded-2xl bg-[var(--theme-accent)] py-3 font-black text-black disabled:opacity-40">{busy?"Вход…":"Войти"}</button></div></main>;
}
