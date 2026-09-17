"use client";
import { useEffect, useState } from "react";

export default function ScrollToTop() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 260);
    onScroll(); window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return <button aria-label="Scroll to top" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className={`fixed bottom-5 right-5 z-[60] grid h-11 w-11 cursor-pointer place-items-center rounded-full border border-white/10 bg-[#0b0e13]/90 text-lg font-black text-pink-300 shadow-[0_10px_35px_rgba(0,0,0,.35)] backdrop-blur transition-all duration-200 hover:-translate-y-1 hover:border-pink-400/50 hover:bg-pink-400/10 hover:text-pink-200 active:scale-90 ${visible ? "opacity-100" : "pointer-events-none opacity-0"}`}>↑</button>;
}
