"use client";

import { useEffect, useState } from "react";

export default function LoadingScreen() {
  const [visible, setVisible] = useState(0);

  const letters = ["D", "U", "E", "L", "P", "L", "A", "Y"];

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible((prev) => {
        if (prev >= letters.length) {
          clearInterval(interval);
          return prev;
        }
        return prev + 1;
      });
    }, 180);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black">
      <div className="flex gap-5 text-6xl font-extrabold tracking-[6px]">
        {letters.map((letter, index) => (
          <span
            key={index}
            className={`transition-all duration-500 ${
              index < visible
                ? "opacity-100 scale-100 text-cyan-400 drop-shadow-[0_0_25px_#22d3ee]"
                : "opacity-0 scale-50"
            }`}
          >
            {letter}
          </span>
        ))}
      </div>
    </div>
  );
}