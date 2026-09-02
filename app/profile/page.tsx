"use client";
import { useEffect, useState } from "react";
import Header from "@/components/Header/Header";
import AvatarPicker from "@/components/Profile/AvatarPicker";
import { useLanguage } from "@/components/Common/LanguageContext";
import { useTheme } from "@/components/Common/ThemeProvider";
import { THEMES, ThemeId } from "@/lib/themes";

type User={id:string;nickname:string;steamId:string|null;email:string|null;avatarUrl:string|null;steamAvatarUrl:string|null;themePreference:string;level:number;xp:number;reputation:number;trustScore:string;referralCode:string;balance:string;lockedBalance:string};
type Data={user:User;stats:{matches:number;wins:number;losses:number;active:number;winRate:number;referralCount:number;referralEarned:number};matches:any[]};
const MAP_IMAGES:Record<string,string>={Mirage:"/images/maps/covers/mirage.jpg",Dust2:"/images/maps/covers/dust2.jpg",Ancient:"/images/maps/covers/ancient.jpg",Train:"/images/maps/covers/train.jpg",Overpass:"/images/maps/covers/overpass.jpg",Inferno:"/images/maps/covers/inferno.jpg",Nuke:"/images/maps/covers/nuke.jpg",Anubis:"/images/maps/covers/anubis.jpg"};

