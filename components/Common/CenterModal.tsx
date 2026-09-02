"use client";

export default function CenterModal({open,title,children,onClose}:{open:boolean;title:string;children:React.ReactNode;onClose:()=>void}){
  if(!open)return null;
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title}>
    <button aria-label="Close" className="absolute inset-0 cursor-default" onClick={onClose}/>
    <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-[#0b0b10] shadow-[0_30px_100px_rgba(0,0,0,.65)]">
      <div className="flex items-center justify-between border-b border-white/5 px-6 py-5"><h2 className="text-xl font-black">{title}</h2><button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-lg text-zinc-400 hover:border-pink-400/40 hover:text-pink-300">×</button></div>
      <div className="p-6">{children}</div>
    </div>
  </div>;
}
