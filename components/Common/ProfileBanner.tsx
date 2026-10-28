"use client";

import type { CSSProperties } from "react";
import { themeById } from "@/lib/themes";

type Props = { imageUrl?: string | null; name?: string; themeId?: string | null; compact?: boolean };

/** Transparent DuelPlay logo with a theme-colored animated perimeter. The original PNG keeps its alpha channel. */
export default function ProfileBanner({ name = "Profile banner", themeId, compact = false }: Props) {
  const accent = themeById(typeof themeId === "string" ? themeId : "STANDARD").accent || "#ff2f91";
  return (
    <div
      className={`dp-profile-banner relative isolate ${compact ? "dp-profile-banner--compact" : ""}`}
      style={{ "--dp-banner-trail": accent } as CSSProperties}
      data-banner-theme={themeId || "STANDARD"}
      aria-label={compact ? undefined : name}
    >
      <img
        className="dp-profile-banner__image"
        src="/images/banners/duelplay-neon-logo.png"
        alt={compact ? "" : name}
        aria-hidden={compact ? true : undefined}
        draggable={false}
      />
      <svg aria-hidden="true" className="dp-profile-banner__trail" viewBox="0 0 600 240" preserveAspectRatio="none">
        <rect x="2" y="2" width="596" height="236" rx="18" ry="18" pathLength="1000" />
      </svg>
    </div>
  );
}
