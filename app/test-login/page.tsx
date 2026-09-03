"use client";
import { useState } from "react";

export default function TestLoginPage() {
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function login(player: "1" | "2") {
    if (!secret.trim() || busy) return;
    setBusy(player); setError("");
    try {
      const response = await fetch("/api/auth/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ player, secret: secret.trim() }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось войти");
      window.location.href = "/?intro=1";
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось войти"); }
    finally { setBusy(""); }
  }
  return <main className="min-h-screen px-4 pb-20 pt-28 text-white"><div className="mx-auto max-w-md"><div className="panel rounded-3xl p-7 sm:p-9"><span className="pill">DUELPLAY TEST</span><h1 className="mt-4 text-3xl font-black">Тестовые аккаунты</h1><p className="mt-3 text-sm leading-6 text-zinc-500">Эта страница не используется обычными игроками. Введи тестовый ключ из настроек проекта и выбери игрока.</p><input value={secret} onChange={(e)=>setSecret(e.target.value)} type="password" autoComplete="off" placeholder="Тестовый ключ" className="input mt-6"/>{error&&<div className="mt-4 rounded-xl border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-300">{error}</div>}<div className="mt-5 grid gap-3"><button disabled={!secret.trim()||Boolean(busy)} onClick={()=>login("1")} className="rounded-2xl bg-pink-400 py-4 font-black text-black disabled:opacity-40">{busy==="1"?"Входим…":"Войти как TEST_PLAYER_1"}</button><button disabled={!secret.trim()||Boolean(busy)} onClick={()=>login("2")} className="rounded-2xl border border-white/10 bg-white/5 py-4 font-black disabled:opacity-40">{busy==="2"?"Входим…":"Войти как TEST_PLAYER_2"}</button></div><p className="mt-5 text-center text-xs text-zinc-600">Тестовые аккаунты не отображаются в публичном рейтинге.</p></div></div></main>;
}
