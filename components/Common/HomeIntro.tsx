"use client";

import {useEffect,useState} from "react";

export default function HomeIntro({trigger}:{trigger:boolean}){
  const [visible,setVisible]=useState(0);
  const [show,setShow]=useState(false);
  const [showSlogan,setShowSlogan]=useState(false);
  const letters=["D","U","E","L","P","L","A","Y"];

  useEffect(()=>{
    if(!trigger)return;
    let cancelled=false;
    let sloganTimer:number|undefined;
    let doneTimer:number|undefined;
    setShow(true);
    setVisible(0);
    setShowSlogan(false);
    let i=0;
    const timer=window.setInterval(()=>{
      if(cancelled)return;
      i+=1;
      setVisible(i);
      if(i===1){
        sloganTimer=window.setTimeout(()=>{if(!cancelled)setShowSlogan(true)},500);
      }
      if(i>=letters.length){
        window.clearInterval(timer);
        doneTimer=window.setTimeout(()=>{if(!cancelled)setShow(false)},1100);
      }
    },150);
    return()=>{
      cancelled=true;
      window.clearInterval(timer);
      if(sloganTimer)window.clearTimeout(sloganTimer);
      if(doneTimer)window.clearTimeout(doneTimer);
    };
  },[trigger]);

  if(!show)return null;
  return <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/95 backdrop-blur-sm" aria-hidden="true">
    <div className="flex flex-col items-center">
      <div className="flex gap-3 text-5xl font-black tracking-[.18em] sm:gap-5 sm:text-7xl">
        {letters.map((letter,index)=><span key={letter+index} className={`transition-all duration-500 ${index<visible?"scale-100 opacity-100 text-pink-400 drop-shadow-[0_0_25px_var(--theme-glow)]":"scale-50 opacity-0 text-zinc-900"}`}>{letter}</span>)}
      </div>
      <div className={`mt-5 text-[10px] font-semibold uppercase tracking-[.42em] text-white/45 transition-all duration-700 sm:mt-6 sm:text-xs ${showSlogan?"translate-y-0 opacity-100":"translate-y-2 opacity-0"}`}>YOUR SKILL - YOUR CASH</div>
    </div>
  </div>;
}
