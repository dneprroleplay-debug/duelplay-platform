"use client";
import {useEffect} from "react";
export default function Error({error,reset}:{error:Error&{digest?:string};reset:()=>void}){
 useEffect(()=>{console.error("DuelPlay page error",error)},[error]);
 return <main className="grid min-h-screen place-items-center px-4 pt-20"><section className="panel w-full max-w-lg rounded-3xl p-8 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-red-400/20 bg-red-400/5 text-2xl">!</div><h1 className="mt-5 text-3xl font-black">Временная ошибка DuelPlay</h1><p className="mt-3 text-sm leading-6 text-zinc-500">Не удалось отобразить эту страницу. Состояние матча и сессия не сброшены.</p><button onClick={reset} className="mt-6 rounded-2xl bg-[var(--theme-accent)] px-6 py-3 font-black text-black">Повторить</button></section></main>
}
