"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AuthFrame, { AuthField, authInputClass, authPrimaryClass, authSecondaryClass } from "./AuthFrame";

const steps = [{ title: "Почта", detail: "Для защиты аккаунта" }, { title: "Игровой профиль", detail: "Как тебя увидят игроки" }, { title: "Безопасность", detail: "Создай надёжный пароль" }];

export default function RegisterPage() {
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [nickname, setNickname] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [nickStatus, setNickStatus] = useState("");
  const [nickAvailable, setNickAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);
  const [emailDeliveryIssue, setEmailDeliveryIssue] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    let active = true;
    setNickAvailable(false);
    if (!nickname || nickname.length < 3) { setNickStatus(""); return () => { active = false; }; }
    const h = setTimeout(async () => {
      if (active) setNickStatus("Проверяем никнейм…");
      try {
        const res = await fetch(`/api/auth/check-nickname?nickname=${encodeURIComponent(nickname)}`, { cache: "no-store" });
        const data = await res.json();
        // A slower response for an older nickname must never overwrite the
        // availability state for the nickname currently in the input.
        if (!active) return;
        if (data.available) { setNickAvailable(true); setNickStatus("✓ Никнейм свободен"); }
        else if (data.reason === "taken") setNickStatus("Этот никнейм уже занят");
        else setNickStatus("Используй допустимые символы (от 3 до 20)");
      } catch { if (active) setNickStatus("Не удалось проверить никнейм. Попробуй ещё раз"); }
    }, 450);
    return () => { active = false; clearTimeout(h); };
  }, [nickname]);

  function nextStep() {
    setError("");
    if (step === 0) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError("Введи корректный email."); return; }
    }
    if (step === 1) {
      if (nickname.trim().length < 3) { setError("Никнейм должен содержать не менее 3 символов."); return; }
      if (!nickAvailable) { setError("Выбери свободный никнейм перед продолжением."); return; }
    }
    setStep(s => Math.min(2, s + 1));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError("");
    if (password.length < 8) { setError("Пароль должен содержать минимум 8 символов."); return; }
    if (password !== confirm) { setError("Пароли не совпадают."); return; }
    if (!accepted) { setError("Для продолжения подтверди согласие с условиями."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), password, nickname: nickname.trim() }) });
      const data = await res.json();
      if (!res.ok) {
        if (data.userId && data.emailSent === false) { setEmailDeliveryIssue(true); setOk(true); return; }
        const raw = String(data.error || "");
        setError(raw === "Email already registered" ? "Этот email уже зарегистрирован. Попробуй войти." : raw === "Nickname already taken" ? "Никнейм уже занят — выбери другой." : raw === "Invalid nickname" ? "Никнейм содержит недопустимые символы." : raw === "Password too short" ? "Пароль должен содержать минимум 8 символов." : raw || "Не удалось создать аккаунт. Попробуй ещё раз.");
        if (raw === "Nickname already taken") setStep(1);
        return;
      }
      setOk(true);
    } catch { setError("Не удалось подключиться к серверу. Проверь интернет и повтори попытку."); }
    finally { setLoading(false); }
  }

  if (ok) return <AuthFrame eyebrow="Остался один шаг" title={emailDeliveryIssue ? "Аккаунт создан" : "Проверь почту"} description={emailDeliveryIssue ? `Аккаунт создан для ${email}, но письмо не удалось доставить автоматически.` : `Мы отправили код подтверждения на ${email}. Он действует 10 минут.`}>
    <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-2xl border border-emerald-400/20 bg-emerald-400/[.08] text-3xl text-emerald-300">✉</div>
    <div className="rounded-2xl border border-white/[.08] bg-white/[.025] p-4 text-sm leading-6 text-zinc-400">{emailDeliveryIssue ? "Перейди к подтверждению и запроси повторную отправку кода. Не создавай аккаунт заново." : "Открой письмо от DuelPlay, введи код подтверждения и твой аккаунт будет готов к игре."}</div>
    <Link href={`/verify-email?email=${encodeURIComponent(email)}`} className={authPrimaryClass + " mt-5"}>{emailDeliveryIssue ? "Перейти к повторной отправке" : "Подтвердить email"} <span>→</span></Link>
    <p className="mt-5 text-center text-xs text-zinc-600">{emailDeliveryIssue ? "Проверь также папку «Спам»." : "Не видишь письмо? Проверь папку «Спам»."}</p>
  </AuthFrame>;

  return <AuthFrame wide eyebrow="Создание игрока" title="Твоя история начинается здесь" description="Создай аккаунт DuelPlay — это займёт меньше минуты." footer={<>Уже есть аккаунт? <Link href="/login" className="font-bold text-pink-300 hover:text-pink-200">Войти</Link></>}>
    <div className="mb-7 grid grid-cols-3 gap-2">
      {steps.map((s, i) => <div key={s.title} className={`rounded-xl border p-3 transition ${i === step ? "border-pink-400/35 bg-pink-400/[.07]" : i < step ? "border-emerald-400/20 bg-emerald-400/[.04]" : "border-white/[.06] bg-black/20"}`}>
        <div className="flex items-center gap-2"><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px] font-black ${i < step ? "bg-emerald-400/15 text-emerald-300" : i === step ? "bg-pink-400 text-black" : "bg-white/[.06] text-zinc-500"}`}>{i < step ? "✓" : `0${i + 1}`}</span><span className={`text-xs font-bold ${i === step ? "text-white" : "text-zinc-500"}`}>{s.title}</span></div>
        <p className="mt-2 hidden text-[10px] text-zinc-600 sm:block">{s.detail}</p>
      </div>)}
    </div>
    <form onSubmit={step === 2 ? submit : e => { e.preventDefault(); nextStep(); }}>
      {step === 0 && <div className="space-y-4">
        <AuthField label="EMAIL" hint="Обязательно"><input className={authInputClass} type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} autoFocus required /></AuthField>
        <div className="rounded-xl border border-white/[.07] bg-white/[.025] p-4"><div className="flex items-start gap-3"><span className="mt-0.5 text-pink-300">◈</span><p className="text-xs leading-5 text-zinc-500">На эту почту придёт код подтверждения и важные уведомления о безопасности аккаунта.</p></div></div>
      </div>}
      {step === 1 && <div className="space-y-4">
        <div className="flex items-center gap-4 rounded-2xl border border-white/[.07] bg-black/25 p-4"><img src="/images/avatar-placeholder.svg" alt="Аватар по умолчанию" className="h-16 w-16 rounded-2xl border border-pink-400/20 bg-black object-cover"/><div><div className="font-bold">Твой игровой профиль</div><p className="mt-1 text-xs leading-5 text-zinc-500">Аватар можно поменять позже в настройках профиля.</p></div></div>
        <AuthField label="НИКНЕЙМ" hint="3–20 символов"><input className={authInputClass} autoComplete="nickname" maxLength={20} placeholder="Например, Keks_Pr_O" value={nickname} onChange={e => setNickname(e.target.value)} autoFocus required /></AuthField>
        {nickStatus && <p aria-live="polite" className={`-mt-2 text-xs ${nickAvailable ? "text-emerald-300" : "text-zinc-500"}`}>{nickStatus}</p>}
      </div>}
      {step === 2 && <div className="space-y-4">
        <AuthField label="ПАРОЛЬ" hint="Минимум 8 символов"><div className="relative"><input className={authInputClass + " pr-20"} type={showPw ? "text" : "password"} autoComplete="new-password" minLength={8} placeholder="Придумай пароль" value={password} onChange={e => setPassword(e.target.value)} autoFocus required/><button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-1 text-xs font-bold text-zinc-500 hover:text-pink-300" onClick={() => setShowPw(s => !s)}>{showPw ? "Скрыть" : "Показать"}</button></div></AuthField>
        <AuthField label="ПОВТОРИ ПАРОЛЬ"><input className={authInputClass} type={showPw ? "text" : "password"} autoComplete="new-password" placeholder="Ещё раз тот же пароль" value={confirm} onChange={e => setConfirm(e.target.value)} required /></AuthField>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[.07] bg-white/[.02] p-3.5"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} className="mt-1 h-4 w-4 accent-pink-400"/><span className="text-xs leading-5 text-zinc-400">Я согласен с <Link href="/terms" className="font-semibold text-pink-300 underline underline-offset-2">условиями использования</Link> и <Link href="/privacy" className="font-semibold text-pink-300 underline underline-offset-2">политикой конфиденциальности</Link>.</span></label>
      </div>}
      {error && <div role="alert" className="mt-4 rounded-xl border border-red-400/20 bg-red-400/[.07] px-4 py-3 text-sm leading-5 text-red-300">{error}</div>}
      <div className="mt-6 flex gap-3">{step > 0 && <button type="button" onClick={() => { setError(""); setStep(s => s - 1); }} className={authSecondaryClass + " w-auto min-w-28"}>← Назад</button>}{step < 2 ? <button type="submit" className={authPrimaryClass}>Продолжить <span>→</span></button> : <button type="submit" disabled={loading} className={authPrimaryClass}>{loading ? "Создаём аккаунт…" : "Создать аккаунт"}<span>→</span></button>}</div>
    </form>
    <div className="mt-5 flex items-center justify-center gap-2 text-[10px] text-zinc-600"><span className="text-emerald-300">●</span> Безопасная регистрация · Email подтверждается перед входом</div>
  </AuthFrame>;
}
