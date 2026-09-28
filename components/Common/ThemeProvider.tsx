"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { THEMES, ThemeId, isThemeBackgroundId } from "@/lib/themes";
import { preloadImage } from "@/lib/image-preload";

type Ctx = {
  theme: ThemeId;
  themePreference: ThemeId;
  setTheme: (id:ThemeId)=>void;
  themes: typeof THEMES;
  isCustom: boolean;
};

const ThemeContext = createContext<Ctx|null>(null);

export function ThemeProvider({children}:{children:React.ReactNode}){
  const [theme,setThemeState] = useState<ThemeId>("STANDARD");
  const [themePreference,setThemePreference] = useState<ThemeId>("STANDARD");
  const [standard,setStandard] = useState<ThemeId>("STANDARD");
  const [background,setBackground] = useState("stars");
  const [isCustom,setIsCustom] = useState(false);

  useEffect(()=>{
    const load = async()=>{
      const [site,me] = await Promise.all([
        fetch("/api/site-settings",{cache:"no-store"})
          .then(r=>r.json())
          .catch(()=>({theme:"STANDARD",background:"stars"})),
        fetch("/api/auth/me",{cache:"no-store"})
          .then(r=>r.json())
          .catch(()=>({user:null}))
      ]);

      const st = THEMES.some(x=>x.id===site.theme)
        ? site.theme as ThemeId
        : "STANDARD";

      const bg = isThemeBackgroundId(site.background)
        ? site.background
        : "stars";

      await preloadImage(
        `/theme-backgrounds/${bg}.svg`
      );

      const rawPreference = String(
        me.user?.themePreference || "STANDARD"
      );

      const pref:ThemeId = THEMES.some(x=>x.id===rawPreference)
        ? rawPreference as ThemeId
        : "STANDARD";

      /*
       * STANDARD is not a concrete personal theme.
       * It means: follow the SUPERADMIN-selected standard theme.
       */
      const effectiveTheme:ThemeId =
        pref === "STANDARD"
          ? st
          : pref;

      setStandard(st);
      setBackground(bg);
      setThemePreference(pref);
      setThemeState(effectiveTheme);
      setIsCustom(pref !== "STANDARD");
    };

    void load();

    const onChanged = ()=>void load();

    window.addEventListener(
      "duelplay:theme-changed",
      onChanged
    );

    return()=>{
      window.removeEventListener(
        "duelplay:theme-changed",
        onChanged
      );
    };
  },[]);

  useEffect(()=>{
    document.documentElement.dataset.theme = theme;

    const root = document.documentElement;

    root.style.removeProperty("--theme-accent");
    root.style.removeProperty("--theme-accent-soft");
    root.style.removeProperty("--theme-accent-bg");

    root.style.setProperty(
      "--theme-bg-image",
      `url(/theme-backgrounds/${background}.svg)`
    );

    const applyPageBackground = ()=>{
      if(root.dataset.season){
        document.body.style.removeProperty("background-image");
      }else{
        document.body.style.setProperty(
          "background-image",
          `url(/theme-backgrounds/${background}.svg)`,
          "important"
        );
      }
    };

    applyPageBackground();

    const observer = new MutationObserver(
      applyPageBackground
    );

    observer.observe(root,{
      attributes:true,
      attributeFilter:["data-season"]
    });

    return()=>observer.disconnect();
  },[theme,background]);

  async function setTheme(id:ThemeId){
    setThemePreference(id);
    setIsCustom(id !== "STANDARD");

    /*
     * When STANDARD is selected, immediately apply the current
     * SUPERADMIN standard theme instead of hard-coding STANDARD.
     */
    const effectiveTheme =
      id === "STANDARD"
        ? standard
        : id;

    setThemeState(effectiveTheme);

    window.localStorage.setItem(
      "duelplay-theme",
      id
    );

    try{
      await fetch("/api/profile",{
        method:"PATCH",
        headers:{
          "Content-Type":"application/json"
        },
        body:JSON.stringify({
          themePreference:id
        })
      });
    }catch{}
  }

  const value = useMemo(
    ()=>({
      theme,
      themePreference,
      setTheme,
      themes:THEMES,
      isCustom
    }),
    [
      theme,
      themePreference,
      isCustom
    ]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(){
  const c = useContext(ThemeContext);

  if(!c){
    throw new Error(
      "useTheme must be used inside ThemeProvider"
    );
  }

  return c;
}
