"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import AuthFrame, { AuthField, authInputClass, authPrimaryClass, authSecondaryClass } from "@/components/Auth/AuthFrame";

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
    e.preventDefault(); setMsg("");
    if (password.length < 8) { setMsg("Пароль должен содержать минимум 8 символов."); return; }
    if (password !== confirm) { setMsg("Пароли не совпадают."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error === "Invalid or expired token" ? "Ссылка недействительна или срок её действия истёк. Запроси новую ссылку." : data.error === "Token already used" ? "Эта ссылка уже использована. Запроси новую, если нужно." : data.error || "Не удалось изменить пароль."); return; }
      setDone(true);
    } catch { setMsg("Не удалось подключиться к серверу. Попробуй ещё раз."); }
    finally { setLoading(false); }
  }
  return <AuthFrame eyebrow="Защита аккаунта" title={done ? "Пароль обновлён" : "Создай новый пароль"} description={done ? "Старые сеансы завершены. Теперь можно войти с новым паролем." : "Используй пароль, который не применяешь на других сайтах."}>
    <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-2xl border border-pink-400/20 bg-pink-400/[.07] text-2xl">{done ? "✓" : "⌑"}</div>
    {done ? <Link href="/login" className={authPrimaryClass}>Перейти ко входу <span>→</span></Link> : !token ? <><div role="alert" className="rounded-xl border border-amber-400/20 bg-amber-400/[.06] p-4 text-sm leading-6 text-amber-200">Ссылка для сброса отсутствует. Запроси новую — мы отправим её на почту.</div><Link href="/forgot-password" className={authPrimaryClass + " mt-4"}>Запросить новую ссылку</Link></> : <form onSubmit={submit} className="space-y-4">
      <AuthField label="НОВЫЙ ПАРОЛЬ" hint="Минимум 8 символов"><div className="relative"><input className={authInputClass + " pr-20"} type={showPw ? "text" : "password"} autoComplete="new-password" minLength={8} value={password} onChange={e => setPassword(e.target.value)} placeholder="Новый пароль" required/><button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-1 text-xs font-bold text-zinc-500 hover:text-pink-300" onClick={() => setShowPw(s => !s)}>{showPw ? "Скрыть" : "Показать"}</button></div></AuthField>
      <AuthField label="ПОВТОРИ ПАРОЛЬ"><input className={authInputClass} type={showPw ? "text" : "password"} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Ещё раз тот же пароль" required/></AuthField>
      {msg && <div role="alert" className="rounded-xl border border-red-400/20 bg-red-400/[.07] p-3 text-sm leading-5 text-red-300">{msg}</div>}
      <button disabled={loading} className={authPrimaryClass}>{loading ? "Сохраняем…" : "Сохранить новый пароль"}<span>→</span></button>
    </form>}
    <Link href="/login" className={authSecondaryClass + " mt-4"}>← Ко входу</Link>
  </AuthFrame>;
}
export const dynamic = "force-dynamic";
export default function Page() { return <Suspense fallback={<div className="min-h-screen bg-[#07070b]" />}><Content /></Suspense>; }
