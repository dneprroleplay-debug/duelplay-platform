"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { THEMES, ThemeId } from "@/lib/themes";

type Ctx={theme:ThemeId;setTheme:(id:ThemeId)=>void;themes:typeof THEMES;isCustom:boolean};
const ThemeContext=createContext<Ctx|null>(null);
export function ThemeProvider({children}:{children:React.ReactNode}){
 const [theme,setThemeState]=useState<ThemeId>("STANDARD");
 const [standard,setStandard]=useState<ThemeId>("STANDARD");
 const [background,setBackground]=useState("stars");
 const [isCustom,setIsCustom]=useState(false);
 useEffect(()=>{
  const load=()=>Promise.all([
    fetch("/api/site-settings",{cache:"no-store"}).then(r=>r.json()).catch(()=>({theme:"STANDARD",background:"stars"})),
    fetch("/api/auth/me",{cache:"no-store"}).then(r=>r.json()).catch(()=>({user:null}))
  ]).then(([site,me])=>{
    const st=THEMES.some(x=>x.id===site.theme)?site.theme:"STANDARD";
    const bg=typeof site.background==="string"?site.background:"stars";
    setStandard(st); setBackground(bg);
    const saved=window.localStorage.getItem("duelplay-theme") as ThemeId|null;
    const pref=me.user?.themePreference;
    const chosen=pref&&THEMES.some(x=>x.id===pref)?pref:(saved&&THEMES.some(x=>x.id===saved)?saved:st);
    setThemeState(chosen); setIsCustom(chosen!=="STANDARD");
  });
  void load();
  const onChanged=()=>void load();
  window.addEventListener("duelplay:theme-changed",onChanged);
  return()=>window.removeEventListener("duelplay:theme-changed",onChanged);
},[]);
 useEffect(()=>{document.documentElement.dataset.theme=theme; const root=document.documentElement; root.style.removeProperty("--theme-accent"); root.style.removeProperty("--theme-accent-soft"); root.style.removeProperty("--theme-accent-bg"); root.style.setProperty("--theme-bg-image",`url(/theme-backgrounds/${background}.svg)`);},[theme,background]);
 async function setTheme(id:ThemeId){
 setThemeState(id);setIsCustom(id!=="STANDARD");window.localStorage.setItem("duelplay-theme",id);
 try{await fetch("/api/profile",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({themePreference:id})})}catch{}}
 const value=useMemo(()=>({theme,setTheme,themes:THEMES,isCustom}),[theme,isCustom]); return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
export function useTheme(){const c=useContext(ThemeContext);if(!c)throw new Error("useTheme must be used inside ThemeProvider");return c;}
