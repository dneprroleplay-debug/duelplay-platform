"use client";
import {useEffect,useState} from "react";

const KEY="duelplay-admin-preview";
export default function AdminPreview(){
 const [enabled,setEnabled]=useState(false);
 const [season,setSeason]=useState("none");
 useEffect(()=>{try{const raw=localStorage.getItem(KEY);if(raw){const x=JSON.parse(raw);setEnabled(!!x.enabled);setSeason(x.season||"none");}}catch{}},[]);
 function apply(next:boolean){const value={enabled:next,season};localStorage.setItem(KEY,JSON.stringify(value));setEnabled(next);document.documentElement.dataset.adminPreview=next?"1":"0";if(next&&season!=="none")document.documentElement.dataset.seasonPreview=season;else delete document.documentElement.dataset.seasonPreview;}
 function changeSeason(value:string){setSeason(value);if(enabled){localStorage.setItem(KEY,JSON.stringify({enabled:true,season:value}));document.documentElement.dataset.seasonPreview=value;}}
 return <section className="admin-preview-control rounded-2xl border border-white/10 bg-white/[.025] p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><span className="pill">ADMIN PREVIEW</span><h3 className="mt-3 text-xl font-black">Preview without production changes</h3><p className="mt-1 text-xs text-zinc-500">Only local preview attributes are changed. No wallet, match, reward or profile data is written.</p></div><button type="button" onClick={()=>apply(!enabled)} className={`rounded-xl px-4 py-2 text-sm font-black ${enabled?"bg-pink-400 text-black":"border border-white/10 text-zinc-300"}`}>{enabled?"Exit preview":"Enter preview"}</button></div>{enabled&&<div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs text-zinc-500">Season preview<select className="input mt-2" value={season} onChange={e=>changeSeason(e.target.value)}><option value="none">Standard</option><option value="winter">Winter</option><option value="christmas">Christmas</option><option value="halloween">Halloween</option><option value="valentines">Valentine's</option><option value="lunar-new-year">Lunar New Year</option><option value="april-fools">April Fools</option><option value="st-patricks">St. Patrick's</option><option value="esports">Esports</option></select></label><div className="rounded-xl border border-pink-400/20 bg-pink-400/5 p-3 text-xs text-pink-200">PREVIEW MODE is local-only and never calls mutation APIs.</div></div>}</section>;
}
