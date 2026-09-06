"use client";
import {useEffect,useState} from "react";
import {usePathname} from "next/navigation";
import {useLanguage} from "./LanguageContext";
export default function MaintenanceGate({children}:{children:React.ReactNode}){
 const path=usePathname(); const {language}=useLanguage(); const [state,setState]=useState<{enabled:boolean,isAdmin:boolean,message:string}|null>(null);
 useEffect(()=>{let live=true;fetch("/api/maintenance",{cache:"no-store"}).then(r=>r.json()).then(d=>{if(live)setState(d)}).catch(()=>{if(live)setState({enabled:false,isAdmin:false,message:""})});return()=>{live=false}},[path]);
 if(state?.enabled&&!state.isAdmin&&path!=="/login"&&path!=="/test-login") return <main className="grid min-h-screen place-items-center px-5 pt-20"><section className="panel max-w-xl rounded-3xl p-8 text-center"><span className="pill">DUELPLAY</span><h1 className="mt-5 text-3xl font-black">{({RU:"Технические работы",UA:"Технічні роботи",EN:"Maintenance",PL:"Prace techniczne"} as any)[language]}</h1><p className="mt-3 text-zinc-400">{({RU:"DuelPlay временно недоступен. Попробуйте позже.",UA:"DuelPlay тимчасово недоступний. Спробуйте пізніше.",EN:state.message,PL:"DuelPlay jest tymczasowo niedostępny. Spróbuj później."} as any)[language]}</p></section></main>;
 return <>{children}</>;
}
