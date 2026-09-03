"use client";

import { useEffect, useState } from "react";

export default function LoadingScreen({onComplete}:{onComplete?:()=>void}) {
  const [visible, setVisible] = useState(0);
  const letters = ["D", "U", "E", "L", "P", "L", "A", "Y"];

  useEffect(() => {
    let doneTimer:number|undefined;
    const interval = window.setInterval(() => {
      setVisible((prev) => {
        if (prev >= letters.length) {
          window.clearInterval(interval);
          doneTimer=window.setTimeout(()=>onComplete?.(),650);
          return prev;
        }
        return prev + 1;
      });
    }, 150);

    return () => {
      window.clearInterval(interval);
      if(doneTimer)window.clearTimeout(doneTimer);
    };
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black">
      <div className="flex gap-5 text-6xl font-extrabold tracking-[6px]">
        {letters.map((letter, index) => (
          <span key={index} className={`transition-all duration-500 ${
            index < visible
              ? "opacity-100 scale-100 text-pink-400 drop-shadow-[0_0_25px_var(--theme-glow)]"
              : "opacity-0 scale-50 text-zinc-900"
          }`}>{letter}</span>
        ))}
      </div>
    </div>
  );
}
