"use client";
import { Suspense } from "react";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function Content() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get("email") || "");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c-1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setMsg("");
    try {
      const res = await fetch("/api/auth/verify-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code }) });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || "Failed"); return; }
      setMsg("Email подтверждён");
      window.location.href = "/login";
    } catch { setMsg("Network error"); }
    finally { setLoading(false); }
  }

  async function resend() {
    if (cooldown > 0) return;
    setCooldown(60);
    await fetch("/api/auth/resend-verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
  }

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-4 pt-24">
      <div className="w-full max-w-md panel rounded-3xl p-8">
        <h1 className="text-3xl font-black mb-6">Подтверждение email</h1>
        <form onSubmit={submit} className="space-y-4">
          <input className="input w-full" type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required />
          <input className="input w-full" placeholder="Код" value={code} onChange={e=>setCode(e.target.value.toUpperCase())} required />
          <button disabled={loading} className="w-full rounded-2xl bg-purple-600 py-3 font-black">{loading?"...":"Подтвердить"}</button>
        </form>
        <button onClick={resend} disabled={cooldown>0} className="mt-4 text-sm text-purple-400">{cooldown>0?`Повторить через ${cooldown}s`:"Отправить код повторно"}</button>
        {msg && <div className="mt-4 text-sm">{msg}</div>}
      </div>
    </main>
  );
}
export const dynamic = "force-dynamic";

export default function Page(){return <Suspense fallback={null}><Content/></Suspense>;}
