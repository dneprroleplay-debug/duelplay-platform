"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import CenterModal from "../Common/CenterModal";
import {useLanguage} from "../Common/LanguageContext";

type CaseItem={id:string;name:string;imageUrl:string;rarity:string;value:number;weight:number};
type DuelCase={id:string;slug:string;name:string;description:string;price:number;imageUrl:string;items:CaseItem[]};
type RollItem=CaseItem&{key:string};

const CASE_COPY:any={
 RU:{starter:["Стартовый кейс","Быстрый шанс получить первый предмет DuelPlay."],neon:["Neon Duel Case","Неоновый кейс с редкими наградами."],premium:["Премиальный арсенал","Премиальный кейс для охотников за редкими предметами."]},
 UA:{starter:["Стартовий кейс","Швидкий шанс отримати перший предмет DuelPlay."],neon:["Neon Duel Case","Неоновий кейс із рідкісними нагородами."],premium:["Преміальний арсенал","Преміальний кейс для мисливців за рідкісними предметами."]},
 EN:{starter:["Starter Case","A quick chance to get your first DuelPlay item."],neon:["Neon Duel Case","A neon case with rare rewards."],premium:["Premium Arsenal","A premium case for hunters of rare items."]},
 PL:{starter:["Starter Case","Szybka szansa na zdobycie pierwszego przedmiotu DuelPlay."],neon:["Neon Duel Case","Neonowa skrzynia z rzadkimi nagrodami."],premium:["Premium Arsenal","Premiumowa skrzynia dla łowców rzadkich przedmiotów."]}
};
const RARITY:any={RU:{Common:"Обычный",Uncommon:"Необычный",Rare:"Редкий",Epic:"Эпический",Legendary:"Легендарный",Mythic:"Мифический"},UA:{Common:"Звичайний",Uncommon:"Незвичайний",Rare:"Рідкісний",Epic:"Епічний",Legendary:"Легендарний",Mythic:"Міфічний"},EN:{Common:"Common",Uncommon:"Uncommon",Rare:"Rare",Epic:"Epic",Legendary:"Legendary",Mythic:"Mythic"},PL:{Common:"Zwykły",Uncommon:"Niezwykły",Rare:"Rzadki",Epic:"Epicki",Legendary:"Legendarny",Mythic:"Mityczny"}};

