"use client";
import {useEffect,useRef,useState} from "react";

type Mode="AUTO"|"BALANCED"|"PERFORMANCE";
const STORAGE_KEY="duelplay-performance-mode";
const MODES:Mode[]=["AUTO","BALANCED","PERFORMANCE"];

function detectAuto():Mode{
 if(typeof window==="undefined")return "BALANCED";
 const reduced=window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
 const cores=navigator.hardwareConcurrency||4;
 const memory=(navigator as Navigator&{deviceMemory?:number}).deviceMemory||4;
 const small=window.matchMedia?.("(max-width: 900px)").matches;
 return reduced||cores<=4||memory<=4||small?"PERFORMANCE":"BALANCED";
}

export default function PerformanceModeControl(){
 const [open,setOpen]=useState(false);
 const [mode,setMode]=useState<Mode>("AUTO");
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  try{const saved=window.localStorage.getItem(STORAGE_KEY) as Mode|null;if(saved&&MODES.includes(saved))setMode(saved);}catch{}
 },[]);
 useEffect(()=>{
  const root=document.documentElement;
  root.dataset.performance=mode.toLowerCase();
  root.dataset.performanceEffective=(mode==="AUTO"?detectAuto():mode).toLowerCase();
  const media=window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const sync=()=>{root.dataset.performanceEffective=(mode==="AUTO"?detectAuto():mode).toLowerCase()};
  media?.addEventListener?.("change",sync);
  window.addEventListener("resize",sync,{passive:true});
  return()=>{media?.removeEventListener?.("change",sync);window.removeEventListener("resize",sync)};
 },[mode]);
 useEffect(()=>{
  if(!open)return;
  const close=(e:PointerEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node))setOpen(false)};
  document.addEventListener("pointerdown",close);
  return()=>document.removeEventListener("pointerdown",close);
 },[open]);
 const update=(next:Mode)=>{setMode(next);try{localStorage.setItem(STORAGE_KEY,next)}catch{};window.dispatchEvent(new CustomEvent("duelplay:performance-mode-changed",{detail:next}));};
 const effective=mode==="AUTO"?detectAuto():mode;
 return <div ref={ref} className="relative">
  <button type="button" aria-label="Режим производительности" title="Режим производительности" onClick={()=>setOpen(v=>!v)} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/5 text-sm hover:border-[var(--theme-accent)]/40 hover:text-[var(--theme-accent)]">⚡</button>
  {open&&<div className="absolute right-0 top-12 z-[70] w-[300px] max-w-[calc(100vw-1rem)] rounded-2xl border border-white/10 bg-[#0b0b10]/95 p-4 shadow-2xl backdrop-blur-xl">
   <div className="flex items-center justify-between gap-3"><div><b className="text-sm">Производительность</b><div className="mt-1 text-[11px] text-zinc-500">Только для вашего экрана</div></div><span className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-accent)]">{effective}</span></div>
   <div className="mt-4 grid grid-cols-3 gap-2">{MODES.map(x=><button key={x} type="button" onClick={()=>update(x)} className={`rounded-xl border px-2 py-2 text-[10px] font-black uppercase tracking-wider ${mode===x?"border-[var(--theme-accent)]/50 bg-[var(--theme-accent-bg)] text-[var(--theme-accent)]":"border-white/10 bg-white/[.03] text-zinc-500"}`}>{x}</button>)}</div>
   <p className="mt-3 text-[11px] leading-5 text-zinc-500">AUTO подбирает режим по устройству и настройке reduced motion. PERFORMANCE уменьшает декоративные частицы и отключает тяжёлые сезонные эффекты.</p>
  </div>}
 </div>;
}
