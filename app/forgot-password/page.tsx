"use client";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setMsg("");
    try {
      await fetch("/api/auth/forgot-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      setMsg("Если email существует, ссылка отправлена");
    } catch { setMsg("Network error"); }
    finally { setLoading(false); }
  }

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-4 pt-24">
      <div className="w-full max-w-md panel rounded-3xl p-8">
        <h1 className="text-3xl font-black mb-6">Восстановить доступ</h1>
        <form onSubmit={submit} className="space-y-4">
          <input className="input w-full" type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required />
          <button disabled={loading} className="w-full rounded-2xl bg-purple-600 py-3 font-black">{loading?"...":"Отправить ссылку для сброса"}</button>
        </form>
        {msg && <div className="mt-4 text-sm">{msg}</div>}
        <div className="mt-6 text-center text-sm"><a href="/login" className="text-purple-400">Ко входу</a></div>
      </div>
    </main>
  );
}
