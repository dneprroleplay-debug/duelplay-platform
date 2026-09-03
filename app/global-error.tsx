"use client";
import {useEffect} from "react";
export default function GlobalError({reset}:{reset:()=>void}){useEffect(()=>{const timer=window.setTimeout(()=>reset(),1400);return()=>window.clearTimeout(timer)},[reset]);return <html><body style={{margin:0,background:"#050507",color:"#fff",fontFamily:"Arial"}}><main style={{minHeight:"100vh",display:"grid",placeItems:"center"}}><div style={{textAlign:"center",maxWidth:520,padding:32}}><h1>DuelPlay перезапускается</h1><p style={{color:"#888"}}>Временная ошибка приложения. Страница автоматически повторит загрузку.</p></div></main></body></html>}
