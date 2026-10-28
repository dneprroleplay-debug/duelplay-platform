const FRAME_IMAGE_BY_SLUG: Record<string, string> = {
  "neon-frame": "/images/frames/neon-frame.svg",
  "frame-neon-pulse": "/images/frames/frame-neon-pulse.svg",
  "frame-electric-storm": "/images/frames/frame-electric-storm.svg",
  "frame-inferno-crown": "/images/frames/frame-inferno-crown.svg",
  "frame-level-10": "/images/frames/frame-level-10.svg",
  "frame-level-20": "/images/frames/frame-level-20.svg",
  "frame-level-30": "/images/frames/frame-level-30.svg",
  "frame-level-40": "/images/frames/frame-level-40.svg",
  "frame-level-50": "/images/frames/frame-level-50.svg",
  "frame-level-75": "/images/frames/frame-level-75.svg",
  "frame-level-100": "/images/frames/frame-level-100.svg",
  "frame-profile-complete": "/images/frames/frame-profile-complete.svg",
};

export function cosmeticFrameImageUrl(slug: string, imageUrl?: string | null): string | null {
  return imageUrl || FRAME_IMAGE_BY_SLUG[slug] || null;
}
