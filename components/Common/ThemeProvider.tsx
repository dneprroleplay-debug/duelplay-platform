"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { THEMES, ThemeId } from "@/lib/themes";

type Ctx={theme:ThemeId;setTheme:(id:ThemeId)=>void;themes:typeof THEMES;isCustom:boolean};
const ThemeContext=createContext<Ctx|null>(null);
export function ThemeProvider({children}:{children:React.ReactNode}){
 const [theme,setThemeState]=useState<ThemeId>("STANDARD"); const [standard,setStandard]=useState<ThemeId>("STANDARD"); const [standardAccent,setStandardAccent]=useState<string>(THEMES[0].accent); const [isCustom,setIsCustom]=useState(false);
 useEffect(()=>{Promise.all([fetch("/api/site-settings",{cache:"no-store"}).then(r=>r.json()).catch(()=>({theme:"STANDARD"})),fetch("/api/auth/me",{cache:"no-store"}).then(r=>r.json()).catch(()=>({user:null}))]).then(([site,me])=>{const st=THEMES.some(x=>x.id===site.theme)?site.theme:"STANDARD";setStandard(st);setStandardAccent(typeof site.accent==="string"?site.accent:THEMES.find(x=>x.id===st)?.accent||THEMES[0].accent);const pref=me.user?.themePreference; if(pref&&pref!=="STANDARD"&&THEMES.some(x=>x.id===pref)){setThemeState(pref);setIsCustom(true)}else setThemeState(st);});},[]);
 useEffect(()=>{document.documentElement.dataset.theme=theme; const root=document.documentElement; if(!isCustom){root.style.setProperty("--theme-accent",standardAccent);root.style.setProperty("--theme-accent-soft",standardAccent);root.style.setProperty("--theme-accent-bg",`${standardAccent}18`);}else{root.style.removeProperty("--theme-accent");root.style.removeProperty("--theme-accent-soft");root.style.removeProperty("--theme-accent-bg");}},[theme,standardAccent,isCustom]);
 async function setTheme(id:ThemeId){setThemeState(id);setIsCustom(id!=="STANDARD"); try{await fetch("/api/profile",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({themePreference:id})})}catch{}}
 const value=useMemo(()=>({theme,setTheme,themes:THEMES,isCustom}),[theme,isCustom]); return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
export function useTheme(){const c=useContext(ThemeContext);if(!c)throw new Error("useTheme must be used inside ThemeProvider");return c;}
