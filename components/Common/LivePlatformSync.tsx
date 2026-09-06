"use client";
import {useEffect} from "react";
import {usePathname} from "next/navigation";

export default function LivePlatformSync(){
 const pathname=usePathname();
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
    if(first){version=next;first=false;return;}
    if(next&&version&&next!==version){
      version=next;
      window.dispatchEvent(new Event("duelplay:platform-changed"));
    }
   }catch{}finally{loading=false}
  };
  void check();
  const timer=window.setInterval(()=>void check(),3000);
  const onLocal=()=>{if(!pathname.startsWith("/admin"))window.location.reload()};
  window.addEventListener("duelplay:platform-changed",onLocal);
  const onVisibility=()=>{if(document.visibilityState==="visible")void check()};
  document.addEventListener("visibilitychange",onVisibility);
  return()=>{disposed=true;window.clearInterval(timer);window.removeEventListener("duelplay:platform-changed",onLocal);document.removeEventListener("visibilitychange",onVisibility)};
 },[pathname]);
 return null;
}
