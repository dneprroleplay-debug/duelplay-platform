"use client";
import {useEffect,useRef} from "react";
import {useLanguage} from "./LanguageContext";
import {translateUi,UiLanguage} from "../../lib/ui-i18n";

export default function GlobalUiI18n(){
  const {language}=useLanguage();
  const lang=language as UiLanguage;
  const sources=useRef(new WeakMap<Node,string>());
  useEffect(()=>{
    const translate=()=>{
      const root=document.body;
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
      let n:Node|null;
      while((n=walker.nextNode())){
        const parent=n.parentElement;
        if(!parent || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|OPTION)$/i.test(parent.tagName)) continue;
        const current=n.nodeValue||"";
        if(!current.trim()) continue;
        const source=sources.current.get(n) ?? current;
        sources.current.set(n,source);
        const next=translateUi(lang,source);
        if(next!==current) n.nodeValue=next;
      }
      document.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLButtonElement|HTMLElement>("input[placeholder],textarea[placeholder],[title],[aria-label]").forEach(el=>{
        for(const attr of ["placeholder","title","aria-label"]){
          const value=el.getAttribute(attr); if(!value) continue;
          const dataKey=`dpI18n${attr.replace(/[^a-z]/g,"").replace(/^./,m=>m.toUpperCase())}Source`;
          const source=(el.dataset as any)[dataKey] ?? value;
          (el.dataset as any)[dataKey]=source;
          const next=translateUi(lang,source); if(next!==value) el.setAttribute(attr,next);
        }
      });
    };
    translate();
    const observer=new MutationObserver(()=>translate());
    observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:["placeholder","title","aria-label"]});
    return()=>observer.disconnect();
  },[lang]);
  return null;
}
