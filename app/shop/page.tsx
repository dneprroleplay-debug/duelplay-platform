"use client";
import { useEffect, useState } from "react";
import { useLanguage } from "@/components/Common/LanguageContext";
import { deferEffectTask } from "@/lib/effect-defer";

type Item = { id:string; slug:string; name:string; type:string; price:number; imageUrl:string|null; metadata:Record<string,unknown>|null; owned:boolean; ownedAt:string|null };
type ShopResponse = { items:Item[]; page:number; pageSize:number; total:number; totalPages:number };
const TYPES = ["ALL","AVATAR","FRAME","BADGE","BANNER","TITLE","PROFILE_THEME","EMOTE","SPRAY","COSMETIC"];
export default function Shop(){
  const { t, language } = useLanguage();
  const [data,setData]=useState<ShopResponse>({items:[],page:1,pageSize:24,total:0,totalPages:1});
  const [search,setSearch]=useState(""); const [type,setType]=useState("ALL"); const [owned,setOwned]=useState("all"); const [sort,setSort]=useState("price_asc");
  const [msg,setMsg]=useState(""); const [busy,setBusy]=useState<string|null>(null);
  async function load(page=1){const q=new URLSearchParams({page:String(page),pageSize:"24",search,type,owned,sort}); const r=await fetch(`/api/shop?${q}`,{cache:"no-store"}); if(r.ok)setData(await r.json());}
  useEffect(()=>{deferEffectTask(()=>{load(1);});},[search,type,owned,sort]);
  const copy = ({
    RU:{owned:"Уже получено",buy:"Купить",processing:"Покупка…",purchased:"Покупка выполнена",recovered:"Покупка подтверждена",failed:"Не удалось выполнить покупку"},
    UA:{owned:"Вже отримано",buy:"Придбати",processing:"Придбання…",purchased:"Покупку виконано",recovered:"Покупку підтверджено",failed:"Не вдалося виконати покупку"},
    EN:{owned:"Owned",buy:"Buy",processing:"Processing…",purchased:"Purchased successfully",recovered:"Purchase recovered",failed:"Purchase failed"},
    PL:{owned:"Posiadana",buy:"Kup",processing:"Kupowanie…",purchased:"Zakup zakończony",recovered:"Zakup potwierdzony",failed:"Nie udało się kupić przedmiotu"},
  } as const)[language] || {owned:"Owned",buy:"Buy",processing:"Processing…",purchased:"Purchased successfully",recovered:"Purchase recovered",failed:"Purchase failed"};
  async function buy(id:string){if(busy)return; setBusy(id); setMsg(""); const key=crypto.randomUUID(); try{const r=await fetch("/api/shop",{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":key},body:JSON.stringify({itemId:id,language})}); const x=await r.json(); setMsg(r.ok?(x.idempotent?copy.recovered:copy.purchased):(x.error||copy.failed)); if(r.ok)await load(data.page);}finally{setBusy(null)}}
  return <main className="mx-auto min-h-screen max-w-6xl px-4 pb-20 pt-28"><section className="panel rounded-3xl p-7 sm:p-10"><span className="pill">COSMETIC SHOP</span><h1 className="mt-4 text-4xl font-black">Cosmetics</h1><p className="mt-2 text-sm text-zinc-500">Cosmetics are visual only and never change gameplay stats.</p>
    <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder={t.searchCosmetics} className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 outline-none"/><select value={type} onChange={e=>setType(e.target.value)} className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">{TYPES.map(x=><option key={x} value={x}>{t.cosmeticTypes[x as keyof typeof t.cosmeticTypes]}</option>)}</select><select value={owned} onChange={e=>setOwned(e.target.value)} className="rounded-xl border border-white/10 bg-black/20 px-4 py-3"><option value="all">{t.cosmeticAllItems}</option><option value="false">{t.cosmeticNotOwned}</option><option value="true">{t.cosmeticOwned}</option></select><select value={sort} onChange={e=>setSort(e.target.value)} className="rounded-xl border border-white/10 bg-black/20 px-4 py-3"><option value="price_asc">{t.cosmeticSortLow}</option><option value="price_desc">{t.cosmeticSortHigh}</option><option value="newest">{t.cosmeticNewest}</option></select></div>
    <div className="mt-3 text-xs text-zinc-500">{data.total} items · page {data.page}/{data.totalPages}</div>
    <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{data.items.map(x=><article key={x.id} className="rounded-2xl border border-white/5 p-5"><div className="flex items-start justify-between gap-3"><div><b>{x.name}</b><div className="mt-1 text-[11px] uppercase text-zinc-600">{t.cosmeticTypes[x.type as keyof typeof t.cosmeticTypes]||x.type}</div></div>{x.owned&&<span className="pill">{copy.owned}</span>}</div><div className="mt-4 flex items-center gap-3">{x.type==="FRAME"&&x.imageUrl&&<img src={x.imageUrl} alt="" className={`h-14 w-14 shrink-0 object-contain frame-glow frame-glow--${x.slug}`}/>}<div className="text-pink-400">${x.price.toFixed(2)}</div></div><button disabled={x.owned||busy===x.id} onClick={()=>buy(x.id)} className="mt-4 w-full rounded-xl bg-pink-400 px-4 py-2 font-black text-black disabled:cursor-not-allowed disabled:opacity-40">{x.owned?copy.owned:busy===x.id?copy.processing:copy.buy}</button></article>)}</div>
    <div className="mt-6 flex items-center justify-center gap-3"><button disabled={data.page<=1} onClick={()=>load(data.page-1)} className="rounded-xl border border-white/10 px-4 py-2 disabled:opacity-30">Previous</button><button disabled={data.page>=data.totalPages} onClick={()=>load(data.page+1)} className="rounded-xl border border-white/10 px-4 py-2 disabled:opacity-30">Next</button></div>{msg&&<p className="mt-5 text-pink-300">{msg}</p>}</section></main>
}
