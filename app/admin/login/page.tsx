"use client";
import { useState } from "react";

export default function AdminLoginPage() {
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
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
  return <main className="mx-auto min-h-screen max-w-md px-4 pb-20 pt-28"><div className="panel rounded-3xl p-6 sm:p-8"><div className="pill">DUELPLAY ADMIN</div><h1 className="mt-4 text-3xl font-black">Вход администратора</h1><p className="mt-3 text-sm leading-6 text-zinc-400">Отдельный вход для команды DuelPlay. Игровой Steam-вход не используется для административного доступа.</p>{error&&<div className="mt-5 rounded-xl border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-300">{error}</div>}<label className="mt-6 block"><span className="mb-2 block text-xs font-black uppercase tracking-widest text-zinc-500">Никнейм</span><input className="input" autoComplete="username" value={nickname} onChange={e=>setNickname(e.target.value)} /></label><label className="mt-4 block"><span className="mb-2 block text-xs font-black uppercase tracking-widest text-zinc-500">Пароль</span><input className="input" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")void login();}} /></label><button disabled={busy||!nickname||!password} onClick={()=>void login()} className="mt-6 w-full rounded-2xl bg-[var(--theme-accent)] py-3 font-black text-black disabled:opacity-40">{busy?"Вход…":"Войти"}</button></div></main>;
}
