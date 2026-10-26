"use client";
import { useEffect, useState } from "react";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [nickname, setNickname] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [nickStatus, setNickStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (!nickname || nickname.length < 3) { setNickStatus(""); return; }
    const h = setTimeout(async () => {
      setNickStatus("Проверяем никнейм…");
      try {
        const res = await fetch(`/api/auth/check-nickname?nickname=${encodeURIComponent(nickname)}`);
        const data = await res.json();
        if (data.available) setNickStatus("Никнейм свободен");
        else if (data.reason === "taken") setNickStatus("Этот никнейм уже занят");
        else setNickStatus("Используй допустимые символы");
      } catch { setNickStatus("Не удалось проверить никнейм. Попробуй ещё раз"); }
    }, 500);
    return () => clearTimeout(h);
  }, [nickname]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("Пароли не совпадают"); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, nickname }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Registration failed"); return; }
      setOk(true);
    } catch { setError("Network error"); }
    finally { setLoading(false); }
  }

  if (ok) return <main className="min-h-screen bg-black text-white flex items-center justify-center px-4 pt-24"><div className="w-full max-w-md panel rounded-3xl p-8 text-center"><h1 className="text-2xl font-black mb-4">Проверь почту</h1><p>Мы отправили код подтверждения.</p><a href={`/verify-email?email=${encodeURIComponent(email)}`} className="mt-6 inline-block text-purple-400">Подтвердить email</a></div></main>;

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-4 pt-24">
      <div className="w-full max-w-md panel rounded-3xl p-8">
        <h1 className="text-3xl font-black mb-6">Создать аккаунт</h1>
        <p className="text-sm text-zinc-400 mb-4">Твой никнейм и аватар DuelPlay будут отображаться на сайте и в игре. Выбирай имя, по которому тебя будут узнавать другие игроки</p>
        <form onSubmit={submit} className="space-y-4">
          <input className="input w-full" type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required />
          <div className="relative">
            <input className="input w-full pr-12" type={showPw?"text":"password"} placeholder="Пароль" value={password} onChange={e=>setPassword(e.target.value)} required />
            <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" onClick={()=>setShowPw(s=>!s)}>{showPw?"Скрыть":"Показать"}</button>
          </div>
          <input className="input w-full" type={showPw?"text":"password"} placeholder="Подтверждение пароля" value={confirm} onChange={e=>setConfirm(e.target.value)} required />
          <input className="input w-full" placeholder="Никнейм" value={nickname} onChange={e=>setNickname(e.target.value)} required />
          {nickStatus && <div className="text-xs text-zinc-400">{nickStatus}</div>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" required /> Согласен с условиями</label>
          <button disabled={loading} className="w-full rounded-2xl bg-purple-600 py-3 font-black">{loading?"...":"Создать аккаунт"}</button>
        </form>
        {error && <div className="mt-4 text-red-400 text-sm">{error}</div>}
        <div className="mt-6 text-center text-sm text-zinc-500">Уже есть аккаунт? <a href="/login" className="text-purple-400">Войти</a></div>
      </div>
    </main>
  );
}
