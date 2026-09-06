"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
type Banner={id:string;title:string;imageUrl:string;placement:string};
export default function BannerStrip(){
 const [banners,setBanners]=useState<Banner[]>([]);
 useEffect(()=>{fetch("/api/banners?placement=HOME",{cache:"no-store"}).then(r=>r.ok?r.json():[]).then(d=>setBanners(Array.isArray(d)?d:[])).catch(()=>setBanners([]));},[]);
 if(!banners.length)return null;
 return <section aria-label="DuelPlay banners" className="mx-auto max-w-7xl px-4 pt-8 sm:px-6"><div className="grid gap-4 md:grid-cols-2">{banners.slice(0,4).map(b=><Link key={b.id} href="#create" className="group relative min-h-28 overflow-hidden rounded-3xl border border-white/10 bg-black/40"><img src={b.imageUrl} alt={b.title} className="absolute inset-0 h-full w-full object-cover opacity-55 transition duration-300 group-hover:scale-[1.02] group-hover:opacity-70"/><div className="absolute inset-0 bg-black/45"/><div className="relative flex min-h-28 items-center p-5 sm:p-6"><div className="max-w-xl text-lg font-black uppercase tracking-tight sm:text-xl">{b.title}</div></div></Link>)}</div></section>;
}
