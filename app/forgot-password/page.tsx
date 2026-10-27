"use client";
import { useState } from "react";
import Link from "next/link";
import AuthFrame, { AuthField, authInputClass, authPrimaryClass, authSecondaryClass } from "@/components/Auth/AuthFrame";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setMsg("");
    try {
      const res = await fetch("/api/auth/forgot-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }) });
      if (res.status === 429) { setMsg("Слишком много запросов. Подожди немного и попробуй снова."); return; }
      setSent(true); setMsg("Запрос обработан. Проверь входящие сообщения и папку «Спам». Если письмо не пришло, проверь адрес и попробуй ещё раз.");
    } catch { setMsg("Не удалось подключиться к серверу. Попробуй ещё раз."); }
    finally { setLoading(false); }
  }
  return <AuthFrame eyebrow="Восстановление доступа" title={sent ? "Проверь свою почту" : "Забыл пароль?"} description={sent ? "Осталось проверить входящие сообщения." : "Ничего страшного — поможем безопасно вернуть доступ к аккаунту."}>
    <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-2xl border border-pink-400/20 bg-pink-400/[.07] text-2xl">{sent ? "✉" : "⌁"}</div>
    {!sent && <form onSubmit={submit} className="space-y-4"><AuthField label="EMAIL АККАУНТА"><input className={authInputClass} type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required /></AuthField><button disabled={loading} className={authPrimaryClass}>{loading ? "Отправляем…" : "Отправить ссылку"}<span>→</span></button></form>}
    {msg && <div role="status" className="mt-4 rounded-xl border border-emerald-400/15 bg-emerald-400/[.05] p-4 text-sm leading-6 text-zinc-300">{msg}</div>}
    {sent && <button onClick={() => { setSent(false); setMsg(""); }} className={authSecondaryClass + " mt-4"}>Использовать другой email</button>}
    <Link href="/login" className={authSecondaryClass + " mt-4"}>← Вернуться ко входу</Link>
  </AuthFrame>;
}