export default function Cases(){
 const{language,t}=useLanguage();
 const[cases,setCases]=useState<DuelCase[]>([]),[selected,setSelected]=useState<DuelCase|null>(null),[opening,setOpening]=useState(false),[spinning,setSpinning]=useState(false),[won,setWon]=useState<CaseItem|null>(null),[roll,setRoll]=useState<RollItem[]>([]),[error,setError]=useState(""),[rollTarget,setRollTarget]=useState<number|null>(null),[stopRatio,setStopRatio]=useState(.5);
 const viewportRef=useRef<HTMLDivElement>(null); const trackRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{fetch("/api/cases",{cache:"no-store"}).then(r=>r.json()).then(d=>setCases(Array.isArray(d)?d:[])).catch(()=>{})},[]);
 const copy=(key:string)=>CASE_COPY[language]?.[key]||CASE_COPY.EN[key];
 const rarity=(value:string)=>RARITY[language]?.[value]||value;
 useEffect(()=>{
   if(rollTarget===null||!viewportRef.current||!trackRef.current)return;
   const item=trackRef.current.querySelector<HTMLElement>(".roulette-item-large");
   if(!item)return;
   const targetPoint=rollTarget*item.offsetWidth+item.offsetWidth*stopRatio;
   const x=viewportRef.current.clientWidth/2-targetPoint;
   const viewport=viewportRef.current;
   viewport.classList.remove("roulette-fullscreen-go");
   viewport.style.setProperty("--roll-x","0px");
   if(spinning){
     requestAnimationFrame(()=>{
       viewport.style.setProperty("--roll-x",`${x}px`);
       void viewport.offsetWidth;
       requestAnimationFrame(()=>viewport.classList.add("roulette-fullscreen-go"));
     });
   }
 },[roll,rollTarget,stopRatio,spinning]);
 function makeSequence(box:DuelCase,winner:CaseItem,targetIndex:number){
   const source=box.items; const now=Date.now();
   return Array.from({length:170},(_,i)=>{const item=i===targetIndex?winner:source[(i*17+i%source.length)%source.length];return {...item,key:`${now}-${i}-${item.id}-${i===targetIndex?"winner":"filler"}`}});
 }
 function chooseTarget(){return 75+Math.floor(Math.random()*55)}
 function chooseStopRatio(){return .04+Math.random()*.92}
 function selectCase(box:DuelCase){
   const target=chooseTarget(); const ratio=chooseStopRatio();
   setSelected(box);setWon(null);setError("");setOpening(false);setSpinning(false);setRollTarget(target);setStopRatio(ratio);setRoll(makeSequence(box,box.items[0],target));
 }
 const close=()=>{if(!opening){setSelected(null);setWon(null);setRoll([]);setRollTarget(null);setSpinning(false);setError("")}};
 async function openCase(box:DuelCase){
   if(opening)return;
   const target=chooseTarget(); const ratio=chooseStopRatio();
   setOpening(true);setSpinning(false);setError("");setWon(null);
   setRollTarget(target);setStopRatio(ratio);
   if(!roll.length)setRoll(makeSequence(box,box.items[0],target));
   try{
    const r=await fetch("/api/cases",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({slug:box.slug})});
    const d=await r.json(); if(!r.ok)throw new Error(d.error||t.caseOpenError);
    const winner=d.item as CaseItem;
    setRoll(current=>{const base=current.length?current:makeSequence(box,box.items[0],target);return base.map((item,i)=>i===target?{...winner,key:item.key}:item)});
    setRollTarget(target);setStopRatio(ratio);setSpinning(true);
    await new Promise(resolve=>setTimeout(resolve,6800));
    setWon(winner);
   }catch(e){setError(e instanceof Error?e.message:t.caseOpenError);setSpinning(false)}finally{setOpening(false)}
 }
 if(!cases.length)return null;
 return <section id="cases" className="mx-auto max-w-7xl px-4 py-12 sm:px-6"><div className="panel rounded-3xl p-7 sm:p-9"><div className="flex flex-wrap items-end justify-between gap-4"><div className="w-full text-center"><span className="pill">DUELPLAY CASES</span><h2 className="mt-3 text-3xl font-black">{t.casesTitle}</h2><p className="mx-auto mt-2 max-w-3xl text-sm leading-6 text-zinc-500">{t.casesText}</p></div><Link href="/inventory" className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold hover:border-[var(--theme-accent)]/40">{t.myInventory} →</Link></div><div className="mt-7 grid gap-4 md:grid-cols-3">{cases.map(box=><CaseCard key={box.id} box={box} copy={copy(box.slug)} rarity={rarity} openText={t.caseOpen} onOpen={()=>selectCase(box)} t={t}/>)}</div></div>
 <CenterModal open={Boolean(selected)} title={selected?copy(selected.slug)[0]:t.case} onClose={close} fullscreen className="bg-[#050507]" contentClassName="h-[calc(100dvh-73px)] overflow-auto p-0">
   {selected&&<div className="min-h-full pb-10">{won?<WinCard won={won} onClose={close} t={t} rarity={rarity}/>:<>
    <div className="px-5 pt-7 text-center sm:px-10"><div className="text-base font-black uppercase tracking-[.25em] text-[var(--theme-accent)]">{t.rouletteTitle}</div></div>
    <div ref={viewportRef} className="roulette-fullscreen roulette-fullscreen-v2 mt-7"><div className="roulette-pointer roulette-pointer-glow"/><div ref={trackRef} className="roulette-track roulette-track-full">{roll.map(item=><div key={item.key} className="roulette-item roulette-item-large"><img src={item.imageUrl} alt=""/><div className="mt-2 truncate text-sm font-black">{item.name}</div><div className="mt-1 text-xs text-[var(--theme-accent)]">${item.value.toFixed(2)}</div></div>)}</div></div>
    <div className="mx-auto mt-5 max-w-6xl px-5 sm:px-10"><div className="mx-auto flex max-w-5xl items-center justify-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[var(--theme-accent)]"/><span className="h-1.5 w-1.5 rounded-full bg-[var(--theme-accent)]/40"/><span className="h-1.5 w-1.5 rounded-full bg-[var(--theme-accent)]/20"/><span className="h-1.5 w-1.5 rounded-full bg-[var(--theme-accent)]/40"/><span className="h-1.5 w-1.5 rounded-full bg-[var(--theme-accent)]/20"/></div>
    <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{selected.items.map(item=><div key={item.id} className="rounded-2xl border border-white/5 bg-white/[.025] p-3"><div className="flex items-center gap-3"><img src={item.imageUrl} alt="" className="h-14 w-20 rounded-xl object-cover"/><div className="min-w-0"><div className="truncate text-xs font-black">{item.name}</div><div className="text-[10px] text-zinc-600">{rarity(item.rarity)}</div><div className="text-[10px] font-bold text-[var(--theme-accent)]">{chance(item,selected.items)}%</div></div></div></div>)}</div>
    {error&&<div className="mx-auto mt-5 max-w-5xl rounded-2xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-300">{error}</div>}
    {!opening&&<button onClick={()=>void openCase(selected)} className="mx-auto mt-7 block w-full max-w-5xl rounded-2xl bg-[var(--theme-accent)] py-4 text-lg font-black text-black shadow-[0_0_45px_var(--theme-glow)]">{t.caseOpen} ${selected.price.toFixed(2)}</button>}
    </div></>}</div>}
 </CenterModal></section>
}
function chance(item:CaseItem,items:CaseItem[]){const total=items.reduce((n,x)=>n+Math.max(0,x.weight),0);return total?((item.weight/total)*100).toFixed(1):"0.0"}
function CaseCard({box,copy,rarity,openText,onOpen,t}:{box:DuelCase;copy:string[];rarity:(v:string)=>string;openText:string;onOpen:()=>void;t:any}){return <article className="group overflow-hidden rounded-3xl border border-white/8 bg-white/[.025] transition hover:-translate-y-1 hover:border-[var(--theme-accent)]/35"><div className="relative h-48 overflow-hidden bg-black"><img src={box.imageUrl} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-105"/><div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent"/><div className="absolute left-4 top-4 rounded-full border border-[var(--theme-accent)]/30 bg-black/60 px-3 py-1 text-[10px] font-black tracking-widest text-[var(--theme-accent)]">{t.caseBadge}</div><div className="absolute bottom-4 left-4 right-4"><div className="text-xl font-black">{copy[0]}</div><div className="mt-1 text-xs text-zinc-300">{copy[1]}</div></div></div><div className="p-4"><div className="mb-4 grid grid-cols-2 gap-2">{box.items.slice(0,4).map(item=><div key={item.id} className="rounded-xl border border-white/5 bg-black/20 px-3 py-2"><div className="truncate text-[11px] font-bold">{item.name}</div><div className="mt-1 flex justify-between text-[10px] text-zinc-600"><span>{rarity(item.rarity)}</span><span>{chance(item,box.items)}%</span></div></div>)}</div><button onClick={onOpen} className="w-full rounded-xl bg-[var(--theme-accent)] py-3 font-black text-black">{openText} ${box.price.toFixed(2)}</button></div></article>}
function WinCard({won,onClose,t,rarity}:{won:CaseItem;onClose:()=>void;t:any;rarity:(v:string)=>string}){return <div className="mx-auto max-w-6xl px-5 py-10 sm:px-10"><div className="text-center"><div className="text-sm font-black uppercase tracking-[.3em] text-[var(--theme-accent)]">{t.congratulations}</div><h3 className="mt-3 text-4xl font-black sm:text-6xl">{t.youWon}</h3><div className="mt-2 text-2xl font-black text-[var(--theme-accent)] sm:text-4xl">{won.name}</div><div className="mt-2 text-3xl font-black sm:text-5xl">${won.value.toFixed(2)}</div></div><div className="mx-auto mt-8 max-w-3xl overflow-hidden rounded-3xl border border-[var(--theme-accent)]/35 bg-[var(--theme-accent-bg)] p-5 shadow-[0_0_70px_var(--theme-glow)]"><img src={won.imageUrl} alt="" className="mx-auto aspect-[16/7] w-full rounded-2xl object-cover"/><div className="mt-3 text-center text-xs uppercase tracking-widest text-zinc-500">{rarity(won.rarity)}</div></div><p className="mt-5 text-center text-sm text-zinc-500">{t.itemStored}</p><div className="mt-7 flex flex-wrap justify-center gap-3"><Link href="/inventory" onClick={onClose} className="rounded-xl bg-[var(--theme-accent)] px-6 py-3 font-black text-black">{t.openInventory}</Link><button onClick={onClose} className="rounded-xl border border-white/10 px-6 py-3 font-bold">{t.close}</button></div></div>}
