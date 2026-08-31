"use client";
import { FormEvent,useEffect,useState } from "react";
import { useLanguage } from "../Common/LanguageContext";

export default function AuthPanel({mode}:{mode:"login"|"register"}){
  const{t}=useLanguage();
  const[login,setLogin]=useState(""); const[nickname,setNickname]=useState(""); const[email,setEmail]=useState("");
  const[password,setPassword]=useState(""); const[confirm,setConfirm]=useState(""); const[referralCode,setReferralCode]=useState("");
  const[error,setError]=useState(""); const[busy,setBusy]=useState(false);
  useEffect(()=>{const params=new URLSearchParams(window.location.search);const steamError=params.get("error");if(steamError)setError(steamError==="steam_verify"?t.steamVerifyError:steamError==="steam_state"?t.steamStateError:steamError==="account_disabled"?t.accountDisabled:t.steamError);if(mode!=="register")return;const ref=params.get("ref");if(ref)setReferralCode(ref.toUpperCase())},[mode,t]);
  async function submit(e:FormEvent){e.preventDefault();setError("");if(mode==="register"&&password!==confirm){setError(t.passwordMismatch);return}setBusy(true);try{const body=mode==="login"?{login,password}:{nickname,email,password,referralCode:referralCode.trim().toUpperCase()};const r=await fetch(`/api/auth/${mode}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error);location.href="/"}catch(e){setError(e instanceof Error?e.message:"Error")}finally{setBusy(false)}}
  const steamHref=mode==="register"&&referralCode?`/api/auth/steam?ref=${encodeURIComponent(referralCode)}`:"/api/auth/steam";
  return <div className="mx-auto max-w-md pt-10"><div className="panel rounded-3xl p-7 sm:p-9"><span className="pill">DUELPLAY</span><h1 className="mt-4 text-3xl font-black">{mode==="login"?t.authLogin:t.authRegister}</h1>
    <a href={steamHref} className="mt-7 flex items-center justify-center gap-3 rounded-2xl border border-white/10 bg-[#171d25] px-5 py-4 font-black text-white transition hover:border-white/25 hover:bg-[#1d2530]"><img src="/images/steam.svg" alt="Steam" className="h-7 w-7"/>{mode==="login"?t.loginSteam:t.registerSteam}</a>
    <div className="my-6 flex items-center gap-3 text-xs text-zinc-600"><span className="h-px flex-1 bg-white/8"/><span>{t.or}</span><span className="h-px flex-1 bg-white/8"/></div>
    <form onSubmit={submit} className="space-y-4">
      {mode==="register"&&<><Field label={t.nickname}><input required minLength={3} maxLength={20} className="input" value={nickname} onChange={e=>setNickname(e.target.value)} /></Field><Field label={t.email}><input required type="email" className="input" value={email} onChange={e=>setEmail(e.target.value)} /></Field></>}
      {mode==="login"&&<Field label={`${t.email} / ${t.nickname}`}><input required className="input" value={login} onChange={e=>setLogin(e.target.value)} /></Field>}
      <Field label={t.password}><input required minLength={8} type="password" className="input" value={password} onChange={e=>setPassword(e.target.value)} /></Field>
      {mode==="register"&&<><Field label={t.confirmPassword}><input required minLength={8} type="password" className="input" value={confirm} onChange={e=>setConfirm(e.target.value)} /></Field><Field label={t.referralCodeOptional}><input maxLength={32} className="input uppercase" value={referralCode} onChange={e=>setReferralCode(e.target.value.toUpperCase())} placeholder="DPXXXXXXXX"/><p className="mt-2 text-xs leading-5 text-zinc-600">{t.referralRegisterHint}</p></Field></>}
      {error&&<div className="rounded-xl border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-300">{error}</div>}
      <button disabled={busy} className="w-full cursor-pointer rounded-2xl bg-pink-400 py-4 font-black text-black transition hover:bg-pink-300 disabled:cursor-not-allowed disabled:opacity-50">{busy?"…":mode==="login"?t.enter:t.createAccount}</button>
    </form><p className="mt-5 text-center text-sm text-zinc-500">{mode==="login"?t.noAccount:t.hasAccount} <a className="cursor-pointer text-pink-400 hover:text-pink-300 hover:underline" href={mode==="login"?"/register":"/login"}>{mode==="login"?t.goRegister:t.goLogin}</a></p>
  </div></div>
}
function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="block"><span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-zinc-500">{label}</span>{children}</label>}
