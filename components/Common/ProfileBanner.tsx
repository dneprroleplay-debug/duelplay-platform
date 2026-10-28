"use client";

import type { CSSProperties } from "react";
import { themeById } from "@/lib/themes";

type Props = { imageUrl?: string | null; name?: string; themeId?: string | null; compact?: boolean };

/** Original transparent DuelPlay artwork with a reusable pink-component mask and logo-shaped theme trail. */
export default function ProfileBanner({ name = "Profile banner", themeId, compact = false }: Props) {
  const accent = themeById(typeof themeId === "string" ? themeId : "STANDARD").accent || "#ff2f91";
  return (
    <div
      className={`dp-profile-banner relative isolate ${compact ? "dp-profile-banner--compact" : ""}`}
      style={{ "--dp-banner-trail": accent, "--dp-banner-accent": accent } as CSSProperties}
      data-banner-theme={themeId || "STANDARD"}
      aria-label={compact ? undefined : name}
    >
      <img
        className="dp-profile-banner__image"
        src="/images/banners/duelplay-neon-logo-cropped.png"
        alt={compact ? "" : name}
        aria-hidden={compact ? true : undefined}
        draggable={false}
      />
      <span className="dp-profile-banner__recolor" aria-hidden="true" />
      <svg aria-hidden="true" className="dp-profile-banner__trail" viewBox="0 0 1983 470" preserveAspectRatio="none">
        <path
          pathLength="1000"
          d="M 8,150
             C 60,132 105,126 156,126
             L 218,126 C 252,126 274,154 305,163
             C 337,172 359,148 376,113
             C 393,77 406,39 437,25
             C 469,10 500,27 524,52
             C 550,78 574,82 600,54
             C 626,27 656,25 682,43
             C 716,67 728,112 756,126
             C 783,140 814,125 846,124
             L 1074,124 C 1108,124 1127,142 1160,142
             L 1320,142 C 1355,142 1375,122 1407,122
             L 1608,122 C 1640,122 1660,141 1691,141
             L 1824,141 C 1877,141 1920,129 1975,150
             C 1932,174 1890,194 1840,194
             L 1730,194 C 1688,194 1667,217 1630,217
             L 1508,217 C 1470,217 1450,239 1412,239
             L 1114,239 C 1080,239 1060,263 1028,263
             L 800,263 C 765,263 741,295 711,322
             C 682,348 670,386 644,410
             C 618,434 586,425 562,398
             C 540,373 520,346 493,346
             C 464,346 444,373 422,399
             C 398,428 366,430 342,403
             C 316,374 307,338 280,318
             C 251,296 228,269 194,269
             L 93,269 C 58,269 32,244 8,220
             C 40,200 82,193 126,193 C 82,193 40,174 8,150 Z" />
      </svg>
    </div>
  );
}
