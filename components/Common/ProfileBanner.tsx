"use client";

import type { CSSProperties } from "react";
import { themeById } from "@/lib/themes";

type Props = { imageUrl: string; name?: string; themeId?: string | null; compact?: boolean };

/** Shared equipped-banner renderer. The pink banner surface is independent of the owner's theme; only the moving perimeter light uses that theme's accent. */
export default function ProfileBanner({ name = "Profile banner", themeId, compact = false }: Props) {
  const accent = themeById(typeof themeId === "string" ? themeId : "STANDARD").accent || "#ff2f91";
  return (
    <div
      className={`dp-profile-banner relative isolate overflow-hidden rounded-2xl ${compact ? "dp-profile-banner--compact" : ""}`}
      style={{ "--dp-banner-trail": accent } as CSSProperties}
      data-banner-theme={themeId || "STANDARD"}
      aria-label={compact ? undefined : name}
    >
      <div aria-hidden="true" className="dp-profile-banner__pink-base">
        <svg className="dp-profile-banner__brand" viewBox="0 0 230 36" focusable="false">
          <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round">
            <path d="M3 4h13l8 8-8 8H3l8-8L3 4Z" />
            <path d="M18 4h13l-8 8 8 8H18l8-8-8-8Z" opacity=".72" />
          </g>
          <text x="42" y="19" fill="currentColor" fontSize="13" fontWeight="700" letterSpacing="2.6">DUELPLAY</text>
        </svg>
      </div>
      <svg aria-hidden="true" className="dp-profile-banner__trail" viewBox="0 0 600 112" preserveAspectRatio="none">
        <rect x="1.5" y="1.5" width="597" height="109" rx="16" ry="16" pathLength="1000" />
      </svg>
    </div>
  );
}
