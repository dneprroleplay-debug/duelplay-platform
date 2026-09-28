"use client";

import {useEffect} from "react";

export default function LivePlatformSync(){
  useEffect(()=>{
    let disposed=false;
    let loading=false;
    let first=true;
    let version="";

    const check=async()=>{
      if(disposed||loading||document.visibilityState==="hidden")return;

      loading=true;

      try{
        const r=await fetch("/api/platform-version",{cache:"no-store"});
        if(!r.ok)return;

        const d=await r.json();
        const next=String(d.version||"");

        if(first){
          version=next;
          first=false;
          return;
        }

        if(next&&version&&next!==version){
          version=next;
          window.dispatchEvent(new Event("duelplay:platform-changed"));
        }
      }catch{}
      finally{
        loading=false;
      }
    };

    void check();

    const timer=window.setInterval(()=>void check(),3000);

    const onLocal=()=>{
      // Never hard-reload the browser on platform-version changes.
      // Match pages can refresh their own API snapshot through this event.
      window.dispatchEvent(new Event("duelplay:match-refresh"));
    };

    window.addEventListener("duelplay:platform-changed",onLocal);

    const onVisibility=()=>{
      if(document.visibilityState==="visible")void check();
    };

    document.addEventListener("visibilitychange",onVisibility);

    return()=>{
      disposed=true;
      window.clearInterval(timer);
      window.removeEventListener("duelplay:platform-changed",onLocal);
      document.removeEventListener("visibilitychange",onVisibility);
    };
  },[]);

  return null;
}
