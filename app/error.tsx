"use client";
import {useEffect} from "react";
export default function Error({error,reset}:{error:Error&{digest?:string};reset:()=>void}){
 useEffect(()=>{console.error(error);const timer=window.setTimeout(()=>reset(),1200);return()=>window.clearTimeout(timer)},[error,reset]);
 return <main className="grid min-h-screen place-items-center px-4 pt-20"><section className="panel w-full max-w-lg rounded-3xl p-8 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-red-400/20 bg-red-400/5 text-2xl">!</div><h1 className="mt-5 text-3xl font-black">DuelPlay перезапускает страницу</h1><p className="mt-3 text-sm leading-6 text-zinc-500">Произошла временная ошибка. Мы автоматически повторяем загрузку — сессия и прогресс не сбрасываются.</p><div className="mt-6 h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full w-full origin-left animate-[pulse_1.2s_ease-in-out] rounded-full bg-[var(--theme-accent)]"/></div></section></main>
}
