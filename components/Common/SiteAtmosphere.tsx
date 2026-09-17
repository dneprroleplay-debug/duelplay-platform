"use client";
import {useEffect,useState} from "react";
import SeasonGlassWater from "./SeasonGlassWater";
import {getSeasonContent} from "@/lib/season-content";

type Season={id:string;name:string;theme:string;mode:string;effects:any;active:boolean};

function snowDot(i:number){
 const left=(i*61)%100;
 const size=2+(i%7)*0.65;
 const drift=((i*17)%70)-35;
 return <span key={`snow-dot-${i}`} className="season-snow-dot" style={{left:`${left}%`,width:`${size}px`,height:`${size}px`,animationDelay:`-${(i*0.19)%10}s`,animationDuration:`${6+(i%11)*.65}s`,["--season-drift" as any]:`${drift}px`}}/>;
}

function particle(kind:string,i:number){
 const seed=(i*37)%100;
 const k=kind.toLowerCase();
 const sets:Record<string,string[]>={
  winter:["❄️"],christmas:["❄️"],newyear:["❄️","✨","⭐"],
  halloween:["🎃"],autumn:["🍁","🍂"],thanksgiving:["🍁","🍂"],
  summer:["☀️","🌴","🦋","🍉"],spring:["🌸","🌷","🌼"],easter:["🌸","🥚"],
  hearts:["❤️","💗"],confetti:["🎉","🎊","✨"],stpatricks:["☘️","🍀"],lunarnewyear:["🏮","✨","🧧"],aprilfools:["🎉","🎊","✨"],esports:["✦","◆"],
 };
 const glyph=(sets[k]||["✦"])[i%(sets[k]?.length||1)];
 const size=k==="halloween"?11+(i%5)*2:10+(i%7)*2;
 const opacity=.55+((i*13)%35)/100;
 const drift=((i*29)%90)-45;
 return <span key={i} className={`season-particle season-${k}`} style={{left:`${seed}%`,fontSize:`${size}px`,opacity,animationDelay:`-${(i*0.37)%12}s`,animationDuration:`${7+(i%9)}s`,["--season-drift" as any]:`${drift}px`}}>{glyph}</span>;
}

