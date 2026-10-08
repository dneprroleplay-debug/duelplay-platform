"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { THEMES, ThemeId, isThemeBackgroundId } from "@/lib/themes";
import {preloadImage} from "@/lib/image-preload";

type Ctx={theme:ThemeId;themePreference:ThemeId;setTheme:(id:ThemeId)=>void;themes:typeof THEMES;isCustom:boolean};
const ThemeContext=createContext<Ctx|null>(null);
export function ThemeProvider({children}:{children:React.ReactNode}){
 const [theme,setThemeState]=useState<ThemeId>("STANDARD");
 const [standard,setStandard]=useState<ThemeId>("STANDARD");
 const [background,setBackground]=useState("stars");
 const [isCustom,setIsCustom]=useState(false); const [themePreference,setThemePreference]=useState<ThemeId>("STANDARD");
 useEffect(()=>{
  const load=async()=>{
    const [site,me]=await Promise.all([

    fetch("/api/site-settings",{cache:"no-store"}).then(r=>r.json()).catch(()=>({theme:"STANDARD",background:"stars"})),
    fetch("/api/auth/me",{cache:"no-store"}).then(r=>r.json()).catch(()=>({user:null}))

    ]);


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
  const onChanged=()=>void load();
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
  setThemePreference(id);
  setIsCustom(id!=="STANDARD");

  const effectiveTheme =
    id==="STANDARD"
      ? standard
      : id;

  setThemeState(effectiveTheme);

  try{
    window.localStorage.setItem("duelplay-theme",id);
  }catch{}

  try{
    await fetch("/api/profile",{
      method:"PATCH",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({themePreference:id})
    });
  }catch{}
 }
 const value=useMemo(()=>({theme,themePreference,setTheme,themes:THEMES,isCustom}),[theme,themePreference,isCustom]); return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
export function useTheme(){const c=useContext(ThemeContext);if(!c)throw new Error("useTheme must be used inside ThemeProvider");return c;}
