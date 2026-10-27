"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import AuthFrame, { AuthField, authInputClass, authPrimaryClass, authSecondaryClass } from "@/components/Auth/AuthFrame";

function Content() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get("email") || "");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState<"error" | "success" | "info">("info");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => { if (cooldown <= 0) return; const t = setTimeout(() => setCooldown(c => c - 1), 1000); return () => clearTimeout(t); }, [cooldown]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setMsg("");
    try {
      const res = await fetch("/api/auth/verify-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), code: code.trim().toUpperCase() }) });
      const data = await res.json();
      if (!res.ok) { setMsgType("error"); setMsg(data.error === "Invalid code" ? "Код не подошёл. Проверь письмо и попробуй ещё раз." : data.error === "Code expired or not found" || data.error === "Code expired" ? "Срок действия кода истёк или код уже использован. Запроси новый." : data.error === "Too many attempts" || data.error === "Too many requests" ? "Слишком много попыток. Подожди немного и запроси новый код." : data.error || "Не удалось подтвердить email."); return; }
      setMsgType("success"); setMsg("Email подтверждён! Сейчас перенаправим тебя ко входу.");
      window.setTimeout(() => { window.location.href = "/login"; }, 900);
    } catch { setMsgType("error"); setMsg("Не удалось подключиться к серверу. Попробуй ещё раз."); }
    finally { setLoading(false); }
  }
  async function resend() {
    if (cooldown > 0 || !email.trim()) return;
    setCooldown(60); setResending(true); setMsg("");
    try {
      const res = await fetch("/api/auth/resend-verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }) });
      if (res.ok) { setMsgType("info"); setMsg("Если для этого email нужен код, мы отправили новое письмо. Проверь также папку «Спам»."); }
      else { const data = await res.json().catch(() => ({})); setMsgType("error"); setMsg(data.error === "Please wait before resending" ? "Подожди немного перед повторной отправкой." : data.error || "Не удалось отправить код."); }
    } catch { setMsgType("error"); setMsg("Не удалось подключиться к серверу."); }
    finally { setResending(false); }
  }
  return <AuthFrame eyebrow="Почти готово" title="Подтверди email" description="Защити свой аккаунт — введи код из письма от DuelPlay. Код действует 10 минут.">
    <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-2xl border border-pink-400/20 bg-pink-400/[.07] text-2xl">✉</div>
    <form onSubmit={submit} className="space-y-4">
      <AuthField label="EMAIL"><input className={authInputClass} type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required /></AuthField>
      <AuthField label="КОД ИЗ ПИСЬМА" hint="6 символов"><input className={authInputClass + " text-center font-mono text-xl font-black tracking-[.35em] uppercase"} inputMode="text" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase())} placeholder="ABC234" required /></AuthField>
      {msg && <div role="status" className={`rounded-xl border p-3 text-sm leading-5 ${msgType === "error" ? "border-red-400/20 bg-red-400/[.07] text-red-300" : msgType === "success" ? "border-emerald-400/20 bg-emerald-400/[.06] text-emerald-200" : "border-white/[.08] bg-white/[.03] text-zinc-300"}`}>{msg}</div>}
      <button disabled={loading} className={authPrimaryClass}>{loading ? "Проверяем…" : "Подтвердить email"}<span>→</span></button>
    </form>
    <button onClick={resend} disabled={cooldown > 0 || resending || !email.trim()} className={authSecondaryClass + " mt-3"}>{resending ? "Отправляем…" : cooldown > 0 ? `Повторить отправку через ${cooldown} сек.` : "Отправить код повторно"}</button>
    <p className="mt-5 text-center text-[11px] leading-5 text-zinc-600">Не пришло письмо? Проверь папку «Спам» и правильность адреса.</p>
    <Link href="/login" className="mt-4 block text-center text-xs font-semibold text-zinc-500 hover:text-pink-300">Вернуться ко входу</Link>
  </AuthFrame>;
}
export const dynamic = "force-dynamic";
export default function Page() { return <Suspense fallback={<div className="min-h-screen bg-[#07070b]" />}><Content /></Suspense>; }
