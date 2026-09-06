"use client";
import {useEffect,useState,useRef} from "react";

const STORAGE_KEY="duelplay-season-intensity";
const MIN=10;
const MAX=200;

export default function SeasonIntensityControl(){
 const [open,setOpen]=useState(false);
 const ref=useRef<HTMLDivElement>(null);
 const [value,setValue]=useState(100);
 useEffect(()=>{
  try{const saved=Number(window.localStorage.getItem(STORAGE_KEY));if(Number.isFinite(saved))setValue(Math.max(MIN,Math.min(MAX,saved)));}catch{}
 },[]);
 useEffect(()=>{
  if(!open)return;
  const close=(e:MouseEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node))setOpen(false)};
  document.addEventListener("pointerdown",close);
  return()=>document.removeEventListener("pointerdown",close);
 },[open]);
 function update(next:number){
  const v=Math.max(MIN,Math.min(MAX,Math.round(next)));
  setValue(v);
  try{window.localStorage.setItem(STORAGE_KEY,String(v));}catch{}
  window.dispatchEvent(new CustomEvent("duelplay:season-intensity-changed",{detail:v}));
 }
 return <div ref={ref} className="relative">
  <button type="button" aria-label="Атмосфера DuelPlay" title="Атмосфера DuelPlay" onClick={()=>setOpen(v=>!v)} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/5 text-lg hover:border-[var(--theme-accent)]/40 hover:text-[var(--theme-accent)]">✦</button>
  {open&&<div className="absolute right-0 top-12 z-[70] w-[300px] max-w-[calc(100vw-1rem)] rounded-2xl border border-white/10 bg-[#0b0b10]/95 p-4 shadow-2xl backdrop-blur-xl">
   <div className="flex items-center justify-between gap-3"><div><b className="text-sm">Сезонные эффекты</b><div className="mt-1 text-[11px] text-zinc-500">Настройка только для вашего экрана</div></div><span className="text-xs font-black text-[var(--theme-accent)]">{value}%</span></div>
   <input aria-label="Атмосфера DuelPlay" type="range" min={MIN} max={MAX} step="1" value={value} onChange={e=>update(Number(e.target.value))} className="season-intensity-range mt-4 w-full"/>
   <div className="mt-2 flex justify-between text-[10px] uppercase tracking-widest text-zinc-600"><span>Минимум</span><span>Максимум</span></div>
   <p className="mt-3 text-[11px] leading-5 text-zinc-500">Эффекты нельзя выключить полностью. Увеличь до 200%, если хочешь очень плотный снегопад, ливень листьев или настоящий праздничный хаос.</p>
  </div>}
 </div>;
}
