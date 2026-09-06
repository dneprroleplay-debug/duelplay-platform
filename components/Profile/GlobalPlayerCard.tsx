"use client";
import Link from "next/link";

type Props={player:any;viewerId?:string|null};
export default function GlobalPlayerCard({player,viewerId=null}:Props){
 const self=viewerId&&viewerId===player.id;
 const canMessage=player.allowMessages!==false&&!player.blocked&&!player.muted;
 const canChallenge=player.allowChallenges!==false&&!player.blocked&&!player.muted;
 return <article className="global-player-card rounded-2xl border border-white/5 bg-white/[.025] p-4">
  <div className="flex min-w-0 items-center gap-3">
   <img src={player.avatarUrl||player.steamAvatarUrl||"/images/avatar-placeholder.png"} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover"/>
   <div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-2"><b className="truncate">{player.nickname}</b>{player.online&&<span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" title="Online"/>}</div>
    <div className="mt-1 text-xs text-zinc-500">Lv.{player.level??1} · {player.league||"Unranked"} · Rating {player.rating??1000}</div>
   </div>
  </div>
  {!self&&<div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
   <Link href={`/profile/${encodeURIComponent(player.nickname)}`} className="rounded-lg border border-white/10 px-3 py-2 text-center text-xs font-bold">Profile</Link>
   {canMessage?<Link href={`/profile/${encodeURIComponent(player.nickname)}?action=message`} className="rounded-lg border border-white/10 px-3 py-2 text-center text-xs font-bold">Message</Link>:<span className="rounded-lg border border-white/5 px-3 py-2 text-center text-xs text-zinc-700">Message disabled</span>}
   {canChallenge?<Link href={`/profile/${encodeURIComponent(player.nickname)}?action=challenge`} className="rounded-lg bg-pink-400 px-3 py-2 text-center text-xs font-black text-black">Challenge</Link>:<span className="rounded-lg border border-white/5 px-3 py-2 text-center text-xs text-zinc-700">Challenge disabled</span>}
  </div>}
 </article>;
}
