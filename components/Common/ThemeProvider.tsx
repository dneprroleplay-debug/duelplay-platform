"use client";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { THEMES, ThemeId, isThemeBackgroundId } from "@/lib/themes";
import {preloadImage} from "@/lib/image-preload";

type Ctx={theme:ThemeId;themePreference:ThemeId;setTheme:(id:ThemeId)=>void;themes:typeof THEMES;isCustom:boolean};
const ThemeContext=createContext<Ctx|null>(null);
export function ThemeProvider({children}:{children:React.ReactNode}){
 const [theme,setThemeState]=useState<ThemeId>("STANDARD");
 const [standard,setStandard]=useState<ThemeId>("STANDARD");
 const [background,setBackground]=useState("stars");
 const [isCustom,setIsCustom]=useState(false); const [themePreference,setThemePreference]=useState<ThemeId>("STANDARD");
 const themeSaveInProgress=useRef(false);
 useEffect(()=>{
  const load=async()=>{
    const [site,me]=await Promise.all([

    fetch("/api/site-settings",{cache:"no-store"}).then(r=>r.json()).catch(()=>({theme:"STANDARD",background:"stars"})),
    fetch("/api/auth/me",{cache:"no-store"}).then(r=>r.json()).catch(()=>({user:null}))

    ]);

    // A periodic refresh that started during a theme save must not overwrite the optimistic selection.
    if(themeSaveInProgress.current)return;

    const st=THEMES.some(x=>x.id===site.theme)?site.theme:"STANDARD";
    const bg=isThemeBackgroundId(site.background)?site.background:"stars";
    await preloadImage(
      `/theme-backgrounds/${bg}.svg`
    );

    setStandard(st);
    setBackground(bg);
    const saved=window.localStorage.getItem("duelplay-theme") as ThemeId|null;

    const serverPreference =
      me.user?.themePreference &&
      THEMES.some(x=>x.id===me.user.themePreference)
        ? me.user.themePreference as ThemeId
        : null;

    const preference =
      serverPreference ||
      (saved && THEMES.some(x=>x.id===saved) ? saved : "STANDARD");

    const effectiveTheme =
      preference === "STANDARD"
        ? st
        : preference;

    setStandard(st);
    setBackground(bg);
    setThemePreference(preference);
    setThemeState(effectiveTheme);
    setIsCustom(preference !== "STANDARD");
  };
  void load();
  const onChanged=(event:Event)=>{
    const detail=(event as CustomEvent<{themePreference?:unknown;effectiveTheme?:unknown}>).detail;
    const requested=detail?.themePreference;
    if(typeof requested==="string"&&THEMES.some(x=>x.id===requested)){
      const next=requested as ThemeId;
      setThemePreference(next);
      setIsCustom(next!=="STANDARD");
      const requestedEffective=detail?.effectiveTheme;
      setThemeState(typeof requestedEffective==="string"&&THEMES.some(x=>x.id===requestedEffective)?requestedEffective as ThemeId:(next==="STANDARD"?standard:next));
      try{window.localStorage.setItem("duelplay-theme",next)}catch{}
      return;
    }
    void load();
  };
  const timer=window.setInterval(()=>void load(),5000);
  window.addEventListener("duelplay:theme-changed",onChanged);
  return()=>{window.clearInterval(timer);window.removeEventListener("duelplay:theme-changed",onChanged)};
},[]);
 useEffect(()=>{
  document.documentElement.dataset.theme=theme;
  const root=document.documentElement;
  root.style.removeProperty("--theme-accent");
  root.style.removeProperty("--theme-accent-soft");
  root.style.removeProperty("--theme-accent-bg");
  root.style.setProperty("--theme-bg-image",`url(/theme-backgrounds/${background}.svg)`);

  // STANDARD removes only the old hero artwork. The separately selected
  // background preset (stars / nebula / aurora / galaxy / gold space)
  // must still be visible. Seasonal artwork keeps priority.
  const applyPageBackground=()=>{
   if(root.dataset.season){
    document.body.style.removeProperty("background-image");
   }else{
    document.body.style.setProperty("background-image",`url(/theme-backgrounds/${background}.svg)`,"important");
   }
  };
  applyPageBackground();
  const observer=new MutationObserver(applyPageBackground);
  observer.observe(root,{attributes:true,attributeFilter:["data-season"]});
  return()=>observer.disconnect();
 },[theme,background]);
 async function setTheme(id:ThemeId){
  const previousPreference=themePreference;
  const previousTheme=theme;
  const apply=(preference:ThemeId,effective:ThemeId)=>{
    setThemePreference(preference);
    setIsCustom(preference!=="STANDARD");
    setThemeState(effective);
    try{window.localStorage.setItem("duelplay-theme",preference)}catch{}
    window.dispatchEvent(new CustomEvent("duelplay:theme-changed",{detail:{themePreference:preference,effectiveTheme:effective}}));
  };
  themeSaveInProgress.current=true;
  apply(id,id==="STANDARD"?standard:id);
  try{
    const response=await fetch("/api/profile",{
      method:"PATCH",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({themePreference:id})
    });
    if(!response.ok)throw new Error("Could not save profile theme");
  }catch{
    // Optimistic display is rolled back if persistence fails.
    apply(previousPreference,previousTheme);
  }finally{
    themeSaveInProgress.current=false;
  }
 }
 const value=useMemo(()=>({theme,themePreference,setTheme,themes:THEMES,isCustom}),[theme,themePreference,isCustom]); return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
export function useTheme(){const c=useContext(ThemeContext);if(!c)throw new Error("useTheme must be used inside ThemeProvider");return c;}