export default function SiteAtmosphere(){
 const [season,setSeason]=useState<Season|null>(null);
 const [userIntensity,setUserIntensity]=useState(100);
 const [performanceMode,setPerformanceMode]=useState("balanced");
 useEffect(()=>{let disposed=false;let loading=false;void fetch("/api/site-settings",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(d=>{if(!disposed&&typeof d?.heroBackground==="string")document.documentElement.style.setProperty("--global-hero-image",`url(/hero-backgrounds/${d.heroBackground}.jpg)`)}).catch(()=>{});const load=async()=>{if(disposed||document.visibilityState==="hidden"||loading)return;loading=true;try{const r=await fetch(`/api/seasons?ts=${Date.now()}`,{cache:"no-store"});const d=r.ok?await r.json():null;if(!disposed)setSeason(d?.active??null)}catch{}finally{loading=false}};void load();const timer=window.setInterval(()=>void load(),60000);const onSeasonChanged=()=>{setSeason(null);void load()};window.addEventListener("duelplay:season-changed",onSeasonChanged);const onVisibility=()=>{if(document.visibilityState==="visible")void load()};document.addEventListener("visibilitychange",onVisibility);return()=>{disposed=true;window.clearInterval(timer);window.removeEventListener("duelplay:season-changed",onSeasonChanged);document.removeEventListener("visibilitychange",onVisibility)}},[]);
 useEffect(()=>{try{const saved=Number(window.localStorage.getItem("duelplay-season-intensity"));if(Number.isFinite(saved))setUserIntensity(Math.max(10,Math.min(200,saved)));}catch{} const onChange=(e:Event)=>{const v=Number((e as CustomEvent<number>).detail);if(Number.isFinite(v))setUserIntensity(Math.max(10,Math.min(200,v)))};window.addEventListener("duelplay:season-intensity-changed",onChange);return()=>window.removeEventListener("duelplay:season-intensity-changed",onChange)},[]);
 const effects=season?.effects||{};
 const seasonId=String(effects.seasonId||season?.id||"none").toLowerCase();
 const content=getSeasonContent(seasonId,effects.preset);
 const particleKind=String(effects.particle||content.particle||season?.theme||"default").toLowerCase();
 const heroSeason=content.hero||"";
 const baseIntensity=Number(effects.intensity??48);
 const performance=performanceMode;
 const performanceFactor=performance==="performance"?0.38:performance==="balanced"?0.72:1;
 const count=Math.max(12,Math.min(1200,Math.round(baseIntensity*userIntensity/100*12.5*performanceFactor)));
 const snow=seasonId==="winter"||seasonId==="christmas"||seasonId==="new-year";
 const snowDotCount=snow?Math.max(18,Math.round(count*.62)):0;
 const particleEffectKind = seasonId==="st-patricks" ? "stpatricks" : seasonId==="lunar-new-year" ? "lunarnewyear" : seasonId==="april-fools" ? "aprilfools" : seasonId==="valentines" ? "hearts" : particleKind;
 const glyphCount=snow?Math.max(6,count-snowDotCount):count;
 useEffect(()=>{
   const root=document.documentElement;
   if(!season?.active){root.removeAttribute("data-season");root.style.removeProperty("--season-hero-image");root.style.removeProperty("--season-site-image");return;}
   root.dataset.season=seasonId;
   const seasonImage=heroSeason?`url(/season-heroes/${heroSeason}.png)`:"none";
   const seasonBackground=content.background?`url(/season-backgrounds/${content.background}.svg)`:"none";
   root.style.setProperty("--season-hero-image",seasonImage);
   root.style.setProperty("--season-site-image",seasonBackground);
   root.style.setProperty("--season-content-id",seasonId);
   return()=>{root.removeAttribute("data-season");root.style.removeProperty("--season-hero-image");root.style.removeProperty("--season-site-image");root.style.removeProperty("--season-content-id");};
 },[season?.active,seasonId,heroSeason]);
 if(!season?.active)return null;
 const mascot = seasonId==="halloween" ? "pumpkin" : seasonId==="winter"||seasonId==="christmas"||seasonId==="new-year" ? "snowman" : seasonId==="spring"||seasonId==="easter" ? "bunny" : seasonId==="summer" ? "summer" : seasonId==="autumn"||seasonId==="thanksgiving" ? "leaf" : seasonId==="valentines" ? "heart" : seasonId==="st-patricks" ? "clover" : seasonId==="lunar-new-year" ? "lantern" : seasonId==="april-fools" ? "fool" : seasonId==="esports" ? "bot" : "star";
 return <div className={`site-atmosphere season-atmosphere season-theme-${particleEffectKind} season-${seasonId}`} aria-hidden="true">
   {effects.particle!==false&&<div className={`season-particles ${snow?"season-snow-layer":""}`}>
     {snow&&<div className="season-snow-dots">{Array.from({length:snowDotCount},(_,i)=>snowDot(i))}</div>}
     {Array.from({length:glyphCount},(_,i)=>particle(particleEffectKind,i))}
   </div>}
   {(seasonId==="autumn"||seasonId==="thanksgiving")&&performance!=="performance"&&<div className="season-glass-rain-layer"><SeasonGlassWater/></div>}
   <div className={`season-corner-mascot season-corner-${mascot}`} aria-hidden="true">{mascot==="snowman"||mascot==="pumpkin" ? <span/> : mascot==="bunny" ? "🐰" : mascot==="summer" ? "😎" : mascot==="leaf" ? "🍁" : mascot==="heart" ? "❤" : mascot==="clover" ? "☘" : mascot==="lantern" ? "🏮" : mascot==="fool" ? "🤡" : mascot==="bot" ? "🤖" : "✦"}</div>
 </div>;
}
