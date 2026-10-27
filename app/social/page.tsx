"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useLanguage } from "../../components/Common/LanguageContext";
import { useAuth } from "@/components/Common/AuthContext";
import { deferEffectTask } from "@/lib/effect-defer";

type Person={id:string;nickname:string;avatarUrl?:string|null;steamAvatarUrl?:string|null;status?:string;online?:boolean};
type SocialData={friends:any[];rivals:any[];pendingIncoming:any[];pendingOutgoing:any[];blocked:any[];mutes:any[];unreadMessages:number};
export default function SocialPage(){
 const {t}=useLanguage();
 const {user}=useAuth();
 const [d,setD]=useState<SocialData>({friends:[],rivals:[],pendingIncoming:[],pendingOutgoing:[],blocked:[],mutes:[],unreadMessages:0});
 const [loading,setLoading]=useState(true); const [loadErr,setLoadErr]=useState(false);
 const [uid,setUid]=useState(""); const [text,setText]=useState(""); const [messages,setMessages]=useState<any[]>([]); const [msg,setMsg]=useState(""); const [busy,setBusy]=useState(false);
 const chatEndRef=useRef<HTMLDivElement>(null);
 async function load(){try{const r=await fetch("/api/social",{cache:"no-store"});const f=await r.json().catch(()=>({}));if(!r.ok)throw new Error("social failed");setD({friends:Array.isArray(f?.friends)?f.friends:[],rivals:Array.isArray(f?.rivals)?f.rivals:[],pendingIncoming:Array.isArray(f?.pendingIncoming)?f.pendingIncoming:[],pendingOutgoing:Array.isArray(f?.pendingOutgoing)?f.pendingOutgoing:[],blocked:Array.isArray(f?.blocked)?f.blocked:[],mutes:Array.isArray(f?.mutes)?f.mutes:[],unreadMessages:Number(f?.unreadMessages||0)});setLoadErr(false)}catch{setLoadErr(true)}finally{setLoading(false)}}
 useEffect(()=>{
  deferEffectTask(() => { void load(); });
  const chat=new URLSearchParams(window.location.search).get("chat");
  if(chat) void loadMessages(chat);
  const tick=()=>{ if(document.visibilityState==="visible") void load(); };
  const id=window.setInterval(tick,15000);
  document.addEventListener("visibilitychange",tick);
  return ()=>{window.clearInterval(id);document.removeEventListener("visibilitychange",tick)};
 },[]);

 useEffect(()=>{
  if(!uid)return;
  const timer=window.setInterval(()=>{
   if(document.visibilityState==="visible"){
    fetch("/api/messages?userId="+encodeURIComponent(uid),{cache:"no-store"})
     .then(r=>r.json())
     .then(x=>{if(Array.isArray(x))setMessages(x)})
     .catch(()=>{});
   }
  },5000);
  return ()=>window.clearInterval(timer);
 },[uid]);

 useEffect(()=>{
  chatEndRef.current?.scrollIntoView({behavior:"smooth"});
 },[messages.length]);

 async function action(url:string,body:any,method="POST"){setBusy(true);try{const r=await fetch(url,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const x=await r.json().catch(()=>({}));setMsg(r.ok?"✓":x.error||t.error);if(r.ok){await load();window.dispatchEvent(new Event("duelplay:profile-updated"))}}finally{setBusy(false)}}
 async function loadMessages(id=uid){if(!id)return;setUid(id);const r=await fetch("/api/messages?userId="+encodeURIComponent(id),{cache:"no-store"});const x=await r.json().catch(()=>[]);setMessages(Array.isArray(x)?x:[]);void fetch("/api/messages",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({fromUserId:id})}).then(()=>{void load();window.dispatchEvent(new Event("duelplay:notifications-updated"));}).catch(()=>{})}
 async function sendMessage(){if(!uid||!text.trim())return;setBusy(true);try{const r=await fetch("/api/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({receiverId:uid,body:text.trim()})});const x=await r.json().catch(()=>({}));setMsg(r.ok?"✓":x.error||t.error);if(r.ok){setText("");await loadMessages(uid)}}finally{setBusy(false)}}
 const accepted=d.friends.filter(x=>x.status==="ACCEPTED");
 const friendPerson=(x:any):Person=>x.person||x.receiver||x.sender;
 const onlineFriends=accepted.filter(x=>Boolean(friendPerson(x)?.online));
 const offlineFriends=accepted.filter(x=>!friendPerson(x)?.online);
 const activePartner = uid ? (accepted.map(friendPerson).find(p => p.id === uid || p.nickname === uid) || d.rivals.map(r => r.target).find(p => p.id === uid || p.nickname === uid) || messages.find(m => m.senderId === uid || m.sender?.nickname === uid)?.sender || messages.find(m => m.receiverId === uid || m.receiver?.nickname === uid)?.receiver) : null;
 return <main className="mx-auto min-h-screen max-w-7xl px-4 pb-20 pt-28"><section className="panel rounded-3xl p-6 sm:p-10">
  <div className="flex flex-wrap items-center gap-3"><span className="pill">SOCIAL CENTER</span>{d.unreadMessages>0&&<span className="rounded-full border border-pink-400/20 bg-pink-400/10 px-3 py-1 text-xs font-black text-pink-300">{d.unreadMessages} unread</span>}</div><h1 className="mt-4 text-4xl font-black">{t.socialTitle}</h1><p className="mt-2 max-w-3xl text-zinc-500">Friends, rivals and private messages in one place.</p>
  <div className="mt-7 grid gap-3 lg:grid-cols-[1fr_auto_auto_auto]"><input className="input" value={uid} onChange={e=>setUid(e.target.value)} placeholder={t.playerId}/><button disabled={busy} onClick={()=>action("/api/friends",{userId:uid,action:"add"})} className="rounded-xl bg-pink-400 px-5 py-3 font-black text-black">+ Friend</button><button disabled={busy} onClick={()=>action("/api/rivals",{targetId:uid})} className="rounded-xl border border-white/10 px-5 py-3 font-bold">Add Rival</button><button disabled={busy} onClick={()=>loadMessages()} className="rounded-xl border border-white/10 px-5 py-3 font-bold">{t.loadChat}</button></div>{msg&&<p className="mt-3 text-sm text-pink-300">{msg}</p>}{loadErr&&<p className="mt-3 text-sm text-red-300">{t.error}</p>}
  <div className="mt-8 grid gap-6 lg:grid-cols-2">
   <Panel title={`${t.friends} · ${accepted.length}`}>
    {loading&&!accepted.length?<div className="rounded-xl border border-white/5 p-5 text-center text-sm text-zinc-600">…</div>:accepted.length?<div className="space-y-5">
     {onlineFriends.length>0&&<div><h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-400"/>{t.friendOnline} · {onlineFriends.length}</h3><div className="mt-2 space-y-2">{onlineFriends.map(x=>{const p=friendPerson(x);return <FriendRow key={x.id} p={p} d={d} busy={busy} action={action} loadMessages={loadMessages} onlineLabel={t.friendOnline} offlineLabel={t.friendOffline}/>})}</div></div>}
     {offlineFriends.length>0&&<div><h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-zinc-500"><span className="h-2 w-2 rounded-full bg-zinc-600"/>{t.friendOffline} · {offlineFriends.length}</h3><div className="mt-2 space-y-2">{offlineFriends.map(x=>{const p=friendPerson(x);return <FriendRow key={x.id} p={p} d={d} busy={busy} action={action} loadMessages={loadMessages} onlineLabel={t.friendOnline} offlineLabel={t.friendOffline}/>})}</div></div>}
    </div>:<Empty text={t.noFriends}/>}
    {d.pendingIncoming.length>0&&<div className="mt-6"><h3 className="font-black">Pending requests · {d.pendingIncoming.length}</h3><div className="mt-3 space-y-2">{d.pendingIncoming.map(x=><div key={x.id} className="flex items-center justify-between rounded-xl bg-white/[.025] p-3"><Link href={`/profile/${encodeURIComponent(x.sender.nickname)}`} className="font-bold hover:text-pink-300"><span data-player-name>{x.sender.nickname}</span></Link><div className="flex gap-2"><button disabled={busy} onClick={()=>action("/api/friends",{userId:x.senderId,action:"accept"})} className="rounded-lg bg-emerald-400/15 px-3 py-2 text-xs text-emerald-300">Accept</button><button disabled={busy} onClick={()=>action("/api/friends",{userId:x.senderId,action:"decline"})} className="rounded-lg border border-white/10 px-3 py-2 text-xs">Decline</button></div></div>)}</div></div>}
    {d.pendingOutgoing.length>0&&<div className="mt-6"><h3 className="font-black">Sent requests · {d.pendingOutgoing.length}</h3><div className="mt-3 space-y-2">{d.pendingOutgoing.map(x=><div key={x.id} className="flex items-center justify-between rounded-xl bg-white/[.025] p-3"><Link href={`/profile/${encodeURIComponent(x.receiver.nickname)}`} className="font-bold hover:text-pink-300"><span data-player-name>{x.receiver.nickname}</span></Link><button disabled={busy} onClick={()=>action("/api/friends",{userId:x.receiverId,action:"remove"})} className="rounded-lg border border-white/10 px-3 py-2 text-xs">Cancel</button></div>)}</div></div>}
    {d.blocked.length>0&&<div className="mt-6"><h3 className="font-black">Blocked · {d.blocked.length}</h3><div className="mt-3 space-y-2">{d.blocked.map(x=><div key={x.id} className="flex items-center justify-between rounded-xl bg-white/[.025] p-3"><span data-player-name className="font-bold">{x.receiver.nickname}</span><button disabled={busy} onClick={()=>action("/api/friends",{userId:x.receiverId,action:"unblock"})} className="rounded-lg border border-white/10 px-3 py-2 text-xs">Unblock</button></div>)}</div></div>}
    {d.mutes.length>0&&<div className="mt-6"><h3 className="font-black">Muted · {d.mutes.length}</h3><div className="mt-3 space-y-2">{d.mutes.map(x=><div key={x.id} className="flex items-center justify-between rounded-xl bg-white/[.025] p-3"><span data-player-name className="font-bold">{x.mutedUser.nickname}</span><button disabled={busy} onClick={()=>action("/api/social",{targetId:x.mutedUserId,action:"unmute"})} className="rounded-lg border border-white/10 px-3 py-2 text-xs">Unmute</button></div>)}</div></div>}
   </Panel>
   <Panel title={`${t.rivals} · ${d.rivals.length}`}><div className="space-y-2">{d.rivals.length?d.rivals.map(x=><div key={x.id} className="flex items-center justify-between rounded-xl bg-white/[.025] p-3"><Link href={`/profile/${encodeURIComponent(x.target.nickname)}`} className="font-bold hover:text-pink-300">⚔ <span data-player-name>{x.target.nickname}</span></Link><button disabled={busy} onClick={()=>action(`/api/rivals?targetId=${encodeURIComponent(x.target.id)}`,{},"DELETE")} className="rounded-lg border border-white/10 px-3 py-2 text-xs">Remove</button></div>):<Empty text="No rivals yet."/>}</div></Panel>
  </div>
  <div className="mt-6 overflow-hidden rounded-2xl border border-pink-400/[.12] bg-gradient-to-br from-pink-400/[.035] via-transparent to-emerald-400/[.025] p-4 sm:p-5">
   <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div className="flex items-center gap-3">
     <img src={activePartner?.avatarUrl || activePartner?.steamAvatarUrl || "/images/avatar-placeholder.svg"} onError={e=>{e.currentTarget.src="/images/avatar-placeholder.svg"}} className="h-11 w-11 rounded-xl object-cover border border-pink-400/20 bg-black" alt={activePartner?.nickname || "Аватар собеседника"}/>
     <div>
      <h2 className="text-xl font-black flex items-center gap-2">
       <span>{t.messages}</span>
       {activePartner&&<span data-player-name className="text-pink-400 font-bold text-base">· {activePartner.nickname}</span>}
      </h2>
      <p className="text-xs text-zinc-500">Select a friend or enter a player ID/nickname to chat.</p>
     </div>
    </div>
    {uid&&<Link href={`/profile/${encodeURIComponent(activePartner?.nickname||uid)}`} className="text-sm text-pink-400 hover:underline">Open profile →</Link>}
   </div>
   <div className="mt-4 max-h-[440px] min-h-40 space-y-4 overflow-y-auto rounded-2xl border border-white/[.06] bg-black/20 p-3 sm:p-4">
    {messages.length?messages.map(x=>{
     const isMine = x.senderId === user?.id || (user?.nickname && x.sender?.nickname === user?.nickname);
     const timeStr = x.createdAt ? new Date(x.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
     return <div key={x.id} className={`flex items-start gap-2.5 ${isMine ? "flex-row-reverse" : "flex-row"}`}>
      <Link href={`/profile/${encodeURIComponent(x.sender?.nickname || "")}`} aria-label={`Профиль ${x.sender?.nickname || "игрока"}`} className="shrink-0 self-start rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-400"><img src={x.sender?.avatarUrl || x.sender?.steamAvatarUrl || "/images/avatar-placeholder.svg"} onError={e=>{e.currentTarget.src="/images/avatar-placeholder.svg"}} className="h-9 w-9 rounded-xl border border-white/10 bg-black object-cover transition hover:border-pink-400/40" alt=""/></Link>
      <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${isMine ? "rounded-tr-sm bg-[var(--theme-accent-bg)] border border-[var(--theme-accent)]/30 text-white" : "rounded-tl-sm bg-white/[.04] border border-white/10 text-zinc-200"}`}>
       <div className={`flex items-center gap-2 text-xs mb-1 ${isMine ? "justify-end text-[var(--theme-accent)]" : "text-zinc-400"}`}>
        <Link href={`/profile/${encodeURIComponent(x.sender?.nickname || "")}`} data-player-name className="font-bold transition hover:text-pink-300">{x.sender?.nickname || "Player"}</Link>
        {timeStr && <span className="text-[10px] text-zinc-500">{timeStr}</span>}
       </div>
       <div className="break-words text-sm whitespace-pre-wrap leading-relaxed">{x.body}</div>
      </div>
     </div>;
    }):<Empty text="No messages in this chat."/>}
    <div ref={chatEndRef}/>
   </div>
   <div className="mt-4 flex flex-col gap-2 sm:flex-row">
    <input className="input" value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")void sendMessage()}} placeholder={t.messagePlaceholder}/>
    <button disabled={busy||!uid||!text.trim()} onClick={sendMessage} className="rounded-xl bg-pink-400 px-6 py-2.5 font-black text-black disabled:opacity-40">{t.send}</button>
   </div>
  </div>
  <div className="mt-6 grid gap-3 sm:grid-cols-3"><Link href="/matches" className="rounded-2xl border border-white/5 p-4 hover:border-pink-400/30"><b>⚔ Find a duel</b><span className="mt-1 block text-xs text-zinc-600">Play against the community</span></Link><Link href="/clans" className="rounded-2xl border border-white/5 p-4 hover:border-pink-400/30"><b>🛡 Clans</b><span className="mt-1 block text-xs text-zinc-600">Meet and manage your team</span></Link><Link href="/notifications" className="rounded-2xl border border-white/5 p-4 hover:border-pink-400/30"><b>🔔 Notifications</b><span className="mt-1 block text-xs text-zinc-600">Friend and challenge alerts</span></Link></div>
 </section></main>
}
function FriendRow({p,d,busy,action,loadMessages,onlineLabel,offlineLabel}:{p:Person;d:SocialData;busy:boolean;action:(url:string,body:any,method?:string)=>void;loadMessages:(id?:string)=>Promise<void>;onlineLabel:string;offlineLabel:string}){return <div className="flex flex-col gap-3 rounded-xl bg-white/[.025] p-3 sm:flex-row sm:items-center sm:justify-between"><Link href={`/profile/${encodeURIComponent(p.nickname)}`} className="flex items-center gap-3"><span className="relative"><img src={p.avatarUrl||p.steamAvatarUrl||"/images/avatar-placeholder.svg"} onError={e=>{e.currentTarget.src="/images/avatar-placeholder.svg"}} className="h-9 w-9 rounded-xl border border-white/10 object-cover" alt={`${p.nickname} avatar`}/><span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#0b0b10] ${p.online?"bg-emerald-400":"bg-zinc-600"}`}/></span><span className="flex flex-col"><b data-player-name>{p.nickname}</b><span className={`text-[10px] font-bold ${p.online?"text-emerald-300":"text-zinc-600"}`}>{p.online?onlineLabel:offlineLabel}</span></span></Link><div className="flex flex-wrap gap-2"><button disabled={busy} onClick={()=>loadMessages(p.id)} className="rounded-lg border border-white/10 px-3 py-2 text-xs">Message</button><button disabled={busy} onClick={()=>action("/api/friends",{userId:p.id,action:"remove"})} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-400">Remove</button><button disabled={busy} onClick={()=>action("/api/social",{targetId:p.id,action:d.mutes.some((m)=>m.mutedUserId===p.id)?"unmute":"mute"})} className="rounded-lg border border-yellow-400/20 px-3 py-2 text-xs text-yellow-300">{d.mutes.some((m)=>m.mutedUserId===p.id)?"Unmute":"Mute"}</button><button disabled={busy} onClick={()=>action("/api/friends",{userId:p.id,action:"block"})} className="rounded-lg border border-red-400/20 px-3 py-2 text-xs text-red-300">Block</button></div></div>}
function Panel({title,children}:{title:string;children:React.ReactNode}){return <section className="rounded-2xl border border-white/5 p-5"><h2 className="text-xl font-black">{title}</h2><div className="mt-4">{children}</div></section>}
function Empty({text}:{text:string}){return <div className="rounded-xl border border-white/5 p-5 text-center text-sm text-zinc-600">{text}</div>}
