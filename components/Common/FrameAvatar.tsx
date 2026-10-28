"use client";
type EquippedFrame = { slug?: string | null; name?: string | null; imageUrl?: string | null } | null | undefined;
type FrameAvatarProps = {
  src?: string | null;
  alt?: string;
  frame?: EquippedFrame;
  className?: string;
  imageClassName?: string;
  frameClassName?: string;
  fallback?: string;
};

/** Avatar and its equipped cosmetic frame share one square coordinate system. */
export default function FrameAvatar({ src, alt = "", frame, className = "", imageClassName = "", frameClassName = "", fallback = "/images/avatar-placeholder.svg" }: FrameAvatarProps) {
  const hasFrame = Boolean(frame?.imageUrl && frame?.slug);
  return (
    <span className={`relative inline-block shrink-0 aspect-square ${className}`}>
      <img
        data-player-name
        src={src || fallback}
        alt={alt}
        onError={(event) => { if (event.currentTarget.src !== new URL(fallback, window.location.href).href) event.currentTarget.src = fallback; }}
        className={hasFrame
          ? `absolute inset-[15%] h-[70%] w-[70%] rounded-[22%] object-cover object-center ${imageClassName}`
          : `h-full w-full rounded-xl object-cover object-center ${imageClassName}`}
      />
      {hasFrame && <img
        src={frame!.imageUrl!}
        alt=""
        aria-label={frame!.name || "Equipped profile frame"}
        title={frame!.name || undefined}
        draggable={false}
        className={`pointer-events-none absolute inset-0 h-full w-full object-fill frame-glow frame-glow--${frame!.slug} ${frameClassName}`}
      />}
    </span>
  );
}
