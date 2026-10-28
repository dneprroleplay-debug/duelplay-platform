"use client";

import type { CSSProperties } from "react";
import { themeById } from "@/lib/themes";

type Props = { imageUrl: string; name?: string; themeId?: string | null; compact?: boolean };

/** Shared equipped-banner renderer. The pink banner surface is independent of the owner's theme; only the moving perimeter light uses that theme's accent. */
export default function ProfileBanner({ imageUrl, name = "Profile banner", themeId, compact = false }: Props) {
  const accent = themeById(typeof themeId === "string" ? themeId : "STANDARD").accent || "#ff2f91";
  return (
    <div
      className={`dp-profile-banner relative isolate overflow-hidden rounded-2xl ${compact ? "dp-profile-banner--compact" : ""}`}
      style={{ "--dp-banner-trail": accent } as CSSProperties}
      data-banner-theme={themeId || "STANDARD"}
    >
      <div aria-hidden="true" className="dp-profile-banner__pink-base" />
      <img src={imageUrl} alt={compact ? "" : name} className="dp-profile-banner__image" loading="lazy" decoding="async" />
      <svg aria-hidden="true" className="dp-profile-banner__trail" viewBox="0 0 600 112" preserveAspectRatio="none">
        <rect x="1.5" y="1.5" width="597" height="109" rx="16" ry="16" pathLength="1000" />
      </svg>
    </div>
  );
}
