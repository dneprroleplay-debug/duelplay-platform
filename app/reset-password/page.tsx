"use client";
import { Suspense } from "react";
import { useState } from "react";
import { useSearchParams } from "next/navigation";

function Content() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setMsg("Пароли не совпадают"); return; }
    setLoading(true); setMsg("");
    try {
      const res = await fetch("/api/auth/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || "Failed"); return; }
      setDone(true);
    } catch { setMsg("Network error"); }
    finally { setLoading(false); }
  }

  if (done) return <main className="min-h-screen bg-black text-white flex items-center justify-center px-4 pt-24"><div className="w-full max-w-md panel rounded-3xl p-8 text-center"><h1 className="text-2xl font-black mb-4">Пароль сброшен</h1><a href="/login" className="text-purple-400">Войти</a></div></main>;

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-4 pt-24">
      <div className="w-full max-w-md panel rounded-3xl p-8">
        <h1 className="text-3xl font-black mb-6">Новый пароль</h1>
        <form onSubmit={submit} className="space-y-4">
          <div className="relative">
            <input className="input w-full pr-12" type={showPw?"text":"password"} placeholder="Новый пароль" value={password} onChange={e=>setPassword(e.target.value)} required />
            <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" onClick={()=>setShowPw(s=>!s)}>{showPw?"Скрыть":"Показать"}</button>
          </div>
          <input className="input w-full" type={showPw?"text":"password"} placeholder="Подтверждение" value={confirm} onChange={e=>setConfirm(e.target.value)} required />
          <button disabled={loading} className="w-full rounded-2xl bg-purple-600 py-3 font-black">{loading?"...":"Сбросить"}</button>
        </form>
        {msg && <div className="mt-4 text-sm text-red-400">{msg}</div>}
      </div>
    </main>
  );
}
export const dynamic = "force-dynamic";

export default function Page(){return <Suspense fallback={null}><Content/></Suspense>;}