export default function ProfilePage(){
 const {t}=useLanguage(); const {theme,setTheme}=useTheme(); const [data,setData]=useState<Data|null>(null); const [error,setError]=useState(""); const [authRequired,setAuthRequired]=useState(false); const [copied,setCopied]=useState(false);
 useEffect(()=>{fetch("/api/profile",{cache:"no-store"}).then(async r=>{const d=await r.json().catch(()=>({}));if(r.status===401){setAuthRequired(true);return}if(!r.ok){setError(t.profileLoadError);return}setData(d)}).catch(()=>setError(t.profileLoadError))},[t.profileLoadError]);
 if(authRequired)return <><Header/><main className="mx-auto min-h-screen max-w-xl px-4 pb-20 pt-28"><section className="panel rounded-3xl p-8 text-center sm:p-10"><span className="pill">DUELPLAY</span><h1 className="mt-4 text-3xl font-black">{t.profile}</h1><p className="mt-3 text-zinc-500">{t.profileLoginRequired}</p><a href="/login" className="mt-6 inline-flex rounded-2xl bg-pink-400 px-6 py-3 font-black text-black hover:bg-pink-300">{t.goLogin}</a></section></main></>;
 if(!data)return <><Header/><main className="min-h-screen pt-28 text-center text-zinc-500">{error||t.loading}</main></>;
 const u=data.user;
 async function copy(){await navigator.clipboard.writeText(u.referralCode);setCopied(true);setTimeout(()=>setCopied(false),1200)}
 return <><Header/><main className="mx-auto min-h-screen max-w-6xl px-4 pb-20 pt-28">
  <div className="panel rounded-3xl p-7 sm:p-10">
   <div className="flex flex-col gap-7 lg:flex-row lg:items-start lg:justify-between">
    <div className="flex items-center gap-5"><AvatarPicker value={u.avatarUrl} steamAvatarUrl={u.steamAvatarUrl} nickname={u.nickname} onSaved={avatarUrl=>setData({...data,user:{...u,avatarUrl}})}/><div><span className="pill">{t.playerProfile}</span><h1 className="mt-3 text-4xl font-black">{u.nickname}</h1><p className="mt-2 text-zinc-500">{t.steamId}: {u.steamId||"—"}</p><p className="mt-2 text-xs text-zinc-600">{t.avatarHintShort}</p></div></div>
    <div className="flex gap-3"><a href="/wallet" className="rounded-2xl bg-pink-400 px-5 py-3 font-black text-black">{t.wallet} · ${Number(u.balance).toFixed(2)}</a><a href="/create" className="rounded-2xl border border-white/10 px-5 py-3 font-bold">{t.createMatch}</a></div>
   </div>
   <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Stat n={String(data.stats.matches)} t={t.matchesCount}/><Stat n={String(data.stats.wins)} t={t.wins}/><Stat n={String(data.stats.losses)} t={t.losses}/><Stat n={`${data.stats.winRate}%`} t={t.winRate}/><Stat n={String(u.level)} t={`${t.level} · ${u.xp} ${t.xp}`}/></div>
  </div>
  <section className="panel mt-6 rounded-3xl p-5 sm:p-6">
   <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><span className="pill">STYLE</span><h2 className="mt-3 text-2xl font-black">{t.themeStyle}</h2><p className="mt-2 max-w-3xl text-sm text-zinc-500">{t.themeDescription}</p></div><span className="text-xs font-bold text-zinc-500">{theme==="STANDARD"?t.themeStandard:t.themePersonal}</span></div>
   <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
    {THEMES.map(x=><button type="button" key={x.id} onClick={()=>setTheme(x.id as ThemeId)} className={`group overflow-hidden rounded-xl border text-left transition hover:-translate-y-0.5 ${theme===x.id?"border-pink-400/70 bg-pink-400/[.08]":"border-white/8 bg-white/[.025] hover:border-white/20"}`}>
      <div className="h-12 w-full" style={{background:`linear-gradient(135deg,${x.preview[0]} 0%,${x.preview[0]} 45%,${x.preview[1]} 45%,${x.preview[1]} 70%,${x.preview[2]} 70%)`}}/>
      <div className="p-3"><div className="text-sm font-bold">{x.name}</div><div className="mt-1 truncate text-[11px] text-zinc-500">{x.description}</div></div>
    </button>)}
   </div>
  </section>

  <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.5fr]">
   <section className="panel rounded-3xl p-7"><h2 className="text-2xl font-black">{t.profile}</h2><div className="mt-5 space-y-3"><Row label={t.reputation} value={u.reputation}/><Row label={t.trust} value={`${Number(u.trustScore).toFixed(0)}%`}/><Row label={t.balance} value={`$${Number(u.balance).toFixed(2)}`}/><Row label={t.locked} value={`$${Number(u.lockedBalance).toFixed(2)}`}/></div><div className="mt-6 rounded-2xl border border-pink-400/10 bg-pink-400/[.035] p-4"><div className="text-xs uppercase tracking-wider text-pink-300">{t.referralTitle}</div><p className="mt-2 text-xs leading-5 text-zinc-500">{t.referralDescription}</p><div className="mt-3 flex gap-2"><input readOnly value={u.referralCode} className="input"/><button onClick={copy} className="cursor-pointer rounded-xl border border-white/10 px-4 text-sm font-bold transition hover:border-pink-400/40 hover:bg-pink-400/5 hover:text-pink-200">{copied?t.copied:t.copy}</button></div><div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-xl bg-black/20 p-3"><div className="text-[11px] text-zinc-600">{t.referralInvited}</div><b className="mt-1 block">{data.stats.referralCount}</b></div><div className="rounded-xl bg-black/20 p-3"><div className="text-[11px] text-zinc-600">{t.referralEarned}</div><b className="mt-1 block text-pink-400">${data.stats.referralEarned.toFixed(4)}</b></div></div><p className="mt-3 text-[11px] text-zinc-600">{t.referralReward}</p></div></section>
   <section className="panel rounded-3xl p-7"><div className="flex items-center justify-between"><h2 className="text-2xl font-black">{t.recentMatches}</h2><a href="/live" className="text-sm text-pink-400">LIVE →</a></div><div className="mt-5 space-y-3">{data.matches.filter(m=>MAP_IMAGES[m.mapName||""]).slice(0,8).length?data.matches.filter(m=>MAP_IMAGES[m.mapName||""]).slice(0,8).map(m=><a href={`/matches/${m.id}`} key={m.id} className="group flex items-center gap-3 rounded-2xl bg-white/[.03] p-2 transition hover:bg-white/[.07] hover:ring-1 hover:ring-pink-400/20"><div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-xl bg-black"><img src={MAP_IMAGES[m.mapName]} alt={m.mapName||""} className="h-full w-full object-cover object-center transition duration-300 group-hover:scale-[1.04]"/><div className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent"/></div><div className="min-w-0 flex-1"><div className="truncate"><b>{m.game.title}</b><span className="ml-2 text-zinc-500">{m.mapName||"—"}</span></div><div className="mt-1 text-sm font-bold text-pink-400">${Number(m.betAmount).toFixed(2)}</div></div><span className="text-right text-[10px] font-bold text-zinc-400">{m.status}</span></a>):<p className="text-zinc-500">{t.noHistory}</p>}</div></section>
  </div>
 </main></>
}
function Stat({n,t}:{n:string;t:string}){return <div className="rounded-2xl bg-white/[.03] p-5"><div className="text-2xl font-black text-pink-400">{n}</div><div className="text-xs text-zinc-500">{t}</div></div>}
function Row({label,value}:{label:string;value:React.ReactNode}){return <div className="flex justify-between border-b border-white/5 py-3 text-sm"><span className="text-zinc-500">{label}</span><b>{value}</b></div>}
