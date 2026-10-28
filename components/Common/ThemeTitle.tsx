"use client";

import type { CSSProperties, ReactNode } from "react";
import { themeById } from "@/lib/themes";

type Props = {
  children: ReactNode;
  themeId?: string | null;
  className?: string;
  rarityClassName?: string;
  title?: string;
};

/** Theme-aware title styling; the title item and its rarity semantics remain unchanged. */
export default function ThemeTitle({ children, themeId, className = "", rarityClassName = "", title }: Props) {
  const accent = themeById(typeof themeId === "string" ? themeId : "STANDARD").accent || "#ff2f91";
  return (
    <span
      title={title}
      className={`dp-theme-title inline-flex items-center rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wider ${rarityClassName} ${className}`}
      style={{ "--dp-title-accent": accent } as CSSProperties}
    >
      {children}
    </span>
  );
}
